import type {
  Node as WorkflowNode,
  WorkflowEdge,
} from "../types/meetmind";

/**
 * Deterministic 32-bit FNV-1a hash encoded in base36 for compact idempotency keys.
 */
export function hashItemPayload(payload: unknown): string {
  const str = typeof payload === "string" ? payload : JSON.stringify(payload ?? "");
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(6, "0");
}

export function computeIdempotencyKey(
  meetingId: string,
  nodeId: string,
  itemPayload: unknown
): string {
  return `${meetingId}:${nodeId}:${hashItemPayload(itemPayload)}`;
}

export function orderNodesTopologically(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[]
): WorkflowNode[] {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const n of nodes) {
    inDegree.set(n.id, 0);
    adj.set(n.id, []);
  }

  for (const e of edges) {
    if (nodeMap.has(e.from) && nodeMap.has(e.to)) {
      adj.get(e.from)!.push(e.to);
      inDegree.set(e.to, (inDegree.get(e.to) || 0) + 1);
    }
  }

  const queue: WorkflowNode[] = [];
  for (const n of nodes) {
    if ((inDegree.get(n.id) || 0) === 0) {
      queue.push(n);
    }
  }

  // Deterministic tie-break by x then y position
  queue.sort((a, b) => a.x - b.x || a.y - b.y);

  const ordered: WorkflowNode[] = [];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const curr = queue.shift()!;
    if (visited.has(curr.id)) continue;
    visited.add(curr.id);
    ordered.push(curr);

    const neighbors = (adj.get(curr.id) || [])
      .map((id) => nodeMap.get(id))
      .filter((n): n is WorkflowNode => Boolean(n));

    for (const next of neighbors) {
      const nextDeg = (inDegree.get(next.id) || 0) - 1;
      inDegree.set(next.id, nextDeg);
      if (nextDeg <= 0 && !visited.has(next.id)) {
        queue.push(next);
        queue.sort((a, b) => a.x - b.x || a.y - b.y);
      }
    }
  }

  // Append any remaining cyclic/disconnected nodes
  for (const n of nodes) {
    if (!visited.has(n.id)) ordered.push(n);
  }

  return ordered;
}

export function buildGmailComposeUrl(
  to: string,
  subject: string,
  body: string
): string {
  const params = new URLSearchParams({
    view: "cm",
    fs: "1",
    to: to || "",
    su: subject || "",
    body: body || "",
  });
  return `https://mail.google.com/mail/?${params.toString()}`;
}

export function buildGoogleCalendarUrl(
  eventTitle: string,
  dateStr: string,
  timeStr: string,
  durationMins: number,
  attendees: string
): string {
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

  let year = 2026;
  let month = 10;
  let day = 19;

  const dateMatch = (dateStr || "").match(/(\d{1,2})\s+([A-Za-z]{3})/);
  if (dateMatch) {
    day = Number(dateMatch[1]) || 19;
    const mIdx = MONTHS[dateMatch[2].toLowerCase()];
    if (mIdx !== undefined) month = mIdx;
  }

  let hours = 16;
  let mins = 0;
  const timeMatch = (timeStr || "").match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (timeMatch) {
    hours = Number(timeMatch[1]) || 16;
    mins = Number(timeMatch[2]) || 0;
    const meridiem = (timeMatch[3] || "").toUpperCase();
    if (meridiem === "PM" && hours < 12) hours += 12;
    if (meridiem === "AM" && hours === 12) hours = 0;
  }

  const startLocal = new Date(year, month, day, hours, mins, 0);
  const endLocal = new Date(startLocal.getTime() + (durationMins || 30) * 60_000);

  const fmt = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(
      d.getHours()
    )}${pad(d.getMinutes())}00`;
  };

  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: eventTitle || "Follow-up Sync",
    dates: `${fmt(startLocal)}/${fmt(endLocal)}`,
    details: `Scheduled automatically via MeetMind.\nAttendees: ${attendees || "Team"}`,
  });

  if (attendees) {
    const emails = attendees
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.includes("@"));
    if (emails.length > 0) {
      params.set("add", emails.join(","));
    }
  }

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
