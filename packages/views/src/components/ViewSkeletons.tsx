import { cn, Skeleton } from "@inkade/ui";
import type React from "react";

const OUTLINE_ROW_LAYOUT = [
  { depth: 0, width: "w-3/4", hasChip: false },
  { depth: 1, width: "w-3/5", hasChip: true },
  { depth: 1, width: "w-4/5", hasChip: false },
  { depth: 0, width: "w-2/3", hasChip: false },
  { depth: 1, width: "w-1/2", hasChip: false },
  { depth: 2, width: "w-2/5", hasChip: true },
  { depth: 0, width: "w-5/6", hasChip: false },
  { depth: 1, width: "w-7/12", hasChip: false },
] as const;

const GRID_CARD_WIDTHS = [
  { title: "w-3/4", line1: "w-full", line2: "w-4/5", space: "w-20", badge: "w-14" },
  { title: "w-2/3", line1: "w-11/12", line2: "w-3/4", space: "w-24", badge: "w-12" },
  { title: "w-4/5", line1: "w-full", line2: "w-5/6", space: "w-18", badge: "w-16" },
  { title: "w-3/5", line1: "w-10/12", line2: "w-2/3", space: "w-20", badge: "w-14" },
  { title: "w-5/6", line1: "w-full", line2: "w-3/5", space: "w-24", badge: "w-12" },
  { title: "w-7/12", line1: "w-11/12", line2: "w-4/5", space: "w-16", badge: "w-14" },
] as const;

const LIST_ROW_WIDTHS = [
  { title: "w-3/4", excerpt: "w-11/12", space: "w-20" },
  { title: "w-3/5", excerpt: "w-4/5", space: "w-24" },
  { title: "w-4/5", excerpt: "w-10/12", space: "w-16" },
  { title: "w-2/3", excerpt: "w-5/6", space: "w-20" },
  { title: "w-5/6", excerpt: "w-3/4", space: "w-18" },
  { title: "w-1/2", excerpt: "w-11/12", space: "w-22" },
] as const;

const TABLE_ROW_WIDTHS = [
  { title: "w-48", space: "w-20" },
  { title: "w-40", space: "w-24" },
  { title: "w-56", space: "w-16" },
  { title: "w-36", space: "w-20" },
  { title: "w-44", space: "w-22" },
  { title: "w-52", space: "w-18" },
] as const;

export interface DocumentDetailSkeletonProps {
  readonly isSplitOpen?: boolean | undefined;
  readonly compact?: boolean | undefined;
}

/**
 * Pixel-aligned loading placeholder for DocumentDetailView (primary and split panes).
 */
export function DocumentDetailSkeleton({
  isSplitOpen = false,
  compact = false,
}: DocumentDetailSkeletonProps): React.ReactElement {
  if (compact) {
    return (
      <div
        aria-busy="true"
        className="flex flex-col gap-3.5"
        data-slot="document-detail-skeleton"
      >
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-5 w-20 rounded-md" />
          <Skeleton className="h-5 w-14 rounded-full" />
          <Skeleton className="h-3.5 w-24" />
        </div>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-3/4 rounded-md" />
          <div className="flex items-center gap-1.5">
            <Skeleton className="h-5 w-14 rounded-full" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
        </div>
        <div className="flex flex-col gap-2.5 pt-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-4/5" />
        </div>
        <div className="mt-1 flex flex-col gap-2 rounded-xl border border-border/70 bg-card/60 p-3.5">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-5/6" />
        </div>
      </div>
    );
  }

  return (
    <div
      aria-busy="true"
      className="flex h-full min-h-0 w-full overflow-hidden"
      data-slot="document-detail-skeleton"
    >
      <div className="min-w-0 flex-1 overflow-hidden">
        <div
          className={cn(
            "mx-auto flex w-full flex-col gap-4 px-4 py-5 lg:px-8",
            isSplitOpen ? "max-w-4xl" : "max-w-6xl",
          )}
        >
          {/* 2-Row Header Mirror */}
          <div className="flex flex-col gap-2 pb-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Skeleton className="h-5 w-24 rounded-md" />
                <Skeleton className="h-5 w-14 rounded-full" />
                <Skeleton className="hidden h-3.5 w-32 sm:block" />
              </div>
              <div className="flex items-center gap-1.5">
                <Skeleton className="h-6 w-7 rounded-md" />
                <Skeleton className="h-6 w-20 rounded-md" />
                <Skeleton className="hidden h-6 w-20 rounded-md sm:block" />
                <Skeleton className="size-6 rounded-md" />
              </div>
            </div>

            <div className="flex flex-col gap-2 pt-1">
              <Skeleton className="h-9 w-2/5 max-w-md min-w-52 rounded-md" />
              <div className="flex flex-wrap items-center gap-1.5">
                <Skeleton className="h-5 w-14 rounded-full" />
                <Skeleton className="h-5 w-20 rounded-full" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
            </div>
          </div>

          {/* Main Prose Body + Right Outline Tick Scrubber Mirror */}
          <div className="relative flex items-start gap-4 pt-2">
            <div className="min-w-0 flex-1">
              <div className="flex max-w-[72ch] flex-col gap-3.5">
                <div className="flex flex-col gap-2.5">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-11/12" />
                  <Skeleton className="h-4 w-4/6" />
                </div>

                <div className="mt-2 flex flex-col gap-2">
                  <Skeleton className="h-6 w-48 rounded-md" />
                  <div className="h-px w-full bg-border/60" />
                </div>

                <div className="flex flex-col gap-2.5">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-10/12" />
                  <Skeleton className="h-4 w-3/5" />
                </div>

                <div className="mt-1 flex flex-col gap-2 rounded-xl border border-border/70 bg-card/60 p-4">
                  <div className="flex items-center gap-2">
                    <Skeleton className="size-4 rounded-sm" />
                    <Skeleton className="h-4 w-36" />
                  </div>
                  <Skeleton className="h-3.5 w-full" />
                  <Skeleton className="h-3.5 w-4/5" />
                </div>

                <div className="mt-1 flex flex-col gap-2.5">
                  <Skeleton className="h-4 w-5/6" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
              </div>
            </div>

            <div
              aria-hidden="true"
              className={cn(
                "hidden shrink-0 flex-col items-end gap-2 px-1.5 py-2",
                isSplitOpen ? "2xl:flex" : "xl:flex",
              )}
            >
              <Skeleton className="h-[2px] w-5 rounded-full" />
              <Skeleton className="h-[2px] w-3.5 rounded-full" />
              <Skeleton className="h-[2px] w-2 rounded-full" />
              <Skeleton className="h-[2px] w-3.5 rounded-full" />
              <Skeleton className="h-[2px] w-2 rounded-full" />
            </div>
          </div>

          {/* Status Bar Mirror */}
          <div className="mt-6 flex items-center justify-between gap-3 border-t border-border/50 pt-3">
            <Skeleton className="h-3 w-44" />
            <Skeleton className="h-4 w-9 rounded-md" />
          </div>
        </div>
      </div>
    </div>
  );
}

