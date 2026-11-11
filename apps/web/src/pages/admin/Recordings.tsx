import type { AdminWord, Schemas } from "@vgt/api-client";
import { t } from "@vgt/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Play, Plus, Scissors, Trash2, Upload, Wand2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { ErrorView, Field, PageTitle, Spinner } from "@/components/common";
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
  mode: "replace" | "extra";
}

let rowKey = 0;
const toRows = (segments: Segment[]): Row[] =>
  segments.map((s) => ({ ...s, key: ++rowKey, wordId: null, mode: "replace" }));

export function RecordingPage({ recordingId }: { recordingId: number }) {
  const rec = useQuery(recordingQuery(recordingId));
  if (rec.isPending) return <Spinner />;
  if (rec.isError) return <ErrorView error={rec.error} />;
  const r = rec.data;
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
      {r.status === "done" && r.source_url && <Editor recording={r} />}
    </div>
  );
}

function Editor({ recording }: { recording: Recording }) {
  const qc = useQueryClient();
  const video = useRef<HTMLVideoElement>(null);
  const stopAt = useRef<number | null>(null);
  const [rows, setRows] = useState<Row[]>(() => toRows(recording.segments));
  const [year, setYear] = useState<number>(1);
  const [list, setList] = useState<string>("");
  const catalog = useQuery(catalogQuery);
  const words = useQuery(adminWordsQuery({ year }));
  const wordsById = useMemo(() => new Map((words.data ?? []).map((w) => [w.id, w])), [words.data]);

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
            items: rows
              .filter((r) => r.wordId != null)
              .map((r) => ({ start: r.start, end: r.end, word_id: r.wordId as number, mode: r.mode })),
          },
        }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin"] });
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
  const splitAt = () => {
    const at = now();
    setRows((rs) => {
      const i = rs.findIndex((r) => r.start < at && at < r.end);
      if (i < 0) {
        const added: Row = { start: at, end: Math.min(at + 1.5, recording.duration ?? at + 1.5), key: ++rowKey, wordId: null, mode: "replace" };
        return [...rs, added].sort((a, b) => a.start - b.start);
      }
      const r = rs[i] as Row;
      return [...rs.slice(0, i), { ...r, end: at }, { ...r, key: ++rowKey, start: at, wordId: null }, ...rs.slice(i + 1)];
    });
  };
  const suggest = () => {
    const candidates = (words.data ?? []).filter((w) => !list || w.list_number === list);
    setRows((rs) => rs.map((r, i) => ({ ...r, wordId: candidates[i]?.id ?? null })));
  };

  const yearData = catalog.data?.years.find((y) => y.year === year);
  const matched = rows.filter((r) => r.wordId != null).length;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,26rem)_1fr]">
      <div className="flex flex-col gap-3 xl:sticky xl:top-32 xl:self-start">
        <video
          ref={video}
          src={recording.source_url ?? undefined}
          controls
          muted
          playsInline
          preload="auto"
          className="aspect-[4/3] w-full rounded-lg bg-black"
        />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={splitAt}>
            <Scissors aria-hidden /> {t.admin.splitHere}
          </Button>
          <Button size="sm" variant="outline" onClick={() => saveCuts.mutate()} disabled={saveCuts.isPending}>
            {t.admin.saveCuts}
          </Button>
        </div>
        {saveCuts.isSuccess && <p className="text-sm text-success">{t.app.saved}</p>}
        {saveCuts.isError && <Alert tone="destructive">{errorMessage(saveCuts.error)}</Alert>}
      </div>

      <div className="flex flex-col gap-4">
        <Card>
          <CardContent className="flex flex-wrap items-end gap-3 pt-5">
            <Field label={t.practice.year}>
              {(p) => (
                <Select {...p} value={year} onChange={(e) => { setYear(Number(e.target.value)); setList(""); }}>
                  {(catalog.data?.years.length ? catalog.data.years.map((y) => y.year) : [1, 2, 3]).map((y) => (
                    <option key={y} value={y}>{t.app.year(y)}</option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t.practice.list}>
              {(p) => (
                <Select {...p} value={list} onChange={(e) => setList(e.target.value)}>
                  <option value="">{t.app.all}</option>
                  {yearData?.lists.map((l) => (
                    <option key={l.list_number ?? ""} value={l.list_number ?? ""}>{t.app.list(l.list_number ?? "—")}</option>
                  ))}
                </Select>
              )}
            </Field>
            <Button variant="secondary" onClick={suggest} disabled={!words.data}>
              <Wand2 aria-hidden /> {t.admin.suggest}
            </Button>
          </CardContent>
        </Card>

        <ol className="flex flex-col gap-3">
          {rows.map((row, i) => (
            <SegmentRow
              key={row.key}
              index={i}
              row={row}
              words={words.data ?? []}
              word={row.wordId != null ? wordsById.get(row.wordId) : undefined}
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
        <Button size="lg" className="self-start" disabled={matched === 0 || apply.isPending} onClick={() => apply.mutate()}>
          {t.admin.apply(matched)}
        </Button>
      </div>
    </div>
  );
}

function SegmentRow({
  index,
  row,
  words,
  word,
  onChange,
  onRemove,
  onPlay,
  now,
}: {
  index: number;
  row: Row;
  words: AdminWord[];
  word: AdminWord | undefined;
  onChange: (patch: Partial<Row>) => void;
  onRemove: () => void;
  onPlay: () => void;
  now: () => number;
}) {
  const old = word?.clips.find((c) => c.is_primary && !c.archived);
  return (
    <li>
      <Card className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-medium">
            #{index + 1} · {formatSeconds(row.start)} – {formatSeconds(row.end)}
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
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <Field label={t.admin.word}>
            {(p) => (
              <Select {...p} value={row.wordId ?? ""} onChange={(e) => onChange({ wordId: e.target.value ? Number(e.target.value) : null })}>
                <option value="">— {t.admin.skip} —</option>
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
              <Select {...p} value={row.mode} onChange={(e) => onChange({ mode: e.target.value as Row["mode"] })}>
                <option value="replace">{t.admin.replace}</option>
                <option value="extra">{t.admin.extra}</option>
              </Select>
            )}
          </Field>
        </div>
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
