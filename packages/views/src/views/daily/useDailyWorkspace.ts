import {
  type AdeThreadBinding,
  type AgentSteeringMode,
  detectBindingConflicts,
  type DocumentId,
  type OutlineNodeId,
  pickDailySerendipityDocs,
  type TaskScheduleSlot,
  type ThreadBindingId,
} from "@inkade/core";
import { useInkadeLocale, useInkadeTranslation } from "@inkade/i18n";
import {
  useInkadeDailyOutline,
  useInkadeDocuments,
  useInkadeOutlineNodes,
  useInkadeSpaces,
  useInkadeTasks,
  useInkadeTemplates,
  useInkadeThreadBindings,
  useInkadeWhoami,
  useInkadeWorkspaceSummary,
} from "@inkade/sdk/react";
import {
  type ComposerDocumentOption,
  extractCitationsFromSummary,
  type KanbanGroupMode,
} from "@inkade/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DispatchAdeTarget } from "../../components/DispatchAdeDialog.tsx";
import type { PromoteNodeTarget } from "../../components/PromoteNodeDialog.tsx";
import {
  dispatchOrOpenThreadDialog,
  openBindingInHostOrTab,
  useInkadeViewsContext,
} from "../../context.tsx";
import {
  filterDocumentsCreatedOnDate,
  getDailyReviewedAt,
  getIsoWeekDays,
  isPendingAdeStatus,
} from "../../lib/daily-studio.ts";
import { getRelativeDailyBadge, getTodayDailyDate, shiftDailyDate } from "../../lib/dates.ts";
import { useUserPreferences } from "../../lib/preferences-store.ts";
import { isEditableEventTarget, isImeEvent } from "../../lib/shortcuts.ts";
import {
  type DailyFocusRailTaskEntry,
  type DailyOutlineViewProps,
  type DailyViewMode,
  findPrevRolloverDocId,
} from "./types.ts";
import { useDailyMutations } from "./useDailyMutations.ts";

