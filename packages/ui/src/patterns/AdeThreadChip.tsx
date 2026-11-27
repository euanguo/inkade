"use client";

import {
  type AdeKind,
  type AdeThreadBinding,
  type AdeThreadStatus,
  formatHostDisplayName,
} from "@inkade/core";
import { t as translate, useInkadeTranslation } from "@inkade/i18n";
import {
  AlertCircleIcon,
  ArchiveIcon,
  CheckCircle2Icon,
  ClockIcon,
  ExternalLinkIcon,
  EyeIcon,
  LoaderCircleIcon,
  MessageSquareIcon,
  UnlinkIcon,
} from "lucide-react";
import type React from "react";
import { cn } from "../lib/utils.ts";
import { Badge } from "../primitives/badge.tsx";
import { Button } from "../primitives/button.tsx";
import {
  PreviewCard,
  PreviewCardPopup,
  PreviewCardTrigger,
} from "../primitives/preview-card.tsx";
import { Separator } from "../primitives/separator.tsx";

export function formatAdeKindLabel(
  kind: AdeKind,
  translateFn: (key: "common.adeAny" | "common.adeGeneric") => string,
): string {
  const normalized = kind.trim().toLowerCase();
  if (!normalized || normalized === "any") {
    return translateFn("common.adeAny");
  }
  if (normalized === "generic") {
    return translateFn("common.adeGeneric");
  }
  return formatHostDisplayName(normalized, translateFn("common.adeAny"));
}

interface StatusMeta {
  readonly label: string;
  readonly chipClassName: string;
  readonly dotClassName: string;
  readonly badgeVariant: "default" | "secondary" | "info" | "warning" | "success" | "error" | "outline";
}

export const ADE_STATUS_META: Readonly<Record<AdeThreadStatus, StatusMeta>> = {
  queued: {
    label: "Queued",
    chipClassName: "border-border bg-muted/70 text-muted-foreground hover:bg-muted",
    dotClassName: "bg-ade-queued",
    badgeVariant: "secondary",
  },
  running: {
    label: "Running",
    chipClassName: "border-info/25 bg-info/10 text-info-foreground hover:bg-info/15",
    dotClassName: "bg-ade-running inkade-ade-pulse",
    badgeVariant: "info",
  },
  waiting_input: {
    label: "Waiting Input",
    chipClassName: "border-warning/35 bg-warning/12 text-warning-foreground hover:bg-warning/18",
    dotClassName: "bg-ade-waiting",
    badgeVariant: "warning",
  },
  completed: {
    label: "Done",
    chipClassName: "border-success/25 bg-success/10 text-success-foreground hover:bg-success/15",
    dotClassName: "bg-ade-completed",
    badgeVariant: "success",
  },
  failed: {
    label: "Failed",
    chipClassName: "border-destructive/30 bg-destructive/10 text-destructive-foreground hover:bg-destructive/15",
    dotClassName: "bg-ade-failed",
    badgeVariant: "error",
  },
  archived: {
    label: "Archived",
    chipClassName: "border-border/60 bg-muted/40 text-muted-foreground/80 hover:bg-muted/60",
    dotClassName: "bg-ade-archived",
    badgeVariant: "outline",
  },
};

export function formatRelativeTime(isoDate: string, nowMs: number = Date.now()): string {
  const parsed = Date.parse(isoDate);
  if (Number.isNaN(parsed)) return isoDate;
  const diffSec = Math.max(0, Math.floor((nowMs - parsed) / 1000));
  if (diffSec < 10) return translate("common.justNow");
  if (diffSec < 60) return translate("common.secondsAgo", { count: diffSec });
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return translate("common.minutesAgo", { count: diffMin });
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return translate("common.hoursAgo", { count: diffHr });
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return translate("common.daysAgo", { count: diffDay });
  return new Date(parsed).toISOString().slice(0, 10);
}

function StatusIcon({ status }: { status: AdeThreadStatus }): React.ReactElement {
  switch (status) {
    case "running":
      return <LoaderCircleIcon className="size-3 animate-spin" />;
    case "waiting_input":
      return <MessageSquareIcon className="size-3" />;
    case "completed":
      return <CheckCircle2Icon className="size-3" />;
    case "failed":
      return <AlertCircleIcon className="size-3" />;
    case "archived":
      return <ArchiveIcon className="size-3" />;
    case "queued":
      return <ClockIcon className="size-3" />;
  }
}

