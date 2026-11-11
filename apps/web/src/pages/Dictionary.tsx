import type { Word } from "@vgt/api-client";
import { t } from "@vgt/core";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Film, Search } from "lucide-react";
import { useDeferredValue, useState } from "react";

import { ErrorView, PageTitle, Spinner } from "@/components/common";
import { SignVideo } from "@/components/Video";
import { Button } from "@/components/ui/button";
import { Badge, Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { catalogQuery, difficultQuery, wordQuery, wordsQuery } from "@/lib/api";
import { useGlossLang } from "@/lib/i18n";

export interface DictionarySearch {
  q?: string;
  year?: number;
}

export function validateDictionarySearch(s: Record<string, unknown>): DictionarySearch {
  return {
    q: typeof s.q === "string" && s.q ? s.q : undefined,
    year: s.year != null && !Number.isNaN(Number(s.year)) ? Number(s.year) : undefined,
  };
}

function WordTile({ word }: { word: Word }) {
  const clip = word.clips[0];
  return (
    <Link
      to="/dictionary/$wordId"
      params={{ wordId: String(word.id) }}
      className="group flex items-center gap-3 rounded-lg border bg-card p-2 pr-3 shadow-xs hover:border-primary/50"
    >
      <div className="flex aspect-[4/3] w-20 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
        {clip?.thumb_url ? (
          <img src={clip.thumb_url} alt="" loading="lazy" className="size-full object-cover" />
        ) : (
          <Film className="size-5 text-muted-foreground" aria-hidden />
        )}
      </div>
      <div className="min-w-0">
        <p className="truncate font-medium group-hover:text-primary">{word.gloss}</p>
        <p className="text-xs text-muted-foreground">
          {[t.app.year(word.year), word.list_number && t.app.list(word.list_number)].filter(Boolean).join(" · ")}
        </p>
      </div>
    </Link>
  );
}

export function WordGrid({ words }: { words: Word[] }) {
  return (
    <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {words.map((w) => (
        <li key={w.id}>
          <WordTile word={w} />
        </li>
      ))}
    </ul>
  );
}

export function DictionaryPage({ search }: { search: DictionarySearch }) {
  const navigate = useNavigate();
  const [q, setQ] = useState(search.q ?? "");
  const deferred = useDeferredValue(q.trim());
  const catalog = useQuery(catalogQuery);
  const words = useQuery({ ...wordsQuery({ q: deferred || undefined, year: search.year }), placeholderData: (p) => p });

  const update = (next: DictionarySearch) =>
    void navigate({ to: "/dictionary", search: next, replace: true });

  return (
    <div>
      <PageTitle>{t.dictionary.title}</PageTitle>
      <div className="mb-5 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-3 left-3 size-4 text-muted-foreground" aria-hidden />
          <Input
            type="search"
            aria-label={t.dictionary.searchLabel}
            placeholder={t.dictionary.searchPlaceholder}
            className="pl-9"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              update({ ...search, q: e.target.value || undefined });
            }}
          />
        </div>
        <Select
          aria-label={t.practice.year}
          className="sm:w-40"
          value={search.year ?? ""}
          onChange={(e) => update({ ...search, year: e.target.value ? Number(e.target.value) : undefined })}
        >
          <option value="">{t.admin.allYears}</option>
          {catalog.data?.years.map((y) => (
            <option key={y.year} value={y.year}>
              {t.app.year(y.year)}
            </option>
          ))}
        </Select>
      </div>
      {words.isPending ? (
        <Spinner />
      ) : words.isError ? (
        <ErrorView error={words.error} onRetry={() => void words.refetch()} />
      ) : (
        <>
          <p className="mb-3 text-sm text-muted-foreground" aria-live="polite">
            {t.dictionary.results(words.data.length)}
          </p>
          {words.data.length === 0 ? <p>{t.dictionary.empty}</p> : <WordGrid words={words.data} />}
        </>
      )}
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
      <h1 className="text-3xl font-semibold tracking-tight" lang={glossLang}>
        {w.gloss}
      </h1>
      <div className="mt-2 mb-5 flex flex-wrap gap-2">
        <Badge>{t.app.year(w.year)}</Badge>
        {w.lesson != null && <Badge>{t.app.lesson(w.lesson)}</Badge>}
        {w.list_number && <Badge>{t.app.list(w.list_number)}</Badge>}
      </div>
      {clip ? (
        <Card className="p-3">
          <SignVideo src={clip.url} poster={clip.thumb_url} label={w.gloss} />
        </Card>
      ) : (
        <p className="text-muted-foreground">{t.dictionary.noVideo}</p>
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
        <WordGrid words={words.data} />
      )}
    </div>
  );
}
