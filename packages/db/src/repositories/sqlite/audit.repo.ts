import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  createId,
  DEFAULT_WORKSPACE_STORAGE_QUOTA_BYTES,
  ID_PREFIXES,
  type AuditBatchId,
  type AuditLogId,
  type AuditLogRecord,
  type StorageBucketsResponse,
} from "@inkade/core";
import {
  attachments,
  auditLogs,
  documentEmbeddings,
  documents,
  outlineNodes,
} from "../../schema/sqlite.ts";
import type {
  AuditRepo,
  CreateAuditLogInput,
  GetStorageBucketsOptions,
  ListAuditLogsOptions,
} from "../ports/audit.port.ts";
import { nowIso, syncToPromise, type SqliteRepoContext } from "./helpers.ts";
import { mapAuditLogRow } from "./mappers.ts";

export class SqliteAuditRepo implements AuditRepo {
  constructor(private readonly ctx: SqliteRepoContext) {}

  createAuditLog(workspaceId: string, input: CreateAuditLogInput): Promise<AuditLogRecord> {
    return syncToPromise(() => {
      const id = createId(ID_PREFIXES.auditLog);
      const ts = nowIso();
      const row: typeof auditLogs.$inferSelect = {
        id,
        workspaceId,
        principalKind: input.principalKind,
        tokenId: input.tokenId ?? null,
        tokenName: input.tokenName ?? null,
        transport: input.transport,
        action: input.action,
        resource: input.resource,
        spaceId: input.spaceId ?? null,
        documentId: input.documentId ?? null,
        decision: input.decision,
        reason: input.reason ?? null,
        summary: input.summary ?? null,
        createdAt: ts,
        beforeRevisionId: input.beforeRevisionId ?? null,
        afterRevisionId: input.afterRevisionId ?? null,
        diffPreviewJson: input.diffPreview ? JSON.stringify(input.diffPreview) : null,
        reversible: input.reversible ?? false,
        irreversibleReason: input.irreversibleReason ?? null,
        batchId: input.batchId ?? null,
        executionMode: input.executionMode ?? "autonomous",
        reversedByAuditId: input.reversedByAuditId ?? null,
      };
      this.ctx.db.insert(auditLogs).values(row).run();
      return mapAuditLogRow(row);
    });
  }

