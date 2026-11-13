import { useCallback, useState } from "react";

/** Lists are usually numbered "<lesson>.<part>": list "3.2" belongs to lesson 3. */
export function lessonOf(list: string): number | null {
  const head = list.trim().split(".")[0] ?? "";
  return /^\d+$/.test(head) ? Number(head) : null;
}

/**
 * A lesson field next to a list field. It suggests the lesson from the list number and follows
 * it, until someone types a lesson of their own. ``value`` is "" when there is no lesson.
 */
export function useLessonField(list: string) {
  const [typed, setTyped] = useState<string | null>(null);
  const guess = lessonOf(list);
  const value = typed ?? (guess == null ? "" : String(guess));
  const set = useCallback((v: string) => setTyped(v), []);
  /** Back to following the list number. */
  const reset = useCallback(() => setTyped(null), []);
  return {
    value,
    /** The lesson as a number, or null when the field is empty. */
    number: value.trim() === "" ? null : Number(value),
    set,
    reset,
  };
}
