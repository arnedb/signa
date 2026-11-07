import type { Schemas } from "@vgt/api-client";
import { t } from "@vgt/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, KeyRound, Plus, RefreshCw } from "lucide-react";
import { useState } from "react";

import { CopyButton, ErrorView, Field, PageTitle, Spinner } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Alert, Badge, Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/input";
import { api, errorMessage, unwrap } from "@/lib/api";
import { formatDate } from "@/lib/utils";

type Group = Schemas["GroupOut"];

export const groupsQuery = {
  queryKey: ["admin", "groups"],
  queryFn: () => unwrap(api.GET("/api/v1/admin/groups")),
};

const membersQuery = (id: number) => ({
  queryKey: ["admin", "groups", id, "members"],
  queryFn: () =>
    unwrap(api.GET("/api/v1/admin/groups/{group_id}/members", { params: { path: { group_id: id } } })),
});

export function inviteUrl(code: string): string {
  return `${window.location.origin}/join/${code}`;
}

export function GroupsPage() {
  const groups = useQuery(groupsQuery);
  const [creating, setCreating] = useState(false);
  return (
    <div>
      <PageTitle
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus aria-hidden /> {t.admin.newGroup}
          </Button>
        }
      >
        {t.admin.groups}
      </PageTitle>
      {groups.isPending ? (
        <Spinner />
      ) : groups.isError ? (
        <ErrorView error={groups.error} />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {groups.data.map((g) => (
            <li key={g.id}>
              <Card className={g.active ? "" : "opacity-60"}>
                <CardHeader className="flex-row items-start justify-between">
                  <div>
                    <CardTitle>
                      <Link to="/admin/groups/$groupId" params={{ groupId: String(g.id) }} className="hover:text-primary hover:underline">
                        {g.label}
                      </Link>
                    </CardTitle>
                    <p className="text-sm text-muted-foreground">
                      {t.admin.students(g.student_count)} · {t.admin.teachers(g.teacher_count)}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    {g.teaching && <Badge tone="primary">{t.profile.roles.teacher}</Badge>}
                    {!g.active && <Badge>{t.admin.inactive}</Badge>}
                  </div>
                </CardHeader>
                {g.active && (
                  <CardContent className="flex flex-wrap items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-xs">{inviteUrl(g.invite_code)}</code>
                    <CopyButton value={inviteUrl(g.invite_code)} />
                  </CardContent>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
      <NewGroupDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}

function NewGroupDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [year, setYear] = useState("1");
  const [weekday, setWeekday] = useState("dinsdag");
  const [label, setLabel] = useState("");
  const create = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST("/api/v1/admin/groups", {
          body: { year: Number(year), weekday: weekday as Schemas["GroupCreate"]["weekday"], label: label || null },
        }),
      ),
    onSuccess: () => {
      onOpenChange(false);
      setLabel("");
      void qc.invalidateQueries({ queryKey: groupsQuery.queryKey });
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t.admin.newGroup}>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
        {create.isError && <Alert tone="destructive">{errorMessage(create.error)}</Alert>}
        <div className="grid grid-cols-2 gap-3">
          <Field label={t.practice.year}>
            {(p) => <Input {...p} type="number" min={1} max={10} required value={year} onChange={(e) => setYear(e.target.value)} />}
          </Field>
          <Field label={t.admin.weekday}>
            {(p) => (
              <Select {...p} value={weekday} onChange={(e) => setWeekday(e.target.value)}>
                {t.admin.weekdays.map((d) => <option key={d} value={d}>{d}</option>)}
              </Select>
            )}
          </Field>
        </div>
        <Field label={t.admin.label} hint={t.admin.labelHint}>
          {(p) => <Input {...p} value={label} onChange={(e) => setLabel(e.target.value)} />}
        </Field>
        <Button type="submit" disabled={create.isPending}>{t.admin.newGroup}</Button>
      </form>
    </Dialog>
  );
}

export function GroupPage({ groupId }: { groupId: number }) {
  const qc = useQueryClient();
  const groups = useQuery(groupsQuery);
  const members = useQuery(membersQuery(groupId));
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [target, setTarget] = useState<string>("");
  const [message, setMessage] = useState<string | null>(null);
  const [temp, setTemp] = useState<Schemas["TempPasswordOut"] | null>(null);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["admin", "groups"] });
    void qc.invalidateQueries({ queryKey: ["admin", "group-events"] });
  };
  const params = { params: { path: { group_id: groupId } } };
  const patch = useMutation({
    mutationFn: (body: Schemas["GroupUpdate"]) => unwrap(api.PATCH("/api/v1/admin/groups/{group_id}", { ...params, body })),
    onSuccess: refresh,
  });
  const rotate = useMutation({
    mutationFn: () => unwrap(api.POST("/api/v1/admin/groups/{group_id}/invite", params)),
    onSuccess: refresh,
  });
  const teaching = useMutation({
    mutationFn: (on: boolean) =>
      unwrap(on ? api.PUT("/api/v1/admin/groups/{group_id}/teaching", params) : api.DELETE("/api/v1/admin/groups/{group_id}/teaching", params)),
    onSuccess: refresh,
  });
  const move = useMutation({
    mutationFn: async (all: boolean) => {
      const to_group_id = Number(target);
      return all
        ? unwrap(api.POST("/api/v1/admin/groups/{group_id}/move-all", { ...params, body: { to_group_id } }))
        : unwrap(api.POST("/api/v1/admin/groups/move-students", { body: { user_ids: [...selected], to_group_id } }));
    },
    onSuccess: (r) => {
      setSelected(new Set());
      setMessage(t.admin.moved(r.moved));
      refresh();
    },
  });
  const reset = useMutation({
    mutationFn: (userId: number) =>
      unwrap(api.POST("/api/v1/admin/users/{user_id}/reset-password", { params: { path: { user_id: userId } } })),
    onSuccess: setTemp,
  });

  const group = groups.data?.find((g) => g.id === groupId);
  if (groups.isPending || members.isPending) return <Spinner />;
  if (groups.isError || members.isError || !group) return <ErrorView error={groups.error ?? members.error ?? t.app.notFound} />;
  const others = groups.data.filter((g) => g.id !== groupId && g.active);
  const students = members.data.filter((m) => m.role === "student");
  const targetLabel = others.find((g) => String(g.id) === target)?.label ?? "";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link to="/admin/groups"><ArrowLeft aria-hidden /> {t.admin.groups}</Link>
        </Button>
        <PageTitle
          actions={
            <>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={group.teaching} onChange={(e) => teaching.mutate(e.target.checked)} />
                {t.admin.teaching}
              </label>
              <Button size="sm" variant="outline" onClick={() => patch.mutate({ active: !group.active })}>
                {group.active ? t.admin.deactivate : t.admin.activate}
              </Button>
            </>
          }
        >
          {group.label}
        </PageTitle>
      </div>

      <GroupForm group={group} onSave={(body) => patch.mutate(body)} />

      {group.active && (
        <Card>
          <CardHeader><CardTitle>{t.admin.inviteLink}</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-sm">{inviteUrl(group.invite_code)}</code>
            <CopyButton value={inviteUrl(group.invite_code)} />
            <Button size="sm" variant="outline" onClick={() => window.confirm(t.admin.rotateConfirm) && rotate.mutate()}>
              <RefreshCw aria-hidden /> {t.admin.rotateInvite}
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t.admin.members}</CardTitle>
          <p className="text-xs text-muted-foreground">{t.admin.noResultsView}</p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {message && <Alert tone="success">{message}</Alert>}
          {move.isError && <Alert tone="destructive">{errorMessage(move.error)}</Alert>}
          {temp && (
            <Alert tone="primary" className="flex flex-wrap items-center gap-3">
              <span>{t.admin.tempPassword(temp.username)}</span>
              <code className="font-mono text-base">{temp.temporary_password}</code>
              <CopyButton value={temp.temporary_password} />
            </Alert>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs text-muted-foreground">
                <tr>
                  <th className="w-8 py-2"><span className="sr-only">Selecteer</span></th>
                  <th className="py-2 font-medium">{t.auth.username}</th>
                  <th className="py-2 font-medium">{t.profile.role}</th>
                  <th className="hidden py-2 font-medium sm:table-cell">{t.admin.lastActive}</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {members.data.map((m) => (
                  <tr key={m.id} className="border-b last:border-0">
                    <td className="py-2">
                      {m.role === "student" && (
                        <input
                          type="checkbox"
                          aria-label={m.username}
                          checked={selected.has(m.id)}
                          onChange={(e) => {
                            const next = new Set(selected);
                            if (e.target.checked) next.add(m.id); else next.delete(m.id);
                            setSelected(next);
                          }}
                        />
                      )}
                    </td>
                    <td className="py-2 font-medium">{m.username}</td>
                    <td className="py-2">{t.profile.roles[m.role]}</td>
                    <td className="hidden py-2 text-muted-foreground sm:table-cell">{m.last_active_at ? formatDate(m.last_active_at, true) : t.admin.never}</td>
                    <td className="py-2 text-right">
                      {m.role === "student" && (
                        <Button size="sm" variant="ghost" onClick={() => reset.mutate(m.id)}>
                          <KeyRound aria-hidden /> <span className="hidden sm:inline">{t.admin.resetPassword}</span>
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {students.length > 0 && others.length > 0 && (
            <div className="flex flex-wrap items-end gap-2 border-t pt-4">
              <Field label={t.admin.chooseGroup}>
                {(p) => (
                  <Select {...p} value={target} onChange={(e) => setTarget(e.target.value)} className="w-56">
                    <option value="">—</option>
                    {others.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
                  </Select>
                )}
              </Field>
              <Button variant="outline" disabled={!target || selected.size === 0 || move.isPending} onClick={() => move.mutate(false)}>
                {t.admin.moveSelected} ({selected.size})
              </Button>
              <Button
                variant="outline"
                disabled={!target || move.isPending}
                onClick={() => window.confirm(t.admin.moveAllConfirm(students.length, group.label, targetLabel)) && move.mutate(true)}
              >
                {t.admin.moveAll}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function GroupForm({ group, onSave }: { group: Group; onSave: (body: Schemas["GroupUpdate"]) => void }) {
  const [year, setYear] = useState(String(group.year));
  const [weekday, setWeekday] = useState(group.weekday);
  const [label, setLabel] = useState(group.label);
  return (
    <Card>
      <CardContent className="pt-5">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            onSave({ year: Number(year), weekday: weekday as Schemas["GroupCreate"]["weekday"], label });
          }}
        >
          <Field label={t.practice.year}>
            {(p) => <Input {...p} type="number" min={1} max={10} className="w-24" value={year} onChange={(e) => setYear(e.target.value)} />}
          </Field>
          <Field label={t.admin.weekday}>
            {(p) => (
              <Select {...p} value={weekday} onChange={(e) => setWeekday(e.target.value)}>
                {t.admin.weekdays.map((d) => <option key={d} value={d}>{d}</option>)}
              </Select>
            )}
          </Field>
          <Field label={t.admin.label} className="min-w-48 flex-1">
            {(p) => <Input {...p} value={label} onChange={(e) => setLabel(e.target.value)} />}
          </Field>
          <Button type="submit">{t.app.save}</Button>
        </form>
      </CardContent>
    </Card>
  );
}
