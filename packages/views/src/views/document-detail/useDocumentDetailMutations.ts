import {
  asSpaceId,
  type AuditBatchId,
  type BatchOutlineNodesResult,
  type BatchRollbackConflict,
  type BridgeSessionId,
  type CreateOutlineNodeInput,
  type DocumentId,
  type DocumentRecord,
  type HighlightColor,
  type HighlightId,
  type MoveOutlineNodeInput,
  type OutlineBatchOperation,
  type OutlineNodeId,
  type ReaderTypographyPrefs,
  type SelectionAnchor,
  type Space,
  type SpaceId,
  type ThreadBindingId,
  type UpdateOutlineNodeInput,
} from "@inkade/core";
import type { useInkadeTranslation } from "@inkade/i18n";
import { InkadeApiError, inkadeQueryKeys } from "@inkade/sdk";
import {
  useAddHighlightCommentMutation,
  useCreateShareLinkMutation,
  useInkadeClient,
  useReopenHighlightMutation,
  useResolveHighlightMutation,
  useRevokeShareLinkMutation,
  useSendHighlightToAgentMutation,
} from "@inkade/sdk/react";
import {
  buildStandaloneDocumentHtml,
  type MarginaliaDeliveryReceipt,
  triggerDocxFileDownload,
  triggerHtmlFileDownload,
} from "@inkade/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type React from "react";
import { useCallback, useState } from "react";
import { useInkadeViewsContext } from "../../context.tsx";

export interface UseDocumentDetailMutationsOptions {
  readonly t: ReturnType<typeof useInkadeTranslation>["t"];
  readonly documentId: DocumentId;
  readonly doc: DocumentRecord | null;
  readonly today: string;
  readonly spaces: readonly Space[];
  readonly splitDocId: DocumentId | null;
  readonly effectiveTheme: "light" | "dark";
  readonly typographyPrefs: ReaderTypographyPrefs;
  readonly latestDraftRef: React.MutableRefObject<string>;
  readonly primaryContentRef: React.RefObject<HTMLDivElement | null>;
  readonly setHasConflict: React.Dispatch<React.SetStateAction<boolean>>;
  readonly setConflictServerDoc: React.Dispatch<React.SetStateAction<DocumentRecord | null>>;
  readonly setIsDirty: React.Dispatch<React.SetStateAction<boolean>>;
  readonly setAutosaveStatus: React.Dispatch<
    React.SetStateAction<"idle" | "saving" | "saved" | "unsaved">
  >;
  readonly setShowAgentDiff: React.Dispatch<React.SetStateAction<boolean>>;
  readonly setUndoBatchConflict: React.Dispatch<
    React.SetStateAction<{
      readonly batchId: AuditBatchId;
      readonly conflicts: readonly BatchRollbackConflict[];
    } | null>
  >;
}

