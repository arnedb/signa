import * as D from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";

import { t } from "@vgt/core";

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  wide = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <D.Content
          className={`fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] ${wide ? "max-h-[calc(100dvh-2rem)] max-w-3xl overflow-y-auto" : "max-w-md"} -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-card p-6 shadow-lg`}
          {...(description ? {} : { "aria-describedby": undefined })}
        >
          <D.Title className="pr-8 text-lg font-semibold">{title}</D.Title>
          {description && (
            <D.Description className="mt-1 text-sm text-muted-foreground">{description}</D.Description>
          )}
          <div className="mt-4">{children}</div>
          <D.Close
            className="absolute top-4 right-4 rounded-sm p-1 text-muted-foreground hover:text-foreground"
            aria-label={t.app.close}
          >
            <X className="size-4" />
          </D.Close>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