export interface OutlineTreeSkeletonProps {
  readonly rows?: number | undefined;
  readonly showToolbar?: boolean | undefined;
  readonly compact?: boolean | undefined;
}

/**
 * Indented bullet-tree loading placeholder aligned to ProseMirrorOutlineEditor.
 */
export function OutlineTreeSkeleton({
  rows = 6,
  showToolbar = false,
  compact = false,
}: OutlineTreeSkeletonProps): React.ReactElement {
  const items = OUTLINE_ROW_LAYOUT.slice(0, rows);

  return (
    <div aria-busy="true" className="flex flex-col" data-slot="outline-tree-skeleton">
      {showToolbar && (
        <div className="mb-3 flex items-center justify-between gap-2 border-b border-border/60 pb-2">
          <Skeleton className="h-5 w-32 rounded-md" />
          <div className="flex items-center gap-1">
            <Skeleton className="size-6 rounded-md" />
            <Skeleton className="size-6 rounded-md" />
            <Skeleton className="h-6 w-16 rounded-md" />
          </div>
        </div>
      )}

      <div className={cn("flex flex-col", compact ? "gap-2" : "gap-2.5")}>
        {items.map((row, idx) => (
          <div
            className="flex items-center gap-2.5 py-0.5"
            key={idx}
            style={{ paddingLeft: `${row.depth * 22}px` }}
          >
            <Skeleton className="size-1.5 shrink-0 rounded-full" />
            <Skeleton className={cn(compact ? "h-3.5" : "h-4", row.width)} />
            {row.hasChip && <Skeleton className="h-4 w-14 shrink-0 rounded-full" />}
          </div>
        ))}
      </div>
    </div>
  );
}

export interface TrackChangesSkeletonProps {
  readonly compact?: boolean | undefined;
}

/**
 * Bordered diff-viewer skeleton matching InlineTrackChangesViewer header and hunk geometry.
 */
export function TrackChangesSkeleton({
  compact = false,
}: TrackChangesSkeletonProps): React.ReactElement {
  return (
    <div
      aria-busy="true"
      className="overflow-hidden rounded-xl border border-border bg-card"
      data-slot="track-changes-skeleton"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Skeleton className="h-5 w-14 rounded-full" />
          <Skeleton className="h-3 w-3 rounded-full" />
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
        <div className="flex items-center gap-1.5">
          <Skeleton className="h-6 w-16 rounded-md" />
          <Skeleton className="h-6 w-20 rounded-md" />
        </div>
      </div>

      <div className={cn("flex flex-col gap-3", compact ? "p-3" : "p-4")}>
        <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
          <Skeleton className="size-2 shrink-0 rounded-full" />
          <Skeleton className="h-3.5 w-2/3" />
        </div>

        <div className="flex flex-col gap-2">
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-11/12" />
        </div>

        <div className="flex flex-col gap-2 rounded-lg border border-border/70 bg-muted/20 p-3">
          <Skeleton className="h-3.5 w-4/5" />
          <Skeleton className="h-3.5 w-3/5" />
        </div>
      </div>
    </div>
  );
}

