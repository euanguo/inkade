"use client";

import {
  type AdeKind,
  type AdeThreadBinding,
  type ThreadConflictItem,
  getHostInitials,
} from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import { AlertTriangleIcon, GitCompareIcon } from "lucide-react";
import type React from "react";
import { cn } from "../lib/utils.ts";
import { Badge } from "../primitives/badge.tsx";
import { Button } from "../primitives/button.tsx";
import { getHostToneStyle } from "../primitives/tag-pill.tsx";

export interface ConflictHostBadge {
  readonly id: string;
  readonly adeKind: AdeKind;
  readonly initials: string;
  readonly title: string;
}

/**
 * Returns compact 2-letter initials for an ADE host binding pill.
 */
export function getHostBadgeInitials(binding: Pick<AdeThreadBinding, "adeKind">): string {
  return getHostInitials(binding.adeKind);
}

/**
 * Computes visible overlapping host initials badges and overflow count for a conflict set.
 */
export function summarizeConflictHosts(
  bindings: readonly AdeThreadBinding[],
  maxVisible = 4,
): {
  readonly visible: readonly ConflictHostBadge[];
  readonly overflowCount: number;
} {
  const uniqueBindings: AdeThreadBinding[] = [];
  const seenIds = new Set<string>();
  for (const b of bindings) {
    if (seenIds.has(b.id)) continue;
    seenIds.add(b.id);
    uniqueBindings.push(b);
  }
  const safeMax = Math.max(1, maxVisible);
  const visible = uniqueBindings.slice(0, safeMax).map((b) => ({
    id: b.id,
    adeKind: b.adeKind,
    initials: getHostBadgeInitials(b),
    title: b.title,
  }));
  return {
    visible,
    overflowCount: Math.max(0, uniqueBindings.length - visible.length),
  };
}

export interface ConflictRadarBannerProps {
  readonly conflicts: readonly ThreadConflictItem[];
  readonly documentTitlesById?: ReadonlyMap<string, string> | Readonly<Record<string, string>> | undefined;
  readonly onCompare?: ((conflict: ThreadConflictItem) => void) | undefined;
  readonly onSelectBinding?: ((bindingId: string, conflict: ThreadConflictItem) => void) | undefined;
  readonly className?: string | undefined;
}

function isStringReadonlyMap(
  value: ReadonlyMap<string, string> | Readonly<Record<string, string>>,
): value is ReadonlyMap<string, string> {
  return value instanceof Map;
}

function resolveDocTitle(
  documentId: string,
  map?: ReadonlyMap<string, string> | Readonly<Record<string, string>>,
): string {
  if (!map) return documentId;
  if (isStringReadonlyMap(map)) {
    return map.get(documentId) ?? documentId;
  }
  return map[documentId] ?? documentId;
}

/**
 * Compact 1px neutral hairline banner surfacing concurrent ADE bindings targeting the same document/section.
 */
export function ConflictRadarBanner({
  conflicts,
  documentTitlesById,
  onCompare,
  onSelectBinding,
  className,
}: ConflictRadarBannerProps): React.ReactElement | null {
  const { t } = useInkadeTranslation();

  if (conflicts.length === 0) {
    return null;
  }

  const primary = conflicts[0]!;
  const allBindings = conflicts.flatMap((c) => c.bindings);
  const { visible, overflowCount } = summarizeConflictHosts(allBindings, 4);

  const scopeLabels: Readonly<Record<ThreadConflictItem["scope"], string>> = {
    node: t("agentControl.conflictScopeNode"),
    selection: t("agentControl.conflictScopeSelection"),
    document: t("agentControl.conflictScopeDocument"),
  };

  const targetName = resolveDocTitle(primary.documentId, documentTitlesById);
  const summaryText =
    conflicts.length === 1
      ? t("agentControl.conflictSingleSummary", {
          count: primary.bindings.length,
          target: targetName,
        })
      : t("agentControl.conflictMultiSummary", {
          conflicts: conflicts.length,
          threads: allBindings.length,
        });

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-3.5 py-2.5",
        className,
      )}
      data-conflict-count={conflicts.length}
      data-slot="conflict-radar-banner"
      role="status"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <span
          aria-hidden="true"
          className="inline-flex size-[22px] shrink-0 items-center justify-center rounded-md bg-amber-500/12 text-[#D97706] dark:bg-amber-400/15 dark:text-amber-300"
        >
          <AlertTriangleIcon className="size-3.5" />
        </span>

        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="truncate text-xs font-medium text-foreground">{summaryText}</span>
          <Badge size="sm" variant="warning">
            {scopeLabels[primary.scope]}
          </Badge>
        </div>
      </div>

      <div className="flex w-full shrink-0 items-center justify-between gap-2.5 sm:w-auto sm:justify-end">
        <div className="flex items-center" data-slot="conflict-host-pills">
          {visible.map((host) => (
            <button
              aria-label={t("agentControl.selectBindingAria", { title: host.title })}
              className={cn(
                "-ml-1.5 inline-flex size-6 cursor-pointer items-center justify-center rounded-full border-2 border-card text-[10px] font-semibold transition-transform duration-[var(--duration-micro)] ease-[var(--ease-smooth-out)] first:ml-0 hover:z-10 hover:scale-105",
                getHostToneStyle(host.adeKind).pillClass,
              )}
              key={host.id}
              onClick={() => onSelectBinding?.(host.id, primary)}
              title={host.title}
              type="button"
            >
              {host.initials}
            </button>
          ))}
          {overflowCount > 0 ? (
            <span className="-ml-1.5 inline-flex size-6 items-center justify-center rounded-full border-2 border-card bg-muted text-[10px] font-medium tabular-nums text-muted-foreground">
              {t("agentControl.hostOverflowCount", { count: overflowCount })}
            </span>
          ) : null}
        </div>

        {onCompare ? (
          <Button
            onClick={() => onCompare(primary)}
            size="xs"
            type="button"
            variant="outline"
          >
            <GitCompareIcon className="size-3.5" />
            <span>{t("agentControl.compareDiff")}</span>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
