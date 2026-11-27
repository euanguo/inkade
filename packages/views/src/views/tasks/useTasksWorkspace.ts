import {
  classifyTaskBucket,
  extractInlineTags,
  type OutlineNode,
  type OutlineNodeId,
  type SpaceId,
  type TaskBucket,
  type TaskPriority,
  type TasksStatusFilter,
  type WorkspaceTaskItem,
} from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import { useInkadeSpaces, useInkadeTasks } from "@inkade/sdk/react";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DispatchAdeTarget } from "../../components/DispatchAdeDialog.tsx";
import { resolveItemScheduledDate } from "../../components/TaskItemCard.tsx";
import {
  dispatchOrOpenThreadDialog,
  useInkadeViewsContext,
} from "../../context.tsx";
import { computeDeferTargetDate } from "../../lib/daily-studio.ts";
import { getTodayDailyDate } from "../../lib/dates.ts";
import { useUserPreferences } from "../../lib/preferences-store.ts";
import { isEditableEventTarget, isImeEvent } from "../../lib/shortcuts.ts";
import type { TasksBoardGroupMode } from "../TasksBoardView.tsx";
import type {
  QuickAddPreset,
  TaskGroupFilter,
  TaskKpiGroup,
  TasksBucketedGroups,
  TaskSourceEngineFilter,
  TaskStatusFilter,
  TasksStats,
  TasksViewProps,
  TasksWorkspaceMode,
} from "./types.ts";
import { useTasksMutations } from "./useTasksMutations.ts";

export interface UseTasksWorkspaceOptions extends TasksViewProps {
  readonly scrollToNodeIdRef: React.MutableRefObject<((nodeId: OutlineNodeId) => void) | null>;
}

