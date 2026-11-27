"use client";

import type { AuditLogId, AuditLogRecord } from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import { LockIcon, RotateCcwIcon } from "lucide-react";
import type * as React from "react";
import { cn } from "../lib/utils.ts";
import { Button } from "../primitives/button.tsx";

export type AgentLedgerCascadeStatus = "target" | "downstream_review" | "none";

export type IrreversibleReasonI18nKey =
  | "settings.ledgerReasonInitialCreation"
  | "settings.ledgerReasonMetadataOnly"
  | "settings.ledgerReasonMissingSnapshot"
  | "settings.ledgerReasonMovedToTrash"
  | "settings.ledgerReasonRestoredFromTrash"
  | "settings.ledgerReasonHardDeleted"
  | "settings.ledgerReasonExportedExternal"
  | "settings.ledgerReasonThreadMeta"
  | "settings.ledgerReasonApprovalDispatched"
  | "settings.ledgerReasonSteeringQueued"
  | "settings.ledgerReasonAccessDenied"
  | "settings.ledgerReasonToolFailed";

const IRREVERSIBLE_REASON_KEY_MAP: Readonly<Record<string, IrreversibleReasonI18nKey>> = {
  "initial document creation has no prior revision": "settings.ledgerReasonInitialCreation",
  "metadata update did not create a content revision": "settings.ledgerReasonMetadataOnly",
  "missing before/after revision snapshot": "settings.ledgerReasonMissingSnapshot",
  "missing outline before/after revision snapshot": "settings.ledgerReasonMissingSnapshot",
  "document moved to trash (use restore endpoint)": "settings.ledgerReasonMovedToTrash",
  "document restored from trash": "settings.ledgerReasonRestoredFromTrash",
  "permanent hard deletion cannot be undone": "settings.ledgerReasonHardDeleted",
  "exported markdown artifacts leave server control": "settings.ledgerReasonExportedExternal",
  "exported zip archive leaves server control": "settings.ledgerReasonExportedExternal",
  "thread binding metadata update": "settings.ledgerReasonThreadMeta",
  "approval decision dispatched to agent binding": "settings.ledgerReasonApprovalDispatched",
  "steering note queued for external thread": "settings.ledgerReasonSteeringQueued",
  "access denied": "settings.ledgerReasonAccessDenied",
  "tool invocation failed": "settings.ledgerReasonToolFailed",
};

/**
 * Maps known backend English irreversible-reason literals to localized `@inkade/i18n` keys.
 */
export function resolveIrreversibleReasonKey(
  reason: string | null | undefined,
): IrreversibleReasonI18nKey | null {
  if (!reason) return null;
  return IRREVERSIBLE_REASON_KEY_MAP[reason.trim().toLowerCase()] ?? null;
}

export interface AgentLedgerRowProps {
  readonly entry: AuditLogRecord;
  readonly cascadeStatus?: AgentLedgerCascadeStatus | undefined;
  readonly documentLabel?: string | undefined;
  readonly onHoverRollback?: ((auditLogId: AuditLogId | null) => void) | undefined;
  readonly onRollback?: ((entry: AuditLogRecord) => void) | undefined;
  readonly rollingBack?: boolean | undefined;
  readonly className?: string | undefined;
}

/**
 * Formats an audit log timestamp into a fixed tabular timestamp string.
 */
export function formatLedgerTimestamp(iso: string): string {
  if (!iso) return "—";
  if (iso.length >= 16 && iso.includes("T")) {
    return iso.slice(0, 16).replace("T", " ");
  }
  return iso;
}

/**
 * Neutral hairline audit ledger row displaying actor, action, compact monospace diff preview,
 * irreversible status or hover-cascading revision restore trigger.
 */
