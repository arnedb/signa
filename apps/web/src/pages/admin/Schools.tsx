import type { Schemas } from "@vgt/api-client";
import { t } from "@vgt/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Power } from "lucide-react";
import { useState } from "react";

import { CopyButton, ErrorView, Field, PageTitle, Spinner } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Alert, Badge, Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/input";
import { api, errorMessage, meQuery, unwrap } from "@/lib/api";

const schoolsQuery = {
  queryKey: ["admin", "organisations"],
  queryFn: () => unwrap(api.GET("/api/v1/admin/organisations")),
};

const languagesQuery = {
  queryKey: ["languages"],
  queryFn: () => unwrap(api.GET("/api/v1/languages")),
  staleTime: Infinity,
};

export function SchoolsPage() {
  const qc = useQueryClient();
  const schools = useQuery(schoolsQuery);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<Schemas["OrgCreateOut"] | null>(null);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: schoolsQuery.queryKey });
    // The school list in the switcher changes too.
    void qc.invalidateQueries({ queryKey: meQuery.queryKey });
  };
  const update = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Schemas["OrgUpdate"] }) =>
      unwrap(api.PATCH("/api/v1/admin/organisations/{org_id}", { params: { path: { org_id: id } }, body })),
    onSuccess: refresh,
  });

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus aria-hidden /> {t.admin.newSchool}
          </Button>
        }
      >
        {t.admin.schools}
      </PageTitle>
      <p className="text-sm text-muted-foreground">{t.admin.schoolsIntro}</p>
      {update.isError && <Alert tone="destructive">{errorMessage(update.error)}</Alert>}
      {created && (
        <Alert tone="success" className="flex flex-wrap items-center gap-3">
          <span>{t.admin.schoolCreated(created.org.name)}</span>
          {created.admin?.temporary_password && (
            <>
              <span>{t.admin.tempPassword(created.admin.username)}</span>
              <code className="font-mono text-base">{created.admin.temporary_password}</code>
              <CopyButton value={created.admin.temporary_password} />
            </>
          )}
        </Alert>
      )}
      {schools.isPending ? (
        <Spinner />
      ) : schools.isError ? (
        <ErrorView error={schools.error} />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">{t.admin.schoolName}</th>
                <th className="hidden px-3 py-2 font-medium sm:table-cell">{t.admin.language}</th>
                <th className="hidden px-3 py-2 font-medium sm:table-cell">{t.admin.users}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {schools.data.map((s) => (
                <tr key={s.id} className={s.active ? "border-b last:border-0" : "border-b opacity-60 last:border-0"}>
                  <td className="px-3 py-2">
                    <span className="font-medium">{s.name}</span>{" "}
                    <span className="text-xs text-muted-foreground">({s.slug})</span>
                    {!s.active && <Badge className="ml-2">{t.admin.inactive}</Badge>}
                    <span className="block text-xs text-muted-foreground sm:hidden">{s.language.name}</span>
                  </td>
                  <td className="hidden px-3 py-2 sm:table-cell">{s.language.name}</td>
                  <td className="hidden px-3 py-2 text-muted-foreground sm:table-cell">
                    {t.admin.memberCount(s.member_count)} · {t.admin.groupCount(s.group_count)} · {t.app.words(s.word_count)}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1 whitespace-nowrap">
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`${t.admin.rename}: ${s.name}`}
                        onClick={() => {
                          const name = window.prompt(t.admin.newName, s.name)?.trim();
                          if (name && name !== s.name) update.mutate({ id: s.id, body: { name } });
                        }}
                      >
                        <Pencil aria-hidden /> {t.admin.rename}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className={
                          s.active
                            ? "text-destructive hover:bg-berry-soft hover:text-destructive"
                            : "text-success hover:bg-mint-soft hover:text-success"
                        }
                        aria-label={`${s.active ? t.admin.deactivateSchool : t.admin.activateSchool}: ${s.name}`}
                        onClick={() =>
                          (!s.active || window.confirm(t.admin.deactivateSchoolConfirm(s.name))) &&
                          update.mutate({ id: s.id, body: { active: !s.active } })
                        }
                      >
                        <Power aria-hidden /> {s.active ? t.admin.deactivateSchool : t.admin.activateSchool}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <NewSchoolDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={(r) => {
          setCreated(r);
          refresh();
        }}
      />
    </div>
  );
}

function NewSchoolDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: (r: Schemas["OrgCreateOut"]) => void;
}) {
  const languages = useQuery(languagesQuery);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [language, setLanguage] = useState("vgt");
  const [admin, setAdmin] = useState("");
  const create = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST("/api/v1/admin/organisations", {
          body: { name, slug: slug || null, language_code: language, admin_username: admin || null },
        }),
      ),
    onSuccess: (r) => {
      onCreated(r);
      onOpenChange(false);
      setName("");
      setSlug("");
      setAdmin("");
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t.admin.newSchool}>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
        {create.isError && <Alert tone="destructive">{errorMessage(create.error)}</Alert>}
        <Field label={t.admin.schoolName}>
          {(p) => <Input {...p} required minLength={2} value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <Field label={t.admin.shortName} hint={t.admin.shortNameHint}>
          {(p) => (
            <Input {...p} pattern="[a-z0-9\-]{2,64}" autoCapitalize="none" value={slug} onChange={(e) => setSlug(e.target.value.trim())} />
          )}
        </Field>
        <Field label={t.admin.language}>
          {(p) => (
            <Select {...p} value={language} onChange={(e) => setLanguage(e.target.value)}>
              {(languages.data ?? [{ code: "vgt", name: "Vlaamse Gebarentaal" }]).map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t.admin.firstAdmin} hint={t.admin.firstAdminHint}>
          {(p) => <Input {...p} autoCapitalize="none" value={admin} onChange={(e) => setAdmin(e.target.value.trim())} />}
        </Field>
        <Button type="submit" disabled={create.isPending}>{t.admin.newSchool}</Button>
      </form>
    </Dialog>
  );
}
