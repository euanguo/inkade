import { keepPreviousData, queryOptions, useQuery, type UseQueryResult } from "@tanstack/react-query";
import {
  type AdeThreadBinding,
  type AgentBriefingRunRecord,
  type AiSettingsRecord,
  type AttachmentRecord,
  type AuditBatchDigestSummary,
  type AuditLogRecord,
  type AwaySummaryResponse,
  type BridgeSessionRecord,
  type CalendarEventInstance,
  type CalendarSubscription,
  type ConnectPingStatus,
  type ContextPack,
  type DocumentArtifact,
  type DocumentArtifactId,
  type DocumentArtifactSummary,
  type DocumentGraph,
  type DocumentHighlight,
  type DocumentId,
  type GetViewerContextResult,
  type HighlightCommentThread,
  type HighlightId,
  type HighlightStatus,
  type DocumentKind,
  type DocumentLink,
  type DocumentRecord,
  type DocumentRevision,
  type DocumentSummary,
  type DocumentTemplate,
  type ListBridgeSessionsInput,
  type ListCalendarEventsQuery,
  type OutlineNode,
  type ProjectScopeRule,
  type PublicSharedDocument,
  type PublicSite,
  type PublicSiteDocumentPayload,
  type PublicSitePayload,
  type RelatedDocumentHit,
  type RenderedContextPack,
  type SavedView,
  type SearchHit,
  type SearchIndexStatus,
  type SearchQueryInput,
  type SemanticSearchRequestInput,
  type SemanticSearchResult,
  type ShareLink,
  type Space,
  type SpaceId,
  type SpacePropertySchema,
  type StorageBucketsResponse,
  type TemplateId,
  type UnlinkedMentionItem,
  type UserPreferencesRecord,
  type ViewQueryRequestInput,
  type ViewQueryResponse,
  type WorkspaceGraph,
  type WorkspaceGraphQuery,
  type WorkspaceSummary,
  type WorkspaceTaskItem,
  type ApiTokenRecord,
} from "@inkade/core";
import type {
  BootstrapResponse,
  DailyOutlineResponse,
  HighlightCommentsResponse,
  InkadeClient,
  ListAuditLogsParams,
  ListBriefingJobsResponse,
  ListBriefingRunsParams,
  ListDocumentsParams,
  ListTasksParams,
  ListThreadBindingsParams,
  RevisionDiffResponse,
  WhoAmIScopeResponse,
} from "../client.ts";
import type { SandboxRuntimeConfigStatus } from "@inkade/core";
import { inkadeQueryKeys } from "../query-keys.ts";
import { useInkadeClient } from "./provider.tsx";

export interface BaseQueryOptions {
  readonly enabled?: boolean | undefined;
  readonly staleTime?: number | undefined;
  readonly refetchInterval?: number | false | undefined;
}

function pickDefinedDocumentFilter(params: ListDocumentsParams = {}): ListDocumentsParams {
  return {
    ...(params.spaceId !== undefined ? { spaceId: params.spaceId } : {}),
    ...(params.kind !== undefined ? { kind: params.kind } : {}),
    ...(params.tag !== undefined ? { tag: params.tag } : {}),
    ...(params.pinnedOnly !== undefined ? { pinnedOnly: params.pinnedOnly } : {}),
    ...(params.includeTrashed !== undefined ? { includeTrashed: params.includeTrashed } : {}),
    ...(params.limit !== undefined ? { limit: params.limit } : {}),
    ...(params.offset !== undefined ? { offset: params.offset } : {}),
  };
}

function pickDefinedTaskFilter(params: ListTasksParams = {}): ListTasksParams {
  return {
    ...(params.status !== undefined ? { status: params.status } : {}),
    ...(params.sourceEngine !== undefined ? { sourceEngine: params.sourceEngine } : {}),
    ...(params.spaceId !== undefined ? { spaceId: params.spaceId } : {}),
    ...(params.tag !== undefined ? { tag: params.tag } : {}),
    ...(params.priority !== undefined ? { priority: params.priority } : {}),
    ...(params.bucket !== undefined ? { bucket: params.bucket } : {}),
    ...(params.scheduledDate !== undefined ? { scheduledDate: params.scheduledDate } : {}),
    ...(params.dueDate !== undefined ? { dueDate: params.dueDate } : {}),
    ...(params.includeAnytime !== undefined ? { includeAnytime: params.includeAnytime } : {}),
    ...(params.limit !== undefined ? { limit: params.limit } : {}),
    ...(params.offset !== undefined ? { offset: params.offset } : {}),
  };
}

/**
 * Reusable TanStack Query v5 `queryOptions` factories shared across web, views, and host integrations.
 */
