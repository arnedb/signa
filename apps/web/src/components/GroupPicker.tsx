import type { Schemas } from "@signa/api-client";
import { t } from "@signa/core";
import { useQuery } from "@tanstack/react-query";

import { Badge } from "@/components/ui/card";
import { groupsQuery } from "@/pages/admin/Groups";

type Group = Schemas["GroupOut"];

/** The school's groups, to name the groups a word is limited to. */
export function useGroups(): Group[] {
  return useQuery(groupsQuery).data ?? [];
}

const byYearAndLabel = (a: Group, b: Group) => a.year - b.year || a.label.localeCompare(b.label);

/** The groups a word is for, as small badges; "All groups" when it is shared. */
export function WordGroups({ ids, groups }: { ids: number[]; groups: Group[] }) {
  if (ids.length === 0) return <span className="text-muted-foreground">{t.admin.allGroups}</span>;
  const named = groups.filter((g) => ids.includes(g.id)).sort(byYearAndLabel);
  return (
    <span className="flex flex-wrap gap-1">
      {named.map((g) => (
        <Badge key={g.id}>{g.label}</Badge>
      ))}
    </span>
  );
}

/** Names of groups, for the history: "Jaar 1 · dinsdag, Jaar 1 · donderdag" or "All groups". */
export function groupNames(ids: unknown, groups: Group[]): string {
  if (!Array.isArray(ids) || ids.length === 0) return t.admin.allGroups;
  return ids.map((id) => groups.find((g) => g.id === id)?.label ?? `#${String(id)}`).join(", ");
}

/**
 * Tick the groups a word is for; nothing ticked is every group. Inactive groups are only
 * shown when they are ticked, so they can be unticked.
 */
export function GroupPicker({
  value,
  onChange,
  legend = t.admin.forGroups,
}: {
  value: number[];
  onChange: (ids: number[]) => void;
  legend?: string;
}) {
  const groups = useGroups()
    .filter((g) => g.active || value.includes(g.id))
    .sort(byYearAndLabel);
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {groups.map((g) => (
          <label key={g.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={value.includes(g.id)}
              onChange={(e) =>
                onChange(e.target.checked ? [...value, g.id].sort((a, b) => a - b) : value.filter((id) => id !== g.id))
              }
            />
            {g.active ? g.label : t.admin.inactiveGroup(g.label)}
          </label>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{t.admin.groupsHint}</p>
    </fieldset>
  );
}
