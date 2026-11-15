import type { AppSettings } from "../types/meetmind";

const SETTINGS_STORAGE_KEY = "meetmind_settings_v2";

export const DEFAULT_GEMINI_MODEL = "gemini-4-hydrogen";

export const DEFAULT_APP_SETTINGS: AppSettings = {
  supabaseUrl: "",
  supabaseAnonKey: "",
  googleClientId: "",
  slackWebhookUrl: "",
  n8nWebhookUrl: "",
  geminiModel: DEFAULT_GEMINI_MODEL,
  testMode: true,
  testEmail: "",
};

export function loadAppSettings(): AppSettings {
  if (typeof window === "undefined") {
    return DEFAULT_APP_SETTINGS;
  }

  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_APP_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      supabaseUrl:
        typeof parsed.supabaseUrl === "string" ? parsed.supabaseUrl.trim() : "",
      supabaseAnonKey:
        typeof parsed.supabaseAnonKey === "string"
          ? parsed.supabaseAnonKey.trim()
          : "",
      googleClientId:
        typeof parsed.googleClientId === "string" ? parsed.googleClientId.trim() : "",
      slackWebhookUrl:
        typeof parsed.slackWebhookUrl === "string" ? parsed.slackWebhookUrl.trim() : "",
      n8nWebhookUrl:
        typeof parsed.n8nWebhookUrl === "string" ? parsed.n8nWebhookUrl.trim() : "",
      geminiModel:
        typeof parsed.geminiModel === "string" && parsed.geminiModel.trim()
          ? parsed.geminiModel.trim()
          : DEFAULT_GEMINI_MODEL,
      testMode: typeof parsed.testMode === "boolean" ? parsed.testMode : true,
      testEmail:
        typeof parsed.testEmail === "string" ? parsed.testEmail.trim() : "",
    };
  } catch {
    return DEFAULT_APP_SETTINGS;
  }
}

export function saveAppSettings(settings: AppSettings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage quota errors
  }
}

export function validateSupabaseInputs(
  url: string,
  anonKey: string
): { valid: boolean; error?: string } {
  const cleanUrl = (url || "").trim();
  const cleanKey = (anonKey || "").trim();
  if (!cleanUrl && !cleanKey) {
    return { valid: false, error: "Supabase URL and anon key not configured." };
  }
  if (!cleanUrl) {
    return { valid: false, error: "Missing Supabase Project URL." };
  }
  try {
    const parsed = new URL(cleanUrl);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return { valid: false, error: "Supabase URL must start with https://" };
    }
  } catch {
    return { valid: false, error: "Invalid Supabase Project URL format." };
  }
  if (!cleanKey || cleanKey.length < 20) {
    return { valid: false, error: "Missing or invalid Supabase anon public key." };
  }
  return { valid: true };
}
