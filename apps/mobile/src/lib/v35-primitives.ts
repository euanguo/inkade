export const DEFAULT_HOLD_DURATION_MS = 1500;
export const ALMOST_READY_THRESHOLD = 0.85;
export const DRAIN_SPEED_MULTIPLIER = 2.6;

/**
 * Computes the next normalized [0..1] progress for a press-and-hold fill or early-release drain frame.
 */
export function advanceMobileHoldProgress(
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

/**
 * Returns the diagonal wave step (0..4) for a cell index inside the 3x3 thinking matrix.
 */
export function getThinkingDotDelayStep(index: number): number {
  const safeIndex = Math.max(0, Math.min(8, Math.trunc(index)));
  const row = Math.floor(safeIndex / 3);
  const col = safeIndex % 3;
  return row + col;
}

/**
 * Formats an elapsed second counter as zero-padded MM:SS for tabular-nums readout.
 */
export function formatElapsedTimer(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export type MobileBucketWarningLevel = "none" | "warning" | "critical";

export interface MobileBucketSegment {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly color: string;
}

export interface MobileBucketComputedSegment extends MobileBucketSegment {
  readonly cleanValue: number;
  readonly widthPercent: number;
  readonly sharePercent: number;
}

export interface MobileBucketLayout {
  readonly segments: readonly MobileBucketComputedSegment[];
  readonly usedTotal: number;
  readonly capacityTotal: number;
  readonly usageRatio: number;
  readonly usagePercent: number;
  readonly warningLevel: MobileBucketWarningLevel;
}

/**
 * Computes proportional widths, share percentages, and high-watermark warning state for capacity meters.
 */
export function computeMobileBucketLayout(
  segments: readonly MobileBucketSegment[],
  options?: {
    readonly total?: number | undefined;
    readonly capacity?: number | undefined;
    readonly highWatermarkRatio?: number | undefined;
  },
): MobileBucketLayout {
  const cleaned = segments.map((seg) => ({
    ...seg,
    cleanValue: Number.isFinite(seg.value) ? Math.max(0, seg.value) : 0,
  }));

  const usedTotal = cleaned.reduce((sum, seg) => sum + seg.cleanValue, 0);
  const explicitCapacity = options?.capacity ?? options?.total;
  const hasExplicitCapacity =
    explicitCapacity !== undefined && Number.isFinite(explicitCapacity) && explicitCapacity > 0;
  const capacityTotal = hasExplicitCapacity ? explicitCapacity : usedTotal;

  const usageRatio = capacityTotal > 0 ? usedTotal / capacityTotal : 0;
  const usagePercent = Math.round(usageRatio * 1000) / 10;

  const barDivisor = Math.max(capacityTotal, usedTotal);
  const computedSegments: MobileBucketComputedSegment[] = cleaned.map((seg) => {
    const widthPercent =
      barDivisor > 0 ? Math.round((seg.cleanValue / barDivisor) * 10000) / 100 : 0;
    const shareDivisor = hasExplicitCapacity ? capacityTotal : usedTotal;
    const sharePercent =
      shareDivisor > 0 ? Math.round((seg.cleanValue / shareDivisor) * 1000) / 10 : 0;
    return {
      ...seg,
      widthPercent,
      sharePercent,
    };
  });

  const threshold = options?.highWatermarkRatio ?? 0.85;
  let warningLevel: MobileBucketWarningLevel = "none";
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
  };
}

/**
 * Formats byte counts cleanly using tabular numeric precision.
 */
export function formatCompactBytes(bytes: number): string {
  const safe = Number.isFinite(bytes) ? Math.max(0, bytes) : 0;
  if (safe < 1024) return `${Math.round(safe)} B`;
  const units = ["KB", "MB", "GB", "TB"] as const;
  let value = safe / 1024;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  const decimals = value >= 100 ? 0 : 1;
  return `${value.toFixed(decimals)} ${units[idx] ?? "TB"}`;
}