export interface AdeThreadChipProps {
  readonly binding: AdeThreadBinding;
  readonly onOpenInAde?: ((binding: AdeThreadBinding) => void) | undefined;
  readonly onMarkRead?: ((binding: AdeThreadBinding) => void) | undefined;
  readonly onUnbind?: ((binding: AdeThreadBinding) => void) | undefined;
  readonly compact?: boolean | undefined;
  readonly className?: string | undefined;
}

export function AdeThreadChip({
  binding,
  onOpenInAde,
  onMarkRead,
  onUnbind,
  compact = false,
  className,
}: AdeThreadChipProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const statusMeta = ADE_STATUS_META[binding.status];
  const statusLabelMap: Readonly<Record<AdeThreadStatus, string>> = {
    queued: t("common.statusQueued"),
    running: t("common.statusRunning"),
    waiting_input: t("common.statusWaitingInput"),
    completed: t("common.statusCompleted"),
    failed: t("common.statusFailed"),
    archived: t("common.statusArchived"),
  };
  const kindLabel = formatAdeKindLabel(binding.adeKind, t);
  const statusLabel = statusLabelMap[binding.status];
  const relTime = formatRelativeTime(binding.lastSyncedAt);

  return (
    <PreviewCard>
      <PreviewCardTrigger
        render={
          <button
            className={cn(
              "inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
              statusMeta.chipClassName,
              className,
            )}
            data-ade-kind={binding.adeKind}
            data-ade-status={binding.status}
            onClick={() => onOpenInAde?.(binding)}
            type="button"
          />
        }
      >
        <span
          aria-hidden="true"
          className={cn("size-1.5 shrink-0 rounded-full", statusMeta.dotClassName)}
        />
        <span className="shrink-0 font-semibold">{kindLabel}</span>
        <span className="opacity-50">·</span>
        <span className="shrink-0">{statusLabel}</span>
        {!compact && (
          <>
            <span className="opacity-50">·</span>
            <span className="truncate font-mono text-[11px] opacity-80">{relTime}</span>
          </>
        )}
        {binding.unreadResult && (
          <span
            aria-label={t("adeChip.unreadResultAria")}
            className="ml-0.5 size-1.5 shrink-0 rounded-full bg-info ring-2 ring-background"
          />
        )}
      </PreviewCardTrigger>

      <PreviewCardPopup align="start" className="w-80 flex-col gap-3 p-3.5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge size="sm" variant="outline">
                {kindLabel}
              </Badge>
              <Badge size="sm" variant={statusMeta.badgeVariant}>
                <StatusIcon status={binding.status} />
                {statusLabel}
              </Badge>
              {binding.unreadResult && (
                <Badge size="sm" variant="info">
                  {t("common.unread")}
                </Badge>
              )}
            </div>
            <h4 className="truncate text-sm font-semibold text-foreground">{binding.title}</h4>
          </div>
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{relTime}</span>
        </div>

        {binding.lastSummary ? (
          <p className="line-clamp-4 rounded-md border bg-muted/40 px-2.5 py-2 text-xs leading-relaxed text-foreground/90">
            {binding.lastSummary}
          </p>
        ) : (
          <p className="text-xs italic text-muted-foreground">{t("adeChip.noSummaryYet")}</p>
        )}

        <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span className="truncate font-mono">{binding.externalThreadId}</span>
          {binding.selectionAnchor?.headingSlug && (
            <span className="truncate font-mono">#{binding.selectionAnchor.headingSlug}</span>
          )}
        </div>

        {(onOpenInAde || (binding.unreadResult && onMarkRead) || onUnbind) && (
          <>
            <Separator />
            <div className="flex flex-wrap items-center justify-between gap-1.5">
              <div className="flex items-center gap-1.5">
                {onOpenInAde && (
                  <Button
                    onClick={() => onOpenInAde(binding)}
                    size="xs"
                    variant="default"
                  >
                    <ExternalLinkIcon />
                    {t("adeChip.openInAde")}
                  </Button>
                )}
                {binding.unreadResult && onMarkRead && (
                  <Button
                    onClick={() => onMarkRead(binding)}
                    size="xs"
                    variant="outline"
                  >
                    <EyeIcon />
                    {t("adeChip.markRead")}
                  </Button>
                )}
              </div>
              {onUnbind && (
                <Button
                  aria-label={t("adeChip.unbindThreadAria")}
                  onClick={() => onUnbind(binding)}
                  size="icon-xs"
                  variant="ghost"
                >
                  <UnlinkIcon className="text-muted-foreground hover:text-destructive-foreground" />
                </Button>
              )}
            </div>
          </>
        )}
      </PreviewCardPopup>
    </PreviewCard>
  );
}