export const inkadeQueries = {
  bootstrap: (client: InkadeClient) =>
    queryOptions({
      queryKey: inkadeQueryKeys.bootstrap(),
      queryFn: () => client.bootstrap.status(),
    }),

  whoami: (client: InkadeClient) =>
    queryOptions({
      queryKey: inkadeQueryKeys.whoami(),
      queryFn: () => client.auth.whoami(),
    }),

  spaces: (client: InkadeClient, includeArchived = false) =>
    queryOptions({
      queryKey: inkadeQueryKeys.spaces(includeArchived),
      queryFn: () => client.spaces.list({ includeArchived }),
    }),

  space: (client: InkadeClient, spaceId: SpaceId) =>
    queryOptions({
      queryKey: inkadeQueryKeys.space(spaceId),
      queryFn: () => client.spaces.get(spaceId),
    }),

  documents: (client: InkadeClient, params: ListDocumentsParams = {}) =>
    queryOptions({
      queryKey: inkadeQueryKeys.documents(pickDefinedDocumentFilter(params)),
      queryFn: () => client.documents.list(params),
    }),

  document: (client: InkadeClient, documentId: DocumentId) =>
    queryOptions({
      queryKey: inkadeQueryKeys.document(documentId),
      queryFn: () => client.documents.get(documentId),
    }),

  dailyOutline: (client: InkadeClient, date: string) =>
    queryOptions({
      queryKey: inkadeQueryKeys.dailyOutline(date),
      queryFn: () => client.documents.getDaily(date),
    }),

  outlineNodes: (client: InkadeClient, documentId: DocumentId) =>
    queryOptions({
      queryKey: inkadeQueryKeys.outlineNodes(documentId),
      queryFn: () => client.outlineNodes.list(documentId),
    }),

  revisions: (client: InkadeClient, documentId: DocumentId) =>
    queryOptions({
      queryKey: inkadeQueryKeys.revisions(documentId),
      queryFn: () => client.documents.listRevisions(documentId),
    }),

  revisionDiff: (
    client: InkadeClient,
    documentId: DocumentId,
    fromVersion: number,
    toVersion: number,
  ) =>
    queryOptions({
      queryKey: inkadeQueryKeys.revisionDiff(documentId, fromVersion, toVersion),
      queryFn: () => client.documents.getRevisionDiff(documentId, fromVersion, toVersion),
    }),

  backlinks: (client: InkadeClient, documentId: DocumentId) =>
    queryOptions({
      queryKey: inkadeQueryKeys.backlinks(documentId),
      queryFn: () => client.documents.listBacklinks(documentId),
    }),

  unlinkedMentions: (client: InkadeClient, documentId: DocumentId) =>
    queryOptions({
      queryKey: inkadeQueryKeys.unlinkedMentions(documentId),
      queryFn: () => client.documents.unlinkedMentions(documentId),
    }),

  documentGraph: (client: InkadeClient, documentId: DocumentId, depth = 2) =>
    queryOptions({
      queryKey: inkadeQueryKeys.documentGraph(documentId, depth),
      queryFn: () => client.documents.graph(documentId, depth),
    }),

  relatedDocuments: (client: InkadeClient, documentId: DocumentId, limit = 10) =>
    queryOptions({
      queryKey: inkadeQueryKeys.relatedDocuments(documentId, limit),
      queryFn: () => client.documents.related(documentId, limit),
    }),

  tasks: (client: InkadeClient, params: ListTasksParams = {}) =>
    queryOptions({
      queryKey: inkadeQueryKeys.tasks(pickDefinedTaskFilter(params)),
      queryFn: () => client.tasks.list(params),
    }),

  calendarSubscriptions: (client: InkadeClient) =>
    queryOptions({
      queryKey: inkadeQueryKeys.calendarSubscriptions(),
      queryFn: () => client.calendar.listSubscriptions(),
    }),

  calendarEvents: (client: InkadeClient, params: ListCalendarEventsQuery) =>
    queryOptions({
      queryKey: inkadeQueryKeys.calendarEvents(params),
      queryFn: () => client.calendar.listEvents(params),
    }),

  threadBindings: (client: InkadeClient, params: ListThreadBindingsParams = {}) =>
    queryOptions({
      queryKey: inkadeQueryKeys.threadBindings(params),
      queryFn: () => client.threadBindings.list(params),
    }),

  bridgeSessions: (client: InkadeClient, params: ListBridgeSessionsInput = {}) =>
    queryOptions({
      queryKey: inkadeQueryKeys.bridgeSessions(params),
      queryFn: () => client.threadBindings.listBridgeSessions(params),
    }),

  search: (client: InkadeClient, input: SearchQueryInput) =>
    queryOptions({
      queryKey: inkadeQueryKeys.search(input.q, input.spaceId, input.kind, input.tag),
      queryFn: () => client.search.query(input),
    }),

  semanticSearch: (client: InkadeClient, input: SemanticSearchRequestInput) =>
    queryOptions({
      queryKey: inkadeQueryKeys.semanticSearch(
        input.q,
        input.mode ?? "hybrid",
        input.spaceId,
        input.kind,
        input.tag,
      ),
      queryFn: () => client.search.semantic(input),
    }),

  tokens: (client: InkadeClient) =>
    queryOptions({
      queryKey: inkadeQueryKeys.tokens(),
      queryFn: () => client.tokens.list(),
    }),

  scopeRules: (client: InkadeClient) =>
    queryOptions({
      queryKey: inkadeQueryKeys.scopeRules(),
      queryFn: () => client.scopeRules.list(),
    }),

  attachments: (
    client: InkadeClient,
    filter: { readonly documentId?: DocumentId | undefined; readonly orphanOnly?: boolean | undefined } = {},
  ) =>
    queryOptions({
      queryKey: inkadeQueryKeys.attachments({
        ...(filter.documentId !== undefined ? { documentId: filter.documentId } : {}),
        ...(filter.orphanOnly !== undefined ? { orphanOnly: filter.orphanOnly } : {}),
      }),
      queryFn: () => client.attachments.list(filter),
    }),

  workspaceSummary: (client: InkadeClient) =>
    queryOptions({
      queryKey: inkadeQueryKeys.workspaceSummary(),
      queryFn: () => client.workspace.summary(),
    }),

  awaySummary: (client: InkadeClient, since?: string) =>
    queryOptions({
      queryKey: inkadeQueryKeys.awaySummary(since),
      queryFn: () => client.workspace.awaySummary(since !== undefined ? { since } : undefined),
    }),

  storageBuckets: (client: InkadeClient) =>
    queryOptions({
      queryKey: inkadeQueryKeys.storageBuckets(),
      queryFn: () => client.workspace.storageBuckets(),
    }),

  highlights: (client: InkadeClient, documentId: DocumentId) =>
    queryOptions({
      queryKey: inkadeQueryKeys.highlights(documentId),
      queryFn: () => client.highlights.list(documentId),
    }),

  commentThreads: (
    client: InkadeClient,
    documentId: DocumentId,
    status: HighlightStatus | "all" = "all",
  ) =>
    queryOptions({
      queryKey: inkadeQueryKeys.commentThreads(documentId, status),
      queryFn: () => client.documents.listCommentThreads(documentId, status),
    }),

  highlightComments: (client: InkadeClient, highlightId: HighlightId) =>
    queryOptions({
      queryKey: inkadeQueryKeys.highlightComments(highlightId),
      queryFn: () => client.documents.listHighlightComments(highlightId),
    }),

  viewerContext: (client: InkadeClient) =>
    queryOptions({
      queryKey: inkadeQueryKeys.viewerContext(),
      queryFn: () => client.documents.getViewerContext(),
    }),

  templates: (client: InkadeClient, kind?: DocumentKind) =>
    queryOptions({
      queryKey: inkadeQueryKeys.templates(kind),
      queryFn: () => client.templates.list(kind),
    }),

  shareLinks: (client: InkadeClient, documentId?: DocumentId) =>
    queryOptions({
      queryKey: inkadeQueryKeys.shareLinks(documentId),
      queryFn: () => client.shareLinks.list(documentId),
    }),

  publicShare: (client: InkadeClient, token: string) =>
    queryOptions({
      queryKey: inkadeQueryKeys.publicShare(token),
      queryFn: () => client.shareLinks.getPublic(token),
    }),

  savedViews: (client: InkadeClient) =>
    queryOptions({
      queryKey: inkadeQueryKeys.savedViews(),
      queryFn: () => client.savedViews.list(),
    }),

  preferences: (client: InkadeClient) =>
    queryOptions({
      queryKey: inkadeQueryKeys.preferences(),
      queryFn: () => client.preferences.get(),
    }),

  auditLogs: (client: InkadeClient, filter: ListAuditLogsParams = {}) =>
    queryOptions({
      queryKey: inkadeQueryKeys.auditLogs(filter),
      queryFn: () => client.auditLogs.list(filter),
    }),

  auditBatches: (client: InkadeClient, limit = 20) =>
    queryOptions({
      queryKey: inkadeQueryKeys.auditBatches(limit),
      queryFn: () => client.auditLogs.listBatches(limit),
    }),

  aiSettings: (client: InkadeClient) =>
    queryOptions({
      queryKey: inkadeQueryKeys.aiSettings(),
      queryFn: () => client.ai.getSettings(),
    }),

  searchIndexStatus: (client: InkadeClient) =>
    queryOptions({
      queryKey: inkadeQueryKeys.searchIndexStatus(),
      queryFn: () => client.search.indexStatus(),
    }),

  contextPacks: (client: InkadeClient) =>
    queryOptions({
      queryKey: inkadeQueryKeys.contextPacks(),
      queryFn: () => client.contextPacks.list(),
    }),

  contextPack: (client: InkadeClient, slug: string, maxTokens?: number) =>
    queryOptions({
      queryKey: inkadeQueryKeys.contextPack(slug, maxTokens),
      queryFn: () =>
        client.contextPacks.getBySlug(slug, maxTokens !== undefined ? { maxTokens } : undefined),
    }),

  connectStatus: (client: InkadeClient) =>
    queryOptions({
      queryKey: inkadeQueryKeys.connectStatus(),
      queryFn: () => client.connect.status(),
    }),

  spaceSchemas: (client: InkadeClient) =>
    queryOptions({
      queryKey: inkadeQueryKeys.spaceSchemas(),
      queryFn: () => client.spaces.listSchemas(),
    }),

  spaceSchema: (client: InkadeClient, spaceId: SpaceId, templateId?: TemplateId) =>
    queryOptions({
      queryKey: inkadeQueryKeys.spaceSchema(spaceId, templateId),
      queryFn: () => client.spaces.getSchema(spaceId, templateId ? { templateId } : undefined),
    }),

  viewQuery: (client: InkadeClient, input: ViewQueryRequestInput) =>
    queryOptions({
      queryKey: inkadeQueryKeys.viewQuery(input),
      queryFn: () => client.views.query(input),
    }),

  workspaceGraph: (client: InkadeClient, filter: WorkspaceGraphQuery = {}) =>
    queryOptions({
      queryKey: inkadeQueryKeys.workspaceGraph(filter),
      queryFn: () => client.workspace.graph(filter),
    }),

  publicSites: (client: InkadeClient) =>
    queryOptions({
      queryKey: inkadeQueryKeys.publicSites(),
      queryFn: () => client.publicSites.list(),
    }),

  publicSite: (client: InkadeClient, slug: string) =>
    queryOptions({
      queryKey: inkadeQueryKeys.publicSite(slug),
      queryFn: () => client.publicSites.getPublic(slug),
    }),

  publicSiteDoc: (client: InkadeClient, slug: string, docSlug: string) =>
    queryOptions({
      queryKey: inkadeQueryKeys.publicSiteDoc(slug, docSlug),
      queryFn: () => client.publicSites.getPublicDoc(slug, docSlug),
    }),

  briefingJobs: (client: InkadeClient) =>
    queryOptions({
      queryKey: inkadeQueryKeys.briefingJobs(),
      queryFn: () => client.briefings.listJobs(),
    }),

  briefingRuns: (client: InkadeClient, filter: ListBriefingRunsParams = {}) =>
    queryOptions({
      queryKey: inkadeQueryKeys.briefingRuns(filter),
      queryFn: () => client.briefings.listRuns(filter),
    }),

  artifactRuntimeConfig: (client: InkadeClient) =>
    queryOptions({
      queryKey: inkadeQueryKeys.artifactRuntimeConfig(),
      queryFn: () => client.artifacts.getRuntimeConfig(),
    }),

  artifacts: (client: InkadeClient, documentId: DocumentId) =>
    queryOptions({
      queryKey: inkadeQueryKeys.artifacts(documentId),
      queryFn: () => client.artifacts.list(documentId),
    }),

  artifact: (client: InkadeClient, artifactId: DocumentArtifactId) =>
    queryOptions({
      queryKey: inkadeQueryKeys.artifact(artifactId),
      queryFn: () => client.artifacts.get(artifactId),
    }),
};

