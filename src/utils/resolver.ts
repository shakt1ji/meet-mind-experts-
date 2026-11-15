import type {
  ExtractedItem,
  ExtractedKind,
  Person,
  RawExtractedItem,
  RawExtractedType,
  ResolutionStatus,
  Segment,
} from "../types/meetmind";

const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const WEEKDAY_NAMES: Record<string, number> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
};

const VAGUE_OWNERS = new Set([
  "",
  "none",
  "null",
  "unassigned",
  "someone",
  "somebody",
  "anyone",
  "anybody",
  "team",
  "we",
  "us",
  "tbd",
  "unknown",
  "n/a",
]);

export function mapTypeToKind(type: RawExtractedType): ExtractedKind {
  switch (type) {
    case "decision":
      return "Decision";
    case "action":
      return "Action";
    case "complaint":
      return "Complaint";
    case "commit":
      return "Commit";
  }
}

export function formatShortDate(date: Date): string {
  const wd = WEEKDAYS_SHORT[date.getDay()];
  const day = date.getDate();
  const mon = MONTHS_SHORT[date.getMonth()];
  return `${wd} ${day} ${mon}`;
}

export function parseMeetingDate(meetingDateStr: string): Date {
  // Expected formats like "14 Nov 2026" or "14 Nov" or ISO
  const cleaned = meetingDateStr.trim();
  const match = cleaned.match(/^(\d{1,2})\s+([A-Za-z]{3,})(?:\s+(\d{4}))?$/);
  if (match) {
    const day = Number(match[1]);
    const monInput = match[2].slice(0, 3).toLowerCase();
    const monIdx = MONTHS_SHORT.findIndex((m) => m.toLowerCase() === monInput);
    const year = match[3] ? Number(match[3]) : 2026;
    if (monIdx !== -1 && day >= 1 && day <= 31) {
      return new Date(year, monIdx, day);
    }
  }
  const fallback = new Date(cleaned);
  if (!Number.isNaN(fallback.getTime())) {
    return fallback;
  }
  return new Date(2026, 10, 14);
}

/**
 * Resolves relative due strings ("Friday", "next Thursday", "today", "tomorrow")
 * relative to the meeting date and formats as e.g. "Fri 20 Nov".
 */
export function resolveRelativeDate(rawDue: string, meetingDateStr: string): string {
  const raw = (rawDue || "").trim();
  if (!raw || raw.toLowerCase() === "tbd" || raw.toLowerCase() === "none") {
    return "TBD";
  }

  const base = parseMeetingDate(meetingDateStr);
  const lower = raw.toLowerCase();

  // Extract optional time qualifier such as "EOD", "6 PM", "4 PM IST", "2 PM"
  const timeMatch = raw.match(/\b(\d{1,2}(?::\d{2})?\s?(?:AM|PM)(?:\s?IST)?|EOD)\b/i);
  const timeSuffix = timeMatch ? ` · ${timeMatch[1].toUpperCase()}` : "";

  if (/\b(today|aaj|aaj hi)\b/.test(lower)) {
    return `${formatShortDate(base)}${timeSuffix}`;
  }

  if (/\b(tomorrow|kal)\b/.test(lower)) {
    const d = new Date(base);
    d.setDate(d.getDate() + 1);
    return `${formatShortDate(d)}${timeSuffix}`;
  }

  if (/\bnext week\b/.test(lower)) {
    const d = new Date(base);
    d.setDate(d.getDate() + 7);
    return `${formatShortDate(d)}${timeSuffix}`;
  }

  // Match "next <weekday>" or "<weekday>"
  const weekdayMatch = lower.match(
    /\b(next\s+|this\s+)?(sunday|sun|monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thu|friday|fri|saturday|sat)\b/
  );
  if (weekdayMatch) {
    const modifier = (weekdayMatch[1] || "").trim();
    const targetDay = WEEKDAY_NAMES[weekdayMatch[2]];
    if (targetDay !== undefined) {
      const currentDay = base.getDay();
      let delta = (targetDay - currentDay + 7) % 7;
      if (delta === 0) delta = 7;

      // When "next <weekday>" is used and the day is within the coming few days,
      // interpret consistently: if modifier === 'next' and delta <= 3, push +7
      if (modifier === "next" && delta <= 3) {
        delta += 7;
      }

      const target = new Date(base);
      target.setDate(target.getDate() + delta);
      return `${formatShortDate(target)}${timeSuffix}`;
    }
  }

  if (/\bnext sprint\b/.test(lower)) {
    const d = new Date(base);
    d.setDate(d.getDate() + 10);
    return formatShortDate(d);
  }

  if (/\bq4 close\b/.test(lower)) {
    return "Wed 31 Dec";
  }

  return raw;
}

