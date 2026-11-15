import { AlertCircle, Check, Quote, Sparkles } from "lucide-react";
import { useState } from "react";
import type {
  ExtractedItem,
  ExtractedKind,
  Person,
  ResolutionStatus,
} from "../types/meetmind";

interface ExtractedPanelProps {
  items: ExtractedItem[];
  people: Person[];
  consentAccepted: boolean;
  isExtracting: boolean;
  extractError: string | null;
  onJumpToQuote: (segmentId: string, quote: string) => void;
  onResolveAmbiguity: (itemId: string, personId: string) => void;
  onDismissAmbiguity: (itemId: string) => void;
  onAnalyzeWithGemini: () => void;
}

const KIND_FILTERS: Array<"All" | ExtractedKind> = [
  "All",
  "Complaint",
  "Decision",
  "Commit",
  "Action",
];

function getKindColor(kind: ExtractedKind): string {
  switch (kind) {
    case "Complaint":
      return "text-rose-300";
    case "Decision":
      return "text-sky-300";
    case "Commit":
      return "text-emerald-300";
    case "Action":
      return "text-[#c4b5fd]";
  }
}

function getStatusBadge(status: ResolutionStatus): { text: string; colorClass: string } {
  switch (status) {
    case "ambiguous":
      return { text: "ambiguous", colorClass: "text-amber-300" };
    case "unowned":
      return { text: "unowned", colorClass: "text-rose-300" };
    case "low_confidence":
      return { text: "low confidence", colorClass: "text-amber-300" };
    case "confirmed":
      return { text: "confirmed", colorClass: "text-emerald-300" };
  }
}

function formatConfidencePct(value: number): number {
  return Math.round(value <= 1 ? value * 100 : value);
}

