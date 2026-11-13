import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-bold transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 cursor-pointer",
  {
    variants: {
      variant: {
        default: "border-2 border-ink bg-primary text-primary-foreground hover:bg-primary/85",
        destructive: "border-2 border-ink bg-destructive text-destructive-foreground hover:bg-destructive/85",
        success: "border-2 border-ink bg-success text-success-foreground hover:bg-success/85",
        sun: "border-2 border-ink bg-sun text-on-crayon hover:bg-sun/85",
        berry: "border-2 border-ink bg-berry text-on-crayon hover:bg-berry/85",
        outline: "border-2 border-ink bg-card hover:bg-sun-soft",
        secondary: "bg-muted text-foreground hover:bg-muted/70",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-12 rounded-lg px-6 text-base [&_svg]:size-5",
        xl: "h-16 rounded-lg px-6 text-lg font-display font-semibold [&_svg]:size-6",
        icon: "size-10",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export function Button({
  className,
  variant,
  size,
  asChild = false,
  type = "button",
  ...props
}: ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      className={cn(buttonVariants({ variant, size, className }))}
      {...(asChild ? {} : { type })}
      {...props}
    />
  );
}
