import { t } from "@vgt/core";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Check, ChevronRight } from "lucide-react";

import { type Choice, contextChoices } from "@/components/ContextSwitcher";
import { Alert, Badge, Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api, errorMessage, isStaff, meQuery, unwrap } from "@/lib/api";
import { cn } from "@/lib/utils";

export interface SwitchSearch {
  from?: "admin";
}

export function validateSwitchSearch(s: Record<string, unknown>): SwitchSearch {
  return s.from === "admin" ? { from: "admin" } : {};
}

/** A full page to choose the school (and group) to work in. The choice is stored on the account. */
export function SwitchSchoolPage({ search }: { search: SwitchSearch }) {
  const { data: me } = useSuspenseQuery(meQuery);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const back = search.from === "admin" ? "/admin" : "/";

  const select = useMutation({
    mutationFn: ({ org_id, group_id }: Choice) =>
      unwrap(api.PUT("/api/v1/me/context", { body: { org_id, group_id } })),
    onSuccess: (next) => {
      // Everything except the user and the server info belongs to the old school.
      qc.removeQueries({ predicate: (q) => !["me", "health"].includes(String(q.queryKey[0])) });
      qc.setQueryData(meQuery.queryKey, next);
      // Back to where the user came from, if they can work there in the new school.
      void navigate({ to: search.from === "admin" && (isStaff(next) || next.is_superadmin) ? "/admin" : "/" });
    },
  });

  if (!me) return null;
  const schools = contextChoices(me);
  const isCurrent = (c: Choice) => c.org_id === me.org?.id && (c.group_id ?? null) === (me.group?.id ?? null);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-2xl items-center justify-between gap-4 px-4">
          <Link to={back} className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" aria-hidden />
            {t.context.back}
          </Link>
          <span className="flex items-center gap-2 font-semibold">
            <img src="/favicon.svg" alt="" className="size-7" />
            {t.app.name}
          </span>
        </div>
      </header>
      <main id="main" className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-8">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{t.context.switchTitle}</h1>
          <p className="text-sm text-muted-foreground">{t.context.switchIntro}</p>
        </div>
        {select.isError && <Alert tone="destructive">{errorMessage(select.error)}</Alert>}
        {schools.length === 0 && (
          <Card>
            <CardHeader>
              <CardTitle>{t.context.noSchoolTitle}</CardTitle>
              <CardDescription>{t.context.noSchoolIntro}</CardDescription>
            </CardHeader>
          </Card>
        )}
        <ul className="flex flex-col gap-4">
          {schools.map(({ org, choices }) => {
            const grouped = choices.some((c) => c.group_id !== null);
            return (
              <li key={org.id}>
                <Card className={cn(org.id === me.org?.id && "border-primary")}>
                  <CardHeader className={cn(!grouped && "hidden")}>
                    <CardTitle>{org.name}</CardTitle>
                    <CardDescription>
                      {org.language.name} · {t.profile.roles[org.role]}
                    </CardDescription>
                  </CardHeader>
                  <ul className={cn("flex flex-col", grouped && "border-t")}>
                    {choices.map((c) => {
                      const current = isCurrent(c);
                      return (
                        <li key={`${c.org_id}:${c.group_id ?? ""}`} className="border-b last:border-b-0">
                          <button
                            type="button"
                            disabled={select.isPending}
                            aria-current={current ? "true" : undefined}
                            aria-label={grouped ? `${org.name} · ${c.label}` : undefined}
                            onClick={() => (current ? void navigate({ to: back }) : select.mutate(c))}
                            className="flex w-full cursor-pointer items-center justify-between gap-3 px-5 py-4 text-left hover:bg-accent disabled:cursor-wait disabled:opacity-60"
                          >
                            <span className="flex min-w-0 flex-col">
                              <span className={cn("truncate font-medium", !grouped && "text-lg font-semibold")}>{c.label}</span>
                              {!grouped && (
                                <span className="text-sm text-muted-foreground">
                                  {org.language.name} · {t.profile.roles[org.role]}
                                </span>
                              )}
                            </span>
                            {current ? (
                              <Badge tone="primary" className="shrink-0 gap-1">
                                <Check className="size-3" aria-hidden />
                                {t.context.current}
                              </Badge>
                            ) : (
                              <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </Card>
              </li>
            );
          })}
        </ul>
      </main>
    </div>
  );
}
