import {
  Badge,
  Button,
  cn,
  Input,
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
  MiniCalendarHeatmap,
  Popover,
  PopoverPopup,
  PopoverTrigger,
  SegmentedControl,
  SegmentedControlItem,
} from "@inkade/ui";
import {
  CalendarDaysIcon,
  CheckCircle2Icon,
  CheckSquareIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleDashedIcon,
  Columns3Icon,
  ListTreeIcon,
  Maximize2Icon,
  Minimize2Icon,
  MoreHorizontalIcon,
  PanelRightCloseIcon,
  PanelRightOpenIcon,
  ScrollTextIcon,
  SendIcon,
} from "lucide-react";
import type React from "react";
import { formatDailyHeading, shiftDailyDate } from "../../lib/dates.ts";
import type { DailyWorkspaceState } from "./useDailyWorkspace.ts";

export function DailyHeaderBar({
  state,
}: {
  readonly state: DailyWorkspaceState;
}): React.ReactElement {
  const {
    t,
    locale,
    isCompact,
    activeDate,
    todayStr,
    relBadge,
    isToday,
    reviewedAt,
    canvasWidth,
    readerMeasure,
    updatePreferences,
    viewMode,
    setViewMode,
    streamMode,
    setStreamMode,
    focusRailOpen,
    setFocusRailOpen,
    datePickerOpen,
    setDatePickerOpen,
    dateDraft,
    setDateDraft,
    summaryQuery,
    dailyDoc,
    activeNodes,
    weekDays,
    activeDayDatesSet,
    goDate,
    openDispatch,
    toggleReviewedMutation,
  } = state;

  return (
    <header
      className={cn(
        "flex w-full flex-col gap-2 border-b border-border/60 bg-background",
        isCompact ? "px-3 py-2" : "px-4 py-2.5 lg:px-6",
      )}
      data-testid="daily-header"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Popover onOpenChange={setDatePickerOpen} open={datePickerOpen}>
            <PopoverTrigger
              render={
                <button
                  aria-label={t("daily.openCalendarAria")}
                  className="group inline-flex min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 -ml-1.5 text-left transition-colors duration-[var(--duration-micro)] hover:bg-muted/65 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--border-focus)]"
                  type="button"
                />
              }
            >
              <h1 className="truncate text-lg font-semibold tracking-tight text-foreground sm:text-xl">
                {formatDailyHeading(activeDate, locale)}
              </h1>
              <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
            </PopoverTrigger>
            <PopoverPopup align="start" className="w-[304px]" viewportClassName="gap-3 p-3.5">
              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground">
                  {t("daily.heatmapTitle")}
                </p>
                <MiniCalendarHeatmap
                  activeDate={activeDate}
                  dailyActivity={summaryQuery.data?.dailyActivity ?? []}
                  onSelectDate={(selectedDate) => {
                    setDatePickerOpen(false);
                    goDate(selectedDate);
                  }}
                  todayDate={todayStr}
                />
              </div>

              <div className="flex items-center gap-1.5 border-t border-border/60 pt-3">
                <Input
                  onChange={(e) => setDateDraft(e.target.value)}
                  size="sm"
                  type="date"
                  value={dateDraft}
                />
                <Button
                  className="shrink-0"
                  onClick={() => {
                    setDatePickerOpen(false);
                    if (dateDraft) goDate(dateDraft);
                  }}
                  size="sm"
                  variant="secondary"
                >
                  {t("daily.openDayOutline")}
                </Button>
              </div>
            </PopoverPopup>
          </Popover>

          {relBadge && (
            <Badge
              className={cn(isToday && "hidden sm:inline-flex")}
              size="sm"
              variant="outline"
            >
              {relBadge}
            </Badge>
          )}
          {dailyDoc && (
            <span className="hidden text-xs text-muted-foreground tabular-nums md:inline">
              {t("daily.nodeCountAndVersion", { count: activeNodes.length })}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1">
          <div className="flex items-center gap-0.5">
            <Button
              aria-label={t("daily.prevDay")}
              onClick={() => goDate(shiftDailyDate(activeDate, -1))}
              size="icon-sm"
              variant="ghost"
            >
              <ChevronLeftIcon />
            </Button>
            <Button
              onClick={() => goDate(todayStr)}
              size="sm"
              variant={isToday ? "secondary" : "ghost"}
            >
              {t("daily.todayButton")}
            </Button>
            <Button
              aria-label={t("daily.nextDay")}
              onClick={() => goDate(shiftDailyDate(activeDate, 1))}
              size="icon-sm"
              variant="ghost"
            >
              <ChevronRightIcon />
            </Button>
          </div>

          {dailyDoc && (
            <Button
              aria-pressed={Boolean(reviewedAt)}
              data-testid="daily-reviewed-toggle"
              disabled={toggleReviewedMutation.isPending}
              onClick={() => toggleReviewedMutation.mutate(!reviewedAt)}
              size="xs"
              title={
                reviewedAt
                  ? t("daily.reviewedAtTooltip", { time: reviewedAt.slice(0, 16).replace("T", " ") })
                  : t("daily.markReviewedLabel")
              }
              variant={reviewedAt ? "secondary" : "outline"}
            >
              {reviewedAt ? (
                <CheckCircle2Icon className="size-3.5 text-success-foreground" />
              ) : (
                <CircleDashedIcon className="size-3.5 text-muted-foreground" />
              )}
              <span className="hidden sm:inline">
                {reviewedAt ? t("daily.headerReviewedButton") : t("daily.headerMarkReviewedButton")}
              </span>
            </Button>
          )}

          <SegmentedControl size="sm">
            <SegmentedControlItem
              data-pressed={viewMode === "outline" ? "" : undefined}
              onClick={() => setViewMode("outline")}
            >
              <ListTreeIcon />
              <span className="hidden sm:inline">{t("daily.viewModeOutline")}</span>
            </SegmentedControlItem>
            <SegmentedControlItem
              data-pressed={viewMode === "kanban" ? "" : undefined}
              onClick={() => setViewMode("kanban")}
            >
              <Columns3Icon />
              <span className="hidden sm:inline">{t("daily.viewModeKanban")}</span>
            </SegmentedControlItem>
            <SegmentedControlItem
              data-pressed={viewMode === "tasks" ? "" : undefined}
              onClick={() => setViewMode("tasks")}
            >
              <CheckSquareIcon />
              <span className="hidden sm:inline">{t("daily.viewModeTasks")}</span>
            </SegmentedControlItem>
          </SegmentedControl>

          <Button
            aria-label={t("daily.focusRailToggleAria")}
            aria-pressed={focusRailOpen}
            onClick={() => setFocusRailOpen((prev) => !prev)}
            size="icon-sm"
            title={t("daily.focusRailToggleAria")}
            variant={focusRailOpen ? "secondary" : "ghost"}
          >
            {focusRailOpen ? <PanelRightCloseIcon /> : <PanelRightOpenIcon />}
          </Button>

          <Button
            aria-label={t("common.toggleCanvasWidthTitle")}
            aria-pressed={viewMode === "kanban" ? canvasWidth === "centered" : readerMeasure === "full"}
            className="hidden sm:inline-flex"
            data-testid="workspace-width-toggle"
            onClick={() => {
              if (viewMode === "kanban") {
                updatePreferences({
                  layout: {
                    workspaceCanvasWidth: canvasWidth === "fluid" ? "centered" : "fluid",
                  },
                });
              } else {
                updatePreferences({
                  reader: {
                    measure: readerMeasure === "full" ? "72ch" : "full",
                  },
                });
              }
            }}
            size="icon-sm"
            title={
              (viewMode === "kanban" ? canvasWidth === "fluid" : readerMeasure === "full")
                ? `${t("common.toggleCanvasWidthTitle")} (${t("common.canvasWidthFluid")})`
                : `${t("common.toggleCanvasWidthTitle")} (${t("common.canvasWidthCentered")})`
            }
            variant={
              (viewMode === "kanban" ? canvasWidth === "centered" : readerMeasure === "full")
                ? "secondary"
                : "ghost"
            }
          >
            {(viewMode === "kanban" ? canvasWidth === "fluid" : readerMeasure === "full") ? (
              <Minimize2Icon className="size-3.5" />
            ) : (
              <Maximize2Icon className="size-3.5" />
            )}
          </Button>

          <Menu>
            <MenuTrigger
              render={
                <Button
                  aria-label={t("daily.moreActionsAria")}
                  size="icon-sm"
                  variant="ghost"
                />
              }
            >
              <MoreHorizontalIcon />
            </MenuTrigger>
            <MenuPopup align="end">
              <MenuItem onClick={() => setStreamMode((prev) => !prev)}>
                <ScrollTextIcon />
                <span>
                  {streamMode ? t("daily.streamModeContinuous") : t("daily.streamModeSingle")}
                </span>
              </MenuItem>
              {dailyDoc && (
                <MenuItem
                  onClick={() =>
                    openDispatch({
                      documentId: dailyDoc.id,
                      documentTitle: dailyDoc.title,
                      excerpt: activeNodes
                        .slice(0, 6)
                        .map((n) => `- ${n.contentText}`)
                        .join("\n"),
                    })
                  }
                >
                  <SendIcon />
                  <span>{t("daily.dispatchAde")}</span>
                </MenuItem>
              )}
              <MenuSeparator />
              <MenuItem onClick={() => setDatePickerOpen(true)}>
                <CalendarDaysIcon />
                <span>{t("daily.jumpToDate")}</span>
              </MenuItem>
            </MenuPopup>
          </Menu>
        </div>
      </div>

      <nav
        aria-label={t("daily.weekRibbonAria")}
        className="grid w-full grid-cols-7 gap-1 rounded-lg bg-muted/40 p-1"
        data-testid="daily-week-ribbon"
      >
        {weekDays.map((day) => {
          const hasActivity = activeDayDatesSet.has(day.date);
          return (
            <button
              aria-current={day.isSelected ? "date" : undefined}
              className={cn(
                "flex min-w-0 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-[calc(var(--radius-md)-2px)] px-1 py-1.5 transition-colors sm:flex-row sm:gap-1.5 sm:px-1.5 sm:py-1",
                day.isSelected
                  ? "bg-foreground text-background shadow-xs"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
                day.isToday &&
                  !day.isSelected &&
                  "ring-1 ring-inset ring-foreground/25 text-foreground",
              )}
              data-date={day.date}
              key={day.date}
              onClick={() => goDate(day.date)}
              type="button"
            >
              <span className="whitespace-nowrap text-[10px] font-medium leading-none uppercase tracking-wide opacity-80">
                {day.weekdayShort}
              </span>
              <span className="inline-flex items-center gap-1 text-xs font-semibold leading-tight tabular-nums">
                <span>{day.dayOfMonth}</span>
                <span
                  aria-hidden="true"
                  className={cn(
                    "size-1 shrink-0 rounded-full",
                    hasActivity
                      ? day.isSelected
                        ? "bg-background/85"
                        : "bg-foreground/60"
                      : "bg-transparent",
                  )}
                />
              </span>
            </button>
          );
        })}
      </nav>
    </header>
  );
}
