"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import type React from "react";
import { cn } from "../lib/utils.ts";

export const badgeVariants = cva(
  "relative inline-flex shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-md border border-transparent font-medium outline-none transition-colors duration-[var(--duration-quick)] ease-[var(--ease-out-strong)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--border-focus)] disabled:pointer-events-none disabled:opacity-64 [&_svg:not([class*='opacity-'])]:opacity-80 [&_svg:not([class*='size-'])]:size-3.5 sm:[&_svg:not([class*='size-'])]:size-3 [&_svg]:pointer-events-none [&_svg]:shrink-0 [button&,a&]:cursor-pointer [button&,a&]:pointer-coarse:after:absolute [button&,a&]:pointer-coarse:after:size-full [button&,a&]:pointer-coarse:after:min-h-11 [button&,a&]:pointer-coarse:after:min-w-11",
  {
    defaultVariants: {
      size: "default",
      variant: "default",
    },
    variants: {
      size: {
        default: "h-5.5 min-w-5.5 px-2 text-xs",
        lg: "h-6 min-w-6 px-2.5 text-xs",
        sm: "h-5 min-w-5 px-1.5 text-xs",
      },
      variant: {
        default:
          "border-primary/22 bg-brand-subtle text-brand-subtle-foreground [button&,a&]:hover:bg-primary/14",
        destructive:
          "border-destructive/28 bg-destructive/14 text-destructive-foreground dark:border-destructive/32 dark:bg-destructive/20 [button&,a&]:hover:bg-destructive/20",
        error:
          "border-destructive/22 bg-destructive/10 text-destructive-foreground dark:border-destructive/28 dark:bg-destructive/16",
        info: "border-info/22 bg-info/10 text-info-foreground dark:border-info/28 dark:bg-info/16",
        outline:
          "border-input bg-background/70 text-foreground dark:bg-input/24 [button&,a&]:hover:bg-accent/50",
        secondary:
          "border-border/80 bg-muted/65 text-muted-foreground [button&,a&]:hover:bg-muted",
        success:
          "border-success/22 bg-success/10 text-success-foreground dark:border-success/28 dark:bg-success/16",
        warning:
          "border-warning/25 bg-warning/10 text-warning-foreground dark:border-warning/28 dark:bg-warning/16",
      },
    },
  },
);

export interface BadgeProps extends useRender.ComponentProps<"span"> {
  variant?: VariantProps<typeof badgeVariants>["variant"];
  size?: VariantProps<typeof badgeVariants>["size"];
}

export function Badge({
  className,
  variant,
  size,
  render,
  ...props
}: BadgeProps): React.ReactElement {
  const defaultProps = {
    className: cn(badgeVariants({ className, size, variant })),
    "data-slot": "badge",
  };

  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(defaultProps, props),
    render,
  });
}
