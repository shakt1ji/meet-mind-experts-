import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI, Type } from "@google/genai";

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
