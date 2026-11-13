import { describe, expect, it } from "vitest";

import { buildDeck, type DeckWord, seededRandom, shuffled } from "./deck";
import { keyCommand } from "./keys";
import {
  currentCard,
  isFinished,
  missedCards,
  score,
  sessionReducer,
  startSession,
  toResults,
} from "./session";

const word = (id: number, clips = 1): DeckWord => ({
  id,
  gloss: `w${id}`,
  year: 1,
  clips: Array.from({ length: clips }, (_, i) => ({ id: id * 10 + i, url: `/c/${id}/${i}` })),
});

describe("buildDeck", () => {
  it("keeps course order and skips words without a clip", () => {
    const deck = buildDeck([word(1), word(2, 0), word(3)], { direction: "w2s", shuffle: false });
    expect(deck.map((c) => c.word.id)).toEqual([1, 3]);
    expect(deck.every((c) => c.direction === "w2s")).toBe(true);
    expect(deck[0]?.clip.id).toBe(10);
  });

  it("shuffles repeatably with a seed, and limits", () => {
    const words = Array.from({ length: 20 }, (_, i) => word(i + 1));
    const a = buildDeck(words, { direction: "s2w", shuffle: true, limit: 5 }, seededRandom(1));
    const b = buildDeck(words, { direction: "s2w", shuffle: true, limit: 5 }, seededRandom(1));
    expect(a.map((c) => c.word.id)).toEqual(b.map((c) => c.word.id));
    expect(a).toHaveLength(5);
  });

  it("mixes directions", () => {
    const words = Array.from({ length: 40 }, (_, i) => word(i + 1));
    const deck = buildDeck(words, { direction: "mixed", shuffle: false }, seededRandom(7));
    const dirs = new Set(deck.map((c) => c.direction));
    expect(dirs).toEqual(new Set(["w2s", "s2w"]));
    expect(new Set(deck.map((c) => c.key)).size).toBe(deck.length);
  });

  it("practises each word only in its own directions when it has them", () => {
    const words: DeckWord[] = [
      { ...word(1), directions: ["w2s"] },
      { ...word(2), directions: ["w2s", "s2w"] },
      word(3),
    ];
    const deck = buildDeck(words, { direction: "s2w", shuffle: false });
    expect(deck.map((c) => [c.word.id, c.direction])).toEqual([
      [1, "w2s"],
      [2, "w2s"],
      [2, "s2w"],
      [3, "s2w"],
    ]);
    expect(new Set(deck.map((c) => c.key)).size).toBe(deck.length);

    const mixed = buildDeck(words, { direction: "mixed", shuffle: true }, seededRandom(5));
    expect(mixed).toHaveLength(4);
    expect(mixed.filter((c) => c.word.id === 1).map((c) => c.direction)).toEqual(["w2s"]);
    expect(new Set(mixed.filter((c) => c.word.id === 2).map((c) => c.direction))).toEqual(
      new Set(["w2s", "s2w"]),
    );
  });

  it("shuffled does not change the input", () => {
    const input = [1, 2, 3, 4];
    const out = shuffled(input, seededRandom(3));
    expect(input).toEqual([1, 2, 3, 4]);
    expect([...out].sort()).toEqual([1, 2, 3, 4]);
  });
});

describe("session", () => {
  const deck = buildDeck([word(1), word(2), word(3)], { direction: "w2s", shuffle: false });

  it("runs a round and repeats the missed cards", () => {
    let s = startSession(deck);
    s = sessionReducer(s, { type: "answer", correct: true }); // answering without reveal is allowed
    s = sessionReducer(s, { type: "reveal" });
    expect(s.revealed).toBe(true);
    s = sessionReducer(s, { type: "answer", correct: false, at: "2026-01-01T00:00:00Z" });
    expect(s.revealed).toBe(false);
    s = sessionReducer(s, { type: "answer", correct: false });
    expect(isFinished(s)).toBe(true);
    expect(score(s)).toEqual({ known: 1, total: 3 });
    expect(missedCards(s).map((c) => c.word.id)).toEqual([2, 3]);
    expect(sessionReducer(s, { type: "answer", correct: true })).toBe(s);

    s = sessionReducer(s, { type: "repeatMissed" });
    expect(s.round).toBe(2);
    expect(currentCard(s)?.word.id).toBe(2);
    s = sessionReducer(s, { type: "answer", correct: true });
    s = sessionReducer(s, { type: "answer", correct: true });
    expect(score(s)).toEqual({ known: 2, total: 2 });
    expect(sessionReducer(s, { type: "repeatMissed" })).toBe(s);

    const results = toResults(s.log);
    expect(results).toHaveLength(5);
    expect(results[1]).toEqual({ word_id: 2, direction: "w2s", correct: false, at: "2026-01-01T00:00:00Z" });
  });

  it("undoes the last answer", () => {
    let s = startSession(deck);
    expect(sessionReducer(s, { type: "undo" })).toBe(s);
    s = sessionReducer(s, { type: "answer", correct: false });
    s = sessionReducer(s, { type: "undo" });
    expect(s.index).toBe(0);
    expect(s.revealed).toBe(true);
    expect(s.log).toHaveLength(0);
  });

  it("restarts", () => {
    let s = startSession(deck);
    s = sessionReducer(s, { type: "answer", correct: true });
    s = sessionReducer(s, { type: "restart" });
    expect(s.index).toBe(0);
    expect(s.cards).toHaveLength(3);
  });
});

describe("keyCommand", () => {
  it("maps keys", () => {
    expect(keyCommand(" ", false)).toBe("reveal");
    expect(keyCommand(" ", true)).toBeNull();
    expect(keyCommand("ArrowRight", false)).toBeNull();
    expect(keyCommand("ArrowRight", true)).toBe("known");
    expect(keyCommand("ArrowLeft", true)).toBe("unknown");
    expect(keyCommand("a", true)).toBeNull();
  });
});
