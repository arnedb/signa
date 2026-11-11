import type { Schemas } from "@vgt/api-client";
import { t } from "@vgt/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Plus, UserMinus } from "lucide-react";
import { useState } from "react";

import { CopyButton, ErrorView, Field, PageTitle, Spinner } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/input";
import { api, errorMessage, unwrap } from "@/lib/api";
import { formatDate } from "@/lib/utils";

type Role = Schemas["UserOut"]["role"];

export function MovesPage() {
  const events = useQuery({
    queryKey: ["admin", "group-events"],
    queryFn: () => unwrap(api.GET("/api/v1/admin/group-events")),
  });
  return (
    <div>
      <PageTitle>{t.admin.moves}</PageTitle>
      {events.isPending ? (
        <Spinner />
      ) : events.isError ? (
        <ErrorView error={events.error} />
      ) : events.data.length === 0 ? (
        <p className="text-muted-foreground">—</p>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">{t.admin.date}</th>
                <th className="px-3 py-2 font-medium">{t.auth.username}</th>
                <th className="px-3 py-2 font-medium">{t.admin.from}</th>
                <th className="px-3 py-2 font-medium">{t.admin.to}</th>
                <th className="px-3 py-2 font-medium">{t.admin.doneBy}</th>
              </tr>
            </thead>
            <tbody>
              {events.data.map((e) => (
                <tr key={e.id} className="border-b last:border-0">
                  <td className="px-3 py-2 text-muted-foreground">{formatDate(e.at, true)}</td>
                  <td className="px-3 py-2 font-medium">{e.username ?? "—"}</td>
                  <td className="px-3 py-2">{e.from_group ?? "—"}</td>
                  <td className="px-3 py-2">{e.to_group ?? "—"}</td>
                  <td className="px-3 py-2">{e.by_username ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

export function UsersPage() {
  const qc = useQueryClient();
  const [role, setRole] = useState<Role | "">("teacher");
  const [creating, setCreating] = useState(false);
  const [temp, setTemp] = useState<Schemas["TempPasswordOut"] | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const users = useQuery({
    queryKey: ["admin", "users", role],
    queryFn: () => unwrap(api.GET("/api/v1/admin/users", { params: { query: { role: role || undefined } } })),
  });
  const setUserRole = useMutation({
    mutationFn: ({ id, role }: { id: number; role: Role }) =>
      unwrap(api.PUT("/api/v1/admin/users/{user_id}/role", { params: { path: { user_id: id } }, body: { role } })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin", "users"] }),
  });
  const reset = useMutation({
    mutationFn: (id: number) =>
      unwrap(api.POST("/api/v1/admin/users/{user_id}/reset-password", { params: { path: { user_id: id } } })),
    onSuccess: setTemp,
  });
  const remove = useMutation({
    mutationFn: (id: number) => unwrap(api.DELETE("/api/v1/admin/users/{user_id}", { params: { path: { user_id: id } } })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin", "users"] }),
  });
  const onAdded = (r: Schemas["MemberAddOut"]) => {
    if (r.temporary_password) {
      setTemp({ username: r.username, temporary_password: r.temporary_password });
      setAdded(null);
    } else {
      setTemp(null);
      setAdded(r.username);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus aria-hidden /> {t.admin.newTeacher}
          </Button>
        }
      >
        {t.admin.users}
      </PageTitle>
      <Select aria-label={t.admin.role} className="w-48" value={role} onChange={(e) => setRole(e.target.value as Role | "")}>
        <option value="">{t.app.all}</option>
        {(["admin", "teacher", "student"] as const).map((r) => <option key={r} value={r}>{t.profile.roles[r]}</option>)}
      </Select>
      {setUserRole.isError && <Alert tone="destructive">{errorMessage(setUserRole.error)}</Alert>}
      {remove.isError && <Alert tone="destructive">{errorMessage(remove.error)}</Alert>}
      {added && <Alert tone="success">{t.admin.memberAdded(added)}</Alert>}
      {temp && (
        <Alert tone="primary" className="flex flex-wrap items-center gap-3">
          <span>{t.admin.tempPassword(temp.username)}</span>
          <code className="font-mono text-base">{temp.temporary_password}</code>
          <CopyButton value={temp.temporary_password} />
        </Alert>
      )}
      {users.isPending ? (
        <Spinner />
      ) : users.isError ? (
        <ErrorView error={users.error} />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">{t.auth.username}</th>
                <th className="px-3 py-2 font-medium">{t.admin.groups}</th>
                <th className="px-3 py-2 font-medium">{t.admin.lastActive}</th>
                <th className="px-3 py-2 font-medium">{t.admin.role}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {users.data.map((u) => (
                <tr key={u.id} className="border-b last:border-0">
                  <td className="px-3 py-2 font-medium">{u.username}</td>
                  <td className="px-3 py-2 text-muted-foreground">{u.groups.map((g) => g.label).join(", ") || "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{u.last_active_at ? formatDate(u.last_active_at) : t.admin.never}</td>
                  <td className="px-3 py-2">
                    <Select
                      aria-label={`${t.admin.makeRole}: ${u.username}`}
                      className="h-8 w-36"
                      value={u.role}
                      onChange={(e) => setUserRole.mutate({ id: u.id, role: e.target.value as Role })}
                    >
                      {(["student", "teacher", "admin"] as const).map((r) => <option key={r} value={r}>{t.profile.roles[r]}</option>)}
                    </Select>
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <Button size="sm" variant="ghost" onClick={() => reset.mutate(u.id)} aria-label={`${t.admin.resetPassword}: ${u.username}`}>
                      <KeyRound aria-hidden />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => window.confirm(t.admin.removeConfirm(u.username)) && remove.mutate(u.id)}
                      aria-label={`${t.admin.removeMember}: ${u.username}`}
                    >
                      <UserMinus aria-hidden />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <NewUserDialog open={creating} onOpenChange={setCreating} onCreated={onAdded} />
    </div>
  );
}

function NewUserDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: (r: Schemas["MemberAddOut"]) => void;
}) {
  const qc = useQueryClient();
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<Role>("teacher");
  const create = useMutation({
    mutationFn: () => unwrap(api.POST("/api/v1/admin/users", { body: { username, role } })),
    onSuccess: (r) => {
      onCreated(r);
      onOpenChange(false);
      setUsername("");
      void qc.invalidateQueries({ queryKey: ["admin", "users"] });
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t.admin.newTeacher}>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
        <p className="text-sm text-muted-foreground">{t.admin.addMemberIntro}</p>
        {create.isError && <Alert tone="destructive">{errorMessage(create.error)}</Alert>}
        <Field label={t.auth.username} hint={t.auth.usernameHint}>
          {(p) => <Input {...p} required autoCapitalize="none" value={username} onChange={(e) => setUsername(e.target.value.trim())} />}
        </Field>
        <Field label={t.admin.role}>
          {(p) => (
            <Select {...p} value={role} onChange={(e) => setRole(e.target.value as Role)}>
              <option value="teacher">{t.profile.roles.teacher}</option>
              <option value="admin">{t.profile.roles.admin}</option>
              <option value="student">{t.profile.roles.student}</option>
            </Select>
          )}
        </Field>
        <Button type="submit" disabled={create.isPending}>{t.admin.newTeacher}</Button>
      </form>
    </Dialog>
  );
}
