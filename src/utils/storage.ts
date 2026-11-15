import { INITIAL_MEETMIND_STATE } from "../data/seedData";
import type { MeetMindState } from "../types/meetmind";

const STORAGE_KEY = "meetmind_workspace_v1";

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

    return {
      people: parsed.people && parsed.people.length > 0 ? parsed.people : INITIAL_MEETMIND_STATE.people,
      meetings: parsed.meetings,
      selectedMeetingId: parsed.selectedMeetingId || parsed.meetings[0].id,
      workflow: hasCompatibleWorkflow && parsed.workflow ? parsed.workflow : INITIAL_MEETMIND_STATE.workflow,
      runs: parsed.runs || INITIAL_MEETMIND_STATE.runs,
      tickets: parsed.tickets || INITIAL_MEETMIND_STATE.tickets,
      promises: parsed.promises || INITIAL_MEETMIND_STATE.promises,
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