function applyBaseOptions(options?: BaseQueryOptions) {
  return {
    ...(options?.enabled !== undefined ? { enabled: options.enabled } : {}),
    ...(options?.staleTime !== undefined ? { staleTime: options.staleTime } : {}),
    ...(options?.refetchInterval !== undefined ? { refetchInterval: options.refetchInterval } : {}),
  };
}

export function useInkadeBootstrap(options?: BaseQueryOptions): UseQueryResult<BootstrapResponse> {
  const client = useInkadeClient();
  return useQuery({
    ...inkadeQueries.bootstrap(client),
    ...applyBaseOptions(options),
  });
}

export function useInkadeWhoami(options?: BaseQueryOptions): UseQueryResult<WhoAmIScopeResponse> {
  const client = useInkadeClient();
  return useQuery({
    ...inkadeQueries.whoami(client),
    ...applyBaseOptions(options),
  });
}

export function useInkadeSpaces(
  options?: BaseQueryOptions & { readonly includeArchived?: boolean | undefined },
): UseQueryResult<readonly Space[]> {
  const client = useInkadeClient();
  const includeArchived = options?.includeArchived ?? false;
  return useQuery({
    ...inkadeQueries.spaces(client, includeArchived),
    ...applyBaseOptions(options),
  });
}

export function useInkadeDocuments(
  params: ListDocumentsParams = {},
  options?: BaseQueryOptions,
): UseQueryResult<readonly DocumentSummary[]> {
  const client = useInkadeClient();
  return useQuery({
    ...inkadeQueries.documents(client, params),
    ...applyBaseOptions(options),
  });
}

