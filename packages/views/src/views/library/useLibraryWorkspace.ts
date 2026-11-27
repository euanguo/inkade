import type {
  AdeThreadBinding,
  DocumentId,
  DocumentKind,
  DocumentSummary,
  LibrarySortField,
  LibraryViewMode,
  PropertyFieldDefinition,
  SavedViewDisplayMode,
  SavedViewFilter,
  SavedViewId,
  SavedViewSortRule,
  SortDirection,
  Space,
  SpaceId,
  SpacePropertySchema,
} from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import { inkadeQueryKeys } from "@inkade/sdk";
import {
  useInkadeClient,
  useInkadeSavedViews,
  useInkadeSpaces,
  useInkadeSpaceSchemas,
  useInkadeThreadBindings,
} from "@inkade/sdk/react";
import { INKADE_MEDIA_QUERIES, useResizablePane } from "@inkade/ui";
import { useInfiniteQuery } from "@tanstack/react-query";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEventListener, useMediaQuery } from "usehooks-ts";
import { useInkadeViewsContext } from "../../context.tsx";
import { useUserPreferences } from "../../lib/preferences-store.ts";
import { isEditableEventTarget, isImeEvent } from "../../lib/shortcuts.ts";
import { tagMatchesFilter } from "../../lib/super-command-parser.ts";
import { type DocumentSortField, sortDocuments } from "../../lib/typed-properties.ts";
import {
  type DocumentListViewProps,
  isEmptyDailyDocument,
  LIBRARY_PAGE_SIZE,
  type LibraryDisplayOptions,
} from "./types.ts";
import { useLibraryMutations } from "./useLibraryMutations.ts";

export interface UseLibraryWorkspaceOptions extends DocumentListViewProps {
  readonly scrollToDocIdRef: React.MutableRefObject<((docId: DocumentId) => void) | null>;
}

