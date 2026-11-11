import type { AdminWord, Schemas } from "@vgt/api-client";
import { t } from "@vgt/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, ListPlus, Pause, Play, Plus, RefreshCw, Scissors, Trash2, Upload, Wand2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ErrorView, Field, PageTitle, Spinner } from "@/components/common";
import { Timeline, isTyping, useVideoTime } from "@/components/Timeline";
import { Button } from "@/components/ui/button";
import { Alert, Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { api, catalogQuery, errorMessage, unwrap } from "@/lib/api";
import { isRunning, uploadFile } from "@/lib/upload";
import { formatDate, formatSeconds } from "@/lib/utils";
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
  wordId: number | null;
  /** Not null: the segment becomes a new word with this name. */
  gloss: string | null;
  mode: "replace" | "extra";
}

let rowKey = 0;
const toRows = (segments: Segment[]): Row[] =>
  segments.map((s) => ({ ...s, key: ++rowKey, wordId: null, gloss: null, mode: "replace" }));

type Method = NonNullable<Recording["method"]>;

export function RecordingPage({ recordingId }: { recordingId: number }) {
  const qc = useQueryClient();
  const rec = useQuery(recordingQuery(recordingId));
  const [method, setMethod] = useState<Method | null>(null);
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
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (window.confirm(t.admin.splitAgainConfirm)) splitAgain.mutate(chosen);
            }}
          >
            <Field label={t.admin.splitMethod} hint={t.admin.splitMethodHint} className="max-w-md">
              {(p) => (
                <Select {...p} value={chosen} onChange={(e) => setMethod(e.target.value as Method)}>
                  {(["motion", "freeze"] as const).map((m) => (
                    <option key={m} value={m}>{t.admin.splitMethods[m]}</option>
                  ))}
                </Select>
              )}
            </Field>
            <Button type="submit" variant="outline" disabled={splitAgain.isPending} className="mb-6">
              <RefreshCw aria-hidden /> {t.admin.splitAgain}
            </Button>
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
  const stopAt = useRef<number | null>(null);
  const { time, playing } = useVideoTime(video);
  const duration = recording.duration ?? 0;
  const [rows, setRows] = useState<Row[]>(() => toRows(recording.segments));
  const [year, setYear] = useState<number>(1);
  const [list, setList] = useState<string>("");
  const [publish, setPublish] = useState(false);
  const catalog = useQuery(catalogQuery);
  const words = useQuery(adminWordsQuery({ year }));
  const wordsById = useMemo(() => new Map((words.data ?? []).map((w) => [w.id, w])), [words.data]);
  const listNumber = list.trim() || null;

  // Which existing words share a name with a new word: on this list (refused) or elsewhere.
  const byGloss = useMemo(() => {
    const map = new Map<string, AdminWord[]>();
    for (const w of words.data ?? []) {
      const k = glossKey(w.gloss);
      map.set(k, [...(map.get(k) ?? []), w]);
    }
    return map;
  }, [words.data]);
  const conflict = (gloss: string | null) => {
    if (!gloss?.trim()) return null;
    const same = byGloss.get(glossKey(gloss)) ?? [];
    if (same.some((w) => (w.list_number ?? null) === listNumber)) return { onList: true, text: t.admin.existsOnList };
    if (same.length) {
      const lists = [...new Set(same.map((w) => t.app.list(w.list_number ?? "—")))].join(", ");
      return { onList: false, text: t.admin.existsElsewhere(lists) };
    }
    return null;
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
            list_number: listNumber,
            publish,
            items: rows
              .filter((r) => r.wordId != null || r.gloss?.trim())
              .map((r) =>
                r.gloss != null
                  ? { start: r.start, end: r.end, gloss: r.gloss.trim() }
                  : { start: r.start, end: r.end, word_id: r.wordId as number, mode: r.mode },
              ),
          },
        }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin"] });
      void qc.invalidateQueries({ queryKey: ["catalog"] });
      // New words are made now: from here on they are existing words.
      setRows((rs) => rs.map((r) => (r.gloss != null ? { ...r, gloss: null, wordId: null } : r)));
    },
  });

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const onTime = () => {
      if (stopAt.current != null && v.currentTime >= stopAt.current) {
        v.pause();
        stopAt.current = null;
      }
    };
    v.addEventListener("timeupdate", onTime);
    return () => v.removeEventListener("timeupdate", onTime);
  }, []);

  const seek = useCallback(
    (to: number) => {
      const v = video.current;
      if (!v) return;
      stopAt.current = null;
      v.currentTime = Math.max(0, Math.min(duration || v.duration || 0, to));
    },
    [duration],
  );
  const toggle = useCallback(() => {
    const v = video.current;
    if (!v) return;
    stopAt.current = null;
    if (v.paused) void v.play();
    else v.pause();
  }, []);
  const playSegment = (s: Segment) => {
    const v = video.current;
    if (!v) return;
    v.currentTime = s.start;
    stopAt.current = s.end;
    void v.play();
  };
  const now = () => Math.round((video.current?.currentTime ?? 0) * 100) / 100;
  const update = (key: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const splitAt = useCallback(() => {
    const at = Math.round((video.current?.currentTime ?? 0) * 100) / 100;
    setRows((rs) => {
      const i = rs.findIndex((r) => r.start < at && at < r.end);
      if (i < 0) {
        const added: Row = { start: at, end: Math.min(at + 1.5, duration || at + 1.5), key: ++rowKey, wordId: null, gloss: null, mode: "replace" };
        return [...rs, added].sort((a, b) => a.start - b.start);
      }
      const r = rs[i] as Row;
      return [...rs.slice(0, i), { ...r, end: at }, { ...r, key: ++rowKey, start: at, wordId: null, gloss: null }, ...rs.slice(i + 1)];
    });
  }, [duration]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || document.querySelector("[role=dialog]")) return;
      const v = video.current;
      if (!v) return;
      const step = e.shiftKey ? 5 : 0.5;
      switch (e.code) {
        case "Space": e.preventDefault(); toggle(); break;
        case "KeyS": e.preventDefault(); splitAt(); break;
        case "ArrowLeft": e.preventDefault(); seek(v.currentTime - step); break;
        case "ArrowRight": e.preventDefault(); seek(v.currentTime + step); break;
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [seek, toggle, splitAt]);

  const suggest = () => {
    const candidates = (words.data ?? []).filter((w) => !listNumber || w.list_number === listNumber);
    setRows((rs) => rs.map((r, i) => ({ ...r, wordId: candidates[i]?.id ?? null, gloss: null })));
  };
  const allNew = () =>
    setRows((rs) => rs.map((r) => (r.wordId == null && r.gloss == null ? { ...r, gloss: "" } : r)));

  const yearData = catalog.data?.years.find((y) => y.year === year);
  const newRows = rows.filter((r) => r.gloss != null);
  const unnamed = newRows.filter((r) => !r.gloss?.trim()).length;
  const blocked = newRows.some((r) => conflict(r.gloss)?.onList);
  const ready = rows.filter((r) => r.wordId != null || r.gloss?.trim()).length;
  const active = rows.find((r) => r.start <= time && time < r.end)?.key ?? null;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,28rem)_1fr]">
      <div className="flex flex-col gap-3 xl:sticky xl:top-32 xl:self-start">
        <video
          ref={video}
          src={recording.source_url ?? undefined}
          muted
          playsInline
          preload="auto"
          className="aspect-[4/3] w-full rounded-lg bg-black"
          onClick={toggle}
        />
        <Timeline
          label={t.admin.timeline}
          duration={duration}
          time={time}
          ranges={rows.map((r, i) => ({ key: r.key, start: r.start, end: r.end, label: String(i + 1) }))}
          activeKey={active}
          onSeek={seek}
          onRangeClick={(r) => playSegment(r)}
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
        <p className="text-xs text-muted-foreground">
          {t.admin.shortcuts}: {t.admin.splitKeys}
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
                  <Select {...p} value={year} onChange={(e) => { setYear(Number(e.target.value)); setList(""); }}>
                    {[...new Set([...(catalog.data?.years.map((y) => y.year) ?? []), 1, 2, 3])]
                      .sort((a, b) => a - b)
                      .map((y) => (
                        <option key={y} value={y}>{t.app.year(y)}</option>
                      ))}
                  </Select>
                )}
              </Field>
              <Field label={t.practice.list}>
                {(p) => (
                  <>
                    <Input {...p} className="w-28" list="recording-lists" placeholder="1.1" value={list} onChange={(e) => setList(e.target.value)} />
                    <datalist id="recording-lists">
                      {yearData?.lists
                        .filter((l) => l.list_number)
                        .map((l) => <option key={l.list_number} value={l.list_number ?? ""} />)}
                    </datalist>
                  </>
                )}
              </Field>
              <Button variant="secondary" onClick={suggest} disabled={!words.data}>
                <Wand2 aria-hidden /> {t.admin.suggest}
              </Button>
              <Button variant="outline" onClick={allNew}>
                <ListPlus aria-hidden /> {t.admin.allNew}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t.admin.listHint}</p>
            {newRows.length > 0 && (
              <div className="flex flex-col gap-2 rounded-md bg-muted p-3 text-sm">
                <p>{t.admin.newWordsGoTo(`${t.app.year(year)} · ${t.app.list(listNumber ?? "—")}`)}</p>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={publish} onChange={(e) => setPublish(e.target.checked)} />
                  {t.admin.publishNew}
                </label>
              </div>
            )}
          </CardContent>
        </Card>

        <ol className="flex flex-col gap-3">
          {rows.map((row, i) => (
            <SegmentRow
              key={row.key}
              index={i}
              row={row}
              active={row.key === active}
              words={words.data ?? []}
              word={row.wordId != null ? wordsById.get(row.wordId) : undefined}
              conflict={conflict(row.gloss)}
              onChange={(patch) => update(row.key, patch)}
              onRemove={() => setRows((rs) => rs.filter((r) => r.key !== row.key))}
              onPlay={() => playSegment(row)}
              now={now}
            />
          ))}
        </ol>
        <Button variant="outline" className="self-start" onClick={splitAt}>
          <Plus aria-hidden /> {t.admin.addSegment}
        </Button>

        {apply.isSuccess && <Alert tone="success">{t.admin.applied}</Alert>}
        {apply.isError && <Alert tone="destructive">{errorMessage(apply.error)}</Alert>}
        {unnamed > 0 && <p className="text-sm text-muted-foreground">{t.admin.needsGloss(unnamed)}</p>}
        <Button
          size="lg"
          className="self-start"
          disabled={ready === 0 || unnamed > 0 || blocked || apply.isPending}
          onClick={() => apply.mutate()}
        >
          {t.admin.apply(ready)}
        </Button>
      </div>
    </div>
  );
}

