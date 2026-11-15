import {
  FastForward,
  RotateCcw,
  Sparkles,
  X,
  Zap,
} from "lucide-react";

export interface PresenterControlsBarProps {
  demoActive: boolean;
  demoStep: number;
  demoStepLabel: string;
  awaitingChaosClick: boolean;
  chaosArmed: boolean;
  mockMode: boolean;
  onToggleMockMode: () => void;
  onNextStep: () => void;
  onRestartDemo: () => void;
  onTriggerBreakIt: () => void;
  onCloseDemo: () => void;
}

export function PresenterControlsBar({
  demoActive,
  demoStep,
  demoStepLabel,
  awaitingChaosClick,
  chaosArmed,
  mockMode,
  onToggleMockMode,
  onNextStep,
  onRestartDemo,
  onTriggerBreakIt,
  onCloseDemo,
}: PresenterControlsBarProps) {
  if (!demoActive && !mockMode) {
    return null;
  }

  return (
    <div
      role="region"
      aria-label="Presenter controls"
      className="fade-slide-up glass-card-elevated fixed bottom-4 left-1/2 z-40 w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 rounded-2xl px-4 py-3"
    >
      {awaitingChaosClick && (
        <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-rose-400/45 bg-rose-500/18 px-3.5 py-2 text-xs text-rose-50">
          <span className="flex items-center gap-2 font-medium">
            <Zap className="h-3.5 w-3.5 shrink-0 text-rose-300" />
            Demo paused before Gmail dispatch — test failure & idempotent Resume:
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onTriggerBreakIt}
              disabled={chaosArmed}
              className="btn-crimson-tactile inline-flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-semibold whitespace-nowrap shrink-0 transition-all disabled:opacity-60"
            >
              <span>💥 Break it</span>
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-[#5eead4]" />
          <span className="font-mono text-[11px] font-semibold text-[#ccfbf1] tabular-nums whitespace-nowrap">
            {demoActive ? `Demo ${demoStep}/7` : "Presenter"}
          </span>
          <span aria-hidden="true" className="text-slate-500">
            ·
          </span>
          <span className="truncate text-xs text-slate-200">
            {demoActive ? demoStepLabel : "Mock AI cache enabled"}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={onToggleMockMode}
            aria-pressed={mockMode}
            className={`rounded-xl border px-2.5 py-1 font-mono text-[11px] font-medium whitespace-nowrap shrink-0 transition-colors ${
              mockMode
                ? "border-emerald-400/45 bg-emerald-400/15 text-emerald-100"
                : "border-white/[0.14] bg-white/[0.05] text-slate-200 hover:text-white"
            }`}
          >
            Mock: {mockMode ? "ON" : "OFF"}
          </button>

          {demoActive && (
            <>
              <button
                type="button"
                onClick={onNextStep}
                className="btn-glazed-primary inline-flex items-center gap-1 rounded-xl px-3 py-1 text-xs font-semibold whitespace-nowrap shrink-0 transition-all"
              >
                <FastForward className="h-3 w-3" />
                Next step
              </button>

              <button
                type="button"
                onClick={onRestartDemo}
                className="inline-flex items-center gap-1 rounded-xl border border-white/[0.14] bg-white/[0.05] px-2.5 py-1 text-xs font-medium text-slate-100 whitespace-nowrap shrink-0 transition-colors hover:bg-white/[0.1]"
              >
                <RotateCcw className="h-3 w-3" />
                Restart
              </button>
            </>
          )}

          {demoActive && (
            <button
              type="button"
              onClick={onCloseDemo}
              aria-label="Exit guided demo"
              className="rounded-xl p-1.5 text-slate-300 hover:bg-white/[0.08] hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
