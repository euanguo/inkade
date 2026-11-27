import type {
  AdeThreadStatus,
  ApiTokenId,
  AttachmentId,
  AuditBatchId,
  AuditDecision,
  AuditTransport,
  DocumentArtifactId,
  DocumentAssetId,
  DocumentId,
  DocumentKind,
  HighlightId,
  HighlightStatus,
  ListBridgeSessionsInput,
  ListCalendarEventsQuery,
  OutlineNodeId,
  PollWakeEventsInput,
  SemanticSearchMode,
  SpaceId,
  TaskBucket,
  TaskPriority,
  TaskSourceEngine,
  TemplateId,
  ViewQueryRequestInput,
  WorkspaceGraphQuery,
} from "@inkade/core";
import type { ListBriefingRunsParams } from "./resources/briefings.ts";

export interface DocumentListFilter {
  readonly spaceId?: SpaceId | undefined;
  readonly kind?: DocumentKind | undefined;
  readonly tag?: string | undefined;
  readonly pinnedOnly?: boolean | undefined;
  readonly includeTrashed?: boolean | undefined;
  readonly limit?: number | undefined;
  readonly offset?: number | undefined;
}

export interface ThreadBindingListFilter {
  readonly documentId?: DocumentId | undefined;
  readonly nodeId?: OutlineNodeId | undefined;
  readonly status?: AdeThreadStatus | undefined;
}

export interface TaskListFilter {
  readonly status?: "open" | "completed" | "all" | undefined;
  readonly sourceEngine?: TaskSourceEngine | undefined;
  readonly spaceId?: SpaceId | undefined;
  readonly tag?: string | undefined;
  readonly priority?: TaskPriority | undefined;
  readonly bucket?: TaskBucket | undefined;
  readonly scheduledDate?: string | undefined;
  readonly dueDate?: string | undefined;
  readonly includeAnytime?: boolean | undefined;
  readonly limit?: number | undefined;
  readonly offset?: number | undefined;
}

export interface AuditLogListFilter {
  readonly tokenId?: ApiTokenId | undefined;
  readonly documentId?: DocumentId | undefined;
  readonly batchId?: AuditBatchId | undefined;
  readonly decision?: AuditDecision | undefined;
  readonly transport?: AuditTransport | undefined;
  readonly action?: string | undefined;
  readonly limit?: number | undefined;
  readonly offset?: number | undefined;
}

