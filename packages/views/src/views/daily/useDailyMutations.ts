import {
  type AdeThreadBinding,
  type AgentApprovalDecision,
  type AgentSteeringMode,
  asOutlineNodeId,
  type BatchOutlineNodesResult,
  type CreateOutlineNodeInput,
  createOrderKeyBetween,
  type DocumentId,
  type DocumentRecord,
  type DocumentSummary,
  type MoveOutlineNodeInput,
  type OutlineBatchOperation,
  type OutlineNode,
  type OutlineNodeId,
  type TemplateId,
  type ThreadBindingId,
  type UpdateOutlineNodeInput,
} from "@inkade/core";
import type { useInkadeTranslation } from "@inkade/i18n";
import { type DailyOutlineResponse, inkadeQueryKeys } from "@inkade/sdk";
import { useInkadeClient } from "@inkade/sdk/react";
import type { AgentComposerSubmitPayload, OutlineDeferTarget } from "@inkade/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type React from "react";
import { useCallback } from "react";
import type { TaskSchedulePatch } from "../../components/TaskSchedulePopover.tsx";
import { useInkadeViewsContext } from "../../context.tsx";
import {
  buildClonedSubtreeBatchOps,
  computeDeferTargetDate,
  withDailyReviewedAt,
} from "../../lib/daily-studio.ts";

export interface UseDailyMutationsOptions {
  readonly t: ReturnType<typeof useInkadeTranslation>["t"];
  readonly activeDate: string;
  readonly dailyDoc: DocumentRecord | null;
  readonly docsById: ReadonlyMap<DocumentId, DocumentSummary>;
  readonly prevOutlineDocId: DocumentId | null;
  readonly rolloverTodos: readonly OutlineNode[];
  readonly dismissRollover: () => void;
  readonly quotingDocId: DocumentId | null;
  readonly setQuotingDocId: React.Dispatch<React.SetStateAction<DocumentId | null>>;
  readonly setExtraRolloverDatesById: React.Dispatch<React.SetStateAction<Map<DocumentId, string>>>;
  readonly setSchedulePopoverTaskId: React.Dispatch<React.SetStateAction<OutlineNodeId | null>>;
  readonly setRecentApprovalIds: React.Dispatch<
    React.SetStateAction<ReadonlySet<ThreadBindingId>>
  >;
  readonly setSteeringDraftById: React.Dispatch<
    React.SetStateAction<Readonly<Record<ThreadBindingId, string>>>
  >;
}

