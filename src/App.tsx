import {
  AlertCircle,
  ArrowRight,
  Calendar,
  CheckSquare,
  Clock,
  Database,
  FileAudio,
  FileText,
  GitBranch,
  Globe,
  Handshake,
  History,
  Loader2,
  Mail,
  Menu,
  MessageSquare,
  MessageSquareText,
  Mic,
  Plus,
  Presentation,
  RotateCcw,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  Webhook,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ExtractedPanel } from "./components/ExtractedPanel";
import { HistoryView } from "./components/HistoryView";
import { LiveRecordView } from "./components/LiveRecordView";
import { MeetingHealthRing } from "./components/MeetingHealthRing";
import { MeetingsListPanel } from "./components/MeetingsListPanel";
import { NewMeetingModal } from "./components/NewMeetingModal";
import { PreMeetingBriefCard } from "./components/PreMeetingBriefCard";
import { PresenterControlsBar } from "./components/PresenterControlsBar";
import { PromiseLedger } from "./components/PromiseLedger";
import {
  type OrbState,
  RecorderOrb,
  loadRememberedOrbConsent,
  saveRememberedOrbConsent,
} from "./components/RecorderOrb";
import { RunTimeline } from "./components/RunTimeline";
import { SettingsView } from "./components/SettingsView";
import { SystemCheckView } from "./components/SystemCheckView";
import { TicketsBoard } from "./components/TicketsBoard";
import { ToolExecutionPanel } from "./components/ToolExecutionPanel";
import { Transcript } from "./components/Transcript";
import { Waveform } from "./components/Waveform";
import { WorkflowCanvas } from "./components/WorkflowCanvas";
import {
  MOCK_ACME_EXTRACTION,
  buildMockLiveAudioAnalysis,
  buildMockPlannedToolActions,
  buildMockPreMeetingBrief,
} from "./data/mockGeminiResponses";
import { INITIAL_MEETMIND_STATE } from "./data/seedData";
import {
  type DbStatusInfo,
  acquireRunStepIdempotency,
  createRunRow,
  fetchAllWorkspaceFromDb,
  fetchMeetingDetailsFromDb,
  generateUuid,
  getDbStatusInfo,
  getSignedAudioUrl,
  insertAnalyzingMeeting,
  resetCachedSupabaseClient,
  resetFailedOrQueuedStepsInDb,
  subscribeToRealtimeChanges,
  updateMeetingRecord,
  updatePromiseRow,
  updateRunRowStatus,
  updateRunStepRow,
  updateTicketRow,
  uploadMeetingAudio,
  upsertTicketsAndPromises,
} from "./lib/db";
import type {
  AppSettings,
  ExecutionPlanStep,
  ExecutionToolBadge,
  IdempotencyRecord,
  MeetMindState,
  Meeting,
  Node as WorkflowNode,
  NodeExecutionStatus,
  PlannedToolAction,
  PlannedToolName,
  Promise as PromiseRecord,
  PromiseStatus,
  Run,
  RunStep,
  Segment,
  SidebarView,
  Ticket,
  TicketPriority,
  TicketStatus,
} from "./types/meetmind";
import { blobToBase64, getAudioBlob, saveAudioBlob } from "./utils/audioStore";
import {
  buildGmailComposeUrl,
  buildGoogleCalendarUrl,
  computeIdempotencyKey,
  orderNodesTopologically,
} from "./utils/executionEngine";
import {
  type GoogleAuthSession,
  connectGoogleAccount,
  disconnectGoogleAccount,
  getStoredGoogleSession,
} from "./utils/googleAuth";
import {
  type RawLiveAudioAnalysisPayload,
  buildAutoTicketsAndPromisesFromMeeting,
  buildMeetingFromLiveAnalysis,
  buildMockCustomConnectorActions,
  buildPlannedActionsFromFunctionCalls,
  buildWorkflowFromExecutionPlan,
  formatMmSs,
} from "./utils/liveProcessor";
import {
  buildOverdueBriefPayload,
  computeMeetingHealth,
  syncPromisesFromMeetings,
} from "./utils/metrics";
import {
  resolveExtractedItems,
  validateRawExtractionResponse,
} from "./utils/resolver";
import {
  loadAppSettings,
  saveAppSettings,
} from "./utils/settingsStorage";
import {
  loadMeetMindState,
  resetMeetMindState,
  saveMeetMindState,
} from "./utils/storage";
import {
  publishWorkspaceEvent,
  subscribeWorkspaceEvents,
} from "./utils/syncBus";

function getPlanToolBadgeMeta(tool: ExecutionToolBadge) {
  switch (tool) {
    case "Ticket":
      return { icon: CheckSquare, cls: "border-rose-400/35 bg-rose-500/12 text-rose-200" };
    case "Gmail":
      return { icon: Mail, cls: "border-sky-400/35 bg-sky-500/12 text-sky-200" };
    case "Calendar":
      return { icon: Calendar, cls: "border-emerald-400/35 bg-emerald-500/12 text-emerald-200" };
    case "Slides":
      return { icon: Presentation, cls: "border-indigo-400/35 bg-indigo-500/12 text-indigo-200" };
    case "Slack":
      return { icon: MessageSquare, cls: "border-[#5eead4]/40 bg-[#5eead4]/12 text-[#99f6e4]" };
    case "n8n":
      return { icon: Webhook, cls: "border-amber-400/35 bg-amber-500/12 text-amber-200" };
  }
}

function mapToolNameToNodeAndBadge(toolName: PlannedToolName): {
  nodeTypes: WorkflowNode["type"][];
  planTool: ExecutionToolBadge;
} {
  switch (toolName) {
    case "create_ticket":
      return { nodeTypes: ["ticket"], planTool: "Ticket" };
    case "draft_email":
    case "send_email":
      return { nodeTypes: ["gmail"], planTool: "Gmail" };
    case "create_calendar_event":
      return { nodeTypes: ["calendar"], planTool: "Calendar" };
    case "create_presentation":
      return { nodeTypes: ["gmail"], planTool: "Slides" };
    case "notify_slack":
      return { nodeTypes: ["slack-nudge"], planTool: "Slack" };
    case "call_n8n":
    case "custom_connector":
      return { nodeTypes: ["slack-nudge"], planTool: "n8n" };
  }
}

