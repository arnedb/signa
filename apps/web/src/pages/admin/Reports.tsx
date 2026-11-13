import type { AdminReport } from "@vgt/api-client";
import { t } from "@vgt/core";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Check, Film, RotateCcw } from "lucide-react";
import { useState } from "react";

import { ErrorView, PageTitle, Spinner } from "@/components/common";
import { SignVideo } from "@/components/Video";
import { Button } from "@/components/ui/button";
import { Alert, Badge, Card } from "@/components/ui/card";
import { api, errorMessage, unwrap } from "@/lib/api";
import { formatDate } from "@/lib/utils";

type ReportState = "open" | "resolved" | "all";

export const reportsQuery = (state: ReportState, wordId?: number) => ({
  queryKey: ["admin", "reports", state, wordId ?? null],
  queryFn: () =>
    unwrap(api.GET("/api/v1/admin/reports", { params: { query: { state, word_id: wordId } } })),
});

export const openReportsCountQuery = {
  queryKey: ["admin", "reports", "count"],
  queryFn: () => unwrap(api.GET("/api/v1/admin/reports/count")),
};

function useReportAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: number; action: "resolve" | "reopen" }) => {
      const params = { params: { path: { report_id: id } } };
      return action === "resolve"
        ? unwrap(api.POST("/api/v1/admin/reports/{report_id}/resolve", params))
        : unwrap(api.POST("/api/v1/admin/reports/{report_id}/reopen", params));
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin", "reports"] }),
  });
}

export function ReportsPage() {
  const [state, setState] = useState<ReportState>("open");
  const reports = useQuery({ ...reportsQuery(state), placeholderData: keepPreviousData });
  return (
    <div>
      <PageTitle>{t.report.adminTitle}</PageTitle>
      <p className="mb-4 text-muted-foreground">{t.report.adminIntro}</p>
      <div className="mb-4 flex gap-1" role="group" aria-label={t.admin.status}>
        {(["open", "resolved", "all"] as const).map((s) => (
          <Button
            key={s}
            size="sm"
            variant={state === s ? "default" : "outline"}
            aria-pressed={state === s}
            onClick={() => setState(s)}
          >
            {t.report[s]}
          </Button>
        ))}
      </div>
      {reports.isPending ? (
        <Spinner />
      ) : reports.isError ? (
        <ErrorView error={reports.error} onRetry={() => void reports.refetch()} />
      ) : reports.data.length === 0 ? (
        <p className="text-muted-foreground">{t.report.empty}</p>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {reports.data.map((r) => (
            <li key={r.id}>
              <ReportCard report={r} showWord />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ReportCard({ report, showWord = false }: { report: AdminReport; showWord?: boolean }) {
  const action = useReportAction();
  const resolved = report.resolved_at != null;
  return (
    <Card className={`flex flex-col gap-3 p-4 ${resolved ? "opacity-70" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {showWord ? (
          <Link
            to="/admin/words/$wordId"
            params={{ wordId: String(report.word_id) }}
            className="font-medium text-primary hover:underline"
          >
            {report.gloss}
          </Link>
        ) : (
          <span />
        )}
        <Badge tone={resolved ? "success" : "warning"}>{t.report.reasons[report.reason]}</Badge>
      </div>
      {report.clip ? (
        showWord && (
          <SignVideo src={report.clip.url} poster={report.clip.thumb_url} autoPlay={false} controls loop={false} />
        )
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Film className="size-4" aria-hidden /> {t.report.clipGone}
        </p>
      )}
      {report.comment && <p className="text-sm whitespace-pre-line">{report.comment}</p>}
      <p className="text-xs text-muted-foreground">
        {t.report.by(report.user?.username ?? t.admin.system, formatDate(report.created_at, true))}
        {report.clip?.archived && ` · ${t.admin.archived}`}
      </p>
      {resolved && (
        <p className="text-xs text-muted-foreground">
          {t.report.resolvedBy(report.resolver?.username ?? t.admin.system, formatDate(report.resolved_at, true))}
        </p>
      )}
      {action.isError && <Alert tone="destructive">{errorMessage(action.error)}</Alert>}
      <div className="flex flex-wrap gap-2">
        {resolved ? (
          <Button size="sm" variant="outline" disabled={action.isPending} onClick={() => action.mutate({ id: report.id, action: "reopen" })}>
            <RotateCcw aria-hidden /> {t.report.reopen}
          </Button>
        ) : (
          <Button size="sm" variant="success" disabled={action.isPending} onClick={() => action.mutate({ id: report.id, action: "resolve" })}>
            <Check aria-hidden /> {t.report.resolve}
          </Button>
        )}
        {showWord && (
          <Button asChild size="sm" variant="ghost">
            <Link to="/admin/words/$wordId" params={{ wordId: String(report.word_id) }}>
              {t.report.toWord}
            </Link>
          </Button>
        )}
      </div>
    </Card>
  );
}

/** Open reports of a clip whose video no longer exists, on the word's admin page. */
export function OrphanReports({ reports }: { reports: AdminReport[] }) {
  if (reports.length === 0) return null;
  return (
    <Alert tone="primary" className="flex flex-col gap-3">
      <p className="font-medium">{t.report.openForWord(reports.length)}</p>
      <ul className="grid gap-3 sm:grid-cols-2">
        {reports.map((r) => (
          <li key={r.id}>
            <ReportCard report={r} />
          </li>
        ))}
      </ul>
    </Alert>
  );
}
