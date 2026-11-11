import { type DirectionChoice, t } from "@vgt/core";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Flame, Play } from "lucide-react";
import { useState } from "react";

import { ErrorView, Field, PageTitle, Spinner } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { catalogQuery, difficultQuery, meQuery } from "@/lib/api";
import { cn } from "@/lib/utils";

type Scope = "year" | "lesson" | "list";

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap gap-1 rounded-lg bg-muted p-1">
        {options.map((o) => (
          <label
            key={o.value}
            className={cn(
              "flex-1 cursor-pointer rounded-md px-3 py-2 text-center text-sm font-medium whitespace-nowrap transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring",
              value === o.value ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground",
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

  const [scope, setScope] = useState<Scope>("list");
  const [lesson, setLesson] = useState<number | null>(null);
  const [list, setList] = useState<string | null>(null);
  const [direction, setDirection] = useState<DirectionChoice>("s2w");
  const [shuffle, setShuffle] = useState(true);

  const lists = yearData?.lists.filter((l) => l.list_number) ?? [];
  const lessonValue = lesson ?? yearData?.lessons[0] ?? null;
  const listValue = list ?? lists[0]?.list_number ?? null;
  const count =
    scope === "year"
      ? (yearData?.count ?? 0)
      : scope === "lesson"
        ? (yearData?.lists.filter((l) => l.lesson === lessonValue).reduce((a, l) => a + l.count, 0) ?? 0)
        : (lists.find((l) => l.list_number === listValue)?.count ?? 0);

  const start = () => {
    if (year == null) return;
    void navigate({
      to: "/practice",
      search: {
        year,
        ...(scope === "lesson" && lessonValue != null ? { lesson: lessonValue } : {}),
        ...(scope === "list" && listValue ? { list: listValue } : {}),
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
          <Card>
            <CardHeader>
              <CardDescription>{t.practice.intro}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              {years.length > 1 && (
                <Segmented
                  label={t.practice.year}
                  value={String(year)}
                  options={years.map((y) => ({ value: String(y.year), label: t.app.year(y.year) }))}
                  onChange={(v) => {
                    setYear(Number(v));
                    setLesson(null);
                    setList(null);
                  }}
                />
              )}
              <Segmented<Scope>
                label={t.practice.what}
                value={scope}
                options={[
                  { value: "list", label: t.practice.byList },
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
              {scope === "list" && (
                <Field label={t.practice.list}>
                  {(p) => (
                    <Select {...p} value={listValue ?? ""} onChange={(e) => setList(e.target.value)}>
                      {lists.map((l) => (
                        <option key={l.list_number} value={l.list_number ?? ""}>
                          {t.app.list(l.list_number ?? "")} · {t.app.words(l.count)}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              )}
              <Segmented<DirectionChoice>
                label={t.practice.direction}
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
                value={shuffle ? "shuffle" : "course"}
                options={[
                  { value: "shuffle", label: t.practice.shuffle },
                  { value: "course", label: t.practice.courseOrder },
                ]}
                onChange={(v) => setShuffle(v === "shuffle")}
              />
              <Button size="lg" onClick={start} disabled={count === 0}>
                <Play aria-hidden />
                {t.practice.startCount(count)}
              </Button>
            </CardContent>
          </Card>

          <Card className="h-fit">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Flame className="size-5 text-warning" aria-hidden />
                {t.practice.difficultTitle}
              </CardTitle>
              <CardDescription>{t.practice.difficultIntro}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {difficult.data && difficult.data.length > 0 ? (
                <>
                  <p className="text-sm">{t.app.words(difficult.data.length)}</p>
                  <Button asChild variant="outline">
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