function nullableDocQuery<TData>(
  documentId: DocumentId | undefined,
  scope: string,
  buildOptions: (id: DocumentId) => {
    readonly queryKey: readonly unknown[];
    readonly queryFn?: unknown;
  },
  options?: BaseQueryOptions,
) {
  const resolved = documentId ? buildOptions(documentId) : null;
  const queryKey: readonly unknown[] = resolved
    ? resolved.queryKey
    : [...inkadeQueryKeys.all, scope, null];
  const queryFn: () => Promise<TData> = resolved
    ? (resolved.queryFn as () => Promise<TData>)
    : () => Promise.reject(new Error("documentId is required"));
  return {
    queryKey,
    queryFn,
    enabled: Boolean(documentId) && (options?.enabled ?? true),
    ...(options?.staleTime !== undefined ? { staleTime: options.staleTime } : {}),
    ...(options?.refetchInterval !== undefined ? { refetchInterval: options.refetchInterval } : {}),
  };
}

export function useInkadeDocument(
  documentId: DocumentId | undefined,
  options?: BaseQueryOptions,
): UseQueryResult<DocumentRecord> {
  const client = useInkadeClient();
  return useQuery<DocumentRecord>(
    nullableDocQuery<DocumentRecord>(
      documentId,
      "document",
      (id) => inkadeQueries.document(client, id),
      options,
    ),
  );
}

