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
  /** Shown in the block after the label, e.g. the word this part is for. */
  name?: string;
}

/** One side of a range: its start or its end. */
export interface Edge {
  key: TimelineRange["key"];
  which: "start" | "end";
}

/** A draggable point on the timeline: one edge, or two edges that touch (a shared boundary). */
export interface Handle {
  id: string;
  t: number;
  edges: Edge[];
  /** The edge of the selected range. */
  selected: boolean;
  /** Indexes (into the sorted ranges) of the ranges it touches, for its name. */
  around: number[];
}

const TOUCH = 0.005;
const round = (t: number) => Math.round(t * 100) / 100;
const byStart = (ranges: TimelineRange[]) => [...ranges].sort((a, b) => a.start - b.start);

/**
 * The handles to show. Two ranges that touch share one handle, so dragging it moves both. The
 * selected range gets its own start and end handles instead, which move just that range.
 */
export function timelineHandles(ranges: TimelineRange[], selectedKey: TimelineRange["key"] | null): Handle[] {
  const sorted = byStart(ranges);
  const handles: Handle[] = [];
  const touches = (a?: TimelineRange, b?: TimelineRange) => !!a && !!b && Math.abs(a.end - b.start) < TOUCH;
  sorted.forEach((r, i) => {
    const prev = sorted[i - 1];
    const next = sorted[i + 1];
    if (r.key === selectedKey) {
      handles.push({ id: `${r.key}:start`, t: r.start, edges: [{ key: r.key, which: "start" }], selected: true, around: [i] });
      handles.push({ id: `${r.key}:end`, t: r.end, edges: [{ key: r.key, which: "end" }], selected: true, around: [i] });
      return;
    }
    // A start that touches the previous range is handled there (shared handle) or by the selection.
    if (!touches(prev, r)) {
      handles.push({ id: `${r.key}:start`, t: r.start, edges: [{ key: r.key, which: "start" }], selected: false, around: [i] });
    }
    if (touches(r, next)) {
      if (next!.key !== selectedKey) {
        handles.push({
          id: `${r.key}|${next!.key}`,
          t: r.end,
          edges: [
            { key: r.key, which: "end" },
            { key: next!.key, which: "start" },
          ],
          selected: false,
          around: [i, i + 1],
        });
      }
    } else {
      handles.push({ id: `${r.key}:end`, t: r.end, edges: [{ key: r.key, which: "end" }], selected: false, around: [i] });
    }
  });
  return handles;
}

/**
 * Moves a handle to ``t`` and returns the new ranges. Every range keeps at least ``min`` seconds.
 * A single edge pushes the neighbouring range back when it would overlap it; a shared boundary
 * moves the end of one range and the start of the next together.
 */
