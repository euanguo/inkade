import type {
  DocumentId,
  DocumentSummary,
  SavedView,
  SavedViewDisplayMode,
  SavedViewFilter,
  SavedViewSortRule,
  SpaceId,
  TaskPriority,
} from "@inkade/core";
import type { useInkadeTranslation } from "@inkade/i18n";
import { inkadeQueryKeys } from "@inkade/sdk";
import { useInkadeClient } from "@inkade/sdk/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useInkadeViewsContext } from "../../context.tsx";

export interface UseLibraryMutationsOptions {
  readonly t: ReturnType<typeof useInkadeTranslation>["t"];
  readonly activeSavedView: SavedView | null;
  readonly currentViewFilterSnapshot: SavedViewFilter;
  readonly currentDisplayMode?: SavedViewDisplayMode | undefined;
  readonly currentGroupByField?: string | null | undefined;
  readonly currentVisibleColumns?: readonly string[] | null | undefined;
  readonly currentColumnWidths?: Readonly<Record<string, number>> | null | undefined;
  readonly currentSortRules?: readonly SavedViewSortRule[] | null | undefined;
  readonly selectedDocs: readonly DocumentSummary[];
  readonly selectedDocId: DocumentId | null;
  readonly studioDocId: DocumentId | null;
  readonly onClearSelection: () => void;
  readonly onClearSelectedDoc: () => void;
  readonly onClearStudioDoc: () => void;
  readonly onClearPriorityEditor: () => void;
  readonly onBulkTagApplied: () => void;
}

