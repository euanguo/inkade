import {
  asOutlineNodeId,
  classifyTaskBucket,
  parseQuickTaskSyntax,
  TASK_PRIORITIES,
  type AdeThreadBinding,
  type OutlineNodeId,
  type Space,
  type SpaceId,
  type TaskPriority,
  type WorkspaceTaskItem,
} from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import {
  Badge,
  bindPragmaticDraggable,
  bindPragmaticDropTarget,
  Button,
  cn,
  getTaskPriorityLabelKey,
  Input,
  SegmentedControl,
  SegmentedControlItem,
  TASK_PRIORITY_STYLES,
} from "@inkade/ui";
import { PlusIcon } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  resolveItemScheduledDate,
  TaskItemCard,
} from "../components/TaskItemCard.tsx";
import type { TaskSchedulePatch } from "../components/TaskSchedulePopover.tsx";
import { shiftDailyDate } from "../lib/dates.ts";

export type TasksBoardGroupMode = "schedule" | "priority";

interface BoardColumnDef {
  readonly id: string;
  readonly title: string;
  readonly accentClass: string;
  readonly items: readonly WorkspaceTaskItem[];
  readonly droppable: boolean;
  readonly targetScheduledDate?: string | null | undefined;
  readonly targetPriority?: TaskPriority | undefined;
}

export interface TasksBoardViewProps {
  readonly tasks: readonly WorkspaceTaskItem[];
  readonly todayDate: string;
  readonly spacesById: ReadonlyMap<SpaceId, Space>;
  readonly readonly?: boolean | undefined;
  readonly groupBy?: TasksBoardGroupMode | undefined;
  readonly onGroupByChange?: ((next: TasksBoardGroupMode) => void) | undefined;
  readonly activeTagFilter?: string | undefined;
  readonly schedulePendingNodeId?: OutlineNodeId | null | undefined;
  readonly onToggleComplete: (item: WorkspaceTaskItem, nextChecked: boolean) => void;
  readonly onToggleSubtask?: ((subtaskId: OutlineNodeId, nextChecked: boolean) => void) | undefined;
  readonly onUpdateSchedule: (
    item: WorkspaceTaskItem,
    patch: TaskSchedulePatch,
  ) => void | Promise<void>;
  readonly onQuickAddToColumn?:
    | ((options: {
        readonly rawText: string;
        readonly scheduledDate?: string | null | undefined;
        readonly priority?: TaskPriority | undefined;
      }) => void)
    | undefined;
  readonly onDispatchAde?: ((item: WorkspaceTaskItem) => void) | undefined;
  readonly onJumpToContext?: ((item: WorkspaceTaskItem) => void) | undefined;
  readonly onOpenDetail?: ((item: WorkspaceTaskItem) => void) | undefined;
  readonly onClickTag?: ((tag: string) => void) | undefined;
  readonly onOpenBinding?: ((binding: AdeThreadBinding) => void) | undefined;
  readonly onMarkBindingRead?: ((binding: AdeThreadBinding) => void) | undefined;
}

function BoardTaskCardWrapper({
  item,
  todayDate,
  space,
  readonly,
  activeTagFilter,
  schedulePending,
  onToggleComplete,
  onToggleSubtask,
  onUpdateSchedule,
  onDispatchAde,
  onJumpToContext,
  onOpenDetail,
  onClickTag,
  onOpenBinding,
  onMarkBindingRead,
}: {
  readonly item: WorkspaceTaskItem;
  readonly todayDate: string;
  readonly space?: Space | undefined;
  readonly readonly: boolean;
  readonly activeTagFilter?: string | undefined;
  readonly schedulePending: boolean;
  readonly onToggleComplete: (item: WorkspaceTaskItem, nextChecked: boolean) => void;
  readonly onToggleSubtask?: ((subtaskId: OutlineNodeId, nextChecked: boolean) => void) | undefined;
  readonly onUpdateSchedule: (
    item: WorkspaceTaskItem,
    patch: TaskSchedulePatch,
  ) => void | Promise<void>;
  readonly onDispatchAde?: ((item: WorkspaceTaskItem) => void) | undefined;
  readonly onJumpToContext?: ((item: WorkspaceTaskItem) => void) | undefined;
  readonly onOpenDetail?: ((item: WorkspaceTaskItem) => void) | undefined;
  readonly onClickTag?: ((tag: string) => void) | undefined;
  readonly onOpenBinding?: ((binding: AdeThreadBinding) => void) | undefined;
  readonly onMarkBindingRead?: ((binding: AdeThreadBinding) => void) | undefined;
}): React.ReactElement {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const el = cardRef.current;
    if (!el || readonly) return;
    return bindPragmaticDraggable({
      element: el,
      getInitialData: () => ({
        type: "inkade-tasks-board-card",
        nodeId: item.node.id,
      }),
      onDragStart: () => setDragging(true),
      onDrop: () => setDragging(false),
    });
  }, [item.node.id, readonly]);

  return (
    <TaskItemCard
      activeTagFilter={activeTagFilter}
      cardRef={(el) => {
        cardRef.current = el;
      }}
      compact
      draggable={!readonly}
      isDragging={dragging}
      item={item}
      onClickTag={onClickTag}
      onDispatchAde={onDispatchAde}
      onJumpToContext={onJumpToContext}
      onMarkBindingRead={onMarkBindingRead}
      onOpenBinding={onOpenBinding}
      onOpenDetail={onOpenDetail}
      onToggleComplete={onToggleComplete}
      onToggleSubtask={onToggleSubtask}
      onUpdateSchedule={onUpdateSchedule}
      readonly={readonly}
      schedulePending={schedulePending}
      space={space}
      todayDate={todayDate}
    />
  );
}

