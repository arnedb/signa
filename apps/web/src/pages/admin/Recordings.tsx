import type { AdminWord, Schemas } from "@signa/api-client";
import { t } from "@signa/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Pause, Play, Plus, RefreshCw, Scissors, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { ErrorView, Field, PageTitle, Spinner } from "@/components/common";
import { Timeline, isTyping, useVideoTime } from "@/components/Timeline";
import { Button } from "@/components/ui/button";
import { Alert, Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { api, catalogQuery, errorMessage, unwrap } from "@/lib/api";
import { useLessonField } from "@/lib/lesson";
import { isRunning, uploadFile } from "@/lib/upload";
import { cn, formatDate, formatSeconds } from "@/lib/utils";
import { adminWordsQuery } from "@/pages/admin/Words";

type Recording = Schemas["RecordingOut"];
type Segment = Schemas["Segment"];

const recordingsQuery = {
  queryKey: ["admin", "recordings"],
  queryFn: () => unwrap(api.GET("/api/v1/admin/recordings")),
  refetchInterval: (q: { state: { data?: Recording[] } }) =>
    q.state.data?.some((r) => isRunning(r.status)) ? 2000 : false,
};

const recordingQuery = (id: number) => ({
  queryKey: ["admin", "recording", id],
  queryFn: () =>
    unwrap(api.GET("/api/v1/admin/recordings/{job_id}", { params: { path: { job_id: id } } })),
  refetchInterval: (q: { state: { data?: Recording } }) => (isRunning(q.state.data?.status) ? 2000 : false),
});

function StatusBadge({ status }: { status: string }) {
  const tone = status === "done" ? "success" : status === "failed" ? "destructive" : "warning";
  return <Badge tone={tone}>{t.admin.recordingStatus[status]}</Badge>;
}

export function RecordingsPage() {
  const qc = useQueryClient();
  const list = useQuery(recordingsQuery);
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const upload = useMutation({
    mutationFn: () => uploadFile<Recording>("/api/v1/admin/recordings", file as File, {}, setProgress),
    onSuccess: () => {
      setFile(null);
      void qc.invalidateQueries({ queryKey: ["admin", "recordings"] });
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <PageTitle>{t.admin.recordings}</PageTitle>
      <Card>
        <CardHeader>
          <CardTitle>{t.admin.uploadRecording}</CardTitle>
          <CardDescription>{t.admin.recordingsIntro}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={(e) => { e.preventDefault(); if (file) upload.mutate(); }}>
            <Field label={t.admin.videoFile} className="flex-1">
              {(p) => <Input {...p} type="file" accept="video/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />}
            </Field>
            <Button type="submit" disabled={!file || upload.isPending}>
              <Upload aria-hidden /> {t.admin.uploadRecording}
            </Button>
          </form>
          {upload.isPending && <Spinner className="mt-3" label={`${t.admin.uploading} ${Math.round(progress * 100)}%`} />}
          {upload.isError && <Alert tone="destructive" className="mt-3">{errorMessage(upload.error)}</Alert>}
        </CardContent>
      </Card>
      {list.isPending ? (
        <Spinner />
      ) : list.isError ? (
        <ErrorView error={list.error} />
      ) : (
        <ul className="flex flex-col gap-2">
          {list.data.map((r) => (
            <li key={r.id}>
              <Link
                to="/admin/recordings/$recordingId"
                params={{ recordingId: String(r.id) }}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3 hover:border-primary/50"
              >
                <div>
                  <p className="font-medium">{r.filename}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(r.created_at, true)}
                    {r.status === "done" && ` · ${t.admin.segments(r.segments.length)}`}
                    {r.applied.length > 0 && ` · ${t.admin.alreadyApplied}: ${r.applied.length}`}
                  </p>
                </div>
                <StatusBadge status={r.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface Row extends Segment {
  key: number;
  /** The word this segment shows. Empty: skip it. See ``resolve`` for what a name becomes. */
  text: string;
}

let rowKey = 0;
const toRows = (segments: Segment[]): Row[] => segments.map((s) => ({ ...s, key: ++rowKey, text: "" }));

type Method = NonNullable<Recording["method"]>;

export function RecordingPage({ recordingId }: { recordingId: number }) {
  const qc = useQueryClient();
  const rec = useQuery(recordingQuery(recordingId));
  const [method, setMethod] = useState<Method | null>(null);
  const formId = useId();
  const splitAgain = useMutation({
    mutationFn: (m: Method) =>
      unwrap(
        api.POST("/api/v1/admin/recordings/{job_id}/split", {
          params: { path: { job_id: recordingId } },
          body: { method: m },
        }),
      ),
    onSuccess: (r) => {
      qc.setQueryData(recordingQuery(recordingId).queryKey, r);
      void qc.invalidateQueries({ queryKey: ["admin", "recordings"] });
    },
  });
  if (rec.isPending) return <Spinner />;
  if (rec.isError) return <ErrorView error={rec.error} />;
  const r = rec.data;
  const chosen = method ?? r.method ?? "motion";
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link to="/admin/recordings">
            <ArrowLeft aria-hidden /> {t.admin.recordings}
          </Link>
        </Button>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{r.filename}</h1>
          <StatusBadge status={r.status} />
        </div>
      </div>
      {isRunning(r.status) && <Spinner label={t.admin.processing} />}
      {r.status === "failed" && <Alert tone="destructive">{r.error}</Alert>}
      {r.status === "done" && r.error && (
        <Alert tone="destructive">
          {t.admin.splitFailed} {r.error}
        </Alert>
      )}
      {r.status === "done" && r.source_url && (
        <>
          <form
            className="flex max-w-2xl flex-col gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (window.confirm(t.admin.splitAgainConfirm)) splitAgain.mutate(chosen);
            }}
          >
            <Label htmlFor={`${formId}-method`}>{t.admin.splitMethod}</Label>
            <div className="flex flex-wrap items-center gap-3">
              <Select
                id={`${formId}-method`}
                className="w-auto min-w-64 flex-1"
                value={chosen}
                onChange={(e) => setMethod(e.target.value as Method)}
              >
                {(["motion", "freeze"] as const).map((m) => (
                  <option key={m} value={m}>{t.admin.splitMethods[m]}</option>
                ))}
              </Select>
              <Button type="submit" variant="outline" disabled={splitAgain.isPending}>
                <RefreshCw aria-hidden /> {t.admin.splitAgain}
              </Button>
            </div>
          </form>
          {splitAgain.isError && <Alert tone="destructive">{errorMessage(splitAgain.error)}</Alert>}
          <Editor recording={r} />
        </>
      )}
    </div>
  );
}

const glossKey = (g: string) => g.trim().replace(/\s+/g, " ").toLocaleLowerCase("nl");

function Editor({ recording }: { recording: Recording }) {
  const qc = useQueryClient();
  const video = useRef<HTMLVideoElement>(null);
  const { time, playing } = useVideoTime(video);
  const duration = recording.duration ?? 0;
  const [rows, setRows] = useState<Row[]>(() => toRows(recording.segments));
  // The segment being edited: its own start and end on the timeline, its details on the right.
  const [selectedKey, setSelectedKey] = useState<number | null>(() => rows[0]?.key ?? null);
  const [year, setYear] = useState<number>(1);
  const [list, setList] = useState<string>("");
  const [publish, setPublish] = useState(false);
  const catalog = useQuery(catalogQuery);
  const words = useQuery(adminWordsQuery({ year }));
  const listNumber = list.trim() || null;
  const lesson = useLessonField(list);

  // Existing words of this year by name, to recognise a typed name.
  const byGloss = useMemo(() => {
    const map = new Map<string, AdminWord[]>();
    for (const w of words.data ?? []) {
      const k = glossKey(w.gloss);
      map.set(k, [...(map.get(k) ?? []), w]);
    }
    return map;
  }, [words.data]);
  /**
   * What a typed name becomes: the word with that name on the chosen list gets this video
   * (in place of its old one); any other name becomes a new word on the list.
   */
  const resolve = (text: string): Resolved => {
    if (!text.trim()) return { kind: "skip" };
    const same = byGloss.get(glossKey(text)) ?? [];
    const onList = same.find((w) => (w.list_number ?? null) === listNumber);
    if (onList) return { kind: "existing", word: onList };
    const elsewhere = [...new Set(same.map((w) => t.app.list(w.list_number ?? "—")))].join(", ");
    return { kind: "new", elsewhere: elsewhere || null };
  };

  const saveCuts = useMutation({
    mutationFn: () =>
      unwrap(
        api.PUT("/api/v1/admin/recordings/{job_id}/segments", {
          params: { path: { job_id: recording.id } },
          body: { segments: rows.map(({ start, end }) => ({ start, end })) },
        }),
      ),
    onSuccess: (r) => qc.setQueryData(recordingQuery(recording.id).queryKey, r),
  });
  const apply = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST("/api/v1/admin/recordings/{job_id}/apply", {
          params: { path: { job_id: recording.id } },
          body: {
            year,
            lesson: lesson.number,
            list_number: listNumber,
            publish,
            items: rows.flatMap((r): { start: number; end: number; word_id?: number; gloss?: string; mode?: "replace" }[] => {
              const to = resolve(r.text);
              if (to.kind === "existing") return [{ start: r.start, end: r.end, word_id: to.word.id, mode: "replace" }];
              if (to.kind === "new") return [{ start: r.start, end: r.end, gloss: r.text.trim() }];
              return [];
            }),
          },
        }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin"] });
      void qc.invalidateQueries({ queryKey: ["catalog"] });
      // Done: clear the names, so making the videos again cannot add them twice.
      setRows((rs) => rs.map((r) => ({ ...r, text: "" })));
    },
  });

  const seek = useCallback(
    (to: number) => {
      const v = video.current;
      if (!v) return;
      v.currentTime = Math.max(0, Math.min(duration || v.duration || 0, to));
    },
    [duration],
  );
  const toggle = useCallback(() => {
    const v = video.current;
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
  }, []);
  const update = (key: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const splitAt = useCallback(() => {
    const at = Math.round((video.current?.currentTime ?? 0) * 100) / 100;
    // Made outside the updater: React may call an updater twice.
    const key = ++rowKey;
    setRows((rs) => {
      const i = rs.findIndex((r) => r.start < at && at < r.end);
      if (i < 0) {
        const added: Row = { start: at, end: Math.min(at + 1.5, duration || at + 1.5), key, text: "" };
        return [...rs, added].sort((a, b) => a.start - b.start);
      }
      const r = rs[i] as Row;
      return [...rs.slice(0, i), { ...r, end: at }, { ...r, key, start: at, text: "" }, ...rs.slice(i + 1)];
    });
    setSelectedKey(key);
  }, [duration]);
  const remove = useCallback(
    (key: number) => {
      const i = rows.findIndex((r) => r.key === key);
      const neighbour = rows[i + 1] ?? rows[i - 1];
      setRows((rs) => rs.filter((r) => r.key !== key));
      setSelectedKey(neighbour?.key ?? null);
    },
    [rows],
  );
  const select = (row: Row) => {
    setSelectedKey(row.key);
    seek(row.start);
  };
  /** The word a segment is for: a new word's name, or the chosen existing word. */
  const nameOf = (row: Row) => row.text.trim();

  // Set when Enter moves on to the next segment: its word field then takes the focus.
  const focusWord = useRef(false);
  useEffect(() => {
    focusWord.current = false;
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || document.querySelector("[role=dialog]")) return;
      const v = video.current;
      if (!v) return;
      const step = e.shiftKey ? 5 : 0.5;
      if ((e.key === "Backspace" || e.key === "Delete") && selectedKey != null) {
        e.preventDefault();
        remove(selectedKey);
        return;
      }
      switch (e.code) {
        case "Space": e.preventDefault(); toggle(); break;
        case "KeyS": e.preventDefault(); splitAt(); break;
        case "ArrowLeft": e.preventDefault(); seek(v.currentTime - step); break;
        case "ArrowRight": e.preventDefault(); seek(v.currentTime + step); break;
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [seek, toggle, splitAt, selectedKey, remove]);

  const resolved = rows.map((r) => resolve(r.text));
  const hasNew = resolved.some((r) => r.kind === "new");
  const ready = resolved.filter((r) => r.kind !== "skip").length;
  const selectedIndex = rows.findIndex((r) => r.key === selectedKey);
  const selected = rows[selectedIndex];

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
      <div className="flex flex-col gap-3 lg:sticky lg:top-32 lg:self-start">
        <video
          ref={video}
          src={recording.source_url ?? undefined}
          muted
          playsInline
          preload="auto"
          className="aspect-[4/3] max-h-[38dvh] w-full rounded-lg bg-black object-contain"
          onClick={toggle}
        />
        <Timeline
          label={t.admin.timeline}
          duration={duration}
          time={time}
          ranges={rows.map((r, i) => ({ key: r.key, start: r.start, end: r.end, label: String(i + 1), name: nameOf(r) }))}
          activeKey={selectedKey}
          onSeek={seek}
          onRangeClick={(r) => setSelectedKey(r.key as number)}
          edit={{
            selectedKey,
            min: 0.1,
            step: 0.05,
            onChange: (next) => {
              const byKey = new Map(next.map((n) => [n.key, n]));
              setRows((rs) =>
                rs.map((r) => {
                  const n = byKey.get(r.key);
                  return n ? { ...r, start: n.start, end: n.end } : r;
                }),
              );
            },
            describe: (h, sorted) => {
              const names = h.around.map((i) => sorted[i]?.label ?? "");
              if (h.edges.length === 2) return t.admin.boundaryBetween(names[0]!, names[1]!);
              return h.edges[0]!.which === "start" ? t.admin.segmentStartOf(names[0]!) : t.admin.segmentEndOf(names[0]!);
            },
          }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button size="icon" aria-label={playing ? t.admin.pause : t.admin.play} onClick={toggle}>
            {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
          </Button>
          <span className="font-mono text-sm tabular-nums">
            {formatSeconds(time)} <span className="text-muted-foreground">/ {formatSeconds(duration)}</span>
          </span>
          <Button size="sm" variant="outline" onClick={splitAt}>
            <Scissors aria-hidden /> {t.admin.splitHere}
          </Button>
          <Button size="sm" variant="outline" onClick={() => saveCuts.mutate()} disabled={saveCuts.isPending}>
            {t.admin.saveCuts}
          </Button>
        </div>
        {rows.length > 0 && (
          <ol aria-label={t.admin.segmentList} className="flex flex-wrap gap-1.5">
            {rows.map((row, i) => {
              const name = nameOf(row);
              const isSelected = row.key === selectedKey;
              return (
                <li key={row.key}>
                  <button
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => select(row)}
                    className={cn(
                      "flex cursor-pointer items-center gap-1.5 rounded-full border-2 py-0.5 pr-2.5 pl-1 text-sm transition-colors",
                      isSelected ? "border-ink bg-sky text-on-crayon" : "border-ink/20 bg-card hover:border-ink",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-5 items-center justify-center rounded-full text-xs font-bold tabular-nums",
                        isSelected ? "bg-card text-foreground" : "bg-muted",
                      )}
                    >
                      {i + 1}
                    </span>
                    <span className={cn(!name && "text-muted-foreground italic", isSelected && !name && "text-on-crayon/70")}>
                      {name || t.admin.noWordYet}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        )}
        <p className="text-xs text-muted-foreground">
          {t.admin.dragHint} {t.admin.shortcuts}: {t.admin.splitKeys}
        </p>
        {saveCuts.isSuccess && <p className="text-sm text-success">{t.app.saved}</p>}
        {saveCuts.isError && <Alert tone="destructive">{errorMessage(saveCuts.error)}</Alert>}
      </div>

      <div className="flex flex-col gap-4">
        <Card>
          <CardContent className="flex flex-col gap-3 pt-5">
            <div className="flex flex-wrap items-end gap-3">
              <Field label={t.practice.year}>
                {(p) => (
                  <Select
                    {...p}
                    value={year}
                    onChange={(e) => {
                      setYear(Number(e.target.value));
                      setList("");
                      lesson.reset();
                    }}
                  >
                    {[...new Set([...(catalog.data?.years.map((y) => y.year) ?? []), 1, 2, 3])]
                      .sort((a, b) => a - b)
                      .map((y) => (
                        <option key={y} value={y}>{t.app.year(y)}</option>
                      ))}
                  </Select>
                )}
              </Field>
              <Field label={t.practice.lesson}>
                {(p) => (
                  <Input
                    {...p}
                    type="number"
                    min={0}
                    max={100}
                    className="w-20"
                    autoComplete="off"
                    value={lesson.value}
                    onChange={(e) => lesson.set(e.target.value)}
                  />
                )}
              </Field>
              <Field label={t.practice.list}>
                {(p) => (
                  <Input {...p} className="w-28" autoComplete="off" placeholder="x.y" value={list} onChange={(e) => setList(e.target.value)} />
                )}
              </Field>
            </div>
          </CardContent>
        </Card>

        {selected ? (
          <SegmentRow
            key={selected.key}
            index={selectedIndex}
            row={selected}
            resolved={resolve(selected.text)}
            focus={focusWord.current}
            onChange={(text) => update(selected.key, { text })}
            onRemove={() => remove(selected.key)}
            onNext={() => {
              const next = rows[selectedIndex + 1];
              if (!next) return;
              focusWord.current = true;
              select(next);
            }}
          />
        ) : (
          rows.length > 0 && <p className="text-sm text-muted-foreground">{t.admin.pickSegment}</p>
        )}
        <Button variant="outline" className="self-start" onClick={splitAt}>
          <Plus aria-hidden /> {t.admin.addSegment}
        </Button>

        {/* Only matters when there are new words: it belongs with making the videos. */}
        {hasNew && (
          <div className="flex flex-col gap-2 rounded-md bg-muted p-3 text-sm">
            <p>
              {t.admin.newWordsGoTo(
                [t.app.year(year), lesson.number != null ? t.app.lesson(lesson.number) : null, t.app.list(listNumber ?? "—")]
                  .filter(Boolean)
                  .join(" · "),
              )}
            </p>
            {lesson.number == null && <p className="font-bold text-destructive">{t.admin.needsLesson}</p>}
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={publish} onChange={(e) => setPublish(e.target.checked)} />
              {t.admin.publishNew}
            </label>
          </div>
        )}
        {apply.isSuccess && <Alert tone="success">{t.admin.applied}</Alert>}
        {apply.isError && <Alert tone="destructive">{errorMessage(apply.error)}</Alert>}
        <Button
          size="lg"
          className="self-start"
          disabled={ready === 0 || (hasNew && lesson.number == null) || apply.isPending}
          onClick={() => apply.mutate()}
        >
          {t.admin.apply(ready)}
        </Button>
      </div>
    </div>
  );
}

type Resolved = { kind: "skip" } | { kind: "existing"; word: AdminWord } | { kind: "new"; elsewhere: string | null };

function SegmentRow({
  index,
  row,
  resolved,
  focus,
  onChange,
  onRemove,
  onNext,
}: {
  index: number;
  row: Row;
  resolved: Resolved;
  focus: boolean;
  onChange: (text: string) => void;
  onRemove: () => void;
  onNext: () => void;
}) {
  const note =
    resolved.kind === "existing"
      ? t.admin.replacesVideo
      : resolved.kind === "new"
        ? resolved.elsewhere
          ? `${t.admin.becomesNewWord} ${t.admin.existsElsewhere(resolved.elsewhere)}`
          : t.admin.becomesNewWord
        : null;
  return (
    <section aria-label={t.admin.segmentTitle(index + 1)}>
      <Card className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
            <span className="flex size-8 items-center justify-center rounded-full border-2 border-ink bg-sky text-on-crayon tabular-nums">
              {index + 1}
            </span>
            {t.admin.segmentTitle(index + 1)}
          </h2>
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:bg-berry-soft hover:text-destructive"
            title={`${t.admin.removeSegment} (Backspace)`}
            onClick={onRemove}
          >
            <Trash2 aria-hidden /> {t.admin.removeSegment}
          </Button>
        </div>
        <Field label={t.admin.word} hint={note ?? undefined}>
          {(p) => (
            <Input
              {...p}
              autoFocus={focus}
              autoComplete="off"
              spellCheck={false}
              placeholder={t.admin.skip}
              value={row.text}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onNext();
                }
              }}
            />
          )}
        </Field>
      </Card>
    </section>
  );
}
