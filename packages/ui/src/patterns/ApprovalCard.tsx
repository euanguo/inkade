"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  type AdeKind,
  type AgentApprovalDecision,
  type AgentApprovalRisk,
  type AgentPendingApproval,
  DEFAULT_HOST_KIND,
} from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import {
  CheckCircle2Icon,
  ClockIcon,
  PauseIcon,
  RotateCcwIcon,
  ShieldAlertIcon,
  SlidersHorizontalIcon,
  XCircleIcon,
} from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useEventListener } from "usehooks-ts";
import { z } from "zod";
import { getHostToneStyle } from "../primitives/tag-pill.tsx";
import { formatAdeKindLabel } from "./AdeThreadChip.tsx";
import { cn } from "../lib/utils.ts";
import { Badge } from "../primitives/badge.tsx";
import { Button } from "../primitives/button.tsx";
import { Form, FormControl, FormField, FormItem, FormMessage } from "../primitives/form.tsx";
import { GridDisclosure } from "../primitives/grid-disclosure.tsx";
import { Input } from "../primitives/input.tsx";
import { Kbd } from "../primitives/kbd.tsx";

const RISK_BADGE_VARIANT: Readonly<Record<AgentApprovalRisk, "secondary" | "warning" | "error">> = {
  low: "secondary",
  medium: "warning",
  high: "error",
};

/**
 * Computes initial remaining milliseconds until `expiresAt`, returning `null` if invalid or absent.
 */
export function computeRemainingApprovalMs(
  expiresAt: string | null | undefined,
  nowMs: number = Date.now(),
): number | null {
  if (!expiresAt) return null;
  const target = Date.parse(expiresAt);
  if (!Number.isFinite(target)) return null;
  return Math.max(0, target - nowMs);
}

/**
 * Advances countdown state by `deltaMs` only when not paused.
 */
export function stepApprovalCountdown(
  state: { readonly remainingMs: number; readonly paused: boolean },
  deltaMs: number,
): { readonly remainingMs: number; readonly expired: boolean } {
  if (state.paused) {
    const safe = Math.max(0, state.remainingMs);
    return { remainingMs: safe, expired: safe === 0 };
  }
  const next = Math.max(0, state.remainingMs - Math.max(0, deltaMs));
  return { remainingMs: next, expired: next === 0 };
}

/**
 * Formats remaining milliseconds as `MM:SS` for tabular-nums display.
 */
export function formatCountdownMmSs(remainingMs: number): string {
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
    return "00:00";
  }
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export interface ApprovalCardProps {
  readonly approval: AgentPendingApproval;
  readonly adeKind?: AdeKind | undefined;
  readonly title?: string | undefined;
  readonly createdAt?: string | undefined;
  readonly onDecision: (decision: AgentApprovalDecision, note?: string) => void | Promise<unknown>;
  readonly onUndo?: (() => void | Promise<unknown>) | undefined;
  readonly autoFocusShortcuts?: boolean | undefined;
  readonly pending?: boolean | undefined;
  readonly variant?: "card" | "embedded" | undefined;
  readonly className?: string | undefined;
}

/**
 * Single-layer crisp card (or borderless embedded tray) for inline human-in-the-loop agent approval.
 * Pauses expiry countdown on hover/focus and morphs into a compact confirmation row with Undo upon resolution.
 */
