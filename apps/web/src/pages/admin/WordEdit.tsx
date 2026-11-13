import type { AdminReport, AdminWord, Clip, Schemas } from "@signa/api-client";
import { t } from "@signa/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Archive, ArchiveRestore, ArrowLeft, Scissors, Star, Trash2, Undo2, Upload } from "lucide-react";
import { useEffect, useState } from "react";

import { ErrorView, Field, Spinner } from "@/components/common";
import { GroupPicker, groupNames, useGroups } from "@/components/GroupPicker";
import { SignVideo } from "@/components/Video";
import { Button } from "@/components/ui/button";
import { Alert, Badge, Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { api, errorMessage, unwrap } from "@/lib/api";
import { isRunning, uploadFile, useJob, type Job } from "@/lib/upload";
import { formatDate, formatSeconds } from "@/lib/utils";
import { Trimmer } from "@/pages/admin/Trim";
import { OrphanReports, ReportCard, reportsQuery } from "@/pages/admin/Reports";
import { StatusBadge } from "@/pages/admin/Words";

type Group = Schemas["GroupOut"];

type WordEvent = Schemas["WordEventOut"];

export const adminWordQuery = (id: number) => ({
  queryKey: ["admin", "word", id],
  queryFn: () => unwrap(api.GET("/api/v1/admin/words/{word_id}", { params: { path: { word_id: id } } })),
});

const eventsQuery = (id: number) => ({
  queryKey: ["admin", "word", id, "events"],
  queryFn: () =>
    unwrap(api.GET("/api/v1/admin/words/{word_id}/events", { params: { path: { word_id: id } } })),
});

function useWordUpdated(id: number) {
  const qc = useQueryClient();
  return (word?: AdminWord) => {
    if (word) qc.setQueryData(adminWordQuery(id).queryKey, word);
    else void qc.invalidateQueries({ queryKey: adminWordQuery(id).queryKey });
    void qc.invalidateQueries({ queryKey: eventsQuery(id).queryKey });
    void qc.invalidateQueries({ queryKey: ["admin", "words"] });
    void qc.invalidateQueries({ queryKey: ["words"] });
    void qc.invalidateQueries({ queryKey: ["catalog"] });
  };
}

export function WordEditPage({ wordId }: { wordId: number }) {
  const word = useQuery(adminWordQuery(wordId));
  if (word.isPending) return <Spinner />;
  if (word.isError) return <ErrorView error={word.error} />;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link to="/admin">
            <ArrowLeft aria-hidden /> {t.admin.words}
          </Link>
        </Button>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{word.data.gloss}</h1>
          <StatusBadge status={word.data.status} />
          <DeleteWordButton word={word.data} />
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="flex flex-col gap-6">
          <WordForm key={word.data.updated_at} word={word.data} />
          <Clips word={word.data} />
        </div>
        <History wordId={wordId} />
      </div>
    </div>
  );
}

function DeleteWordButton({ word }: { word: AdminWord }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const remove = useMutation({
    mutationFn: () => unwrap(api.DELETE("/api/v1/admin/words/{word_id}", { params: { path: { word_id: word.id } } })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "words"] });
      void qc.invalidateQueries({ queryKey: ["words"] });
      void qc.invalidateQueries({ queryKey: ["catalog"] });
      void qc.invalidateQueries({ queryKey: ["difficult"] });
      void navigate({ to: "/admin" });
    },
  });
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        className="ml-auto text-destructive hover:bg-berry-soft hover:text-destructive"
        disabled={remove.isPending}
        onClick={() => window.confirm(t.admin.deleteWordConfirm(word.gloss)) && remove.mutate()}
      >
        <Trash2 aria-hidden /> {t.admin.deleteWord}
      </Button>
      {remove.isError && <Alert tone="destructive" className="w-full">{errorMessage(remove.error)}</Alert>}
    </>
  );
}