export function useDailyMutations({
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
}: UseDailyMutationsOptions) {
  const client = useInkadeClient();
  const { notifier } = useInkadeViewsContext();
  const queryClient = useQueryClient();
  const dailyQueryKey = inkadeQueryKeys.dailyOutline(activeDate);

  const toggleReviewedMutation = useMutation({
    mutationFn: async (nextReviewed: boolean) => {
      if (!dailyDoc) return null;
      const nextValue = nextReviewed ? new Date().toISOString() : null;
      return client.documents.update(dailyDoc.id, {
        properties: withDailyReviewedAt(dailyDoc.properties, nextValue),
      });
    },
    onSuccess: (updated, nextReviewed) => {
      if (updated) {
        queryClient.setQueryData<DailyOutlineResponse>(dailyQueryKey, (prev) =>
          prev ? { ...prev, document: updated } : prev,
        );
        void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.documents() });
        void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.document(updated.id) });
      }
      notifier.success(nextReviewed ? t("daily.reviewedToast") : t("daily.unreviewedToast"));
    },
    onError: (err) => notifier.error(t("daily.reviewedUpdateFailed"), err),
  });

  const handleDeferNode = useCallback(
    async (
      sourceDocumentId: DocumentId,
      sourceDate: string,
      sourceNodes: readonly OutlineNode[],
      node: OutlineNode,
      target: OutlineDeferTarget,
    ): Promise<{ readonly targetDocId: DocumentId; readonly targetDate: string } | void> => {
      const targetDate = computeDeferTargetDate(sourceDate, target);
      try {
        const latestSourceNodes =
          queryClient.getQueryData<DailyOutlineResponse>(inkadeQueryKeys.dailyOutline(sourceDate))
            ?.nodes ?? sourceNodes;
        const targetDaily = await client.documents.getDaily(targetDate);
        const targetDocId = targetDaily.document.id;
        const ops = buildClonedSubtreeBatchOps(latestSourceNodes, node);
        if (ops.length > 0) {
          await client.outlineNodes.batch({
            documentId: targetDocId,
            operations: [...ops],
          });
        }
        const sourceResult = await client.outlineNodes.batch({
          documentId: sourceDocumentId,
          operations: [
            {
              op: "update",
              nodeId: node.id,
              rolledOverToDocId: targetDocId,
            },
          ],
        });
        setExtraRolloverDatesById((prev) => {
          const next = new Map(prev);
          next.set(targetDocId, targetDate);
          return next;
        });
        queryClient.setQueryData<DailyOutlineResponse>(
          inkadeQueryKeys.dailyOutline(sourceDate),
          (prev) => (prev ? { ...prev, nodes: sourceResult.nodes } : prev),
        );
        void queryClient.invalidateQueries({
          queryKey: inkadeQueryKeys.dailyOutline(targetDate),
        });
        void queryClient.invalidateQueries({
          queryKey: inkadeQueryKeys.dailyOutline(sourceDate),
        });
        void queryClient.invalidateQueries({
          queryKey: inkadeQueryKeys.documents({ kind: "outline" }),
        });
        void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.workspaceSummary() });
        void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "tasks"] });
        notifier.success(t("outline.deferredSuccessToast", { date: targetDate }));
        return { targetDocId, targetDate };
      } catch (err) {
        notifier.error(t("outline.deferFailedToast"), err);
      }
    },
    [client.documents, client.outlineNodes, notifier, queryClient, setExtraRolloverDatesById, t],
  );

  const applyTemplateMutation = useMutation({
    mutationFn: async (templateId: TemplateId) => {
      return client.templates.apply(templateId, { dailyDate: activeDate });
    },
    onSuccess: (res) => {
      if (dailyDoc) {
        try {
          window.localStorage.setItem(`inkade:daily-tpl-applied:${dailyDoc.id}`, "1");
        } catch {
          // ignore
        }
      }
      if (res.nodes) {
        queryClient.setQueryData<DailyOutlineResponse>(dailyQueryKey, (prev) =>
          prev ? { ...prev, nodes: res.nodes ?? prev.nodes } : prev,
        );
      }
      void queryClient.invalidateQueries({ queryKey: dailyQueryKey });
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.workspaceSummary() });
      notifier.success(t("daily.templateApplied"));
    },
    onError: (err) => notifier.error(t("daily.templateApplyFailed"), err),
  });

  const handleBatchMutate = useCallback(
    async (
      operations: readonly OutlineBatchOperation[],
    ): Promise<BatchOutlineNodesResult | void> => {
      if (!dailyDoc) return;
      try {
        const result = await client.outlineNodes.batch({
          documentId: dailyDoc.id,
          operations: [...operations],
        });
        queryClient.setQueryData<DailyOutlineResponse>(dailyQueryKey, (prev) =>
          prev ? { ...prev, nodes: result.nodes } : prev,
        );
        void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.workspaceSummary() });
        void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "tasks"] });
        return result;
      } catch (err) {
        notifier.error(t("daily.batchSaveFailed"), err);
        void queryClient.invalidateQueries({ queryKey: dailyQueryKey });
        return undefined;
      }
    },
    [client.outlineNodes, dailyDoc, dailyQueryKey, notifier, queryClient, t],
  );

  const handleBatchCollapseChange = async (
    collapsed: boolean,
    scopeNodeIds: readonly OutlineNodeId[],
  ): Promise<void> => {
    if (!dailyDoc || scopeNodeIds.length === 0) return;
    await handleBatchMutate(
      scopeNodeIds.map((nodeId) => ({
        op: "update",
        nodeId,
        collapsed,
      })),
    );
  };

  const createNodeMutation = useMutation({
    mutationFn: (input: CreateOutlineNodeInput) => client.outlineNodes.create(input),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: dailyQueryKey });
      const previous = queryClient.getQueryData<DailyOutlineResponse>(dailyQueryKey);
      if (previous) {
        const siblings = previous.nodes
          .filter((n) => n.deletedAt === null && n.parentNodeId === (input.parentNodeId ?? null))
          .sort((a, b) => (a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : 0));
        const afterNode = input.afterNodeId
          ? siblings.find((s) => s.id === input.afterNodeId) ?? null
          : null;
        const beforeNode = input.beforeNodeId
          ? siblings.find((s) => s.id === input.beforeNodeId) ?? null
          : null;
        const tempOrder =
          input.orderKey ??
          createOrderKeyBetween(afterNode?.orderKey ?? null, beforeNode?.orderKey ?? null);
        const now = new Date().toISOString();
        const optimisticNode: OutlineNode = {
          id: asOutlineNodeId(
            `temp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          ),
          documentId: input.documentId,
          parentNodeId: input.parentNodeId ?? null,
          orderKey: tempOrder,
          contentMarkdown: input.contentMarkdown,
          contentText: input.contentMarkdown,
          checked: input.checked ?? null,
          collapsed: input.collapsed ?? false,
          authorType: input.authorType ?? "human",
          authorId: null,
          sourceBindingId: input.sourceBindingId ?? null,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        };
        queryClient.setQueryData<DailyOutlineResponse>(dailyQueryKey, {
          ...previous,
          nodes: [...previous.nodes, optimisticNode],
        });
      }
      return { previous };
    },
    onError: (err, _input, context) => {
      if (context?.previous) queryClient.setQueryData(dailyQueryKey, context.previous);
      notifier.error(t("daily.nodeCreateFailed"), err);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: dailyQueryKey });
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.workspaceSummary() });
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "tasks"] });
    },
  });

  const updateNodeMutation = useMutation({
    mutationFn: async (vars: {
      readonly nodeId: OutlineNodeId;
      readonly patch: UpdateOutlineNodeInput;
    }): Promise<{
      readonly node: OutlineNode;
      readonly spawnedNextNode?: OutlineNode | null | undefined;
    }> => {
      const canUseTaskEndpoint =
        vars.patch.checked !== null &&
        vars.patch.collapsed === undefined &&
        vars.patch.sourceBindingId === undefined &&
        vars.patch.rolledOverToDocId === undefined &&
        vars.patch.spawnedNextNodeId === undefined;
      if (canUseTaskEndpoint) {
        return client.tasks.update(vars.nodeId, {
          ...(vars.patch.contentMarkdown !== undefined
            ? { contentMarkdown: vars.patch.contentMarkdown }
            : {}),
          ...(vars.patch.noteMarkdown !== undefined
            ? { noteMarkdown: vars.patch.noteMarkdown }
            : {}),
          ...(typeof vars.patch.checked === "boolean"
            ? { checked: vars.patch.checked }
            : {}),
          ...(vars.patch.priority !== undefined ? { priority: vars.patch.priority } : {}),
          ...(vars.patch.scheduledDate !== undefined
            ? { scheduledDate: vars.patch.scheduledDate }
            : {}),
          ...(vars.patch.scheduledSlot !== undefined
            ? { scheduledSlot: vars.patch.scheduledSlot }
            : {}),
          ...(vars.patch.scheduledStartMin !== undefined
            ? { scheduledStartMin: vars.patch.scheduledStartMin }
            : {}),
          ...(vars.patch.durationMin !== undefined
            ? { durationMin: vars.patch.durationMin }
            : {}),
          ...(vars.patch.recurrenceRule !== undefined
            ? { recurrenceRule: vars.patch.recurrenceRule }
            : {}),
          ...(vars.patch.dueDate !== undefined ? { dueDate: vars.patch.dueDate } : {}),
        });
      }
      const node = await client.outlineNodes.update(vars.nodeId, vars.patch);
      return { node };
    },
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: dailyQueryKey });
      const previous = queryClient.getQueryData<DailyOutlineResponse>(dailyQueryKey);
      if (previous) {
        queryClient.setQueryData<DailyOutlineResponse>(dailyQueryKey, {
          ...previous,
          nodes: previous.nodes.map((n) =>
            n.id === vars.nodeId
              ? {
                  ...n,
                  ...(vars.patch.contentMarkdown !== undefined
                    ? {
                        contentMarkdown: vars.patch.contentMarkdown,
                        contentText: vars.patch.contentMarkdown,
                      }
                    : {}),
                  ...(vars.patch.checked !== undefined ? { checked: vars.patch.checked } : {}),
                  ...(vars.patch.collapsed !== undefined
                    ? { collapsed: vars.patch.collapsed }
                    : {}),
                  ...(vars.patch.priority !== undefined ? { priority: vars.patch.priority } : {}),
                  ...(vars.patch.scheduledDate !== undefined
                    ? { scheduledDate: vars.patch.scheduledDate }
                    : {}),
                  ...(vars.patch.scheduledSlot !== undefined
                    ? { scheduledSlot: vars.patch.scheduledSlot }
                    : {}),
                  ...(vars.patch.durationMin !== undefined
                    ? { durationMin: vars.patch.durationMin }
                    : {}),
                  ...(vars.patch.recurrenceRule !== undefined
                    ? { recurrenceRule: vars.patch.recurrenceRule }
                    : {}),
                  ...(vars.patch.dueDate !== undefined ? { dueDate: vars.patch.dueDate } : {}),
                  updatedAt: new Date().toISOString(),
                }
              : n,
          ),
        });
      }
      return { previous };
    },
    onSuccess: (res, vars) => {
      if (vars.patch.checked === true && res.spawnedNextNode) {
        const cleanTitle = res.node.contentText || res.node.contentMarkdown || t("common.untitled");
        notifier.withUndo?.({
          title: t("tasks.recurringSpawnedToast", {
            title: cleanTitle,
            date: res.spawnedNextNode.scheduledDate ?? activeDate,
          }),
          onUndo: async () => {
            await client.tasks.update(res.node.id, { checked: false });
            void queryClient.invalidateQueries({ queryKey: dailyQueryKey });
            void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "tasks"] });
          },
        });
      }
    },
    onError: (err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(dailyQueryKey, context.previous);
      notifier.error(t("daily.nodeUpdateFailed"), err);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: dailyQueryKey });
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.workspaceSummary() });
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "tasks"] });
    },
  });

  const moveNodeMutation = useMutation({
    mutationFn: (vars: { readonly nodeId: OutlineNodeId; readonly move: MoveOutlineNodeInput }) =>
      client.outlineNodes.move(vars.nodeId, vars.move),
    onError: (err) => notifier.error(t("daily.nodeMoveFailed"), err),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: dailyQueryKey });
    },
  });

  const deleteNodeMutation = useMutation({
    mutationFn: (nodeId: OutlineNodeId) => client.outlineNodes.delete(nodeId),
    onSuccess: (deletedNodes) => {
      const rootDeleted = deletedNodes[0];
      if (!rootDeleted || !dailyDoc) return;
      notifier.withUndo?.({
        title: t("daily.nodeDeleted"),
        description: rootDeleted.contentText.slice(0, 60) || undefined,
        onUndo: async () => {
          await client.outlineNodes.create({
            documentId: dailyDoc.id,
            parentNodeId: rootDeleted.parentNodeId,
            orderKey: rootDeleted.orderKey,
            contentMarkdown: rootDeleted.contentMarkdown,
            checked: rootDeleted.checked,
            collapsed: rootDeleted.collapsed,
          });
          void queryClient.invalidateQueries({ queryKey: dailyQueryKey });
          notifier.success(t("daily.nodeRestored"));
        },
      });
    },
    onError: (err) => notifier.error(t("daily.nodeDeleteFailed"), err),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: dailyQueryKey });
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.workspaceSummary() });
    },
  });

  const rolloverAllMutation = useMutation({
    mutationFn: async () => {
      if (!prevOutlineDocId || !dailyDoc) return [];
      return client.outlineNodes.rollover(prevOutlineDocId, dailyDoc.id);
    },
    onSuccess: (rolled) => {
      dismissRollover();
      void queryClient.invalidateQueries({ queryKey: dailyQueryKey });
      if (prevOutlineDocId) {
        void queryClient.invalidateQueries({
          queryKey: inkadeQueryKeys.outlineNodes(prevOutlineDocId),
        });
      }
      notifier.success(t("daily.rolledOverCount", { count: rolled.length }));
    },
    onError: (err) => notifier.error(t("daily.rolloverFailed"), err),
  });

  const rolloverSelectedMutation = useMutation({
    mutationFn: async (nodeIds: readonly OutlineNodeId[]) => {
      if (!dailyDoc) return;
      const map = new Map(rolloverTodos.map((n) => [n.id, n]));
      for (const id of nodeIds) {
        const todo = map.get(id);
        if (!todo) continue;
        await client.outlineNodes.create({
          documentId: dailyDoc.id,
          parentNodeId: null,
          contentMarkdown: todo.contentMarkdown,
          ...(todo.noteMarkdown ? { noteMarkdown: todo.noteMarkdown } : {}),
          checked: false,
        });
        await client.outlineNodes.update(todo.id, {
          rolledOverToDocId: dailyDoc.id,
        });
      }
    },
    onSuccess: (_data, nodeIds) => {
      dismissRollover();
      void queryClient.invalidateQueries({ queryKey: dailyQueryKey });
      if (prevOutlineDocId) {
        void queryClient.invalidateQueries({
          queryKey: inkadeQueryKeys.outlineNodes(prevOutlineDocId),
        });
      }
      notifier.success(t("daily.carriedOverCount", { count: nodeIds.length }));
    },
    onError: (err) => notifier.error(t("daily.carryOverFailed"), err),
  });

  const markBindingReadMutation = useMutation({
    mutationFn: (bindingId: ThreadBindingId) =>
      client.threadBindings.update(bindingId, { unreadResult: false }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: [...inkadeQueryKeys.all, "thread-bindings"],
      });
    },
    onError: (err) => notifier.error(t("daily.markReadFailed"), err),
  });

  const unbindMutation = useMutation({
    mutationFn: (bindingId: ThreadBindingId) => client.threadBindings.delete(bindingId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: [...inkadeQueryKeys.all, "thread-bindings"],
      });
      notifier.success(t("daily.unboundAde"));
    },
    onError: (err) => notifier.error(t("daily.unbindFailed"), err),
  });

  const invalidateControlRoomQueries = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: [...inkadeQueryKeys.all, "thread-bindings"],
    });
    void queryClient.invalidateQueries({
      queryKey: [...inkadeQueryKeys.all, "away-summary"],
    });
    void queryClient.invalidateQueries({
      queryKey: inkadeQueryKeys.workspaceSummary(),
    });
  }, [queryClient]);

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
      queryClient.setQueriesData<readonly AdeThreadBinding[]>(
        { queryKey: [...inkadeQueryKeys.all, "thread-bindings"] },
        (prev) => (prev ? prev.map((b) => (b.id === updated.id ? updated : b)) : prev),
      );
      setRecentApprovalIds((prev) => {
        const next = new Set(prev);
        next.add(vars.bindingId);
        return next;
      });
      invalidateControlRoomQueries();
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
      queryClient.setQueriesData<readonly AdeThreadBinding[]>(
        { queryKey: [...inkadeQueryKeys.all, "thread-bindings"] },
        (prev) => (prev ? prev.map((b) => (b.id === updated.id ? updated : b)) : prev),
      );
      setRecentApprovalIds((prev) => {
        const next = new Set(prev);
        next.delete(binding.id);
        return next;
      });
      invalidateControlRoomQueries();
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
      invalidateControlRoomQueries();
      notifier.success(t("agentControl.steeringSentToast"));
    },
    onError: (err) => notifier.error(t("agentControl.steeringFailedToast"), err),
  });

  const quickDispatchMutation = useMutation({
    mutationFn: async (payload: AgentComposerSubmitPayload) => {
      if (!dailyDoc) throw new Error("No active daily document");
      const targetDocId = payload.mentionedDocIds[0] ?? dailyDoc.id;
      const docTitle = docsById.get(targetDocId)?.title ?? dailyDoc.title;
      const mentionSuffix =
        payload.mentionedDocIds.length > 0
          ? payload.mentionedDocIds
              .map((docId) => `[[${docsById.get(docId)?.title ?? docId}]]`)
              .join(" ")
          : "";
      const summary = [
        payload.prompt.trim(),
        mentionSuffix ? `@${mentionSuffix}` : "",
        payload.suggestionMode ? "[Track Changes]" : "",
      ]
        .filter(Boolean)
        .join(" ")
        .trim();

      return client.threadBindings.upsert({
        documentId: targetDocId,
        nodeId: null,
        adeKind: payload.adeKind,
        externalThreadId: `thr_pending_${Date.now().toString(36)}`,
        title: payload.prompt.trim().slice(0, 80) || docTitle,
        status: "queued",
        lastSummary: summary || null,
        unreadResult: false,
      });
    },
    onSuccess: () => {
      invalidateControlRoomQueries();
      notifier.success(
        t("agentControl.composerDispatchedToast"),
        t("agentControl.composerDispatchedDesc"),
      );
    },
    onError: (err) => notifier.error(t("dialogs.dispatchFailed"), err),
  });

  const updateTaskScheduleMutation = useMutation({
    mutationFn: async (vars: {
      readonly nodeId: OutlineNodeId;
      readonly patch: TaskSchedulePatch;
    }) => {
      return client.tasks.update(vars.nodeId, {
        ...(vars.patch.scheduledDate !== undefined
          ? { scheduledDate: vars.patch.scheduledDate }
          : {}),
        ...(vars.patch.scheduledStartMin !== undefined
          ? { scheduledStartMin: vars.patch.scheduledStartMin }
          : {}),
        ...(vars.patch.scheduledSlot !== undefined
          ? { scheduledSlot: vars.patch.scheduledSlot }
          : {}),
        ...(vars.patch.durationMin !== undefined
          ? { durationMin: vars.patch.durationMin }
          : {}),
        ...(vars.patch.priority !== undefined ? { priority: vars.patch.priority } : {}),
        ...(vars.patch.recurrenceRule !== undefined
          ? { recurrenceRule: vars.patch.recurrenceRule }
          : {}),
        ...(vars.patch.dueDate !== undefined ? { dueDate: vars.patch.dueDate } : {}),
      });
    },
    onSuccess: (res) => {
      setSchedulePopoverTaskId(null);
      queryClient.setQueryData<DailyOutlineResponse>(dailyQueryKey, (prev) =>
        prev
          ? {
              ...prev,
              nodes: prev.nodes.map((n) => (n.id === res.node.id ? res.node : n)),
            }
          : prev,
      );
      void queryClient.invalidateQueries({ queryKey: dailyQueryKey });
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "tasks"] });
      notifier.success(t("daily.scheduleUpdatedToast"));
    },
    onError: (err) => notifier.error(t("daily.batchSaveFailed"), err),
  });

  const handleQuoteToToday = useCallback(
    async (doc: { readonly id: DocumentId; readonly title: string }): Promise<void> => {
      if (!dailyDoc || quotingDocId) return;
      setQuotingDocId(doc.id);
      try {
        await createNodeMutation.mutateAsync({
          documentId: dailyDoc.id,
          parentNodeId: null,
          contentMarkdown: `[[${doc.title}]]`,
          checked: null,
          collapsed: false,
          authorType: "human",
        });
        notifier.success(t("daily.serendipityQuotedToast", { title: doc.title }));
      } catch {
        // toast already handled by createNodeMutation
      } finally {
        setQuotingDocId(null);
      }
    },
    [createNodeMutation, dailyDoc, notifier, quotingDocId, setQuotingDocId, t],
  );

  return {
    toggleReviewedMutation,
    handleDeferNode,
    applyTemplateMutation,
    handleBatchMutate,
    handleBatchCollapseChange,
    createNodeMutation,
    updateNodeMutation,
    moveNodeMutation,
    deleteNodeMutation,
    rolloverAllMutation,
    rolloverSelectedMutation,
    markBindingReadMutation,
    unbindMutation,
    approveBindingMutation,
    undoApprovalMutation,
    steerBindingMutation,
    quickDispatchMutation,
    updateTaskScheduleMutation,
    handleQuoteToToday,
  };
}
