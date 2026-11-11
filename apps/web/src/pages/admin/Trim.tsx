import type { Clip } from "@vgt/api-client";
import { t } from "@vgt/core";
import { useMutation } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw, Scissors, SkipBack, SkipForward } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Spinner } from "@/components/common";
import { Timeline, isTyping, useVideoTime } from "@/components/Timeline";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api, errorMessage, unwrap } from "@/lib/api";
import { isRunning, useJob } from "@/lib/upload";
import { formatSeconds } from "@/lib/utils";

/** Every clip is encoded at 30 frames per second. */
const FRAME = 1 / 30;
const MIN_LENGTH = 0.2;

/** "1:02.5" or "62.5" (comma or dot) → seconds; null when it is not a time. */
export function parseTime(text: string): number | null {
  const s = text.trim().replace(",", ".");
  const m = /^(\d+):(\d+(?:\.\d+)?)$/.exec(s);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  return /^\d+(?:\.\d+)?$/.test(s) ? Number(s) : null;
}

function TimeInput({
  label,
  value,
  valid,
  onCommit,
}: {
  label: string;
  value: number;
  valid: (t: number) => boolean;
  onCommit: (t: number) => void;
}) {
  const [text, setText] = useState(formatSeconds(value));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => setText(formatSeconds(value)), [value]);
  const commit = () => {
    const parsed = parseTime(text);
    if (parsed != null && valid(parsed)) {
      setInvalid(false);
      onCommit(parsed);
    } else {
      setInvalid(true);
      setText(formatSeconds(value));
    }
  };
  return (
    <Input
      aria-label={label}
      aria-invalid={invalid || undefined}
      className="w-24 font-mono tabular-nums"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
      }}
    />
  );
}

