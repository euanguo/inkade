import {
  type BatchUpdateTasksInput,
  type OutlineNodeId,
  TASK_PRIORITIES,
  type WorkspaceTaskItem,
} from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import {
  Badge,
  Button,
  cn,
  getTaskPriorityLabelKey,
  Menu,
  MenuItem,
  MenuPopup,
  MenuTrigger,
  TASK_PRIORITY_STYLES,
} from "@inkade/ui";
import {
  CalendarDaysIcon,
  CheckIcon,
  FlagIcon,
  InboxIcon,
  SunIcon,
  XIcon,
} from "lucide-react";
import type React from "react";

export interface TasksBulkActionBarProps {
  readonly isPending: boolean;
  readonly onBatchUpdate: (input: BatchUpdateTasksInput) => void;
  readonly onClearSelection: () => void;
  readonly onSelectAllVisible: () => void;
  readonly selectedAllCompleted: boolean;
  readonly selectedCount: number;
  readonly selectedIds: readonly OutlineNodeId[];
  readonly todayStr: string;
  readonly tomorrowStr: string;
  readonly visibleOrderedTasks: readonly WorkspaceTaskItem[];
}

export function TasksBulkActionBar({
  isPending,
  onBatchUpdate,
  onClearSelection,
  onSelectAllVisible,
  selectedAllCompleted,
  selectedCount,
  selectedIds,
  todayStr,
  tomorrowStr,
  visibleOrderedTasks,
}: TasksBulkActionBarProps): React.ReactElement {
  const { t } = useInkadeTranslation();

  return (
    <div
      className="fixed inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] z-40 flex flex-col gap-1.5 rounded-xl border border-[var(--border-overlay)] bg-popover/96 px-3 py-2 shadow-[var(--shadow-overlay)] backdrop-blur-md md:inset-x-auto md:bottom-6 md:left-1/2 md:max-w-[94vw] md:-translate-x-1/2 md:flex-row md:flex-nowrap md:items-center md:gap-1.5 md:rounded-xl md:py-1.5"
      data-testid="tasks-bulk-bar"
    >
      <div className="flex items-center justify-between gap-2 md:contents">
        <Badge className="shrink-0 tabular-nums" size="sm" variant="secondary">
          {t("tasks.selectedCount", { count: selectedCount })}
        </Badge>

        <Button
          aria-label={t("tasks.clearSelection")}
          className="shrink-0 md:order-last"
          onClick={onClearSelection}
          size="icon-xs"
          title={t("tasks.clearSelection")}
          variant="ghost"
        >
          <XIcon className="size-3.5" />
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-1 md:flex-nowrap">
        {visibleOrderedTasks.length > selectedCount && (
          <Button onClick={onSelectAllVisible} size="xs" variant="ghost">
            {t("tasks.selectAllVisible")}
          </Button>
        )}

        <Button
          disabled={isPending}
          onClick={() =>
            onBatchUpdate({
              nodeIds: [...selectedIds],
              checked: !selectedAllCompleted,
            })
          }
          size="xs"
          variant="secondary"
        >
          <CheckIcon className="size-3.5" />
          <span>
            {selectedAllCompleted ? t("tasks.batchReopen") : t("tasks.batchComplete")}
          </span>
        </Button>

        <Button
          disabled={isPending}
          onClick={() =>
            onBatchUpdate({
              nodeIds: [...selectedIds],
              scheduledDate: todayStr,
            })
          }
          size="xs"
          variant="outline"
        >
          <SunIcon className="size-3.5 text-amber-500" />
          <span>{t("tasks.batchMoveToday")}</span>
        </Button>

        <Button
          disabled={isPending}
          onClick={() =>
            onBatchUpdate({
              nodeIds: [...selectedIds],
              scheduledDate: tomorrowStr,
            })
          }
          size="xs"
          variant="outline"
        >
          <CalendarDaysIcon className="size-3.5 text-sky-500" />
          <span>{t("tasks.batchMoveTomorrow")}</span>
        </Button>

        <Button
          disabled={isPending}
          onClick={() =>
            onBatchUpdate({
              nodeIds: [...selectedIds],
              scheduledDate: null,
              scheduledSlot: null,
            })
          }
          size="xs"
          variant="outline"
        >
          <InboxIcon className="size-3.5" />
          <span>{t("tasks.batchMoveAnytime")}</span>
        </Button>

        <Menu>
          <MenuTrigger
            render={
              <Button disabled={isPending} size="xs" variant="outline" />
            }
          >
            <FlagIcon className="size-3.5" />
            <span>{t("tasks.batchPriority")}</span>
          </MenuTrigger>
          <MenuPopup align="end">
            {TASK_PRIORITIES.map((priority) => (
              <MenuItem
                key={priority}
                onClick={() =>
                  onBatchUpdate({
                    nodeIds: [...selectedIds],
                    priority,
                  })
                }
              >
                <span
                  className={cn(
                    "size-2 shrink-0 rounded-full",
                    TASK_PRIORITY_STYLES[priority].dotClass,
                  )}
                />
                <span>{t(getTaskPriorityLabelKey(priority, false))}</span>
              </MenuItem>
            ))}
          </MenuPopup>
        </Menu>
      </div>
    </div>
  );
}
