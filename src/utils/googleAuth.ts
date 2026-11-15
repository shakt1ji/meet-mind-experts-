/**
 * Client-side Google Identity Services (GIS) OAuth + real Gmail, Google Calendar & Google Slides API helpers.
 * Never hardcodes Client IDs or secrets; reads Client ID from user's Settings.
 */
import type { SlideDeckData } from "../types/meetmind";

const GIS_SCRIPT_URL = "https://accounts.google.com/gsi/client";
const TOKEN_SESSION_KEY = "meetmind_google_oauth_token_v1";

export const GOOGLE_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/presentations",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/userinfo.email",
];

export interface GoogleAuthSession {
  accessToken: string;
  expiresAt: number;
  scope: string;
  connectedAt: string;
  userEmail?: string;
}

export class GoogleTokenExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleTokenExpiredError";
  }
}

interface GisTokenResponse {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface GisTokenClient {
  requestAccessToken: (overrideConfig?: { prompt?: string }) => void;
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (response: GisTokenResponse) => void;
            error_callback?: (err: { type?: string; message?: string }) => void;
          }) => GisTokenClient;
          revoke?: (token: string, done: () => void) => void;
        };
      };
    };
  }
}

let gisLoadPromise: Promise<void> | null = null;

export function loadGoogleIdentityScript(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Google OAuth is only available in the browser."));
  }
  if (window.google?.accounts?.oauth2) {
    return Promise.resolve();
  }
  if (gisLoadPromise) return gisLoadPromise;

  gisLoadPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector(`script[src="${GIS_SCRIPT_URL}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () =>
        reject(new Error("Could not load Google Identity Services script."))
      );
      return;
    }

    const script = document.createElement("script");
    script.src = GIS_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error("Could not load https://accounts.google.com/gsi/client."));
    document.head.appendChild(script);
  });

  return gisLoadPromise;
}

export function getStoredGoogleSession(): GoogleAuthSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(TOKEN_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GoogleAuthSession;
    if (!parsed.accessToken || !parsed.expiresAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function isGoogleSessionValid(session: GoogleAuthSession | null): boolean {
  if (!session) return false;
  return Date.now() < session.expiresAt - 15_000;
}

export function saveGoogleSession(session: GoogleAuthSession | null): void {
  if (typeof window === "undefined") return;
  if (!session) {
    window.sessionStorage.removeItem(TOKEN_SESSION_KEY);
    return;
  }
  window.sessionStorage.setItem(TOKEN_SESSION_KEY, JSON.stringify(session));
}

async function fetchGoogleUserEmail(accessToken: string): Promise<string | undefined> {
  try {
    const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.ok) {
      const data = (await res.json()) as { email?: string };
      if (data.email) return data.email;
    }
  } catch {
    // Ignore userinfo lookup errors
  }
  return undefined;
}

export async function connectGoogleAccount(clientId: string): Promise<GoogleAuthSession> {
  const trimmed = (clientId || "").trim();
  if (!trimmed) {
    throw new Error("Enter your Google OAuth Client ID in Settings before connecting Google.");
  }

  await loadGoogleIdentityScript();
  const oauth2 = window.google?.accounts?.oauth2;
  if (!oauth2) {
    throw new Error("Google Identity Services failed to initialize.");
  }

  return new Promise<GoogleAuthSession>((resolve, reject) => {
    const tokenClient = oauth2.initTokenClient({
      client_id: trimmed,
      scope: GOOGLE_OAUTH_SCOPES.join(" "),
      callback: (resp) => {
        if (resp.error || !resp.access_token) {
          reject(
            new Error(
              resp.error_description ||
                resp.error ||
                "Google Sign-In did not return an access token."
            )
          );
          return;
        }
        const token = resp.access_token;
        const expiresInSec = Number(resp.expires_in) || 3500;
        void fetchGoogleUserEmail(token).then((userEmail) => {
          const session: GoogleAuthSession = {
            accessToken: token,
            expiresAt: Date.now() + expiresInSec * 1000,
            scope: resp.scope || GOOGLE_OAUTH_SCOPES.join(" "),
            connectedAt: new Date().toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            }),
            userEmail,
          };
          saveGoogleSession(session);
          resolve(session);
        });
      },
      error_callback: (err) => {
        reject(
          new Error(
            err?.message ||
              "Google Sign-In popup was closed or blocked. Allow popups and check Authorized JavaScript origins in Google Cloud Console."
          )
        );
      },
    });

    tokenClient.requestAccessToken({ prompt: "consent" });
  });
}

export function disconnectGoogleAccount(): void {
  const current = getStoredGoogleSession();
  if (current?.accessToken && window.google?.accounts?.oauth2?.revoke) {
    try {
      window.google.accounts.oauth2.revoke(current.accessToken, () => {});
    } catch {
      // Ignore revoke error
    }
  }
  saveGoogleSession(null);
}

function encodeBase64UrlUtf8(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export interface EmailAttachmentInput {
  filename: string;
  mimeType: string;
  base64Data: string;
}

function buildMimeEmail(
  to: string,
  subject: string,
  body: string,
  attachment?: EmailAttachmentInput
): string {
  const encodedSubject = `=?UTF-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`;

  if (!attachment) {
    const lines = [
      `To: ${to}`,
      `Subject: ${encodedSubject}`,
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: 8bit",
      "",
      body,
    ];
    return encodeBase64UrlUtf8(lines.join("\r\n"));
  }

  const boundary = `meetmind_boundary_${Date.now()}`;
  const wrappedBase64 = attachment.base64Data.replace(/(.{76})/g, "$1\r\n");
  const lines = [
    `To: ${to}`,
    `Subject: ${encodedSubject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    body,
    "",
    `--${boundary}`,
    `Content-Type: ${attachment.mimeType}; name="${attachment.filename}"`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${attachment.filename}"`,
    "",
    wrappedBase64,
    "",
    `--${boundary}--`,
  ];
  return encodeBase64UrlUtf8(lines.join("\r\n"));
}

