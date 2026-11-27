import type {
  ApiTokenId,
  AuditBatchId,
  AuditDecision,
  AuditLogId,
  AuditLogRecord,
  AuditPrincipalKind,
  AuditTransport,
  DiffPreview,
  DocumentId,
  ExecutionMode,
  RevisionId,
  SpaceId,
  StorageBucketsResponse,
} from "@inkade/core";

export interface CreateAuditLogInput {
  readonly principalKind: AuditPrincipalKind;
  readonly tokenId?: ApiTokenId | null | undefined;
  readonly tokenName?: string | null | undefined;
  readonly transport: AuditTransport;
  readonly action: string;
  readonly resource: string;
  readonly spaceId?: SpaceId | null | undefined;
  readonly documentId?: DocumentId | null | undefined;
  readonly decision: AuditDecision;
  readonly reason?: string | null | undefined;
  readonly summary?: string | null | undefined;
  readonly beforeRevisionId?: RevisionId | null | undefined;
  readonly afterRevisionId?: RevisionId | null | undefined;
  readonly diffPreview?: DiffPreview | null | undefined;
  readonly reversible?: boolean | undefined;
  readonly irreversibleReason?: string | null | undefined;
  readonly batchId?: AuditBatchId | null | undefined;
  readonly executionMode?: ExecutionMode | undefined;
  readonly reversedByAuditId?: AuditLogId | null | undefined;
}

export interface ListAuditLogsOptions {
  readonly tokenId?: ApiTokenId | undefined;
  readonly documentId?: DocumentId | undefined;
  readonly batchId?: AuditBatchId | undefined;
  readonly decision?: AuditDecision | undefined;
  readonly transport?: AuditTransport | undefined;
  readonly action?: string | undefined;
  readonly limit?: number | undefined;
  readonly offset?: number | undefined;
}

export interface GetStorageBucketsOptions {
  readonly visibleDocumentIds?: ReadonlySet<DocumentId | string> | "*" | undefined;
  readonly quotaLimitBytes?: number | undefined;
}

export interface AuditRepo {
  createAuditLog(workspaceId: string, input: CreateAuditLogInput): Promise<AuditLogRecord>;
  getAuditLogById(
    workspaceId: string,
    auditLogId: AuditLogId | string,
  ): Promise<AuditLogRecord | null>;
  listAuditLogs(
    workspaceId: string,
    options?: ListAuditLogsOptions,
  ): Promise<readonly AuditLogRecord[]>;
  listAuditLogsByBatch(
    workspaceId: string,
    batchId: AuditBatchId | string,
  ): Promise<readonly AuditLogRecord[]>;
  markAuditLogsReversed(
    workspaceId: string,
    auditLogIds: readonly (AuditLogId | string)[],
    reversedByAuditId: AuditLogId | string,
  ): Promise<void>;
  getStorageBuckets(
    workspaceId: string,
    options?: GetStorageBucketsOptions,
  ): Promise<StorageBucketsResponse>;
}