export default function App() {
  const [state, setState] = useState<MeetMindState>(() => loadMeetMindState());
  const stateRef = useRef<MeetMindState>(state);
  stateRef.current = state;

  const [activeView, setActiveView] = useState<SidebarView>("meetings");
  const [globalSearch, setGlobalSearch] = useState("");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [ingestModal, setIngestModal] = useState<{
    open: boolean;
    mode: "paste" | "audio";
  }>({ open: false, mode: "paste" });

  // Required consent banner state
  const [consentAccepted, setConsentAccepted] = useState<boolean>(() =>
    loadRememberedOrbConsent()
  );

  // Playback & quote highlight state
  const [currentSeconds, setCurrentSeconds] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [highlightedSegmentId, setHighlightedSegmentId] = useState<string | null>(null);
  const [highlightedQuote, setHighlightedQuote] = useState<string | null>(null);
  const [highlightNonce, setHighlightNonce] = useState(0);

  // Async Gemini extraction & run execution states
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [isRunningMeeting, setIsRunningMeeting] = useState(false);
  const [chaosArmed, setChaosArmed] = useState(false);
  const chaosArmedRef = useRef(false);
  chaosArmedRef.current = chaosArmed;

  const [slackToast, setSlackToast] = useState<{
    title: string;
    message: string;
    actionLabel?: string;
    onAction?: () => void;
  } | null>(null);

  const [runFeedback, setRunFeedback] = useState<{
    runId: string;
    message: string;
  } | null>(null);

  // Prompt 5: Pre-meeting brief state
  const [mockMode, setMockMode] = useState(false);
  const mockModeRef = useRef(false);
  mockModeRef.current = mockMode;

  const [briefLines, setBriefLines] = useState<string[]>(() =>
    buildMockPreMeetingBrief(
      state.promises,
      state.people,
      state.meetings
    ).lines
  );
  const [briefGeneratedAt, setBriefGeneratedAt] = useState<string | null>(
    "Cached Preview"
  );
  const [isLoadingBrief, setIsLoadingBrief] = useState(false);
  const [briefError, setBriefError] = useState<string | null>(null);

  // Prompt 6: 7-Step Guided Demo & Presenter Controls
  const [demoActive, setDemoActive] = useState(false);
  const [demoStep, setDemoStep] = useState(1);
  const [demoStepLabel, setDemoStepLabel] = useState("Ready");
  const [awaitingChaosClick, setAwaitingChaosClick] = useState(false);
  const [revealedSegmentCount, setRevealedSegmentCount] = useState<number | null>(null);
  const [activeTypingProgress, setActiveTypingProgress] = useState(1);
  const [visibleExtractCount, setVisibleExtractCount] = useState<number | null>(null);
  const [showConfirmationTray, setShowConfirmationTray] = useState(true);
  const [demoStaggerNonce, setDemoStaggerNonce] = useState(0);
  const [demoDryRunActive, setDemoDryRunActive] = useState(false);

  const demoRunTokenRef = useRef(0);
  const skipWaitResolverRef = useRef<(() => void) | null>(null);
  const chaosDecisionResolverRef = useRef<(() => void) | null>(null);
  const resumeDoneResolverRef = useRef<(() => void) | null>(null);

  // Live Mode, Settings, Supabase & Google OAuth state
  const [settings, setSettings] = useState<AppSettings>(() => loadAppSettings());
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const [dbStatus, setDbStatus] = useState<DbStatusInfo>(() => getDbStatusInfo());
  const [googleSession, setGoogleSession] = useState<GoogleAuthSession | null>(() =>
    getStoredGoogleSession()
  );
  const [activeLiveMeetingId, setActiveLiveMeetingId] = useState<string | null>(
    () => state.meetings.find((m) => m.isLiveRecording)?.id || null
  );
  const [isPlanningMeetingTools, setIsPlanningMeetingTools] = useState(false);
  const [newlyArrivedMeetingId, setNewlyArrivedMeetingId] = useState<string | null>(null);
  const newlyArrivedTimerRef = useRef<number | null>(null);
  const [selectedMeetingAudioUrl, setSelectedMeetingAudioUrl] = useState<string | null>(null);

  const markMeetingNewlyArrived = (meetingId: string) => {
    setNewlyArrivedMeetingId(meetingId);
    if (newlyArrivedTimerRef.current !== null) {
      window.clearTimeout(newlyArrivedTimerRef.current);
    }
    newlyArrivedTimerRef.current = window.setTimeout(() => {
      setNewlyArrivedMeetingId((cur) => (cur === meetingId ? null : cur));
    }, 6500);
  };

  // Global Floating Recorder Orb state & refs
  const [orbState, setOrbState] = useState<OrbState>("idle");
  const orbStateRef = useRef<OrbState>("idle");
  orbStateRef.current = orbState;
  const [orbElapsedSec, setOrbElapsedSec] = useState(0);
  const [orbWaveLevels, setOrbWaveLevels] = useState<number[]>(() =>
    Array.from({ length: 12 }, () => 0.16)
  );
  const [orbErrorText, setOrbErrorText] = useState<string | null>(null);

  const orbRecorderRef = useRef<MediaRecorder | null>(null);
  const orbStreamRef = useRef<MediaStream | null>(null);
  const orbAudioCtxRef = useRef<AudioContext | null>(null);
  const orbRafRef = useRef<number | null>(null);
  const orbTimerRef = useRef<number | null>(null);
  const orbAutoStopRef = useRef<number | null>(null);
  const orbStartMsRef = useRef<number>(0);
  const orbChunksRef = useRef<BlobPart[]>([]);

  const showToast = (
    title: string,
    message: string,
    action?: { label: string; onClick: () => void }
  ) => {
    setSlackToast({
      title,
      message,
      actionLabel: action?.label,
      onAction: action?.onClick,
    });
    window.setTimeout(() => {
      setSlackToast((prev) => (prev?.message === message ? null : prev));
    }, 6500);
  };

  useEffect(() => {
    saveMeetMindState(state);
  }, [state]);

  const mergeWorkspaceFromSupabase = async (silent = false) => {
    const res = await fetchAllWorkspaceFromDb(stateRef.current.people);
    setDbStatus(getDbStatusInfo());
    if (!res.ok) {
      if (!silent && res.error) {
        showToast("Supabase Sync Error", res.error);
      }
      return;
    }

    setState((prev) => {
      const dbMeetingIds = new Set(res.meetings.map((m) => m.id));
      const localOnlyMeetings = prev.meetings.filter((m) => !dbMeetingIds.has(m.id));
      const mergedMeetings = [...res.meetings, ...localOnlyMeetings].sort((a, b) => {
        const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return tb - ta;
      });

      const dbTicketIds = new Set(res.tickets.map((t) => t.id));
      const mergedTickets = [
        ...res.tickets,
        ...prev.tickets.filter((t) => !dbTicketIds.has(t.id)),
      ];

      const dbPromiseIds = new Set(res.promises.map((p) => p.id));
      const mergedPromises = syncPromisesFromMeetings(
        [...res.promises, ...prev.promises.filter((p) => !dbPromiseIds.has(p.id))],
        mergedMeetings
      );

      const dbRunIds = new Set(res.runs.map((r) => r.id));
      const mergedRuns = [
        ...res.runs,
        ...prev.runs.filter((r) => !dbRunIds.has(r.id)),
      ];

      return {
        ...prev,
        meetings: mergedMeetings.length > 0 ? mergedMeetings : prev.meetings,
        tickets: mergedTickets,
        promises: mergedPromises,
        runs: mergedRuns,
        duplicatesBlockedTotal: Math.max(prev.duplicatesBlockedTotal, res.blockedCount),
      };
    });

    if (!silent) {
      showToast(
        "Supabase Synced",
        `Loaded ${res.meetings.length} meeting(s) & ${res.tickets.length} ticket(s).`
      );
    }
  };

  // Load Supabase workspace + subscribe to Realtime changes cleanly
  useEffect(() => {
    setDbStatus(getDbStatusInfo());
    void mergeWorkspaceFromSupabase(true);

    const unsubscribe = subscribeToRealtimeChanges(stateRef.current.people, {
      onMeetingChange: (incoming) => {
        setState((prev) => {
          const exists = prev.meetings.some((m) => m.id === incoming.id);
          const nextMeetings = exists
            ? prev.meetings.map((m) => (m.id === incoming.id ? incoming : m))
            : [incoming, ...prev.meetings];
          return {
            ...prev,
            meetings: nextMeetings,
          };
        });
      },
      onTicketChange: (incoming) => {
        setState((prev) => {
          const exists = prev.tickets.some((t) => t.id === incoming.id);
          return {
            ...prev,
            tickets: exists
              ? prev.tickets.map((t) => (t.id === incoming.id ? incoming : t))
              : [incoming, ...prev.tickets],
          };
        });
      },
      onPromiseChange: (incoming) => {
        setState((prev) => {
          const exists = prev.promises.some((p) => p.id === incoming.id);
          return {
            ...prev,
            promises: exists
              ? prev.promises.map((p) => (p.id === incoming.id ? incoming : p))
              : [incoming, ...prev.promises],
          };
        });
      },
      onRunStepChange: (stepUpdate) => {
        setState((prev) => ({
          ...prev,
          workflow: {
            ...prev.workflow,
            nodes: prev.workflow.nodes.map((n) =>
              n.id === stepUpdate.nodeId ? { ...n, status: stepUpdate.status } : n
            ),
          },
        }));
      },
    });

    return () => {
      unsubscribe();
    };
  }, [settings.supabaseUrl, settings.supabaseAnonKey]);

  // Cross-view & cross-tab event bus + localStorage sync
  useEffect(() => {
    const unsubBus = subscribeWorkspaceEvents((ev) => {
      if (ev.type === "meeting_upserted" && ev.isNew) {
        markMeetingNewlyArrived(ev.meetingId);
      }
    });

    const onStorageSync = (ev: StorageEvent) => {
      if (ev.key && ev.key.includes("meetmind")) {
        setState(loadMeetMindState());
      }
    };
    window.addEventListener("storage", onStorageSync);

    return () => {
      unsubBus();
      window.removeEventListener("storage", onStorageSync);
    };
  }, []);

  const selectedMeeting =
    state.meetings.find((m) => m.id === state.selectedMeetingId) || state.meetings[0];

  const activeLiveMeeting =
    state.meetings.find((m) => m.id === activeLiveMeetingId) || null;

  const pendingConfirmCount = state.meetings.reduce(
    (acc, m) =>
      acc + m.extractedItems.filter((i) => i.needsConfirmation && !i.resolved).length,
    0
  );
  const unownedPromisesCount = state.promises.filter((p) => p.ownerId === null).length;

  // Load audio playback URL (IndexedDB blob or Supabase signed URL) for selectedMeeting
  const currentSelectedMeetingId =
    state.meetings.find((m) => m.id === state.selectedMeetingId)?.id || state.meetings[0]?.id;
  const currentSelectedAudioPath = state.meetings.find(
    (m) => m.id === currentSelectedMeetingId
  )?.audioPath;

  useEffect(() => {
    let revokedUrl: string | null = null;
    let cancelled = false;

    const loadAudio = async () => {
      if (!currentSelectedMeetingId) {
        setSelectedMeetingAudioUrl(null);
        return;
      }
      const localBlob = await getAudioBlob(currentSelectedMeetingId);
      if (cancelled) return;
      if (localBlob) {
        revokedUrl = URL.createObjectURL(localBlob);
        setSelectedMeetingAudioUrl(revokedUrl);
        return;
      }
      if (currentSelectedAudioPath) {
        const signed = await getSignedAudioUrl(currentSelectedAudioPath);
        if (!cancelled) {
          setSelectedMeetingAudioUrl(signed);
        }
        return;
      }
      setSelectedMeetingAudioUrl(null);
    };

    void loadAudio();
    return () => {
      cancelled = true;
      if (revokedUrl) URL.revokeObjectURL(revokedUrl);
    };
  }, [currentSelectedMeetingId, currentSelectedAudioPath]);

  const selectMeeting = (meetingId: string) => {
    const target = state.meetings.find((m) => m.id === meetingId);
    setIsPlaying(false);
    setCurrentSeconds(0);
    setHighlightedSegmentId(null);
    setHighlightedQuote(null);
    setExtractError(null);
    setState((prev) => ({
      ...prev,
      selectedMeetingId: meetingId,
      workflow: target?.workflowSnapshot || prev.workflow,
    }));
    if (target?.isLiveRecording) {
      setActiveLiveMeetingId(meetingId);
    }
    setActiveView("meetings");
    setMobileMenuOpen(false);

    // Fetch latest meeting tickets, promises, runs & signed audio URL from Supabase
    void fetchMeetingDetailsFromDb(
      meetingId,
      stateRef.current.people,
      target?.audioPath
    ).then((details) => {
      if (details.tickets.length === 0 && details.promises.length === 0 && details.runs.length === 0) {
        return;
      }
      setState((prev) => {
        const tIds = new Set(details.tickets.map((t) => t.id));
        const pIds = new Set(details.promises.map((p) => p.id));
        const rIds = new Set(details.runs.map((r) => r.id));
        return {
          ...prev,
          tickets: [
            ...details.tickets,
            ...prev.tickets.filter((t) => !tIds.has(t.id)),
          ],
          promises: [
            ...details.promises,
            ...prev.promises.filter((p) => !pIds.has(p.id)),
          ],
          runs: [
            ...details.runs,
            ...prev.runs.filter((r) => !rIds.has(r.id)),
          ],
        };
      });
    });
  };

  const handleJumpToQuote = (segmentId: string, quote: string | null = null) => {
    const seg = selectedMeeting?.segments.find((s) => s.id === segmentId);
    if (seg) {
      setCurrentSeconds(seg.seconds);
    }
    setHighlightedSegmentId(segmentId);
    setHighlightedQuote(quote);
    setHighlightNonce((n) => n + 1);
  };

  const handleJumpFromBoardOrLedger = (meetingId: string, segmentId: string) => {
    const targetMeeting = state.meetings.find((m) => m.id === meetingId);
    const matchingItem = targetMeeting?.extractedItems.find(
      (i) => i.segmentId === segmentId
    );
    const seg = targetMeeting?.segments.find((s) => s.id === segmentId);

    setState((prev) => ({ ...prev, selectedMeetingId: meetingId }));
    setActiveView("meetings");
    setIsPlaying(false);
    setCurrentSeconds(seg?.seconds || 0);

    window.setTimeout(() => {
      setHighlightedSegmentId(segmentId);
      setHighlightedQuote(matchingItem?.quote || null);
      setHighlightNonce((n) => n + 1);
    }, 60);
  };

  const handleResolveAmbiguity = (itemId: string, personId: string) => {
    const resolvedPerson = state.people.find((p) => p.id === personId);
    if (!resolvedPerson || !selectedMeeting) return;

    const targetItem = selectedMeeting.extractedItems.find((i) => i.id === itemId);

    setState((prev) => {
      const updatedMeetings = prev.meetings.map((m) => {
        if (m.id !== selectedMeeting.id) return m;
        return {
          ...m,
          extractedItems: m.extractedItems.map((item) =>
            item.id === itemId
              ? {
                  ...item,
                  ownerId: personId,
                  resolutionStatus: "confirmed" as const,
                  needsConfirmation: false,
                  resolved: true,
                  confidence: Math.max(item.confidence, 0.92),
                  ambiguityReason: undefined,
                }
              : item
          ),
        };
      });

      const updatedPromises = prev.promises.map((p) => {
        if (
          p.meetingId === selectedMeeting.id &&
          p.segmentId === targetItem?.segmentId &&
          !p.ownerId
        ) {
          return {
            ...p,
            ownerId: personId,
            confidence: Math.max(p.confidence, 0.92),
            status: p.status === "At Risk" ? ("Open" as PromiseStatus) : p.status,
          };
        }
        return p;
      });

      const updatedTickets = prev.tickets.map((t) => {
        if (
          t.meetingId === selectedMeeting.id &&
          t.segmentId === targetItem?.segmentId &&
          !t.assigneeId
        ) {
          return {
            ...t,
            assigneeId: personId,
            status: t.status === "Blocked" ? ("In Progress" as TicketStatus) : t.status,
          };
        }
        return t;
      });

      const nextMtg = updatedMeetings.find((m) => m.id === selectedMeeting.id);
      if (nextMtg) {
        void updateMeetingRecord(nextMtg);
      }

      return {
        ...prev,
        meetings: updatedMeetings,
        promises: syncPromisesFromMeetings(updatedPromises, updatedMeetings),
        tickets: updatedTickets,
      };
    });
    publishWorkspaceEvent({ type: "meeting_upserted", meetingId: selectedMeeting.id });
  };

  const handleDismissAmbiguity = (itemId: string) => {
    if (!selectedMeeting) return;
    setState((prev) => ({
      ...prev,
      meetings: prev.meetings.map((m) =>
        m.id !== selectedMeeting.id
          ? m
          : {
              ...m,
              extractedItems: m.extractedItems.filter((i) => i.id !== itemId),
            }
      ),
    }));
  };

  const handleGenerateBrief = async () => {
    const latest = stateRef.current;
    const targetMeeting =
      latest.meetings.find((m) => m.id === latest.selectedMeetingId) ||
      latest.meetings[0];

    setIsLoadingBrief(true);
    setBriefError(null);

    try {
      if (mockModeRef.current) {
        await new Promise((r) => window.setTimeout(r, 220));
        const cached = buildMockPreMeetingBrief(
          latest.promises,
          latest.people,
          latest.meetings
        );
        setBriefLines(cached.lines);
        setBriefGeneratedAt("Mock Mode");
        return;
      }

      const payloadPromises = buildOverdueBriefPayload(
        latest.promises,
        latest.people,
        latest.meetings
      );

      const response = await fetch("/api/gemini/brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nextMeetingTitle: targetMeeting?.title || "Acme weekly sync",
          currentDate: "14 Nov 2026",
          promises: payloadPromises,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Could not generate pre-meeting brief.");
      }

      setBriefLines(data.lines || []);
      setBriefGeneratedAt(data.generatedAt || "Gemini Live");
    } catch (err) {
      const fallback = buildMockPreMeetingBrief(
        latest.promises,
        latest.people,
        latest.meetings
      );
      setBriefLines(fallback.lines);
      setBriefGeneratedAt("Fallback Cache");
      setBriefError(
        err instanceof Error
          ? `${err.message} Showing cached brief.`
          : "Showing cached brief."
      );
    } finally {
      setIsLoadingBrief(false);
    }
  };

  const handleAnalyzeWithGemini = async () => {
    if (!selectedMeeting) return;
    if (!consentAccepted) {
      setExtractError('Please check "Audio is processed once and not stored." before analyzing.');
      return;
    }

    setIsExtracting(true);
    setExtractError(null);

    try {
      let data: unknown;
      if (mockModeRef.current) {
        await new Promise((r) => window.setTimeout(r, 280));
        data = MOCK_ACME_EXTRACTION;
      } else {
        const response = await fetch("/api/gemini/extract", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: selectedMeeting.title,
            segments: selectedMeeting.segments,
            roster: state.people,
          }),
        });
        data = await response.json();
        if (!response.ok) {
          throw new Error(
            (data as { error?: string }).error || "Failed to extract via Gemini."
          );
        }
      }

      const validation = validateRawExtractionResponse(data);
      if (!validation.valid) {
        throw new Error(validation.error || "Gemini returned an invalid JSON payload.");
      }

      const resolvedItems = resolveExtractedItems(
        validation.items,
        selectedMeeting.segments,
        state.people,
        selectedMeeting.date,
        selectedMeeting.id
      );

      setState((prev) => {
        const updatedMeetings = prev.meetings.map((m) =>
          m.id === selectedMeeting.id
            ? {
                ...m,
                summary: validation.summary || m.summary,
                extractedItems: resolvedItems,
              }
            : m
        );
        return {
          ...prev,
          meetings: updatedMeetings,
          promises: syncPromisesFromMeetings(prev.promises, updatedMeetings),
        };
      });
    } catch (err) {
      setExtractError(
        err instanceof Error ? err.message : "Could not reach Gemini extraction endpoint."
      );
    } finally {
      setIsExtracting(false);
    }
  };

  const nowTimeShort = () => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, "0")}:${String(
      d.getMinutes()
    ).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
  };

  const executeRunFromStep = async (
    runId: string,
    startIndex: number,
    options?: {
      forceReplayFromIndex?: number;
      autoApproveAs?: string;
      pauseBeforeGmailForDemo?: () => Promise<void>;
    }
  ) => {
    setIsRunningMeeting(true);

    const updateStepAndNode = (
      stepId: string,
      nodeId: string,
      stepPatch: Partial<RunStep>,
      nodeStatus: NodeExecutionStatus,
      runStatus?: Run["status"]
    ) => {
      const doneAt = nodeStatus === "done" ? nowTimeShort().slice(0, 5) : undefined;
      const errMsg = nodeStatus === "failed" ? stepPatch.error : undefined;

      setState((prev) => ({
        ...prev,
        workflow: {
          ...prev.workflow,
          nodes: prev.workflow.nodes.map((n) =>
            n.id === nodeId
              ? {
                  ...n,
                  status: nodeStatus,
                  completedAt: doneAt ?? (nodeStatus === "running" || nodeStatus === "queued" ? undefined : n.completedAt),
                  errorMessage: errMsg,
                }
              : n
          ),
        },
        meetings: prev.meetings.map((m) =>
          m.id !== prev.selectedMeetingId || !m.workflowSnapshot
            ? m
            : {
                ...m,
                workflowSnapshot: {
                  ...m.workflowSnapshot,
                  nodes: m.workflowSnapshot.nodes.map((n) =>
                    n.id === nodeId
                      ? {
                          ...n,
                          status: nodeStatus,
                          completedAt: doneAt ?? (nodeStatus === "running" || nodeStatus === "queued" ? undefined : n.completedAt),
                          errorMessage: errMsg,
                        }
                      : n
                  ),
                },
              }
        ),
        runs: prev.runs.map((r) => {
          if (r.id !== runId) return r;
          return {
            ...r,
            status: runStatus ?? r.status,
            steps: r.steps.map((s) => (s.id === stepId ? { ...s, ...stepPatch } : s)),
          };
        }),
      }));
    };

    const currentRun = stateRef.current.runs.find((r) => r.id === runId);
    if (!currentRun) {
      setIsRunningMeeting(false);
      return;
    }

    const totalSteps = currentRun.steps.length;

    for (let idx = startIndex; idx < totalSteps; idx++) {
      const latestState = stateRef.current;
      const latestRun = latestState.runs.find((r) => r.id === runId);
      const step = latestRun?.steps[idx];
      const node = latestState.workflow.nodes.find((n) => n.id === step?.nodeId);
      const meeting =
        latestState.meetings.find((m) => m.id === latestRun?.meetingId) || selectedMeeting;

      if (!latestRun || !step || !node || !meeting) break;

      const forceReplay =
        options?.forceReplayFromIndex !== undefined && idx >= options.forceReplayFromIndex;

      // Idempotency check before executing step (localStorage + Supabase run_steps unique key)
      let dbBlockedCount: number | undefined;
      let isDuplicate = Boolean(!forceReplay && latestState.idempotencyLedger[step.idempotencyKey]);
      if (!isDuplicate && !forceReplay) {
        const dbCheck = await acquireRunStepIdempotency({
          stepId: step.id,
          runId,
          meetingId: meeting.id,
          nodeId: node.id,
          tool: node.type,
          idempotencyKey: step.idempotencyKey,
        });
        if (dbCheck.duplicateBlocked) {
          isDuplicate = true;
          dbBlockedCount = dbCheck.blockedCount;
        }
      }

      if (isDuplicate) {
        await new Promise((r) => window.setTimeout(r, 220));
        setState((prev) => ({
          ...prev,
          duplicatesBlockedTotal:
            dbBlockedCount !== undefined
              ? Math.max(prev.duplicatesBlockedTotal + 1, dbBlockedCount)
              : prev.duplicatesBlockedTotal + 1,
          workflow: {
            ...prev.workflow,
            nodes: prev.workflow.nodes.map((n) =>
              n.id === node.id ? { ...n, status: "done" } : n
            ),
          },
          runs: prev.runs.map((r) => {
            if (r.id !== runId) return r;
            return {
              ...r,
              duplicatesBlockedInRun: r.duplicatesBlockedInRun + 1,
              steps: r.steps.map((s) =>
                s.id === step.id
                  ? {
                      ...s,
                      status: "skipped",
                      skippedDuplicate: true,
                      startedAt: nowTimeShort(),
                      durationMs: 45,
                      error: undefined,
                      outputSummary:
                        "Skipped — idempotency key already succeeded (duplicate blocked).",
                    }
                  : s
              ),
            };
          }),
        }));
        continue;
      }

      // Mark step running
      updateStepAndNode(
        step.id,
        node.id,
        { status: "running", error: undefined, startedAt: nowTimeShort() },
        "running",
        "running"
      );
      void updateRunStepRow({
        idempotencyKey: step.idempotencyKey,
        status: "running",
      });

      // Realistic sequential execution delay (600-1200ms)
      const delayMs = 640 + Math.floor(Math.random() * 510);
      await new Promise((r) => window.setTimeout(r, delayMs));

      // Execute built-in node behavior
      if (node.type === "trigger" || node.type === "loop") {
        const outputSummary =
          node.type === "trigger"
            ? `Triggered on "${meeting.title}" (${meeting.segments.length} transcript turns).`
            : `Iterated ${meeting.extractedItems.length} extracted items across Complaints, Commits & Actions.`;

        setState((prev) => ({
          ...prev,
          idempotencyLedger: {
            ...prev.idempotencyLedger,
            [step.idempotencyKey]: {
              key: step.idempotencyKey,
              nodeId: node.id,
              meetingId: meeting.id,
              completedAt: nowTimeShort(),
              outputSummary,
            },
          },
        }));
        updateStepAndNode(
          step.id,
          node.id,
          { status: "completed", durationMs: delayMs, outputSummary },
          "done"
        );
        void updateRunStepRow({
          idempotencyKey: step.idempotencyKey,
          status: "done",
          output: outputSummary,
        });
        continue;
      }

      if (node.type === "ticket") {
        const currentTickets = stateRef.current.tickets;
        const ticketNum = stateRef.current.nextTicketNumber;
        const ticketKey = `TCK-${ticketNum}`;
        const ownerName = (node.config.owner || "").toLowerCase();
        const assignee = stateRef.current.people.find(
          (p) =>
            ownerName.includes(p.name.toLowerCase()) ||
            p.name.toLowerCase().includes(ownerName)
        );

        const newTicket: Ticket = {
          id: generateUuid(),
          key: ticketKey,
          title: node.config.ticketTitle || node.label,
          description: `Auto-created by Run #${latestRun.runNumber} from "${meeting.title}".`,
          status: assignee ? "In Progress" : "Blocked",
          priority: node.config.priority || "High",
          assigneeId: assignee?.id || null,
          dueDate: node.config.dueDate || "Fri 20 Nov",
          meetingId: meeting.id,
          segmentId: meeting.segments[0]?.id || "",
          sourceKind: "Complaint",
          sourceItemId: `wf_${node.id}_${ticketKey}`,
        };

        void upsertTicketsAndPromises(meeting, [newTicket], [], stateRef.current.people);

        const outputSummary = `Created ticket ${ticketKey} (${newTicket.title}) · Owner: ${
          assignee?.name || node.config.owner || "Unassigned"
        } · Priority: ${newTicket.priority} · Due: ${newTicket.dueDate}.`;

        setState((prev) => ({
          ...prev,
          nextTicketNumber: prev.nextTicketNumber + 1,
          tickets: currentTickets.some((t) => t.key === ticketKey)
            ? prev.tickets
            : [newTicket, ...prev.tickets],
          idempotencyLedger: {
            ...prev.idempotencyLedger,
            [step.idempotencyKey]: {
              key: step.idempotencyKey,
              nodeId: node.id,
              meetingId: meeting.id,
              completedAt: nowTimeShort(),
              outputSummary,
            },
          },
        }));

        updateStepAndNode(
          step.id,
          node.id,
          { status: "completed", durationMs: delayMs, outputSummary },
          "done"
        );
        void updateRunStepRow({
          idempotencyKey: step.idempotencyKey,
          status: "done",
          output: outputSummary,
        });
        continue;
      }

      if (node.type === "approval") {
        const approverName =
          options?.autoApproveAs || node.config.approver || "Anita (Manager)";

        if (options?.autoApproveAs) {
          const outputSummary = `Auto-approved by ${approverName}.`;
          setState((prev) => ({
            ...prev,
            idempotencyLedger: {
              ...prev.idempotencyLedger,
              [step.idempotencyKey]: {
                key: step.idempotencyKey,
                nodeId: node.id,
                meetingId: meeting.id,
                completedAt: nowTimeShort(),
                outputSummary,
              },
            },
          }));
          updateStepAndNode(
            step.id,
            node.id,
            {
              status: "completed",
              durationMs: delayMs,
              approverName,
              waitingKind: undefined,
              outputSummary,
            },
            "done"
          );
          void updateRunStepRow({
            idempotencyKey: step.idempotencyKey,
            status: "done",
            output: outputSummary,
          });
          continue;
        }

          updateStepAndNode(
            step.id,
            node.id,
            {
              status: "waiting",
              durationMs: delayMs,
              waitingKind: "approval",
              approverName,
              outputSummary: `Paused — awaiting human approval from ${approverName}.`,
            },
            "waiting",
            "needs_review"
          );
          void updateRunStepRow({
            idempotencyKey: step.idempotencyKey,
            status: "waiting",
            output: `Awaiting approval from ${approverName}`,
          });
          void updateRunRowStatus(runId, "needs_review");
          setIsRunningMeeting(false);
          setRunFeedback({
            runId,
            message: `Run #${latestRun.runNumber} paused at Approval (${approverName}). Click Approve in Run Timeline to continue.`,
          });
          return;
        }

      if (node.type === "gmail") {
        if (options?.pauseBeforeGmailForDemo) {
          await options.pauseBeforeGmailForDemo();
        }

        // Chaos mode check: fail next network Email step!
        if (chaosArmedRef.current) {
          setChaosArmed(false);
          chaosArmedRef.current = false;
          const completedStepCount = latestState.runs
            .find((r) => r.id === runId)
            ?.steps.slice(0, idx)
            .filter((s) => s.status === "completed" || s.status === "skipped").length || idx;

          const errMsg = `Gmail connection expired. Reconnect, then click Resume. Steps 1–${Math.max(
            1,
            completedStepCount
          )} will not run again.`;

          updateStepAndNode(
            step.id,
            node.id,
            {
              status: "failed",
              durationMs: delayMs,
              error: errMsg,
              outputSummary: "Email dispatch aborted due to expired Gmail OAuth token.",
            },
            "failed",
            "failed"
          );
          void updateRunStepRow({
            idempotencyKey: step.idempotencyKey,
            status: "failed",
            error: errMsg,
          });
          void updateRunRowStatus(runId, "failed");
          setIsRunningMeeting(false);
          setRunFeedback({
            runId,
            message: errMsg,
          });
          return;
        }

        const to = node.config.to || "ops-lead@acmecorp.example";
        const subject = node.config.subject || `${meeting.title} Recap`;
        const body = node.config.body || meeting.summary;
        const gmailUrl = buildGmailComposeUrl(to, subject, body);

        updateStepAndNode(
          step.id,
          node.id,
          {
            status: "waiting",
            durationMs: delayMs,
            waitingKind: "gmail",
            actionUrl: gmailUrl,
            actionLabel: "Open in Gmail",
            outputSummary: `Email ready for ${to} ("${subject}"). Click Open in Gmail to send and mark step done.`,
          },
          "waiting",
          "needs_review"
        );
        void updateRunStepRow({
          idempotencyKey: step.idempotencyKey,
          status: "waiting",
          output: `Email draft ready for ${to}`,
        });
        void updateRunRowStatus(runId, "needs_review");
        setIsRunningMeeting(false);
        setRunFeedback({
          runId,
          message: `Run #${latestRun.runNumber} prepared Gmail draft — click "Open in Gmail" in Run Timeline to mark done & continue.`,
        });
        return;
      }

      if (node.type === "calendar") {
        const eventTitle = node.config.eventTitle || `${meeting.title} Follow-up`;
        const dateStr = node.config.date || "Thu 19 Nov";
        const timeStr = node.config.time || "4:00 PM IST";
        const durationMins = node.config.durationMins || 30;
        const attendees = node.config.attendees || "Anita, Meena, Raj Patel";
        const calUrl = buildGoogleCalendarUrl(
          eventTitle,
          dateStr,
          timeStr,
          durationMins,
          attendees
        );
        const outputSummary = `Prepared Google Calendar event "${eventTitle}" for ${dateStr} at ${timeStr}.`;

        setState((prev) => ({
          ...prev,
          idempotencyLedger: {
            ...prev.idempotencyLedger,
            [step.idempotencyKey]: {
              key: step.idempotencyKey,
              nodeId: node.id,
              meetingId: meeting.id,
              completedAt: nowTimeShort(),
              outputSummary,
            },
          },
        }));

        updateStepAndNode(
          step.id,
          node.id,
          {
            status: "completed",
            durationMs: delayMs,
            actionUrl: calUrl,
            actionLabel: "Add to Google Calendar",
            outputSummary,
          },
          "done"
        );
        void updateRunStepRow({
          idempotencyKey: step.idempotencyKey,
          status: "done",
          output: outputSummary,
        });
        continue;
      }

      if (node.type === "wait") {
        const days = node.config.durationDays ?? 3;
        updateStepAndNode(
          step.id,
          node.id,
          {
            status: "waiting",
            durationMs: delayMs,
            waitingKind: "wait",
            outputSummary: `Scheduled ${days}-day wait (${
              node.config.condition || "check open tickets"
            }). Click Fast-forward 3 days to trigger now.`,
          },
          "waiting",
          "needs_review"
        );
        void updateRunStepRow({
          idempotencyKey: step.idempotencyKey,
          status: "waiting",
          output: `Scheduled ${days}-day wait`,
        });
        void updateRunRowStatus(runId, "needs_review");
        setIsRunningMeeting(false);
        setRunFeedback({
          runId,
          message: `Run #${latestRun.runNumber} waiting ${days} days — click "Fast-forward 3 days" in Run Timeline to continue.`,
        });
        return;
      }

      if (node.type === "slack-nudge") {
        const channel = node.config.channel || "#delivery-ops";
        const message =
          node.config.message ||
          `Reminder from ${meeting.title}: open action items need attention.`;
        const webhook = (node.config.webhookUrl || settings.slackWebhookUrl || "").trim();

        let outputSummary = "";
        if (webhook && !mockModeRef.current) {
          try {
            const resp = await fetch("/api/integrations/webhook", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ url: webhook, payload: { text: `[${channel}] ${message}` } }),
            });
            if (!resp.ok) {
              const errData = (await resp.json().catch(() => ({}))) as { error?: string };
              throw new Error(errData.error || "Slack webhook delivery failed.");
            }
            outputSummary = `Delivered Slack webhook payload to ${channel}.`;
            showToast(`Slack Sent · ${channel}`, message);
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : "Slack webhook failed.";
            updateStepAndNode(
              step.id,
              node.id,
              { status: "failed", durationMs: delayMs, error: errMsg, outputSummary: errMsg },
              "failed",
              "failed"
            );
            void updateRunStepRow({
              idempotencyKey: step.idempotencyKey,
              status: "failed",
              error: errMsg,
            });
            void updateRunRowStatus(runId, "failed");
            setIsRunningMeeting(false);
            setRunFeedback({ runId, message: errMsg });
            return;
          }
        } else {
          outputSummary = webhook
            ? `Simulated Slack webhook to ${channel} (Mock Mode).`
            : `Simulated Slack nudge in ${channel} via toast notification (no webhook URL configured).`;
          showToast(`Slack Nudge · ${channel}`, message);
        }

        setState((prev) => ({
          ...prev,
          idempotencyLedger: {
            ...prev.idempotencyLedger,
            [step.idempotencyKey]: {
              key: step.idempotencyKey,
              nodeId: node.id,
              meetingId: meeting.id,
              completedAt: nowTimeShort(),
              outputSummary,
            },
          },
        }));

        updateStepAndNode(
          step.id,
          node.id,
          { status: "completed", durationMs: delayMs, outputSummary },
          "done"
        );
        void updateRunStepRow({
          idempotencyKey: step.idempotencyKey,
          status: "done",
          output: outputSummary,
        });
      }
    }

    // Completed full run
    setState((prev) => ({
      ...prev,
      runs: prev.runs.map((r) =>
        r.id === runId
          ? {
              ...r,
              status: "completed",
              completedAt: `14 Nov · ${nowTimeShort().slice(0, 5)}`,
            }
          : r
      ),
    }));
    void updateRunRowStatus(runId, "completed");
    setIsRunningMeeting(false);
    const finishedRun = stateRef.current.runs.find((r) => r.id === runId);
    setRunFeedback({
      runId,
      message: `Run #${finishedRun?.runNumber ?? ""} finished — ${
        finishedRun?.duplicatesBlockedInRun || 0
      } duplicate(s) blocked.`,
    });
  };

  const handleRunMeeting = async (runOptions?: {
    autoApproveAs?: string;
    pauseBeforeGmailForDemo?: () => Promise<void>;
  }): Promise<string | null> => {
    if (!selectedMeeting || isRunningMeeting) return null;
    setRunFeedback(null);

    const orderedNodes = orderNodesTopologically(
      stateRef.current.workflow.nodes.filter((n) => n.enabled),
      stateRef.current.workflow.edges
    );

    if (orderedNodes.length === 0) return null;

    const runId = generateUuid();
    const runNumber = stateRef.current.nextRunNumber;
    const startedLabel = `14 Nov · ${nowTimeShort().slice(0, 5)}`;

    const confirmedItems = selectedMeeting.extractedItems.filter(
      (i) => !i.needsConfirmation || i.resolved
    );
    const gmailNode = orderedNodes.find((n) => n.type === "gmail");
    const recapDraft =
      gmailNode?.config.body ||
      `Recap for ${selectedMeeting.title} (${selectedMeeting.date}):\n` +
        confirmedItems
          .map((i) => {
            const owner = stateRef.current.people.find((p) => p.id === i.ownerId)?.name || "Team";
            return `• ${i.title} — ${owner} (${i.dueDate})`;
          })
          .join("\n");

    const initialSteps: RunStep[] = orderedNodes.map((node, index) => ({
      id: generateUuid(),
      stepIndex: index + 1,
      nodeId: node.id,
      nodeType: node.type,
      nodeLabel: node.label,
      idempotencyKey: computeIdempotencyKey(selectedMeeting.id, node.id, {
        type: node.type,
        config: node.config,
        date: selectedMeeting.date,
      }),
      status: "queued",
      startedAt: nowTimeShort(),
      durationMs: 0,
      outputSummary: "Queued for sequential execution.",
    }));

    const newRun: Run = {
      id: runId,
      runNumber,
      meetingId: selectedMeeting.id,
      meetingTitle: selectedMeeting.title,
      workflowId: stateRef.current.workflow.id,
      status: "running",
      startedAt: startedLabel,
      duplicatesBlockedInRun: 0,
      recapDraft,
      steps: initialSteps,
    };

    void createRunRow(newRun);

    setState((prev) => ({
      ...prev,
      nextRunNumber: prev.nextRunNumber + 1,
      workflow: {
        ...prev.workflow,
        nodes: prev.workflow.nodes.map((n) => ({
          ...n,
          status: n.enabled ? "queued" : "idle",
        })),
      },
      runs: [newRun, ...prev.runs],
      meetings: prev.meetings.map((m) =>
        m.id === selectedMeeting.id ? { ...m, lastRunId: runId } : m
      ),
    }));

    // Wait a tick so stateRef reflects newRun before sequential execution starts
    await new Promise((r) => window.setTimeout(r, 40));
    await executeRunFromStep(runId, 0, runOptions);
    return runId;
  };

  const handleApproveStep = async (runId: string, stepId: string) => {
    const run = stateRef.current.runs.find((r) => r.id === runId);
    if (!run || isRunningMeeting) return;
    const stepIdx = run.steps.findIndex((s) => s.id === stepId);
    if (stepIdx === -1) return;
    const step = run.steps[stepIdx];
    const outputSummary = `Approved by ${step.approverName || "Anita (Manager)"}.`;

    setState((prev) => ({
      ...prev,
      idempotencyLedger: {
        ...prev.idempotencyLedger,
        [step.idempotencyKey]: {
          key: step.idempotencyKey,
          nodeId: step.nodeId,
          meetingId: run.meetingId,
          completedAt: nowTimeShort(),
          outputSummary,
        },
      },
      workflow: {
        ...prev.workflow,
        nodes: prev.workflow.nodes.map((n) =>
          n.id === step.nodeId ? { ...n, status: "done" } : n
        ),
      },
      runs: prev.runs.map((r) =>
        r.id !== runId
          ? r
          : {
              ...r,
              steps: r.steps.map((s) =>
                s.id === stepId
                  ? { ...s, status: "completed", outputSummary, waitingKind: undefined }
                  : s
              ),
            }
      ),
    }));

    void updateRunStepRow({
      idempotencyKey: step.idempotencyKey,
      status: "done",
      output: outputSummary,
    });
    void updateRunRowStatus(runId, "running");

    await new Promise((r) => window.setTimeout(r, 50));
    await executeRunFromStep(runId, stepIdx + 1);
  };

  const handleOpenGmailStep = async (runId: string, stepId: string) => {
    const run = stateRef.current.runs.find((r) => r.id === runId);
    if (!run || isRunningMeeting) return;
    const stepIdx = run.steps.findIndex((s) => s.id === stepId);
    if (stepIdx === -1) return;
    const step = run.steps[stepIdx];
    if (step.status === "completed") return;

    const outputSummary = "Opened prefilled Gmail compose window and marked step done.";

    setState((prev) => ({
      ...prev,
      idempotencyLedger: {
        ...prev.idempotencyLedger,
        [step.idempotencyKey]: {
          key: step.idempotencyKey,
          nodeId: step.nodeId,
          meetingId: run.meetingId,
          completedAt: nowTimeShort(),
          outputSummary,
        },
      },
      workflow: {
        ...prev.workflow,
        nodes: prev.workflow.nodes.map((n) =>
          n.id === step.nodeId ? { ...n, status: "done" } : n
        ),
      },
      runs: prev.runs.map((r) =>
        r.id !== runId
          ? r
          : {
              ...r,
              steps: r.steps.map((s) =>
                s.id === stepId
                  ? { ...s, status: "completed", outputSummary, waitingKind: undefined }
                  : s
              ),
            }
      ),
    }));

    void updateRunStepRow({
      idempotencyKey: step.idempotencyKey,
      status: "done",
      output: outputSummary,
    });
    void updateRunRowStatus(runId, "running");

    await new Promise((r) => window.setTimeout(r, 100));
    await executeRunFromStep(runId, stepIdx + 1);
  };

  const handleFastForwardWaitStep = async (runId: string, stepId: string) => {
    const run = stateRef.current.runs.find((r) => r.id === runId);
    if (!run || isRunningMeeting) return;
    const stepIdx = run.steps.findIndex((s) => s.id === stepId);
    if (stepIdx === -1) return;
    const step = run.steps[stepIdx];
    const outputSummary = "Fast-forwarded 3 days — triggering downstream nudge check.";

    setState((prev) => ({
      ...prev,
      idempotencyLedger: {
        ...prev.idempotencyLedger,
        [step.idempotencyKey]: {
          key: step.idempotencyKey,
          nodeId: step.nodeId,
          meetingId: run.meetingId,
          completedAt: nowTimeShort(),
          outputSummary,
        },
      },
      workflow: {
        ...prev.workflow,
        nodes: prev.workflow.nodes.map((n) =>
          n.id === step.nodeId ? { ...n, status: "done" } : n
        ),
      },
      runs: prev.runs.map((r) =>
        r.id !== runId
          ? r
          : {
              ...r,
              steps: r.steps.map((s) =>
                s.id === stepId
                  ? { ...s, status: "completed", outputSummary, waitingKind: undefined }
                  : s
              ),
            }
      ),
    }));

    void updateRunStepRow({
      idempotencyKey: step.idempotencyKey,
      status: "done",
      output: outputSummary,
    });
    void updateRunRowStatus(runId, "running");

    await new Promise((r) => window.setTimeout(r, 80));
    await executeRunFromStep(runId, stepIdx + 1);
  };

  const handleResumeRun = async (runId: string) => {
    const run = stateRef.current.runs.find((r) => r.id === runId);
    if (!run || isRunningMeeting) return;

    setChaosArmed(false);
    chaosArmedRef.current = false;

    const firstFailedOrWaitingIdx = run.steps.findIndex(
      (s) => s.status === "failed" || s.status === "waiting" || s.status === "queued"
    );
    const startIdx = firstFailedOrWaitingIdx === -1 ? 0 : firstFailedOrWaitingIdx;

    await resetFailedOrQueuedStepsInDb(runId);
    void updateRunRowStatus(runId, "running");

    // Clear error on failed step before resuming from step 0 so completed steps visibly skip via idempotency
    setState((prev) => ({
      ...prev,
      runs: prev.runs.map((r) =>
        r.id !== runId
          ? r
          : {
              ...r,
              status: "running",
              steps: r.steps.map((s, idx) =>
                idx >= startIdx ? { ...s, status: "queued", error: undefined } : s
              ),
            }
      ),
    }));

    await new Promise((r) => window.setTimeout(r, 50));
    await executeRunFromStep(runId, 0);
    if (resumeDoneResolverRef.current) {
      resumeDoneResolverRef.current();
      resumeDoneResolverRef.current = null;
    }
  };

  const exitGuidedDemo = () => {
    demoRunTokenRef.current += 1;
    skipWaitResolverRef.current?.();
    skipWaitResolverRef.current = null;
    chaosDecisionResolverRef.current?.();
    chaosDecisionResolverRef.current = null;
    resumeDoneResolverRef.current?.();
    resumeDoneResolverRef.current = null;

    setDemoActive(false);
    setAwaitingChaosClick(false);
    setRevealedSegmentCount(null);
    setActiveTypingProgress(1);
    setVisibleExtractCount(null);
    setShowConfirmationTray(true);
    setDemoDryRunActive(false);
    setIsPlaying(false);
  };

  const startGuidedDemo = async () => {
    const token = demoRunTokenRef.current + 1;
    demoRunTokenRef.current = token;
    const isAlive = () => demoRunTokenRef.current === token;

    const skippableWait = (ms: number) =>
      new Promise<boolean>((resolve) => {
        let settled = false;
        const finish = (skipped: boolean) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          if (skipWaitResolverRef.current === onSkip) {
            skipWaitResolverRef.current = null;
          }
          resolve(skipped);
        };
        const timer = window.setTimeout(() => finish(false), ms);
        const onSkip = () => finish(true);
        skipWaitResolverRef.current = onSkip;
      });

    // Reset Acme weekly sync items cleanly for repeatable demo runs
    const seedAcme = INITIAL_MEETMIND_STATE.meetings[0];
    setState((prev) => ({
      ...prev,
      selectedMeetingId: seedAcme.id,
      meetings: prev.meetings.map((m) =>
        m.id === seedAcme.id ? { ...seedAcme, extractedItems: seedAcme.extractedItems } : m
      ),
      workflow: {
        ...prev.workflow,
        nodes: prev.workflow.nodes.map((n) => ({ ...n, status: "idle" })),
      },
    }));

    setDemoActive(true);
    setAwaitingChaosClick(false);
    setDemoDryRunActive(false);
    setConsentAccepted(true);
    setExtractError(null);
    setRunFeedback(null);
    setActiveView("meetings");

    // Step 1: Play waveform & stream transcript progressively (~8s total)
    setDemoStep(1);
    setDemoStepLabel("Playing waveform & streaming transcript");
    setVisibleExtractCount(0);
    setShowConfirmationTray(false);
    setIsPlaying(true);
    setCurrentSeconds(0);

    const segs = seedAcme.segments;
    for (let i = 0; i < segs.length; i++) {
      if (!isAlive()) return;
      setRevealedSegmentCount(i + 1);
      setCurrentSeconds(segs[i].seconds);

      let skipped = false;
      for (const frac of [0.3, 0.65, 1]) {
        if (!isAlive()) return;
        setActiveTypingProgress(frac);
        skipped = await skippableWait(320);
        if (skipped) break;
      }
      if (skipped) break;
    }

    if (!isAlive()) return;
    setIsPlaying(false);
    setRevealedSegmentCount(null);
    setActiveTypingProgress(1);

    // Step 2: Extraction chips pop in one by one; ambiguous items enter tray
    setDemoStep(2);
    setDemoStepLabel("Extracting complaints, decisions, commits & actions");
    setIsExtracting(true);
    await skippableWait(480);
    if (!isAlive()) return;

    let extractionRaw = MOCK_ACME_EXTRACTION;
    if (!mockModeRef.current) {
      try {
        const res = await fetch("/api/gemini/extract", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: seedAcme.title,
            segments: seedAcme.segments,
            roster: stateRef.current.people,
          }),
        });
        if (res.ok) {
          const parsed = await res.json();
          const check = validateRawExtractionResponse(parsed);
          if (check.valid) {
            extractionRaw = { summary: check.summary, items: check.items };
          }
        }
      } catch {
        // Fallback smoothly to cached extraction if offline
      }
    }
    if (!isAlive()) return;

    const resolvedItems = resolveExtractedItems(
      extractionRaw.items,
      seedAcme.segments,
      stateRef.current.people,
      seedAcme.date,
      seedAcme.id
    );
    setState((prev) => {
      const updatedMeetings = prev.meetings.map((m) =>
        m.id === seedAcme.id
          ? {
              ...m,
              summary: extractionRaw.summary || m.summary,
              extractedItems: resolvedItems,
            }
          : m
      );
      return {
        ...prev,
        meetings: updatedMeetings,
        promises: syncPromisesFromMeetings(prev.promises, updatedMeetings),
      };
    });
    setIsExtracting(false);
    setShowConfirmationTray(true);

    const confirmedCount = resolvedItems.filter(
      (item) => !item.needsConfirmation || item.resolved
    ).length;
    for (let c = 1; c <= confirmedCount; c++) {
      if (!isAlive()) return;
      setVisibleExtractCount(c);
      const skipped = await skippableWait(240);
      if (skipped) break;
    }
    if (!isAlive()) return;
    setVisibleExtractCount(null);

    // Step 3: Auto-resolve one ambiguity ("Raj" -> Raj Patel) then switch to Workflow
    setDemoStep(3);
    setDemoStepLabel('Auto-resolving "Raj" → Raj Patel & switching to Workflow');
    await skippableWait(1100);
    if (!isAlive()) return;

    const currentAcme = stateRef.current.meetings.find((m) => m.id === seedAcme.id);
    const rajAmbiguous = currentAcme?.extractedItems.find(
      (i) => i.needsConfirmation && !i.resolved
    );
    if (rajAmbiguous) {
      handleResolveAmbiguity(rajAmbiguous.id, "p_raj_patel");
      showToast(
        "Ambiguity Resolved",
        'Assigned "Send Acme a recap today" from "Raj" to Raj Patel (Engineer).'
      );
    }

    await skippableWait(1200);
    if (!isAlive()) return;
    setActiveView("workflow");

    // Step 4: Draw workflow graph node by node
    setDemoStep(4);
    setDemoStepLabel("Drawing workflow graph node by node");
    setDemoStaggerNonce((n) => n + 1);
    await skippableWait(2000);
    if (!isAlive()) return;

    // Step 5: Open Dry-run panel for 3 seconds, then auto-approve as Anita & execute
    setDemoStep(5);
    setDemoStepLabel("Previewing Dry run (3s), then auto-approving as Anita");
    setDemoDryRunActive(true);
    await skippableWait(3000);
    if (!isAlive()) return;

    showToast(
      "Dry Run Approved",
      "Approved by Anita (Manager) — executing pipeline sequentially."
    );

    // Step 6: Execute & pause before Gmail with prominent Break it prompt
    let chaosPromptShown = false;
    const waitForChaosDecision = () =>
      new Promise<void>((resolve) => {
        if (!isAlive()) {
          resolve();
          return;
        }
        chaosPromptShown = true;
        setDemoStep(6);
        setDemoStepLabel("Paused before Gmail — click 💥 Break it or Next step");
        setAwaitingChaosClick(true);
        chaosDecisionResolverRef.current = () => {
          chaosDecisionResolverRef.current = null;
          setAwaitingChaosClick(false);
          resolve();
        };
      });

    await handleRunMeeting({
      autoApproveAs: "Anita (Manager)",
      pauseBeforeGmailForDemo: waitForChaosDecision,
    });

    await skippableWait(60);
    if (!isAlive()) return;

    // If chaos failed the Gmail step, pause for presenter to click Resume (or Next step)
    const latestRun = stateRef.current.runs[0];
    if (chaosPromptShown && latestRun?.status === "failed") {
      setDemoStepLabel("Gmail failed — click Resume in Run Timeline (or Next step)");
      await new Promise<void>((resolve) => {
        resumeDoneResolverRef.current = () => {
          resumeDoneResolverRef.current = null;
          resolve();
        };
        skipWaitResolverRef.current = () => {
          skipWaitResolverRef.current = null;
          if (resumeDoneResolverRef.current) {
            resumeDoneResolverRef.current = null;
            resolve();
          }
        };
      });
      await skippableWait(1200);
    }

    if (!isAlive()) return;

    // Step 7: End on Promise Ledger with Pre-meeting brief
    setDemoStep(7);
    setDemoStepLabel("Promise Ledger & Gemini Pre-meeting brief");
    setDemoDryRunActive(false);
    setAwaitingChaosClick(false);
    setActiveView("promises");
    await handleGenerateBrief();
    if (!isAlive()) return;
    showToast(
      "Demo Complete",
      "All 7 steps finished. Use Restart to replay or toggle Mock mode anytime."
    );
  };

  const handleToggleChaos = () => {
    const next = !chaosArmedRef.current;
    setChaosArmed(next);
    chaosArmedRef.current = next;
    if (next && chaosDecisionResolverRef.current) {
      chaosDecisionResolverRef.current();
    }
  };

  const handleReplayFromStep = async (runId: string, stepIndex: number) => {
    const run = stateRef.current.runs.find((r) => r.id === runId);
    if (!run || isRunningMeeting) return;

    const targetSteps = run.steps.slice(stepIndex);
    const keysToInvalidate = new Set(targetSteps.map((s) => s.idempotencyKey));
    const nodeIdsToReset = new Set(targetSteps.map((s) => s.nodeId));

    setState((prev) => {
      const nextLedger = { ...prev.idempotencyLedger };
      for (const k of keysToInvalidate) {
        delete nextLedger[k];
      }
      return {
        ...prev,
        idempotencyLedger: nextLedger,
        workflow: {
          ...prev.workflow,
          nodes: prev.workflow.nodes.map((n) =>
            nodeIdsToReset.has(n.id) ? { ...n, status: "queued" } : n
          ),
        },
        runs: prev.runs.map((r) =>
          r.id !== runId
            ? r
            : {
                ...r,
                status: "running",
                steps: r.steps.map((s, idx) =>
                  idx >= stepIndex
                    ? {
                        ...s,
                        status: "queued",
                        error: undefined,
                        skippedDuplicate: false,
                        outputSummary: "Queued for replay.",
                      }
                    : s
                ),
              }
        ),
      };
    });

    await new Promise((r) => window.setTimeout(r, 60));
    await executeRunFromStep(runId, 0, { forceReplayFromIndex: stepIndex });
  };

  const handleCreateNewMeeting = (newMeeting: Meeting) => {
    setState((prev) => {
      const createdTickets: Ticket[] = newMeeting.extractedItems
        .filter((i) => i.kind !== "Decision")
        .map((item, idx) => ({
          id: `tkt_${Date.now()}_${idx}`,
          key: `TCK-${prev.nextTicketNumber + idx}`,
          title: item.title,
          description: `Extracted quote: "${item.quote}"`,
          status: item.ownerId ? "Backlog" : "Blocked",
          priority: item.kind === "Complaint" ? "High" : "Medium",
          assigneeId: item.ownerId,
          dueDate: item.dueDate,
          meetingId: newMeeting.id,
          segmentId: item.segmentId,
          sourceKind: item.kind,
        }));

      const createdPromises: PromiseRecord[] = newMeeting.extractedItems
        .filter((i) => i.kind === "Commit" || i.kind === "Action")
        .map((item, idx) => ({
          id: `prm_${Date.now()}_${idx}`,
          statement: item.title,
          ownerId: item.ownerId,
          counterparty: newMeeting.title,
          dueDate: item.dueDate,
          status: item.ownerId ? "Open" : "At Risk",
          confidence: item.confidence,
          meetingId: newMeeting.id,
          segmentId: item.segmentId,
        }));

      const nextPromises = syncPromisesFromMeetings(
        [...createdPromises, ...prev.promises],
        [newMeeting]
      );

      return {
        ...prev,
        nextTicketNumber: prev.nextTicketNumber + createdTickets.length,
        meetings: [newMeeting, ...prev.meetings],
        selectedMeetingId: newMeeting.id,
        tickets: [...createdTickets, ...prev.tickets],
        promises: nextPromises,
      };
    });
    setActiveView("meetings");
  };

  const handleSaveSettings = async (next: AppSettings) => {
    saveAppSettings(next);
    setSettings(next);
    resetCachedSupabaseClient();
    setDbStatus(getDbStatusInfo());
    await mergeWorkspaceFromSupabase(true);
  };

  const handleConnectGoogle = async () => {
    const session = await connectGoogleAccount(settings.googleClientId);
    setGoogleSession(session);
    showToast("Google Connected", "Gmail drafts/send & Calendar permissions active.");
  };

  const handleDisconnectGoogle = () => {
    disconnectGoogleAccount();
    setGoogleSession(null);
    showToast("Google Disconnected", "Cleared Google OAuth session token.");
  };

  const planToolsForMeeting = async (targetMeeting: Meeting): Promise<PlannedToolAction[]> => {
    const customConnectors = settingsRef.current.customConnectors || [];
    try {
      if (mockModeRef.current) {
        return [
          ...buildMockPlannedToolActions(targetMeeting.id, targetMeeting.title),
          ...buildMockCustomConnectorActions(targetMeeting, customConnectors),
        ];
      }
      const resp = await fetch("/api/gemini/plan-tools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          meetingId: targetMeeting.id,
          meetingTitle: targetMeeting.title,
          summary: targetMeeting.summary,
          executionPlan: targetMeeting.executionPlan || [],
          roster: stateRef.current.people,
          modelName: settingsRef.current.geminiModel,
          customConnectors,
          items: targetMeeting.extractedItems.map((it) => ({
            kind: it.kind,
            liveCategory: it.liveCategory,
            title: it.title,
            quote: it.quote,
            dueDate: it.dueDate,
            priority: it.priority || "Medium",
            ownerName:
              stateRef.current.people.find((p) => p.id === it.ownerId)?.name ||
              it.rawOwner ||
              "Unassigned",
          })),
        }),
      });
      const data = (await resp.json()) as {
        toolCalls?: Array<{ id?: string; name: string; args: Record<string, unknown> }>;
      };
      if (resp.ok && Array.isArray(data.toolCalls)) {
        return buildPlannedActionsFromFunctionCalls(
          targetMeeting.id,
          data.toolCalls,
          customConnectors
        );
      }
    } catch {
      // Fallback cleanly to editable mock tool actions
    }
    return [
      ...buildMockPlannedToolActions(targetMeeting.id, targetMeeting.title),
      ...buildMockCustomConnectorActions(targetMeeting, customConnectors),
    ];
  };

  // Unified Background Pipeline for both Global Recorder Orb and Live Record Page
  const runAudioAnalysisPipeline = async (input: {
    blob: Blob | null;
    durationSec: number;
    title?: string;
    mimeType?: string;
    existingMeetingId?: string;
    fromOrb?: boolean;
  }) => {
    const meetingId = input.existingMeetingId || generateUuid();
    const durationSec = Math.max(1, Math.round(input.durationSec || 10));
    const title = (input.title || "").trim() || `Recorded Meeting · ${formatMmSs(durationSec)}`;
    const nowIso = new Date().toISOString();
    const todayFormatted = new Date().toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });

    if (input.blob) {
      await saveAudioBlob(meetingId, input.blob);
    }

    const analyzingPlaceholder: Meeting = {
      id: meetingId,
      title,
      date: todayFormatted,
      duration: formatMmSs(durationSec),
      durationSeconds: durationSec,
      speakerIds: [],
      segments: [],
      extractedItems: [],
      summary: "Transcribing audio & extracting complaints, tasks, decisions & promises…",
      language: "Detecting…",
      createdAt: nowIso,
      isLiveRecording: true,
      status: "analyzing",
      healthScore: 0,
    };

    // 1) Insert meeting row immediately with status="analyzing"
    setState((prev) => {
      const exists = prev.meetings.some((m) => m.id === meetingId);
      const nextMeetings = exists
        ? prev.meetings.map((m) => (m.id === meetingId ? analyzingPlaceholder : m))
        : [analyzingPlaceholder, ...prev.meetings];
      return {
        ...prev,
        meetings: nextMeetings,
      };
    });
    setActiveLiveMeetingId(meetingId);
    void insertAnalyzingMeeting(analyzingPlaceholder);

    try {
      // 2) Upload audio blob to Supabase Storage bucket "recordings"
      let uploadedAudioPath: string | undefined;
      if (input.blob) {
        const upRes = await uploadMeetingAudio(meetingId, input.blob);
        if (upRes.audioPath) {
          uploadedAudioPath = upRes.audioPath;
        }
      }

      // 3) Transcribe + extract via Gemini multimodal audio (with retry-once inside server endpoint)
      let rawAnalysis: RawLiveAudioAnalysisPayload;
      if (mockModeRef.current || !input.blob) {
        await new Promise((r) => window.setTimeout(r, 420));
        rawAnalysis = buildMockLiveAudioAnalysis(durationSec);
      } else {
        const base64 = await blobToBase64(input.blob);
        const cleanMime = (input.mimeType || input.blob.type || "audio/webm").split(";")[0];
        const resp = await fetch("/api/gemini/analyze-audio", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            audioBase64: base64,
            mimeType: cleanMime,
            durationSec,
            modelName: settingsRef.current.geminiModel,
            roster: stateRef.current.people,
            currentDate: todayFormatted,
          }),
        });
        const data = (await resp.json()) as RawLiveAudioAnalysisPayload & { error?: string };
        if (!resp.ok) {
          throw new Error(data.error || "Gemini audio analysis failed.");
        }
        rawAnalysis = data;
      }

      // 4) Run people & relative date resolvers + draft workflow & health score
      const builtMeeting = buildMeetingFromLiveAnalysis(rawAnalysis, {
        meetingId,
        title: (input.title || "").trim() || rawAnalysis.title || title,
        durationSeconds: durationSec,
        roster: stateRef.current.people,
        audioPath: uploadedAudioPath,
      });

      const plannedActions = await planToolsForMeeting(builtMeeting);
      const completeMeeting: Meeting = {
        ...builtMeeting,
        createdAt: nowIso,
        status: "ready",
        plannedActions,
      };

      // 5) Auto-create Tickets (complaints/tasks) + Promises (commits/owned tasks) idempotently
      const autoRecords = buildAutoTicketsAndPromisesFromMeeting(
        completeMeeting,
        stateRef.current.nextTicketNumber
      );

      await updateMeetingRecord(completeMeeting);
      await upsertTicketsAndPromises(
        completeMeeting,
        autoRecords.tickets,
        autoRecords.promises,
        stateRef.current.people
      );

      setState((prev) => {
        const existingTicketKeys = new Set(
          prev.tickets.map((t) => `${t.meetingId}:${t.sourceItemId || t.id}`)
        );
        const freshTickets = autoRecords.tickets.filter(
          (t) => !existingTicketKeys.has(`${t.meetingId}:${t.sourceItemId || t.id}`)
        );

        const existingPromiseKeys = new Set(
          prev.promises.map((p) => `${p.meetingId}:${p.sourceItemId || p.id}`)
        );
        const freshPromises = autoRecords.promises.filter(
          (p) => !existingPromiseKeys.has(`${p.meetingId}:${p.sourceItemId || p.id}`)
        );

        const nextMeetings = prev.meetings.map((m) =>
          m.id === meetingId ? completeMeeting : m
        );
        const nextPromises = syncPromisesFromMeetings(
          [...freshPromises, ...prev.promises],
          nextMeetings
        );

        return {
          ...prev,
          nextTicketNumber: autoRecords.nextTicketNumber,
          meetings: nextMeetings,
          tickets: [...freshTickets, ...prev.tickets],
          promises: nextPromises,
          workflow: completeMeeting.workflowSnapshot || prev.workflow,
        };
      });

      if (input.fromOrb) {
        setOrbState("done");
        window.setTimeout(() => {
          setOrbState((cur) => (cur === "done" ? "idle" : cur));
        }, 4200);
      }

      markMeetingNewlyArrived(meetingId);
      publishWorkspaceEvent({ type: "meeting_upserted", meetingId, isNew: true });

      showToast(
        "Meeting saved",
        `${formatMmSs(durationSec)} · ${completeMeeting.extractedItems.length} items found`,
        {
          label: "View",
          onClick: () => selectMeeting(meetingId),
        }
      );
    } catch (err) {
      const errMsg =
        err instanceof Error ? err.message : "Audio analysis failed. Click Retry.";
      const failedMeeting: Meeting = {
        ...analyzingPlaceholder,
        status: "failed",
        summary: `Analysis failed: ${errMsg}`,
        analysisError: errMsg,
      };
      void updateMeetingRecord(failedMeeting);
      setState((prev) => ({
        ...prev,
        meetings: prev.meetings.map((m) => (m.id === meetingId ? failedMeeting : m)),
      }));

      if (input.fromOrb) {
        setOrbErrorText(errMsg);
        setOrbState("error");
        window.setTimeout(() => {
          setOrbState((cur) => (cur === "error" ? "idle" : cur));
        }, 5000);
      }

      showToast("Analysis Failed", errMsg, {
        label: "View",
        onClick: () => selectMeeting(meetingId),
      });
    }
  };

  const handleRetryMeetingAnalysis = async (meetingId: string) => {
    const target = stateRef.current.meetings.find((m) => m.id === meetingId);
    if (!target) return;
    const savedBlob = await getAudioBlob(meetingId);
    if (!savedBlob && !mockModeRef.current) {
      showToast(
        "Audio Blob Missing",
        "Original local recording was cleared; toggle Mock Mode or record again."
      );
      return;
    }
    await runAudioAnalysisPipeline({
      blob: savedBlob,
      durationSec: target.durationSeconds || 12,
      title: target.title,
      mimeType: savedBlob?.type || "audio/webm",
      existingMeetingId: meetingId,
      fromOrb: true,
    });
  };

  const cleanupOrbHandles = () => {
    if (orbRafRef.current !== null) {
      cancelAnimationFrame(orbRafRef.current);
      orbRafRef.current = null;
    }
    if (orbTimerRef.current !== null) {
      window.clearInterval(orbTimerRef.current);
      orbTimerRef.current = null;
    }
    if (orbAutoStopRef.current !== null) {
      window.clearTimeout(orbAutoStopRef.current);
      orbAutoStopRef.current = null;
    }
    if (orbStreamRef.current) {
      orbStreamRef.current.getTracks().forEach((t) => t.stop());
      orbStreamRef.current = null;
    }
    if (orbAudioCtxRef.current) {
      void orbAudioCtxRef.current.close().catch(() => {});
      orbAudioCtxRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      cleanupOrbHandles();
    };
  }, []);

  const stopOrbRecording = () => {
    if (orbStateRef.current !== "recording") return;
    setOrbState("stopping");
    const recorder = orbRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    } else {
      cleanupOrbHandles();
      setOrbState("idle");
    }
  };

  const startOrbRecording = async () => {
    setOrbErrorText(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      const msg = "Microphone MediaRecorder unsupported in this browser.";
      setOrbErrorText(msg);
      setOrbState("error");
      showToast("Microphone Unavailable", msg);
      window.setTimeout(() => setOrbState((c) => (c === "error" ? "idle" : c)), 4500);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      orbStreamRef.current = stream;

      const preferredTypes = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4",
        "audio/ogg",
      ];
      const supportedMime =
        preferredTypes.find((t) => MediaRecorder.isTypeSupported(t)) || "";

      const recorder = supportedMime
        ? new MediaRecorder(stream, { mimeType: supportedMime })
        : new MediaRecorder(stream);

      orbChunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          orbChunksRef.current.push(ev.data);
        }
      };

      recorder.onstop = () => {
        const realDurationSec = Math.max(
          1,
          Math.round((Date.now() - orbStartMsRef.current) / 1000)
        );
        const mime = recorder.mimeType || supportedMime || "audio/webm";
        const blob = new Blob(orbChunksRef.current, { type: mime });
        cleanupOrbHandles();
        setOrbWaveLevels(Array.from({ length: 12 }, () => 0.16));
        setOrbState("analyzing");

        // Launch full pipeline in background while user keeps navigating freely
        void runAudioAnalysisPipeline({
          blob,
          durationSec: realDurationSec,
          mimeType: mime,
          fromOrb: true,
        });
      };

      // Live Web Audio AnalyserNode for Orb waveform
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audioCtx = new AudioCtx();
      orbAudioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);

      const freqArr = new Uint8Array(analyser.frequencyBinCount);
      const tickWave = () => {
        analyser.getByteFrequencyData(freqArr);
        const bars: number[] = [];
        const step = Math.max(1, Math.floor(freqArr.length / 12));
        for (let i = 0; i < 12; i++) {
          const val = freqArr[Math.min(freqArr.length - 1, i * step)] / 255;
          bars.push(Math.max(0.14, Math.min(1, val * 1.2)));
        }
        setOrbWaveLevels(bars);
        orbRafRef.current = requestAnimationFrame(tickWave);
      };
      orbRafRef.current = requestAnimationFrame(tickWave);

      orbStartMsRef.current = Date.now();
      setOrbElapsedSec(0);
      orbTimerRef.current = window.setInterval(() => {
        setOrbElapsedSec(Math.floor((Date.now() - orbStartMsRef.current) / 1000));
      }, 200);

      // Auto-stop at 10 minutes (600s)
      orbAutoStopRef.current = window.setTimeout(() => {
        showToast("Max Recording Length Reached", "Auto-stopped at 10:00 and started analysis.");
        stopOrbRecording();
      }, 600_000);

      recorder.start(250);
      orbRecorderRef.current = recorder;
      setOrbState("recording");
    } catch (err) {
      cleanupOrbHandles();
      const rawName = err instanceof Error ? err.name : "";
      const msg =
        rawName === "NotAllowedError" || rawName === "PermissionDeniedError"
          ? "Mic permission denied. Allow microphone access in browser settings."
          : err instanceof Error
          ? err.message
          : "Could not access microphone.";
      setOrbErrorText(msg);
      setOrbState("error");
      showToast("Microphone Error", msg);
      window.setTimeout(() => setOrbState((c) => (c === "error" ? "idle" : c)), 4500);
    }
  };

  const handleToggleOrbRecording = () => {
    if (orbStateRef.current === "recording") {
      stopOrbRecording();
      return;
    }
    if (orbStateRef.current === "stopping" || orbStateRef.current === "analyzing") {
      return;
    }
    if (!consentAccepted && !loadRememberedOrbConsent()) {
      showToast(
        "Consent Required",
        'Click the glowing Lavender Orb to accept "Audio is processed to extract tasks."'
      );
      return;
    }
    void startOrbRecording();
  };

  const handleUpdateLiveMeeting = (updated: Meeting) => {
    setState((prev) => ({
      ...prev,
      meetings: prev.meetings.map((m) => (m.id === updated.id ? updated : m)),
    }));
    void updateMeetingRecord(updated);
    publishWorkspaceEvent({ type: "meeting_upserted", meetingId: updated.id });
  };

  const handleUpdateMeetingData = (meetingId: string, patch: Partial<Meeting>) => {
    let savedMtg: Meeting | null = null;
    setState((prev) => ({
      ...prev,
      meetings: prev.meetings.map((m) => {
        if (m.id !== meetingId) return m;
        savedMtg = { ...m, ...patch };
        return savedMtg;
      }),
    }));
    if (savedMtg) {
      void updateMeetingRecord(savedMtg);
      publishWorkspaceEvent({ type: "meeting_upserted", meetingId });
    }
  };

  const handleToggleTestMode = () => {
    const nextSettings: AppSettings = {
      ...settingsRef.current,
      testMode: !settingsRef.current.testMode,
    };
    saveAppSettings(nextSettings);
    setSettings(nextSettings);
    showToast(
      nextSettings.testMode ? "Test Mode Enabled" : "Test Mode Disabled",
      nextSettings.testMode
        ? `Outgoing emails redirect safely to ${
            nextSettings.testEmail || googleSession?.userEmail || "uditnarayan3119@gmail.com"
          }.`
        : "Outgoing emails will target each recipient address."
    );
  };

  const handleSyncWorkflowNode = (
    meetingId: string,
    input: {
      toolName: PlannedToolName;
      status: NodeExecutionStatus;
      completedAt?: string;
      errorMessage?: string;
    }
  ) => {
    const mapping = mapToolNameToNodeAndBadge(input.toolName);
    const planStepStatus: ExecutionPlanStep["status"] =
      input.status === "done"
        ? "done"
        : input.status === "failed"
        ? "failed"
        : input.status === "running" || input.status === "waiting"
        ? "waiting"
        : "planned";

    const updateNodesList = (nodes: WorkflowNode[]) =>
      nodes.map((n) =>
        mapping.nodeTypes.includes(n.type)
          ? {
              ...n,
              status: input.status,
              completedAt: input.completedAt ?? (input.status === "running" ? undefined : n.completedAt),
              errorMessage: input.errorMessage,
            }
          : n
      );

    let updatedMeetingObj: Meeting | null = null;
    setState((prev) => ({
      ...prev,
      workflow:
        prev.selectedMeetingId === meetingId
          ? { ...prev.workflow, nodes: updateNodesList(prev.workflow.nodes) }
          : prev.workflow,
      meetings: prev.meetings.map((m) => {
        if (m.id !== meetingId) return m;
        const nextSnap = m.workflowSnapshot
          ? { ...m.workflowSnapshot, nodes: updateNodesList(m.workflowSnapshot.nodes) }
          : undefined;
        const nextPlan = (m.executionPlan || []).map((st) =>
          st.tool === mapping.planTool ? { ...st, status: planStepStatus } : st
        );
        updatedMeetingObj = {
          ...m,
          workflowSnapshot: nextSnap,
          executionPlan: nextPlan,
        };
        return updatedMeetingObj;
      }),
    }));

    if (updatedMeetingObj) {
      void updateMeetingRecord(updatedMeetingObj);
    }
    publishWorkspaceEvent({ type: "workflow_updated", meetingId });
  };

  const handleResumeFailedWorkflow = (meetingId: string) => {
    const failedRun =
      stateRef.current.runs.find((r) => r.meetingId === meetingId && r.status === "failed") ||
      stateRef.current.runs.find((r) => r.status === "failed");
    if (failedRun) {
      void handleResumeRun(failedRun.id);
      return;
    }
    const targetMtg = stateRef.current.meetings.find((m) => m.id === meetingId);
    const baseWf = targetMtg?.workflowSnapshot || stateRef.current.workflow;
    const resetNodes = baseWf.nodes.map((n) =>
      n.status === "failed"
        ? { ...n, status: "idle" as const, errorMessage: undefined }
        : n
    );
    setState((prev) => ({
      ...prev,
      workflow:
        prev.selectedMeetingId === meetingId
          ? { ...prev.workflow, nodes: resetNodes }
          : prev.workflow,
      meetings: prev.meetings.map((m) =>
        m.id === meetingId && m.workflowSnapshot
          ? { ...m, workflowSnapshot: { ...m.workflowSnapshot, nodes: resetNodes } }
          : m
      ),
    }));
    showToast("Failed Node Reset", "Click Permit on the failed action card to resume.");
  };

  const handleResolveAmbiguityForMeeting = (
    meetingId: string,
    itemId: string,
    personId: string
  ) => {
    const targetMtg = stateRef.current.meetings.find((m) => m.id === meetingId);
    const targetItem = targetMtg?.extractedItems.find((i) => i.id === itemId);
    if (!targetMtg) return;

    setState((prev) => {
      const updatedMeetings = prev.meetings.map((m) => {
        if (m.id !== meetingId) return m;
        const nextMtg: Meeting = {
          ...m,
          extractedItems: m.extractedItems.map((item) =>
            item.id === itemId
              ? {
                  ...item,
                  ownerId: personId,
                  resolutionStatus: "confirmed" as const,
                  needsConfirmation: false,
                  resolved: true,
                  confidence: Math.max(item.confidence, 0.92),
                  ambiguityReason: undefined,
                }
              : item
          ),
        };
        void updateMeetingRecord(nextMtg);
        return nextMtg;
      });

      const updatedPromises = prev.promises.map((p) =>
        p.meetingId === meetingId &&
        p.segmentId === targetItem?.segmentId &&
        !p.ownerId
          ? {
              ...p,
              ownerId: personId,
              confidence: Math.max(p.confidence, 0.92),
              status: p.status === "At Risk" ? ("Open" as PromiseStatus) : p.status,
            }
          : p
      );

      return {
        ...prev,
        meetings: updatedMeetings,
        promises: syncPromisesFromMeetings(updatedPromises, updatedMeetings),
      };
    });
  };

  const handleDismissAmbiguityForMeeting = (meetingId: string, itemId: string) => {
    setState((prev) => ({
      ...prev,
      meetings: prev.meetings.map((m) => {
        if (m.id !== meetingId) return m;
        const nextMtg = {
          ...m,
          extractedItems: m.extractedItems.filter((i) => i.id !== itemId),
        };
        void updateMeetingRecord(nextMtg);
        return nextMtg;
      }),
    }));
  };

  const handleCreateTicketFromTool = (input: {
    title: string;
    ownerName: string;
    priority: TicketPriority;
    dueDate: string;
    quote: string;
    meetingId: string;
  }): string => {
    const ticketNum = stateRef.current.nextTicketNumber;
    const key = `TCK-${ticketNum}`;
    const ownerLower = input.ownerName.toLowerCase();
    const assignee = stateRef.current.people.find(
      (p) =>
        ownerLower &&
        (p.name.toLowerCase().includes(ownerLower) ||
          ownerLower.includes(p.name.toLowerCase()))
    );
    const mtg = stateRef.current.meetings.find((m) => m.id === input.meetingId);

    const newTicket: Ticket = {
      id: generateUuid(),
      key,
      title: input.title,
      description: input.quote
        ? `From live meeting quote: "${input.quote}"`
        : `Created via Gemini Function Calling from "${mtg?.title || "Meeting"}".`,
      status: assignee ? "In Progress" : "Backlog",
      priority: input.priority || "Medium",
      assigneeId: assignee?.id || null,
      dueDate: input.dueDate || "TBD",
      meetingId: input.meetingId,
      segmentId: mtg?.segments[0]?.id || "",
      sourceKind: input.priority === "High" ? "Complaint" : "Action",
      sourceItemId: `tool_${key}`,
    };

    if (mtg) {
      void upsertTicketsAndPromises(mtg, [newTicket], [], stateRef.current.people);
    }

    setState((prev) => ({
      ...prev,
      nextTicketNumber: prev.nextTicketNumber + 1,
      tickets: [newTicket, ...prev.tickets],
    }));

    publishWorkspaceEvent({ type: "ticket_upserted", ticketId: newTicket.id });

    return key;
  };

  const handleRecordIdempotency = (record: IdempotencyRecord, wasDuplicate: boolean) => {
    setState((prev) => ({
      ...prev,
      duplicatesBlockedTotal: wasDuplicate
        ? prev.duplicatesBlockedTotal + 1
        : prev.duplicatesBlockedTotal,
      idempotencyLedger: {
        ...prev.idempotencyLedger,
        [record.key]: record,
      },
    }));
  };

  const handlePlanToolsForSelectedMeeting = async (targetMeeting: Meeting) => {
    setIsPlanningMeetingTools(true);
    const customConnectors = settings.customConnectors || [];
    try {
      let actions: PlannedToolAction[];
      if (mockMode) {
        await new Promise((r) => window.setTimeout(r, 220));
        actions = [
          ...buildMockPlannedToolActions(targetMeeting.id, targetMeeting.title),
          ...buildMockCustomConnectorActions(targetMeeting, customConnectors),
        ];
      } else {
        const resp = await fetch("/api/gemini/plan-tools", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            meetingId: targetMeeting.id,
            meetingTitle: targetMeeting.title,
            summary: targetMeeting.summary,
            executionPlan: targetMeeting.executionPlan || [],
            roster: state.people,
            modelName: settings.geminiModel,
            customConnectors,
            items: targetMeeting.extractedItems.map((it) => ({
              kind: it.kind,
              liveCategory: it.liveCategory,
              title: it.title,
              quote: it.quote,
              dueDate: it.dueDate,
              priority: it.priority || "Medium",
              ownerName:
                state.people.find((p) => p.id === it.ownerId)?.name ||
                it.rawOwner ||
                "Unassigned",
            })),
          }),
        });
        const data = (await resp.json()) as {
          toolCalls?: Array<{ id?: string; name: string; args: Record<string, unknown> }>;
          error?: string;
        };
        if (!resp.ok || !Array.isArray(data.toolCalls)) {
          throw new Error(data.error || "Could not plan tool actions.");
        }
        actions = buildPlannedActionsFromFunctionCalls(
          targetMeeting.id,
          data.toolCalls,
          customConnectors
        );
      }
      handleUpdateLiveMeeting({ ...targetMeeting, plannedActions: actions });
    } catch (err) {
      showToast(
        "Tool Planner Fallback",
        err instanceof Error
          ? `${err.message} Loaded editable tool actions.`
          : "Loaded editable tool actions."
      );
      handleUpdateLiveMeeting({
        ...targetMeeting,
        plannedActions: [
          ...buildMockPlannedToolActions(targetMeeting.id, targetMeeting.title),
          ...buildMockCustomConnectorActions(targetMeeting, customConnectors),
        ],
      });
    } finally {
      setIsPlanningMeetingTools(false);
    }
  };

  // Keyboard shortcut: press "R" to toggle Recorder Orb recording (ignore inputs)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        (e.key === "r" || e.key === "R") &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !ingestModal.open
      ) {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName?.toLowerCase();
        const isEditable =
          tag === "input" ||
          tag === "textarea" ||
          tag === "select" ||
          Boolean(target?.isContentEditable);
        if (!isEditable) {
          e.preventDefault();
          handleToggleOrbRecording();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [ingestModal.open, consentAccepted]);

  const speakerNames = selectedMeeting
    ? selectedMeeting.speakerIds
        .map((id) => state.people.find((p) => p.id === id)?.name)
        .filter(Boolean)
        .join(", ")
    : "";

  const navItems: Array<{
    id: SidebarView;
    label: string;
    icon: typeof MessageSquareText;
    count?: number;
  }> = [
    {
      id: "live",
      label: "New Meeting",
      icon: Mic,
    },
    {
      id: "meetings",
      label: "Meetings",
      icon: MessageSquareText,
      count: pendingConfirmCount > 0 ? pendingConfirmCount : undefined,
    },
    {
      id: "history",
      label: "History",
      icon: History,
      count: state.meetings.length,
    },
    { id: "workflow", label: "Workflow", icon: GitBranch },
    { id: "tickets", label: "Tickets", icon: CheckSquare, count: state.tickets.length },
    {
      id: "promises",
      label: "Promise Ledger",
      icon: Handshake,
      count: unownedPromisesCount > 0 ? unownedPromisesCount : state.promises.length,
    },
    {
      id: "check",
      label: "System Check",
      icon: Stethoscope,
    },
    {
      id: "settings",
      label: "Settings",
      icon: Settings,
    },
  ];

  const breadcrumbLabel =
    activeView === "live"
      ? "New Meeting / Live Audio Record"
      : activeView === "history"
      ? "History / Past Meetings"
      : activeView === "check"
      ? "System Check / Supabase & Health"
      : activeView === "settings"
      ? "Settings / Supabase & OAuth"
      : activeView === "meetings"
      ? `Meetings / ${selectedMeeting?.title || ""}`
      : activeView === "workflow"
      ? "Workflow / Pipeline & Runs"
      : activeView === "tickets"
      ? "Tickets / Action Board"
      : "Promise Ledger / Commitments";

  return (
    <div className="canvas-atmospheric min-h-screen text-slate-100 lg:p-4">
      <div className="mx-auto flex min-h-screen max-w-[1520px] overflow-hidden lg:min-h-[calc(100vh-2rem)] lg:rounded-[26px] lg:border lg:border-white/[0.15] lg:glass-shell">
        {/* Mobile Sidebar Backdrop */}
        {mobileMenuOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/70 backdrop-blur-sm lg:hidden"
            onClick={() => setMobileMenuOpen(false)}
          />
        )}

        {/* Left Frosted Navigation Rail */}
        <aside
          className={`fixed inset-y-0 left-0 z-40 flex w-[264px] shrink-0 flex-col border-r border-white/[0.1] bg-[#08171e]/92 backdrop-blur-2xl transition-transform duration-200 lg:static lg:bg-white/[0.03] lg:translate-x-0 ${
            mobileMenuOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          {/* Brand */}
          <div className="flex items-center justify-between border-b border-white/[0.08] px-5 py-5">
            <div>
              <div className="font-serif text-2xl italic tracking-tight text-slate-50">
                MeetMind
              </div>
              <p className="mt-0.5 text-[11px] text-slate-300/75">
                Meetings that execute themselves.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setMobileMenuOpen(false)}
              className="rounded-xl p-1 text-slate-300 hover:text-white lg:hidden"
              aria-label="Close navigation"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Primary Nav */}
          <nav aria-label="Workspace sections" className="space-y-1.5 px-3 py-4">
            <div className="px-3 pb-1 text-[11px] font-medium text-slate-400">
              Main Menu
            </div>
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = activeView === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setActiveView(item.id);
                    setMobileMenuOpen(false);
                  }}
                  className={`flex w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5eead4] ${
                    active
                      ? "border border-white/[0.16] bg-white/[0.12] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]"
                      : "border border-transparent text-slate-300/80 hover:bg-white/[0.06] hover:text-white"
                  }`}
                >
                  <span className="flex shrink-0 items-center gap-2.5 whitespace-nowrap">
                    <Icon
                      className={`h-4 w-4 ${active ? "text-[#5eead4]" : "text-slate-400"}`}
                    />
                    {item.label}
                  </span>
                  {item.count !== undefined && (
                    <span
                      className={`font-mono text-[11px] tabular-nums ${
                        active ? "text-[#99f6e4]" : "text-slate-400"
                      }`}
                    >
                      {item.count}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Meetings Switcher */}
          <div className="mt-1 flex-1 overflow-y-auto border-t border-white/[0.08] px-3 py-4">
            <div className="flex items-center justify-between px-2">
              <span className="font-mono text-[11px] text-slate-400">Recent Meetings</span>
              <button
                type="button"
                onClick={() => setIngestModal({ open: true, mode: "paste" })}
                className="inline-flex items-center gap-1 font-mono text-[11px] text-[#5eead4] hover:text-[#99f6e4]"
              >
                <Plus className="h-3 w-3" />
                New
              </button>
            </div>

            <div className="mt-2.5 space-y-1.5">
              {state.meetings.map((mtg) => {
                const isSelected = mtg.id === selectedMeeting?.id && activeView === "meetings";
                const pending = mtg.extractedItems.filter(
                  (i) => i.needsConfirmation && !i.resolved
                ).length;
                const health = computeMeetingHealth(mtg);
                return (
                  <button
                    key={mtg.id}
                    type="button"
                    onClick={() => selectMeeting(mtg.id)}
                    className={`w-full rounded-xl px-3 py-2.5 text-left transition-all ${
                      isSelected
                        ? "border border-white/[0.14] bg-white/[0.1] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]"
                        : "border border-transparent text-slate-300/80 hover:bg-white/[0.05] hover:text-white"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-medium">{mtg.title}</span>
                      <span
                        className={`shrink-0 font-mono text-[10px] tabular-nums ${
                          health.tone === "healthy"
                            ? "text-[#5eead4]"
                            : health.tone === "warning"
                            ? "text-amber-300"
                            : "text-rose-300"
                        }`}
                      >
                        {health.score}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center justify-between font-mono text-[10px] text-slate-400 tabular-nums">
                      <span>
                        {mtg.date} · {mtg.duration}
                      </span>
                      {pending > 0 && <span className="text-amber-300">{pending} check</span>}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Team Roster */}
            <div className="mt-6 border-t border-white/[0.08] px-2 pt-4">
              <div className="font-mono text-[11px] text-slate-400">Team Roster</div>
              <div className="mt-2.5 space-y-2">
                {state.people.map((person) => (
                  <div key={person.id} className="flex items-center justify-between text-xs">
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-white/[0.12] font-mono text-[10px] font-semibold"
                        style={{
                          backgroundColor: `${person.accentHex}24`,
                          color: person.accentHex,
                        }}
                      >
                        {person.initials}
                      </span>
                      <span className="truncate text-slate-200">{person.name}</span>
                    </div>
                    <span className="shrink-0 font-mono text-[10px] text-slate-400">
                      {person.role}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Footer Storage Badge, Reset & Mock Mode */}
          <div className="space-y-2.5 border-t border-white/[0.08] px-4 py-3.5">
            <button
              type="button"
              onClick={() =>
                setActiveView(dbStatus.mode === "supabase" ? "check" : "settings")
              }
              className={`flex w-full items-center justify-between rounded-lg border px-2.5 py-1.5 font-mono text-[10px] transition-colors ${
                dbStatus.mode === "supabase"
                  ? "border-emerald-400/35 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/15"
                  : "border-amber-300/30 bg-amber-400/10 text-amber-200 hover:bg-amber-400/15"
              }`}
              title={dbStatus.message}
            >
              <span className="inline-flex items-center gap-1.5 truncate">
                <Database className="h-3 w-3 shrink-0" />
                {dbStatus.mode === "supabase" ? "Supabase Live" : "Local mode"}
              </span>
              <span className="shrink-0 opacity-80">
                {dbStatus.mode === "supabase" ? "Check" : "Setup"}
              </span>
            </button>

            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] text-slate-400">Offline AI Cache</span>
              <button
                type="button"
                onClick={() => setMockMode((prev) => !prev)}
                aria-pressed={mockMode}
                className={`rounded-lg border px-2 py-0.5 font-mono text-[10px] font-medium transition-colors ${
                  mockMode
                    ? "border-emerald-400/45 bg-emerald-400/18 text-emerald-100"
                    : "border-white/[0.14] text-slate-300 hover:text-white"
                }`}
              >
                Mock: {mockMode ? "ON" : "OFF"}
              </button>
            </div>
            <button
              type="button"
              onClick={() => {
                exitGuidedDemo();
                const reset = resetMeetMindState();
                setState(reset);
                setCurrentSeconds(0);
                setIsPlaying(false);
                setChaosArmed(false);
                setSlackToast(null);
                setRunFeedback(null);
              }}
              className="inline-flex items-center gap-1.5 font-mono text-[11px] text-slate-400 transition-colors hover:text-slate-100"
            >
              <RotateCcw className="h-3 w-3" />
              Reset sample workspace
            </button>
          </div>
        </aside>

        {/* Main Content Area */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Sleek Frosted Top Bar */}
          <header className="sticky top-0 z-20 flex items-center justify-between gap-4 border-b border-white/[0.09] bg-[#091920]/70 px-4 py-3.5 backdrop-blur-xl sm:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={() => setMobileMenuOpen(true)}
                aria-label="Open navigation"
                className="rounded-xl border border-white/[0.14] bg-white/[0.05] p-2 text-slate-200 hover:bg-white/[0.1] lg:hidden"
              >
                <Menu className="h-4 w-4" />
              </button>
              <div className="truncate font-mono text-xs text-slate-300">
                <span className="text-slate-400">MeetMind</span>
                <span className="mx-2 text-slate-500">/</span>
                <span className="text-slate-100">{breadcrumbLabel}</span>
              </div>
            </div>

            {/* Live Search Field */}
            <div className="relative hidden w-full max-w-xs md:block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={globalSearch}
                onChange={(e) => setGlobalSearch(e.target.value)}
                placeholder="Search transcript, items, tickets..."
                aria-label="Search workspace"
                className="glass-inset w-full rounded-xl py-1.5 pl-9 pr-7 text-xs text-slate-100 placeholder:text-slate-400 focus:border-[#5eead4] focus:outline-none"
              />
              {globalSearch && (
                <button
                  type="button"
                  onClick={() => setGlobalSearch("")}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => void startGuidedDemo()}
              title="Start 7-step guided meeting simulation"
              className="btn-glazed-primary inline-flex shrink-0 items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold whitespace-nowrap transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5eead4] focus-visible:ring-offset-2 focus-visible:ring-offset-[#071318]"
            >
              <span>▶ Run the Meeting</span>
            </button>
          </header>

          {/* Inline Execution Feedback Banner */}
          {runFeedback && (
            <div className="border-b border-[#5eead4]/25 bg-[#5eead4]/10 px-4 py-2.5 sm:px-8">
              <div className="mx-auto flex max-w-[1360px] flex-wrap items-center justify-between gap-3 text-xs">
                <span className="text-[#ccfbf1]">{runFeedback.message}</span>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveView("workflow");
                      setRunFeedback(null);
                    }}
                    className="font-mono text-[11px] font-medium text-[#5eead4] underline underline-offset-4 hover:text-white"
                  >
                    Inspect Run Timeline →
                  </button>
                  <button
                    type="button"
                    onClick={() => setRunFeedback(null)}
                    className="text-slate-300 hover:text-white"
                    aria-label="Dismiss notification"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Active View Viewport */}
          <main className="mx-auto w-full max-w-[1360px] flex-1 px-4 py-6 pb-24 sm:px-8 sm:py-8 sm:pb-24">
            {activeView === "meetings" && selectedMeeting && (
              <div className="space-y-6">
                {/* Newest-first Live Meetings List */}
                <MeetingsListPanel
                  meetings={state.meetings}
                  selectedMeetingId={selectedMeeting.id}
                  newlyArrivedMeetingId={newlyArrivedMeetingId}
                  onSelectMeeting={selectMeeting}
                  onRetryMeeting={(id) => void handleRetryMeetingAnalysis(id)}
                  onNewMeetingClick={() => setIngestModal({ open: true, mode: "paste" })}
                  onRecordLiveClick={() => setActiveView("live")}
                />

                {/* =========================================================
                    MEETING DETAIL (STRICT ORDER 1 → 6)
                   ========================================================= */}

                {/* 1. Recording Card (audio player, duration, recorded at, Live badge when running) */}
                <section className="glass-card-elevated space-y-4 rounded-2xl p-5 sm:p-6">
                  <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <span className="font-mono text-[11px] uppercase tracking-wider text-[#5eead4]">
                          1. Recording
                        </span>
                        {(isRunningMeeting ||
                          (selectedMeeting.workflowSnapshot || state.workflow).nodes.some(
                            (n) => n.status === "running"
                          )) && (
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/45 bg-emerald-400/15 px-2.5 py-0.5 font-mono text-[10px] font-semibold text-emerald-200">
                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                            Live
                          </span>
                        )}
                        {selectedMeeting.status === "analyzing" && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-[#a78bfa]/45 bg-[#a78bfa]/15 px-2.5 py-0.5 font-mono text-[10px] text-[#ede9fe]">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            Analyzing
                          </span>
                        )}
                      </div>

                      <h1 className="mt-1 font-serif text-3xl italic tracking-tight text-slate-50 sm:text-4xl">
                        {selectedMeeting.title}
                      </h1>

                      <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-xs text-slate-300/85 tabular-nums">
                        <span className="inline-flex items-center gap-1.5">
                          <Clock className="h-3.5 w-3.5 text-[#5eead4]" />
                          Duration:{" "}
                          {selectedMeeting.durationSeconds > 0 &&
                          selectedMeeting.durationSeconds < 60
                            ? `${selectedMeeting.durationSeconds} sec`
                            : selectedMeeting.duration}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>
                          Recorded at:{" "}
                          {selectedMeeting.createdAt
                            ? new Date(selectedMeeting.createdAt).toLocaleString([], {
                                day: "2-digit",
                                month: "short",
                                hour: "2-digit",
                                minute: "2-digit",
                              })
                            : selectedMeeting.date}
                        </span>
                        {selectedMeeting.language && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="inline-flex items-center gap-1 text-sky-300">
                              <Globe className="h-3.5 w-3.5" />
                              {selectedMeeting.language}
                            </span>
                          </>
                        )}
                        {speakerNames && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-slate-100">Speakers: {speakerNames}</span>
                          </>
                        )}
                      </div>
                    </div>

                    {selectedMeetingAudioUrl && (
                      <div className="flex flex-col items-start gap-1 lg:items-end">
                        <span className="font-mono text-[10px] text-slate-400">
                          Audio Recording Playback
                        </span>
                        <audio
                          controls
                          src={selectedMeetingAudioUrl}
                          className="h-9 w-full max-w-xs"
                        />
                      </div>
                    )}
                  </div>

                  {selectedMeeting.status === "failed" && (
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-400/45 bg-rose-500/14 px-4 py-3 text-xs text-rose-100">
                      <div className="flex items-center gap-2.5">
                        <AlertCircle className="h-4 w-4 shrink-0 text-rose-300" />
                        <span>
                          Meeting analysis failed:{" "}
                          {selectedMeeting.analysisError || "Could not analyze audio recording."}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleRetryMeetingAnalysis(selectedMeeting.id)}
                        className="btn-crimson-tactile inline-flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 font-mono text-xs font-semibold"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        Retry Analysis
                      </button>
                    </div>
                  )}

                  {/* Waveform + Consent + Analyze/Ingest Strip */}
                  <Waveform
                    durationSeconds={selectedMeeting.durationSeconds}
                    currentSeconds={currentSeconds}
                    isPlaying={isPlaying}
                    onTogglePlay={() => setIsPlaying((prev) => !prev)}
                    onSeek={(sec) => setCurrentSeconds(sec)}
                    segments={selectedMeeting.segments}
                    people={state.people}
                  />

                  <div className="flex flex-col justify-between gap-3 border-t border-white/[0.08] pt-3.5 md:flex-row md:items-center">
                    <label className="flex cursor-pointer items-center gap-2.5 text-xs text-slate-100">
                      <input
                        type="checkbox"
                        checked={consentAccepted}
                        onChange={(e) => {
                          setConsentAccepted(e.target.checked);
                          saveRememberedOrbConsent(e.target.checked);
                          if (e.target.checked) setExtractError(null);
                        }}
                        className="h-4 w-4 rounded border-white/25 bg-[#071318] accent-[#5eead4]"
                      />
                      <ShieldCheck className="h-4 w-4 shrink-0 text-[#5eead4]" />
                      <span>Audio is processed once and not stored.</span>
                    </label>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setIngestModal({ open: true, mode: "paste" })}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-white/[0.12] bg-white/[0.05] px-3.5 py-1.5 text-xs font-medium text-slate-100 whitespace-nowrap transition-colors hover:bg-white/[0.1]"
                      >
                        <FileText className="h-3.5 w-3.5 text-slate-300" />
                        Paste your own transcript
                      </button>
                      <button
                        type="button"
                        onClick={() => setIngestModal({ open: true, mode: "audio" })}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-white/[0.12] bg-white/[0.05] px-3.5 py-1.5 text-xs font-medium text-slate-100 whitespace-nowrap transition-colors hover:bg-white/[0.1]"
                      >
                        <FileAudio className="h-3.5 w-3.5 text-slate-300" />
                        Upload audio
                      </button>
                      <button
                        type="button"
                        onClick={handleAnalyzeWithGemini}
                        disabled={isExtracting || !consentAccepted}
                        title={
                          !consentAccepted
                            ? "Confirm consent checkbox before analyzing"
                            : "Extract structured items with Gemini"
                        }
                        className="btn-glazed-primary inline-flex shrink-0 items-center gap-1.5 rounded-xl px-4 py-1.5 text-xs font-semibold whitespace-nowrap transition-all disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        {isExtracting ? "Analyzing..." : "Analyze"}
                      </button>
                    </div>
                  </div>
                </section>

                {/* 2. Summary + Health & Pre-Meeting Brief */}
                <section className="space-y-4">
                  <div className="glass-card rounded-2xl p-5">
                    <div className="font-mono text-[11px] uppercase tracking-wider text-[#5eead4]">
                      2. Summary
                    </div>
                    <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-slate-100">
                      {selectedMeeting.summary ||
                        "Summary will appear here once analysis completes."}
                    </p>
                  </div>

                  <div className="grid grid-cols-1 gap-4 xl:grid-cols-12 xl:items-stretch">
                    <div className="xl:col-span-5">
                      <MeetingHealthRing health={computeMeetingHealth(selectedMeeting)} />
                    </div>
                    <div className="xl:col-span-7">
                      <PreMeetingBriefCard
                        nextMeetingTitle={selectedMeeting.title}
                        lines={briefLines}
                        generatedAt={briefGeneratedAt}
                        isLoading={isLoadingBrief}
                        error={briefError}
                        mockMode={mockMode}
                        onRefresh={() => void handleGenerateBrief()}
                      />
                    </div>
                  </div>
                </section>

                {/* 3. Transcript + 4. Extracted Items Grouped by Type */}
                <section className="grid grid-cols-1 gap-6 xl:grid-cols-12 xl:items-start">
                  <div className="space-y-2 xl:col-span-7">
                    <div className="font-mono text-[11px] uppercase tracking-wider text-[#5eead4]">
                      3. Transcript
                    </div>
                    <Transcript
                      segments={selectedMeeting.segments}
                      people={state.people}
                      extractedItems={selectedMeeting.extractedItems}
                      currentSeconds={currentSeconds}
                      highlightedSegmentId={highlightedSegmentId}
                      highlightedQuote={highlightedQuote}
                      highlightNonce={highlightNonce}
                      revealedSegmentCount={revealedSegmentCount}
                      activeTypingProgress={activeTypingProgress}
                      searchQuery={globalSearch}
                      onSeekToSegment={(seg: Segment) => {
                        setCurrentSeconds(seg.seconds);
                        setHighlightedSegmentId(seg.id);
                        setHighlightedQuote(null);
                        setHighlightNonce((n) => n + 1);
                      }}
                    />
                  </div>

                  <div className="space-y-2 xl:col-span-5">
                    <div className="font-mono text-[11px] uppercase tracking-wider text-[#5eead4]">
                      4. Extracted Items &amp; Confirmation
                    </div>
                    <ExtractedPanel
                      items={selectedMeeting.extractedItems}
                      people={state.people}
                      consentAccepted={consentAccepted}
                      isExtracting={isExtracting}
                      extractError={extractError}
                      visibleExtractCount={visibleExtractCount}
                      showConfirmationTray={showConfirmationTray}
                      searchQuery={globalSearch}
                      onJumpToQuote={handleJumpToQuote}
                      onResolveAmbiguity={handleResolveAmbiguity}
                      onDismissAmbiguity={handleDismissAmbiguity}
                      onAnalyzeWithGemini={handleAnalyzeWithGemini}
                    />
                  </div>
                </section>

                {/* 5. Execution Plan + Human-Permission Tool Actions & Live Log */}
                <section className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-mono text-[11px] uppercase tracking-wider text-[#5eead4]">
                      5. Execution Plan &amp; Tool Permissions
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveView("workflow")}
                      className="inline-flex items-center gap-1 font-mono text-[11px] text-[#5eead4] hover:underline"
                    >
                      Open Full Run Timeline
                      <ArrowRight className="h-3 w-3" />
                    </button>
                  </div>

                  {/* Numbered Human-Readable Execution Plan */}
                  <div className="glass-card rounded-2xl p-5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className="font-serif text-xl italic text-slate-50">
                          Execution Plan
                        </h3>
                        <p className="mt-0.5 text-xs text-slate-300/80">
                          Ordered actions showing who does what, dependencies, and real-time step status.
                        </p>
                      </div>
                    </div>

                    {!selectedMeeting.executionPlan ||
                    selectedMeeting.executionPlan.length === 0 ? (
                      <div className="mt-4 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-5 text-center text-xs text-slate-400">
                        Use Draft with AI below or Plan Tool Actions to build an ordered execution plan for this meeting.
                      </div>
                    ) : (
                      <ol className="mt-4 space-y-2.5">
                        {selectedMeeting.executionPlan.map((step: ExecutionPlanStep) => {
                          const badge = getPlanToolBadgeMeta(step.tool);
                          const BadgeIcon = badge.icon;
                          return (
                            <li
                              key={step.id}
                              className="glass-inset flex flex-col justify-between gap-3 rounded-xl p-3.5 sm:flex-row sm:items-center"
                            >
                              <div className="flex items-start gap-3">
                                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[#5eead4]/40 bg-[#5eead4]/15 font-mono text-xs font-bold text-[#99f6e4]">
                                  {step.stepNumber}
                                </span>
                                <div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-sm font-semibold text-slate-50">
                                      {step.title}
                                    </span>
                                    <span className="font-mono text-[11px] text-slate-300">
                                      · Owner: {step.owner}
                                    </span>
                                  </div>
                                  <p className="mt-0.5 text-xs leading-relaxed text-slate-300/85">
                                    {step.description}
                                  </p>
                                  {step.dependsOn.length > 0 && (
                                    <div className="mt-1 font-mono text-[10px] text-amber-300/90">
                                      Depends on: {step.dependsOn.join(", ")}
                                    </div>
                                  )}
                                </div>
                              </div>

                              <div className="flex shrink-0 items-center gap-2">
                                <span
                                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 font-mono text-[11px] font-medium ${badge.cls}`}
                                >
                                  <BadgeIcon className="h-3.5 w-3.5" />
                                  {step.tool}
                                </span>
                                <span
                                  className={`rounded-lg border px-2.5 py-1 font-mono text-[10px] ${
                                    step.status === "done"
                                      ? "border-emerald-400/40 bg-emerald-400/15 text-emerald-200"
                                      : step.status === "failed"
                                      ? "border-rose-400/45 bg-rose-500/15 text-rose-200"
                                      : step.status === "waiting"
                                      ? "border-amber-300/40 bg-amber-400/15 text-amber-200"
                                      : "border-white/[0.12] bg-white/[0.05] text-slate-300"
                                  }`}
                                >
                                  {step.status}
                                </span>
                              </div>
                            </li>
                          );
                        })}
                      </ol>
                    )}
                  </div>

                  {/* Permission Cards + Google Workspace / Slides / .pptx + Live Log */}
                  <ToolExecutionPanel
                    meeting={selectedMeeting}
                    people={state.people}
                    settings={settings}
                    googleSession={googleSession}
                    plannedActions={selectedMeeting.plannedActions || []}
                    idempotencyLedger={state.idempotencyLedger}
                    duplicatesBlockedTotal={state.duplicatesBlockedTotal}
                    mockMode={mockMode}
                    isPlanningTools={isPlanningMeetingTools}
                    onPlanToolsWithGemini={() =>
                      handlePlanToolsForSelectedMeeting(selectedMeeting)
                    }
                    onUpdateActions={(nextActions) =>
                      handleUpdateLiveMeeting({
                        ...selectedMeeting,
                        plannedActions: nextActions,
                      })
                    }
                    onUpdateMeetingData={(patch) =>
                      handleUpdateMeetingData(selectedMeeting.id, patch)
                    }
                    onToggleTestMode={handleToggleTestMode}
                    onSyncWorkflowNode={(input) =>
                      handleSyncWorkflowNode(selectedMeeting.id, input)
                    }
                    onCreateTicketFromTool={handleCreateTicketFromTool}
                    onRecordIdempotency={handleRecordIdempotency}
                    onToast={showToast}
                    onOpenSettings={() => setActiveView("settings")}
                    onReconnectGoogle={handleConnectGoogle}
                  />
                </section>

                {/* 6. Embedded Live Workflow Canvas */}
                <section className="space-y-2">
                  <div className="font-mono text-[11px] uppercase tracking-wider text-[#5eead4]">
                    6. Workflow Canvas (Live Status)
                  </div>
                  <WorkflowCanvas
                    embedded
                    workflow={selectedMeeting.workflowSnapshot || state.workflow}
                    activeMeeting={selectedMeeting}
                    people={state.people}
                    isRunning={isRunningMeeting}
                    chaosArmed={chaosArmed}
                    duplicatesBlockedTotal={state.duplicatesBlockedTotal}
                    mockMode={mockMode}
                    demoStaggerNonce={demoStaggerNonce}
                    demoDryRunActive={demoDryRunActive}
                    onToggleChaos={handleToggleChaos}
                    onApproveAndRun={async () => {
                      await handleRunMeeting();
                    }}
                    onResumeFailed={() => handleResumeFailedWorkflow(selectedMeeting.id)}
                    onReplaceWorkflow={(nodes: WorkflowNode[], edges) => {
                      const nextWf = {
                        ...(selectedMeeting.workflowSnapshot || state.workflow),
                        nodes,
                        edges,
                      };
                      setState((prev) => ({
                        ...prev,
                        workflow: nextWf,
                        meetings: prev.meetings.map((m) =>
                          m.id === selectedMeeting.id
                            ? { ...m, workflowSnapshot: nextWf }
                            : m
                        ),
                      }));
                      void updateMeetingRecord({
                        ...selectedMeeting,
                        workflowSnapshot: nextWf,
                      });
                    }}
                    onUpdateNodes={(nodes: WorkflowNode[]) => {
                      const baseWf = selectedMeeting.workflowSnapshot || state.workflow;
                      const nextWf = { ...baseWf, nodes };
                      setState((prev) => ({
                        ...prev,
                        workflow: nextWf,
                        meetings: prev.meetings.map((m) =>
                          m.id === selectedMeeting.id
                            ? { ...m, workflowSnapshot: nextWf }
                            : m
                        ),
                      }));
                    }}
                  />
                </section>
              </div>
            )}

            {activeView === "live" && (
              <LiveRecordView
                people={state.people}
                settings={settings}
                mockMode={mockMode}
                consentAccepted={consentAccepted}
                activeLiveMeeting={activeLiveMeeting}
                googleSession={googleSession}
                idempotencyLedger={state.idempotencyLedger}
                duplicatesBlockedTotal={state.duplicatesBlockedTotal}
                onToggleConsent={(checked) => {
                  setConsentAccepted(checked);
                  saveRememberedOrbConsent(checked);
                }}
                onProcessAudioCapture={async (capture) => {
                  await runAudioAnalysisPipeline({
                    blob: capture.blob,
                    durationSec: capture.durationSec,
                    title: capture.title,
                    mimeType: capture.mimeType,
                    fromOrb: false,
                  });
                }}
                onRetryMeeting={handleRetryMeetingAnalysis}
                onUpdateLiveMeeting={handleUpdateLiveMeeting}
                onResolveAmbiguity={handleResolveAmbiguityForMeeting}
                onDismissAmbiguity={handleDismissAmbiguityForMeeting}
                onCreateTicketFromTool={handleCreateTicketFromTool}
                onRecordIdempotency={handleRecordIdempotency}
                onToast={showToast}
                onOpenSettings={() => setActiveView("settings")}
                onOpenWorkflow={() => setActiveView("workflow")}
                onReconnectGoogle={handleConnectGoogle}
                onToggleTestMode={handleToggleTestMode}
                onSyncWorkflowNode={handleSyncWorkflowNode}
              />
            )}

            {activeView === "history" && (
              <HistoryView
                meetings={state.meetings}
                dbStatus={dbStatus}
                onOpenMeeting={selectMeeting}
                onRetryMeeting={handleRetryMeetingAnalysis}
                onGoToLiveRecord={() => setActiveView("live")}
                onSyncFromSupabase={() => mergeWorkspaceFromSupabase(false)}
              />
            )}

            {activeView === "check" && (
              <SystemCheckView
                dbStatus={dbStatus}
                onOpenSettings={() => setActiveView("settings")}
              />
            )}

            {activeView === "settings" && (
              <SettingsView
                settings={settings}
                mockMode={mockMode}
                dbStatus={dbStatus}
                googleSession={googleSession}
                onSaveSettings={handleSaveSettings}
                onToggleMockMode={() => setMockMode((prev) => !prev)}
                onConnectGoogle={handleConnectGoogle}
                onDisconnectGoogle={handleDisconnectGoogle}
                onOpenSystemCheck={() => setActiveView("check")}
              />
            )}

          {activeView === "workflow" && (
            <div className="space-y-10">
              <WorkflowCanvas
                workflow={state.workflow}
                activeMeeting={selectedMeeting}
                people={state.people}
                isRunning={isRunningMeeting}
                chaosArmed={chaosArmed}
                duplicatesBlockedTotal={state.duplicatesBlockedTotal}
                mockMode={mockMode}
                demoStaggerNonce={demoStaggerNonce}
                demoDryRunActive={demoDryRunActive}
                onToggleChaos={handleToggleChaos}
                onApproveAndRun={async () => {
                  await handleRunMeeting();
                }}
                onResumeFailed={() =>
                  selectedMeeting && handleResumeFailedWorkflow(selectedMeeting.id)
                }
                onReplaceWorkflow={(nodes: WorkflowNode[], edges) =>
                  setState((prev) => ({
                    ...prev,
                    workflow: {
                      ...prev.workflow,
                      nodes,
                      edges,
                    },
                  }))
                }
                onUpdateNodes={(nodes: WorkflowNode[]) =>
                  setState((prev) => ({
                    ...prev,
                    workflow: {
                      ...prev.workflow,
                      nodes,
                    },
                  }))
                }
              />

              <RunTimeline
                runs={state.runs}
                duplicatesBlockedTotal={state.duplicatesBlockedTotal}
                chaosArmed={chaosArmed}
                isRunning={isRunningMeeting}
                onToggleChaos={handleToggleChaos}
                onSelectMeeting={selectMeeting}
                onApproveStep={handleApproveStep}
                onOpenGmailStep={handleOpenGmailStep}
                onFastForwardWaitStep={handleFastForwardWaitStep}
                onResumeRun={handleResumeRun}
                onReplayFromStep={handleReplayFromStep}
              />
            </div>
          )}

          {activeView === "tickets" && (
            <TicketsBoard
              tickets={state.tickets}
              people={state.people}
              meetings={state.meetings}
              externalQuery={globalSearch}
              onJumpToMeetingQuote={handleJumpFromBoardOrLedger}
              onUpdateTicketStatus={(ticketId: string, status: TicketStatus) => {
                setState((prev) => {
                  const nextTickets = prev.tickets.map((t) => {
                    if (t.id !== ticketId) return t;
                    const updated = { ...t, status };
                    void updateTicketRow(updated, prev.people);
                    return updated;
                  });
                  return { ...prev, tickets: nextTickets };
                });
                publishWorkspaceEvent({ type: "ticket_upserted", ticketId });
              }}
              onAssignTicket={(ticketId: string, assigneeId: string | null) => {
                setState((prev) => {
                  const nextTickets = prev.tickets.map((t) => {
                    if (t.id !== ticketId) return t;
                    const updated = {
                      ...t,
                      assigneeId,
                      status:
                        assigneeId && t.status === "Blocked" ? "In Progress" : t.status,
                    };
                    void updateTicketRow(updated, prev.people);
                    return updated;
                  });
                  return { ...prev, tickets: nextTickets };
                });
                publishWorkspaceEvent({ type: "ticket_upserted", ticketId });
              }}
              onCreateTicket={(input: {
                title: string;
                priority: TicketPriority;
                assigneeId: string | null;
                dueDate: string;
              }) => {
                const newTicketId = `tkt_${Date.now()}`;
                setState((prev) => {
                  const newTicket: Ticket = {
                    id: newTicketId,
                    key: `TCK-${prev.nextTicketNumber}`,
                    title: input.title,
                    description: "Created from Tickets Board.",
                    status: "Backlog",
                    priority: input.priority,
                    assigneeId: input.assigneeId,
                    dueDate: input.dueDate,
                    meetingId: selectedMeeting?.id || "",
                    segmentId: "",
                    sourceKind: "Action",
                    sourceItemId: `board_${newTicketId}`,
                  };
                  if (selectedMeeting) {
                    void upsertTicketsAndPromises(
                      selectedMeeting,
                      [newTicket],
                      [],
                      prev.people
                    );
                  }
                  return {
                    ...prev,
                    nextTicketNumber: prev.nextTicketNumber + 1,
                    tickets: [newTicket, ...prev.tickets],
                  };
                });
                publishWorkspaceEvent({ type: "ticket_upserted", ticketId: newTicketId });
              }}
            />
          )}

          {activeView === "promises" && (
            <PromiseLedger
              promises={state.promises}
              people={state.people}
              meetings={state.meetings}
              nextMeetingTitle={selectedMeeting?.title || "Acme weekly sync"}
              briefLines={briefLines}
              briefGeneratedAt={briefGeneratedAt}
              isLoadingBrief={isLoadingBrief}
              briefError={briefError}
              mockMode={mockMode}
              externalQuery={globalSearch}
              onRefreshBrief={() => void handleGenerateBrief()}
              onJumpToMeetingQuote={handleJumpFromBoardOrLedger}
              onAssignPromiseOwner={(promiseId: string, ownerId: string) => {
                setState((prev) => {
                  const nextPromises = prev.promises.map((p) => {
                    if (p.id !== promiseId) return p;
                    const updated = {
                      ...p,
                      ownerId,
                      confidence: Math.max(p.confidence, 0.92),
                      status: p.status === "At Risk" ? ("Open" as PromiseStatus) : p.status,
                    };
                    void updatePromiseRow(updated, prev.people);
                    return updated;
                  });
                  return { ...prev, promises: nextPromises };
                });
                publishWorkspaceEvent({ type: "promise_upserted", promiseId });
              }}
              onUpdatePromiseStatus={(promiseId: string, status: PromiseStatus) => {
                setState((prev) => {
                  const nextPromises = prev.promises.map((p) => {
                    if (p.id !== promiseId) return p;
                    const updated = { ...p, status };
                    void updatePromiseRow(updated, prev.people);
                    return updated;
                  });
                  return { ...prev, promises: nextPromises };
                });
                publishWorkspaceEvent({ type: "promise_upserted", promiseId });
              }}
            />
          )}
        </main>
      </div>
    </div>

      <NewMeetingModal
        isOpen={ingestModal.open}
        initialMode={ingestModal.mode}
        people={state.people}
        consentAccepted={consentAccepted}
        onToggleConsent={setConsentAccepted}
        onClose={() => setIngestModal((prev) => ({ ...prev, open: false }))}
        onCreateMeeting={handleCreateNewMeeting}
      />

      <PresenterControlsBar
        demoActive={demoActive}
        demoStep={demoStep}
        demoStepLabel={demoStepLabel}
        awaitingChaosClick={awaitingChaosClick}
        chaosArmed={chaosArmed}
        mockMode={mockMode}
        onToggleMockMode={() => setMockMode((prev) => !prev)}
        onNextStep={() => {
          if (chaosDecisionResolverRef.current) {
            chaosDecisionResolverRef.current();
            return;
          }
          if (skipWaitResolverRef.current) {
            skipWaitResolverRef.current();
            return;
          }
          if (demoStep >= 7) {
            exitGuidedDemo();
          }
        }}
        onRestartDemo={() => void startGuidedDemo()}
        onTriggerBreakIt={() => {
          setChaosArmed(true);
          chaosArmedRef.current = true;
          if (chaosDecisionResolverRef.current) {
            chaosDecisionResolverRef.current();
          }
        }}
        onCloseDemo={exitGuidedDemo}
      />

      {slackToast && (
        <div
          role="status"
          aria-live="polite"
          className={`fade-slide-up glass-card-elevated fixed right-5 z-[9998] w-full max-w-sm rounded-2xl p-4 shadow-2xl ${
            demoActive ? "top-16" : "bottom-24"
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <MessageSquareText className="h-4 w-4 text-[#5eead4]" />
              <span className="font-mono text-xs font-semibold text-[#ccfbf1]">
                {slackToast.title}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setSlackToast(null)}
              aria-label="Close notification"
              className="rounded-lg p-0.5 text-slate-300 hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-slate-100">
            {slackToast.message}
          </p>
          {slackToast.actionLabel && slackToast.onAction && (
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  const fn = slackToast.onAction;
                  setSlackToast(null);
                  fn?.();
                }}
                className="btn-glazed-primary rounded-lg px-3 py-1 font-mono text-[11px] font-semibold"
              >
                {slackToast.actionLabel}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Global Floating Recorder Orb rendered at root layout above every page */}
      <RecorderOrb
        orbState={orbState}
        elapsedSec={orbElapsedSec}
        waveLevels={orbWaveLevels}
        errorText={orbErrorText}
        consentAccepted={consentAccepted}
        onConfirmConsent={(remember) => {
          setConsentAccepted(true);
          saveRememberedOrbConsent(remember);
        }}
        onStartRecording={startOrbRecording}
        onStopRecording={stopOrbRecording}
      />
    </div>
  );
}
