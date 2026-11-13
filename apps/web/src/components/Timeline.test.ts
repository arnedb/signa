import { describe, expect, it } from "vitest";

import { moveHandle, type TimelineRange, timelineHandles } from "@/components/Timeline";

// 1 and 2 touch at 2 s; 3 starts after a gap.
const ranges: TimelineRange[] = [
  { key: 1, start: 0.5, end: 2 },
  { key: 2, start: 2, end: 3.5 },
  { key: 3, start: 4, end: 5 },
];
const span = (rs: TimelineRange[]) => rs.map((r) => [r.key, r.start, r.end]);

describe("timelineHandles", () => {
  it("shares one handle between ranges that touch", () => {
    expect(timelineHandles(ranges, null).map((h) => h.id)).toEqual(["1:start", "1|2", "2:end", "3:start", "3:end"]);
  });

  it("gives the selected range its own start and end", () => {
    const handles = timelineHandles(ranges, 2);
    expect(handles.map((h) => h.id)).toEqual(["1:start", "2:start", "2:end", "3:start", "3:end"]);
    expect(handles.filter((h) => h.selected).map((h) => h.id)).toEqual(["2:start", "2:end"]);
  });
});

describe("moveHandle", () => {
  it("moves a shared boundary for both ranges", () => {
    const edges = timelineHandles(ranges, null).find((h) => h.id === "1|2")!.edges;
    expect(span(moveHandle(ranges, edges, 2.4, 0.1, 6))).toEqual([
      [1, 0.5, 2.4],
      [2, 2.4, 3.5],
      [3, 4, 5],
    ]);
  });

  it("keeps a minimum length when a boundary is dragged too far", () => {
    const edges = timelineHandles(ranges, null).find((h) => h.id === "1|2")!.edges;
    expect(span(moveHandle(ranges, edges, 9, 0.1, 6))[1]).toEqual([2, 3.4, 3.5]);
  });

  it("moves only the selected start, leaving a gap", () => {
    expect(span(moveHandle(ranges, [{ key: 2, which: "start" }], 2.3, 0.1, 6))).toEqual([
      [1, 0.5, 2],
      [2, 2.3, 3.5],
      [3, 4, 5],
    ]);
  });

  it("pushes the neighbour back when the selected edge overlaps it", () => {
    expect(span(moveHandle(ranges, [{ key: 2, which: "end" }], 4.5, 0.1, 6))).toEqual([
      [1, 0.5, 2],
      [2, 2, 4.5],
      [3, 4.5, 5],
    ]);
  });

  it("stays inside the video", () => {
    expect(span(moveHandle(ranges, [{ key: 3, which: "end" }], 99, 0.1, 6))[2]).toEqual([3, 4, 6]);
    expect(span(moveHandle(ranges, [{ key: 1, which: "start" }], -3, 0.1, 6))[0]).toEqual([1, 0, 2]);
  });
});
