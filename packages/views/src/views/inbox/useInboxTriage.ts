import {
  asSpaceId,
  type AdeThreadBinding,
  type AgentApprovalDecision,
  type AgentSteeringMode,
  type AuditBatchId,
  type BatchRollbackConflict,
  type BriefingJobId,
  type BriefingRunId,
  buildUnifiedInboxEntries,
  type DocumentId,
  type DocumentRecord,
  type DocumentSummary,
  extractSourceDomain,
  type InboxBatchDigestMetadata,
  normalizeLegacyInboxTab,
  renderOutlineNodesToMarkdown,
  type SpaceId,
  type ThreadBindingId,
  type UnifiedInboxEntry,
  withDocInboxSnooze,
  withDocInboxUnread,
} from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import { inkadeQueryKeys } from "@inkade/sdk";
import {
  useInkadeAuditBatches,
  useInkadeBriefingRuns,
  useInkadeWhoami,
  useInkadeClient,
  useInkadeDocument,
  useInkadeDocuments,
  useInkadeOutlineNodes,
  useInkadeRevisions,
  useInkadeSpaces,
  useInkadeThreadBindings,
} from "@inkade/sdk/react";
import { INKADE_MEDIA_QUERIES } from "@inkade/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEventListener, useMediaQuery } from "usehooks-ts";
import type { DispatchAdeTarget } from "../../components/DispatchAdeDialog.tsx";
import { useInkadeViewsContext } from "../../context.tsx";
import { formatLocalizedBriefingSummary } from "../../lib/briefings-i18n.ts";
import { getTodayDailyDate } from "../../lib/dates.ts";
import {
  setBindingInboxSnooze,
  setBindingInboxUnread,
  useInboxLocalState,
} from "../../lib/inbox-local-state.ts";
import { useResolvedColorScheme, useUserPreferences } from "../../lib/preferences-store.ts";
import { isEditableEventTarget, isImeEvent } from "../../lib/shortcuts.ts";
import {
  formatSnoozeUntilShort,
  getInboxItemSubtitle,
  type InboxFilterTab,
  type InboxViewProps,
} from "./types.ts";

