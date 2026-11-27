"use client";

import { useInkadeTranslation } from "@inkade/i18n";
import * as React from "react";
import { cn } from "../lib/utils.ts";

export type BucketMeterTone =
  | "primary"
  | "info"
  | "success"
  | "warning"
  | "destructive"
  | "neutral"
  | "violet"
  | "teal";

export type BucketMeterScaleMode = "capacity" | "used" | "auto";

export interface BucketMeterSegment {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly colorClass?: string | undefined;
  readonly tone?: BucketMeterTone | undefined;
}

export interface BucketMeterComputedSegment extends BucketMeterSegment {
  readonly cleanValue: number;
  readonly widthPercent: number;
  readonly sharePercent: number;
  readonly resolvedColorClass: string;
}

export type BucketMeterWarningLevel = "none" | "warning" | "critical";

export interface BucketMeterLayout {
  readonly segments: readonly BucketMeterComputedSegment[];
  readonly usedTotal: number;
  readonly capacityTotal: number;
  readonly usageRatio: number;
  readonly usagePercent: number;
  readonly warningLevel: BucketMeterWarningLevel;
  readonly resolvedScaleMode: "capacity" | "used";
}

export interface BucketMeterProps {
  readonly segments: readonly BucketMeterSegment[];
  readonly total?: number | undefined;
  readonly capacity?: number | undefined;
  readonly highWatermarkRatio?: number | undefined;
  readonly showWarning?: boolean | undefined;
  readonly showLegend?: boolean | undefined;
  readonly scaleMode?: BucketMeterScaleMode | undefined;
  readonly formatValue?: ((value: number) => string) | undefined;
  readonly ariaLabel?: string | undefined;
  readonly className?: string | undefined;
}

const TONE_DEFAULT_POOL: readonly BucketMeterTone[] = [
  "primary",
  "info",
  "teal",
  "violet",
  "success",
  "warning",
  "neutral",
  "destructive",
];

const TONE_BG_CLASS: Readonly<Record<BucketMeterTone, string>> = {
  primary: "bg-primary",
  info: "bg-info",
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
  neutral: "bg-muted-foreground/55",
  violet: "bg-violet-500 dark:bg-violet-400",
  teal: "bg-teal-500 dark:bg-teal-400",
};

/**
 * Pure proportional layout and high-watermark calculator for multi-segment capacity meters.
 */
export function computeBucketMeterLayout(
  segments: readonly BucketMeterSegment[],
  options?: {
    readonly total?: number | undefined;
    readonly capacity?: number | undefined;
    readonly highWatermarkRatio?: number | undefined;
    readonly scaleMode?: BucketMeterScaleMode | undefined;
  },
): BucketMeterLayout {
  const cleaned = segments.map((seg, index) => {
    const cleanValue = Number.isFinite(seg.value) ? Math.max(0, seg.value) : 0;
    const tone = seg.tone ?? TONE_DEFAULT_POOL[index % TONE_DEFAULT_POOL.length] ?? "primary";
    const resolvedColorClass = seg.colorClass ?? TONE_BG_CLASS[tone];
    return { ...seg, cleanValue, tone, resolvedColorClass };
  });

  const usedTotal = cleaned.reduce((sum, seg) => sum + seg.cleanValue, 0);
  const explicitCapacity = options?.capacity ?? options?.total;
  const hasExplicitCapacity =
    explicitCapacity !== undefined && Number.isFinite(explicitCapacity) && explicitCapacity > 0;
  const capacityTotal = hasExplicitCapacity ? explicitCapacity : usedTotal;

  const usageRatio = capacityTotal > 0 ? usedTotal / capacityTotal : 0;
  const usagePercent = Math.round(usageRatio * 1000) / 10;

  const requestedMode: BucketMeterScaleMode = options?.scaleMode ?? "capacity";
  const resolvedScaleMode: "capacity" | "used" =
    !hasExplicitCapacity
      ? "used"
      : requestedMode === "used"
        ? "used"
        : requestedMode === "auto" && usedTotal > 0 && usageRatio < 0.05
          ? "used"
          : "capacity";

  // Normalize bar widths against total used when in relative "used" mode, or against capacity otherwise.
  const barDivisor =
    resolvedScaleMode === "used" ? usedTotal : Math.max(capacityTotal, usedTotal);
  const shareDivisor =
    resolvedScaleMode === "used" ? usedTotal : capacityTotal;

  const computedSegments: BucketMeterComputedSegment[] = cleaned.map((seg) => {
    const widthPercent =
      barDivisor > 0 ? Math.round((seg.cleanValue / barDivisor) * 10000) / 100 : 0;
    const sharePercent =
      shareDivisor > 0 ? Math.round((seg.cleanValue / shareDivisor) * 1000) / 10 : 0;
    return {
      ...seg,
      widthPercent,
      sharePercent,
    };
  });

  const threshold = options?.highWatermarkRatio ?? 0.85;
  let warningLevel: BucketMeterWarningLevel = "none";
  if (hasExplicitCapacity && usageRatio > threshold) {
    warningLevel = usageRatio >= 0.95 ? "critical" : "warning";
  }

  return {
    segments: computedSegments,
    usedTotal,
    capacityTotal,
    usageRatio,
    usagePercent,
    warningLevel,
    resolvedScaleMode,
  };
}

