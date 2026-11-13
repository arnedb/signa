import { Check, Copy, LoaderCircle } from "lucide-react";
import { type ReactNode, useId, useState } from "react";

import { t } from "@signa/core";

import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/card";
import { Label } from "@/components/ui/input";
import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";

export function Spinner({ label = t.app.loading, className }: { label?: string; className?: string }) {
  return (
    <div role="status" className={cn("flex items-center gap-2 text-muted-foreground", className)}>
      <LoaderCircle className="size-5 animate-spin text-primary" aria-hidden />
      <span>{label}</span>
    </div>
  );
}

export function ErrorView({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <Alert tone="destructive" className="flex items-center justify-between gap-4">
      <span>
        {t.app.error} {errorMessage(error)}
      </span>
      {onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry}>
          {t.app.retry}
        </Button>
      )}
    </Alert>
  );
}

/** A label + control + hint/error, wired with ids for screen readers. */
export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  className?: string;
  children: (props: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean }) => ReactNode;
}) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function CopyButton({ value, label = t.app.copy }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={async () => {
        await navigator.clipboard?.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
      {copied ? t.app.copied : label}
    </Button>
  );
}

export function RecoveryCode({ code }: { code: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <code className="sticker-sm rounded-md bg-sun-soft px-4 py-3 font-mono text-xl tracking-widest select-all">
        {code}
      </code>
      <CopyButton value={code} />
    </div>
  );
}

export function PageTitle({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <h1 className="squiggle font-display text-3xl font-semibold sm:text-4xl">{children}</h1>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
