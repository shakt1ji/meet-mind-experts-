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
  visibleExtractCount?: number | null;
  showConfirmationTray?: boolean;
  searchQuery?: string;
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
      return "text-[#5eead4]";
    default:
      return "text-slate-300";
  }
}

function getStatusBadge(
  status?: ResolutionStatus | null,
  ownerId?: string | null
): { text: string; colorClass: string } {
  switch (status) {
    case "ambiguous":
      return { text: "ambiguous", colorClass: "text-amber-300" };
    case "unowned":
      return { text: "unowned", colorClass: "text-rose-300" };
    case "low_confidence":
      return { text: "low confidence", colorClass: "text-amber-300" };
    case "confirmed":
      return { text: "confirmed", colorClass: "text-emerald-300" };
    default:
      return ownerId === null
        ? { text: "unowned", colorClass: "text-rose-300" }
        : { text: "needs check", colorClass: "text-amber-300" };
  }
}

function formatConfidencePct(value: number): number {
  const safe = typeof value === "number" && !Number.isNaN(value) ? value : 0.7;
  return Math.round(safe <= 1 ? safe * 100 : safe);
}

function getPriorityBadgeClass(priority?: "High" | "Medium" | "Low"): string {
  switch (priority) {
    case "High":
      return "border-rose-400/35 bg-rose-500/12 text-rose-200";
    case "Low":
      return "border-white/[0.12] bg-white/[0.04] text-slate-300";
    default:
      return "border-amber-300/30 bg-amber-400/10 text-amber-200";
  }
}

