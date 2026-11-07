/** Building a practice deck from a list of words. No scheduling algorithm: just a list. */

export type Direction = "w2s" | "s2w";
export type DirectionChoice = Direction | "mixed";

export interface DeckClip {
  id: number;
  url: string;
  thumb_url?: string | null;
}

export interface DeckWord {
  id: number;
  gloss: string;
  year: number;
  lesson?: number | null;
  list_number?: string | null;
  position?: number;
  notes?: string;
  clips: DeckClip[];
}

export interface Card {
  /** Unique within a deck: word id + direction. */
  key: string;
  word: DeckWord;
  direction: Direction;
  clip: DeckClip;
}

export interface DeckOptions {
  direction: DirectionChoice;
  shuffle: boolean;
  limit?: number;
}

export type Random = () => number;

/** Fisher–Yates on a copy. */
export function shuffled<T>(items: readonly T[], random: Random = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/** A small seeded random generator (mulberry32), for repeatable tests. */
export function seededRandom(seed: number): Random {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildDeck(
  words: readonly DeckWord[],
  options: DeckOptions,
  random: Random = Math.random,
): Card[] {
  const playable = words.filter((w) => w.clips.length > 0);
  const ordered = options.shuffle ? shuffled(playable, random) : [...playable];
  const limited = options.limit ? ordered.slice(0, options.limit) : ordered;
  return limited.map((word, i) => {
    const direction: Direction =
      options.direction === "mixed" ? (random() < 0.5 ? "w2s" : "s2w") : options.direction;
    // The first clip is the primary one; extra clips are alternatives shown in the dictionary.
    const clip = word.clips[0] as DeckClip;
    return { key: `${word.id}:${direction}:${i}`, word, direction, clip };
  });
}