export function useInkadeOutlineNodes(
  documentId: DocumentId | undefined,
  options?: BaseQueryOptions,
): UseQueryResult<readonly OutlineNode[]> {
  const client = useInkadeClient();
  return useQuery<readonly OutlineNode[]>(
    nullableDocQuery<readonly OutlineNode[]>(
      documentId,
      "outline-nodes",
      (id) => inkadeQueries.outlineNodes(client, id),
      options,
    ),
  );
}

export function useInkadeDailyOutline(
  date: string,
  options?: BaseQueryOptions,
): UseQueryResult<DailyOutlineResponse> {
  const client = useInkadeClient();
  return useQuery({
    ...inkadeQueries.dailyOutline(client, date),
    enabled: Boolean(date) && (options?.enabled ?? true),
    placeholderData: keepPreviousData,
    ...(options?.staleTime !== undefined ? { staleTime: options.staleTime } : {}),
    ...(options?.refetchInterval !== undefined ? { refetchInterval: options.refetchInterval } : {}),
  });
}

export function useInkadeTasks(
  params: ListTasksParams = {},
  options?: BaseQueryOptions,
): UseQueryResult<readonly WorkspaceTaskItem[]> {
  const client = useInkadeClient();
  return useQuery({
    ...inkadeQueries.tasks(client, params),
    placeholderData: keepPreviousData,
    ...applyBaseOptions(options),
  });
}

export function useInkadeThreadBindings(
  params: ListThreadBindingsParams = {},
  options?: BaseQueryOptions,
): UseQueryResult<readonly AdeThreadBinding[]> {
  const client = useInkadeClient();
  return useQuery({
    ...inkadeQueries.threadBindings(client, params),
    placeholderData: keepPreviousData,
    ...applyBaseOptions(options),
  });
}

export function useInkadeBridgeSessions(
  params: ListBridgeSessionsInput = {},
  options?: BaseQueryOptions,
): UseQueryResult<readonly BridgeSessionRecord[]> {
  const client = useInkadeClient();
  return useQuery({
    ...inkadeQueries.bridgeSessions(client, params),
    placeholderData: keepPreviousData,
    ...applyBaseOptions(options),
  });
}

export function useInkadeWorkspaceSummary(
  options?: BaseQueryOptions,
): UseQueryResult<WorkspaceSummary> {
  const client = useInkadeClient();
  return useQuery({
    ...inkadeQueries.workspaceSummary(client),
    ...applyBaseOptions(options),
  });
}

export function useInkadeSavedViews(options?: BaseQueryOptions): UseQueryResult<readonly SavedView[]> {
  const client = useInkadeClient();
  return useQuery({
    ...inkadeQueries.savedViews(client),
    ...applyBaseOptions(options),
  });
}

export function useInkadeTemplates(
  kind?: DocumentKind,
  options?: BaseQueryOptions,
): UseQueryResult<readonly DocumentTemplate[]> {
  const client = useInkadeClient();
  return useQuery({
    ...inkadeQueries.templates(client, kind),
    ...applyBaseOptions(options),
  });
}

export function useInkadeTokens(options?: BaseQueryOptions): UseQueryResult<readonly ApiTokenRecord[]> {
  const client = useInkadeClient();
  return useQuery({
    ...inkadeQueries.tokens(client),
    ...applyBaseOptions(options),
  });
}

export function useInkadeScopeRules(
  options?: BaseQueryOptions,
): UseQueryResult<readonly ProjectScopeRule[]> {
  const client = useInkadeClient();
  return useQuery({
    ...inkadeQueries.scopeRules(client),
    ...applyBaseOptions(options),
  });
}

export function useInkadeStorageBuckets(
  options?: BaseQueryOptions,
): UseQueryResult<StorageBucketsResponse> {
  const client = useInkadeClient();
  return useQuery({
    ...inkadeQueries.storageBuckets(client),
    ...applyBaseOptions(options),
  });
}

export function useInkadeShareLinks(
  documentId?: DocumentId,
  options?: BaseQueryOptions,
): UseQueryResult<readonly ShareLink[]> {
  const client = useInkadeClient();
  return useQuery({
    ...inkadeQueries.shareLinks(client, documentId),
    ...applyBaseOptions(options),
  });
}

export function useInkadeHighlights(
  documentId: DocumentId | undefined,
  options?: BaseQueryOptions,
): UseQueryResult<readonly DocumentHighlight[]> {
  const client = useInkadeClient();
  return useQuery<readonly DocumentHighlight[]>(
    nullableDocQuery<readonly DocumentHighlight[]>(
      documentId,
      "highlights",
      (id) => inkadeQueries.highlights(client, id),
      options,
    ),
  );
}

