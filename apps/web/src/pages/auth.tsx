import type { Me } from "@signa/api-client";
import { t } from "@signa/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { type FormEvent, type ReactNode, useState } from "react";

import { Field, RecoveryCode, Spinner } from "@/components/common";
import { LanguageSelect } from "@/components/LanguageSelect";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ApiError, api, errorMessage, meQuery, unwrap } from "@/lib/api";

function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main id="main" className="relative flex min-h-dvh flex-col items-center justify-center gap-6 overflow-hidden px-4 py-10">
      {/* Decorative blobs of colour behind the card. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <span className="absolute top-[8%] left-[6%] size-40 rounded-full bg-sun opacity-60 blur-2xl" />
        <span className="absolute top-[30%] right-[4%] size-52 rounded-full bg-sky opacity-50 blur-2xl" />
        <span className="absolute bottom-[6%] left-[18%] size-48 rounded-full bg-berry opacity-40 blur-2xl" />
        <span className="absolute right-[22%] bottom-[12%] size-32 rounded-full bg-mint opacity-50 blur-2xl" />
      </div>
      <div className="flex animate-pop-in items-center gap-3">
        <img src="/favicon.svg" alt="" className="size-14 animate-float" />
        <div>
          <p className="font-display text-3xl font-semibold">{t.app.name}</p>
          <p className="text-sm font-bold text-muted-foreground">{t.app.tagline}</p>
        </div>
      </div>
      <Card className="w-full max-w-sm animate-pop-in [animation-delay:80ms]">{children}</Card>
      <LanguageSelect />
    </main>
  );
}

function useLoggedIn() {
  const qc = useQueryClient();
  return (user: Me) => {
    qc.clear();
    qc.setQueryData(meQuery.queryKey, user);
  };
}

export function LoginPage() {
  const search = useSearch({ strict: false }) as { redirect?: string };
  const navigate = useNavigate();
  const loggedIn = useLoggedIn();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const login = useMutation({
    mutationFn: () =>
      unwrap(api.POST("/api/v1/auth/login", { body: { username, password, client: "web" } })),
    onSuccess: (data) => {
      loggedIn(data.user);
      const to = search.redirect?.startsWith("/") ? search.redirect : "/";
      void navigate({ to });
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate();
  };

  return (
    <AuthShell>
      <CardHeader>
        <CardTitle>{t.auth.login}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          {login.isError && (
            <Alert tone="destructive">
              {login.error instanceof ApiError && login.error.status === 401
                ? t.auth.wrongLogin
                : errorMessage(login.error)}
            </Alert>
          )}
          <Field label={t.auth.username}>
            {(p) => (
              <Input
                {...p}
                autoComplete="username"
                autoCapitalize="none"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            )}
          </Field>
          <Field label={t.auth.password}>
            {(p) => (
              <Input
                {...p}
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
          </Field>
          <Button type="submit" size="lg" disabled={login.isPending}>
            {login.isPending ? t.auth.loggingIn : t.auth.login}
          </Button>
          <Link to="/recover" className="text-center text-sm text-primary hover:underline">
            {t.auth.forgot}
          </Link>
          <p className="text-center text-xs text-muted-foreground">{t.auth.noAccount}</p>
        </form>
      </CardContent>
    </AuthShell>
  );
}

function PasswordFields({
  password,
  setPassword,
  repeat,
  setRepeat,
  label = t.auth.password,
}: {
  password: string;
  setPassword: (v: string) => void;
  repeat: string;
  setRepeat: (v: string) => void;
  label?: string;
}) {
  const mismatch = repeat.length > 0 && repeat !== password;
  return (
    <>
      <Field label={label} hint={t.auth.passwordHint}>
        {(p) => (
          <Input
            {...p}
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        )}
      </Field>
      <Field label={t.auth.repeatPassword} error={mismatch ? t.auth.passwordsDiffer : null}>
        {(p) => (
          <Input
            {...p}
            type="password"
            autoComplete="new-password"
            required
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
          />
        )}
      </Field>
    </>
  );
}

export function JoinPage() {
  const { code } = useParams({ strict: false }) as { code: string };
  const navigate = useNavigate();
  const loggedIn = useLoggedIn();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [recovery, setRecovery] = useState<{ code: string; user: Me } | null>(null);
  const qc = useQueryClient();
  const me = useQuery(meQuery);

  const invite = useQuery({
    queryKey: ["invite", code],
    queryFn: () => unwrap(api.GET("/api/v1/auth/invites/{code}", { params: { path: { code } } })),
    retry: false,
  });
  const register = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST("/api/v1/auth/register", {
          body: { invite_code: code, username, password, client: "web" },
        }),
      ),
    onSuccess: (data) => setRecovery({ code: data.recovery_code, user: data.user }),
  });
  // Already logged in: join with the same account, also for a group of another school.
  const join = useMutation({
    mutationFn: () => unwrap(api.POST("/api/v1/me/join", { body: { invite_code: code } })),
    onSuccess: (user) => {
      loggedIn(user);
      void navigate({ to: "/" });
    },
  });
  const logout = useMutation({
    mutationFn: () => api.POST("/api/v1/auth/logout"),
    onSettled: () => {
      qc.clear();
      qc.setQueryData(meQuery.queryKey, null);
    },
  });

  if (recovery) {
    return (
      <AuthShell>
        <CardHeader>
          <CardTitle>{t.auth.recoveryTitle}</CardTitle>
          <CardDescription>{t.auth.recoveryIntro}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <RecoveryCode code={recovery.code} />
          <Button
            size="lg"
            onClick={() => {
              loggedIn(recovery.user);
              void navigate({ to: "/" });
            }}
          >
            {t.auth.recoveryDone}
          </Button>
        </CardContent>
      </AuthShell>
    );
  }

  if (invite.isPending || me.isPending) {
    return (
      <AuthShell>
        <CardContent className="pt-5">
          <Spinner />
        </CardContent>
      </AuthShell>
    );
  }
  if (invite.isError) {
    return (
      <AuthShell>
        <CardContent className="flex flex-col gap-4 pt-5">
          <Alert tone="destructive">{t.auth.inviteInvalid}</Alert>
          <Link to="/login" className="text-sm text-primary hover:underline">
            {t.auth.toLogin}
          </Link>
        </CardContent>
      </AuthShell>
    );
  }

  const { group, org } = invite.data;
  const school = (
    <p className="text-sm font-medium">{t.auth.joinSchool(org.name, org.language.name)}</p>
  );

  if (me.data) {
    const member = me.data.groups.some((g) => g.id === group.id);
    return (
      <AuthShell>
        <CardHeader>
          <CardTitle>{t.auth.joinTitle(group.label)}</CardTitle>
          {school}
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {join.isError && <Alert tone="destructive">{errorMessage(join.error)}</Alert>}
          <p className="text-sm">{t.auth.joinAs(me.data.username)}</p>
          {member && <Alert tone="primary">{t.auth.alreadyMember}</Alert>}
          <Button size="lg" onClick={() => join.mutate()} disabled={join.isPending}>
            {t.auth.joinWithAccount}
          </Button>
          <button
            type="button"
            className="cursor-pointer self-start text-sm text-primary hover:underline"
            onClick={() => logout.mutate()}
          >
            {t.auth.otherAccount}
          </button>
        </CardContent>
      </AuthShell>
    );
  }

  const canSubmit = password.length >= 8 && password === repeat && username.length >= 3;
  return (
    <AuthShell>
      <CardHeader>
        <CardTitle>{t.auth.joinTitle(group.label)}</CardTitle>
        {school}
        <CardDescription>{t.auth.joinIntro}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) register.mutate();
          }}
        >
          {register.isError && (
            <Alert tone="destructive">
              {register.error instanceof ApiError && register.error.status === 409
                ? t.auth.usernameTaken
                : errorMessage(register.error)}
            </Alert>
          )}
          <Field label={t.auth.username} hint={t.auth.usernameHint}>
            {(p) => (
              <Input
                {...p}
                autoComplete="username"
                autoCapitalize="none"
                pattern="[A-Za-z0-9._\-]{3,32}"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value.trim())}
              />
            )}
          </Field>
          <PasswordFields password={password} setPassword={setPassword} repeat={repeat} setRepeat={setRepeat} />
          <Button type="submit" size="lg" disabled={!canSubmit || register.isPending}>
            {register.isPending ? t.auth.joining : t.auth.join}
          </Button>
        </form>
        <div className="mt-6 border-t pt-4 text-sm">
          <p className="text-muted-foreground">{t.auth.haveAccount}</p>
          <Link to="/login" search={{ redirect: `/join/${code}` }} className="text-primary hover:underline">
            {t.auth.loginToJoin}
          </Link>
        </div>
      </CardContent>
    </AuthShell>
  );
}

export function RecoverPage() {
  const [username, setUsername] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const recover = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST("/api/v1/auth/recover", {
          body: { username, recovery_code: code, new_password: password },
        }),
      ),
  });

  if (recover.data) {
    return (
      <AuthShell>
        <CardHeader>
          <CardTitle>{t.auth.recoveryTitle}</CardTitle>
          <CardDescription>{t.auth.recoverNewCode}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <RecoveryCode code={recover.data.recovery_code} />
          <Button asChild size="lg">
            <Link to="/login">{t.auth.toLogin}</Link>
          </Button>
        </CardContent>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <CardHeader>
        <CardTitle>{t.auth.recoverTitle}</CardTitle>
        <CardDescription>{t.auth.recoverIntro}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (password === repeat) recover.mutate();
          }}
        >
          {recover.isError && (
            <Alert tone="destructive">
              {recover.error instanceof ApiError && recover.error.status === 400
                ? t.auth.recoverFailed
                : errorMessage(recover.error)}
            </Alert>
          )}
          <Field label={t.auth.username}>
            {(p) => (
              <Input
                {...p}
                autoComplete="username"
                autoCapitalize="none"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            )}
          </Field>
          <Field label={t.auth.recoveryCode}>
            {(p) => (
              <Input
                {...p}
                autoComplete="off"
                autoCapitalize="characters"
                className="font-mono tracking-widest uppercase"
                placeholder="XXXX-XXXX-XXXX-XXXX"
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            )}
          </Field>
          <PasswordFields
            label={t.auth.newPassword}
            password={password}
            setPassword={setPassword}
            repeat={repeat}
            setRepeat={setRepeat}
          />
          <Button type="submit" size="lg" disabled={recover.isPending || password !== repeat}>
            {t.auth.recover}
          </Button>
          <Link to="/login" className="text-center text-sm text-primary hover:underline">
            {t.auth.toLogin}
          </Link>
        </form>
      </CardContent>
    </AuthShell>
  );
}