export function ExtractedPanel({
  items,
  people,
  consentAccepted,
  isExtracting,
  extractError,
  visibleExtractCount = null,
  showConfirmationTray = true,
  searchQuery = "",
  onJumpToQuote,
  onResolveAmbiguity,
  onDismissAmbiguity,
  onAnalyzeWithGemini,
}: ExtractedPanelProps) {
  const [activeFilter, setActiveFilter] = useState<"All" | ExtractedKind>("All");
  const trimmedQuery = searchQuery.trim().toLowerCase();

  const matchesSearch = (item: ExtractedItem) => {
    if (!trimmedQuery) return true;
    const ownerName = people.find((p) => p.id === item.ownerId)?.name || "";
    return (
      item.title.toLowerCase().includes(trimmedQuery) ||
      item.quote.toLowerCase().includes(trimmedQuery) ||
      ownerName.toLowerCase().includes(trimmedQuery)
    );
  };

  const pendingConfirmation = showConfirmationTray
    ? items.filter((item) => item.needsConfirmation && !item.resolved && matchesSearch(item))
    : [];
  const allConfirmedItems = items.filter(
    (item) => (!item.needsConfirmation || item.resolved) && matchesSearch(item)
  );

  const visibleConfirmedItems =
    visibleExtractCount !== null && visibleExtractCount !== undefined
      ? allConfirmedItems.slice(0, visibleExtractCount)
      : allConfirmedItems;

  const filteredItems =
    activeFilter === "All"
      ? visibleConfirmedItems
      : visibleConfirmedItems.filter((item) => item.kind === activeFilter);

  const countFor = (filter: "All" | ExtractedKind) => {
    if (filter === "All") return visibleConfirmedItems.length;
    return visibleConfirmedItems.filter((item) => item.kind === filter).length;
  };

  const groupedSections: Array<{
    key: string;
    label: string;
    accentClass: string;
    rows: ExtractedItem[];
  }> = [
    {
      key: "Complaint",
      label: "Complaints",
      accentClass: "text-rose-300",
      rows: visibleConfirmedItems.filter(
        (i) => i.liveCategory === "Complaint" || i.kind === "Complaint"
      ),
    },
    {
      key: "Action",
      label: "Actions & Tasks",
      accentClass: "text-[#5eead4]",
      rows: visibleConfirmedItems.filter(
        (i) =>
          i.kind === "Action" &&
          i.liveCategory !== "Deadline" &&
          i.liveCategory !== "Complaint"
      ),
    },
    {
      key: "Decision",
      label: "Decisions",
      accentClass: "text-sky-300",
      rows: visibleConfirmedItems.filter(
        (i) => i.liveCategory === "Decision" || i.kind === "Decision"
      ),
    },
    {
      key: "Commit",
      label: "Commitments",
      accentClass: "text-emerald-300",
      rows: visibleConfirmedItems.filter(
        (i) => i.liveCategory === "Commit" || i.kind === "Commit"
      ),
    },
    {
      key: "Deadline",
      label: "Deadlines",
      accentClass: "text-amber-300",
      rows: visibleConfirmedItems.filter((i) => i.liveCategory === "Deadline"),
    },
  ].filter((g) => g.rows.length > 0);

  const renderExtractedRow = (item: ExtractedItem) => {
    const owner = people.find((p) => p.id === item.ownerId);
    const priority = item.priority || (item.kind === "Complaint" ? "High" : "Medium");
    return (
      <div
        key={item.id}
        className="chip-pop-in px-5 py-3.5 transition-colors hover:bg-white/[0.035]"
      >
        <div className="flex items-center justify-between gap-2 font-mono text-[11px]">
          <div className="flex items-center gap-2">
            <span className={`font-medium ${getKindColor(item.kind)}`}>
              {item.liveCategory || item.kind}
            </span>
            <span
              className={`rounded border px-1.5 py-0.5 text-[10px] ${getPriorityBadgeClass(
                priority
              )}`}
            >
              {priority}
            </span>
          </div>
          <span className="text-slate-400 tabular-nums">
            {formatConfidencePct(item.confidence)}% conf
          </span>
        </div>

        <p className="mt-1.5 text-[13px] font-medium leading-snug text-slate-100">
          {item.title}
        </p>

        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
          <div className="flex items-center gap-2 font-mono text-[11px]">
            <span className="text-slate-200">
              {owner ? owner.name : item.rawOwner || "Unowned"}
            </span>
            <span aria-hidden="true">·</span>
            <span className="text-[#99f6e4] tabular-nums">{item.dueDate}</span>
          </div>

          <button
            type="button"
            onClick={() => onJumpToQuote(item.segmentId, item.quote)}
            className="inline-flex items-center gap-1 rounded font-mono text-[11px] text-[#5eead4] underline-offset-4 hover:text-[#99f6e4] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5eead4]"
          >
            <Quote className="h-3 w-3" />
            quote
          </button>
        </div>
      </div>
    );
  };

  return (
    <aside className="flex flex-col gap-5">
      {/* Main Extracted Panel */}
      <div className="glass-card overflow-hidden rounded-2xl">
        <div className="flex items-center justify-between border-b border-white/[0.09] px-5 py-3.5">
          <div>
            <h2 className="font-serif text-lg italic text-slate-50">
              Extracted (grouped by type)
            </h2>
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
            className="btn-glazed-soft inline-flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 font-mono text-[11px] font-medium whitespace-nowrap shrink-0 transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5eead4]"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {isExtracting ? "Analyzing..." : "Analyze"}
          </button>
        </div>

        {extractError && (
          <div className="border-b border-rose-400/25 bg-rose-500/12 px-5 py-2.5 text-xs text-rose-100">
            {extractError}
          </div>
        )}

        {/* Filter Chips */}
        <div className="flex flex-wrap gap-1.5 border-b border-white/[0.09] px-5 py-3">
          {KIND_FILTERS.map((kind) => {
            const active = activeFilter === kind;
            return (
              <button
                key={kind}
                type="button"
                onClick={() => setActiveFilter(kind)}
                className={`inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5eead4] ${
                  active
                    ? "btn-glazed-primary"
                    : "border border-white/[0.1] bg-white/[0.04] text-slate-300 hover:bg-white/[0.09] hover:text-white"
                }`}
              >
                <span>{kind}</span>
                <span
                  className={`font-mono text-[10px] tabular-nums ${
                    active ? "text-[#052024]/80" : "text-slate-400"
                  }`}
                >
                  {countFor(kind)}
                </span>
              </button>
            );
          })}
        </div>

        {/* Extracted List or Loading Skeletons */}
        <div>
          {isExtracting ? (
            <div className="divide-y divide-white/[0.07]">
              {Array.from({ length: 4 }).map((_, idx) => (
                <div key={idx} className="space-y-2.5 px-5 py-4" aria-hidden="true">
                  <div className="flex items-center justify-between">
                    <div className="skeleton-pulse h-3 w-16 rounded bg-white/[0.1]" />
                    <div className="skeleton-pulse h-3 w-12 rounded bg-white/[0.1]" />
                  </div>
                  <div className="skeleton-pulse h-4 w-5/6 rounded bg-white/[0.11]" />
                  <div className="skeleton-pulse h-3 w-1/2 rounded bg-white/[0.08]" />
                </div>
              ))}
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="px-5 py-9 text-center text-xs text-slate-400">
              {visibleExtractCount === 0
                ? "Listening to transcript before extracting items..."
                : `No confirmed ${
                    activeFilter === "All" ? "items" : activeFilter.toLowerCase() + "s"
                  } in this filter yet.`}
            </div>
          ) : activeFilter === "All" ? (
            <div>
              {groupedSections.map((group) => (
                <div key={group.key} className="border-b border-white/[0.08] last:border-b-0">
                  <div className="flex items-center justify-between bg-white/[0.025] px-5 py-2 font-mono text-[10px]">
                    <span className={`font-semibold uppercase tracking-wider ${group.accentClass}`}>
                      {group.label}
                    </span>
                    <span className="text-slate-400 tabular-nums">{group.rows.length}</span>
                  </div>
                  <div className="divide-y divide-white/[0.07]">
                    {group.rows.map(renderExtractedRow)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="divide-y divide-white/[0.07]">
              {filteredItems.map(renderExtractedRow)}
            </div>
          )}
        </div>
      </div>

      {/* Needs Your Confirmation Tray */}
      <div className="glass-card overflow-hidden rounded-2xl border border-amber-300/25">
        <div className="flex items-center justify-between border-b border-white/[0.09] px-5 py-3.5">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-amber-300" />
            <h3 className="font-serif text-base italic text-slate-50">
              Needs your confirmation
            </h3>
          </div>
          <span className="font-mono text-xs text-amber-300 tabular-nums">
            {pendingConfirmation.length} pending
          </span>
        </div>

        {pendingConfirmation.length === 0 ? (
          <div className="flex items-center gap-2 px-5 py-5 text-xs text-slate-300">
            <Check className="h-4 w-4 text-emerald-400" />
            <span>
              {showConfirmationTray
                ? "All owners, dates, and low-confidence items are confirmed."
                : "Scanning transcript for ambiguous owners..."}
            </span>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.07]">
            {pendingConfirmation.map((item) => {
              const candidatePeople =
                item.ownerCandidates && item.ownerCandidates.length > 0
                  ? people.filter((p) => item.ownerCandidates?.includes(p.id))
                  : people;
              const statusMeta = getStatusBadge(item.resolutionStatus, item.ownerId);

              return (
                <div key={item.id} className="chip-pop-in px-5 py-4">
                  <div className="flex items-center justify-between gap-2 font-mono text-[11px]">
                    <div className="flex items-center gap-2">
                      <span className={getKindColor(item.kind)}>{item.kind}</span>
                      <span aria-hidden="true" className="text-slate-500">
                        ·
                      </span>
                      <span className={statusMeta.colorClass}>{statusMeta.text}</span>
                    </div>
                    <span className="text-amber-300 tabular-nums">
                      {formatConfidencePct(item.confidence)}% conf
                    </span>
                  </div>

                  <p className="mt-1.5 text-[13px] font-medium text-slate-100">{item.title}</p>

                  {item.ambiguityReason && (
                    <p className="mt-1 text-xs leading-relaxed text-slate-300/80">
                      {item.ambiguityReason}
                    </p>
                  )}

                  <div className="mt-2.5 flex items-center justify-between font-mono text-[11px] text-slate-400">
                    <span className="tabular-nums">Due {item.dueDate}</span>
                    <button
                      type="button"
                      onClick={() => onJumpToQuote(item.segmentId, item.quote)}
                      className="inline-flex items-center gap-1 text-[#5eead4] hover:text-[#99f6e4] hover:underline"
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
                        className="btn-glazed-soft inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5eead4]"
                      >
                        <span>{person.name}</span>
                        <span className="font-mono text-[10px] opacity-80">{person.role}</span>
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => onDismissAmbiguity(item.id)}
                      className="rounded-xl border border-white/[0.1] bg-white/[0.04] px-3 py-1.5 text-xs text-slate-300 whitespace-nowrap shrink-0 transition-colors hover:bg-white/[0.09] hover:text-white"
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
