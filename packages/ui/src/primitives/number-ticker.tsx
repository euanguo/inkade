"use client";

import NumberFlow from "@number-flow/react";
import * as React from "react";
import { cn, prefersReducedMotion } from "../lib/utils.ts";

export interface NumberTickerProps {
  readonly value: number;
  readonly from?: number | undefined;
  readonly durationMs?: number | undefined;
  readonly decimals?: number | undefined;
  readonly locale?: string | undefined;
  readonly prefix?: string | undefined;
  readonly suffix?: string | undefined;
  readonly formatValue?: ((value: number) => string) | undefined;
  readonly mode?: "interpolate" | "odometer" | undefined;
  readonly animated?: boolean | undefined;
  readonly className?: string | undefined;
}

export interface RollingDigitsProps {
  readonly value: string;
  readonly className?: string | undefined;
}

interface ParsedRollingValue {
  readonly prefix: string;
  readonly number: number;
  readonly decimals: number;
  readonly useGrouping: boolean;
  readonly suffix: string;
}

const NUMERIC_STRING_PATTERN = /^([^0-9+-]*?)([+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(.*)$/;

/**
 * Parses a preformatted numeric display string (e.g. `"42%"`, `"$1,280.50"`) into
 * structured `@number-flow/react` props so no duplicate digit stack leaks into DOM text.
 */
export function parseRollingValue(value: string): ParsedRollingValue | null {
  const match = NUMERIC_STRING_PATTERN.exec(value);
  if (!match) return null;
  const [, prefix = "", rawNum = "", suffix = ""] = match;
  // Avoid re-formatting multi-segment values like dates or timers (`04:12`, `2026-11-25`)
  if (/^[:./-]?\d/.test(suffix.trimStart()) || /[.:/-]$/.test(prefix.trimEnd())) {
    return null;
  }
  const normalized = rawNum.replace(/,/g, "");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  const dotIdx = normalized.indexOf(".");
  const decimals = dotIdx === -1 ? 0 : normalized.length - dotIdx - 1;
  return {
    prefix,
    number: parsed,
    decimals,
    useGrouping: rawNum.includes(","),
    suffix,
  };
}

/**
 * Isolated odometer digit transition powered by `@number-flow/react` Shadow DOM.
 * Guarantees `textContent`, copy selection, and screen readers see only the clean value.
 */
export function RollingDigits({ value, className }: RollingDigitsProps): React.ReactElement {
  const reduced = prefersReducedMotion();
  const parsed = React.useMemo(() => parseRollingValue(value), [value]);

  if (!parsed || reduced) {
    return (
      <span
        className={cn("inline-flex items-baseline tabular-nums", className)}
        data-slot="rolling-digits"
        data-value={value}
      >
        {value}
      </span>
    );
  }

  return (
    <span
      className={cn("inline-flex items-baseline tabular-nums", className)}
      data-slot="rolling-digits"
      data-value={value}
    >
      <NumberFlow
        animated={!reduced}
        className="inline-block tabular-nums"
        format={{
          minimumFractionDigits: parsed.decimals,
          maximumFractionDigits: parsed.decimals,
          useGrouping: parsed.useGrouping,
        }}
        {...(parsed.prefix ? { prefix: parsed.prefix } : {})}
        respectMotionPreference
        {...(parsed.suffix ? { suffix: parsed.suffix } : {})}
        value={parsed.number}
      />
    </span>
  );
}

/**
 * Interpolates between two numbers with cubic ease-out and optional decimal rounding.
 */
export function interpolateTickerValue(
  from: number,
  to: number,
  progress: number,
  decimals = 0,
): number {
  const clamped = Math.min(1, Math.max(0, progress));
  const eased = 1 - Math.pow(1 - clamped, 3);
  const raw = from + (to - from) * eased;
  const factor = Math.pow(10, Math.max(0, Math.trunc(decimals)));
  return Math.round(raw * factor) / factor;
}

/**
 * Formats a numeric ticker value with tabular precision, prefix, and suffix.
 */
export function formatTickerValue(
  value: number,
  options?: {
    readonly decimals?: number | undefined;
    readonly locale?: string | undefined;
    readonly prefix?: string | undefined;
    readonly suffix?: string | undefined;
  },
): string {
  const decimals = Math.max(0, Math.trunc(options?.decimals ?? 0));
  const safe = Number.isFinite(value) ? value : 0;
  const formatted = new Intl.NumberFormat(options?.locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(safe);
  return `${options?.prefix ?? ""}${formatted}${options?.suffix ?? ""}`;
}

/**
 * Tabular-nums numeric transition primitive powered by `@number-flow/react` for Shadow-DOM-isolated
 * transitions without DOM digit-stack text leakage, with `formatValue` fallback and reduced-motion support.
 */
export function NumberTicker({
  value,
  from,
  durationMs = 320,
  decimals = 0,
  locale,
  prefix,
  suffix,
  formatValue,
  mode = "interpolate",
  animated = true,
  className,
}: NumberTickerProps): React.ReactElement {
  const safeTarget = Number.isFinite(value) ? value : 0;
  const safeDecimals = Math.max(0, Math.trunc(decimals));
  const reduced = prefersReducedMotion();
  const motionDisabled = !animated || reduced;
  const useCustomFormatter = typeof formatValue === "function";

  const [displayValue, setDisplayValue] = React.useState<number>(() => safeTarget);
  const prevTargetRef = React.useRef<number>(
    from !== undefined && Number.isFinite(from) ? from : safeTarget,
  );
  const hasMountedRef = React.useRef(false);

  React.useEffect(() => {
    if (!useCustomFormatter) {
      setDisplayValue(safeTarget);
      prevTargetRef.current = safeTarget;
      hasMountedRef.current = true;
      return;
    }

    const startVal = hasMountedRef.current
      ? prevTargetRef.current
      : from !== undefined && Number.isFinite(from)
        ? from
        : safeTarget;
    hasMountedRef.current = true;
    prevTargetRef.current = safeTarget;

    if (
      startVal === safeTarget ||
      motionDisabled ||
      typeof requestAnimationFrame !== "function"
    ) {
      setDisplayValue(safeTarget);
      return;
    }

    let rafId: number | null = null;
    const startTime = performance.now();
    const safeDuration = Math.max(80, durationMs);

    const tick = (now: number): void => {
      const progress = Math.min(1, (now - startTime) / safeDuration);
      setDisplayValue(interpolateTickerValue(startVal, safeTarget, progress, safeDecimals));
      if (progress < 1) {
        rafId = requestAnimationFrame(tick);
      } else {
        setDisplayValue(safeTarget);
      }
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      if (rafId !== null && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(rafId);
      }
    };
  }, [durationMs, from, motionDisabled, safeDecimals, safeTarget, useCustomFormatter]);

  if (useCustomFormatter) {
    return (
      <span
        aria-live="polite"
        className={cn("inline-block tabular-nums", className)}
        data-mode={mode}
        data-slot="number-ticker"
        data-value={String(safeTarget)}
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {formatValue(displayValue)}
      </span>
    );
  }

  if (motionDisabled) {
    return (
      <span
        aria-live="polite"
        className={cn("inline-block tabular-nums", className)}
        data-mode={mode}
        data-slot="number-ticker"
        data-value={String(safeTarget)}
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {formatTickerValue(safeTarget, { decimals: safeDecimals, locale, prefix, suffix })}
      </span>
    );
  }

  const transitionMs = Math.max(120, durationMs);

  return (
    <span
      aria-live="polite"
      className={cn("inline-block tabular-nums", className)}
      data-mode={mode}
      data-slot="number-ticker"
      data-value={String(safeTarget)}
      style={{ fontVariantNumeric: "tabular-nums" }}
    >
      <NumberFlow
        animated={!motionDisabled}
        className="inline-block tabular-nums"
        format={{
          minimumFractionDigits: safeDecimals,
          maximumFractionDigits: safeDecimals,
        }}
        {...(locale ? { locales: locale } : {})}
        {...(prefix ? { prefix } : {})}
        {...(suffix ? { suffix } : {})}
        respectMotionPreference
        spinTiming={{
          duration: transitionMs,
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        }}
        transformTiming={{
          duration: transitionMs,
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        }}
        value={safeTarget}
      />
    </span>
  );
}
