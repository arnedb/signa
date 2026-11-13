import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

const field =
  "flex w-full rounded-md border-2 border-ink/80 bg-card px-3 text-base placeholder:text-muted-foreground focus-visible:border-primary disabled:opacity-50 aria-[invalid=true]:border-destructive md:text-sm";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      className={cn(
        field,
        "h-10 py-2 file:mr-3 file:cursor-pointer file:rounded file:border-0 file:bg-muted file:px-2 file:text-sm file:font-medium",
        props.type === "file" && "h-auto py-1.5",
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(field, "min-h-20 py-2", className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cn(field, "select-chevron h-10 cursor-pointer py-0 pr-9", className)} {...props} />;
}

export function Label({ className, ...props }: ComponentProps<"label">) {
  return <label className={cn("text-sm font-bold leading-none", className)} {...props} />;
}
