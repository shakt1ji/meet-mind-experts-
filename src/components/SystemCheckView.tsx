import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Database,
  HardDrive,
  Loader2,
  Mic,
  Play,
  Radio,
  Sparkles,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import {
  type DbStatusInfo,
  type SystemCheckReport,
  runSupabaseSystemCheck,
} from "../lib/db";

interface SystemCheckViewProps {
  dbStatus: DbStatusInfo;
  onOpenSettings: () => void;
}

export function SystemCheckView({ dbStatus, onOpenSettings }: SystemCheckViewProps) {
  const [isRunning, setIsRunning] = useState(false);
  const [report, setReport] = useState<SystemCheckReport | null>(null);
  const [geminiHealth, setGeminiHealth] = useState<{
    checked: boolean;
    ok: boolean;
    detail: string;
  }>({ checked: false, ok: false, detail: "Not tested yet" });
  const [micReady, setMicReady] = useState<boolean>(() =>
    typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia)
  );

  const handleRunDiagnostics = async () => {
    setIsRunning(true);
    try {
      const [supaReport, apiRes] = await Promise.all([
        runSupabaseSystemCheck(),
        fetch("/api/health")
          .then(async (r) => ({ ok: r.ok, body: await r.json().catch(() => ({})) }))
          .catch(() => ({ ok: false, body: {} })),
      ]);

      setReport(supaReport);
      setGeminiHealth({
        checked: true,
        ok: apiRes.ok,
        detail: apiRes.ok
          ? "Server API online (/api/health -> ok: true)"
          : "Server API unreachable on port 3000",
      });
      setMicReady(
        typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia)
      );
    } finally {
      setIsRunning(false);
    }
  };

  const stepIcon = (id: string) => {
    if (id === "db_rw") return Database;
    if (id === "storage_rw") return HardDrive;
    return Radio;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="font-serif text-3xl italic tracking-tight text-slate-50">
            System Check
          </h1>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-300/80">
            Verify Supabase Postgres RLS policies, private &ldquo;recordings&rdquo; Storage bucket, Realtime replication, and MeetMind server readiness in one click.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onOpenSettings}
            className="btn-glazed-soft rounded-xl px-3.5 py-2 font-mono text-xs font-medium"
          >
            Open Settings
          </button>
          <button
            type="button"
            onClick={() => void handleRunDiagnostics()}
            disabled={isRunning}
            className="btn-glazed-primary inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold disabled:opacity-50"
          >
            {isRunning ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            {isRunning ? "Running Diagnostics..." : "Run Supabase System Check"}
          </button>
        </div>
      </div>

      {/* Mode Banner */}
      <div className="glass-card flex flex-wrap items-center justify-between gap-3 rounded-2xl px-5 py-3.5">
        <div className="flex items-center gap-2.5 text-xs">
          <Activity className="h-4 w-4 text-[#5eead4]" />
          <span className="text-slate-100">{dbStatus.message}</span>
        </div>
        <span
          className={`rounded-lg border px-2.5 py-1 font-mono text-[10px] font-semibold ${
            dbStatus.mode === "supabase"
              ? "border-emerald-400/40 bg-emerald-400/15 text-emerald-200"
              : "border-amber-300/35 bg-amber-400/12 text-amber-200"
          }`}
        >
          {dbStatus.mode === "supabase" ? "Supabase Live" : "Local mode"}
        </span>
      </div>

      {/* Supabase 3-Step Diagnostics */}
      <div className="space-y-3">
        <div className="font-mono text-[11px] text-[#5eead4]">
          Supabase Live Probe {report ? `· Last checked ${report.checkedAt}` : ""}
        </div>

        {!report ? (
          <div className="glass-card rounded-2xl px-6 py-10 text-center text-xs text-slate-300">
            Click <span className="font-semibold text-[#5eead4]">Run Supabase System Check</span> to test row insert/delete, bucket &ldquo;recordings&rdquo; upload/delete, and Realtime event delivery.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {report.steps.map((step) => {
              const Icon = stepIcon(step.id);
              const passed = step.status === "pass";
              return (
                <div
                  key={step.id}
                  className={`glass-card rounded-2xl p-5 ${
                    passed
                      ? "border-emerald-400/35 bg-emerald-500/[0.05]"
                      : "border-rose-400/45 bg-rose-500/[0.06]"
                  }`}
                >
                  <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                    <div className="flex items-center gap-3">
                      <span
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                          passed
                            ? "bg-emerald-400/15 text-emerald-300"
                            : "bg-rose-400/15 text-rose-300"
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                      <div>
                        <div className="text-sm font-semibold text-slate-50">
                          {step.title}
                        </div>
                        <div className="mt-0.5 text-xs text-slate-300">{step.detail}</div>
                      </div>
                    </div>

                    <span
                      className={`inline-flex shrink-0 items-center gap-1.5 self-start rounded-lg border px-2.5 py-1 font-mono text-[11px] font-semibold sm:self-center ${
                        passed
                          ? "border-emerald-400/40 bg-emerald-400/15 text-emerald-200"
                          : "border-rose-400/45 bg-rose-500/15 text-rose-200"
                      }`}
                    >
                      {passed ? (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5" />
                      )}
                      {passed ? "PASS" : "FAIL"}
                    </span>
                  </div>

                  {!passed && step.fixHint && (
                    <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-300/30 bg-amber-400/10 px-3.5 py-2.5 text-xs text-amber-100">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
                      <div>
                        <span className="font-semibold">Fix hint: </span>
                        <span>{step.fixHint}</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Environment Readiness Cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="glass-card rounded-2xl p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-50">
              <Sparkles className="h-4 w-4 text-[#5eead4]" />
              <span>Gemini Server Proxy</span>
            </div>
            <span
              className={`font-mono text-[11px] ${
                !geminiHealth.checked
                  ? "text-slate-400"
                  : geminiHealth.ok
                  ? "text-emerald-300"
                  : "text-rose-300"
              }`}
            >
              {!geminiHealth.checked ? "Pending" : geminiHealth.ok ? "Online" : "Error"}
            </span>
          </div>
          <p className="mt-2 text-xs text-slate-300/80">{geminiHealth.detail}</p>
        </div>

        <div className="glass-card rounded-2xl p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-50">
              <Mic className="h-4 w-4 text-[#a78bfa]" />
              <span>Browser MediaRecorder & Audio</span>
            </div>
            <span
              className={`font-mono text-[11px] ${
                micReady ? "text-emerald-300" : "text-rose-300"
              }`}
            >
              {micReady ? "Supported" : "Unavailable"}
            </span>
          </div>
          <p className="mt-2 text-xs text-slate-300/80">
            {micReady
              ? "Web Audio AnalyserNode and audio/webm MediaRecorder APIs are ready for the Recorder Orb."
              : "Microphone API unavailable in this browser context."}
          </p>
        </div>
      </div>
    </div>
  );
}
