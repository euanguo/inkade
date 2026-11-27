"use client";

import {
  formatHostDisplayName,
  type AdeThreadBinding,
  type AdeThreadStatus,
  type InkadePendingStatus,
} from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import {
  AlertCircleIcon,
  ClockIcon,
  PencilLineIcon,
  SparklesIcon,
  Trash2Icon,
} from "lucide-react";
import type React from "react";
import { cn } from "../lib/utils.ts";
import { Badge } from "../primitives/badge.tsx";
import { Button } from "../primitives/button.tsx";
import { Skeleton } from "../primitives/skeleton.tsx";
import { ThinkingIndicator } from "../primitives/thinking-indicator.tsx";

export interface InkadePendingBlockProps {
  readonly pendingId: string;
  readonly label?: string | undefined;
  readonly status?: InkadePendingStatus | undefined;
  readonly bindingId?: string | undefined;
  readonly binding?: AdeThreadBinding | undefined;
  readonly readOnly?: boolean | undefined;
  readonly onOpenBinding?: ((binding: AdeThreadBinding) => void) | undefined;
  readonly onConvertToProse?: (() => void) | undefined;
  readonly onRemovePlaceholder?: (() => void) | undefined;
  readonly className?: string | undefined;
}

function resolveEffectiveStatus(
  rawStatus: InkadePendingStatus,
  binding?: AdeThreadBinding,
): InkadePendingStatus {
  if (!binding) return rawStatus;
  if (binding.status === "failed") return "error";
  if (binding.status === "running") return "generating";
  if (binding.status === "queued" || binding.status === "waiting_input") return "queued";
  return rawStatus;
}

export function InkadePendingBlock({
  pendingId,
  label,
  status = "generating",
  bindingId,
  binding,
  readOnly = false,
  onOpenBinding,
  onConvertToProse,
  onRemovePlaceholder,
  className,
}: InkadePendingBlockProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const effectiveStatus = resolveEffectiveStatus(status, binding);
  const effectiveBindingId = binding?.id ?? (bindingId?.trim() || "");
  const displayLabel = label?.trim() || t("inkadePending.defaultLabel");

  const statusLabel =
    effectiveStatus === "error"
      ? t("inkadePending.badgeError")
      : effectiveStatus === "queued"
        ? t("inkadePending.badgeQueued")
        : t("inkadePending.badgeGenerating");

  const threadStatusMap: Readonly<Record<AdeThreadStatus, string>> = {
    queued: t("common.statusQueued"),
    running: t("common.statusRunning"),
    waiting_input: t("common.statusWaitingInput"),
    completed: t("common.statusCompleted"),
    failed: t("common.statusFailed"),
    archived: t("common.statusArchived"),
  };

  const runningStep = binding?.progressSteps?.find((step) => step.status === "running");
  const latestStep = binding?.progressSteps?.[binding.progressSteps.length - 1];
  const stepText = runningStep?.label ?? latestStep?.label ?? binding?.lastSummary ?? null;
  const startedAt =
    effectiveStatus === "generating" && binding
      ? (binding.runningSince ?? binding.createdAt)
      : null;

  const badgeVariant =
    effectiveStatus === "error"
      ? "error"
      : effectiveStatus === "queued"
        ? "secondary"
        : "info";

  return (
    <div
      className={cn(
        "not-typeset my-3 rounded-[var(--radius-card)] border border-dashed px-4 py-3 text-card-foreground transition-[border-color,background-color] duration-[var(--duration-fast)] ease-[var(--ease-smooth-out)]",
        effectiveStatus === "error"
          ? "border-destructive/35 bg-destructive/6"
          : effectiveStatus === "generating"
            ? "border-info/30 bg-muted/40"
            : "border-border bg-muted/30",
        className,
      )}
      data-binding-id={effectiveBindingId || undefined}
      data-pending-id={pendingId}
      data-pending-status={effectiveStatus}
      data-testid="inkade-pending-block"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {effectiveStatus === "generating" ? (
            <ThinkingIndicator
              shimmer={false}
              showTimer={Boolean(startedAt)}
              size="sm"
              startedAt={startedAt}
            />
          ) : effectiveStatus === "error" ? (
            <AlertCircleIcon className="size-3.5 shrink-0 text-destructive-foreground" />
          ) : (
            <ClockIcon className="size-3.5 shrink-0 text-muted-foreground" />
          )}

          <Badge size="sm" variant={badgeVariant}>
            {statusLabel}
          </Badge>

          {pendingId ? (
            <span
              className="truncate font-mono text-[10px] text-muted-foreground/70"
              title={pendingId}
            >
              {pendingId}
            </span>
          ) : null}

          {binding ? (
            onOpenBinding ? (
              <Button
                aria-label={t("inkadePending.openBoundThreadAria", { title: binding.title })}
                className="h-5 max-w-52 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
                onClick={() => onOpenBinding(binding)}
                size="xs"
                type="button"
                variant="ghost"
              >
                <SparklesIcon className="size-3 shrink-0" />
                <span className="truncate">
                  {formatHostDisplayName(binding.adeKind, binding.adeKind)} · {binding.title}
                </span>
              </Button>
            ) : (
              <Badge className="max-w-52" size="sm" variant="outline">
                <SparklesIcon className="size-3 shrink-0" />
                <span className="truncate">
                  {formatHostDisplayName(binding.adeKind, binding.adeKind)} · {binding.title}
                </span>
              </Badge>
            )
          ) : effectiveBindingId ? (
            <Badge className="font-mono" size="sm" variant="outline">
              {effectiveBindingId}
            </Badge>
          ) : null}
        </div>

        {!readOnly && (onConvertToProse || onRemovePlaceholder) ? (
          <div className="flex shrink-0 items-center gap-1">
            {onConvertToProse ? (
              <Button
                aria-label={t("inkadePending.convertToProseAria")}
                onClick={onConvertToProse}
                size="xs"
                title={t("inkadePending.convertToProseAria")}
                type="button"
                variant="outline"
              >
                <PencilLineIcon className="size-3" />
                <span>{t("inkadePending.convertToProse")}</span>
              </Button>
            ) : null}
            {onRemovePlaceholder ? (
              <Button
                aria-label={t("inkadePending.removePlaceholderAria")}
                className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive-foreground"
                onClick={onRemovePlaceholder}
                size="xs"
                title={t("inkadePending.removePlaceholderAria")}
                type="button"
                variant="ghost"
              >
                <Trash2Icon className="size-3" />
                <span>{t("inkadePending.removePlaceholder")}</span>
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      <p className="mt-2 text-sm font-medium leading-relaxed text-foreground/90">
        {displayLabel}
      </p>

      {binding && (stepText || binding.status) ? (
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>
            {t("inkadePending.threadStatusPrefix", {
              status: threadStatusMap[binding.status],
            })}
          </span>
          {stepText ? (
            <span className="truncate">
              {t("inkadePending.threadStepPrefix", { step: stepText })}
            </span>
          ) : null}
        </div>
      ) : null}

      {effectiveStatus !== "error" ? (
        <div aria-hidden="true" className="mt-2.5 flex flex-col gap-1.5">
          <Skeleton className="h-2.5 w-4/5" />
          <Skeleton className="h-2.5 w-3/5" />
        </div>
      ) : null}
    </div>
  );
}
