import { t } from "@signa/core";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, Outlet, useNavigate } from "@tanstack/react-router";
import {
  BookOpen,
  CircleUser,
  Dumbbell,
  Film,
  Flag,
  School,
  ListChecks,
  LogOut,
  type LucideIcon,
  Settings,
  Shuffle,
  Users,
  UserCog,
} from "lucide-react";

import { ContextSwitcher } from "@/components/ContextSwitcher";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api, isStaff, meQuery, unwrap } from "@/lib/api";
import { cn } from "@/lib/utils";

interface NavItem {
  to: string;
  label: string;
  short?: string;
  icon: LucideIcon;
  exact?: boolean;
  /** Classes for the item's own colour when it is the current page. */
  tone?: keyof typeof tones;
  /** A number shown next to the label, e.g. open reports. */
  count?: number;
}

/** Each student page has its own crayon colour. */
const tones = {
  practice: "bg-tangerine-soft text-foreground [&_svg]:text-tangerine",
  dictionary: "bg-sky-soft text-foreground [&_svg]:text-sky",
  profile: "bg-mint-soft text-foreground [&_svg]:text-mint",
  admin: "bg-grape-soft text-foreground [&_svg]:text-grape",
};
const bubbleTones = {
  practice: "[&>span]:bg-tangerine",
  dictionary: "[&>span]:bg-sky",
  profile: "[&>span]:bg-mint",
};

function useLogout() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: () => api.POST("/api/v1/auth/logout"),
    onSettled: () => {
      qc.clear();
      qc.setQueryData(meQuery.queryKey, null);
      void navigate({ to: "/login" });
    },
  });
}

function SkipLink() {
  return (
    <a
      href="#main"
      className="sr-only z-50 rounded-md bg-primary px-3 py-2 font-bold text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
    >
      {t.app.skipToContent}
    </a>
  );
}

function Brand({ to = "/", compact = false }: { to?: string; compact?: boolean }) {
  return (
    <Link to={to} className="group flex shrink-0 items-center gap-2 whitespace-nowrap">
      <img src="/favicon.svg" alt="" className="size-9 -rotate-6 transition-transform group-hover:animate-wiggle" />
      <span className={cn("font-display text-xl font-semibold", compact && "hidden sm:inline")}>{t.app.name}</span>
    </Link>
  );
}

const linkClass =
  "flex items-center gap-2 whitespace-nowrap rounded-full border-2 border-transparent px-3 py-1.5 text-sm font-bold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";
const activeClass = "border-ink!";

