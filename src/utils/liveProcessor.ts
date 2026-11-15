import type {
  ExecutionPlanStep,
  ExecutionToolBadge,
  ExtractedItem,
  LiveExtractedCategory,
  Meeting,
  Node as WorkflowNode,
  Person,
  PlannedToolAction,
  PlannedToolName,
  Promise as PromiseRecord,
  RawExtractedType,
  Segment,
  Ticket,
  TicketPriority,
  WorkflowEdge,
} from "../types/meetmind";
import { computeIdempotencyKey } from "./executionEngine";
import { computeMeetingHealth } from "./metrics";
import {
  formatShortDate,
  resolveOwner,
  resolveRelativeDate,
} from "./resolver";

export interface RawLiveAudioAnalysisPayload {
  title?: string;
  language?: string;
  durationSec?: number;
  summary?: string;
  transcript?: Array<{
    start?: string;
    end?: string;
    speaker?: string;
    text?: string;
  }>;
  items?: Array<{
    type?: string;
    title?: string;
    quote?: string;
    timestamp?: string;
    rawOwner?: string;
    rawDue?: string;
    priority?: string;
    confidence?: number;
  }>;
  executionPlan?: Array<{
    stepNumber?: number;
    title?: string;
    owner?: string;
    description?: string;
    tool?: string;
    dependsOn?: string[];
  }>;
}

