"use client";

import type { AgentStepItem, AgentStepSource, AgentStepStatus } from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../lib/utils.ts";
import { GridDisclosure } from "../primitives/grid-disclosure.tsx";
import { ThinkingIndicator } from "../primitives/thinking-indicator.tsx";

const MAX_VISIBLE_SOURCE_PILLS = 3;

const STEP_DOT_CLASS: Readonly<Record<AgentStepStatus, string>> = {
  pending: "bg-muted-foreground/45",
  running: "bg-[#2563EB] animate-pulse",
  completed: "bg-[#16A34A]",
  failed: "bg-[#DC2626]",
};

/**
 * Collects unique step sources preserving first-seen order, capped at `maxVisible` pills + overflow count.
 */
export function collectUniqueStepSources(
  steps: readonly AgentStepItem[],
  maxVisible = MAX_VISIBLE_SOURCE_PILLS,
): {
  readonly visible: readonly AgentStepSource[];
  readonly overflowCount: number;
} {
  const unique: AgentStepSource[] = [];
  const seen = new Set<string>();
  for (const step of steps) {
    for (const src of step.sources ?? []) {
      const normalizedLabel = src.label.trim();
      if (!normalizedLabel) continue;
      const key = `${(src.kind ?? "").trim().toUpperCase()}::${normalizedLabel.toUpperCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push({
        label: normalizedLabel,
        ...(src.kind ? { kind: src.kind } : {}),
      });
    }
  }
  const safeMax = Math.max(1, maxVisible);
  const visible = unique.slice(0, safeMax);
  return {
    visible,
    overflowCount: Math.max(0, unique.length - visible.length),
  };
}

/**
 * Returns true only when `collapseOnComplete` is enabled and steps transitioned
 * from an active `running` state to all steps `completed`.
 */
export function shouldAutoCollapseSteps(
  wasRunning: boolean,
  steps: readonly AgentStepItem[],
  collapseOnComplete: boolean,
): boolean {
  if (!collapseOnComplete || !wasRunning || steps.length === 0) return false;
  const hasRunning = steps.some((s) => s.status === "running");
  const allCompleted = steps.every((s) => s.status === "completed");
  return !hasRunning && allCompleted;
}

export interface AgentStepsLogProps {
  readonly steps: readonly AgentStepItem[];
  readonly collapseOnComplete?: boolean | undefined;
  readonly defaultExpanded?: boolean | undefined;
  readonly elapsedMs?: number | undefined;
  readonly statusLabel?: string | undefined;
  readonly variant?: "card" | "embedded" | undefined;
  readonly className?: string | undefined;
}

/**
 * Collapsible execution steps drawer with live ThinkingIndicator, unique source pills,
 * tabular-nums step durations, and optional auto-collapse upon completion.
 */
export function AgentStepsLog({
  steps,
  collapseOnComplete = false,
  defaultExpanded = true,
  elapsedMs,
  statusLabel,
  variant = "card",
  className,
}: AgentStepsLogProps): React.ReactElement | null {
  const { t } = useInkadeTranslation();
  const [expanded, setExpanded] = useState(defaultExpanded);

  const hasRunning = steps.some((s) => s.status === "running");
  const hasFailed = steps.some((s) => s.status === "failed");
  const completedCount = steps.filter((s) => s.status === "completed").length;
  const wasRunningRef = useRef<boolean>(hasRunning);

  useEffect(() => {
    if (shouldAutoCollapseSteps(wasRunningRef.current, steps, collapseOnComplete)) {
      setExpanded(false);
    }
    wasRunningRef.current = hasRunning;
  }, [collapseOnComplete, hasRunning, steps]);

  const { visible: visibleSources, overflowCount } = useMemo(
    () => collectUniqueStepSources(steps, MAX_VISIBLE_SOURCE_PILLS),
    [steps],
  );

  if (steps.length === 0) {
    return null;
  }

  const resolvedHeaderLabel =
    statusLabel ??
    (hasRunning
      ? t("agentControl.stepsRunning")
      : hasFailed
        ? t("agentControl.stepsFailed")
        : completedCount === steps.length
          ? t("agentControl.stepsCompleted")
          : t("agentControl.stepsIdle"));

  const formatDurationLabel = (step: AgentStepItem): string => {
    if (step.status === "running") return t("agentControl.stepStatusRunning");
    if (step.status === "failed" && step.durationMs == null) {
      return t("agentControl.stepStatusFailed");
    }
    if (step.durationMs == null) return t("agentControl.stepStatusPending");
    if (step.durationMs >= 1000) {
      const sec = (step.durationMs / 1000).toFixed(1);
      return t("agentControl.stepDurationSec", { sec });
    }
    return t("agentControl.stepDurationMs", { ms: step.durationMs });
  };

  const formattedTotalDuration =
    elapsedMs !== undefined && Number.isFinite(elapsedMs)
      ? elapsedMs >= 1000
        ? t("agentControl.stepDurationSec", { sec: (elapsedMs / 1000).toFixed(1) })
        : t("agentControl.stepDurationMs", { ms: Math.max(0, Math.round(elapsedMs)) })
      : null;

  return (
    <div
      className={cn(
        variant === "card"
          ? "overflow-hidden rounded-lg border border-border bg-card shadow-[var(--shadow-card)]"
          : "overflow-hidden rounded-md bg-muted/30",
        className,
      )}
      data-expanded={expanded ? "true" : "false"}
      data-slot="agent-steps-log"
    >
      <button
        aria-expanded={expanded}
        aria-label={t("agentControl.toggleStepsAria")}
        className="flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-2 text-left transition-colors duration-[var(--duration-micro)] ease-[var(--ease-smooth-out)] hover:bg-muted/35"
        onClick={() => setExpanded((prev) => !prev)}
        type="button"
      >
        <div className="flex min-w-0 items-center gap-2">
          {hasRunning ? (
            <ThinkingIndicator shimmer={false} size="sm" />
          ) : hasFailed ? (
            <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-[#DC2626]" />
          ) : (
            <span
              aria-hidden="true"
              className="inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-[#16A34A]/12 text-[#16A34A] dark:text-emerald-400"
            >
              <CheckIcon className="size-2.5" />
            </span>
          )}
          <span className="truncate text-xs font-medium text-foreground">
            {resolvedHeaderLabel}
          </span>
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
            {t("agentControl.stepsProgressCount", {
              completed: completedCount,
              total: steps.length,
            })}
          </span>
          {formattedTotalDuration ? (
            <span className="hidden shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground/80 sm:inline">
              {formattedTotalDuration}
            </span>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {visibleSources.length > 0 ? (
            <div className="flex items-center" data-slot="agent-steps-sources">
              {visibleSources.map((src, idx) => (
                <span
                  className="-ml-1.5 inline-flex items-center rounded-full border-2 border-card bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium text-foreground/85 first:ml-0"
                  key={`${src.kind ?? "src"}-${src.label}-${idx}`}
                  title={src.label}
                >
                  {src.label}
                </span>
              ))}
              {overflowCount > 0 ? (
                <span className="-ml-1.5 inline-flex items-center rounded-full border-2 border-card bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium tabular-nums text-muted-foreground">
                  {t("agentControl.hostOverflowCount", { count: overflowCount })}
                </span>
              ) : null}
            </div>
          ) : null}

          <ChevronDownIcon
            aria-hidden="true"
            className={cn(
              "size-3.5 text-muted-foreground transition-transform duration-[var(--duration-quick)] ease-[var(--ease-out-strong)]",
              expanded && "rotate-180",
            )}
          />
        </div>
      </button>

      <GridDisclosure open={expanded}>
        <ul
          className="relative divide-y divide-border/70 border-t border-border/70 before:pointer-events-none before:absolute before:top-3.5 before:bottom-3.5 before:left-[14.5px] before:w-px before:bg-border/75"
          data-slot="agent-steps-list"
        >
          {steps.map((step) => (
            <li
              className="relative z-10 flex items-center justify-between gap-3 px-3 py-2 text-xs transition-colors duration-[var(--duration-micro)] hover:bg-muted/25"
              data-step-id={step.id}
              data-step-status={step.status}
              key={step.id}
            >
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span
                  aria-hidden="true"
                  className={cn("size-1.5 shrink-0 rounded-full ring-2 ring-card", STEP_DOT_CLASS[step.status])}
                  data-motion-essential={step.status === "running" ? "pulse" : undefined}
                />
                <span
                  className={cn(
                    "truncate",
                    step.status === "pending"
                      ? "text-muted-foreground"
                      : step.status === "running"
                        ? "inkade-shimmer-text font-medium"
                        : step.status === "failed"
                          ? "font-medium text-destructive-foreground"
                          : "text-foreground/90",
                  )}
                >
                  {step.label}
                </span>
              </div>

              <span
                className={cn(
                  "shrink-0 font-mono text-[11px] tabular-nums",
                  step.status === "running"
                    ? "font-medium text-[#2563EB] dark:text-blue-400"
                    : step.status === "failed"
                      ? "text-[#DC2626] dark:text-rose-400"
                      : "text-muted-foreground",
                )}
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {formatDurationLabel(step)}
              </span>
            </li>
          ))}
        </ul>
      </GridDisclosure>
    </div>
  );
}
