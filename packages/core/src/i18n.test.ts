import { afterEach, describe, expect, it } from "vitest";

import {
  getLocale,
  LOCALES,
  MESSAGES,
  localeTag,
  pickLocale,
  setLocale,
  t,
  translateError,
  weekdayName,
} from "./i18n";

/** Every key path, with the kind of value (string, function, object). */
function shape(value: unknown, path = ""): string[] {
  if (typeof value !== "object" || value === null) return [`${path}:${typeof value}`];
  return Object.entries(value).flatMap(([k, v]) => shape(v, `${path}.${k}`));
}

afterEach(() => setLocale("nl"));

describe("i18n", () => {
  it("has the same keys in every language", () => {
    // errors.server is a lookup table; English needs no entries.
    const strip = (keys: string[]) => keys.filter((k) => !k.startsWith(".errors.server."));
    const reference = strip(shape(MESSAGES.nl));
    for (const locale of LOCALES) expect(strip(shape(MESSAGES[locale]))).toEqual(reference);
  });

  it("switches the text in place", () => {
    expect(t.nav.practice).toBe("Oefenen");
    setLocale("fr");
    expect(getLocale()).toBe("fr");
    expect(t.nav.practice).toBe("S’exercer");
    expect(t.app.words(2)).toBe("2 mots");
    expect(weekdayName("tue")).toBe("mardi");
    expect(localeTag()).toBe("fr-BE");
    setLocale("en");
    expect(t.practice.known).toBe("I knew it");
  });

  it("picks the first supported language", () => {
    expect(pickLocale(null, "de-DE", "fr-BE", "nl")).toBe("fr");
    expect(pickLocale(undefined, "es")).toBe("nl");
    expect(pickLocale("EN")).toBe("en");
  });

  it("translates known API errors and keeps unknown ones", () => {
    expect(translateError("Username is taken")).toBe("Deze gebruikersnaam is al in gebruik.");
    expect(translateError("Invalid input")).toBe("Ongeldige invoer");
    expect(translateError("Something new")).toBe("Something new");
    setLocale("en");
    expect(translateError("Username is taken")).toBe("Username is taken");
  });
});
