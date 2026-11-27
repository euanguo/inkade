import type { PropertyOptionColor } from "@inkade/core";
import type React from "react";
import { cn } from "../lib/utils.ts";

export const PROPERTY_OPTION_COLOR_STYLES: Readonly<
  Record<
    PropertyOptionColor,
    {
      readonly badgeClass: string;
      readonly dotClass: string;
      readonly laneTintClass: string;
    }
  >
> = {
  indigo: {
    badgeClass: "border-indigo-500/25 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
    dotClass: "bg-indigo-500",
    laneTintClass: "border-indigo-500/25 bg-indigo-500/[0.04]",
  },
  blue: {
    badgeClass: "border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-300",
    dotClass: "bg-blue-500",
    laneTintClass: "border-blue-500/25 bg-blue-500/[0.04]",
  },
  teal: {
    badgeClass: "border-teal-500/25 bg-teal-500/10 text-teal-700 dark:text-teal-300",
    dotClass: "bg-teal-500",
    laneTintClass: "border-teal-500/25 bg-teal-500/[0.04]",
  },
  emerald: {
    badgeClass: "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    dotClass: "bg-emerald-500",
    laneTintClass: "border-emerald-500/25 bg-emerald-500/[0.04]",
  },
  amber: {
    badgeClass: "border-amber-500/25 bg-amber-500/10 text-amber-800 dark:text-amber-300",
    dotClass: "bg-amber-500",
    laneTintClass: "border-amber-500/25 bg-amber-500/[0.04]",
  },
  orange: {
    badgeClass: "border-orange-500/25 bg-orange-500/10 text-orange-700 dark:text-orange-300",
    dotClass: "bg-orange-500",
    laneTintClass: "border-orange-500/25 bg-orange-500/[0.04]",
  },
  rose: {
    badgeClass: "border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-300",
    dotClass: "bg-rose-500",
    laneTintClass: "border-rose-500/25 bg-rose-500/[0.04]",
  },
  pink: {
    badgeClass: "border-pink-500/25 bg-pink-500/10 text-pink-700 dark:text-pink-300",
    dotClass: "bg-pink-500",
    laneTintClass: "border-pink-500/25 bg-pink-500/[0.04]",
  },
  violet: {
    badgeClass: "border-violet-500/25 bg-violet-500/10 text-violet-700 dark:text-violet-300",
    dotClass: "bg-violet-500",
    laneTintClass: "border-violet-500/25 bg-violet-500/[0.04]",
  },
  slate: {
    badgeClass: "border-slate-500/25 bg-slate-500/10 text-slate-700 dark:text-slate-300",
    dotClass: "bg-slate-500",
    laneTintClass: "border-border bg-muted/35",
  },
};

export function getPropertyOptionColorStyle(color?: PropertyOptionColor | null) {
  if (!color) return PROPERTY_OPTION_COLOR_STYLES.slate;
  return PROPERTY_OPTION_COLOR_STYLES[color] ?? PROPERTY_OPTION_COLOR_STYLES.slate;
}

export function PropertyOptionPill({
  label,
  color,
  className,
}: {
  readonly label: string;
  readonly color?: PropertyOptionColor | null | undefined;
  readonly className?: string | undefined;
}): React.ReactElement {
  const style = getPropertyOptionColorStyle(color);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] leading-tight font-medium whitespace-nowrap",
        style.badgeClass,
        className,
      )}
    >
      <span className={cn("size-1.5 shrink-0 rounded-full", style.dotClass)} />
      <span className="truncate">{label}</span>
    </span>
  );
}
