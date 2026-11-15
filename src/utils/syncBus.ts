/**
 * Cross-component and cross-tab event bus for instant Local Mode + Supabase UI sync.
 */

export type WorkspaceSyncEvent =
  | { type: "meeting_upserted"; meetingId: string; isNew?: boolean }
  | { type: "ticket_upserted"; ticketId: string }
  | { type: "promise_upserted"; promiseId: string }
  | { type: "workflow_updated"; meetingId?: string }
  | { type: "state_synced" };

const CHANNEL_NAME = "meetmind_workspace_sync_v1";
const WINDOW_EVENT = "meetmind:workspace-sync";

let sharedChannel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") {
    return null;
  }
  if (!sharedChannel) {
    try {
      sharedChannel = new BroadcastChannel(CHANNEL_NAME);
    } catch {
      sharedChannel = null;
    }
  }
  return sharedChannel;
}

export function publishWorkspaceEvent(event: WorkspaceSyncEvent): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent<WorkspaceSyncEvent>(WINDOW_EVENT, { detail: event }));
  } catch {
    // Ignore event dispatch issues
  }
  try {
    getChannel()?.postMessage(event);
  } catch {
    // Ignore BroadcastChannel errors
  }
}

export function subscribeWorkspaceEvents(
  handler: (event: WorkspaceSyncEvent) => void
): () => void {
  if (typeof window === "undefined") return () => {};

  const onWindowEvent = (ev: Event) => {
    const custom = ev as CustomEvent<WorkspaceSyncEvent>;
    if (custom.detail) {
      handler(custom.detail);
    }
  };

  const ch = getChannel();
  const onBroadcast = (ev: MessageEvent<WorkspaceSyncEvent>) => {
    if (ev.data) {
      handler(ev.data);
    }
  };

  window.addEventListener(WINDOW_EVENT, onWindowEvent);
  ch?.addEventListener("message", onBroadcast);

  return () => {
    window.removeEventListener(WINDOW_EVENT, onWindowEvent);
    ch?.removeEventListener("message", onBroadcast);
  };
}