function WordForm({ word }: { word: AdminWord }) {
  const updated = useWordUpdated(word.id);
  const [form, setForm] = useState({
    gloss: word.gloss,
    year: String(word.year),
    lesson: word.lesson == null ? "" : String(word.lesson),
    list_number: word.list_number ?? "",
    position: String(word.position),
    notes: word.notes,
  });
  const [groupIds, setGroupIds] = useState<number[]>(word.group_ids);
  const groups = useGroups();
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = useMutation({
    mutationFn: (body: Schemas["WordUpdate"]) =>
      unwrap(api.PATCH("/api/v1/admin/words/{word_id}", { params: { path: { word_id: word.id } }, body })),
    onSuccess: updated,
  });
  const body = (): Schemas["WordUpdate"] => ({
    gloss: form.gloss,
    year: Number(form.year),
    lesson: form.lesson === "" ? null : Number(form.lesson),
    list_number: form.list_number || null,
    position: Number(form.position) || 0,
    notes: form.notes,
    group_ids: groupIds,
  });

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>{t.admin.edit}</CardTitle>
        {word.status === "draft" ? (
          <Button size="sm" variant="success" onClick={() => save.mutate({ ...body(), status: "published" })}>
            {t.admin.publish}
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={() => save.mutate({ status: "draft" })}>
            {t.admin.unpublish}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <form className="grid gap-4 sm:grid-cols-4" onSubmit={(e) => { e.preventDefault(); save.mutate(body()); }}>
          {save.isError && <Alert tone="destructive" className="sm:col-span-4">{errorMessage(save.error)}</Alert>}
          <Field label={t.admin.gloss} className="sm:col-span-4">
            {(p) => <Input {...p} required value={form.gloss} onChange={set("gloss")} />}
          </Field>
          <Field label={t.practice.year}>
            {(p) => <Input {...p} type="number" min={1} max={10} required value={form.year} onChange={set("year")} />}
          </Field>
          <Field label={t.practice.lesson}>
            {(p) => <Input {...p} type="number" min={0} value={form.lesson} onChange={set("lesson")} />}
          </Field>
          <Field label={t.practice.list}>
            {(p) => <Input {...p} placeholder="x.y" value={form.list_number} onChange={set("list_number")} />}
          </Field>
          <Field label={t.admin.position}>
            {(p) => <Input {...p} type="number" value={form.position} onChange={set("position")} />}
          </Field>
          <Field label={t.admin.notes} className="sm:col-span-4">
            {(p) => <Textarea {...p} value={form.notes} onChange={set("notes")} />}
          </Field>
          {(groups.length > 1 || groupIds.length > 0) && (
            <div className="sm:col-span-4">
              <GroupPicker value={groupIds} onChange={setGroupIds} />
            </div>
          )}
          <div className="flex items-center gap-3 sm:col-span-4">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? t.app.saving : t.app.save}
            </Button>
            {save.isSuccess && <span className="text-sm text-success">{t.app.saved}</span>}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function ClipCard({ clip, wordId, reports }: { clip: Clip; wordId: number; reports: AdminReport[] }) {
  const updated = useWordUpdated(wordId);
  const [trimming, setTrimming] = useState(false);
  const action = useMutation({
    mutationFn: (kind: "primary" | "archive" | "restore") => {
      const params = { params: { path: { clip_id: clip.id } } };
      if (kind === "primary") return unwrap(api.POST("/api/v1/admin/clips/{clip_id}/primary", params));
      if (kind === "archive") return unwrap(api.POST("/api/v1/admin/clips/{clip_id}/archive", params));
      return unwrap(api.POST("/api/v1/admin/clips/{clip_id}/restore", params));
    },
    onSuccess: updated,
  });
  return (
    <div className={clip.archived ? "opacity-60" : ""}>
      <SignVideo src={clip.url} poster={clip.thumb_url} autoPlay={false} controls loop={false} />
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        {clip.is_primary && <Badge tone="primary">{t.admin.primary}</Badge>}
        {clip.archived && <Badge>{t.admin.archived}</Badge>}
        <Badge>{t.admin.sources[clip.source]}</Badge>
        <span className="text-muted-foreground">{clip.duration.toFixed(1)} s · {formatDate(clip.updated_at)}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {!clip.is_primary && (
          <Button size="sm" variant="outline" onClick={() => action.mutate("primary")}>
            <Star aria-hidden /> {t.admin.makePrimary}
          </Button>
        )}
        {!clip.archived && (
          <Button size="sm" variant="outline" onClick={() => setTrimming(true)}>
            <Scissors aria-hidden /> {t.admin.trim}
          </Button>
        )}
        {clip.archived ? (
          <Button size="sm" variant="outline" onClick={() => action.mutate("restore")}>
            <ArchiveRestore aria-hidden /> {t.admin.restore}
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => action.mutate("archive")}>
            <Archive aria-hidden /> {t.admin.archive}
          </Button>
        )}
      </div>
      {reports.length > 0 && (
        <div className="mt-3 flex flex-col gap-2">
          <p className="text-sm font-medium">{t.report.openForWord(reports.length)}</p>
          {reports.map((r) => (
            <ReportCard key={r.id} report={r} />
          ))}
        </div>
      )}
      <Dialog open={trimming} onOpenChange={setTrimming} title={t.admin.trimTitle} wide>
        {trimming && (
          <Trimmer
            clip={clip}
            onDone={() => {
              setTrimming(false);
              updated();
            }}
          />
        )}
      </Dialog>
    </div>
  );
}

function Clips({ word }: { word: AdminWord }) {
  const updated = useWordUpdated(word.id);
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<"replace" | "extra">("replace");
  const [progress, setProgress] = useState(0);
  const [jobId, setJobId] = useState<number | null>(null);
  const job = useJob(jobId);
  const upload = useMutation({
    mutationFn: () =>
      uploadFile<Job>(`/api/v1/admin/words/${word.id}/clips`, file as File, { mode }, setProgress),
    onSuccess: (j) => {
      setJobId(j.id);
      setFile(null);
    },
  });
  const done = job.data?.status === "done";
  useEffect(() => {
    if (done) updated();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);

  const reports = useQuery(reportsQuery("open", word.id)).data ?? [];
  const hasLive = word.clips.some((c) => !c.archived);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.admin.clips}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <OrphanReports reports={reports.filter((r) => !r.clip || !word.clips.some((c) => c.id === r.clip?.id))} />
        {word.clips.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2">
            {word.clips.map((c) => (
              <ClipCard key={c.id} clip={c} wordId={word.id} reports={reports.filter((r) => r.clip?.id === c.id)} />
            ))}
          </div>
        )}
        <form
          className="flex flex-col gap-3 rounded-lg border border-dashed p-4"
          onSubmit={(e) => { e.preventDefault(); if (file) upload.mutate(); }}
        >
          <Field label={t.admin.videoFile}>
            {(p) => (
              <Input {...p} type="file" accept="video/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            )}
          </Field>
          {hasLive && (
            <fieldset className="flex flex-col gap-1 text-sm">
              <legend className="mb-1 font-medium">{t.admin.uploadMode}</legend>
              {(["replace", "extra"] as const).map((m) => (
                <label key={m} className="flex items-center gap-2">
                  <input type="radio" name="mode" checked={mode === m} onChange={() => setMode(m)} />
                  {m === "replace" ? t.admin.modeReplace : t.admin.modeExtra}
                </label>
              ))}
            </fieldset>
          )}
          {upload.isError && <Alert tone="destructive">{errorMessage(upload.error)}</Alert>}
          {upload.isPending && <Spinner label={`${t.admin.uploading} ${Math.round(progress * 100)}%`} />}
          {isRunning(job.data?.status) && <Spinner label={t.admin.processing} />}
          {job.data?.status === "failed" && <Alert tone="destructive">{t.admin.failed}: {job.data.error}</Alert>}
          {done && <Alert tone="success">{t.admin.processed}</Alert>}
          <Button type="submit" className="self-start" disabled={!file || upload.isPending}>
            <Upload aria-hidden /> {t.admin.uploadClip}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

const show = (v: unknown) => (v == null || v === "" ? "—" : String(v));

function describe(e: WordEvent, groups: Group[]): string {
  const label = t.admin.actions[e.action] ?? e.action;
  if (e.action === "update") {
    const fields = Object.keys(e.diff_json)
      .map((f) => {
        const [from, to] = e.diff_json[f] as [unknown, unknown];
        if (f === "group_ids") return `${t.admin.fields[f]}: ${groupNames(from, groups)} → ${groupNames(to, groups)}`;
        return `${t.admin.fields[f] ?? f}: ${show(from)} → ${show(to)}`;
      })
      .join("; ");
    return `${label} (${fields})`;
  }
  if (e.action === "clip_trim" && typeof e.diff_json.start === "number" && typeof e.diff_json.end === "number") {
    return `${label} (${formatSeconds(e.diff_json.start)} – ${formatSeconds(e.diff_json.end)})`;
  }
  if (e.action === "undo") {
    return `${label}: ${t.admin.actions[String(e.diff_json.action)] ?? ""}`;
  }
  return label;
}

const UNDOABLE = new Set([
  "update",
  "clip_add",
  "clip_replace",
  "clip_trim",
  "clip_archive",
  "clip_restore",
  "clip_primary",
]);

function History({ wordId }: { wordId: number }) {
  const events = useQuery(eventsQuery(wordId));
  const groups = useGroups();
  const updated = useWordUpdated(wordId);
  const undo = useMutation({
    mutationFn: (id: number) =>
      unwrap(api.POST("/api/v1/admin/events/{event_id}/undo", { params: { path: { event_id: id } } })),
    onSuccess: updated,
  });
  return (
    <Card className="h-fit">
      <CardHeader>
        <CardTitle>{t.admin.history}</CardTitle>
      </CardHeader>
      <CardContent>
        {undo.isError && <Alert tone="destructive" className="mb-3">{errorMessage(undo.error)}</Alert>}
        {events.isPending ? (
          <Spinner />
        ) : events.isError ? (
          <ErrorView error={events.error} />
        ) : (
          <ol className="flex flex-col gap-3">
            {events.data.map((e) => (
              <li key={e.id} className="border-l-2 pl-3 text-sm">
                <p className={e.undone ? "line-through opacity-60" : ""}>{describe(e, groups)}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDate(e.at, true)} · {t.admin.by(e.user?.username ?? t.admin.system)}
                  {e.undone && ` · ${t.admin.undone}`}
                </p>
                {!e.undone && UNDOABLE.has(e.action) && (
                  <Button size="sm" variant="ghost" className="mt-1 -ml-2 h-7" onClick={() => undo.mutate(e.id)} disabled={undo.isPending}>
                    <Undo2 aria-hidden /> {t.admin.undo}
                  </Button>
                )}
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