export function AgentLedgerRow({
  entry,
  cascadeStatus = "none",
  documentLabel,
  onHoverRollback,
  onRollback,
  rollingBack = false,
  className,
}: AgentLedgerRowProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const canRollback = Boolean(entry.reversible && entry.beforeRevisionId);

  const actorLabel =
    entry.tokenName ??
    (entry.principalKind === "user"
      ? t("settings.ledgerPrincipalUser")
      : entry.transport.toUpperCase());

  const contextLabel = documentLabel ?? entry.summary ?? entry.resource;
  const restoreLabel = rollingBack
    ? t("settings.ledgerRestoring")
    : entry.beforeRevisionId
      ? t("settings.ledgerRestoreToRev", { rev: entry.beforeRevisionId.slice(0, 8) })
      : t("settings.ledgerRestoreAction");

  const reasonKey = resolveIrreversibleReasonKey(entry.irreversibleReason);
  const irreversibleLabel = reasonKey
    ? t(reasonKey)
    : entry.irreversibleReason ??
      (entry.decision === "denied"
        ? t("settings.decisionDenied")
        : t("settings.ledgerIrreversibleFallback"));

  const hasDiffPreview = Boolean(
    entry.diffPreview && (entry.diffPreview.oldSnippet || entry.diffPreview.newSnippet),
  );

  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 border-b border-border px-3.5 py-2.5 transition-colors duration-[var(--duration-quick)] ease-[var(--ease-smooth-out)] last:border-b-0",
        cascadeStatus === "target" && "bg-muted/55",
        cascadeStatus === "downstream_review" &&
          "bg-amber-500/[0.06] dark:bg-amber-400/[0.08]",
        cascadeStatus === "none" && "bg-card hover:bg-muted/30",
        className,
      )}
      data-audit-id={entry.id}
      data-cascade-status={cascadeStatus}
      data-reversible={canRollback ? "true" : "false"}
      data-slot="agent-ledger-row"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <span
            aria-hidden="true"
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              cascadeStatus === "downstream_review"
                ? "bg-amber-500"
                : canRollback
                  ? "bg-emerald-500"
                  : entry.decision === "denied"
                    ? "bg-destructive"
                    : "bg-muted-foreground/50",
            )}
          />
          <span className="inline-flex shrink-0 items-center rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[11px] font-medium text-foreground">
            {actorLabel}
          </span>
          <code className="shrink-0 font-mono text-[11px] text-muted-foreground">{entry.action}</code>
          <span className="min-w-0 max-w-60 truncate text-xs font-medium text-foreground">
            {contextLabel}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-2.5">
          {cascadeStatus === "downstream_review" && !hasDiffPreview ? (
            <span
              className="inline-flex shrink-0 items-center rounded border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 text-[10.5px] font-medium text-amber-700 dark:text-amber-300"
              data-slot="agent-ledger-cascade-badge"
            >
              {t("settings.ledgerCascadeBadge")}
            </span>
          ) : null}

          <span className="font-mono text-[10.5px] text-muted-foreground tabular-nums">
            {formatLedgerTimestamp(entry.createdAt)}
          </span>

          {canRollback ? (
            <Button
              className={cn(cascadeStatus === "target" && "border-foreground/50")}
              data-slot="agent-ledger-rollback"
              disabled={rollingBack}
              loading={rollingBack}
              onBlur={() => onHoverRollback?.(null)}
              onClick={() => onRollback?.(entry)}
              onFocus={() => onHoverRollback?.(entry.id)}
              onMouseEnter={() => onHoverRollback?.(entry.id)}
              onMouseLeave={() => onHoverRollback?.(null)}
              size="xs"
              variant="outline"
            >
              <RotateCcwIcon className="size-3" />
              <span>{restoreLabel}</span>
            </Button>
          ) : (
            <span
              className="inline-flex h-6 items-center gap-1 rounded-md border border-dashed border-border bg-muted/40 px-2 text-[11px] text-muted-foreground"
              data-slot="agent-ledger-irreversible"
              title={irreversibleLabel}
            >
              <LockIcon className="size-3 shrink-0" />
              <span className="max-w-56 truncate">{irreversibleLabel}</span>
            </span>
          )}
        </div>
      </div>

      {hasDiffPreview ? (
        <div className="flex min-h-6 items-center justify-between gap-2 pl-3.5 text-[11px]">
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            {entry.diffPreview?.oldSnippet ? (
              <code className="max-w-48 truncate rounded bg-destructive/10 px-1.5 py-0.5 font-mono text-[10.5px] text-rose-700 line-through dark:text-rose-300">
                {entry.diffPreview.oldSnippet}
              </code>
            ) : null}
            {entry.diffPreview?.oldSnippet && entry.diffPreview?.newSnippet ? (
              <span aria-hidden="true" className="shrink-0 text-muted-foreground">
                →
              </span>
            ) : null}
            {entry.diffPreview?.newSnippet ? (
              <code className="max-w-48 truncate rounded bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10.5px] text-emerald-700 dark:text-emerald-300">
                {entry.diffPreview.newSnippet}
              </code>
            ) : null}
          </div>

          {cascadeStatus === "downstream_review" ? (
            <span className="inline-flex shrink-0 items-center gap-1.5">
              <span
                className="inline-flex items-center rounded border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 text-[10.5px] font-medium text-amber-700 dark:text-amber-300"
                data-slot="agent-ledger-cascade-badge"
              >
                {t("settings.ledgerCascadeBadge")}
              </span>
              <span className="hidden text-[11px] text-muted-foreground xl:inline">
                {t("settings.ledgerCascadeHint")}
              </span>
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
