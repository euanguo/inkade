import type { DocumentKind, LibraryViewMode, SavedView, SortDirection } from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import {
  Badge,
  Button,
  Checkbox,
  cn,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Popover,
  PopoverPopup,
  PopoverTrigger,
  SegmentedControl,
  SegmentedControlItem,
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
  TagPill,
} from "@inkade/ui";
import {
  ArrowDownIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  BookmarkIcon,
  FilePlus2Icon,
  KanbanSquareIcon,
  LayoutGridIcon,
  LibraryIcon,
  ListIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  TableIcon,
} from "lucide-react";
import type React from "react";
import type { DocumentSortField } from "../../lib/typed-properties.ts";
import { ADE_STATUS_BADGE_VARIANT, type AdeSummary, type LibraryDisplayOptions } from "./types.ts";

export function SortColumnHeader({
  label,
  field,
  activeField,
  direction,
  onToggle,
}: {
  readonly label: string;
  readonly field: DocumentSortField;
  readonly activeField: DocumentSortField;
  readonly direction: SortDirection;
  readonly onToggle: (field: DocumentSortField) => void;
}): React.ReactElement {
  const isActive = activeField === field;
  return (
    <button
      className={cn(
        "inline-flex cursor-pointer items-center gap-1 font-medium transition-colors hover:text-foreground",
        isActive ? "text-foreground" : "text-muted-foreground",
      )}
      onClick={() => onToggle(field)}
      type="button"
    >
      <span>{label}</span>
      {isActive ? (
        direction === "asc" ? (
          <ArrowUpIcon className="size-3" />
        ) : (
          <ArrowDownIcon className="size-3" />
        )
      ) : (
        <ArrowUpDownIcon className="size-3 opacity-45" />
      )}
    </button>
  );
}

export function DocAdeBadge({
  summary,
}: {
  readonly summary: AdeSummary | null;
}): React.ReactElement | null {
  const { t } = useInkadeTranslation();
  if (!summary) return null;
  return (
    <Badge size="sm" variant={ADE_STATUS_BADGE_VARIANT[summary.primaryStatus]}>
      <SparklesIcon className="size-3" />
      <span>
        {summary.waitingCount > 0
          ? t("library.adeWaitingCount", { count: summary.waitingCount })
          : t("library.adeCount", { count: summary.total })}
      </span>
    </Badge>
  );
}

export function LibraryViewSwitcher({
  viewMode,
  compact = false,
  onViewModeChange,
}: {
  readonly viewMode: LibraryViewMode;
  readonly compact?: boolean | undefined;
  readonly onViewModeChange: (next: LibraryViewMode) => void;
}): React.ReactElement {
  const { t } = useInkadeTranslation();
  return (
    <SegmentedControl aria-label={t("library.viewModeLabel")} size="sm">
      <SegmentedControlItem
        aria-label={t("library.viewList")}
        data-pressed={viewMode === "list" ? "" : undefined}
        onClick={() => onViewModeChange("list")}
        title={t("library.viewList")}
      >
        <ListIcon className="size-3.5" />
        {!compact && <span>{t("library.viewList")}</span>}
      </SegmentedControlItem>
      <SegmentedControlItem
        aria-label={t("library.viewGrid")}
        data-pressed={viewMode === "grid" ? "" : undefined}
        onClick={() => onViewModeChange("grid")}
        title={t("library.viewGrid")}
      >
        <LayoutGridIcon className="size-3.5" />
        {!compact && <span>{t("library.viewGrid")}</span>}
      </SegmentedControlItem>
      <SegmentedControlItem
        aria-label={t("library.viewTable")}
        data-pressed={viewMode === "table" ? "" : undefined}
        onClick={() => onViewModeChange("table")}
        title={t("library.viewTable")}
      >
        <TableIcon className="size-3.5" />
        {!compact && <span>{t("library.viewTable")}</span>}
      </SegmentedControlItem>
      <SegmentedControlItem
        aria-label={t("library.viewBoard")}
        data-pressed={viewMode === "board" ? "" : undefined}
        onClick={() => onViewModeChange("board")}
        title={t("library.viewBoard")}
      >
        <KanbanSquareIcon className="size-3.5" />
        {!compact && <span>{t("library.viewBoard")}</span>}
      </SegmentedControlItem>
    </SegmentedControl>
  );
}

