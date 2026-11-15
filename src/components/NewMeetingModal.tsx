import { FileAudio, FileText, ShieldCheck, Sparkles, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Meeting, Person, Segment } from "../types/meetmind";
import { resolveExtractedItems, validateRawExtractionResponse } from "../utils/resolver";

interface NewMeetingModalProps {
  isOpen: boolean;
  initialMode: "paste" | "audio";
  people: Person[];
  consentAccepted: boolean;
  onToggleConsent: (checked: boolean) => void;
  onClose: () => void;
  onCreateMeeting: (meeting: Meeting) => void;
}

const SAMPLE_PASTE = `00:15 Anita: Chalo quick sync start karte hain—Delta client ka webhook fail ho raha hai since morning.
01:10 Raj: Haan maine dekha, retry queue jam hai. I'll patch the webhook handler by Friday.
02:05 Meena: Delta ka Q3 invoice hold pe hai because PO number missing tha—someone should follow up with their procurement team today.
03:18 Anita: Raj, please send Delta the status update today. Let's meet next Thursday at 3 PM.`;

export function parseTranscriptText(raw: string, people: Person[]): Segment[] {
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  return lines.map((line, index) => {
    const match = line.match(/^(\d{1,2}:\d{2})\s+([^:]+):\s*(.+)$/);
    let timestamp = `${String(Math.floor((index * 45) / 60)).padStart(2, "0")}:${String(
      (index * 45) % 60
    ).padStart(2, "0")}`;
    let speakerRaw = "Anita";
    let text = line;

    if (match) {
      timestamp = match[1].padStart(5, "0");
      speakerRaw = match[2].trim();
      text = match[3].trim();
    } else {
      const simpleMatch = line.match(/^([^:]+):\s*(.+)$/);
      if (simpleMatch) {
        speakerRaw = simpleMatch[1].trim();
        text = simpleMatch[2].trim();
      }
    }

    const [mins, secs] = timestamp.split(":").map((n) => Number(n) || 0);
    const matchedPerson =
      people.find((p) => p.name.toLowerCase() === speakerRaw.toLowerCase()) ||
      people.find((p) => p.name.toLowerCase().startsWith(speakerRaw.toLowerCase()));

    return {
      id: `seg_new_${Date.now()}_${index}`,
      timestamp,
      seconds: mins * 60 + secs,
      speakerId: matchedPerson?.id || people[0]?.id || "p_anita",
      speakerName: matchedPerson?.name || speakerRaw,
      text,
    };
  });
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const commaIdx = result.indexOf(",");
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(new Error("Could not read selected audio file."));
    reader.readAsDataURL(file);
  });
}