export function useInkadeCommentThreads(
  documentId: DocumentId | undefined,
  status: HighlightStatus | "all" = "all",
  options?: BaseQueryOptions,
): UseQueryResult<readonly HighlightCommentThread[]> {
  const client = useInkadeClient();
  return useQuery<readonly HighlightCommentThread[]>(
    nullableDocQuery<readonly HighlightCommentThread[]>(
      documentId,
      "comment-threads",
      (id) => inkadeQueries.commentThreads(client, id, status),
      options,
    ),
  );
}

export function useInkadeHighlightComments(
  highlightId: HighlightId | undefined,
  options?: BaseQueryOptions,
): UseQueryResult<HighlightCommentsResponse> {
  const client = useInkadeClient();
  const queryKey: readonly unknown[] = highlightId
    ? inkadeQueryKeys.highlightComments(highlightId)
    : [...inkadeQueryKeys.all, "highlight-comments", null];
  return useQuery<HighlightCommentsResponse>({
    queryKey,
    queryFn: () =>
      highlightId
        ? client.documents.listHighlightComments(highlightId)
        : Promise.reject(new Error("highlightId is required")),
    enabled: Boolean(highlightId) && (options?.enabled ?? true),
    ...(options?.staleTime !== undefined ? { staleTime: options.staleTime } : {}),
    ...(options?.refetchInterval !== undefined ? { refetchInterval: options.refetchInterval } : {}),
  });
}

export function useInkadeViewerContext(
  options?: BaseQueryOptions,
): UseQueryResult<GetViewerContextResult> {
  const client = useInkadeClient();
  return useQuery({
    ...inkadeQueries.viewerContext(client),
    ...applyBaseOptions(options),
  });
}

export function useInkadeRevisions(
  documentId: DocumentId | undefined,
  options?: BaseQueryOptions,
): UseQueryResult<readonly DocumentRevision[]> {
  const client = useInkadeClient();
  return useQuery<readonly DocumentRevision[]>(
    nullableDocQuery<readonly DocumentRevision[]>(
      documentId,
      "revisions",
      (id) => inkadeQueries.revisions(client, id),
      options,
    ),
  );
}

export function useInkadeRevisionDiff(
  documentId: DocumentId | undefined,
  fromVersion: number | undefined,
  toVersion: number | undefined,
  options?: BaseQueryOptions,
): UseQueryResult<RevisionDiffResponse> {
  const client = useInkadeClient();
  const valid = Boolean(documentId) && fromVersion !== undefined && toVersion !== undefined;
  const from = fromVersion ?? 0;
  const to = toVersion ?? 0;
  return useQuery<RevisionDiffResponse>(
    nullableDocQuery<RevisionDiffResponse>(
      valid ? documentId : undefined,
      "revision-diff",
      (id) => inkadeQueries.revisionDiff(client, id, from, to),
      options,
    ),
  );
}

export function useInkadeBacklinks(
  documentId: DocumentId | undefined,
  options?: BaseQueryOptions,
): UseQueryResult<readonly DocumentLink[]> {
  const client = useInkadeClient();
  return useQuery<readonly DocumentLink[]>(
    nullableDocQuery<readonly DocumentLink[]>(
      documentId,
      "backlinks",
      (id) => inkadeQueries.backlinks(client, id),
      options,
    ),
  );
}

export function useInkadeUnlinkedMentions(
  documentId: DocumentId | undefined,
  options?: BaseQueryOptions,
): UseQueryResult<readonly UnlinkedMentionItem[]> {
  const client = useInkadeClient();
  return useQuery<readonly UnlinkedMentionItem[]>(
    nullableDocQuery<readonly UnlinkedMentionItem[]>(
      documentId,
      "unlinked-mentions",
      (id) => inkadeQueries.unlinkedMentions(client, id),
      options,
    ),
  );
}

export function useInkadeDocumentGraph(
  documentId: DocumentId | undefined,
  depth = 2,
  options?: BaseQueryOptions,
): UseQueryResult<DocumentGraph> {
  const client = useInkadeClient();
  return useQuery<DocumentGraph>(
    nullableDocQuery<DocumentGraph>(
      documentId,
      "document-graph",
      (id) => inkadeQueries.documentGraph(client, id, depth),
      options,
    ),
  );
}

export function useInkadeRelatedDocuments(
  documentId: DocumentId | undefined,
  limit = 10,
  options?: BaseQueryOptions,
): UseQueryResult<readonly RelatedDocumentHit[]> {
  const client = useInkadeClient();
  return useQuery<readonly RelatedDocumentHit[]>(
    nullableDocQuery<readonly RelatedDocumentHit[]>(
      documentId,
      "related-documents",
      (id) => inkadeQueries.relatedDocuments(client, id, limit),
      options,
    ),
  );
}

export function useInkadeAttachments(
  filter: { readonly documentId?: DocumentId | undefined; readonly orphanOnly?: boolean | undefined } = {},
  options?: BaseQueryOptions,
): UseQueryResult<readonly AttachmentRecord[]> {
  const client = useInkadeClient();
  return useQuery({
    ...inkadeQueries.attachments(client, filter),
    ...applyBaseOptions(options),
  });
}

