import { useInkadeTranslation } from "@inkade/i18n";
import {
  Button,
  cn,
  NumberTicker,
  SegmentedControl,
  SegmentedControlItem,
} from "@inkade/ui";
import {
  CalendarClockIcon,
  Columns3Icon,
  ListIcon,
  Maximize2Icon,
  Minimize2Icon,
  PlusIcon,
} from "lucide-react";
import type React from "react";
import type { TaskGroupFilter, TaskKpiGroup, TasksStats, TasksWorkspaceMode } from "./types.ts";

export interface TasksHeaderBarProps {
  readonly canvasWidth: "fluid" | "centered";
  readonly groupFilter: TaskGroupFilter;
  readonly isPending: boolean;
  readonly isReadOnly: boolean;
  readonly isWideMode: boolean;
  readonly kpiGroups: readonly TaskKpiGroup[];
  readonly onGroupFilterChange: (next: TaskGroupFilter) => void;
  readonly onToggleCanvasWidth: () => void;
  readonly onToggleQuickAdd: () => void;
  readonly onViewModeChange: (next: TasksWorkspaceMode) => void;
  readonly quickAddExpanded: boolean;
  readonly stats: TasksStats;
  readonly viewMode: TasksWorkspaceMode;
}

export function TasksHeaderBar({
  canvasWidth,
  groupFilter,
  isPending,
  isReadOnly,
  isWideMode,
  kpiGroups,
  onGroupFilterChange,
  onToggleCanvasWidth,
  onToggleQuickAdd,
  onViewModeChange,
  quickAddExpanded,
  stats,
  viewMode,
}: TasksHeaderBarProps): React.ReactElement {
  const { t } = useInkadeTranslation();

  return (
    <header
      className="flex w-full flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-background px-4 py-2.5 lg:px-6"
      data-testid="tasks-header"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <h1 className="shrink-0 text-base font-semibold tracking-tight text-foreground">
          {t("tasks.title")}
        </h1>
        <span aria-hidden="true" className="hidden h-3.5 w-px bg-border sm:inline-block" />
        <div
          aria-label={t("tasks.groupAll")}
          className="flex max-w-full flex-nowrap items-center gap-1 overflow-x-auto pr-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [mask-image:linear-gradient(to_right,black_calc(100%-20px),transparent)] sm:flex-wrap sm:pr-0 sm:[mask-image:none]"
          role="group"
        >
          {kpiGroups.map((grp) => {
            const active = groupFilter === grp.key;
            return (
              <button
                aria-pressed={active}
                className={cn(
                  "inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-xs font-medium transition-colors duration-[var(--duration-micro)]",
                  active
                    ? "bg-foreground text-background shadow-xs"
                    : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                )}
                key={grp.key}
                onClick={() => onGroupFilterChange(grp.key)}
                type="button"
              >
                <span>{grp.label}</span>
                <span
                  aria-hidden="true"
                  className={cn(
                    "inline-flex items-center justify-center rounded px-1.5 py-0.5 font-mono text-[11px] leading-tight tabular-nums [--number-flow-mask-height:0em]",
                    active
                      ? "bg-background/20 text-background"
                      : grp.tone === "warning" && grp.count > 0
                        ? "bg-warning/15 text-warning-foreground"
                        : grp.tone === "primary" && grp.count > 0
                          ? "bg-primary/12 text-primary"
                          : "bg-muted text-muted-foreground",
                  )}
                >
                  <NumberTicker
                    animated={!isPending}
                    durationMs={180}
                    mode={isPending ? "interpolate" : "odometer"}
                    value={grp.count}
                  />
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {isWideMode && !isReadOnly && (
          <Button
            aria-expanded={quickAddExpanded}
            aria-label={t("tasks.quickAddToggleAria")}
            onClick={onToggleQuickAdd}
            size="xs"
            title={t("tasks.quickSyntaxHint")}
            variant={quickAddExpanded ? "secondary" : "outline"}
          >
            <PlusIcon className="size-3.5" />
            <span>{t("tasks.quickAddSubmit")}</span>
          </Button>
        )}

        <div
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border/80 bg-card px-2 text-xs shadow-[var(--shadow-card)]"
          title={t("agentControl.tasksCompletionTitle")}
        >
          <svg
            aria-hidden="true"
            className="size-4 -rotate-90 text-muted-foreground/35"
            viewBox="0 0 24 24"
          >
            <circle
              cx="12"
              cy="12"
              fill="none"
              r="9"
              stroke="currentColor"
              strokeWidth="2.75"
            />
            <circle
              className="text-primary transition-[stroke-dashoffset] duration-[var(--duration-medium)] ease-[var(--ease-smooth-out)]"
              cx="12"
              cy="12"
              fill="none"
              r="9"
              stroke="currentColor"
              strokeDasharray={56.548}
              strokeDashoffset={56.548 * (1 - stats.completionPercent / 100)}
              strokeLinecap="round"
              strokeWidth="2.75"
            />
          </svg>
          <span className="font-semibold text-foreground tabular-nums">
            <NumberTicker suffix="%" value={stats.completionPercent} />
          </span>
        </div>

        <SegmentedControl aria-label={t("tasks.viewSwitcherAria")} size="sm">
          <SegmentedControlItem
            data-checked={viewMode === "list" ? "" : undefined}
            onClick={() => onViewModeChange("list")}
          >
            <ListIcon className="size-3.5" />
            <span>{t("tasks.viewList")}</span>
          </SegmentedControlItem>
          <SegmentedControlItem
            data-checked={viewMode === "board" ? "" : undefined}
            onClick={() => onViewModeChange("board")}
          >
            <Columns3Icon className="size-3.5" />
            <span>{t("tasks.viewBoard")}</span>
          </SegmentedControlItem>
          <SegmentedControlItem
            data-checked={viewMode === "agenda" ? "" : undefined}
            onClick={() => onViewModeChange("agenda")}
          >
            <CalendarClockIcon className="size-3.5" />
            <span>{t("tasks.viewAgenda")}</span>
          </SegmentedControlItem>
        </SegmentedControl>

        <Button
          aria-label={t("common.toggleCanvasWidthTitle")}
          aria-pressed={canvasWidth === "centered"}
          className="hidden sm:inline-flex"
          data-testid="workspace-width-toggle"
          onClick={onToggleCanvasWidth}
          size="icon-xs"
          title={
            canvasWidth === "fluid"
              ? `${t("common.toggleCanvasWidthTitle")} (${t("common.canvasWidthFluid")})`
              : `${t("common.toggleCanvasWidthTitle")} (${t("common.canvasWidthCentered")})`
          }
          variant={canvasWidth === "centered" ? "secondary" : "ghost"}
        >
          {canvasWidth === "fluid" ? (
            <Minimize2Icon className="size-3.5" />
          ) : (
            <Maximize2Icon className="size-3.5" />
          )}
        </Button>
      </div>
    </header>
  );
}
