import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("sticker rounded-lg bg-card", className)} {...props} />;
}

export function CardHeader({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-1.5 p-5 pb-3", className)} {...props} />;
}

export function CardTitle({ className, ...props }: ComponentProps<"h2">) {
  return <h2 className={cn("font-display text-xl font-semibold leading-tight", className)} {...props} />;
}

export function CardDescription({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

export function CardContent({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("p-5 pt-0", className)} {...props} />;
}

export function Badge({
  className,
  tone = "muted",
  ...props
}: ComponentProps<"span"> & { tone?: "muted" | "primary" | "success" | "warning" | "destructive" }) {
  const tones = {
    muted: "bg-muted text-muted-foreground",
    primary: "bg-accent text-accent-foreground",
    success: "bg-mint-soft text-foreground",
    warning: "bg-sun-soft text-foreground",
    destructive: "bg-berry-soft text-destructive",
  };
  return (
    <span
      className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold", tones[tone], className)}
      {...props}
    />
  );
}

export function Alert({
  className,
  tone = "muted",
  ...props
}: ComponentProps<"div"> & { tone?: "muted" | "success" | "destructive" | "primary" }) {
  const tones = {
    muted: "bg-muted",
    primary: "bg-accent text-accent-foreground border-primary/40",
    success: "bg-mint-soft border-success/50",
    destructive: "bg-berry-soft border-destructive/50 text-destructive",
  };
  return (
    <div
      role={tone === "destructive" ? "alert" : "status"}
      className={cn("rounded-md border-2 px-4 py-3 text-sm font-medium", tones[tone], className)}
      {...props}
    />
  );
}
