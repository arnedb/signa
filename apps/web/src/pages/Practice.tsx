import type { Word } from "@vgt/api-client";
import {
  buildDeck,
  type Card as DeckCard,
  currentCard,
  type DirectionChoice,
  isFinished,
  keyCommand,
  missedCards,
  score,
  sessionReducer,
  startSession,
  t,
  toResults,
} from "@vgt/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useGlossLang } from "@/lib/i18n";
import { Link } from "@tanstack/react-router";
import { Check, Eye, RotateCcw, Undo2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import { ErrorView, Spinner } from "@/components/common";
import { SignVideo } from "@/components/Video";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { api, difficultQuery, wordsQuery } from "@/lib/api";

export interface PracticeSearch {
  year?: number;
  lesson?: number;
  list?: string;
  difficult?: boolean;
  direction: DirectionChoice;
  shuffle: boolean;
}

export function validatePracticeSearch(s: Record<string, unknown>): PracticeSearch {
  const num = (v: unknown) => (v == null || v === "" || Number.isNaN(Number(v)) ? undefined : Number(v));
  const direction = ["w2s", "s2w", "mixed"].includes(s.direction as string)
    ? (s.direction as DirectionChoice)
    : "s2w";
  return {
    year: num(s.year),
    lesson: num(s.lesson),
    list: s.list != null ? String(s.list) : undefined,
    difficult: s.difficult === true || s.difficult === "true" || undefined,
    direction,
    shuffle: s.shuffle !== false && s.shuffle !== "false",
  };
}

export function PracticePage({ search }: { search: PracticeSearch }) {
  const filter = { year: search.year, lesson: search.lesson, list_number: search.list, with_clip: true };
  const listWords = useQuery({ ...wordsQuery(filter), enabled: !search.difficult });
  const difficultWords = useQuery({ ...difficultQuery, enabled: !!search.difficult });
  const words = search.difficult ? difficultWords : listWords;

  if (words.isPending) return <Spinner />;
  if (words.isError) return <ErrorView error={words.error} onRetry={() => void words.refetch()} />;
  return <Session words={words.data} search={search} />;
}

function title(search: PracticeSearch): string {
  if (search.difficult) return t.practice.difficultTitle;
  const parts = [search.year ? t.app.year(search.year) : null];
  if (search.lesson != null) parts.push(t.app.lesson(search.lesson));
  if (search.list) parts.push(t.app.list(search.list));
  return parts.filter(Boolean).join(" · ");
}

function Session({ words, search }: { words: Word[]; search: PracticeSearch }) {
  const qc = useQueryClient();
  const deck = useMemo(
    () => buildDeck(words, { direction: search.direction, shuffle: search.shuffle }),
    [words, search.direction, search.shuffle],
  );
  const [state, dispatch] = useReducer(sessionReducer, deck, startSession);
  const [saveError, setSaveError] = useState(false);
  const saved = useRef(0);
  const logRef = useRef(state.log);
  logRef.current = state.log;

  const save = useCallback(
    async (log = logRef.current) => {
      // Never save the same answer twice; an "undo" can shrink the log below what was saved.
      const pending = log.slice(saved.current);
      if (pending.length === 0) return;
      saved.current = log.length;
      const { error } = await api.POST("/api/v1/me/results", { body: { results: toResults(pending) } });
      setSaveError(Boolean(error));
      void qc.invalidateQueries({ queryKey: ["difficult"] });
    },
    [qc],
  );

  const finished = isFinished(state);
  useEffect(() => {
    if (finished) void save(state.log);
  }, [finished, save, state.log]);
  // Save what was answered when leaving the page halfway.
  useEffect(() => () => void save(), [save]);

  const card = currentCard(state);
  const answer = useCallback((correct: boolean) => dispatch({ type: "answer", correct }), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea, select, button")) {
        if (e.key === " " || e.key === "Enter") return; // let buttons handle their own keys
      }
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const cmd = keyCommand(e.key, state.revealed);
      if (!cmd || finished) return;
      e.preventDefault();
      if (cmd === "reveal") dispatch({ type: "reveal" });
      else if (cmd === "known") answer(true);
      else if (cmd === "unknown") answer(false);
      else if (cmd === "undo") dispatch({ type: "undo" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.revealed, finished, answer]);

  if (deck.length === 0) {
    return (
      <div className="flex flex-col items-start gap-4">
        <p className="text-muted-foreground">
          {search.difficult ? t.practice.difficultEmpty : t.practice.noWords}
        </p>
        <Button asChild variant="outline">
          <Link to="/">{t.practice.newChoice}</Link>
        </Button>
      </div>
    );
  }

  const progress = Math.min(state.index, state.cards.length);
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold">{title(search)}</h1>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {state.round > 1 && `${t.practice.round(state.round)} · `}
            {t.practice.progress(Math.min(progress + 1, state.cards.length), state.cards.length)}
          </p>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link to="/">
            <X aria-hidden /> {t.practice.stop}
          </Link>
        </Button>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={state.cards.length}
        aria-valuenow={progress}
        aria-label={t.practice.progress(progress, state.cards.length)}
      >
        <div
          className="h-full bg-primary transition-all"
          style={{ width: `${(progress / state.cards.length) * 100}%` }}
        />
      </div>

      {saveError && <Alert tone="destructive">{t.practice.saveFailed}</Alert>}

      {card ? (
        <PracticeCard
          card={card}
          revealed={state.revealed}
          canUndo={state.answers.length > 0}
          onReveal={() => dispatch({ type: "reveal" })}
          onAnswer={answer}
          onUndo={() => dispatch({ type: "undo" })}
        />
      ) : (
        <Done
          known={score(state).known}
          total={score(state).total}
          missed={missedCards(state)}
          onRepeat={() => dispatch({ type: "repeatMissed" })}
          onRestart={() => {
            saved.current = 0;
            dispatch({ type: "restart", cards: deck });
          }}
        />
      )}
      {/* Load the next video early so it starts at once. */}
      {state.cards[state.index + 1] && (
        <video src={state.cards[state.index + 1]?.clip.url} preload="auto" muted hidden aria-hidden />
      )}
    </div>
  );
}

