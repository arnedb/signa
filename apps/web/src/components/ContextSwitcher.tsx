import type { Me } from "@signa/api-client";
import { t } from "@signa/core";
import { Link } from "@tanstack/react-router";
import { ArrowLeftRight } from "lucide-react";

import { cn } from "@/lib/utils";

export interface Choice {
  org_id: number;
  group_id: number | null;
  label: string;
}

export interface SchoolChoices {
  org: Me["organisations"][number];
  choices: Choice[];
}

/** The school + group choices of a user, grouped by school. A school without groups is one choice. */
export function contextChoices(me: Me): SchoolChoices[] {
  return me.organisations.map((org) => {
    const groups = me.groups.filter((g) => g.org_id === org.id);
    const choices = groups.length
      ? groups.map((g) => ({ org_id: org.id, group_id: g.id, label: g.label }))
      : [{ org_id: org.id, group_id: null, label: org.name }];
    return { org, choices };
  });
}

/** Whether the user can choose between schools or groups at all. */
export function hasChoice(me: Me): boolean {
  return contextChoices(me).reduce((n, s) => n + s.choices.length, 0) > 1;
}

/**
 * The current school (or group, with one school) in the header. It opens the page to switch
 * school. Shown only when there is a choice: a user with one school and one group never sees it.
 */
export function ContextSwitcher({ me, admin = false, className }: { me: Me; admin?: boolean; className?: string }) {
  if (!me.org || !hasChoice(me)) return null;
  const label = me.organisations.length > 1 ? me.org.name : (me.group?.label ?? me.org.name);
  return (
    <Link
      to="/switch"
      search={admin ? { from: "admin" } : {}}
      title={t.context.switch}
      className={cn(
        "flex h-9 min-w-0 items-center gap-2 rounded-md border px-3 text-sm font-medium hover:bg-accent hover:text-accent-foreground",
        className,
      )}
    >
      <ArrowLeftRight className="size-4 shrink-0" aria-hidden />
      <span className="sr-only">{t.context.switch}: </span>
      <span className="max-w-32 truncate sm:max-w-48">{label}</span>
    </Link>
  );
}
