import { describe, expect, it } from "vitest";

import { formatSeconds } from "@/lib/utils";
import { validateDictionarySearch } from "@/pages/Dictionary";
import { validatePracticeSearch } from "@/pages/Practice";
import { validateAdminWordsSearch } from "@/pages/admin/Words";

describe("search params", () => {
  it("parses practice options with safe defaults", () => {
    expect(validatePracticeSearch({ year: "1", list: "1.2", direction: "w2s", shuffle: "false" })).toEqual({
      year: 1,
      lesson: undefined,
      list: "1.2",
      difficult: undefined,
      direction: "w2s",
      shuffle: false,
    });
    const fallback = validatePracticeSearch({ direction: "nonsense", year: "x" });
    expect(fallback.direction).toBe("s2w");
    expect(fallback.year).toBeUndefined();
    expect(fallback.shuffle).toBe(true);
    expect(validatePracticeSearch({ difficult: true }).difficult).toBe(true);
  });

  it("parses dictionary and admin filters", () => {
    expect(validateDictionarySearch({ q: "", year: "2" })).toEqual({ q: undefined, year: 2 });
    expect(validateAdminWordsSearch({ status: "draft", missing: "true" })).toMatchObject({
      status: "draft",
      missing: true,
    });
    expect(validateAdminWordsSearch({ status: "weird" }).status).toBeUndefined();
  });
});

describe("formatSeconds", () => {
  it("formats minutes and tenths", () => {
    expect(formatSeconds(0)).toBe("0:00.0");
    expect(formatSeconds(75.25)).toBe("1:15.3");
  });
});
