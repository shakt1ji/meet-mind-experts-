import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Globe,
  Loader2,
  Mic,
  Plus,
  RotateCcw,
} from "lucide-react";
import type { Meeting } from "../types/meetmind";

interface MeetingsListPanelProps {
  meetings: Meeting[];
  selectedMeetingId: string;
  newlyArrivedMeetingId: string | null;
  onSelectMeeting: (meetingId: string) => void;
  onRetryMeeting: (meetingId: string) => void;
  onNewMeetingClick: () => void;
  onRecordLiveClick: () => void;
}

function formatDurationLabel(mtg: Meeting): string {
  if (typeof mtg.durationSeconds === "number" && mtg.durationSeconds > 0 && mtg.durationSeconds < 60) {
    return `${mtg.durationSeconds} sec`;
  }
  return mtg.duration || `${mtg.durationSeconds || 0} sec`;
}

function formatDateTimeLabel(mtg: Meeting): string {
  if (mtg.createdAt) {
    const parsed = new Date(mtg.createdAt);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleString([], {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
    }
  }
  return mtg.date;
}

export function MeetingsListPanel({
  meetings,
  selectedMeetingId,
  newlyArrivedMeetingId,
  onSelectMeeting,
  onRetryMeeting,
  onNewMeetingClick,
  onRecordLiveClick,
}: MeetingsListPanelProps) {
  // Always sort newest first by createdAt descending
  const sortedMeetings = [...meetings].sort((a, b) => {
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return tb - ta;
  });

  return (
    <section className="glass-card overflow-hidden rounded-2xl">
      <div className="flex flex-col justify-between gap-3 border-b border-white/[0.09] px-5 py-3.5 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2.5">
          <h2 className="font-serif text-lg italic text-slate-50">Meetings</h2>
          <span className="font-mono text-xs text-slate-400 tabular-nums">
            {sortedMeetings.length} total · newest first
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onRecordLiveClick}
            className="btn-glazed-soft inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0"
          >
            <Mic className="h-3.5 w-3.5" />
            Record Audio
          </button>
          <button
            type="button"
            onClick={onNewMeetingClick}
            className="inline-flex items-center gap-1 rounded-xl border border-white/[0.12] bg-white/[0.05] px-3 py-1.5 text-xs font-medium text-slate-100 whitespace-nowrap shrink-0 hover:bg-white/[0.1]"
          >
            <Plus className="h-3.5 w-3.5 text-[#5eead4]" />
            Paste / Upload
          </button>
        </div>
      </div>

      <div className="divide-y divide-white/[0.07] max-h-[300px] overflow-y-auto">
        {sortedMeetings.map((mtg) => {
          const isSelected = mtg.id === selectedMeetingId;
          const isNew = mtg.id === newlyArrivedMeetingId;
          const status = mtg.status || "ready";

          const complaintsCount = mtg.extractedItems.filter(
            (i) => i.kind === "Complaint" || i.liveCategory === "Complaint"
          ).length;
          const tasksCount = mtg.extractedItems.filter(
            (i) =>
              i.kind === "Action" ||
              i.kind === "Commit" ||
              i.liveCategory === "Task"
          ).length;
          const deadlinesCount = mtg.extractedItems.filter(
            (i) =>
              i.liveCategory === "Deadline" ||
              (i.dueDate && i.dueDate !== "TBD")
          ).length;

          return (
            <div
              key={mtg.id}
              onClick={() => onSelectMeeting(mtg.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelectMeeting(mtg.id);
                }
              }}
              className={`flex cursor-pointer flex-col justify-between gap-3 px-5 py-3.5 transition-all lg:flex-row lg:items-center ${
                isNew ? "chip-pop-in bg-[#5eead4]/[0.11]" : ""
              } ${
                isSelected
                  ? "bg-white/[0.085] shadow-[inset_3px_0_0_#5eead4]"
                  : "hover:bg-white/[0.04]"
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-semibold text-slate-50">
                    {mtg.title}
                  </span>

                  {/* Status Badge */}
                  {status === "analyzing" ? (
                    <span className="inline-flex items-center gap-1 rounded-md border border-[#a78bfa]/45 bg-[#a78bfa]/15 px-2 py-0.5 font-mono text-[10px] font-medium text-[#ede9fe]">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Analyzing
                    </span>
                  ) : status === "failed" ? (
                    <span className="inline-flex items-center gap-1 rounded-md border border-rose-400/45 bg-rose-500/18 px-2 py-0.5 font-mono text-[10px] font-medium text-rose-100">
                      <AlertCircle className="h-3 w-3" />
                      Failed
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-md border border-emerald-400/35 bg-emerald-400/12 px-2 py-0.5 font-mono text-[10px] font-medium text-emerald-200">
                      <CheckCircle2 className="h-3 w-3" />
                      Ready
                    </span>
                  )}

                  {isNew && (
                    <span className="font-mono text-[10px] font-medium text-[#5eead4]">
                      New
                    </span>
                  )}
                </div>

                <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-[11px] text-slate-400 tabular-nums">
                  <span>{formatDateTimeLabel(mtg)}</span>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1 text-slate-200">
                    <Clock className="h-3 w-3 text-[#5eead4]" />
                    {formatDurationLabel(mtg)}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1 text-sky-300">
                    <Globe className="h-3 w-3" />
                    {mtg.language || "English"}
                  </span>
                </div>
              </div>

              {/* Counts + Retry */}
              <div className="flex shrink-0 flex-wrap items-center gap-2 font-mono text-[11px] tabular-nums">
                <span className="rounded-lg border border-rose-400/25 bg-rose-500/10 px-2 py-0.5 text-rose-200">
                  {complaintsCount} {complaintsCount === 1 ? "complaint" : "complaints"}
                </span>
                <span className="rounded-lg border border-[#5eead4]/25 bg-[#5eead4]/10 px-2 py-0.5 text-[#99f6e4]">
                  {tasksCount} {tasksCount === 1 ? "task" : "tasks"}
                </span>
                <span className="rounded-lg border border-amber-300/25 bg-amber-400/10 px-2 py-0.5 text-amber-200">
                  {deadlinesCount} {deadlinesCount === 1 ? "deadline" : "deadlines"}
                </span>

                {status === "failed" && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRetryMeeting(mtg.id);
                    }}
                    className="btn-crimson-tactile inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[10px] font-semibold"
                  >
                    <RotateCcw className="h-3 w-3" />
                    Retry
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
