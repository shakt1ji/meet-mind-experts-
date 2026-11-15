import type {
  Meeting,
  Person,
  Promise as PromiseRecord,
  RawExtractedItem,
  WorkflowEdge,
  Node as WorkflowNode,
} from "../types/meetmind";
import { buildOverdueBriefPayload } from "../utils/metrics";

/**
 * Cached extraction response matching strict /api/gemini/extract schema
 * for offline / instant Mock Mode demo runs.
 */
export const MOCK_ACME_EXTRACTION: {
  summary: string;
  items: RawExtractedItem[];
} = {
  summary:
    "Reviewed two production dashboard outages and an October GST slab mismatch on Acme invoices. Raj Patel committed to resolving the dashboard cache issue by Friday, Meena took ownership of the GST correction, and the next client check-in was set for Thursday.",
  items: [
    {
      type: "complaint",
      title: "Acme dashboard went down twice this week",
      quote: "dashboard went down twice this week",
      segmentId: "seg_2",
      timestamp: "01:04",
      rawOwner: "Raj Patel",
      rawDue: "Friday",
      confidence: 0.96,
    },
    {
      type: "commit",
      title: "Fix dashboard Redis pool & stability by Friday",
      quote: "I'll fix the dashboard by Friday.",
      segmentId: "seg_3",
      timestamp: "02:11",
      rawOwner: "Raj Patel",
      rawDue: "Friday",
      confidence: 0.95,
    },
    {
      type: "complaint",
      title: "October invoices show wrong GST (12% instead of 18%)",
      quote: "October invoices show wrong GST",
      segmentId: "seg_4",
      timestamp: "03:09",
      rawOwner: "Meena",
      rawDue: "today",
      confidence: 0.97,
    },
    {
      type: "action",
      title: "Meena to take GST fix and issue corrected PDF & credit note",
      quote: "Meena, take GST",
      segmentId: "seg_5",
      timestamp: "04:12",
      rawOwner: "Meena",
      rawDue: "today EOD",
      confidence: 0.93,
    },
    {
      type: "action",
      title: "Send Acme a recap today with dashboard & GST ETAs",
      quote: "send Acme a recap today",
      segmentId: "seg_6",
      timestamp: "05:26",
      rawOwner: "Raj",
      rawDue: "today",
      confidence: 0.61,
    },
    {
      type: "action",
      title: "Wire automated Slack alerts for Redis memory spikes",
      quote: "someone should wire automated Slack alerts for memory spikes",
      segmentId: "seg_7",
      timestamp: "06:18",
      rawOwner: "someone",
      rawDue: "next sprint",
      confidence: 0.64,
    },
    {
      type: "decision",
      title: "Meet next Thursday at 4 PM IST with Acme billing lead",
      quote: "meet next Thursday at 4 PM IST",
      segmentId: "seg_8",
      timestamp: "07:34",
      rawOwner: "Anita",
      rawDue: "next Thursday 4 PM IST",
      confidence: 0.92,
    },
  ],
};

/**
 * Cached workflow draft matching /api/gemini/workflow/draft schema
 */
