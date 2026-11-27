import {
  useMutation,
  useQueryClient,
  type UseMutationOptions,
  type UseMutationResult,
} from "@tanstack/react-query";
import type {
  AckWakeEventInput,
  AdeThreadBinding,
  AgentBriefingJobRecord,
  AgentBriefingRunRecord,
  AiSettingsRecord,
  ApproveThreadBindingInput,
  AuditBatchId,
  BatchRollbackInput,
  BatchRollbackResult,
  BatchUpdateTasksInput,
  BridgeSessionRecord,
  BriefingJobId,
  BriefingRunId,
  CalendarSubId,
  CalendarSubscription,
  ContextPack,
  ContextPackId,
  CreateBriefingJobInput,
  CreateCalendarSubscriptionInput,
  CreateContextPackInput,
  CreateDocumentArtifactInput,
  CreateDocumentInput,
  CreateHighlightCommentInput,
  CreatePublicSiteInput,
  CreateSavedViewInput,
  CreateShareLinkInput,
  CreateTaskInput,
  DocumentArtifactId,
  DocumentHighlight,
  DocumentId,
  DocumentRecord,
  HeartbeatBridgeSessionInput,
  HighlightComment,
  HighlightId,
  OutlineNode,
  PublicSite,
  PublicSiteId,
  RescheduleTaskInput,
  RunBriefingJobInput,
  SavedView,
  SavedViewId,
  SendHighlightToAgentInput,
  SendHighlightToAgentResult,
  ShareLink,
  ShareLinkId,
  Space,
  SpaceId,
  SpacePropertySchema,
  SteerThreadBindingRequestInput,
  SubmitArtifactCommentInput,
  TaskTargetId,
  TestEmbeddingInput,
  TestEmbeddingResult,
  ThreadBindingId,
  UpdateAiSettingsInput,
  UpdateBriefingJobInput,
  UpdateCalendarSubscriptionInput,
  UpdateContextPackInput,
  UpdateDocumentArtifactInput,
  UpdateDocumentInput,
  UpdatePublicSiteInput,
  UpdateSavedViewInput,
  UpdateTaskInput,
  UpdateThreadBindingInput,
  UpdateViewerContextInput,
  UpsertSpacePropertySchemaInput,
  ReindexSearchResult,
  WakeEnvelope,
  WakeEventId,
} from "@inkade/core";
import type {
  BatchUpdateTasksResponse,
  CreateDocumentArtifactResponse,
  CreateTaskResponse,
  DeleteDocumentArtifactResponse,
  LinkDocumentTargetResponse,
  SyncCalendarSubscriptionResponse,
  UpdateDocumentArtifactResponse,
  UpdateTaskResponse,
  UpdateViewerContextResponse,
} from "../client.ts";
import { inkadeQueryKeys } from "../query-keys.ts";
import { useInkadeClient } from "./provider.tsx";

export interface UpdateDocumentMutationVariables {
  readonly documentId: DocumentId;
  readonly input: UpdateDocumentInput;
}

export interface DeleteDocumentMutationVariables {
  readonly documentId: DocumentId;
  readonly hard?: boolean | undefined;
}

export interface UpdateTaskMutationVariables {
  readonly nodeId: TaskTargetId;
  readonly input: UpdateTaskInput;
}

export interface UpdateCalendarSubscriptionVariables {
  readonly subscriptionId: CalendarSubId;
  readonly input: UpdateCalendarSubscriptionInput;
}

export interface UpdateThreadBindingVariables {
  readonly bindingId: ThreadBindingId;
  readonly input: UpdateThreadBindingInput;
}

export interface ApproveThreadBindingVariables {
  readonly bindingId: ThreadBindingId;
  readonly input: ApproveThreadBindingInput;
}

export interface SteerThreadBindingVariables {
  readonly bindingId: ThreadBindingId;
  readonly input: SteerThreadBindingRequestInput;
}

export interface UpdateSavedViewVariables {
  readonly viewId: SavedViewId;
  readonly input: UpdateSavedViewInput;
}

export interface UpdateContextPackVariables {
  readonly packId: ContextPackId;
  readonly input: UpdateContextPackInput;
}

export function useCreateDocumentMutation(
  options?: Omit<UseMutationOptions<DocumentRecord, Error, CreateDocumentInput>, "mutationFn">,
): UseMutationResult<DocumentRecord, Error, CreateDocumentInput> {
  const client = useInkadeClient();
  const queryClient = useQueryClient();
  return useMutation({
    ...options,
    mutationFn: (input) => client.documents.create(input),
    onSuccess: async (data, variables, onMutateResult, context) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "documents"] }),
        queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.workspaceSummary() }),
        queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.storageBuckets() }),
      ]);
      await options?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

export function useUpdateDocumentMutation(
  options?: Omit<
    UseMutationOptions<DocumentRecord, Error, UpdateDocumentMutationVariables>,
    "mutationFn"
  >,
): UseMutationResult<DocumentRecord, Error, UpdateDocumentMutationVariables> {
  const client = useInkadeClient();
  const queryClient = useQueryClient();
  return useMutation({
    ...options,
    mutationFn: ({ documentId, input }) => client.documents.update(documentId, input),
    onSuccess: async (data, variables, onMutateResult, context) => {
      queryClient.setQueryData(inkadeQueryKeys.document(variables.documentId), data);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "documents"] }),
        queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.revisions(variables.documentId) }),
        queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.workspaceSummary() }),
      ]);
      await options?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

