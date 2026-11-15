import {
  AlertCircle,
  ArrowRight,
  Calendar,
  Check,
  CheckSquare,
  Clock,
  FileAudio,
  GitBranch,
  Globe,
  Loader2,
  Mail,
  MessageSquare,
  Mic,
  Presentation,
  Quote,
  ShieldCheck,
  Sparkles,
  Square,
  Upload,
  Webhook,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getSignedAudioUrl } from "../lib/db";
import type {
  AppSettings,
  ExecutionPlanStep,
  ExecutionToolBadge,
  ExtractedItem,
  IdempotencyRecord,
  Meeting,
  NodeExecutionStatus,
  Person,
  PlannedToolAction,
  PlannedToolName,
  Segment,
  TicketPriority,
} from "../types/meetmind";
import { getAudioBlob } from "../utils/audioStore";
import type { GoogleAuthSession } from "../utils/googleAuth";
import {
  buildMockCustomConnectorActions,
  buildPlannedActionsFromFunctionCalls,
  formatMmSs,
} from "../utils/liveProcessor";
import { buildMockPlannedToolActions } from "../data/mockGeminiResponses";
import { ToolExecutionPanel } from "./ToolExecutionPanel";
import { Transcript } from "./Transcript";

interface LiveRecordViewProps {
  people: Person[];
  settings: AppSettings;
  mockMode: boolean;
  consentAccepted: boolean;
  activeLiveMeeting: Meeting | null;
  googleSession: GoogleAuthSession | null;
  idempotencyLedger: Record<string, IdempotencyRecord>;
  duplicatesBlockedTotal: number;
  onToggleConsent: (accepted: boolean) => void;
  onProcessAudioCapture: (input: {
    blob: Blob | null;
    durationSec: number;
    title: string;
    mimeType: string;
  }) => Promise<void>;
  onRetryMeeting: (meetingId: string) => Promise<void>;
  onUpdateLiveMeeting: (meeting: Meeting) => void;
  onResolveAmbiguity: (meetingId: string, itemId: string, personId: string) => void;
  onDismissAmbiguity: (meetingId: string, itemId: string) => void;
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
  onOpenWorkflow: () => void;
  onReconnectGoogle: () => Promise<void>;
  onToggleTestMode: () => void;
  onSyncWorkflowNode?: (
    meetingId: string,
    input: {
      toolName: PlannedToolName;
      status: NodeExecutionStatus;
      completedAt?: string;
      errorMessage?: string;
    }
  ) => void;
}

const WAVE_BARS = 36;