export const MOCK_WORKFLOW_DRAFT_PAYLOAD = {
  nodes: [
    {
      id: "node_trigger",
      type: "trigger",
      label: "Meeting Extracted",
      description: "Fires when transcript analysis finishes for the selected meeting.",
      configSummary: "On Acme weekly sync",
      config: { event: "Meeting extraction completed" },
    },
    {
      id: "node_loop",
      type: "loop",
      label: "Loop Complaints & Actions",
      description: "Iterates over all extracted complaints and action items.",
      configSummary: "For each Complaint / Action",
      config: {
        collection: "extractedItems",
        filter: "kind in ['Complaint', 'Action', 'Commit']",
      },
    },
    {
      id: "node_ticket",
      type: "ticket",
      label: "Create Engineering & Ops Tickets",
      description: "Creates tracked tickets for dashboard outage & GST invoice fix.",
      configSummary: "High · Fri 20 Nov",
      config: {
        ticketTitle: "Fix Redis pool saturation & October GST invoice slab",
        owner: "Raj Patel / Meena",
        priority: "High",
        dueDate: "Fri 20 Nov",
      },
    },
    {
      id: "node_approval",
      type: "approval",
      label: "Confirm Ambiguous Owners",
      description: "Holds recap & alert setup until 'Raj' and unowned items are confirmed.",
      configSummary: "Gate: Anita (Manager)",
      config: {
        approver: "Anita (Manager)",
        rule: "Require confirmation when owner is ambiguous or confidence < 0.70",
      },
    },
    {
      id: "node_gmail",
      type: "gmail",
      label: "Send Client Recap Email",
      description: "Sends executive summary and ETAs to Acme's ops & billing leads.",
      configSummary: "To: ops-lead@acmecorp.example",
      config: {
        to: "ops-lead@acmecorp.example, billing@acmecorp.example",
        subject: "Acme Weekly Sync Recap: Dashboard ETA & Oct GST Correction",
        body: "Hi Acme team,\n\nThanks for flagging this week's items. Here is our confirmed plan:\n\n1. Dashboard Stability: Raj Patel is resolving the Redis bulk-export saturation by Fri 20 Nov.\n2. October Invoice GST: Meena is issuing the corrected 18% IGST PDF and credit note today (Sat 14 Nov EOD).\n3. Follow-up Sign-off: Calendar invite sent for Thu 19 Nov at 4:00 PM IST.\n\nBest,\nMeetMind Ops Team",
      },
    },
    {
      id: "node_calendar",
      type: "calendar",
      label: "Book Thursday Check-in",
      description: "Schedules follow-up sign-off call with Acme billing lead.",
      configSummary: "Thu 19 Nov · 4:00 PM IST",
      config: {
        eventTitle: "Acme Billing & Dashboard Sign-off",
        attendees: "Anita, Meena, Raj Patel, billing@acmecorp.example",
        date: "Thu 19 Nov",
        time: "4:00 PM IST",
        durationMins: 30,
      },
    },
    {
      id: "node_wait",
      type: "wait",
      label: "Wait 3 Days",
      description: "Pauses before checking whether open tickets were closed.",
      configSummary: "Delay: 3 days",
      config: {
        durationDays: 3,
        condition: "Check if Acme tickets remain open",
      },
    },
    {
      id: "node_slack",
      type: "slack-nudge",
      label: "Nudge #delivery-ops",
      description: "Sends a Slack reminder if any Acme ticket remains open after 3 days.",
      configSummary: "#delivery-ops",
      config: {
        channel: "#delivery-ops",
        condition: "Ticket status is still In Progress or Blocked",
        message:
          "Heads up @raj.patel @meena — Acme sync tickets are still open ahead of Thursday's sign-off.",
      },
    },
  ],
  edges: [
    { id: "e_1", from: "node_trigger", to: "node_loop" },
    { id: "e_2", from: "node_loop", to: "node_ticket", label: "complaints" },
    { id: "e_3", from: "node_trigger", to: "node_approval" },
    { id: "e_4", from: "node_approval", to: "node_gmail", label: "approved" },
    { id: "e_5", from: "node_approval", to: "node_calendar", label: "approved" },
    { id: "e_6", from: "node_ticket", to: "node_wait" },
    { id: "e_7", from: "node_wait", to: "node_slack", label: "if still open" },
  ],
};