export function useTrashDocumentMutation(
  options?: Omit<UseMutationOptions<DocumentRecord, Error, DocumentId>, "mutationFn">,
): UseMutationResult<DocumentRecord, Error, DocumentId> {
  const client = useInkadeClient();
  const queryClient = useQueryClient();
  return useMutation({
    ...options,
    mutationFn: (documentId) => client.documents.trash(documentId),
    onSuccess: async (data, documentId, onMutateResult, context) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "documents"] }),
        queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.document(documentId) }),
        queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "daily"] }),
        queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.workspaceSummary() }),
      ]);
      await options?.onSuccess?.(data, documentId, onMutateResult, context);
    },
  });
}

export function useRestoreDocumentMutation(
  options?: Omit<UseMutationOptions<DocumentRecord, Error, DocumentId>, "mutationFn">,
): UseMutationResult<DocumentRecord, Error, DocumentId> {
  const client = useInkadeClient();
  const queryClient = useQueryClient();
  return useMutation({
    ...options,
    mutationFn: (documentId) => client.documents.restore(documentId),
    onSuccess: async (data, documentId, onMutateResult, context) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "documents"] }),
        queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.document(documentId) }),
        queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.workspaceSummary() }),
      ]);
      await options?.onSuccess?.(data, documentId, onMutateResult, context);
    },
  });
}

export function useDeleteDocumentMutation(
  options?: Omit<
    UseMutationOptions<
      { readonly deleted: boolean; readonly id: DocumentId } | { readonly document: DocumentRecord },
      Error,
      DeleteDocumentMutationVariables
    >,
    "mutationFn"
  >,
): UseMutationResult<
  { readonly deleted: boolean; readonly id: DocumentId } | { readonly document: DocumentRecord },
  Error,
  DeleteDocumentMutationVariables
> {
  const client = useInkadeClient();
  const queryClient = useQueryClient();
  return useMutation({
    ...options,
    mutationFn: ({ documentId, hard }) => client.documents.delete(documentId, { hard }),
    onSuccess: async (data, variables, onMutateResult, context) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "documents"] }),
        queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.document(variables.documentId) }),
        queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.workspaceSummary() }),
        queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.storageBuckets() }),
      ]);
      await options?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

export function useMarkAgentUpdateReadMutation(
  options?: Omit<UseMutationOptions<DocumentRecord, Error, DocumentId>, "mutationFn">,
): UseMutationResult<DocumentRecord, Error, DocumentId> {
  const client = useInkadeClient();
  const queryClient = useQueryClient();
  return useMutation({
    ...options,
    mutationFn: (documentId) => client.documents.acknowledgeSilent(documentId),
    onSuccess: async (data, documentId, onMutateResult, context) => {
      queryClient.setQueryData(inkadeQueryKeys.document(documentId), data);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "documents"] }),
        queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.workspaceSummary() }),
      ]);
      await options?.onSuccess?.(data, documentId, onMutateResult, context);
    },
  });
}

export function useAcknowledgeSilentMutation(
  options?: Omit<UseMutationOptions<DocumentRecord, Error, DocumentId>, "mutationFn">,
): UseMutationResult<DocumentRecord, Error, DocumentId> {
  return useMarkAgentUpdateReadMutation(options);
}

export interface RollbackAuditBatchVariables {
  readonly batchId: AuditBatchId;
  readonly input?: BatchRollbackInput | undefined;
}

export function useRollbackAuditBatchMutation(
  options?: Omit<UseMutationOptions<BatchRollbackResult, Error, RollbackAuditBatchVariables>, "mutationFn">,
): UseMutationResult<BatchRollbackResult, Error, RollbackAuditBatchVariables> {
  const client = useInkadeClient();
  const queryClient = useQueryClient();
  return useMutation({
    ...options,
    mutationFn: ({ batchId, input }) => client.auditLogs.rollbackBatch(batchId, input),
    onSuccess: async (data, variables, onMutateResult, context) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "audit-logs"] }),
        queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "audit-batches"] }),
        queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "documents"] }),
        queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.workspaceSummary() }),
        queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "daily"] }),
        queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "tasks"] }),
        queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.briefingJobs() }),
        queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "briefing-runs"] }),
      ]);
      for (const item of data.items) {
        queryClient.setQueryData(inkadeQueryKeys.document(item.documentId), item.document);
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.revisions(item.documentId) }),
          queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.outlineNodes(item.documentId) }),
        ]);
      }
      await options?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

export function useCreateTaskMutation(
  options?: Omit<UseMutationOptions<CreateTaskResponse, Error, CreateTaskInput>, "mutationFn">,
): UseMutationResult<CreateTaskResponse, Error, CreateTaskInput> {
  const client = useInkadeClient();
  const queryClient = useQueryClient();
  return useMutation({
    ...options,
    mutationFn: (input) => client.tasks.create(input),
    onSuccess: async (data, variables, onMutateResult, context) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "tasks"] }),
        queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "daily"] }),
        queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.outlineNodes(data.document.id) }),
        queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.workspaceSummary() }),
      ]);
      await options?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

