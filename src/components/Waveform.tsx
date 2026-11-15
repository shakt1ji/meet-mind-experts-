import { Pause, Play } from "lucide-react";
import { useEffect, useMemo } from "react";
import type { Person, Segment } from "../types/meetmind";

interface WaveformProps {
  durationSeconds: number;
  currentSeconds: number;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onSeek: (seconds: number) => void;
  segments: Segment[];
  people: Person[];
}

function formatTime(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function Waveform({
  durationSeconds,
  currentSeconds,
  isPlaying,
  onTogglePlay,
  onSeek,
  segments,
  people,
}: WaveformProps) {
  const barCount = 72;

  const bars = useMemo(() => {
    return Array.from({ length: barCount }, (_, i) => {
      const wave =
        Math.sin(i * 0.42) * 0.35 +
        Math.cos(i * 0.19) * 0.28 +
        Math.sin(i * 0.85) * 0.18 +
        0.52;
      return Math.max(0.18, Math.min(0.96, wave));
    });
  }, []);

  useEffect(() => {
    if (!isPlaying) return;
    const timer = window.setInterval(() => {
      onSeek(currentSeconds + 1 >= durationSeconds ? 0 : currentSeconds + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isPlaying, currentSeconds, durationSeconds, onSeek]);

  const progressRatio = durationSeconds > 0 ? currentSeconds / durationSeconds : 0;

  const activeSegment = useMemo(() => {
    let matched = segments[0];
    for (const seg of segments) {
      if (seg.seconds <= currentSeconds) {
        matched = seg;
      } else {
        break;
      }
    }
    return matched;
  }, [segments, currentSeconds]);

  const activePerson = people.find((p) => p.id === activeSegment?.speakerId);

  return (
    <div className="rounded-xl border border-white/[0.08] bg-[#111118]/90 px-4 py-3.5">
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={onTogglePlay}
          aria-label={isPlaying ? "Pause playback" : "Play recording"}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#a78bfa]/35 bg-[#a78bfa]/15 text-[#c4b5fd] transition-colors duration-150 hover:bg-[#a78bfa]/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a78bfa]"
        >
          {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-[1px]" />}
        </button>

        <div className="min-w-0 flex-1">
          <div
            className="flex h-12 items-center gap-[3px]"
            role="slider"
            aria-label="Audio timeline"
            aria-valuemin={0}
            aria-valuemax={durationSeconds}
            aria-valuenow={currentSeconds}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") onSeek(Math.min(durationSeconds, currentSeconds + 15));
              if (e.key === "ArrowLeft") onSeek(Math.max(0, currentSeconds - 15));
            }}
          >
            {bars.map((height, idx) => {
              const barRatio = idx / barCount;
              const isPlayed = barRatio <= progressRatio;
              const animatedScale = isPlaying
                ? 0.78 + 0.35 * Math.abs(Math.sin(currentSeconds * 1.4 + idx * 0.55))
                : 1;
              const finalPct = Math.min(100, Math.round(height * animatedScale * 100));

              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => onSeek(Math.round((idx / barCount) * durationSeconds))}
                  title={`Jump to ${formatTime(Math.round((idx / barCount) * durationSeconds))}`}
                  className="group flex h-full flex-1 items-center justify-center focus-visible:outline-none"
                >
                  <span
                    className={`block w-full rounded-full transition-colors duration-150 ${
                      isPlayed
                        ? "bg-[#a78bfa]"
                        : "bg-white/[0.14] group-hover:bg-white/[0.28]"
                    }`}
                    style={{ height: `${finalPct}%` }}
                  />
                </button>
              );
            })}
          </div>
        </div>

        <div className="hidden shrink-0 text-right sm:block">
          <div className="font-mono text-xs text-zinc-200 tabular-nums">
            {formatTime(currentSeconds)} <span className="text-zinc-500">/ {formatTime(durationSeconds)}</span>
          </div>
          {activeSegment && (
            <div className="mt-0.5 font-mono text-[11px] text-zinc-400">
              Lane: <span className="text-[#c4b5fd]">{activePerson?.name || activeSegment.speakerName}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