export const inkadeQueryKeys = {
  all: ["inkade"] as const,
  bootstrap: () => [...inkadeQueryKeys.all, "bootstrap"] as const,
  whoami: () => [...inkadeQueryKeys.all, "whoami"] as const,
  spaces: (includeArchived = false) =>
    [...inkadeQueryKeys.all, "spaces", { includeArchived }] as const,
  space: (spaceId: SpaceId) => [...inkadeQueryKeys.all, "space", spaceId] as const,
  spaceSchemas: () => [...inkadeQueryKeys.all, "space-schemas"] as const,
  spaceSchema: (spaceId: SpaceId, templateId?: TemplateId) =>
    [...inkadeQueryKeys.all, "space-schema", spaceId, { templateId }] as const,
  viewQuery: (input: ViewQueryRequestInput) =>
    [...inkadeQueryKeys.all, "view-query", input] as const,
  documents: (filter: DocumentListFilter = {}) =>
    [...inkadeQueryKeys.all, "documents", filter] as const,
  document: (documentId: DocumentId) => [...inkadeQueryKeys.all, "document", documentId] as const,
  dailyOutline: (date: string) => [...inkadeQueryKeys.all, "daily", date] as const,
  outlineNodes: (documentId: DocumentId) =>
    [...inkadeQueryKeys.all, "outline-nodes", documentId] as const,
  revisions: (documentId: DocumentId) =>
    [...inkadeQueryKeys.all, "revisions", documentId] as const,
  revisionDiff: (documentId: DocumentId, fromVersion: number, toVersion: number) =>
    [...inkadeQueryKeys.all, "revision-diff", documentId, fromVersion, toVersion] as const,
  backlinks: (documentId: DocumentId) =>
    [...inkadeQueryKeys.all, "backlinks", documentId] as const,
  threadBindings: (filter: ThreadBindingListFilter = {}) =>
    [...inkadeQueryKeys.all, "thread-bindings", filter] as const,
  search: (query: string, spaceId?: SpaceId, kind?: DocumentKind, tag?: string) =>
    [...inkadeQueryKeys.all, "search", { query, spaceId, kind, tag }] as const,
  semanticSearch: (
    query: string,
    mode: SemanticSearchMode = "hybrid",
    spaceId?: SpaceId,
    kind?: DocumentKind,
    tag?: string,
  ) =>
    [...inkadeQueryKeys.all, "semantic-search", { query, mode, spaceId, kind, tag }] as const,
  relatedDocuments: (documentId: DocumentId, limit = 10) =>
    [...inkadeQueryKeys.all, "related-documents", documentId, limit] as const,
  tokens: () => [...inkadeQueryKeys.all, "tokens"] as const,
  scopeRules: () => [...inkadeQueryKeys.all, "scope-rules"] as const,
  attachment: (attachmentId: AttachmentId) =>
    [...inkadeQueryKeys.all, "attachment", attachmentId] as const,
  attachments: (filter: { documentId?: DocumentId; orphanOnly?: boolean } = {}) =>
    [...inkadeQueryKeys.all, "attachments", filter] as const,
  workspaceSummary: () => [...inkadeQueryKeys.all, "workspace-summary"] as const,
  awaySummary: (since?: string) =>
    [...inkadeQueryKeys.all, "away-summary", { since }] as const,
  storageBuckets: () => [...inkadeQueryKeys.all, "storage-buckets"] as const,
  threadConflicts: (documentId?: DocumentId) =>
    [...inkadeQueryKeys.all, "thread-conflicts", { documentId }] as const,
  tasks: (filter: TaskListFilter = {}) => [...inkadeQueryKeys.all, "tasks", filter] as const,
  unlinkedMentions: (documentId: DocumentId) =>
    [...inkadeQueryKeys.all, "unlinked-mentions", documentId] as const,
  documentGraph: (documentId: DocumentId, depth = 2) =>
    [...inkadeQueryKeys.all, "document-graph", documentId, depth] as const,
  highlights: (documentId: DocumentId) =>
    [...inkadeQueryKeys.all, "highlights", documentId] as const,
  commentThreads: (documentId: DocumentId, status: HighlightStatus | "all" = "all") =>
    [...inkadeQueryKeys.all, "comment-threads", documentId, { status }] as const,
  highlightComments: (highlightId: HighlightId) =>
    [...inkadeQueryKeys.all, "highlight-comments", highlightId] as const,
  viewerContext: () => [...inkadeQueryKeys.all, "viewer-context"] as const,
  artifactRuntimeConfig: () => [...inkadeQueryKeys.all, "artifact-runtime-config"] as const,
  artifacts: (documentId: DocumentId) => [...inkadeQueryKeys.all, "artifacts", documentId] as const,
  artifact: (artifactId: DocumentArtifactId) =>
    [...inkadeQueryKeys.all, "artifact", artifactId] as const,
  templates: (kind?: DocumentKind) =>
    [...inkadeQueryKeys.all, "templates", { kind }] as const,
  shareLinks: (documentId?: DocumentId) =>
    [...inkadeQueryKeys.all, "share-links", { documentId }] as const,
  publicShare: (token: string) =>
    [...inkadeQueryKeys.all, "public-share", token] as const,
  savedViews: () => [...inkadeQueryKeys.all, "saved-views"] as const,
  preferences: () => [...inkadeQueryKeys.all, "preferences"] as const,
  aiSettings: () => [...inkadeQueryKeys.all, "ai-settings"] as const,
  searchIndexStatus: () => [...inkadeQueryKeys.all, "search-index-status"] as const,
  contextPacks: () => [...inkadeQueryKeys.all, "context-packs"] as const,
  contextPack: (slug: string, maxTokens?: number) =>
    [...inkadeQueryKeys.all, "context-pack", slug, { maxTokens }] as const,
  connectStatus: () => [...inkadeQueryKeys.all, "connect-status"] as const,
  auditLogs: (filter: AuditLogListFilter = {}) =>
    [...inkadeQueryKeys.all, "audit-logs", filter] as const,
  auditBatches: (limit = 20) => [...inkadeQueryKeys.all, "audit-batches", limit] as const,
  calendarSubscriptions: () => [...inkadeQueryKeys.all, "calendar-subscriptions"] as const,
  calendarEvents: (filter: ListCalendarEventsQuery) =>
    [...inkadeQueryKeys.all, "calendar-events", filter] as const,
  pdfAssets: () => [...inkadeQueryKeys.all, "pdf-assets"] as const,
  pdfAssetByDocument: (documentId: DocumentId) =>
    [...inkadeQueryKeys.all, "pdf-asset-doc", documentId] as const,
  pdfAsset: (assetId: DocumentAssetId) => [...inkadeQueryKeys.all, "pdf-asset", assetId] as const,
  rssFeeds: () => [...inkadeQueryKeys.all, "rss-feeds"] as const,
  ingestWebhooks: () => [...inkadeQueryKeys.all, "ingest-webhooks"] as const,
  outlineNodeSearch: (query: string) =>
    [...inkadeQueryKeys.all, "outline-node-search", query] as const,
  outlineNodeRoot: (nodeId: OutlineNodeId) =>
    [...inkadeQueryKeys.all, "outline-node", nodeId] as const,
  workspaceGraph: (filter: WorkspaceGraphQuery = {}) =>
    [...inkadeQueryKeys.all, "workspace-graph", filter] as const,
  publicSites: () => [...inkadeQueryKeys.all, "public-sites"] as const,
  publicSite: (slug: string) => [...inkadeQueryKeys.all, "public-site", slug] as const,
  publicSiteDoc: (slug: string, docSlug: string) =>
    [...inkadeQueryKeys.all, "public-site-doc", slug, docSlug] as const,
  briefingJobs: () => [...inkadeQueryKeys.all, "briefing-jobs"] as const,
  briefingRuns: (filter: ListBriefingRunsParams = {}) =>
    [...inkadeQueryKeys.all, "briefing-runs", filter] as const,
  bridgeSessions: (filter: ListBridgeSessionsInput = {}) =>
    [...inkadeQueryKeys.all, "bridge-sessions", filter] as const,
  wakeEvents: (filter: PollWakeEventsInput = {}) =>
    [...inkadeQueryKeys.all, "wake-events", filter] as const,
};
