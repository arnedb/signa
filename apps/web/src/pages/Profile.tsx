import { t } from "@vgt/core";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Download, KeyRound, Trash2 } from "lucide-react";
import { useState } from "react";

import { Field, PageTitle, RecoveryCode } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api, errorMessage, meQuery, unwrap } from "@/lib/api";
import { downloadJson, formatDate } from "@/lib/utils";

export function ProfilePage() {
  const { data: me } = useSuspenseQuery(meQuery);
  if (!me) return null;
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <PageTitle>{t.profile.title}</PageTitle>
      <Card>
        <CardContent className="pt-5">
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-muted-foreground">{t.auth.username}</dt>
            <dd className="font-medium">{me.username}</dd>
            <dt className="text-muted-foreground">{me.groups.length > 1 ? t.profile.groups : t.profile.group}</dt>
            <dd>{me.groups.map((g) => g.label).join(", ") || "—"}</dd>
            <dt className="text-muted-foreground">{t.profile.role}</dt>
            <dd>{t.profile.roles[me.role]}</dd>
            <dt className="text-muted-foreground">{t.profile.memberSince}</dt>
            <dd>{formatDate(me.created_at)}</dd>
          </dl>
          {me.role === "student" && <p className="mt-3 text-xs text-muted-foreground">{t.profile.groupFixed}</p>}
        </CardContent>
      </Card>
      <ChangePassword />
      <NewRecoveryCode />
      <DataCard />
    </div>
  );
}

function ChangePassword() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const change = useMutation({
    mutationFn: () =>
      unwrap(api.POST("/api/v1/me/password", { body: { current_password: current, new_password: next } })),
    onSuccess: () => {
      setCurrent("");
      setNext("");
      setRepeat("");
    },
  });
  const mismatch = repeat.length > 0 && next !== repeat;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.profile.changePassword}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-4 sm:max-w-sm"
          onSubmit={(e) => {
            e.preventDefault();
            if (!mismatch) change.mutate();
          }}
        >
          {change.isSuccess && <Alert tone="success">{t.profile.passwordChanged}</Alert>}
          {change.isError && <Alert tone="destructive">{errorMessage(change.error)}</Alert>}
          <Field label={t.profile.currentPassword}>
            {(p) => (
              <Input {...p} type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
            )}
          </Field>
          <Field label={t.auth.newPassword} hint={t.auth.passwordHint}>
            {(p) => (
              <Input {...p} type="password" autoComplete="new-password" minLength={8} required value={next} onChange={(e) => setNext(e.target.value)} />
            )}
          </Field>
          <Field label={t.auth.repeatPassword} error={mismatch ? t.auth.passwordsDiffer : null}>
            {(p) => (
              <Input {...p} type="password" autoComplete="new-password" required value={repeat} onChange={(e) => setRepeat(e.target.value)} />
            )}
          </Field>
          <Button type="submit" className="self-start" disabled={change.isPending || mismatch}>
            {t.app.save}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function NewRecoveryCode() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const make = useMutation({
    mutationFn: () => unwrap(api.POST("/api/v1/me/recovery-code", { body: { password } })),
    onSuccess: () => setPassword(""),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.auth.recoveryCode}</CardTitle>
        <CardDescription>{t.profile.newRecoveryIntro}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="outline" onClick={() => { make.reset(); setOpen(true); }}>
          <KeyRound aria-hidden /> {t.profile.newRecovery}
        </Button>
        <Dialog open={open} onOpenChange={setOpen} title={t.profile.newRecovery}>
          {make.data ? (
            <div className="flex flex-col gap-4">
              <p className="text-sm">{t.auth.recoveryIntro}</p>
              <RecoveryCode code={make.data.recovery_code} />
              <Button onClick={() => setOpen(false)}>{t.auth.recoveryDone}</Button>
            </div>
          ) : (
            <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); make.mutate(); }}>
              {make.isError && <Alert tone="destructive">{errorMessage(make.error)}</Alert>}
              <Field label={t.auth.password}>
                {(p) => <Input {...p} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}
              </Field>
              <Button type="submit" disabled={make.isPending}>{t.profile.newRecovery}</Button>
            </form>
          )}
        </Dialog>
      </CardContent>
    </Card>
  );
}

function DataCard() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const exportData = useMutation({
    mutationFn: () => unwrap(api.GET("/api/v1/me/export")),
    onSuccess: (data) => downloadJson(data, "vgt-mijn-gegevens.json"),
  });
  const remove = useMutation({
    mutationFn: () => unwrap(api.POST("/api/v1/me/delete", { body: { password } })),
    onSuccess: () => {
      qc.clear();
      qc.setQueryData(meQuery.queryKey, null);
      void navigate({ to: "/login" });
    },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.profile.data}</CardTitle>
        <CardDescription>{t.profile.dataIntro}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-3">
        <Button variant="outline" onClick={() => exportData.mutate()} disabled={exportData.isPending}>
          <Download aria-hidden /> {t.profile.download}
        </Button>
        <Button variant="outline" className="text-destructive" onClick={() => setOpen(true)}>
          <Trash2 aria-hidden /> {t.profile.deleteAccount}
        </Button>
        <Dialog open={open} onOpenChange={setOpen} title={t.profile.deleteAccount} description={t.profile.deleteIntro}>
          <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); remove.mutate(); }}>
            {remove.isError && <Alert tone="destructive">{errorMessage(remove.error)}</Alert>}
            <Field label={t.profile.deleteConfirm}>
              {(p) => <Input {...p} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}
            </Field>
            <Button type="submit" variant="destructive" disabled={remove.isPending}>
              {t.profile.deleteButton}
            </Button>
          </form>
        </Dialog>
      </CardContent>
    </Card>
  );
}
