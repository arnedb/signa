import { useQuery } from "@tanstack/react-query";
import type { Me } from "@signa/api-client";
import { type Locale, getLocale, pickLocale, setLocale, t } from "@signa/core";

import { meQuery } from "@/lib/api";

const STORAGE_KEY = "signa.locale";

/** The language chosen on this device, for the pages before logging in. */
export function storedLocale(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? memory;
  } catch {
    return memory;
  }
}

// Kept in memory too, so the choice holds when storage is blocked (private mode).
let memory: string | null = null;
const listeners = new Set<() => void>();

export function storeLocale(locale: Locale | null): void {
  memory = locale;
  try {
    if (locale) localStorage.setItem(STORAGE_KEY, locale);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Blocked storage: the in-memory choice still holds for this visit.
  }
  listeners.forEach((l) => l());
}

/** For `useSyncExternalStore`: re-render when the device's choice changes. */
export function subscribeStoredLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function browserLocales(): readonly string[] {
  return typeof navigator === "undefined" ? [] : (navigator.languages ?? [navigator.language]);
}

/** The spoken language of the current school's glosses (for `lang` attributes). */
export function glossLocale(me: Me | null | undefined): Locale {
  return pickLocale(me?.org?.language.locale);
}

/**
 * The interface language. Explicit choices come first: the one saved on the account, then
 * the one made on this device. Then the spoken language of the school's sign language
 * (LSFB: French), then the browser's languages, then Dutch.
 */
export function resolveLocale(me: Me | null | undefined): Locale {
  return pickLocale(me?.locale, storedLocale(), me?.org?.language.locale, ...browserLocales());
}

/** Switch `t` to the language and update the page around the app. */
export function applyLocale(locale: Locale): void {
  setLocale(locale);
  if (typeof document !== "undefined") {
    document.documentElement.lang = locale;
    document.title = t.app.name;
  }
}

export { getLocale };

/** The `lang` for glosses of the current school, e.g. "fr" for an LSFB school. */
export function useGlossLang(): Locale {
  const { data: me } = useQuery(meQuery);
  return glossLocale(me);
}