export function useDailyWorkspace({
  date,
  focusNodeId,
  compact = false,
  readonly: readonlyProp,
  urlState,
  onUrlStateChange,
}: DailyOutlineViewProps = {}) {
  const { t } = useInkadeTranslation();
  const { locale } = useInkadeLocale();
  const { navigation, hostActions, notifier, environment } = useInkadeViewsContext();
  const isReadOnly = readonlyProp ?? environment.readonly ?? false;
  const isCompact = compact || environment.density === "compact";
  const activeDate = date ?? getTodayDailyDate();
  const { preferences, updatePreferences } = useUserPreferences();
  const canvasWidth = preferences.layout.workspaceCanvasWidth;
  const readerMeasure = preferences.reader.measure;

  const viewMode: DailyViewMode = urlState?.view ?? preferences.daily.viewMode;
  const kanbanGroupBy: KanbanGroupMode =
    urlState?.kanbanGroup ?? preferences.daily.kanbanGroupBy;
  const streamMode = preferences.daily.streamMode;
  const focusRailOpen = preferences.daily.focusRailOpen;
  const todosExpanded = preferences.daily.todosExpanded;

  const setViewMode = useCallback(
    (updater: DailyViewMode | ((prev: DailyViewMode) => DailyViewMode)) => {
      const current = urlState?.view ?? preferences.daily.viewMode;
      const next = typeof updater === "function" ? updater(current) : updater;
      updatePreferences({ daily: { viewMode: next } });
      onUrlStateChange?.({ view: next });
    },
    [onUrlStateChange, preferences.daily.viewMode, updatePreferences, urlState?.view],
  );

  const setKanbanGroupBy = useCallback(
    (next: KanbanGroupMode) => {
      updatePreferences({ daily: { kanbanGroupBy: next } });
      onUrlStateChange?.({ kanbanGroup: next });
    },
    [onUrlStateChange, updatePreferences],
  );

  const setStreamMode = useCallback(
    (updater: boolean | ((prev: boolean) => boolean)) => {
      const next =
        typeof updater === "function" ? updater(preferences.daily.streamMode) : updater;
      updatePreferences({ daily: { streamMode: next } });
    },
    [preferences.daily.streamMode, updatePreferences],
  );

  const setFocusRailOpen = useCallback(
    (updater: boolean | ((prev: boolean) => boolean)) => {
      const next =
        typeof updater === "function" ? updater(preferences.daily.focusRailOpen) : updater;
      updatePreferences({ daily: { focusRailOpen: next } });
    },
    [preferences.daily.focusRailOpen, updatePreferences],
  );

  const setTodosExpanded = useCallback(
    (updater: boolean | ((prev: boolean) => boolean)) => {
      const next =
        typeof updater === "function" ? updater(preferences.daily.todosExpanded) : updater;
      updatePreferences({ daily: { todosExpanded: next } });
    },
    [preferences.daily.todosExpanded, updatePreferences],
  );

  const [streamCount, setStreamCount] = useState(3);
  const [focusRootId, setFocusRootId] = useState<OutlineNodeId | null>(null);
  const [highlightedNodeId, setHighlightedNodeId] = useState<OutlineNodeId | null>(
    focusNodeId ?? null,
  );
  const [extraRolloverDatesById, setExtraRolloverDatesById] = useState<Map<DocumentId, string>>(
    () => new Map(),
  );
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [dateDraft, setDateDraft] = useState(activeDate);
  const [dismissedRolloverDocIds, setDismissedRolloverDocIds] = useState<Set<DocumentId>>(
    () => new Set(),
  );
  const [dismissedTemplateDocIds, setDismissedTemplateDocIds] = useState<Set<DocumentId>>(
    () => new Set(),
  );
  const [dispatchTarget, setDispatchTarget] = useState<DispatchAdeTarget | null>(null);
  const [promoteTarget, setPromoteTarget] = useState<PromoteNodeTarget | null>(null);
  const [steeringDraftById, setSteeringDraftById] = useState<
    Readonly<Record<ThreadBindingId, string>>
  >({});
  const [steeringModeById, setSteeringModeById] = useState<
    Readonly<Record<ThreadBindingId, AgentSteeringMode>>
  >({});
  const [recentApprovalIds, setRecentApprovalIds] = useState<ReadonlySet<ThreadBindingId>>(
    () => new Set(),
  );
  const [serendipitySeedOffset, setSerendipitySeedOffset] = useState(0);
  const [quotingDocId, setQuotingDocId] = useState<DocumentId | null>(null);
  const [schedulePopoverTaskId, setSchedulePopoverTaskId] = useState<OutlineNodeId | null>(null);
  const autoAppliedDocsRef = useRef<Set<DocumentId>>(new Set());
  const streamSentinelRef = useRef<HTMLDivElement>(null);
  const serendipitySectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDateDraft(activeDate);
    setFocusRootId(null);
    setHighlightedNodeId(focusNodeId ?? null);
  }, [activeDate, focusNodeId]);

  const dailyQuery = useInkadeDailyOutline(activeDate);
  const spacesQuery = useInkadeSpaces();
  const summaryQuery = useInkadeWorkspaceSummary();
  const whoamiQuery = useInkadeWhoami();
  const templatesQuery = useInkadeTemplates("outline");
  const allDocsQuery = useInkadeDocuments({ limit: 300 });
  const outlineDocsQuery = useInkadeDocuments({ kind: "outline", limit: 90 });

  const dailyDoc = dailyQuery.data?.document ?? null;
  const nodes = useMemo(() => dailyQuery.data?.nodes ?? [], [dailyQuery.data?.nodes]);
  const activeNodes = useMemo(
    () => nodes.filter((n) => n.deletedAt === null),
    [nodes],
  );
  const spaces = spacesQuery.data ?? [];

  const workspaceTags = useMemo(
    () => (summaryQuery.data?.tags ?? []).map((item) => item.tag),
    [summaryQuery.data],
  );

  const rolloverDocDatesById = useMemo(() => {
    const map = new Map<DocumentId, string>();
    for (const d of outlineDocsQuery.data ?? []) {
      if (d.dailyDate) map.set(d.id, d.dailyDate);
    }
    for (const [k, v] of extraRolloverDatesById) {
      map.set(k, v);
    }
    return map;
  }, [outlineDocsQuery.data, extraRolloverDatesById]);

  const hostActionsRef = useRef(hostActions);
  hostActionsRef.current = hostActions;

  useEffect(() => {
    hostActionsRef.current.syncInspectorTarget?.({ document: dailyDoc, selectedNodeId: null });
  }, [dailyDoc]);

  useEffect(() => {
    return () => {
      hostActionsRef.current.syncInspectorTarget?.({ document: null, selectedNodeId: null });
    };
  }, []);

  const initialDailyMentionDocs = useMemo<readonly ComposerDocumentOption[]>(
    () =>
      dailyDoc
        ? [
            {
              id: dailyDoc.id,
              title: dailyDoc.title,
              kind: dailyDoc.kind,
              spaceId: dailyDoc.spaceId,
            },
          ]
        : [],
    [dailyDoc],
  );

  const openDispatch = useCallback(
    (target: DispatchAdeTarget) => {
      if (isReadOnly) return;
      dispatchOrOpenThreadDialog(hostActions, environment, target, setDispatchTarget);
    },
    [environment, hostActions, isReadOnly],
  );

  const openBindingTarget = useCallback(
    (binding: AdeThreadBinding) => {
      openBindingInHostOrTab(hostActions, environment, binding);
    },
    [environment, hostActions],
  );

  const bindingsQuery = useInkadeThreadBindings(
    dailyDoc?.id ? { documentId: dailyDoc.id } : {},
    { enabled: Boolean(dailyDoc?.id) },
  );
  const allBindingsQuery = useInkadeThreadBindings({});

  const defaultDailyTemplate = useMemo(
    () => (templatesQuery.data ?? []).find((tpl) => tpl.isDefaultDaily) ?? null,
    [templatesQuery.data],
  );

  const showManualTemplateOffer = useMemo(() => {
    if (!dailyDoc || !defaultDailyTemplate || dailyQuery.isPlaceholderData) return false;
    if (dailyQuery.data?.created) return false;
    if (activeNodes.length > 0) return false;
    if (dismissedTemplateDocIds.has(dailyDoc.id)) return false;
    try {
      return window.localStorage.getItem(`inkade:daily-tpl-applied:${dailyDoc.id}`) !== "1";
    } catch {
      return true;
    }
  }, [
    activeNodes.length,
    dailyDoc,
    dailyQuery.data?.created,
    dailyQuery.isPlaceholderData,
    defaultDailyTemplate,
    dismissedTemplateDocIds,
  ]);

  const prevOutlineDocId = useMemo(
    () => findPrevRolloverDocId(outlineDocsQuery.data ?? [], activeDate),
    [outlineDocsQuery.data, activeDate],
  );
  const prevNodesQuery = useInkadeOutlineNodes(prevOutlineDocId ?? undefined);

  const rolloverDismissed = useMemo(() => {
    if (!dailyDoc) return true;
    if (dismissedRolloverDocIds.has(dailyDoc.id)) return true;
    try {
      return window.localStorage.getItem(`inkade:rollover-dismissed:${dailyDoc.id}`) === "1";
    } catch {
      return false;
    }
  }, [dailyDoc, dismissedRolloverDocIds]);

  const rolloverTodos = useMemo(() => {
    if (rolloverDismissed || !prevOutlineDocId) return [];
    return (prevNodesQuery.data ?? []).filter(
      (n) => n.deletedAt === null && n.checked === false && !n.rolledOverToDocId,
    );
  }, [rolloverDismissed, prevOutlineDocId, prevNodesQuery.data]);

  const dismissRollover = useCallback((): void => {
    if (!dailyDoc) return;
    setDismissedRolloverDocIds((prev) => new Set(prev).add(dailyDoc.id));
    try {
      window.localStorage.setItem(`inkade:rollover-dismissed:${dailyDoc.id}`, "1");
    } catch {
      // ignore
    }
  }, [dailyDoc]);

  const docsById = useMemo(
    () => new Map((allDocsQuery.data ?? []).map((d) => [d.id, d])),
    [allDocsQuery.data],
  );

  const mutations = useDailyMutations({
    t,
    activeDate,
    dailyDoc,
    docsById,
    prevOutlineDocId,
    rolloverTodos,
    dismissRollover,
    quotingDocId,
    setQuotingDocId,
    setExtraRolloverDatesById,
    setSchedulePopoverTaskId,
    setRecentApprovalIds,
    setSteeringDraftById,
  });

  const { applyTemplateMutation } = mutations;

  useEffect(() => {
    if (!dailyQuery.data?.created || !dailyDoc || !defaultDailyTemplate) return;
    if (activeNodes.length > 0) return;
    if (autoAppliedDocsRef.current.has(dailyDoc.id)) return;
    try {
      if (window.localStorage.getItem(`inkade:daily-tpl-applied:${dailyDoc.id}`) === "1") {
        return;
      }
    } catch {
      // ignore
    }
    autoAppliedDocsRef.current.add(dailyDoc.id);
    applyTemplateMutation.mutate(defaultDailyTemplate.id);
  }, [
    activeNodes.length,
    applyTemplateMutation,
    dailyDoc,
    dailyQuery.data?.created,
    defaultDailyTemplate,
  ]);

  const goDate = useCallback(
    (targetDate: string): void => {
      navigation.openDaily(targetDate);
    },
    [navigation],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isImeEvent(event)) return;
      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        !event.altKey &&
        event.key.toLowerCase() === "b"
      ) {
        event.preventDefault();
        setFocusRailOpen((prev) => !prev);
        return;
      }
      if (isEditableEventTarget(event.target)) return;
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey) {
        if (event.key.toLowerCase() === "b") {
          event.preventDefault();
          setViewMode((prev) => (prev === "kanban" ? "outline" : "kanban"));
        }
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "[") {
        event.preventDefault();
        goDate(shiftDailyDate(activeDate, -1));
      } else if (event.key === "]") {
        event.preventDefault();
        goDate(shiftDailyDate(activeDate, 1));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    const onToggleFocusRail = (): void => {
      setFocusRailOpen((prev) => !prev);
    };
    window.addEventListener("inkade:toggle-daily-focus-rail", onToggleFocusRail);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("inkade:toggle-daily-focus-rail", onToggleFocusRail);
    };
  }, [activeDate, goDate, setFocusRailOpen, setViewMode]);

  const handleOpenDocument = useCallback(
    (docIdOrSlug: string): void => {
      const clean = docIdOrSlug.split("#")[0]?.trim().toLowerCase() ?? "";
      const matched = (allDocsQuery.data ?? []).find(
        (d) =>
          d.id.toLowerCase() === clean ||
          d.slug.toLowerCase() === clean ||
          d.title.toLowerCase() === clean,
      );
      if (matched) {
        navigation.openDocument(matched.id);
      } else {
        notifier.error(t("daily.docNotFound", { target: docIdOrSlug }));
      }
    },
    [allDocsQuery.data, navigation, notifier, t],
  );

  const handleClickTag = useCallback(
    (tag: string): void => {
      navigation.openLibrary({ tag });
    },
    [navigation],
  );

  const availableStreamDates = useMemo(() => {
    const existingDates = new Set<string>();
    for (const entry of summaryQuery.data?.dailyActivity ?? []) {
      if (entry.documentId && entry.date < activeDate) {
        existingDates.add(entry.date);
      }
    }
    for (const d of outlineDocsQuery.data ?? []) {
      if (d.trashedAt === null && d.dailyDate && d.dailyDate < activeDate) {
        existingDates.add(d.dailyDate);
      }
    }
    const sorted = [...existingDates].sort((a, b) => b.localeCompare(a));
    if (sorted.length > 0) return sorted;
    return Array.from({ length: 7 }, (_, i) => shiftDailyDate(activeDate, -(i + 1)));
  }, [activeDate, outlineDocsQuery.data, summaryQuery.data?.dailyActivity]);

  const visibleStreamDates = useMemo(
    () => availableStreamDates.slice(0, streamCount),
    [availableStreamDates, streamCount],
  );

  useEffect(() => {
    if (!streamMode || typeof IntersectionObserver === "undefined") return;
    const sentinel = streamSentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setStreamCount((prev) =>
            prev < availableStreamDates.length ? prev + 3 : prev,
          );
        }
      },
      { rootMargin: "160px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [availableStreamDates.length, streamMode]);

  const todayStr = getTodayDailyDate();
  const relBadge = getRelativeDailyBadge(activeDate, todayStr);
  const isToday = activeDate === todayStr;
  const reviewedAt = getDailyReviewedAt(dailyDoc);

  const weekDays = useMemo(
    () => getIsoWeekDays(activeDate, todayStr, locale),
    [activeDate, todayStr, locale],
  );

  const activeDayDatesSet = useMemo(() => {
    const set = new Set<string>();
    for (const entry of summaryQuery.data?.dailyActivity ?? []) {
      if (entry.documentId) set.add(entry.date);
    }
    for (const d of outlineDocsQuery.data ?? []) {
      if (d.trashedAt === null && d.dailyDate) set.add(d.dailyDate);
    }
    if (dailyDoc && activeNodes.length > 0) set.add(activeDate);
    return set;
  }, [
    summaryQuery.data?.dailyActivity,
    outlineDocsQuery.data,
    dailyDoc,
    activeNodes.length,
    activeDate,
  ]);

  const focusTasks = useMemo(
    () => activeNodes.filter((n) => n.checked !== null),
    [activeNodes],
  );

  const openFocusTasks = useMemo(
    () => activeNodes.filter((n) => n.checked === false),
    [activeNodes],
  );

  const pendingAdeBindings = useMemo(() => {
    return [...(allBindingsQuery.data ?? [])]
      .filter((b) => isPendingAdeStatus(b.status))
      .sort((a, b) => {
        const aCurrent = a.documentId === dailyDoc?.id ? 1 : 0;
        const bCurrent = b.documentId === dailyDoc?.id ? 1 : 0;
        if (aCurrent !== bCurrent) return bCurrent - aCurrent;
        return b.lastSyncedAt.localeCompare(a.lastSyncedAt);
      });
  }, [allBindingsQuery.data, dailyDoc?.id]);

  const createdTodayDocs = useMemo(
    () => filterDocumentsCreatedOnDate(allDocsQuery.data ?? [], activeDate, dailyDoc?.id),
    [allDocsQuery.data, activeDate, dailyDoc?.id],
  );

  const bindingsByNode = useMemo(() => {
    const map = new Map<OutlineNodeId, AdeThreadBinding[]>();
    for (const b of bindingsQuery.data ?? []) {
      if (!b.nodeId) continue;
      const list = map.get(b.nodeId);
      if (list) list.push(b);
      else map.set(b.nodeId, [b]);
    }
    return map;
  }, [bindingsQuery.data]);

  const allBindings = useMemo(() => allBindingsQuery.data ?? [], [allBindingsQuery.data]);
  const allConflicts = useMemo(() => detectBindingConflicts(allBindings), [allBindings]);

  const composerDocuments = useMemo((): ComposerDocumentOption[] => {
    return (allDocsQuery.data ?? [])
      .filter((doc) => doc.trashedAt === null)
      .map((doc) => ({
        id: doc.id,
        title: doc.title,
        kind: doc.kind,
        spaceId: doc.spaceId,
      }));
  }, [allDocsQuery.data]);

  const currentDocBindings = useMemo(() => bindingsQuery.data ?? [], [bindingsQuery.data]);

  const currentDocActiveStepBindings = useMemo(
    () =>
      currentDocBindings.filter(
        (b) => b.status === "running" || (b.progressSteps?.length ?? 0) > 0,
      ),
    [currentDocBindings],
  );

  const currentDocCitationCards = useMemo(() => {
    const docs = allDocsQuery.data ?? [];
    const entries: Array<{
      readonly bindingId: string;
      readonly answer: string;
      readonly citations: ReturnType<typeof extractCitationsFromSummary>;
    }> = [];
    for (const b of currentDocBindings) {
      if (!b.lastSummary) continue;
      const citations = extractCitationsFromSummary(b.lastSummary, docs);
      if (citations.length > 0) {
        entries.push({ bindingId: b.id, answer: b.lastSummary, citations });
      }
    }
    return entries;
  }, [currentDocBindings, allDocsQuery.data]);

  const pendingApprovalBindings = useMemo(
    () =>
      allBindings.filter(
        (b) =>
          b.pendingApproval &&
          ((b.status === "waiting_input" && !b.pendingApproval.decision) ||
            recentApprovalIds.has(b.id)),
      ),
    [allBindings, recentApprovalIds],
  );

  const unreadAgentDocsCount = useMemo(
    () =>
      (allDocsQuery.data ?? []).filter((d) => d.trashedAt === null && d.unreadAgentUpdate).length,
    [allDocsQuery.data],
  );

  const failedBindingsCount = useMemo(
    () => allBindings.filter((b) => b.status === "failed").length,
    [allBindings],
  );

  const quietTriageTotal =
    pendingApprovalBindings.length +
    unreadAgentDocsCount +
    allConflicts.length +
    failedBindingsCount;

  const dayTotalTasks = focusTasks.length;
  const dayDoneTasks = dayTotalTasks - openFocusTasks.length;

  const scheduledForDayQuery = useInkadeTasks({
    status: "open",
    scheduledDate: activeDate,
    limit: 100,
  });

  const externalScheduledTasks = useMemo(
    () =>
      (scheduledForDayQuery.data ?? []).filter(
        (item) =>
          item.node.checked === false &&
          dailyDoc !== null &&
          item.node.documentId !== dailyDoc.id,
      ),
    [dailyDoc, scheduledForDayQuery.data],
  );

  const focusRailTasks = useMemo<readonly DailyFocusRailTaskEntry[]>(() => {
    const localItems = openFocusTasks
      .filter((task) => !task.scheduledDate || task.scheduledDate === activeDate)
      .map((task) => ({
        node: task,
        isExternal: false,
        documentTitle: dailyDoc?.title ?? activeDate,
      }));
    const externalItems = externalScheduledTasks.map((item) => ({
      node: item.node,
      isExternal: true,
      documentTitle: item.document.title,
    }));
    return [...localItems, ...externalItems];
  }, [activeDate, dailyDoc?.title, externalScheduledTasks, openFocusTasks]);

  const scheduleBuckets = useMemo(() => {
    const buckets: Record<TaskScheduleSlot, DailyFocusRailTaskEntry[]> = {
      today: [],
      morning: [],
      afternoon: [],
      evening: [],
    };
    for (const entry of focusRailTasks) {
      const slot: TaskScheduleSlot = entry.node.scheduledSlot ?? "today";
      buckets[slot].push(entry);
    }
    return buckets;
  }, [focusRailTasks]);

  const totalPlannedMinutes = useMemo(
    () =>
      focusRailTasks.reduce(
        (sum, entry) => sum + (entry.node.durationMin ?? 0),
        0,
      ),
    [focusRailTasks],
  );

  const serendipityPicks = useMemo(
    () =>
      pickDailySerendipityDocs(allDocsQuery.data ?? [], {
        dateKey: activeDate,
        seedOffset: serendipitySeedOffset,
        limit: 3,
      }),
    [activeDate, allDocsQuery.data, serendipitySeedOffset],
  );

  useEffect(() => {
    const onOpenSerendipity = (): void => {
      setFocusRailOpen(true);
      window.requestAnimationFrame(() => {
        window.setTimeout(() => {
          serendipitySectionRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "nearest",
          });
        }, 60);
      });
    };
    window.addEventListener("inkade:open-daily-serendipity", onOpenSerendipity);
    return () => {
      window.removeEventListener("inkade:open-daily-serendipity", onOpenSerendipity);
    };
  }, [setFocusRailOpen]);

  return {
    t,
    locale,
    navigation,
    hostActions,
    isReadOnly,
    isCompact,
    activeDate,
    todayStr,
    relBadge,
    isToday,
    reviewedAt,
    updatePreferences,
    canvasWidth,
    readerMeasure,
    viewMode,
    setViewMode,
    kanbanGroupBy,
    setKanbanGroupBy,
    streamMode,
    setStreamMode,
    focusRailOpen,
    setFocusRailOpen,
    todosExpanded,
    setTodosExpanded,
    streamCount,
    setStreamCount,
    focusRootId,
    setFocusRootId,
    highlightedNodeId,
    setHighlightedNodeId,
    datePickerOpen,
    setDatePickerOpen,
    dateDraft,
    setDateDraft,
    setDismissedTemplateDocIds,
    dispatchTarget,
    setDispatchTarget,
    promoteTarget,
    setPromoteTarget,
    steeringDraftById,
    setSteeringDraftById,
    steeringModeById,
    setSteeringModeById,
    setSerendipitySeedOffset,
    quotingDocId,
    schedulePopoverTaskId,
    setSchedulePopoverTaskId,
    streamSentinelRef,
    serendipitySectionRef,
    dailyQuery,
    summaryQuery,
    whoamiQuery,
    allDocsQuery,
    allBindingsQuery,
    bindingsQuery,
    dailyDoc,
    nodes,
    activeNodes,
    spaces,
    workspaceTags,
    rolloverDocDatesById,
    initialDailyMentionDocs,
    defaultDailyTemplate,
    showManualTemplateOffer,
    rolloverTodos,
    dismissRollover,
    weekDays,
    activeDayDatesSet,
    focusTasks,
    openFocusTasks,
    pendingAdeBindings,
    createdTodayDocs,
    docsById,
    bindingsByNode,
    composerDocuments,
    currentDocActiveStepBindings,
    currentDocCitationCards,
    pendingApprovalBindings,
    unreadAgentDocsCount,
    allConflicts,
    failedBindingsCount,
    quietTriageTotal,
    dayTotalTasks,
    dayDoneTasks,
    externalScheduledTasks,
    focusRailTasks,
    scheduleBuckets,
    totalPlannedMinutes,
    serendipityPicks,
    goDate,
    openDispatch,
    openBindingTarget,
    handleOpenDocument,
    handleClickTag,
    availableStreamDates,
    visibleStreamDates,
    ...mutations,
  };
}

export type DailyWorkspaceState = ReturnType<typeof useDailyWorkspace>;
