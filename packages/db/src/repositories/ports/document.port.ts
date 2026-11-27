import type {
  ActorType,
  ApiTokenId,
  AuditBatchId,
  CreateDocumentInput,
  DocumentId,
  DocumentKind,
  DocumentRecord,
  DocumentSummary,
  ExecutionMode,
  SpaceId,
  UpdateDocumentInput,
  UserId,
} from "@inkade/core";

export interface ListDocumentsOptions {
  readonly spaceId?: SpaceId | undefined;
  readonly spaceIds?: readonly SpaceId[] | undefined;
  readonly kind?: DocumentKind | undefined;
  readonly allowedKinds?: readonly DocumentKind[] | undefined;
  readonly tag?: string | undefined;
  readonly tagAllowlist?: readonly string[] | undefined;
  readonly pinnedOnly?: boolean | undefined;
  readonly includeTrashed?: boolean | undefined;
  readonly includeSystem?: boolean | undefined;
  readonly limit?: number | null | undefined;
  readonly offset?: number | undefined;
}

export interface CreateDocumentOptions {
  readonly id?: DocumentId | undefined;
  readonly actorType?: ActorType | undefined;
  readonly actorId?: UserId | ApiTokenId | string | null | undefined;
  readonly unreadAgentUpdate?: boolean | undefined;
  readonly changeSummary?: string | null | undefined;
  readonly batchId?: AuditBatchId | null | undefined;
  readonly executionMode?: ExecutionMode | undefined;
}

export interface UpdateDocumentOptions {
  readonly actorType?: ActorType | undefined;
  readonly actorId?: UserId | ApiTokenId | string | null | undefined;
  readonly batchId?: AuditBatchId | null | undefined;
  readonly executionMode?: ExecutionMode | undefined;
}

export interface UpdateDocumentContentDirectInput {
  readonly contentMarkdown: string;
  readonly contentText: string;
  readonly excerpt: string;
  readonly version: number;
  readonly updatedAt: string;
}

export interface DocumentRepo {
  listDocumentSummaries(
    workspaceId: string,
    options?: ListDocumentsOptions,
  ): Promise<readonly DocumentSummary[]>;
  listDocuments(
    workspaceId: string,
    options?: ListDocumentsOptions,
  ): Promise<readonly DocumentRecord[]>;
  getDocumentById(workspaceId: string, documentId: string): Promise<DocumentRecord | null>;
  getDocumentBySlug(workspaceId: string, slug: string): Promise<DocumentRecord | null>;
  findActiveDailyDocumentId(workspaceId: string, dailyDate: string): Promise<DocumentId | null>;
  getOrCreateDailyOutline(
    workspaceId: string,
    dailySpaceId: string,
    dailyDate: string,
    title?: string,
  ): Promise<{ readonly document: DocumentRecord; readonly created: boolean }>;
  createDocument(
    workspaceId: string,
    input: CreateDocumentInput,
    options?: CreateDocumentOptions,
  ): Promise<DocumentRecord>;
  updateDocument(
    workspaceId: string,
    documentId: string,
    input: UpdateDocumentInput,
    options?: UpdateDocumentOptions,
  ): Promise<DocumentRecord>;
  trashDocument(workspaceId: string, documentId: string): Promise<DocumentRecord>;
  restoreDocument(workspaceId: string, documentId: string): Promise<DocumentRecord>;
  hardDeleteDocument(workspaceId: string, documentId: string): Promise<void>;
  markDocumentAgentUpdateRead(workspaceId: string, documentId: string): Promise<DocumentRecord>;
  setDocumentUnreadAgentUpdate(
    workspaceId: string,
    documentId: string,
    unread: boolean,
  ): Promise<DocumentRecord>;

  updateDocumentContentDirect(
    workspaceId: string,
    documentId: string,
    patch: UpdateDocumentContentDirectInput,
  ): Promise<void>;
  bumpDocumentVersion(
    documentId: string,
    version: number,
    updatedAt: string,
    actorType?: ActorType,
  ): Promise<void>;
  touchDocumentUpdatedAt(
    documentId: string,
    updatedAt: string,
    actorType?: ActorType,
  ): Promise<void>;
  addDocumentTags(documentId: string, extraTags: readonly string[]): Promise<readonly string[]>;
  listTagsForDocuments(
    documentIds: readonly string[],
  ): Promise<ReadonlyMap<string, readonly string[]>>;
}
