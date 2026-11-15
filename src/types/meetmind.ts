export type ExtractedKind = "Complaint" | "Decision" | "Commit" | "Action";
export type RawExtractedType = "decision" | "action" | "complaint" | "commit";

export type ResolutionStatus =
  | "confirmed"
  | "ambiguous"
  | "unowned"
  | "low_confidence";

export type TicketStatus = "Backlog" | "In Progress" | "Blocked" | "Done";
export type TicketPriority = "High" | "Medium" | "Low";

export type PromiseStatus = "Open" | "Kept" | "At Risk" | "Overdue";

export type WorkflowNodeType =
  | "trigger"
  | "loop"
  | "ticket"
  | "approval"
  | "gmail"
  | "calendar"
  | "wait"
  | "slack-nudge";

export type NodeExecutionStatus =
  | "idle"
  | "running"
  | "done"
  | "failed"
  | "queued"
  | "waiting";

export interface Person {
  id: string;
  name: string;
  role: string;
  department: string;
  email: string;
  initials: string;
  accentHex: string;
}

export interface Segment {
  id: string;
  timestamp: string;
  seconds: number;
  speakerId: string;
  speakerName: string;
  text: string;
}

export interface RawExtractedItem {
  type: RawExtractedType;
  title: string;
  quote: string;
  segmentId: string;
  timestamp: string;
  rawOwner: string;
  rawDue: string;
  confidence: number;
}

export interface ExtractedItem {
  id: string;
  meetingId: string;
  segmentId: string;
  timestamp: string;
  kind: ExtractedKind;
  title: string;
  quote: string;
  rawOwner: string;
  rawDue: string;
  ownerId: string | null;
  ownerCandidates?: string[];
  dueDate: string;
  confidence: number; // 0 to 1
  resolutionStatus: ResolutionStatus;
  needsConfirmation: boolean;
  ambiguityReason?: string;
  resolved?: boolean;
}

export interface Meeting {
  id: string;
  title: string;
  date: string;
  duration: string;
  durationSeconds: number;
  speakerIds: string[];
  segments: Segment[];
  extractedItems: ExtractedItem[];
  summary: string;
  lastRunId?: string;
}

export interface NodeConfig {
  // Trigger
  event?: string;
  // Loop
  collection?: string;
  filter?: string;
  // Ticket
  ticketTitle?: string;
  owner?: string;
  priority?: TicketPriority;
  dueDate?: string;
  // Approval
  approver?: string;
  rule?: string;
  // Gmail
  to?: string;
  subject?: string;
  body?: string;
  // Calendar
  eventTitle?: string;
  attendees?: string;
  date?: string;
  time?: string;
  durationMins?: number;
  // Wait
  durationDays?: number;
  condition?: string;
  // Slack nudge
  channel?: string;
  message?: string;
}

export interface Node {
  id: string;
  type: WorkflowNodeType;
  label: string;
  description: string;
  x: number;
  y: number;
  enabled: boolean;
  status: NodeExecutionStatus;
  configSummary: string;
  config: NodeConfig;
}

export interface WorkflowEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  nodes: Node[];
  edges: WorkflowEdge[];
}

export type RunStepStatus = "completed" | "running" | "waiting" | "skipped";

export interface RunStep {
  id: string;
  nodeId: string;
  nodeLabel: string;
  status: RunStepStatus;
  startedAt: string;
  durationMs: number;
  outputSummary: string;
}

export interface Run {
  id: string;
  meetingId: string;
  meetingTitle: string;
  workflowId: string;
  status: "completed" | "needs_review" | "running";
  startedAt: string;
  completedAt?: string;
  recapDraft?: string;
  steps: RunStep[];
}

export interface Ticket {
  id: string;
  key: string;
  title: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
  assigneeId: string | null;
  dueDate: string;
  meetingId: string;
  segmentId: string;
  sourceKind: ExtractedKind;
}

export interface Promise {
  id: string;
  statement: string;
  ownerId: string | null;
  counterparty: string;
  dueDate: string;
  status: PromiseStatus;
  confidence: number; // 0 to 1
  meetingId: string;
  segmentId: string;
}

export type SidebarView = "meetings" | "workflow" | "tickets" | "promises";

export interface MeetMindState {
  people: Person[];
  meetings: Meeting[];
  selectedMeetingId: string;
  workflow: Workflow;
  runs: Run[];
  tickets: Ticket[];
  promises: Promise[];
}