export function useTasksWorkspace({
  readonly: readonlyProp,
  initialViewMode,
  urlState,
  onUrlStateChange,
  scrollToNodeIdRef,
}: UseTasksWorkspaceOptions) {
  const { t } = useInkadeTranslation();
  const { navigation, hostActions, environment } = useInkadeViewsContext();
  const isReadOnly = readonlyProp ?? environment.readonly ?? false;
  const { preferences, updatePreferences } = useUserPreferences();
  const canvasWidth = preferences.layout.workspaceCanvasWidth;
  const todayStr = getTodayDailyDate();
  const tomorrowStr = computeDeferTargetDate(todayStr, "tomorrow");

  const viewMode: TasksWorkspaceMode =
    urlState?.view ?? initialViewMode ?? preferences.tasks.viewMode;
  const boardGroupBy: TasksBoardGroupMode =
    urlState?.boardGroup ?? preferences.tasks.boardGroupBy;
  const groupFilter: TaskGroupFilter = urlState?.group ?? preferences.tasks.groupFilter;
  const prefStatusFilter: TasksStatusFilter =
    urlState?.status ?? preferences.tasks.statusFilter;
  const statusFilter: TaskStatusFilter =
    prefStatusFilter === "done" ? "completed" : prefStatusFilter;
  const quickAddPreset: QuickAddPreset = preferences.tasks.quickAddPreset;
  const showCompletedInAll = preferences.tasks.showCompletedInAll;

  const [priorityFilter, setPriorityFilterState] = useState<string>(
    () => urlState?.priority ?? "__all__",
  );
  const [sourceEngineFilter, setSourceEngineFilterState] = useState<TaskSourceEngineFilter>(
    () => urlState?.engine ?? "all",
  );
  const [spaceFilter, setSpaceFilterState] = useState<SpaceId | "__all__">(
    () => urlState?.space ?? "__all__",
  );
  const [tagFilter, setTagFilterState] = useState<string>(() => urlState?.tag ?? "");
  const [searchQuery, setSearchQueryState] = useState<string>(() => urlState?.q ?? "");

  const prevUrlFiltersRef = useRef({
    priority: urlState?.priority,
    engine: urlState?.engine,
    space: urlState?.space,
    tag: urlState?.tag,
    q: urlState?.q,
  });

  useEffect(() => {
    const prev = prevUrlFiltersRef.current;
    if (prev.priority !== urlState?.priority) {
      prev.priority = urlState?.priority;
      setPriorityFilterState(urlState?.priority ?? "__all__");
    }
    if (prev.engine !== urlState?.engine) {
      prev.engine = urlState?.engine;
      setSourceEngineFilterState(urlState?.engine ?? "all");
    }
    if (prev.space !== urlState?.space) {
      prev.space = urlState?.space;
      setSpaceFilterState(urlState?.space ?? "__all__");
    }
    if (prev.tag !== urlState?.tag) {
      prev.tag = urlState?.tag;
      setTagFilterState(urlState?.tag ?? "");
    }
    if (prev.q !== urlState?.q) {
      prev.q = urlState?.q;
      setSearchQueryState(urlState?.q ?? "");
    }
  }, [urlState?.engine, urlState?.priority, urlState?.q, urlState?.space, urlState?.tag]);

  const setViewMode = useCallback(
    (next: TasksWorkspaceMode) => {
      updatePreferences({ tasks: { viewMode: next } });
      onUrlStateChange?.({ view: next });
    },
    [onUrlStateChange, updatePreferences],
  );

  const setBoardGroupBy = useCallback(
    (next: TasksBoardGroupMode) => {
      updatePreferences({ tasks: { boardGroupBy: next } });
      onUrlStateChange?.({ boardGroup: next });
    },
    [onUrlStateChange, updatePreferences],
  );

  const setGroupFilter = useCallback(
    (next: TaskGroupFilter) => {
      updatePreferences({ tasks: { groupFilter: next } });
      onUrlStateChange?.({ group: next });
    },
    [onUrlStateChange, updatePreferences],
  );

  const setStatusFilter = useCallback(
    (next: TaskStatusFilter) => {
      const normalized: TasksStatusFilter = next === "completed" ? "done" : next;
      updatePreferences({ tasks: { statusFilter: normalized } });
      onUrlStateChange?.({ status: normalized });
    },
    [onUrlStateChange, updatePreferences],
  );

  const setQuickAddPreset = useCallback(
    (next: QuickAddPreset) => {
      updatePreferences({ tasks: { quickAddPreset: next } });
    },
    [updatePreferences],
  );

  const setShowCompletedInAll = useCallback(
    (updater: boolean | ((prev: boolean) => boolean)) => {
      const next =
        typeof updater === "function" ? updater(preferences.tasks.showCompletedInAll) : updater;
      updatePreferences({ tasks: { showCompletedInAll: next } });
    },
    [preferences.tasks.showCompletedInAll, updatePreferences],
  );

  const setPriorityFilter = useCallback(
    (next: string) => {
      setPriorityFilterState(next);
      onUrlStateChange?.({
        priority: next === "__all__" ? undefined : (next as TaskPriority),
      });
    },
    [onUrlStateChange],
  );

  const setSourceEngineFilter = useCallback(
    (next: TaskSourceEngineFilter) => {
      setSourceEngineFilterState(next);
      onUrlStateChange?.({
        engine: next === "all" ? undefined : next,
      });
    },
    [onUrlStateChange],
  );

  const setSpaceFilter = useCallback(
    (next: SpaceId | "__all__") => {
      setSpaceFilterState(next);
      onUrlStateChange?.({ space: next === "__all__" ? undefined : next });
    },
    [onUrlStateChange],
  );

  const setTagFilter = useCallback(
    (updater: string | ((prev: string) => string)) => {
      const next = typeof updater === "function" ? updater(tagFilter) : updater;
      setTagFilterState(next);
      onUrlStateChange?.({ tag: next || undefined });
    },
    [onUrlStateChange, tagFilter],
  );

  const setSearchQuery = useCallback(
    (next: string) => {
      setSearchQueryState(next);
      onUrlStateChange?.({ q: next.trim() ? next : undefined });
    },
    [onUrlStateChange],
  );

  const [dispatchTarget, setDispatchTarget] = useState<DispatchAdeTarget | null>(null);
  const [quickAddExpanded, setQuickAddExpanded] = useState(false);
  const [filterPopoverOpen, setFilterPopoverOpen] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<OutlineNodeId | null>(null);
  const [detailNodeId, setDetailNodeId] = useState<OutlineNodeId | null>(null);
  const [selectedBatchIds, setSelectedBatchIds] = useState<ReadonlySet<OutlineNodeId>>(
    () => new Set(),
  );

  const quickAddInputRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<Map<OutlineNodeId, HTMLDivElement>>(new Map());
  const lastBatchAnchorRef = useRef<OutlineNodeId | null>(null);

  const clearBatchSelection = useCallback(() => {
    setSelectedBatchIds(new Set());
  }, []);

  const handleCreatedNode = useCallback(
    (createdNode: OutlineNode): void => {
      setSelectedNodeId(createdNode.id);
      if (statusFilter === "completed") {
        setStatusFilter("open");
      }
      const scheduledDate = createdNode.scheduledDate ?? null;
      const bucket = classifyTaskBucket(
        {
          checked: createdNode.checked,
          scheduledDate,
          dueDate: createdNode.dueDate ?? null,
        },
        todayStr,
      );
      if (
        (groupFilter === "today" && scheduledDate !== todayStr) ||
        (groupFilter === "overdue" && bucket !== "overdue") ||
        (groupFilter === "anytime" && scheduledDate !== null)
      ) {
        setGroupFilter("all");
      }
    },
    [groupFilter, setGroupFilter, setStatusFilter, statusFilter, todayStr],
  );

  const mutations = useTasksMutations({
    t,
    isReadOnly,
    todayStr,
    tomorrowStr,
    quickAddPreset,
    spaceFilter,
    onCreatedNode: handleCreatedNode,
    onClearBatchSelection: clearBatchSelection,
  });

  const tasksQuery = useInkadeTasks({
    status: "all",
    ...(spaceFilter !== "__all__" ? { spaceId: spaceFilter } : {}),
    ...(tagFilter ? { tag: tagFilter } : {}),
    limit: 500,
  });

  const spacesQuery = useInkadeSpaces();
  const spaces = useMemo(() => spacesQuery.data ?? [], [spacesQuery.data]);
  const spaceById = useMemo(
    () => new Map(spaces.map((s) => [s.id, s])),
    [spaces],
  );
  const allTasks = useMemo(() => tasksQuery.data ?? [], [tasksQuery.data]);

  const isOverdueTask = useCallback(
    (item: WorkspaceTaskItem): boolean =>
      item.node.checked === false &&
      !item.node.rolledOverToDocId &&
      classifyTaskBucket(
        {
          checked: item.node.checked,
          scheduledDate: resolveItemScheduledDate(item),
          dueDate: item.node.dueDate ?? null,
        },
        todayStr,
      ) === "overdue",
    [todayStr],
  );

  const isTodayTask = useCallback(
    (item: WorkspaceTaskItem): boolean => resolveItemScheduledDate(item) === todayStr,
    [todayStr],
  );

  const isAnytimeTask = useCallback(
    (item: WorkspaceTaskItem): boolean =>
      item.node.checked === false && resolveItemScheduledDate(item) === null,
    [],
  );

  const stats: TasksStats = useMemo(() => {
    let open = 0;
    let completed = 0;
    let today = 0;
    let overdue = 0;
    let anytime = 0;
    let ade = 0;
    for (const item of allTasks) {
      if (item.node.checked === false) open += 1;
      if (item.node.checked === true) completed += 1;
      if (isTodayTask(item) && item.node.checked === false) today += 1;
      if (isOverdueTask(item)) overdue += 1;
      if (isAnytimeTask(item)) anytime += 1;
      if (item.bindings.length > 0) ade += 1;
    }
    const total = allTasks.length;
    const completionPercent = total > 0 ? Math.round((completed / total) * 100) : 0;
    return { open, completed, total, completionPercent, today, overdue, anytime, ade };
  }, [allTasks, isAnytimeTask, isOverdueTask, isTodayTask]);

  const availableTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of allTasks) {
      const tags = new Set([
        ...item.document.tags,
        ...extractInlineTags(item.node.contentMarkdown),
      ]);
      for (const tag of tags) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 14);
  }, [allTasks]);

  const filteredTasks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return allTasks.filter((item) => {
      if (
        statusFilter === "open" &&
        item.node.checked !== false &&
        !mutations.recentlyCompletedIds.has(item.node.id)
      ) {
        return false;
      }
      if (statusFilter === "completed" && item.node.checked !== true) return false;

      if (groupFilter === "today" && !isTodayTask(item)) return false;
      if (groupFilter === "overdue" && !isOverdueTask(item)) return false;
      if (groupFilter === "anytime" && !isAnytimeTask(item)) return false;
      if (groupFilter === "ade" && item.bindings.length === 0) return false;

      if (priorityFilter !== "__all__") {
        const effectivePriority = item.node.priority ?? "none";
        if (effectivePriority !== priorityFilter) return false;
      }

      if (sourceEngineFilter !== "all") {
        const itemEngine =
          item.sourceEngine ??
          (item.document.kind === "article" || item.document.kind === "clip"
            ? "markdown"
            : "outline");
        if (itemEngine !== sourceEngineFilter) return false;
      }

      if (q) {
        const inlineTags = extractInlineTags(item.node.contentMarkdown).join(" ");
        const hay =
          `${item.node.contentText} ${item.node.contentMarkdown} ${item.document.title} ${item.document.tags.join(" ")} ${inlineTags}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [
    allTasks,
    groupFilter,
    isAnytimeTask,
    isOverdueTask,
    isTodayTask,
    mutations.recentlyCompletedIds,
    priorityFilter,
    searchQuery,
    sourceEngineFilter,
    statusFilter,
  ]);

  const bucketedGroups: TasksBucketedGroups = useMemo(() => {
    const buckets: Record<TaskBucket, WorkspaceTaskItem[]> = {
      overdue: [],
      today: [],
      tomorrow: [],
      week: [],
      upcoming: [],
      anytime: [],
      completed: [],
    };
    for (const item of filteredTasks) {
      if (mutations.recentlyCompletedIds.has(item.node.id) && statusFilter === "open") {
        const originalBucket = classifyTaskBucket(
          {
            checked: false,
            scheduledDate: resolveItemScheduledDate(item),
            dueDate: item.node.dueDate ?? null,
          },
          todayStr,
        );
        buckets[originalBucket].push(item);
        continue;
      }
      const bucket = classifyTaskBucket(
        {
          checked: item.node.checked,
          scheduledDate: resolveItemScheduledDate(item),
          dueDate: item.node.dueDate ?? null,
        },
        todayStr,
      );
      buckets[bucket].push(item);
    }
    return buckets;
  }, [filteredTasks, mutations.recentlyCompletedIds, statusFilter, todayStr]);

  // Visible ordered items for Shift-click range selection and J/K keyboard nav
  const visibleOrderedTasks = useMemo(() => {
    if (viewMode !== "list" || groupFilter !== "all" || statusFilter === "completed") {
      return filteredTasks;
    }
    const order: WorkspaceTaskItem[] = [
      ...bucketedGroups.overdue,
      ...bucketedGroups.today,
      ...bucketedGroups.tomorrow,
      ...bucketedGroups.week,
      ...bucketedGroups.upcoming,
      ...bucketedGroups.anytime,
    ];
    if (statusFilter === "all" && showCompletedInAll) {
      order.push(...bucketedGroups.completed);
    }
    return order;
  }, [
    bucketedGroups,
    filteredTasks,
    groupFilter,
    showCompletedInAll,
    statusFilter,
    viewMode,
  ]);

  useEffect(() => {
    if (
      selectedNodeId &&
      !visibleOrderedTasks.some((item) => item.node.id === selectedNodeId)
    ) {
      setSelectedNodeId(null);
    }
  }, [selectedNodeId, visibleOrderedTasks]);

  const handleJumpToContext = useCallback(
    (item: WorkspaceTaskItem): void => {
      if (item.document.dailyDate) {
        navigation.openDaily(item.document.dailyDate, { nodeId: item.node.id });
      } else {
        navigation.openDocument(item.document.id);
      }
    },
    [navigation],
  );

  const handleToggleBatchSelect = useCallback(
    (nodeId: OutlineNodeId, shiftKey: boolean): void => {
      if (isReadOnly) return;
      setSelectedBatchIds((prev) => {
        const next = new Set(prev);
        if (shiftKey && lastBatchAnchorRef.current) {
          const anchorIdx = visibleOrderedTasks.findIndex(
            (item) => item.node.id === lastBatchAnchorRef.current,
          );
          const currentIdx = visibleOrderedTasks.findIndex(
            (item) => item.node.id === nodeId,
          );
          if (anchorIdx >= 0 && currentIdx >= 0) {
            const start = Math.min(anchorIdx, currentIdx);
            const end = Math.max(anchorIdx, currentIdx);
            for (let i = start; i <= end; i += 1) {
              const target = visibleOrderedTasks[i];
              if (target) next.add(target.node.id);
            }
            return next;
          }
        }
        if (next.has(nodeId)) {
          next.delete(nodeId);
        } else {
          next.add(nodeId);
        }
        return next;
      });
      lastBatchAnchorRef.current = nodeId;
    },
    [isReadOnly, visibleOrderedTasks],
  );

  const { setWhenOpenNodeId, toggleTodoMutation, whenOpenNodeId } = mutations;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (
        isImeEvent(event) ||
        isEditableEventTarget(event.target) ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        dispatchTarget !== null
      ) {
        return;
      }

      if (event.key === "Escape" && selectedBatchIds.size > 0) {
        event.preventDefault();
        setSelectedBatchIds(new Set());
        return;
      }

      const lower = event.key.toLowerCase();
      if (lower === "n") {
        event.preventDefault();
        setQuickAddExpanded(true);
        window.setTimeout(() => {
          quickAddInputRef.current?.focus();
        }, 0);
        return;
      }

      if (visibleOrderedTasks.length === 0) return;

      const currentIndex = selectedNodeId
        ? visibleOrderedTasks.findIndex((item) => item.node.id === selectedNodeId)
        : 0;
      const activeItem =
        visibleOrderedTasks[Math.max(0, currentIndex)] ?? visibleOrderedTasks[0];

      if (lower === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        const nextIdx = Math.min(
          visibleOrderedTasks.length - 1,
          currentIndex < 0 ? 0 : currentIndex + 1,
        );
        const nextItem = visibleOrderedTasks[nextIdx];
        if (nextItem) {
          setSelectedNodeId(nextItem.node.id);
          if (scrollToNodeIdRef.current) {
            scrollToNodeIdRef.current(nextItem.node.id);
          } else {
            rowRefs.current.get(nextItem.node.id)?.scrollIntoView({ block: "nearest" });
          }
        }
        return;
      }

      if (lower === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        const nextIdx = Math.max(0, currentIndex < 0 ? 0 : currentIndex - 1);
        const nextItem = visibleOrderedTasks[nextIdx];
        if (nextItem) {
          setSelectedNodeId(nextItem.node.id);
          if (scrollToNodeIdRef.current) {
            scrollToNodeIdRef.current(nextItem.node.id);
          } else {
            rowRefs.current.get(nextItem.node.id)?.scrollIntoView({ block: "nearest" });
          }
        }
        return;
      }

      if (!activeItem) return;

      if (event.key === " ") {
        event.preventDefault();
        toggleTodoMutation.mutate({
          node: activeItem.node,
          nextChecked: activeItem.node.checked !== true,
        });
      } else if (lower === "x" && !isReadOnly) {
        event.preventDefault();
        handleToggleBatchSelect(activeItem.node.id, event.shiftKey);
      } else if (lower === "s" && !isReadOnly) {
        event.preventDefault();
        setWhenOpenNodeId((prev) =>
          prev === activeItem.node.id ? null : activeItem.node.id,
        );
      } else if (lower === "d") {
        event.preventDefault();
        if (!isReadOnly) {
          dispatchOrOpenThreadDialog(
            hostActions,
            environment,
            {
              documentId: activeItem.document.id,
              documentTitle: activeItem.document.title,
              nodeId: activeItem.node.id,
              excerpt: activeItem.node.contentText || activeItem.node.contentMarkdown,
            },
            setDispatchTarget,
          );
        }
      } else if (event.key === "Enter" && whenOpenNodeId === null) {
        event.preventDefault();
        handleJumpToContext(activeItem);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    dispatchTarget,
    environment,
    handleJumpToContext,
    handleToggleBatchSelect,
    hostActions,
    isReadOnly,
    scrollToNodeIdRef,
    selectedBatchIds.size,
    selectedNodeId,
    setWhenOpenNodeId,
    toggleTodoMutation,
    visibleOrderedTasks,
    whenOpenNodeId,
  ]);

  const kpiGroups: readonly TaskKpiGroup[] = [
    { key: "all", label: t("tasks.groupAll"), count: stats.open },
    { key: "today", label: t("tasks.groupToday"), count: stats.today },
    { key: "overdue", label: t("tasks.groupOverdue"), count: stats.overdue, tone: "warning" },
    { key: "anytime", label: t("tasks.groupAnytime"), count: stats.anytime },
    { key: "ade", label: t("tasks.groupAde"), count: stats.ade, tone: "primary" },
  ];

  const selectedItemsList = useMemo(
    () => allTasks.filter((item) => selectedBatchIds.has(item.node.id)),
    [allTasks, selectedBatchIds],
  );
  const selectedAllCompleted =
    selectedItemsList.length > 0 &&
    selectedItemsList.every((item) => item.node.checked === true);
  const selectedIdsArray = useMemo(() => [...selectedBatchIds], [selectedBatchIds]);

  const detailItem = useMemo(
    () => (detailNodeId ? allTasks.find((tItem) => tItem.node.id === detailNodeId) ?? null : null),
    [allTasks, detailNodeId],
  );

  const isWideMode = viewMode === "board" || viewMode === "agenda";
  const activeFilterCount =
    (priorityFilter !== "__all__" ? 1 : 0) +
    (sourceEngineFilter !== "all" ? 1 : 0) +
    (spaceFilter !== "__all__" ? 1 : 0) +
    (tagFilter ? 1 : 0);
  const showQuickAddRow = !isReadOnly && (!isWideMode || quickAddExpanded || mutations.hasQuickTokens);

  return {
    t,
    hostActions,
    environment,
    isReadOnly,
    updatePreferences,
    canvasWidth,
    todayStr,
    tomorrowStr,
    viewMode,
    setViewMode,
    boardGroupBy,
    setBoardGroupBy,
    groupFilter,
    setGroupFilter,
    statusFilter,
    setStatusFilter,
    quickAddPreset,
    setQuickAddPreset,
    showCompletedInAll,
    setShowCompletedInAll,
    priorityFilter,
    setPriorityFilter,
    sourceEngineFilter,
    setSourceEngineFilter,
    spaceFilter,
    setSpaceFilter,
    tagFilter,
    setTagFilter,
    searchQuery,
    setSearchQuery,
    dispatchTarget,
    setDispatchTarget,
    quickAddExpanded,
    setQuickAddExpanded,
    filterPopoverOpen,
    setFilterPopoverOpen,
    selectedNodeId,
    setSelectedNodeId,
    detailNodeId,
    setDetailNodeId,
    detailItem,
    selectedBatchIds,
    setSelectedBatchIds,
    clearBatchSelection,
    quickAddInputRef,
    rowRefs,
    tasksQuery,
    spaces,
    spaceById,
    stats,
    kpiGroups,
    availableTags,
    filteredTasks,
    bucketedGroups,
    visibleOrderedTasks,
    selectedAllCompleted,
    selectedIdsArray,
    isWideMode,
    activeFilterCount,
    showQuickAddRow,
    handleJumpToContext,
    handleToggleBatchSelect,
    ...mutations,
  };
}

export type TasksWorkspaceState = ReturnType<typeof useTasksWorkspace>;
