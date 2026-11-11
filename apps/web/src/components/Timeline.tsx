import { type KeyboardEvent, type PointerEvent, type RefObject, useEffect, useRef, useState } from "react";

import { cn, formatSeconds } from "@/lib/utils";

/** The current time, duration and playing state of a video, updated every frame while it plays. */
export function useVideoTime(ref: RefObject<HTMLVideoElement | null>) {
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    let frame = 0;
    const tick = () => {
      setTime(v.currentTime);
      if (!v.paused) frame = requestAnimationFrame(tick);
    };
    const onPlay = () => {
      setPlaying(true);
      frame = requestAnimationFrame(tick);
    };
    const onPause = () => {
      setPlaying(false);
      cancelAnimationFrame(frame);
      setTime(v.currentTime);
    };
    const onMeta = () => setDuration(Number.isFinite(v.duration) ? v.duration : 0);
    const onSeeked = () => setTime(v.currentTime);
    onMeta();
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("loadedmetadata", onMeta);
    v.addEventListener("durationchange", onMeta);
    v.addEventListener("seeked", onSeeked);
    v.addEventListener("timeupdate", onSeeked);
    return () => {
      cancelAnimationFrame(frame);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("loadedmetadata", onMeta);
      v.removeEventListener("durationchange", onMeta);
      v.removeEventListener("seeked", onSeeked);
      v.removeEventListener("timeupdate", onSeeked);
    };
  }, [ref]);
  return { time, duration, playing };
}

/** True when a key press belongs to a form control, so page shortcuts should leave it alone. */
export function isTyping(e: { target: EventTarget | null; code?: string }): boolean {
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName)) return true;
  if (el.getAttribute("role") === "slider") return true;
  // Space on a focused button already clicks it.
  return e.code === "Space" && el.tagName === "BUTTON";
}

export interface TimelineRange {
  key: number | string;
  start: number;
  end: number;
  label?: string;
}

const pct = (t: number, duration: number) => `${Math.max(0, Math.min(100, (t / duration) * 100))}%`;

/**
 * A bar under a video: click to seek, ranges as blocks (the parts of a recording) or one range
 * with drag handles (trimming a clip). Hovering shows the time under the pointer.
 */
export function Timeline({
  duration,
  time,
  ranges = [],
  activeKey,
  onSeek,
  onRangeClick,
  trim,
  label,
  className,
}: {
  duration: number;
  time: number;
  ranges?: TimelineRange[];
  activeKey?: number | string | null;
  onSeek: (t: number) => void;
  onRangeClick?: (range: TimelineRange) => void;
  /** One range with draggable start and end handles. ``step`` is the keyboard step (s). */
  trim?: {
    start: number;
    end: number;
    min: number;
    step: number;
    onChange: (start: number, end: number) => void;
    labels: { start: string; end: string };
  };
  label: string;
  className?: string;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [drag, setDrag] = useState<"start" | "end" | null>(null);

  const at = (clientX: number) => {
    const rect = bar.current?.getBoundingClientRect();
    if (!rect || !duration) return 0;
    return Math.max(0, Math.min(duration, ((clientX - rect.left) / rect.width) * duration));
  };

  const move = (which: "start" | "end", t: number) => {
    if (!trim) return;
    if (which === "start") trim.onChange(Math.min(t, trim.end - trim.min), trim.end);
    else trim.onChange(trim.start, Math.max(t, trim.start + trim.min));
  };

  const onPointerMove = (e: PointerEvent) => {
    const t = at(e.clientX);
    setHover(t);
    if (drag) move(drag, t);
  };

  const handleKey = (which: "start" | "end") => (e: KeyboardEvent) => {
    if (!trim) return;
    const step = e.shiftKey ? 1 : trim.step;
    const value = which === "start" ? trim.start : trim.end;
    const next = e.key === "ArrowLeft" || e.key === "ArrowDown" ? value - step
      : e.key === "ArrowRight" || e.key === "ArrowUp" ? value + step
      : e.key === "Home" ? 0
      : e.key === "End" ? duration
      : null;
    if (next == null) return;
    e.preventDefault();
    e.stopPropagation();
    move(which, Math.max(0, Math.min(duration, next)));
  };

  if (!duration) return <div className={cn("h-12 rounded-md border bg-muted", className)} />;

  return (
    <div className={cn("relative select-none pt-6", className)}>
      {hover != null && (
        <span
          className="pointer-events-none absolute top-0 -translate-x-1/2 rounded border bg-card px-1.5 text-xs tabular-nums shadow-xs"
          style={{ left: pct(hover, duration) }}
        >
          {formatSeconds(hover)}
        </span>
      )}
      <div
        ref={bar}
        role="group"
        aria-label={label}
        className="relative h-12 cursor-crosshair touch-none rounded-md border bg-muted"
        onPointerMove={onPointerMove}
        onPointerLeave={() => setHover(null)}
        onPointerUp={() => setDrag(null)}
        onPointerCancel={() => setDrag(null)}
        onClick={(e) => {
          if (!drag) onSeek(at(e.clientX));
        }}
      >
        {ranges.map((r) => (
          <button
            key={r.key}
            type="button"
            tabIndex={-1}
            title={`${r.label ?? ""} ${formatSeconds(r.start)} – ${formatSeconds(r.end)}`.trim()}
            className={cn(
              "absolute inset-y-1 flex items-start justify-center overflow-hidden rounded border border-primary/40 bg-primary/15 text-[10px] font-semibold text-primary hover:bg-primary/25",
              activeKey === r.key && "border-primary bg-primary/30",
            )}
            style={{ left: pct(r.start, duration), width: pct(r.end - r.start, duration) }}
            onClick={(e) => {
              e.stopPropagation();
              onSeek(r.start);
              onRangeClick?.(r);
            }}
          >
            {r.label}
          </button>
        ))}
        {trim && (
          <>
            <div className="pointer-events-none absolute inset-y-0 left-0 rounded-l-md bg-foreground/15" style={{ width: pct(trim.start, duration) }} />
            <div className="pointer-events-none absolute inset-y-0 right-0 rounded-r-md bg-foreground/15" style={{ width: pct(duration - trim.end, duration) }} />
            <div
              className="pointer-events-none absolute inset-y-0 border-y-2 border-primary/50 bg-primary/10"
              style={{ left: pct(trim.start, duration), width: pct(trim.end - trim.start, duration) }}
            />
            {(["start", "end"] as const).map((which) => (
              <div
                key={which}
                role="slider"
                tabIndex={0}
                aria-label={trim.labels[which]}
                aria-valuemin={0}
                aria-valuemax={Math.round(duration * 100) / 100}
                aria-valuenow={Math.round(trim[which] * 100) / 100}
                aria-valuetext={formatSeconds(trim[which])}
                className="absolute -inset-y-1.5 z-10 w-3 -translate-x-1/2 cursor-ew-resize rounded bg-primary shadow focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                style={{ left: pct(trim[which], duration) }}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  (e.target as HTMLElement).setPointerCapture(e.pointerId);
                  setDrag(which);
                }}
                onPointerMove={(e) => {
                  if (drag === which) move(which, at(e.clientX));
                }}
                onPointerUp={(e) => {
                  e.stopPropagation();
                  setDrag(null);
                }}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={handleKey(which)}
              />
            ))}
          </>
        )}
        <div
          className="pointer-events-none absolute -inset-y-1.5 z-20 w-0.5 -translate-x-1/2 rounded bg-foreground"
          style={{ left: pct(time, duration) }}
        />
      </div>
    </div>
  );
}
