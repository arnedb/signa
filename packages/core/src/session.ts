/**
 * Practice session state, as a pure reducer so web and mobile share it unchanged.
 *
 * Flow per card: question → reveal → answer "Kende ik" / "Kende ik niet".
 * At the end of a round the student can repeat the cards they missed.
 */

import type { Card, Direction } from "./deck";

export interface Answer {
  card: Card;
  correct: boolean;
  at: string;
}

export interface SessionState {
  cards: Card[];
  index: number;
  revealed: boolean;
  round: number;
  /** Answers in the current round. */
  answers: Answer[];
  /** Every answer in the session, all rounds, for saving results. */
  log: Answer[];
}

export type SessionAction =
  | { type: "reveal" }
  | { type: "answer"; correct: boolean; at?: string }
  | { type: "undo" }
  | { type: "repeatMissed" }
  | { type: "restart"; cards?: Card[] };

export function startSession(cards: Card[]): SessionState {
  return { cards, index: 0, revealed: false, round: 1, answers: [], log: [] };
}

export function isFinished(state: SessionState): boolean {
  return state.index >= state.cards.length;
}

export function currentCard(state: SessionState): Card | undefined {
  return state.cards[state.index];
}

export function missedCards(state: SessionState): Card[] {
  return state.answers.filter((a) => !a.correct).map((a) => a.card);
}

export function score(state: SessionState): { known: number; total: number } {
  return { known: state.answers.filter((a) => a.correct).length, total: state.answers.length };
}

export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case "reveal":
      return isFinished(state) ? state : { ...state, revealed: true };
    case "answer": {
      const card = currentCard(state);
      if (!card) return state;
      const answer: Answer = {
        card,
        correct: action.correct,
        at: action.at ?? new Date().toISOString(),
      };
      return {
        ...state,
        index: state.index + 1,
        revealed: false,
        answers: [...state.answers, answer],
        log: [...state.log, answer],
      };
    }
    case "undo": {
      if (state.index === 0 || state.answers.length === 0) return state;
      return {
        ...state,
        index: state.index - 1,
        revealed: true,
        answers: state.answers.slice(0, -1),
        log: state.log.slice(0, -1),
      };
    }
    case "repeatMissed": {
      const missed = missedCards(state);
      if (missed.length === 0) return state;
      return { ...state, cards: missed, index: 0, revealed: false, round: state.round + 1, answers: [] };
    }
    case "restart":
      return startSession(action.cards ?? state.cards);
  }
}

export interface ResultPayload {
  word_id: number;
  direction: Direction;
  correct: boolean;
  at: string;
}

export function toResults(answers: readonly Answer[]): ResultPayload[] {
  return answers.map((a) => ({
    word_id: a.card.word.id,
    direction: a.card.direction,
    correct: a.correct,
    at: a.at,
  }));
}
