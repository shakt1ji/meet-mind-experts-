import { Check, Clock, Copy, PauseCircle } from "lucide-react";
import { useState } from "react";
import type { Run, RunStepStatus } from "../types/meetmind";

interface RunTimelineProps {
  runs: Run[];
  onSelectMeeting: (meetingId: string) => void;
}

function stepLabel(status: RunStepStatus): { text: string; colorClass: string } {
  switch (status) {
    case "completed":
      return { text: "Completed", colorClass: "text-emerald-300" };
    case "running":
      return { text: "Running", colorClass: "text-[#c4b5fd]" };
    case "waiting":
      return { text: "Awaiting Confirmation", colorClass: "text-amber-300" };
    case "skipped":
      return { text: "Skipped", colorClass: "text-zinc-500" };
  }
}

export function RunTimeline({ runs, onSelectMeeting }: RunTimelineProps) {
  const [copiedRunId, setCopiedRunId] = useState<string | null>(null);

  const handleCopyRecap = async (runId: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedRunId(runId);
      window.setTimeout(() => setCopiedRunId(null), 1800);
    } catch {
      // Clipboard unavailable
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-serif text-2xl italic text-zinc-100">Execution Run Timeline</h2>
        <span className="font-mono text-xs text-zinc-400 tabular-nums">
          {runs.length} recorded {runs.length === 1 ? "run" : "runs"}
        </span>
      </div>

      {runs.length === 0 ? (
        <div className="rounded-xl border border-white/[0.08] bg-[#111118]/80 px-6 py-10 text-center text-sm text-zinc-400">
          No workflow runs yet. Click <span className="text-[#c4b5fd]">▶ Run the Meeting</span> to
          execute the pipeline.
        </div>
      ) : (
        <div className="space-y-4">
          {runs.map((run) => (
            <div
              key={run.id}
              className="rounded-xl border border-white/[0.08] bg-[#111118]/90 p-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] pb-3.5">
                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => onSelectMeeting(run.meetingId)}
                    className="font-serif text-xl italic text-zinc-100 hover:text-[#c4b5fd]"
                  >
                    {run.meetingTitle}
                  </button>
                  <span aria-hidden="true" className="text-zinc-600">
                    ·
                  </span>
                  <span className="font-mono text-xs text-zinc-400 tabular-nums">
                    {run.startedAt}
                  </span>
                </div>

                <div className="flex items-center gap-2 font-mono text-xs">
                  {run.status === "needs_review" ? (
                    <span className="inline-flex items-center gap-1.5 text-amber-300">
                      <PauseCircle className="h-3.5 w-3.5" />
                      Needs Confirmation
                    </span>
                  ) : run.status === "running" ? (
                    <span className="inline-flex items-center gap-1.5 text-[#c4b5fd]">
                      <Clock className="h-3.5 w-3.5" />
                      Executing
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-emerald-300">
                      <Check className="h-3.5 w-3.5" />
                      Executed
                    </span>
                  )}
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-12">
                <div className="lg:col-span-7 divide-y divide-white/[0.06]">
                  {run.steps.map((step) => {
                    const meta = stepLabel(step.status);
                    return (
                      <div
                        key={step.id}
                        className="flex flex-col justify-between gap-1 py-2.5 sm:flex-row sm:items-center"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-zinc-200">
                              {step.nodeLabel}
                            </span>
                            <span className={`font-mono text-[11px] ${meta.colorClass}`}>
                              {meta.text}
                            </span>
                          </div>
                          <p className="mt-0.5 text-xs text-zinc-400">{step.outputSummary}</p>
                        </div>
                        <div className="shrink-0 font-mono text-[11px] text-zinc-500 tabular-nums">
                          {step.startedAt} · {step.durationMs}ms
                        </div>
                      </div>
                    );
                  })}
                </div>

                {run.recapDraft && (
                  <div className="lg:col-span-5 rounded-lg border border-white/[0.07] bg-[#0b0b10]/80 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[11px] text-[#c4b5fd]">
                        Generated Client Recap
                      </span>
                      <button
                        type="button"
                        onClick={() => handleCopyRecap(run.id, run.recapDraft || "")}
                        className="inline-flex items-center gap-1 font-mono text-[11px] text-zinc-400 hover:text-zinc-100"
                      >
                        {copiedRunId === run.id ? (
                          <>
                            <Check className="h-3 w-3 text-emerald-400" />
                            Copied
                          </>
                        ) : (
                          <>
                            <Copy className="h-3 w-3" />
                            Copy
                          </>
                        )}
                      </button>
                    </div>
                    <p className="mt-2.5 whitespace-pre-line text-xs leading-relaxed text-zinc-300">
                      {run.recapDraft}
                    </p>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