export function useInkadeAwaySummary(
  since?: string,
  options?: BaseQueryOptions,
): UseQueryResult<AwaySummaryResponse> {
  const client = useInkadeClient();
  return useQuery({
    ...inkadeQueries.awaySummary(client, since),
    ...applyBaseOptions(options),
  });
}

export function useInkadePublicShare(
  token: string,
  options?: BaseQueryOptions,
): UseQueryResult<PublicSharedDocument> {
  const client = useInkadeClient();
  return useQuery({
    ...inkadeQueries.publicShare(client, token),
    enabled: Boolean(token) && (options?.enabled ?? true),
    ...(options?.staleTime !== undefined ? { staleTime: options.staleTime } : {}),
  });
}

export function useInkadePreferences(
  options?: BaseQueryOptions,
): UseQueryResult<UserPreferencesRecord> {
  const client = useInkadeClient();
  return useQuery({
    ...inkadeQueries.preferences(client),
    ...applyBaseOptions(options),
  });
}

export function useInkadeAuditLogs(
  filter: ListAuditLogsParams = {},
  options?: BaseQueryOptions,
): UseQueryResult<readonly AuditLogRecord[]> {
  const client = useInkadeClient();
  return useQuery({
    ...inkadeQueries.auditLogs(client, filter),
    ...applyBaseOptions(options),
  });
}

export function useInkadeAuditBatches(
  limit = 20,
  options?: BaseQueryOptions,
): UseQueryResult<readonly AuditBatchDigestSummary[]> {
  const client = useInkadeClient();
  return useQuery({
    ...inkadeQueries.auditBatches(client, limit),
    ...applyBaseOptions(options),
  });
}

export function useInkadeAiSettings(options?: BaseQueryOptions): UseQueryResult<AiSettingsRecord> {
  const client = useInkadeClient();
  return useQuery({
    ...inkadeQueries.aiSettings(client),
    ...applyBaseOptions(options),
  });
}

export function useInkadeCalendarSubscriptions(
  options?: BaseQueryOptions,
): UseQueryResult<readonly CalendarSubscription[]> {
  const client = useInkadeClient();
  return useQuery({
    ...inkadeQueries.calendarSubscriptions(client),
    ...applyBaseOptions(options),
  });
}

export function useInkadeCalendarEvents(
  params: ListCalendarEventsQuery,
  options?: BaseQueryOptions,
): UseQueryResult<readonly CalendarEventInstance[]> {
  const client = useInkadeClient();
  return useQuery({
    ...inkadeQueries.calendarEvents(client, params),
    enabled: Boolean(params.start && params.end) && (options?.enabled ?? true),
    ...(options?.staleTime !== undefined ? { staleTime: options.staleTime } : {}),
    ...(options?.refetchInterval !== undefined
      ? { refetchInterval: options.refetchInterval }
      : {}),
  });
}

export function useInkadeSpaceSchemas(
  options?: BaseQueryOptions,
): UseQueryResult<readonly SpacePropertySchema[]> {
  const client = useInkadeClient();
  return useQuery({
    ...inkadeQueries.spaceSchemas(client),
    ...applyBaseOptions(options),
  });
}

export function useInkadeSpaceSchema(
  spaceId: SpaceId | undefined,
  templateId?: TemplateId,
  options?: BaseQueryOptions,
): UseQueryResult<SpacePropertySchema | null> {
  const client = useInkadeClient();
  return useQuery({
    queryKey: spaceId
      ? inkadeQueryKeys.spaceSchema(spaceId, templateId)
      : [...inkadeQueryKeys.all, "space-schema", "__none__", { templateId }],
    queryFn: () => {
      if (!spaceId) return null;
      return client.spaces.getSchema(spaceId, templateId ? { templateId } : undefined);
    },
    ...applyBaseOptions(options),
    enabled: Boolean(spaceId) && (options?.enabled ?? true),
  });
}

export function useInkadeViewQuery(
  input: ViewQueryRequestInput,
  options?: BaseQueryOptions,
): UseQueryResult<ViewQueryResponse> {
  const client = useInkadeClient();
  return useQuery({
    ...inkadeQueries.viewQuery(client, input),
    ...applyBaseOptions(options),
  });
}

export function useInkadeSearchIndexStatus(
  options?: BaseQueryOptions,
): UseQueryResult<SearchIndexStatus> {
  const client = useInkadeClient();
  return useQuery({
    ...inkadeQueries.searchIndexStatus(client),
    ...applyBaseOptions(options),
  });
}

export function useInkadeContextPacks(
  options?: BaseQueryOptions,
): UseQueryResult<readonly ContextPack[]> {
  const client = useInkadeClient();
  return useQuery({
    ...inkadeQueries.contextPacks(client),
    ...applyBaseOptions(options),
  });
}

