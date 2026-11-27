"use client";

import { useInkadeTranslation } from "@inkade/i18n";
import * as React from "react";
import { cn } from "../lib/utils.ts";

export type ThinkingIndicatorSize = "sm" | "md";

export interface ThinkingIndicatorProps {
  readonly label?: string | undefined;
  readonly showTimer?: boolean | undefined;
  readonly elapsedSeconds?: number | undefined;
  /** Optional ISO-8601 server timestamp so timers survive reloads accurately. */
  readonly startedAt?: string | null | undefined;
  readonly size?: ThinkingIndicatorSize | undefined;
  readonly shimmer?: boolean | undefined;
  readonly className?: string | undefined;
}

/**
 * Computes elapsed whole seconds since an ISO-8601 server timestamp.
 * Returns null if missing or invalid.
 */
export function computeElapsedSecondsFromIso(
  startedAt: string | null | undefined,
  nowMs: number = Date.now(),
): number | null {
  if (!startedAt) return null;
  const parsedMs = Date.parse(startedAt);
  if (Number.isNaN(parsedMs)) return null;
  return Math.max(0, Math.floor((nowMs - parsedMs) / 1000));
}

const DOT_INDICES = [0, 1, 2, 3, 4, 5, 6, 7, 8] as const;

/**
 * Returns the diagonal wave step (0..4) for a cell index inside the 3x3 matrix.
 */
export function getThinkingDotDelayStep(index: number): number {
  const safeIndex = Math.max(0, Math.min(8, Math.trunc(index)));
  const row = Math.floor(safeIndex / 3);
  const col = safeIndex % 3;
  return row + col;
}

/**
 * Formats an elapsed second counter as zero-padded MM:SS (or HH:MM:SS at >= 1 hour) for tabular-nums readout.
 */
export function formatElapsedTimer(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/**
 * 3x3 diagonal dot-wave indicator with optional shimmering label and tabular-nums timer.
 * Preserves essential opacity breathing under reduced-motion preferences.
 */
export function ThinkingIndicator({
  label,
  showTimer = false,
  elapsedSeconds,
  startedAt,
  size = "sm",
  shimmer = true,
  className,
}: ThinkingIndicatorProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const [internalSeconds, setInternalSeconds] = React.useState<number>(() => {
    if (elapsedSeconds !== undefined) return elapsedSeconds;
    return computeElapsedSecondsFromIso(startedAt) ?? 0;
  });

  React.useEffect(() => {
    if (!showTimer || elapsedSeconds !== undefined) return;
    const syncFromIso = computeElapsedSecondsFromIso(startedAt);
    setInternalSeconds(syncFromIso ?? 0);
    const id = setInterval(() => {
      const fromIso = computeElapsedSecondsFromIso(startedAt);
      setInternalSeconds((prev) => (fromIso !== null ? fromIso : prev + 1));
    }, 1000);
    return () => clearInterval(id);
  }, [showTimer, elapsedSeconds, startedAt]);

  const displayedSeconds =
    elapsedSeconds ?? computeElapsedSecondsFromIso(startedAt) ?? internalSeconds;
  const resolvedAriaLabel = label ?? t("common.thinking");

  return (
    <span
      aria-label={resolvedAriaLabel}
      aria-live="polite"
      className={cn(
        "inline-flex items-center text-muted-foreground",
        size === "sm" ? "gap-1.5 text-xs" : "gap-2.5 text-sm",
        className,
      )}
      data-size={size}
      data-slot="thinking-indicator"
      role="status"
    >
      <span
        aria-hidden="true"
        className={cn(
          "grid shrink-0 grid-cols-3 text-primary",
          size === "sm" ? "gap-[2px]" : "gap-[3px]",
        )}
        data-motion-essential="pulse"
        data-slot="thinking-indicator-matrix"
      >
        {DOT_INDICES.map((idx) => {
          const step = getThinkingDotDelayStep(idx);
          return (
            <span
              className={cn(
                "rounded-full bg-current",
                size === "sm" ? "size-[3px]" : "size-1",
              )}
              data-slot="thinking-indicator-dot"
              data-step={step}
              key={idx}
              style={{
                animationName: "inkade-thinking-wave",
                animationDuration: "1.2s",
                animationIterationCount: "infinite",
                animationTimingFunction: "ease-in-out",
                animationDelay: `calc(var(--duration-stagger) * ${step})`,
              }}
            />
          );
        })}
      </span>

      {label ? (
        <span
          className={cn(
            "truncate font-medium",
            shimmer
              ? "animate-skeleton bg-[linear-gradient(110deg,var(--muted-foreground)_35%,var(--foreground)_50%,var(--muted-foreground)_65%)] bg-[length:200%_100%] bg-clip-text text-transparent"
              : "text-foreground/85",
          )}
          data-slot="thinking-indicator-label"
        >
          {label}
        </span>
      ) : null}

      {showTimer ? (
        <span
          className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground/80"
          data-slot="thinking-indicator-timer"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {formatElapsedTimer(displayedSeconds)}
        </span>
      ) : null}
    </span>
  );
}