/**
 * Multi-segment horizontal proportional bar with synchronized hover legend highlighting
 * and >85% high-watermark capacity transition.
 */
export function BucketMeter({
  segments,
  total,
  capacity,
  highWatermarkRatio = 0.85,
  showWarning = true,
  showLegend = true,
  scaleMode = "capacity",
  formatValue,
  ariaLabel,
  className,
}: BucketMeterProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const [activeId, setActiveId] = React.useState<string | null>(null);

  const layout = React.useMemo(
    () =>
      computeBucketMeterLayout(segments, {
        total,
        capacity,
        highWatermarkRatio,
        scaleMode,
      }),
    [segments, total, capacity, highWatermarkRatio, scaleMode],
  );

  const formatMetric = React.useCallback(
    (val: number): string => (formatValue ? formatValue(val) : String(val)),
    [formatValue],
  );

  const hasWarning = showWarning && layout.warningLevel !== "none";
  const roundedPercent = Math.min(100, Math.round(layout.usagePercent));
  const resolvedAriaLabel = ariaLabel ?? t("common.capacityMeter");

  return (
    <div
      aria-label={resolvedAriaLabel}
      className={cn("flex flex-col gap-2", className)}
      data-scale-mode={layout.resolvedScaleMode}
      data-slot="bucket-meter"
      data-warning-level={hasWarning ? layout.warningLevel : "none"}
      role="group"
    >
      <div
        className={cn(
          "flex h-2.5 w-full items-stretch overflow-hidden rounded-full bg-muted p-[1px] ring-1 transition-[box-shadow,background-color] duration-[var(--duration-fast)] ease-[var(--ease-smooth-out)]",
          layout.warningLevel === "critical" && hasWarning
            ? "ring-rose-500/45 bg-rose-500/10"
            : layout.warningLevel === "warning" && hasWarning
              ? "ring-amber-500/45 bg-amber-500/10"
              : "ring-border/60",
        )}
        data-slot="bucket-meter-track"
      >
        {layout.segments.map((seg) => {
          if (seg.cleanValue <= 0) return null;
          const isFocused = activeId === seg.id;
          const isDimmed = activeId !== null && !isFocused;
          const segmentAria = `${seg.label}: ${formatMetric(seg.cleanValue)} (${seg.sharePercent}%)`;

          return (
            <div
              aria-label={segmentAria}
              className={cn(
                "h-full origin-center first:rounded-l-full last:rounded-r-full transition-[opacity,transform,background-color] duration-[var(--duration-quick)] ease-[var(--ease-smooth-out)]",
                seg.resolvedColorClass,
                isFocused && "scale-y-125 brightness-105",
                isDimmed && "opacity-30",
              )}
              data-active={isFocused ? "true" : undefined}
              data-segment-id={seg.id}
              data-slot="bucket-meter-segment"
              key={seg.id}
              onMouseEnter={() => setActiveId(seg.id)}
              onMouseLeave={() => setActiveId((prev) => (prev === seg.id ? null : prev))}
              role="img"
              style={{ width: `${seg.widthPercent}%`, minWidth: "6px" }}
            />
          );
        })}
      </div>

      {(showLegend || hasWarning) && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          {showLegend ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1" data-slot="bucket-meter-legend">
              {layout.segments.map((seg) => {
                const isFocused = activeId === seg.id;
                const isDimmed = activeId !== null && !isFocused;
                return (
                  <button
                    className={cn(
                      "inline-flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 text-left transition-opacity duration-[var(--duration-quick)] ease-[var(--ease-smooth-out)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      isDimmed ? "opacity-40" : "opacity-100",
                    )}
                    data-active={isFocused ? "true" : undefined}
                    data-segment-id={seg.id}
                    data-slot="bucket-meter-legend-item"
                    key={seg.id}
                    onBlur={() => setActiveId((prev) => (prev === seg.id ? null : prev))}
                    onFocus={() => setActiveId(seg.id)}
                    onMouseEnter={() => setActiveId(seg.id)}
                    onMouseLeave={() => setActiveId((prev) => (prev === seg.id ? null : prev))}
                    type="button"
                  >
                    <span
                      aria-hidden="true"
                      className={cn("size-2 shrink-0 rounded-full", seg.resolvedColorClass)}
                    />
                    <span className="font-medium text-foreground">{seg.label}</span>
                    <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                      {formatMetric(seg.cleanValue)} · {seg.sharePercent}%
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <span />
          )}

          {hasWarning ? (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[11px] font-medium tabular-nums",
                layout.warningLevel === "critical"
                  ? "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300"
                  : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
              )}
              data-slot="bucket-meter-warning"
              role="status"
            >
              {layout.warningLevel === "critical"
                ? t("common.capacityCritical", { percent: roundedPercent })
                : t("common.capacityWarning", { percent: roundedPercent })}
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}