export function useUpdateTaskMutation(
  options?: Omit<
    UseMutationOptions<UpdateTaskResponse, Error, UpdateTaskMutationVariables>,
    "mutationFn"
  >,
): UseMutationResult<UpdateTaskResponse, Error, UpdateTaskMutationVariables> {
  const client = useInkadeClient();
  const queryClient = useQueryClient();
  return useMutation({
    ...options,
    mutationFn: ({ nodeId, input }) => client.tasks.update(nodeId, input),
    onSuccess: async (data, variables, onMutateResult, context) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "tasks"] }),
        queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "daily"] }),
        queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "outline-nodes"] }),
        queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "documents"] }),
        ...(data.document
          ? [
              queryClient.invalidateQueries({
                queryKey: inkadeQueryKeys.document(data.document.id),
              }),
            ]
          : []),
      ]);
      await options?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

export function useBatchUpdateTasksMutation(
  options?: Omit<
    UseMutationOptions<BatchUpdateTasksResponse, Error, BatchUpdateTasksInput>,
    "mutationFn"
  >,
): UseMutationResult<BatchUpdateTasksResponse, Error, BatchUpdateTasksInput> {
  const client = useInkadeClient();
  const queryClient = useQueryClient();
  return useMutation({
    ...options,
    mutationFn: (input) => client.tasks.batchUpdate(input),
    onSuccess: async (data, variables, onMutateResult, context) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "tasks"] }),
        queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "daily"] }),
        queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "outline-nodes"] }),
      ]);
      await options?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

export function useRescheduleTaskMutation(
  options?: Omit<UseMutationOptions<OutlineNode, Error, RescheduleTaskInput>, "mutationFn">,
): UseMutationResult<OutlineNode, Error, RescheduleTaskInput> {
  const client = useInkadeClient();
  const queryClient = useQueryClient();
  return useMutation({
    ...options,
    mutationFn: (input) => client.tasks.reschedule(input),
    onSuccess: async (data, variables, onMutateResult, context) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "tasks"] }),
        queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "daily"] }),
        queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.outlineNodes(data.documentId) }),
      ]);
      await options?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

export function useUpdateThreadBindingMutation(
  options?: Omit<
    UseMutationOptions<AdeThreadBinding, Error, UpdateThreadBindingVariables>,
    "mutationFn"
  >,
): UseMutationResult<AdeThreadBinding, Error, UpdateThreadBindingVariables> {
  const client = useInkadeClient();
  const queryClient = useQueryClient();
  return useMutation({
    ...options,
    mutationFn: ({ bindingId, input }) => client.threadBindings.update(bindingId, input),
    onSuccess: async (data, variables, onMutateResult, context) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "thread-bindings"] }),
        queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "away-summary"] }),
        queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.workspaceSummary() }),
      ]);
      await options?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

export function useApproveThreadBindingMutation(
  options?: Omit<
    UseMutationOptions<AdeThreadBinding, Error, ApproveThreadBindingVariables>,
    "mutationFn"
  >,
): UseMutationResult<AdeThreadBinding, Error, ApproveThreadBindingVariables> {
  const client = useInkadeClient();
  const queryClient = useQueryClient();
  return useMutation({
    ...options,
    mutationFn: ({ bindingId, input }) => client.threadBindings.approve(bindingId, input),
    onSuccess: async (data, variables, onMutateResult, context) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "thread-bindings"] }),
        queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "away-summary"] }),
        queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.workspaceSummary() }),
      ]);
      await options?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

export function useSteerThreadBindingMutation(
  options?: Omit<
    UseMutationOptions<AdeThreadBinding, Error, SteerThreadBindingVariables>,
    "mutationFn"
  >,
): UseMutationResult<AdeThreadBinding, Error, SteerThreadBindingVariables> {
  const client = useInkadeClient();
  const queryClient = useQueryClient();
  return useMutation({
    ...options,
    mutationFn: ({ bindingId, input }) => client.threadBindings.steer(bindingId, input),
    onSuccess: async (data, variables, onMutateResult, context) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "thread-bindings"] }),
        queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "away-summary"] }),
        queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.workspaceSummary() }),
      ]);
      await options?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

export function useDeleteThreadBindingMutation(
  options?: Omit<UseMutationOptions<void, Error, ThreadBindingId>, "mutationFn">,
): UseMutationResult<void, Error, ThreadBindingId> {
  const client = useInkadeClient();
  const queryClient = useQueryClient();
  return useMutation({
    ...options,
    mutationFn: (bindingId) => client.threadBindings.delete(bindingId),
    onSuccess: async (data, bindingId, onMutateResult, context) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "thread-bindings"] }),
        queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "away-summary"] }),
        queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.workspaceSummary() }),
      ]);
      await options?.onSuccess?.(data, bindingId, onMutateResult, context);
    },
  });
}

export function useArchiveSpaceMutation(
  options?: Omit<UseMutationOptions<Space, Error, SpaceId>, "mutationFn">,
): UseMutationResult<Space, Error, SpaceId> {
  const client = useInkadeClient();
  const queryClient = useQueryClient();
  return useMutation({
    ...options,
    mutationFn: (spaceId) => client.spaces.archive(spaceId),
    onSuccess: async (data, spaceId, onMutateResult, context) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "spaces"] }),
        queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.workspaceSummary() }),
      ]);
      await options?.onSuccess?.(data, spaceId, onMutateResult, context);
    },
  });
}

