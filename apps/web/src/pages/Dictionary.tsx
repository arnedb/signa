import type { Catalog, DifficultWord, Word } from "@vgt/api-client";
import { t } from "@vgt/core";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ChevronDown, Film, LoaderCircle, Pause, Play, Search, Snail, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { ErrorView, PageTitle, Spinner } from "@/components/common";
import { ReportClipButton } from "@/components/ReportClip";
import { SignVideo } from "@/components/Video";
import { Button } from "@/components/ui/button";
import { Badge, Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { catalogQuery, difficultQuery, meQuery, wordPagesQuery, wordQuery } from "@/lib/api";
import { useGlossLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export interface DictionarySearch {
  q?: string;
  year?: number;
  lesson?: number;
}

export function validateDictionarySearch(s: Record<string, unknown>): DictionarySearch {
  const num = (v: unknown) => (v != null && v !== "" && !Number.isNaN(Number(v)) ? Number(v) : undefined);
  return {
    q: typeof s.q === "string" && s.q ? s.q : undefined,
    year: num(s.year),
    lesson: num(s.lesson),
  };
}

/** A small sign video: plays on request, loops until paused, and can play at half speed. */
function WordTile({ word, detail, showPlace = true }: { word: Word; detail?: string; showPlace?: boolean }) {
  const clip = word.clips[0];
  const glossLang = useGlossLang();
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [slow, setSlow] = useState(false);
  // The play and pause buttons swap places; keep keyboard focus on whichever is shown.
  const playRef = useRef<HTMLButtonElement>(null);
  const pauseRef = useRef<HTMLButtonElement>(null);
  const moveFocus = useRef(false);
  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    (playing ? pauseRef : playRef).current?.focus();
  }, [playing]);

  useEffect(() => {
    const v = ref.current;
    // Loading a video resets playbackRate to defaultPlaybackRate, so set both.
    if (v) v.defaultPlaybackRate = v.playbackRate = slow ? 0.5 : 1;
  }, [slow]);

  const toggle = () => {
    const v = ref.current;
    if (!v) return;
    moveFocus.current = document.activeElement === playRef.current || document.activeElement === pauseRef.current;
    if (v.paused) void v.play().catch(() => setPlaying(false));
    else v.pause();
  };

  const roundButton =
    "flex size-8 cursor-pointer items-center justify-center rounded-full border-2 border-ink transition-colors [&_svg]:size-4";

  return (
    <div className="flex h-full flex-col gap-2 rounded-lg border-2 border-ink bg-card p-2">
      <div className="relative aspect-[4/3] overflow-hidden rounded-md border-2 border-ink bg-black">
        {clip ? (
          <>
            <video
              ref={ref}
              src={clip.url}
              poster={clip.thumb_url ?? undefined}
              loop
              muted
              playsInline
              preload="none"
              aria-label={word.gloss}
              className="size-full cursor-pointer object-contain"
              onClick={toggle}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
            />
            {!playing && (
              <button
                ref={playRef}
                type="button"
                className="group/play absolute inset-0 flex cursor-pointer items-center justify-center bg-black/15"
                aria-label={t.dictionary.play(word.gloss)}
                onClick={toggle}
              >
                <span className="flex size-12 items-center justify-center rounded-full border-2 border-ink bg-sun text-on-crayon transition-transform group-hover/play:scale-110">
                  <Play className="ml-0.5 size-6 fill-current" aria-hidden />
                </span>
              </button>
            )}
            <div className="pointer-events-none absolute inset-x-1.5 bottom-1.5 flex justify-between [&>button]:pointer-events-auto">
              {playing ? (
                <button
                  ref={pauseRef}
                  type="button"
                  className={cn(roundButton, "bg-card text-foreground hover:bg-sun-soft")}
                  aria-label={t.dictionary.pause(word.gloss)}
                  onClick={toggle}
                >
                  <Pause className="fill-current" aria-hidden />
                </button>
              ) : (
                <span />
              )}
              <button
                type="button"
                className={cn(
                  roundButton,
                  slow ? "bg-mint text-on-crayon" : "bg-card text-foreground hover:bg-mint-soft",
                )}
                aria-label={t.dictionary.slowMotion}
                aria-pressed={slow}
                title={t.dictionary.slowMotion}
                onClick={() => setSlow((x) => !x)}
              >
                <Snail />
              </button>
            </div>
          </>
        ) : (
          <div className="flex size-full items-center justify-center bg-sky-soft">
            <Film className="size-6 text-sky" aria-hidden />
          </div>
        )}
      </div>
      {/* One link for the name and its details, so the link says everything about the word. */}
      <Link
        to="/dictionary/$wordId"
        params={{ wordId: String(word.id) }}
        className="group/name block min-w-0 rounded-md px-1 pb-0.5"
      >
        <span
          className="block truncate font-display text-lg leading-snug font-medium group-hover/name:text-primary group-hover/name:underline"
          lang={glossLang}
        >
          {word.gloss}
        </span>
        {showPlace && (
          <span className="block text-xs text-muted-foreground">
            {[t.app.year(word.year), word.list_number && t.app.list(word.list_number)].filter(Boolean).join(" · ")}
          </span>
        )}
        {detail && <span className="block text-xs text-muted-foreground">{detail}</span>}
      </Link>
    </div>
  );
}

