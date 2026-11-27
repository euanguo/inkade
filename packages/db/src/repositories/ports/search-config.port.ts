import type {
  AiProviderPreset,
  AiSettingsRecord,
  CalendarEventCacheRecord,
  CalendarSubId,
  CalendarSubscription,
  ChunkEmbeddingRecord,
  ContextPack,
  ContextPackId,
  CreateCalendarSubscriptionInput,
  CreateContextPackInput,
  CreateIngestWebhookInput,
  CreateRssFeedInput,
  DocumentChunkDraft,
  DocumentChunkId,
  DocumentChunkRecord,
  DocumentEmbeddingRecord,
  DocumentId,
  DocumentKind,
  EmbeddingProviderPreset,
  IngestWebhookId,
  IngestWebhookRecord,
  RssFeedId,
  RssFeedRecord,
  SearchHit,
  SpaceId,
  UpdateAiSettingsInput,
  UpdateCalendarSubscriptionInput,
  UpdateContextPackInput,
  UpdateIngestWebhookInput,
  UpdateRssFeedInput,
  UserPreferencesPatch,
  UserPreferencesRecord,
  WorkspaceId,
} from "@inkade/core";

export interface SearchFtsOptions {
  readonly spaceIds?: readonly SpaceId[] | undefined;
  readonly kind?: DocumentKind | undefined;
  readonly allowedKinds?: readonly DocumentKind[] | undefined;
  readonly tag?: string | undefined;
  readonly tagAllowlist?: readonly string[] | undefined;
  readonly includeSystem?: boolean | undefined;
  readonly limit?: number | undefined;
}

export interface UpsertFtsEntryInput {
  readonly entityKey: string;
  readonly workspaceId: string;
  readonly entityType: "document" | "outline_node";
  readonly documentId: string;
  readonly nodeId: string | null;
  readonly spaceId: string;
  readonly kind: string;
  readonly title: string;
  readonly body: string;
}

export interface AiSettingsSecretRecord {
  readonly workspaceId: WorkspaceId;
  readonly enabled: boolean;
  readonly provider: AiProviderPreset;
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKey: string;
  readonly temperature: number;
  readonly embeddingProvider: EmbeddingProviderPreset;
  readonly embeddingBaseUrl: string;
  readonly embeddingModel: string;
  readonly embeddingApiKey: string;
  readonly updatedAt: string;
}

export interface SearchConfigRepo {
  searchFts(
    workspaceId: string,
    query: string,
    options?: SearchFtsOptions,
  ): Promise<readonly SearchHit[]>;
  upsertFtsEntry(entry: UpsertFtsEntryInput): Promise<void>;
  deleteDocumentFts(documentId: string): Promise<void>;
  deleteNodesFts(nodeIds: readonly string[]): Promise<void>;
  updateDocumentNodesFtsSpace(documentId: string, spaceId: string): Promise<void>;

  getDocumentEmbedding(
    workspaceId: string,
    documentId: DocumentId | string,
  ): Promise<DocumentEmbeddingRecord | null>;
  listDocumentEmbeddings(
    workspaceId: string,
    model?: string,
  ): Promise<readonly DocumentEmbeddingRecord[]>;
  upsertDocumentEmbedding(
    workspaceId: string,
    input: {
      readonly documentId: DocumentId | string;
      readonly model: string;
      readonly dimensions: number;
      readonly vector: readonly number[];
      readonly contentHash: string;
    },
  ): Promise<DocumentEmbeddingRecord>;
  deleteDocumentEmbedding(
    workspaceId: string,
    documentId: DocumentId | string,
  ): Promise<void>;

  getDocumentYjsState(workspaceId: string, documentId: string): Promise<string | null>;
  upsertDocumentYjsState(
    workspaceId: string,
    documentId: string,
    stateBase64: string,
  ): Promise<void>;

  getAiSettings(workspaceId: string): Promise<AiSettingsRecord>;
  getAiSettingsSecret(workspaceId: string): Promise<AiSettingsSecretRecord>;
  upsertAiSettings(
    workspaceId: string,
    input: UpdateAiSettingsInput,
  ): Promise<AiSettingsRecord>;

  getUserPreferences(
    workspaceId: string,
    principalKey: string,
  ): Promise<UserPreferencesRecord>;
  upsertUserPreferences(
    workspaceId: string,
    principalKey: string,
    patch: UserPreferencesPatch,
  ): Promise<UserPreferencesRecord>;