export function useCreateSavedViewMutation(
  options?: Omit<UseMutationOptions<SavedView, Error, CreateSavedViewInput>, "mutationFn">,
): UseMutationResult<SavedView, Error, CreateSavedViewInput> {
  const client = useInkadeClient();
  const queryClient = useQueryClient();
  return useMutation({
    ...options,
    mutationFn: (input) => client.savedViews.create(input),
    onSuccess: async (data, variables, onMutateResult, context) => {
      await queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.savedViews() });
      await options?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

export function useUpdateSavedViewMutation(
  options?: Omit<UseMutationOptions<SavedView, Error, UpdateSavedViewVariables>, "mutationFn">,
): UseMutationResult<SavedView, Error, UpdateSavedViewVariables> {
  const client = useInkadeClient();
  const queryClient = useQueryClient();
  return useMutation({
    ...options,
    mutationFn: ({ viewId, input }) => client.savedViews.update(viewId, input),
    onSuccess: async (data, variables, onMutateResult, context) => {
      await queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.savedViews() });
      await options?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

export function useDeleteSavedViewMutation(
  options?: Omit<UseMutationOptions<void, Error, SavedViewId>, "mutationFn">,
): UseMutationResult<void, Error, SavedViewId> {
  const client = useInkadeClient();
  const queryClient = useQueryClient();
  return useMutation({
    ...options,
    mutationFn: (viewId) => client.savedViews.delete(viewId),
    onSuccess: async (data, viewId, onMutateResult, context) => {
      await queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.savedViews() });
      await options?.onSuccess?.(data, viewId, onMutateResult, context);
    },
  });
}

export function useCreateShareLinkMutation(
  options?: Omit<UseMutationOptions<ShareLink, Error, CreateShareLinkInput>, "mutationFn">,
): UseMutationResult<ShareLink, Error, CreateShareLinkInput> {
  const client = useInkadeClient();
  const queryClient = useQueryClient();
  return useMutation({
    ...options,
    mutationFn: (input) => client.shareLinks.create(input),
    onSuccess: async (data, variables, onMutateResult, context) => {
      await queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "share-links"] });
      await options?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

export function useRevokeShareLinkMutation(
  options?: Omit<UseMutationOptions<ShareLink, Error, ShareLinkId>, "mutationFn">,
): UseMutationResult<ShareLink, Error, ShareLinkId> {
  const client = useInkadeClient();
  const queryClient = useQueryClient();
  return useMutation({
    ...options,
    mutationFn: (shareLinkId) => client.shareLinks.revoke(shareLinkId),
    onSuccess: async (data, shareLinkId, onMutateResult, context) => {
      await queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "share-links"] });
      await options?.onSuccess?.(data, shareLinkId, onMutateResult, context);
    },
  });
}

export interface UpsertSpaceSchemaVariables {
  readonly spaceId: SpaceId;
  readonly input: UpsertSpacePropertySchemaInput;
}

export function useUpsertSpaceSchemaMutation(
  options?: Omit<
    UseMutationOptions<SpacePropertySchema, Error, UpsertSpaceSchemaVariables>,
    "mutationFn"
  >,
): UseMutationResult<SpacePropertySchema, Error, UpsertSpaceSchemaVariables> {
  const client = useInkadeClient();
  const queryClient = useQueryClient();
  return useMutation({
    ...options,
    mutationFn: ({ spaceId, input }) => client.spaces.upsertSchema(spaceId, input),
    onSuccess: async (data, variables, onMutateResult, context) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "space-schema"] }),
        queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.spaceSchemas() }),
        queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "view-query"] }),
      ]);
      await options?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

export function useReindexSearchMutation(
  options?: Omit<UseMutationOptions<ReindexSearchResult, Error, void>, "mutationFn">,
): UseMutationResult<ReindexSearchResult, Error, void> {
  const client = useInkadeClient();
  const queryClient = useQueryClient();
  return useMutation({
    ...options,
    mutationFn: () => client.search.reindex(),
    onSuccess: async (data, variables, onMutateResult, context) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.storageBuckets() }),
        queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.workspaceSummary() }),
        queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.searchIndexStatus() }),
      ]);
      await options?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

export function useUpdateAiSettingsMutation(
  options?: Omit<UseMutationOptions<AiSettingsRecord, Error, UpdateAiSettingsInput>, "mutationFn">,
): UseMutationResult<AiSettingsRecord, Error, UpdateAiSettingsInput> {
  const client = useInkadeClient();
  const queryClient = useQueryClient();
  return useMutation({
    ...options,
    mutationFn: (input) => client.ai.updateSettings(input),
    onSuccess: async (data, variables, onMutateResult, context) => {
      queryClient.setQueryData(inkadeQueryKeys.aiSettings(), data);
      await queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.searchIndexStatus() });
      await options?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

export function useTestEmbeddingMutation(
  options?: Omit<
    UseMutationOptions<TestEmbeddingResult, Error, TestEmbeddingInput | undefined>,
    "mutationFn"
  >,
): UseMutationResult<TestEmbeddingResult, Error, TestEmbeddingInput | undefined> {
  const client = useInkadeClient();
  return useMutation({
    ...options,
    mutationFn: (input) => client.ai.testEmbedding(input ?? {}),
  });
}

export function useCreateContextPackMutation(
  options?: Omit<UseMutationOptions<ContextPack, Error, CreateContextPackInput>, "mutationFn">,
): UseMutationResult<ContextPack, Error, CreateContextPackInput> {
  const client = useInkadeClient();
  const queryClient = useQueryClient();
  return useMutation({
    ...options,
    mutationFn: (input) => client.contextPacks.create(input),
    onSuccess: async (data, variables, onMutateResult, context) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.contextPacks() }),
        queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "context-pack"] }),
        queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.connectStatus() }),
      ]);
      await options?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