const tileGrid = "grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4";

export function WordGrid({ words, showPlace }: { words: Word[]; showPlace?: boolean }) {
  return (
    <ul className={tileGrid}>
      {words.map((w) => (
        <li key={w.id}>
          <WordTile word={w} showPlace={showPlace} />
        </li>
      ))}
    </ul>
  );
}

interface ListGroup {
  list: string | null;
  words: Word[];
}
interface LessonGroup {
  key: string;
  year: number;
  lesson: number | null;
  lists: ListGroup[];
}

/** Groups words (already in course order) by year and lesson, then by list. */
export function groupWords(words: Word[]): LessonGroup[] {
  const groups: LessonGroup[] = [];
  for (const w of words) {
    const key = `${w.year}:${w.lesson ?? "-"}`;
    let group = groups.find((g) => g.key === key);
    if (!group) {
      group = { key, year: w.year, lesson: w.lesson ?? null, lists: [] };
      groups.push(group);
    }
    const list = w.list_number ?? null;
    let listGroup = group.lists.find((l) => l.list === list);
    if (!listGroup) {
      listGroup = { list, words: [] };
      group.lists.push(listGroup);
    }
    listGroup.words.push(w);
  }
  return groups;
}

/** Waits until the value has stopped changing for a moment, so typing does not fire a request per key. */
function useDebounced<T>(value: T, ms = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

const lessonCount = (year: Catalog["years"][number], lesson: number) =>
  year.lists.filter((l) => l.lesson === lesson).reduce((a, l) => a + l.count, 0);

/** The table of contents: every year with its lessons, one under the other. */
function LessonNav({
  years,
  year,
  lesson,
  searching,
  onPick,
}: {
  years: Catalog["years"];
  year?: number;
  lesson?: number;
  searching: boolean;
  onPick: () => void;
}) {
  const item = (active: boolean) =>
    cn(
      "flex items-center justify-between gap-2 rounded-full border-2 px-3 py-1.5 text-sm font-bold transition-colors",
      active
        ? "border-ink bg-sun text-on-crayon"
        : "border-transparent text-muted-foreground hover:bg-card hover:text-foreground",
    );
  const count = (n: number, active: boolean) => (
    <span className={cn("text-xs tabular-nums", active ? "opacity-70" : "opacity-60")}>{n}</span>
  );
  return (
    <div className="flex flex-col gap-5">
      {/* Most recent first: the newest year on top, and the latest lesson first within a year. */}
      {[...years].sort((a, b) => b.year - a.year).map((y) => {
        return (
          <div key={y.year}>
            <h2 className="mb-1.5 px-3 font-display text-lg font-semibold">{t.app.year(y.year)}</h2>
            <ul className="flex flex-col gap-0.5">
              {[...y.lessons].sort((a, b) => b - a).map((l) => {
                const active = !searching && year === y.year && lesson === l;
                return (
                  <li key={l}>
                    <Link
                      to="/dictionary"
                      search={{ year: y.year, lesson: l }}
                      replace
                      onClick={onPick}
                      className={item(active)}
                      aria-current={active ? "page" : undefined}
                    >
                      {t.app.lesson(l)}
                      {count(lessonCount(y, l), active)}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

export function DictionaryPage({ search }: { search: DictionarySearch }) {
  const navigate = useNavigate();
  const { data: me } = useQuery(meQuery);
  const catalog = useQuery(catalogQuery);
  const [q, setQ] = useState(search.q ?? "");
  const [menuOpen, setMenuOpen] = useState(false);
  const term = useDebounced(q.trim());
  const searching = term.length > 0;

  const years = catalog.data?.years ?? [];
  const year =
    search.year ?? (years.some((y) => y.year === me?.group?.year) ? me?.group?.year : years[0]?.year) ?? undefined;
  const yearData = years.find((y) => y.year === year);
  // Without a choice, open the most recent lesson of the year (the top of the menu).
  const lessons = yearData?.lessons ?? [];
  const lesson =
    search.lesson != null && lessons.includes(search.lesson)
      ? search.lesson
      : lessons.length > 0
        ? Math.max(...lessons)
        : undefined;

  // Searching looks through every year; browsing shows one year, or one lesson of it.
  const filter = searching ? { q: term } : { year, lesson };
  const words = useInfiniteQuery({ ...wordPagesQuery(filter), enabled: searching || year != null });
  const loaded = words.data?.pages.flat() ?? [];

  const total = searching ? undefined : lesson != null && yearData ? lessonCount(yearData, lesson) : yearData?.count;
  const place = [year != null && t.app.year(year), lesson != null && t.app.lesson(lesson)]
    .filter(Boolean)
    .join(" · ");

  const setSearch = (value: string) => {
    setQ(value);
    void navigate({ to: "/dictionary", search: { ...search, q: value || undefined }, replace: true });
  };

  return (
    <div>
      <PageTitle>{t.dictionary.title}</PageTitle>

      <div className="relative mb-6">
        <Search
          className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          aria-label={t.dictionary.searchLabel}
          placeholder={t.dictionary.searchPlaceholder}
          className="h-12 rounded-full pr-11 pl-11 text-base md:text-base [&::-webkit-search-cancel-button]:hidden"
          value={q}
          onChange={(e) => setSearch(e.target.value)}
        />
        {q && (
          <button
            type="button"
            className="absolute top-1/2 right-3 flex size-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={t.dictionary.clearSearch}
            onClick={() => setSearch("")}
          >
            <X className="size-4" aria-hidden />
          </button>
        )}
      </div>

      <div className="grid gap-6 md:grid-cols-[12rem_1fr] md:gap-8">
        {years.length > 0 && (
          <nav aria-label={t.dictionary.lessons} className="md:sticky md:top-24 md:self-start">
            {/* On small screens the lessons fold away behind a button. */}
            <button
              type="button"
              className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-full border-2 border-ink bg-card px-4 py-2 text-sm font-bold md:hidden"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((o) => !o)}
            >
              <span>
                {t.dictionary.lessons}: <span className="text-muted-foreground">{searching ? "—" : place}</span>
              </span>
              <ChevronDown className={cn("size-4 transition-transform", menuOpen && "rotate-180")} aria-hidden />
            </button>
            <div
              className={cn(
                "mt-2 rounded-lg border-2 border-ink bg-card/70 p-2 md:mt-0 md:block md:border-0 md:bg-transparent md:p-0",
                menuOpen ? "block" : "hidden",
              )}
            >
              <LessonNav
                years={years}
                year={year}
                lesson={lesson}
                searching={searching}
                onPick={() => {
                  setQ("");
                  setMenuOpen(false);
                }}
              />
            </div>
          </nav>
        )}

        <div className="min-w-0">
          {catalog.isError ? (
            <ErrorView error={catalog.error} onRetry={() => void catalog.refetch()} />
          ) : words.isPending && (searching || year != null) ? (
            <Spinner />
          ) : words.isError ? (
            <ErrorView error={words.error} onRetry={() => void words.refetch()} />
          ) : loaded.length === 0 ? (
            <p className="text-muted-foreground">{t.dictionary.empty}</p>
          ) : (
            <>
              <p className="mb-4 text-sm font-bold text-muted-foreground" aria-live="polite">
                {searching
                  ? `${t.dictionary.searchResults(term)} · ${t.dictionary.results(loaded.length)}${words.hasNextPage ? "+" : ""}`
                  : total != null && words.hasNextPage
                    ? t.dictionary.shown(loaded.length, total)
                    : t.dictionary.results(loaded.length)}
              </p>
              <GroupedWords words={loaded} showYear={searching || years.length > 1} />
              {words.hasNextPage && (
                <LoadMore loading={words.isFetchingNextPage} onLoad={() => void words.fetchNextPage()} />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function GroupedWords({ words, showYear }: { words: Word[]; showYear: boolean }) {
  return (
    <div className="flex flex-col gap-8">
      {groupWords(words).map((g) => {
        const heading = g.lesson != null ? t.app.lesson(g.lesson) : t.dictionary.noLesson;
        return (
          <section key={g.key} aria-label={showYear ? `${t.app.year(g.year)} · ${heading}` : heading}>
            <h2 className="mb-3 flex items-center gap-3">
              <span className="rounded-full border-2 border-ink bg-sky px-4 py-1 font-display text-xl font-semibold text-on-crayon">
                {heading}
              </span>
              {showYear && <span className="text-sm font-bold text-muted-foreground">{t.app.year(g.year)}</span>}
              <span aria-hidden className="h-0.5 flex-1 rounded-full bg-ink/15" />
            </h2>
            <div className="flex flex-col gap-4 rounded-lg bg-sky-soft p-3 sm:p-4">
              {g.lists.map((l) => (
                <div key={l.list ?? "-"}>
                  {(g.lists.length > 1 || l.list) && (
                    <h3 className="mb-2 font-sans text-sm font-extrabold tracking-wide text-muted-foreground uppercase">
                      {l.list ? t.app.list(l.list) : t.dictionary.noList}
                    </h3>
                  )}
                  <WordGrid words={l.words} showPlace={false} />
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** Loads the next page when the button scrolls into view; the button also works by itself. */
function LoadMore({ loading, onLoad }: { loading: boolean; onLoad: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const onLoadRef = useRef(onLoad);
  onLoadRef.current = onLoad;
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) onLoadRef.current();
      },
      { rootMargin: "400px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div className="mt-6 flex justify-center">
      <Button ref={ref} variant="outline" disabled={loading} onClick={onLoad}>
        {loading && <LoaderCircle className="animate-spin" aria-hidden />}
        {t.dictionary.more}
      </Button>
    </div>
  );
}

export function WordPage({ wordId }: { wordId: number }) {
  const word = useQuery(wordQuery(wordId));
  const [active, setActive] = useState(0);
  const glossLang = useGlossLang();
  if (word.isPending) return <Spinner />;
  if (word.isError) return <ErrorView error={word.error} />;
  const w = word.data;
  const clip = w.clips[active] ?? w.clips[0];
  return (
    <div className="mx-auto max-w-2xl">
      <Button asChild variant="ghost" size="sm" className="mb-4 -ml-2">
        <Link to="/dictionary">
          <ArrowLeft aria-hidden /> {t.dictionary.back}
        </Link>
      </Button>
      <h1 className="squiggle w-fit font-display text-4xl font-semibold" lang={glossLang}>
        {w.gloss}
      </h1>
      <div className="mt-2 mb-5 flex flex-wrap gap-2">
        <Badge className="bg-grape-soft text-foreground">{t.app.year(w.year)}</Badge>
        {w.lesson != null && <Badge className="bg-sky-soft text-foreground">{t.app.lesson(w.lesson)}</Badge>}
        {w.list_number && <Badge className="bg-mint-soft text-foreground">{t.app.list(w.list_number)}</Badge>}
      </div>
      {clip ? (
        <Card className="rotate-[-0.5deg] bg-sky-soft p-3">
          <SignVideo src={clip.url} poster={clip.thumb_url} label={w.gloss} />
        </Card>
      ) : (
        <p className="text-muted-foreground">{t.dictionary.noVideo}</p>
      )}
      {clip && (
        <div className="mt-2 flex justify-end">
          <ReportClipButton key={clip.id} clipId={clip.id} className="text-muted-foreground" />
        </div>
      )}
      {w.clips.length > 1 && (
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={t.dictionary.clips(w.clips.length)}>
          {w.clips.map((c, i) => (
            <Button
              key={c.id}
              size="sm"
              variant={i === active ? "default" : "outline"}
              aria-pressed={i === active}
              onClick={() => setActive(i)}
            >
              {t.dictionary.clip(i + 1)}
            </Button>
          ))}
        </div>
      )}
      {w.notes && (
        <div className="mt-5">
          <h2 className="text-sm font-medium">{t.dictionary.notes}</h2>
          <p className="mt-1 whitespace-pre-line text-muted-foreground">{w.notes}</p>
        </div>
      )}
    </div>
  );
}

export function DifficultPage() {
  const words = useQuery(difficultQuery);
  return (
    <div>
      <Button asChild variant="ghost" size="sm" className="mb-4 -ml-2">
        <Link to="/">
          <ArrowLeft aria-hidden /> {t.practice.backToPractice}
        </Link>
      </Button>
      <PageTitle
        actions={
          words.data && words.data.length > 0 ? (
            <Button asChild>
              <Link to="/practice" search={{ difficult: true, direction: "s2w", shuffle: true }}>
                {t.practice.practiseDifficult}
              </Link>
            </Button>
          ) : null
        }
      >
        {t.practice.difficultTitle}
      </PageTitle>
      <p className="mb-5 text-muted-foreground">{t.practice.difficultIntro}</p>
      {words.isPending ? (
        <Spinner />
      ) : words.isError ? (
        <ErrorView error={words.error} />
      ) : words.data.length === 0 ? (
        <p>{t.practice.difficultEmpty}</p>
      ) : (
        <ul className={tileGrid}>
          {words.data.map((w) => (
            <li key={w.id}>
              <WordTile word={w} detail={difficultDirections(w)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function difficultDirections(word: DifficultWord): string {
  return word.directions.map((d) => (d === "w2s" ? t.practice.w2s : t.practice.s2w)).join(" · ");
}
