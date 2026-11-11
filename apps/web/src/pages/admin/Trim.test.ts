import { describe, expect, it } from "vitest";

import { parseTime } from "@/pages/admin/Trim";

describe("parseTime", () => {
  it("reads seconds and minutes:seconds, with a dot or a comma", () => {
    expect(parseTime("1.5")).toBe(1.5);
    expect(parseTime("0,4")).toBe(0.4);
    expect(parseTime(" 2 ")).toBe(2);
    expect(parseTime("1:02.5")).toBe(62.5);
    expect(parseTime("0:00,8")).toBe(0.8);
  });

  it("refuses anything else", () => {
    expect(parseTime("")).toBeNull();
    expect(parseTime("abc")).toBeNull();
    expect(parseTime("-1")).toBeNull();
    expect(parseTime("1:2:3")).toBeNull();
  });
});