export function useUpdateContextPackMutation(
  options?: Omit<UseMutationOptions<ContextPack, Error, UpdateContextPackVariables>, "mutationFn">,
): UseMutationResult<ContextPack, Error, UpdateContextPackVariables> {
  const client = useInkadeClient();
  const queryClient = useQueryClient();
  return useMutation({
    ...options,
    mutationFn: ({ packId, input }) => client.contextPacks.update(packId, input),
    onSuccess: async (data, variables, onMutateResult, context) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.contextPacks() }),
        queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "context-pack"] }),
      ]);
      await options?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

export function useDeleteContextPackMutation(
  options?: Omit<UseMutationOptions<void, Error, ContextPackId>, "mutationFn">,
): UseMutationResult<void, Error, ContextPackId> {
  const client = useInkadeClient();
  const queryClient = useQueryClient();
  return useMutation({
    ...options,
    mutationFn: (packId) => client.contextPacks.delete(packId),
    onSuccess: async (data, packId, onMutateResult, context) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.contextPacks() }),
        queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "context-pack"] }),
        queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.connectStatus() }),
      ]);
      await options?.onSuccess?.(data, packId, onMutateResult, context);
    },
  });
}

export function useCreateCalendarSubscriptionMutation(
  options?: Omit<
    UseMutationOptions<SyncCalendarSubscriptionResponse, Error, CreateCalendarSubscriptionInput>,
    "mutationFn"
  >,
): UseMutationResult<SyncCalendarSubscriptionResponse, Error, CreateCalendarSubscriptionInput> {
  const client = useInkadeClient();
  const queryClient = useQueryClient();
  return useMutation({
    ...options,
    mutationFn: (input) => client.calendar.createSubscription(input),
    onSuccess: async (data, variables, onMutateResult, context) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.calendarSubscriptions() }),
        queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "calendar-events"] }),
      ]);
      await options?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

export function useUpdateCalendarSubscriptionMutation(
  options?: Omit<
    UseMutationOptions<CalendarSubscription, Error, UpdateCalendarSubscriptionVariables>,
    "mutationFn"
  >,
): UseMutationResult<CalendarSubscription, Error, UpdateCalendarSubscriptionVariables> {
  const client = useInkadeClient();
  const queryClient = useQueryClient();
  return useMutation({
    ...options,
    mutationFn: ({ subscriptionId, input }) =>
      client.calendar.updateSubscription(subscriptionId, input),
    onSuccess: async (data, variables, onMutateResult, context) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.calendarSubscriptions() }),
        queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "calendar-events"] }),
      ]);
      await options?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

export function useDeleteCalendarSubscriptionMutation(
  options?: Omit<UseMutationOptions<void, Error, CalendarSubId>, "mutationFn">,
): UseMutationResult<void, Error, CalendarSubId> {
  const client = useInkadeClient();
  const queryClient = useQueryClient();
  return useMutation({
    ...options,
    mutationFn: (subscriptionId) => client.calendar.deleteSubscription(subscriptionId),
    onSuccess: async (data, subscriptionId, onMutateResult, context) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.calendarSubscriptions() }),
        queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "calendar-events"] }),
      ]);
      await options?.onSuccess?.(data, subscriptionId, onMutateResult, context);
    },
  });
}

export function useRefreshCalendarSubscriptionMutation(
  options?: Omit<
    UseMutationOptions<SyncCalendarSubscriptionResponse, Error, CalendarSubId>,
    "mutationFn"
  >,
): UseMutationResult<SyncCalendarSubscriptionResponse, Error, CalendarSubId> {
  const client = useInkadeClient();
  const queryClient = useQueryClient();
  return useMutation({
    ...options,
    mutationFn: (subscriptionId) => client.calendar.refreshSubscription(subscriptionId),
    onSuccess: async (data, subscriptionId, onMutateResult, context) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.calendarSubscriptions() }),
        queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "calendar-events"] }),
      ]);
      await options?.onSuccess?.(data, subscriptionId, onMutateResult, context);
    },
  });
}

export interface LinkDocumentTargetVariables {
  readonly documentId: DocumentId;
  readonly targetDocumentId: DocumentId;
}

export function useLinkDocumentTargetMutation(
  options?: Omit<
    UseMutationOptions<LinkDocumentTargetResponse, Error, LinkDocumentTargetVariables>,
    "mutationFn"
  >,
): UseMutationResult<LinkDocumentTargetResponse, Error, LinkDocumentTargetVariables> {
  const client = useInkadeClient();
  const queryClient = useQueryClient();
  return useMutation({
    ...options,
    mutationFn: ({ documentId, targetDocumentId }) =>
      client.documents.linkTarget(documentId, targetDocumentId),
    onSuccess: async (data, variables, onMutateResult, context) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "workspace-graph"] }),
        queryClient.invalidateQueries({
          queryKey: inkadeQueryKeys.document(variables.documentId),
        }),
        queryClient.invalidateQueries({
          queryKey: inkadeQueryKeys.document(variables.targetDocumentId),
        }),
        queryClient.invalidateQueries({
          queryKey: inkadeQueryKeys.outlineNodes(variables.documentId),
        }),
      ]);
      await options?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

export interface UpdatePublicSiteVariables {
  readonly siteId: PublicSiteId;
  readonly input: UpdatePublicSiteInput;
}