export async function createGmailDraft(
  accessToken: string,
  params: {
    to: string;
    subject: string;
    body: string;
    attachment?: EmailAttachmentInput;
  }
): Promise<{ draftId: string; messageId: string; draftUrl: string }> {
  const raw = buildMimeEmail(params.to, params.subject, params.body, params.attachment);

  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: { raw },
    }),
  });

  if (response.status === 401 || response.status === 403) {
    saveGoogleSession(null);
    throw new GoogleTokenExpiredError(
      "Gmail authorization expired or lacks compose scope. Reconnect Google in Settings, then click Resume."
    );
  }

  const data = (await response.json().catch(() => ({}))) as {
    id?: string;
    message?: { id?: string };
    error?: { message?: string };
  };

  if (!response.ok || !data.id) {
    throw new Error(
      data.error?.message || `Gmail Draft API returned status ${response.status}.`
    );
  }

  const messageId = data.message?.id || data.id;
  return {
    draftId: data.id,
    messageId,
    draftUrl: `https://mail.google.com/mail/u/0/#drafts?compose=${encodeURIComponent(
      messageId
    )}`,
  };
}

export async function sendGmailDraft(
  accessToken: string,
  draftId: string
): Promise<{ id: string; sentAt: string }> {
  const response = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/drafts/send",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id: draftId }),
    }
  );

  if (response.status === 401 || response.status === 403) {
    saveGoogleSession(null);
    throw new GoogleTokenExpiredError(
      "Gmail send permission expired. Reconnect Google in Settings, then click Resume."
    );
  }

  const data = (await response.json().catch(() => ({}))) as {
    id?: string;
    error?: { message?: string };
  };

  if (!response.ok) {
    throw new Error(
      data.error?.message || `Gmail Send API returned status ${response.status}.`
    );
  }

  const now = new Date();
  const sentAt = `${String(now.getHours()).padStart(2, "0")}:${String(
    now.getMinutes()
  ).padStart(2, "0")}`;

  return {
    id: data.id || draftId,
    sentAt,
  };
}

