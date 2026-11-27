import {
  asSpaceId,
  type Space,
  type SpaceId,
  TASK_PRIORITIES,
  type TaskPriority,
} from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import {
  Button,
  getTaskPriorityLabelKey,
  INKADE_MEDIA_QUERIES,
  Input,
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
import { SearchIcon, SlidersHorizontalIcon, XIcon } from "lucide-react";
import type React from "react";
import { useMediaQuery } from "usehooks-ts";
import type { TaskSourceEngineFilter, TaskStatusFilter } from "./types.ts";

export interface TasksFilterBarProps {
  readonly activeFilterCount: number;
  readonly availableTags: ReadonlyArray<readonly [string, number]>;
  readonly filterPopoverOpen: boolean;
  readonly onFilterPopoverOpenChange: (open: boolean) => void;
  readonly onPriorityFilterChange: (next: string) => void;
  readonly onSourceEngineFilterChange?: ((next: TaskSourceEngineFilter) => void) | undefined;
  readonly onSearchQueryChange: (next: string) => void;
  readonly onSpaceFilterChange: (next: SpaceId | "__all__") => void;
  readonly onStatusFilterChange: (next: TaskStatusFilter) => void;
  readonly onTagFilterChange: (updater: string | ((prev: string) => string)) => void;
  readonly priorityFilter: string;
  readonly sourceEngineFilter?: TaskSourceEngineFilter | undefined;
  readonly searchQuery: string;
  readonly spaceFilter: SpaceId | "__all__";
  readonly spaces: readonly Space[];
  readonly statusFilter: TaskStatusFilter;
  readonly tagFilter: string;
}

export function TasksFilterBar({
  activeFilterCount,
  availableTags,
  filterPopoverOpen,
  onFilterPopoverOpenChange,
  onPriorityFilterChange,
  onSourceEngineFilterChange,
  onSearchQueryChange,
  onSpaceFilterChange,
  onStatusFilterChange,
  onTagFilterChange,
  priorityFilter,
  sourceEngineFilter = "all",
  searchQuery,
  spaceFilter,
  spaces,
  statusFilter,
  tagFilter,
}: TasksFilterBarProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const isSmUp = useMediaQuery(INKADE_MEDIA_QUERIES.sm);

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex min-w-0 basis-full flex-nowrap items-center gap-1.5 sm:basis-auto sm:flex-1">
        <Input
          className="min-w-0 flex-1 sm:w-auto sm:min-w-[200px] sm:max-w-xs"
          onChange={(e) => onSearchQueryChange(e.target.value)}
          placeholder={
            isSmUp ? t("tasks.searchPlaceholder") : t("tasks.searchPlaceholderCompact")
          }
          size="sm"
          startAddon={<SearchIcon />}
          value={searchQuery}
        />

        <Popover onOpenChange={onFilterPopoverOpenChange} open={filterPopoverOpen}>
          <PopoverTrigger
            render={
              <Button
                className="shrink-0"
                data-testid="tasks-filter-trigger"
                size="sm"
                variant={activeFilterCount > 0 ? "secondary" : "outline"}
              />
            }
          >
            <SlidersHorizontalIcon className="size-3.5" />
            <span>{t("tasks.filterButton")}</span>
            {activeFilterCount > 0 && (
              <span className="rounded bg-primary/15 px-1 font-mono text-[10px] font-semibold text-primary tabular-nums">
                {activeFilterCount}
              </span>
            )}
          </PopoverTrigger>
          <PopoverPopup align="start" className="w-72" viewportClassName="p-3">
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground">
                  {t("tasks.filterButton")}
                </span>
                {activeFilterCount > 0 && (
                  <button
                    className="cursor-pointer text-[11px] font-medium text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      onPriorityFilterChange("__all__");
                      onSourceEngineFilterChange?.("all");
                      onSpaceFilterChange("__all__");
                      onTagFilterChange("");
                    }}
                    type="button"
                  >
                    {t("tasks.clearFilters")}
                  </button>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] font-medium text-muted-foreground">
                  {t("tasks.priorityLabel")}
                </span>
                <Select
                  onValueChange={(val) => onPriorityFilterChange(val ?? "__all__")}
                  value={priorityFilter}
                >
                  <SelectTrigger size="sm">
                    <SelectValue>
                      {priorityFilter === "__all__"
                        ? t("tasks.filterPriorityAll")
                        : t(getTaskPriorityLabelKey(priorityFilter as TaskPriority, false))}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup>
                    <SelectItem value="__all__">{t("tasks.filterPriorityAll")}</SelectItem>
                    {TASK_PRIORITIES.map((priority) => (
                      <SelectItem key={priority} value={priority}>
                        {t(getTaskPriorityLabelKey(priority, false))}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </div>

              {onSourceEngineFilterChange && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-medium text-muted-foreground">
                    {t("tasks.filterSourceHeading")}
                  </span>
                  <Select<TaskSourceEngineFilter>
                    onValueChange={(val) =>
                      onSourceEngineFilterChange(val ?? "all")
                    }
                    value={sourceEngineFilter}
                  >
                    <SelectTrigger size="sm">
                      <SelectValue>
                        {sourceEngineFilter === "all"
                          ? t("tasks.sourceAll")
                          : sourceEngineFilter === "markdown"
                            ? t("tasks.sourceMarkdown")
                            : t("tasks.sourceOutline")}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectPopup>
                      <SelectItem value="all">{t("tasks.sourceAll")}</SelectItem>
                      <SelectItem value="outline">{t("tasks.sourceOutline")}</SelectItem>
                      <SelectItem value="markdown">{t("tasks.sourceMarkdown")}</SelectItem>
                    </SelectPopup>
                  </Select>
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] font-medium text-muted-foreground">
                  {t("tasks.filterSpaceHeading")}
                </span>
                <Select<SpaceId | "__all__">
                  onValueChange={(val) =>
                    onSpaceFilterChange(!val || val === "__all__" ? "__all__" : asSpaceId(val))
                  }
                  value={spaceFilter}
                >
                  <SelectTrigger size="sm">
                    <SelectValue>
                      {spaceFilter === "__all__"
                        ? t("tasks.filterSpaceAll")
                        : (spaces.find((s) => s.id === spaceFilter)?.name ??
                          t("tasks.filterSpaceAll"))}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup>
                    <SelectItem value="__all__">{t("tasks.filterSpaceAll")}</SelectItem>
                    {spaces
                      .filter((s) => s.archivedAt === null)
                      .map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                  </SelectPopup>
                </Select>
              </div>

              {availableTags.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-medium text-muted-foreground">
                    {t("tasks.filterTagsHeading")}
                  </span>
                  <div className="flex flex-wrap items-center gap-1">
                    {availableTags.map(([tag]) => (
                      <TagPill
                        active={tagFilter === tag}
                        key={tag}
                        onClick={() => onTagFilterChange((prev) => (prev === tag ? "" : tag))}
                        size="sm"
                        tag={tag}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </PopoverPopup>
        </Popover>

        {priorityFilter !== "__all__" && (
          <button
            className="inline-flex h-6 cursor-pointer items-center gap-1 rounded-md border border-border bg-card px-1.5 text-[11px] text-foreground hover:bg-muted"
            onClick={() => onPriorityFilterChange("__all__")}
            type="button"
          >
            <span>{t(getTaskPriorityLabelKey(priorityFilter as TaskPriority, true))}</span>
            <XIcon className="size-3 text-muted-foreground" />
          </button>
        )}
        {sourceEngineFilter !== "all" && onSourceEngineFilterChange && (
          <button
            className="inline-flex h-6 cursor-pointer items-center gap-1 rounded-md border border-border bg-card px-1.5 text-[11px] text-foreground hover:bg-muted"
            onClick={() => onSourceEngineFilterChange("all")}
            type="button"
          >
            <span>
              {sourceEngineFilter === "markdown"
                ? t("tasks.sourceMarkdown")
                : t("tasks.sourceOutline")}
            </span>
            <XIcon className="size-3 text-muted-foreground" />
          </button>
        )}
        {spaceFilter !== "__all__" && (
          <button
            className="inline-flex h-6 cursor-pointer items-center gap-1 rounded-md border border-border bg-card px-1.5 text-[11px] text-foreground hover:bg-muted"
            onClick={() => onSpaceFilterChange("__all__")}
            type="button"
          >
            <span>{spaces.find((s) => s.id === spaceFilter)?.name ?? spaceFilter}</span>
            <XIcon className="size-3 text-muted-foreground" />
          </button>
        )}
        {tagFilter && (
          <TagPill
            active
            onClick={() => onTagFilterChange("")}
            size="sm"
            tag={tagFilter}
          />
        )}
      </div>

      <div className="ml-auto shrink-0">
        <SegmentedControl size="sm">
          {(["all", "open", "completed"] as const).map((status) => (
            <SegmentedControlItem
              className="text-xs sm:text-xs"
              data-checked={statusFilter === status ? "" : undefined}
              key={status}
              onClick={() => onStatusFilterChange(status)}
            >
              {status === "all"
                ? t("tasks.statusAll")
                : status === "open"
                  ? t("tasks.statusOpen")
                  : t("tasks.statusCompleted")}
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
      </div>
    </div>
  );
}