export function AppLayout() {
  const { data: me } = useSuspenseQuery(meQuery);
  const logout = useLogout();
  const items: NavItem[] = [
    { to: "/", label: t.nav.practice, icon: Dumbbell, exact: true, tone: "practice" },
    { to: "/dictionary", label: t.nav.dictionary, icon: BookOpen, tone: "dictionary" },
    { to: "/profile", label: t.nav.profile, icon: CircleUser, tone: "profile" },
  ];

  return (
    <div className="flex min-h-dvh flex-col">
      <SkipLink />
      <header className="sticky top-0 z-30 border-b-2 border-ink bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-4 px-4">
          <Brand />
          <nav aria-label={t.nav.menu} className="hidden items-center gap-1 md:flex">
            {items.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={linkClass}
                activeProps={{ className: cn(activeClass, item.tone && tones[item.tone]), "aria-current": "page" }}
                activeOptions={{ exact: item.exact }}
              >
                <item.icon className="size-4" aria-hidden />
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="flex min-w-0 items-center gap-1">
            {me && <ContextSwitcher me={me} />}
            {(isStaff(me) || me?.is_superadmin) && (
              <Link to="/admin" className={linkClass}>
                <Settings className="size-4" aria-hidden />
                <span className="hidden sm:inline">{t.nav.admin}</span>
              </Link>
            )}
            <button type="button" className={cn(linkClass, "cursor-pointer")} onClick={() => logout.mutate()}>
              <LogOut className="size-4" aria-hidden />
              <span className="sr-only sm:not-sr-only">{t.nav.logout}</span>
            </button>
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 pt-8 pb-28 md:pb-12">
        {me?.org ? <Outlet /> : <NoSchool />}
      </main>
      <nav
        aria-label={t.nav.menu}
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-3 border-t-2 border-ink bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        {items.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className="flex flex-col items-center gap-0.5 py-1.5 text-xs font-bold text-muted-foreground"
            activeProps={{
              className: cn(
                "text-foreground [&>span]:border-ink [&>span]:text-on-crayon",
                item.tone && item.tone !== "admin" && bubbleTones[item.tone],
              ),
              "aria-current": "page",
            }}
            activeOptions={{ exact: item.exact }}
          >
            <span className="flex h-8 w-12 items-center justify-center rounded-full border-2 border-transparent transition-all">
              <item.icon className="size-5" aria-hidden />
            </span>
            {item.short ?? item.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

function NoSchool() {
  return (
    <Card className="mx-auto max-w-md">
      <CardHeader>
        <CardTitle>{t.context.noSchoolTitle}</CardTitle>
        <CardDescription>{t.context.noSchoolIntro}</CardDescription>
      </CardHeader>
      <CardContent>
        <Link to="/profile" className="text-sm text-primary hover:underline">
          {t.nav.profile}
        </Link>
      </CardContent>
    </Card>
  );
}

export function AdminLayout() {
  const { data: me } = useSuspenseQuery(meQuery);
  const logout = useLogout();
  // Same key as the reports page uses, so resolving a report updates the count.
  const openReports = useQuery({
    queryKey: ["admin", "reports", "count"],
    queryFn: () => unwrap(api.GET("/api/v1/admin/reports/count")),
    enabled: isStaff(me),
    refetchInterval: 5 * 60_000,
  });
  const items: NavItem[] = [
    ...(isStaff(me)
      ? [
          { to: "/admin", label: t.admin.words, icon: ListChecks, exact: true },
          { to: "/admin/recordings", label: t.admin.recordings, icon: Film },
          { to: "/admin/reports", label: t.report.adminTitle, icon: Flag, count: openReports.data },
          { to: "/admin/groups", label: t.admin.groups, icon: Users },
          { to: "/admin/moves", label: t.admin.moves, icon: Shuffle },
        ]
      : []),
    ...(me?.role === "admin" ? [{ to: "/admin/users", label: t.admin.users, icon: UserCog }] : []),
    ...(me?.is_superadmin ? [{ to: "/admin/schools", label: t.admin.schools, icon: School }] : []),
  ];
  return (
    <div className="flex min-h-dvh flex-col">
      <SkipLink />
      <header className="sticky top-0 z-30 border-b-2 border-ink bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
          <div className="flex items-center gap-3">
            <Brand to="/admin" compact />
            <span className="hidden max-w-48 truncate rounded-full border-2 border-ink bg-grape-soft px-2.5 py-0.5 text-xs font-bold sm:inline-block">
              {me?.org ? `${t.admin.title} · ${me.org.name}` : t.admin.title}
            </span>
          </div>
          <div className="flex min-w-0 items-center gap-1">
            {me && <ContextSwitcher me={me} admin />}
            <Link to="/" className={linkClass}>
              <Dumbbell className="size-4 sm:hidden" aria-hidden />
              <span className="sr-only sm:not-sr-only">{t.admin.toApp}</span>
            </Link>
            <button type="button" className={cn(linkClass, "cursor-pointer")} onClick={() => logout.mutate()}>
              <LogOut className="size-4" aria-hidden />
              <span className="sr-only sm:not-sr-only">{t.nav.logout}</span>
            </button>
          </div>
        </div>
        <nav aria-label={t.admin.title} className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 pb-2">
          {items.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={cn(linkClass, "shrink-0")}
              activeProps={{ className: cn(activeClass, tones.admin), "aria-current": "page" }}
              activeOptions={{ exact: item.exact }}
            >
              <item.icon className="size-4" aria-hidden />
              {item.label}
              {item.count ? (
                <span className="rounded-full bg-primary px-1.5 text-xs leading-5 text-primary-foreground">
                  {item.count}
                </span>
              ) : null}
            </Link>
          ))}
        </nav>
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
