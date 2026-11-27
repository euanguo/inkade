import type {
  ApiTokenId,
  ApiTokenRecord,
  AttachmentId,
  AttachmentRecord,
  AuditBatchDigestSummary,
  AuditBatchId,
  AuditLogId,
  AuditLogRecord,
  AuditRollbackResult,
  AwaySummaryQuery,
  AwaySummaryResponse,
  BatchRollbackInput,
  BatchRollbackResult,
  CreateApiTokenInput,
  DocumentId,
  ProjectRuleId,
  ProjectScopeRule,
  ProjectScopeRuleInput,
  StorageBucketsResponse,
  UpdateApiTokenInput,
  WorkspaceGraph,
  WorkspaceGraphQuery,
  WorkspaceSummary,
} from "@inkade/core";
import { buildQuery, type InkadeHttpTransport } from "../http-transport.ts";
import type { AuditLogListFilter } from "../query-keys.ts";

export interface CreateTokenResponse {
  readonly token: ApiTokenRecord;
  readonly rawToken: string;
}

export interface UploadAttachmentInput {
  readonly documentId?: DocumentId | null | undefined;
  readonly filename: string;
  readonly mimeType?: string | undefined;
  readonly data: Blob | Uint8Array;
}

export interface UploadAttachmentResponse {
  readonly attachment: AttachmentRecord;
  readonly downloadUrl: string;
}

export interface CleanupOrphanAttachmentsResponse {
  readonly deletedCount: number;
  readonly freedBytes: number;
  readonly deletedIds: readonly AttachmentId[];
}

export type ListAuditLogsParams = AuditLogListFilter;

export type AwaySummaryParams = AwaySummaryQuery;

export interface TokensResource {
  list(): Promise<readonly ApiTokenRecord[]>;
  create(input: CreateApiTokenInput): Promise<CreateTokenResponse>;
  update(tokenId: ApiTokenId, input: UpdateApiTokenInput): Promise<ApiTokenRecord>;
  revoke(tokenId: ApiTokenId): Promise<ApiTokenRecord>;
}

export interface ScopeRulesResource {
  list(): Promise<readonly ProjectScopeRule[]>;
  create(input: ProjectScopeRuleInput): Promise<ProjectScopeRule>;
  update(
    ruleId: ProjectRuleId,
    input: { readonly [K in keyof ProjectScopeRuleInput]?: ProjectScopeRuleInput[K] | undefined },
  ): Promise<ProjectScopeRule>;
  delete(ruleId: ProjectRuleId): Promise<void>;
}

export interface AttachmentsResource {
  list(options?: {
    readonly documentId?: DocumentId | undefined;
    readonly orphanOnly?: boolean | undefined;
  }): Promise<readonly AttachmentRecord[]>;
  cleanupOrphans(): Promise<CleanupOrphanAttachmentsResponse>;
  upload(input: UploadAttachmentInput): Promise<UploadAttachmentResponse>;
  get(attachmentId: AttachmentId): Promise<AttachmentRecord>;
  download(attachmentId: AttachmentId): Promise<Uint8Array>;
}

export interface WorkspaceResource {
  summary(): Promise<WorkspaceSummary>;
  awaySummary(params?: AwaySummaryParams): Promise<AwaySummaryResponse>;
  storageBuckets(): Promise<StorageBucketsResponse>;
  graph(params?: WorkspaceGraphQuery): Promise<WorkspaceGraph>;
  exportZip(): Promise<Uint8Array>;
}

export interface AuditLogsResource {
  list(params?: ListAuditLogsParams): Promise<readonly AuditLogRecord[]>;
  rollback(auditLogId: AuditLogId): Promise<AuditRollbackResult>;
  listBatches(limit?: number): Promise<readonly AuditBatchDigestSummary[]>;
  rollbackBatch(batchId: AuditBatchId, input?: BatchRollbackInput): Promise<BatchRollbackResult>;
}