const NEW = "__new__";

function SegmentRow({
  index,
  row,
  active,
  words,
  word,
  conflict,
  onChange,
  onRemove,
  onPlay,
  now,
}: {
  index: number;
  row: Row;
  active: boolean;
  words: AdminWord[];
  word: AdminWord | undefined;
  conflict: { onList: boolean; text: string } | null;
  onChange: (patch: Partial<Row>) => void;
  onRemove: () => void;
  onPlay: () => void;
  now: () => number;
}) {
  const old = word?.clips.find((c) => c.is_primary && !c.archived);
  const isNew = row.gloss != null;
  return (
    <li>
      <Card className={`flex flex-col gap-3 p-4 ${active ? "border-primary" : ""}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-medium">
            #{index + 1} · {formatSeconds(row.start)} – {formatSeconds(row.end)}
            <span className="ml-2 text-xs text-muted-foreground">{(row.end - row.start).toFixed(1)} s</span>
          </p>
          <div className="flex gap-1">
            <Button size="sm" variant="secondary" onClick={onPlay}>
              <Play aria-hidden /> {t.admin.playSegment}
            </Button>
            <Button size="sm" variant="ghost" onClick={onRemove} aria-label={t.admin.removeSegment}>
              <Trash2 aria-hidden />
            </Button>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex items-end gap-2">
            <Field label={t.admin.start} className="flex-1">
              {(p) => <Input {...p} type="number" step="0.05" min={0} value={row.start} onChange={(e) => onChange({ start: Number(e.target.value) })} />}
            </Field>
            <Button size="sm" variant="outline" onClick={() => onChange({ start: now() })}>{t.admin.setStart}</Button>
          </div>
          <div className="flex items-end gap-2">
            <Field label={t.admin.end} className="flex-1">
              {(p) => <Input {...p} type="number" step="0.05" min={0} value={row.end} onChange={(e) => onChange({ end: Number(e.target.value) })} />}
            </Field>
            <Button size="sm" variant="outline" onClick={() => onChange({ end: now() })}>{t.admin.setEnd}</Button>
          </div>
        </div>
        {isNew ? (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-end gap-2">
              <Field label={t.admin.newWordGloss} className="flex-1" error={conflict?.onList ? conflict.text : null} hint={conflict && !conflict.onList ? conflict.text : undefined}>
                {(p) => (
                  <Input {...p} autoFocus={row.gloss === ""} value={row.gloss ?? ""} onChange={(e) => onChange({ gloss: e.target.value, wordId: null })} />
                )}
              </Field>
              <Button size="sm" variant="ghost" onClick={() => onChange({ gloss: null })}>
                {t.admin.existingWord}
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <Field label={t.admin.word}>
              {(p) => (
                <Select
                  {...p}
                  value={row.wordId ?? ""}
                  onChange={(e) =>
                    e.target.value === NEW
                      ? onChange({ gloss: "", wordId: null })
                      : onChange({ wordId: e.target.value ? Number(e.target.value) : null })
                  }
                >
                  <option value="">— {t.admin.skip} —</option>
                  <option value={NEW}>{t.admin.newWordOption}</option>
                  {words.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.gloss} {w.list_number ? `(${w.list_number})` : ""}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t.admin.mode}>
              {(p) => (
                <Select {...p} value={row.mode} disabled={row.wordId == null} onChange={(e) => onChange({ mode: e.target.value as Row["mode"] })}>
                  <option value="replace">{t.admin.replace}</option>
                  <option value="extra">{t.admin.extra}</option>
                </Select>
              )}
            </Field>
          </div>
        )}
        {word && (
          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted-foreground">{t.admin.oldClip}:</span>
            {old ? (
              <video src={old.url} poster={old.thumb_url ?? undefined} muted loop playsInline controls className="h-24 rounded-md bg-black" />
            ) : (
              <span>{t.admin.noOldClip}</span>
            )}
          </div>
        )}
      </Card>
    </li>
  );
}
