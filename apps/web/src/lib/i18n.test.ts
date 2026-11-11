import type { Me } from "@vgt/api-client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveLocale, storeLocale } from "@/lib/i18n";

function me(locale: Me["locale"], school: "nl" | "fr" | "en" | null): Me {
  return {
    id: 1,
    username: "u",
    is_superadmin: false,
    locale,
    created_at: "2026-01-01T00:00:00",
    org: school ? { id: 1, name: "S", slug: "s", language: { code: "x", name: "X", locale: school } } : null,
    role: "student",
    group: null,
    organisations: [],
    groups: [],
  };
}

afterEach(() => {
  storeLocale(null);
  vi.unstubAllGlobals();
});

describe("resolveLocale", () => {
  it("prefers the account's choice, then the device's, then the school's", () => {
    expect(resolveLocale(me("en", "fr"))).toBe("en");
    expect(resolveLocale(me(null, "fr"))).toBe("fr");
    storeLocale("en");
    expect(resolveLocale(me(null, "fr"))).toBe("en");
    expect(resolveLocale(me("nl", "fr"))).toBe("nl");
  });

  it("falls back to the browser, then Dutch", () => {
    vi.stubGlobal("navigator", { languages: ["de-DE", "fr-BE"], language: "de-DE" });
    expect(resolveLocale(null)).toBe("fr");
    vi.stubGlobal("navigator", { languages: ["de-DE"], language: "de-DE" });
    expect(resolveLocale(null)).toBe("nl");
  });
});
