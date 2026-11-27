import { z } from "zod";
import {
  apiTokenIdSchema,
  auditBatchIdSchema,
  documentIdSchema,
  type ApiTokenId,
  type AuditBatchId,
  type AuditLogId,
  type DocumentId,
  type RevisionId,
  type SpaceId,
  type WorkspaceId,
} from "../ids.ts";
import {
  auditDecisionSchema,
  auditTransportSchema,
  type AuditDecision,
  type AuditPrincipalKind,
  type AuditTransport,
  type ExecutionMode,
} from "./common.ts";
import type { DiffPreview } from "./document.ts";

export interface AuditLogRecord {
  readonly id: AuditLogId;
  readonly workspaceId: WorkspaceId;
  readonly principalKind: AuditPrincipalKind;
  readonly tokenId: ApiTokenId | null;
  readonly tokenName: string | null;
  readonly transport: AuditTransport;
  readonly action: string;
  readonly resource: string;
  readonly spaceId: SpaceId | null;
  readonly documentId: DocumentId | null;
  readonly decision: AuditDecision;
  readonly reason: string | null;
  readonly summary: string | null;
  readonly createdAt: string;
  readonly beforeRevisionId?: RevisionId | null | undefined;
  readonly afterRevisionId?: RevisionId | null | undefined;
  readonly diffPreview?: DiffPreview | null | undefined;
  readonly reversible?: boolean | undefined;
  readonly irreversibleReason?: string | null | undefined;
  readonly batchId?: AuditBatchId | null | undefined;
  readonly executionMode?: ExecutionMode | undefined;
  readonly reversedByAuditId?: AuditLogId | null | undefined;
}

export const listAuditLogsQuerySchema = z.object({
  tokenId: apiTokenIdSchema.optional(),
  documentId: documentIdSchema.optional(),
  batchId: auditBatchIdSchema.optional(),
  decision: auditDecisionSchema.optional(),
  transport: auditTransportSchema.optional(),
  action: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListAuditLogsQuery = z.input<typeof listAuditLogsQuerySchema>;
export type ParsedListAuditLogsQuery = z.infer<typeof listAuditLogsQuerySchema>;
