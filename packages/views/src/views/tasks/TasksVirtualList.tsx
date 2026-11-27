import type {
  OutlineNodeId,
  TaskBucket,
  WorkspaceTaskItem,
} from "@inkade/core";
import { cn } from "@inkade/ui";
import {
  AlertTriangleIcon,
  CalendarClockIcon,
  CalendarDaysIcon,
  ChevronDownIcon,
  InboxIcon,
  MoonIcon,
  SunIcon,
} from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useRef } from "react";
import { TaskItemCard } from "../../components/TaskItemCard.tsx";
import {
  dispatchOrOpenThreadDialog,
  openBindingInHostOrTab,
} from "../../context.tsx";
import {
  useAncestorScrollMetrics,
  useListVirtualizer,
} from "../../lib/use-list-virtualizer.ts";
import type { TaskSectionIconKey, TasksFlatVirtualRow } from "./types.ts";
import type { TasksWorkspaceState } from "./useTasksWorkspace.ts";

function renderSectionIcon(icon: TaskSectionIconKey): React.ReactElement {
  switch (icon) {
    case "alert":
      return <AlertTriangleIcon className="size-3.5 text-amber-500" />;
    case "sun":
      return <SunIcon className="size-3.5 text-amber-500" />;
    case "moon":
      return <MoonIcon className="size-3.5 text-indigo-500" />;
    case "clock":
      return <CalendarClockIcon className="size-3.5 text-indigo-500" />;
    case "calendar":
      return <CalendarDaysIcon className="size-3.5 text-sky-500" />;
    case "inbox":
      return <InboxIcon className="size-3.5 text-muted-foreground" />;
  }
}

export interface TasksVirtualListProps {
  readonly state: TasksWorkspaceState;
  readonly scrollToNodeIdRef: React.MutableRefObject<((nodeId: OutlineNodeId) => void) | null>;
}

