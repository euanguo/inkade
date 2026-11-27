"use client";

import { useInkadeTranslation } from "@inkade/i18n";
import { CheckIcon, CopyIcon } from "lucide-react";
import type React from "react";
import { useCallback, useState } from "react";
import { useCopyToClipboard, useDebounceCallback } from "usehooks-ts";
import { cn } from "../lib/utils.ts";
import { Button, type ButtonProps } from "./button.tsx";

const DEFAULT_RESET_MS = 1500;

export interface CopyButtonProps
  extends Omit<ButtonProps, "value" | "onCopy" | "children"> {
  readonly value: string;
  readonly label?: string | undefined;
  readonly copiedLabel?: string | undefined;
  readonly showLabel?: boolean | undefined;
  readonly resetDelayMs?: number | undefined;
  readonly onCopy?: ((value: string) => void) | undefined;
}

/**
 * Reusable clipboard button with CopyIcon -> emerald CheckIcon transition.
 */
export function CopyButton({
  value,
  label,
  copiedLabel,
  showLabel = false,
  resetDelayMs = DEFAULT_RESET_MS,
  onCopy,
  onClick,
  variant = "ghost",
  size,
  className,
  ...props
}: CopyButtonProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const [copied, setCopied] = useState(false);
  const [, copyToClipboard] = useCopyToClipboard();
  const scheduleResetCopied = useDebounceCallback(() => {
    setCopied(false);
  }, resetDelayMs);

  const resolvedLabel = label ?? t("common.copy");
  const resolvedCopiedLabel = copiedLabel ?? t("common.copied");
  const currentLabel = copied ? resolvedCopiedLabel : resolvedLabel;
  const resolvedSize = size ?? (showLabel ? "xs" : "icon-xs");

  const handleClick = useCallback(
    async (event: React.MouseEvent<HTMLButtonElement>) => {
      onClick?.(event);
      if (event.defaultPrevented) return;

      await copyToClipboard(value).catch(() => false);
      onCopy?.(value);
      setCopied(true);
      scheduleResetCopied();
    },
    [copyToClipboard, onClick, onCopy, scheduleResetCopied, value],
  );

  return (
    <Button
      aria-label={currentLabel}
      className={cn(
        "transition-colors duration-[var(--duration-quick)] ease-[var(--ease-smooth-out)]",
        copied && "text-emerald-600 dark:text-emerald-400",
        className,
      )}
      data-copied={copied ? "true" : undefined}
      data-slot="copy-button"
      onClick={(e) => void handleClick(e)}
      size={resolvedSize}
      title={currentLabel}
      variant={variant}
      {...props}
    >
      <span
        className="relative inline-flex size-3.5 shrink-0 items-center justify-center"
        data-slot="copy-button-icon-stack"
      >
        <CopyIcon
          aria-hidden="true"
          className={cn(
            "absolute inset-0 mx-0! size-full transition-[transform,opacity,filter] duration-[var(--duration-fast)] ease-[var(--ease-smooth-out)]",
            copied
              ? "pointer-events-none scale-[0.7] opacity-0 blur-[2px]"
              : "scale-100 opacity-100 blur-none",
          )}
          data-state={copied ? "hidden" : "visible"}
        />
        <CheckIcon
          aria-hidden="true"
          className={cn(
            "absolute inset-0 mx-0! size-full text-emerald-600 transition-[transform,opacity,filter] duration-[var(--duration-fast)] ease-[var(--ease-smooth-out)] dark:text-emerald-400",
            copied
              ? "scale-100 opacity-100 blur-none"
              : "pointer-events-none scale-[0.7] opacity-0 blur-[2px]",
          )}
          data-state={copied ? "visible" : "hidden"}
        />
      </span>
      {showLabel ? <span>{currentLabel}</span> : null}
    </Button>
  );
}
