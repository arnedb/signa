import type { ReportReason } from "@vgt/api-client";
import { t } from "@vgt/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Flag } from "lucide-react";
import { useState } from "react";

import { Field } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/input";
import { api, errorMessage, unwrap } from "@/lib/api";

export const REPORT_REASONS: ReportReason[] = ["wrong_sign", "cut_start", "cut_end", "quality", "other"];

/** A small button that opens a form to report a problem with one clip, with a comment. */
export function ReportClipButton({ clipId, className }: { clipId: number; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="sm" className={className} onClick={() => setOpen(true)}>
        <Flag aria-hidden /> {t.report.button}
      </Button>
      <Dialog open={open} onOpenChange={setOpen} title={t.report.title} description={t.report.intro}>
        {/* Mounted only while open, so the form starts empty each time. */}
        {open && <ReportForm clipId={clipId} onClose={() => setOpen(false)} />}
      </Dialog>
    </>
  );
}

function ReportForm({ clipId, onClose }: { clipId: number; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [comment, setComment] = useState("");
  const [missing, setMissing] = useState(false);
  const send = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST("/api/v1/clips/{clip_id}/reports", {
          params: { path: { clip_id: clipId } },
          body: { reason: reason as ReportReason, comment: comment.trim() },
        }),
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin", "reports"] }),
  });

  if (send.isSuccess) {
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="success" role="status">
          {t.report.thanks}
        </Alert>
        <Button className="self-end" onClick={onClose} autoFocus>
          {t.app.close}
        </Button>
      </div>
    );
  }

  const needsComment = reason === "other" && !comment.trim();
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (needsComment) {
          setMissing(true);
          return;
        }
        send.mutate();
      }}
    >
      {send.isError && <Alert tone="destructive">{errorMessage(send.error)}</Alert>}
      <fieldset className="flex flex-col gap-2 text-sm">
        <legend className="mb-2 font-medium">{t.report.reason}</legend>
        {REPORT_REASONS.map((r) => (
          <label key={r} className="flex cursor-pointer items-center gap-2">
            <input
              type="radio"
              name="reason"
              value={r}
              required
              checked={reason === r}
              onChange={() => setReason(r)}
            />
            {t.report.reasons[r]}
          </label>
        ))}
      </fieldset>
      <Field
        label={t.report.comment}
        hint={t.report.commentHint}
        error={missing && needsComment ? t.report.commentRequired : null}
      >
        {(p) => (
          <Textarea
            {...p}
            maxLength={1000}
            placeholder={t.report.commentPlaceholder}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        )}
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          {t.app.cancel}
        </Button>
        <Button type="submit" disabled={!reason || send.isPending}>
          {send.isPending ? t.report.sending : t.report.send}
        </Button>
      </div>
    </form>
  );
}