export function useDocumentDetailMutations({
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
}: UseDocumentDetailMutationsOptions) {
  const client = useInkadeClient();
  const { navigation, notifier } = useInkadeViewsContext();
  const queryClient = useQueryClient();

  const createShareLinkMutation = useCreateShareLinkMutation({
    onSuccess: () => {
      notifier.success(t("inspector.shareLinkCreated"));
    },
    onError: (err) => notifier.error(t("inspector.shareLinkCreateFailed"), err),
  });
  const quickShareMutation = {
    ...createShareLinkMutation,
    mutate: () => createShareLinkMutation.mutate({ documentId }),
    mutateAsync: () => createShareLinkMutation.mutateAsync({ documentId }),
  };

  const revokeShareLinkMutation = useRevokeShareLinkMutation({
    onSuccess: () => {
      notifier.success(t("inspector.shareLinkRevoked"));
    },
    onError: (err) => notifier.error(t("inspector.shareLinkRevokeFailed"), err),
  });

  const handlePrimaryOutlineBatch = useCallback(
    async (
      operations: readonly OutlineBatchOperation[],
    ): Promise<BatchOutlineNodesResult | void> => {
      if (!doc) return;
      try {
        const result = await client.outlineNodes.batch({
          documentId: doc.id,
          operations: [...operations],
        });
        queryClient.setQueryData(inkadeQueryKeys.outlineNodes(doc.id), result.nodes);
        void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.document(doc.id) });
        return result;
      } catch (err) {
        notifier.error(t("daily.batchSaveFailed"), err);
        void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.outlineNodes(doc.id) });
        return undefined;
      }
    },
    [client.outlineNodes, doc, notifier, queryClient, t],
  );

  const handleSplitOutlineBatch = useCallback(
    async (
      operations: readonly OutlineBatchOperation[],
    ): Promise<BatchOutlineNodesResult | void> => {
      if (!splitDocId) return;
      try {
        const result = await client.outlineNodes.batch({
          documentId: splitDocId,
          operations: [...operations],
        });
        queryClient.setQueryData(inkadeQueryKeys.outlineNodes(splitDocId), result.nodes);
        return result;
      } catch (err) {
        notifier.error(t("daily.batchSaveFailed"), err);
        void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.outlineNodes(splitDocId) });
        return undefined;
      }
    },
    [client.outlineNodes, notifier, queryClient, splitDocId, t],
  );

  const saveMutation = useMutation({
    mutationFn: (payload: {
      readonly targetDocId: DocumentId;
      readonly markdown: string;
      readonly expectedVersion: number;
      readonly silent?: boolean;
    }) =>
      client.documents.update(payload.targetDocId, {
        contentMarkdown: payload.markdown,
        expectedVersion: payload.expectedVersion,
      }),
    onSuccess: (updated, vars) => {
      queryClient.setQueryData(inkadeQueryKeys.document(vars.targetDocId), updated);
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "documents"] });
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.revisions(vars.targetDocId) });
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.backlinks(vars.targetDocId) });
      void queryClient.invalidateQueries({
        queryKey: inkadeQueryKeys.documentGraph(vars.targetDocId, 2),
      });
      if (vars.targetDocId === documentId) {
        setHasConflict(false);
        setConflictServerDoc(null);
        const stillSameDraft = latestDraftRef.current === vars.markdown;
        setIsDirty(!stillSameDraft);
        setAutosaveStatus(stillSameDraft ? "saved" : "unsaved");
      }
      if (!vars.silent) {
        notifier.success(t("document.saved"), t("common.version", { version: updated.version }));
      }
    },
    onError: async (err, vars) => {
      if (vars.targetDocId !== documentId) return;
      if (err instanceof InkadeApiError && (err.status === 409 || err.code === "VERSION_CONFLICT")) {
        setHasConflict(true);
        setAutosaveStatus("unsaved");
        try {
          const latest = await client.documents.get(vars.targetDocId);
          setConflictServerDoc(latest);
        } catch {
          // ignore secondary fetch failure
        }
        notifier.error(t("document.conflictToastTitle"), t("document.conflictToastDesc"));
        return;
      }
      setAutosaveStatus("unsaved");
      notifier.error(t("document.saveFailed"), err);
    },
  });

  const updateTitleMutation = useMutation({
    mutationFn: (payload: { readonly title: string; readonly syncBacklinks: boolean }) =>
      client.documents.update(documentId, {
        title: payload.title,
        syncBacklinks: payload.syncBacklinks,
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(inkadeQueryKeys.document(documentId), updated);
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "documents"] });
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.backlinks(documentId) });
      setAutosaveStatus("saved");
    },
    onError: (err) => notifier.error(t("document.titleUpdateFailed"), err),
  });

  const updateTagsMutation = useMutation({
    mutationFn: (tags: readonly string[]) =>
      client.documents.update(documentId, { tags: [...tags] }),
    onSuccess: (updated) => {
      queryClient.setQueryData(inkadeQueryKeys.document(documentId), updated);
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "documents"] });
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.workspaceSummary() });
      notifier.success(t("document.tagsUpdated"));
    },
    onError: (err) => notifier.error(t("document.tagsUpdateFailed"), err),
  });

  const updatePropsMutation = useMutation({
    mutationFn: (properties: Record<string, unknown> | null) =>
      client.documents.update(documentId, { properties }),
    onSuccess: (updated) => {
      queryClient.setQueryData(inkadeQueryKeys.document(documentId), updated);
    },
    onError: (err) => notifier.error(t("document.saveFailed"), err),
  });

  const pinMutation = useMutation({
    mutationFn: (pinned: boolean) => client.documents.update(documentId, { pinned }),
    onSuccess: (updated) => {
      queryClient.setQueryData(inkadeQueryKeys.document(documentId), updated);
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "documents"] });
      notifier.success(updated.pinned ? t("document.pinnedToast") : t("document.unpinnedToast"));
    },
    onError: (err) => notifier.error(t("document.pinFailed"), err),
  });

  const moveSpaceMutation = useMutation({
    mutationFn: (spaceId: SpaceId) => client.documents.update(documentId, { spaceId }),
    onSuccess: (updated) => {
      queryClient.setQueryData(inkadeQueryKeys.document(documentId), updated);
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "documents"] });
      notifier.success(t("document.movedSpace"));
    },
    onError: (err) => notifier.error(t("document.moveSpaceFailed"), err),
  });

  const acknowledgeSilentMutation = useMutation({
    mutationFn: () => client.documents.acknowledgeSilent(documentId),
    onSuccess: (updated) => {
      queryClient.setQueryData(inkadeQueryKeys.document(documentId), updated);
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "documents"] });
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.workspaceSummary() });
    },
  });

  const markAgentReadMutation = useMutation({
    mutationFn: () => client.documents.acknowledgeSilent(documentId),
    onSuccess: (updated) => {
      queryClient.setQueryData(inkadeQueryKeys.document(documentId), updated);
      setShowAgentDiff(false);
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "documents"] });
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.workspaceSummary() });
      notifier.success(t("document.markedAgentRead"));
    },
    onError: (err) => notifier.error(t("document.actionFailed"), err),
  });

  const undoBatchMutation = useMutation({
    mutationFn: (vars: { readonly batchId: AuditBatchId; readonly force?: boolean | undefined }) =>
      client.auditLogs.rollbackBatch(vars.batchId, vars.force ? { force: true } : undefined),
    onSuccess: (result, vars) => {
      if (result.conflicts.length > 0 && !vars.force) {
        setUndoBatchConflict({ batchId: vars.batchId, conflicts: result.conflicts });
        return;
      }
      setUndoBatchConflict(null);
      setShowAgentDiff(false);
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.document(documentId) });
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.revisions(documentId) });
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "documents"] });
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "audit-batches"] });
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.workspaceSummary() });
      notifier.success(t("inbox.undoBatchSuccess", { count: result.rolledBackCount }));
    },
    onError: (err) => notifier.error(t("inbox.undoBatchFailed"), err),
  });

  const trashMutation = useMutation({
    mutationFn: () => client.documents.trash(documentId),
    onSuccess: (trashed) => {
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "documents"] });
      notifier.withUndo?.({
        title: t("document.trashedToast", { title: trashed.title }),
        onUndo: async () => {
          await client.documents.restore(trashed.id);
          void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "documents"] });
          void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.document(trashed.id) });
          notifier.success(t("document.restoredToast"), trashed.title);
        },
      });
      navigation.openLibrary();
    },
    onError: (err) => notifier.error(t("document.trashFailed"), err),
  });

  const createHighlightMutation = useMutation({
    mutationFn: (input: {
      readonly quote: string;
      readonly prefixContext: string;
      readonly suffixContext: string;
      readonly color: HighlightColor;
      readonly noteMarkdown?: string;
    }) => client.highlights.create(documentId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.highlights(documentId) });
      notifier.success(t("document.highlightCreated"));
    },
    onError: (err) => notifier.error(t("document.highlightFailed"), err),
  });

  const updateHighlightMutation = useMutation({
    mutationFn: (payload: {
      readonly highlightId: HighlightId;
      readonly patch: { readonly color?: HighlightColor; readonly noteMarkdown?: string };
    }) => client.highlights.update(payload.highlightId, payload.patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.highlights(documentId) });
      notifier.success(t("document.highlightUpdated"));
    },
    onError: (err) => notifier.error(t("document.highlightFailed"), err),
  });

  const deleteHighlightMutation = useMutation({
    mutationFn: (highlightId: HighlightId) => client.highlights.delete(highlightId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.highlights(documentId) });
      void queryClient.invalidateQueries({
        queryKey: [...inkadeQueryKeys.all, "comment-threads", documentId],
      });
      notifier.success(t("document.highlightDeleted"));
    },
    onError: (err) => notifier.error(t("document.highlightFailed"), err),
  });

  const [deliveryReceipts, setDeliveryReceipts] = useState<
    Readonly<Record<string, MarginaliaDeliveryReceipt>>
  >({});

  const addCommentMutation = useAddHighlightCommentMutation({
    onSuccess: () => {
      notifier.success(t("document.commentAdded"));
    },
    onError: (err) => notifier.error(t("document.commentFailed"), err),
  });

  const sendHighlightToAgentMutation = useSendHighlightToAgentMutation({
    onSuccess: (result) => {
      setDeliveryReceipts((prev) => ({
        ...prev,
        [result.highlight.id]: {
          deliveryTarget: result.deliveryTarget,
          wakeStatus: result.wakeEvent.deliveryStatus,
          agentLabel:
            result.wakeEvent.targetAdeKind ?? result.wakeEvent.senderName,
        },
      }));
      notifier.success(
        result.deliveryTarget === "unowned"
          ? t("document.sentToAgentUnowned")
          : t("document.sentToAgentBound"),
      );
    },
    onError: (err) => notifier.error(t("document.sentToAgentFailed"), err),
  });

  const resolveHighlightMutation = useResolveHighlightMutation({
    onSuccess: () => {
      notifier.success(t("document.threadResolved"));
    },
    onError: (err) => notifier.error(t("document.highlightFailed"), err),
  });

  const reopenHighlightMutation = useReopenHighlightMutation({
    onSuccess: () => {
      notifier.success(t("document.threadReopened"));
    },
    onError: (err) => notifier.error(t("document.highlightFailed"), err),
  });

  const handleAddHighlightComment = useCallback(
    async (highlightId: HighlightId, bodyMarkdown: string) => {
      await addCommentMutation.mutateAsync({
        highlightId,
        documentId,
        input: { bodyMarkdown },
      });
    },
    [addCommentMutation, documentId],
  );

  const handleSendHighlightToAgent = useCallback(
    async (
      highlightId: HighlightId,
      options?: {
        readonly bridgeSessionId?: BridgeSessionId | null | undefined;
        readonly bindingId?: ThreadBindingId | null | undefined;
        readonly bodyMarkdown?: string | undefined;
      },
    ) => {
      await sendHighlightToAgentMutation.mutateAsync({
        highlightId,
        documentId,
        input: {
          ...(options?.bridgeSessionId !== undefined
            ? { bridgeSessionId: options.bridgeSessionId }
            : {}),
          ...(options?.bindingId !== undefined ? { bindingId: options.bindingId } : {}),
          ...(options?.bodyMarkdown ? { bodyMarkdown: options.bodyMarkdown } : {}),
        },
      });
    },
    [documentId, sendHighlightToAgentMutation],
  );

  const createMissingDocMutation = useMutation({
    mutationFn: (title: string) =>
      client.documents.create({
        spaceId: doc?.spaceId ?? spaces[0]?.id ?? asSpaceId("spc_research"),
        kind: "article",
        title,
        contentMarkdown: `# ${title}\n\n`,
      }),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "documents"] });
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.workspaceSummary() });
      notifier.success(t("document.createdFromWikilink", { title: created.title }));
      navigation.openDocument(created.id);
    },
    onError: (err) => notifier.error(t("document.createDocFailed"), err),
  });

  const splitCreateNodeMutation = useMutation({
    mutationFn: (input: CreateOutlineNodeInput) => client.outlineNodes.create(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.dailyOutline(today) });
    },
  });

  const splitUpdateNodeMutation = useMutation({
    mutationFn: (payload: { readonly nodeId: OutlineNodeId; readonly patch: UpdateOutlineNodeInput }) =>
      client.outlineNodes.update(payload.nodeId, payload.patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.dailyOutline(today) });
    },
  });

  const splitMoveNodeMutation = useMutation({
    mutationFn: (payload: { readonly nodeId: OutlineNodeId; readonly move: MoveOutlineNodeInput }) =>
      client.outlineNodes.move(payload.nodeId, payload.move),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.dailyOutline(today) });
    },
  });

  const splitDeleteNodeMutation = useMutation({
    mutationFn: (nodeId: OutlineNodeId) => client.outlineNodes.delete(nodeId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.dailyOutline(today) });
    },
  });

  const handleExcerptToDaily = async (
    _anchor: SelectionAnchor,
    markdownQuote: string,
  ): Promise<void> => {
    try {
      const daily = await client.documents.getDaily(today);
      await client.outlineNodes.create({
        documentId: daily.document.id,
        parentNodeId: null,
        contentMarkdown: markdownQuote,
      });
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.dailyOutline(today) });
      notifier.success(t("document.excerptedToDaily"), today);
    } catch (err) {
      notifier.error(t("document.excerptFailed"), err);
    }
  };

  const handleExportMd = async (): Promise<void> => {
    if (!doc) return;
    try {
      const markdown = await client.documents.exportMarkdown(doc.id);
      const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${doc.slug || doc.id}.md`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      notifier.error(t("document.exportMdFailed"), err);
    }
  };

  const handleExportHtml = async (): Promise<void> => {
    if (!doc) return;
    try {
      let bodyHtml: string | undefined;
      const proseEl = primaryContentRef.current?.querySelector<HTMLElement>(".inkade-prose");
      if (proseEl) {
        const cloned = proseEl.cloneNode(true) as HTMLElement;
        for (const artifactNode of cloned.querySelectorAll("[data-inkade-artifact-block]")) {
          const fallbackEl = artifactNode.querySelector<HTMLElement>(
            "[data-inkade-artifact-static-fallback]",
          );
          if (fallbackEl) {
            fallbackEl.classList.remove("hidden");
            fallbackEl.removeAttribute("aria-hidden");
            artifactNode.replaceChildren(fallbackEl);
          } else {
            artifactNode.remove();
          }
        }
        for (const uiNode of cloned.querySelectorAll(
          "[data-inkade-ui-overlay], [data-inkade-dom-search], [data-testid='editor-static-toolbar']",
        )) {
          if (uiNode.hasAttribute("data-inkade-dom-search")) {
            uiNode.replaceWith(document.createTextNode(uiNode.textContent ?? ""));
          } else {
            uiNode.remove();
          }
        }
        bodyHtml = cloned.innerHTML;
      }
      const markdown = bodyHtml ? undefined : await client.documents.exportMarkdown(doc.id);
      const html = buildStandaloneDocumentHtml({
        title: doc.title,
        bodyHtml,
        markdown,
        theme: effectiveTheme,
        paperMode: typographyPrefs.paper,
        font: typographyPrefs.fontFamily,
        fontSize: typographyPrefs.fontSize,
        measure: typographyPrefs.measure,
        tags: doc.tags,
        updatedAt: doc.updatedAt.slice(0, 16).replace("T", " "),
      });
      triggerHtmlFileDownload(`${doc.slug || doc.id}.html`, html);
    } catch (err) {
      notifier.error(t("editor.exportHtmlFailed"), err);
    }
  };

  const handlePrintPdf = (): void => {
    if (typeof window !== "undefined") {
      window.print();
    }
  };

  const handleExportDocx = async (): Promise<void> => {
    if (!doc) return;
    try {
      const bytes = await client.documents.exportDocx(doc.id);
      triggerDocxFileDownload(`${doc.slug || doc.id}.docx`, bytes);
    } catch (err) {
      notifier.error(t("document.exportDocxFailed"), err);
    }
  };

  return {
    quickShareMutation,
    revokeShareLinkMutation,
    handlePrimaryOutlineBatch,
    handleSplitOutlineBatch,
    saveMutation,
    updateTitleMutation,
    updateTagsMutation,
    updatePropsMutation,
    pinMutation,
    moveSpaceMutation,
    acknowledgeSilentMutation,
    markAgentReadMutation,
    undoBatchMutation,
    trashMutation,
    createHighlightMutation,
    updateHighlightMutation,
    deleteHighlightMutation,
    deliveryReceipts,
    addCommentMutation,
    sendHighlightToAgentMutation,
    resolveHighlightMutation,
    reopenHighlightMutation,
    handleAddHighlightComment,
    handleSendHighlightToAgent,
    createMissingDocMutation,
    splitCreateNodeMutation,
    splitUpdateNodeMutation,
    splitMoveNodeMutation,
    splitDeleteNodeMutation,
    handleExcerptToDaily,
    handleExportMd,
    handleExportHtml,
    handleExportDocx,
    handlePrintPdf,
  };
}
