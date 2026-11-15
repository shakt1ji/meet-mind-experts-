import {
  AlertOctagon,
  Calendar,
  Check,
  Clock,
  Copy,
  ExternalLink,
  FastForward,
  Loader2,
  Mail,
  PauseCircle,
  Play,
  RotateCcw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import type { Run, RunStep, RunStepStatus } from "../types/meetmind";

interface RunTimelineProps {
  runs: Run[];
  duplicatesBlockedTotal: number;
  chaosArmed: boolean;
  isRunning: boolean;
  onToggleChaos: () => void;
  onSelectMeeting: (meetingId: string) => void;
  onApproveStep: (runId: string, stepId: string) => void;
  onOpenGmailStep: (runId: string, stepId: string) => void;
  onFastForwardWaitStep: (runId: string, stepId: string) => void;
  onResumeRun: (runId: string) => void;
  onReplayFromStep: (runId: string, stepIndex: number) => void;
}

function StepStatusPill({
  status,
  skippedDuplicate,
}: {
  status: RunStepStatus;
  skippedDuplicate?: boolean;
}) {
  switch (status) {
    case "completed":
      return (
        <span className="inline-flex items-center gap-1 font-mono text-[11px] text-emerald-300">
          <Check className="h-3.5 w-3.5" />
          done
        </span>
      );
    case "running":
      return (
        <span className="inline-flex items-center gap-1 font-mono text-[11px] text-[#5eead4]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          running
        </span>
      );
    case "queued":
      return (
        <span className="inline-flex items-center gap-1 font-mono text-[11px] text-slate-300">
          <Clock className="h-3 w-3" />
          queued
        </span>
      );
    case "waiting":
      return (
        <span className="inline-flex items-center gap-1 font-mono text-[11px] text-amber-300">
          <PauseCircle className="h-3.5 w-3.5" />
          waiting
        </span>
      );
    case "failed":
      return (
        <span className="inline-flex items-center gap-1 font-mono text-[11px] text-rose-300">
          <XCircle className="h-3.5 w-3.5" />
          failed
        </span>
      );
    case "skipped":
      return (
        <span className="inline-flex items-center gap-1 font-mono text-[11px] text-sky-300">
          <ShieldCheck className="h-3.5 w-3.5" />
          {skippedDuplicate ? "skipped (idempotent)" : "skipped"}
        </span>
      );
    case "idle":
    default:
      return (
        <span className="font-mono text-[11px] text-slate-400">idle</span>
      );
  }
}

export function RunTimeline({
  runs,
  duplicatesBlockedTotal,
  chaosArmed,
  isRunning,
  onToggleChaos,
  onSelectMeeting,
  onApproveStep,
  onOpenGmailStep,
  onFastForwardWaitStep,
  onResumeRun,
  onReplayFromStep,
}: RunTimelineProps) {
  const [copiedRunId, setCopiedRunId] = useState<string | null>(null);
  const [replaySelectByRun, setReplaySelectByRun] = useState<Record<string, number>>({});

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
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h2 className="font-serif text-2xl italic text-slate-50">
            Execution Run Ledger
          </h2>
          <p className="mt-0.5 text-xs text-slate-300/80">
            Sequential idempotent execution stored in localStorage. Re-running never duplicates tickets.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="glass-inset rounded-xl px-3 py-1.5 font-mono text-xs text-slate-200 tabular-nums">
            Duplicates blocked:{" "}
            <span className="font-semibold text-[#5eead4]">
              {duplicatesBlockedTotal}
            </span>
          </div>

          <button
            type="button"
            onClick={onToggleChaos}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 transition-all ${
              chaosArmed
                ? "btn-crimson-tactile"
                : "border-white/[0.14] bg-white/[0.05] text-slate-100 hover:border-rose-400/50 hover:text-rose-200"
            }`}
          >
            <span>💥 Break it</span>
            {chaosArmed && (
              <span className="font-mono text-[10px] text-rose-100">(Armed)</span>
            )}
          </button>
        </div>
      </div>

      {runs.length === 0 ? (
        <div className="glass-card rounded-2xl px-6 py-10 text-center text-sm text-slate-300">
          No workflow runs yet. Click <span className="text-[#5eead4]">Dry run</span> then{" "}
          <span className="text-[#5eead4]">Approve and Run</span> to execute.
        </div>
      ) : (
        <div className="space-y-5">
          {runs.map((run) => {
            const doneCount = run.steps.filter(
              (s) => s.status === "completed" || s.status === "skipped"
            ).length;
            const totalSteps = run.steps.length;
            const hasFailedStep = run.steps.some((s) => s.status === "failed");
            const defaultReplayIdx = Math.min(1, Math.max(0, run.steps.length - 1));
            const selectedReplayIdx = Math.min(
              replaySelectByRun[run.id] ?? defaultReplayIdx,
              Math.max(0, run.steps.length - 1)
            );

            return (
              <div
                key={run.id}
                className="glass-card rounded-2xl p-5"
              >
                {/* Run Header */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.09] pb-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="inline-flex items-center rounded-xl border border-[#5eead4]/35 bg-[#5eead4]/14 px-3 py-1 font-mono text-xs font-medium text-[#ccfbf1] tabular-nums">
                      Run #{run.runNumber} · {doneCount} of {totalSteps} done
                    </span>

                    <button
                      type="button"
                      onClick={() => onSelectMeeting(run.meetingId)}
                      className="font-serif text-xl italic text-slate-50 hover:text-[#5eead4]"
                    >
                      {run.meetingTitle}
                    </button>

                    <span className="font-mono text-xs text-slate-400 tabular-nums">
                      {run.startedAt}
                    </span>

                    {run.duplicatesBlockedInRun > 0 && (
                      <span className="font-mono text-xs text-sky-300 tabular-nums">
                        {run.duplicatesBlockedInRun} duplicate(s) blocked
                      </span>
                    )}
                  </div>

                  {/* Run-level Controls: Resume & Replay from step */}
                  <div className="flex flex-wrap items-center gap-2">
                    {hasFailedStep && (
                      <button
                        type="button"
                        disabled={isRunning}
                        onClick={() => onResumeRun(run.id)}
                        className="btn-glazed-primary inline-flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-semibold transition-all disabled:opacity-50"
                      >
                        <Play className="h-3.5 w-3.5" />
                        Resume
                      </button>
                    )}

                    <div className="glass-inset flex items-center gap-1.5 rounded-xl p-1">
                      <select
                        aria-label={`Select step to replay for Run #${run.runNumber}`}
                        value={selectedReplayIdx}
                        onChange={(e) =>
                          setReplaySelectByRun((prev) => ({
                            ...prev,
                            [run.id]: Number(e.target.value),
                          }))
                        }
                        className="bg-transparent px-2 py-1 font-mono text-[11px] text-slate-200 focus:outline-none"
                      >
                        {run.steps.map((st, idx) => (
                          <option
                            key={st.id}
                            value={idx}
                            className="bg-[#0b1b22]"
                          >
                            Step {idx + 1}: {st.nodeLabel}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={isRunning}
                        onClick={() => onReplayFromStep(run.id, selectedReplayIdx)}
                        className="inline-flex items-center gap-1 rounded-lg bg-white/[0.08] px-2.5 py-1 font-mono text-[11px] text-slate-100 transition-colors hover:bg-[#5eead4] hover:text-[#052024] disabled:opacity-50"
                      >
                        <RotateCcw className="h-3 w-3" />
                        Replay from step
                      </button>
                    </div>
                  </div>
                </div>

                {/* Steps + Recap */}
                <div className="mt-4 grid grid-cols-1 gap-5 lg:grid-cols-12">
                  <div className="divide-y divide-white/[0.07] lg:col-span-8">
                    {run.steps.map((step: RunStep, idx: number) => (
                      <div key={step.id} className="py-3.5 first:pt-0 last:pb-0">
                        <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
                          <div className="min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center gap-2.5">
                              <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                                #{idx + 1}
                              </span>
                              <span className="text-xs font-semibold text-slate-100">
                                {step.nodeLabel}
                              </span>
                              <StepStatusPill
                                status={step.status}
                                skippedDuplicate={step.skippedDuplicate}
                              />
                            </div>

                            <p className="text-xs text-slate-200/90">{step.outputSummary}</p>

                            <div className="font-mono text-[10px] text-slate-400/80">
                              key: {step.idempotencyKey}
                            </div>

                            {/* Plain-English Chaos Error */}
                            {step.error && (
                              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-rose-400/40 bg-rose-500/14 px-3 py-2 text-xs text-rose-100">
                                <span className="flex items-center gap-2">
                                  <AlertOctagon className="h-4 w-4 shrink-0 text-rose-300" />
                                  {step.error}
                                </span>
                                <button
                                  type="button"
                                  disabled={isRunning}
                                  onClick={() => onResumeRun(run.id)}
                                  className="btn-crimson-tactile rounded-lg px-2.5 py-1 font-mono text-[11px] font-semibold"
                                >
                                  Reconnect & Resume
                                </button>
                              </div>
                            )}

                            {/* Interactive Built-in Step Actions */}
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              {step.status === "waiting" &&
                                step.waitingKind === "approval" && (
                                  <button
                                    type="button"
                                    disabled={isRunning}
                                    onClick={() => onApproveStep(run.id, step.id)}
                                    className="inline-flex items-center gap-1.5 rounded-xl bg-amber-300 px-3 py-1.5 text-xs font-semibold text-[#1a1404] transition-colors hover:bg-amber-200 disabled:opacity-50"
                                  >
                                    <Check className="h-3.5 w-3.5" />
                                    Approve ({step.approverName || "Anita"})
                                  </button>
                                )}

                              {step.nodeType === "gmail" &&
                                step.actionUrl &&
                                step.status !== "failed" && (
                                  <a
                                    href={step.actionUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={() => onOpenGmailStep(run.id, step.id)}
                                    className="inline-flex items-center gap-1.5 rounded-xl border border-sky-400/45 bg-sky-400/15 px-3 py-1.5 text-xs font-medium text-sky-100 transition-colors hover:bg-sky-400 hover:text-[#052024]"
                                  >
                                    <Mail className="h-3.5 w-3.5" />
                                    Open in Gmail
                                    <ExternalLink className="h-3 w-3" />
                                  </a>
                                )}

                              {step.nodeType === "calendar" &&
                                step.actionUrl &&
                                step.status !== "idle" &&
                                step.status !== "queued" && (
                                  <a
                                    href={step.actionUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-400/45 bg-emerald-400/15 px-3 py-1.5 text-xs font-medium text-emerald-100 transition-colors hover:bg-emerald-400 hover:text-[#052024]"
                                  >
                                    <Calendar className="h-3.5 w-3.5" />
                                    Add to Google Calendar
                                    <ExternalLink className="h-3 w-3" />
                                  </a>
                                )}

                              {step.status === "waiting" &&
                                step.waitingKind === "wait" && (
                                  <button
                                    type="button"
                                    disabled={isRunning}
                                    onClick={() =>
                                      onFastForwardWaitStep(run.id, step.id)
                                    }
                                    className="btn-glazed-soft inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition-all disabled:opacity-50"
                                  >
                                    <FastForward className="h-3.5 w-3.5" />
                                    Fast-forward 3 days
                                  </button>
                                )}
                            </div>
                          </div>

                          <div className="shrink-0 font-mono text-[11px] text-slate-400 tabular-nums">
                            {step.startedAt}
                            {step.durationMs > 0 ? ` · ${step.durationMs}ms` : ""}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {run.recapDraft && (
                    <div className="glass-inset h-fit rounded-xl p-4 lg:col-span-4">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[11px] text-[#5eead4]">
                          Email Recap Payload
                        </span>
                        <button
                          type="button"
                          onClick={() => handleCopyRecap(run.id, run.recapDraft || "")}
                          className="inline-flex items-center gap-1 font-mono text-[11px] text-slate-300 hover:text-white"
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
                      <p className="mt-2.5 whitespace-pre-line text-xs leading-relaxed text-slate-200/90">
                        {run.recapDraft}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
