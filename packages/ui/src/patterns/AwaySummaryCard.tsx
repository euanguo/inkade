"use client";

import type { AwaySummaryCategory, AwaySummaryItem, AwaySummaryResponse } from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import {
  BellRingIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  XIcon,
} from "lucide-react";
import type React from "react";
import { useMemo, useState } from "react";
import { cn } from "../lib/utils.ts";
import { Badge } from "../primitives/badge.tsx";
import { Button } from "../primitives/button.tsx";
import { GlideHighlight } from "../primitives/glide-highlight.tsx";

const CATEGORY_ORDER: Readonly<Record<AwaySummaryCategory, number>> = {
  needs_decision: 0,
  failed: 1,
  completed: 2,
  unread_document: 3,
};

const CATEGORY_DOT_CLASS: Readonly<Record<AwaySummaryCategory, string>> = {
  needs_decision: "bg-[#D97706]",
  failed: "bg-[#DC2626]",
  completed: "bg-[#16A34A]",
  unread_document: "bg-[#5E6AD2]",
};

const CATEGORY_BADGE_VARIANT: Readonly<
  Record<AwaySummaryCategory, "warning" | "error" | "success" | "info">
> = {
  needs_decision: "warning",
  failed: "error",
  completed: "success",
  unread_document: "info",
};

/**
 * Sorts away-summary items deterministically:
 * `needs_decision` -> `failed` -> `completed` -> `unread_document`, newest first within each category.
 */
export function sortAwaySummaryItems(items: readonly AwaySummaryItem[]): AwaySummaryItem[] {
  return [...items].sort((a, b) => {
    const rankDiff = CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category];
    if (rankDiff !== 0) return rankDiff;
    return b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id);
  });
}

/**
 * Converts elapsed milliseconds into clamped non-negative whole hours and minutes.
 */
