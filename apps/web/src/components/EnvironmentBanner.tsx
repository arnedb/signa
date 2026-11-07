import { t } from "@vgt/core";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { healthQuery } from "@/lib/api";

/** Marks the dev deployment, so nobody mistakes it for the real app. Nothing in pro. */
export function EnvironmentBanner() {
  const { data } = useQuery(healthQuery);
  const dev = data?.environment === "dev";

  useEffect(() => {
    if (dev && !document.title.startsWith("[DEV]")) document.title = `[DEV] ${document.title}`;
  }, [dev]);

  if (!dev) return null;
  return (
    <div className="bg-warning px-4 py-1 text-center text-xs font-medium text-black" role="note">
      {t.app.devBanner} <span className="opacity-70">({data.release.slice(0, 7)})</span>
    </div>
  );
}
