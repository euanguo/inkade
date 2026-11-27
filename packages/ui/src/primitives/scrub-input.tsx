"use client";

import * as React from "react";
import { cn } from "../lib/utils.ts";

/**
 * Clamps and rounds a numeric scrub value cleanly to `[min, max]` snapped by `step`.
 */
export function clampScrubValue(
  value: number,
  min: number,
  max: number,
  step = 1,
): number {
  if (!Number.isFinite(value)) return min;
  const safeStep = Number.isFinite(step) && step > 0 ? step : 1;
  const snapped = Math.round(value / safeStep) * safeStep;
  const clamped = Math.min(max, Math.max(min, snapped));
  return Number(clamped.toFixed(6));
}

export interface ScrubInputProps {
  readonly label: string;
  readonly ariaLabel?: string | undefined;
  readonly value: number;
  readonly onChange: (next: number) => void;
  readonly min: number;
  readonly max: number;
  readonly step?: number | undefined;
  readonly suffix?: string | undefined;
  readonly modified?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  readonly className?: string | undefined;
}

/**
 * Compact Figma-style numeric field supporting horizontal drag-scrubbing, keyboard stepping (`Shift` x10),
 * and direct numeric input.
 */
export function ScrubInput({
  label,
  ariaLabel,
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
  modified = false,
  disabled = false,
  className,
}: ScrubInputProps): React.ReactElement {
  const dragRef = React.useRef<{ x: number; v: number } | null>(null);
  const [scrubbing, setScrubbing] = React.useState(false);
  const resolvedAriaLabel = ariaLabel ?? label;

  const commit = (raw: number) => {
    if (disabled) return;
    onChange(clampScrubValue(raw, min, max, step));
  };

  return (
    <label
      className={cn(
        "flex h-7 min-w-0 items-center gap-1 rounded-md border px-1.5 text-xs transition-[background-color,border-color,box-shadow] duration-[var(--duration-quick)] ease-[var(--ease-out-strong)]",
        modified || scrubbing
          ? "border-primary/45 bg-brand-subtle text-foreground"
          : "border-border bg-muted/45 text-foreground focus-within:border-ring",
        disabled && "pointer-events-none opacity-60",
        className,
      )}
      data-modified={modified ? "true" : "false"}
      data-slot="scrub-input"
    >
      <span
        aria-label={resolvedAriaLabel}
        aria-valuemax={max}
        aria-valuemin={min}
        aria-valuenow={value}
        className="flex h-full shrink-0 cursor-ew-resize touch-none items-center rounded-sm px-1 font-medium text-muted-foreground select-none hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
        onKeyDown={(e) => {
          if (disabled) return;
          const mult = e.shiftKey ? 10 : 1;
          if (e.key === "ArrowUp" || e.key === "ArrowRight") {
            e.preventDefault();
            commit(value + step * mult);
          } else if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
            e.preventDefault();
            commit(value - step * mult);
          }
        }}
        onPointerCancel={() => {
          dragRef.current = null;
          setScrubbing(false);
        }}
        onPointerDown={(e) => {
          if (disabled) return;
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          dragRef.current = { x: e.clientX, v: value };
          setScrubbing(true);
        }}
        onPointerMove={(e) => {
          if (!dragRef.current || disabled) return;
          const delta = ((e.clientX - dragRef.current.x) / 2) * step;
          commit(dragRef.current.v + delta);
        }}
        onPointerUp={(e) => {
          if (dragRef.current) {
            try {
              e.currentTarget.releasePointerCapture(e.pointerId);
            } catch {
              // ignore if capture was already released
            }
          }
          dragRef.current = null;
          setScrubbing(false);
        }}
        role="slider"
        tabIndex={disabled ? -1 : 0}
      >
        {label}
      </span>

      <input
        aria-label={resolvedAriaLabel}
        className="min-w-0 flex-1 bg-transparent font-mono text-xs text-foreground tabular-nums outline-none"
        disabled={disabled}
        inputMode="numeric"
        onChange={(e) => {
          const parsed = Number(e.target.value.replace(/[^\d.-]/g, ""));
          if (!Number.isNaN(parsed)) {
            commit(parsed);
          }
        }}
        type="text"
        value={value}
      />

      {suffix ? (
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground select-none">
          {suffix}
        </span>
      ) : null}
    </label>
  );
}
