import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";

import { Spinner } from "@/components/common";
import { EnvironmentBanner } from "@/components/EnvironmentBanner";
import { queryClient } from "@/lib/api";
import { makeRouter } from "@/router";

import "./index.css";

const router = makeRouter(queryClient);

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <EnvironmentBanner />
      <Suspense fallback={<Spinner className="p-6" />}>
        <RouterProvider router={router} />
      </Suspense>
    </QueryClientProvider>
  </StrictMode>,
);