function parseDateToIsoRange(
  dateStr: string,
  timeStr: string,
  durationMins: number
): { startIso: string; endIso: string } {
  const MONTHS: Record<string, number> = {
    jan: 0,
    feb: 1,
    mar: 2,
    apr: 3,
    may: 4,
    jun: 5,
    jul: 6,
    aug: 7,
    sep: 8,
    oct: 9,
    nov: 10,
    dec: 11,
  };

  const now = new Date();
  let start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 16, 0, 0);

  const isoMatch = (dateStr || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  const shortMatch = (dateStr || "").match(/(\d{1,2})\s+([A-Za-z]{3})/);

  if (isoMatch) {
    start = new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]), 16, 0, 0);
  } else if (shortMatch) {
    const day = Number(shortMatch[1]) || now.getDate();
    const mon = MONTHS[shortMatch[2].toLowerCase()];
    if (mon !== undefined) {
      start = new Date(now.getFullYear(), mon, day, 16, 0, 0);
    }
  }

  const timeMatch = (timeStr || "").match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (timeMatch) {
    let hrs = Number(timeMatch[1]) || 16;
    const mins = Number(timeMatch[2]) || 0;
    const mer = (timeMatch[3] || "").toUpperCase();
    if (mer === "PM" && hrs < 12) hrs += 12;
    if (mer === "AM" && hrs === 12) hrs = 0;
    start.setHours(hrs, mins, 0, 0);
  }

  const end = new Date(start.getTime() + (durationMins || 30) * 60_000);
  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
}

export async function createGoogleCalendarEvent(
  accessToken: string,
  params: {
    title: string;
    date: string;
    time?: string;
    durationMins?: number;
    attendees?: string[];
    description?: string;
  }
): Promise<{ id: string; htmlLink: string }> {
  const { startIso, endIso } = parseDateToIsoRange(
    params.date,
    params.time || "16:00",
    params.durationMins || 30
  );

  const attendeeList = (params.attendees || [])
    .map((e) => e.trim())
    .filter((e) => e.includes("@"))
    .map((email) => ({ email }));

  const response = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        summary: params.title,
        description: params.description || "Created automatically by MeetMind.",
        start: { dateTime: startIso },
        end: { dateTime: endIso },
        ...(attendeeList.length > 0 ? { attendees: attendeeList } : {}),
      }),
    }
  );

  if (response.status === 401 || response.status === 403) {
    saveGoogleSession(null);
    throw new GoogleTokenExpiredError(
      "Google Calendar authorization expired. Reconnect Google in Settings, then click Resume."
    );
  }

  const data = (await response.json().catch(() => ({}))) as {
    id?: string;
    htmlLink?: string;
    error?: { message?: string };
  };

  if (!response.ok || !data.id) {
    throw new Error(
      data.error?.message || `Google Calendar API returned status ${response.status}.`
    );
  }

  return {
    id: data.id,
    htmlLink: data.htmlLink || "https://calendar.google.com/calendar",
  };
}

