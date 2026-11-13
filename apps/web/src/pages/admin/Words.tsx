import type { AdminWord, Schemas } from "@signa/api-client";
import { t } from "@signa/core";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowRightLeft, Check, Film, Plus, Search, Trash2, Undo2, X } from "lucide-react";
import { useDeferredValue, useEffect, useRef, useState } from "react";

import { ErrorView, Field, PageTitle, Spinner } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Alert, Badge } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/input";
import { api, catalogQuery, errorMessage, unwrap } from "@/lib/api";
import { useLessonField } from "@/lib/lesson";
import { formatDate } from "@/lib/utils";

export interface AdminWordsSearch {
  q?: string;
  year?: number;
  list?: string;
  status?: "draft" | "published";
  missing?: boolean;
}

export function validateAdminWordsSearch(s: Record<string, unknown>): AdminWordsSearch {
  return {
    q: typeof s.q === "string" && s.q ? s.q : undefined,
    year: s.year != null && s.year !== "" ? Number(s.year) : undefined,
    list: s.list != null && s.list !== "" ? String(s.list) : undefined,
    status: s.status === "draft" || s.status === "published" ? s.status : undefined,
    missing: s.missing === true || s.missing === "true" || undefined,
  };
}

export const adminWordsQuery = (f: AdminWordsSearch) => ({
  queryKey: ["admin", "words", f],
  queryFn: () =>
    unwrap(
      api.GET("/api/v1/admin/words", {
        params: {
          query: { q: f.q, year: f.year, list_number: f.list, status: f.status, missing_clip: f.missing },
        },
      }),
    ),
});

export function StatusBadge({ status }: { status: AdminWord["status"] }) {
  return <Badge tone={status === "published" ? "success" : "warning"}>{t.admin.statuses[status]}</Badge>;
}

