import { cn, Skeleton } from "@inkade/ui";
import type React from "react";

export type SettingsSkeletonVariant =
  | "account"
  | "space"
  | "template"
  | "token"
  | "rule"
  | "share";

export interface SettingsGroupSkeletonProps {
  readonly variant: SettingsSkeletonVariant;
  readonly rows?: number | undefined;
  readonly showGroupHeader?: boolean | undefined;
}

const ROW_WIDTHS = ["w-36", "w-44", "w-32", "w-40"] as const;

/**
 * Mirrors SettingsGroup + SettingRow geometry (rounded-lg card, divide-y borders, px-4 py-3.5 sm:px-5).
 */
export function SettingsGroupSkeleton({
  variant,
  rows = 3,
  showGroupHeader = false,
}: SettingsGroupSkeletonProps): React.ReactElement {
  const rowCount = Array.from({ length: rows }, (_, i) => i);

  return (
    <section aria-busy="true" className="flex flex-col gap-2.5" data-slot="settings-group-skeleton">
      {showGroupHeader && (
        <div className="space-y-1 px-0.5">
          <Skeleton className="h-3.5 w-24" />
        </div>
      )}
      <div className="divide-y divide-border rounded-lg border border-border bg-card">
        {rowCount.map((idx) => {
          const primaryWidth = ROW_WIDTHS[idx % ROW_WIDTHS.length] ?? "w-36";
          return (
            <div
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-5"
              key={idx}
            >
              {variant === "space" ? (
                <>
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <Skeleton className="size-8 shrink-0 rounded-md" />
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                      <Skeleton className={cn("h-4", primaryWidth)} />
                      <Skeleton className="h-3.5 w-16" />
                      <Skeleton className="h-5 w-14 rounded-full" />
                    </div>
                  </div>
                  <Skeleton className="h-7 w-14 shrink-0 rounded-md" />
                </>
              ) : variant === "template" ? (
                <>
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex items-center gap-2">
                      <Skeleton className="size-4 shrink-0 rounded-sm" />
                      <Skeleton className={cn("h-4", primaryWidth)} />
                      <Skeleton className="h-5 w-14 rounded-full" />
                    </div>
                    <Skeleton className="h-3 w-3/5" />
                    <Skeleton className="h-8 w-4/5 rounded-lg" />
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Skeleton className="h-7 w-16 rounded-md" />
                  </div>
                </>
              ) : variant === "token" ? (
                <>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Skeleton className="size-3.5 shrink-0 rounded-sm" />
                      <Skeleton className={cn("h-4", primaryWidth)} />
                      <Skeleton className="h-5 w-20 rounded-full" />
                      <Skeleton className="h-5 w-16 rounded-full" />
                      <Skeleton className="h-5 w-24 rounded-full" />
                    </div>
                    <Skeleton className="h-3 w-48" />
                  </div>
                  <Skeleton className="h-7 w-16 shrink-0 rounded-md" />
                </>
              ) : variant === "rule" ? (
                <>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Skeleton className="h-5 w-16 rounded-full" />
                      <Skeleton className={cn("h-4", primaryWidth)} />
                      <Skeleton className="h-5 w-18 rounded-full" />
                    </div>
                    <div className="flex items-center gap-2">
                      <Skeleton className="h-4 w-20 rounded-full" />
                      <Skeleton className="h-4 w-16 rounded-full" />
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Skeleton className="h-7 w-14 rounded-md" />
                    <Skeleton className="size-7 rounded-md" />
                  </div>
                </>
              ) : variant === "share" ? (
                <>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Skeleton className="size-3.5 shrink-0 rounded-sm" />
                      <Skeleton className={cn("h-4", primaryWidth)} />
                      <Skeleton className="h-5 w-14 rounded-full" />
                    </div>
                    <Skeleton className="h-3 w-44" />
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Skeleton className="size-7 rounded-md" />
                    <Skeleton className="h-7 w-14 rounded-md" />
                  </div>
                </>
              ) : (
                <>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <Skeleton className={cn("h-4", primaryWidth)} />
                    <Skeleton className="h-3 w-52" />
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Skeleton className="h-5 w-20 rounded-full" />
                    <Skeleton className="h-5 w-16 rounded-full" />
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export interface SettingsTableSkeletonProps {
  readonly columns?: number | undefined;
  readonly rows?: number | undefined;
}

/**
 * Mirrors Settings table cards (Attachments / Audit table view).
 */
export function SettingsTableSkeleton({
  columns = 5,
  rows = 4,
}: SettingsTableSkeletonProps): React.ReactElement {
  const colIndices = Array.from({ length: columns }, (_, i) => i);
  const rowIndices = Array.from({ length: rows }, (_, i) => i);

  return (
    <div
      aria-busy="true"
      className="overflow-hidden rounded-xl border border-border bg-card"
      data-slot="settings-table-skeleton"
    >
      <div className="flex items-center gap-4 border-b border-border/70 bg-muted/25 px-4 py-2.5">
        {colIndices.map((c) => (
          <Skeleton className={cn("h-3.5", c === 0 ? "w-28" : "w-16 flex-1 max-w-24")} key={c} />
        ))}
      </div>
      <div className="divide-y divide-border/70">
        {rowIndices.map((r) => (
          <div className="flex items-center gap-4 px-4 py-3" key={r}>
            {colIndices.map((c) => (
              <Skeleton
                className={cn(
                  c === 0 ? "h-4 w-36" : c === columns - 1 ? "ml-auto h-3.5 w-20" : "h-4 w-16 flex-1 max-w-24",
                )}
                key={c}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export interface SettingsTimelineSkeletonProps {
  readonly rows?: number | undefined;
}

/**
 * Mirrors AuditLogsSettings AgentLedgerRow timeline list.
 */
export function SettingsTimelineSkeleton({
  rows = 4,
}: SettingsTimelineSkeletonProps): React.ReactElement {
  const rowIndices = Array.from({ length: rows }, (_, i) => i);

  return (
    <div
      aria-busy="true"
      className="divide-y divide-border/70 overflow-hidden rounded-xl border border-border bg-card"
      data-slot="settings-timeline-skeleton"
    >
      {rowIndices.map((r) => (
        <div className="flex flex-col gap-2 px-4 py-3.5 sm:px-5" key={r}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Skeleton className="size-2 shrink-0 rounded-full" />
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-5 w-14 rounded-full" />
              <Skeleton className="h-4 w-32" />
            </div>
            <Skeleton className="h-3.5 w-28 shrink-0" />
          </div>
          <Skeleton className="h-3.5 w-3/4" />
        </div>
      ))}
    </div>
  );
}
