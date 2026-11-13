import { t } from "@vgt/core";
import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Link,
  Outlet,
  redirect,
} from "@tanstack/react-router";

import { ErrorView } from "@/components/common";
import { AdminLayout, AppLayout } from "@/components/Layout";
import { isStaff, meQuery } from "@/lib/api";
import { JoinPage, LoginPage, RecoverPage } from "@/pages/auth";
import { DictionaryPage, DifficultPage, validateDictionarySearch, WordPage } from "@/pages/Dictionary";
import { HomePage } from "@/pages/Home";
import { PracticePage, validatePracticeSearch } from "@/pages/Practice";
import { ProfilePage } from "@/pages/Profile";
import { SwitchSchoolPage, validateSwitchSearch } from "@/pages/SwitchSchool";
import { validateAdminWordsSearch } from "@/pages/admin/Words";

interface Context {
  queryClient: QueryClient;
}

function NotFound() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-start gap-4 px-4 py-16">
      <p>{t.app.notFound}</p>
      <Link to="/" className="text-primary hover:underline">
        {t.app.backHome}
      </Link>
    </div>
  );
}

const rootRoute = createRootRouteWithContext<Context>()({
  component: Outlet,
  notFoundComponent: NotFound,
  errorComponent: ({ error, reset }) => (
    <div className="mx-auto max-w-xl p-6">
      <ErrorView error={error} onRetry={reset} />
    </div>
  ),
});

// --- public ---------------------------------------------------------------------------------

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  validateSearch: (s: Record<string, unknown>): { redirect?: string } => ({
    redirect: typeof s.redirect === "string" ? s.redirect : undefined,
  }),
  component: LoginPage,
});
const joinRoute = createRoute({ getParentRoute: () => rootRoute, path: "/join/$code", component: JoinPage });
const recoverRoute = createRoute({ getParentRoute: () => rootRoute, path: "/recover", component: RecoverPage });

// --- students (any logged-in user) ----------------------------------------------------------

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "app",
  beforeLoad: async ({ context, location }) => {
    const me = await context.queryClient.ensureQueryData(meQuery);
    if (!me) throw redirect({ to: "/login", search: { redirect: location.href } });
  },
  component: AppLayout,
});

const homeRoute = createRoute({ getParentRoute: () => appRoute, path: "/", component: HomePage });

const practiceRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/practice",
  validateSearch: validatePracticeSearch,
  component: function Practice() {
    const search = practiceRoute.useSearch();
    // A new key restarts the session when the selection changes.
    return <PracticePage key={JSON.stringify(search)} search={search} />;
  },
});

const difficultRoute = createRoute({ getParentRoute: () => appRoute, path: "/difficult", component: DifficultPage });

const dictionaryRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/dictionary",
  validateSearch: validateDictionarySearch,
  component: function Dictionary() {
    return <DictionaryPage search={dictionaryRoute.useSearch()} />;
  },
});

const wordRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/dictionary/$wordId",
  component: function Word() {
    const { wordId } = wordRoute.useParams();
    return <WordPage key={wordId} wordId={Number(wordId)} />;
  },
});

const profileRoute = createRoute({ getParentRoute: () => appRoute, path: "/profile", component: ProfilePage });

// A full page to switch school, outside the app and admin layouts: both link to it.
const switchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/switch",
  validateSearch: validateSwitchSearch,
  beforeLoad: async ({ context, location }) => {
    const me = await context.queryClient.ensureQueryData(meQuery);
    if (!me) throw redirect({ to: "/login", search: { redirect: location.href } });
  },
  component: function SwitchSchool() {
    return <SwitchSchoolPage search={switchRoute.useSearch()} />;
  },
});

// --- teachers (/admin) ----------------------------------------------------------------------

const adminRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin",
  beforeLoad: async ({ context, location }) => {
    const me = await context.queryClient.ensureQueryData(meQuery);
    if (!me) throw redirect({ to: "/login", search: { redirect: location.href } });
    if (!isStaff(me) && !me.is_superadmin) throw redirect({ to: "/" });
  },
  component: AdminLayout,
});

// The school pages need a school in which the user is staff. A superadmin without one
// (for example before the first school exists) goes to the list of schools.
const staffOnly = async ({ context }: { context: Context }) => {
  const me = await context.queryClient.ensureQueryData(meQuery);
  if (!isStaff(me)) throw redirect({ to: me?.is_superadmin ? "/admin/schools" : "/" });
};

// Admin pages load as a separate chunk, so students never download them.
const adminWordsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: "/",
  validateSearch: validateAdminWordsSearch,
  beforeLoad: staffOnly,
  component: lazyRouteComponent(() => import("@/pages/admin/routes"), "AdminWords"),
});
const adminWordRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: "/words/$wordId",
  beforeLoad: staffOnly,
  component: lazyRouteComponent(() => import("@/pages/admin/routes"), "AdminWord"),
});
const recordingsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: "/recordings",
  beforeLoad: staffOnly,
  component: lazyRouteComponent(() => import("@/pages/admin/Recordings"), "RecordingsPage"),
});
const recordingRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: "/recordings/$recordingId",
  beforeLoad: staffOnly,
  component: lazyRouteComponent(() => import("@/pages/admin/routes"), "AdminRecording"),
});
const groupsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: "/groups",
  beforeLoad: staffOnly,
  component: lazyRouteComponent(() => import("@/pages/admin/Groups"), "GroupsPage"),
});
const groupRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: "/groups/$groupId",
  beforeLoad: staffOnly,
  component: lazyRouteComponent(() => import("@/pages/admin/routes"), "AdminGroup"),
});
const movesRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: "/moves",
  beforeLoad: staffOnly,
  component: lazyRouteComponent(() => import("@/pages/admin/Users"), "MovesPage"),
});
const usersRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: "/users",
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.ensureQueryData(meQuery);
    if (me?.role !== "admin") throw redirect({ to: "/admin" });
  },
  component: lazyRouteComponent(() => import("@/pages/admin/Users"), "UsersPage"),
});
const schoolsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: "/schools",
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.ensureQueryData(meQuery);
    if (!me?.is_superadmin) throw redirect({ to: "/admin" });
  },
  component: lazyRouteComponent(() => import("@/pages/admin/Schools"), "SchoolsPage"),
});

export const routeTree = rootRoute.addChildren([
  loginRoute,
  joinRoute,
  recoverRoute,
  switchRoute,
  appRoute.addChildren([homeRoute, practiceRoute, difficultRoute, dictionaryRoute, wordRoute, profileRoute]),
  adminRoute.addChildren([
    adminWordsRoute,
    adminWordRoute,
    recordingsRoute,
    recordingRoute,
    groupsRoute,
    groupRoute,
    movesRoute,
    usersRoute,
    schoolsRoute,
  ]),
]);


export function makeRouter(queryClient: QueryClient) {
  return createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: "intent",
    scrollRestoration: true,
    defaultPendingMinMs: 0,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof makeRouter>;
  }
}
