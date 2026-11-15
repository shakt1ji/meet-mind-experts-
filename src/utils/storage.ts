import { INITIAL_MEETMIND_STATE } from "../data/seedData";
import type {
  ExtractedItem,
  MeetMindState,
  Meeting,
  ResolutionStatus,
} from "../types/meetmind";

const STORAGE_KEY = "meetmind_workspace_v1";

const VALID_RESOLUTION_STATUSES = new Set<ResolutionStatus>([
  "confirmed",
  "ambiguous",
  "unowned",
  "low_confidence",
]);

function normalizeExtractedItem(item: Partial<ExtractedItem>, meetingId: string): ExtractedItem {
  const confidence =
    typeof item.confidence === "number" && !Number.isNaN(item.confidence)
      ? item.confidence
      : 0.7;
  const ownerId = item.ownerId ?? null;
  const hasCandidates = Array.isArray(item.ownerCandidates) && item.ownerCandidates.length > 1;

  let resolutionStatus: ResolutionStatus;
  if (item.resolutionStatus && VALID_RESOLUTION_STATUSES.has(item.resolutionStatus)) {
    resolutionStatus = item.resolutionStatus;
  } else if (item.resolved) {
    resolutionStatus = "confirmed";
  } else if (hasCandidates) {
    resolutionStatus = "ambiguous";
  } else if (!ownerId && item.kind !== "Decision") {
    resolutionStatus = "unowned";
  } else if (confidence < 0.7) {
    resolutionStatus = "low_confidence";
  } else {
    resolutionStatus = "confirmed";
  }

  return {
    id: item.id || `ext_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    meetingId: item.meetingId || meetingId,
    segmentId: item.segmentId || "",
    timestamp: item.timestamp || "00:00",
    kind: item.kind || "Action",
    title: item.title || "Untitled item",
    quote: item.quote || item.title || "",
    rawOwner: item.rawOwner || "",
    rawDue: item.rawDue || item.dueDate || "TBD",
    ownerId,
    ownerCandidates: item.ownerCandidates,
    dueDate: item.dueDate || "TBD",
    confidence,
    resolutionStatus,
    needsConfirmation:
      typeof item.needsConfirmation === "boolean"
        ? item.needsConfirmation
        : resolutionStatus !== "confirmed",
    ambiguityReason: item.ambiguityReason,
    resolved: item.resolved,
  };
}

export function loadMeetMindState(): MeetMindState {
  if (typeof window === "undefined") {
    return INITIAL_MEETMIND_STATE;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return INITIAL_MEETMIND_STATE;
    }
    const parsed = JSON.parse(raw) as Partial<MeetMindState>;
    if (!parsed.meetings || !Array.isArray(parsed.meetings) || parsed.meetings.length === 0) {
      return INITIAL_MEETMIND_STATE;
    }

    const normalizedMeetings: Meeting[] = parsed.meetings.map((m) => ({
      ...m,
      segments: Array.isArray(m.segments) ? m.segments : [],
      extractedItems: Array.isArray(m.extractedItems)
        ? m.extractedItems.map((item) => normalizeExtractedItem(item, m.id))
        : [],
    }));

    const validNodeTypes = new Set([
      "trigger",
      "loop",
      "ticket",
      "approval",
      "gmail",
      "calendar",
      "wait",
      "slack-nudge",
    ]);
    const hasCompatibleWorkflow =
      parsed.workflow &&
      Array.isArray(parsed.workflow.nodes) &&
      parsed.workflow.nodes.length > 0 &&
      parsed.workflow.nodes.every((n) => validNodeTypes.has(n.type));

    const hasCompatibleRuns =
      Array.isArray(parsed.runs) &&
      parsed.runs.every(
        (r) =>
          typeof r.runNumber === "number" &&
          Array.isArray(r.steps) &&
          r.steps.every((s) => typeof s.idempotencyKey === "string")
      );

    return {
      people: parsed.people && parsed.people.length > 0 ? parsed.people : INITIAL_MEETMIND_STATE.people,
      meetings: normalizedMeetings,
      selectedMeetingId:
        normalizedMeetings.some((m) => m.id === parsed.selectedMeetingId) && parsed.selectedMeetingId
          ? parsed.selectedMeetingId
          : normalizedMeetings[0].id,
      workflow: hasCompatibleWorkflow && parsed.workflow ? parsed.workflow : INITIAL_MEETMIND_STATE.workflow,
      runs: hasCompatibleRuns && parsed.runs ? parsed.runs : INITIAL_MEETMIND_STATE.runs,
      idempotencyLedger: parsed.idempotencyLedger || {},
      duplicatesBlockedTotal:
        typeof parsed.duplicatesBlockedTotal === "number" ? parsed.duplicatesBlockedTotal : 0,
      nextRunNumber:
        typeof parsed.nextRunNumber === "number"
          ? parsed.nextRunNumber
          : INITIAL_MEETMIND_STATE.nextRunNumber,
      nextTicketNumber:
        typeof parsed.nextTicketNumber === "number"
          ? parsed.nextTicketNumber
          : INITIAL_MEETMIND_STATE.nextTicketNumber,
      tickets: Array.isArray(parsed.tickets) ? parsed.tickets : INITIAL_MEETMIND_STATE.tickets,
      promises: Array.isArray(parsed.promises) ? parsed.promises : INITIAL_MEETMIND_STATE.promises,
    };
  } catch {
    return INITIAL_MEETMIND_STATE;
  }
}

export function saveMeetMindState(state: MeetMindState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage quota errors silently
  }
}

export function resetMeetMindState(): MeetMindState {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(STORAGE_KEY);
  }
  return INITIAL_MEETMIND_STATE;
}
