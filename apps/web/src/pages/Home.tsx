import { type DirectionChoice, t } from "@vgt/core";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Flame, List, Play, Sparkles } from "lucide-react";
import { useState } from "react";

import { ErrorView, Field, PageTitle, Spinner } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { catalogQuery, difficultQuery, meQuery } from "@/lib/api";
import { cn } from "@/lib/utils";

type Scope = "year" | "lesson";

const segmentTones = {
  sky: "bg-sky",
  mint: "bg-mint",
  tangerine: "bg-tangerine",
  grape: "bg-grape",
  sun: "bg-sun",
};

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  tone = "sky",
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  tone?: keyof typeof segmentTones;
}) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-sm font-bold">{label}</legend>
      <div className="grid auto-cols-fr grid-flow-col gap-1 rounded-[1.4rem] border-2 border-ink/80 bg-muted p-1">
        {options.map((o) => (
          <label
            key={o.value}
            className={cn(
              "flex cursor-pointer items-center justify-center rounded-[1.1rem] border-2 px-2 py-1.5 text-center text-sm leading-tight font-bold text-balance transition-all sm:px-3 has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-ring",
              value === o.value
                ? cn("border-ink text-on-crayon", segmentTones[tone])
                : "border-transparent text-muted-foreground hover:bg-card hover:text-foreground",
            )}
          >
            <input
              type="radio"
              className="sr-only"
              checked={value === o.value}
              onChange={() => onChange(o.value)}
            />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function HomePage() {
  const { data: me } = useSuspenseQuery(meQuery);
  const catalog = useQuery(catalogQuery);
  const difficult = useQuery(difficultQuery);
  const navigate = useNavigate();

  const groupYear = me?.group?.year;
  const years = catalog.data?.years ?? [];
  const [yearChoice, setYear] = useState<number | null>(null);
  const year =
    yearChoice ?? (years.some((y) => y.year === groupYear) ? groupYear : years[0]?.year) ?? null;
  const yearData = years.find((y) => y.year === year);

  const [scope, setScope] = useState<Scope>("lesson");
  const [lesson, setLesson] = useState<number | null>(null);
  const [direction, setDirection] = useState<DirectionChoice>("mixed");
  const [shuffle, setShuffle] = useState(true);

  const lessonValue = lesson ?? yearData?.lessons[0] ?? null;
  const count =
    scope === "year"
      ? (yearData?.count ?? 0)
      : (yearData?.lists.filter((l) => l.lesson === lessonValue).reduce((a, l) => a + l.count, 0) ?? 0);

  const start = () => {
    if (year == null) return;
    void navigate({
      to: "/practice",
      search: {
        year,
        ...(scope === "lesson" && lessonValue != null ? { lesson: lessonValue } : {}),
        direction,
        shuffle,
      },
    });
  };

  return (
    <div className="flex flex-col">
      <PageTitle>{t.practice.title}</PageTitle>
      {catalog.isPending ? (
        <Spinner />
      ) : catalog.isError ? (
        <ErrorView error={catalog.error} onRetry={() => void catalog.refetch()} />
      ) : years.length === 0 ? (
        <p className="text-muted-foreground">{t.practice.noWords}</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
          <Card className="animate-pop-in">
            <CardHeader>
              <CardDescription className="text-base">{t.practice.intro}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              {years.length > 1 && (
                <Segmented
                  label={t.practice.year}
                  value={String(year)}
                  tone="grape"
                  options={years.map((y) => ({ value: String(y.year), label: t.app.year(y.year) }))}
                  onChange={(v) => {
                    setYear(Number(v));
                    setLesson(null);
                  }}
                />
              )}
              <Segmented<Scope>
                label={t.practice.what}
                tone="sky"
                value={scope}
                options={[
                  { value: "lesson", label: t.practice.byLesson },
                  { value: "year", label: t.practice.wholeYear },
                ]}
                onChange={setScope}
              />
              {scope === "lesson" && (
                <Field label={t.practice.lesson}>
                  {(p) => (
                    <Select {...p} value={lessonValue ?? ""} onChange={(e) => setLesson(Number(e.target.value))}>
                      {yearData?.lessons.map((l) => (
                        <option key={l} value={l}>
                          {t.app.lesson(l)}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              )}
              <Segmented<DirectionChoice>
                label={t.practice.direction}
                tone="mint"
                value={direction}
                options={[
                  { value: "s2w", label: t.practice.s2w },
                  { value: "w2s", label: t.practice.w2s },
                  { value: "mixed", label: t.practice.mixed },
                ]}
                onChange={setDirection}
              />
              <Segmented
                label={t.practice.order}
                tone="sun"
                value={shuffle ? "shuffle" : "course"}
                options={[
                  { value: "shuffle", label: t.practice.shuffle },
                  { value: "course", label: t.practice.courseOrder },
                ]}
                onChange={(v) => setShuffle(v === "shuffle")}
              />
              <Button size="xl" className="mt-2 bg-tangerine text-on-crayon" onClick={start} disabled={count === 0}>
                <Play aria-hidden className="fill-current" />
                {t.practice.startCount(count)}
              </Button>
            </CardContent>
          </Card>

          <Card className="relative h-fit animate-pop-in overflow-hidden bg-berry-soft [animation-delay:80ms]">
            <Sparkles className="absolute top-3 right-3 size-6 animate-float text-berry" aria-hidden />
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <span className="sticker-sm flex size-9 items-center justify-center rounded-full bg-berry text-white">
                  <Flame className="size-5" aria-hidden />
                </span>
                {t.practice.difficultTitle}
              </CardTitle>
              <CardDescription>{t.practice.difficultIntro}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {difficult.data && difficult.data.length > 0 ? (
                <>
                  <p className="font-display text-3xl font-semibold">{t.app.words(difficult.data.length)}</p>
                  <Button asChild variant="outline">
                    <Link to="/difficult">
                      <List aria-hidden /> {t.practice.viewDifficult}
                    </Link>
                  </Button>
                  <Button asChild variant="berry">
                    <Link to="/practice" search={{ difficult: true, direction, shuffle: true }}>
                      {t.practice.practiseDifficult}
                    </Link>
                  </Button>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">{t.practice.difficultEmpty}</p>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