export function NewMeetingModal({
  isOpen,
  initialMode,
  people,
  consentAccepted,
  onToggleConsent,
  onClose,
  onCreateMeeting,
}: NewMeetingModalProps) {
  const [mode, setMode] = useState<"paste" | "audio">(initialMode);
  const [title, setTitle] = useState("Delta Escalation Sync");
  const [meetingDate, setMeetingDate] = useState("14 Nov 2026");
  const [rawTranscript, setRawTranscript] = useState(SAMPLE_PASTE);
  const [selectedAudioFile, setSelectedAudioFile] = useState<File | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      setMode(initialMode);
      setError(null);
      setStatusMessage(null);
    }
  }, [isOpen, initialMode]);

  if (!isOpen) return null;

  const runExtractionAndCreate = async (transcriptBody: string) => {
    const segments = parseTranscriptText(transcriptBody, people);
    if (segments.length === 0) {
      throw new Error("Please enter at least one transcript line.");
    }

    const meetingId = `mtg_${Date.now()}`;
    const lastSec = segments[segments.length - 1]?.seconds || 240;
    const durationMins = Math.max(2, Math.ceil((lastSec + 30) / 60));

    setStatusMessage("Extracting structured items with Gemini...");

    const response = await fetch("/api/gemini/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: title.trim(),
        segments,
        roster: people,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Gemini extraction failed.");
    }

    const validation = validateRawExtractionResponse(data);
    if (!validation.valid) {
      throw new Error(validation.error || "Gemini returned invalid JSON output.");
    }

    const resolvedItems = resolveExtractedItems(
      validation.items,
      segments,
      people,
      meetingDate.trim() || "14 Nov 2026",
      meetingId
    );

    const speakerIds = Array.from(new Set(segments.map((s) => s.speakerId)));

    onCreateMeeting({
      id: meetingId,
      title: title.trim(),
      date: meetingDate.trim() || "14 Nov 2026",
      duration: `${durationMins} min`,
      durationSeconds: durationMins * 60,
      speakerIds,
      segments,
      extractedItems: resolvedItems,
      summary:
        validation.summary ||
        "Analyzed English and Hinglish transcript via Gemini 4 Hydrogen.",
    });
    setSelectedAudioFile(null);
    setStatusMessage(null);
    onClose();
  };

  const handleAnalyzeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!consentAccepted) {
      setError('Please check "Audio is processed once and not stored." before analyzing.');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setStatusMessage(null);

    try {
      let transcriptToAnalyze = rawTranscript;

      if (mode === "audio") {
        if (!selectedAudioFile) {
          throw new Error("Choose an audio file first or switch to Paste your own transcript.");
        }

        setStatusMessage("Transcribing audio once in memory with Gemini...");
        const base64 = await fileToBase64(selectedAudioFile);
        const mimeType = selectedAudioFile.type || "audio/mp3";

        const transcribeRes = await fetch("/api/gemini/transcribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            audioBase64: base64,
            mimeType,
            roster: people,
          }),
        });

        const transcribeData = await transcribeRes.json();
        if (!transcribeRes.ok || !transcribeData.transcript) {
          setMode("paste");
          throw new Error(
            transcribeData.error ||
              "Audio transcription unavailable — switched to paste fallback so you can paste your transcript."
          );
        }

        transcriptToAnalyze = transcribeData.transcript;
        setRawTranscript(transcriptToAnalyze);
      }

      await runExtractionAndCreate(transcriptToAnalyze);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not complete Gemini analysis."
      );
      setStatusMessage(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-meeting-title"
    >
      <div className="w-full max-w-2xl rounded-xl border border-white/[0.12] bg-[#111118] shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/[0.08] px-5 py-4">
          <div>
            <h2 id="new-meeting-title" className="font-serif text-xl italic text-zinc-100">
              Analyze Meeting Input
            </h2>
            <p className="mt-0.5 text-xs text-zinc-400">
              Paste a bilingual transcript or upload meeting audio for single-pass transcription & extraction.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleAnalyzeSubmit} className="space-y-4 p-5">
          {/* Mode Switcher */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setMode("paste");
                setError(null);
              }}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                mode === "paste"
                  ? "bg-[#a78bfa] text-[#0b0b10]"
                  : "border border-white/[0.08] bg-white/[0.03] text-zinc-300 hover:bg-white/[0.07]"
              }`}
            >
              <FileText className="h-3.5 w-3.5" />
              Paste your own transcript
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("audio");
                setError(null);
              }}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                mode === "audio"
                  ? "bg-[#a78bfa] text-[#0b0b10]"
                  : "border border-white/[0.08] bg-white/[0.03] text-zinc-300 hover:bg-white/[0.07]"
              }`}
            >
              <FileAudio className="h-3.5 w-3.5" />
              Upload audio
            </button>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <label
                htmlFor="meeting-title-input"
                className="block font-mono text-[11px] text-zinc-400"
              >
                Meeting Title
              </label>
              <input
                id="meeting-title-input"
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-white/[0.1] bg-[#0b0b10] px-3 py-2 text-sm text-zinc-100 focus:border-[#a78bfa] focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="meeting-date-input"
                className="block font-mono text-[11px] text-zinc-400"
              >
                Meeting Date
              </label>
              <input
                id="meeting-date-input"
                type="text"
                required
                value={meetingDate}
                onChange={(e) => setMeetingDate(e.target.value)}
                placeholder="14 Nov 2026"
                className="mt-1.5 w-full rounded-lg border border-white/[0.1] bg-[#0b0b10] px-3 py-2 font-mono text-xs text-zinc-100 focus:border-[#a78bfa] focus:outline-none"
              />
            </div>
          </div>

          {mode === "paste" ? (
            <div>
              <label
                htmlFor="transcript-textarea"
                className="block font-mono text-[11px] text-zinc-400"
              >
                Transcript Lines (MM:SS Speaker: line)
              </label>
              <textarea
                id="transcript-textarea"
                rows={7}
                required
                value={rawTranscript}
                onChange={(e) => setRawTranscript(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-white/[0.1] bg-[#0b0b10] p-3 font-mono text-xs leading-relaxed text-zinc-200 focus:border-[#a78bfa] focus:outline-none"
              />
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-white/[0.18] bg-[#0b0b10]/80 p-6 text-center">
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*,.mp3,.wav,.webm,.m4a,.ogg"
                onChange={(e) => {
                  const file = e.target.files?.[0] || null;
                  setSelectedAudioFile(file);
                  setError(null);
                }}
                className="hidden"
              />
              <Upload className="mx-auto h-6 w-6 text-[#a78bfa]" />
              <div className="mt-2.5 text-sm font-medium text-zinc-200">
                {selectedAudioFile
                  ? selectedAudioFile.name
                  : "Select an audio recording (.mp3, .wav, .webm, .m4a)"}
              </div>
              <p className="mt-1 text-xs text-zinc-500">
                {selectedAudioFile
                  ? `${(selectedAudioFile.size / (1024 * 1024)).toFixed(2)} MB · Ready for single-pass Gemini transcription`
                  : "Multimodal Gemini transcription extracts English & Hinglish speaker turns."}
              </p>
              <div className="mt-4 flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-lg border border-[#a78bfa]/40 bg-[#a78bfa]/15 px-3.5 py-1.5 text-xs font-medium text-[#e9d5ff] hover:bg-[#a78bfa]/25"
                >
                  {selectedAudioFile ? "Choose different file" : "Browse audio file"}
                </button>
                <button
                  type="button"
                  onClick={() => setMode("paste")}
                  className="text-xs text-zinc-400 underline underline-offset-4 hover:text-zinc-200"
                >
                  Use paste fallback
                </button>
              </div>
            </div>
          )}

          {/* Consent Banner */}
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-white/[0.1] bg-[#0b0b10] px-3.5 py-3 text-xs text-zinc-300">
            <input
              type="checkbox"
              checked={consentAccepted}
              onChange={(e) => onToggleConsent(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-white/20 bg-[#111118] accent-[#a78bfa]"
            />
            <span className="flex flex-1 items-center gap-2">
              <ShieldCheck className="h-4 w-4 shrink-0 text-[#a78bfa]" />
              <span>
                Audio is processed once and not stored.{" "}
                <span className="text-zinc-500">(Required before analyzing)</span>
              </span>
            </span>
          </label>

          {statusMessage && (
            <div className="rounded-lg border border-[#a78bfa]/30 bg-[#a78bfa]/10 px-3 py-2 font-mono text-xs text-[#e9d5ff]">
              {statusMessage}
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 border-t border-white/[0.08] pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-white/[0.1] px-4 py-2 text-xs font-medium text-zinc-300 hover:bg-white/[0.05]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !consentAccepted}
              className="inline-flex items-center gap-2 rounded-lg bg-[#a78bfa] px-4 py-2 text-xs font-semibold text-[#0b0b10] transition-colors hover:bg-[#c4b5fd] disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {isSubmitting ? "Analyzing..." : "Analyze"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