function BoardColumn({
  column,
  todayDate,
  spacesById,
  readonly,
  activeTagFilter,
  schedulePendingNodeId,
  onDropTask,
  onToggleComplete,
  onToggleSubtask,
  onUpdateSchedule,
  onQuickAdd,
  onDispatchAde,
  onJumpToContext,
  onOpenDetail,
  onClickTag,
  onOpenBinding,
  onMarkBindingRead,
}: {
  readonly column: BoardColumnDef;
  readonly todayDate: string;
  readonly spacesById: ReadonlyMap<SpaceId, Space>;
  readonly readonly: boolean;
  readonly activeTagFilter?: string | undefined;
  readonly schedulePendingNodeId?: OutlineNodeId | null | undefined;
  readonly onDropTask: (nodeId: OutlineNodeId, column: BoardColumnDef) => void;
  readonly onToggleComplete: (item: WorkspaceTaskItem, nextChecked: boolean) => void;
  readonly onToggleSubtask?: ((subtaskId: OutlineNodeId, nextChecked: boolean) => void) | undefined;
  readonly onUpdateSchedule: (
    item: WorkspaceTaskItem,
    patch: TaskSchedulePatch,
  ) => void | Promise<void>;
  readonly onQuickAdd?: ((column: BoardColumnDef, text: string) => void) | undefined;
  readonly onDispatchAde?: ((item: WorkspaceTaskItem) => void) | undefined;
  readonly onJumpToContext?: ((item: WorkspaceTaskItem) => void) | undefined;
  readonly onOpenDetail?: ((item: WorkspaceTaskItem) => void) | undefined;
  readonly onClickTag?: ((tag: string) => void) | undefined;
  readonly onOpenBinding?: ((binding: AdeThreadBinding) => void) | undefined;
  readonly onMarkBindingRead?: ((binding: AdeThreadBinding) => void) | undefined;
}): React.ReactElement {
  const { t } = useInkadeTranslation();
  const colRef = useRef<HTMLDivElement>(null);
  const [isOver, setIsOver] = useState(false);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    const el = colRef.current;
    if (!el || readonly || !column.droppable) return;
    return bindPragmaticDropTarget({
      element: el,
      canDrop: ({ sourceData }) =>
        sourceData["type"] === "inkade-tasks-board-card",
      onDragEnter: () => setIsOver(true),
      onDragLeave: () => setIsOver(false),
      onDrop: ({ sourceData }) => {
        setIsOver(false);
        const nodeId = sourceData["nodeId"];
        if (typeof nodeId === "string" && nodeId.trim().length > 0) {
          onDropTask(asOutlineNodeId(nodeId), column);
        }
      },
    });
  }, [column, onDropTask, readonly]);

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed || !onQuickAdd) return;
    onQuickAdd(column, trimmed);
    setDraft("");
  };

  return (
    <section
      className={cn(
        "flex min-h-[380px] min-w-[248px] flex-1 flex-col gap-2 rounded-xl border border-border/65 bg-muted/30 p-2.5 transition-colors duration-[var(--duration-micro)] xl:min-w-0",
        isOver && "border-primary/55 bg-primary/6",
      )}
      data-board-column={column.id}
      ref={colRef}
    >
      <header className="flex items-center justify-between gap-2 px-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn("size-2 shrink-0 rounded-full", column.accentClass)} />
          <h3 className="truncate text-sm font-semibold text-foreground">
            {column.title}
          </h3>
        </div>
        <Badge className="tabular-nums" size="sm" variant="secondary">
          {column.items.length}
        </Badge>
      </header>

      <div className="flex flex-1 flex-col gap-2">
        {column.items.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed py-10 text-xs text-muted-foreground">
            {t("tasks.boardEmptyColumn")}
          </div>
        ) : (
          column.items.map((item) => (
            <BoardTaskCardWrapper
              activeTagFilter={activeTagFilter}
              item={item}
              key={item.node.id}
              onClickTag={onClickTag}
              onDispatchAde={onDispatchAde}
              onJumpToContext={onJumpToContext}
              onMarkBindingRead={onMarkBindingRead}
              onOpenBinding={onOpenBinding}
              onOpenDetail={onOpenDetail}
              onToggleComplete={onToggleComplete}
              onToggleSubtask={onToggleSubtask}
              onUpdateSchedule={onUpdateSchedule}
              readonly={readonly}
              schedulePending={schedulePendingNodeId === item.node.id}
              space={spacesById.get(item.document.spaceId)}
              todayDate={todayDate}
            />
          ))
        )}
      </div>

      {!readonly && onQuickAdd && column.droppable && (
        <form className="flex items-center gap-1.5 pt-1" onSubmit={handleSubmit}>
          <Input
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t("tasks.boardQuickAddPlaceholder")}
            size="sm"
            value={draft}
          />
          <Button
            aria-label={t("tasks.boardAddButton")}
            disabled={!draft.trim()}
            size="icon-sm"
            type="submit"
            variant="outline"
          >
            <PlusIcon className="size-3.5" />
          </Button>
        </form>
      )}
    </section>
  );
}