export function formatMmSs(totalSeconds: number): string {
  const safe = Math.max(0, Math.round(totalSeconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function parseTimestampSeconds(ts: string, fallbackSec: number): number {
  const m = (ts || "").match(/(\d{1,2}):(\d{2})/);
  if (!m) return fallbackSec;
  return Number(m[1]) * 60 + Number(m[2]);
}

function mapLiveTypeToCore(rawType: string): {
  coreType: RawExtractedType;
  liveCategory: LiveExtractedCategory;
} {
  switch ((rawType || "").toLowerCase()) {
    case "complaint":
      return { coreType: "complaint", liveCategory: "Complaint" };
    case "decision":
      return { coreType: "decision", liveCategory: "Decision" };
    case "commit":
      return { coreType: "commit", liveCategory: "Commit" };
    case "deadline":
      return { coreType: "action", liveCategory: "Deadline" };
    case "meeting_request":
      return { coreType: "action", liveCategory: "Meeting Request" };
    case "presentation_request":
      return { coreType: "action", liveCategory: "Presentation Request" };
    case "task":
    default:
      return { coreType: "action", liveCategory: "Task" };
  }
}

function normalizePriority(raw?: string, kind?: string): TicketPriority {
  const lower = (raw || "").toLowerCase();
  if (lower === "high") return "High";
  if (lower === "low") return "Low";
  if (lower === "medium") return "Medium";
  return kind === "complaint" ? "High" : "Medium";
}

function normalizeToolBadge(raw?: string): ExecutionToolBadge {
  const lower = (raw || "").toLowerCase();
  if (lower.includes("mail")) return "Gmail";
  if (lower.includes("cal")) return "Calendar";
  if (lower.includes("slide")) return "Slides";
  if (lower.includes("slack")) return "Slack";
  if (lower.includes("n8n") || lower.includes("zap")) return "n8n";
  return "Ticket";
}

export function buildMeetingFromLiveAnalysis(
  payload: RawLiveAudioAnalysisPayload,
  options: {
    meetingId: string;
    title?: string;
    durationSeconds: number;
    roster: Person[];
    audioPath?: string;
  }
): Meeting {
  const today = new Date();
  const todayFormatted =
    formatShortDate(today).replace(/^[A-Za-z]+\s+/, "") + ` ${today.getFullYear()}`;
  const rawTurns = Array.isArray(payload.transcript) ? payload.transcript : [];

  const segments: Segment[] = rawTurns.map((turn, idx) => {
    const startTs = turn.start || formatMmSs(idx * 4);
    const speakerName = (turn.speaker || `Speaker ${idx + 1}`).trim();
    const matchedSpeaker = options.roster.find(
      (p) =>
        p.name.toLowerCase() === speakerName.toLowerCase() ||
        p.name.toLowerCase().includes(speakerName.toLowerCase())
    );
    return {
      id: `live_seg_${options.meetingId}_${idx + 1}`,
      timestamp: startTs,
      endTimestamp: turn.end,
      seconds: parseTimestampSeconds(startTs, idx * 4),
      speakerId:
        matchedSpeaker?.id || `spk_${speakerName.toLowerCase().replace(/\s+/g, "_")}`,
      speakerName: matchedSpeaker?.name || speakerName,
      text: (turn.text || "").trim(),
    };
  });

  const speakerIds = Array.from(
    new Set(
      segments
        .map((s) => s.speakerId)
        .filter((id) => options.roster.some((p) => p.id === id))
    )
  );

  const rawItems = Array.isArray(payload.items) ? payload.items : [];
  const extractedItems: ExtractedItem[] = [];

  rawItems.forEach((raw, idx) => {
    const quote = (raw.quote || "").trim();
    if (!quote || segments.length === 0) return;

    const normQuote = quote.toLowerCase().replace(/\s+/g, " ");
    const matchedSegment =
      segments.find((s) => s.text.toLowerCase().replace(/\s+/g, " ").includes(normQuote)) ||
      segments.find((s) => s.timestamp === raw.timestamp) ||
      null;

    // Never invent items without a supporting transcript turn
    if (!matchedSegment) return;

    const { coreType, liveCategory } = mapLiveTypeToCore(raw.type || "task");
    const ownerRes = resolveOwner(raw.rawOwner || "", coreType, options.roster);
    const resolvedDue = resolveRelativeDate(raw.rawDue || "", todayFormatted);
    const confidence =
      typeof raw.confidence === "number" && !Number.isNaN(raw.confidence)
        ? Math.min(1, Math.max(0, raw.confidence))
        : 0.72;
    const lowConf = confidence < 0.7;

    let finalStatus = ownerRes.status;
    let reason = ownerRes.reason;
    if (finalStatus === "confirmed" && lowConf) {
      finalStatus = "low_confidence";
      reason = `Confidence (${Math.round(confidence * 100)}%) is below 70% — please verify owner and phrasing.`;
    } else if (finalStatus !== "confirmed" && lowConf && reason) {
      reason = `${reason} (Confidence ${Math.round(confidence * 100)}%).`;
    }

    const needsConfirmation =
      finalStatus === "ambiguous" ||
      finalStatus === "unowned" ||
      finalStatus === "low_confidence" ||
      lowConf;

    extractedItems.push({
      id: `live_ext_${options.meetingId}_${idx}`,
      meetingId: options.meetingId,
      segmentId: matchedSegment.id,
      timestamp: matchedSegment.timestamp,
      kind:
        coreType === "complaint"
          ? "Complaint"
          : coreType === "decision"
          ? "Decision"
          : coreType === "commit"
          ? "Commit"
          : "Action",
      liveCategory,
      priority: normalizePriority(raw.priority, raw.type),
      title: (raw.title || quote).trim(),
      quote,
      rawOwner: (raw.rawOwner || "").trim(),
      rawDue: (raw.rawDue || "").trim(),
      ownerId: ownerRes.ownerId,
      ownerCandidates: ownerRes.ownerCandidates,
      dueDate: resolvedDue,
      confidence,
      resolutionStatus: finalStatus,
      needsConfirmation,
      ambiguityReason: reason,
    });
  });

  const executionPlan: ExecutionPlanStep[] = (
    Array.isArray(payload.executionPlan) ? payload.executionPlan : []
  ).map((step, idx) => ({
    id: `plan_${options.meetingId}_${idx + 1}`,
    stepNumber: step.stepNumber || idx + 1,
    title: step.title || `Execution Step ${idx + 1}`,
    owner: step.owner || "Team",
    description: step.description || "",
    tool: normalizeToolBadge(step.tool),
    dependsOn: Array.isArray(step.dependsOn) ? step.dependsOn : [],
    status: "planned",
  }));

  const realDurationSec = Math.max(
    1,
    Math.round(options.durationSeconds || payload.durationSec || 10)
  );

  const resolvedTitle =
    (options.title || "").trim() ||
    (payload.title || "").trim() ||
    `Live Sync · ${todayFormatted}`;

  const draftMeeting: Meeting = {
    id: options.meetingId,
    title: resolvedTitle,
    date: todayFormatted,
    duration: formatMmSs(realDurationSec),
    durationSeconds: realDurationSec,
    speakerIds,
    segments,
    extractedItems,
    summary:
      (payload.summary || "").trim() ||
      "Live audio transcribed and analyzed by Gemini multimodal pipeline.",
    language: payload.language || "English / Hinglish",
    createdAt: new Date().toISOString(),
    isLiveRecording: true,
    status: "ready",
    audioPath: options.audioPath,
    executionPlan,
  };

  const health = computeMeetingHealth(draftMeeting);
  const wfParts = buildWorkflowFromExecutionPlan(draftMeeting, executionPlan);
  draftMeeting.healthScore = health.score;
  draftMeeting.workflowSnapshot = {
    id: `wf_${options.meetingId}`,
    name: `${resolvedTitle} — Execution DAG`,
    description: "Auto-drafted from live meeting execution plan.",
    nodes: wfParts.nodes,
    edges: wfParts.edges,
  };

  return draftMeeting;
}

/**
 * Automatically creates Tickets (complaints & tasks) and Promises (commits/tasks with owner+due)
 * linked to the meeting with stable sourceItemId keys for idempotent Supabase upserts.
 */
export function buildAutoTicketsAndPromisesFromMeeting(
  meeting: Meeting,
  startingTicketNumber: number
): { tickets: Ticket[]; promises: PromiseRecord[]; nextTicketNumber: number } {
  const tickets: Ticket[] = [];
  const promises: PromiseRecord[] = [];
  let cursor = startingTicketNumber;

  for (const item of meeting.extractedItems) {
    const isComplaintOrTask =
      item.kind === "Complaint" ||
      item.kind === "Action" ||
      item.liveCategory === "Complaint" ||
      item.liveCategory === "Task";

    if (isComplaintOrTask) {
      tickets.push({
        id: `tkt_${meeting.id}_${item.id}`,
        key: `TCK-${cursor}`,
        title: item.title,
        description: `Auto-created from quote: "${item.quote}"`,
        status: item.ownerId ? "Backlog" : "Blocked",
        priority: item.priority || (item.kind === "Complaint" ? "High" : "Medium"),
        assigneeId: item.ownerId,
        dueDate: item.dueDate,
        meetingId: meeting.id,
        segmentId: item.segmentId,
        sourceKind: item.kind,
        sourceItemId: item.id,
      });
      cursor += 1;
    }

    const hasOwnerAndDue = Boolean(
      (item.ownerId || item.rawOwner) && item.dueDate && item.dueDate !== "TBD"
    );
    const isCommitOrOwnedTask =
      item.kind === "Commit" ||
      (item.kind === "Action" && hasOwnerAndDue) ||
      item.liveCategory === "Commit";

    if (isCommitOrOwnedTask) {
      promises.push({
        id: `prm_${meeting.id}_${item.id}`,
        statement: item.title,
        ownerId: item.ownerId,
        counterparty: meeting.title,
        dueDate: item.dueDate,
        status: item.ownerId ? "Open" : "At Risk",
        confidence: item.confidence,
        meetingId: meeting.id,
        segmentId: item.segmentId,
        sourceItemId: item.id,
      });
    }
  }

  return { tickets, promises, nextTicketNumber: cursor };
}

export function buildPlannedActionsFromFunctionCalls(
  meetingId: string,
  toolCalls: Array<{ id?: string; name: string; args: Record<string, unknown> }>
): PlannedToolAction[] {
  const validToolNames = new Set<PlannedToolName>([
    "create_ticket",
    "draft_email",
    "send_email",
    "create_calendar_event",
    "notify_slack",
    "call_n8n",
    "create_presentation",
  ]);

  return toolCalls.map((fc, idx) => {
    const toolName = (
      validToolNames.has(fc.name as PlannedToolName) ? fc.name : "create_ticket"
    ) as PlannedToolName;
    const args = fc.args || {};

    let title = `Execute ${toolName}`;
    let description = "Prepared by Gemini function calling — awaiting your approval.";

    if (toolName === "create_ticket") {
      title = `Create Ticket: ${String(args.title || "Follow-up Task")}`;
      description = `Owner: ${String(args.owner || "Unassigned")} · Priority: ${String(
        args.priority || "Medium"
      )} · Due: ${String(args.due || "TBD")}`;
    } else if (toolName === "draft_email") {
      title = `Create Gmail Draft: ${String(args.subject || "Meeting Recap")}`;
      description = `To: ${String(args.to || "client@example.com")} — streams & saves real Gmail draft (never auto-sends).`;
    } else if (toolName === "create_calendar_event") {
      title = `Create Calendar Event: ${String(args.title || "Follow-up Sync")}`;
      description = `Date: ${String(args.date || "TBD")} · Attendees: ${
        Array.isArray(args.attendees) ? args.attendees.join(", ") : String(args.attendees || "Team")
      }`;
    } else if (toolName === "notify_slack") {
      title = "Post Update to Slack";
      description = String(args.message || "").slice(0, 95);
    } else if (toolName === "call_n8n") {
      title = "Trigger n8n / Zapier Webhook";
      description = "Delivers meetingId, extracted items, speakers, and timestamps to configured webhook.";
    } else if (toolName === "create_presentation") {
      title = `Create Presentation: ${String(args.title || "Meeting Executive Deck")}`;
      description =
        "Generates a 6–8 slide deck via Gemini, saves to Google Slides, and builds a downloadable .pptx (Canva-ready).";
    }

    return {
      id: fc.id || `act_${meetingId}_${idx}`,
      toolName,
      title,
      description,
      args,
      status: "pending",
      idempotencyKey: computeIdempotencyKey(meetingId, `${toolName}_${idx}`, args),
    };
  });
}

export function buildWorkflowFromExecutionPlan(
  meeting: Meeting,
  plan: ExecutionPlanStep[]
): { nodes: WorkflowNode[]; edges: WorkflowEdge[] } {
  const triggerNode: WorkflowNode = {
    id: `live_node_trigger`,
    type: "trigger",
    label: `Live Audio: ${meeting.title}`,
    description: `Triggered after analyzing ${meeting.duration} recording (${meeting.language || "English/Hinglish"}).`,
    x: 40,
    y: 160,
    enabled: true,
    status: "done",
    configSummary: `${meeting.segments.length} turns · ${meeting.extractedItems.length} items`,
    config: { event: "Live audio analyzed" },
  };

  const nodes: WorkflowNode[] = [triggerNode];
  const edges: WorkflowEdge[] = [];

  const sorted = [...plan].sort((a, b) => a.stepNumber - b.stepNumber);
  sorted.forEach((step, idx) => {
    let type: WorkflowNode["type"] = "ticket";
    if (step.tool === "Gmail") type = "gmail";
    else if (step.tool === "Calendar") type = "calendar";
    else if (step.tool === "Slack" || step.tool === "n8n") type = "slack-nudge";

    const nodeId = `live_node_${step.stepNumber}`;
    const col = Math.floor(idx / 2) + 1;
    const row = idx % 2;

    nodes.push({
      id: nodeId,
      type,
      label: step.title,
      description: step.description,
      x: 40 + col * 310,
      y: 70 + row * 190,
      enabled: true,
      status:
        step.status === "done"
          ? "done"
          : step.status === "failed"
          ? "failed"
          : step.status === "waiting"
          ? "waiting"
          : "idle",
      configSummary: `${step.tool} · ${step.owner}`,
      config: {
        ticketTitle: step.title,
        owner: step.owner,
        message: step.description,
      },
    });

    const prevId = idx === 0 ? triggerNode.id : `live_node_${sorted[idx - 1].stepNumber}`;
    edges.push({
      id: `live_edge_${idx}`,
      from: prevId,
      to: nodeId,
      label: step.dependsOn.length > 0 ? step.dependsOn.join(", ") : undefined,
    });
  });

  return { nodes, edges };
}
