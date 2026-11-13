import { type Locale, LOCALE_NAMES, LOCALES, getLocale, t } from "@signa/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { Select } from "@/components/ui/input";
import { api, meQuery, unwrap } from "@/lib/api";
import { glossLocale, storeLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Me } from "@signa/api-client";

/**
 * Choose the interface language. Logged in, the choice is saved on the account (so the
 * mobile app follows) and "Automatic" follows the school. Logged out, it is kept on this
 * device. The language names are always in their own language.
 */
export function LanguageSelect({ me, className }: { me?: Me | null; className?: string }) {
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (locale: Locale | null) => unwrap(api.PUT("/api/v1/me/locale", { body: { locale } })),
    onSuccess: (next) => qc.setQueryData(meQuery.queryKey, next),
  });

  const value = me ? (me.locale ?? "") : getLocale();
  const choose = (v: string) => {
    const locale = (v || null) as Locale | null;
    // Also remember it on this device, for the login page after logging out.
    storeLocale(locale);
    if (me) save.mutate(locale);
  };

  return (
    <Select
      aria-label={t.language.label}
      className={cn("h-9 w-auto text-sm", className)}
      value={value}
      disabled={save.isPending}
      onChange={(e) => choose(e.target.value)}
    >
      {me && <option value="">{t.language.auto(LOCALE_NAMES[glossLocale(me)])}</option>}
      {LOCALES.map((l) => (
        <option key={l} value={l} lang={l}>
          {LOCALE_NAMES[l]}
        </option>
      ))}
    </Select>
  );
}
