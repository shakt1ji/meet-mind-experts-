import { Check, Loader2, Mic, ShieldCheck, Square, X, AlertCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatMmSs } from "../utils/liveProcessor";

export type OrbState =
  | "idle"
  | "recording"
  | "stopping"
  | "analyzing"
  | "done"
  | "error";

interface OrbPos {
  x: number;
  y: number;
}

const ORB_POS_KEY = "meetmind_orb_pos_v1";
const ORB_CONSENT_KEY = "meetmind_orb_consent_v1";
const ORB_SIZE = 64;
const EDGE_MARGIN = 18;

interface RecorderOrbProps {
  orbState: OrbState;
  elapsedSec: number;
  waveLevels: number[];
  errorText: string | null;
  consentAccepted: boolean;
  onConfirmConsent: (remember: boolean) => void;
  onStartRecording: () => Promise<void>;
  onStopRecording: () => void;
}

function getDefaultPos(): OrbPos {
  if (typeof window === "undefined") return { x: 24, y: 520 };
  return {
    x: Math.max(EDGE_MARGIN, window.innerWidth - ORB_SIZE - EDGE_MARGIN),
    y: Math.max(EDGE_MARGIN, window.innerHeight - ORB_SIZE - 88),
  };
}

function clampAndLoadPos(): OrbPos {
  const def = getDefaultPos();
  if (typeof window === "undefined") return def;
  try {
    const raw = window.localStorage.getItem(ORB_POS_KEY);
    if (!raw) return def;
    const parsed = JSON.parse(raw) as Partial<OrbPos>;
    if (typeof parsed.x !== "number" || typeof parsed.y !== "number") return def;
    const maxX = Math.max(EDGE_MARGIN, window.innerWidth - ORB_SIZE - EDGE_MARGIN);
    const maxY = Math.max(EDGE_MARGIN, window.innerHeight - ORB_SIZE - EDGE_MARGIN);
    return {
      x: Math.min(maxX, Math.max(EDGE_MARGIN, parsed.x)),
      y: Math.min(maxY, Math.max(EDGE_MARGIN, parsed.y)),
    };
  } catch {
    return def;
  }
}

export function loadRememberedOrbConsent(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(ORB_CONSENT_KEY) === "true";
}

export function saveRememberedOrbConsent(remember: boolean): void {
  if (typeof window === "undefined") return;
  if (remember) {
    window.localStorage.setItem(ORB_CONSENT_KEY, "true");
  } else {
    window.localStorage.removeItem(ORB_CONSENT_KEY);
  }
}

