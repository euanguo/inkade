"use client";

import { useInkadeTranslation } from "@inkade/i18n";
import * as React from "react";
import { cn } from "../lib/utils.ts";

export const DEFAULT_HOLD_DURATION_MS = 1500;
export const ALMOST_READY_THRESHOLD = 0.85;
const DRAIN_SPEED_MULTIPLIER = 2.6;

export type HoldConfirmSize = "sm" | "default" | "lg";

export interface HoldConfirmButtonProps
  extends Omit<React.ComponentPropsWithoutRef<"button">, "onProgress"> {
  readonly holdDurationMs?: number | undefined;
  readonly onConfirm: () => void;
  readonly onCancel?: (() => void) | undefined;
  readonly onProgressChange?: ((progress: number) => void) | undefined;
  readonly holdingLabel?: string | undefined;
  readonly size?: HoldConfirmSize | undefined;
}

/**
 * Pure frame-step progress calculator for press-and-hold fill and early-release drain.
 */
export function advanceHoldProgress(
  current: number,
  deltaMs: number,
  holdDurationMs: number,
  direction: "fill" | "drain",
): number {
  const safeDuration = Math.max(100, holdDurationMs);
  const safeDelta = Math.max(0, deltaMs);
  if (direction === "fill") {
    return Math.min(1, Math.max(0, current + safeDelta / safeDuration));
  }
  const drainDelta = (safeDelta * DRAIN_SPEED_MULTIPLIER) / safeDuration;
  return Math.max(0, Math.min(1, current - drainDelta));
}

const SIZE_CLASSES: Readonly<Record<HoldConfirmSize, string>> = {
  sm: "h-7 px-2.5 text-xs rounded-md",
  default: "h-8 px-3 text-sm rounded-lg",
  lg: "h-9 px-3.5 text-sm rounded-lg",
};

/**
 * Destructive hold-to-confirm button with clean resting surface, 2px bottom fill rail,
 * tactile micro-shake at >=85% progress, smooth early-release drain, and Space/Enter support.
 */
