import { RefreshCw, Sparkles } from "lucide-react";

interface PreMeetingBriefCardProps {
  nextMeetingTitle: string;
  lines: string[];
  generatedAt: string | null;
  isLoading: boolean;
  error: string | null;
  mockMode: boolean;
  onRefresh: () => void;
}

export function PreMeetingBriefCard({
  nextMeetingTitle,
  lines,
  generatedAt,
  isLoading,
  error,
  mockMode,
  onRefresh,
}: PreMeetingBriefCardProps) {
  return (
    <section
      aria-label="Pre-meeting brief"
      className="fade-slide-up glass-card-elevated flex h-full flex-col justify-between rounded-2xl p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/[0.1] pb-3.5">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-[#5eead4]" />
            <h2 className="font-serif text-xl italic text-slate-50">
              Pre-meeting brief
            </h2>
          </div>
          <p className="mt-0.5 font-mono text-[11px] text-slate-300/80">
            Carry-over commitments for {nextMeetingTitle}
            {generatedAt ? ` · ${generatedAt}` : ""}
            {mockMode ? " · Mock mode" : ""}
          </p>
        </div>

        <button
          type="button"
          onClick={onRefresh}
          disabled={isLoading}
          className="inline-flex items-center gap-1.5 rounded-xl border border-white/[0.16] bg-white/[0.06] px-3 py-1.5 text-xs font-medium text-slate-100 whitespace-nowrap shrink-0 transition-all duration-150 hover:border-[#5eead4]/50 hover:bg-white/[0.12] disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 text-[#5eead4] ${isLoading ? "animate-spin" : ""}`} />
          {isLoading ? "Drafting brief..." : "Refresh Brief"}
        </button>
      </div>

      {error && (
        <div className="mt-3 rounded-xl border border-rose-400/35 bg-rose-500/12 px-3 py-2 text-xs text-rose-100">
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="mt-4 space-y-2.5" aria-label="Loading pre-meeting brief">
          <div className="skeleton-pulse h-4 w-11/12 rounded bg-white/[0.1]" />
          <div className="skeleton-pulse h-4 w-10/12 rounded bg-white/[0.1]" />
          <div className="skeleton-pulse h-4 w-9/12 rounded bg-white/[0.1]" />
          <div className="skeleton-pulse h-4 w-4/5 rounded bg-white/[0.1]" />
        </div>
      ) : lines.length === 0 ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-300">
          <span>
            Generate a 4-line summary of overdue and unkept promises before starting the next call.
          </span>
          <button
            type="button"
            onClick={onRefresh}
            className="btn-glazed-primary rounded-xl px-3.5 py-1.5 text-xs font-semibold transition-all"
          >
            Generate Brief
          </button>
        </div>
      ) : (
        <ul className="mt-4 space-y-2 text-[13px] leading-relaxed text-slate-100/95">
          {lines.slice(0, 4).map((line, idx) => (
            <li key={idx} className="flex items-start gap-2.5">
              <span className="mt-0.5 font-mono text-xs font-medium text-[#5eead4] tabular-nums">
                0{idx + 1}
              </span>
              <span>{line.replace(/^[•\-*]\s*/, "")}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
