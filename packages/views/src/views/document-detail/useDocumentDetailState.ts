import { zodResolver } from "@hookform/resolvers/zod";
import {
  buildOutlineBlockDeepLink,
  INTERNAL_HIDDEN_PROPERTY_KEYS,
  parseOutlineBlockDeepLink,
  parsePdfCitationUri,
  type AdeThreadBinding,
  type AuditBatchId,
  type BatchRollbackConflict,
  type CreatePdfAnnotationInput,
  computeRevisionDiff,
  type DocumentId,
  type DocumentRecord,
  type HighlightComment,
  type HighlightId,
  type OutlineNode,
  type OutlineNodeId,
  stripLeadingDuplicateTitle,
  type TocEntry,
  type UpdateViewerContextInput,
} from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import { InkadeApiError, inkadeQueryKeys } from "@inkade/sdk";
import {
  useInkadeBridgeSessions,
  useInkadeClient,
  useInkadeCommentThreads,
  useInkadeDailyOutline,
  useInkadeDocument,
  useInkadeDocuments,
  useInkadeHighlights,
  useInkadeOutlineNodes,
  useInkadeRevisionDiff,
  useInkadeRevisions,
  useInkadeShareLinks,
  useInkadeSpaces,
  useInkadeSpaceSchema,
  useInkadeTemplates,
  useInkadeThreadBindings,
} from "@inkade/sdk/react";
import {
  type ArticleEditorHandle,
  INKADE_MEDIA_QUERIES,
  type MarginaliaAnchorPosition,
  type MarginaliaStatusFilter,
  useResizablePane,
  type WorkspaceOutlineSearchMatch,
} from "@inkade/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useForm } from "react-hook-form";
import { useDebounceCallback, useEventListener, useMediaQuery } from "usehooks-ts";
import { tinykeys } from "tinykeys";
import { z } from "zod";
import type { DispatchAdeTarget } from "../../components/DispatchAdeDialog.tsx";
import type { InlineDocumentTitleHandle } from "../../components/InlineDocumentTitle.tsx";
import {
  dispatchOrOpenThreadDialog,
  openBindingInHostOrTab,
  useInkadeViewsContext,
  useViewsNavigationBlocker,
} from "../../context.tsx";
import {
  computeDocumentReadingStats,
  extractDocumentHeadings,
} from "../../lib/daily-studio.ts";
import { getTodayDailyDate } from "../../lib/dates.ts";
import {
  usePreferencesStore,
  useReaderTypography,
  useResolvedColorScheme,
  useUserPreferences,
  useYjsOfflineEnabled,
} from "../../lib/preferences-store.ts";
import { isEditableEventTarget, isImeEvent } from "../../lib/shortcuts.ts";
import { getPropertyPresets } from "../../lib/typed-properties.ts";
import { useWorkspaceTabsStore } from "../../lib/workspace-tabs-store.ts";
import {
  createActiveHeadingStore,
  type DocumentDetailViewProps,
  EMPTY_DOCS,
  EMPTY_HIGHLIGHTS,
  EMPTY_SPACES,
  scrollContainerToElement,
  type SplitMode,
} from "./types.ts";
import { useDocumentDetailMutations } from "./useDocumentDetailMutations.ts";