  listCalendarSubscriptions(workspaceId: string): Promise<readonly CalendarSubscription[]>;
  getCalendarSubscriptionById(
    workspaceId: string,
    subscriptionId: CalendarSubId | string,
  ): Promise<CalendarSubscription | null>;
  createCalendarSubscription(
    workspaceId: string,
    input: CreateCalendarSubscriptionInput,
    options?: { readonly id?: string | undefined },
  ): Promise<CalendarSubscription>;
  updateCalendarSubscription(
    workspaceId: string,
    subscriptionId: CalendarSubId | string,
    patch: UpdateCalendarSubscriptionInput & {
      readonly etag?: string | null | undefined;
      readonly lastModified?: string | null | undefined;
      readonly lastSyncedAt?: string | null | undefined;
      readonly lastError?: string | null | undefined;
    },
  ): Promise<CalendarSubscription>;
  deleteCalendarSubscription(
    workspaceId: string,
    subscriptionId: CalendarSubId | string,
  ): Promise<void>;
  replaceCalendarEventsCache(
    workspaceId: string,
    subscriptionId: CalendarSubId | string,
    events: readonly Omit<
      CalendarEventCacheRecord,
      "id" | "subscriptionId" | "workspaceId" | "updatedAt"
    >[],
  ): Promise<readonly CalendarEventCacheRecord[]>;
  listCalendarEventsCache(
    workspaceId: string,
    options?: {
      readonly subscriptionId?: CalendarSubId | string | undefined;
      readonly onlyEnabledSubscriptions?: boolean | undefined;
    },
  ): Promise<
    readonly (CalendarEventCacheRecord & {
      readonly subscriptionName: string;
      readonly color: string;
    })[]
  >;

  replaceDocumentChunks(
    workspaceId: string,
    docId: DocumentId | string,
    chunks: readonly DocumentChunkDraft[],
  ): Promise<readonly DocumentChunkRecord[]>;
  listDocumentChunks(
    workspaceId: string,
    options?: {
      readonly docId?: DocumentId | string | undefined;
      readonly docIds?: readonly (DocumentId | string)[] | undefined;
    },
  ): Promise<readonly DocumentChunkRecord[]>;
  deleteDocumentChunks(workspaceId: string, docId: DocumentId | string): Promise<void>;

  listChunkEmbeddings(
    workspaceId: string,
    modelKey: string,
    options?: {
      readonly docIds?: readonly (DocumentId | string)[] | undefined;
    },
  ): Promise<readonly ChunkEmbeddingRecord[]>;
  upsertChunkEmbeddings(
    workspaceId: string,
    items: readonly {
      readonly chunkId: DocumentChunkId | string;
      readonly modelKey: string;
      readonly dimensions: number;
      readonly vector: readonly number[];
    }[],
  ): Promise<void>;
  getEmbeddingIndexStats(
    workspaceId: string,
    modelKey: string,
  ): Promise<{
    readonly totalChunks: number;
    readonly indexedChunks: number;
    readonly indexedDocuments: number;
    readonly dimensions: number | null;
    readonly lastIndexedAt: string | null;
  }>;

  listContextPacks(workspaceId: string): Promise<readonly ContextPack[]>;
  getContextPackById(
    workspaceId: string,
    packId: ContextPackId | string,
  ): Promise<ContextPack | null>;
  getContextPackBySlug(workspaceId: string, slug: string): Promise<ContextPack | null>;
  createContextPack(
    workspaceId: string,
    input: CreateContextPackInput & { readonly slug: string },
    options?: { readonly id?: string | undefined },
  ): Promise<ContextPack>;
  updateContextPack(
    workspaceId: string,
    packId: ContextPackId | string,
    input: UpdateContextPackInput,
  ): Promise<ContextPack>;
  deleteContextPack(workspaceId: string, packId: ContextPackId | string): Promise<void>;

  listRssFeeds(workspaceId: string): Promise<readonly RssFeedRecord[]>;
  getRssFeedById(workspaceId: string, feedId: RssFeedId | string): Promise<RssFeedRecord | null>;
  createRssFeed(
    workspaceId: string,
    input: Omit<CreateRssFeedInput, "targetSpaceId" | "title"> & {
      readonly title: string;
      readonly targetSpaceId: SpaceId;
    },
    options?: { readonly id?: string | undefined },
  ): Promise<RssFeedRecord>;
  updateRssFeed(
    workspaceId: string,
    feedId: RssFeedId | string,
    patch: UpdateRssFeedInput & {
      readonly etag?: string | null | undefined;
      readonly lastModified?: string | null | undefined;
      readonly lastFetchedAt?: string | null | undefined;
      readonly lastError?: string | null | undefined;
    },
  ): Promise<RssFeedRecord>;
  deleteRssFeed(workspaceId: string, feedId: RssFeedId | string): Promise<void>;

  listIngestWebhooks(workspaceId: string): Promise<readonly IngestWebhookRecord[]>;
  getIngestWebhookById(
    workspaceId: string,
    webhookId: IngestWebhookId | string,
  ): Promise<IngestWebhookRecord | null>;
  findIngestWebhookByTokenHash(tokenHash: string): Promise<IngestWebhookRecord | null>;
  createIngestWebhook(
    workspaceId: string,
    input: Omit<CreateIngestWebhookInput, "targetSpaceId"> & {
      readonly targetSpaceId: SpaceId;
      readonly tokenHash: string;
      readonly tokenPrefix: string;
    },
    options?: { readonly id?: string | undefined },
  ): Promise<IngestWebhookRecord>;
  updateIngestWebhook(
    workspaceId: string,
    webhookId: IngestWebhookId | string,
    patch: UpdateIngestWebhookInput,
  ): Promise<IngestWebhookRecord>;
  deleteIngestWebhook(workspaceId: string, webhookId: IngestWebhookId | string): Promise<void>;
  touchIngestWebhookLastUsed(webhookId: IngestWebhookId | string, timestamp: string): Promise<void>;
}