export function normalizeQuoteText(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

export function findSupportingSegment(
  quote: string,
  preferredSegmentId: string,
  segments: Segment[]
): Segment | null {
  const normQuote = normalizeQuoteText(quote);
  if (!normQuote || normQuote.length < 3) return null;

  const preferred = segments.find((s) => s.id === preferredSegmentId);
  if (preferred && normalizeQuoteText(preferred.text).includes(normQuote)) {
    return preferred;
  }

  for (const seg of segments) {
    if (normalizeQuoteText(seg.text).includes(normQuote)) {
      return seg;
    }
  }

  return null;
}

export function resolveOwner(
  rawOwner: string,
  itemType: RawExtractedType,
  roster: Person[]
): {
  ownerId: string | null;
  ownerCandidates: string[];
  status: ResolutionStatus;
  reason?: string;
} {
  const cleaned = (rawOwner || "").trim();
  const lower = cleaned.toLowerCase();

  if (VAGUE_OWNERS.has(lower)) {
    if (itemType === "action" || itemType === "commit") {
      return {
        ownerId: null,
        ownerCandidates: roster.map((p) => p.id),
        status: "unowned",
        reason: `Unowned ${itemType} ("${cleaned || "no owner specified"}") — assign an owner to track execution.`,
      };
    }
    return {
      ownerId: null,
      ownerCandidates: roster.map((p) => p.id),
      status: "unowned",
      reason: `No specific owner named for this ${itemType}.`,
    };
  }

  // 1. Exact full name match
  const exactMatch = roster.find((p) => p.name.toLowerCase() === lower);
  if (exactMatch) {
    return {
      ownerId: exactMatch.id,
      ownerCandidates: [exactMatch.id],
      status: "confirmed",
    };
  }

  // 2. Token / first-name / partial match (e.g. "Raj" matches "Raj Patel" and "Raj Mehta")
  const tokenMatches = roster.filter((p) => {
    const tokens = p.name.toLowerCase().split(/\s+/);
    return (
      tokens.some((t) => t === lower) ||
      p.name.toLowerCase().includes(lower) ||
      lower.includes(p.name.toLowerCase())
    );
  });

  if (tokenMatches.length === 1) {
    return {
      ownerId: tokenMatches[0].id,
      ownerCandidates: [tokenMatches[0].id],
      status: "confirmed",
    };
  }

  if (tokenMatches.length > 1) {
    const namesList = tokenMatches.map((p) => `${p.name} (${p.role})`).join(" and ");
    return {
      ownerId: null,
      ownerCandidates: tokenMatches.map((p) => p.id),
      status: "ambiguous",
      reason: `Ambiguous owner "${cleaned}" — matches ${namesList}.`,
    };
  }

  return {
    ownerId: null,
    ownerCandidates: roster.map((p) => p.id),
    status: "unowned",
    reason: `Owner "${cleaned}" did not match anyone on the roster.`,
  };
}

export function validateRawExtractionResponse(data: unknown): {
  valid: boolean;
  items: RawExtractedItem[];
  summary: string;
  error?: string;
} {
  if (!data || typeof data !== "object") {
    return { valid: false, items: [], summary: "", error: "Response is not a JSON object." };
  }

  const obj = data as Record<string, unknown>;
  if (!Array.isArray(obj.items)) {
    return { valid: false, items: [], summary: "", error: "Missing items array in JSON output." };
  }

  const validTypes = new Set(["decision", "action", "complaint", "commit"]);
  const validItems: RawExtractedItem[] = [];

  for (let i = 0; i < obj.items.length; i++) {
    const item = obj.items[i] as Record<string, unknown>;
    if (!item || typeof item !== "object") {
      return { valid: false, items: [], summary: "", error: `Item at index ${i} is not an object.` };
    }

    const type = typeof item.type === "string" ? item.type.toLowerCase() : "";
    if (!validTypes.has(type)) {
      return {
        valid: false,
        items: [],
        summary: "",
        error: `Item ${i} has invalid type "${String(item.type)}".`,
      };
    }

    if (typeof item.title !== "string" || !item.title.trim()) {
      return { valid: false, items: [], summary: "", error: `Item ${i} is missing title.` };
    }

    if (typeof item.quote !== "string" || !item.quote.trim()) {
      return { valid: false, items: [], summary: "", error: `Item ${i} is missing quote.` };
    }

    if (typeof item.segmentId !== "string" || typeof item.timestamp !== "string") {
      return {
        valid: false,
        items: [],
        summary: "",
        error: `Item ${i} is missing segmentId or timestamp.`,
      };
    }

    if (typeof item.rawOwner !== "string" || typeof item.rawDue !== "string") {
      return {
        valid: false,
        items: [],
        summary: "",
        error: `Item ${i} is missing rawOwner or rawDue.`,
      };
    }

    const conf = item.confidence;
    if (typeof conf !== "number" || Number.isNaN(conf) || conf < 0 || conf > 1) {
      return {
        valid: false,
        items: [],
        summary: "",
        error: `Item ${i} confidence must be between 0 and 1.`,
      };
    }

    validItems.push({
      type: type as RawExtractedType,
      title: item.title.trim(),
      quote: item.quote.trim(),
      segmentId: item.segmentId.trim(),
      timestamp: item.timestamp.trim(),
      rawOwner: item.rawOwner.trim(),
      rawDue: item.rawDue.trim(),
      confidence: conf,
    });
  }

  return {
    valid: true,
    items: validItems,
    summary: typeof obj.summary === "string" ? obj.summary.trim() : "",
  };
}

/**
 * Deterministic post-processor for Gemini JSON output:
 * 1. Verifies every item has a verbatim supporting quote in the transcript (never invents items).
 * 2. Maps rawOwner -> Person (detecting "ambiguous" multi-matches like Raj and "unowned" actions).
 * 3. Resolves relative dates against meetingDate.
 * 4. Routes confidence < 0.7 or ambiguous/unowned items to the confirmation tray.
 */
export function resolveExtractedItems(
  rawItems: RawExtractedItem[],
  segments: Segment[],
  roster: Person[],
  meetingDate: string,
  meetingId: string
): ExtractedItem[] {
  const resolved: ExtractedItem[] = [];

  rawItems.forEach((raw, idx) => {
    const matchedSegment = findSupportingSegment(raw.quote, raw.segmentId, segments);
    // Never invent items that have no supporting quote in the transcript
    if (!matchedSegment) {
      return;
    }

    const ownerResolution = resolveOwner(raw.rawOwner, raw.type, roster);
    const dueDate = resolveRelativeDate(raw.rawDue, meetingDate);
    const lowConfidence = raw.confidence < 0.7;

    let finalStatus: ResolutionStatus = ownerResolution.status;
    let reason = ownerResolution.reason;

    if (finalStatus === "confirmed" && lowConfidence) {
      finalStatus = "low_confidence";
      reason = `Confidence (${Math.round(raw.confidence * 100)}%) is below 70% threshold — please verify owner and wording.`;
    } else if (finalStatus !== "confirmed" && lowConfidence && reason) {
      reason = `${reason} (Confidence ${Math.round(raw.confidence * 100)}%).`;
    }

    const needsConfirmation =
      finalStatus === "ambiguous" ||
      finalStatus === "unowned" ||
      finalStatus === "low_confidence" ||
      lowConfidence;

    resolved.push({
      id: `ext_${Date.now()}_${idx}`,
      meetingId,
      segmentId: matchedSegment.id,
      timestamp: matchedSegment.timestamp,
      kind: mapTypeToKind(raw.type),
      title: raw.title,
      quote: raw.quote,
      rawOwner: raw.rawOwner,
      rawDue: raw.rawDue,
      ownerId: ownerResolution.ownerId,
      ownerCandidates: ownerResolution.ownerCandidates,
      dueDate,
      confidence: raw.confidence,
      resolutionStatus: finalStatus,
      needsConfirmation,
      ambiguityReason: reason,
    });
  });

  return resolved;
}
