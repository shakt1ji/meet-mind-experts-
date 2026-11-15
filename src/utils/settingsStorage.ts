import type { AppSettings, CustomConnector } from "../types/meetmind";

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
  customConnectors: [],
};

export const CONNECTOR_TEMPLATES: Array<{
  label: string;
  connector: Omit<CustomConnector, "id">;
}> = [
  {
    label: "Notion Database Task",
    connector: {
      name: "Notion Tasks",
      toolName: "create_notion_task",
      description:
        "Create a task page in Notion whenever a meeting action item or follow-up task needs tracking.",
      method: "POST",
      endpointUrl: "",
      authHeaderName: "Authorization",
      authHeaderValue: "",
      extraHeadersJson: '{"Notion-Version": "2022-06-28"}',
      payloadTemplate: "",
      enabled: true,
      params: [
        { name: "title", type: "string", description: "Short task title", required: true },
        { name: "owner", type: "string", description: "Assigned person name", required: true },
        { name: "dueDate", type: "string", description: "Resolved deadline e.g. Fri 21 Nov", required: false },
        { name: "priority", type: "string", description: "High, Medium, or Low", required: false },
      ],
    },
  },
  {
    label: "Jira / Linear Issue",
    connector: {
      name: "Jira / Linear Issue",
      toolName: "create_tracker_issue",
      description:
        "Create an engineering bug or complaint ticket in Jira/Linear when a technical issue or blocker is reported.",
      method: "POST",
      endpointUrl: "",
      authHeaderName: "Authorization",
      authHeaderValue: "",
      extraHeadersJson: "",
      payloadTemplate: "",
      enabled: true,
      params: [
        { name: "summary", type: "string", description: "Concise issue title", required: true },
        { name: "assignee", type: "string", description: "Owner name", required: true },
        { name: "severity", type: "string", description: "High, Medium, or Low", required: true },
        { name: "quote", type: "string", description: "Transcript quote", required: false },
      ],
    },
  },
  {
    label: "WhatsApp / Telegram Bot",
    connector: {
      name: "WhatsApp / Telegram Alert",
      toolName: "send_messaging_alert",
      description:
        "Send a concise summary and urgent action deadlines to WhatsApp/Telegram bot webhook.",
      method: "POST",
      endpointUrl: "",
      authHeaderName: "Authorization",
      authHeaderValue: "",
      extraHeadersJson: "",
      payloadTemplate: "",
      enabled: true,
      params: [
        { name: "message", type: "string", description: "Short formatted alert message", required: true },
        { name: "recipient", type: "string", description: "Target group or contact name", required: false },
      ],
    },
  },
  {
    label: "Google Sheets / Airtable Row",
    connector: {
      name: "Sheets / Airtable Row",
      toolName: "append_crm_row",
      description:
        "Append a structured meeting log row (client, decisions, next steps, owner) to Google Sheets or Airtable.",
      method: "POST",
      endpointUrl: "",
      authHeaderName: "Authorization",
      authHeaderValue: "",
      extraHeadersJson: "",
      payloadTemplate: "",
      enabled: true,
      params: [
        { name: "clientOrProject", type: "string", description: "Client or project name", required: true },
        { name: "actionSummary", type: "string", description: "Key takeaways & action items", required: true },
        { name: "nextFollowUp", type: "string", description: "Next follow-up date", required: false },
      ],
    },
  },
];

function sanitizeConnectors(raw: unknown): CustomConnector[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is CustomConnector => Boolean(item && typeof item === "object"))
    .map((c, idx) => ({
      id: typeof c.id === "string" && c.id.trim() ? c.id : `conn_${idx}`,
      name: typeof c.name === "string" ? c.name.trim() : "Custom Tool",
      toolName:
        typeof c.toolName === "string" && c.toolName.trim()
          ? c.toolName.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_")
          : `custom_tool_${idx}`,
      description: typeof c.description === "string" ? c.description.trim() : "",
      method:
        c.method === "GET" || c.method === "PUT" || c.method === "PATCH"
          ? c.method
          : "POST",
      endpointUrl: typeof c.endpointUrl === "string" ? c.endpointUrl.trim() : "",
      authHeaderName: typeof c.authHeaderName === "string" ? c.authHeaderName.trim() : "",
      authHeaderValue: typeof c.authHeaderValue === "string" ? c.authHeaderValue.trim() : "",
      extraHeadersJson: typeof c.extraHeadersJson === "string" ? c.extraHeadersJson : "",
      payloadTemplate: typeof c.payloadTemplate === "string" ? c.payloadTemplate : "",
      params: Array.isArray(c.params)
        ? c.params.map((p) => ({
            name: typeof p.name === "string" ? p.name.trim() : "",
            type:
              p.type === "number" || p.type === "boolean" ? p.type : "string",
            description: typeof p.description === "string" ? p.description.trim() : "",
            required: Boolean(p.required),
          }))
        : [],
      enabled: typeof c.enabled === "boolean" ? c.enabled : true,
    }));
}

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
      customConnectors: sanitizeConnectors(parsed.customConnectors),
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
