import type { AdminWord } from "@vgt/api-client";
import { t } from "@vgt/core";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Film, Plus, Search } from "lucide-react";
import { useDeferredValue, useState } from "react";

import { ErrorView, Field, PageTitle, Spinner } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Alert, Badge } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/input";
import { api, catalogQuery, errorMessage, unwrap } from "@/lib/api";
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

      {words.isPending ? (
        <Spinner />
      ) : words.isError ? (
        <ErrorView error={words.error} onRetry={() => void words.refetch()} />
      ) : words.data.length === 0 ? (
        <p className="text-muted-foreground">{t.admin.noResults}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm">
            <caption className="sr-only">{t.admin.words}</caption>
            <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
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
              {words.data.map((w) => {
                const live = w.clips.filter((c) => !c.archived);
                return (
                  <tr key={w.id} className="border-b last:border-0 hover:bg-muted/40">
                    <td className="px-3 py-2">
                      <Link
                        to="/admin/words/$wordId"
                        params={{ wordId: String(w.id) }}
                        className="font-medium text-primary hover:underline"
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
      <NewWordDialog open={creating} onOpenChange={setCreating} defaults={search} />
    </div>
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
  const create = useMutation({
    mutationFn: () => {
      const lesson = Number(list.split(".")[0]);
      return unwrap(
        api.POST("/api/v1/admin/words", {
          body: {
            gloss,
            year: Number(year),
            list_number: list || null,
            lesson: list && !Number.isNaN(lesson) ? lesson : null,
          },
        }),
      );
    },
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
        <div className="grid grid-cols-2 gap-3">
          <Field label={t.practice.year}>
            {(p) => <Input {...p} type="number" min={1} max={10} required value={year} onChange={(e) => setYear(e.target.value)} />}
          </Field>
          <Field label={t.practice.list}>
            {(p) => <Input {...p} placeholder="1.1" value={list} onChange={(e) => setList(e.target.value)} />}
          </Field>
        </div>
        <Button type="submit" disabled={create.isPending}>{t.admin.newWord}</Button>
      </form>
    </Dialog>
  );
}
