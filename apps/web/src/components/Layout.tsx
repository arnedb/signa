import { t } from "@vgt/core";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, Outlet, useNavigate } from "@tanstack/react-router";
import {
  BookOpen,
  CircleUser,
  Dumbbell,
  Film,
  Flame,
  ListChecks,
  LogOut,
  type LucideIcon,
  Settings,
  Shuffle,
  Users,
  UserCog,
} from "lucide-react";

import { api, isStaff, meQuery } from "@/lib/api";
import { cn } from "@/lib/utils";

interface NavItem {
  to: string;
  label: string;
  short?: string;
  icon: LucideIcon;
  exact?: boolean;
}

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
      className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
    >
      {t.app.skipToContent}
    </a>
  );
}

function Brand({ to = "/" }: { to?: string }) {
  return (
    <Link to={to} className="flex items-center gap-2 font-semibold">
      <img src="/favicon.svg" alt="" className="size-7" />
      <span>{t.app.name}</span>
    </Link>
  );
}

const linkClass =
  "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground";
const activeClass = "bg-accent text-accent-foreground";

export function AppLayout() {
  const { data: me } = useSuspenseQuery(meQuery);
  const logout = useLogout();
  const items: NavItem[] = [
    { to: "/", label: t.nav.practice, icon: Dumbbell, exact: true },
    { to: "/difficult", label: t.nav.difficult, short: t.nav.difficultShort, icon: Flame },
    { to: "/dictionary", label: t.nav.dictionary, icon: BookOpen },
    { to: "/profile", label: t.nav.profile, icon: CircleUser },
  ];

  return (
    <div className="flex min-h-dvh flex-col">
      <SkipLink />
      <header className="sticky top-0 z-30 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-4">
          <Brand />
          <nav aria-label={t.nav.menu} className="hidden items-center gap-1 md:flex">
            {items.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={linkClass}
                activeProps={{ className: activeClass, "aria-current": "page" }}
                activeOptions={{ exact: item.exact }}
              >
                <item.icon className="size-4" aria-hidden />
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-1">
            {isStaff(me) && (
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
      <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 pt-6 pb-24 md:pb-10">
        <Outlet />
      </main>
      <nav
        aria-label={t.nav.menu}
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        {items.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className="flex flex-col items-center gap-0.5 py-2 text-xs text-muted-foreground"
            activeProps={{ className: "text-primary", "aria-current": "page" }}
            activeOptions={{ exact: item.exact }}
          >
            <item.icon className="size-5" aria-hidden />
            {item.short ?? item.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

export function AdminLayout() {
  const { data: me } = useSuspenseQuery(meQuery);
  const logout = useLogout();
  const items: NavItem[] = [
    { to: "/admin", label: t.admin.words, icon: ListChecks, exact: true },
    { to: "/admin/recordings", label: t.admin.recordings, icon: Film },
    { to: "/admin/groups", label: t.admin.groups, icon: Users },
    { to: "/admin/moves", label: t.admin.moves, icon: Shuffle },
    ...(me?.role === "admin" ? [{ to: "/admin/users", label: t.admin.users, icon: UserCog }] : []),
  ];
  return (
    <div className="flex min-h-dvh flex-col">
      <SkipLink />
      <header className="sticky top-0 z-30 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4">
          <div className="flex items-center gap-3">
            <Brand to="/admin" />
            <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">
              {t.admin.title}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Link to="/" className={linkClass}>
              {t.admin.toApp}
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
              activeProps={{ className: activeClass, "aria-current": "page" }}
              activeOptions={{ exact: item.exact }}
            >
              <item.icon className="size-4" aria-hidden />
              {item.label}
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
