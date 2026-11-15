import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type FunctionDeclaration, GoogleGenAI, Type } from "@google/genai";

function resolveGeminiModel(requested?: string): string {
  const raw = (requested || "").trim().toLowerCase();
  if (
    !raw ||
    raw === "latest" ||
    raw === "gemini-flash" ||
    raw === "gemini-4-flash" ||
    raw === "gemini-latest" ||
    raw.includes("1.5") ||
    raw.includes("2.0") ||
    raw === "gemini-pro"
  ) {
    return "gemini-4-hydrogen";
  }
  return requested!.trim();
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === "production";

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured in environment secrets.");
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

interface RosterMemberInput {
  id: string;
  name: string;
  role: string;
  department: string;
}

interface SegmentInput {
  id: string;
  timestamp: string;
  speakerName: string;
  text: string;
}

interface RawItemCheck {
  type: string;
  title: string;
  quote: string;
  segmentId: string;
  timestamp: string;
  rawOwner: string;
  rawDue: string;
  confidence: number;
}

const VALID_TYPES = new Set(["decision", "action", "complaint", "commit"]);

function validateExtractionJson(rawText: string): {
  valid: boolean;
  parsed?: { summary: string; items: RawItemCheck[] };
  reason?: string;
} {
  let obj: unknown;
  try {
    obj = JSON.parse(rawText.trim());
  } catch {
    return { valid: false, reason: "Model returned malformed JSON." };
  }

  if (!obj || typeof obj !== "object") {
    return { valid: false, reason: "JSON root must be an object." };
  }

  const record = obj as Record<string, unknown>;
  if (!Array.isArray(record.items)) {
    return { valid: false, reason: "Missing items array in JSON." };
  }

  for (let i = 0; i < record.items.length; i++) {
    const it = record.items[i] as Record<string, unknown>;
    if (!it || typeof it !== "object") {
      return { valid: false, reason: `Item ${i} is not an object.` };
    }
    const type = typeof it.type === "string" ? it.type.toLowerCase() : "";
    if (!VALID_TYPES.has(type)) {
      return { valid: false, reason: `Item ${i} has invalid type "${String(it.type)}".` };
    }
    if (typeof it.title !== "string" || !it.title.trim()) {
      return { valid: false, reason: `Item ${i} is missing title.` };
    }
    if (typeof it.quote !== "string" || !it.quote.trim()) {
      return { valid: false, reason: `Item ${i} is missing quote.` };
    }
    if (typeof it.segmentId !== "string" || typeof it.timestamp !== "string") {
      return { valid: false, reason: `Item ${i} is missing segmentId or timestamp.` };
    }
    if (typeof it.rawOwner !== "string" || typeof it.rawDue !== "string") {
      return { valid: false, reason: `Item ${i} is missing rawOwner or rawDue.` };
    }
    if (
      typeof it.confidence !== "number" ||
      Number.isNaN(it.confidence) ||
      it.confidence < 0 ||
      it.confidence > 1
    ) {
      return { valid: false, reason: `Item ${i} confidence must be a number between 0 and 1.` };
    }
  }

  return {
    valid: true,
    parsed: {
      summary: typeof record.summary === "string" ? record.summary.trim() : "",
      items: (record.items as RawItemCheck[]).map((item) => ({
        ...item,
        type: item.type.toLowerCase(),
      })),
    },
  };
}

async function runStrictExtraction(
  ai: GoogleGenAI,
  title: string,
  segments: SegmentInput[],
  roster: RosterMemberInput[],
  retryReason?: string
): Promise<string> {
  const formattedTranscript = segments
    .map((s) => `[${s.id}] (${s.timestamp}) ${s.speakerName}: ${s.text}`)
    .join("\n");

  const formattedRoster = roster
    .map((p) => `- ${p.name} (${p.role}, ${p.department})`)
    .join("\n");

  const retryNote = retryReason
    ? `\n\nPREVIOUS ATTEMPT FAILED VALIDATION (${retryReason}). Strictly adhere to the JSON schema and exact field types.`
    : "";

  const prompt = `You are MeetMind's bilingual English & Hinglish meeting extraction engine.
Analyze the meeting "${title}" and extract ONLY items that have an explicit, verbatim supporting quote in the transcript.

Team Roster:
${formattedRoster}

Transcript:
${formattedTranscript}

Strict Rules:
1. Each item must have:
   - type: strictly one of "decision", "action", "complaint", or "commit"
   - title: concise English summary of the item
   - quote: EXACT verbatim substring copied from the transcript line (never paraphrase or invent quotes)
   - segmentId: exact segment ID from [seg_id]
   - timestamp: exact MM:SS timestamp from that segment
   - rawOwner: owner name or phrase as spoken (e.g., "Raj", "Meena", "Raj Patel", "someone", or "" if none spoken)
   - rawDue: due expression as spoken (e.g., "Friday", "next Thursday", "today", "tomorrow", or "" if none spoken)
   - confidence: float from 0 to 1 (e.g., 0.94 for clear items, < 0.7 for uncertain/ambiguous/vague items)
2. Understand Hinglish (Hindi words in Latin script mixed with English).
3. Never invent items without a verbatim supporting quote from the transcript.
4. Keep rawOwner faithful to what was spoken (e.g. return "Raj" if transcript says "Raj", do not guess between multiple Rajs).${retryNote}`;

  const response = await ai.models.generateContent({
    model: "gemini-4-hydrogen",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          summary: {
            type: Type.STRING,
            description: "Concise 2-sentence executive summary of the meeting.",
          },
          items: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                type: {
                  type: Type.STRING,
                  enum: ["decision", "action", "complaint", "commit"],
                },
                title: { type: Type.STRING },
                quote: { type: Type.STRING },
                segmentId: { type: Type.STRING },
                timestamp: { type: Type.STRING },
                rawOwner: { type: Type.STRING },
                rawDue: { type: Type.STRING },
                confidence: { type: Type.NUMBER },
              },
              required: [
                "type",
                "title",
                "quote",
                "segmentId",
                "timestamp",
                "rawOwner",
                "rawDue",
                "confidence",
              ],
            },
          },
        },
        required: ["summary", "items"],
      },
    },
  });

  return response.text || "{}";
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: "25mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, service: "meetmind-api" });
  });

  app.post("/api/gemini/extract", async (req, res) => {
    try {
      const { title, segments, roster } = req.body as {
        title?: string;
        segments?: SegmentInput[];
        roster?: RosterMemberInput[];
      };

      if (!Array.isArray(segments) || segments.length === 0) {
        res.status(400).json({ error: "Meeting transcript segments are required." });
        return;
      }

      const ai = getGeminiClient();
      const meetingTitle = title || "Team Sync";
      const teamRoster = Array.isArray(roster) ? roster : [];

      // Attempt 1
      const firstRaw = await runStrictExtraction(ai, meetingTitle, segments, teamRoster);
      const firstCheck = validateExtractionJson(firstRaw);

      if (firstCheck.valid && firstCheck.parsed) {
        res.json(firstCheck.parsed);
        return;
      }

      // Retry once if JSON validation failed
      const secondRaw = await runStrictExtraction(
        ai,
        meetingTitle,
        segments,
        teamRoster,
        firstCheck.reason
      );
      const secondCheck = validateExtractionJson(secondRaw);

      if (secondCheck.valid && secondCheck.parsed) {
        res.json(secondCheck.parsed);
        return;
      }

      res.status(422).json({
        error:
          "Gemini returned an unexpected format twice. Please verify your transcript text and try analyzing again.",
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to extract meeting items with Gemini.";
      res.status(500).json({ error: message });
    }
  });

  app.post("/api/gemini/transcribe", async (req, res) => {
    try {
      const { audioBase64, mimeType, roster } = req.body as {
        audioBase64?: string;
        mimeType?: string;
        roster?: RosterMemberInput[];
      };

      if (!audioBase64 || !mimeType) {
        res.status(400).json({
          error: "Audio file data and MIME type are required.",
          fallbackToPaste: true,
        });
        return;
      }

      const ai = getGeminiClient();
      const speakerHint = Array.isArray(roster) && roster.length > 0
        ? `Possible speakers on the call: ${roster.map((p) => p.name).join(", ")}.`
        : "";

      // Process audio once in-memory; never persist audio to disk or storage
      const response = await ai.models.generateContent({
        model: "gemini-3.5-transcribe",
        contents: {
          parts: [
            {
              inlineData: {
                mimeType,
                data: audioBase64,
              },
            },
            {
              text: `Transcribe this meeting audio verbatim (preserving English and Hinglish words in Latin script). Format each speaker turn on its own line as "MM:SS Speaker: transcript line". ${speakerHint}`,
            },
          ],
        },
      });

      const transcriptText = (response.text || "").trim();
      if (!transcriptText) {
        res.status(422).json({
          error: "Audio transcription returned empty text. Try pasting the transcript instead.",
          fallbackToPaste: true,
        });
        return;
      }

      res.json({ transcript: transcriptText });
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Multimodal audio transcription is unavailable right now.";
      res.status(500).json({
        error: `${message} You can paste your transcript directly as a fallback.`,
        fallbackToPaste: true,
      });
    }
  });

  app.post("/api/gemini/recap", async (req, res) => {
    try {
      const { meetingTitle, date, itemsSummary } = req.body as {
        meetingTitle?: string;
        date?: string;
        itemsSummary?: string;
      };

      if (!meetingTitle || !itemsSummary) {
        res.status(400).json({ error: "Meeting title and items summary are required." });
        return;
      }

      const ai = getGeminiClient();
      const response = await ai.models.generateContent({
        model: "gemini-4-hydrogen",
        contents: `Draft a crisp, professional client/team execution recap for the meeting "${meetingTitle}" (${date || "Today"}).
Include:
1. Key issues & decisions acknowledged
2. Committed actions with owners and due dates
3. Next check-in date if mentioned.
Keep it under 140 words, direct and ready to send.

Extracted Items:
${itemsSummary}`,
      });

      res.json({ recap: (response.text || "").trim() });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to generate recap.";
      res.status(500).json({ error: message });
    }
  });

  const VALID_WORKFLOW_NODE_TYPES = new Set([
    "trigger",
    "loop",
    "ticket",
    "approval",
    "gmail",
    "calendar",
    "wait",
    "slack-nudge",
  ]);

  function validateWorkflowJson(rawText: string): {
    valid: boolean;
    parsed?: { nodes: unknown[]; edges: unknown[] };
    reason?: string;
  } {
    let obj: unknown;
    try {
      obj = JSON.parse(rawText.trim());
    } catch {
      return { valid: false, reason: "Workflow response was not valid JSON." };
    }
    if (!obj || typeof obj !== "object") {
      return { valid: false, reason: "Workflow root must be an object." };
    }
    const rec = obj as Record<string, unknown>;
    if (!Array.isArray(rec.nodes) || !Array.isArray(rec.edges) || rec.nodes.length === 0) {
      return { valid: false, reason: "Workflow must include non-empty nodes and edges arrays." };
    }

    const ids = new Set<string>();
    for (let i = 0; i < rec.nodes.length; i++) {
      const n = rec.nodes[i] as Record<string, unknown>;
      if (!n || typeof n !== "object") {
        return { valid: false, reason: `Node ${i} is not an object.` };
      }
      const id = typeof n.id === "string" ? n.id.trim() : "";
      const type = typeof n.type === "string" ? n.type.toLowerCase().trim() : "";
      const label = typeof n.label === "string" ? n.label.trim() : "";
      if (!id || !label || !VALID_WORKFLOW_NODE_TYPES.has(type)) {
        return { valid: false, reason: `Node ${i} has invalid id, label, or type "${type}".` };
      }
      ids.add(id);
    }

    return {
      valid: true,
      parsed: {
        nodes: rec.nodes,
        edges: rec.edges,
      },
    };
  }

  const workflowResponseSchema = {
    type: Type.OBJECT,
    properties: {
      nodes: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.STRING },
            type: {
              type: Type.STRING,
              enum: [
                "trigger",
                "loop",
                "ticket",
                "approval",
                "gmail",
                "calendar",
                "wait",
                "slack-nudge",
              ],
            },
            label: { type: Type.STRING },
            description: { type: Type.STRING },
            configSummary: { type: Type.STRING },
            config: {
              type: Type.OBJECT,
              properties: {
                event: { type: Type.STRING },
                collection: { type: Type.STRING },
                filter: { type: Type.STRING },
                ticketTitle: { type: Type.STRING },
                owner: { type: Type.STRING },
                priority: { type: Type.STRING },
                dueDate: { type: Type.STRING },
                approver: { type: Type.STRING },
                rule: { type: Type.STRING },
                to: { type: Type.STRING },
                subject: { type: Type.STRING },
                body: { type: Type.STRING },
                eventTitle: { type: Type.STRING },
                attendees: { type: Type.STRING },
                date: { type: Type.STRING },
                time: { type: Type.STRING },
                durationMins: { type: Type.INTEGER },
                durationDays: { type: Type.INTEGER },
                condition: { type: Type.STRING },
                channel: { type: Type.STRING },
                message: { type: Type.STRING },
              },
            },
          },
          required: ["id", "type", "label", "description", "configSummary", "config"],
        },
      },
      edges: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.STRING },
            from: { type: Type.STRING },
            to: { type: Type.STRING },
            label: { type: Type.STRING },
          },
          required: ["id", "from", "to"],
        },
      },
    },
    required: ["nodes", "edges"],
  };

  app.post("/api/gemini/workflow/draft", async (req, res) => {
    try {
      const { meetingTitle, meetingDate, summary, extractedItems, roster } = req.body as {
        meetingTitle?: string;
        meetingDate?: string;
        summary?: string;
        extractedItems?: Array<{
          kind: string;
          title: string;
          dueDate: string;
          ownerName?: string;
          needsConfirmation?: boolean;
        }>;
        roster?: RosterMemberInput[];
      };

      if (!Array.isArray(extractedItems)) {
        res.status(400).json({ error: "Extracted items are required to draft a workflow." });
        return;
      }

      const ai = getGeminiClient();
      const itemsText = extractedItems
        .map(
          (i, idx) =>
            `${idx + 1}. [${i.kind}] ${i.title} (Owner: ${i.ownerName || "Unassigned"}, Due: ${i.dueDate}, NeedsConfirmation: ${Boolean(i.needsConfirmation)})`
        )
        .join("\n");

      const rosterText = (roster || []).map((p) => `${p.name} (${p.role})`).join(", ");

      const prompt = `You are MeetMind's workflow architect.
Generate an executable automation workflow JSON { nodes, edges } from these extracted meeting items.

Meeting: "${meetingTitle || "Team Sync"}" on ${meetingDate || "14 Nov 2026"}
Summary: ${summary || ""}
Team Roster: ${rosterText}

Extracted Items:
${itemsText}

Required workflow logic:
1. Start with a "trigger" node.
2. Convert complaints & high-priority actions into "ticket" nodes (optionally preceded by a "loop" node if iterating multiple items). Populate realistic ticketTitle, owner, priority ("High"|"Medium"|"Low"), and dueDate.
3. Add an "approval" node before external client comms (gate for Anita or human confirmation).
4. Add a "gmail" node sending a full recap email to the client with complete realistic "to", "subject", and multi-line "body".
5. Add a "calendar" node if a follow-up meeting/decision date was discussed (e.g. next Thursday), with eventTitle, attendees, date, time, durationMins.
6. Add a "wait" node (3 days) connected to a "slack-nudge" node to nudge owners if tickets remain open.
7. Only use node types from: "trigger", "loop", "ticket", "approval", "gmail", "calendar", "wait", "slack-nudge".`;

      const first = await ai.models.generateContent({
        model: "gemini-4-hydrogen",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: workflowResponseSchema,
        },
      });

      const check1 = validateWorkflowJson(first.text || "{}");
      if (check1.valid && check1.parsed) {
        res.json(check1.parsed);
        return;
      }

      const second = await ai.models.generateContent({
        model: "gemini-4-hydrogen",
        contents: `${prompt}\n\nPrevious attempt failed (${check1.reason}). Return strictly valid JSON matching the schema.`,
        config: {
          responseMimeType: "application/json",
          responseSchema: workflowResponseSchema,
        },
      });

      const check2 = validateWorkflowJson(second.text || "{}");
      if (check2.valid && check2.parsed) {
        res.json(check2.parsed);
        return;
      }

      res.status(422).json({
        error: "Gemini could not draft a valid workflow schema. Please try again.",
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to draft workflow with Gemini.";
      res.status(500).json({ error: message });
    }
  });

  app.post("/api/gemini/workflow/edit", async (req, res) => {
    try {
      const { currentWorkflow, instruction, meetingTitle, roster } = req.body as {
        currentWorkflow?: { nodes: unknown[]; edges: unknown[] };
        instruction?: string;
        meetingTitle?: string;
        roster?: RosterMemberInput[];
      };

      if (!currentWorkflow || !instruction?.trim()) {
        res.status(400).json({ error: "Current workflow JSON and edit instruction are required." });
        return;
      }

      const ai = getGeminiClient();
      const rosterText = (roster || []).map((p) => `${p.name} (${p.role})`).join(", ");

      const prompt = `You are MeetMind's workflow editor.
Apply the user's plain-English instruction to the existing workflow JSON while preserving existing node IDs and edges that were not removed.

Meeting: "${meetingTitle || "Team Sync"}"
Roster: ${rosterText}

Current Workflow JSON:
${JSON.stringify(currentWorkflow, null, 2)}

User Edit Instruction:
"${instruction.trim()}"

Rules:
1. Keep existing node IDs unchanged when modifying or keeping them, and assign clean new IDs (e.g. "node_ops_nudge") for any newly added nodes.
2. Populate realistic config fields for any new or modified nodes (e.g. channel, condition, message for slack-nudge; to, subject, body for gmail; ticketTitle, owner, priority, dueDate for ticket; durationDays for wait).
3. Only use node types: "trigger", "loop", "ticket", "approval", "gmail", "calendar", "wait", "slack-nudge".
4. Connect new nodes cleanly into the DAG with valid edges.`;

      const first = await ai.models.generateContent({
        model: "gemini-4-hydrogen",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: workflowResponseSchema,
        },
      });

      const check1 = validateWorkflowJson(first.text || "{}");
      if (check1.valid && check1.parsed) {
        res.json(check1.parsed);
        return;
      }

      const second = await ai.models.generateContent({
        model: "gemini-4-hydrogen",
        contents: `${prompt}\n\nPrevious attempt failed (${check1.reason}). Return strictly valid JSON matching the schema.`,
        config: {
          responseMimeType: "application/json",
          responseSchema: workflowResponseSchema,
        },
      });

      const check2 = validateWorkflowJson(second.text || "{}");
      if (check2.valid && check2.parsed) {
        res.json(check2.parsed);
        return;
      }

      res.status(422).json({
        error: "Could not apply plain-English edit cleanly. Please rephrase and try again.",
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to edit workflow with Gemini.";
      res.status(500).json({ error: message });
    }
  });

  app.post("/api/gemini/brief", async (req, res) => {
    try {
      const { nextMeetingTitle, currentDate, promises } = req.body as {
        nextMeetingTitle?: string;
        currentDate?: string;
        promises?: Array<{
          statement: string;
          ownerName: string;
          dueDate: string;
          computedStatus: string;
          daysOverdue: number;
          sourceMeeting: string;
        }>;
      };

      if (!Array.isArray(promises)) {
        res.status(400).json({ error: "Promises payload is required to generate a brief." });
        return;
      }

      const ai = getGeminiClient();
      const summaryInput = promises
        .map(
          (p, i) =>
            `${i + 1}. "${p.statement}" | Owner: ${p.ownerName} | Due: ${p.dueDate} | Status: ${p.computedStatus} (${p.daysOverdue} days overdue) | From: ${p.sourceMeeting}`
        )
        .join("\n");

      const response = await ai.models.generateContent({
        model: "gemini-4-hydrogen",
        contents: `Write an executive pre-meeting brief for "${nextMeetingTitle || "Upcoming Sync"}" (Current date: ${currentDate || "14 Nov 2026"}).
Return EXACTLY 4 crisp bullet-style lines summarizing unkept and overdue promises from previous meetings, explicitly naming the owners and days overdue.

Unkept Promises:
${summaryInput || "No unkept promises."}`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              lines: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "Exactly 4 concise summary lines mentioning owner names and days overdue.",
              },
            },
            required: ["lines"],
          },
        },
      });

      const parsed = JSON.parse((response.text || "{}").trim()) as { lines?: unknown };
      const lines = Array.isArray(parsed.lines)
        ? parsed.lines.filter((l): l is string => typeof l === "string" && l.trim().length > 0).slice(0, 4)
        : [];

      if (lines.length === 0) {
        res.status(422).json({ error: "Gemini returned an empty brief." });
        return;
      }

      res.json({ lines, generatedAt: "Gemini Live" });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to generate pre-meeting brief.";
      res.status(500).json({ error: message });
    }
  });

  // Live Meeting Mode: Multimodal Audio Analysis (Hindi / English / Hinglish)
  const VALID_LIVE_ITEM_TYPES = new Set([
    "complaint",
    "task",
    "decision",
    "commit",
    "deadline",
    "meeting_request",
    "presentation_request",
  ]);

  function validateLiveAudioAnalysisJson(rawText: string): {
    valid: boolean;
    parsed?: {
      title: string;
      language: string;
      durationSec: number;
      summary: string;
      transcript: Array<{ start: string; end: string; speaker: string; text: string }>;
      items: Array<{
        type: string;
        title: string;
        quote: string;
        timestamp: string;
        rawOwner: string;
        rawDue: string;
        priority: string;
        confidence: number;
      }>;
      executionPlan: Array<{
        stepNumber: number;
        title: string;
        owner: string;
        description: string;
        tool: string;
        dependsOn: string[];
      }>;
    };
    reason?: string;
  } {
    let obj: unknown;
    try {
      obj = JSON.parse(rawText.trim());
    } catch {
      return { valid: false, reason: "Model returned malformed JSON." };
    }
    if (!obj || typeof obj !== "object") {
      return { valid: false, reason: "Root JSON must be an object." };
    }
    const rec = obj as Record<string, unknown>;
    if (!Array.isArray(rec.transcript) || !Array.isArray(rec.items)) {
      return { valid: false, reason: "Missing transcript or items array." };
    }

    for (let i = 0; i < rec.items.length; i++) {
      const it = rec.items[i] as Record<string, unknown>;
      const t = typeof it?.type === "string" ? it.type.toLowerCase() : "";
      if (!VALID_LIVE_ITEM_TYPES.has(t)) {
        return { valid: false, reason: `Item ${i} has invalid type "${String(it?.type)}".` };
      }
      if (typeof it.title !== "string" || !it.title.trim()) {
        return { valid: false, reason: `Item ${i} is missing title.` };
      }
      if (typeof it.quote !== "string" || !it.quote.trim()) {
        return { valid: false, reason: `Item ${i} is missing quote.` };
      }
      if (typeof it.confidence !== "number" || Number.isNaN(it.confidence)) {
        return { valid: false, reason: `Item ${i} is missing numeric confidence.` };
      }
    }

    const plan = Array.isArray(rec.executionPlan)
      ? (rec.executionPlan as Array<Record<string, unknown>>).map((step, idx) => ({
          stepNumber: typeof step.stepNumber === "number" ? step.stepNumber : idx + 1,
          title: typeof step.title === "string" ? step.title : `Step ${idx + 1}`,
          owner: typeof step.owner === "string" ? step.owner : "Team",
          description: typeof step.description === "string" ? step.description : "",
          tool: typeof step.tool === "string" ? step.tool : "Ticket",
          dependsOn: Array.isArray(step.dependsOn)
            ? step.dependsOn.filter((d): d is string => typeof d === "string")
            : [],
        }))
      : [];

    return {
      valid: true,
      parsed: {
        title: typeof rec.title === "string" && rec.title.trim() ? rec.title.trim() : "",
        language: typeof rec.language === "string" && rec.language.trim() ? rec.language.trim() : "English / Hinglish",
        durationSec: typeof rec.durationSec === "number" && rec.durationSec > 0 ? Math.round(rec.durationSec) : 10,
        summary: typeof rec.summary === "string" ? rec.summary.trim() : "",
        transcript: (rec.transcript as Array<Record<string, unknown>>).map((t) => ({
          start: typeof t.start === "string" ? t.start : "00:00",
          end: typeof t.end === "string" ? t.end : "00:05",
          speaker: typeof t.speaker === "string" && t.speaker.trim() ? t.speaker.trim() : "Speaker",
          text: typeof t.text === "string" ? t.text.trim() : "",
        })).filter((t) => t.text.length > 0),
        items: (rec.items as Array<Record<string, unknown>>).map((it) => ({
          type: String(it.type).toLowerCase(),
          title: String(it.title).trim(),
          quote: String(it.quote).trim(),
          timestamp: typeof it.timestamp === "string" ? it.timestamp : "00:00",
          rawOwner: typeof it.rawOwner === "string" ? it.rawOwner : "",
          rawDue: typeof it.rawDue === "string" ? it.rawDue : "",
          priority: typeof it.priority === "string" ? it.priority : "Medium",
          confidence: Math.min(1, Math.max(0, Number(it.confidence))),
        })),
        executionPlan: plan,
      },
    };
  }

  app.post("/api/gemini/analyze-audio", async (req, res) => {
    try {
      const { audioBase64, mimeType, durationSec, modelName, roster, currentDate } = req.body as {
        audioBase64?: string;
        mimeType?: string;
        durationSec?: number;
        modelName?: string;
        roster?: RosterMemberInput[];
        currentDate?: string;
      };

      if (!audioBase64 || !mimeType) {
        res.status(400).json({ error: "Recorded or uploaded audio data and MIME type are required." });
        return;
      }

      const ai = getGeminiClient();
      const model = resolveGeminiModel(modelName);
      const teamRoster = Array.isArray(roster) ? roster : [];
      const rosterHint = teamRoster.map((p) => `- ${p.name} (${p.role}, ${p.department})`).join("\n");

      const liveAudioSchema = {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          language: { type: Type.STRING },
          durationSec: { type: Type.NUMBER },
          summary: { type: Type.STRING },
          transcript: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                start: { type: Type.STRING },
                end: { type: Type.STRING },
                speaker: { type: Type.STRING },
                text: { type: Type.STRING },
              },
              required: ["start", "end", "speaker", "text"],
            },
          },
          items: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                type: {
                  type: Type.STRING,
                  enum: [
                    "complaint",
                    "task",
                    "decision",
                    "commit",
                    "deadline",
                    "meeting_request",
                    "presentation_request",
                  ],
                },
                title: { type: Type.STRING },
                quote: { type: Type.STRING },
                timestamp: { type: Type.STRING },
                rawOwner: { type: Type.STRING },
                rawDue: { type: Type.STRING },
                priority: { type: Type.STRING, enum: ["High", "Medium", "Low"] },
                confidence: { type: Type.NUMBER },
              },
              required: [
                "type",
                "title",
                "quote",
                "timestamp",
                "rawOwner",
                "rawDue",
                "priority",
                "confidence",
              ],
            },
          },
          executionPlan: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                stepNumber: { type: Type.INTEGER },
                title: { type: Type.STRING },
                owner: { type: Type.STRING },
                description: { type: Type.STRING },
                tool: {
                  type: Type.STRING,
                  enum: ["Ticket", "Gmail", "Calendar", "Slides", "Slack", "n8n"],
                },
                dependsOn: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
              },
              required: ["stepNumber", "title", "owner", "description", "tool", "dependsOn"],
            },
          },
        },
        required: ["language", "durationSec", "summary", "transcript", "items", "executionPlan"],
      };

      const runOnce = async (retryHint?: string) => {
        const prompt = `You are MeetMind's multimodal meeting intelligence engine.
Listen carefully to the attached audio clip (measured duration: ~${durationSec || "unknown"} seconds, meeting date: ${currentDate || "Today"}).

Team Roster (match speakers/owners if clear, otherwise keep spoken name faithfully e.g. "Raj" or "Speaker 1"):
${rosterHint || "- Anita (Manager)\n- Raj Patel (Engineer)\n- Meena (Finance)"}

Strict Instructions:
1. Transcribe the audio accurately in its original spoken language:
   - Support Hindi, English, and Hinglish.
   - ALWAYS write Hinglish/Hindi words in clean Roman script (Latin characters, e.g. "Main Friday tak fix kar dunga"), NOT Devanagari, unless purely Devanagari is clearly needed.
   - Provide a short descriptive "title" (3-6 words) for the meeting based on its content.
   - Provide start and end timestamps as "MM:SS" for each speaker turn.
2. Extract ONLY items directly supported by a verbatim quote copied from your transcript turns. NEVER invent items or tasks not spoken in the audio.
3. For each item:
   - type: one of "complaint", "task", "decision", "commit", "deadline", "meeting_request", "presentation_request"
   - quote: exact verbatim substring from the transcript
   - timestamp: "MM:SS" of that turn
   - rawOwner: spoken owner (or "" if none)
   - rawDue: spoken relative/exact date (or "" if none)
   - priority: "High", "Medium", or "Low"
   - confidence: float 0..1 (< 0.7 if unclear/ambiguous)
4. Also build "executionPlan": an ordered, numbered list of clear human-readable execution steps covering who does what, in what order, what depends on what (e.g. ["Step 1"]), and which tool ("Ticket"|"Gmail"|"Calendar"|"Slides"|"Slack"|"n8n") handles it.${retryHint ? `\n\nPREVIOUS OUTPUT FAILED VALIDATION (${retryHint}). Fix strictly.` : ""}`;

        const resp = await ai.models.generateContent({
          model,
          contents: {
            parts: [
              {
                inlineData: {
                  mimeType,
                  data: audioBase64,
                },
              },
              { text: prompt },
            ],
          },
          config: {
            responseMimeType: "application/json",
            responseSchema: liveAudioSchema,
          },
        });
        return resp.text || "{}";
      };

      const raw1 = await runOnce();
      const check1 = validateLiveAudioAnalysisJson(raw1);
      if (check1.valid && check1.parsed) {
        res.json({
          ...check1.parsed,
          durationSec: durationSec && durationSec > 0 ? durationSec : check1.parsed.durationSec,
        });
        return;
      }

      const raw2 = await runOnce(check1.reason);
      const check2 = validateLiveAudioAnalysisJson(raw2);
      if (check2.valid && check2.parsed) {
        res.json({
          ...check2.parsed,
          durationSec: durationSec && durationSec > 0 ? durationSec : check2.parsed.durationSec,
        });
        return;
      }

      res.status(422).json({
        error:
          "Audio analysis returned an unexpected JSON format twice. Please record clearly or try again.",
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to analyze meeting audio with Gemini.";
      res.status(500).json({ error: message });
    }
  });

  // Live Meeting Mode: Gemini Function Calling Tool Planner (Human-in-the-loop)
  app.post("/api/gemini/plan-tools", async (req, res) => {
    try {
      const {
        meetingId,
        meetingTitle,
        summary,
        items,
        executionPlan,
        roster,
        modelName,
        customConnectors,
      } = req.body as {
        meetingId?: string;
        meetingTitle?: string;
        summary?: string;
        items?: Array<{
          kind?: string;
          liveCategory?: string;
          title: string;
          quote: string;
          dueDate: string;
          ownerName?: string;
          priority?: string;
        }>;
        executionPlan?: Array<{
          stepNumber: number;
          title: string;
          owner: string;
          tool: string;
          description: string;
        }>;
        roster?: RosterMemberInput[];
        modelName?: string;
        customConnectors?: Array<{
          id?: string;
          name?: string;
          toolName?: string;
          description?: string;
          endpointUrl?: string;
          enabled?: boolean;
          params?: Array<{
            name?: string;
            type?: string;
            description?: string;
            required?: boolean;
          }>;
        }>;
      };

      if (!Array.isArray(items) || items.length === 0) {
        res.status(400).json({ error: "Extracted items are required to plan tool actions." });
        return;
      }

      const ai = getGeminiClient();
      const model = resolveGeminiModel(modelName);

      const declarations: FunctionDeclaration[] = [
        {
          name: "create_ticket",
          description: "Create a tracked engineering/ops ticket in MeetMind & Firestore.",
          parameters: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              owner: { type: Type.STRING },
              priority: { type: Type.STRING, enum: ["High", "Medium", "Low"] },
              due: { type: Type.STRING },
              quote: { type: Type.STRING },
            },
            required: ["title", "owner", "priority", "due", "quote"],
          },
        },
        {
          name: "draft_email",
          description: "Create a Gmail draft with meeting recap, complaint acknowledgement, and deadlines.",
          parameters: {
            type: Type.OBJECT,
            properties: {
              to: { type: Type.STRING },
              subject: { type: Type.STRING },
              body: { type: Type.STRING },
            },
            required: ["to", "subject", "body"],
          },
        },
        {
          name: "create_calendar_event",
          description: "Schedule a follow-up event in Google Calendar.",
          parameters: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              date: { type: Type.STRING },
              time: { type: Type.STRING },
              durationMins: { type: Type.INTEGER },
              attendees: { type: Type.ARRAY, items: { type: Type.STRING } },
              description: { type: Type.STRING },
            },
            required: ["title", "date", "attendees", "description"],
          },
        },
        {
          name: "notify_slack",
          description: "Send a Slack channel update summarizing owners and deadlines.",
          parameters: {
            type: Type.OBJECT,
            properties: {
              message: { type: Type.STRING },
            },
            required: ["message"],
          },
        },
        {
          name: "call_n8n",
          description: "Trigger downstream n8n/Zapier webhook with meeting metadata and extracted items.",
          parameters: {
            type: Type.OBJECT,
            properties: {
              meetingId: { type: Type.STRING },
              meetingTitle: { type: Type.STRING },
              event: { type: Type.STRING },
              itemCount: { type: Type.INTEGER },
            },
            required: ["meetingId", "meetingTitle", "event"],
          },
        },
        {
          name: "create_presentation",
          description:
            "Generate a 6-8 slide presentation in Google Slides and downloadable .pptx deck summarizing meeting points, decisions, and action items.",
          parameters: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              slideCount: { type: Type.INTEGER },
            },
            required: ["title"],
          },
        },
      ];

      const builtInNames = new Set(declarations.map((d) => d.name));
      const activeCustomConnectors = (Array.isArray(customConnectors) ? customConnectors : []).filter(
        (c) =>
          c &&
          c.enabled !== false &&
          typeof c.toolName === "string" &&
          c.toolName.trim().length > 0 &&
          typeof c.endpointUrl === "string" &&
          c.endpointUrl.trim().length > 0 &&
          !builtInNames.has(c.toolName.trim())
      );

      for (const conn of activeCustomConnectors) {
        const cleanToolName = String(conn.toolName)
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9_]/g, "_")
          .slice(0, 60);
        if (!cleanToolName || builtInNames.has(cleanToolName)) continue;
        builtInNames.add(cleanToolName);

        const properties: Record<string, { type: Type; description?: string }> = {};
        const required: string[] = [];

        for (const p of conn.params || []) {
          const paramName = (p.name || "").trim().replace(/[^a-zA-Z0-9_]/g, "_");
          if (!paramName) continue;
          properties[paramName] = {
            type:
              p.type === "number"
                ? Type.NUMBER
                : p.type === "boolean"
                ? Type.BOOLEAN
                : Type.STRING,
            description: p.description || paramName,
          };
          if (p.required) required.push(paramName);
        }

        if (Object.keys(properties).length === 0) {
          properties.summary = {
            type: Type.STRING,
            description: "Concise meeting action payload to send to this connector.",
          };
          required.push("summary");
        }

        declarations.push({
          name: cleanToolName,
          description: `[User Connector: ${conn.name || cleanToolName}] ${
            conn.description || "Trigger this connected integration with extracted meeting details."
          }`,
          parameters: {
            type: Type.OBJECT,
            properties,
            required,
          },
        });
      }

      const itemsSummary = items
        .map(
          (it, i) =>
            `${i + 1}. [${it.liveCategory || it.kind || "Action"}] ${it.title} | Owner: ${it.ownerName || "Unassigned"} | Due: ${it.dueDate} | Priority: ${it.priority || "Medium"} | Quote: "${it.quote}"`
        )
        .join("\n");

      const planSummary = (executionPlan || [])
        .map((p) => `${p.stepNumber}. [${p.tool}] ${p.title} (${p.owner}): ${p.description}`)
        .join("\n");

      const rosterSummary = (roster || []).map((r) => `${r.name} <${r.role}>`).join(", ");

      const hasPresentationRequest =
        items.some(
          (it) =>
            (it.liveCategory || "").toLowerCase().includes("presentation") ||
            `${it.title} ${it.quote}`.toLowerCase().match(/\b(slides|deck|ppt|pptx|presentation)\b/)
        ) ||
        (executionPlan || []).some((p) => p.tool.toLowerCase() === "slides");

      const customConnectorsHint =
        activeCustomConnectors.length > 0
          ? `\n- User-Connected Custom Tools (${activeCustomConnectors
              .map((c) => `${c.toolName}: ${c.description}`)
              .join("; ")}): call these custom tools whenever relevant to the meeting items.`
          : "";

      const prompt = `You are MeetMind's execution planner. Based on this meeting's extracted items and execution plan, emit the exact function calls needed to prepare all actions for human approval.

Meeting ID: ${meetingId || "mtg_live"}
Meeting Title: ${meetingTitle || "Live Meeting"}
Summary: ${summary || ""}
Roster: ${rosterSummary}

Extracted Items:
${itemsSummary}

Execution Plan:
${planSummary}

Call the appropriate tools:
- create_ticket for complaints and high-priority tasks/commits
- draft_email once for a complete, polite recap email (NEVER call send_email directly; human reviews draft first)
- create_calendar_event if a follow-up meeting or review was discussed
- notify_slack once for the team summary
- call_n8n once with meetingId "${meetingId || "mtg_live"}" so downstream workflows can sync
- ${hasPresentationRequest ? "MUST call create_presentation (6-8 slides) because a presentation/deck was requested." : "call create_presentation (6-8 slides) if a stakeholder summary deck would be helpful."}${customConnectorsHint}`;

      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          tools: [{ functionDeclarations: declarations }],
        },
      });

      const functionCalls = response.functionCalls || [];
      if (functionCalls.length === 0) {
        res.status(422).json({
          error: "Gemini did not propose any structured tool calls for this meeting.",
        });
        return;
      }

      res.json({
        toolCalls: functionCalls.map((fc, idx) => ({
          id: fc.id || `fc_${Date.now()}_${idx}`,
          name: fc.name || "create_ticket",
          args: (fc.args as Record<string, unknown>) || {},
        })),
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to plan tool actions with Gemini.";
      res.status(500).json({ error: message });
    }
  });

  // Live Meeting Mode: Gemini 6-8 Slide Deck Generator
  app.post("/api/gemini/generate-slides", async (req, res) => {
    try {
      const { meetingTitle, date, summary, items, modelName } = req.body as {
        meetingTitle?: string;
        date?: string;
        summary?: string;
        items?: Array<{
          kind?: string;
          liveCategory?: string;
          title: string;
          ownerName?: string;
          dueDate?: string;
          priority?: string;
        }>;
        modelName?: string;
      };

      const ai = getGeminiClient();
      const model = resolveGeminiModel(modelName);

      const slidesSchema = {
        type: Type.OBJECT,
        properties: {
          deckTitle: { type: Type.STRING },
          subtitle: { type: Type.STRING },
          slides: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                subtitle: { type: Type.STRING },
                layout: {
                  type: Type.STRING,
                  enum: ["title", "agenda", "bullets", "actions", "closing"],
                },
                bullets: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
                speakerNotes: { type: Type.STRING },
              },
              required: ["title", "layout", "bullets", "speakerNotes"],
            },
          },
        },
        required: ["deckTitle", "subtitle", "slides"],
      };

      const itemLines = (items || [])
        .map(
          (it, i) =>
            `${i + 1}. [${it.liveCategory || it.kind || "Action"}] ${it.title} — Owner: ${
              it.ownerName || "Unassigned"
            }, Due: ${it.dueDate || "TBD"}, Priority: ${it.priority || "Medium"}`
        )
        .join("\n");

      const runGenerate = async (retryHint?: string) => {
        const prompt = `Create an executive 6-to-8 slide presentation deck from this meeting.
Meeting Title: "${meetingTitle || "Team Sync"}" (${date || "Today"})
Summary: ${summary || "Key meeting highlights and action items."}

Extracted Items:
${itemLines || "1. Review meeting recap and assign next steps."}

Required 6-8 slides structure:
1. Title slide (layout: "title") with crisp deckTitle & date/context subtitle
2. Agenda & Context (layout: "agenda")
3. Key Complaints & Risks Raised (layout: "bullets")
4. Decisions Locked (layout: "bullets")
5. Action Items, Owners & Real Deadlines (layout: "actions")
6. SLA / Follow-Up Timeline (layout: "bullets")
7. Next Steps & Sign-off (layout: "closing")

Rules:
- Generate between 6 and 8 slides total.
- Keep bullets sharp, scannable (max 4-5 bullets per slide, under 18 words each).
- Include helpful speakerNotes on every slide.${
          retryHint ? `\n\nPREVIOUS OUTPUT FAILED (${retryHint}). Return strictly valid JSON with 6-8 slides.` : ""
        }`;

        const resp = await ai.models.generateContent({
          model,
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            responseSchema: slidesSchema,
          },
        });
        return resp.text || "{}";
      };

      const validateDeck = (rawText: string) => {
        try {
          const parsed = JSON.parse(rawText.trim()) as {
            deckTitle?: string;
            subtitle?: string;
            slides?: Array<{
              title?: string;
              subtitle?: string;
              layout?: string;
              bullets?: unknown[];
              speakerNotes?: string;
            }>;
          };
          if (!parsed.deckTitle || !Array.isArray(parsed.slides) || parsed.slides.length < 4) {
            return { valid: false as const, reason: "Expected deckTitle and at least 4 slides." };
          }
          const validLayouts = new Set(["title", "agenda", "bullets", "actions", "closing"]);
          return {
            valid: true as const,
            deck: {
              deckTitle: parsed.deckTitle.trim(),
              subtitle: (parsed.subtitle || `${meetingTitle || "Meeting"} · ${date || "Today"}`).trim(),
              generatedAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
              slides: parsed.slides.slice(0, 8).map((s, idx) => ({
                title: (s.title || `Slide ${idx + 1}`).trim(),
                subtitle: typeof s.subtitle === "string" ? s.subtitle.trim() : "",
                layout: (validLayouts.has(s.layout || "") ? s.layout : "bullets") as
                  | "title"
                  | "agenda"
                  | "bullets"
                  | "actions"
                  | "closing",
                bullets: Array.isArray(s.bullets)
                  ? s.bullets.filter((b): b is string => typeof b === "string" && b.trim().length > 0)
                  : [],
                speakerNotes: typeof s.speakerNotes === "string" ? s.speakerNotes.trim() : "",
              })),
            },
          };
        } catch {
          return { valid: false as const, reason: "Malformed JSON." };
        }
      };

      const raw1 = await runGenerate();
      const check1 = validateDeck(raw1);
      if (check1.valid) {
        res.json(check1.deck);
        return;
      }

      const raw2 = await runGenerate(check1.reason);
      const check2 = validateDeck(raw2);
      if (check2.valid) {
        res.json(check2.deck);
        return;
      }

      res.status(422).json({ error: "Gemini could not generate a valid slide deck JSON." });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to generate slides with Gemini.";
      res.status(500).json({ error: message });
    }
  });

  // Live Meeting Mode: SSE Streaming Email Drafting
  app.post("/api/gemini/draft-email-stream", async (req, res) => {
    try {
      const { meetingTitle, summary, items, to, modelName } = req.body as {
        meetingTitle?: string;
        summary?: string;
        items?: Array<{ title: string; ownerName?: string; dueDate?: string; kind?: string }>;
        to?: string;
        modelName?: string;
      };

      const ai = getGeminiClient();
      const model = resolveGeminiModel(modelName);

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      const itemLines = (items || [])
        .map((it, i) => `${i + 1}. [${it.kind || "Action"}] ${it.title} — ${it.ownerName || "Team"} (Due: ${it.dueDate || "TBD"})`)
        .join("\n");

      const stream = await ai.models.generateContentStream({
        model,
        contents: `Write a crisp, warm, ready-to-send client follow-up email body (plain text only, no markdown fences) for "${meetingTitle || "Meeting"}".
Recipient: ${to || "Client Team"}
Meeting Summary: ${summary || ""}
Action Items & Deadlines:
${itemLines}

Include:
- Brief acknowledgement of any complaints/issues raised
- Clear numbered action items with owners & real due dates
- Next check-in confirmation if mentioned
Keep under 160 words.`,
      });

      for await (const chunk of stream) {
        const text = chunk.text || "";
        if (text) {
          res.write(`data: ${JSON.stringify({ text })}\n\n`);
        }
      }
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to stream email draft.";
      if (!res.headersSent) {
        res.status(500).json({ error: message });
      } else {
        res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
        res.end();
      }
    }
  });

  // Server-side Webhook Relay for Slack & n8n/Zapier (avoids browser CORS issues)
  app.post("/api/integrations/webhook", async (req, res) => {
    try {
      const { url, payload } = req.body as { url?: string; payload?: unknown };
      const trimmed = (url || "").trim();
      if (!trimmed) {
        res.status(400).json({ error: "Webhook URL is required." });
        return;
      }

      let parsedUrl: URL;
      try {
        parsedUrl = new URL(trimmed);
      } catch {
        res.status(400).json({ error: "Invalid webhook URL format." });
        return;
      }

      const isAllowedProtocol =
        parsedUrl.protocol === "https:" ||
        (parsedUrl.protocol === "http:" &&
          (parsedUrl.hostname === "localhost" || parsedUrl.hostname === "127.0.0.1"));

      if (!isAllowedProtocol) {
        res.status(400).json({
          error: "Webhook URL must use HTTPS (or http://localhost for local n8n testing).",
        });
        return;
      }

      const upstream = await fetch(parsedUrl.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload ?? {}),
      });

      const responseText = await upstream.text().catch(() => "");
      if (!upstream.ok) {
        res.status(502).json({
          error: `Webhook returned HTTP ${upstream.status}: ${responseText.slice(0, 140) || "Upstream error"}`,
        });
        return;
      }

      res.json({ ok: true, status: upstream.status, responseText: responseText.slice(0, 200) });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to deliver webhook.";
      res.status(500).json({ error: message });
    }
  });

  // Universal Server-Side Custom Connector Executor (n8n-style REST / API / Webhook bridge)
  app.post("/api/integrations/custom-tool", async (req, res) => {
    try {
      const {
        endpointUrl,
        method,
        authHeaderName,
        authHeaderValue,
        extraHeadersJson,
        payloadTemplate,
        args,
        meetingContext,
      } = req.body as {
        endpointUrl?: string;
        method?: string;
        authHeaderName?: string;
        authHeaderValue?: string;
        extraHeadersJson?: string;
        payloadTemplate?: string;
        args?: Record<string, unknown>;
        meetingContext?: Record<string, unknown>;
      };

      const trimmedUrl = (endpointUrl || "").trim();
      if (!trimmedUrl) {
        res.status(400).json({ error: "Custom connector Endpoint URL is required." });
        return;
      }

      let parsedUrl: URL;
      try {
        parsedUrl = new URL(trimmedUrl);
      } catch {
        res.status(400).json({ error: "Invalid Endpoint URL format." });
        return;
      }

      const isAllowedProtocol =
        parsedUrl.protocol === "https:" ||
        (parsedUrl.protocol === "http:" &&
          (parsedUrl.hostname === "localhost" || parsedUrl.hostname === "127.0.0.1"));

      if (!isAllowedProtocol) {
        res.status(400).json({
          error: "Endpoint URL must use HTTPS (or http://localhost for local testing).",
        });
        return;
      }

      const httpMethod =
        method === "GET" || method === "PUT" || method === "PATCH" ? method : "POST";

      const headers: Record<string, string> = {};
      if (httpMethod !== "GET") {
        headers["Content-Type"] = "application/json";
      }

      if (extraHeadersJson && extraHeadersJson.trim()) {
        try {
          const parsedExtra = JSON.parse(extraHeadersJson) as Record<string, unknown>;
          if (parsedExtra && typeof parsedExtra === "object") {
            for (const [k, v] of Object.entries(parsedExtra)) {
              if (k.trim() && v !== undefined && v !== null) {
                headers[k.trim()] = String(v);
              }
            }
          }
        } catch {
          res.status(400).json({ error: "Extra headers JSON is malformed." });
          return;
        }
      }

      if (authHeaderName?.trim() && authHeaderValue?.trim()) {
        headers[authHeaderName.trim()] = authHeaderValue.trim();
      }

      const templateVars: Record<string, unknown> = {
        ...(meetingContext || {}),
        ...(args || {}),
      };

      let bodyString: string | undefined;
      if (httpMethod !== "GET") {
        if (payloadTemplate && payloadTemplate.trim()) {
          bodyString = payloadTemplate.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
            const val = templateVars[key];
            if (val === undefined || val === null) return "";
            if (typeof val === "string") {
              // Strip enclosing quotes from JSON.stringify so template quotes stay valid
              return JSON.stringify(val).slice(1, -1);
            }
            return String(val);
          });
        } else {
          bodyString = JSON.stringify({
            ...(meetingContext || {}),
            args: args || {},
            ...(args || {}),
          });
        }
      }

      const upstream = await fetch(parsedUrl.toString(), {
        method: httpMethod,
        headers,
        ...(bodyString !== undefined ? { body: bodyString } : {}),
      });

      const responseText = await upstream.text().catch(() => "");
      if (!upstream.ok) {
        res.status(502).json({
          error: `Connector returned HTTP ${upstream.status}: ${
            responseText.slice(0, 180) || "Upstream error"
          }`,
        });
        return;
      }

      res.json({
        ok: true,
        status: upstream.status,
        responsePreview: responseText.slice(0, 300) || `HTTP ${upstream.status} OK`,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to execute custom connector.";
      res.status(500).json({ error: message });
    }
  });

  if (!isProduction) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, "dist");
    app.use(express.static(distPath));
    app.get("/{*splat}", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`MeetMind server listening on http://localhost:${PORT}`);
  });
}

startServer();
