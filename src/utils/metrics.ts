import type {
  Meeting,
  Person,
  Promise as PromiseRecord,
  Ticket,
} from "../types/meetmind";

const MONTHS_INDEX: Record<string, number> = {
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

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Parses due date strings such as "Fri 20 Nov", "Thu 12 Nov", "Sat 14 Nov · EOD",
 * "14 Nov 2026", or ISO strings into a local midnight Date.
 */
export function parseDueDate(
  dueStr: string,
  referenceDate: Date = new Date()
): Date | null {
  const raw = (dueStr || "").trim();
  if (!raw || raw.toLowerCase() === "tbd" || raw.toLowerCase() === "none") {
    return null;
  }

  // Strip trailing time/qualifier after "·" or comma
  const datePart = raw.split("·")[0].replace(/,/g, "").trim();

  // Pattern: optional weekday + day + month (+ optional year), e.g. "Thu 12 Nov" or "14 Nov 2026"
  const match = datePart.match(
    /^(?:[A-Za-z]{3,9}\s+)?(\d{1,2})\s+([A-Za-z]{3,9})(?:\s+(\d{4}))?$/
  );
  if (match) {
    const day = Number(match[1]);
    const monKey = match[2].slice(0, 3).toLowerCase();
    const month = MONTHS_INDEX[monKey];
    const year = match[3] ? Number(match[3]) : referenceDate.getFullYear();
    if (month !== undefined && day >= 1 && day <= 31) {
      return new Date(year, month, day);
    }
  }

  const parsed = new Date(datePart);
  if (!Number.isNaN(parsed.getTime())) {
    return startOfDay(parsed);
  }
  return null;
}

export type ComputedPromiseStatus = "open" | "done" | "overdue";

export interface ComputedPromiseMeta {
  computedStatus: ComputedPromiseStatus;
  daysOverdue: number;
  quote: string;
  sourceMeetingTitle: string;
}

export function computePromiseMeta(
  promise: PromiseRecord,
  meetings: Meeting[],
  referenceDate: Date = new Date()
): ComputedPromiseMeta {
  const meeting = meetings.find((m) => m.id === promise.meetingId);
  const matchingItem = meeting?.extractedItems.find(
    (item) =>
      item.segmentId === promise.segmentId &&
      (item.kind === "Commit" || item.kind === "Action")
  );
  const matchingSeg = meeting?.segments.find((s) => s.id === promise.segmentId);
  const quote = matchingItem?.quote || matchingSeg?.text || promise.statement;
  const sourceMeetingTitle = meeting?.title || promise.counterparty || "Manual";

  if (promise.status === "Kept") {
    return {
      computedStatus: "done",
      daysOverdue: 0,
      quote,
      sourceMeetingTitle,
    };
  }

  const today = startOfDay(referenceDate);
  const parsedDue = parseDueDate(promise.dueDate, referenceDate);

  if (parsedDue) {
    const diffDays = Math.floor(
      (today.getTime() - parsedDue.getTime()) / 86_400_000
    );
    if (diffDays > 0) {
      return {
        computedStatus: "overdue",
        daysOverdue: diffDays,
        quote,
        sourceMeetingTitle,
      };
    }
  }

  if (promise.status === "Overdue") {
    return {
      computedStatus: "overdue",
      daysOverdue: 1,
      quote,
      sourceMeetingTitle,
    };
  }

  return {
    computedStatus: "open",
    daysOverdue: 0,
    quote,
    sourceMeetingTitle,
  };
}

export interface MeetingHealthReport {
  score: number;
  ownedSharePct: number;
  datedSharePct: number;
  ambiguousCount: number;
  unownedCount: number;
  decisionCount: number;
  advice: string;
  tone: "healthy" | "warning" | "critical";
}

export function computeMeetingHealth(meeting: Meeting): MeetingHealthReport {
  const items = meeting.extractedItems;
  if (items.length === 0) {
    return {
      score: 40,
      ownedSharePct: 0,
      datedSharePct: 0,
      ambiguousCount: 0,
      unownedCount: 0,
      decisionCount: 0,
      advice: "Analyze this meeting to extract owned commitments, due dates, and decisions.",
      tone: "warning",
    };
  }

  const total = items.length;
  const ownedCount = items.filter((i) => i.ownerId !== null).length;
  const datedCount = items.filter(
    (i) => i.dueDate && i.dueDate.trim().toLowerCase() !== "tbd"
  ).length;
  const ambiguousCount = items.filter(
    (i) => i.needsConfirmation && !i.resolved
  ).length;
  const unownedCount = items.filter((i) => i.ownerId === null).length;
  const decisionCount = items.filter((i) => i.kind === "Decision").length;

  const ownedShare = ownedCount / total;
  const datedShare = datedCount / total;

  // Weighted 0–100 rubric:
  // 35 pts ownership share + 25 pts due-date share + 25 pts clarity (penalized by ambiguous items) + 15 pts explicit decisions
  const ownershipPts = ownedShare * 35;
  const dueDatePts = datedShare * 25;
  const clarityPts = Math.max(0, 25 - ambiguousCount * 10);
  const decisionPts = decisionCount >= 1 ? Math.min(15, 10 + (decisionCount - 1) * 5) : 0;

  const score = Math.max(
    0,
    Math.min(100, Math.round(ownershipPts + dueDatePts + clarityPts + decisionPts))
  );

  let advice = "All owners, due dates, and decisions are locked in.";
  if (unownedCount > 0) {
    advice = `${unownedCount} promise${unownedCount === 1 ? " has" : "s have"} no owner — assign ${unownedCount === 1 ? "it" : "them"} in the confirmation tray.`;
  } else if (ambiguousCount > 0) {
    advice = `${ambiguousCount} item${ambiguousCount === 1 ? " needs" : "s need"} confirmation before execution.`;
  } else if (datedCount < total) {
    const missingDates = total - datedCount;
    advice = `${missingDates} item${missingDates === 1 ? " is" : "s are"} missing a concrete due date.`;
  } else if (decisionCount === 0) {
    advice = "Capture at least one explicit Decision so next steps stay aligned.";
  }

  const tone: MeetingHealthReport["tone"] =
    score >= 80 ? "healthy" : score >= 55 ? "warning" : "critical";

  return {
    score,
    ownedSharePct: Math.round(ownedShare * 100),
    datedSharePct: Math.round(datedShare * 100),
    ambiguousCount,
    unownedCount,
    decisionCount,
    advice,
    tone,
  };
}

export interface TicketSlaMeta {
  tier: "P1" | "P2" | "P3";
  isComplaint: boolean;
  breached: boolean;
  daysOverdue: number;
}

export function computeTicketSla(
  ticket: Ticket,
  referenceDate: Date = new Date()
): TicketSlaMeta {
  const tier: "P1" | "P2" | "P3" =
    ticket.priority === "High"
      ? "P1"
      : ticket.priority === "Medium"
      ? "P2"
      : "P3";

  const isComplaint = ticket.sourceKind === "Complaint";

  if (ticket.status === "Done") {
    return { tier, isComplaint, breached: false, daysOverdue: 0 };
  }

  const today = startOfDay(referenceDate);
  const parsedDue = parseDueDate(ticket.dueDate, referenceDate);
  if (parsedDue) {
    const diffDays = Math.floor(
      (today.getTime() - parsedDue.getTime()) / 86_400_000
    );
    if (diffDays > 0) {
      return {
        tier,
        isComplaint,
        breached: true,
        daysOverdue: diffDays,
      };
    }
  }

  return { tier, isComplaint, breached: false, daysOverdue: 0 };
}

/**
 * Ensures every Commit and Action extracted from any meeting is stored in the Promise Ledger,
 * updating ownerId when resolved without duplicating records.
 */
export function syncPromisesFromMeetings(
  existingPromises: PromiseRecord[],
  meetings: Meeting[]
): PromiseRecord[] {
  const next = [...existingPromises];

  for (const meeting of meetings) {
    for (const item of meeting.extractedItems) {
      if (item.kind !== "Commit" && item.kind !== "Action") continue;

      const existingIdx = next.findIndex(
        (p) =>
          p.meetingId === meeting.id &&
          p.segmentId === item.segmentId &&
          (p.statement.toLowerCase() === item.title.toLowerCase() ||
            next.filter(
              (x) => x.meetingId === meeting.id && x.segmentId === item.segmentId
            ).length === 1)
      );

      if (existingIdx !== -1) {
        const cur = next[existingIdx];
        if (!cur.ownerId && item.ownerId) {
          next[existingIdx] = {
            ...cur,
            ownerId: item.ownerId,
            confidence: Math.max(cur.confidence, item.confidence),
            status: cur.status === "At Risk" ? "Open" : cur.status,
          };
        }
      } else {
        next.unshift({
          id: `prm_sync_${meeting.id}_${item.id}`,
          statement: item.title,
          ownerId: item.ownerId,
          counterparty: meeting.title,
          dueDate: item.dueDate,
          status: item.ownerId ? "Open" : "At Risk",
          confidence: item.confidence,
          meetingId: meeting.id,
          segmentId: item.segmentId,
        });
      }
    }
  }

  return next;
}

export function buildOverdueBriefPayload(
  promises: PromiseRecord[],
  people: Person[],
  meetings: Meeting[],
  referenceDate: Date = new Date()
) {
  return promises
    .map((p) => {
      const meta = computePromiseMeta(p, meetings, referenceDate);
      const owner = people.find((person) => person.id === p.ownerId);
      return {
        statement: p.statement,
        ownerName: owner ? owner.name : "Unassigned",
        dueDate: p.dueDate,
        computedStatus: meta.computedStatus,
        daysOverdue: meta.daysOverdue,
        sourceMeeting: meta.sourceMeetingTitle,
        quote: meta.quote,
      };
    })
    .filter((item) => item.computedStatus !== "done");
}