export function TasksBoardView({
  tasks,
  todayDate,
  spacesById,
  readonly = false,
  groupBy: groupByProp,
  onGroupByChange,
  activeTagFilter,
  schedulePendingNodeId,
  onToggleComplete,
  onToggleSubtask,
  onUpdateSchedule,
  onQuickAddToColumn,
  onDispatchAde,
  onJumpToContext,
  onOpenDetail,
  onClickTag,
  onOpenBinding,
  onMarkBindingRead,
}: TasksBoardViewProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const [uncontrolledGroupBy, setUncontrolledGroupBy] = useState<TasksBoardGroupMode>("schedule");
  const groupBy = groupByProp ?? uncontrolledGroupBy;
  const setGroupBy = (next: TasksBoardGroupMode): void => {
    if (groupByProp === undefined) {
      setUncontrolledGroupBy(next);
    }
    onGroupByChange?.(next);
  };

  const columns = useMemo<readonly BoardColumnDef[]>(() => {
    if (groupBy === "priority") {
      const buckets: Record<TaskPriority, WorkspaceTaskItem[]> = {
        p1: [],
        p2: [],
        p3: [],
        p4: [],
        none: [],
      };
      for (const item of tasks) {
        const p: TaskPriority = item.node.priority ?? "none";
        buckets[p].push(item);
      }
      return TASK_PRIORITIES.map((priority) => ({
        id: `priority:${priority}`,
        title: t(getTaskPriorityLabelKey(priority, false)),
        accentClass: TASK_PRIORITY_STYLES[priority].dotClass,
        items: buckets[priority],
        droppable: true,
        targetPriority: priority,
      }));
    }

    const overdue: WorkspaceTaskItem[] = [];
    const anytime: WorkspaceTaskItem[] = [];
    const today: WorkspaceTaskItem[] = [];
    const tomorrow: WorkspaceTaskItem[] = [];
    const week: WorkspaceTaskItem[] = [];
    const upcoming: WorkspaceTaskItem[] = [];

    for (const item of tasks) {
      const bucket = classifyTaskBucket(
        {
          checked: item.node.checked,
          scheduledDate: resolveItemScheduledDate(item),
        },
        todayDate,
      );
      if (bucket === "overdue") overdue.push(item);
      else if (bucket === "anytime") anytime.push(item);
      else if (bucket === "today") today.push(item);
      else if (bucket === "tomorrow") tomorrow.push(item);
      else if (bucket === "week") week.push(item);
      else if (bucket === "upcoming") upcoming.push(item);
    }

    const tomorrowDate = shiftDailyDate(todayDate, 1);
    const weekDate = shiftDailyDate(todayDate, 3);
    const upcomingDate = shiftDailyDate(todayDate, 8);

    const scheduleCols: BoardColumnDef[] = [];
    if (overdue.length > 0) {
      scheduleCols.push({
        id: "schedule:overdue",
        title: t("tasks.bucketOverdue"),
        accentClass: "bg-red-500",
        items: overdue,
        droppable: false,
      });
    }
    scheduleCols.push(
      {
        id: "schedule:anytime",
        title: t("tasks.bucketAnytime"),
        accentClass: "bg-muted-foreground/60",
        items: anytime,
        droppable: true,
        targetScheduledDate: null,
      },
      {
        id: "schedule:today",
        title: t("tasks.bucketToday"),
        accentClass: "bg-amber-500",
        items: today,
        droppable: true,
        targetScheduledDate: todayDate,
      },
      {
        id: "schedule:tomorrow",
        title: t("tasks.bucketTomorrow"),
        accentClass: "bg-sky-500",
        items: tomorrow,
        droppable: true,
        targetScheduledDate: tomorrowDate,
      },
      {
        id: "schedule:week",
        title: t("tasks.bucketWeek"),
        accentClass: "bg-indigo-500",
        items: week,
        droppable: true,
        targetScheduledDate: weekDate,
      },
      {
        id: "schedule:upcoming",
        title: t("tasks.bucketUpcoming"),
        accentClass: "bg-emerald-500",
        items: upcoming,
        droppable: true,
        targetScheduledDate: upcomingDate,
      },
    );
    return scheduleCols;
  }, [groupBy, t, tasks, todayDate]);

  const handleDropTask = (nodeId: OutlineNodeId, column: BoardColumnDef): void => {
    if (readonly || !column.droppable) return;
    const item = tasks.find((entry) => entry.node.id === nodeId);
    if (!item) return;

    if (groupBy === "priority" && column.targetPriority) {
      const currentPriority = item.node.priority ?? "none";
      if (currentPriority === column.targetPriority) return;
      void onUpdateSchedule(item, { priority: column.targetPriority });
      return;
    }

    if (groupBy === "schedule" && column.targetScheduledDate !== undefined) {
      const currentBucket = classifyTaskBucket(
        {
          checked: item.node.checked,
          scheduledDate: resolveItemScheduledDate(item),
        },
        todayDate,
      );
      const targetColumnBucket = column.id.replace("schedule:", "");
      if (currentBucket === targetColumnBucket) return;

      if (column.targetScheduledDate === null) {
        void onUpdateSchedule(item, { scheduledDate: null, scheduledSlot: null });
      } else {
        void onUpdateSchedule(item, { scheduledDate: column.targetScheduledDate });
      }
    }
  };

  const handleQuickAdd = (column: BoardColumnDef, text: string): void => {
    if (!onQuickAddToColumn || readonly) return;
    const parsed = parseQuickTaskSyntax(text);
    onQuickAddToColumn({
      rawText: text,
      ...(parsed.scheduledDate === undefined && column.targetScheduledDate !== undefined
        ? { scheduledDate: column.targetScheduledDate }
        : {}),
      ...(parsed.priority === undefined && column.targetPriority !== undefined
        ? { priority: column.targetPriority }
        : {}),
    });
  };

  return (
    <div className="flex flex-col gap-2" data-testid="tasks-board-view">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className="text-[11px] font-medium text-muted-foreground">
          {t("tasks.boardGroupLabel")}
        </span>
        <SegmentedControl size="sm">
          <SegmentedControlItem
            data-checked={groupBy === "schedule" ? "" : undefined}
            onClick={() => setGroupBy("schedule")}
          >
            {t("tasks.boardGroupSchedule")}
          </SegmentedControlItem>
          <SegmentedControlItem
            data-checked={groupBy === "priority" ? "" : undefined}
            onClick={() => setGroupBy("priority")}
          >
            {t("tasks.boardGroupPriority")}
          </SegmentedControlItem>
        </SegmentedControl>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-3 pr-2 xl:grid xl:auto-cols-fr xl:grid-flow-col xl:overflow-x-visible xl:pr-0">
        {columns.map((column) => (
          <BoardColumn
            activeTagFilter={activeTagFilter}
            column={column}
            key={column.id}
            onClickTag={onClickTag}
            onDispatchAde={onDispatchAde}
            onDropTask={handleDropTask}
            onJumpToContext={onJumpToContext}
            onMarkBindingRead={onMarkBindingRead}
            onOpenBinding={onOpenBinding}
            onOpenDetail={onOpenDetail}
            onQuickAdd={onQuickAddToColumn ? handleQuickAdd : undefined}
            onToggleComplete={onToggleComplete}
            onToggleSubtask={onToggleSubtask}
            onUpdateSchedule={onUpdateSchedule}
            readonly={readonly}
            schedulePendingNodeId={schedulePendingNodeId}
            spacesById={spacesById}
            todayDate={todayDate}
          />
        ))}
      </div>
    </div>
  );
}