export function useInkadeContextPack(
  slug: string | undefined,
  maxTokens?: number,
  options?: BaseQueryOptions,
): UseQueryResult<RenderedContextPack | null> {
  const client = useInkadeClient();
  const normalizedSlug = slug?.trim() ?? "";
  return useQuery({
    queryKey: normalizedSlug
      ? inkadeQueryKeys.contextPack(normalizedSlug, maxTokens)
      : [...inkadeQueryKeys.all, "context-pack", "__none__", { maxTokens }],
    queryFn: () => {
      if (!normalizedSlug) return null;
      return client.contextPacks.getBySlug(
        normalizedSlug,
        maxTokens !== undefined ? { maxTokens } : undefined,
      );
    },
    ...applyBaseOptions(options),
    enabled: Boolean(normalizedSlug) && (options?.enabled ?? true),
  });
}

export function useInkadeConnectStatus(
  options?: BaseQueryOptions,
): UseQueryResult<ConnectPingStatus> {
  const client = useInkadeClient();
  return useQuery({
    ...inkadeQueries.connectStatus(client),
    ...applyBaseOptions(options),
  });
}

export function useInkadeWorkspaceGraph(
  filter: WorkspaceGraphQuery = {},
  options?: BaseQueryOptions,
): UseQueryResult<WorkspaceGraph> {
  const client = useInkadeClient();
  return useQuery({
    ...inkadeQueries.workspaceGraph(client, filter),
    ...applyBaseOptions(options),
  });
}

export function useInkadePublicSites(
  options?: BaseQueryOptions,
): UseQueryResult<readonly PublicSite[]> {
  const client = useInkadeClient();
  return useQuery({
    ...inkadeQueries.publicSites(client),
    ...applyBaseOptions(options),
  });
}

export function useInkadePublicSite(
  slug: string | undefined,
  options?: BaseQueryOptions,
): UseQueryResult<PublicSitePayload> {
  const client = useInkadeClient();
  const cleanSlug = slug?.trim() ?? "";
  return useQuery({
    ...inkadeQueries.publicSite(client, cleanSlug),
    enabled: Boolean(cleanSlug) && (options?.enabled ?? true),
    ...(options?.staleTime !== undefined ? { staleTime: options.staleTime } : {}),
    ...(options?.refetchInterval !== undefined ? { refetchInterval: options.refetchInterval } : {}),
  });
}

export function useInkadePublicSiteDoc(
  slug: string | undefined,
  docSlug: string | undefined,
  options?: BaseQueryOptions,
): UseQueryResult<PublicSiteDocumentPayload> {
  const client = useInkadeClient();
  const cleanSlug = slug?.trim() ?? "";
  const cleanDocSlug = docSlug?.trim() ?? "";
  return useQuery({
    ...inkadeQueries.publicSiteDoc(client, cleanSlug, cleanDocSlug),
    enabled: Boolean(cleanSlug && cleanDocSlug) && (options?.enabled ?? true),
    ...(options?.staleTime !== undefined ? { staleTime: options.staleTime } : {}),
    ...(options?.refetchInterval !== undefined ? { refetchInterval: options.refetchInterval } : {}),
  });
}

export function useInkadeBriefingJobs(
  options?: BaseQueryOptions,
): UseQueryResult<ListBriefingJobsResponse> {
  const client = useInkadeClient();
  return useQuery({
    ...inkadeQueries.briefingJobs(client),
    ...applyBaseOptions(options),
  });
}

export function useInkadeBriefingRuns(
  filter: ListBriefingRunsParams = {},
  options?: BaseQueryOptions,
): UseQueryResult<readonly AgentBriefingRunRecord[]> {
  const client = useInkadeClient();
  return useQuery({
    ...inkadeQueries.briefingRuns(client, filter),
    ...applyBaseOptions(options),
  });
}

export function useInkadeArtifactRuntimeConfig(
  options?: BaseQueryOptions,
): UseQueryResult<SandboxRuntimeConfigStatus> {
  const client = useInkadeClient();
  return useQuery({
    ...inkadeQueries.artifactRuntimeConfig(client),
    ...applyBaseOptions(options),
  });
}

export function useInkadeDocumentArtifacts(
  documentId: DocumentId | undefined,
  options?: BaseQueryOptions,
): UseQueryResult<readonly DocumentArtifactSummary[]> {
  const client = useInkadeClient();
  return useQuery<readonly DocumentArtifactSummary[]>(
    nullableDocQuery<readonly DocumentArtifactSummary[]>(
      documentId,
      "artifacts",
      (id) => inkadeQueries.artifacts(client, id),
      options,
    ),
  );
}

export function useInkadeDocumentArtifact(
  artifactId: DocumentArtifactId | undefined,
  options?: BaseQueryOptions,
): UseQueryResult<DocumentArtifact> {
  const client = useInkadeClient();
  const resolved = artifactId ? inkadeQueries.artifact(client, artifactId) : null;
  const queryKey: readonly unknown[] = resolved
    ? resolved.queryKey
    : [...inkadeQueryKeys.all, "artifact", null];
  const queryFn: () => Promise<DocumentArtifact> = resolved
    ? (resolved.queryFn as () => Promise<DocumentArtifact>)
    : () => Promise.reject(new Error("artifactId is required"));
  return useQuery<DocumentArtifact>({
    queryKey,
    queryFn,
    enabled: Boolean(artifactId) && (options?.enabled ?? true),
    ...applyBaseOptions(options),
  });
}

export type { SearchHit, SemanticSearchResult };