export function useCreatePublicSiteMutation(
  options?: Omit<UseMutationOptions<PublicSite, Error, CreatePublicSiteInput>, "mutationFn">,
): UseMutationResult<PublicSite, Error, CreatePublicSiteInput> {
  const client = useInkadeClient();
  const queryClient = useQueryClient();
  return useMutation({
    ...options,
    mutationFn: (input) => client.publicSites.create(input),
    onSuccess: async (data, variables, onMutateResult, context) => {
      await queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.publicSites() });
      await options?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

export function useUpdatePublicSiteMutation(
  options?: Omit<UseMutationOptions<PublicSite, Error, UpdatePublicSiteVariables>, "mutationFn">,
): UseMutationResult<PublicSite, Error, UpdatePublicSiteVariables> {
  const client = useInkadeClient();
  const queryClient = useQueryClient();
  return useMutation({
    ...options,
    mutationFn: ({ siteId, input }) => client.publicSites.update(siteId, input),
    onSuccess: async (data, variables, onMutateResult, context) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.publicSites() }),
        queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.publicSite(data.slug) }),
      ]);
      await options?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

export interface UpdateBriefingJobVariables {
  readonly jobId: BriefingJobId;
  readonly input: UpdateBriefingJobInput;
}

export interface RunBriefingJobVariables {
  readonly jobId: BriefingJobId;
  readonly input?: RunBriefingJobInput | undefined;
}

export function useCreateBriefingJobMutation(
  options?: Omit<
    UseMutationOptions<AgentBriefingJobRecord, Error, CreateBriefingJobInput>,
    "mutationFn"
  >,
): UseMutationResult<AgentBriefingJobRecord, Error, CreateBriefingJobInput> {
  const client = useInkadeClient();
  const queryClient = useQueryClient();
  return useMutation({
    ...options,
    mutationFn: (input) => client.briefings.createJob(input),
    onSuccess: async (data, variables, onMutateResult, context) => {
      await queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.briefingJobs() });
      await options?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

export function useUpdateBriefingJobMutation(
  options?: Omit<
    UseMutationOptions<AgentBriefingJobRecord, Error, UpdateBriefingJobVariables>,
    "mutationFn"
  >,
): UseMutationResult<AgentBriefingJobRecord, Error, UpdateBriefingJobVariables> {
  const client = useInkadeClient();
  const queryClient = useQueryClient();
  return useMutation({
    ...options,
    mutationFn: ({ jobId, input }) => client.briefings.updateJob(jobId, input),
    onSuccess: async (data, variables, onMutateResult, context) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.briefingJobs() }),
        queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "briefing-runs"] }),
      ]);
      await options?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

export function useDeleteBriefingJobMutation(
  options?: Omit<
    UseMutationOptions<{ readonly deleted: true; readonly id: BriefingJobId }, Error, BriefingJobId>,
    "mutationFn"
  >,
): UseMutationResult<{ readonly deleted: true; readonly id: BriefingJobId }, Error, BriefingJobId> {
  const client = useInkadeClient();
  const queryClient = useQueryClient();
  return useMutation({
    ...options,
    mutationFn: (jobId) => client.briefings.deleteJob(jobId),
    onSuccess: async (data, jobId, onMutateResult, context) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.briefingJobs() }),
        queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "briefing-runs"] }),
      ]);
      await options?.onSuccess?.(data, jobId, onMutateResult, context);
    },
  });
}

export function useRunBriefingJobNowMutation(
  options?: Omit<
    UseMutationOptions<AgentBriefingRunRecord, Error, RunBriefingJobVariables>,
    "mutationFn"
  >,
): UseMutationResult<AgentBriefingRunRecord, Error, RunBriefingJobVariables> {
  const client = useInkadeClient();
  const queryClient = useQueryClient();
  return useMutation({
    ...options,
    mutationFn: ({ jobId, input }) => client.briefings.runJobNow(jobId, input),
    onSuccess: async (data, variables, onMutateResult, context) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.briefingJobs() }),
        queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "briefing-runs"] }),
        queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "documents"] }),
        queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "daily"] }),
        queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "audit-logs"] }),
        queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "audit-batches"] }),
        queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.workspaceSummary() }),
        queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.storageBuckets() }),
        queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "tasks"] }),
        ...(data.documentId
          ? [
              queryClient.invalidateQueries({
                queryKey: inkadeQueryKeys.document(data.documentId),
              }),
              queryClient.invalidateQueries({
                queryKey: inkadeQueryKeys.outlineNodes(data.documentId),
              }),
              queryClient.invalidateQueries({
                queryKey: inkadeQueryKeys.revisions(data.documentId),
              }),
            ]
          : []),
      ]);
      await options?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

export function useDismissBriefingRunMutation(
  options?: Omit<UseMutationOptions<AgentBriefingRunRecord, Error, BriefingRunId>, "mutationFn">,
): UseMutationResult<AgentBriefingRunRecord, Error, BriefingRunId> {
  const client = useInkadeClient();
  const queryClient = useQueryClient();
  return useMutation({
    ...options,
    mutationFn: (runId) => client.briefings.dismissRun(runId),
    onSuccess: async (data, runId, onMutateResult, context) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.briefingJobs() }),
        queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "briefing-runs"] }),
      ]);
      await options?.onSuccess?.(data, runId, onMutateResult, context);
    },
  });
}