function PracticeCard({
  card,
  revealed,
  canUndo,
  onReveal,
  onAnswer,
  onUndo,
}: {
  card: DeckCard;
  revealed: boolean;
  canUndo: boolean;
  onReveal: () => void;
  onAnswer: (correct: boolean) => void;
  onUndo: () => void;
}) {
  const glossLang = useGlossLang();
  const showVideo = card.direction === "s2w" || revealed;
  const showWord = card.direction === "w2s" || revealed;
  const knownRef = useRef<HTMLButtonElement>(null);
  const revealRef = useRef<HTMLButtonElement>(null);

  // Keep keyboard focus on the main action as the card changes.
  useEffect(() => {
    (revealed ? knownRef : revealRef).current?.focus({ preventScroll: true });
  }, [revealed, card.key]);

  return (
    <Card className="flex flex-col gap-4 p-4 sm:p-6">
      <p className="text-sm text-muted-foreground">
        {card.direction === "w2s" ? t.practice.showSign : t.practice.showWord}
      </p>
      <div className="flex min-h-16 items-center justify-center">
        {showWord ? (
          <p className="text-center text-3xl font-semibold tracking-tight sm:text-4xl" lang={glossLang}>
            {card.word.gloss}
          </p>
        ) : (
          <p className="text-3xl text-muted-foreground" aria-hidden>
            ?
          </p>
        )}
      </div>
      {showVideo ? (
        <SignVideo src={card.clip.url} poster={card.clip.thumb_url} label={revealed ? card.word.gloss : undefined} />
      ) : (
        <div className="flex aspect-[4/3] max-h-[45dvh] w-full items-center justify-center rounded-lg border-2 border-dashed text-muted-foreground">
          <Eye className="size-10" aria-hidden />
        </div>
      )}
      {revealed && card.word.notes && <p className="text-sm text-muted-foreground">{card.word.notes}</p>}

      {revealed ? (
        <div className="grid grid-cols-2 gap-3">
          <Button size="xl" variant="outline" onClick={() => onAnswer(false)} className="border-destructive/40">
            <X aria-hidden className="text-destructive" /> {t.practice.unknown}
          </Button>
          <Button ref={knownRef} size="xl" variant="success" onClick={() => onAnswer(true)}>
            <Check aria-hidden /> {t.practice.known}
          </Button>
        </div>
      ) : (
        <Button ref={revealRef} size="xl" onClick={onReveal}>
          <Eye aria-hidden /> {t.practice.reveal}
        </Button>
      )}
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="hidden sm:inline">{t.practice.keys}</span>
        <Button variant="ghost" size="sm" onClick={onUndo} disabled={!canUndo}>
          <Undo2 aria-hidden /> {t.practice.undo}
        </Button>
      </div>
    </Card>
  );
}

function Done({
  known,
  total,
  missed,
  onRepeat,
  onRestart,
}: {
  known: number;
  total: number;
  missed: DeckCard[];
  onRepeat: () => void;
  onRestart: () => void;
}) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <Card className="flex flex-col gap-5 p-6">
      <div>
        <h2 ref={ref} tabIndex={-1} className="text-2xl font-semibold">
          {t.practice.doneTitle}
        </h2>
        <p className="mt-1 text-muted-foreground">{t.practice.doneScore(known, total)}</p>
      </div>
      {missed.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-medium">{t.practice.missedList}</p>
          <ul className="flex flex-wrap gap-2">
            {missed.map((c) => (
              <li key={c.key}>
                <Link
                  to="/dictionary/$wordId"
                  params={{ wordId: String(c.word.id) }}
                  className="inline-block rounded-full bg-muted px-3 py-1 text-sm hover:bg-accent"
                >
                  {c.word.gloss}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap gap-3">
        {missed.length > 0 && (
          <Button size="lg" onClick={onRepeat}>
            <RotateCcw aria-hidden /> {t.practice.repeatMissed(missed.length)}
          </Button>
        )}
        <Button size="lg" variant="outline" onClick={onRestart}>
          {t.practice.again}
        </Button>
        <Button asChild size="lg" variant="ghost">
          <Link to="/">{t.practice.newChoice}</Link>
        </Button>
      </div>
    </Card>
  );
}