export function AdminWordsPage({ search }: { search: AdminWordsSearch }) {
  const navigate = useNavigate();
  const [q, setQ] = useState(search.q ?? "");
  const deferredQ = useDeferredValue(q.trim() || undefined);
  const catalog = useQuery(catalogQuery);
  const words = useQuery({ ...adminWordsQuery({ ...search, q: deferredQ }), placeholderData: keepPreviousData });
  const [creating, setCreating] = useState(false);

  const set = (patch: Partial<AdminWordsSearch>) =>
    void navigate({ to: "/admin", search: { ...search, ...patch }, replace: true });

  // Bulk editing: a selection of word ids, acted on from a bar at the bottom of the screen.
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [moving, setMoving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const lastClicked = useRef<number | null>(null);
  const filterKey = JSON.stringify({ ...search, q: deferredQ });
  useEffect(() => {
    // A new filter shows other words; start over rather than act on words that are out of sight.
    setSelected(new Set());
    lastClicked.current = null;
  }, [filterKey]);

  const visible = words.data ?? [];
  const chosen = visible.filter((w) => selected.has(w.id));
  const allChosen = visible.length > 0 && chosen.length === visible.length;

  const toggle = (index: number, shift: boolean) => {
    const next = new Set(selected);
    const on = !selected.has(visible[index]!.id);
    // Shift-click sets the whole range since the last click to the same state.
    const from = shift && lastClicked.current != null ? Math.min(lastClicked.current, index) : index;
    const to = shift && lastClicked.current != null ? Math.max(lastClicked.current, index) : index;
    for (let i = from; i <= to; i++) {
      const id = visible[i]!.id;
      if (on) next.add(id);
      else next.delete(id);
    }
    lastClicked.current = index;
    setSelected(next);
  };

  const afterBulk = (text: string) => {
    setMessage(text);
    setSelected(new Set());
    setMoving(false);
    void qc.invalidateQueries({ queryKey: ["admin", "words"] });
    void qc.invalidateQueries({ queryKey: ["catalog"] });
    void qc.invalidateQueries({ queryKey: ["words"] });
    void qc.invalidateQueries({ queryKey: ["difficult"] });
  };
  const bulkDelete = useMutation({
    mutationFn: (ids: number[]) => unwrap(api.POST("/api/v1/admin/words/bulk-delete", { body: { ids } })).then(() => ids.length),
    onSuccess: (n) => afterBulk(t.admin.deletedWords(n)),
  });
  const bulk = useMutation({
    mutationFn: (changes: Schemas["WordBulkChanges"]) =>
      unwrap(api.POST("/api/v1/admin/words/bulk", { body: { ids: chosen.map((w) => w.id), changes } })),
    onSuccess: (updated) => afterBulk(t.admin.bulkDone(updated.length)),
  });

  return (
    <div>
      <PageTitle
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus aria-hidden /> {t.admin.newWord}
          </Button>
        }
      >
        {t.admin.words}
      </PageTitle>
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute top-3 left-3 size-4 text-muted-foreground" aria-hidden />
          <Input
            type="search"
            aria-label={t.app.search}
            placeholder={t.app.search}
            className="pl-9"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              set({ q: e.target.value || undefined });
            }}
          />
        </div>
        <Select
          aria-label={t.practice.year}
          className="w-36"
          value={search.year ?? ""}
          onChange={(e) => set({ year: e.target.value ? Number(e.target.value) : undefined, list: undefined })}
        >
          <option value="">{t.admin.allYears}</option>
          {[1, 2, 3, 4, 5].map((y) => (
            <option key={y} value={y}>
              {t.app.year(y)}
            </option>
          ))}
        </Select>
        {search.year && (
          <Select
            aria-label={t.practice.list}
            className="w-36"
            value={search.list ?? ""}
            onChange={(e) => set({ list: e.target.value || undefined })}
          >
            <option value="">{t.app.all}</option>
            {catalog.data?.years
              .find((y) => y.year === search.year)
              ?.lists.map((l) => (
                <option key={l.list_number ?? "-"} value={l.list_number ?? ""}>
                  {t.app.list(l.list_number ?? "—")}
                </option>
              ))}
          </Select>
        )}
        <Select
          aria-label={t.admin.status}
          className="w-40"
          value={search.status ?? ""}
          onChange={(e) => set({ status: (e.target.value || undefined) as AdminWordsSearch["status"] })}
        >
          <option value="">{t.admin.allStatuses}</option>
          <option value="published">{t.admin.statuses.published}</option>
          <option value="draft">{t.admin.statuses.draft}</option>
        </Select>
        <label className="flex items-center gap-2 px-2 text-sm">
          <input type="checkbox" checked={!!search.missing} onChange={(e) => set({ missing: e.target.checked || undefined })} />
          {t.admin.missingClip}
        </label>
      </div>

      {message && (
        <Alert tone="success" className="mb-4 flex items-center justify-between gap-3">
          {message}
          <button
            type="button"
            className="cursor-pointer rounded-full p-1 hover:bg-mint"
            aria-label={t.app.close}
            onClick={() => setMessage(null)}
          >
            <X className="size-4" aria-hidden />
          </button>
        </Alert>
      )}
      {bulk.isError && <Alert tone="destructive" className="mb-4">{errorMessage(bulk.error)}</Alert>}
      {bulkDelete.isError && <Alert tone="destructive" className="mb-4">{errorMessage(bulkDelete.error)}</Alert>}

      {words.isPending ? (
        <Spinner />
      ) : words.isError ? (
        <ErrorView error={words.error} onRetry={() => void words.refetch()} />
      ) : words.data.length === 0 ? (
        <p className="text-muted-foreground">{t.admin.noResults}</p>
      ) : (
        <div className="sticker overflow-x-auto rounded-lg bg-card">
          <table className="w-full text-sm">
            <caption className="sr-only">{t.admin.words}</caption>
            <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="w-10 py-2 pl-3">
                  <SelectAll
                    all={allChosen}
                    some={chosen.length > 0}
                    onChange={(on) => setSelected(on ? new Set(visible.map((w) => w.id)) : new Set())}
                  />
                </th>
                <th className="px-3 py-2 font-medium">{t.admin.gloss}</th>
                <th className="px-3 py-2 font-medium">{t.practice.year}</th>
                <th className="px-3 py-2 font-medium">{t.practice.lesson}</th>
                <th className="px-3 py-2 font-medium">{t.practice.list}</th>
                <th className="px-3 py-2 font-medium">{t.admin.clips}</th>
                <th className="px-3 py-2 font-medium">{t.admin.status}</th>
                <th className="hidden px-3 py-2 font-medium md:table-cell">{t.admin.history}</th>
              </tr>
            </thead>
            <tbody>
              {words.data.map((w, index) => {
                const live = w.clips.filter((c) => !c.archived);
                const isSelected = selected.has(w.id);
                return (
                  <tr
                    key={w.id}
                    data-selected={isSelected || undefined}
                    className="relative cursor-pointer border-b transition-colors last:border-0 data-selected:bg-sky-soft hover:bg-sun/20 has-[a:focus-visible]:bg-sun/20 has-[a:focus-visible]:outline-3 has-[a:focus-visible]:-outline-offset-3 has-[a:focus-visible]:outline-ring"
                  >
                    {/* Above the row-wide link, so ticking the box does not open the word. */}
                    <td className="relative z-10 w-10 py-2 pl-3">
                      <input
                        type="checkbox"
                        className="size-4 cursor-pointer accent-primary"
                        aria-label={t.admin.selectWord(w.gloss)}
                        checked={isSelected}
                        onChange={() => {}}
                        onClick={(e) => toggle(index, e.shiftKey)}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        to="/admin/words/$wordId"
                        params={{ wordId: String(w.id) }}
                        // Stretches over the whole row, so clicking anywhere on it opens the word.
                        className="font-medium text-primary after:absolute after:inset-0 after:content-[''] hover:underline focus-visible:outline-none"
                      >
                        {w.gloss}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{w.year}</td>
                    <td className="px-3 py-2">{w.lesson ?? "—"}</td>
                    <td className="px-3 py-2">{w.list_number ?? "—"}</td>
                    <td className="px-3 py-2">
                      {live.length === 0 ? (
                        <Badge tone="destructive">{t.admin.missingClip}</Badge>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-muted-foreground">
                          <Film className="size-3.5" aria-hidden />
                          {live.length}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={w.status} />
                    </td>
                    <td className="hidden px-3 py-2 text-muted-foreground md:table-cell">{formatDate(w.updated_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {chosen.length > 0 && (
        <>
          {/* Room below the table, so the bar never hides the last rows. */}
          <div className="h-24" aria-hidden />
          <div
            role="region"
            aria-label={t.admin.selectedCount(chosen.length)}
            className="sticker fixed inset-x-4 bottom-4 z-30 mx-auto flex max-w-5xl animate-pop-in flex-wrap items-center gap-2 rounded-2xl bg-card px-4 py-3"
          >
            <p className="mr-auto text-sm font-bold" aria-live="polite">
              {t.admin.selectedCount(chosen.length)}
              <span className="ml-2 hidden font-normal text-muted-foreground xl:inline">{t.admin.bulkHint}</span>
            </p>
            <Button size="sm" variant="success" disabled={bulk.isPending} onClick={() => bulk.mutate({ status: "published" })}>
              <Check aria-hidden /> {t.admin.publish}
            </Button>
            <Button size="sm" variant="outline" disabled={bulk.isPending} onClick={() => bulk.mutate({ status: "draft" })}>
              <Undo2 aria-hidden /> {t.admin.unpublish}
            </Button>
            <Button size="sm" variant="outline" disabled={bulk.isPending} onClick={() => setMoving(true)}>
              <ArrowRightLeft aria-hidden /> {t.admin.moveWords}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive hover:bg-berry-soft hover:text-destructive"
              disabled={bulkDelete.isPending}
              onClick={() =>
                window.confirm(t.admin.deleteWordsConfirm(chosen.length)) && bulkDelete.mutate(chosen.map((w) => w.id))
              }
            >
              <Trash2 aria-hidden /> {t.admin.deleteWords}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              <X aria-hidden /> {t.admin.clearSelection}
            </Button>
          </div>
        </>
      )}
      <MoveWordsDialog
        open={moving}
        onOpenChange={setMoving}
        count={chosen.length}
        pending={bulk.isPending}
        onMove={(changes) => bulk.mutate(changes)}
      />
      <NewWordDialog open={creating} onOpenChange={setCreating} defaults={search} />
    </div>
  );
}

/** The header checkbox: ticks every visible word, or clears them; shows a dash when some are ticked. */
function SelectAll({ all, some, onChange }: { all: boolean; some: boolean; onChange: (on: boolean) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = some && !all;
  }, [some, all]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className="size-4 cursor-pointer accent-primary"
      aria-label={t.admin.selectAll}
      checked={all}
      onChange={(e) => onChange(e.target.checked)}
    />
  );
}

function MoveWordsDialog({
  open,
  onOpenChange,
  count,
  pending,
  onMove,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  count: number;
  pending: boolean;
  onMove: (changes: Schemas["WordBulkChanges"]) => void;
}) {
  const [year, setYear] = useState("");
  const [list, setList] = useState("");
  const lesson = useLessonField(list);
  const { reset } = lesson;
  useEffect(() => {
    if (open) {
      setYear("");
      setList("");
      reset();
    }
  }, [open, reset]);
  const listNumber = list.trim();
  const changes: Schemas["WordBulkChanges"] = {
    ...(year ? { year: Number(year) } : {}),
    ...(lesson.number != null ? { lesson: lesson.number } : {}),
    ...(listNumber ? { list_number: listNumber } : {}),
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t.admin.moveWordsTitle(count)} description={t.admin.moveWordsIntro}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          onMove(changes);
        }}
      >
        <Field label={t.practice.year}>
          {(p) => (
            <Select {...p} value={year} onChange={(e) => setYear(e.target.value)}>
              <option value="">{t.admin.keepAsIs}</option>
              {[1, 2, 3, 4, 5].map((y) => (
                <option key={y} value={y}>
                  {t.app.year(y)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t.practice.lesson}>
            {(p) => (
              <Input
                {...p}
                type="number"
                min={0}
                max={100}
                placeholder={t.admin.keepAsIs}
                value={lesson.value}
                onChange={(e) => lesson.set(e.target.value)}
              />
            )}
          </Field>
          <Field label={t.practice.list}>
            {(p) => <Input {...p} placeholder="x.y" value={list} onChange={(e) => setList(e.target.value)} />}
          </Field>
        </div>
        <Button type="submit" disabled={pending || Object.keys(changes).length === 0}>
          <ArrowRightLeft aria-hidden /> {t.admin.moveWords}
        </Button>
      </form>
    </Dialog>
  );
}

function NewWordDialog({
  open,
  onOpenChange,
  defaults,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  defaults: AdminWordsSearch;
}) {
  const navigate = useNavigate();
  const [gloss, setGloss] = useState("");
  const [year, setYear] = useState(String(defaults.year ?? 1));
  const [list, setList] = useState(defaults.list ?? "");
  const lesson = useLessonField(list);
  const create = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST("/api/v1/admin/words", {
          body: {
            gloss,
            year: Number(year),
            lesson: lesson.number ?? 0,
            list_number: list.trim() || null,
          },
        }),
      ),
    onSuccess: (w) => {
      onOpenChange(false);
      setGloss("");
      void navigate({ to: "/admin/words/$wordId", params: { wordId: String(w.id) } });
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t.admin.newWord}>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
        {create.isError && <Alert tone="destructive">{errorMessage(create.error)}</Alert>}
        <Field label={t.admin.gloss}>
          {(p) => <Input {...p} required autoFocus value={gloss} onChange={(e) => setGloss(e.target.value)} />}
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label={t.practice.year}>
            {(p) => <Input {...p} type="number" min={1} max={10} required value={year} onChange={(e) => setYear(e.target.value)} />}
          </Field>
          <Field label={t.practice.lesson}>
            {(p) => (
              <Input {...p} type="number" min={0} max={100} required value={lesson.value} onChange={(e) => lesson.set(e.target.value)} />
            )}
          </Field>
          <Field label={t.practice.list}>
            {(p) => <Input {...p} placeholder="x.y" value={list} onChange={(e) => setList(e.target.value)} />}
          </Field>
        </div>
        <Button type="submit" disabled={create.isPending}>{t.admin.newWord}</Button>
      </form>
    </Dialog>
  );
}
