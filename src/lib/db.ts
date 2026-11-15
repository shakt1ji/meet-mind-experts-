import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import type {
  ExecutionPlanStep,
  ExtractedItem,
  Meeting,
  MeetingStatus,
  NodeExecutionStatus,
  Person,
  Promise as PromiseRecord,
  PromiseStatus,
  Run,
  RunStep,
  RunStepStatus,
  Segment,
  Ticket,
  TicketPriority,
  TicketStatus,
  Workflow,
  WorkflowNodeType,
} from "../types/meetmind";
import { computeMeetingHealth } from "../utils/metrics";
import { loadAppSettings, validateSupabaseInputs } from "../utils/settingsStorage";

export type DbMode = "supabase" | "local";

export interface DbStatusInfo {
  mode: DbMode;
  message: string;
  projectHost?: string;
}

export interface SystemCheckStepResult {
  id: "db_rw" | "storage_rw" | "realtime";
  title: string;
  status: "pass" | "fail";
  detail: string;
  fixHint?: string;
}

export interface SystemCheckReport {
  mode: DbMode;
  checkedAt: string;
  steps: SystemCheckStepResult[];
}

interface DbMeetingRow {
  id: string;
  title: string | null;
  language: string | null;
  duration_sec: number | null;
  status: string | null;
  summary: string | null;
  transcript: unknown;
  items: unknown;
  plan: unknown;
  workflow: unknown;
  audio_path: string | null;
  health_score: number | null;
  created_at: string | null;
}

interface DbTicketRow {
  id: string;
  ticket_no: string | null;
  meeting_id: string;
  source_item_id: string | null;
  title: string;
  owner: string | null;
  priority: string | null;
  due: string | null;
  status: string | null;
  quote: string | null;
}

interface DbPromiseRow {
  id: string;
  meeting_id: string;
  source_item_id: string | null;
  owner: string | null;
  title: string;
  due: string | null;
  status: string | null;
  quote: string | null;
}

interface DbRunRow {
  id: string;
  run_no: number | null;
  meeting_id: string;
  status: string | null;
}

interface DbRunStepRow {
  id: string;
  run_id: string;
  meeting_id: string;
  node_id: string;
  tool: string | null;
  status: string | null;
  idempotency_key: string;
  output: string | null;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
}

let cachedClient: SupabaseClient | null = null;
let cachedSignature = "";
let lastFailureReason: string | null = null;