export function ApprovalCard({
  approval,
  adeKind = DEFAULT_HOST_KIND,
  title,
  createdAt,
  onDecision,
  onUndo,
  autoFocusShortcuts = false,
  pending = false,
  variant = "card",
  className,
}: ApprovalCardProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const [adjusting, setAdjusting] = useState(false);
  const adjustInputRef = useRef<HTMLInputElement | null>(null);
  const adjustSchema = useMemo(
    () =>
      z.object({
        adjustNote: z.string().trim().min(1, t("validation.required")),
      }),
    [t],
  );
  const adjustForm = useForm<{ adjustNote: string }>({
    resolver: zodResolver(adjustSchema),
    defaultValues: { adjustNote: "" },
  });
  const watchedAdjustNote = useWatch({ control: adjustForm.control, name: "adjustNote" });

  useEffect(() => {
    if (adjusting) {
      adjustInputRef.current?.focus();
    }
  }, [adjusting]);
  const [isHovered, setIsHovered] = useState(false);
  const [isFocusedWithin, setIsFocusedWithin] = useState(false);
  const [localDecision, setLocalDecision] = useState<AgentApprovalDecision | null>(null);
  const [localNote, setLocalNote] = useState<string | null>(null);
  const [remainingMs, setRemainingMs] = useState<number | null>(() =>
    computeRemainingApprovalMs(approval.expiresAt),
  );

  const isPaused = isHovered || isFocusedWithin;
  const resolvedDecision = approval.decision ?? localDecision;
  const resolvedNote = approval.decisionNote ?? localNote;

  useEffect(() => {
    setRemainingMs(computeRemainingApprovalMs(approval.expiresAt));
    if (approval.decision !== undefined) {
      setLocalDecision(approval.decision ?? null);
      setLocalNote(approval.decisionNote ?? null);
    }
  }, [approval.id, approval.expiresAt, approval.decision, approval.decisionNote]);

  useEffect(() => {
    if (remainingMs === null || remainingMs <= 0 || isPaused || resolvedDecision) {
      return;
    }
    const timer = setInterval(() => {
      setRemainingMs((prev) => {
        if (prev === null) return null;
        return stepApprovalCountdown({ remainingMs: prev, paused: false }, 1000).remainingMs;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [isPaused, remainingMs, resolvedDecision]);

  const commitDecision = useCallback(
    (decision: AgentApprovalDecision, note?: string) => {
      if (pending) return;
      setLocalDecision(decision);
      setLocalNote(note ?? null);
      setAdjusting(false);
      adjustForm.reset({ adjustNote: "" });
      void Promise.resolve(onDecision(decision, note)).catch(() => {
        setLocalDecision(null);
        setLocalNote(null);
      });
    },
    [adjustForm, onDecision, pending],
  );

  const handleUndo = useCallback(() => {
    if (pending) return;
    setLocalDecision(null);
    setLocalNote(null);
    void onUndo?.();
  }, [onUndo, pending]);

  useEventListener("keydown", (event: KeyboardEvent) => {
    if (!autoFocusShortcuts || resolvedDecision) return;
    if (event.isComposing) return;
    const target = event.target as HTMLElement | null;
    const isInput =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target?.isContentEditable;
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      const noteValue = adjustForm.getValues("adjustNote").trim();
      if (adjusting && noteValue) {
        commitDecision("adjusted", noteValue);
      } else {
        commitDecision("approved");
      }
      return;
    }
    if (event.key === "Escape" && !isInput) {
      event.preventDefault();
      if (adjusting) {
        setAdjusting(false);
      } else {
        commitDecision("denied");
      }
    }
  });

  const kindLabel = formatAdeKindLabel(adeKind, t);
  const dotClass = getHostToneStyle(adeKind).dotClass;

  const riskLabels: Readonly<Record<AgentApprovalRisk, string>> = {
    low: t("agentControl.riskLow"),
    medium: t("agentControl.riskMedium"),
    high: t("agentControl.riskHigh"),
  };

  if (resolvedDecision) {
    const decisionText =
      resolvedDecision === "approved"
        ? t("agentControl.resolvedApproved")
        : resolvedDecision === "denied"
          ? t("agentControl.resolvedDenied")
          : t("agentControl.resolvedAdjusted");

    return (
      <div
        className={cn(
          variant === "card"
            ? "flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2 shadow-[var(--shadow-card)] transition-colors duration-[var(--duration-quick)] ease-[var(--ease-out-strong)]"
            : "flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/35 px-3 py-2 transition-colors duration-[var(--duration-quick)] ease-[var(--ease-out-strong)]",
          className,
        )}
        data-approval-decision={resolvedDecision}
        data-slot="approval-card"
        style={{
          animation: "inkade-pop-in var(--duration-fast) var(--ease-out-strong) both",
        }}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {resolvedDecision === "approved" ? (
            <CheckCircle2Icon className="size-4 shrink-0 text-[#16A34A] dark:text-emerald-400" />
          ) : resolvedDecision === "denied" ? (
            <XCircleIcon className="size-4 shrink-0 text-[#DC2626] dark:text-rose-400" />
          ) : (
            <SlidersHorizontalIcon className="size-4 shrink-0 text-[#D97706] dark:text-amber-400" />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-foreground">
              {title || approval.action} · {decisionText}
            </p>
            {resolvedNote ? (
              <p className="truncate text-[11px] text-muted-foreground">{resolvedNote}</p>
            ) : null}
          </div>
        </div>

        {onUndo ? (
          <Button
            disabled={pending}
            onClick={handleUndo}
            size="xs"
            type="button"
            variant="ghost"
          >
            <RotateCcwIcon className="size-3" />
            <span>{t("agentControl.undoDecision")}</span>
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={cn(
        variant === "card"
          ? "flex flex-col gap-2.5 rounded-lg border border-border bg-card p-3 shadow-[var(--shadow-card)]"
          : "flex flex-col gap-2.5 rounded-md bg-muted/35 p-2.5",
        className,
      )}
      data-countdown-paused={isPaused ? "true" : "false"}
      data-slot="approval-card"
      onBlur={(e) => {
        if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) {
          setIsFocusedWithin(false);
        }
      }}
      onFocus={() => setIsFocusedWithin(true)}
      onKeyDown={(e) => {
        if (autoFocusShortcuts) return;
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
          e.preventDefault();
          const noteValue = adjustForm.getValues("adjustNote").trim();
          if (adjusting && noteValue) {
            commitDecision("adjusted", noteValue);
          } else {
            commitDecision("approved");
          }
        } else if (e.key === "Escape") {
          e.preventDefault();
          if (adjusting) {
            setAdjusting(false);
          } else {
            commitDecision("denied");
          }
        }
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center justify-between gap-1.5">
          <div className="flex min-w-0 items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-amber-500/10 text-[#D97706] dark:bg-amber-400/15 dark:text-amber-300"
            >
              <ShieldAlertIcon className="size-3.5" />
            </span>

            <div className="flex min-w-0 items-center gap-1.5">
              <span
                aria-hidden="true"
                className={cn("size-1.5 shrink-0 rounded-full", dotClass)}
              />
              <span className="truncate text-[11px] font-medium text-muted-foreground">
                {kindLabel}
              </span>
              {createdAt ? (
                <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground/75">
                  {createdAt.slice(11, 16)}
                </span>
              ) : null}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <Badge size="sm" variant={RISK_BADGE_VARIANT[approval.risk]}>
              {riskLabels[approval.risk]}
            </Badge>
            {remainingMs !== null ? (
              <span
                className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-muted-foreground"
                data-slot="approval-countdown"
                style={{ fontVariantNumeric: "tabular-nums" }}
                title={isPaused && remainingMs > 0 ? t("agentControl.countdownPaused") : undefined}
              >
                {isPaused && remainingMs > 0 ? (
                  <PauseIcon className="size-3 text-amber-600 dark:text-amber-400" />
                ) : (
                  <ClockIcon className="size-3" />
                )}
                <span>
                  {remainingMs === 0
                    ? t("agentControl.countdownExpired")
                    : formatCountdownMmSs(remainingMs)}
                </span>
                {isPaused && remainingMs > 0 ? (
                  <span className="sr-only">{t("agentControl.countdownPaused")}</span>
                ) : null}
              </span>
            ) : null}
          </div>
        </div>

        <div className="min-w-0">
          <p className="text-xs font-semibold leading-snug text-foreground break-words">
            {title || approval.action || t("agentControl.approvalTitleFallback")}
          </p>
          {title && approval.action && title !== approval.action ? (
            <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground break-words">
              {approval.action}
            </p>
          ) : null}
        </div>
      </div>

      {approval.diffPreview ? (
        <div
          className="flex flex-col gap-1 rounded-md bg-muted/45 px-2.5 py-2 font-mono text-[11px] leading-relaxed"
          data-slot="approval-diff-preview"
        >
          {approval.diffPreview.oldSnippet ? (
            <div className="flex items-start gap-1.5 text-rose-700 dark:text-rose-300">
              <span aria-hidden="true" className="select-none opacity-75">
                -
              </span>
              <span className="line-clamp-2 whitespace-pre-wrap break-words">
                {approval.diffPreview.oldSnippet}
              </span>
            </div>
          ) : null}
          {approval.diffPreview.newSnippet ? (
            <div className="flex items-start gap-1.5 text-emerald-700 dark:text-emerald-300">
              <span aria-hidden="true" className="select-none opacity-75">
                +
              </span>
              <span className="line-clamp-2 whitespace-pre-wrap break-words">
                {approval.diffPreview.newSnippet}
              </span>
            </div>
          ) : null}
        </div>
      ) : null}

      <GridDisclosure open={adjusting}>
        <form
          className="flex flex-col gap-1 pt-0.5"
          noValidate
          onSubmit={(e) =>
            void adjustForm.handleSubmit((values) => {
              commitDecision("adjusted", values.adjustNote.trim());
            })(e)
          }
        >
          <Form {...adjustForm}>
            <FormField
              control={adjustForm.control}
              name="adjustNote"
              render={({ field }) => (
                <FormItem className="gap-1">
                  <div className="flex items-center gap-1.5">
                    <FormControl>
                      <Input
                        {...field}
                        className="flex-1"
                        placeholder={t("agentControl.adjustPlaceholder")}
                        ref={(node) => {
                          adjustInputRef.current = node;
                          field.ref(node);
                        }}
                        size="sm"
                        tabIndex={adjusting ? undefined : -1}
                      />
                    </FormControl>
                    <Button
                      disabled={pending || !watchedAdjustNote.trim()}
                      size="sm"
                      tabIndex={adjusting ? undefined : -1}
                      type="submit"
                      variant="default"
                    >
                      {t("agentControl.submitAdjust")}
                    </Button>
                    <Button
                      onClick={() => setAdjusting(false)}
                      size="sm"
                      tabIndex={adjusting ? undefined : -1}
                      type="button"
                      variant="ghost"
                    >
                      {t("agentControl.cancelAdjust")}
                    </Button>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
          </Form>
        </form>
      </GridDisclosure>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            className="border-foreground bg-foreground text-background hover:bg-foreground/90"
            disabled={pending}
            onClick={() => commitDecision("approved")}
            size="xs"
            type="button"
            variant="default"
          >
            <span>{t("agentControl.approveAction")}</span>
            <Kbd>⌘⏎</Kbd>
          </Button>
          <Button
            disabled={pending}
            onClick={() => setAdjusting((prev) => !prev)}
            size="xs"
            type="button"
            variant="outline"
          >
            <span>{t("agentControl.adjustAction")}</span>
          </Button>
        </div>

        <Button
          disabled={pending}
          onClick={() => commitDecision("denied")}
          size="xs"
          type="button"
          variant="ghost"
        >
          <span>{t("agentControl.denyAction")}</span>
          <Kbd>Esc</Kbd>
        </Button>
      </div>
    </div>
  );
}