export function createTokensResource(transport: InkadeHttpTransport): TokensResource {
  return {
    async list() {
      const res = await transport.requestJson<{ readonly tokens: readonly ApiTokenRecord[] }>(
        "/api/v1/tokens",
      );
      return res.tokens;
    },

    create(input) {
      return transport.requestJson<CreateTokenResponse>("/api/v1/tokens", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },

    async update(tokenId, input) {
      const res = await transport.requestJson<{ readonly token: ApiTokenRecord }>(
        `/api/v1/tokens/${encodeURIComponent(tokenId)}`,
        {
          method: "PATCH",
          body: JSON.stringify(input),
        },
      );
      return res.token;
    },

    async revoke(tokenId) {
      const res = await transport.requestJson<{ readonly token: ApiTokenRecord }>(
        `/api/v1/tokens/${encodeURIComponent(tokenId)}/revoke`,
        { method: "POST" },
      );
      return res.token;
    },
  };
}

export function createScopeRulesResource(transport: InkadeHttpTransport): ScopeRulesResource {
  return {
    async list() {
      const res = await transport.requestJson<{ readonly rules: readonly ProjectScopeRule[] }>(
        "/api/v1/scope-rules",
      );
      return res.rules;
    },

    async create(input) {
      const res = await transport.requestJson<{ readonly rule: ProjectScopeRule }>(
        "/api/v1/scope-rules",
        {
          method: "POST",
          body: JSON.stringify({
            writableSpaceIds: [],
            readonlySpaceIds: [],
            priority: 0,
            ...input,
          }),
        },
      );
      return res.rule;
    },

    async update(ruleId, input) {
      const res = await transport.requestJson<{ readonly rule: ProjectScopeRule }>(
        `/api/v1/scope-rules/${encodeURIComponent(ruleId)}`,
        {
          method: "PATCH",
          body: JSON.stringify(input),
        },
      );
      return res.rule;
    },

    async delete(ruleId) {
      await transport.requestJson<{ readonly deleted: boolean }>(
        `/api/v1/scope-rules/${encodeURIComponent(ruleId)}`,
        { method: "DELETE" },
      );
    },
  };
}

export function createAttachmentsResource(transport: InkadeHttpTransport): AttachmentsResource {
  return {
    async list(options) {
      const query = buildQuery({
        documentId: options?.documentId,
        orphanOnly: options?.orphanOnly,
      });
      const res = await transport.requestJson<{ readonly attachments: readonly AttachmentRecord[] }>(
        `/api/v1/attachments${query}`,
      );
      return res.attachments;
    },

    cleanupOrphans() {
      return transport.requestJson<CleanupOrphanAttachmentsResponse>(
        "/api/v1/attachments/cleanup-orphans",
        { method: "POST" },
      );
    },

    upload(input) {
      const form = new FormData();
      let blob: Blob;
      if (input.data instanceof Blob) {
        blob = input.data;
      } else {
        const copy = new Uint8Array(input.data.byteLength);
        copy.set(input.data);
        blob = new Blob([copy], {
          type: input.mimeType ?? "application/octet-stream",
        });
      }
      form.set("file", blob, input.filename);
      form.set("filename", input.filename);
      if (input.mimeType) {
        form.set("mimeType", input.mimeType);
      }
      if (input.documentId) {
        form.set("documentId", input.documentId);
      }
      return transport.requestJson<UploadAttachmentResponse>("/api/v1/attachments", {
        method: "POST",
        body: form,
      });
    },

    async get(attachmentId) {
      const res = await transport.requestJson<{ readonly attachment: AttachmentRecord }>(
        `/api/v1/attachments/${encodeURIComponent(attachmentId)}`,
      );
      return res.attachment;
    },

    async download(attachmentId) {
      const response = await transport.requestRaw(
        `/api/v1/attachments/${encodeURIComponent(attachmentId)}/download`,
      );
      return new Uint8Array(await response.arrayBuffer());
    },
  };
}

export function createWorkspaceResource(transport: InkadeHttpTransport): WorkspaceResource {
  return {
    summary: () => transport.requestJson<WorkspaceSummary>("/api/v1/workspace/summary"),

    awaySummary(params = {}) {
      const query = buildQuery({ since: params.since });
      return transport.requestJson<AwaySummaryResponse>(
        `/api/v1/workspace/away-summary${query}`,
      );
    },

    storageBuckets: () =>
      transport.requestJson<StorageBucketsResponse>("/api/v1/workspace/storage-buckets"),

    graph(params = {}) {
      const query = buildQuery({
        spaceId: params.spaceId,
        kind: params.kind,
        tag: params.tag,
        includeSemantic: params.includeSemantic,
        includeIsolated: params.includeIsolated,
        semanticThreshold: params.semanticThreshold,
      });
      return transport.requestJson<WorkspaceGraph>(`/api/v1/workspace/graph${query}`);
    },

    async exportZip() {
      const response = await transport.requestRaw("/api/v1/export/zip");
      return new Uint8Array(await response.arrayBuffer());
    },
  };
}

export function createAuditLogsResource(transport: InkadeHttpTransport): AuditLogsResource {
  return {
    async list(params = {}) {
      const query = buildQuery({
        tokenId: params.tokenId,
        documentId: params.documentId,
        batchId: params.batchId,
        decision: params.decision,
        transport: params.transport,
        action: params.action,
        limit: params.limit,
        offset: params.offset,
      });
      const res = await transport.requestJson<{ readonly auditLogs: readonly AuditLogRecord[] }>(
        `/api/v1/audit-logs${query}`,
      );
      return res.auditLogs;
    },

    rollback(auditLogId) {
      return transport.requestJson<AuditRollbackResult>(
        `/api/v1/audit-logs/${encodeURIComponent(auditLogId)}/rollback`,
        { method: "POST" },
      );
    },

    async listBatches(limit = 20) {
      const query = buildQuery({ limit });
      const res = await transport.requestJson<{
        readonly batches: readonly AuditBatchDigestSummary[];
      }>(`/api/v1/audit-batches${query}`);
      return res.batches;
    },

    rollbackBatch(batchId, input) {
      return transport.requestJson<BatchRollbackResult>(
        `/api/v1/audit/batches/${encodeURIComponent(batchId)}/rollback`,
        {
          method: "POST",
          body: JSON.stringify(input ?? {}),
        },
      );
    },
  };
}
