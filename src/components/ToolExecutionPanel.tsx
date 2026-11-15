import {
  AlertTriangle,
  Calendar,
  Check,
  CheckCheck,
  CheckSquare,
  Edit3,
  ExternalLink,
  Eye,
  FlaskConical,
  Loader2,
  Mail,
  MessageSquare,
  Paperclip,
  Presentation,
  RotateCcw,
  Send,
  ShieldCheck,
  Sparkles,
  Terminal,
  Webhook,
  X,
} from "lucide-react";
import { useState } from "react";
import { buildMockSlideDeck } from "../data/mockGeminiResponses";
import type {
  AppSettings,
  IdempotencyRecord,
  LiveLogEntry,
  Meeting,
  NodeExecutionStatus,
  Person,
  PlannedToolAction,
  PlannedToolName,
  SlideDeckData,
  TicketPriority,
} from "../types/meetmind";
import {
  GoogleTokenExpiredError,
  createGmailDraft,
  createGoogleCalendarEvent,
  createGoogleSlidesPresentation,
  type GoogleAuthSession,
  isGoogleSessionValid,
  sendGmailDraft,
} from "../utils/googleAuth";
import { generatePptxBase64 } from "../utils/pptxGenerator";
import { SlideDeckPreview } from "./SlideDeckPreview";

interface ToolExecutionPanelProps {
  meeting: Meeting;
  people: Person[];
  settings: AppSettings;
  googleSession: GoogleAuthSession | null;
  plannedActions: PlannedToolAction[];
  idempotencyLedger: Record<string, IdempotencyRecord>;
  duplicatesBlockedTotal: number;
  mockMode: boolean;
  isPlanningTools: boolean;
  onPlanToolsWithGemini: () => Promise<void>;
  onUpdateActions: (next: PlannedToolAction[]) => void;
  onUpdateMeetingData: (patch: Partial<Meeting>) => void;
  onToggleTestMode: () => void;
  onSyncWorkflowNode?: (input: {
    toolName: PlannedToolName;
    status: NodeExecutionStatus;
    completedAt?: string;
    errorMessage?: string;
  }) => void;
  onCreateTicketFromTool: (input: {
    title: string;
    ownerName: string;
    priority: TicketPriority;
    dueDate: string;
    quote: string;
    meetingId: string;
  }) => string;
  onRecordIdempotency: (record: IdempotencyRecord, wasDuplicate: boolean) => void;
  onToast: (title: string, message: string) => void;
  onOpenSettings: () => void;
  onReconnectGoogle: () => Promise<void>;
}

function getToolMeta(name: PlannedToolName) {
  switch (name) {
    case "create_ticket":
      return { label: "Ticket", icon: CheckSquare, color: "text-rose-300" };
    case "draft_email":
    case "send_email":
      return { label: "Gmail", icon: Mail, color: "text-sky-300" };
    case "create_calendar_event":
      return { label: "Calendar", icon: Calendar, color: "text-emerald-300" };
    case "notify_slack":
      return { label: "Slack", icon: MessageSquare, color: "text-[#5eead4]" };
    case "call_n8n":
      return { label: "n8n", icon: Webhook, color: "text-amber-300" };
    case "create_presentation":
      return { label: "Slides", icon: Presentation, color: "text-indigo-300" };
  }
}