  getAuditLogById(
    workspaceId: string,
    auditLogId: AuditLogId | string,
  ): Promise<AuditLogRecord | null> {
    return syncToPromise(() => {
      const row = this.ctx.db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.workspaceId, workspaceId), eq(auditLogs.id, auditLogId)))
        .get();
      return row ? mapAuditLogRow(row) : null;
    });
  }

  listAuditLogs(
    workspaceId: string,
    options?: ListAuditLogsOptions,
  ): Promise<readonly AuditLogRecord[]> {
    return syncToPromise(() => {
      const conditions = [eq(auditLogs.workspaceId, workspaceId)];
      if (options?.tokenId) conditions.push(eq(auditLogs.tokenId, options.tokenId));
      if (options?.documentId) conditions.push(eq(auditLogs.documentId, options.documentId));
      if (options?.batchId) conditions.push(eq(auditLogs.batchId, options.batchId));
      if (options?.decision) conditions.push(eq(auditLogs.decision, options.decision));
      if (options?.transport) conditions.push(eq(auditLogs.transport, options.transport));
      if (options?.action) conditions.push(eq(auditLogs.action, options.action));

      const limit = Math.min(Math.max(options?.limit ?? 100, 1), 500);
      const offset = Math.max(options?.offset ?? 0, 0);

      const rows = this.ctx.db
        .select()
        .from(auditLogs)
        .where(and(...conditions))
        .orderBy(desc(auditLogs.createdAt), desc(sql`rowid`))
        .limit(limit)
        .offset(offset)
        .all();
      return rows.map(mapAuditLogRow);
    });
  }

  listAuditLogsByBatch(
    workspaceId: string,
    batchId: AuditBatchId | string,
  ): Promise<readonly AuditLogRecord[]> {
    return syncToPromise(() => {
      const rows = this.ctx.db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.workspaceId, workspaceId), eq(auditLogs.batchId, batchId)))
        .orderBy(asc(auditLogs.createdAt), asc(sql`rowid`))
        .all();
      return rows.map(mapAuditLogRow);
    });
  }

  markAuditLogsReversed(
    workspaceId: string,
    auditLogIds: readonly (AuditLogId | string)[],
    reversedByAuditId: AuditLogId | string,
  ): Promise<void> {
    return syncToPromise(() => {
      if (auditLogIds.length === 0) return;
      this.ctx.db
        .update(auditLogs)
        .set({ reversedByAuditId })
        .where(
          and(
            eq(auditLogs.workspaceId, workspaceId),
            inArray(auditLogs.id, [...auditLogIds]),
          ),
        )
        .run();
    });
  }

  getStorageBuckets(
    workspaceId: string,
    options?: GetStorageBucketsOptions,
  ): Promise<StorageBucketsResponse> {
    return syncToPromise(() => {
      const visibleIds = options?.visibleDocumentIds ?? "*";
      const quotaLimitBytes = options?.quotaLimitBytes ?? DEFAULT_WORKSPACE_STORAGE_QUOTA_BYTES;

      const docRows = this.ctx.db
        .select({
          id: documents.id,
          kind: documents.kind,
          contentMarkdown: documents.contentMarkdown,
          trashedAt: documents.trashedAt,
        })
        .from(documents)
        .where(eq(documents.workspaceId, workspaceId))
        .all();

      let articleCount = 0;
      let outlineCount = 0;
      let clipCount = 0;
      let trashedDocumentCount = 0;
      let articleBytes = 0;
      let clipBytes = 0;
      const activeOutlineIds: string[] = [];

      for (const doc of docRows) {
        if (visibleIds !== "*" && !visibleIds.has(doc.id)) continue;
        if (doc.trashedAt !== null) {
          trashedDocumentCount++;
          continue;
        }
        const docBytes = Buffer.byteLength(doc.contentMarkdown, "utf8");
        if (doc.kind === "article") {
          articleCount++;
          articleBytes += docBytes;
        } else if (doc.kind === "outline") {
          outlineCount++;
          activeOutlineIds.push(doc.id);
        } else if (doc.kind === "clip") {
          clipCount++;
          clipBytes += docBytes;
        }
      }

      let outlineBytes = 0;
      if (activeOutlineIds.length > 0) {
        const nodeRows = this.ctx.db
          .select({
            contentMarkdown: outlineNodes.contentMarkdown,
            noteMarkdown: outlineNodes.noteMarkdown,
          })
          .from(outlineNodes)
          .where(
            and(inArray(outlineNodes.documentId, activeOutlineIds), isNull(outlineNodes.deletedAt)),
          )
          .all();
        for (const node of nodeRows) {
          outlineBytes +=
            Buffer.byteLength(node.contentMarkdown, "utf8") +
            Buffer.byteLength(node.noteMarkdown, "utf8");
        }
      }

      const embRows = this.ctx.db
        .select({
          documentId: documentEmbeddings.documentId,
          vectorJson: documentEmbeddings.vectorJson,
        })
        .from(documentEmbeddings)
        .where(eq(documentEmbeddings.workspaceId, workspaceId))
        .all();
      let indexedCount = 0;
      let embeddingBytes = 0;
      for (const emb of embRows) {
        if (visibleIds !== "*" && !visibleIds.has(emb.documentId)) continue;
        indexedCount++;
        embeddingBytes += Buffer.byteLength(emb.vectorJson, "utf8");
      }

      const attRows = this.ctx.db
        .select({ documentId: attachments.documentId, byteSize: attachments.byteSize })
        .from(attachments)
        .where(eq(attachments.workspaceId, workspaceId))
        .all();
      let attachmentCount = 0;
      let attachmentBytes = 0;
      for (const att of attRows) {
        if (visibleIds !== "*" && (!att.documentId || !visibleIds.has(att.documentId))) continue;
        attachmentCount++;
        attachmentBytes += att.byteSize;
      }

      const totalDocumentCount = articleCount + outlineCount + clipCount;
      const contentBytes = articleBytes + outlineBytes + clipBytes;
      const totalUsedBytes = attachmentBytes + contentBytes;
      const usedRatio = quotaLimitBytes > 0 ? Math.min(1, totalUsedBytes / quotaLimitBytes) : 0;
      const remainingPercent = Math.max(
        0,
        Math.min(100, Number(((1 - usedRatio) * 100).toFixed(2))),
      );

      return {
        articleCount,
        outlineCount,
        clipCount,
        totalDocumentCount,
        trashedDocumentCount,
        indexedCount,
        attachmentCount,
        attachmentBytes,
        contentBytes,
        totalUsedBytes,
        quotaLimitBytes,
        usedRatio,
        remainingPercent,
        buckets: [
          { key: "articles", count: articleCount, bytes: articleBytes },
          { key: "outlines", count: outlineCount, bytes: outlineBytes },
          { key: "clips", count: clipCount, bytes: clipBytes },
          { key: "embeddings", count: indexedCount, bytes: embeddingBytes },
          { key: "attachments", count: attachmentCount, bytes: attachmentBytes },
        ],
      };
    });
  }
}