export function useLibraryMutations({
  t,
  activeSavedView,
  currentViewFilterSnapshot,
  currentDisplayMode,
  currentGroupByField,
  currentVisibleColumns,
  currentColumnWidths,
  currentSortRules,
  selectedDocs,
  selectedDocId,
  studioDocId,
  onClearSelection,
  onClearSelectedDoc,
  onClearStudioDoc,
  onClearPriorityEditor,
  onBulkTagApplied,
}: UseLibraryMutationsOptions) {
  const client = useInkadeClient();
  const { notifier } = useInkadeViewsContext();
  const queryClient = useQueryClient();

  const invalidateDocsQueries = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "documents"] });
    void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "view-query"] });
    void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.workspaceSummary() });
  }, [queryClient]);

  const saveViewLayoutMutation = useMutation({
    mutationFn: async () => {
      if (!activeSavedView) return null;
      return client.savedViews.update(activeSavedView.id, {
        filter: currentViewFilterSnapshot,
        ...(currentDisplayMode !== undefined ? { displayMode: currentDisplayMode } : {}),
        ...(currentGroupByField !== undefined ? { groupByField: currentGroupByField } : {}),
        ...(currentVisibleColumns !== undefined
          ? {
              visibleColumns: currentVisibleColumns ? [...currentVisibleColumns] : null,
            }
          : {}),
        ...(currentColumnWidths !== undefined
          ? { columnWidths: currentColumnWidths ? { ...currentColumnWidths } : null }
          : {}),
        ...(currentSortRules !== undefined
          ? { sortRules: currentSortRules ? [...currentSortRules] : null }
          : {}),
      });
    },
    onSuccess: (updated) => {
      if (!updated) return;
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.savedViews() });
      notifier.success(t("library.viewLayoutSaved"), updated.name);
    },
    onError: (err) => notifier.error(t("library.viewLayoutSaveFailed"), err),
  });

  const quickUpdatePropertiesMutation = useMutation({
    mutationFn: ({
      docId,
      properties,
    }: {
      readonly docId: DocumentId;
      readonly properties: Record<string, unknown> | null;
    }) => client.documents.update(docId, { properties }),
    onSuccess: (_updated, variables) => {
      invalidateDocsQueries();
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.document(variables.docId) });
      notifier.success(t("library.quickEditCellSaved"));
    },
    onError: (err) => notifier.error(t("library.quickEditCellFailed"), err),
  });

  const togglePinMutation = useMutation({
    mutationFn: ({ docId, pinned }: { readonly docId: DocumentId; readonly pinned: boolean }) =>
      client.documents.update(docId, { pinned }),
    onSuccess: (_updated, variables) => {
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "documents"] });
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.document(variables.docId) });
      notifier.success(t("library.pinUpdated"));
    },
    onError: (err) => notifier.error(t("library.pinFailed"), err),
  });

  const quickMoveSpaceMutation = useMutation({
    mutationFn: ({
      docId,
      spaceId: targetSpaceId,
    }: {
      readonly docId: DocumentId;
      readonly spaceId: SpaceId;
    }) => client.documents.update(docId, { spaceId: targetSpaceId }),
    onSuccess: (_updated, variables) => {
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "documents"] });
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.document(variables.docId) });
      notifier.success(t("document.movedSpace"));
    },
    onError: (err) => notifier.error(t("document.moveSpaceFailed"), err),
  });

  const quickUpdateTagsMutation = useMutation({
    mutationFn: ({
      docId,
      tags,
    }: {
      readonly docId: DocumentId;
      readonly tags: readonly string[];
    }) => client.documents.update(docId, { tags: [...tags] }),
    onSuccess: (_updated, variables) => {
      invalidateDocsQueries();
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.document(variables.docId) });
      notifier.success(t("library.tagsUpdatedToast"));
    },
    onError: (err) => notifier.error(t("library.tagsUpdateFailed"), err),
  });

  const quickUpdatePriorityMutation = useMutation({
    mutationFn: ({
      doc,
      priority,
    }: {
      readonly doc: DocumentSummary;
      readonly priority: TaskPriority;
    }) => {
      const nextProps: Record<string, unknown> = { ...(doc.properties ?? {}) };
      if (priority === "none") {
        delete nextProps["priority"];
      } else {
        nextProps["priority"] = priority;
      }
      return client.documents.update(doc.id, { properties: nextProps });
    },
    onSuccess: (_updated, variables) => {
      onClearPriorityEditor();
      invalidateDocsQueries();
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.document(variables.doc.id) });
      notifier.success(t("library.priorityUpdatedToast"));
    },
    onError: (err) => notifier.error(t("library.priorityUpdateFailed"), err),
  });

  const bulkMoveSpaceMutation = useMutation({
    mutationFn: async (targetSpaceId: SpaceId) => {
      const targets = selectedDocs;
      await Promise.all(
        targets.map((doc) =>
          client.documents.update(doc.id, { spaceId: targetSpaceId }),
        ),
      );
      return targets.length;
    },
    onSuccess: (count) => {
      onClearSelection();
      invalidateDocsQueries();
      notifier.success(t("library.bulkMovedToast", { count }));
    },
    onError: (err) => notifier.error(t("library.bulkActionFailed"), err),
  });

  const bulkAddTagMutation = useMutation({
    mutationFn: async (rawTag: string) => {
      const cleanTag = rawTag.trim().replace(/^#+/, "");
      if (!cleanTag) return { cleanTag: "", count: 0 };
      const targets = selectedDocs;
      await Promise.all(
        targets.map((doc) => {
          if (doc.tags.includes(cleanTag)) return Promise.resolve(doc);
          return client.documents.update(doc.id, {
            tags: [...doc.tags, cleanTag],
          });
        }),
      );
      return { cleanTag, count: targets.length };
    },
    onSuccess: ({ cleanTag, count }) => {
      if (!cleanTag) return;
      onBulkTagApplied();
      onClearSelection();
      invalidateDocsQueries();
      notifier.success(t("library.bulkTaggedToast", { tag: cleanTag, count }));
    },
    onError: (err) => notifier.error(t("library.bulkActionFailed"), err),
  });

  const bulkPinMutation = useMutation({
    mutationFn: async (nextPinned: boolean) => {
      const targets = selectedDocs;
      await Promise.all(
        targets.map((doc) =>
          client.documents.update(doc.id, { pinned: nextPinned }),
        ),
      );
      return targets.length;
    },
    onSuccess: (count) => {
      onClearSelection();
      invalidateDocsQueries();
      notifier.success(t("library.bulkPinnedToast", { count }));
    },
    onError: (err) => notifier.error(t("library.bulkActionFailed"), err),
  });

  const bulkTrashMutation = useMutation({
    mutationFn: async () => {
      const ids = selectedDocs.map((d) => d.id);
      await Promise.all(ids.map((id) => client.documents.trash(id)));
      return ids;
    },
    onSuccess: (ids) => {
      const idSet = new Set(ids);
      onClearSelection();
      if (selectedDocId && idSet.has(selectedDocId)) {
        onClearSelectedDoc();
      }
      if (studioDocId && idSet.has(studioDocId)) {
        onClearStudioDoc();
      }
      invalidateDocsQueries();
      notifier.withUndo?.({
        title: t("library.bulkTrashedToast", { count: ids.length }),
        onUndo: async () => {
          await Promise.all(ids.map((id) => client.documents.restore(id)));
          invalidateDocsQueries();
          notifier.success(t("library.bulkRestoredToast", { count: ids.length }));
        },
      });
    },
    onError: (err) => notifier.error(t("library.bulkActionFailed"), err),
  });

  return {
    saveViewLayoutMutation,
    quickUpdatePropertiesMutation,
    togglePinMutation,
    quickMoveSpaceMutation,
    quickUpdateTagsMutation,
    quickUpdatePriorityMutation,
    bulkMoveSpaceMutation,
    bulkAddTagMutation,
    bulkPinMutation,
    bulkTrashMutation,
  };
}
