"use client";

import type { AutonomyLevel, AutonomyPolicySummary, QuietGovernanceSummary } from "@inkade/core";
import { AUTONOMY_LEVELS } from "@inkade/core";
import { type InkadeTranslationSchema, useInkadeTranslation } from "@inkade/i18n";
import { CheckCircle2Icon, LockIcon, RotateCcwIcon, ShieldCheckIcon } from "lucide-react";
import type * as React from "react";
import { cn } from "../lib/utils.ts";
import { SegmentedControl, SegmentedControlItem } from "../primitives/segmented-control.tsx";

type SettingsTranslationKey = `settings.${keyof InkadeTranslationSchema["settings"]}`;

const STOP_LABEL_KEYS: Readonly<Record<AutonomyLevel, SettingsTranslationKey>> = {
  auto: "settings.autonomyStopAuto",
  draft: "settings.autonomyStopDraft",
  ask: "settings.autonomyStopAsk",
};

const ACTION_LABEL_KEYS: Readonly<Record<string, SettingsTranslationKey>> = {
  read: "settings.autonomyActionRead",
  append: "settings.autonomyActionAppend",
  write: "settings.autonomyActionWrite",
  soft_delete: "settings.autonomyActionSoftDelete",
  admin: "settings.autonomyActionAdmin",
  hard_delete: "settings.autonomyActionHardDelete",
};

export interface AutonomyDialProps {
  readonly value: AutonomyLevel;
  readonly onChange?: ((level: AutonomyLevel) => void) | undefined;
  readonly policy: AutonomyPolicySummary;
  readonly quietSummary?: QuietGovernanceSummary | undefined;
  readonly disabled?: boolean | undefined;
  readonly readOnly?: boolean | undefined;
  readonly variant?: "card" | "embedded" | undefined;
  readonly className?: string | undefined;
}

/**
 * Quiet Autonomy Execution Mode & Safety Guardrails Dial:
 * - Maps Autonomous (Quiet) / Sandbox Only (Append) / Read Only execution boundaries
 * - Displays permitted actions alongside hard safety locks & always-on batch rollback guarantee
 * - Eliminates pre-write approval blockers so scoped work happens calmly and reversibly
 */
export function AutonomyDial({
  value,
  onChange,
  policy,
  quietSummary,
  disabled = false,
  readOnly = false,
  variant = "card",
  className,
}: AutonomyDialProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const isEmbedded = variant === "embedded";
  const interactive = Boolean(onChange) && !disabled && !readOnly;

  const allowedActions = quietSummary?.allowedActions ?? policy.autoActions;
  const blockedActions = quietSummary?.blockedActions ?? policy.lockedActions;

  return (
    <div
      className={cn(
        "flex flex-col gap-3",
        !isEmbedded && "rounded-lg border border-border bg-card p-3.5 sm:p-4",
        className,
      )}
      data-level={value}
      data-slot="autonomy-dial"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold text-foreground">
          {t("settings.autonomyDialTitle")}
        </span>
        <span
          className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
          data-slot="autonomy-dial-badge"
        >
          <ShieldCheckIcon className="size-3 text-emerald-600 dark:text-emerald-400" />
          <span>{t("settings.autonomyDialServerLockBadge")}</span>
        </span>
      </div>

      <SegmentedControl
        aria-label={t("settings.autonomyDialAria")}
        className="grid w-full grid-cols-1 sm:grid-cols-3"
        role="radiogroup"
      >
        {AUTONOMY_LEVELS.map((level) => {
          const checked = value === level;
          return (
            <SegmentedControlItem
              aria-checked={checked}
              data-autonomy-stop={level}
              data-checked={checked ? "" : undefined}
              disabled={!interactive}
              key={level}
              onClick={() => {
                if (!interactive) return;
                onChange?.(level);
              }}
              role="radio"
            >
              {t(STOP_LABEL_KEYS[level])}
            </SegmentedControlItem>
          );
        })}
      </SegmentedControl>

      <div className="grid gap-2.5 sm:grid-cols-2">
        <div
          className="flex flex-col gap-1.5 rounded-md border border-emerald-500/20 bg-emerald-500/[0.04] p-2.5"
          data-slot="autonomy-dial-auto-matrix"
        >
          <span className="text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
            {t("settings.autonomyAutoColTitle")}
          </span>
          <div className="flex flex-wrap gap-1.5">
            {allowedActions.map((action) => {
              const labelKey = ACTION_LABEL_KEYS[action];
              return (
                <span
                  className="inline-flex items-center gap-1 rounded-sm border border-emerald-500/25 bg-background/80 px-1.5 py-0.5 text-[11px] text-foreground"
                  key={action}
                >
                  <CheckCircle2Icon className="size-3 text-emerald-600 dark:text-emerald-400" />
                  <span>{labelKey ? t(labelKey) : action}</span>
                </span>
              );
            })}
          </div>
          {value === "ask" && (
            <span className="text-[11px] text-muted-foreground">
              {t("settings.autonomyNoAutoActions")}
            </span>
          )}
        </div>

        <div
          className="flex flex-col gap-1.5 rounded-md border border-border/75 bg-muted/25 p-2.5"
          data-slot="autonomy-dial-safety-locks"
        >
          <span className="text-[11px] font-medium text-foreground">
            {t("settings.autonomyApprovalColTitle")}
          </span>
          <div className="flex flex-wrap gap-1.5">
            {blockedActions.map((action) => {
              const labelKey = ACTION_LABEL_KEYS[action];
              return (
                <span
                  className="inline-flex items-center gap-1 rounded-sm border border-border/70 bg-background/80 px-1.5 py-0.5 text-[11px] text-muted-foreground"
                  key={action}
                >
                  <LockIcon className="size-3 shrink-0" />
                  <span>{labelKey ? t(labelKey) : action}</span>
                </span>
              );
            })}
          </div>
          <span className="text-[11px] leading-relaxed text-muted-foreground">
            {value === "ask"
              ? t("settings.autonomyNoAutoActions")
              : t("settings.autonomyNoExtraApprovals")}
          </span>
        </div>
      </div>

      <div
        className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/70 bg-muted/25 px-2.5 py-1.5 text-[11px] text-muted-foreground"
        data-slot="autonomy-dial-server-lock"
      >
        <span className="inline-flex items-center gap-1.5">
          <LockIcon className="size-3 shrink-0 text-muted-foreground" />
          <span>{t("settings.autonomyHardDeleteLock")}</span>
        </span>
        <span className="inline-flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-300">
          <RotateCcwIcon className="size-3 shrink-0" />
          <span>{t("settings.autonomyRollbackGuarantee")}</span>
        </span>
      </div>
    </div>
  );
}