export function moveHandle(
  ranges: TimelineRange[],
  edges: Edge[],
  t: number,
  min: number,
  duration: number,
): TimelineRange[] {
  const sorted = byStart(ranges).map((r) => ({ ...r }));
  const index = (key: Edge["key"]) => sorted.findIndex((r) => r.key === key);
  const clamp = (v: number, lo: number, hi: number) => round(Math.max(lo, Math.min(hi, v)));

  if (edges.length === 2) {
    const a = sorted[index(edges[0]!.key)]!;
    const b = sorted[index(edges[1]!.key)]!;
    const at = clamp(t, a.start + min, b.end - min);
    a.end = at;
    b.start = at;
    return sorted;
  }
  const edge = edges[0]!;
  const i = index(edge.key);
  const r = sorted[i]!;
  const prev = sorted[i - 1];
  const next = sorted[i + 1];
  if (edge.which === "start") {
    const at = clamp(t, prev ? prev.start + min : 0, r.end - min);
    r.start = at;
    if (prev && prev.end > at) prev.end = at;
  } else {
    const at = clamp(t, r.start + min, next ? next.end - min : duration);
    r.end = at;
    if (next && next.start < at) next.start = at;
  }
  return sorted;
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
  edit,
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
  /** Drag the edges of the ranges. ``step`` is the keyboard step (s); ``min`` the shortest range (s). */
  edit?: {
    selectedKey: TimelineRange["key"] | null;
    min: number;
    step: number;
    onChange: (ranges: TimelineRange[]) => void;
    /** Names the handles for screen readers. */
    describe: (handle: Handle, ranges: TimelineRange[]) => string;
  };
  label: string;
  className?: string;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [drag, setDrag] = useState<"start" | "end" | null>(null);
  const [dragHandle, setDragHandle] = useState<string | null>(null);
  const sortedRanges = byStart(ranges);
  const handles = edit ? timelineHandles(ranges, edit.selectedKey) : [];

  /** Moves the edges of a handle, and shows the frame at that time in the video. */
  const moveEdges = (handle: Handle, t: number) => {
    if (!edit) return;
    const next = moveHandle(ranges, handle.edges, t, edit.min, duration);
    edit.onChange(next);
    const edge = handle.edges[0]!;
    const moved = next.find((r) => r.key === edge.key);
    if (moved) onSeek(moved[edge.which]);
  };

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
        onPointerUp={() => {
          setDrag(null);
          setDragHandle(null);
        }}
        onPointerCancel={() => {
          setDrag(null);
          setDragHandle(null);
        }}
        onClick={(e) => {
          if (!drag && !dragHandle) onSeek(at(e.clientX));
        }}
      >
        {ranges.map((r) => (
          <button
            key={r.key}
            type="button"
            tabIndex={-1}
            title={`${r.label ?? ""} ${formatSeconds(r.start)} – ${formatSeconds(r.end)}`.trim()}
            aria-pressed={edit ? activeKey === r.key : undefined}
            className={cn(
              "absolute inset-y-1 flex cursor-pointer flex-col items-center justify-start overflow-hidden rounded border border-primary/40 bg-primary/15 px-0.5 text-[10px] leading-tight font-semibold text-primary hover:bg-primary/25",
              activeKey === r.key && "border-2 border-primary bg-primary/35",
            )}
            style={{ left: pct(r.start, duration), width: pct(r.end - r.start, duration) }}
            onClick={(e) => {
              e.stopPropagation();
              onSeek(r.start);
              onRangeClick?.(r);
            }}
          >
            {r.label}
            {r.name && <span className="w-full truncate text-center font-medium text-foreground/80">{r.name}</span>}
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
        {edit &&
          handles.map((h) => (
            <div
              key={h.id}
              role="slider"
              tabIndex={0}
              aria-label={edit.describe(h, sortedRanges)}
              aria-valuemin={0}
              aria-valuemax={Math.round(duration * 100) / 100}
              aria-valuenow={Math.round(h.t * 100) / 100}
              aria-valuetext={formatSeconds(h.t)}
              title={formatSeconds(h.t)}
              className={cn(
                // A wide, invisible grip around a thin visible bar.
                "group/handle absolute z-10 flex w-4 -translate-x-1/2 cursor-ew-resize justify-center rounded focus-visible:outline-2 focus-visible:outline-ring",
                h.selected ? "-inset-y-2" : "inset-y-0",
              )}
              style={{ left: pct(h.t, duration) }}
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                setDragHandle(h.id);
              }}
              onPointerMove={(e) => {
                if (dragHandle === h.id) moveEdges(h, at(e.clientX));
              }}
              onPointerUp={(e) => {
                e.stopPropagation();
                setDragHandle(null);
              }}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                const step = e.shiftKey ? edit.step * 10 : edit.step;
                const next =
                  e.key === "ArrowLeft" || e.key === "ArrowDown" ? h.t - step
                  : e.key === "ArrowRight" || e.key === "ArrowUp" ? h.t + step
                  : null;
                if (next == null) return;
                e.preventDefault();
                e.stopPropagation();
                moveEdges(h, next);
              }}
            >
              <span
                className={cn(
                  "pointer-events-none h-full rounded-full transition-[width]",
                  h.selected
                    ? "w-2 border border-ink bg-primary"
                    : "w-1 bg-ink/60 group-hover/handle:w-1.5 group-hover/handle:bg-ink",
                  dragHandle === h.id && "bg-ink",
                )}
              />
            </div>
          ))}
        <div
          className="pointer-events-none absolute -inset-y-1.5 z-20 w-0.5 -translate-x-1/2 rounded bg-foreground"
          style={{ left: pct(time, duration) }}
        />
      </div>
    </div>
  );
}