export function HoldConfirmButton({
  children,
  holdDurationMs = DEFAULT_HOLD_DURATION_MS,
  onConfirm,
  onCancel,
  onProgressChange,
  holdingLabel,
  size = "default",
  disabled = false,
  className,
  onPointerDown,
  onPointerUp,
  onPointerCancel,
  onPointerLeave,
  onKeyDown,
  onKeyUp,
  onBlur,
  "aria-label": ariaLabelProp,
  ...props
}: HoldConfirmButtonProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const [holding, setHolding] = React.useState(false);
  const [progress, setProgress] = React.useState(0);

  const progressRef = React.useRef(0);
  const modeRef = React.useRef<"idle" | "fill" | "drain">("idle");
  const rafRef = React.useRef<number | null>(null);
  const lastFrameRef = React.useRef<number | null>(null);
  const confirmedThisPressRef = React.useRef(false);

  const stopRaf = React.useCallback(() => {
    if (rafRef.current !== null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(rafRef.current);
    }
    rafRef.current = null;
    lastFrameRef.current = null;
  }, []);

  const updateProgress = React.useCallback(
    (next: number) => {
      progressRef.current = next;
      setProgress(next);
      onProgressChange?.(next);
    },
    [onProgressChange],
  );

  const stepFrame = React.useCallback(
    (now: number) => {
      const prevTime = lastFrameRef.current ?? now;
      lastFrameRef.current = now;
      const deltaMs = now - prevTime;
      const mode = modeRef.current;

      if (mode === "fill") {
        const next = advanceHoldProgress(progressRef.current, deltaMs, holdDurationMs, "fill");
        updateProgress(next);
        if (next >= 1) {
          stopRaf();
          modeRef.current = "idle";
          setHolding(false);
          if (!confirmedThisPressRef.current) {
            confirmedThisPressRef.current = true;
            onConfirm();
          }
          updateProgress(0);
          return;
        }
        rafRef.current = requestAnimationFrame(stepFrame);
        return;
      }

      if (mode === "drain") {
        const next = advanceHoldProgress(progressRef.current, deltaMs, holdDurationMs, "drain");
        updateProgress(next);
        if (next <= 0) {
          stopRaf();
          modeRef.current = "idle";
          return;
        }
        rafRef.current = requestAnimationFrame(stepFrame);
      }
    },
    [holdDurationMs, onConfirm, stopRaf, updateProgress],
  );

  const startHold = React.useCallback(() => {
    if (disabled || modeRef.current === "fill") return;
    confirmedThisPressRef.current = false;
    modeRef.current = "fill";
    setHolding(true);
    stopRaf();
    if (typeof requestAnimationFrame === "function") {
      rafRef.current = requestAnimationFrame(stepFrame);
    }
  }, [disabled, stepFrame, stopRaf]);

  const releaseHold = React.useCallback(() => {
    if (modeRef.current !== "fill") return;
    setHolding(false);
    const hadPartialProgress = progressRef.current > 0 && !confirmedThisPressRef.current;
    if (hadPartialProgress) {
      onCancel?.();
    }
    if (progressRef.current <= 0) {
      stopRaf();
      modeRef.current = "idle";
      return;
    }
    modeRef.current = "drain";
    stopRaf();
    if (typeof requestAnimationFrame === "function") {
      rafRef.current = requestAnimationFrame(stepFrame);
    } else {
      modeRef.current = "idle";
      updateProgress(0);
    }
  }, [onCancel, stepFrame, stopRaf, updateProgress]);

  React.useEffect(() => {
    return () => {
      stopRaf();
    };
  }, [stopRaf]);

  React.useEffect(() => {
    if (disabled && modeRef.current === "fill") {
      releaseHold();
    }
  }, [disabled, releaseHold]);

  const almostReady = holding && progress >= ALMOST_READY_THRESHOLD;
  const fallbackLabel = t("common.holdToConfirm");
  const displayHoldingLabel = holdingLabel ?? t("common.keepHolding");
  const visibleContent =
    holding && holdingLabel
      ? displayHoldingLabel
      : (children ?? (holding ? displayHoldingLabel : fallbackLabel));

  const resolvedAriaLabel =
    ariaLabelProp ?? (typeof children === "string" ? children : fallbackLabel);

  return (
    <button
      aria-label={resolvedAriaLabel}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={Math.round(progress * 100)}
      className={cn(
        "relative inline-flex shrink-0 cursor-pointer select-none items-center justify-center gap-1.5 overflow-hidden border border-destructive/35 bg-background font-medium text-destructive-foreground shadow-[var(--shadow-control)] outline-none transition-[border-color,background-color,box-shadow] duration-[var(--duration-quick)] ease-[var(--ease-smooth-out)] hover:border-destructive/55 hover:bg-destructive/[0.04] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-destructive/60 disabled:pointer-events-none disabled:opacity-55 dark:bg-card dark:hover:bg-destructive/10",
        almostReady && "animate-[inkade-hold-shake_120ms_ease-in-out_infinite]",
        SIZE_CLASSES[size],
        className,
      )}
      data-almost-ready={almostReady ? "true" : undefined}
      data-holding={holding ? "true" : undefined}
      data-slot="hold-confirm-button"
      disabled={disabled}
      onBlur={(e) => {
        releaseHold();
        onBlur?.(e);
      }}
      onKeyDown={(e) => {
        if ((e.key === " " || e.key === "Enter") && !e.repeat && !disabled) {
          e.preventDefault();
          startHold();
        }
        onKeyDown?.(e);
      }}
      onKeyUp={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          releaseHold();
        }
        onKeyUp?.(e);
      }}
      onPointerCancel={(e) => {
        releaseHold();
        onPointerCancel?.(e);
      }}
      onPointerDown={(e) => {
        if (e.button === 0 && !disabled) {
          try {
            e.currentTarget.setPointerCapture?.(e.pointerId);
          } catch {
            // ignore synthetic events without active pointerId
          }
          startHold();
        }
        onPointerDown?.(e);
      }}
      onPointerLeave={(e) => {
        if (e.buttons === 0) {
          releaseHold();
        }
        onPointerLeave?.(e);
      }}
      onPointerUp={(e) => {
        releaseHold();
        onPointerUp?.(e);
      }}
      type="button"
      {...props}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-destructive/12 transition-opacity duration-[var(--duration-micro)]"
        style={{ opacity: progress > 0 ? Math.min(1, progress * 0.9) : 0 }}
      />
      <span className="relative z-10 inline-flex items-center gap-1.5">{visibleContent}</span>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px] bg-destructive/12"
      >
        <span
          className="block h-full origin-left bg-destructive will-change-transform"
          data-slot="hold-confirm-progress"
          style={{ transform: `scaleX(${progress})` }}
        />
      </span>
    </button>
  );
}