export interface LibraryGridSkeletonProps {
  readonly compact?: boolean | undefined;
  readonly count?: number | undefined;
}

/**
 * Card-wall skeleton matching DocumentListView grid card chrome, tags, and footer separator.
 */
export function LibraryGridSkeleton({
  compact = false,
  count = 6,
}: LibraryGridSkeletonProps): React.ReactElement {
  const items = GRID_CARD_WIDTHS.slice(0, count);

  return (
    <div
      aria-busy="true"
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
      data-slot="library-grid-skeleton"
    >
      {items.map((item, idx) => (
        <div
          className={cn(
            "flex flex-col justify-between rounded-xl border border-border bg-card",
            compact ? "gap-2 p-3" : "gap-3 p-4",
          )}
          key={idx}
        >
          <div className="flex flex-col gap-2">
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <Skeleton className="size-4 shrink-0 rounded-sm" />
                <Skeleton className={cn("h-4.5", item.title)} />
              </div>
              <Skeleton className="size-3.5 shrink-0 rounded-sm" />
            </div>
            <div className="flex flex-col gap-1.5 pt-0.5">
              <Skeleton className={cn("h-3", item.line1)} />
              <Skeleton className={cn("h-3", item.line2)} />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-1.5">
              <Skeleton className={cn("h-5 rounded-full", item.space)} />
              <Skeleton className={cn("h-5 rounded-full", item.badge)} />
            </div>
            <div
              className={cn(
                "flex items-center justify-between gap-2 border-t border-border/60",
                compact ? "pt-2.5" : "pt-3",
              )}
            >
              <div className="flex items-center gap-1.5">
                <Skeleton className="h-4 w-12 rounded-full" />
                <Skeleton className="h-4 w-14 rounded-full" />
              </div>
              <Skeleton className="h-3 w-12" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export interface LibraryTableSkeletonProps {
  readonly compact?: boolean | undefined;
  readonly rows?: number | undefined;
}

/**
 * Property-table skeleton matching DocumentListView `<Table variant="card">` geometry.
 */
export function LibraryTableSkeleton({
  compact = false,
  rows = 6,
}: LibraryTableSkeletonProps): React.ReactElement {
  const items = TABLE_ROW_WIDTHS.slice(0, rows);

  return (
    <div
      aria-busy="true"
      className="overflow-hidden rounded-xl border border-border bg-card"
      data-slot="library-table-skeleton"
    >
      <div className="flex items-center gap-4 border-b border-border/70 bg-muted/25 px-3.5 py-2.5">
        <Skeleton className="size-4 shrink-0 rounded-sm" />
        <Skeleton className="h-3.5 w-24" />
        <Skeleton className="hidden h-3.5 w-14 sm:block" />
        <Skeleton className="hidden h-3.5 w-20 md:block" />
        <Skeleton className="hidden h-3.5 w-20 lg:block" />
        <Skeleton className="ml-auto h-3.5 w-16" />
      </div>

      <div className="divide-y divide-border/60">
        {items.map((item, idx) => (
          <div
            className={cn("flex items-center gap-4 px-3.5", compact ? "py-2" : "py-3")}
            key={idx}
          >
            <Skeleton className="size-4 shrink-0 rounded-sm" />
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <Skeleton className="size-3.5 shrink-0 rounded-sm" />
              <Skeleton className={cn("h-4 max-w-full", item.title)} />
            </div>
            <Skeleton className="hidden h-5 w-14 shrink-0 rounded-full sm:block" />
            <Skeleton className={cn("hidden h-5 shrink-0 rounded-md md:block", item.space)} />
            <Skeleton className="hidden h-4 w-16 shrink-0 rounded-full lg:block" />
            <Skeleton className="ml-auto h-3.5 w-14 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}

export interface LibraryListSkeletonProps {
  readonly compact?: boolean | undefined;
  readonly rows?: number | undefined;
}

/**
 * Slim split-list row skeleton matching DocumentListView list pane density.
 */
export function LibraryListSkeleton({
  compact = false,
  rows = 6,
}: LibraryListSkeletonProps): React.ReactElement {
  const items = LIST_ROW_WIDTHS.slice(0, rows);

  return (
    <div
      aria-busy="true"
      className="flex flex-col gap-1.5 p-2"
      data-slot="library-list-skeleton"
    >
      {items.map((item, idx) => (
        <div
          className={cn(
            "flex flex-col rounded-lg border border-border/45 bg-card/50 px-3",
            compact ? "gap-1 py-1.5" : "gap-1.5 py-2.5",
          )}
          key={idx}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              <Skeleton className="size-3.5 shrink-0 rounded-sm" />
              <Skeleton className={cn("h-4", item.title)} />
            </div>
            <Skeleton className="size-3 shrink-0 rounded-sm" />
          </div>
          <Skeleton className={cn("h-3", item.excerpt)} />
          <div className="mt-0.5 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <Skeleton className={cn("h-4.5 rounded-full", item.space)} />
              <Skeleton className="h-4 w-12 rounded-full" />
            </div>
            <Skeleton className="h-3 w-12 shrink-0" />
          </div>
        </div>
      ))}
    </div>
  );
}
