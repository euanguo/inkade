"use client";

import { Input as InputPrimitive } from "@base-ui/react/input";
import type * as React from "react";
import { cn } from "../lib/utils.ts";

export type InputProps = Omit<
  InputPrimitive.Props & React.RefAttributes<HTMLInputElement>,
  "size"
> & {
  size?: "xs" | "sm" | "default" | "lg" | number;
  unstyled?: boolean;
  nativeInput?: boolean;
  startAddon?: React.ReactNode;
  endAddon?: React.ReactNode;
};

export function Input({
  className,
  size = "default",
  unstyled = false,
  nativeInput = false,
  startAddon,
  endAddon,
  style,
  ...props
}: InputProps): React.ReactElement {
  const inputClassName = cn(
    "h-8.5 w-full min-w-0 flex-1 rounded-[inherit] px-[calc(--spacing(3)-1px)] text-foreground leading-8.5 outline-none [transition:background-color_5000000s_ease-in-out_0s] placeholder:text-muted-foreground sm:h-7.5 sm:leading-7.5 autofill:[-webkit-text-fill-color:var(--foreground)]",
    size === "xs" &&
      "h-6.5 px-[calc(--spacing(2)-1px)] text-xs leading-6.5 sm:h-5.5 sm:leading-5.5",
    size === "sm" &&
      "h-7.5 px-[calc(--spacing(2.5)-1px)] leading-7.5 sm:h-6.5 sm:leading-6.5",
    size === "lg" && "h-9.5 leading-9.5 sm:h-8.5 sm:leading-8.5",
    Boolean(startAddon) && (size === "xs" ? "ps-1.5" : "ps-2"),
    Boolean(endAddon) && "pe-1.5",
    props.type === "search" &&
      "[&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none [&::-webkit-search-results-button]:appearance-none [&::-webkit-search-results-decoration]:appearance-none",
    props.type === "file" &&
      "text-muted-foreground file:me-3 file:bg-transparent file:font-medium file:text-foreground file:text-sm",
  );

  return (
    <span
      className={
        cn(
          !unstyled &&
            "relative inline-flex w-full items-center rounded-md border border-input bg-background text-base transition-[border-color,background-color] duration-[var(--duration-quick)] ease-[var(--ease-out-strong)] hover:border-foreground/20 has-focus-visible:border-[var(--border-focus)] has-focus-visible:bg-background has-aria-invalid:border-destructive/55 has-focus-visible:has-aria-invalid:border-destructive has-autofill:bg-foreground/4 has-disabled:pointer-events-none has-disabled:opacity-64 sm:text-sm dark:bg-input/24 dark:hover:border-foreground/22 dark:has-focus-visible:bg-input/36 dark:has-autofill:bg-foreground/8",
          className,
        ) || undefined
      }
      data-size={size}
      data-slot="input-control"
    >
      {startAddon && (
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none flex shrink-0 items-center text-muted-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
            size === "xs"
              ? "ps-[calc(--spacing(2)-1px)]"
              : size === "sm"
                ? "ps-[calc(--spacing(2.5)-1px)]"
                : "ps-[calc(--spacing(3)-1px)]",
          )}
          data-slot="input-start-addon"
        >
          {startAddon}
        </span>
      )}
      {nativeInput ? (
        <input
          className={inputClassName}
          data-slot="input"
          size={typeof size === "number" ? size : undefined}
          style={typeof style === "function" ? undefined : style}
          {...props}
        />
      ) : (
        <InputPrimitive
          className={inputClassName}
          data-slot="input"
          size={typeof size === "number" ? size : undefined}
          style={style}
          {...props}
        />
      )}
      {endAddon && (
        <span
          className={cn(
            "flex shrink-0 items-center text-muted-foreground",
            size === "xs" ? "pe-1" : "pe-1.5",
          )}
          data-slot="input-end-addon"
        >
          {endAddon}
        </span>
      )}
    </span>
  );
}

export { InputPrimitive };
