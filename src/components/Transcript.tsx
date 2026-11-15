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
      <mark className="rounded bg-[#a78bfa]/35 px-1 py-0.5 text-[#f5f3ff] ring-1 ring-[#a78bfa]/60 transition-all duration-300">
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

  const activeSegmentId = (() => {
    let activeId = segments[0]?.id;
    for (const seg of segments) {
      if (seg.seconds <= currentSeconds) activeId = seg.id;
      else break;
    }
    return activeId;
  })();

  return (
    <section
      aria-label="Meeting transcript"
      className="rounded-xl border border-white/[0.08] bg-[#111118]/80"
    >
      <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-3.5">
        <div>
          <h2 className="font-serif text-lg italic text-zinc-100">Speaker Transcript</h2>
        </div>
        <div className="font-mono text-xs text-zinc-400 tabular-nums">
          {segments.length} turns · English + Hinglish
        </div>
      </div>

      <div className="divide-y divide-white/[0.06]">
        {segments.map((seg, index) => {
          const speaker = people.find((p) => p.id === seg.speakerId);
          const isHighlighted = highlightedSegmentId === seg.id;
          const isCurrentPlayhead = activeSegmentId === seg.id && currentSeconds > 0;
          const linkedItems = extractedItems.filter((item) => item.segmentId === seg.id);

          return (
            <div
              key={isHighlighted ? `${seg.id}-${highlightNonce}` : seg.id}
              ref={(node) => {
                rowRefs.current[seg.id] = node;
              }}
              onClick={() => onSeekToSegment(seg)}
              className={`group cursor-pointer px-5 py-4 transition-colors duration-150 hover:bg-white/[0.025] ${
                isHighlighted ? "quote-highlight-flash bg-[#a78bfa]/10" : ""
              } ${isCurrentPlayhead && !isHighlighted ? "bg-white/[0.03]" : ""}`}
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
                    className="font-mono text-xs text-zinc-400 tabular-nums transition-colors group-hover:text-[#c4b5fd]"
                  >
                    {seg.timestamp}
                  </button>
                  <span
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md font-mono text-[10px] font-semibold"
                    style={{
                      backgroundColor: `${speaker?.accentHex || "#a78bfa"}1f`,
                      color: speaker?.accentHex || "#c4b5fd",
                    }}
                  >
                    {speaker?.initials || seg.speakerName.slice(0, 2).toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-xs font-medium text-zinc-200">
                      {speaker?.name || seg.speakerName}
                    </div>
                    {speaker?.role && (
                      <div className="truncate font-mono text-[10px] text-zinc-500">
                        {speaker.role}
                      </div>
                    )}
                  </div>
                </div>

                {/* Transcript line */}
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] leading-relaxed text-zinc-200">
                    {isHighlighted
                      ? highlightSubstring(seg.text, highlightedQuote)
                      : seg.text}
                  </p>

                  {linkedItems.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-zinc-400">
                      {linkedItems.map((item) => (
                        <span key={item.id} className="inline-flex items-center gap-1.5">
                          <span className="text-[#c4b5fd]">{item.kind}</span>
                          <span aria-hidden="true">·</span>
                          <span className="truncate max-w-[260px] text-zinc-400">
                            {item.title}
                          </span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="hidden shrink-0 font-mono text-[11px] text-zinc-600 tabular-nums lg:block">
                  #{String(index + 1).padStart(2, "0")}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