export function generateUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function getLazySupabaseClient(): {
  client: SupabaseClient | null;
  error?: string;
} {
  const settings = loadAppSettings();
  const check = validateSupabaseInputs(settings.supabaseUrl, settings.supabaseAnonKey);
  if (!check.valid) {
    cachedClient = null;
    cachedSignature = "";
    return { client: null, error: check.error };
  }

  const sig = `${settings.supabaseUrl}::${settings.supabaseAnonKey}`;
  if (cachedClient && cachedSignature === sig) {
    return { client: cachedClient };
  }

  try {
    cachedClient = createClient(settings.supabaseUrl, settings.supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
    cachedSignature = sig;
    lastFailureReason = null;
    return { client: cachedClient };
  } catch (err) {
    cachedClient = null;
    cachedSignature = "";
    return {
      client: null,
      error: err instanceof Error ? err.message : "Failed to initialize Supabase client.",
    };
  }
}

export function resetCachedSupabaseClient(): void {
  cachedClient = null;
  cachedSignature = "";
  lastFailureReason = null;
}

export function getDbStatusInfo(): DbStatusInfo {
  const settings = loadAppSettings();
  const check = validateSupabaseInputs(settings.supabaseUrl, settings.supabaseAnonKey);
  if (!check.valid) {
    return {
      mode: "local",
      message: "Local mode · Configure Supabase URL & anon key in Settings to sync.",
    };
  }
  if (lastFailureReason) {
    return {
      mode: "local",
      message: `Local mode fallback · ${lastFailureReason}`,
    };
  }
  try {
    const host = new URL(settings.supabaseUrl).hostname;
    return {
      mode: "supabase",
      projectHost: host,
      message: `Supabase live (${host})`,
    };
  } catch {
    return {
      mode: "local",
      message: "Local mode · Invalid Supabase URL.",
    };
  }
}

function formatDurationShort(sec: number): string {
  const s = Math.max(0, Math.round(sec || 0));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${String(m).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
}

function formatDisplayDate(iso?: string | null): string {
  if (!iso) return "Today";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Today";
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function resolvePersonIdByName(ownerName: string | null, people: Person[]): string | null {
  if (!ownerName) return null;
  const lower = ownerName.trim().toLowerCase();
  if (!lower || lower === "unassigned" || lower === "unowned") return null;
  const exact = people.find((p) => p.name.toLowerCase() === lower);
  if (exact) return exact.id;
  const partial = people.find(
    (p) => p.name.toLowerCase().includes(lower) || lower.includes(p.name.toLowerCase())
  );
  return partial?.id || null;
}

function getPersonNameById(personId: string | null, people: Person[]): string {
  if (!personId) return "Unassigned";
  return people.find((p) => p.id === personId)?.name || "Unassigned";
}

function mapRowToMeeting(row: DbMeetingRow): Meeting {
  const durationSec = Number(row.duration_sec) || 0;
  const segments = Array.isArray(row.transcript) ? (row.transcript as Segment[]) : [];
  const extractedItems = Array.isArray(row.items)
    ? (row.items as ExtractedItem[])
    : [];
  const executionPlan = Array.isArray(row.plan)
    ? (row.plan as ExecutionPlanStep[])
    : [];

  let workflowSnapshot: Workflow | undefined;
  let plannedActions: Meeting["plannedActions"];
  let slideDeck: Meeting["slideDeck"];
  let liveLog: Meeting["liveLog"];

  if (row.workflow && typeof row.workflow === "object") {
    const rawWf = row.workflow as Workflow & {
      __meta?: {
        plannedActions?: Meeting["plannedActions"];
        slideDeck?: Meeting["slideDeck"];
        liveLog?: Meeting["liveLog"];
      };
    };
    if (rawWf.__meta) {
      plannedActions = rawWf.__meta.plannedActions;
      slideDeck = rawWf.__meta.slideDeck;
      liveLog = rawWf.__meta.liveLog;
    }
    if (Array.isArray(rawWf.nodes) && Array.isArray(rawWf.edges)) {
      const { __meta: _ignored, ...cleanWf } = rawWf;
      void _ignored;
      workflowSnapshot = cleanWf;
    }
  }

  const speakerIds = Array.from(
    new Set(segments.map((s) => s.speakerId).filter(Boolean))
  );

  return {
    id: row.id,
    title: row.title || "Recorded Meeting",
    date: formatDisplayDate(row.created_at),
    duration: formatDurationShort(durationSec),
    durationSeconds: durationSec,
    speakerIds,
    segments,
    extractedItems,
    summary: row.summary || "",
    language: row.language || undefined,
    createdAt: row.created_at || new Date().toISOString(),
    isLiveRecording: Boolean(row.audio_path || row.status),
    status: (row.status as MeetingStatus) || "ready",
    audioPath: row.audio_path || undefined,
    healthScore:
      typeof row.health_score === "number" ? row.health_score : undefined,
    executionPlan,
    workflowSnapshot,
    plannedActions,
    slideDeck,
    liveLog,
  };
}

function mapMeetingToDbRow(meeting: Meeting): DbMeetingRow {
  const health =
    typeof meeting.healthScore === "number"
      ? meeting.healthScore
      : computeMeetingHealth(meeting).score;

  const meta =
    meeting.plannedActions || meeting.slideDeck || meeting.liveLog
      ? {
          ...(meeting.plannedActions ? { plannedActions: meeting.plannedActions } : {}),
          ...(meeting.slideDeck ? { slideDeck: meeting.slideDeck } : {}),
          ...(meeting.liveLog ? { liveLog: meeting.liveLog } : {}),
        }
      : undefined;

  const workflowPayload = meeting.workflowSnapshot
    ? meta
      ? { ...meeting.workflowSnapshot, __meta: meta }
      : meeting.workflowSnapshot
    : meta
    ? { __meta: meta }
    : null;

  return {
    id: meeting.id,
    title: meeting.title,
    language: meeting.language || "English / Hinglish",
    duration_sec: Math.round(meeting.durationSeconds || 0),
    status: meeting.status || "ready",
    summary: meeting.summary || "",
    transcript: meeting.segments || [],
    items: meeting.extractedItems || [],
    plan: meeting.executionPlan || [],
    workflow: workflowPayload,
    audio_path: meeting.audioPath || null,
    health_score: health,
    created_at: meeting.createdAt || new Date().toISOString(),
  };
}

function mapRowToTicket(row: DbTicketRow, people: Person[]): Ticket {
  const priority: TicketPriority =
    row.priority === "High" || row.priority === "Low" ? row.priority : "Medium";
  const status: TicketStatus =
    row.status === "In Progress" ||
    row.status === "Blocked" ||
    row.status === "Done"
      ? row.status
      : "Backlog";

  return {
    id: row.id,
    key: row.ticket_no || `TCK-${row.id.slice(0, 4).toUpperCase()}`,
    title: row.title,
    description: row.quote ? `Extracted quote: "${row.quote}"` : "Synced from MeetMind.",
    status,
    priority,
    assigneeId: resolvePersonIdByName(row.owner, people),
    dueDate: row.due || "TBD",
    meetingId: row.meeting_id,
    segmentId: "",
    sourceKind: priority === "High" ? "Complaint" : "Action",
    sourceItemId: row.source_item_id || undefined,
  };
}

function mapRowToPromise(row: DbPromiseRow, people: Person[]): PromiseRecord {
  const status: PromiseStatus =
    row.status === "Kept" || row.status === "At Risk" || row.status === "Overdue"
      ? row.status
      : "Open";

  return {
    id: row.id,
    statement: row.title,
    ownerId: resolvePersonIdByName(row.owner, people),
    counterparty: row.quote ? `"${row.quote.slice(0, 48)}"` : "Meeting Commitment",
    dueDate: row.due || "TBD",
    status,
    confidence: 0.9,
    meetingId: row.meeting_id,
    segmentId: "",
    sourceItemId: row.source_item_id || undefined,
  };
}

function mapDbRunStatus(raw: string | null): Run["status"] {
  if (raw === "completed" || raw === "needs_review" || raw === "failed") {
    return raw;
  }
  return "running";
}

function mapDbStepStatus(raw: string | null): RunStepStatus {
  if (
    raw === "done" ||
    raw === "completed"
  ) {
    return "completed";
  }
  if (raw === "running" || raw === "waiting" || raw === "failed" || raw === "skipped" || raw === "queued") {
    return raw;
  }
  return "idle";
}

function mapRowToRunStep(row: DbRunStepRow, index: number): RunStep {
  const toolType = (row.tool || "ticket") as WorkflowNodeType;
  return {
    id: row.id,
    stepIndex: index + 1,
    nodeId: row.node_id,
    nodeType: toolType,
    nodeLabel: row.node_id,
    idempotencyKey: row.idempotency_key,
    status: mapDbStepStatus(row.status),
    startedAt: row.started_at || "",
    durationMs: 0,
    outputSummary: row.output || "",
    error: row.error || undefined,
  };
}

export async function insertAnalyzingMeeting(
  meeting: Meeting
): Promise<{ ok: boolean; error?: string }> {
  const { client } = getLazySupabaseClient();
  if (!client) return { ok: false };

  try {
    const row = mapMeetingToDbRow({
      ...meeting,
      status: "analyzing",
    });
    const { error } = await client.from("meetings").upsert(row, { onConflict: "id" });
    if (error) {
      lastFailureReason = error.message;
      return { ok: false, error: error.message };
    }
    lastFailureReason = null;
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to save meeting.";
    lastFailureReason = msg;
    return { ok: false, error: msg };
  }
}

export async function updateMeetingRecord(
  meeting: Meeting
): Promise<{ ok: boolean; error?: string }> {
  const { client } = getLazySupabaseClient();
  if (!client) return { ok: false };

  try {
    const row = mapMeetingToDbRow(meeting);
    const { error } = await client
      .from("meetings")
      .upsert(row, { onConflict: "id" });
    if (error) {
      lastFailureReason = error.message;
      return { ok: false, error: error.message };
    }
    lastFailureReason = null;
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to update meeting.";
    lastFailureReason = msg;
    return { ok: false, error: msg };
  }
}

export async function uploadMeetingAudio(
  meetingId: string,
  blob: Blob
): Promise<{ audioPath?: string; error?: string }> {
  const { client } = getLazySupabaseClient();
  if (!client) return { error: "Local mode" };

  const audioPath = `${meetingId}.webm`;
  try {
    const { error } = await client.storage
      .from("recordings")
      .upload(audioPath, blob, {
        contentType: blob.type || "audio/webm",
        upsert: true,
      });

    if (error) {
      lastFailureReason = error.message;
      return { error: error.message };
    }
    lastFailureReason = null;
    return { audioPath };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Storage upload failed.";
    lastFailureReason = msg;
    return { error: msg };
  }
}

export async function getSignedAudioUrl(audioPath: string): Promise<string | null> {
  if (!audioPath) return null;
  const { client } = getLazySupabaseClient();
  if (!client) return null;

  try {
    const { data, error } = await client.storage
      .from("recordings")
      .createSignedUrl(audioPath, 3600);
    if (error || !data?.signedUrl) {
      return null;
    }
    return data.signedUrl;
  } catch {
    return null;
  }
}

export async function upsertTicketsAndPromises(
  meeting: Meeting,
  tickets: Ticket[],
  promises: PromiseRecord[],
  people: Person[]
): Promise<{ ok: boolean; error?: string }> {
  const { client } = getLazySupabaseClient();
  if (!client) return { ok: false };

  try {
    if (tickets.length > 0) {
      const ticketRows: DbTicketRow[] = tickets.map((t) => ({
        id: t.id,
        ticket_no: t.key,
        meeting_id: meeting.id,
        source_item_id: t.sourceItemId || t.id,
        title: t.title,
        owner: getPersonNameById(t.assigneeId, people),
        priority: t.priority,
        due: t.dueDate,
        status: t.status,
        quote:
          meeting.extractedItems.find((i) => i.id === t.sourceItemId)?.quote ||
          t.description,
      }));

      const { error: tErr } = await client
        .from("tickets")
        .upsert(ticketRows, {
          onConflict: "meeting_id,source_item_id",
          ignoreDuplicates: true,
        });
      if (tErr) {
        lastFailureReason = tErr.message;
        return { ok: false, error: tErr.message };
      }
    }

    if (promises.length > 0) {
      const promiseRows: DbPromiseRow[] = promises.map((p) => ({
        id: p.id,
        meeting_id: meeting.id,
        source_item_id: p.sourceItemId || p.id,
        owner: getPersonNameById(p.ownerId, people),
        title: p.statement,
        due: p.dueDate,
        status: p.status,
        quote:
          meeting.extractedItems.find((i) => i.id === p.sourceItemId)?.quote ||
          p.counterparty,
      }));

      const { error: pErr } = await client
        .from("promises")
        .upsert(promiseRows, {
          onConflict: "meeting_id,source_item_id",
          ignoreDuplicates: true,
        });
      if (pErr) {
        lastFailureReason = pErr.message;
        return { ok: false, error: pErr.message };
      }
    }

    lastFailureReason = null;
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to upsert tickets/promises.";
    lastFailureReason = msg;
    return { ok: false, error: msg };
  }
}

export async function updateTicketRow(ticket: Ticket, people: Person[]): Promise<void> {
  const { client } = getLazySupabaseClient();
  if (!client) return;
  try {
    await client
      .from("tickets")
      .update({
        status: ticket.status,
        owner: getPersonNameById(ticket.assigneeId, people),
        priority: ticket.priority,
        due: ticket.dueDate,
      })
      .eq("id", ticket.id);
  } catch {
    // Fallback to local state silently
  }
}

export async function updatePromiseRow(
  promise: PromiseRecord,
  people: Person[]
): Promise<void> {
  const { client } = getLazySupabaseClient();
  if (!client) return;
  try {
    await client
      .from("promises")
      .update({
        status: promise.status,
        owner: getPersonNameById(promise.ownerId, people),
        due: promise.dueDate,
      })
      .eq("id", promise.id);
  } catch {
    // Fallback to local state silently
  }
}

export async function fetchMeetingsFromDb(): Promise<{
  meetings: Meeting[];
  fromSupabase: boolean;
  error?: string;
}> {
  const { client } = getLazySupabaseClient();
  if (!client) {
    return { meetings: [], fromSupabase: false };
  }

  try {
    const { data, error } = await client
      .from("meetings")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      lastFailureReason = error.message;
      return { meetings: [], fromSupabase: false, error: error.message };
    }

    lastFailureReason = null;
    return {
      meetings: ((data || []) as DbMeetingRow[]).map(mapRowToMeeting),
      fromSupabase: true,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to query meetings.";
    lastFailureReason = msg;
    return { meetings: [], fromSupabase: false, error: msg };
  }
}

export async function fetchMeetingDetailsFromDb(
  meetingId: string,
  people: Person[],
  audioPath?: string
): Promise<{
  tickets: Ticket[];
  promises: PromiseRecord[];
  runs: Run[];
  signedAudioUrl?: string;
  error?: string;
}> {
  const { client } = getLazySupabaseClient();
  if (!client) {
    return { tickets: [], promises: [], runs: [] };
  }

  try {
    const [tRes, pRes, rRes, sRes, signedUrl] = await Promise.all([
      client.from("tickets").select("*").eq("meeting_id", meetingId),
      client.from("promises").select("*").eq("meeting_id", meetingId),
      client.from("runs").select("*").eq("meeting_id", meetingId),
      client.from("run_steps").select("*").eq("meeting_id", meetingId),
      audioPath ? getSignedAudioUrl(audioPath) : Promise.resolve(null),
    ]);

    const tickets = ((tRes.data || []) as DbTicketRow[]).map((r) =>
      mapRowToTicket(r, people)
    );
    const promises = ((pRes.data || []) as DbPromiseRow[]).map((r) =>
      mapRowToPromise(r, people)
    );
    const stepsByRun = new Map<string, DbRunStepRow[]>();
    ((sRes.data || []) as DbRunStepRow[]).forEach((step) => {
      const list = stepsByRun.get(step.run_id) || [];
      list.push(step);
      stepsByRun.set(step.run_id, list);
    });

    const runs: Run[] = ((rRes.data || []) as DbRunRow[]).map((r) => ({
      id: r.id,
      runNumber: r.run_no || 1,
      meetingId: r.meeting_id,
      meetingTitle: "",
      workflowId: "wf_1",
      status: mapDbRunStatus(r.status),
      startedAt: "",
      duplicatesBlockedInRun: 0,
      steps: (stepsByRun.get(r.id) || []).map((s, idx) => mapRowToRunStep(s, idx)),
    }));

    return {
      tickets,
      promises,
      runs,
      signedAudioUrl: signedUrl || undefined,
    };
  } catch (err) {
    return {
      tickets: [],
      promises: [],
      runs: [],
      error: err instanceof Error ? err.message : "Failed to load meeting details.",
    };
  }
}

export async function fetchAllWorkspaceFromDb(people: Person[]): Promise<{
  ok: boolean;
  meetings: Meeting[];
  tickets: Ticket[];
  promises: PromiseRecord[];
  runs: Run[];
  blockedCount: number;
  error?: string;
}> {
  const { client } = getLazySupabaseClient();
  if (!client) {
    return {
      ok: false,
      meetings: [],
      tickets: [],
      promises: [],
      runs: [],
      blockedCount: 0,
    };
  }

  try {
    const [mRes, tRes, pRes, rRes, sRes, bRes] = await Promise.all([
      client.from("meetings").select("*").order("created_at", { ascending: false }),
      client.from("tickets").select("*"),
      client.from("promises").select("*"),
      client.from("runs").select("*"),
      client.from("run_steps").select("*"),
      client.from("blocked_duplicates").select("*", { count: "exact", head: true }),
    ]);

    if (mRes.error) {
      lastFailureReason = mRes.error.message;
      return {
        ok: false,
        meetings: [],
        tickets: [],
        promises: [],
        runs: [],
        blockedCount: 0,
        error: mRes.error.message,
      };
    }

    const meetings = ((mRes.data || []) as DbMeetingRow[]).map(mapRowToMeeting);
    const tickets = ((tRes.data || []) as DbTicketRow[]).map((r) =>
      mapRowToTicket(r, people)
    );
    const promises = ((pRes.data || []) as DbPromiseRow[]).map((r) =>
      mapRowToPromise(r, people)
    );

    const stepsByRun = new Map<string, DbRunStepRow[]>();
    ((sRes.data || []) as DbRunStepRow[]).forEach((s) => {
      const arr = stepsByRun.get(s.run_id) || [];
      arr.push(s);
      stepsByRun.set(s.run_id, arr);
    });

    const runs: Run[] = ((rRes.data || []) as DbRunRow[]).map((r) => {
      const mtg = meetings.find((m) => m.id === r.meeting_id);
      return {
        id: r.id,
        runNumber: r.run_no || 1,
        meetingId: r.meeting_id,
        meetingTitle: mtg?.title || "Meeting Run",
        workflowId: "wf_1",
        status: mapDbRunStatus(r.status),
        startedAt: mtg?.date || "Today",
        duplicatesBlockedInRun: 0,
        steps: (stepsByRun.get(r.id) || []).map((s, idx) => mapRowToRunStep(s, idx)),
      };
    });

    lastFailureReason = null;
    return {
      ok: true,
      meetings,
      tickets,
      promises,
      runs,
      blockedCount: bRes.count ?? 0,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to fetch Supabase data.";
    lastFailureReason = msg;
    return {
      ok: false,
      meetings: [],
      tickets: [],
      promises: [],
      runs: [],
      blockedCount: 0,
      error: msg,
    };
  }
}

export async function createRunRow(run: Run): Promise<void> {
  const { client } = getLazySupabaseClient();
  if (!client) return;
  try {
    await client.from("runs").upsert(
      {
        id: run.id,
        run_no: run.runNumber,
        meeting_id: run.meetingId,
        status: run.status,
      },
      { onConflict: "id" }
    );
  } catch {
    // Fallback cleanly
  }
}

export async function updateRunRowStatus(runId: string, status: string): Promise<void> {
  const { client } = getLazySupabaseClient();
  if (!client) return;
  try {
    await client.from("runs").update({ status }).eq("id", runId);
  } catch {
    // Ignore
  }
}

export async function fetchBlockedDuplicatesCount(): Promise<number | null> {
  const { client } = getLazySupabaseClient();
  if (!client) return null;
  try {
    const { count, error } = await client
      .from("blocked_duplicates")
      .select("*", { count: "exact", head: true });
    if (error) return null;
    return count ?? 0;
  } catch {
    return null;
  }
}

export async function acquireRunStepIdempotency(params: {
  stepId: string;
  runId: string;
  meetingId: string;
  nodeId: string;
  tool: string;
  idempotencyKey: string;
}): Promise<{ duplicateBlocked: boolean; blockedCount?: number }> {
  const { client } = getLazySupabaseClient();
  if (!client) {
    return { duplicateBlocked: false };
  }

  try {
    const { error: insertErr } = await client.from("run_steps").insert({
      id: params.stepId,
      run_id: params.runId,
      meeting_id: params.meetingId,
      node_id: params.nodeId,
      tool: params.tool,
      status: "running",
      idempotency_key: params.idempotencyKey,
      started_at: new Date().toISOString(),
    });

    if (!insertErr) {
      return { duplicateBlocked: false };
    }

    // Check existing row if unique constraint violated (23505)
    const { data: existing } = await client
      .from("run_steps")
      .select("id, status")
      .eq("idempotency_key", params.idempotencyKey)
      .maybeSingle();

    if (insertErr.code === "23505" || existing) {
      if (existing && (existing.status === "failed" || existing.status === "queued")) {
        // Re-running a previously failed/queued step during Resume
        await client
          .from("run_steps")
          .update({
            status: "running",
            error: null,
            started_at: new Date().toISOString(),
          })
          .eq("id", existing.id);
        return { duplicateBlocked: false };
      }

      // Already done -> record in blocked_duplicates and skip!
      await client.from("blocked_duplicates").insert({
        id: generateUuid(),
        idempotency_key: params.idempotencyKey,
        meeting_id: params.meetingId,
        created_at: new Date().toISOString(),
      });

      const freshCount = await fetchBlockedDuplicatesCount();
      return {
        duplicateBlocked: true,
        blockedCount: freshCount ?? undefined,
      };
    }

    return { duplicateBlocked: false };
  } catch {
    return { duplicateBlocked: false };
  }
}

export async function updateRunStepRow(params: {
  idempotencyKey: string;
  status: "running" | "done" | "failed" | "waiting" | "queued";
  output?: string;
  error?: string;
}): Promise<void> {
  const { client } = getLazySupabaseClient();
  if (!client) return;

  try {
    await client
      .from("run_steps")
      .update({
        status: params.status,
        output: params.output ?? null,
        error: params.error ?? null,
        ...(params.status === "done" || params.status === "failed"
          ? { finished_at: new Date().toISOString() }
          : {}),
      })
      .eq("idempotency_key", params.idempotencyKey);
  } catch {
    // Ignore
  }
}

export async function resetFailedOrQueuedStepsInDb(runId: string): Promise<void> {
  const { client } = getLazySupabaseClient();
  if (!client) return;

  try {
    await client
      .from("run_steps")
      .update({ status: "queued", error: null })
      .eq("run_id", runId)
      .in("status", ["failed", "queued"]);
  } catch {
    // Ignore
  }
}

export interface RealtimeSyncHandlers {
  onMeetingChange?: (meeting: Meeting) => void;
  onTicketChange?: (ticket: Ticket) => void;
  onPromiseChange?: (promise: PromiseRecord) => void;
  onRunStepChange?: (step: {
    runId: string;
    meetingId: string;
    nodeId: string;
    status: NodeExecutionStatus;
    output?: string;
    error?: string;
  }) => void;
}

export function subscribeToRealtimeChanges(
  people: Person[],
  handlers: RealtimeSyncHandlers
): () => void {
  const { client } = getLazySupabaseClient();
  if (!client) return () => {};

  const channel: RealtimeChannel = client
    .channel(`meetmind-realtime-${Date.now()}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "meetings" },
      (payload) => {
        if (payload.new && typeof payload.new === "object" && handlers.onMeetingChange) {
          handlers.onMeetingChange(mapRowToMeeting(payload.new as DbMeetingRow));
        }
      }
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "tickets" },
      (payload) => {
        if (payload.new && typeof payload.new === "object" && handlers.onTicketChange) {
          handlers.onTicketChange(
            mapRowToTicket(payload.new as DbTicketRow, people)
          );
        }
      }
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "promises" },
      (payload) => {
        if (payload.new && typeof payload.new === "object" && handlers.onPromiseChange) {
          handlers.onPromiseChange(
            mapRowToPromise(payload.new as DbPromiseRow, people)
          );
        }
      }
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "run_steps" },
      (payload) => {
        if (payload.new && typeof payload.new === "object" && handlers.onRunStepChange) {
          const row = payload.new as DbRunStepRow;
          const mappedStatus: NodeExecutionStatus =
            row.status === "done" || row.status === "completed"
              ? "done"
              : row.status === "failed"
              ? "failed"
              : row.status === "running"
              ? "running"
              : row.status === "waiting"
              ? "waiting"
              : row.status === "queued"
              ? "queued"
              : "idle";
          handlers.onRunStepChange({
            runId: row.run_id,
            meetingId: row.meeting_id,
            nodeId: row.node_id,
            status: mappedStatus,
            output: row.output || undefined,
            error: row.error || undefined,
          });
        }
      }
    )
    .subscribe();

  return () => {
    void client.removeChannel(channel);
  };
}

export async function runSupabaseSystemCheck(): Promise<SystemCheckReport> {
  const checkedAt = new Date().toLocaleTimeString();
  const { client, error: initError } = getLazySupabaseClient();

  if (!client) {
    return {
      mode: "local",
      checkedAt,
      steps: [
        {
          id: "db_rw",
          title: "1. Database Insert & Delete (meetings)",
          status: "fail",
          detail: initError || "Supabase URL or anon key is missing.",
          fixHint: "Open Settings and enter your Supabase Project URL and anon public key.",
        },
        {
          id: "storage_rw",
          title: '2. Private Storage Upload & Delete ("recordings")',
          status: "fail",
          detail: "Skipped because Supabase client is not configured.",
          fixHint: "Configure Supabase credentials in Settings first.",
        },
        {
          id: "realtime",
          title: "3. Realtime Postgres Changes Event",
          status: "fail",
          detail: "Skipped because Supabase client is not configured.",
          fixHint: "Configure Supabase credentials in Settings first.",
        },
      ],
    };
  }

  const steps: SystemCheckStepResult[] = [];
  const dummyId = generateUuid();

  // Step 1: Insert & delete dummy row
  try {
    const { error: insErr } = await client.from("meetings").insert({
      id: dummyId,
      title: "__system_check_probe__",
      language: "English",
      duration_sec: 1,
      status: "ready",
      summary: "Probe",
      transcript: [],
      items: [],
      plan: [],
      workflow: null,
      audio_path: null,
      health_score: 100,
      created_at: new Date().toISOString(),
    });

    if (insErr) {
      throw insErr;
    }

    const { error: delErr } = await client.from("meetings").delete().eq("id", dummyId);
    if (delErr) {
      throw delErr;
    }

    steps.push({
      id: "db_rw",
      title: "1. Database Insert & Delete (meetings)",
      status: "pass",
      detail: "Inserted and cleaned up dummy row in public.meetings successfully.",
    });
  } catch (err) {
    const msg =
      typeof err === "object" && err && "message" in err
        ? String((err as { message: string }).message)
        : "Database write/delete failed.";
    const lower = msg.toLowerCase();
    let fixHint = "Verify your Supabase URL, anon key, and table schema.";
    if (lower.includes("row-level security") || lower.includes("permission denied")) {
      fixHint = "RLS policy missing on public.meetings (enable insert/select/delete for anon or configured policy).";
    } else if (lower.includes("jwt") || lower.includes("api key") || lower.includes("401")) {
      fixHint = "Wrong anon key or Project URL in Settings.";
    } else if (lower.includes("relation") && lower.includes("does not exist")) {
      fixHint = "Table public.meetings not found — create the MeetMind tables in SQL Editor.";
    }

    steps.push({
      id: "db_rw",
      title: "1. Database Insert & Delete (meetings)",
      status: "fail",
      detail: msg,
      fixHint,
    });
  }

  // Step 2: Upload & delete tiny test file in "recordings"
  const testPath = `system-check-${Date.now()}.webm`;
  try {
    const tinyBlob = new Blob(["meetmind-probe"], { type: "audio/webm" });
    const { error: upErr } = await client.storage
      .from("recordings")
      .upload(testPath, tinyBlob, { contentType: "audio/webm", upsert: true });
    if (upErr) throw upErr;

    const { error: rmErr } = await client.storage.from("recordings").remove([testPath]);
    if (rmErr) throw rmErr;

    steps.push({
      id: "storage_rw",
      title: '2. Private Storage Upload & Delete ("recordings")',
      status: "pass",
      detail: `Uploaded and deleted ${testPath} in bucket "recordings".`,
    });
  } catch (err) {
    const msg =
      typeof err === "object" && err && "message" in err
        ? String((err as { message: string }).message)
        : "Storage upload failed.";
    const lower = msg.toLowerCase();
    let fixHint = 'Check Storage policies on bucket "recordings".';
    if (lower.includes("bucket not found") || lower.includes("not found")) {
      fixHint = 'Bucket "recordings" not found — create a private bucket named "recordings" in Supabase Storage.';
    } else if (lower.includes("row-level security") || lower.includes("policy")) {
      fixHint = 'Storage RLS policy missing on storage.objects for bucket "recordings" (allow insert, select, delete).';
    }

    steps.push({
      id: "storage_rw",
      title: '2. Private Storage Upload & Delete ("recordings")',
      status: "fail",
      detail: msg,
      fixHint,
    });
  }

  // Step 3: Realtime postgres_changes confirmation
  const rtProbeId = generateUuid();
  let rtChannel: RealtimeChannel | null = null;
  try {
    const received = await new Promise<boolean>((resolve) => {
      let settled = false;
      const timer = window.setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve(false);
        }
      }, 5500);

      rtChannel = client
        .channel(`sys-check-${rtProbeId}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "meetings" },
          (payload) => {
            const rec = payload.new as { id?: string } | undefined;
            if (rec?.id === rtProbeId && !settled) {
              settled = true;
              window.clearTimeout(timer);
              resolve(true);
            }
          }
        )
        .subscribe(async (status) => {
          if (status === "SUBSCRIBED") {
            await client.from("meetings").insert({
              id: rtProbeId,
              title: "__realtime_probe__",
              duration_sec: 1,
              status: "ready",
              created_at: new Date().toISOString(),
            });
          }
        });
    });

    await client.from("meetings").delete().eq("id", rtProbeId);

    if (received) {
      steps.push({
        id: "realtime",
        title: "3. Realtime Postgres Changes Event",
        status: "pass",
        detail: "Subscribed and received live INSERT postgres_changes event on public.meetings.",
      });
    } else {
      steps.push({
        id: "realtime",
        title: "3. Realtime Postgres Changes Event",
        status: "fail",
        detail: "Timed out waiting 5.5s for postgres_changes INSERT event.",
        fixHint:
          "Enable Realtime replication for meetings, tickets, promises, and run_steps in Supabase Dashboard → Database → Replication.",
      });
    }
  } catch (err) {
    steps.push({
      id: "realtime",
      title: "3. Realtime Postgres Changes Event",
      status: "fail",
      detail: err instanceof Error ? err.message : "Realtime probe failed.",
      fixHint: "Check Realtime replication & RLS select policy on public.meetings.",
    });
  } finally {
    if (rtChannel) {
      void client.removeChannel(rtChannel);
    }
  }

  return {
    mode: "supabase",
    checkedAt,
    steps,
  };
}
