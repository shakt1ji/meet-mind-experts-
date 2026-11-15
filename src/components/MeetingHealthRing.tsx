import type { MeetingHealthReport } from "../utils/metrics";

interface MeetingHealthRingProps {
  health: MeetingHealthReport;
}

export function MeetingHealthRing({ health }: MeetingHealthRingProps) {
  const size = 60;
  const strokeWidth = 5;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (health.score / 100) * circumference;

  const strokeColor =
    health.tone === "healthy"
      ? "#5eead4"
      : health.tone === "warning"
      ? "#fbbf24"
      : "#fb7185";

  const textColor =
    health.tone === "healthy"
      ? "text-[#5eead4]"
      : health.tone === "warning"
      ? "text-amber-300"
      : "text-rose-300";

  return (
    <div className="glass-card flex h-full items-center gap-4 rounded-2xl px-5 py-4">
      <div className="relative flex h-[60px] w-[60px] shrink-0 items-center justify-center">
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="-rotate-90"
          aria-hidden="true"
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="rgba(255,255,255,0.1)"
            strokeWidth={strokeWidth}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            className="transition-[stroke-dashoffset] duration-500 ease-out"
          />
        </svg>
        <span
          className={`absolute font-mono text-sm font-semibold tabular-nums ${textColor}`}
        >
          {health.score}
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <span className="text-[13px] font-semibold tracking-tight text-slate-100">
            Meeting Health
          </span>
          <span className="font-mono text-[11px] text-slate-400 tabular-nums">
            Owners {health.ownedSharePct}% · Dates {health.datedSharePct}% · Decisions{" "}
            {health.decisionCount} · Ambiguous {health.ambiguousCount}
          </span>
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-slate-300">{health.advice}</p>
      </div>
    </div>
  );
}