export function RecorderOrb({
  orbState,
  elapsedSec,
  waveLevels,
  errorText,
  consentAccepted,
  onConfirmConsent,
  onStartRecording,
  onStopRecording,
}: RecorderOrbProps) {
  const [pos, setPos] = useState<OrbPos>(() => clampAndLoadPos());
  const [isDragging, setIsDragging] = useState(false);
  const [showConsentPopover, setShowConsentPopover] = useState(false);
  const [rememberChoice, setRememberChoice] = useState(true);

  const dragRef = useRef<{
    active: boolean;
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    movedDist: number;
  }>({
    active: false,
    pointerId: -1,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
    movedDist: 0,
  });

  useEffect(() => {
    const onResize = () => {
      setPos((prev) => {
        const maxX = Math.max(EDGE_MARGIN, window.innerWidth - ORB_SIZE - EDGE_MARGIN);
        const maxY = Math.max(EDGE_MARGIN, window.innerHeight - ORB_SIZE - EDGE_MARGIN);
        const isRightSide = prev.x > window.innerWidth / 2 - ORB_SIZE / 2;
        return {
          x: isRightSide ? maxX : EDGE_MARGIN,
          y: Math.min(maxY, Math.max(EDGE_MARGIN, prev.y)),
        };
      });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const handleOrbClick = () => {
    if (orbState === "recording") {
      onStopRecording();
      return;
    }
    if (orbState === "stopping" || orbState === "analyzing") {
      return;
    }
    if (!consentAccepted && !loadRememberedOrbConsent()) {
      setShowConsentPopover(true);
      return;
    }
    void onStartRecording();
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      active: true,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originX: pos.x,
      originY: pos.y,
      movedDist: 0,
    };
    setIsDragging(false);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current;
    if (!d.active || d.pointerId !== e.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    const dist = Math.hypot(dx, dy);
    d.movedDist = Math.max(d.movedDist, dist);

    if (dist >= 5) {
      setIsDragging(true);
      const maxX = Math.max(EDGE_MARGIN, window.innerWidth - ORB_SIZE - EDGE_MARGIN);
      const maxY = Math.max(EDGE_MARGIN, window.innerHeight - ORB_SIZE - EDGE_MARGIN);
      setPos({
        x: Math.min(maxX, Math.max(EDGE_MARGIN, d.originX + dx)),
        y: Math.min(maxY, Math.max(EDGE_MARGIN, d.originY + dy)),
      });
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current;
    if (!d.active || d.pointerId !== e.pointerId) return;
    d.active = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Ignore if already released
    }

    if (d.movedDist < 5) {
      setIsDragging(false);
      handleOrbClick();
      return;
    }

    // Snap to nearest horizontal viewport edge while keeping within vertical bounds
    const maxX = Math.max(EDGE_MARGIN, window.innerWidth - ORB_SIZE - EDGE_MARGIN);
    const maxY = Math.max(EDGE_MARGIN, window.innerHeight - ORB_SIZE - EDGE_MARGIN);
    const centerX = pos.x + ORB_SIZE / 2;
    const snappedX = centerX < window.innerWidth / 2 ? EDGE_MARGIN : maxX;
    const clampedY = Math.min(maxY, Math.max(EDGE_MARGIN, pos.y));
    const snapped = { x: snappedX, y: clampedY };

    setPos(snapped);
    setIsDragging(false);
    try {
      window.localStorage.setItem(ORB_POS_KEY, JSON.stringify(snapped));
    } catch {
      // Ignore storage error
    }
  };

  const isRightHalf =
    typeof window !== "undefined" ? pos.x + ORB_SIZE / 2 > window.innerWidth / 2 : true;

  return (
    <div
      style={{
        left: `${pos.x}px`,
        top: `${pos.y}px`,
      }}
      className={`fixed z-[9999] select-none ${
        isDragging ? "transition-none" : "transition-all duration-200 ease-out"
      }`}
    >
      {/* First-click Consent Popover */}
      {showConsentPopover && (
        <div
          className={`glass-card-elevated absolute bottom-[76px] w-72 rounded-2xl p-4 shadow-2xl ${
            isRightHalf ? "right-0" : "left-0"
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-50">
              <ShieldCheck className="h-4 w-4 shrink-0 text-[#a78bfa]" />
              <span>Recording Consent</span>
            </div>
            <button
              type="button"
              onClick={() => setShowConsentPopover(false)}
              className="text-slate-400 hover:text-white"
              aria-label="Close consent prompt"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-slate-200">
            Audio is processed to extract tasks. Continue?
          </p>
          <label className="mt-2.5 flex cursor-pointer items-center gap-2 text-[11px] text-slate-300">
            <input
              type="checkbox"
              checked={rememberChoice}
              onChange={(e) => setRememberChoice(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-white/25 bg-[#071318] accent-[#a78bfa]"
            />
            <span>Remember my consent</span>
          </label>
          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowConsentPopover(false)}
              className="rounded-xl border border-white/[0.12] px-3 py-1.5 text-xs text-slate-300 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                setShowConsentPopover(false);
                onConfirmConsent(rememberChoice);
                void onStartRecording();
              }}
              className="rounded-xl bg-[#a78bfa] px-3.5 py-1.5 text-xs font-semibold text-[#110c24] shadow-[0_6px_18px_rgba(167,139,250,0.45)] hover:bg-[#c4b5fd]"
            >
              Continue & Record
            </button>
          </div>
        </div>
      )}

      {/* Side Pill: Live Timer + Mini Waveform OR Analyzing Label OR Error Hint */}
      {orbState === "recording" && (
        <div
          className={`glass-card-elevated pointer-events-none absolute top-1/2 flex -translate-y-1/2 items-center gap-2.5 rounded-2xl border border-rose-400/45 bg-[#190d16]/90 px-3.5 py-2 shadow-xl ${
            isRightHalf ? "right-[74px]" : "left-[74px]"
          }`}
        >
          <span className="h-2 w-2 animate-pulse rounded-full bg-rose-500" />
          <span className="font-mono text-xs font-semibold text-rose-100 tabular-nums">
            {formatMmSs(elapsedSec)}
          </span>
          <div className="flex h-5 items-center gap-0.5" aria-hidden="true">
            {waveLevels.slice(0, 12).map((lvl, idx) => (
              <span
                key={idx}
                className="w-1 rounded-full bg-[#a78bfa] transition-all duration-75"
                style={{ height: `${Math.max(4, Math.round(lvl * 20))}px` }}
              />
            ))}
          </div>
        </div>
      )}

      {(orbState === "stopping" || orbState === "analyzing") && (
        <div
          className={`glass-card-elevated pointer-events-none absolute top-1/2 flex -translate-y-1/2 items-center gap-2 rounded-2xl border border-[#a78bfa]/45 bg-[#121024]/90 px-3.5 py-2 shadow-xl ${
            isRightHalf ? "right-[74px]" : "left-[74px]"
          }`}
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin text-[#c4b5fd]" />
          <span className="font-mono text-xs font-medium whitespace-nowrap text-slate-100">
            Analyzing…
          </span>
        </div>
      )}

      {orbState === "error" && errorText && (
        <div
          className={`glass-card-elevated pointer-events-none absolute top-1/2 flex max-w-[230px] -translate-y-1/2 items-center gap-2 rounded-2xl border border-rose-400/50 bg-[#1c0c13]/92 px-3 py-2 text-[11px] text-rose-100 shadow-xl ${
            isRightHalf ? "right-[74px]" : "left-[74px]"
          }`}
        >
          <AlertCircle className="h-3.5 w-3.5 shrink-0 text-rose-300" />
          <span className="truncate">{errorText}</span>
        </div>
      )}

      {/* Red Pulse Rings while Recording */}
      {orbState === "recording" && (
        <>
          <span className="pointer-events-none absolute inset-0 animate-ping rounded-full bg-rose-500/45" />
          <span className="pointer-events-none absolute -inset-1.5 animate-pulse rounded-full border border-rose-400/60" />
        </>
      )}

      {/* Main 64px Circular Glowing Lavender Orb */}
      <button
        type="button"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        title="MeetMind Recorder Orb — Click or press R to record · Drag to move"
        aria-label={
          orbState === "recording"
            ? "Stop recording"
            : orbState === "analyzing"
            ? "Analyzing meeting audio"
            : "Start recording meeting"
        }
        style={{ touchAction: "none" }}
        className={`relative flex h-16 w-16 cursor-grab items-center justify-center rounded-full border text-white active:cursor-grabbing ${
          orbState === "recording"
            ? "border-rose-300/80 bg-gradient-to-br from-rose-500 via-rose-600 to-purple-700 shadow-[0_0_32px_rgba(244,63,94,0.7)]"
            : orbState === "done"
            ? "border-emerald-300/80 bg-gradient-to-br from-emerald-400 via-teal-500 to-emerald-700 shadow-[0_0_28px_rgba(52,211,153,0.65)]"
            : orbState === "error"
            ? "border-rose-300/80 bg-gradient-to-br from-rose-500 to-red-800 shadow-[0_0_28px_rgba(244,63,94,0.65)]"
            : "orb-breathing-glow border-[#ddd6fe]/65 bg-gradient-to-br from-[#c4b5fd] via-[#a78bfa] to-[#6d28d9] shadow-[0_10px_30px_rgba(167,139,250,0.55),inset_0_2px_4px_rgba(255,255,255,0.45)]"
        }`}
      >
        {orbState === "recording" ? (
          <Square className="h-5 w-5 fill-current" />
        ) : orbState === "stopping" || orbState === "analyzing" ? (
          <Loader2 className="h-6 w-6 animate-spin" />
        ) : orbState === "done" ? (
          <Check className="h-7 w-7 stroke-[2.5]" />
        ) : orbState === "error" ? (
          <AlertCircle className="h-6 w-6" />
        ) : (
          <Mic className="h-6 w-6" />
        )}
      </button>
    </div>
  );
}
