export type ExtractedKind = "Complaint" | "Decision" | "Commit" | "Action";
export type RawExtractedType = "decision" | "action" | "complaint" | "commit";
export type LiveExtractedCategory =
  | "Complaint"
  | "Task"
  | "Decision"
  | "Commit"
  | "Deadline"
  | "Meeting Request"
  | "Presentation Request";

export type MeetingStatus = "analyzing" | "ready" | "failed";

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
  endTimestamp?: string;
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
  priority?: TicketPriority;
  liveCategory?: LiveExtractedCategory;
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
  priority?: TicketPriority;
  liveCategory?: LiveExtractedCategory;
}

export type ExecutionToolBadge =
  | "Ticket"
  | "Gmail"
  | "Calendar"
  | "Slides"
  | "Slack"
  | "n8n";

export interface ExecutionPlanStep {
  id: string;
  stepNumber: number;
  title: string;
  owner: string;
  description: string;
  tool: ExecutionToolBadge;
  dependsOn: string[];
  status: "planned" | "waiting" | "done" | "skipped" | "failed";
}

export type PlannedToolName =
  | "create_ticket"
  | "draft_email"
  | "send_email"
  | "create_calendar_event"
  | "notify_slack"
  | "call_n8n"
  | "create_presentation";

export type PlannedToolStatus =
  | "pending"
  | "drafted"
  | "executed"
  | "skipped"
  | "failed";

export interface GeneratedSlide {
  title: string;
  subtitle?: string;
  layout: "title" | "agenda" | "bullets" | "actions" | "closing";
  bullets: string[];
  speakerNotes: string;
}

export interface SlideDeckData {
  deckTitle: string;
  subtitle: string;
  generatedAt: string;
  slides: GeneratedSlide[];
}

export interface LiveLogEntry {
  id: string;
  time: string;
  tool: string;
  status: "info" | "running" | "success" | "error" | "skipped";
  message: string;
}

export interface PlannedToolAction {
  id: string;
  toolName: PlannedToolName;
  title: string;
  description: string;
  args: Record<string, unknown>;
  status: PlannedToolStatus;
  idempotencyKey: string;
  gmailDraftId?: string;
  gmailDraftUrl?: string;
  sentAt?: string;
  calendarEventUrl?: string;
  ticketKey?: string;
  googlePresentationId?: string;
  googlePresentationUrl?: string;
  pptxFileName?: string;
  slideDeck?: SlideDeckData;
  attachPptx?: boolean;
  attachmentName?: string;
  error?: string;
  executedAt?: string;
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
  webhookUrl?: string;
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
  completedAt?: string;
  errorMessage?: string;
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
  language?: string;
  createdAt?: string;
  isLiveRecording?: boolean;
  status?: MeetingStatus;
  audioPath?: string;
  healthScore?: number;
  analysisError?: string;
  executionPlan?: ExecutionPlanStep[];
  plannedActions?: PlannedToolAction[];
  workflowSnapshot?: Workflow;
  slideDeck?: SlideDeckData;
  liveLog?: LiveLogEntry[];
}

export type RunStepStatus =
  | "idle"
  | "queued"
  | "running"
  | "completed"
  | "waiting"
  | "failed"
  | "skipped";

export interface RunStep {
  id: string;
  stepIndex: number;
  nodeId: string;
  nodeType: WorkflowNodeType;
  nodeLabel: string;
  idempotencyKey: string;
  status: RunStepStatus;
  startedAt: string;
  durationMs: number;
  outputSummary: string;
  error?: string;
  skippedDuplicate?: boolean;
  approverName?: string;
  actionUrl?: string;
  actionLabel?: string;
  waitingKind?: "approval" | "gmail" | "wait";
}

export interface Run {
  id: string;
  runNumber: number;
  meetingId: string;
  meetingTitle: string;
  workflowId: string;
  status: "completed" | "needs_review" | "running" | "failed";
  startedAt: string;
  completedAt?: string;
  recapDraft?: string;
  duplicatesBlockedInRun: number;
  steps: RunStep[];
}

export interface IdempotencyRecord {
  key: string;
  nodeId: string;
  meetingId: string;
  completedAt: string;
  outputSummary: string;
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
  sourceItemId?: string;
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
  sourceItemId?: string;
}

export type SidebarView =
  | "meetings"
  | "live"
  | "history"
  | "workflow"
  | "tickets"
  | "promises"
  | "check"
  | "settings";

export interface AppSettings {
  supabaseUrl: string;
  supabaseAnonKey: string;
  googleClientId: string;
  slackWebhookUrl: string;
  n8nWebhookUrl: string;
  geminiModel: string;
  testMode: boolean;
  testEmail: string;
}

export interface MeetMindState {
  people: Person[];
  meetings: Meeting[];
  selectedMeetingId: string;
  workflow: Workflow;
  runs: Run[];
  idempotencyLedger: Record<string, IdempotencyRecord>;
  duplicatesBlockedTotal: number;
  nextRunNumber: number;
  nextTicketNumber: number;
  tickets: Ticket[];
  promises: Promise[];
}