function formatHms(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(
    2,
    "0"
  )}:${String(d.getSeconds()).padStart(2, "0")}`;
}

export function ToolExecutionPanel({
  meeting,
  people,
  settings,
  googleSession,
  plannedActions,
  idempotencyLedger,
  duplicatesBlockedTotal,
  mockMode,
  isPlanningTools,
  onPlanToolsWithGemini,
  onUpdateActions,
  onUpdateMeetingData,
  onToggleTestMode,
  onSyncWorkflowNode,
  onCreateTicketFromTool,
  onRecordIdempotency,
  onToast,
  onOpenSettings,
  onReconnectGoogle,
}: ToolExecutionPanelProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [runningActionId, setRunningActionId] = useState<string | null>(null);
  const [dryRunPreviewOpen, setDryRunPreviewOpen] = useState(false);
  const [dryRunViewed, setDryRunViewed] = useState(false);

  // Explicit Send confirmation before calling Gmail Send API
  const [confirmSendActionId, setConfirmSendActionId] = useState<string | null>(null);

  // Live SSE streaming email preview
  const [streamingEmailBody, setStreamingEmailBody] = useState<string>("");
  const [isStreamingEmail, setIsStreamingEmail] = useState(false);

  // Presentation generation & Gmail .pptx attachment state
  const [isGeneratingDeck, setIsGeneratingDeck] = useState(false);
  const [isSavingGoogleSlides, setIsSavingGoogleSlides] = useState(false);
  const [isAttachingPptx, setIsAttachingPptx] = useState(false);

  const googleConnected = isGoogleSessionValid(googleSession);
  const hasFailed = plannedActions.some((a) => a.status === "failed");
  const hasPending = plannedActions.some((a) => a.status === "pending");
  const isActivelyRunning =
    Boolean(runningActionId) || isStreamingEmail || isGeneratingDeck || isSavingGoogleSlides;

  const liveLog = meeting.liveLog || [];
  const slideAction = plannedActions.find((a) => a.toolName === "create_presentation");
  const activeDeck = meeting.slideDeck || slideAction?.slideDeck;
  const activeSlidesUrl = slideAction?.googlePresentationUrl;
  const activePptxName = slideAction?.pptxFileName;
  const draftEmailAction = plannedActions.find((a) => a.toolName === "draft_email");

  // Resolve effective email recipient honoring Test Mode safety guard
  const safeTestEmail =
    settings.testEmail.trim() ||
    googleSession?.userEmail ||
    "uditnarayan3119@gmail.com";

  const resolveRecipient = (rawTo: string) => {
    if (settings.testMode) return safeTestEmail;
    return rawTo || safeTestEmail;
  };

  const appendLiveLog = (
    tool: string,
    status: LiveLogEntry["status"],
    message: string
  ) => {
    const entry: LiveLogEntry = {
      id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      time: formatHms(),
      tool,
      status,
      message,
    };
    const nextLog = [entry, ...(meeting.liveLog || [])].slice(0, 40);
    onUpdateMeetingData({ liveLog: nextLog });
  };

  const patchAction = (actionId: string, patch: Partial<PlannedToolAction>) => {
    onUpdateActions(
      plannedActions.map((a) => (a.id === actionId ? { ...a, ...patch } : a))
    );
  };

  const updateActionArg = (actionId: string, key: string, value: unknown) => {
    onUpdateActions(
      plannedActions.map((a) =>
        a.id === actionId
          ? {
              ...a,
              args: {
                ...a.args,
                [key]: value,
              },
            }
          : a
      )
    );
  };

  const generateDeckData = async (): Promise<SlideDeckData> => {
    if (mockMode) {
      await new Promise((r) => window.setTimeout(r, 260));
      return buildMockSlideDeck(meeting);
    }

    const resp = await fetch("/api/gemini/generate-slides", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        meetingTitle: meeting.title,
        date: meeting.date,
        summary: meeting.summary,
        modelName: settings.geminiModel,
        items: meeting.extractedItems.map((it) => ({
          kind: it.kind,
          liveCategory: it.liveCategory,
          title: it.title,
          dueDate: it.dueDate,
          priority: it.priority || "Medium",
          ownerName:
            people.find((p) => p.id === it.ownerId)?.name || it.rawOwner || "Unassigned",
        })),
      }),
    });

    const data = (await resp.json()) as SlideDeckData & { error?: string };
    if (!resp.ok || !Array.isArray(data.slides)) {
      throw new Error(data.error || "Could not generate slide deck.");
    }
    return data;
  };

  const handleStandaloneCreatePresentation = async () => {
    setIsGeneratingDeck(true);
    appendLiveLog("Slides", "running", "Generating 6–8 slide deck via Gemini...");
    try {
      const deck = await generateDeckData();
      const { filename } = await generatePptxBase64(deck);
      let googlePresentationId: string | undefined;
      let googlePresentationUrl: string | undefined;

      if (!mockMode && googleConnected && googleSession?.accessToken) {
        const created = await createGoogleSlidesPresentation(
          googleSession.accessToken,
          deck
        );
        googlePresentationId = created.presentationId;
        googlePresentationUrl = created.presentationUrl;
        appendLiveLog("Slides", "success", `Google Slides deck created ✓ (${deck.slides.length} slides)`);
      } else {
        appendLiveLog("Slides", "success", `Generated ${deck.slides.length}-slide preview + ${filename}`);
      }

      onUpdateMeetingData({ slideDeck: deck });
      if (slideAction) {
        patchAction(slideAction.id, {
          status: "executed",
          slideDeck: deck,
          pptxFileName: filename,
          googlePresentationId,
          googlePresentationUrl,
          executedAt: `Presentation created ✓ (${deck.slides.length} slides)`,
        });
      }
      onToast(
        "Presentation Created ✓",
        googlePresentationUrl
          ? `Created "${deck.deckTitle}" in Google Slides + .pptx export ready.`
          : `Generated "${deck.deckTitle}" (${deck.slides.length} slides) + .pptx export ready.`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Slide generation failed.";
      appendLiveLog("Slides", "error", msg);
      onToast("Presentation Error", msg);
    } finally {
      setIsGeneratingDeck(false);
    }
  };

  const handleSaveDeckToGoogleSlides = async () => {
    if (!activeDeck) return;
    setIsSavingGoogleSlides(true);
    appendLiveLog("Slides", "running", "Uploading slides to Google Slides API...");
    try {
      if (mockMode) {
        await new Promise((r) => window.setTimeout(r, 240));
        const mockUrl = "https://docs.google.com/presentation/u/0/";
        if (slideAction) {
          patchAction(slideAction.id, {
            googlePresentationUrl: mockUrl,
            executedAt: "Presentation created ✓ (Mock)",
          });
        }
        appendLiveLog("Slides", "success", "Google Slides preview created (Mock)");
        return;
      }

      if (!googleConnected || !googleSession?.accessToken) {
        throw new GoogleTokenExpiredError(
          "Connect Google in Settings (or above) with Presentations scope to create a Google Slides deck."
        );
      }

      const created = await createGoogleSlidesPresentation(
        googleSession.accessToken,
        activeDeck
      );
      if (slideAction) {
        patchAction(slideAction.id, {
          status: "executed",
          googlePresentationId: created.presentationId,
          googlePresentationUrl: created.presentationUrl,
          executedAt: `Google Slides created ✓`,
        });
      }
      appendLiveLog("Slides", "success", "Google Slides presentation created ✓");
      onToast("Google Slides Created ✓", "Opened presentation link is ready.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not save to Google Slides.";
      appendLiveLog("Slides", "error", msg);
      onToast("Google Slides Error", msg);
    } finally {
      setIsSavingGoogleSlides(false);
    }
  };

  const handleAttachPptxToGmail = async () => {
    if (!activeDeck) return;
    if (!draftEmailAction) {
      onToast("No Email Draft Action", "Prepare Tool Actions first so a Gmail draft step exists.");
      return;
    }

    setIsAttachingPptx(true);
    appendLiveLog("Gmail", "running", "Building .pptx and attaching to Gmail draft...");
    try {
      const attachment = await generatePptxBase64(activeDeck);
      const rawTo = String(draftEmailAction.args.to || "client@example.com");
      const effectiveTo = resolveRecipient(rawTo);
      const subject = String(
        draftEmailAction.args.subject || `${meeting.title} Recap & Presentation`
      );
      const body = String(draftEmailAction.args.body || meeting.summary);

      if (mockMode || !googleConnected || !googleSession?.accessToken) {
        patchAction(draftEmailAction.id, {
          attachPptx: true,
          attachmentName: attachment.filename,
          status: draftEmailAction.status === "executed" ? "executed" : "drafted",
          gmailDraftId:
            draftEmailAction.gmailDraftId || `mock_draft_${Date.now().toString().slice(-4)}`,
          gmailDraftUrl:
            draftEmailAction.gmailDraftUrl || "https://mail.google.com/mail/u/0/#drafts",
          executedAt: `Draft with ${attachment.filename} ready`,
        });
        appendLiveLog(
          "Gmail",
          "success",
          `Attached ${attachment.filename} to Gmail draft (${effectiveTo})`
        );
        onToast("Attached .pptx to Draft ✓", `${attachment.filename} attached for ${effectiveTo}.`);
        return;
      }

      const draft = await createGmailDraft(googleSession.accessToken, {
        to: effectiveTo,
        subject,
        body,
        attachment,
      });

      patchAction(draftEmailAction.id, {
        status: "drafted",
        attachPptx: true,
        attachmentName: attachment.filename,
        gmailDraftId: draft.draftId,
        gmailDraftUrl: draft.draftUrl,
        executedAt: `Draft created with ${attachment.filename} ✓`,
      });
      appendLiveLog(
        "Gmail",
        "success",
        `Gmail draft updated with ${attachment.filename} → ${effectiveTo}`
      );
      onToast(
        "Gmail Draft Updated ✓",
        `Created real Gmail draft with ${attachment.filename} attached.`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not attach .pptx to Gmail draft.";
      appendLiveLog("Gmail", "error", msg);
      onToast("Attachment Error", msg);
    } finally {
      setIsAttachingPptx(false);
    }
  };

  const streamEmailDraftText = async (to: string, fallbackBody: string): Promise<string> => {
    setIsStreamingEmail(true);
    setStreamingEmailBody("");

    if (mockMode) {
      const tokens = fallbackBody.split(/(\s+)/);
      let accumulated = "";
      for (const tok of tokens) {
        accumulated += tok;
        setStreamingEmailBody(accumulated);
        await new Promise((r) => window.setTimeout(r, 15));
      }
      setIsStreamingEmail(false);
      return accumulated;
    }

    try {
      const response = await fetch("/api/gemini/draft-email-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          meetingTitle: meeting.title,
          summary: meeting.summary,
          to,
          modelName: settings.geminiModel,
          items: meeting.extractedItems.map((it) => ({
            kind: it.liveCategory || it.kind,
            title: it.title,
            dueDate: it.dueDate,
            ownerName:
              people.find((p) => p.id === it.ownerId)?.name || it.rawOwner || "Team",
          })),
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error("Stream unavailable");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullText = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() || "";
        for (const ev of events) {
          const line = ev.trim();
          if (!line.startsWith("data:")) continue;
          const jsonStr = line.slice(5).trim();
          try {
            const payload = JSON.parse(jsonStr) as { text?: string };
            if (payload.text) {
              fullText += payload.text;
              setStreamingEmailBody(fullText);
            }
          } catch {
            // Ignore partial chunk parse
          }
        }
      }

      setIsStreamingEmail(false);
      return fullText.trim() || fallbackBody;
    } catch {
      setIsStreamingEmail(false);
      setStreamingEmailBody(fallbackBody);
      return fallbackBody;
    }
  };

  const executeSingleAction = async (action: PlannedToolAction): Promise<boolean> => {
    if (idempotencyLedger[action.idempotencyKey]) {
      onRecordIdempotency(idempotencyLedger[action.idempotencyKey], true);
      patchAction(action.id, {
        status: "executed",
        error: undefined,
        executedAt: "Skipped duplicate (already succeeded)",
      });
      appendLiveLog(
        getToolMeta(action.toolName).label,
        "skipped",
        `Duplicate blocked: ${action.title}`
      );
      onToast("Duplicate Blocked", `Skipped "${action.title}" — already executed.`);
      return true;
    }

    setRunningActionId(action.id);
    patchAction(action.id, { error: undefined });
    onSyncWorkflowNode?.({ toolName: action.toolName, status: "running" });
    appendLiveLog(getToolMeta(action.toolName).label, "running", `Permitted: ${action.title}`);

    try {
      const nowTime = new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });

      if (action.toolName === "create_ticket") {
        const ticketKey = onCreateTicketFromTool({
          title: String(action.args.title || action.title),
          ownerName: String(action.args.owner || ""),
          priority: (String(action.args.priority || "Medium") as TicketPriority) || "Medium",
          dueDate: String(action.args.due || "TBD"),
          quote: String(action.args.quote || ""),
          meetingId: meeting.id,
        });

        onRecordIdempotency(
          {
            key: action.idempotencyKey,
            nodeId: action.id,
            meetingId: meeting.id,
            completedAt: nowTime,
            outputSummary: `Created ticket ${ticketKey}`,
          },
          false
        );

        patchAction(action.id, {
          status: "executed",
          ticketKey,
          executedAt: `Ticket ${ticketKey} created ✓ at ${nowTime}`,
        });
        onSyncWorkflowNode?.({
          toolName: action.toolName,
          status: "done",
          completedAt: nowTime,
        });
        appendLiveLog("Ticket", "success", `Created ${ticketKey}: ${String(action.args.title || "")}`);
        onToast("Ticket Created ✓", `${ticketKey}: ${String(action.args.title || "")}`);
        return true;
      }

      if (action.toolName === "draft_email") {
        const rawTo = String(action.args.to || "client@example.com");
        const effectiveTo = resolveRecipient(rawTo);
        const subject = String(action.args.subject || `${meeting.title} Recap`);
        const existingBody = String(action.args.body || meeting.summary);

        const finalBody =
          existingBody.trim().length > 20
            ? await streamEmailDraftText(effectiveTo, existingBody)
            : await streamEmailDraftText(effectiveTo, meeting.summary);

        let attachment: { filename: string; mimeType: string; base64Data: string } | undefined;
        if (action.attachPptx && activeDeck) {
          attachment = await generatePptxBase64(activeDeck);
        }

        if (mockMode) {
          const mockDraftId = `mock_draft_${Date.now().toString().slice(-5)}`;
          patchAction(action.id, {
            status: "drafted",
            gmailDraftId: mockDraftId,
            gmailDraftUrl: "https://mail.google.com/mail/u/0/#drafts",
            attachmentName: attachment?.filename,
            args: { ...action.args, to: rawTo, subject, body: finalBody },
            executedAt: `Draft created ✓ (${effectiveTo}) at ${nowTime}`,
          });
          onSyncWorkflowNode?.({ toolName: action.toolName, status: "waiting" });
          appendLiveLog(
            "Gmail",
            "success",
            `Gmail draft created (Mock) → ${effectiveTo}${
              attachment ? ` + ${attachment.filename}` : ""
            }`
          );
          onToast("Draft created ✓", `Ready for ${effectiveTo}. Review and click Send.`);
          return true;
        }

        if (!googleConnected || !googleSession?.accessToken) {
          throw new GoogleTokenExpiredError(
            "Google account not connected or token expired. Reconnect Google, then click Resume."
          );
        }

        const draft = await createGmailDraft(googleSession.accessToken, {
          to: effectiveTo,
          subject,
          body: finalBody,
          attachment,
        });

        patchAction(action.id, {
          status: "drafted",
          gmailDraftId: draft.draftId,
          gmailDraftUrl: draft.draftUrl,
          attachmentName: attachment?.filename,
          args: { ...action.args, to: rawTo, subject, body: finalBody },
          executedAt: `Draft created ✓ (${effectiveTo}) at ${nowTime}`,
        });
        onSyncWorkflowNode?.({ toolName: action.toolName, status: "waiting" });
        appendLiveLog(
          "Gmail",
          "success",
          `Gmail draft created ✓ → ${effectiveTo}${
            attachment ? ` (+ ${attachment.filename})` : ""
          }`
        );
        onToast("Draft created ✓", `Saved in Gmail for ${effectiveTo}. Click Send when ready.`);
        return true;
      }

      if (action.toolName === "create_calendar_event") {
        const title = String(action.args.title || `${meeting.title} Follow-up`);
        const date = String(action.args.date || "Thu 19 Nov");
        const time = String(action.args.time || "4:00 PM");
        const durationMins = Number(action.args.durationMins || 30);
        const attendees = Array.isArray(action.args.attendees)
          ? action.args.attendees.map(String)
          : String(action.args.attendees || "")
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
        const description = String(action.args.description || meeting.summary);

        let calUrl = "https://calendar.google.com/calendar";
        if (!mockMode) {
          if (!googleConnected || !googleSession?.accessToken) {
            throw new GoogleTokenExpiredError(
              "Google Calendar requires an active Google connection. Connect Google, then click Resume."
            );
          }
          const created = await createGoogleCalendarEvent(googleSession.accessToken, {
            title,
            date,
            time,
            durationMins,
            attendees,
            description,
          });
          calUrl = created.htmlLink;
        }

        onRecordIdempotency(
          {
            key: action.idempotencyKey,
            nodeId: action.id,
            meetingId: meeting.id,
            completedAt: nowTime,
            outputSummary: `Calendar event "${title}" created`,
          },
          false
        );

        patchAction(action.id, {
          status: "executed",
          calendarEventUrl: calUrl,
          executedAt: `Event created ✓ at ${nowTime}`,
        });
        onSyncWorkflowNode?.({
          toolName: action.toolName,
          status: "done",
          completedAt: nowTime,
        });
        appendLiveLog("Calendar", "success", `Event created ✓ "${title}" (${date} ${time})`);
        onToast("Event created ✓", `${title} on ${date} at ${time}`);
        return true;
      }

      if (action.toolName === "create_presentation") {
        const deck = await generateDeckData();
        const { filename } = await generatePptxBase64(deck);
        let googlePresentationId: string | undefined;
        let googlePresentationUrl: string | undefined;

        if (!mockMode && googleConnected && googleSession?.accessToken) {
          const created = await createGoogleSlidesPresentation(
            googleSession.accessToken,
            deck
          );
          googlePresentationId = created.presentationId;
          googlePresentationUrl = created.presentationUrl;
        } else if (!mockMode && (!googleConnected || !googleSession?.accessToken)) {
          // Still keep slide preview & .pptx usable, but if explicitly wanting Google Slides API check:
          appendLiveLog(
            "Slides",
            "info",
            "Google not connected — generated interactive preview & .pptx locally (connect Google to push to Slides)."
          );
        }

        onRecordIdempotency(
          {
            key: action.idempotencyKey,
            nodeId: action.id,
            meetingId: meeting.id,
            completedAt: nowTime,
            outputSummary: `Presentation created (${deck.slides.length} slides)`,
          },
          false
        );

        onUpdateMeetingData({ slideDeck: deck });
        patchAction(action.id, {
          status: "executed",
          slideDeck: deck,
          pptxFileName: filename,
          googlePresentationId,
          googlePresentationUrl,
          executedAt: `Presentation created ✓ at ${nowTime}`,
        });
        onSyncWorkflowNode?.({
          toolName: action.toolName,
          status: "done",
          completedAt: nowTime,
        });
        appendLiveLog(
          "Slides",
          "success",
          `Presentation created ✓ (${deck.slides.length} slides · ${filename})`
        );
        onToast("Presentation created ✓", `${deck.slides.length} slides + ${filename} ready.`);
        return true;
      }

      if (action.toolName === "notify_slack") {
        const message = String(
          action.args.message || `[MeetMind] ${meeting.title} action plan ready.`
        );
        const webhook = settings.slackWebhookUrl.trim();
        if (webhook && !mockMode) {
          const resp = await fetch("/api/integrations/webhook", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              url: webhook,
              payload: {
                text: message,
                meetingId: meeting.id,
                items: meeting.extractedItems,
              },
            }),
          });
          const data = (await resp.json().catch(() => ({}))) as { error?: string };
          if (!resp.ok) {
            throw new Error(data.error || "Slack webhook delivery failed.");
          }
          appendLiveLog("Slack", "success", "Slack webhook delivered ✓");
          onToast("Slack Notified ✓", "Posted meeting summary to your Slack webhook.");
        } else {
          appendLiveLog("Slack", "success", "Slack nudge previewed (no webhook URL configured)");
          onToast("Slack Nudge Preview", message);
        }

        onRecordIdempotency(
          {
            key: action.idempotencyKey,
            nodeId: action.id,
            meetingId: meeting.id,
            completedAt: nowTime,
            outputSummary: webhook ? "Sent to Slack webhook" : "Shown as toast notification",
          },
          false
        );

        patchAction(action.id, {
          status: "executed",
          executedAt: `${webhook && !mockMode ? "Sent to Slack ✓" : "Toast preview ✓"} at ${nowTime}`,
        });
        onSyncWorkflowNode?.({
          toolName: action.toolName,
          status: "done",
          completedAt: nowTime,
        });
        return true;
      }

      // call_n8n
      const webhook = settings.n8nWebhookUrl.trim();
      const payload = {
        meetingId: meeting.id,
        meetingTitle: meeting.title,
        date: meeting.date,
        duration: meeting.duration,
        language: meeting.language || "English/Hinglish",
        speakers: meeting.segments.map((s) => s.speakerName),
        timestamps: meeting.segments.map((s) => ({
          id: s.id,
          timestamp: s.timestamp,
          speaker: s.speakerName,
        })),
        owners: meeting.extractedItems.map((i) => ({
          title: i.title,
          owner: people.find((p) => p.id === i.ownerId)?.name || i.rawOwner || "Unassigned",
          dueDate: i.dueDate,
        })),
        items: meeting.extractedItems,
        ...action.args,
      };

      if (webhook && !mockMode) {
        const resp = await fetch("/api/integrations/webhook", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: webhook, payload }),
        });
        const data = (await resp.json().catch(() => ({}))) as { error?: string };
        if (!resp.ok) {
          throw new Error(data.error || "n8n/Zapier webhook returned an error.");
        }
        appendLiveLog("n8n", "success", `n8n webhook delivered (${meeting.extractedItems.length} items)`);
        onToast("n8n Webhook Delivered ✓", `Sent ${meeting.extractedItems.length} items to automation webhook.`);
      } else {
        appendLiveLog("n8n", "success", "n8n payload logged locally");
        onToast(
          "n8n Payload Ready",
          webhook
            ? "Simulated n8n webhook delivery in Mock Mode."
            : "No n8n webhook URL set in Settings — payload logged locally."
        );
      }

      onRecordIdempotency(
        {
          key: action.idempotencyKey,
          nodeId: action.id,
          meetingId: meeting.id,
          completedAt: nowTime,
          outputSummary: "n8n webhook step completed",
        },
        false
      );

      patchAction(action.id, {
        status: "executed",
        executedAt: `${webhook && !mockMode ? "Delivered ✓" : "Logged locally ✓"} at ${nowTime}`,
      });
      onSyncWorkflowNode?.({
        toolName: action.toolName,
        status: "done",
        completedAt: nowTime,
      });
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Tool execution failed.";
      patchAction(action.id, {
        status: "failed",
        error: msg,
      });
      onSyncWorkflowNode?.({
        toolName: action.toolName,
        status: "failed",
        errorMessage: msg,
      });
      appendLiveLog(getToolMeta(action.toolName).label, "error", msg);
      return false;
    } finally {
      setRunningActionId(null);
    }
  };

  const handleConfirmAndSendEmail = async (action: PlannedToolAction) => {
    if (!action.gmailDraftId) return;
    setConfirmSendActionId(null);
    setRunningActionId(action.id);
    patchAction(action.id, { error: undefined });
    onSyncWorkflowNode?.({ toolName: "draft_email", status: "running" });

    const effectiveTo = resolveRecipient(String(action.args.to || "client@example.com"));
    appendLiveLog("Gmail", "running", `Sending draft to ${effectiveTo}...`);

    try {
      let sentAt = new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });

      if (!mockMode) {
        if (!googleConnected || !googleSession?.accessToken) {
          throw new GoogleTokenExpiredError(
            "Gmail token expired before send. Reconnect Google, then click Resume."
          );
        }
        const sent = await sendGmailDraft(googleSession.accessToken, action.gmailDraftId);
        sentAt = sent.sentAt;
      }

      onRecordIdempotency(
        {
          key: `${action.idempotencyKey}:send`,
          nodeId: action.id,
          meetingId: meeting.id,
          completedAt: sentAt,
          outputSummary: `Email sent to ${effectiveTo} at ${sentAt}`,
        },
        false
      );

      patchAction(action.id, {
        status: "executed",
        sentAt,
        gmailDraftUrl: "https://mail.google.com/mail/u/0/#sent",
        executedAt: `Sent ✓ ${sentAt}`,
      });
      onSyncWorkflowNode?.({
        toolName: "draft_email",
        status: "done",
        completedAt: sentAt,
      });
      appendLiveLog("Gmail", "success", `Email sent ✓ ${sentAt} → ${effectiveTo}`);
      onToast(`Sent ✓ ${sentAt}`, `Email delivered to ${effectiveTo}.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not send Gmail draft.";
      patchAction(action.id, {
        status: "failed",
        error: msg,
      });
      onSyncWorkflowNode?.({
        toolName: "draft_email",
        status: "failed",
        errorMessage: msg,
      });
      appendLiveLog("Gmail", "error", msg);
    } finally {
      setRunningActionId(null);
    }
  };

  const handlePermitAll = async () => {
    for (const action of plannedActions) {
      if (action.status === "pending") {
        const ok = await executeSingleAction(action);
        if (!ok) break;
      }
    }
  };

  const handleResumeFailed = async () => {
    for (const action of plannedActions) {
      if (action.status === "failed" || action.status === "pending") {
        if (action.gmailDraftId && action.toolName === "draft_email") {
          await handleConfirmAndSendEmail(action);
        } else {
          const ok = await executeSingleAction(action);
          if (!ok) break;
        }
      }
    }
  };

  return (
    <div className="space-y-5">
      {/* Header & Top Action Controls */}
      <div className="glass-card rounded-2xl p-5">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h3 className="font-serif text-xl italic text-slate-50">
                Execution Permissions &amp; Real Actions
              </h3>
              <span className="rounded-lg border border-white/[0.12] bg-white/[0.05] px-2.5 py-0.5 font-mono text-[10px] text-[#5eead4]">
                Never auto-runs
              </span>
              {isActivelyRunning && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[#5eead4]/45 bg-[#5eead4]/15 px-2.5 py-0.5 font-mono text-[10px] font-semibold text-[#99f6e4]">
                  <span className="h-1.5 w-1.5 animate-ping rounded-full bg-[#5eead4]" />
                  Live
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-slate-300/80">
              Review each proposed action below. Click <span className="text-slate-100 font-medium">Permit</span>, <span className="text-slate-100 font-medium">Edit</span>, or <span className="text-slate-100 font-medium">Skip</span> — nothing is sent or created without your explicit permission.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Test Mode Toggle */}
            <button
              type="button"
              onClick={onToggleTestMode}
              title="When Test mode is ON, outgoing emails go only to your own Google email"
              className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 font-mono text-[11px] font-medium whitespace-nowrap shrink-0 transition-colors ${
                settings.testMode
                  ? "border-amber-300/50 bg-amber-400/15 text-amber-100"
                  : "border-white/[0.14] bg-white/[0.05] text-slate-300 hover:bg-white/[0.1]"
              }`}
            >
              <FlaskConical className="h-3.5 w-3.5" />
              Test mode: {settings.testMode ? "ON" : "OFF"}
            </button>

            <div className="glass-inset rounded-xl px-3 py-1.5 font-mono text-[11px] text-slate-200 tabular-nums">
              Duplicates blocked:{" "}
              <span className="font-semibold text-[#5eead4]">{duplicatesBlockedTotal}</span>
            </div>

            <button
              type="button"
              onClick={() => void handleStandaloneCreatePresentation()}
              disabled={isGeneratingDeck}
              className="btn-glazed-soft inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-medium whitespace-nowrap shrink-0 disabled:opacity-50"
            >
              {isGeneratingDeck ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Presentation className="h-3.5 w-3.5" />
              )}
              {isGeneratingDeck ? "Creating Deck..." : "Create presentation"}
            </button>

            <button
              type="button"
              onClick={() => void onPlanToolsWithGemini()}
              disabled={isPlanningTools}
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/[0.14] bg-white/[0.05] px-3.5 py-2 text-xs font-medium text-slate-100 whitespace-nowrap shrink-0 hover:bg-white/[0.1] disabled:opacity-50"
            >
              {isPlanningTools ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5 text-[#5eead4]" />
              )}
              {isPlanningTools
                ? "Planning..."
                : plannedActions.length > 0
                ? "Re-plan Tools"
                : "Prepare Tool Actions"}
            </button>

            {plannedActions.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setDryRunPreviewOpen((v) => !v);
                    setDryRunViewed(true);
                  }}
                  className={`inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                    dryRunPreviewOpen
                      ? "border-[#5eead4]/55 bg-[#5eead4]/18 text-white"
                      : "border-white/[0.14] bg-white/[0.05] text-slate-100 hover:bg-white/[0.1]"
                  }`}
                >
                  <Eye className="h-3.5 w-3.5 text-[#5eead4]" />
                  Dry Run
                </button>

                <button
                  type="button"
                  onClick={() => void handlePermitAll()}
                  disabled={!dryRunViewed || !hasPending || Boolean(runningActionId)}
                  title={
                    !dryRunViewed
                      ? "View Dry Run summary first to unlock Permit all"
                      : "Permit all pending steps sequentially"
                  }
                  className="btn-glazed-primary inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold whitespace-nowrap shrink-0 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <CheckCheck className="h-3.5 w-3.5" />
                  Permit all
                </button>
              </>
            )}

            {hasFailed && (
              <button
                type="button"
                onClick={() => void handleResumeFailed()}
                className="btn-crimson-tactile inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold whitespace-nowrap shrink-0"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Resume
              </button>
            )}
          </div>
        </div>

        {/* Test Mode Safety Banner */}
        {settings.testMode && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300/30 bg-amber-400/10 px-4 py-2 font-mono text-[11px] text-amber-100">
            <span>
              Test Mode Active → Outgoing Gmail drafts &amp; sends redirect exclusively to{" "}
              <span className="font-semibold text-white">{safeTestEmail}</span>.
            </span>
            <button
              type="button"
              onClick={onOpenSettings}
              className="text-amber-200 underline underline-offset-4 hover:text-white"
            >
              Change test email
            </button>
          </div>
        )}

        {/* Google Connection Prompt if not connected */}
        {!mockMode && !googleConnected && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sky-400/30 bg-sky-500/10 px-4 py-2.5 text-xs text-sky-100">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 text-sky-300" />
              <span>
                Connect Google Workspace to enable real Gmail drafts/send, Google Calendar events, and Google Slides decks.
              </span>
            </div>
            <div className="flex items-center gap-2">
              {settings.googleClientId.trim() ? (
                <button
                  type="button"
                  onClick={() => void onReconnectGoogle()}
                  className="rounded-lg border border-sky-300/45 bg-sky-400/20 px-3 py-1 font-mono text-[11px] font-medium text-sky-50 hover:bg-sky-400/30"
                >
                  Connect Google
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onOpenSettings}
                  className="rounded-lg border border-sky-300/45 bg-sky-400/20 px-3 py-1 font-mono text-[11px] font-medium text-sky-50 hover:bg-sky-400/30"
                >
                  Set Client ID in Settings
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Dry Run Summary Drawer */}
      {dryRunPreviewOpen && plannedActions.length > 0 && (
        <div className="glass-card-elevated rounded-2xl p-5">
          <div className="flex items-center justify-between border-b border-white/[0.09] pb-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-[#5eead4]" />
              <span className="font-serif text-base italic text-slate-50">
                Dry Run Inspection — Zero side-effects executed
              </span>
            </div>
            <button
              type="button"
              onClick={() => setDryRunPreviewOpen(false)}
              className="text-slate-300 hover:text-white"
              aria-label="Close dry run preview"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
            {plannedActions.map((act, idx) => (
              <div key={act.id} className="glass-inset rounded-xl p-3 text-xs">
                <div className="font-mono text-[11px] text-[#5eead4]">
                  {idx + 1}. {act.toolName}
                </div>
                <div className="mt-1 font-medium text-slate-100">{act.title}</div>
                <pre className="mt-2 max-h-28 overflow-auto font-mono text-[10px] leading-relaxed whitespace-pre-wrap text-slate-300/85">
                  {JSON.stringify(
                    act.toolName === "draft_email"
                      ? { ...act.args, effectiveRecipient: resolveRecipient(String(act.args.to || "")) }
                      : act.args,
                    null,
                    2
                  )}
                </pre>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main Grid: Permission Cards (Left 8 cols) + Right-Side Live Log (4 cols) */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12 xl:items-start">
        <div className="space-y-3 xl:col-span-8">
          {plannedActions.length === 0 ? (
            <div className="glass-card rounded-2xl px-6 py-10 text-center text-xs text-slate-400">
              Click <span className="font-semibold text-[#5eead4]">Prepare Tool Actions</span> to generate Ticket, Gmail, Calendar, Slides, Slack, and n8n permission cards.
            </div>
          ) : (
            plannedActions.map((action) => {
              const meta = getToolMeta(action.toolName);
              const Icon = meta.icon;
              const isEditing = editingId === action.id;
              const isBusy = runningActionId === action.id;
              const isConfirmingSend = confirmSendActionId === action.id;
              const effectiveEmailTo = resolveRecipient(String(action.args.to || "client@example.com"));

              return (
                <div
                  key={action.id}
                  className={`glass-card rounded-2xl p-5 transition-all ${
                    action.status === "failed"
                      ? "border-rose-400/50 bg-rose-500/[0.06]"
                      : action.status === "executed"
                      ? "border-emerald-400/35"
                      : action.status === "drafted"
                      ? "border-sky-400/45"
                      : ""
                  }`}
                >
                  <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
                        <span className={`inline-flex items-center gap-1.5 font-semibold ${meta.color}`}>
                          <Icon className="h-3.5 w-3.5" />
                          {meta.label}
                        </span>
                        <span className="text-slate-500">·</span>
                        <span
                          className={`rounded-md px-2 py-0.5 text-[10px] font-medium ${
                            action.status === "executed"
                              ? "bg-emerald-400/15 text-emerald-200"
                              : action.status === "drafted"
                              ? "bg-sky-400/18 text-sky-200"
                              : action.status === "failed"
                              ? "bg-rose-500/20 text-rose-200"
                              : action.status === "skipped"
                              ? "bg-white/[0.06] text-slate-400"
                              : "bg-amber-400/15 text-amber-200"
                          }`}
                        >
                          {action.status}
                        </span>
                        {action.attachmentName && (
                          <span className="inline-flex items-center gap-1 rounded-md border border-indigo-300/35 bg-indigo-400/12 px-2 py-0.5 text-[10px] text-indigo-200">
                            <Paperclip className="h-2.5 w-2.5" />
                            {action.attachmentName}
                          </span>
                        )}
                        {action.executedAt && (
                          <span className="text-emerald-300">{action.executedAt}</span>
                        )}
                      </div>

                      <h4 className="mt-1.5 text-sm font-semibold text-slate-50">
                        {action.title}
                      </h4>
                      <p className="mt-1 text-xs text-slate-300/80">{action.description}</p>
                    </div>

                    {/* Permission Buttons: [Permit] [Edit] [Skip] */}
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      {action.status === "pending" && (
                        <>
                          <button
                            type="button"
                            onClick={() => void executeSingleAction(action)}
                            disabled={isBusy}
                            className="btn-glazed-primary inline-flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-semibold disabled:opacity-50"
                          >
                            {isBusy ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Check className="h-3.5 w-3.5" />
                            )}
                            Permit
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(isEditing ? null : action.id)}
                            className="inline-flex items-center gap-1 rounded-xl border border-white/[0.14] bg-white/[0.05] px-3 py-1.5 text-xs text-slate-200 hover:bg-white/[0.1]"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                            {isEditing ? "Done" : "Edit"}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              patchAction(action.id, { status: "skipped" });
                              appendLiveLog(meta.label, "skipped", `Skipped: ${action.title}`);
                            }}
                            className="inline-flex items-center gap-1 rounded-xl border border-white/[0.1] px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200"
                          >
                            Skip
                          </button>
                        </>
                      )}

                      {action.status === "drafted" && action.toolName === "draft_email" && (
                        <div className="flex flex-wrap items-center gap-2">
                          {action.gmailDraftUrl && (
                            <a
                              href={action.gmailDraftUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 rounded-xl border border-sky-300/40 bg-sky-400/12 px-3 py-1.5 font-mono text-[11px] text-sky-200 hover:bg-sky-400/20"
                            >
                              Open Draft
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                          <button
                            type="button"
                            onClick={() => setConfirmSendActionId(action.id)}
                            disabled={isBusy}
                            className="btn-glazed-primary inline-flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-semibold"
                          >
                            <Send className="h-3.5 w-3.5" />
                            Send
                          </button>
                        </div>
                      )}

                      {action.status === "executed" &&
                        action.toolName === "draft_email" &&
                        action.gmailDraftUrl && (
                          <a
                            href={action.gmailDraftUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn-glazed-soft inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 font-mono text-[11px]"
                          >
                            Open in Gmail
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}

                      {action.status === "executed" && action.calendarEventUrl && (
                        <a
                          href={action.calendarEventUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn-glazed-soft inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 font-mono text-[11px]"
                        >
                          Open Event
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}

                      {action.status === "executed" && action.googlePresentationUrl && (
                        <a
                          href={action.googlePresentationUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn-glazed-soft inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 font-mono text-[11px]"
                        >
                          Open Slides
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}

                      {action.status === "failed" && (
                        <button
                          type="button"
                          onClick={() =>
                            action.gmailDraftId && action.toolName === "draft_email"
                              ? void handleConfirmAndSendEmail(action)
                              : void executeSingleAction(action)
                          }
                          disabled={isBusy}
                          className="btn-crimson-tactile inline-flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-semibold"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          Resume
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Explicit Send Confirmation Box */}
                  {isConfirmingSend && (
                    <div className="mt-3 rounded-xl border border-amber-300/50 bg-amber-400/12 p-4 text-xs">
                      <div className="font-mono text-[11px] font-semibold text-amber-200">
                        Confirm Outgoing Email Summary
                      </div>
                      <div className="mt-2 space-y-1 font-mono text-[11px] text-slate-100">
                        <div>
                          <span className="text-slate-400">Recipient: </span>
                          <span className="text-[#5eead4]">{effectiveEmailTo}</span>
                          {settings.testMode && (
                            <span className="ml-2 text-amber-200">(Test Mode redirect)</span>
                          )}
                        </div>
                        <div>
                          <span className="text-slate-400">Subject: </span>
                          <span>{String(action.args.subject || "")}</span>
                        </div>
                        {action.attachmentName && (
                          <div>
                            <span className="text-slate-400">Attachment: </span>
                            <span className="text-indigo-200">{action.attachmentName}</span>
                          </div>
                        )}
                      </div>
                      <div className="mt-3 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void handleConfirmAndSendEmail(action)}
                          className="btn-glazed-primary inline-flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-semibold"
                        >
                          <Send className="h-3.5 w-3.5" />
                          Confirm &amp; Send
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmSendActionId(null)}
                          className="rounded-xl border border-white/[0.14] px-3 py-1.5 text-xs text-slate-200 hover:bg-white/[0.08]"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Error Message + Reconnect CTA */}
                  {action.error && (
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-rose-400/35 bg-rose-500/12 px-3.5 py-2.5 text-xs text-rose-100">
                      <span>{action.error}</span>
                      {action.error.toLowerCase().includes("google") && (
                        <button
                          type="button"
                          onClick={() => void onReconnectGoogle()}
                          className="rounded-lg border border-rose-300/40 bg-rose-500/20 px-2.5 py-1 font-mono text-[11px] font-medium hover:bg-rose-500/30"
                        >
                          Reconnect Google
                        </button>
                      )}
                    </div>
                  )}

                  {/* Editable Preview for Email & Other Tools */}
                  {(action.toolName === "draft_email" || isEditing) && (
                    <div className="glass-inset mt-3.5 space-y-2.5 rounded-xl p-3.5 text-xs">
                      {action.toolName === "draft_email" ? (
                        <>
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            <div>
                              <label className="block font-mono text-[10px] text-slate-400">
                                To {settings.testMode ? `(Test Mode → ${safeTestEmail})` : ""}
                              </label>
                              <input
                                type="text"
                                value={String(action.args.to || "")}
                                onChange={(e) =>
                                  updateActionArg(action.id, "to", e.target.value)
                                }
                                className="mt-1 w-full rounded-lg border border-white/[0.1] bg-[#071318]/80 px-2.5 py-1.5 font-mono text-xs text-slate-100 focus:border-[#5eead4] focus:outline-none"
                              />
                            </div>
                            <div>
                              <label className="block font-mono text-[10px] text-slate-400">
                                Subject
                              </label>
                              <input
                                type="text"
                                value={String(action.args.subject || "")}
                                onChange={(e) =>
                                  updateActionArg(action.id, "subject", e.target.value)
                                }
                                className="mt-1 w-full rounded-lg border border-white/[0.1] bg-[#071318]/80 px-2.5 py-1.5 text-xs text-slate-100 focus:border-[#5eead4] focus:outline-none"
                              />
                            </div>
                          </div>
                          <div>
                            <label className="block font-mono text-[10px] text-slate-400">
                              Email Body (live-typed &amp; editable before draft/send)
                            </label>
                            <textarea
                              rows={4}
                              value={
                                isStreamingEmail && runningActionId === action.id
                                  ? streamingEmailBody
                                  : String(action.args.body || "")
                              }
                              onChange={(e) =>
                                updateActionArg(action.id, "body", e.target.value)
                              }
                              className="mt-1 w-full rounded-lg border border-white/[0.1] bg-[#071318]/80 p-2.5 text-xs leading-relaxed text-slate-100 focus:border-[#5eead4] focus:outline-none"
                            />
                          </div>
                        </>
                      ) : (
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          {Object.entries(action.args).map(([k, v]) => (
                            <div key={k}>
                              <label className="block font-mono text-[10px] text-slate-400">
                                {k}
                              </label>
                              <input
                                type="text"
                                value={Array.isArray(v) ? v.join(", ") : String(v ?? "")}
                                onChange={(e) =>
                                  updateActionArg(
                                    action.id,
                                    k,
                                    Array.isArray(v)
                                      ? e.target.value.split(",").map((s) => s.trim())
                                      : e.target.value
                                  )
                                }
                                className="mt-1 w-full rounded-lg border border-white/[0.1] bg-[#071318]/80 px-2.5 py-1.5 text-xs text-slate-100 focus:border-[#5eead4] focus:outline-none"
                              />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Right-Side Live Log Panel */}
        <aside className="glass-card flex flex-col overflow-hidden rounded-2xl xl:col-span-4">
          <div className="flex items-center justify-between border-b border-white/[0.09] px-4 py-3.5">
            <div className="flex items-center gap-2">
              <Terminal className="h-4 w-4 text-[#5eead4]" />
              <h4 className="font-serif text-base italic text-slate-50">Live log</h4>
            </div>
            <span className="font-mono text-[10px] text-slate-400 tabular-nums">
              {liveLog.length} events
            </span>
          </div>

          {/* Active Streaming Preview when Gemini is drafting email */}
          {(isStreamingEmail || streamingEmailBody) && (
            <div className="border-b border-white/[0.09] bg-[#5eead4]/[0.06] p-4">
              <div className="flex items-center justify-between font-mono text-[10px] text-[#5eead4]">
                <span>
                  {isStreamingEmail ? "Drafting Gmail text live..." : "Latest Email Preview"}
                </span>
                {isStreamingEmail && <Loader2 className="h-3 w-3 animate-spin" />}
              </div>
              <div className="mt-2 max-h-36 overflow-y-auto whitespace-pre-line text-xs leading-relaxed text-slate-100">
                {streamingEmailBody}
                {isStreamingEmail && (
                  <span className="ml-1 inline-block h-3 w-1.5 animate-pulse bg-[#5eead4]" />
                )}
              </div>
            </div>
          )}

          <div className="max-h-[520px] flex-1 divide-y divide-white/[0.06] overflow-y-auto">
            {liveLog.length === 0 ? (
              <div className="px-4 py-10 text-center text-xs text-slate-400">
                Permit any action to watch real-time execution events stream here.
              </div>
            ) : (
              liveLog.map((entry) => (
                <div key={entry.id} className="px-4 py-2.5 text-xs">
                  <div className="flex items-center justify-between gap-2 font-mono text-[10px] tabular-nums">
                    <span className="text-slate-400">{entry.time}</span>
                    <span
                      className={
                        entry.status === "success"
                          ? "text-emerald-300"
                          : entry.status === "error"
                          ? "text-rose-300"
                          : entry.status === "running"
                          ? "text-[#5eead4]"
                          : entry.status === "skipped"
                          ? "text-amber-300"
                          : "text-slate-300"
                      }
                    >
                      {entry.tool}
                    </span>
                  </div>
                  <p className="mt-0.5 leading-snug text-slate-100">{entry.message}</p>
                </div>
              ))
            )}
          </div>
        </aside>
      </div>

      {/* Interactive Presentation Carousel Preview (Google Slides + .pptx + Canva + Attach to Gmail) */}
      {activeDeck && (
        <SlideDeckPreview
          deck={activeDeck}
          googlePresentationUrl={activeSlidesUrl}
          pptxFileName={activePptxName}
          isAttachingToGmail={isAttachingPptx}
          attachedToGmail={Boolean(draftEmailAction?.attachPptx)}
          onAttachPptxToGmail={handleAttachPptxToGmail}
          onCreateGoogleSlides={handleSaveDeckToGoogleSlides}
          isCreatingGoogleSlides={isSavingGoogleSlides}
        />
      )}
    </div>
  );
}
