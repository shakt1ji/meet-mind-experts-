import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  Database,
  ExternalLink,
  KeyRound,
  Save,
  Sparkles,
  Stethoscope,
  Unplug,
  Webhook,
} from "lucide-react";
import { useState } from "react";
import type { DbStatusInfo } from "../lib/db";
import type { AppSettings } from "../types/meetmind";
import {
  GOOGLE_OAUTH_SCOPES,
  type GoogleAuthSession,
  isGoogleSessionValid,
} from "../utils/googleAuth";
import {
  DEFAULT_GEMINI_MODEL,
  validateSupabaseInputs,
} from "../utils/settingsStorage";

interface SettingsViewProps {
  settings: AppSettings;
  mockMode: boolean;
  dbStatus: DbStatusInfo;
  googleSession: GoogleAuthSession | null;
  onSaveSettings: (next: AppSettings) => Promise<void>;
  onToggleMockMode: () => void;
  onConnectGoogle: () => Promise<void>;
  onDisconnectGoogle: () => void;
  onOpenSystemCheck: () => void;
}

export function SettingsView({
  settings,
  mockMode,
  dbStatus,
  googleSession,
  onSaveSettings,
  onToggleMockMode,
  onConnectGoogle,
  onDisconnectGoogle,
  onOpenSystemCheck,
}: SettingsViewProps) {
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [isConnectingGoogle, setIsConnectingGoogle] = useState(false);

  const supaCheck =
    draft.supabaseUrl.trim() || draft.supabaseAnonKey.trim()
      ? validateSupabaseInputs(draft.supabaseUrl, draft.supabaseAnonKey)
      : null;

  const googleConnected = isGoogleSessionValid(googleSession);
  const originHint =
    typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setSaveMessage(null);
    try {
      const normalized: AppSettings = {
        ...draft,
        supabaseUrl: draft.supabaseUrl.trim(),
        supabaseAnonKey: draft.supabaseAnonKey.trim(),
        googleClientId: draft.googleClientId.trim(),
        slackWebhookUrl: draft.slackWebhookUrl.trim(),
        n8nWebhookUrl: draft.n8nWebhookUrl.trim(),
        geminiModel: draft.geminiModel.trim() || DEFAULT_GEMINI_MODEL,
      };
      await onSaveSettings(normalized);
      setDraft(normalized);
      setSaveMessage("Settings saved to localStorage and Supabase client refreshed.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleGoogleConnectClick = async () => {
    setGoogleError(null);
    setIsConnectingGoogle(true);
    try {
      await onSaveSettings({
        ...draft,
        geminiModel: draft.geminiModel.trim() || DEFAULT_GEMINI_MODEL,
      });
      await onConnectGoogle();
    } catch (err) {
      setGoogleError(
        err instanceof Error ? err.message : "Could not connect Google account."
      );
    } finally {
      setIsConnectingGoogle(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="font-serif text-3xl italic tracking-tight text-slate-50">
            Integrations & Settings
          </h1>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-300/80">
            Connect your Supabase project (URL + public anon key), Google Workspace OAuth Client ID, and optional Slack/n8n webhooks. Saved in browser localStorage only — never hardcoded.
          </p>
        </div>

        <button
          type="button"
          onClick={onToggleMockMode}
          className={`inline-flex shrink-0 items-center gap-2 rounded-xl border px-3.5 py-2 font-mono text-xs font-medium transition-colors ${
            mockMode
              ? "border-emerald-400/50 bg-emerald-400/18 text-emerald-100"
              : "border-white/[0.14] bg-white/[0.05] text-slate-200 hover:bg-white/[0.1]"
          }`}
        >
          <Sparkles className="h-3.5 w-3.5 text-[#5eead4]" />
          Mock Mode: {mockMode ? "ON (Offline Cache)" : "OFF (Live APIs)"}
        </button>
      </div>

      {/* Live Connection Status Cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="glass-card rounded-2xl p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#5eead4]/15 text-[#5eead4]">
                <Database className="h-4 w-4" />
              </span>
              <div>
                <div className="text-sm font-semibold text-slate-50">
                  Supabase Persistence & Realtime
                </div>
                <div className="font-mono text-[11px] text-slate-400">
                  {dbStatus.mode === "supabase"
                    ? `Connected · ${dbStatus.projectHost}`
                    : "Local mode"}
                </div>
              </div>
            </div>

            <span
              className={`rounded-lg border px-2.5 py-1 font-mono text-[10px] font-medium ${
                dbStatus.mode === "supabase"
                  ? "border-emerald-400/40 bg-emerald-400/15 text-emerald-200"
                  : "border-amber-300/35 bg-amber-400/12 text-amber-200"
              }`}
            >
              {dbStatus.mode === "supabase" ? "Supabase Live" : "Local mode"}
            </span>
          </div>

          <p className="mt-3 text-xs leading-relaxed text-slate-300/80">
            {dbStatus.message}
          </p>

          <button
            type="button"
            onClick={onOpenSystemCheck}
            className="btn-glazed-soft mt-3 inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 font-mono text-[11px] font-medium"
          >
            <Stethoscope className="h-3.5 w-3.5" />
            Run System Check
          </button>
        </div>

        <div className="glass-card rounded-2xl p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-400/15 text-sky-300">
                <Cloud className="h-4 w-4" />
              </span>
              <div>
                <div className="text-sm font-semibold text-slate-50">
                  Google Workspace OAuth
                </div>
                <div className="font-mono text-[11px] text-slate-400">
                  Gmail Draft/Send + Google Calendar
                </div>
              </div>
            </div>

            <span
              className={`rounded-lg border px-2.5 py-1 font-mono text-[10px] font-medium ${
                googleConnected
                  ? "border-emerald-400/40 bg-emerald-400/15 text-emerald-200"
                  : "border-white/[0.14] bg-white/[0.05] text-slate-300"
              }`}
            >
              {googleConnected
                ? `Connected (${googleSession?.connectedAt || "Active"})`
                : "Not Connected"}
            </span>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleGoogleConnectClick()}
              disabled={isConnectingGoogle || !draft.googleClientId.trim()}
              className="btn-glazed-primary inline-flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-45"
            >
              <KeyRound className="h-3.5 w-3.5" />
              {isConnectingGoogle
                ? "Authorizing..."
                : googleConnected
                ? "Reconnect Google"
                : "Connect Google"}
            </button>

            {googleConnected && (
              <button
                type="button"
                onClick={onDisconnectGoogle}
                className="inline-flex items-center gap-1.5 rounded-xl border border-rose-400/35 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-200 hover:bg-rose-500/20"
              >
                <Unplug className="h-3.5 w-3.5" />
                Disconnect
              </button>
            )}
          </div>

          {googleError && (
            <p className="mt-2.5 text-xs text-rose-300">{googleError}</p>
          )}
        </div>
      </div>

      {/* Main Settings Form */}
      <form onSubmit={handleSave} className="glass-card space-y-6 rounded-2xl p-6">
        {saveMessage && (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-400/35 bg-emerald-400/12 px-4 py-2.5 text-xs text-emerald-100">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-300" />
            <span>{saveMessage}</span>
          </div>
        )}

        {/* Section 1: Supabase URL + Anon Key */}
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="font-mono text-xs font-medium text-slate-100">
                Supabase Project Credentials
              </div>
              <p className="mt-0.5 text-[11px] text-slate-400">
                Uses your public <span className="font-mono text-slate-200">anon</span> key only (never service_role). Syncs tables:{" "}
                <span className="font-mono text-slate-300">
                  meetings, tickets, promises, runs, run_steps, blocked_duplicates
                </span>{" "}
                + Storage bucket <span className="font-mono text-slate-300">recordings</span>.
              </p>
            </div>
            {supaCheck && (
              <span
                className={`font-mono text-[11px] ${
                  supaCheck.valid ? "text-emerald-300" : "text-rose-300"
                }`}
              >
                {supaCheck.valid ? "Valid format" : supaCheck.error}
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <label
                htmlFor="supabase-url"
                className="block font-mono text-[11px] text-slate-300"
              >
                Supabase Project URL
              </label>
              <input
                id="supabase-url"
                type="url"
                value={draft.supabaseUrl}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, supabaseUrl: e.target.value }))
                }
                placeholder="https://xxxxxxxxxxxx.supabase.co"
                className="glass-inset w-full rounded-xl px-3.5 py-2.5 font-mono text-xs text-slate-100 placeholder:text-slate-500 focus:border-[#5eead4] focus:outline-none"
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="supabase-anon-key"
                className="block font-mono text-[11px] text-slate-300"
              >
                Supabase Anon Public Key
              </label>
              <input
                id="supabase-anon-key"
                type="password"
                value={draft.supabaseAnonKey}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, supabaseAnonKey: e.target.value }))
                }
                placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6..."
                className="glass-inset w-full rounded-xl px-3.5 py-2.5 font-mono text-xs text-slate-100 placeholder:text-slate-500 focus:border-[#5eead4] focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* Section 2: Google OAuth Client ID */}
        <div className="space-y-2 border-t border-white/[0.08] pt-5">
          <label
            htmlFor="google-client-id"
            className="block font-mono text-xs font-medium text-slate-100"
          >
            Google OAuth Client ID (Web Application)
          </label>
          <input
            id="google-client-id"
            type="text"
            value={draft.googleClientId}
            onChange={(e) =>
              setDraft((prev) => ({ ...prev, googleClientId: e.target.value }))
            }
            placeholder="1234567890-xxxxxxxx.apps.googleusercontent.com"
            className="glass-inset w-full rounded-xl px-3.5 py-2.5 font-mono text-xs text-slate-100 placeholder:text-slate-500 focus:border-[#5eead4] focus:outline-none"
          />
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-3.5 py-2.5 text-[11px] leading-relaxed text-slate-300/85">
            <div className="flex items-center gap-1.5 font-mono text-[#5eead4]">
              <AlertTriangle className="h-3.5 w-3.5" />
              <span>Authorized JavaScript Origin for Google Cloud Console:</span>
            </div>
            <div className="mt-1 select-all font-mono text-slate-100">{originHint}</div>
            <div className="mt-1 text-slate-400">
              Requested scopes: {GOOGLE_OAUTH_SCOPES.join(", ")}
            </div>
          </div>
        </div>

        {/* Section 3: Webhooks (Slack + n8n) */}
        <div className="grid grid-cols-1 gap-4 border-t border-white/[0.08] pt-5 md:grid-cols-2">
          <div className="space-y-2">
            <label
              htmlFor="slack-webhook"
              className="flex items-center gap-1.5 font-mono text-xs font-medium text-slate-100"
            >
              <Webhook className="h-3.5 w-3.5 text-[#5eead4]" />
              Slack Webhook URL (Optional)
            </label>
            <input
              id="slack-webhook"
              type="url"
              value={draft.slackWebhookUrl}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, slackWebhookUrl: e.target.value }))
              }
              placeholder="https://hooks.slack.com/services/T000/B000/XXXX"
              className="glass-inset w-full rounded-xl px-3.5 py-2.5 font-mono text-xs text-slate-100 placeholder:text-slate-500 focus:border-[#5eead4] focus:outline-none"
            />
          </div>

          <div className="space-y-2">
            <label
              htmlFor="n8n-webhook"
              className="flex items-center gap-1.5 font-mono text-xs font-medium text-slate-100"
            >
              <ExternalLink className="h-3.5 w-3.5 text-[#5eead4]" />
              n8n / Zapier Webhook URL (Optional)
            </label>
            <input
              id="n8n-webhook"
              type="url"
              value={draft.n8nWebhookUrl}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, n8nWebhookUrl: e.target.value }))
              }
              placeholder="https://your-n8n-instance/webhook/meetmind"
              className="glass-inset w-full rounded-xl px-3.5 py-2.5 font-mono text-xs text-slate-100 placeholder:text-slate-500 focus:border-[#5eead4] focus:outline-none"
            />
          </div>
        </div>

        {/* Section 4: Gemini Model & Execution Safety (Test Mode) */}
        <div className="grid grid-cols-1 gap-5 border-t border-white/[0.08] pt-5 md:grid-cols-2">
          <div className="space-y-2">
            <label
              htmlFor="gemini-model-name"
              className="block font-mono text-xs font-medium text-slate-100"
            >
              Gemini Model Name
            </label>
            <input
              id="gemini-model-name"
              type="text"
              value={draft.geminiModel}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, geminiModel: e.target.value }))
              }
              placeholder={DEFAULT_GEMINI_MODEL}
              className="glass-inset w-full rounded-xl px-3.5 py-2.5 font-mono text-xs text-slate-100 placeholder:text-slate-500 focus:border-[#5eead4] focus:outline-none"
            />
            <p className="text-[11px] text-slate-400">
              Default: <span className="font-mono text-[#5eead4]">{DEFAULT_GEMINI_MODEL}</span>{" "}
              (server API key is managed securely in environment secrets).
            </p>
          </div>

          <div className="space-y-2.5 rounded-xl border border-white/[0.09] bg-white/[0.03] p-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="font-mono text-xs font-medium text-slate-100">
                  Test Mode (Email Safety Guard)
                </div>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  Redirects outgoing Gmail drafts &amp; sends exclusively to your own Google email.
                </p>
              </div>
              <input
                type="checkbox"
                checked={draft.testMode}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, testMode: e.target.checked }))
                }
                aria-label="Enable Test Mode"
                className="h-4 w-4 rounded border-white/25 bg-[#071318] accent-[#5eead4]"
              />
            </div>

            <div>
              <label
                htmlFor="test-mode-email"
                className="block font-mono text-[10px] text-slate-400"
              >
                Test Recipient Override (defaults to signed-in Google email)
              </label>
              <input
                id="test-mode-email"
                type="email"
                value={draft.testEmail}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, testEmail: e.target.value }))
                }
                placeholder={googleSession?.userEmail || "your-email@gmail.com"}
                className="glass-inset mt-1 w-full rounded-xl px-3 py-2 font-mono text-xs text-slate-100 placeholder:text-slate-500 focus:border-[#5eead4] focus:outline-none"
              />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-white/[0.08] pt-4">
          <button
            type="submit"
            disabled={isSaving}
            className="btn-glazed-primary inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-xs font-semibold disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" />
            {isSaving ? "Saving..." : "Save Settings"}
          </button>
        </div>
      </form>
    </div>
  );
}