export function buildMockWorkflowEdit(
  currentNodes: WorkflowNode[],
  currentEdges: WorkflowEdge[],
  instruction: string
) {
  const channelMatch = instruction.match(/#[a-z0-9-_]+/i);
  const channel = channelMatch ? channelMatch[0] : "#ops";
  const newNodeId = `node_mock_${Date.now().toString().slice(-4)}`;
  const parentId =
    currentNodes.find((n) => n.type === "ticket")?.id ||
    currentNodes[currentNodes.length - 1]?.id ||
    "node_trigger";

  const nodes = [
    ...currentNodes.map((n) => ({
      id: n.id,
      type: n.type,
      label: n.label,
      description: n.description,
      configSummary: n.configSummary,
      config: n.config,
    })),
    {
      id: newNodeId,
      type: "slack-nudge" as const,
      label: `Notify ${channel}`,
      description: `Added from instruction: "${instruction}"`,
      configSummary: channel,
      config: {
        channel,
        condition: instruction,
        message: `Automated alert (${channel}): ${instruction}`,
      },
    },
  ];

  const edges = [
    ...currentEdges,
    {
      id: `e_mock_${Date.now().toString().slice(-4)}`,
      from: parentId,
      to: newNodeId,
      label: "condition met",
    },
  ];

  return { nodes, edges };
}

export function buildMockPreMeetingBrief(
  promises: PromiseRecord[],
  people: Person[],
  meetings: Meeting[]
): { lines: string[]; generatedAt: string } {
  const items = buildOverdueBriefPayload(promises, people, meetings);
  const overdue = items.filter((i) => i.computedStatus === "overdue");
  const unowned = items.filter((i) => i.ownerName === "Unassigned");
  const openOwned = items.filter(
    (i) => i.computedStatus === "open" && i.ownerName !== "Unassigned"
  );

  const lines: string[] = [];

  if (overdue.length > 0) {
    overdue.slice(0, 2).forEach((o) => {
      lines.push(
        `• ${o.ownerName} is ${o.daysOverdue} day${o.daysOverdue === 1 ? "" : "s"} overdue on "${o.statement}" (from ${o.sourceMeeting}, due ${o.dueDate}).`
      );
    });
  } else {
    lines.push("• Zero overdue promises from prior syncs — all past due dates are clear.");
  }

  if (unowned.length > 0) {
    lines.push(
      `• ${unowned.length} prior commitment${unowned.length === 1 ? " lacks" : "s lack"} an owner (${unowned.map((u) => `"${u.statement}"`).slice(0, 2).join("; ")}).`
    );
  } else {
    lines.push("• Every active commitment in the Promise Ledger has a verified owner.");
  }

  if (openOwned.length > 0) {
    const nextItem = openOwned[0];
    lines.push(
      `• Watch today: ${nextItem.ownerName} owns "${nextItem.statement}" due ${nextItem.dueDate}.`
    );
  }

  while (lines.length < 4) {
    lines.push(
      "• Open the next sync by locking ETAs on overdue items before taking new commitments."
    );
  }

  return {
    lines: lines.slice(0, 4),
    generatedAt: "Cached Demo Brief",
  };
}

/**
 * Cached Live Meeting Multimodal Audio Analysis response for instant Mock Mode.
 */
export function buildMockLiveAudioAnalysis(durationSec: number) {
  const safeDuration = Math.max(4, Math.round(durationSec || 12));
  const fmt = (sec: number) => {
    const s = Math.min(safeDuration, Math.max(0, sec));
    return `00:${String(s).padStart(2, "0")}`;
  };

  return {
    language: "Hinglish (English + Hindi)",
    durationSec: safeDuration,
    summary:
      "Live recording captured client checkout latency complaints, an explicit commitment from Raj Patel to ship the Redis fix by Friday, Meena taking GST invoice reconciliation today, and a follow-up sign-off call on next Thursday.",
    transcript: [
      {
        start: "00:00",
        end: fmt(Math.max(3, Math.floor(safeDuration * 0.3))),
        speaker: "Anita",
        text: "Acme team ka complaint aaya hai — checkout dashboard twice slow hua aaj morning.",
      },
      {
        start: fmt(Math.max(3, Math.floor(safeDuration * 0.3))),
        end: fmt(Math.max(6, Math.floor(safeDuration * 0.65))),
        speaker: "Raj Patel",
        text: "Main Friday tak Redis cache patch deploy kar dunga, aur Meena please aaj October GST invoice bhej dena.",
      },
      {
        start: fmt(Math.max(6, Math.floor(safeDuration * 0.65))),
        end: fmt(safeDuration),
        speaker: "Meena",
        text: "Done, aaj 6 PM tak credit note email kar dungi. Let's schedule follow-up review next Thursday 4 PM.",
      },
    ],
    items: [
      {
        type: "complaint",
        title: "Acme checkout dashboard slowed down twice this morning",
        quote: "checkout dashboard twice slow hua aaj morning",
        timestamp: "00:00",
        rawOwner: "Raj Patel",
        rawDue: "Friday",
        priority: "High",
        confidence: 0.95,
      },
      {
        type: "commit",
        title: "Deploy Redis cache patch for checkout dashboard",
        quote: "Main Friday tak Redis cache patch deploy kar dunga",
        timestamp: fmt(Math.max(3, Math.floor(safeDuration * 0.3))),
        rawOwner: "Raj Patel",
        rawDue: "Friday",
        priority: "High",
        confidence: 0.94,
      },
      {
        type: "task",
        title: "Send corrected October GST invoice and credit note",
        quote: "aaj 6 PM tak credit note email kar dungi",
        timestamp: fmt(Math.max(6, Math.floor(safeDuration * 0.65))),
        rawOwner: "Meena",
        rawDue: "today 6 PM",
        priority: "High",
        confidence: 0.92,
      },
      {
        type: "deadline",
        title: "Redis patch production cutoff by Friday",
        quote: "Friday tak Redis cache patch deploy",
        timestamp: fmt(Math.max(3, Math.floor(safeDuration * 0.3))),
        rawOwner: "Raj Patel",
        rawDue: "Friday",
        priority: "High",
        confidence: 0.89,
      },
      {
        type: "meeting_request",
        title: "Schedule follow-up review call next Thursday at 4 PM",
        quote: "schedule follow-up review next Thursday 4 PM",
        timestamp: fmt(Math.max(6, Math.floor(safeDuration * 0.65))),
        rawOwner: "Anita",
        rawDue: "next Thursday 4 PM",
        priority: "Medium",
        confidence: 0.91,
      },
      {
        type: "task",
        title: "Confirm who sends client Slack escalation summary",
        quote: "Acme team ka complaint aaya hai",
        timestamp: "00:00",
        rawOwner: "Raj",
        rawDue: "today",
        priority: "Medium",
        confidence: 0.63,
      },
    ],
    executionPlan: [
      {
        id: "plan_1",
        stepNumber: 1,
        title: "Log P1 Complaint Ticket for Checkout Latency",
        owner: "Raj Patel",
        description:
          "Create a High-priority ticket tracking the morning checkout dashboard slowdowns before writing external communications.",
        tool: "Ticket",
        dependsOn: [],
        status: "planned",
      },
      {
        id: "plan_2",
        stepNumber: 2,
        title: "Create October GST Invoice & Credit Note Task",
        owner: "Meena",
        description:
          "Track Meena's commitment to email the corrected October GST invoice by today 6 PM.",
        tool: "Ticket",
        dependsOn: [],
        status: "planned",
      },
      {
        id: "plan_3",
        stepNumber: 3,
        title: "Draft Client Recap & Complaint Acknowledgement in Gmail",
        owner: "Anita",
        description:
          "Prepare Gmail draft summarizing the Redis patch ETA (Friday) and today's 6 PM GST credit note delivery. Requires human approval to send.",
        tool: "Gmail",
        dependsOn: ["Step 1", "Step 2"],
        status: "planned",
      },
      {
        id: "plan_4",
        stepNumber: 4,
        title: "Schedule Follow-Up Review on Google Calendar",
        owner: "Anita",
        description:
          "Create a 30-minute review event for next Thursday at 4:00 PM with Acme & ops leads.",
        tool: "Calendar",
        dependsOn: ["Step 3"],
        status: "planned",
      },
      {
        id: "plan_5",
        stepNumber: 5,
        title: "Post Team Alert to Slack & Trigger n8n Automation",
        owner: "MeetMind",
        description:
          "Dispatch structured meeting payload to #delivery-ops and optional n8n webhook once tickets & draft are ready.",
        tool: "Slack",
        dependsOn: ["Step 1", "Step 2"],
        status: "planned",
      },
    ],
  };
}

export function buildMockPlannedToolActions(meetingId: string, meetingTitle: string) {
  return [
    {
      id: `act_${meetingId}_ticket_1`,
      toolName: "create_ticket" as const,
      title: "Create Ticket: Fix Checkout Dashboard Redis Saturation",
      description: "Logs P1 complaint from live recording into MeetMind Tickets board & Firestore.",
      status: "pending" as const,
      idempotencyKey: `${meetingId}:create_ticket:checkout_redis`,
      args: {
        title: "Fix Acme checkout dashboard Redis saturation",
        owner: "Raj Patel",
        priority: "High",
        due: "Fri 20 Nov",
        quote: "checkout dashboard twice slow hua aaj morning",
      },
    },
    {
      id: `act_${meetingId}_email_draft`,
      toolName: "draft_email" as const,
      title: "Create Real Gmail Draft: Client Recap & Deadlines",
      description: "Streams personalized recap email with complaint acknowledgement and saves as a Gmail draft.",
      status: "pending" as const,
      idempotencyKey: `${meetingId}:draft_email:client_recap`,
      args: {
        to: "ops-lead@acmecorp.example",
        subject: `${meetingTitle} — Action Plan, GST Credit Note & Redis ETA`,
        body: `Hi Acme team,\n\nThank you for flagging this morning's checkout slowdown. Here is our verified execution plan from ${meetingTitle}:\n\n1. Checkout Dashboard Stability (Owner: Raj Patel): Redis cache patch deploying by Friday EOD.\n2. October GST Invoice & Credit Note (Owner: Meena): Corrected PDF + credit note delivering today by 6:00 PM.\n3. Follow-Up Review: Proposed check-in on next Thursday at 4:00 PM IST.\n\nBest regards,\nAnita & MeetMind Delivery Team`,
      },
    },
    {
      id: `act_${meetingId}_cal`,
      toolName: "create_calendar_event" as const,
      title: "Create Calendar Event: Acme Follow-Up Sign-Off",
      description: "Books the requested Thursday 4:00 PM check-in on Google Calendar.",
      status: "pending" as const,
      idempotencyKey: `${meetingId}:create_calendar_event:followup`,
      args: {
        title: `${meetingTitle} — Follow-Up Review`,
        date: "Thu 19 Nov",
        time: "4:00 PM",
        durationMins: 30,
        attendees: ["anita@meetmind.io", "raj.patel@meetmind.io", "meena@meetmind.io"],
        description: "Review Redis checkout stability and confirm October GST invoice closure.",
      },
    },
    {
      id: `act_${meetingId}_slack`,
      toolName: "notify_slack" as const,
      title: "Notify Slack (#delivery-ops)",
      description: "Posts summary + owners + deadlines to your configured Slack webhook (or preview toast).",
      status: "pending" as const,
      idempotencyKey: `${meetingId}:notify_slack:summary`,
      args: {
        message: `[MeetMind] ${meetingTitle}: Ticket assigned to Raj Patel (Due Fri), GST credit note with Meena (Due today 6 PM).`,
      },
    },
    {
      id: `act_${meetingId}_n8n`,
      toolName: "call_n8n" as const,
      title: "Trigger n8n / Zapier Downstream Webhook",
      description: "Sends meetingId, structured items, speaker metadata, and timestamps to your automation webhook.",
      status: "pending" as const,
      idempotencyKey: `${meetingId}:call_n8n:sync`,
      args: {
        meetingId,
        meetingTitle,
        event: "meeting_analyzed",
        itemCount: 5,
      },
    },
    {
      id: `act_${meetingId}_slides`,
      toolName: "create_presentation" as const,
      title: "Generate Stakeholder Deck (Google Slides + .pptx)",
      description: "Creates a 7-slide deck in Google Slides with downloadable .pptx & Canva export.",
      status: "pending" as const,
      idempotencyKey: `${meetingId}:create_presentation:deck`,
      args: {
        title: `${meetingTitle} — Executive Brief`,
        slideCount: 7,
      },
    },
  ];
}

export function buildMockSlideDeck(meeting: Meeting) {
  const complaints = meeting.extractedItems.filter((i) => i.kind === "Complaint");
  const decisions = meeting.extractedItems.filter((i) => i.kind === "Decision");
  const actions = meeting.extractedItems.filter(
    (i) => i.kind === "Action" || i.kind === "Commit"
  );

  return {
    deckTitle: `${meeting.title} — Executive Recap`,
    subtitle: `${meeting.date} · ${meeting.duration} · Prepared by MeetMind`,
    generatedAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    slides: [
      {
        title: meeting.title,
        subtitle: `${meeting.date} · Stakeholder Sync & Execution Plan`,
        layout: "title" as const,
        bullets: [
          meeting.summary.split(".")[0] || "Executive summary & verified commitments",
          `${meeting.extractedItems.length} tracked outcomes with resolved dates`,
        ],
        speakerNotes: "Open by confirming the exact complaint timeline and owner commitments.",
      },
      {
        title: "Agenda & Context",
        subtitle: "Meeting scope and key themes",
        layout: "agenda" as const,
        bullets: [
          "Review client complaints & incident root cause",
          "Lock key architectural & commercial decisions",
          "Confirm action owners and target due dates",
          "Align on follow-up review cadence",
        ],
        speakerNotes: "Walk stakeholders through what was covered in this session.",
      },
      {
        title: "Complaints & Escalated Risks",
        subtitle: "Immediate stability & billing issues raised",
        layout: "bullets" as const,
        bullets:
          complaints.length > 0
            ? complaints.map((c) => `${c.title} (Due ${c.dueDate})`)
            : ["No critical escalations logged during this session."],
        speakerNotes: "Acknowledge client pain points directly and emphasize ownership.",
      },
      {
        title: "Decisions Locked",
        subtitle: "Agreed direction & checkpoints",
        layout: "bullets" as const,
        bullets:
          decisions.length > 0
            ? decisions.map((d) => `${d.title} (${d.dueDate})`)
            : [
                "Prioritize production stability fixes ahead of new feature work",
                "Weekly status sync locked for next Thursday",
              ],
        speakerNotes: "Confirm everyone agrees on the locked decisions.",
      },
      {
        title: "Action Plan & Ownership",
        subtitle: "Committed deliverables and real dates",
        layout: "actions" as const,
        bullets:
          actions.length > 0
            ? actions.slice(0, 5).map((a) => `${a.title} — Due ${a.dueDate}`)
            : ["Assign remaining open actions before closing the call."],
        speakerNotes: "Call out each owner and verify no date conflicts remain.",
      },
      {
        title: "SLA & Execution Pipeline",
        subtitle: "Automated tracking & escalation guardrails",
        layout: "bullets" as const,
        bullets: [
          "Tickets tracked on MeetMind board with P1/P2/P3 SLA badges",
          "Gmail recap drafted for human approval before send",
          "Calendar review scheduled with key stakeholders",
          "3-day automated Slack nudge if tickets stay open",
        ],
        speakerNotes: "Explain how MeetMind monitors follow-through without manual chasing.",
      },
      {
        title: "Next Steps & Sign-Off",
        subtitle: "Immediate post-meeting actions",
        layout: "closing" as const,
        bullets: [
          "Approve Gmail client recap & verify recipient list",
          "Confirm calendar invite attendance",
          "Review open Promise Ledger items before next sync",
        ],
        speakerNotes: "Close with clear next milestone and thank the team.",
      },
    ],
  };
}


