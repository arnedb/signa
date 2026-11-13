import type { DifficultWord, Word } from "@vgt/api-client";
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
import { Check, Eye, PartyPopper, RotateCcw, Undo2, X } from "lucide-react";
import { type CSSProperties, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import { ErrorView, Spinner } from "@/components/common";
import { ReportClipButton } from "@/components/ReportClip";
import { SignVideo } from "@/components/Video";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { api, difficultQuery, wordsQuery } from "@/lib/api";
import { cn } from "@/lib/utils";

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

/** Difficult words carry the directions in which they were difficult; only those are practised. */
type PracticeWord = Word | DifficultWord;

function Session({ words, search }: { words: PracticeWord[]; search: PracticeSearch }) {
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
      // Typing in the report dialog must not answer the card.
      if (e.target instanceof HTMLElement && e.target.closest('[role="dialog"]')) return;
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
          <h1 className="font-display text-2xl font-semibold">{title(search)}</h1>
          <p className="text-sm font-bold text-muted-foreground" aria-live="polite">
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
        className="h-4 overflow-hidden rounded-full border-2 border-ink bg-card"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={state.cards.length}
        aria-valuenow={progress}
        aria-label={t.practice.progress(progress, state.cards.length)}
      >
        <div
          className="h-full rounded-full bg-[linear-gradient(90deg,var(--color-tangerine),var(--color-berry),var(--color-grape),var(--color-sky),var(--color-mint))] bg-size-[var(--full)_100%] transition-all duration-500 ease-out"
          style={
            {
              width: `${(progress / state.cards.length) * 100}%`,
              // Stretch the rainbow over the whole bar, so it fills in rather than squashes.
              "--full": `${progress > 0 ? (state.cards.length / progress) * 100 : 100}%`,
            } as CSSProperties
          }
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
    <Card key={card.key} className="flex animate-pop-in flex-col gap-4 p-4 sm:p-6">
      <p
        className={cn(
          "self-start rounded-full border-2 border-ink px-3 py-1 text-xs font-bold text-on-crayon",
          card.direction === "w2s" ? "bg-sky" : "bg-sun",
        )}
      >
        {card.direction === "w2s" ? t.practice.showSign : t.practice.showWord}
      </p>
      <div className="flex min-h-16 items-center justify-center">
        {showWord ? (
          <p className="animate-pop-in text-center font-display text-4xl font-semibold sm:text-5xl" lang={glossLang}>
            {card.word.gloss}
          </p>
        ) : (
          <p className="animate-float font-display text-5xl font-bold text-grape" aria-hidden>
            ?
          </p>
        )}
      </div>
      {showVideo ? (
        <SignVideo src={card.clip.url} poster={card.clip.thumb_url} label={revealed ? card.word.gloss : undefined} />
      ) : (
        <div className="flex aspect-[4/3] max-h-[45dvh] w-full items-center justify-center rounded-lg border-[3px] border-dashed border-grape/60 bg-grape-soft text-grape">
          <Eye className="size-12 animate-float" aria-hidden />
        </div>
      )}
      {revealed && card.word.notes && <p className="text-sm text-muted-foreground">{card.word.notes}</p>}

      {revealed ? (
        <div className="grid grid-cols-2 gap-3">
          <Button size="xl" variant="outline" onClick={() => onAnswer(false)} className="bg-berry-soft hover:bg-berry-soft">
            <X aria-hidden className="text-destructive" strokeWidth={3} /> {t.practice.unknown}
          </Button>
          <Button ref={knownRef} size="xl" variant="success" onClick={() => onAnswer(true)}>
            <Check aria-hidden strokeWidth={3} /> {t.practice.known}
          </Button>
        </div>
      ) : (
        <Button ref={revealRef} size="xl" onClick={onReveal}>
          <Eye aria-hidden /> {t.practice.reveal}
        </Button>
      )}
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="hidden font-medium sm:inline">{t.practice.keys}</span>
        <div className="flex items-center gap-1">
          {/* Only after the answer is shown: a wrong sign is only clear once you see the word. */}
          {revealed && <ReportClipButton clipId={card.clip.id} />}
          <Button variant="ghost" size="sm" onClick={onUndo} disabled={!canUndo}>
            <Undo2 aria-hidden /> {t.practice.undo}
          </Button>
        </div>
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
  const ratio = total > 0 ? known / total : 0;
  return (
    <Card className="relative flex animate-pop-in flex-col gap-5 overflow-hidden p-6">
      {ratio >= 0.5 && <Confetti />}
      <div className="flex items-center gap-4">
        <span
          className={cn(
            "sticker flex size-16 shrink-0 items-center justify-center rounded-full text-on-crayon",
            ratio >= 0.8 ? "bg-mint" : ratio >= 0.5 ? "bg-sun" : "bg-sky",
          )}
        >
          <PartyPopper className="size-8 animate-wiggle" aria-hidden />
        </span>
        <div>
          <h2 ref={ref} tabIndex={-1} className="font-display text-3xl font-semibold">
            {t.practice.doneTitle}
          </h2>
          <p className="mt-1 text-lg font-bold text-muted-foreground">{t.practice.doneScore(known, total)}</p>
        </div>
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
                  className="inline-block rounded-full border-2 border-ink bg-berry-soft px-3 py-1 text-sm font-bold transition-colors hover:bg-berry/30"
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

const confettiColours = ["tangerine", "berry", "sun", "sky", "mint", "grape"].map((c) => `var(--color-${c})`);

/** A short burst of paper confetti; purely decorative. */
function Confetti() {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 h-64 overflow-hidden" aria-hidden>
      {Array.from({ length: 28 }, (_, i) => (
        <span
          key={i}
          className="absolute top-0 block rounded-[2px] opacity-0"
          style={{
            left: `${(i * 37) % 100}%`,
            width: i % 3 === 0 ? 6 : 8,
            height: i % 2 === 0 ? 12 : 8,
            background: confettiColours[i % confettiColours.length],
            animation: `confetti-fall ${1.6 + (i % 5) * 0.25}s ease-in ${(i % 7) * 0.08}s 1 both`,
          }}
        />
      ))}
    </div>
  );
}
