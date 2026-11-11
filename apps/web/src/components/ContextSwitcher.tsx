import type { Me } from "@vgt/api-client";
import { t } from "@vgt/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import { Select } from "@/components/ui/input";
import { api, meQuery, unwrap } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Choice {
  value: string;
  label: string;
}

/** The school + group choices of a user, grouped by school. */
export function contextChoices(me: Me): { school: string; choices: Choice[] }[] {
  const several = me.organisations.length > 1;
  return me.organisations.map((org) => {
    const groups = me.groups.filter((g) => g.org_id === org.id);
    // With several schools, the closed select must still show which school is chosen.
    const choices = groups.length
      ? groups.map((g) => ({ value: `${org.id}:${g.id}`, label: several ? `${org.name} · ${g.label}` : g.label }))
      : [{ value: `${org.id}:`, label: org.name }];
    return { school: org.name, choices };
  });
}

/**
 * Pick the school and group to work in. Shown only when there is a choice: a user with one
 * school and one group never sees it.
 */
export function ContextSwitcher({ me, admin = false, className }: { me: Me; admin?: boolean; className?: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const select = useMutation({
    mutationFn: ({ org_id, group_id }: { org_id: number; group_id: number | null }) =>
      unwrap(api.PUT("/api/v1/me/context", { body: { org_id, group_id } })),
    onSuccess: (next) => {
      // Everything except the user and the server info belongs to the old school.
      qc.removeQueries({ predicate: (q) => !["me", "health"].includes(String(q.queryKey[0])) });
      qc.setQueryData(meQuery.queryKey, next);
      void navigate({ to: admin ? "/admin" : "/" });
    },
  });

  const schools = contextChoices(me);
  const count = schools.reduce((n, s) => n + s.choices.length, 0);
  if (count < 2 || !me.org) return null;
  const value = `${me.org.id}:${me.group?.id ?? ""}`;
  const several = schools.length > 1;

  return (
    <Select
      aria-label={t.context.label}
      className={cn("h-9 w-auto max-w-44 truncate text-sm sm:max-w-56", className)}
      value={value}
      disabled={select.isPending}
      onChange={(e) => {
        const [org, group] = e.target.value.split(":");
        select.mutate({ org_id: Number(org), group_id: group ? Number(group) : null });
      }}
    >
      {schools.map((s) =>
        several ? (
          <optgroup key={s.school} label={s.school}>
            {s.choices.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </optgroup>
        ) : (
          s.choices.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))
        ),
      )}
    </Select>
  );
}
