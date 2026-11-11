import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode, Suspense, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";

import { Spinner } from "@/components/common";
import { EnvironmentBanner } from "@/components/EnvironmentBanner";
import { meQuery, queryClient } from "@/lib/api";
import { applyLocale, resolveLocale, storedLocale, subscribeStoredLocale } from "@/lib/i18n";
import { makeRouter } from "@/router";

import "./index.css";

const router = makeRouter(queryClient);

/**
 * Renders the app in the user's language. A new language remounts the tree under a new key,
 * so every component reads the new text; the router keeps its place.
 */
function App() {
  const { data: me } = useQuery(meQuery);
  // The device's choice matters before logging in; subscribing re-renders when it changes.
  useSyncExternalStore(subscribeStoredLocale, storedLocale);
  const locale = resolveLocale(me);
  // `t` must hold the new text before the children render.
  applyLocale(locale);
  return (
    <div key={locale} className="contents">
      <EnvironmentBanner />
      <Suspense fallback={<Spinner className="p-6" />}>
        <RouterProvider router={router} />
      </Suspense>
    </div>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
