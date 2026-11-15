import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FileText,
  Mail,
  Presentation,
  Sparkles,
} from "lucide-react";
import { useState } from "react";
import type { SlideDeckData } from "../types/meetmind";
import { triggerPptxDownload } from "../utils/pptxGenerator";

interface SlideDeckPreviewProps {
  deck: SlideDeckData;
  googlePresentationUrl?: string;
  pptxFileName?: string;
  isAttachingToGmail?: boolean;
  attachedToGmail?: boolean;
  onAttachPptxToGmail?: () => Promise<void>;
  onCreateGoogleSlides?: () => Promise<void>;
  isCreatingGoogleSlides?: boolean;
}

export function SlideDeckPreview({
  deck,
  googlePresentationUrl,
  pptxFileName,
  isAttachingToGmail = false,
  attachedToGmail = false,
  onAttachPptxToGmail,
  onCreateGoogleSlides,
  isCreatingGoogleSlides = false,
}: SlideDeckPreviewProps) {
  const [activeSlideIdx, setActiveSlideIdx] = useState(0);
  const [isDownloading, setIsDownloading] = useState(false);

  const slides = deck.slides || [];
  const safeIdx = Math.min(activeSlideIdx, Math.max(0, slides.length - 1));
  const current = slides[safeIdx];

  if (!current) return null;

  const handleDownload = async () => {
    setIsDownloading(true);
    try {
      await triggerPptxDownload(deck);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="glass-card-elevated overflow-hidden rounded-2xl">
      {/* Header Toolbar */}
      <div className="flex flex-col justify-between gap-3 border-b border-white/[0.09] px-5 py-4 lg:flex-row lg:items-center">
        <div>
          <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-[#5eead4]">
            <Presentation className="h-3.5 w-3.5" />
            <span>Presentation Created ✓</span>
            <span className="text-slate-500">·</span>
            <span className="text-slate-300 tabular-nums">{slides.length} slides</span>
            {pptxFileName && (
              <>
                <span className="text-slate-500">·</span>
                <span className="text-slate-400">{pptxFileName}</span>
              </>
            )}
          </div>
          <h4 className="mt-1 font-serif text-lg italic text-slate-50">{deck.deckTitle}</h4>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {googlePresentationUrl ? (
            <a
              href={googlePresentationUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-glazed-primary inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold whitespace-nowrap shrink-0"
            >
              Open in Google Slides
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          ) : (
            onCreateGoogleSlides && (
              <button
                type="button"
                onClick={() => void onCreateGoogleSlides()}
                disabled={isCreatingGoogleSlides}
                className="btn-glazed-primary inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold whitespace-nowrap shrink-0 disabled:opacity-50"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {isCreatingGoogleSlides ? "Saving to Slides..." : "Save to Google Slides"}
              </button>
            )
          )}

          <button
            type="button"
            onClick={() => void handleDownload()}
            disabled={isDownloading}
            className="btn-glazed-soft inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-medium whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" />
            {isDownloading ? "Exporting .pptx..." : "Download .pptx"}
          </button>

          <a
            href="https://www.canva.com"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-xl border border-white/[0.14] bg-white/[0.05] px-3.5 py-2 text-xs font-medium text-slate-100 whitespace-nowrap shrink-0 transition-colors hover:bg-white/[0.1]"
          >
            Open in Canva
            <ExternalLink className="h-3 w-3 text-[#5eead4]" />
          </a>

          {onAttachPptxToGmail && (
            <button
              type="button"
              onClick={() => void onAttachPptxToGmail()}
              disabled={isAttachingToGmail}
              className={`inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                attachedToGmail
                  ? "border-emerald-400/45 bg-emerald-400/15 text-emerald-100"
                  : "border-sky-400/40 bg-sky-400/12 text-sky-100 hover:bg-sky-400/20"
              }`}
            >
              <Mail className="h-3.5 w-3.5" />
              {isAttachingToGmail
                ? "Attaching..."
                : attachedToGmail
                ? "Attached .pptx to Gmail Draft ✓"
                : "Attach .pptx to Gmail draft"}
            </button>
          )}
        </div>
      </div>

      {/* Canva Upload Hint */}
      <div className="flex items-center justify-between border-b border-white/[0.07] bg-white/[0.025] px-5 py-2 font-mono text-[11px] text-slate-300">
        <span>Tip: Download the .pptx and upload it into Canva to edit any slide layout or brand kit.</span>
        <span className="tabular-nums text-[#5eead4]">
          Slide {safeIdx + 1} of {slides.length}
        </span>
      </div>

      {/* Active Slide Stage */}
      <div className="p-5">
        <div className="relative overflow-hidden rounded-2xl border border-white/[0.14] bg-gradient-to-br from-[#0a1d24] via-[#07141a] to-[#050d12] p-6 shadow-2xl">
          {/* Top teal accent rule */}
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#5eead4] via-[#2dd4bf] to-sky-400" />

          <div className="flex items-center justify-between gap-2 font-mono text-[10px] text-[#5eead4]">
            <span>
              SLIDE {safeIdx + 1} / {slides.length} · {current.layout.toUpperCase()}
            </span>
            <span>MeetMind Deck</span>
          </div>

          <h5 className="mt-4 font-serif text-2xl italic tracking-tight text-slate-50 sm:text-3xl">
            {current.title}
          </h5>

          {current.subtitle && (
            <p className="mt-1.5 text-sm text-[#99f6e4]/90">{current.subtitle}</p>
          )}

          <div className="mt-5 rounded-xl border border-white/[0.09] bg-white/[0.03] p-4 sm:p-5">
            <ul className="space-y-2.5 text-sm text-slate-100">
              {current.bullets.map((bullet, bIdx) => (
                <li key={bIdx} className="flex items-start gap-2.5 leading-relaxed">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#5eead4]" />
                  <span>{bullet}</span>
                </li>
              ))}
            </ul>
          </div>

          {current.speakerNotes && (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-white/[0.07] bg-[#040c10]/70 px-3.5 py-2.5 text-xs text-slate-300/85">
              <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
              <div>
                <span className="font-mono text-[10px] text-slate-400">Speaker notes: </span>
                <span>{current.speakerNotes}</span>
              </div>
            </div>
          )}
        </div>

        {/* Carousel Navigation */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setActiveSlideIdx((i) => Math.max(0, i - 1))}
            disabled={safeIdx === 0}
            className="inline-flex items-center gap-1 rounded-xl border border-white/[0.12] bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-white/[0.1] disabled:opacity-40"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Previous
          </button>

          <div className="flex flex-wrap items-center justify-center gap-1.5">
            {slides.map((s, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => setActiveSlideIdx(idx)}
                title={s.title}
                className={`h-7 min-w-[28px] rounded-lg px-2 font-mono text-[11px] tabular-nums transition-all ${
                  idx === safeIdx
                    ? "btn-glazed-primary font-semibold"
                    : "border border-white/[0.1] bg-white/[0.04] text-slate-300 hover:bg-white/[0.1]"
                }`}
              >
                {idx + 1}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setActiveSlideIdx((i) => Math.min(slides.length - 1, i + 1))}
            disabled={safeIdx >= slides.length - 1}
            className="inline-flex items-center gap-1 rounded-xl border border-white/[0.12] bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-white/[0.1] disabled:opacity-40"
          >
            Next
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