export function useDeletePublicSiteMutation(
  options?: Omit<UseMutationOptions<void, Error, PublicSiteId>, "mutationFn">,
): UseMutationResult<void, Error, PublicSiteId> {
  const client = useInkadeClient();
  const queryClient = useQueryClient();
  return useMutation({
    ...options,
    mutationFn: (siteId) => client.publicSites.delete(siteId),
    onSuccess: async (data, siteId, onMutateResult, context) => {
      await queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.publicSites() });
      await options?.onSuccess?.(data, siteId, onMutateResult, context);
    },
  });
}

export interface AckWakeEventVariables {
  readonly wakeId: WakeEventId;
  readonly input?: AckWakeEventInput | undefined;
}

export function useAckWakeEventMutation(
  options?: Omit<UseMutationOptions<WakeEnvelope, Error, AckWakeEventVariables>, "mutationFn">,
): UseMutationResult<WakeEnvelope, Error, AckWakeEventVariables> {
  const client = useInkadeClient();
  const queryClient = useQueryClient();
  return useMutation({
    ...options,
    mutationFn: ({ wakeId, input }) => client.threadBindings.ackWakeEvent(wakeId, input),
    onSuccess: async (data, variables, onMutateResult, context) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "wake-events"] }),
        queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "thread-bindings"] }),
      ]);
      await options?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

export function useHeartbeatBridgeSessionMutation(
  options?: Omit<
    UseMutationOptions<BridgeSessionRecord, Error, HeartbeatBridgeSessionInput>,
    "mutationFn"
  >,
): UseMutationResult<BridgeSessionRecord, Error, HeartbeatBridgeSessionInput> {
  const client = useInkadeClient();
  const queryClient = useQueryClient();
  return useMutation({
    ...options,
    mutationFn: (input) => client.threadBindings.heartbeatBridgeSession(input),
    onSuccess: async (data, variables, onMutateResult, context) => {
      await queryClient.invalidateQueries({
        queryKey: [...inkadeQueryKeys.all, "bridge-sessions"],
      });
      await options?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

export interface AddHighlightCommentVariables {
  readonly highlightId: HighlightId;
  readonly documentId?: DocumentId | undefined;
  readonly input: CreateHighlightCommentInput;
}

export function useAddHighlightCommentMutation(
  options?: Omit<
    UseMutationOptions<
      { readonly highlight: DocumentHighlight; readonly comment: HighlightComment },
      Error,
      AddHighlightCommentVariables
    >,
    "mutationFn"
  >,
): UseMutationResult<
  { readonly highlight: DocumentHighlight; readonly comment: HighlightComment },
  Error,
  AddHighlightCommentVariables
> {
  const client = useInkadeClient();
  const queryClient = useQueryClient();
  return useMutation({
    ...options,
    mutationFn: ({ highlightId, input }) => client.highlights.addComment(highlightId, input),
    onSuccess: async (data, variables, onMutateResult, context) => {
      const docId = variables.documentId ?? data.highlight.documentId;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.highlights(docId) }),
        queryClient.invalidateQueries({
          queryKey: [...inkadeQueryKeys.all, "comment-threads", docId],
        }),
        queryClient.invalidateQueries({
          queryKey: inkadeQueryKeys.highlightComments(variables.highlightId),
        }),
      ]);
      await options?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

export interface SendHighlightToAgentVariables {
  readonly highlightId: HighlightId;
  readonly documentId?: DocumentId | undefined;
  readonly input?: SendHighlightToAgentInput | undefined;
}

export function useSendHighlightToAgentMutation(
  options?: Omit<
    UseMutationOptions<SendHighlightToAgentResult, Error, SendHighlightToAgentVariables>,
    "mutationFn"
  >,
): UseMutationResult<SendHighlightToAgentResult, Error, SendHighlightToAgentVariables> {
  const client = useInkadeClient();
  const queryClient = useQueryClient();
  return useMutation({
    ...options,
    mutationFn: ({ highlightId, input }) => client.highlights.sendToAgent(highlightId, input),
    onSuccess: async (data, variables, onMutateResult, context) => {
      const docId = variables.documentId ?? data.highlight.documentId;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.highlights(docId) }),
        queryClient.invalidateQueries({
          queryKey: [...inkadeQueryKeys.all, "comment-threads", docId],
        }),
        queryClient.invalidateQueries({
          queryKey: inkadeQueryKeys.highlightComments(variables.highlightId),
        }),
        queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "thread-bindings"] }),
        queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "wake-events"] }),
      ]);
      await options?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

export interface HighlightResolutionVariables {
  readonly highlightId: HighlightId;
  readonly documentId?: DocumentId | undefined;
}

export function useResolveHighlightMutation(
  options?: Omit<UseMutationOptions<DocumentHighlight, Error, HighlightResolutionVariables>, "mutationFn">,
): UseMutationResult<DocumentHighlight, Error, HighlightResolutionVariables> {
  const client = useInkadeClient();
  const queryClient = useQueryClient();
  return useMutation({
    ...options,
    mutationFn: ({ highlightId }) => client.highlights.resolve(highlightId),
    onSuccess: async (data, variables, onMutateResult, context) => {
      const docId = variables.documentId ?? data.documentId;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.highlights(docId) }),
        queryClient.invalidateQueries({
          queryKey: [...inkadeQueryKeys.all, "comment-threads", docId],
        }),
        queryClient.invalidateQueries({
          queryKey: inkadeQueryKeys.highlightComments(variables.highlightId),
        }),
      ]);
      await options?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

