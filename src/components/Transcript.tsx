import { useEffect, useRef } from "react";
import type { ExtractedItem, Person, Segment } from "../types/meetmind";

interface TranscriptProps {
  segments: Segment[];
  people: Person[];
  extractedItems: ExtractedItem[];
  currentSeconds: number;
  highlightedSegmentId: string | null;
  highlightedQuote: string | null;
  highlightNonce: number;
  revealedSegmentCount?: number | null;
  activeTypingProgress?: number; // 0..1 for the latest revealed segment
  searchQuery?: string;
  onSeekToSegment: (segment: Segment) => void;
}

function highlightSubstring(text: string, quote: string | null) {
  if (!quote) return text;
  const idx = text.toLowerCase().indexOf(quote.toLowerCase());
  if (idx === -1) return text;
  const before = text.slice(0, idx);
  const match = text.slice(idx, idx + quote.length);
  const after = text.slice(idx + quote.length);
  return (
    <>
      {before}
      <mark className="rounded bg-[#5eead4]/28 px-1 py-0.5 text-[#f0fdfa] ring-1 ring-[#5eead4]/55 transition-all duration-300">
        {match}
      </mark>
      {after}
    </>
  );
}

export function Transcript({
  segments,
  people,
  extractedItems,
  currentSeconds,
  highlightedSegmentId,
  highlightedQuote,
  highlightNonce,
  revealedSegmentCount = null,
  activeTypingProgress = 1,
  searchQuery = "",
  onSeekToSegment,
}: TranscriptProps) {
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    if (!highlightedSegmentId) return;
    const el = rowRefs.current[highlightedSegmentId];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlightedSegmentId, highlightNonce]);

  const baseVisibleSegments =
    revealedSegmentCount !== null && revealedSegmentCount !== undefined
      ? segments.slice(0, revealedSegmentCount)
      : segments;

  const trimmedQuery = searchQuery.trim().toLowerCase();
  const visibleSegments = trimmedQuery
    ? baseVisibleSegments.filter(
        (seg) =>
          seg.text.toLowerCase().includes(trimmedQuery) ||
          seg.speakerName.toLowerCase().includes(trimmedQuery) ||
          seg.timestamp.includes(trimmedQuery)
      )
    : baseVisibleSegments;

  const activeSegmentId = (() => {
    let activeId = visibleSegments[0]?.id;
    for (const seg of visibleSegments) {
      if (seg.seconds <= currentSeconds) activeId = seg.id;
      else break;
    }
    return activeId;
  })();

  return (
    <section
      aria-label="Meeting transcript"
      className="glass-card overflow-hidden rounded-2xl"
    >
      <div className="flex items-center justify-between border-b border-white/[0.09] px-5 py-3.5">
        <div>
          <h2 className="font-serif text-lg italic text-slate-50">Speaker Transcript</h2>
        </div>
        <div className="font-mono text-xs text-slate-300/80 tabular-nums">
          {visibleSegments.length}
          {revealedSegmentCount !== null && revealedSegmentCount < segments.length
            ? ` / ${segments.length}`
            : ""}{" "}
          turns · English + Hinglish
        </div>
      </div>

      {visibleSegments.length === 0 ? (
        <div className="px-5 py-12 text-center text-xs text-slate-400">
          {trimmedQuery
            ? `No transcript lines match "${searchQuery}".`
            : "Transcript lines will appear here as playback begins."}
        </div>
      ) : (
        <div className="divide-y divide-white/[0.07]">
          {visibleSegments.map((seg, index) => {
            const speaker = people.find((p) => p.id === seg.speakerId);
            const isHighlighted = highlightedSegmentId === seg.id;
            const isCurrentPlayhead = activeSegmentId === seg.id && currentSeconds > 0;
            const linkedItems = extractedItems.filter((item) => item.segmentId === seg.id);
            const isStreamingThisLine =
              revealedSegmentCount !== null &&
              index === visibleSegments.length - 1 &&
              activeTypingProgress < 1;

            const displayedText = isStreamingThisLine
              ? seg.text.slice(0, Math.max(8, Math.ceil(seg.text.length * activeTypingProgress)))
              : seg.text;

            return (
              <div
                key={isHighlighted ? `${seg.id}-${highlightNonce}` : seg.id}
                ref={(node) => {
                  rowRefs.current[seg.id] = node;
                }}
                onClick={() => onSeekToSegment(seg)}
                className={`fade-slide-up group cursor-pointer px-5 py-4 transition-colors duration-150 hover:bg-white/[0.04] ${
                  isHighlighted ? "quote-highlight-flash bg-[#5eead4]/10" : ""
                } ${isCurrentPlayhead && !isHighlighted ? "bg-white/[0.05]" : ""}`}
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-4">
                  {/* Speaker lane & timestamp */}
                  <div className="flex w-40 shrink-0 items-center gap-2.5 pt-0.5">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSeekToSegment(seg);
                      }}
                      className="font-mono text-xs text-slate-400 tabular-nums transition-colors group-hover:text-[#5eead4]"
                    >
                      {seg.timestamp}
                    </button>
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/[0.12] font-mono text-[10px] font-semibold shadow-sm"
                      style={{
                        backgroundColor: `${speaker?.accentHex || "#5eead4"}24`,
                        color: speaker?.accentHex || "#5eead4",
                      }}
                    >
                      {speaker?.initials || seg.speakerName.slice(0, 2).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-xs font-medium text-slate-100">
                        {speaker?.name || seg.speakerName}
                      </div>
                      {speaker?.role && (
                        <div className="truncate font-mono text-[10px] text-slate-400">
                          {speaker.role}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Transcript line */}
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] leading-relaxed text-slate-100/95">
                      {isHighlighted
                        ? highlightSubstring(displayedText, highlightedQuote || searchQuery || null)
                        : trimmedQuery
                        ? highlightSubstring(displayedText, trimmedQuery)
                        : displayedText}
                      {isStreamingThisLine && (
                        <span className="ml-1 inline-block h-3.5 w-1.5 align-middle bg-[#5eead4]" />
                      )}
                    </p>

                    {linkedItems.length > 0 && revealedSegmentCount === null && (
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-slate-400">
                        {linkedItems.map((item) => (
                          <span key={item.id} className="inline-flex items-center gap-1.5">
                            <span className="text-[#5eead4]">{item.kind}</span>
                            <span aria-hidden="true">·</span>
                            <span className="max-w-[260px] truncate text-slate-300/80">
                              {item.title}
                            </span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="hidden shrink-0 font-mono text-[11px] text-slate-500 tabular-nums lg:block">
                    #{String(index + 1).padStart(2, "0")}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