export function LibraryDisplayOptionsMenu({
  open,
  onOpenChange,
  displayOptions,
  canvasWidth,
  compact = false,
  onUpdateDisplayOptions,
  onUpdateCanvasWidth,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly displayOptions: LibraryDisplayOptions;
  readonly canvasWidth: "fluid" | "centered";
  readonly compact?: boolean | undefined;
  readonly onUpdateDisplayOptions: (patch: Partial<LibraryDisplayOptions>) => void;
  readonly onUpdateCanvasWidth: (next: "fluid" | "centered") => void;
}): React.ReactElement {
  const { t } = useInkadeTranslation();
  return (
    <Popover onOpenChange={onOpenChange} open={open}>
      <PopoverTrigger
        render={
          <Button
            aria-label={t("library.displayOptionsAria")}
            size={compact ? "icon-xs" : "xs"}
            title={t("library.displayOptionsAria")}
            variant="outline"
          />
        }
      >
        <SlidersHorizontalIcon className="size-3.5" />
        {!compact && <span>{t("library.displayOptions")}</span>}
      </PopoverTrigger>
      <PopoverPopup align="end" className="w-60" viewportClassName="p-3">
        <div className="flex flex-col gap-2.5">
          <p className="text-xs font-semibold text-foreground">{t("library.displayOptions")}</p>
          <div className="flex flex-col gap-2">
            {(
              [
                ["showExcerpt", t("library.showExcerpt")],
                ["showTags", t("library.showTags")],
                ["showAdeBadge", t("library.showAdeBadge")],
                ["showProperties", t("library.showProperties")],
                ["showEmptyDailies", t("library.showEmptyDailies")],
              ] as const
            ).map(([key, label]) => (
              <label
                className="flex cursor-pointer items-center justify-between gap-2 text-xs text-foreground"
                key={key}
              >
                <span>{label}</span>
                <Checkbox
                  checked={displayOptions[key]}
                  onCheckedChange={(checked) => onUpdateDisplayOptions({ [key]: Boolean(checked) })}
                />
              </label>
            ))}
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-2.5">
            <span className="text-xs text-muted-foreground">{t("library.density")}</span>
            <SegmentedControl size="sm">
              <SegmentedControlItem
                data-pressed={displayOptions.density === "compact" ? "" : undefined}
                onClick={() => onUpdateDisplayOptions({ density: "compact" })}
              >
                {t("library.densityCompact")}
              </SegmentedControlItem>
              <SegmentedControlItem
                data-pressed={displayOptions.density === "comfortable" ? "" : undefined}
                onClick={() => onUpdateDisplayOptions({ density: "comfortable" })}
              >
                {t("library.densityComfortable")}
              </SegmentedControlItem>
            </SegmentedControl>
          </div>
          <div className="hidden items-center justify-between gap-2 border-t border-border/60 pt-2.5 sm:flex">
            <span className="text-xs text-muted-foreground">{t("settings.workspaceWidthTitle")}</span>
            <SegmentedControl size="sm">
              <SegmentedControlItem
                data-pressed={canvasWidth === "fluid" ? "" : undefined}
                onClick={() => onUpdateCanvasWidth("fluid")}
              >
                {t("common.canvasWidthFluid")}
              </SegmentedControlItem>
              <SegmentedControlItem
                data-pressed={canvasWidth === "centered" ? "" : undefined}
                onClick={() => onUpdateCanvasWidth("centered")}
              >
                {t("common.canvasWidthCentered")}
              </SegmentedControlItem>
            </SegmentedControl>
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
}

export function LibrarySortControls({
  sortBy,
  sortDir,
  compact = false,
  onSortByChange,
  onToggleSortDir,
}: {
  readonly sortBy: DocumentSortField;
  readonly sortDir: SortDirection;
  readonly compact?: boolean | undefined;
  readonly onSortByChange: (field: DocumentSortField) => void;
  readonly onToggleSortDir: () => void;
}): React.ReactElement {
  const { t } = useInkadeTranslation();
  const sortLabels: Readonly<Record<DocumentSortField, string>> = {
    updatedAt: t("library.sortUpdatedAt"),
    createdAt: t("library.sortCreatedAt"),
    title: t("library.sortTitle"),
    kind: t("library.sortKind"),
    space: t("library.sortSpace"),
  };

  return (
    <div className="flex items-center gap-1">
      <Select
        onValueChange={(value) => {
          if (value) onSortByChange(value);
        }}
        value={sortBy}
      >
        <SelectTrigger
          aria-label={t("library.sortLabel")}
          className={compact ? "min-w-24 text-xs" : "min-w-28 text-xs"}
          size="sm"
        >
          <SelectValue>{sortLabels[sortBy]}</SelectValue>
        </SelectTrigger>
        <SelectPopup>
          {(["updatedAt", "createdAt", "title", "kind", "space"] as const).map((field) => (
            <SelectItem key={field} value={field}>
              {sortLabels[field]}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
      <Button
        aria-label={t("library.sortDirectionAria")}
        onClick={onToggleSortDir}
        size="icon-sm"
        title={sortDir === "asc" ? t("library.sortDirAsc") : t("library.sortDirDesc")}
        variant="outline"
      >
        {sortDir === "asc" ? <ArrowUpIcon /> : <ArrowDownIcon />}
      </Button>
    </div>
  );
}

export function LibraryPaginationFooter({
  isPending,
  hasNextPage,
  isFetchingNextPage,
  totalLoaded,
  onLoadMore,
}: {
  readonly isPending: boolean;
  readonly hasNextPage: boolean;
  readonly isFetchingNextPage: boolean;
  readonly totalLoaded: number;
  readonly onLoadMore: () => void;
}): React.ReactElement | null {
  const { t } = useInkadeTranslation();
  if (isPending || (!hasNextPage && totalLoaded === 0)) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t px-2 pt-3 text-xs text-muted-foreground">
      <span className="tabular-nums">
        {hasNextPage
          ? t("library.loadedCounter", { loaded: totalLoaded })
          : t("library.allDocsLoaded", { count: totalLoaded })}
      </span>
      {hasNextPage && (
        <Button
          loading={isFetchingNextPage}
          onClick={onLoadMore}
          size="xs"
          variant="outline"
        >
          {isFetchingNextPage ? t("library.loadingMore") : t("library.loadMore")}
        </Button>
      )}
    </div>
  );
}

export function LibraryEmptyState({
  onCreateArticle,
}: {
  readonly onCreateArticle: () => void;
}): React.ReactElement {
  const { t } = useInkadeTranslation();
  return (
    <Empty className="py-12">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <LibraryIcon />
        </EmptyMedia>
        <EmptyTitle>{t("library.emptyTitle")}</EmptyTitle>
        <EmptyDescription>{t("library.emptyDesc")}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button
          className="active:scale-[0.985] transition-[transform,colors]"
          onClick={onCreateArticle}
          size="sm"
          variant="outline"
        >
          <FilePlus2Icon />
          {t("library.createArticle")}
        </Button>
      </EmptyContent>
    </Empty>
  );
}

export function LibraryEmptyDailiesToggle({
  show,
  showEmptyDailies,
  hiddenCount,
  onToggle,
}: {
  readonly show: boolean;
  readonly showEmptyDailies: boolean;
  readonly hiddenCount: number;
  readonly onToggle: () => void;
}): React.ReactElement | null {
  const { t } = useInkadeTranslation();
  if (!show) return null;
  return (
    <button
      className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-border/70 bg-muted/45 px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-foreground/25 hover:bg-muted hover:text-foreground"
      data-testid="library-toggle-empty-dailies"
      onClick={onToggle}
      type="button"
    >
      {showEmptyDailies ? (
        <span>{t("library.hideEmptyDailies")}</span>
      ) : (
        <>
          <span>{t("library.emptyDailiesHiddenCount", { count: hiddenCount })}</span>
          <span aria-hidden="true">·</span>
          <span className="text-foreground underline-offset-2 hover:underline">
            {t("library.revealEmptyDailies")}
          </span>
        </>
      )}
    </button>
  );
}

export function LibraryActiveFilterBadges({
  activeSavedView,
  pinnedOnly,
  unreadOnly,
  tagFilter,
  showEmptyDailiesPill,
  showEmptyDailies,
  hiddenEmptyDailyCount,
  omitEmptyDailies = false,
  onClearTag,
  onToggleEmptyDailies,
}: {
  readonly activeSavedView: SavedView | null;
  readonly pinnedOnly: boolean;
  readonly unreadOnly: boolean;
  readonly tagFilter: string | null;
  readonly showEmptyDailiesPill: boolean;
  readonly showEmptyDailies: boolean;
  readonly hiddenEmptyDailyCount: number;
  readonly omitEmptyDailies?: boolean | undefined;
  readonly onClearTag: () => void;
  readonly onToggleEmptyDailies: () => void;
}): React.ReactElement | null {
  const { t } = useInkadeTranslation();
  const includeEmptyPill = !omitEmptyDailies && showEmptyDailiesPill;
  if (!activeSavedView && !pinnedOnly && !unreadOnly && !tagFilter && !includeEmptyPill) {
    return null;
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {activeSavedView && (
        <Badge size="sm" variant="info">
          <BookmarkIcon className="size-3" />
          <span>{t("library.savedViewBadge", { name: activeSavedView.name })}</span>
        </Badge>
      )}
      {pinnedOnly && (
        <Badge size="sm" variant="secondary">
          {t("library.pinnedFilterBadge")}
        </Badge>
      )}
      {unreadOnly && (
        <Badge size="sm" variant="warning">
          {t("library.unreadFilterBadge")}
        </Badge>
      )}
      {tagFilter && (
        <TagPill active onClick={onClearTag} size="sm" tag={tagFilter} />
      )}
      <LibraryEmptyDailiesToggle
        hiddenCount={hiddenEmptyDailyCount}
        onToggle={onToggleEmptyDailies}
        show={includeEmptyPill}
        showEmptyDailies={showEmptyDailies}
      />
    </div>
  );
}

export type KindLabelsRecord = Readonly<Record<DocumentKind, string>>;