export function ExtractedPanel({
  items,
  people,
  consentAccepted,
  isExtracting,
  extractError,
  onJumpToQuote,
  onResolveAmbiguity,
  onDismissAmbiguity,
  onAnalyzeWithGemini,
}: ExtractedPanelProps) {
  const [activeFilter, setActiveFilter] = useState<"All" | ExtractedKind>("All");

  const pendingConfirmation = items.filter(
    (item) => item.needsConfirmation && !item.resolved
  );
  const confirmedItems = items.filter(
    (item) => !item.needsConfirmation || item.resolved
  );

  const filteredItems =
    activeFilter === "All"
      ? confirmedItems
      : confirmedItems.filter((item) => item.kind === activeFilter);

  const countFor = (filter: "All" | ExtractedKind) => {
    if (filter === "All") return confirmedItems.length;
    return confirmedItems.filter((item) => item.kind === filter).length;
  };

  return (
    <aside className="flex flex-col gap-4">
      {/* Main Extracted Panel */}
      <div className="rounded-xl border border-white/[0.08] bg-[#111118]/90">
        <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-3.5">
          <div>
            <h2 className="font-serif text-lg italic text-zinc-100">Extracted</h2>
          </div>
          <button
            type="button"
            onClick={onAnalyzeWithGemini}
            disabled={isExtracting || !consentAccepted}
            title={
              !consentAccepted
                ? "Confirm the consent checkbox before analyzing"
                : "Run Gemini structured extraction"
            }
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#a78bfa]/35 bg-[#a78bfa]/15 px-3 py-1.5 font-mono text-[11px] font-medium text-[#e9d5ff] whitespace-nowrap shrink-0 transition-colors hover:bg-[#a78bfa] hover:text-[#0b0b10] disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a78bfa]"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {isExtracting ? "Analyzing..." : "Analyze"}
          </button>
        </div>

        {extractError && (
          <div className="border-b border-rose-500/20 bg-rose-500/10 px-4 py-2.5 text-xs text-rose-200">
            {extractError}
          </div>
        )}

        {/* Filter Chips */}
        <div className="flex flex-wrap gap-1.5 border-b border-white/[0.07] px-4 py-3">
          {KIND_FILTERS.map((kind) => {
            const active = activeFilter === kind;
            return (
              <button
                key={kind}
                type="button"
                onClick={() => setActiveFilter(kind)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a78bfa] ${
                  active
                    ? "bg-[#a78bfa] text-[#0b0b10]"
                    : "border border-white/[0.08] bg-white/[0.03] text-zinc-300 hover:bg-white/[0.07] hover:text-white"
                }`}
              >
                <span>{kind}</span>
                <span
                  className={`font-mono text-[10px] tabular-nums ${
                    active ? "text-[#0b0b10]/80" : "text-zinc-500"
                  }`}
                >
                  {countFor(kind)}
                </span>
              </button>
            );
          })}
        </div>

        {/* Extracted List */}
        <div className="divide-y divide-white/[0.06]">
          {filteredItems.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-zinc-500">
              No confirmed {activeFilter === "All" ? "items" : activeFilter.toLowerCase() + "s"} in
              this filter yet.
            </div>
          ) : (
            filteredItems.map((item) => {
              const owner = people.find((p) => p.id === item.ownerId);
              return (
                <div key={item.id} className="px-4 py-3.5 transition-colors hover:bg-white/[0.02]">
                  <div className="flex items-center justify-between gap-2 font-mono text-[11px]">
                    <span className={`font-medium ${getKindColor(item.kind)}`}>{item.kind}</span>
                    <span className="text-zinc-400 tabular-nums">
                      {formatConfidencePct(item.confidence)}% conf
                    </span>
                  </div>

                  <p className="mt-1.5 text-[13px] font-medium leading-snug text-zinc-100">
                    {item.title}
                  </p>

                  <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-400">
                    <div className="flex items-center gap-2 font-mono text-[11px]">
                      <span className="text-zinc-200">{owner ? owner.name : "Unowned"}</span>
                      <span aria-hidden="true">·</span>
                      <span className="tabular-nums">{item.dueDate}</span>
                    </div>

                    <button
                      type="button"
                      onClick={() => onJumpToQuote(item.segmentId, item.quote)}
                      className="inline-flex items-center gap-1 rounded font-mono text-[11px] text-[#a78bfa] underline-offset-4 hover:text-[#c4b5fd] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a78bfa]"
                    >
                      <Quote className="h-3 w-3" />
                      quote
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Needs Your Confirmation Tray */}
      <div className="rounded-xl border border-amber-400/25 bg-[#13121a]">
        <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-amber-300" />
            <h3 className="font-serif text-base italic text-zinc-100">
              Needs your confirmation
            </h3>
          </div>
          <span className="font-mono text-xs text-amber-300 tabular-nums">
            {pendingConfirmation.length} pending
          </span>
        </div>

        {pendingConfirmation.length === 0 ? (
          <div className="flex items-center gap-2 px-4 py-5 text-xs text-zinc-400">
            <Check className="h-4 w-4 text-emerald-400" />
            <span>All owners, dates, and low-confidence items are confirmed.</span>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.06]">
            {pendingConfirmation.map((item) => {
              const candidatePeople =
                item.ownerCandidates && item.ownerCandidates.length > 0
                  ? people.filter((p) => item.ownerCandidates?.includes(p.id))
                  : people;
              const statusMeta = getStatusBadge(item.resolutionStatus);

              return (
                <div key={item.id} className="px-4 py-3.5">
                  <div className="flex items-center justify-between gap-2 font-mono text-[11px]">
                    <div className="flex items-center gap-2">
                      <span className={getKindColor(item.kind)}>{item.kind}</span>
                      <span aria-hidden="true" className="text-zinc-600">
                        ·
                      </span>
                      <span className={statusMeta.colorClass}>{statusMeta.text}</span>
                    </div>
                    <span className="text-amber-300 tabular-nums">
                      {formatConfidencePct(item.confidence)}% conf
                    </span>
                  </div>

                  <p className="mt-1 text-[13px] font-medium text-zinc-100">{item.title}</p>

                  {item.ambiguityReason && (
                    <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                      {item.ambiguityReason}
                    </p>
                  )}

                  <div className="mt-2 flex items-center justify-between font-mono text-[11px] text-zinc-500">
                    <span className="tabular-nums">Due {item.dueDate}</span>
                    <button
                      type="button"
                      onClick={() => onJumpToQuote(item.segmentId, item.quote)}
                      className="inline-flex items-center gap-1 text-[#a78bfa] hover:text-[#c4b5fd] hover:underline"
                    >
                      <Quote className="h-3 w-3" />
                      quote
                    </button>
                  </div>

                  {/* One-tap resolution chips */}
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {candidatePeople.map((person) => (
                      <button
                        key={person.id}
                        type="button"
                        onClick={() => onResolveAmbiguity(item.id, person.id)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[#a78bfa]/35 bg-[#a78bfa]/10 px-2.5 py-1.5 text-xs font-medium text-[#e9d5ff] whitespace-nowrap shrink-0 transition-colors hover:bg-[#a78bfa] hover:text-[#0b0b10] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a78bfa]"
                      >
                        <span>{person.name}</span>
                        <span className="font-mono text-[10px] opacity-75">{person.role}</span>
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => onDismissAmbiguity(item.id)}
                      className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-1.5 text-xs text-zinc-400 whitespace-nowrap shrink-0 transition-colors hover:bg-white/[0.08] hover:text-zinc-200"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}
