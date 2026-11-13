import type { Word } from "@signa/api-client";
import { describe, expect, it } from "vitest";

import { groupWords } from "@/pages/Dictionary";

const word = (id: number, year: number, lesson: number | null, list: string | null): Word => ({
  id,
  gloss: `w${id}`,
  year,
  lesson,
  list_number: list,
  position: id,
  notes: "",
  group_ids: [],
  clips: [],
});

describe("groupWords", () => {
  it("groups words in course order by lesson, then by list", () => {
    const groups = groupWords([
      word(1, 1, null, null),
      word(2, 1, 1, "1.1"),
      word(3, 1, 1, "1.1"),
      word(4, 1, 1, "1.2"),
      word(5, 1, 2, "2.1"),
      word(6, 2, 1, "1.1"),
    ]);
    expect(groups.map((g) => [g.year, g.lesson, g.lists.map((l) => [l.list, l.words.map((w) => w.id)])])).toEqual([
      [1, null, [[null, [1]]]],
      [1, 1, [["1.1", [2, 3]], ["1.2", [4]]]],
      [1, 2, [["2.1", [5]]]],
      [2, 1, [["1.1", [6]]]],
    ]);
  });
});