export function useInboxTriage({
  shareTarget,
  readonly: readonlyProp,
  initialTab,
  initialQuery,
  initialItemId,
  urlState,
  onUrlStateChange,
  onClearShareTarget,
  scrollToIndexRef,
}: InboxViewProps & {
  readonly scrollToIndexRef: React.RefObject<((index: number) => void) | null>;
}) {
  const { t } = useInkadeTranslation();
  const client = useInkadeClient();
  const { navigation, hostActions, notifier, environment } = useInkadeViewsContext();
  const isReadOnly = readonlyProp ?? environment.readonly ?? false;
  const effectiveTheme = useResolvedColorScheme(environment.effectiveTheme);
  const queryClient = useQueryClient();
  const { preferences, updatePreferences } = useUserPreferences();
  const isMdUp = useMediaQuery(INKADE_MEDIA_QUERIES.min768);
  const inboxLocalState = useInboxLocalState();
  const todayStr = getTodayDailyDate();

  const effectiveUrlQuery = urlState?.q ?? initialQuery;
  const effectiveUrlItemId = urlState?.item ?? initialItemId;
  const explicitRequestedTab = normalizeLegacyInboxTab(urlState?.tab ?? initialTab);
  const [sessionSelectedTab, setSessionSelectedTab] = useState<InboxFilterTab | null>(null);

  const [filterText, setFilterTextState] = useState<string>(() => effectiveUrlQuery ?? "");
  const [exitingItemIds, setExitingItemIds] = useState<ReadonlySet<string>>(() => new Set());
  const [selectedItemId, setSelectedItemId] = useState<string | null>(
    () => effectiveUrlItemId ?? null,
  );
  const [moveMenuOpen, setMoveMenuOpen] = useState(false);
  const [snoozePopoverOpen, setSnoozePopoverOpen] = useState(false);
  const [customSnoozeDate, setCustomSnoozeDate] = useState(todayStr);
  const [dispatchTarget, setDispatchTarget] = useState<DispatchAdeTarget | null>(null);
  const [recentApprovalIds, setRecentApprovalIds] = useState<ReadonlySet<ThreadBindingId>>(
    () => new Set(),
  );
  const [steeringDraftById, setSteeringDraftById] = useState<
    Readonly<Record<ThreadBindingId, string>>
  >({});
  const [steeringModeById, setSteeringModeById] = useState<
    Readonly<Record<ThreadBindingId, AgentSteeringMode>>
  >({});
  const shareHandledRef = useRef(false);

  const prevInitialQueryRef = useRef(effectiveUrlQuery);
  useEffect(() => {
    if (prevInitialQueryRef.current === effectiveUrlQuery) return;
    prevInitialQueryRef.current = effectiveUrlQuery;
    setFilterTextState(effectiveUrlQuery ?? "");
  }, [effectiveUrlQuery]);

  const prevInitialItemRef = useRef(effectiveUrlItemId);
  useEffect(() => {
    if (prevInitialItemRef.current === effectiveUrlItemId) return;
    prevInitialItemRef.current = effectiveUrlItemId;
    if (effectiveUrlItemId) {
      setSelectedItemId(effectiveUrlItemId);
    }
  }, [effectiveUrlItemId]);

  const setActiveTab = useCallback(
    (nextTab: InboxFilterTab) => {
      setSessionSelectedTab(nextTab);
      updatePreferences({ inbox: { defaultTab: nextTab } });
      onUrlStateChange?.({ tab: nextTab === "exceptions" ? undefined : nextTab });
    },
    [onUrlStateChange, updatePreferences],
  );

  const setFilterText = useCallback(
    (nextText: string) => {
      setFilterTextState(nextText);
      onUrlStateChange?.({ q: nextText.trim() ? nextText : undefined });
    },
    [onUrlStateChange],
  );

  const selectItemAndSyncUrl = useCallback(
    (itemId: string | null) => {
      setSelectedItemId(itemId);
      onUrlStateChange?.({ item: itemId ?? undefined });
    },
    [onUrlStateChange],
  );

  useEffect(() => {
    if (shareHandledRef.current || !shareTarget) return;
    if (!shareTarget.title && !shareTarget.text && !shareTarget.url) return;
    shareHandledRef.current = true;
    hostActions.openQuickCapture?.({
      target: "inbox",
      title: shareTarget.title,
      text: shareTarget.text,
      sourceUrl: shareTarget.url,
    });
    onClearShareTarget?.();
  }, [hostActions, onClearShareTarget, shareTarget]);

  const whoamiQuery = useInkadeWhoami();
  const isAdminPrincipal =
    whoamiQuery.data?.scope.permission === "admin" &&
    whoamiQuery.data?.scope.spaceIds === "*";
  const spacesQuery = useInkadeSpaces();
  const docsQuery = useInkadeDocuments({ limit: 300 });
  const bindingsQuery = useInkadeThreadBindings({});
  const briefingRunsQuery = useInkadeBriefingRuns({ limit: 50 });
  const auditBatchesQuery = useInkadeAuditBatches(20, { enabled: isAdminPrincipal });
  const [rollbackConflictPrompt, setRollbackConflictPrompt] = useState<{
    readonly batchId: AuditBatchId;
    readonly conflicts: readonly BatchRollbackConflict[];
  } | null>(null);

  const docLatestBatchMap = useMemo(() => {
    const map: Record<string, InboxBatchDigestMetadata> = {};
    for (const batch of auditBatchesQuery.data ?? []) {
      for (const docId of batch.documentIds) {
        if (!map[docId]) {
          map[docId] = {
            batchId: batch.batchId,
            summary: formatLocalizedBriefingSummary(batch.summary, batch.summary, t),
            createdAt: batch.createdAt,
          };
        }
      }
    }
    for (const run of briefingRunsQuery.data ?? []) {
      if (run.status === "succeeded" && run.documentId && run.batchId) {
        const ts = run.finishedAt ?? run.startedAt;
        const prev = map[run.documentId];
        if (!prev || ts >= prev.createdAt) {
          map[run.documentId] = {
            batchId: run.batchId,
            summary: formatLocalizedBriefingSummary(run.summary, run.jobName, t),
            createdAt: ts,
          };
        }
      }
    }
    return map;
  }, [auditBatchesQuery.data, briefingRunsQuery.data, t]);

  const spaces = useMemo(() => spacesQuery.data ?? [], [spacesQuery.data]);
  const allDocs = useMemo(() => docsQuery.data ?? [], [docsQuery.data]);
  const allBindings = useMemo(() => bindingsQuery.data ?? [], [bindingsQuery.data]);

  const docsById = useMemo(() => new Map(allDocs.map((d) => [d.id, d])), [allDocs]);

  const docTitlesRecord = useMemo(() => {
    const rec: Record<string, string> = {};
    for (const d of allDocs) {
      rec[d.id] = d.title;
    }
    return rec;
  }, [allDocs]);

  const inboxSpaceId = useMemo(
    () => spaces.find((s) => s.slug === "inbox")?.id ?? asSpaceId("spc_inbox"),
    [spaces],
  );

  const researchSpaceId = useMemo(
    () =>
      spaces.find((s) => s.slug === "research" && s.archivedAt === null)?.id ??
      spaces.find((s) => s.id !== inboxSpaceId && s.archivedAt === null)?.id ??
      inboxSpaceId,
    [spaces, inboxSpaceId],
  );

  const targetSpaces = useMemo(
    () => spaces.filter((s) => s.archivedAt === null && s.id !== inboxSpaceId),
    [spaces, inboxSpaceId],
  );

  const {
    active: unifiedItems,
    snoozed: snoozedItems,
    counts: tabCounts,
  } = useMemo(
    () =>
      buildUnifiedInboxEntries({
        docs: allDocs,
        bindings: allBindings,
        briefingRuns: briefingRunsQuery.data ?? [],
        inboxSpaceId,
        recentApprovalIds,
        bindingSnoozeMap: inboxLocalState.snoozeMap,
        bindingUnreadMap: inboxLocalState.unreadMap,
        docLatestBatchMap,
      }),
    [
      allBindings,
      allDocs,
      briefingRunsQuery.data,
      docLatestBatchMap,
      inboxSpaceId,
      recentApprovalIds,
      inboxLocalState.snoozeMap,
      inboxLocalState.unreadMap,
    ],
  );

  const activeTab: InboxFilterTab =
    explicitRequestedTab ??
    sessionSelectedTab ??
    (tabCounts.exceptions > 0
      ? "exceptions"
      : (normalizeLegacyInboxTab(preferences.inbox.defaultTab) ?? "exceptions"));

  const filteredItems = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    const baseList = activeTab === "snoozed" ? snoozedItems : unifiedItems;
    return baseList
      .filter((item) => {
        if (activeTab === "exceptions") {
          return (
            item.kind === "blocking_question" ||
            item.kind === "conflict" ||
            item.kind === "failed" ||
            item.kind === "briefing_failed"
          );
        }
        if (activeTab === "digest") return item.kind === "digest";
        if (activeTab === "clips") return item.kind === "clip";
        return true;
      })
      .filter((item) => {
        if (!q) return true;
        const localizedSubtitle = getInboxItemSubtitle(item, t);
        if (
          item.title.toLowerCase().includes(q) ||
          localizedSubtitle.toLowerCase().includes(q)
        ) {
          return true;
        }
        if (item.kind === "clip" || item.kind === "digest") {
          const domain = extractSourceDomain(item.doc.sourceUrl) ?? "";
          return (
            domain.toLowerCase().includes(q) ||
            item.doc.tags.some((tag) => tag.toLowerCase().includes(q))
          );
        }
        return false;
      });
  }, [activeTab, filterText, snoozedItems, t, unifiedItems]);

  const selectedItem = useMemo(
    () => filteredItems.find((item) => item.id === selectedItemId) ?? null,
    [filteredItems, selectedItemId],
  );

  const selectedDoc = useMemo<DocumentSummary | null>(() => {
    if (!selectedItem) return null;
    if (selectedItem.kind === "clip" || selectedItem.kind === "digest") {
      return selectedItem.doc;
    }
    return null;
  }, [selectedItem]);

  const selectedDocDetailQuery = useInkadeDocument(selectedDoc?.id);
  const selectedOutlineNodesQuery = useInkadeOutlineNodes(
    selectedDoc?.kind === "outline" ? selectedDoc.id : undefined,
  );
  const selectedFullDoc = useMemo<DocumentRecord | null>(() => {
    const raw =
      selectedDoc && selectedDocDetailQuery.data?.id === selectedDoc.id
        ? selectedDocDetailQuery.data
        : null;
    if (!raw) return null;
    if (
      raw.kind === "outline" &&
      !raw.contentMarkdown.trim() &&
      selectedOutlineNodesQuery.data &&
      selectedOutlineNodesQuery.data.length > 0
    ) {
      const rendered = renderOutlineNodesToMarkdown(selectedOutlineNodesQuery.data);
      return {
        ...raw,
        contentMarkdown: rendered,
        contentText: rendered,
      };
    }
    return raw;
  }, [selectedDoc, selectedDocDetailQuery.data, selectedOutlineNodesQuery.data]);

  const isQueueSourcesLoading =
    docsQuery.isPending || bindingsQuery.isPending || briefingRunsQuery.isPending;

  useEffect(() => {
    if (isQueueSourcesLoading && !effectiveUrlItemId) return;
    if (filteredItems.length === 0) {
      setSelectedItemId(null);
      return;
    }
    if (!selectedItemId || !filteredItems.some((item) => item.id === selectedItemId)) {
      if (isMdUp) {
        setSelectedItemId(filteredItems[0]?.id ?? null);
      }
    }
  }, [filteredItems, selectedItemId, isMdUp, isQueueSourcesLoading, effectiveUrlItemId]);

  const reviewDoc = selectedItem?.kind === "digest" ? selectedItem.doc : null;
  const reviewFullDoc =
    selectedItem?.kind === "digest" && selectedFullDoc?.id === selectedItem.doc.id
      ? selectedFullDoc
      : null;
  const reviewRevisionsQuery = useInkadeRevisions(reviewDoc?.id);

  const sortedReviewRevisions = useMemo(
    () => [...(reviewRevisionsQuery.data ?? [])].sort((a, b) => b.version - a.version),
    [reviewRevisionsQuery.data],
  );
  const latestReviewRevision = sortedReviewRevisions[0] ?? null;
  const previousReviewRevision = useMemo(() => {
    if (!reviewDoc) return null;
    return (
      sortedReviewRevisions.find((r) => r.version < reviewDoc.version) ??
      sortedReviewRevisions[1] ??
      null
    );
  }, [reviewDoc, sortedReviewRevisions]);

  const hasReviewDiff = Boolean(
    reviewFullDoc &&
      previousReviewRevision &&
      reviewFullDoc.kind !== "outline" &&
      previousReviewRevision.contentMarkdown !== reviewFullDoc.contentMarkdown,
  );

  const getNextSelectionIdAfterRemoving = useCallback(
    (removedItemId: string): string | null => {
      const idx = filteredItems.findIndex((item) => item.id === removedItemId);
      if (idx === -1) return filteredItems[0]?.id ?? null;
      const next = filteredItems[idx + 1] ?? filteredItems[idx - 1] ?? null;
      return next ? next.id : null;
    },
    [filteredItems],
  );

  const invalidateAllTriageQueries = useCallback(
    (docId?: DocumentId) => {
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "documents"] });
      if (docId) {
        void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.document(docId) });
        void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.revisions(docId) });
      }
      void queryClient.invalidateQueries({
        queryKey: [...inkadeQueryKeys.all, "thread-bindings"],
      });
      void queryClient.invalidateQueries({
        queryKey: [...inkadeQueryKeys.all, "audit-batches"],
      });
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.briefingJobs() });
      void queryClient.invalidateQueries({
        queryKey: [...inkadeQueryKeys.all, "briefing-runs"],
      });
      void queryClient.invalidateQueries({
        queryKey: [...inkadeQueryKeys.all, "away-summary"],
      });
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.workspaceSummary() });
    },
    [queryClient],
  );

  const animateTriageExit = useCallback(
    (itemId: string, docId?: DocumentId) => {
      setExitingItemIds((prev) => new Set(prev).add(itemId));
      window.setTimeout(() => {
        setExitingItemIds((prev) => {
          const next = new Set(prev);
          next.delete(itemId);
          return next;
        });
        invalidateAllTriageQueries(docId);
      }, 150);
    },
    [invalidateAllTriageQueries],
  );

  const moveToSpaceMutation = useMutation({
    mutationFn: (vars: { readonly doc: DocumentSummary; readonly spaceId: SpaceId }) =>
      client.documents.update(vars.doc.id, {
        spaceId: vars.spaceId,
        properties: {
          ...(vars.doc.properties ?? {}),
          inboxArchived: true,
        },
      }),
    onSuccess: (updated, vars) => {
      const itemId = selectedItem?.id ?? `clip:${vars.doc.id}`;
      setSelectedItemId(getNextSelectionIdAfterRemoving(itemId));
      animateTriageExit(itemId, updated.id);
      notifier.success(t("inbox.movedToSpace"), updated.title);
    },
    onError: (err) => notifier.error(t("inbox.moveFailed"), err),
  });

  const archiveOutMutation = useMutation({
    mutationFn: async (doc: DocumentSummary) => {
      const targetSpaceId = doc.spaceId === inboxSpaceId ? researchSpaceId : doc.spaceId;
      const nextProps: Record<string, unknown> = {
        ...(doc.properties ?? {}),
        inboxArchived: true,
      };
      const updated = await client.documents.update(doc.id, {
        spaceId: targetSpaceId,
        properties: nextProps,
      });
      return { updated, originalDoc: doc };
    },
    onSuccess: ({ updated, originalDoc }) => {
      const itemId = selectedItem?.id ?? `clip:${originalDoc.id}`;
      setSelectedItemId(getNextSelectionIdAfterRemoving(itemId));
      animateTriageExit(itemId, updated.id);
      const undoOpts = {
        title: t("inbox.archivedToast"),
        description: updated.title,
        onUndo: async () => {
          const restoredProps: Record<string, unknown> = { ...(originalDoc.properties ?? {}) };
          delete restoredProps["inboxArchived"];
          await client.documents.update(originalDoc.id, {
            spaceId: originalDoc.spaceId,
            properties: Object.keys(restoredProps).length > 0 ? restoredProps : null,
          });
          invalidateAllTriageQueries(originalDoc.id);
          setSelectedItemId(`clip:${originalDoc.id}`);
          notifier.success(t("inbox.restoredClip"), originalDoc.title);
        },
      };
      if (notifier.withUndo) {
        notifier.withUndo(undoOpts);
      } else {
        notifier.success(undoOpts.title, undoOpts.description);
      }
    },
    onError: (err) => notifier.error(t("inbox.archiveFailed"), err),
  });

  const snoozeItemMutation = useMutation({
    mutationFn: async (vars: {
      readonly item: UnifiedInboxEntry;
      readonly untilIso: string | null;
    }) => {
      if (vars.item.kind === "clip" || vars.item.kind === "digest") {
        await client.documents.update(vars.item.doc.id, {
          properties: withDocInboxSnooze(vars.item.doc.properties, vars.untilIso),
        });
      } else {
        setBindingInboxSnooze(vars.item.id, vars.untilIso);
      }
      return vars;
    },
    onSuccess: ({ item, untilIso }) => {
      setSnoozePopoverOpen(false);
      setSelectedItemId(getNextSelectionIdAfterRemoving(item.id));
      if (item.kind === "clip" || item.kind === "digest") {
        animateTriageExit(item.id, item.doc.id);
      }
      if (untilIso) {
        notifier.success(t("inbox.snoozedToast", { until: formatSnoozeUntilShort(untilIso) }));
      } else {
        notifier.success(t("inbox.wokenToast"));
      }
    },
    onError: (err) => notifier.error(t("inbox.snoozeFailed"), err),
  });

  const toggleUnreadMutation = useMutation({
    mutationFn: async (item: UnifiedInboxEntry) => {
      const nextUnread = !item.unread;
      if (item.kind === "clip" || item.kind === "digest") {
        await client.documents.update(item.doc.id, {
          properties: withDocInboxUnread(item.doc.properties, nextUnread),
        });
        return { item, nextUnread, docId: item.doc.id };
      }
      setBindingInboxUnread(item.id, nextUnread);
      return { item, nextUnread, docId: undefined };
    },
    onSuccess: ({ nextUnread, docId }) => {
      if (docId) {
        invalidateAllTriageQueries(docId);
      }
      notifier.success(nextUnread ? t("inbox.markedUnreadToast") : t("inbox.markedReadToast"));
    },
    onError: (err) => notifier.error(t("inbox.unreadToggleFailed"), err),
  });

  const clearReadMutation = useMutation({
    mutationFn: async () => {
      const readClips = unifiedItems.filter(
        (item): item is Extract<UnifiedInboxEntry, { kind: "clip" }> =>
          item.kind === "clip" && !item.unread,
      );
      if (readClips.length === 0) {
        return [] as DocumentSummary[];
      }
      const snapshots: DocumentSummary[] = [];
      for (const entry of readClips) {
        const doc = entry.doc;
        snapshots.push(doc);
        const targetSpaceId = doc.spaceId === inboxSpaceId ? researchSpaceId : doc.spaceId;
        await client.documents.update(doc.id, {
          spaceId: targetSpaceId,
          properties: {
            ...(doc.properties ?? {}),
            inboxArchived: true,
          },
        });
      }
      return snapshots;
    },
    onSuccess: (snapshots) => {
      if (snapshots.length === 0) {
        notifier.success(t("inbox.clearReadNone"));
        return;
      }
      invalidateAllTriageQueries();
      const undoOpts = {
        title: t("inbox.clearedReadToast", { count: snapshots.length }),
        onUndo: async () => {
          await Promise.all(
            snapshots.map((orig) => {
              const restoredProps: Record<string, unknown> = { ...(orig.properties ?? {}) };
              delete restoredProps["inboxArchived"];
              return client.documents.update(orig.id, {
                spaceId: orig.spaceId,
                properties: Object.keys(restoredProps).length > 0 ? restoredProps : null,
              });
            }),
          );
          invalidateAllTriageQueries();
          notifier.success(t("inbox.restoredClip"));
        },
      };
      if (notifier.withUndo) {
        notifier.withUndo(undoOpts);
      } else {
        notifier.success(undoOpts.title);
      }
    },
    onError: (err) => notifier.error(t("inbox.archiveFailed"), err),
  });

  const convertToArticleMutation = useMutation({
    mutationFn: async (doc: DocumentSummary | DocumentRecord) => {
      const fullDoc = "contentMarkdown" in doc ? doc : await client.documents.get(doc.id);
      const article = await client.documents.create({
        spaceId: researchSpaceId,
        kind: "article",
        title: fullDoc.title,
        contentMarkdown: fullDoc.contentMarkdown || `# ${fullDoc.title}\n\n`,
        tags: [...fullDoc.tags],
        ...(fullDoc.sourceUrl ? { sourceUrl: fullDoc.sourceUrl } : {}),
      });
      await client.documents.trash(fullDoc.id);
      return { article, origId: fullDoc.id };
    },
    onSuccess: ({ article, origId }) => {
      const itemId = selectedItem?.id ?? `clip:${origId}`;
      setSelectedItemId(getNextSelectionIdAfterRemoving(itemId));
      animateTriageExit(itemId, origId);
      const targetSpaceName =
        spaces.find((s) => s.id === researchSpaceId)?.name ?? researchSpaceId;
      notifier.success(
        t("inbox.convertedToArticle"),
        t("inbox.promotedStayToast", { title: article.title, space: targetSpaceName }),
      );
    },
    onError: (err) => notifier.error(t("inbox.convertFailed"), err),
  });

  const trashMutation = useMutation({
    mutationFn: (docId: DocumentId) => client.documents.trash(docId),
    onSuccess: (trashed) => {
      const itemId = selectedItem?.id ?? `clip:${trashed.id}`;
      setSelectedItemId(getNextSelectionIdAfterRemoving(itemId));
      animateTriageExit(itemId, trashed.id);
      const undoOpts = {
        title: t("inbox.removedClip", { title: trashed.title }),
        onUndo: async () => {
          await client.documents.restore(trashed.id);
          invalidateAllTriageQueries(trashed.id);
          setSelectedItemId(`clip:${trashed.id}`);
          notifier.success(t("inbox.restoredClip"), trashed.title);
        },
      };
      if (notifier.withUndo) {
        notifier.withUndo(undoOpts);
      } else {
        notifier.success(undoOpts.title);
      }
    },
    onError: (err) => notifier.error(t("inbox.trashFailed"), err),
  });

  const applyReviewMutation = useMutation({
    mutationFn: async (vars: {
      readonly doc: DocumentRecord;
      readonly resolvedMarkdown: string;
    }) => {
      if (vars.resolvedMarkdown !== vars.doc.contentMarkdown) {
        return client.documents.update(vars.doc.id, {
          contentMarkdown: vars.resolvedMarkdown,
          unreadAgentUpdate: false,
          expectedVersion: vars.doc.version,
          changeSummary: t("reviewCenter.reviewAppliedToast"),
        });
      }
      return client.documents.markAgentUpdateRead(vars.doc.id);
    },
    onSuccess: (updated) => {
      setSelectedItemId(getNextSelectionIdAfterRemoving(`rev:${updated.id}`));
      invalidateAllTriageQueries(updated.id);
      notifier.success(t("reviewCenter.reviewAppliedToast"));
    },
    onError: (err) => notifier.error(t("reviewCenter.reviewApplyFailed"), err),
  });

  const markReadMutation = useMutation({
    mutationFn: (docId: DocumentId) => client.documents.acknowledgeSilent(docId),
    onSuccess: (updated) => {
      setSelectedItemId(getNextSelectionIdAfterRemoving(`rev:${updated.id}`));
      invalidateAllTriageQueries(updated.id);
      notifier.success(t("reviewCenter.reviewMarkedReadToast"));
    },
    onError: (err) => notifier.error(t("reviewCenter.reviewApplyFailed"), err),
  });

  const undoBatchMutation = useMutation({
    mutationFn: (vars: { readonly batchId: AuditBatchId; readonly force?: boolean | undefined }) =>
      client.auditLogs.rollbackBatch(vars.batchId, vars.force ? { force: true } : undefined),
    onSuccess: (result, vars) => {
      if (result.conflicts.length > 0 && !vars.force) {
        setRollbackConflictPrompt({
          batchId: vars.batchId,
          conflicts: result.conflicts,
        });
        return;
      }
      setRollbackConflictPrompt(null);
      if (selectedItem?.kind === "digest" && selectedItem.batchId === vars.batchId) {
        setSelectedItemId(getNextSelectionIdAfterRemoving(selectedItem.id));
      }
      invalidateAllTriageQueries(selectedDoc?.id);
      notifier.success(t("inbox.undoBatchSuccess", { count: result.rolledBackCount }));
    },
    onError: (err) => notifier.error(t("inbox.undoBatchFailed"), err),
  });

  const patchBindingCaches = useCallback(
    (updated: AdeThreadBinding) => {
      queryClient.setQueriesData<readonly AdeThreadBinding[]>(
        { queryKey: [...inkadeQueryKeys.all, "thread-bindings"] },
        (prev) => (prev ? prev.map((b) => (b.id === updated.id ? updated : b)) : prev),
      );
    },
    [queryClient],
  );

  const approveBindingMutation = useMutation({
    mutationFn: (vars: {
      readonly bindingId: ThreadBindingId;
      readonly decision: AgentApprovalDecision;
      readonly note?: string | undefined;
    }) =>
      client.threadBindings.approve(vars.bindingId, {
        decision: vars.decision,
        ...(vars.note ? { note: vars.note } : {}),
      }),
    onSuccess: (updated, vars) => {
      patchBindingCaches(updated);
      setRecentApprovalIds((prev) => new Set(prev).add(vars.bindingId));
      invalidateAllTriageQueries();
      notifier.success(t("agentControl.approvalSuccessToast"));
    },
    onError: (err) => notifier.error(t("agentControl.approvalFailedToast"), err),
  });

  const undoApprovalMutation = useMutation({
    mutationFn: async (binding: AdeThreadBinding) => {
      if (!binding.pendingApproval) return binding;
      return client.threadBindings.update(binding.id, {
        status: "waiting_input",
        pendingApproval: {
          ...binding.pendingApproval,
          decision: null,
          decisionNote: null,
          decidedAt: null,
        },
      });
    },
    onSuccess: (updated, binding) => {
      patchBindingCaches(updated);
      setRecentApprovalIds((prev) => {
        const next = new Set(prev);
        next.delete(binding.id);
        return next;
      });
      invalidateAllTriageQueries();
      notifier.success(t("agentControl.approvalUndoToast"));
    },
    onError: (err) => notifier.error(t("agentControl.approvalFailedToast"), err),
  });

  const steerBindingMutation = useMutation({
    mutationFn: (vars: {
      readonly bindingId: ThreadBindingId;
      readonly text: string;
      readonly mode: AgentSteeringMode;
    }) =>
      client.threadBindings.steer(vars.bindingId, {
        text: vars.text,
        mode: vars.mode,
      }),
    onSuccess: (_data, vars) => {
      setSteeringDraftById((prev) => ({ ...prev, [vars.bindingId]: "" }));
      invalidateAllTriageQueries();
      notifier.success(t("agentControl.steeringSentToast"));
    },
    onError: (err) => notifier.error(t("agentControl.steeringFailedToast"), err),
  });

  const retryBindingMutation = useMutation({
    mutationFn: (bindingId: ThreadBindingId) =>
      client.threadBindings.update(bindingId, { status: "queued" }),
    onSuccess: (_data, bindingId) => {
      setSelectedItemId(getNextSelectionIdAfterRemoving(`fail:${bindingId}`));
      invalidateAllTriageQueries();
      notifier.success(t("agentControl.threadsRetrySuccess"));
    },
    onError: (err) => notifier.error(t("threads.updateFailed"), err),
  });

  const archiveBindingMutation = useMutation({
    mutationFn: (bindingId: ThreadBindingId) =>
      client.threadBindings.update(bindingId, { status: "archived" }),
    onSuccess: (_data, bindingId) => {
      setSelectedItemId(getNextSelectionIdAfterRemoving(`fail:${bindingId}`));
      invalidateAllTriageQueries();
      notifier.success(t("inbox.archivedThreadToast"));
    },
    onError: (err) => notifier.error(t("threads.updateFailed"), err),
  });

  const retryBriefingMutation = useMutation({
    mutationFn: ({ jobId }: { readonly jobId: BriefingJobId; readonly itemId: string }) =>
      client.briefings.runJobNow(jobId),
    onSuccess: (run, vars) => {
      invalidateAllTriageQueries(run.documentId ?? undefined);
      if (run.status === "failed") {
        notifier.error(t("briefings.runFailedToast"), run.errorMessage ?? undefined);
        return;
      }
      setSelectedItemId(getNextSelectionIdAfterRemoving(vars.itemId));
      notifier.success(t("inbox.retryBriefingSuccess"));
    },
    onError: (err) => notifier.error(t("briefings.runFailedToast"), err),
  });

  const dismissBriefingMutation = useMutation({
    mutationFn: (runId: BriefingRunId) => client.briefings.dismissRun(runId),
    onSuccess: (_data, runId) => {
      setSelectedItemId(getNextSelectionIdAfterRemoving(`brf:${runId}`));
      invalidateAllTriageQueries();
      notifier.success(t("inbox.dismissBriefingSuccess"));
    },
    onError: (err) => notifier.error(t("briefings.saveFailedToast"), err),
  });

  const handleOpenWikilink = useCallback(
    (targetSlugOrTitle: string) => {
      const base = (targetSlugOrTitle.split("#")[0] ?? targetSlugOrTitle).trim().toLowerCase();
      const matched = allDocs.find(
        (d) =>
          d.trashedAt === null &&
          (d.id.toLowerCase() === base ||
            d.slug.toLowerCase() === base ||
            d.title.toLowerCase() === base),
      );
      if (matched) {
        navigation.openDocument(matched.id);
      }
    },
    [allDocs, navigation],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent): void => {
      if (
        isImeEvent(event) ||
        isEditableEventTarget(event.target) ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      ) {
        return;
      }

      const target = event.target as HTMLElement | null;
      if (target?.closest('[role="dialog"], [role="menu"]')) {
        return;
      }
      if (dispatchTarget || moveMenuOpen) {
        return;
      }

      if (event.shiftKey && event.key === "Backspace") {
        event.preventDefault();
        if (!clearReadMutation.isPending && !isReadOnly) {
          clearReadMutation.mutate();
        }
        return;
      }

      if (snoozePopoverOpen || filteredItems.length === 0) {
        return;
      }

      const lowerKey = event.key.toLowerCase();
      if (hasReviewDiff && ["y", "n", "z"].includes(lowerKey)) {
        return;
      }

      const currentIdx = selectedItem
        ? filteredItems.findIndex((item) => item.id === selectedItem.id)
        : -1;

      if (event.key === "ArrowDown" || lowerKey === "j") {
        event.preventDefault();
        const nextIdx = Math.min(filteredItems.length - 1, currentIdx < 0 ? 0 : currentIdx + 1);
        const nextItem = filteredItems[nextIdx];
        if (nextItem) {
          setSelectedItemId(nextItem.id);
          scrollToIndexRef.current?.(nextIdx);
        }
        return;
      }

      if (event.key === "ArrowUp" || lowerKey === "k") {
        event.preventDefault();
        const nextIdx = Math.max(0, currentIdx < 0 ? 0 : currentIdx - 1);
        const nextItem = filteredItems[nextIdx];
        if (nextItem) {
          setSelectedItemId(nextItem.id);
          scrollToIndexRef.current?.(nextIdx);
        }
        return;
      }

      if (!selectedItem) return;

      if (lowerKey === "h") {
        event.preventDefault();
        setCustomSnoozeDate(todayStr);
        setSnoozePopoverOpen((prev) => !prev);
        return;
      }

      if (lowerKey === "u") {
        event.preventDefault();
        if (!toggleUnreadMutation.isPending && !isReadOnly) {
          toggleUnreadMutation.mutate(selectedItem);
        }
        return;
      }

      if (selectedItem.kind === "failed" && lowerKey === "e") {
        event.preventDefault();
        if (!archiveBindingMutation.isPending && !isReadOnly) {
          archiveBindingMutation.mutate(selectedItem.binding.id);
        }
        return;
      }

      if (selectedItem.kind === "briefing_failed" && lowerKey === "e") {
        event.preventDefault();
        if (!dismissBriefingMutation.isPending && !isReadOnly) {
          dismissBriefingMutation.mutate(selectedItem.briefingRun.id);
        }
        return;
      }

      if (!selectedDoc || isReadOnly) return;

      if (lowerKey === "m") {
        event.preventDefault();
        setMoveMenuOpen(true);
      } else if (lowerKey === "a" && selectedItem.kind === "clip") {
        event.preventDefault();
        if (!convertToArticleMutation.isPending) {
          convertToArticleMutation.mutate(selectedDoc);
        }
      } else if (lowerKey === "d") {
        event.preventDefault();
        setDispatchTarget({
          documentId: selectedDoc.id,
          documentTitle: selectedDoc.title,
          excerpt: selectedDoc.excerpt || selectedFullDoc?.contentText.slice(0, 260) || "",
        });
      } else if (lowerKey === "e") {
        event.preventDefault();
        if (selectedItem.kind === "digest") {
          if (!markReadMutation.isPending) {
            markReadMutation.mutate(selectedDoc.id);
          }
        } else if (!archiveOutMutation.isPending) {
          archiveOutMutation.mutate(selectedDoc);
        }
      } else if (event.key === "Backspace" && !event.shiftKey && selectedItem.kind === "clip") {
        event.preventDefault();
        if (!trashMutation.isPending) {
          trashMutation.mutate(selectedDoc.id);
        }
      }
    },
    [
      archiveBindingMutation,
      archiveOutMutation,
      clearReadMutation,
      convertToArticleMutation,
      dismissBriefingMutation,
      dispatchTarget,
      filteredItems,
      hasReviewDiff,
      isReadOnly,
      markReadMutation,
      moveMenuOpen,
      scrollToIndexRef,
      selectedDoc,
      selectedFullDoc?.contentText,
      selectedItem,
      snoozePopoverOpen,
      todayStr,
      toggleUnreadMutation,
      trashMutation,
    ],
  );

  useEventListener("keydown", handleKeyDown);

  const isLoadingAll =
    (docsQuery.isPending || bindingsQuery.isPending || briefingRunsQuery.isPending) &&
    unifiedItems.length === 0 &&
    snoozedItems.length === 0;

  const isEmptyInboxZero =
    !docsQuery.isPending &&
    !bindingsQuery.isPending &&
    !briefingRunsQuery.isPending &&
    unifiedItems.length === 0 &&
    snoozedItems.length === 0;

  return {
    t,
    navigation,
    hostActions,
    isReadOnly,
    effectiveTheme,
    isMdUp,
    todayStr,
    spaces,
    allDocs,
    docsById,
    docTitlesRecord,
    inboxSpaceId,
    targetSpaces,
    activeTab,
    setActiveTab,
    filterText,
    setFilterText,
    tabCounts,
    unifiedItems,
    snoozedItems,
    filteredItems,
    exitingItemIds,
    selectedItemId,
    setSelectedItemId,
    selectItemAndSyncUrl,
    selectedItem,
    selectedFullDoc,
    selectedDocDetailQuery,
    reviewFullDoc,
    reviewRevisionsQuery,
    latestReviewRevision,
    previousReviewRevision,
    hasReviewDiff,
    rollbackConflictPrompt,
    setRollbackConflictPrompt,
    moveMenuOpen,
    setMoveMenuOpen,
    snoozePopoverOpen,
    setSnoozePopoverOpen,
    customSnoozeDate,
    setCustomSnoozeDate,
    dispatchTarget,
    setDispatchTarget,
    steeringDraftById,
    setSteeringDraftById,
    steeringModeById,
    setSteeringModeById,
    isLoadingAll,
    isEmptyInboxZero,
    handleOpenWikilink,
    moveToSpaceMutation,
    archiveOutMutation,
    snoozeItemMutation,
    toggleUnreadMutation,
    clearReadMutation,
    convertToArticleMutation,
    trashMutation,
    applyReviewMutation,
    markReadMutation,
    undoBatchMutation,
    approveBindingMutation,
    undoApprovalMutation,
    steerBindingMutation,
    retryBindingMutation,
    archiveBindingMutation,
    retryBriefingMutation,
    dismissBriefingMutation,
  };
}
