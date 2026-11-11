/**
 * Interface languages. `t` always holds the text of the current language: components read
 * `t.section.key` while rendering, so after `setLocale` a re-render shows the new language.
 */

import { nl, type Text } from "./text";
import { en } from "./text.en";
import { fr } from "./text.fr";

export const LOCALES = ["nl", "fr", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "nl";

/** Each language in its own words, the same in every interface language. */
export const LOCALE_NAMES: Record<Locale, string> = { nl: "Nederlands", fr: "Français", en: "English" };

/** Used for dates and numbers. */
const TAGS: Record<Locale, string> = { nl: "nl-BE", fr: "fr-BE", en: "en-GB" };

export const MESSAGES: Record<Locale, Text> = { nl, fr, en };

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const t: Text = { ...nl };
let current: Locale = DEFAULT_LOCALE;

export function setLocale(locale: Locale): void {
  if (locale === current) return;
  current = locale;
  Object.assign(t, MESSAGES[locale]);
}

export function getLocale(): Locale {
  return current;
}

export function localeTag(locale: Locale = current): string {
  return TAGS[locale];
}

/** "fr-BE" → "fr"; anything unsupported → null. */
export function matchLocale(value: string | null | undefined): Locale | null {
  const base = value?.toLowerCase().split(/[-_]/)[0];
  return LOCALES.find((l) => l === base) ?? null;
}

/** The first supported language among the candidates, in order of preference. */
export function pickLocale(...candidates: (string | null | undefined)[]): Locale {
  for (const c of candidates) {
    const match = matchLocale(c);
    if (match) return match;
  }
  return DEFAULT_LOCALE;
}

/** An API error message (English) in the current language, when we know it. */
export function translateError(message: string): string {
  if (message === "Invalid input") return t.errors.invalidInput;
  return t.errors.server[message] ?? message;
}

export function weekdayName(code: string): string {
  return (t.admin.weekdays as Record<string, string>)[code] ?? code;
}