function getToolBadgeMeta(tool: ExecutionToolBadge) {
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

export function LiveRecordView({
  people,
  settings,
  mockMode,
  consentAccepted,
  activeLiveMeeting,
  googleSession,
  idempotencyLedger,
  duplicatesBlockedTotal,
  onToggleConsent,
  onProcessAudioCapture,
  onRetryMeeting,
  onUpdateLiveMeeting,
  onResolveAmbiguity,
  onDismissAmbiguity,
  onCreateTicketFromTool,
  onRecordIdempotency,
  onToast,
  onOpenSettings,
  onOpenWorkflow,
  onReconnectGoogle,
  onToggleTestMode,
  onSyncWorkflowNode,
}: LiveRecordViewProps) {
  const [meetingTitle, setMeetingTitle] = useState("Live Client Sync");
  const [isRecording, setIsRecording] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [capturedDurationSec, setCapturedDurationSec] = useState<number | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioMimeType, setAudioMimeType] = useState<string>("audio/webm");
  const [audioFileName, setAudioFileName] = useState<string | null>(null);
  const [waveLevels, setWaveLevels] = useState<number[]>(() =>
    Array.from({ length: WAVE_BARS }, () => 0.14)
  );

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isPlanningTools, setIsPlanningTools] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Transcript highlight & quote jump state
  const [highlightedSegmentId, setHighlightedSegmentId] = useState<string | null>(null);
  const [highlightedQuote, setHighlightedQuote] = useState<string | null>(null);
  const [highlightNonce, setHighlightNonce] = useState(0);
  const [currentPlayheadSec, setCurrentPlayheadSec] = useState(0);

  const [savedAudioPlayUrl, setSavedAudioPlayUrl] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const recordStartMsRef = useRef<number>(0);
  const chunksRef = useRef<BlobPart[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const cleanupRecordingHandles = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      cleanupRecordingHandles();
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, []);

  // Load saved audio for activeLiveMeeting from IndexedDB or Supabase Storage signed URL
  useEffect(() => {
    let revokedObjUrl: string | null = null;
    let cancelled = false;

    const loadPlayback = async () => {
      if (!activeLiveMeeting) {
        setSavedAudioPlayUrl(null);
        return;
      }
      const localBlob = await getAudioBlob(activeLiveMeeting.id);
      if (cancelled) return;
      if (localBlob) {
        revokedObjUrl = URL.createObjectURL(localBlob);
        setSavedAudioPlayUrl(revokedObjUrl);
        return;
      }
      if (activeLiveMeeting.audioPath) {
        const signed = await getSignedAudioUrl(activeLiveMeeting.audioPath);
        if (!cancelled) setSavedAudioPlayUrl(signed);
        return;
      }
      setSavedAudioPlayUrl(null);
    };

    void loadPlayback();
    return () => {
      cancelled = true;
      if (revokedObjUrl) URL.revokeObjectURL(revokedObjUrl);
    };
  }, [activeLiveMeeting?.id, activeLiveMeeting?.audioPath]);

  const startRecording = async () => {
    setErrorMsg(null);
    if (!consentAccepted) {
      setErrorMsg('Please confirm "Audio is processed once and not stored." before recording.');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setErrorMsg("Microphone MediaRecorder is not supported in this browser. Use Upload audio file instead.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

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

      chunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          chunksRef.current.push(ev.data);
        }
      };

      recorder.onstop = () => {
        const finalSec = Math.max(
          1,
          Math.round((Date.now() - recordStartMsRef.current) / 1000)
        );
        const mime = recorder.mimeType || supportedMime || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: mime });
        if (audioUrl) URL.revokeObjectURL(audioUrl);
        const nextUrl = URL.createObjectURL(blob);

        setAudioBlob(blob);
        setAudioMimeType(mime);
        setAudioUrl(nextUrl);
        setAudioFileName(null);
        setCapturedDurationSec(finalSec);
        setElapsedSec(finalSec);
        setWaveLevels(Array.from({ length: WAVE_BARS }, () => 0.14));
        cleanupRecordingHandles();
      };

      // Live Web Audio API AnalyserNode for real-time waveform
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audioCtx = new AudioCtx();
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 128;
      source.connect(analyser);

      const dataArr = new Uint8Array(analyser.frequencyBinCount);
      const updateWave = () => {
        analyser.getByteFrequencyData(dataArr);
        const nextBars: number[] = [];
        const step = Math.max(1, Math.floor(dataArr.length / WAVE_BARS));
        for (let i = 0; i < WAVE_BARS; i++) {
          const val = dataArr[Math.min(dataArr.length - 1, i * step)] / 255;
          nextBars.push(Math.max(0.12, Math.min(1, val * 1.15)));
        }
        setWaveLevels(nextBars);
        rafRef.current = requestAnimationFrame(updateWave);
      };
      rafRef.current = requestAnimationFrame(updateWave);

      recordStartMsRef.current = Date.now();
      setElapsedSec(0);
      setCapturedDurationSec(null);
      timerRef.current = window.setInterval(() => {
        setElapsedSec(Math.floor((Date.now() - recordStartMsRef.current) / 1000));
      }, 200);

      recorder.start(250);
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
    } catch (err) {
      cleanupRecordingHandles();
      setErrorMsg(
        err instanceof Error
          ? `Microphone error: ${err.message}. Check mic permission or upload an audio file.`
          : "Could not access microphone."
      );
    }
  };

  const stopRecording = () => {
    setIsRecording(false);
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    } else {
      cleanupRecordingHandles();
    }
  };

  const handleUploadFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg(null);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    const nextUrl = URL.createObjectURL(file);
    setAudioBlob(file);
    setAudioMimeType(file.type || "audio/mp3");
    setAudioUrl(nextUrl);
    setAudioFileName(file.name);
    setCapturedDurationSec(null);
  };

  const handlePlanTools = async (targetMeeting: Meeting): Promise<PlannedToolAction[]> => {
    setIsPlanningTools(true);
    const customConnectors = settings.customConnectors || [];
    try {
      if (mockMode) {
        await new Promise((r) => window.setTimeout(r, 220));
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
          roster: people,
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
              people.find((p) => p.id === it.ownerId)?.name ||
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

      return buildPlannedActionsFromFunctionCalls(
        targetMeeting.id,
        data.toolCalls,
        customConnectors
      );
    } catch (err) {
      onToast(
        "Tool Planner Notice",
        err instanceof Error
          ? `${err.message} Using editable fallback tool actions.`
          : "Using editable fallback tool actions."
      );
      return [
        ...buildMockPlannedToolActions(targetMeeting.id, targetMeeting.title),
        ...buildMockCustomConnectorActions(targetMeeting, customConnectors),
      ];
    } finally {
      setIsPlanningTools(false);
    }
  };

  const handleAnalyzeAudio = async () => {
    setErrorMsg(null);
    if (!consentAccepted) {
      setErrorMsg('Please confirm "Audio is processed once and not stored." before analyzing.');
      return;
    }
    if (!audioBlob && !mockMode) {
      setErrorMsg("Record a meeting clip or upload an audio file first.");
      return;
    }

    setIsAnalyzing(true);
    try {
      const durationToUse = Math.max(1, capturedDurationSec || elapsedSec || 12);
      await onProcessAudioCapture({
        blob: audioBlob,
        durationSec: durationToUse,
        title: meetingTitle.trim() || "Live Meeting",
        mimeType: audioMimeType.split(";")[0] || "audio/webm",
      });
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Failed to analyze meeting audio."
      );
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Group extracted items for Section 3 display
  const items = activeLiveMeeting?.extractedItems || [];
  const pendingConfirmation = items.filter((i) => i.needsConfirmation && !i.resolved);

  const groupedSections: Array<{
    title: string;
    accent: string;
    rows: ExtractedItem[];
  }> = [
    {
      title: "Complaints",
      accent: "text-rose-300 border-rose-400/30 bg-rose-500/10",
      rows: items.filter((i) => i.liveCategory === "Complaint" || i.kind === "Complaint"),
    },
    {
      title: "Tasks",
      accent: "text-[#5eead4] border-[#5eead4]/30 bg-[#5eead4]/10",
      rows: items.filter(
        (i) =>
          i.liveCategory === "Task" ||
          i.liveCategory === "Meeting Request" ||
          i.liveCategory === "Presentation Request" ||
          (i.kind === "Action" && i.liveCategory !== "Deadline")
      ),
    },
    {
      title: "Decisions",
      accent: "text-sky-300 border-sky-400/30 bg-sky-500/10",
      rows: items.filter((i) => i.liveCategory === "Decision" || i.kind === "Decision"),
    },
    {
      title: "Commitments",
      accent: "text-emerald-300 border-emerald-400/30 bg-emerald-500/10",
      rows: items.filter((i) => i.liveCategory === "Commit" || i.kind === "Commit"),
    },
    {
      title: "Deadlines",
      accent: "text-amber-300 border-amber-400/30 bg-amber-500/10",
      rows: items.filter((i) => i.liveCategory === "Deadline"),
    },
  ];

  const jumpToQuote = (segmentId: string, quote: string) => {
    const seg = activeLiveMeeting?.segments.find((s) => s.id === segmentId);
    if (seg) setCurrentPlayheadSec(seg.seconds);
    setHighlightedSegmentId(segmentId);
    setHighlightedQuote(quote);
    setHighlightNonce((n) => n + 1);
  };

  return (
    <div className="space-y-6">
      {/* Page Title */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="font-serif text-3xl italic tracking-tight text-slate-50">
            Live Record — New Meeting
          </h1>
          <p className="mt-1 text-xs text-slate-300/80">
            Capture live microphone audio (4s, 15s, or full meetings) or upload an audio file. Gemini transcribes Hindi, English & Hinglish and builds your execution plan.
          </p>
        </div>
        {activeLiveMeeting && (
          <button
            type="button"
            onClick={onOpenWorkflow}
            className="btn-glazed-soft inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3.5 py-2 font-mono text-xs font-medium"
          >
            <GitBranch className="h-3.5 w-3.5" />
            View Drafted Workflow
          </button>
        )}
      </div>

      {/* Consent Banner + Title Input */}
      <div className="glass-card space-y-4 rounded-2xl p-5">
        <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
          <label className="flex cursor-pointer items-center gap-2.5 text-xs text-slate-100">
            <input
              type="checkbox"
              checked={consentAccepted}
              onChange={(e) => {
                onToggleConsent(e.target.checked);
                if (e.target.checked) setErrorMsg(null);
              }}
              className="h-4 w-4 rounded border-white/25 bg-[#071318] accent-[#5eead4]"
            />
            <ShieldCheck className="h-4 w-4 shrink-0 text-[#5eead4]" />
            <span>
              Audio is processed once and not stored.{" "}
              <span className="text-rose-300">*Required</span>
            </span>
          </label>

          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] text-slate-400">Title:</span>
            <input
              type="text"
              value={meetingTitle}
              onChange={(e) => setMeetingTitle(e.target.value)}
              placeholder="Live Client Sync"
              className="glass-inset w-56 rounded-xl px-3 py-1.5 text-xs text-slate-100 focus:border-[#5eead4] focus:outline-none"
            />
          </div>
        </div>

        {/* Big Mic Recorder + Live Waveform + Upload */}
        <div className="glass-inset rounded-2xl p-5">
          <div className="flex flex-col items-center justify-between gap-6 lg:flex-row">
            {/* Big Record / Stop Button */}
            <div className="flex items-center gap-4">
              {!isRecording ? (
                <button
                  type="button"
                  onClick={() => void startRecording()}
                  className="btn-crimson-tactile flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl transition-transform active:scale-95"
                  aria-label="Start live recording"
                >
                  <Mic className="h-7 w-7" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={stopRecording}
                  className="flex h-16 w-16 shrink-0 animate-pulse items-center justify-center rounded-2xl border border-rose-300/60 bg-rose-500 text-white shadow-[0_0_28px_rgba(244,63,94,0.65)]"
                  aria-label="Stop recording"
                >
                  <Square className="h-6 w-6 fill-current" />
                </button>
              )}

              <div>
                <div className="font-mono text-2xl font-semibold tracking-tight text-slate-50 tabular-nums">
                  {formatMmSs(elapsedSec)}
                </div>
                <div className="mt-0.5 text-xs text-slate-300">
                  {isRecording
                    ? "Listening via microphone (Web Audio Analyser)..."
                    : capturedDurationSec !== null
                    ? `Recording captured: ${formatMmSs(capturedDurationSec)} seconds`
                    : audioFileName
                    ? `Uploaded: ${audioFileName}`
                    : "Click Record to start mic capture, or upload an audio clip"}
                </div>
              </div>
            </div>

            {/* Real-time Web Audio Analyser Waveform */}
            <div
              className="flex h-14 w-full flex-1 items-center justify-center gap-1 rounded-xl border border-white/[0.07] bg-[#061117]/75 px-3 lg:max-w-md"
              aria-hidden="true"
            >
              {waveLevels.map((lvl, idx) => (
                <div
                  key={idx}
                  className={`w-1.5 rounded-full transition-all duration-75 ${
                    isRecording ? "bg-[#5eead4]" : "bg-slate-500/45"
                  }`}
                  style={{ height: `${Math.round(lvl * 44)}px` }}
                />
              ))}
            </div>

            {/* Upload + Analyze Buttons */}
            <div className="flex flex-wrap items-center gap-2.5">
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*,.mp3,.wav,.m4a,.webm,.ogg"
                onChange={handleUploadFile}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isRecording}
                className="inline-flex items-center gap-1.5 rounded-xl border border-white/[0.14] bg-white/[0.05] px-3.5 py-2.5 text-xs font-medium text-slate-100 hover:bg-white/[0.1] disabled:opacity-45"
              >
                <Upload className="h-3.5 w-3.5 text-[#5eead4]" />
                Upload audio file
              </button>

              <button
                type="button"
                onClick={() => void handleAnalyzeAudio()}
                disabled={isRecording || isAnalyzing || (!audioBlob && !mockMode)}
                className="btn-glazed-primary inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-45"
              >
                {isAnalyzing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                {isAnalyzing ? "Analyzing Audio..." : "Analyze Recording"}
              </button>
            </div>
          </div>

          {/* Replay Audio Player after Stop / Upload */}
          {audioUrl && !isRecording && (
            <div className="mt-4 flex flex-col items-start justify-between gap-3 border-t border-white/[0.08] pt-4 sm:flex-row sm:items-center">
              <div className="flex items-center gap-2 font-mono text-xs text-[#99f6e4]">
                <FileAudio className="h-4 w-4 text-[#5eead4]" />
                <span>
                  {capturedDurationSec !== null
                    ? `Recording captured: ${formatMmSs(capturedDurationSec)} seconds`
                    : `Audio ready: ${audioFileName || "clip"}`}
                </span>
              </div>
              <audio
                controls
                src={audioUrl}
                onLoadedMetadata={(e) => {
                  const dur = e.currentTarget.duration;
                  if (Number.isFinite(dur) && dur > 0 && capturedDurationSec === null) {
                    const rounded = Math.max(1, Math.round(dur));
                    setCapturedDurationSec(rounded);
                    setElapsedSec(rounded);
                  }
                }}
                className="h-9 w-full max-w-sm"
              />
            </div>
          )}
        </div>

        {errorMsg && (
          <div className="rounded-xl border border-rose-400/35 bg-rose-500/14 px-4 py-2.5 text-xs text-rose-100">
            {errorMsg}
          </div>
        )}
      </div>

      {/* =====================================================================
          SINGLE-PAGE DISPLAY AFTER ANALYSIS (EXACT ORDER 1 → 5)
          ===================================================================== */}
      {activeLiveMeeting && (
        <div className="space-y-6">
          {activeLiveMeeting.status === "analyzing" && (
            <div className="glass-card flex items-center gap-3 rounded-2xl border border-[#a78bfa]/45 bg-[#a78bfa]/10 px-5 py-3.5 text-xs text-[#ede9fe]">
              <Loader2 className="h-4 w-4 animate-spin text-[#c4b5fd]" />
              <span>
                Analyzing recording in background — feel free to navigate across MeetMind while Gemini extracts transcript, items, tickets &amp; promises.
              </span>
            </div>
          )}

          {activeLiveMeeting.status === "failed" && (
            <div className="glass-card flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-400/45 bg-rose-500/14 px-5 py-3.5 text-xs text-rose-100">
              <div className="flex items-center gap-2.5">
                <AlertCircle className="h-4 w-4 shrink-0 text-rose-300" />
                <span>
                  Analysis failed:{" "}
                  {activeLiveMeeting.analysisError || "Could not complete Gemini analysis."}
                </span>
              </div>
              <button
                type="button"
                onClick={() => void onRetryMeeting(activeLiveMeeting.id)}
                className="btn-crimson-tactile rounded-xl px-3.5 py-1.5 font-mono text-xs font-semibold"
              >
                Retry Analysis
              </button>
            </div>
          )}

          {/* 1) Recording Card */}
          <section className="glass-card-elevated rounded-2xl p-5">
            <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
              <div>
                <div className="font-mono text-[11px] text-[#5eead4]">
                  1. Recording Summary Card
                </div>
                <h2 className="mt-1 font-serif text-2xl italic text-slate-50">
                  {activeLiveMeeting.title}
                </h2>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-slate-300 tabular-nums">
                  <span className="inline-flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5 text-[#5eead4]" />
                    Duration: {activeLiveMeeting.duration} ({activeLiveMeeting.durationSeconds}s)
                  </span>
                  <span>·</span>
                  <span>{activeLiveMeeting.date}</span>
                  <span>·</span>
                  <span className="inline-flex items-center gap-1.5 text-sky-300">
                    <Globe className="h-3.5 w-3.5" />
                    {activeLiveMeeting.language || "English / Hinglish"}
                  </span>
                </div>
              </div>

              {(savedAudioPlayUrl || audioUrl) && (
                <audio
                  controls
                  src={savedAudioPlayUrl || audioUrl || undefined}
                  className="h-9 w-full max-w-xs"
                />
              )}
            </div>
            <p className="mt-3 border-t border-white/[0.08] pt-3 text-xs leading-relaxed text-slate-200/90">
              {activeLiveMeeting.summary}
            </p>
          </section>

          {/* 2) Transcript (speaker + timestamp + text, quote click highlights & scrolls) */}
          <section className="space-y-2">
            <div className="font-mono text-[11px] text-[#5eead4]">
              2. Transcript (English · Hindi · Hinglish Roman Script)
            </div>
            <Transcript
              segments={activeLiveMeeting.segments}
              people={people}
              extractedItems={activeLiveMeeting.extractedItems}
              currentSeconds={currentPlayheadSec}
              highlightedSegmentId={highlightedSegmentId}
              highlightedQuote={highlightedQuote}
              highlightNonce={highlightNonce}
              onSeekToSegment={(seg: Segment) => {
                setCurrentPlayheadSec(seg.seconds);
                setHighlightedSegmentId(seg.id);
                setHighlightedQuote(null);
                setHighlightNonce((n) => n + 1);
              }}
            />
          </section>

          {/* 3) Extracted Items Grouped Cards */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="font-mono text-[11px] text-[#5eead4]">
                3. Extracted Items (Complaints · Tasks · Decisions · Commitments · Deadlines)
              </div>
              <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                {items.length} verified items
              </span>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {groupedSections.map((group) => (
                <div key={group.title} className="glass-card flex flex-col rounded-2xl p-4">
                  <div className="flex items-center justify-between border-b border-white/[0.08] pb-2.5">
                    <span
                      className={`rounded-lg border px-2.5 py-0.5 font-mono text-[11px] font-semibold ${group.accent}`}
                    >
                      {group.title}
                    </span>
                    <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                      {group.rows.length}
                    </span>
                  </div>

                  {group.rows.length === 0 ? (
                    <div className="py-6 text-center text-xs text-slate-400">
                      No {group.title.toLowerCase()} detected in this clip.
                    </div>
                  ) : (
                    <div className="mt-3 space-y-2.5">
                      {group.rows.map((item) => {
                        const owner = people.find((p) => p.id === item.ownerId);
                        return (
                          <div
                            key={item.id}
                            className="glass-inset rounded-xl p-3 text-xs"
                          >
                            <div className="flex items-center justify-between gap-2 font-mono text-[10px]">
                              <span
                                className={
                                  item.priority === "High"
                                    ? "text-rose-300"
                                    : item.priority === "Low"
                                    ? "text-slate-400"
                                    : "text-amber-300"
                                }
                              >
                                {item.priority || "Medium"} priority
                              </span>
                              <span className="text-slate-400 tabular-nums">
                                {Math.round(item.confidence * 100)}% conf
                              </span>
                            </div>
                            <div className="mt-1 font-medium leading-snug text-slate-100">
                              {item.title}
                            </div>
                            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] text-slate-300">
                              <span>
                                {owner ? owner.name : item.rawOwner || "Unowned"} ·{" "}
                                <span className="text-[#5eead4]">{item.dueDate}</span>
                              </span>
                              <button
                                type="button"
                                onClick={() => jumpToQuote(item.segmentId, item.quote)}
                                className="inline-flex items-center gap-1 text-[#5eead4] hover:underline"
                              >
                                <Quote className="h-3 w-3" />
                                quote
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* 4) Existing Resolver: "Needs your confirmation" */}
          <section className="space-y-2">
            <div className="font-mono text-[11px] text-[#5eead4]">
              4. Ambiguity & Low-Confidence Resolver
            </div>
            <div className="glass-card overflow-hidden rounded-2xl border border-amber-300/25">
              <div className="flex items-center justify-between border-b border-white/[0.09] px-5 py-3.5">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-amber-300" />
                  <h3 className="font-serif text-base italic text-slate-50">
                    Needs your confirmation
                  </h3>
                </div>
                <span className="font-mono text-xs text-amber-300 tabular-nums">
                  {pendingConfirmation.length} pending
                </span>
              </div>

              {pendingConfirmation.length === 0 ? (
                <div className="flex items-center gap-2 px-5 py-4 text-xs text-slate-300">
                  <Check className="h-4 w-4 text-emerald-400" />
                  <span>All extracted owners, dates, and low-confidence items are resolved.</span>
                </div>
              ) : (
                <div className="divide-y divide-white/[0.07]">
                  {pendingConfirmation.map((item) => {
                    const candidatePeople =
                      item.ownerCandidates && item.ownerCandidates.length > 0
                        ? people.filter((p) => item.ownerCandidates?.includes(p.id))
                        : people;

                    return (
                      <div key={item.id} className="px-5 py-4">
                        <div className="flex items-center justify-between gap-2 font-mono text-[11px]">
                          <span className="text-amber-300">
                            {item.liveCategory || item.kind} · {item.resolutionStatus}
                          </span>
                          <span className="text-amber-300 tabular-nums">
                            {Math.round(item.confidence * 100)}% conf
                          </span>
                        </div>
                        <p className="mt-1 text-sm font-medium text-slate-100">{item.title}</p>
                        {item.ambiguityReason && (
                          <p className="mt-1 text-xs text-slate-300/80">
                            {item.ambiguityReason}
                          </p>
                        )}
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          {candidatePeople.map((person) => (
                            <button
                              key={person.id}
                              type="button"
                              onClick={() =>
                                onResolveAmbiguity(activeLiveMeeting.id, item.id, person.id)
                              }
                              className="btn-glazed-soft inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium"
                            >
                              <span>{person.name}</span>
                              <span className="font-mono text-[10px] opacity-80">
                                {person.role}
                              </span>
                            </button>
                          ))}
                          <button
                            type="button"
                            onClick={() => jumpToQuote(item.segmentId, item.quote)}
                            className="inline-flex items-center gap-1 rounded-xl border border-white/[0.12] px-3 py-1.5 font-mono text-[11px] text-[#5eead4] hover:bg-white/[0.06]"
                          >
                            <Quote className="h-3 w-3" />
                            quote
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              onDismissAmbiguity(activeLiveMeeting.id, item.id)
                            }
                            className="rounded-xl border border-white/[0.1] px-3 py-1.5 text-xs text-slate-300 hover:text-white"
                          >
                            Dismiss
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          {/* 5) Below Everything — Execution Plan + Real Tool Permission Execution */}
          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-mono text-[11px] text-[#5eead4]">
                5. Execution Plan & Human-Approved Tool Dispatch
              </div>
              <button
                type="button"
                onClick={onOpenWorkflow}
                className="inline-flex items-center gap-1 font-mono text-[11px] text-[#5eead4] hover:underline"
              >
                Open Visual Workflow Canvas
                <ArrowRight className="h-3 w-3" />
              </button>
            </div>

            {/* Numbered Human-Readable Execution Plan */}
            <div className="glass-card rounded-2xl p-5">
              <h3 className="font-serif text-xl italic text-slate-50">
                Execution Plan
              </h3>
              <p className="mt-1 text-xs text-slate-300/80">
                Ordered step-by-step plan generated from this recording — who does what, in what order, and dependencies.
              </p>

              {!activeLiveMeeting.executionPlan ||
              activeLiveMeeting.executionPlan.length === 0 ? (
                <div className="mt-4 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-6 text-center text-xs text-slate-400">
                  No execution steps generated yet.
                </div>
              ) : (
                <ol className="mt-4 space-y-3">
                  {activeLiveMeeting.executionPlan.map((step: ExecutionPlanStep) => {
                    const badge = getToolBadgeMeta(step.tool);
                    const BadgeIcon = badge.icon;
                    return (
                      <li
                        key={step.id}
                        className="glass-inset flex flex-col justify-between gap-3 rounded-xl p-4 sm:flex-row sm:items-center"
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
                            <p className="mt-1 text-xs leading-relaxed text-slate-300/85">
                              {step.description}
                            </p>
                            {step.dependsOn.length > 0 && (
                              <div className="mt-1.5 font-mono text-[10px] text-amber-300/90">
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
                          <span className="rounded-lg border border-white/[0.12] bg-white/[0.05] px-2.5 py-1 font-mono text-[10px] text-slate-300">
                            {step.status}
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>

            {/* Real Gemini Function Calling Tool Execution Cards */}
            <ToolExecutionPanel
              meeting={activeLiveMeeting}
              people={people}
              settings={settings}
              googleSession={googleSession}
              plannedActions={activeLiveMeeting.plannedActions || []}
              idempotencyLedger={idempotencyLedger}
              duplicatesBlockedTotal={duplicatesBlockedTotal}
              mockMode={mockMode}
              isPlanningTools={isPlanningTools}
              onPlanToolsWithGemini={async () => {
                const planned = await handlePlanTools(activeLiveMeeting);
                onUpdateLiveMeeting({
                  ...activeLiveMeeting,
                  plannedActions: planned,
                });
              }}
              onUpdateActions={(nextActions) => {
                onUpdateLiveMeeting({
                  ...activeLiveMeeting,
                  plannedActions: nextActions,
                });
              }}
              onUpdateMeetingData={(patch) => {
                onUpdateLiveMeeting({
                  ...activeLiveMeeting,
                  ...patch,
                });
              }}
              onToggleTestMode={onToggleTestMode}
              onSyncWorkflowNode={(input) => {
                onSyncWorkflowNode?.(activeLiveMeeting.id, input);
              }}
              onCreateTicketFromTool={onCreateTicketFromTool}
              onRecordIdempotency={onRecordIdempotency}
              onToast={onToast}
              onOpenSettings={onOpenSettings}
              onReconnectGoogle={onReconnectGoogle}
            />
          </section>
        </div>
      )}
    </div>
  );
}
