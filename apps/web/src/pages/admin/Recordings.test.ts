import { describe, expect, it } from "vitest";

import { mergeRows } from "@/pages/admin/Recordings";

const rows = [
  { key: 1, start: 0, end: 1, text: "a" },
  { key: 2, start: 1.2, end: 2, text: "" },
  { key: 3, start: 2, end: 3.5, text: "c" },
];

describe("mergeRows", () => {
  it("joins with the next segment and keeps the segment's own word", () => {
    expect(mergeRows(rows, 1, 1)).toEqual([
      { key: 1, start: 0, end: 2, text: "a" },
      { key: 3, start: 2, end: 3.5, text: "c" },
    ]);
  });

  it("joins with the previous segment and takes its word when it has none", () => {
    expect(mergeRows(rows, 2, -1)).toEqual([
      { key: 2, start: 0, end: 2, text: "a" },
      { key: 3, start: 2, end: 3.5, text: "c" },
    ]);
  });

  it("leaves the rows alone without a neighbour on that side", () => {
    expect(mergeRows(rows, 1, -1)).toBe(rows);
    expect(mergeRows(rows, 3, 1)).toBe(rows);
    expect(mergeRows(rows, 9, 1)).toBe(rows);
  });
});
