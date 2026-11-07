/** Keyboard practice: space reveals, → "Kende ik", ← "Kende ik niet". */

export type KeyCommand = "reveal" | "known" | "unknown" | "undo" | null;

export function keyCommand(key: string, revealed: boolean): KeyCommand {
  if (key === " " || key === "Spacebar" || key === "Enter") return revealed ? null : "reveal";
  if (key === "ArrowRight") return revealed ? "known" : null;
  if (key === "ArrowLeft") return revealed ? "unknown" : null;
  if (key === "Backspace" || key === "z") return "undo";
  return null;
}