export async function createGoogleSlidesPresentation(
  accessToken: string,
  deck: SlideDeckData
): Promise<{ presentationId: string; presentationUrl: string }> {
  // 1. Create empty Google Slides presentation
  const createRes = await fetch("https://slides.googleapis.com/v1/presentations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title: deck.deckTitle || "MeetMind Presentation",
    }),
  });

  if (createRes.status === 401 || createRes.status === 403) {
    saveGoogleSession(null);
    throw new GoogleTokenExpiredError(
      "Google Slides permission expired or missing. Reconnect Google in Settings, then click Resume."
    );
  }

  const created = (await createRes.json().catch(() => ({}))) as {
    presentationId?: string;
    slides?: Array<{ objectId?: string }>;
    error?: { message?: string };
  };

  if (!createRes.ok || !created.presentationId) {
    throw new Error(
      created.error?.message || `Google Slides API returned status ${createRes.status}.`
    );
  }

  const presentationId = created.presentationId;
  const requests: Array<Record<string, unknown>> = [];

  // Delete initial blank default slide if present so our clean slides come first
  const defaultSlideId = created.slides?.[0]?.objectId;

  const slidesToWrite = deck.slides.slice(0, 8);
  slidesToWrite.forEach((slide, idx) => {
    const slideId = `mm_slide_${idx}`;
    const titleBoxId = `mm_title_${idx}`;
    const bodyBoxId = `mm_body_${idx}`;

    requests.push({
      createSlide: {
        objectId: slideId,
        insertionIndex: idx,
        slideLayoutReference: { predefinedLayout: "BLANK" },
      },
    });

    // Dark background fill matching MeetMind aesthetic
    requests.push({
      updatePageProperties: {
        objectId: slideId,
        pageProperties: {
          pageBackgroundFill: {
            solidFill: {
              color: { rgbColor: { red: 0.03, green: 0.08, blue: 0.1 } },
            },
          },
        },
        fields: "pageBackgroundFill.solidFill.color",
      },
    });

    // Title text box
    requests.push({
      createShape: {
        objectId: titleBoxId,
        shapeType: "TEXT_BOX",
        elementProperties: {
          pageObjectId: slideId,
          size: {
            width: { magnitude: 640, unit: "PT" },
            height: { magnitude: 75, unit: "PT" },
          },
          transform: {
            scaleX: 1,
            scaleY: 1,
            translateX: 40,
            translateY: 36,
            unit: "PT",
          },
        },
      },
    });

    const headerText = slide.subtitle
      ? `${slide.title}\n${slide.subtitle}`
      : slide.title;

    requests.push({
      insertText: {
        objectId: titleBoxId,
        text: headerText,
        insertionIndex: 0,
      },
    });

    requests.push({
      updateTextStyle: {
        objectId: titleBoxId,
        style: {
          foregroundColor: {
            opaqueColor: { rgbColor: { red: 0.37, green: 0.92, blue: 0.83 } },
          },
          fontSize: { magnitude: idx === 0 ? 28 : 22, unit: "PT" },
          bold: true,
        },
        fields: "foregroundColor,fontSize,bold",
      },
    });

    // Body bullets text box
    const bodyLines = (slide.bullets || []).map((b) => `• ${b}`).join("\n");
    if (bodyLines) {
      requests.push({
        createShape: {
          objectId: bodyBoxId,
          shapeType: "TEXT_BOX",
          elementProperties: {
            pageObjectId: slideId,
            size: {
              width: { magnitude: 640, unit: "PT" },
              height: { magnitude: 240, unit: "PT" },
            },
            transform: {
              scaleX: 1,
              scaleY: 1,
              translateX: 40,
              translateY: 126,
              unit: "PT",
            },
          },
        },
      });

      requests.push({
        insertText: {
          objectId: bodyBoxId,
          text: bodyLines,
          insertionIndex: 0,
        },
      });

      requests.push({
        updateTextStyle: {
          objectId: bodyBoxId,
          style: {
            foregroundColor: {
              opaqueColor: { rgbColor: { red: 0.92, green: 0.95, blue: 0.97 } },
            },
            fontSize: { magnitude: 15, unit: "PT" },
          },
          fields: "foregroundColor,fontSize",
        },
      });
    }
  });

  if (defaultSlideId && slidesToWrite.length > 0) {
    requests.push({
      deleteObject: { objectId: defaultSlideId },
    });
  }

  if (requests.length > 0) {
    const batchRes = await fetch(
      `https://slides.googleapis.com/v1/presentations/${encodeURIComponent(
        presentationId
      )}:batchUpdate`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ requests }),
      }
    );

    if (!batchRes.ok) {
      const batchErr = (await batchRes.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      throw new Error(
        batchErr.error?.message ||
          `Google Slides batchUpdate failed with status ${batchRes.status}.`
      );
    }
  }

  return {
    presentationId,
    presentationUrl: `https://docs.google.com/presentation/d/${presentationId}/edit`,
  };
}