export function TasksVirtualList({
  state,
  scrollToNodeIdRef,
}: TasksVirtualListProps): React.ReactElement {
  const {
    t,
    hostActions,
    environment,
    isReadOnly,
    todayStr,
    groupFilter,
    statusFilter,
    showCompletedInAll,
    setShowCompletedInAll,
    tagFilter,
    setTagFilter,
    selectedNodeId,
    setSelectedNodeId,
    setDetailNodeId,
    selectedBatchIds,
    whenOpenNodeId,
    setWhenOpenNodeId,
    recentlyCompletedIds,
    spaceById,
    filteredTasks,
    bucketedGroups,
    rowRefs,
    handleJumpToContext,
    handleToggleBatchSelect,
    toggleTodoMutation,
    toggleSubtaskMutation,
    updateScheduleMutation,
    markBindingReadMutation,
    setDispatchTarget,
  } = state;

  const virtualRows = useMemo<readonly TasksFlatVirtualRow[]>(() => {
    const rows: TasksFlatVirtualRow[] = [];

    if (groupFilter === "today") {
      const eveningTasks: WorkspaceTaskItem[] = [];
      const regularTodayTasks: WorkspaceTaskItem[] = [];
      for (const item of filteredTasks) {
        if (item.node.scheduledSlot === "evening") {
          eveningTasks.push(item);
        } else {
          regularTodayTasks.push(item);
        }
      }

      if (eveningTasks.length > 0) {
        if (regularTodayTasks.length > 0) {
          rows.push({
            kind: "header",
            key: "header:today-anytime",
            icon: "sun",
            heading: t("tasks.todayAnytimeHeading"),
            count: regularTodayTasks.length,
          });
          for (const item of regularTodayTasks) {
            rows.push({ kind: "task", key: `task:${item.node.id}`, item });
          }
        }
        rows.push({
          kind: "header",
          key: "header:today-evening",
          icon: "moon",
          heading: t("tasks.todayEveningHeading"),
          count: eveningTasks.length,
        });
        for (const item of eveningTasks) {
          rows.push({ kind: "task", key: `task:${item.node.id}`, item });
        }
        return rows;
      }
    }

    if (groupFilter === "all" && statusFilter !== "completed") {
      const sections: ReadonlyArray<{
        readonly key: TaskBucket;
        readonly heading: string;
        readonly icon: TaskSectionIconKey;
        readonly items: readonly WorkspaceTaskItem[];
        readonly toneClass?: string | undefined;
      }> = [
        {
          key: "overdue",
          heading: t("tasks.bucketOverdue"),
          icon: "alert",
          items: bucketedGroups.overdue,
          toneClass: "text-warning-foreground",
        },
        {
          key: "today",
          heading: t("tasks.bucketToday"),
          icon: "sun",
          items: bucketedGroups.today,
        },
        {
          key: "tomorrow",
          heading: t("tasks.bucketTomorrow"),
          icon: "calendar",
          items: bucketedGroups.tomorrow,
        },
        {
          key: "week",
          heading: t("tasks.bucketWeek"),
          icon: "clock",
          items: bucketedGroups.week,
        },
        {
          key: "upcoming",
          heading: t("tasks.bucketUpcoming"),
          icon: "calendar",
          items: bucketedGroups.upcoming,
        },
        {
          key: "anytime",
          heading: t("tasks.bucketAnytime"),
          icon: "inbox",
          items: bucketedGroups.anytime,
        },
      ];

      for (const sec of sections) {
        if (sec.items.length === 0) continue;
        rows.push({
          kind: "header",
          key: `header:${sec.key}`,
          bucket: sec.key,
          icon: sec.icon,
          heading: sec.heading,
          count: sec.items.length,
          toneClass: sec.toneClass,
        });
        for (const item of sec.items) {
          rows.push({ kind: "task", key: `task:${item.node.id}`, item });
        }
      }

      if (statusFilter === "all" && bucketedGroups.completed.length > 0) {
        rows.push({
          kind: "completed-toggle",
          key: "completed-toggle",
          count: bucketedGroups.completed.length,
          expanded: showCompletedInAll,
        });
        if (showCompletedInAll) {
          for (const item of bucketedGroups.completed) {
            rows.push({ kind: "task", key: `task:${item.node.id}`, item });
          }
        }
      }

      return rows;
    }

    for (const item of filteredTasks) {
      rows.push({ kind: "task", key: `task:${item.node.id}`, item });
    }
    return rows;
  }, [bucketedGroups, filteredTasks, groupFilter, showCompletedInAll, statusFilter, t]);

  const rowIndexByNodeId = useMemo(() => {
    const map = new Map<OutlineNodeId, number>();
    virtualRows.forEach((row, index) => {
      if (row.kind === "task") {
        map.set(row.item.node.id, index);
      }
    });
    return map;
  }, [virtualRows]);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const { scrollElement, scrollMargin } = useAncestorScrollMetrics(
    wrapperRef,
    `${groupFilter}:${statusFilter}:${filteredTasks.length}:${showCompletedInAll}`,
  );

  const virtualizer = useListVirtualizer<HTMLElement, HTMLDivElement>({
    count: virtualRows.length,
    getScrollElement: () => scrollElement,
    estimateSize: (index) => (virtualRows[index]?.kind === "task" ? 96 : 36),
    scrollMargin,
    overscan: 8,
    gap: 8,
    getItemKey: (index) => virtualRows[index]?.key ?? index,
  });

  useEffect(() => {
    scrollToNodeIdRef.current = (nodeId: OutlineNodeId) => {
      const idx = rowIndexByNodeId.get(nodeId);
      if (idx !== undefined) {
        virtualizer.scrollToIndex(idx, { align: "auto" });
      } else {
        rowRefs.current.get(nodeId)?.scrollIntoView({ block: "nearest" });
      }
    };
    return () => {
      scrollToNodeIdRef.current = null;
    };
  }, [rowIndexByNodeId, rowRefs, scrollToNodeIdRef, virtualizer]);

  const virtualItems = virtualizer.getVirtualItems();

  const renderTaskCard = (item: WorkspaceTaskItem): React.ReactElement => (
    <TaskItemCard
      activeTagFilter={tagFilter || undefined}
      cardRef={(el) => {
        if (el) rowRefs.current.set(item.node.id, el);
        else rowRefs.current.delete(item.node.id);
      }}
      checkedForBatch={selectedBatchIds.has(item.node.id)}
      item={item}
      onClickTag={(tag) => setTagFilter((prev) => (prev === tag ? "" : tag))}
      onDispatchAde={(targetItem) =>
        dispatchOrOpenThreadDialog(
          hostActions,
          environment,
          {
            documentId: targetItem.document.id,
            documentTitle: targetItem.document.title,
            nodeId: targetItem.node.id,
            excerpt:
              targetItem.node.contentText || targetItem.node.contentMarkdown,
          },
          setDispatchTarget,
        )
      }
      onJumpToContext={handleJumpToContext}
      onOpenDetail={(targetItem) => setDetailNodeId(targetItem.node.id)}
      onMarkBindingRead={(b) => markBindingReadMutation.mutate(b.id)}
      onOpenBinding={(b) => openBindingInHostOrTab(hostActions, environment, b)}
      onSchedulePopoverOpenChange={(open) => {
        if (open) {
          setSelectedNodeId(item.node.id);
          setWhenOpenNodeId(item.node.id);
        } else if (whenOpenNodeId === item.node.id) {
          setWhenOpenNodeId(null);
        }
      }}
      onSelectCard={(e) => {
        e.currentTarget.focus({ preventScroll: true });
        setSelectedNodeId(item.node.id);
      }}
      onToggleBatchSelect={handleToggleBatchSelect}
      onToggleComplete={(targetItem, nextChecked) =>
        toggleTodoMutation.mutate({ node: targetItem.node, nextChecked })
      }
      onToggleSubtask={(subtaskId, nextChecked) =>
        toggleSubtaskMutation.mutate({ subtaskId, nextChecked })
      }
      onUpdateSchedule={async (targetItem, patch) => {
        await updateScheduleMutation.mutateAsync({ item: targetItem, patch });
      }}
      readonly={isReadOnly}
      recentlyCompleted={recentlyCompletedIds.has(item.node.id)}
      schedulePending={
        updateScheduleMutation.isPending &&
        updateScheduleMutation.variables?.item.node.id === item.node.id
      }
      schedulePopoverOpen={whenOpenNodeId === item.node.id}
      selected={selectedNodeId === item.node.id}
      selectionActive={selectedBatchIds.size > 0}
      space={spaceById.get(item.document.spaceId)}
      todayDate={todayStr}
    />
  );

  return (
    <div className="w-full pb-6 md:pb-4" data-testid="tasks-virtual-list" ref={wrapperRef}>
      <div
        className="relative w-full"
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        {virtualItems.map((virtualRow) => {
          const row = virtualRows[virtualRow.index];
          if (!row) return null;

          return (
            <div
              className="absolute top-0 left-0 w-full"
              data-index={virtualRow.index}
              key={virtualRow.key}
              ref={virtualizer.measureElement}
              style={{
                transform: `translateY(${virtualRow.start - virtualizer.options.scrollMargin}px)`,
              }}
            >
              {row.kind === "header" ? (
                <div
                  className={cn(virtualRow.index > 0 && "pt-2")}
                  data-task-bucket={row.bucket}
                >
                  <h2
                    className={cn(
                      "inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground",
                      row.toneClass,
                    )}
                  >
                    {renderSectionIcon(row.icon)}
                    <span>{row.heading}</span>
                    <span className="font-mono font-normal tabular-nums">
                      {row.count}
                    </span>
                  </h2>
                </div>
              ) : row.kind === "completed-toggle" ? (
                <div className="border-t border-border/60 pt-3">
                  <button
                    aria-expanded={row.expanded}
                    className="inline-flex w-fit cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    onClick={() => setShowCompletedInAll((prev) => !prev)}
                    type="button"
                  >
                    <ChevronDownIcon
                      className={cn(
                        "size-3.5 transition-transform duration-[var(--duration-micro)]",
                        row.expanded && "rotate-180",
                      )}
                    />
                    <span>
                      {row.expanded
                        ? t("tasks.hideCompleted", { count: row.count })
                        : t("tasks.showCompletedCount", { count: row.count })}
                    </span>
                  </button>
                </div>
              ) : (
                renderTaskCard(row.item)
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
