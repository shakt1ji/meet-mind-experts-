import {
  ArrowUpRight,
  Clock,
  Database,
  Globe,
  Loader2,
  Mic,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import type { DbStatusInfo } from "../lib/db";
import type { Meeting } from "../types/meetmind";
import { computeMeetingHealth } from "../utils/metrics";

interface HistoryViewProps {
  meetings: Meeting[];
  dbStatus: DbStatusInfo;
  onOpenMeeting: (meetingId: string) => void;
  onRetryMeeting: (meetingId: string) => Promise<void>;
  onGoToLiveRecord: () => void;
  onSyncFromSupabase: () => Promise<void>;
}

export function HistoryView({
  meetings,
  dbStatus,
  onOpenMeeting,
  onRetryMeeting,
  onGoToLiveRecord,
  onSyncFromSupabase,
}: HistoryViewProps) {
  const sortedMeetings = [...meetings].sort((a, b) => {
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return tb - ta;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="font-serif text-3xl italic tracking-tight text-slate-50">
            Meeting History
          </h1>
          <p className="mt-1 text-xs text-slate-300/80">
            Ordered newest first. Click any meeting to load its transcript, signed audio playback, tickets, promises, and execution runs.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {dbStatus.mode === "supabase" && (
            <button
              type="button"
              onClick={() => void onSyncFromSupabase()}
              className="btn-glazed-soft inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 font-mono text-xs font-medium"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh Supabase
            </button>
          )}
          <button
            type="button"
            onClick={onGoToLiveRecord}
            className="btn-glazed-primary inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold"
          >
            <Mic className="h-3.5 w-3.5" />
            Record New Meeting
          </button>
        </div>
      </div>

      {/* Storage Mode Banner */}
      <div className="glass-card flex flex-wrap items-center justify-between gap-3 rounded-2xl px-5 py-3 text-xs">
        <div className="flex items-center gap-2.5">
          <Database className="h-4 w-4 text-[#5eead4]" />
          <span className="text-slate-200">{dbStatus.message}</span>
        </div>
        <span className="font-mono text-[11px] text-slate-400 tabular-nums">
          {sortedMeetings.length} meeting{sortedMeetings.length === 1 ? "" : "s"} stored
        </span>
      </div>

      {/* Meetings Grid */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {sortedMeetings.map((meeting) => {
          const health = computeMeetingHealth(meeting);
          const pendingCount = meeting.extractedItems.filter(
            (i) => i.needsConfirmation && !i.resolved
          ).length;
          const actionCount = meeting.extractedItems.filter(
            (i) => i.kind === "Action" || i.kind === "Commit"
          ).length;
          const status = meeting.status || "ready";

          return (
            <div
              key={meeting.id}
              onClick={() => onOpenMeeting(meeting.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onOpenMeeting(meeting.id);
                }
              }}
              className="glass-card fade-slide-up group cursor-pointer rounded-2xl p-5 transition-all hover:border-[#5eead4]/45 hover:bg-white/[0.08]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate font-serif text-xl italic text-slate-50 group-hover:text-[#99f6e4]">
                      {meeting.title}
                    </h2>
                    {status === "analyzing" && (
                      <span className="inline-flex items-center gap-1 rounded-md border border-[#a78bfa]/40 bg-[#a78bfa]/15 px-2 py-0.5 font-mono text-[10px] text-[#ddd6fe]">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Analyzing
                      </span>
                    )}
                    {status === "failed" && (
                      <span className="rounded-md border border-rose-400/45 bg-rose-500/20 px-2 py-0.5 font-mono text-[10px] text-rose-200">
                        Failed
                      </span>
                    )}
                    {meeting.isLiveRecording && status === "ready" && (
                      <span className="rounded-md border border-[#5eead4]/35 bg-[#5eead4]/15 px-2 py-0.5 font-mono text-[10px] text-[#99f6e4]">
                        Audio Saved
                      </span>
                    )}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-[11px] text-slate-400 tabular-nums">
                    <span>{meeting.date}</span>
                    <span>·</span>
                    <span className="inline-flex items-center gap-1 text-slate-200">
                      <Clock className="h-3 w-3 text-[#5eead4]" />
                      {meeting.duration}
                    </span>
                    {meeting.language && (
                      <>
                        <span>·</span>
                        <span className="inline-flex items-center gap-1 text-sky-300">
                          <Globe className="h-3 w-3" />
                          {meeting.language}
                        </span>
                      </>
                    )}
                  </div>
                </div>

                <span
                  className={`shrink-0 rounded-xl border px-2.5 py-1 font-mono text-[11px] font-semibold tabular-nums ${
                    health.tone === "healthy"
                      ? "border-emerald-400/35 bg-emerald-400/12 text-emerald-200"
                      : health.tone === "warning"
                      ? "border-amber-300/35 bg-amber-400/12 text-amber-200"
                      : "border-rose-400/35 bg-rose-500/15 text-rose-200"
                  }`}
                >
                  Health {meeting.healthScore ?? health.score}
                </span>
              </div>

              <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-slate-300/85">
                {status === "failed"
                  ? meeting.analysisError || "Audio analysis failed. Click Retry to re-run."
                  : meeting.summary}
              </p>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.08] pt-3 font-mono text-[11px]">
                <div className="flex flex-wrap items-center gap-3 text-slate-300 tabular-nums">
                  <span>{meeting.segments.length} turns</span>
                  <span>·</span>
                  <span>{meeting.extractedItems.length} items</span>
                  <span>·</span>
                  <span>{actionCount} promises</span>
                  {pendingCount > 0 && (
                    <span className="text-amber-300">· {pendingCount} to confirm</span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {status === "failed" && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void onRetryMeeting(meeting.id);
                      }}
                      className="btn-crimson-tactile inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[10px] font-semibold"
                    >
                      <RotateCcw className="h-3 w-3" />
                      Retry
                    </button>
                  )}
                  <span className="inline-flex items-center gap-1 text-[#5eead4] group-hover:underline">
                    Open
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