export function useReopenHighlightMutation(
  options?: Omit<UseMutationOptions<DocumentHighlight, Error, HighlightResolutionVariables>, "mutationFn">,
): UseMutationResult<DocumentHighlight, Error, HighlightResolutionVariables> {
  const client = useInkadeClient();
  const queryClient = useQueryClient();
  return useMutation({
    ...options,
    mutationFn: ({ highlightId }) => client.highlights.reopen(highlightId),
    onSuccess: async (data, variables, onMutateResult, context) => {
      const docId = variables.documentId ?? data.documentId;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.highlights(docId) }),
        queryClient.invalidateQueries({
          queryKey: [...inkadeQueryKeys.all, "comment-threads", docId],
        }),
        queryClient.invalidateQueries({
          queryKey: inkadeQueryKeys.highlightComments(variables.highlightId),
        }),
      ]);
      await options?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

export function useUpdateViewerContextMutation(
  options?: Omit<
    UseMutationOptions<UpdateViewerContextResponse, Error, UpdateViewerContextInput>,
    "mutationFn"
  >,
): UseMutationResult<UpdateViewerContextResponse, Error, UpdateViewerContextInput> {
  const client = useInkadeClient();
  const queryClient = useQueryClient();
  return useMutation({
    ...options,
    mutationFn: (input) => client.documents.updateViewerContext(input),
    onSuccess: async (data, variables, onMutateResult, context) => {
      await queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.viewerContext() });
      await options?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

export interface CreateDocumentArtifactVariables {
  readonly documentId: DocumentId;
  readonly input: CreateDocumentArtifactInput;
}

export function useCreateDocumentArtifactMutation(
  options?: Omit<
    UseMutationOptions<CreateDocumentArtifactResponse, Error, CreateDocumentArtifactVariables>,
    "mutationFn"
  >,
): UseMutationResult<CreateDocumentArtifactResponse, Error, CreateDocumentArtifactVariables> {
  const client = useInkadeClient();
  const queryClient = useQueryClient();
  return useMutation({
    ...options,
    mutationFn: ({ documentId, input }) => client.artifacts.create(documentId, input),
    onSuccess: async (data, variables, onMutateResult, context) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.artifacts(variables.documentId) }),
        queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.document(variables.documentId) }),
      ]);
      await options?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

export interface UpdateDocumentArtifactVariables {
  readonly artifactId: DocumentArtifactId;
  readonly input: UpdateDocumentArtifactInput;
}

export function useUpdateDocumentArtifactMutation(
  options?: Omit<
    UseMutationOptions<UpdateDocumentArtifactResponse, Error, UpdateDocumentArtifactVariables>,
    "mutationFn"
  >,
): UseMutationResult<UpdateDocumentArtifactResponse, Error, UpdateDocumentArtifactVariables> {
  const client = useInkadeClient();
  const queryClient = useQueryClient();
  return useMutation({
    ...options,
    mutationFn: ({ artifactId, input }) => client.artifacts.update(artifactId, input),
    onSuccess: async (data, variables, onMutateResult, context) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.artifact(variables.artifactId) }),
        queryClient.invalidateQueries({
          queryKey: inkadeQueryKeys.artifacts(data.artifact.documentId),
        }),
      ]);
      await options?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

export interface DeleteDocumentArtifactVariables {
  readonly artifactId: DocumentArtifactId;
  readonly documentId?: DocumentId | undefined;
}

export function useDeleteDocumentArtifactMutation(
  options?: Omit<
    UseMutationOptions<DeleteDocumentArtifactResponse, Error, DeleteDocumentArtifactVariables>,
    "mutationFn"
  >,
): UseMutationResult<DeleteDocumentArtifactResponse, Error, DeleteDocumentArtifactVariables> {
  const client = useInkadeClient();
  const queryClient = useQueryClient();
  return useMutation({
    ...options,
    mutationFn: ({ artifactId }) => client.artifacts.delete(artifactId),
    onSuccess: async (data, variables, onMutateResult, context) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.artifact(variables.artifactId) }),
        ...(variables.documentId
          ? [
              queryClient.invalidateQueries({
                queryKey: inkadeQueryKeys.artifacts(variables.documentId),
              }),
            ]
          : [queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "artifacts"] })]),
      ]);
      await options?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}

export interface SubmitArtifactCommentVariables {
  readonly artifactId: DocumentArtifactId;
  readonly documentId?: DocumentId | undefined;
  readonly input: SubmitArtifactCommentInput;
}

export function useSubmitArtifactCommentMutation(
  options?: Omit<
    UseMutationOptions<SendHighlightToAgentResult, Error, SubmitArtifactCommentVariables>,
    "mutationFn"
  >,
): UseMutationResult<SendHighlightToAgentResult, Error, SubmitArtifactCommentVariables> {
  const client = useInkadeClient();
  const queryClient = useQueryClient();
  return useMutation({
    ...options,
    mutationFn: ({ artifactId, input }) => client.artifacts.submitComment(artifactId, input),
    onSuccess: async (data, variables, onMutateResult, context) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "thread-bindings"] }),
        queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "wake-events"] }),
        ...(variables.documentId
          ? [
              queryClient.invalidateQueries({
                queryKey: inkadeQueryKeys.highlights(variables.documentId),
              }),
            ]
          : []),
      ]);
      await options?.onSuccess?.(data, variables, onMutateResult, context);
    },
  });
}