/** Cut the start and/or end off a clip. Calls ``onDone`` once the shortened copy is ready. */
export function Trimmer({ clip, onDone }: { clip: Clip; onDone: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const { time, duration: loaded, playing } = useVideoTime(video);
  const duration = loaded || clip.duration;
  const [range, setRange] = useState({ start: 0, end: clip.duration });
  const rangeRef = useRef(range);
  rangeRef.current = range;
  const [jobId, setJobId] = useState<number | null>(null);
  const job = useJob(jobId);

  // Once the real length is known, the end handle starts at the very end.
  useEffect(() => {
    if (loaded) setRange((r) => (Math.abs(r.end - clip.duration) < 0.05 ? { ...r, end: loaded } : r));
  }, [loaded, clip.duration]);

  // Playback loops between the start and end handles.
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const onTime = () => {
      const { start, end } = rangeRef.current;
      if (v.currentTime >= end - 0.01 || v.currentTime < start - 0.05) {
        v.currentTime = start;
      }
    };
    v.addEventListener("timeupdate", onTime);
    return () => v.removeEventListener("timeupdate", onTime);
  }, []);

  const seek = useCallback(
    (to: number) => {
      const v = video.current;
      if (v) v.currentTime = Math.max(0, Math.min(duration, to));
    },
    [duration],
  );
  const toggle = useCallback(() => {
    const v = video.current;
    if (!v) return;
    if (v.paused) {
      const { start, end } = rangeRef.current;
      if (v.currentTime < start || v.currentTime >= end - 0.01) v.currentTime = start;
      void v.play();
    } else v.pause();
  }, []);
  const setStart = useCallback((to: number) => {
    setRange((r) => ({ ...r, start: Math.max(0, Math.min(to, r.end - MIN_LENGTH)) }));
  }, []);
  const setEnd = useCallback(
    (to: number) => setRange((r) => ({ ...r, end: Math.min(duration, Math.max(to, r.start + MIN_LENGTH)) })),
    [duration],
  );
  const now = () => video.current?.currentTime ?? 0;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      const v = video.current;
      if (!v) return;
      const step = e.shiftKey ? 1 : FRAME;
      switch (e.code) {
        case "Space": e.preventDefault(); toggle(); break;
        case "KeyI": setStart(v.currentTime); break;
        case "KeyO": setEnd(v.currentTime); break;
        case "ArrowLeft": e.preventDefault(); v.pause(); seek(v.currentTime - step); break;
        case "ArrowRight": e.preventDefault(); v.pause(); seek(v.currentTime + step); break;
        case "Home": e.preventDefault(); seek(rangeRef.current.start); break;
        case "End": e.preventDefault(); seek(rangeRef.current.end); break;
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [seek, toggle, setStart, setEnd]);

  const save = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST("/api/v1/admin/clips/{clip_id}/trim", {
          params: { path: { clip_id: clip.id } },
          body: { start: Math.round(range.start * 1000) / 1000, end: Math.round(range.end * 1000) / 1000 },
        }),
      ),
    onSuccess: (j) => setJobId(j.id),
  });
  const done = job.data?.status === "done";
  useEffect(() => {
    if (done) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);

  const kept = range.end - range.start;
  const cut = duration - kept;
  const changed = cut > 0.01;
  const busy = save.isPending || isRunning(job.data?.status) || (jobId != null && !job.data);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">{t.admin.trimIntro}</p>
      <video
        ref={video}
        src={clip.url}
        poster={clip.thumb_url ?? undefined}
        muted
        playsInline
        preload="auto"
        className="aspect-[4/3] max-h-[40dvh] w-full rounded-lg bg-black object-contain"
        onClick={toggle}
      />
      <Timeline
        label={t.admin.timeline}
        duration={duration}
        time={time}
        onSeek={(to) => {
          video.current?.pause();
          seek(to);
        }}
        trim={{
          ...range,
          min: MIN_LENGTH,
          step: FRAME,
          onChange: (start, end) => {
            video.current?.pause();
            if (start !== range.start) seek(start);
            else if (end !== range.end) seek(end);
            setRange({ start, end });
          },
          labels: { start: t.admin.startHandle, end: t.admin.endHandle },
        }}
      />
      <div className="flex flex-wrap items-center gap-1">
        <Button size="icon" variant="outline" aria-label={t.admin.jumpToStart} title={t.admin.jumpToStart} onClick={() => seek(range.start)}>
          <SkipBack aria-hidden />
        </Button>
        <Button size="icon" variant="outline" aria-label={t.admin.prevFrame} title={t.admin.prevFrame} onClick={() => seek(now() - FRAME)}>
          <ChevronLeft aria-hidden />
        </Button>
        <Button size="icon" aria-label={playing ? t.admin.pause : t.admin.play} onClick={toggle}>
          {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
        </Button>
        <Button size="icon" variant="outline" aria-label={t.admin.nextFrame} title={t.admin.nextFrame} onClick={() => seek(now() + FRAME)}>
          <ChevronRight aria-hidden />
        </Button>
        <Button size="icon" variant="outline" aria-label={t.admin.jumpToEnd} title={t.admin.jumpToEnd} onClick={() => seek(range.end)}>
          <SkipForward aria-hidden />
        </Button>
        <span className="ml-2 font-mono text-sm tabular-nums">
          {formatSeconds(time)} <span className="text-muted-foreground">/ {formatSeconds(duration)}</span>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 rounded-lg border px-2 py-1.5">
          <span className="text-xs font-semibold uppercase text-muted-foreground">{t.admin.start}</span>
          <TimeInput label={t.admin.start} value={range.start} valid={(v) => v >= 0 && v <= range.end - MIN_LENGTH} onCommit={(v) => { setStart(v); seek(v); }} />
          <Button size="sm" variant="outline" onClick={() => setStart(now())}>{t.admin.setStart}</Button>
        </div>
        <div className="flex items-center gap-2 rounded-lg border px-2 py-1.5">
          <span className="text-xs font-semibold uppercase text-muted-foreground">{t.admin.end}</span>
          <TimeInput label={t.admin.end} value={range.end} valid={(v) => v >= range.start + MIN_LENGTH && v <= duration + 0.01} onCommit={(v) => { setEnd(v); seek(v); }} />
          <Button size="sm" variant="outline" onClick={() => setEnd(now())}>{t.admin.setEnd}</Button>
        </div>
      </div>
      <p className={changed ? "text-sm font-medium text-success" : "text-sm text-muted-foreground"}>
        {changed
          ? t.admin.trimPreview(formatSeconds(duration), formatSeconds(kept), formatSeconds(cut))
          : t.admin.trimNone(formatSeconds(duration))}
      </p>
      <p className="text-xs text-muted-foreground">
        {t.admin.shortcuts}: {t.admin.trimKeys}
      </p>
      {save.isError && <Alert tone="destructive">{errorMessage(save.error)}</Alert>}
      {job.data?.status === "failed" && <Alert tone="destructive">{t.admin.failed}: {job.data.error}</Alert>}
      {busy && <Spinner label={t.admin.trimming} />}
      <div className="flex flex-wrap gap-2">
        <Button disabled={!changed || busy} onClick={() => save.mutate()}>
          <Scissors aria-hidden /> {t.admin.trimSave}
        </Button>
        <Button variant="ghost" disabled={!changed || busy} onClick={() => setRange({ start: 0, end: duration })}>
          <RotateCcw aria-hidden /> {t.admin.resetTrim}
        </Button>
      </div>
    </div>
  );
}