export function useDocumentDetailState({
  documentId,
  mode,
  focusNodeId,
  focusHeading,
  focusHighlightId,
  focusPage,
  focusAnnotationId,
  readonly: readonlyProp,
  hideHeaderActions = false,
  spaces: spacesProp,
  workspaceDocs: workspaceDocsProp,
  externalSplitDocId,
  onExternalSplitClear,
}: DocumentDetailViewProps) {
  const { t } = useInkadeTranslation();
  const client = useInkadeClient();
  const { navigation, hostActions, notifier, environment } = useInkadeViewsContext();
  const isReadOnly = readonlyProp ?? environment.readonly ?? false;
  const inspectorOpen = environment.inspectorOpen ?? false;
  const effectiveTheme = useResolvedColorScheme(environment.effectiveTheme);
  const queryClient = useQueryClient();
  const { yjsOfflineEnabled } = useYjsOfflineEnabled();
  const { preferences: userPrefs, updatePreferences } = useUserPreferences();
  const { typography: typographyPrefs, setTypography: handleTypographyChange } =
    useReaderTypography();
  const readerFont = typographyPrefs.fontFamily;
  const readerMeasure = typographyPrefs.measure;
  const isLgUp = useMediaQuery(INKADE_MEDIA_QUERIES.lg);
  const isXlUp = useMediaQuery(INKADE_MEDIA_QUERIES.xl);

  const [viewModeOverride, setViewModeOverride] = useState<"edit" | "read" | null>(mode ?? null);
  const [editorMode, setEditorMode] = useState<"rich" | "source">("rich");
  const showFormatBar = userPrefs.layout.showFormatBar;
  const setShowFormatBar = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      const current = usePreferencesStore.getState().preferences.layout.showFormatBar;
      const resolved = typeof next === "function" ? next(current) : next;
      updatePreferences({ layout: { showFormatBar: resolved } });
    },
    [updatePreferences],
  );
  const [findOpen, setFindOpen] = useState(false);
  const [highlightedNodeId, setHighlightedNodeId] = useState<OutlineNodeId | null>(
    focusNodeId ?? null,
  );
  const [activeHighlightId, setActiveHighlightId] = useState<HighlightId | null>(
    focusHighlightId ?? null,
  );
  const [highlightStatusFilter, setHighlightStatusFilter] =
    useState<MarginaliaStatusFilter>("all");
  const [shareViewerContext, setShareViewerContext] = useState(false);
  const [selectedReaderQuote, setSelectedReaderQuote] = useState<string | null>(null);
  const [showAgentDiff, setShowAgentDiff] = useState(false);
  const [reviewMode, setReviewMode] = useState<"inline" | "diff">("inline");
  const [undoBatchConflict, setUndoBatchConflict] = useState<{
    readonly batchId: AuditBatchId;
    readonly conflicts: readonly BatchRollbackConflict[];
  } | null>(null);
  const [quietSessionDocKey, setQuietSessionDocKey] = useState<string | null>(null);
  const quietAutoAckKeyRef = useRef<string | null>(null);
  const [hasConflict, setHasConflict] = useState(false);
  const [conflictServerDoc, setConflictServerDoc] = useState<DocumentRecord | null>(null);
  const [dispatchTarget, setDispatchTarget] = useState<DispatchAdeTarget | null>(null);
  const [mobileTocOpen, setMobileTocOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [presentationOpen, setPresentationOpen] = useState(false);
  const primaryScrollRef = useRef<HTMLDivElement>(null);
  const primaryContentRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<ArticleEditorHandle>(null);
  const titleRef = useRef<InlineDocumentTitleHandle>(null);
  const tocJumpLockUntilRef = useRef<number>(0);
  const activeHeadingStore = useMemo(() => createActiveHeadingStore(), []);
  const hostActionsRef = useRef(hostActions);
  hostActionsRef.current = hostActions;

  const [draftMarkdown, setDraftMarkdown] = useState("");
  const latestDraftRef = useRef("");
  const [isDirty, setIsDirty] = useState(false);
  const [autosaveStatus, setAutosaveStatus] = useState<"idle" | "saving" | "saved" | "unsaved">(
    "idle",
  );
  const editorHostRef = useRef<HTMLDivElement>(null);
  const [editorAnchorPositions, setEditorAnchorPositions] = useState<MarginaliaAnchorPosition[]>(
    [],
  );

  const [syncBacklinks, setSyncBacklinks] = useState(true);
  const [tagInputOpen, setTagInputOpen] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [propsOpen, setPropsOpen] = useState(false);
  const propSchema = useMemo(
    () =>
      z.object({
        key: z.string().trim().min(1, t("validation.required")),
        value: z.string(),
      }),
    [t],
  );
  const addPropForm = useForm<{ key: string; value: string }>({
    resolver: zodResolver(propSchema),
    defaultValues: { key: "", value: "" },
  });
  const [editingPropKey, setEditingPropKey] = useState<string | null>(null);
  const [editingPropVal, setEditingPropVal] = useState("");

  const isHostSplitManaged = Boolean(hostActions.workspaceSplitManaged);
  const globalSplitOpen = useWorkspaceTabsStore((s) => s.splitOpen);
  const globalSplitMode = useWorkspaceTabsStore((s) => s.splitMode);
  const globalSplitDocId = useWorkspaceTabsStore((s) => s.splitDocId);
  const [localSplitMode, setLocalSplitMode] = useState<SplitMode>("closed");
  const [localSplitDocId, setLocalSplitDocId] = useState<DocumentId | null>(null);
  const splitMode: SplitMode = isHostSplitManaged
    ? globalSplitOpen
      ? globalSplitMode
      : "closed"
    : localSplitMode;
  const splitDocId = isHostSplitManaged ? globalSplitDocId : localSplitDocId;
  const setSplitMode = useCallback(
    (next: React.SetStateAction<SplitMode>) => {
      if (isHostSplitManaged) {
        const currentState = useWorkspaceTabsStore.getState();
        const prev: SplitMode = currentState.splitOpen ? currentState.splitMode : "closed";
        const resolved = typeof next === "function" ? next(prev) : next;
        currentState.setSplitMode(resolved);
        return;
      }
      setLocalSplitMode(next);
    },
    [isHostSplitManaged],
  );
  const setSplitDocId = useCallback(
    (next: React.SetStateAction<DocumentId | null>) => {
      if (isHostSplitManaged) {
        const currentState = useWorkspaceTabsStore.getState();
        const resolved = typeof next === "function" ? next(currentState.splitDocId) : next;
        currentState.setSplitDocId(resolved);
        return;
      }
      setLocalSplitDocId(next);
    },
    [isHostSplitManaged],
  );
  const splitPane = useResizablePane({
    storageKey: "inkade:pane:split",
    defaultWidth: 440,
    minWidth: 320,
    maxWidth: 700,
    side: "right",
  });

  const today = useMemo(() => getTodayDailyDate(), []);
  const spacesQuery = useInkadeSpaces({ enabled: spacesProp === undefined });
  const allDocsQuery = useInkadeDocuments(
    { limit: 300 },
    { enabled: workspaceDocsProp === undefined },
  );

  const spaces = spacesProp ?? spacesQuery.data ?? EMPTY_SPACES;
  const workspaceDocs = workspaceDocsProp ?? allDocsQuery.data ?? EMPTY_DOCS;

  const docQuery = useInkadeDocument(documentId);
  const bindingsQuery = useInkadeThreadBindings({ documentId });
  const highlightsQuery = useInkadeHighlights(documentId);
  const pdfAssetQuery = useQuery({
    queryKey: inkadeQueryKeys.pdfAssetByDocument(documentId),
    queryFn: async () => {
      const res = await client.pdf.getByDocument(documentId);
      return res.asset;
    },
    enabled: Boolean(documentId),
    staleTime: 30_000,
  });
  const pdfAsset = pdfAssetQuery.data ?? null;
  const [activePdfPage, setActivePdfPage] = useState<number | null>(focusPage ?? null);
  const [activePdfAnnotationId, setActivePdfAnnotationId] = useState<string | null>(
    focusAnnotationId ?? null,
  );
  const [distillingPdfPage, setDistillingPdfPage] = useState<number | null>(null);

  useEffect(() => {
    if (focusPage) setActivePdfPage(focusPage);
  }, [focusPage]);

  useEffect(() => {
    if (focusAnnotationId) setActivePdfAnnotationId(focusAnnotationId);
  }, [focusAnnotationId]);

  const doc = docQuery.data ?? null;
  const spaceSchemaQuery = useInkadeSpaceSchema(doc?.spaceId);
  const spaceSchemaFields = useMemo(
    () => spaceSchemaQuery.data?.fields ?? [],
    [spaceSchemaQuery.data],
  );
  const editing =
    isReadOnly || doc === null || doc.kind === "outline"
      ? false
      : viewModeOverride !== null
        ? viewModeOverride === "edit"
        : doc.kind === "article";

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

  const activeHighlights = highlightsQuery.data ?? EMPTY_HIGHLIGHTS;
  const commentThreadsQuery = useInkadeCommentThreads(doc ? documentId : undefined, "all");
  const bridgeSessionsQuery = useInkadeBridgeSessions(
    { status: "online" },
    { enabled: !isReadOnly },
  );
  const commentsByHighlightId = useMemo<Readonly<Record<string, readonly HighlightComment[]>>>(
    () => {
      const threads = commentThreadsQuery.data ?? [];
      if (threads.length === 0) return {};
      const map: Record<string, readonly HighlightComment[]> = {};
      for (const thread of threads) {
        map[thread.highlight.id] = thread.comments;
      }
      return map;
    },
    [commentThreadsQuery.data],
  );
  const onlineBridgeSessions = bridgeSessionsQuery.data ?? [];

  useEffect(() => {
    if (!editing) {
      setEditorAnchorPositions([]);
      return;
    }
    const host = editorHostRef.current;
    if (!host) return;

    let rafId = 0;
    const measure = (): void => {
      const container = editorHostRef.current;
      if (!container) return;
      const hostRect = container.getBoundingClientRect();
      const marks = container.querySelectorAll<HTMLElement>("mark[data-highlight-id]");
      const seen = new Set<string>();
      const next: MarginaliaAnchorPosition[] = [];
      for (const mark of marks) {
        const hlId = mark.getAttribute("data-highlight-id");
        if (!hlId || seen.has(hlId)) continue;
        seen.add(hlId);
        const rect = mark.getBoundingClientRect();
        next.push({
          kind: "highlight",
          id: hlId,
          top: Math.max(0, Math.round(rect.top - hostRect.top)),
        });
      }
      setEditorAnchorPositions((prev) => {
        if (
          prev.length === next.length &&
          prev.every((p, idx) => p.id === next[idx]?.id && Math.abs(p.top - (next[idx]?.top ?? 0)) <= 1)
        ) {
          return prev;
        }
        return next;
      });
    };

    const scheduleMeasure = (): void => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(measure);
    };

    scheduleMeasure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(scheduleMeasure) : null;
    ro?.observe(host);
    const mo =
      typeof MutationObserver !== "undefined" ? new MutationObserver(scheduleMeasure) : null;
    mo?.observe(host, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-highlight-id"],
    });

    return () => {
      cancelAnimationFrame(rafId);
      ro?.disconnect();
      mo?.disconnect();
    };
  }, [activeHighlights, doc?.id, draftMarkdown, editing, readerFont, readerMeasure]);

  const templatesQuery = useInkadeTemplates("article", { enabled: editing });
  const primaryOutlineNodesQuery = useInkadeOutlineNodes(
    doc && doc.kind === "outline" ? documentId : undefined,
  );
  const revisionsQuery = useInkadeRevisions(doc ? documentId : undefined);
  const shareLinksQuery = useInkadeShareLinks(documentId, {
    enabled: Boolean(doc && shareOpen),
  });
  const agentDiffQuery = useInkadeRevisionDiff(
    documentId,
    Math.max(1, (doc?.version ?? 1) - 1),
    doc?.version ?? 1,
    { enabled: Boolean(doc && showAgentDiff && doc.version > 1) },
  );
  const splitDocQuery = useInkadeDocument(
    !isHostSplitManaged && splitMode === "doc" ? (splitDocId ?? undefined) : undefined,
  );
  const splitDocNodesQuery = useInkadeOutlineNodes(
    !isHostSplitManaged && isLgUp && splitMode === "doc" && splitDocId && splitDocQuery.data?.kind === "outline"
      ? splitDocId
      : undefined,
  );
  const splitDailyQuery = useInkadeDailyOutline(today, {
    enabled: !isHostSplitManaged && splitMode === "daily",
  });

  const mutations = useDocumentDetailMutations({
    t,
    documentId,
    doc,
    today,
    spaces,
    splitDocId,
    effectiveTheme,
    typographyPrefs,
    latestDraftRef,
    primaryContentRef,
    setHasConflict,
    setConflictServerDoc,
    setIsDirty,
    setAutosaveStatus,
    setShowAgentDiff,
    setUndoBatchConflict,
  });

  const silentAckMutate = mutations.acknowledgeSilentMutation.mutate;
  useEffect(() => {
    if (!doc || !doc.unreadAgentUpdate) return;
    const versionKey = `${doc.id}:${doc.version}`;
    setQuietSessionDocKey((prev) => (prev === versionKey ? prev : versionKey));
    if (isReadOnly || showAgentDiff) return;
    if (quietAutoAckKeyRef.current === versionKey) return;
    const timer = window.setTimeout(() => {
      quietAutoAckKeyRef.current = versionKey;
      silentAckMutate();
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [doc, isReadOnly, showAgentDiff, silentAckMutate]);

  const pendingSplitDocId = hostActions.pendingSplitDocId ?? null;
  useEffect(() => {
    const incomingSplitId = externalSplitDocId ?? pendingSplitDocId;
    if (incomingSplitId && incomingSplitId !== documentId) {
      setSplitDocId(incomingSplitId);
      setSplitMode("doc");
      hostActions.setInspectorOpen?.(false);
      if (pendingSplitDocId) {
        hostActions.clearPendingSplitDoc?.();
      }
    }
  }, [externalSplitDocId, pendingSplitDocId, documentId, hostActions, setSplitDocId, setSplitMode]);

  useEffect(() => {
    setViewModeOverride(mode ?? null);
    setEditorMode("rich");
    setFindOpen(false);
    setSelectedReaderQuote(null);
    setShowAgentDiff(false);
    setHasConflict(false);
    setConflictServerDoc(null);
    latestDraftRef.current = "";
    setDraftMarkdown("");
    setIsDirty(false);
    setAutosaveStatus("idle");
    setEditingPropKey(null);
    tocJumpLockUntilRef.current = 0;
    activeHeadingStore.set(null);
    primaryScrollRef.current?.scrollTo({ top: 0 });
  }, [activeHeadingStore, documentId, mode]);

  useEffect(() => {
    if (!isHostSplitManaged && splitDocId === documentId) {
      setSplitDocId(null);
      if (splitMode === "doc") {
        setSplitMode("closed");
      }
    }
  }, [documentId, isHostSplitManaged, setSplitDocId, setSplitMode, splitDocId, splitMode]);

  useEventListener("keydown", (event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
      event.preventDefault();
      setFindOpen(true);
    }
  });

  const canonicalEditorBody = useMemo(
    () => (doc ? stripLeadingDuplicateTitle(doc.contentMarkdown, doc.title) : ""),
    [doc],
  );

  useEffect(() => {
    if (doc && !isDirty && !hasConflict) {
      latestDraftRef.current = canonicalEditorBody;
      setDraftMarkdown(canonicalEditorBody);
    }
  }, [canonicalEditorBody, doc, isDirty, hasConflict]);

  useEffect(() => {
    hostActionsRef.current.syncInspectorTarget?.({ document: doc, selectedNodeId: null });
  }, [doc]);

  useEffect(() => {
    return () => {
      hostActionsRef.current.syncInspectorTarget?.({ document: null, selectedNodeId: null });
    };
  }, []);

  useEventListener("beforeunload", (event: BeforeUnloadEvent) => {
    if (!isDirty) return;
    event.preventDefault();
    event.returnValue = "";
  });

  useEffect(() => {
    if (!doc || doc.kind === "outline" || isReadOnly) return;
    const unsubscribe = tinykeys(window, {
      e: (event) => {
        if (
          isImeEvent(event) ||
          isEditableEventTarget(event.target) ||
          (event.target instanceof Element && event.target.closest('[role="dialog"]'))
        ) {
          return;
        }
        event.preventDefault();
        setViewModeOverride((prev) => {
          const currentlyEditing = prev !== null ? prev === "edit" : doc.kind === "article";
          return currentlyEditing ? "read" : "edit";
        });
      },
    });
    return unsubscribe;
  }, [doc, isReadOnly]);

  const { mutate: triggerSaveDocument } = mutations.saveMutation;
  const autosaveDocId = doc?.id ?? null;
  const autosaveDocVersion = doc?.version ?? null;
  const runDebouncedAutosave = useCallback(
    (payload: {
      readonly targetDocId: DocumentId;
      readonly markdown: string;
      readonly expectedVersion: number;
    }) => {
      setAutosaveStatus("saving");
      triggerSaveDocument({ ...payload, silent: true });
    },
    [triggerSaveDocument],
  );
  const debouncedAutosave = useDebounceCallback(runDebouncedAutosave, 1500);

  useEffect(() => {
    if (!editing || !isDirty || hasConflict || !autosaveDocId || autosaveDocVersion === null) {
      debouncedAutosave.cancel();
      return;
    }
    setAutosaveStatus("unsaved");
    debouncedAutosave({
      targetDocId: autosaveDocId,
      markdown: draftMarkdown,
      expectedVersion: autosaveDocVersion,
    });
  }, [
    autosaveDocId,
    autosaveDocVersion,
    debouncedAutosave,
    draftMarkdown,
    editing,
    hasConflict,
    isDirty,
  ]);

  useEffect(() => {
    debouncedAutosave.cancel();
  }, [debouncedAutosave, documentId]);

  const { saveMutation } = mutations;
  const handleImmediateSave = useCallback(
    (markdown: string, expectedVersion: number) => {
      debouncedAutosave.cancel();
      latestDraftRef.current = markdown;
      setAutosaveStatus("saving");
      saveMutation.mutate({ targetDocId: documentId, markdown, expectedVersion });
    },
    [debouncedAutosave, documentId, saveMutation],
  );

  const handleSaveForLeave = useCallback(async (): Promise<boolean> => {
    if (!doc || isReadOnly) return true;
    debouncedAutosave.cancel();
    const markdown = editorRef.current?.flushMarkdown() ?? latestDraftRef.current;
    latestDraftRef.current = markdown;
    setAutosaveStatus("saving");
    try {
      await saveMutation.mutateAsync({
        targetDocId: documentId,
        markdown,
        expectedVersion: doc.version,
        silent: true,
      });
      return true;
    } catch {
      return false;
    }
  }, [debouncedAutosave, doc, documentId, isReadOnly, saveMutation]);

  const handleDiscardForLeave = useCallback((): void => {
    debouncedAutosave.cancel();
    latestDraftRef.current = canonicalEditorBody;
    setDraftMarkdown(canonicalEditorBody);
    setIsDirty(false);
    setAutosaveStatus("idle");
  }, [canonicalEditorBody, debouncedAutosave]);

  const navBlockerOptions = useMemo(
    () => ({
      onSaveAndLeave: handleSaveForLeave,
      onDiscardAndLeave: handleDiscardForLeave,
    }),
    [handleDiscardForLeave, handleSaveForLeave],
  );

  useViewsNavigationBlocker(
    isDirty && !isReadOnly,
    t("document.unsavedConfirmMessage"),
    navBlockerOptions,
  );

  const handleOpenWikilink = useCallback(
    (targetSlugOrTitle: string, event?: React.MouseEvent): void => {
      const clean = targetSlugOrTitle.split("#")[0]?.trim().toLowerCase() ?? "";
      const matched = workspaceDocs.find(
        (d) =>
          d.id.toLowerCase() === clean ||
          d.slug.toLowerCase() === clean ||
          d.title.toLowerCase() === clean,
      );
      if (matched) {
        if (event && (event.metaKey || event.ctrlKey) && isLgUp) {
          setSplitDocId(matched.id);
          setSplitMode("doc");
          hostActions.setInspectorOpen?.(false);
          return;
        }
        navigation.openDocument(matched.id);
      } else {
        notifier.error(t("document.referencedDocNotFound", { target: targetSlugOrTitle }));
      }
    },
    [hostActions, isLgUp, navigation, notifier, setSplitDocId, setSplitMode, t, workspaceDocs],
  );

  const toc = useMemo(() => {
    if (!doc) return [];
    return extractDocumentHeadings(editing ? draftMarkdown : doc.contentMarkdown, doc.title, 3);
  }, [doc, editing, draftMarkdown]);

  const readingStats = useMemo(
    () => computeDocumentReadingStats(editing ? draftMarkdown : (doc?.contentMarkdown ?? "")),
    [editing, draftMarkdown, doc?.contentMarkdown],
  );

  const scrollToHeading = useCallback(
    (entry: TocEntry) => {
      if (typeof performance !== "undefined") {
        tocJumpLockUntilRef.current = performance.now() + 1000;
      }
      activeHeadingStore.set(entry.slug);
      const container = primaryScrollRef.current;
      if (!container) return;
      const byId = container.querySelector<HTMLElement>(`#${CSS.escape(entry.slug)}`);
      if (byId) {
        scrollContainerToElement(container, byId, "start", 20);
        return;
      }
      const pmHeadings = container.querySelectorAll<HTMLElement>(
        ".ProseMirror h1, .ProseMirror h2, .ProseMirror h3",
      );
      const normalized = entry.text.trim().toLowerCase();
      for (const el of pmHeadings) {
        if ((el.textContent ?? "").trim().toLowerCase() === normalized) {
          scrollContainerToElement(container, el, "start", 20);
          return;
        }
      }
    },
    [activeHeadingStore],
  );

  const scrollToHighlight = useCallback((highlightId: HighlightId) => {
    const container = primaryScrollRef.current;
    const el = container?.querySelector<HTMLElement>(
      `mark[data-highlight-id="${CSS.escape(highlightId)}"]`,
    );
    scrollContainerToElement(container, el ?? null, "center");
  }, []);

  useEffect(() => {
    setHighlightedNodeId(focusNodeId ?? null);
    if (!focusNodeId) return;
    const timer = setTimeout(() => {
      setHighlightedNodeId((curr) => (curr === focusNodeId ? null : curr));
    }, 3500);
    return () => clearTimeout(timer);
  }, [documentId, focusNodeId]);

  const appliedFocusHeadingRef = useRef<string | null>(null);
  useEffect(() => {
    appliedFocusHeadingRef.current = null;
  }, [documentId, focusHeading]);

  useEffect(() => {
    if (!focusHeading || toc.length === 0) return;
    const key = `${documentId}:${focusHeading}`;
    if (appliedFocusHeadingRef.current === key) return;
    const leaf =
      focusHeading
        .split(/\s*[>/]\s*/)
        .filter(Boolean)
        .at(-1)
        ?.trim()
        .toLowerCase() ?? focusHeading.trim().toLowerCase();
    const matched = toc.find(
      (entry) =>
        entry.slug.toLowerCase() === leaf || entry.text.trim().toLowerCase() === leaf,
    );
    if (!matched) return;
    appliedFocusHeadingRef.current = key;
    const timer = setTimeout(() => scrollToHeading(matched), 120);
    return () => clearTimeout(timer);
  }, [documentId, focusHeading, scrollToHeading, toc]);

  const appliedFocusHighlightRef = useRef<string | null>(null);
  useEffect(() => {
    appliedFocusHighlightRef.current = null;
    setActiveHighlightId(focusHighlightId ?? null);
  }, [documentId, focusHighlightId]);

  useEffect(() => {
    if (!focusHighlightId || activeHighlights.length === 0) return;
    const key = `${documentId}:${focusHighlightId}`;
    if (appliedFocusHighlightRef.current === key) return;
    const exists = activeHighlights.some((h) => h.id === focusHighlightId);
    if (!exists) return;
    appliedFocusHighlightRef.current = key;
    setActiveHighlightId(focusHighlightId);
    const timer = setTimeout(() => scrollToHighlight(focusHighlightId), 120);
    return () => clearTimeout(timer);
  }, [activeHighlights, documentId, focusHighlightId, scrollToHighlight]);

  const activeHeadingSlug = useSyncExternalStore(
    (listener) => activeHeadingStore.subscribe(listener),
    () => activeHeadingStore.getSnapshot(),
    () => activeHeadingStore.getSnapshot(),
  );

  useEffect(() => {
    const state = isReadOnly
      ? "readonly"
      : autosaveStatus === "saving"
        ? "saving"
        : isDirty || autosaveStatus === "unsaved"
          ? "unsaved"
          : "saved";
    hostActionsRef.current.reportSaveState?.({
      state,
      leaveLosesWork: !isReadOnly && (isDirty || state === "saving" || state === "unsaved"),
    });
  }, [autosaveStatus, isDirty, isReadOnly]);

  useEffect(() => {
    if (!doc) return;
    hostActionsRef.current.reportPlace?.({
      documentId: doc.id,
      ...(activeHeadingSlug ? { headingSlug: activeHeadingSlug } : {}),
      ...(highlightedNodeId ? { nodeId: highlightedNodeId } : {}),
      ...(activeHighlightId ? { highlightId: activeHighlightId } : {}),
    });
  }, [activeHeadingSlug, activeHighlightId, doc, highlightedNodeId]);

  const viewerContextWasSharedRef = useRef(false);
  const sendViewerContext = useDebounceCallback((payload: UpdateViewerContextInput) => {
    void client.documents.updateViewerContext(payload).catch(() => {});
  }, 500);

  useEffect(() => {
    if (!shareViewerContext || !doc) {
      sendViewerContext.cancel();
      if (viewerContextWasSharedRef.current) {
        viewerContextWasSharedRef.current = false;
        void client.documents
          .updateViewerContext({ documentId: null, viewMode: "reader" })
          .catch(() => {});
      }
      return;
    }

    viewerContextWasSharedRef.current = true;
    const activeHl = activeHighlightId
      ? activeHighlights.find((h) => h.id === activeHighlightId) ?? null
      : null;
    const payload: UpdateViewerContextInput = {
      documentId: doc.id,
      viewMode:
        doc.kind === "outline"
          ? "outline"
          : showAgentDiff
            ? "diff"
            : editing
              ? "editor"
              : "reader",
      headingSlug: activeHeadingSlug ?? null,
      activeNodeId: highlightedNodeId ?? null,
      selectedQuote: selectedReaderQuote ?? activeHl?.quote ?? null,
      selectedHighlightId: activeHighlightId ?? null,
    };
    sendViewerContext(payload);

    const keepAliveTimer = window.setInterval(() => {
      void client.documents.updateViewerContext(payload).catch(() => {});
    }, 15_000);
    return () => {
      window.clearInterval(keepAliveTimer);
    };
  }, [
    activeHeadingSlug,
    activeHighlightId,
    activeHighlights,
    client.documents,
    doc,
    editing,
    highlightedNodeId,
    selectedReaderQuote,
    sendViewerContext,
    shareViewerContext,
    showAgentDiff,
  ]);

  useEffect(() => {
    return () => {
      sendViewerContext.cancel();
      if (viewerContextWasSharedRef.current) {
        viewerContextWasSharedRef.current = false;
        void client.documents
          .updateViewerContext({ documentId: null, viewMode: "reader" })
          .catch(() => {});
      }
    };
  }, [client.documents, sendViewerContext]);

  const handleOpenThreadsTab = useCallback(() => {
    hostActions.openInspectorTab?.("threads");
  }, [hostActions]);

  useEffect(() => {
    const container = primaryScrollRef.current;
    if (!container || toc.length === 0) {
      activeHeadingStore.set(null);
      return;
    }
    const updateActiveFromScroll = () => {
      if (typeof performance !== "undefined" && performance.now() < tocJumpLockUntilRef.current) {
        return;
      }
      const containerTop = container.getBoundingClientRect().top;
      let currentSlug: string | null = toc[0]?.slug ?? null;
      const headingEls = container.querySelectorAll<HTMLElement>(
        "h1[id], h2[id], h3[id], .ProseMirror h1, .ProseMirror h2, .ProseMirror h3",
      );
      for (const el of headingEls) {
        const rect = el.getBoundingClientRect();
        if (rect.top - containerTop <= 140) {
          if (el.id) {
            currentSlug = el.id;
          } else {
            const text = (el.textContent ?? "").trim().toLowerCase();
            const matched = toc.find((entry) => entry.text.trim().toLowerCase() === text);
            if (matched) currentSlug = matched.slug;
          }
        }
      }
      if (
        container.scrollTop > 0 &&
        container.scrollHeight - (container.scrollTop + container.clientHeight) <= 8
      ) {
        currentSlug = toc[toc.length - 1]?.slug ?? currentSlug;
      }
      activeHeadingStore.set(currentSlug);
    };

    let rafId = 0;
    const onScroll = () => {
      if (rafId !== 0) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        updateActiveFromScroll();
      });
    };
    const clearJumpLock = () => {
      tocJumpLockUntilRef.current = 0;
    };
    updateActiveFromScroll();
    container.addEventListener("scroll", onScroll, { passive: true });
    container.addEventListener("wheel", clearJumpLock, { passive: true });
    container.addEventListener("touchstart", clearJumpLock, { passive: true });
    return () => {
      if (rafId !== 0) cancelAnimationFrame(rafId);
      container.removeEventListener("scroll", onScroll);
      container.removeEventListener("wheel", clearJumpLock);
      container.removeEventListener("touchstart", clearJumpLock);
    };
  }, [activeHeadingStore, doc?.id, toc, editing, documentId]);

  const conflictDiff = useMemo(() => {
    if (!conflictServerDoc) return null;
    return computeRevisionDiff(draftMarkdown, conflictServerDoc.contentMarkdown);
  }, [draftMarkdown, conflictServerDoc]);

  const latestRevision = useMemo(() => {
    const revs = revisionsQuery.data ?? [];
    if (!doc) return null;
    return revs.find((r) => r.version === doc.version) ?? revs[0] ?? null;
  }, [revisionsQuery.data, doc]);

  const previousRevision = useMemo(() => {
    const revs = revisionsQuery.data ?? [];
    if (!doc || doc.version <= 1) return null;
    return revs.find((r) => r.version === doc.version - 1) ?? null;
  }, [revisionsQuery.data, doc]);

  const spaceObj = doc ? (spaces.find((s) => s.id === doc.spaceId) ?? null) : null;
  const spaceName = spaceObj?.name ?? doc?.spaceId ?? "";
  const kindLabel = doc
    ? doc.kind === "outline"
      ? t("common.kindOutline")
      : doc.kind === "clip"
        ? t("common.kindClip")
        : t("common.kindArticle")
    : "";
  const activeSpaces = spaces.filter((s) => s.archivedAt === null);
  const schemaPropKeys = useMemo(
    () => new Set(spaceSchemaFields.map((f) => f.key)),
    [spaceSchemaFields],
  );
  const customProps = Object.entries(doc?.properties ?? {}).filter(
    ([key]) => !INTERNAL_HIDDEN_PROPERTY_KEYS.has(key) && !schemaPropKeys.has(key),
  );
  const availablePresets = doc
    ? getPropertyPresets(doc.kind).filter(
        (preset) => !(doc.properties && preset.key in doc.properties) && !schemaPropKeys.has(preset.key),
      )
    : [];
  const isSplitOpen = isLgUp && splitMode !== "closed";
  const isViewingTodayDaily = doc?.kind === "outline" && doc?.dailyDate === today;
  const secondaryDocs = doc
    ? workspaceDocs.filter(
        (d) =>
          d.id !== doc.id &&
          d.trashedAt === null &&
          !(doc.dailyDate && d.dailyDate === doc.dailyDate),
      )
    : EMPTY_DOCS;
  const activeShareLinks = (shareLinksQuery.data ?? []).filter((link) => !link.revokedAt);
  const buildPublicShareUrl = (token: string): string => {
    const base =
      environment.documentBaseUrl ?? client.getConnectionConfig().baseUrl ?? "";
    const trimmed = base.endsWith("/") ? base.slice(0, -1) : base;
    const path = `/share/${encodeURIComponent(token)}`;
    return trimmed ? `${trimmed}${path}` : path;
  };
  const updatedDisplay = doc ? doc.updatedAt.slice(0, 16).replace("T", " ") : "";
  const revisionCount = revisionsQuery.data?.length ?? doc?.version ?? 1;

  const fetchPdfBytes = useCallback(
    (assetIdToFetch: NonNullable<typeof pdfAsset>["id"]) => client.pdf.fetchBytes(assetIdToFetch),
    [client],
  );

  const handleCreatePdfAnnotation = useCallback(
    async (input: CreatePdfAnnotationInput) => {
      if (!pdfAsset) return;
      try {
        const res = await client.pdf.createAnnotation(pdfAsset.id, input);
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.pdfAssetByDocument(documentId) }),
          queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.outlineNodes(documentId) }),
        ]);
        setActivePdfPage(input.page);
        setActivePdfAnnotationId(res.annotation.id);
        notifier.success(t("pdfStudy.annotationAddedToast", { page: input.page }));
      } catch (err) {
        notifier.error(t("pdfStudy.annotationAddFailedToast"), err);
      }
    },
    [client, documentId, notifier, pdfAsset, queryClient, t],
  );

  const handleDeletePdfAnnotation = useCallback(
    async (annotationId: string) => {
      if (!pdfAsset) return;
      try {
        await client.pdf.deleteAnnotation(pdfAsset.id, annotationId);
        await queryClient.invalidateQueries({
          queryKey: inkadeQueryKeys.pdfAssetByDocument(documentId),
        });
        notifier.success(t("pdfStudy.annotationRemovedToast"));
      } catch (err) {
        notifier.error(t("pdfStudy.annotationAddFailedToast"), err);
      }
    },
    [client, documentId, notifier, pdfAsset, queryClient, t],
  );

  const handleDistillPdfPage = useCallback(
    async (page: number) => {
      if (!pdfAsset) return;
      setDistillingPdfPage(page);
      try {
        await client.pdf.distillPage(pdfAsset.id, { page });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.pdfAssetByDocument(documentId) }),
          queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.outlineNodes(documentId) }),
        ]);
        notifier.success(t("pdfStudy.distillSuccessToast", { page }));
      } catch (err) {
        notifier.error(t("pdfStudy.distillFailedToast"), err);
      } finally {
        setDistillingPdfPage(null);
      }
    },
    [client, documentId, notifier, pdfAsset, queryClient, t],
  );

  const handleOpenPdfCitation = useCallback(
    (uri: string) => {
      const parsed = parsePdfCitationUri(uri);
      if (!parsed) return;
      if (parsed.docId === documentId) {
        setActivePdfPage(parsed.page);
        const matchingAnn = pdfAsset?.annotations.find(
          (ann) =>
            ann.page === parsed.page &&
            (!parsed.rect ||
              ann.rects.some(
                (r) =>
                  Math.abs(r.x - parsed.rect!.x) < 0.02 &&
                  Math.abs(r.y - parsed.rect!.y) < 0.02,
              )),
        );
        if (matchingAnn) {
          setActivePdfAnnotationId(matchingAnn.id);
        }
        return;
      }
      navigation.openDocument(parsed.docId, { page: parsed.page });
    },
    [documentId, navigation, pdfAsset?.annotations],
  );

  const handleSearchWorkspaceNodes = useCallback(
    async (query: string): Promise<readonly WorkspaceOutlineSearchMatch[]> => {
      const res = await client.outlineNodes.search(query, 20);
      return res.map((m) => ({
        node: m.node,
        documentId: m.documentId,
        documentTitle: m.documentTitle,
      }));
    },
    [client],
  );

  const handleCreateOutlineMirror = useCallback(
    async (
      sourceNode: OutlineNode,
      placement: {
        readonly targetDocumentId: DocumentId;
        readonly parentNodeId?: OutlineNodeId | null | undefined;
        readonly afterNodeId?: OutlineNodeId | undefined;
      },
    ): Promise<OutlineNode | void> => {
      try {
        const res = await client.outlineNodes.mirror(sourceNode.id, {
          targetDocumentId: placement.targetDocumentId,
          parentNodeId: placement.parentNodeId ?? null,
          ...(placement.afterNodeId ? { afterNodeId: placement.afterNodeId } : {}),
        });
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: inkadeQueryKeys.outlineNodes(placement.targetDocumentId),
          }),
          queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.outlineNodes(documentId) }),
        ]);
        notifier.success(t("mirrorNode.mirrorCreatedToast"));
        return res.node;
      } catch (err) {
        if (err instanceof InkadeApiError && err.code === "INVALID_PARENT_CYCLE") {
          notifier.error(t("mirrorNode.mirrorCycleErrorToast"), err);
        } else {
          notifier.error(t("mirrorNode.mirrorCreateFailedToast"), err);
        }
      }
    },
    [client, documentId, notifier, queryClient, t],
  );

  const handleCopyBlockLink = useCallback(
    (nodeId: OutlineNodeId, deepLinkUri?: string) => {
      const uri = deepLinkUri ?? buildOutlineBlockDeepLink(documentId, nodeId);
      notifier.success(t("mirrorNode.blockLinkCopiedToast", { link: uri }));
    },
    [documentId, notifier, t],
  );

  const handleOpenBlockDeepLink = useCallback(
    (uri: string) => {
      const parsed = parseOutlineBlockDeepLink(uri);
      if (!parsed) return;
      if (parsed.docId === documentId) {
        setHighlightedNodeId(parsed.nodeId);
        return;
      }
      navigation.openDocument(parsed.docId, { nodeId: parsed.nodeId });
    },
    [documentId, navigation],
  );

  const handleOpenMirroredSource = useCallback(
    async (mirrorOfNodeId: OutlineNodeId) => {
      const matches = await client.outlineNodes.search(mirrorOfNodeId, 5).catch(() => []);
      const found = matches.find((m) => m.node.id === mirrorOfNodeId);
      if (found) {
        navigation.openDocument(found.documentId, { nodeId: mirrorOfNodeId });
      }
    },
    [client, navigation],
  );

  return {
    t,
    client,
    navigation,
    hostActions,
    hostActionsRef,
    notifier,
    environment,
    queryClient,
    documentId,
    isReadOnly,
    hideHeaderActions,
    onExternalSplitClear,
    inspectorOpen,
    effectiveTheme,
    yjsOfflineEnabled,
    typographyPrefs,
    handleTypographyChange,
    readerFont,
    readerMeasure,
    isLgUp,
    isXlUp,
    viewModeOverride,
    setViewModeOverride,
    editorMode,
    setEditorMode,
    showFormatBar,
    setShowFormatBar,
    findOpen,
    setFindOpen,
    activeHighlightId,
    setActiveHighlightId,
    highlightStatusFilter,
    setHighlightStatusFilter,
    shareViewerContext,
    setShareViewerContext,
    selectedReaderQuote,
    setSelectedReaderQuote,
    commentsByHighlightId,
    onlineBridgeSessions,
    showAgentDiff,
    setShowAgentDiff,
    reviewMode,
    setReviewMode,
    undoBatchConflict,
    setUndoBatchConflict,
    quietSessionDocKey,
    hasConflict,
    setHasConflict,
    conflictServerDoc,
    setConflictServerDoc,
    dispatchTarget,
    setDispatchTarget,
    mobileTocOpen,
    setMobileTocOpen,
    shareOpen,
    setShareOpen,
    presentationOpen,
    setPresentationOpen,
    primaryScrollRef,
    primaryContentRef,
    editorRef,
    titleRef,
    activeHeadingStore,
    draftMarkdown,
    setDraftMarkdown,
    latestDraftRef,
    isDirty,
    setIsDirty,
    autosaveStatus,
    setAutosaveStatus,
    editorHostRef,
    editorAnchorPositions,
    syncBacklinks,
    setSyncBacklinks,
    tagInputOpen,
    setTagInputOpen,
    tagInput,
    setTagInput,
    propsOpen,
    setPropsOpen,
    addPropForm,
    editingPropKey,
    setEditingPropKey,
    editingPropVal,
    setEditingPropVal,
    splitMode,
    setSplitMode,
    splitDocId,
    setSplitDocId,
    splitPane,
    today,
    spaces,
    workspaceDocs,
    docQuery,
    doc,
    pdfAsset,
    activePdfPage,
    activePdfAnnotationId,
    distillingPdfPage,
    fetchPdfBytes,
    handleCreatePdfAnnotation,
    handleDeletePdfAnnotation,
    handleDistillPdfPage,
    handleOpenPdfCitation,
    handleSearchWorkspaceNodes,
    handleCreateOutlineMirror,
    handleCopyBlockLink,
    handleOpenBlockDeepLink,
    handleOpenMirroredSource,
    editing,
    bindingsQuery,
    highlightsQuery,
    templatesQuery,
    primaryOutlineNodesQuery,
    revisionsQuery,
    shareLinksQuery,
    agentDiffQuery,
    splitDocQuery,
    splitDocNodesQuery,
    splitDailyQuery,
    canonicalEditorBody,
    toc,
    readingStats,
    conflictDiff,
    latestRevision,
    previousRevision,
    spaceObj,
    spaceName,
    kindLabel,
    activeSpaces,
    spaceSchemaFields,
    customProps,
    availablePresets,
    isSplitOpen,
    isViewingTodayDaily,
    secondaryDocs,
    activeShareLinks,
    buildPublicShareUrl,
    updatedDisplay,
    revisionCount,
    openDispatch,
    openBindingTarget,
    handleImmediateSave,
    handleOpenWikilink,
    highlightedNodeId,
    scrollToHeading,
    scrollToHighlight,
    handleOpenThreadsTab,
    ...mutations,
  };
}

export type DocumentDetailState = ReturnType<typeof useDocumentDetailState>;
