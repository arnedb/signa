import { describe, expect, it } from "vitest";

import { lessonOf } from "@/lib/lesson";

describe("lessonOf", () => {
  it("reads the lesson from a '<lesson>.<part>' list number", () => {
    expect(lessonOf("3.2")).toBe(3);
    expect(lessonOf(" 12.1 ")).toBe(12);
    expect(lessonOf("4")).toBe(4);
  });

  it("gives nothing for other list numbers", () => {
    expect(lessonOf("")).toBeNull();
    expect(lessonOf("extra")).toBeNull();
    expect(lessonOf("A.1")).toBeNull();
  });
});