export function formatAwayElapsedParts(elapsedMs: number): {
  readonly hours: number;
  readonly minutes: number;
} {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) {
    return { hours: 0, minutes: 0 };
  }
  const totalMinutes = Math.max(0, Math.floor(elapsedMs / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return { hours, minutes };
}

export interface AwaySummaryCardProps {
  readonly summary: AwaySummaryResponse | null | undefined;
  readonly onSelectItem?: ((item: AwaySummaryItem) => void) | undefined;
  readonly onDismiss?: (() => void) | undefined;
  readonly defaultCollapsed?: boolean | undefined;
  readonly collapsed?: boolean | undefined;
  readonly onCollapsedChange?: ((collapsed: boolean) => void) | undefined;
  readonly className?: string | undefined;
}

/**
 * Nested tray + 1px crisp unified summary card listing activity since the user was away.
 */
export function AwaySummaryCard({
  summary,
  onSelectItem,
  onDismiss,
  defaultCollapsed = false,
  collapsed: controlledCollapsed,
  onCollapsedChange,
  className,
}: AwaySummaryCardProps): React.ReactElement | null {
  const { t } = useInkadeTranslation();
  const [uncontrolledCollapsed, setUncontrolledCollapsed] = useState(defaultCollapsed);
  const isCollapsed = controlledCollapsed ?? uncontrolledCollapsed;

  const setCollapsed = (next: boolean): void => {
    if (controlledCollapsed === undefined) {
      setUncontrolledCollapsed(next);
    }
    onCollapsedChange?.(next);
  };

  const sortedItems = useMemo(
    () => (summary ? sortAwaySummaryItems(summary.items) : []),
    [summary],
  );

  if (!summary || sortedItems.length === 0) {
    return null;
  }

  const elapsed = formatAwayElapsedParts(summary.elapsedMs);
  const elapsedLabel =
    elapsed.hours > 0
      ? t("agentControl.awayElapsedHm", { hours: elapsed.hours, minutes: elapsed.minutes })
      : t("agentControl.awayElapsedMinutes", { minutes: elapsed.minutes });

  const categoryLabels: Readonly<Record<AwaySummaryCategory, string>> = {
    needs_decision: t("agentControl.awayCatNeedsDecision"),
    failed: t("agentControl.awayCatFailed"),
    completed: t("agentControl.awayCatCompleted"),
    unread_document: t("agentControl.awayCatUnreadDoc"),
  };

  const actionLabels: Readonly<Record<AwaySummaryCategory, string>> = {
    needs_decision: t("agentControl.awayActionApprove"),
    failed: t("agentControl.awayActionRetry"),
    completed: t("agentControl.awayActionReviewDiff"),
    unread_document: t("agentControl.awayActionReviewDiff"),
  };

  return (
    <section
      aria-label={t("agentControl.awaySummaryTitle")}
      className={cn(
        "overflow-hidden rounded-lg border border-border bg-card shadow-[var(--shadow-card)] transition-colors duration-[var(--duration-quick)] ease-[var(--ease-out-strong)]",
        className,
      )}
      data-collapsed={isCollapsed ? "true" : "false"}
      data-slot="away-summary-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 bg-muted/30 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden="true"
            className="inline-flex size-[22px] shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
          >
            <BellRingIcon className="size-3.5" />
          </span>
          <h2 className="truncate text-xs font-semibold text-foreground">
            {t("agentControl.awaySummaryTitle")}
          </h2>
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
            {elapsedLabel}
          </span>
          <Badge className="tabular-nums" size="sm" variant="secondary">
            {sortedItems.length}
          </Badge>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1">
          <Button
            aria-expanded={!isCollapsed}
            onClick={() => setCollapsed(!isCollapsed)}
            size="xs"
            type="button"
            variant="ghost"
          >
            {isCollapsed ? (
              <>
                <ChevronDownIcon className="size-3.5" />
                <span>{t("agentControl.reexpandSummary")}</span>
              </>
            ) : (
              <>
                <ChevronUpIcon className="size-3.5" />
                <span>{t("agentControl.collapseSummary")}</span>
              </>
            )}
          </Button>
          {onDismiss ? (
            <Button
              aria-label={t("agentControl.dismissSummaryAria")}
              onClick={onDismiss}
              size="icon-xs"
              type="button"
              variant="ghost"
            >
              <XIcon className="size-3.5" />
            </Button>
          ) : null}
        </div>
      </div>

      {isCollapsed ? (
        <div
          className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs text-muted-foreground"
          data-slot="away-summary-collapsed-bar"
        >
          <span className="truncate tabular-nums">
            {t("agentControl.awayCollapsedLine", {
              needsDecision: summary.counts.needsDecision,
              failed: summary.counts.failed,
              completed: summary.counts.completed,
              unread: summary.counts.unreadDocuments,
            })}
          </span>
          <Button
            onClick={() => setCollapsed(false)}
            size="xs"
            type="button"
            variant="outline"
          >
            {t("agentControl.reexpandSummary")}
          </Button>
        </div>
      ) : (
        <GlideHighlight
          highlightClassName="bg-muted/45"
          mode="pointer"
          rowSelector="[data-slot='away-summary-row']"
        >
          <div
            className="divide-y divide-border/70"
            data-slot="away-summary-list"
          >
            {sortedItems.map((item) => (
              <div
                className="relative z-10 flex flex-wrap items-center justify-between gap-2.5 px-3 py-2.5 transition-colors duration-[var(--duration-micro)] ease-[var(--ease-out-strong)] hover:bg-muted/35 in-data-[glide-visible=true]:hover:bg-transparent"
                data-away-category={item.category}
                data-slot="away-summary-row"
                key={item.id}
              >
                <div className="flex min-w-0 flex-1 items-center gap-2.5">
                  <span
                    aria-hidden="true"
                    className={cn("size-1.5 shrink-0 rounded-full", CATEGORY_DOT_CLASS[item.category])}
                  />
                  <Badge size="sm" variant={CATEGORY_BADGE_VARIANT[item.category]}>
                    {categoryLabels[item.category]}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-foreground">{item.title}</p>
                    {item.documentTitle && item.documentTitle !== item.title ? (
                      <p className="truncate text-[11px] text-muted-foreground">
                        {item.documentTitle}
                      </p>
                    ) : null}
                  </div>
                </div>

                <Button
                  className="shrink-0"
                  onClick={() => onSelectItem?.(item)}
                  size="xs"
                  type="button"
                  variant={item.category === "needs_decision" ? "default" : "outline"}
                >
                  {actionLabels[item.category]}
                </Button>
              </div>
            ))}
          </div>
        </GlideHighlight>
      )}
    </section>
  );
}