export function useLibraryWorkspace({
  spaceId,
  initialSpaceId,
  initialTag,
  initialKind,
  initialPinnedOnly,
  initialUnreadOnly,
  activeViewId,
  readonly: readonlyProp,
  urlState,
  onUrlStateChange,
  onSelectDocument,
  scrollToDocIdRef,
}: UseLibraryWorkspaceOptions) {
  const { t } = useInkadeTranslation();
  const client = useInkadeClient();
  const { navigation, hostActions, environment } = useInkadeViewsContext();
  const { preferences: globalPrefs, updatePreferences } = useUserPreferences();
  const canvasWidth = globalPrefs.layout.workspaceCanvasWidth;
  const isReadOnly = readonlyProp ?? environment.readonly ?? false;
  const isMdUp = useMediaQuery(INKADE_MEDIA_QUERIES.min768);
  const isLgUp = useMediaQuery(INKADE_MEDIA_QUERIES.lg);

  const [savedViewOverrides, setSavedViewOverrides] = useState<{
    readonly viewMode?: LibraryViewMode | undefined;
    readonly sortBy?: DocumentSortField | undefined;
    readonly sortDir?: SortDirection | undefined;
  } | null>(null);
  const [boardGroupByField, setBoardGroupByField] = useState<string | null>(null);
  const [tableVisibleColumns, setTableVisibleColumns] = useState<readonly string[] | null>(null);
  const [tableColumnWidths, setTableColumnWidths] = useState<Readonly<Record<string, number>> | null>(
    null,
  );
  const [tableSortRules, setTableSortRules] = useState<readonly SavedViewSortRule[] | null>(null);

  const isSavedViewSession = Boolean(activeViewId);
  const viewMode: LibraryViewMode =
    (isSavedViewSession ? savedViewOverrides?.viewMode : urlState?.view) ??
    globalPrefs.library.viewMode;
  const displayOptions: LibraryDisplayOptions = globalPrefs.library.displayOptions;
  const [displayPopoverOpen, setDisplayPopoverOpen] = useState(false);
  const sortBy: DocumentSortField =
    (isSavedViewSession ? savedViewOverrides?.sortBy : urlState?.sort) ??
    globalPrefs.library.sortBy;
  const sortDir: SortDirection =
    (isSavedViewSession ? savedViewOverrides?.sortDir : urlState?.dir) ??
    globalPrefs.library.sortDir;

  const setViewMode = useCallback(
    (next: LibraryViewMode) => {
      if (isSavedViewSession) {
        setSavedViewOverrides((prev) => ({ ...prev, viewMode: next }));
        return;
      }
      updatePreferences({ library: { viewMode: next } });
      onUrlStateChange?.({ view: next });
    },
    [isSavedViewSession, onUrlStateChange, updatePreferences],
  );

  const setSortBy = useCallback(
    (next: DocumentSortField) => {
      if (isSavedViewSession) {
        setSavedViewOverrides((prev) => ({ ...prev, sortBy: next }));
        return;
      }
      updatePreferences({ library: { sortBy: next } });
      onUrlStateChange?.({ sort: next });
    },
    [isSavedViewSession, onUrlStateChange, updatePreferences],
  );

  const setSortDir = useCallback(
    (updater: SortDirection | ((prev: SortDirection) => SortDirection)) => {
      const next = typeof updater === "function" ? updater(sortDir) : updater;
      if (isSavedViewSession) {
        setSavedViewOverrides((prev) => ({ ...prev, sortDir: next }));
        return;
      }
      updatePreferences({ library: { sortDir: next } });
      onUrlStateChange?.({ dir: next });
    },
    [isSavedViewSession, onUrlStateChange, sortDir, updatePreferences],
  );

  const [selectedDocId, setSelectedDocIdState] = useState<DocumentId | null>(
    () => urlState?.doc ?? null,
  );
  const setSelectedDocId = useCallback(
    (next: DocumentId | null) => {
      setSelectedDocIdState(next);
      onUrlStateChange?.({ doc: next ?? undefined });
    },
    [onUrlStateChange],
  );

  const [activeCursorDocId, setActiveCursorDocId] = useState<DocumentId | null>(null);
  const [selectedDocIds, setSelectedDocIds] = useState<ReadonlySet<DocumentId>>(() => new Set());
  const [bulkTagPopoverOpen, setBulkTagPopoverOpen] = useState(false);
  const [bulkTagDraft, setBulkTagDraft] = useState("");
  const [openTagEditorDocId, setOpenTagEditorDocId] = useState<DocumentId | null>(null);
  const [inlineTagDraft, setInlineTagDraft] = useState("");
  const [openPriorityEditorDocId, setOpenPriorityEditorDocId] = useState<DocumentId | null>(null);
  const [studioDocId, setStudioDocId] = useState<DocumentId | null>(null);
  const [splitDocId, setSplitDocId] = useState<DocumentId | null>(null);
  const [kindFilter, setKindFilterState] = useState<"all" | DocumentKind>(
    () => initialKind ?? urlState?.kind ?? "all",
  );
  const setKindFilter = useCallback(
    (next: "all" | DocumentKind) => {
      setKindFilterState(next);
      onUrlStateChange?.({ kind: next === "all" ? undefined : next });
    },
    [onUrlStateChange],
  );
  const [searchText, setSearchTextState] = useState<string>(() => urlState?.q ?? "");
  const setSearchText = useCallback(
    (next: string) => {
      setSearchTextState(next);
      onUrlStateChange?.({ q: next.trim() ? next : undefined });
    },
    [onUrlStateChange],
  );
  const [tagFilter, setTagFilter] = useState<string | null>(initialTag ?? null);
  const [spaceFilterId, setSpaceFilterId] = useState<SpaceId | undefined>(
    spaceId ?? initialSpaceId,
  );
  const [pinnedOnly, setPinnedOnly] = useState(Boolean(initialPinnedOnly));
  const [unreadOnly, setUnreadOnly] = useState(Boolean(initialUnreadOnly));
  const lastAppliedViewRef = useRef<SavedViewId | null>(null);
  const itemRefs = useRef<Map<DocumentId, HTMLElement>>(new Map());

  const listPane = useResizablePane({
    storageKey: "inkade:pane:library-list",
    defaultWidth: 336,
    minWidth: 260,
    maxWidth: 460,
    side: "left",
  });

  const kindLabels: Readonly<Record<DocumentKind, string>> = {
    outline: t("common.kindOutline"),
    article: t("common.kindArticle"),
    clip: t("common.kindClip"),
  };

  useEffect(() => {
    setTagFilter(initialTag ?? null);
  }, [initialTag]);

  useEffect(() => {
    setKindFilterState(initialKind ?? urlState?.kind ?? "all");
  }, [initialKind, urlState?.kind]);

  const prevUrlQRef = useRef(urlState?.q);
  useEffect(() => {
    if (activeViewId) return;
    if (prevUrlQRef.current === urlState?.q) return;
    prevUrlQRef.current = urlState?.q;
    setSearchTextState(urlState?.q ?? "");
  }, [activeViewId, urlState?.q]);

  const prevUrlDocRef = useRef(urlState?.doc);
  useEffect(() => {
    if (prevUrlDocRef.current === urlState?.doc) return;
    prevUrlDocRef.current = urlState?.doc;
    if (urlState?.doc) {
      setSelectedDocIdState(urlState.doc);
    }
  }, [urlState?.doc]);

  useEffect(() => {
    setSpaceFilterId(spaceId ?? initialSpaceId);
  }, [spaceId, initialSpaceId]);

  useEffect(() => {
    setPinnedOnly(Boolean(initialPinnedOnly));
  }, [initialPinnedOnly]);

  useEffect(() => {
    setUnreadOnly(Boolean(initialUnreadOnly));
  }, [initialUnreadOnly]);

  const updateDisplayOptions = useCallback(
    (patch: Partial<LibraryDisplayOptions>) => {
      const next = { ...displayOptions, ...patch };
      updatePreferences({ library: { displayOptions: next } });
    },
    [displayOptions, updatePreferences],
  );

  const spacesQuery = useInkadeSpaces();
  const spaceSchemasQuery = useInkadeSpaceSchemas();

  const docsQuery = useInfiniteQuery({
    queryKey: [...inkadeQueryKeys.documents(), "infinite"] as const,
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      client.documents.list({
        limit: LIBRARY_PAGE_SIZE,
        offset: pageParam,
      }),
    getNextPageParam: (lastPage, allPages) => {
      if (lastPage.length < LIBRARY_PAGE_SIZE) return undefined;
      return allPages.reduce((sum, page) => sum + page.length, 0);
    },
  });

  const bindingsQuery = useInkadeThreadBindings({});

  const savedViewsQuery = useInkadeSavedViews({
    enabled: Boolean(activeViewId),
  });

  const spaces = useMemo(() => spacesQuery.data ?? [], [spacesQuery.data]);
  const activeSpaces = useMemo(
    () => spaces.filter((s) => s.archivedAt === null),
    [spaces],
  );

  const allDocs = useMemo(() => {
    const pages = docsQuery.data?.pages ?? [];
    const deduped = new Map<DocumentId, DocumentSummary>();
    for (const page of pages) {
      for (const doc of page) {
        if (!deduped.has(doc.id)) {
          deduped.set(doc.id, doc);
        }
      }
    }
    return [...deduped.values()];
  }, [docsQuery.data]);

  const bindingsByDocId = useMemo(() => {
    const map = new Map<DocumentId, AdeThreadBinding[]>();
    for (const binding of bindingsQuery.data ?? []) {
      const existing = map.get(binding.documentId);
      if (existing) {
        existing.push(binding);
      } else {
        map.set(binding.documentId, [binding]);
      }
    }
    return map;
  }, [bindingsQuery.data]);

  const activeSavedView = useMemo(
    () =>
      activeViewId
        ? ((savedViewsQuery.data ?? []).find((v) => v.id === activeViewId) ?? null)
        : null,
    [activeViewId, savedViewsQuery.data],
  );

  useEffect(() => {
    if (!activeViewId) {
      lastAppliedViewRef.current = null;
      setSavedViewOverrides(null);
      setBoardGroupByField(null);
      setTableVisibleColumns(null);
      setTableColumnWidths(null);
      setTableSortRules(null);
      return;
    }
    if (!activeSavedView) return;
    if (lastAppliedViewRef.current === activeSavedView.id) return;
    lastAppliedViewRef.current = activeSavedView.id;

    const filter = activeSavedView.filter;
    const nextOverrides: {
      viewMode?: LibraryViewMode | undefined;
      sortBy?: DocumentSortField | undefined;
      sortDir?: SortDirection | undefined;
    } = {};
    const resolvedViewMode = filter.viewMode ?? activeSavedView.displayMode;
    if (
      resolvedViewMode === "list" ||
      resolvedViewMode === "grid" ||
      resolvedViewMode === "table" ||
      resolvedViewMode === "board"
    ) {
      nextOverrides.viewMode = resolvedViewMode;
      setStudioDocId(null);
    }
    if (
      filter.sortBy === "updatedAt" ||
      filter.sortBy === "createdAt" ||
      filter.sortBy === "title" ||
      filter.sortBy === "kind"
    ) {
      nextOverrides.sortBy = filter.sortBy;
    }
    if (filter.sortDir === "asc" || filter.sortDir === "desc") {
      nextOverrides.sortDir = filter.sortDir;
    }
    setSavedViewOverrides(nextOverrides);
    setBoardGroupByField(activeSavedView.groupByField ?? null);
    setTableVisibleColumns(activeSavedView.visibleColumns ?? null);
    setTableColumnWidths(activeSavedView.columnWidths ?? null);
    setTableSortRules(activeSavedView.sortRules ?? null);
    if (typeof filter.query === "string") {
      setSearchTextState(filter.query);
    }
  }, [activeViewId, activeSavedView]);

  const activeSpace = useMemo(
    () => (spaceFilterId ? (spaces.find((s) => s.id === spaceFilterId) ?? null) : null),
    [spaceFilterId, spaces],
  );

  const spaceSchemas = useMemo(
    () => spaceSchemasQuery.data ?? ([] as readonly SpacePropertySchema[]),
    [spaceSchemasQuery.data],
  );

  const schemaBySpaceId = useMemo(() => {
    const map = new Map<SpaceId, SpacePropertySchema>();
    for (const s of spaceSchemas) {
      if (s.spaceId) map.set(s.spaceId, s);
    }
    return map;
  }, [spaceSchemas]);

  const activeSchemaFields = useMemo<readonly PropertyFieldDefinition[]>(() => {
    const targetSpaceId = spaceFilterId ?? activeSavedView?.filter.spaceId;
    if (targetSpaceId) {
      return schemaBySpaceId.get(targetSpaceId)?.fields ?? [];
    }
    return [];
  }, [activeSavedView?.filter.spaceId, schemaBySpaceId, spaceFilterId]);

  const allSchemaFields = useMemo<readonly PropertyFieldDefinition[]>(() => {
    const seen = new Set<string>();
    const out: PropertyFieldDefinition[] = [];
    for (const schema of spaceSchemas) {
      if (!schema.spaceId) continue;
      for (const field of schema.fields) {
        if (seen.has(field.key)) continue;
        seen.add(field.key);
        out.push(field);
      }
    }
    return out;
  }, [spaceSchemas]);

  const spaceById = useMemo(
    () => new Map<SpaceId, Space>(spaces.map((s) => [s.id, s])),
    [spaces],
  );

  const spaceNameById = useMemo(
    () => new Map<SpaceId, string>(spaces.map((s) => [s.id, s.name])),
    [spaces],
  );

  const matchingSpaceIds = useMemo(() => {
    if (!spaceFilterId) return null;
    const result = new Set<SpaceId>([spaceFilterId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const s of spaces) {
        if (s.parentId && result.has(s.parentId) && !result.has(s.id)) {
          result.add(s.id);
          changed = true;
        }
      }
    }
    return result;
  }, [spaceFilterId, spaces]);

  const allWorkspaceTags = useMemo(() => {
    const unique = new Set<string>();
    for (const d of allDocs) {
      if (d.trashedAt !== null) continue;
      for (const tag of d.tags) {
        if (tag.trim()) unique.add(tag);
      }
    }
    return [...unique].sort((a, b) => a.localeCompare(b));
  }, [allDocs]);

  const { filteredDocs, hiddenEmptyDailyCount, hasEmptyDailyDocs } = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    const baseMatched = allDocs
      .filter((d) => d.trashedAt === null)
      .filter((d) => (!matchingSpaceIds ? true : matchingSpaceIds.has(d.spaceId)))
      .filter((d) => (kindFilter === "all" ? true : d.kind === kindFilter))
      .filter((d) => (!tagFilter ? true : d.tags.some((tItem) => tagMatchesFilter(tItem, tagFilter))))
      .filter((d) => (!pinnedOnly ? true : d.pinned))
      .filter((d) => (!unreadOnly ? true : d.unreadAgentUpdate))
      .filter((d) => {
        if (!q) return true;
        return (
          d.title.toLowerCase().includes(q) ||
          d.excerpt.toLowerCase().includes(q) ||
          d.tags.some((tag) => tag.toLowerCase().includes(q))
        );
      });

    let emptyCount = 0;
    let anyEmpty = false;
    const shouldHideEmptyDailies =
      !displayOptions.showEmptyDailies && !q && !pinnedOnly && !unreadOnly && !tagFilter;

    const visibleMatched = baseMatched.filter((d) => {
      const empty = isEmptyDailyDocument(d);
      if (empty) anyEmpty = true;
      if (shouldHideEmptyDailies && empty) {
        emptyCount += 1;
        return false;
      }
      return true;
    });

    return {
      filteredDocs: sortDocuments(visibleMatched, sortBy, sortDir, {
        pinnedFirst: sortBy === "updatedAt",
        spaceNameById,
      }),
      hiddenEmptyDailyCount: emptyCount,
      hasEmptyDailyDocs: anyEmpty,
    };
  }, [
    allDocs,
    displayOptions.showEmptyDailies,
    matchingSpaceIds,
    kindFilter,
    tagFilter,
    pinnedOnly,
    unreadOnly,
    searchText,
    sortBy,
    sortDir,
    spaceNameById,
  ]);

  useEffect(() => {
    if (filteredDocs.length === 0) {
      setSelectedDocIdState(null);
      setStudioDocId(null);
      setActiveCursorDocId(null);
      return;
    }
    if (viewMode === "list") {
      if (!selectedDocId || !filteredDocs.some((d) => d.id === selectedDocId)) {
        if (typeof window !== "undefined" && window.innerWidth >= 768) {
          setSelectedDocIdState(filteredDocs[0]?.id ?? null);
        }
      }
    } else {
      if (!activeCursorDocId || !filteredDocs.some((d) => d.id === activeCursorDocId)) {
        setActiveCursorDocId(filteredDocs[0]?.id ?? null);
      }
      if (studioDocId && !filteredDocs.some((d) => d.id === studioDocId)) {
        setStudioDocId(null);
      }
    }
  }, [activeCursorDocId, filteredDocs, selectedDocId, studioDocId, viewMode]);

  const selectedDocs = useMemo(
    () => allDocs.filter((d) => d.trashedAt === null && selectedDocIds.has(d.id)),
    [allDocs, selectedDocIds],
  );

  const toggleDocSelection = useCallback((docId: DocumentId) => {
    setSelectedDocIds((prev) => {
      const next = new Set(prev);
      if (next.has(docId)) {
        next.delete(docId);
      } else {
        next.add(docId);
      }
      return next;
    });
  }, []);

  const toggleSelectAllVisible = useCallback(() => {
    setSelectedDocIds((prev) => {
      const visibleIds = filteredDocs.map((d) => d.id);
      if (visibleIds.length === 0) return prev;
      const allSelected = visibleIds.every((id) => prev.has(id));
      if (allSelected) {
        return new Set();
      }
      return new Set(visibleIds);
    });
  }, [filteredDocs]);

  const hasExtraFilters = Boolean(
    tagFilter || pinnedOnly || unreadOnly || activeSavedView || (!spaceId && spaceFilterId),
  );

  const persistableSortBy: LibrarySortField | undefined =
    sortBy === "space" ? undefined : sortBy;

  const currentViewFilterSnapshot = useMemo<SavedViewFilter>(() => {
    const cleanQuery = searchText.trim();
    return {
      ...(spaceFilterId ? { spaceId: spaceFilterId } : {}),
      ...(kindFilter !== "all" ? { kind: kindFilter } : {}),
      ...(tagFilter ? { tag: tagFilter } : {}),
      ...(pinnedOnly ? { pinnedOnly: true } : {}),
      ...(unreadOnly ? { unreadOnly: true } : {}),
      ...(cleanQuery ? { query: cleanQuery } : {}),
      viewMode,
      ...(persistableSortBy ? { sortBy: persistableSortBy } : {}),
      sortDir,
    };
  }, [
    spaceFilterId,
    kindFilter,
    tagFilter,
    pinnedOnly,
    unreadOnly,
    searchText,
    viewMode,
    persistableSortBy,
    sortDir,
  ]);

  const currentDisplayMode: SavedViewDisplayMode =
    viewMode === "table" || viewMode === "board" ? viewMode : "grid";

  const isSavedViewModified = useMemo(() => {
    if (!activeSavedView) return false;
    const saved = activeSavedView.filter;
    return (
      (saved.spaceId ?? undefined) !== currentViewFilterSnapshot.spaceId ||
      (saved.kind ?? undefined) !== currentViewFilterSnapshot.kind ||
      (saved.tag ?? undefined) !== currentViewFilterSnapshot.tag ||
      Boolean(saved.pinnedOnly) !== Boolean(currentViewFilterSnapshot.pinnedOnly) ||
      Boolean(saved.unreadOnly) !== Boolean(currentViewFilterSnapshot.unreadOnly) ||
      (saved.query ?? undefined) !== currentViewFilterSnapshot.query ||
      saved.viewMode !== currentViewFilterSnapshot.viewMode ||
      saved.sortBy !== currentViewFilterSnapshot.sortBy ||
      saved.sortDir !== currentViewFilterSnapshot.sortDir ||
      activeSavedView.displayMode !== currentDisplayMode ||
      (activeSavedView.groupByField ?? null) !== boardGroupByField ||
      JSON.stringify(activeSavedView.visibleColumns ?? null) !==
        JSON.stringify(tableVisibleColumns) ||
      JSON.stringify(activeSavedView.columnWidths ?? null) !== JSON.stringify(tableColumnWidths) ||
      JSON.stringify(activeSavedView.sortRules ?? null) !== JSON.stringify(tableSortRules)
    );
  }, [
    activeSavedView,
    boardGroupByField,
    currentDisplayMode,
    currentViewFilterSnapshot,
    tableColumnWidths,
    tableSortRules,
    tableVisibleColumns,
  ]);

  const clearSelection = useCallback(() => setSelectedDocIds(new Set()), []);
  const clearSelectedDoc = useCallback(() => setSelectedDocId(null), [setSelectedDocId]);
  const clearStudioDoc = useCallback(() => setStudioDocId(null), []);
  const clearPriorityEditor = useCallback(() => setOpenPriorityEditorDocId(null), []);
  const handleBulkTagApplied = useCallback(() => {
    setBulkTagDraft("");
    setBulkTagPopoverOpen(false);
  }, []);

  const mutations = useLibraryMutations({
    t,
    activeSavedView,
    currentViewFilterSnapshot,
    currentDisplayMode,
    currentGroupByField: boardGroupByField,
    currentVisibleColumns: tableVisibleColumns,
    currentColumnWidths: tableColumnWidths,
    currentSortRules: tableSortRules,
    selectedDocs,
    selectedDocId,
    studioDocId,
    onClearSelection: clearSelection,
    onClearSelectedDoc: clearSelectedDoc,
    onClearStudioDoc: clearStudioDoc,
    onClearPriorityEditor: clearPriorityEditor,
    onBulkTagApplied: handleBulkTagApplied,
  });

  const handleViewModeChange = (next: LibraryViewMode): void => {
    setViewMode(next);
    if (next !== "list") {
      setStudioDocId(null);
    }
  };

  const applyLibrarySort = useCallback(
    (field: DocumentSortField, dir: SortDirection): void => {
      if (isSavedViewSession) {
        setSavedViewOverrides((prev) => ({ ...prev, sortBy: field, sortDir: dir }));
        return;
      }
      updatePreferences({ library: { sortBy: field, sortDir: dir } });
      onUrlStateChange?.({ sort: field, dir });
    },
    [isSavedViewSession, onUrlStateChange, updatePreferences],
  );

  const handleToggleColumnSort = (field: DocumentSortField): void => {
    if (sortBy === field) {
      applyLibrarySort(field, sortDir === "asc" ? "desc" : "asc");
      return;
    }
    const defaultDir: SortDirection =
      field === "title" || field === "kind" || field === "space" ? "asc" : "desc";
    applyLibrarySort(field, defaultDir);
  };

  const handleOpenStudioDoc = useCallback(
    (doc: DocumentSummary, event?: React.MouseEvent<HTMLElement>): void => {
      if (event && (event.metaKey || event.ctrlKey) && isLgUp) {
        if (selectedDocId && selectedDocId !== doc.id) {
          setStudioDocId(selectedDocId);
          setSplitDocId(doc.id);
          return;
        }
        hostActions.requestOpenSplitDoc?.(doc.id);
      }
      setSelectedDocId(doc.id);
      setActiveCursorDocId(doc.id);
      if (onSelectDocument) {
        onSelectDocument(doc);
        return;
      }
      setStudioDocId(doc.id);
    },
    [hostActions, isLgUp, onSelectDocument, selectedDocId, setSelectedDocId],
  );

  const handleSplitFromStudio = (doc: DocumentSummary): void => {
    if (selectedDocId && selectedDocId !== doc.id) {
      setStudioDocId(selectedDocId);
      setSplitDocId(doc.id);
      return;
    }
    hostActions.requestOpenSplitDoc?.(doc.id);
    setSelectedDocId(doc.id);
    setStudioDocId(doc.id);
  };

  const handleResetFilters = (): void => {
    setTagFilter(null);
    setPinnedOnly(false);
    setUnreadOnly(false);
    setKindFilter("all");
    setSearchText("");
    if (!spaceId) {
      setSpaceFilterId(undefined);
      navigation.openLibrary();
    }
  };

  const handleListKeyDown = useCallback(
    (event: KeyboardEvent): void => {
      if (
        isImeEvent(event) ||
        isEditableEventTarget(event.target) ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        studioDocId !== null
      ) {
        return;
      }
      const targetEl = event.target as HTMLElement | null;
      if (targetEl?.closest('[role="dialog"], [role="menu"]')) {
        return;
      }

      if (event.key === "Escape") {
        if (bulkTagPopoverOpen) {
          setBulkTagPopoverOpen(false);
          return;
        }
        if (displayPopoverOpen) {
          setDisplayPopoverOpen(false);
          return;
        }
        if (selectedDocIds.size > 0) {
          setSelectedDocIds(new Set());
        }
        return;
      }

      const lower = event.key.toLowerCase();
      if (event.shiftKey && lower === "v") {
        event.preventDefault();
        setDisplayPopoverOpen((prev) => !prev);
        return;
      }

      if (event.shiftKey || displayPopoverOpen || bulkTagPopoverOpen || filteredDocs.length === 0) {
        return;
      }

      const currentCursorId = viewMode === "list" ? selectedDocId : activeCursorDocId;
      const currentIdx = currentCursorId
        ? filteredDocs.findIndex((d) => d.id === currentCursorId)
        : -1;

      if (lower === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        const nextIdx = Math.min(filteredDocs.length - 1, currentIdx < 0 ? 0 : currentIdx + 1);
        const nextDoc = filteredDocs[nextIdx];
        if (nextDoc) {
          if (viewMode === "list") {
            setSelectedDocId(nextDoc.id);
          } else {
            setActiveCursorDocId(nextDoc.id);
          }
          if (scrollToDocIdRef.current) {
            scrollToDocIdRef.current(nextDoc.id);
          } else {
            itemRefs.current.get(nextDoc.id)?.scrollIntoView({ block: "nearest" });
          }
        }
        return;
      }

      if (lower === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        const nextIdx = Math.max(0, currentIdx < 0 ? 0 : currentIdx - 1);
        const nextDoc = filteredDocs[nextIdx];
        if (nextDoc) {
          if (viewMode === "list") {
            setSelectedDocId(nextDoc.id);
          } else {
            setActiveCursorDocId(nextDoc.id);
          }
          if (scrollToDocIdRef.current) {
            scrollToDocIdRef.current(nextDoc.id);
          } else {
            itemRefs.current.get(nextDoc.id)?.scrollIntoView({ block: "nearest" });
          }
        }
        return;
      }

      const activeDoc = filteredDocs[Math.max(0, currentIdx)];
      if (!activeDoc) return;

      if (lower === "x") {
        event.preventDefault();
        toggleDocSelection(activeDoc.id);
      } else if (event.key === "Enter" && viewMode !== "list") {
        event.preventDefault();
        handleOpenStudioDoc(activeDoc);
      }
    },
    [
      activeCursorDocId,
      bulkTagPopoverOpen,
      displayPopoverOpen,
      filteredDocs,
      handleOpenStudioDoc,
      scrollToDocIdRef,
      selectedDocId,
      selectedDocIds.size,
      setSelectedDocId,
      studioDocId,
      toggleDocSelection,
      viewMode,
    ],
  );

  useEventListener("keydown", handleListKeyDown);

  const showEmptyDailiesPill =
    hiddenEmptyDailyCount > 0 || (displayOptions.showEmptyDailies && hasEmptyDailyDocs);
  const isCompact = displayOptions.density === "compact";

  return {
    t,
    navigation,
    hostActions,
    canvasWidth,
    updatePreferences,
    isReadOnly,
    isMdUp,
    isLgUp,
    viewMode,
    displayOptions,
    displayPopoverOpen,
    setDisplayPopoverOpen,
    sortBy,
    setSortBy,
    sortDir,
    setSortDir,
    selectedDocId,
    setSelectedDocId,
    activeCursorDocId,
    selectedDocIds,
    setSelectedDocIds,
    bulkTagPopoverOpen,
    setBulkTagPopoverOpen,
    bulkTagDraft,
    setBulkTagDraft,
    openTagEditorDocId,
    setOpenTagEditorDocId,
    inlineTagDraft,
    setInlineTagDraft,
    openPriorityEditorDocId,
    setOpenPriorityEditorDocId,
    studioDocId,
    setStudioDocId,
    splitDocId,
    setSplitDocId,
    kindFilter,
    setKindFilter,
    searchText,
    setSearchText,
    tagFilter,
    setTagFilter,
    pinnedOnly,
    unreadOnly,
    itemRefs,
    listPane,
    kindLabels,
    updateDisplayOptions,
    docsQuery,
    spaces,
    activeSpaces,
    allDocs,
    bindingsByDocId,
    activeSavedView,
    activeSpace,
    spaceSchemas,
    schemaBySpaceId,
    activeSchemaFields,
    allSchemaFields,
    boardGroupByField,
    setBoardGroupByField,
    tableVisibleColumns,
    setTableVisibleColumns,
    tableColumnWidths,
    setTableColumnWidths,
    tableSortRules,
    setTableSortRules,
    currentViewFilterSnapshot,
    spaceById,
    allWorkspaceTags,
    filteredDocs,
    hiddenEmptyDailyCount,
    selectedDocs,
    toggleDocSelection,
    toggleSelectAllVisible,
    hasExtraFilters,
    isSavedViewModified,
    showEmptyDailiesPill,
    isCompact,
    onSelectDocument,
    handleViewModeChange,
    applyLibrarySort,
    handleToggleColumnSort,
    handleOpenStudioDoc,
    handleSplitFromStudio,
    handleResetFilters,
    ...mutations,
  };
}

export type LibraryWorkspaceState = ReturnType<typeof useLibraryWorkspace>;
