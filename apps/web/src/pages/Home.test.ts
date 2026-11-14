import type { Catalog } from "@signa/api-client";
import { describe, expect, it } from "vitest";

import { practiceSelection } from "@/pages/Home";
import { practiceTitle } from "@/pages/Practice";

const years: Catalog["years"] = [
  {
    year: 1,
    count: 5,
    lessons: [1, 2],
    lists: [
      { lesson: 1, list_number: "1.1", count: 2 },
      { lesson: 2, list_number: "2.1", count: 3 },
    ],
  },
  {
    year: 2,
    count: 4,
    lessons: [1],
    lists: [{ lesson: 1, list_number: "1.1", count: 4 }],
  },
] as Catalog["years"];

describe("practiceSelection", () => {
  it("practises every year together, without a year or lesson", () => {
    expect(practiceSelection(years, "all", "lesson", 2)).toEqual({
      count: 9,
      search: {},
    });
  });

  it("practises a whole year", () => {
    expect(practiceSelection(years, 1, "year", null)).toEqual({
      count: 5,
      search: { year: 1 },
    });
  });

  it("practises a lesson, the first one by default", () => {
    expect(practiceSelection(years, 1, "lesson", null)).toEqual({
      count: 2,
      search: { year: 1, lesson: 1 },
    });
    expect(practiceSelection(years, 1, "lesson", 2)).toEqual({
      count: 3,
      search: { year: 1, lesson: 2 },
    });
  });

  it("selects nothing without a known year", () => {
    expect(practiceSelection(years, null, "year", null)).toEqual({
      count: 0,
      search: null,
    });
    expect(practiceSelection(years, 7, "year", null)).toEqual({
      count: 0,
      search: null,
    });
  });
});

describe("practiceTitle", () => {
  it("names an all-years session", () => {
    expect(practiceTitle({ direction: "mixed", shuffle: true })).toBe(
      "Alle jaren",
    );
  });

  it("names a year and lesson", () => {
    expect(
      practiceTitle({ year: 2, lesson: 3, direction: "mixed", shuffle: true }),
    ).toBe("Jaar 2 · Les 3");
  });
});
