import {
  buildCompactDiffPreview,
  computeLedgerCascade,
  InkadeError,
  propertyFieldDefinitionSchema,
  type AuditBatchId,
  type AuditLogId,
  type AuditRollbackResult,
  type BatchRollbackConflict,
  type BatchRollbackInput,
  type BatchRollbackItemResult,
  type BatchRollbackResult,
  type DiffPreview,
  type DocumentId,
  type DocumentRecord,
  type OutlineNode,
  type PropertyFieldDefinition,
  type RevisionId,
  type SpaceId,
} from "@inkade/core";
import type {
  AttachmentRepo,
  AuditRepo,
  DocumentRepo,
  RevisionLinkRepo,
  SearchConfigRepo,
  SpaceRepo,
} from "@inkade/db";
import type { WorkspaceSpacesCache } from "../cache/workspace-spaces-cache.ts";
import type { SseHub } from "../realtime/sse-hub.ts";
import type { Principal } from "../types.ts";
import type { AuditService } from "./audit-service.ts";
import type { DocumentService } from "./document-service.ts";
import type { OramaIndexService } from "./orama-index-service.ts";
import type { OutlineService } from "./outline-service.ts";
import { assertAdminPrincipal, assertScope, getAllWorkspaceSpaces } from "./scope-guard.ts";

export interface AuditRollbackServiceDeps {
  readonly auditRepo: AuditRepo;
  readonly documentRepo: DocumentRepo;
  readonly revisionLinkRepo: RevisionLinkRepo;
  readonly spaceRepo: SpaceRepo;
  readonly attachmentRepo?: AttachmentRepo | undefined;
  readonly searchConfigRepo?: SearchConfigRepo | undefined;
  readonly oramaIndex?: OramaIndexService | undefined;
  readonly spacesCache?: WorkspaceSpacesCache | undefined;
  readonly auditService: AuditService;
  readonly documentService: DocumentService;
  readonly outlineService: OutlineService;
  readonly sseHub?: SseHub | undefined;
}

export class AuditRollbackService {
  constructor(private readonly deps: AuditRollbackServiceDeps) {}

  async rollback(principal: Principal, auditLogId: AuditLogId): Promise<AuditRollbackResult> {
    const record = await this.deps.auditRepo.getAuditLogById(principal.workspaceId, auditLogId);
    if (!record) {
      throw new InkadeError("NOT_FOUND", `Audit log "${auditLogId}" not found`);
    }

    const allSpaces = await getAllWorkspaceSpaces(
      this.deps.spacesCache ?? this.deps.spaceRepo,
      principal.workspaceId,
    );
    let doc: DocumentRecord | null = null;

    if (record.documentId) {
      doc = await this.deps.documentRepo.getDocumentById(principal.workspaceId, record.documentId);
      if (doc) {
        assertScope(
          principal.scope,
          "write",
          { spaceId: doc.spaceId, kind: doc.kind, tags: doc.tags },
          allSpaces,
        );
        if (record.spaceId && record.spaceId !== doc.spaceId) {
          assertScope(
            principal.scope,
            "write",
            { spaceId: record.spaceId, resourceType: "space" },
            allSpaces,
          );
        }
      } else if (record.spaceId) {
        assertScope(
          principal.scope,
          "write",
          { spaceId: record.spaceId, resourceType: "space" },
          allSpaces,
        );
      } else {
        assertAdminPrincipal(principal, allSpaces);
      }
    } else {
      assertAdminPrincipal(principal, allSpaces);
    }

    if (!record.reversible) {
      throw new InkadeError(
        "CONFLICT",
        record.irreversibleReason ?? `Audit log "${auditLogId}" is not reversible`,
      );
    }

    if (!record.beforeRevisionId || !record.documentId) {
      throw new InkadeError(
        "VALIDATION_ERROR",
        `Audit log "${auditLogId}" has no beforeRevisionId to restore`,
      );
    }

    if (!doc) {
      throw new InkadeError("NOT_FOUND", `Document "${record.documentId}" not found`);
    }
    if (doc.trashedAt !== null) {
      throw new InkadeError(
        "CONFLICT",
        `Document "${doc.id}" is trashed; restore it from trash before rolling back revisions`,
      );
    }

    const targetRevision = await this.deps.revisionLinkRepo.getRevisionById(record.beforeRevisionId);
    if (!targetRevision || targetRevision.documentId !== doc.id) {
      throw new InkadeError(
        "NOT_FOUND",
        `Revision "${record.beforeRevisionId}" not found for document "${doc.id}"`,
      );
    }

    const docAuditLogs = await this.deps.auditRepo.listAuditLogs(principal.workspaceId, {
      documentId: doc.id,
      limit: 500,
    });
    const cascade = computeLedgerCascade(docAuditLogs, record.id);

    interface RollbackOutcome {
      readonly restoredDoc: DocumentRecord;
      readonly restoredNodes?: readonly OutlineNode[] | undefined;
      readonly beforeRevId: RevisionId | null;
      readonly afterRevId: RevisionId | null;
      readonly diffPreview: DiffPreview | null;
    }

    const outcome: RollbackOutcome = await this.deps.auditService.runSuppressed(async () => {
      if (doc.kind === "outline") {
        const res = await this.deps.outlineService.restoreRevisionSnapshot(
          principal,
          doc.id,
          targetRevision.id,
          `Rolled back "${record.action}" (${record.id}) to v${targetRevision.version}`,
        );
        return {
          restoredDoc: res.document,
          restoredNodes: res.nodes,
          beforeRevId: res.beforeRevision?.id ?? null,
          afterRevId: res.afterRevision.id,
          diffPreview: buildCompactDiffPreview(
            res.beforeRevision?.contentMarkdown ?? "",
            res.afterRevision.contentMarkdown,
          ),
        };
      }

      const preRevision = await this.deps.revisionLinkRepo.getLatestRevision(doc.id);
      const preMarkdown = doc.contentMarkdown;
      const updatedDoc = await this.deps.documentService.restoreRevision(
        principal,
        doc.id,
        targetRevision.version,
      );
      const postRevision = await this.deps.revisionLinkRepo.getRevision(
        doc.id,
        updatedDoc.version,
      );
      return {
        restoredDoc: updatedDoc,
        beforeRevId: preRevision?.id ?? null,
        afterRevId: postRevision?.id ?? null,
        diffPreview: buildCompactDiffPreview(preMarkdown, updatedDoc.contentMarkdown),
      };
    });

    const finalDoc = outcome.restoredDoc;

    const rollbackAuditLog = await this.deps.auditService.recordCapturedEvent(principal, {
      action: "audit.rollback",
      resource: `audit:${record.id}`,
      spaceId: finalDoc.spaceId,
      documentId: finalDoc.id,
      summary: `Rolled back "${record.action}" to revision v${targetRevision.version}`,
      beforeRevisionId: outcome.beforeRevId,
      afterRevisionId: outcome.afterRevId,
      diffPreview: outcome.diffPreview,
      reversible: Boolean(outcome.beforeRevId && outcome.afterRevId),
    });

    await this.deps.auditRepo.markAuditLogsReversed(
      principal.workspaceId,
      [record.id],
      rollbackAuditLog.id,
    );
    if (record.afterRevisionId) {
      await this.deps.revisionLinkRepo.markRevisionsReversed(
        [record.afterRevisionId],
        rollbackAuditLog.id,
      );
    }

    this.deps.sseHub?.publish({
      type: "audit.rolled_back",
      workspaceId: principal.workspaceId,
      spaceId: finalDoc.spaceId,
      documentId: finalDoc.id,
      documentKind: finalDoc.kind,
      tags: finalDoc.tags,
      actorType: principal.actorType,
      payload: {
        restoredRevisionId: targetRevision.id,
        rollbackAuditLog,
        affectedAuditIds: cascade.affectedAuditIds,
        document: finalDoc,
        ...(outcome.restoredNodes ? { nodes: outcome.restoredNodes } : {}),
      },
    });

    return {
      restoredRevisionId: targetRevision.id,
      rollbackAuditLog,
      affectedAuditIds: cascade.affectedAuditIds,
      document: finalDoc,
      ...(outcome.restoredNodes ? { nodes: outcome.restoredNodes } : {}),
    };
  }

  /**
   * Atomically rewinds every document touched in a Quiet Autonomy `batchId` back to its
   * pre-batch revision snapshot. When subsequent manual human edits exist and `force` is false,
   * returns ConflictRadar conflicts instead of silently overwriting human changes.
   */
  async rollbackBatch(
    principal: Principal,
    batchId: AuditBatchId,
    input: BatchRollbackInput = {},
  ): Promise<BatchRollbackResult> {
    const batchEntries = await this.deps.auditRepo.listAuditLogsByBatch(
      principal.workspaceId,
      batchId,
    );
    if (batchEntries.length === 0) {
      throw new InkadeError("NOT_FOUND", `Audit batch "${batchId}" not found`);
    }

    const allSpaces = await getAllWorkspaceSpaces(
      this.deps.spacesCache ?? this.deps.spaceRepo,
      principal.workspaceId,
    );

    const reversibleEntries = batchEntries.filter(
      (e) =>
        e.decision === "allowed" &&
        e.reversible &&
        e.documentId != null &&
        e.reversedByAuditId == null &&
        e.action !== "audit.rollback" &&
        e.action !== "audit.batch_rollback" &&
        (e.beforeRevisionId != null ||
          e.action === "import.document.create" ||
          e.action === "briefing.document.create"),
    );
    const reversibleSpaceEntries = batchEntries.filter(
      (e) =>
        e.decision === "allowed" &&
        e.reversible &&
        e.spaceId != null &&
        e.reversedByAuditId == null &&
        (e.action === "import.space.create" || e.action === "import.schema.update"),
    );
    const skippedAlreadyReversedCount = batchEntries.filter(
      (e) => e.reversedByAuditId != null,
    ).length;

    if (reversibleEntries.length === 0 && reversibleSpaceEntries.length === 0) {
      if (skippedAlreadyReversedCount > 0) {
        return {
          batchId,
          rolledBackCount: 0,
          skippedAlreadyReversedCount,
          conflicts: [],
          items: [],
        };
      }
      throw new InkadeError(
        "CONFLICT",
        `Audit batch "${batchId}" has no reversible document mutations`,
      );
    }

    const entriesByDoc = new Map<DocumentRecord["id"], typeof reversibleEntries>();
    for (const entry of reversibleEntries) {
      if (!entry.documentId) continue;
      const list = entriesByDoc.get(entry.documentId);
      if (list) list.push(entry);
      else entriesByDoc.set(entry.documentId, [entry]);
    }

    const docContexts: Array<{
      readonly doc: DocumentRecord;
      readonly earliestEntry: (typeof reversibleEntries)[number];
      readonly docBatchAuditIds: readonly AuditLogId[];
      readonly docBatchAfterRevIds: readonly RevisionId[];
      readonly isCreatedImport: boolean;
    }> = [];
    const conflicts: BatchRollbackConflict[] = [];

    for (const [docId, docBatchEntries] of entriesByDoc.entries()) {
      const earliestEntry = docBatchEntries[0]!;
      const isCreatedImport =
        (earliestEntry.action === "import.document.create" ||
          earliestEntry.action === "briefing.document.create") &&
        earliestEntry.beforeRevisionId == null;
      const doc = await this.deps.documentRepo.getDocumentById(principal.workspaceId, docId);
      if (!doc) {
        if (isCreatedImport) continue;
        throw new InkadeError("NOT_FOUND", `Document "${docId}" not found`);
      }
      assertScope(
        principal.scope,
        "write",
        { spaceId: doc.spaceId, kind: doc.kind, tags: doc.tags },
        allSpaces,
      );
      if (isCreatedImport && principal.scope?.denyHardDelete) {
        throw new InkadeError("FORBIDDEN", "Token scope denies hard deleting imported documents");
      }
      if (!isCreatedImport && doc.trashedAt !== null) {
        throw new InkadeError(
          "CONFLICT",
          `Document "${doc.id}" is trashed; restore it before rolling back batch "${batchId}"`,
        );
      }

      if (!isCreatedImport) {
        const targetRev = await this.deps.revisionLinkRepo.getRevisionById(
          earliestEntry.beforeRevisionId!,
        );
        if (!targetRev || targetRev.documentId !== doc.id) {
          throw new InkadeError(
            "NOT_FOUND",
            `Revision "${earliestEntry.beforeRevisionId}" not found for document "${doc.id}"`,
          );
        }
      }

      const docAuditLogs = await this.deps.auditRepo.listAuditLogs(principal.workspaceId, {
        documentId: doc.id,
        limit: 500,
      });
      const cascade = computeLedgerCascade(docAuditLogs, earliestEntry.id);
      const externalLater = cascade.affectedEntries.filter(
        (entry) => entry.batchId !== batchId && entry.reversedByAuditId == null,
      );

      if (!input.force && externalLater.length > 0) {
        conflicts.push({
          documentId: doc.id,
          documentTitle: doc.title,
          conflictReason: `${externalLater.length} subsequent edit(s) occurred on "${doc.title}" after batch ${batchId}`,
          conflictingAuditIds: externalLater.map((e) => e.id),
          latestHumanEditAt: externalLater[externalLater.length - 1]?.createdAt ?? null,
        });
      }

      docContexts.push({
        doc,
        earliestEntry,
        docBatchAuditIds: docBatchEntries.map((e) => e.id),
        docBatchAfterRevIds: docBatchEntries
          .map((e) => e.afterRevisionId)
          .filter((id): id is RevisionId => id != null),
        isCreatedImport,
      });
    }

    if (conflicts.length > 0 && !input.force) {
      return {
        batchId,
        rolledBackCount: 0,
        skippedAlreadyReversedCount,
        conflicts,
        items: [],
      };
    }

    const items: BatchRollbackItemResult[] = [];
    const deletedDocumentIds: DocumentId[] = [];
    const deletedSpaceIds: SpaceId[] = [];
    const restoredSchemaSpaceIds: SpaceId[] = [];

    for (const ctx of docContexts) {
      if (ctx.isCreatedImport) {
        const linkedAsset = await this.deps.attachmentRepo?.getDocumentAssetByDocumentId(
          principal.workspaceId,
          ctx.doc.id,
        );
        if (linkedAsset) {
          await this.deps.attachmentRepo?.deleteDocumentAsset(principal.workspaceId, linkedAsset.id);
        }
        const attached = await this.deps.attachmentRepo?.listAttachmentsByDocument(
          principal.workspaceId,
          ctx.doc.id,
        );
        if (attached) {
          for (const item of attached) {
            await this.deps.attachmentRepo?.deleteAttachment(principal.workspaceId, item.id);
          }
        }
        await this.deps.searchConfigRepo?.deleteDocumentChunks(principal.workspaceId, ctx.doc.id);
        await this.deps.searchConfigRepo?.deleteDocumentEmbedding(principal.workspaceId, ctx.doc.id);
        await this.deps.oramaIndex?.removeDocument(principal.workspaceId, ctx.doc.id);
        await this.deps.documentRepo.hardDeleteDocument(principal.workspaceId, ctx.doc.id);

        const rollbackAuditLog = await this.deps.auditService.recordCapturedEvent(principal, {
          action: "audit.batch_rollback",
          resource: `audit-batch:${batchId}`,
          spaceId: ctx.doc.spaceId,
          documentId: ctx.doc.id,
          summary: `Batch-undid imported document "${ctx.doc.title}" (removed)`,
          beforeRevisionId: null,
          afterRevisionId: null,
          reversible: false,
          irreversibleReason: "Imported document creation was undone cleanly",
          batchId: null,
          executionMode: "autonomous",
        });

        await this.deps.auditRepo.markAuditLogsReversed(
          principal.workspaceId,
          ctx.docBatchAuditIds,
          rollbackAuditLog.id,
        );
        if (ctx.docBatchAfterRevIds.length > 0) {
          await this.deps.revisionLinkRepo.markRevisionsReversed(
            ctx.docBatchAfterRevIds,
            rollbackAuditLog.id,
          );
        }

        this.deps.sseHub?.publish({
          type: "document.deleted",
          workspaceId: principal.workspaceId,
          spaceId: ctx.doc.spaceId,
          documentId: ctx.doc.id,
          documentKind: ctx.doc.kind,
          tags: ctx.doc.tags,
          actorType: principal.actorType,
          payload: { documentId: ctx.doc.id },
        });
        deletedDocumentIds.push(ctx.doc.id);
        continue;
      }

      const targetRevId = ctx.earliestEntry.beforeRevisionId!;
      const targetRevision = await this.deps.revisionLinkRepo.getRevisionById(targetRevId);
      if (!targetRevision) continue;

      const outcome = await this.deps.auditService.runSuppressed(async () => {
        if (ctx.doc.kind === "outline") {
          const res = await this.deps.outlineService.restoreRevisionSnapshot(
            principal,
            ctx.doc.id,
            targetRevision.id,
            `Batch rollback (${batchId}) to v${targetRevision.version}`,
          );
          let finalDoc = res.document;
          if (finalDoc.unreadAgentUpdate) {
            finalDoc = await this.deps.documentRepo.markDocumentAgentUpdateRead(
              principal.workspaceId,
              ctx.doc.id,
            );
          }
          return {
            restoredDoc: finalDoc,
            restoredNodes: res.nodes,
            beforeRevId: res.beforeRevision?.id ?? null,
            afterRevId: res.afterRevision.id,
            diffPreview: buildCompactDiffPreview(
              res.beforeRevision?.contentMarkdown ?? "",
              res.afterRevision.contentMarkdown,
            ),
          };
        }

        const preRevision = await this.deps.revisionLinkRepo.getLatestRevision(ctx.doc.id);
        const preMarkdown = ctx.doc.contentMarkdown;
        let updatedDoc = await this.deps.documentService.restoreRevision(
          principal,
          ctx.doc.id,
          targetRevision.version,
        );
        if (updatedDoc.unreadAgentUpdate) {
          updatedDoc = await this.deps.documentRepo.markDocumentAgentUpdateRead(
            principal.workspaceId,
            ctx.doc.id,
          );
        }
        const postRevision = await this.deps.revisionLinkRepo.getRevision(
          ctx.doc.id,
          updatedDoc.version,
        );
        return {
          restoredDoc: updatedDoc,
          restoredNodes: undefined,
          beforeRevId: preRevision?.id ?? null,
          afterRevId: postRevision?.id ?? null,
          diffPreview: buildCompactDiffPreview(preMarkdown, updatedDoc.contentMarkdown),
        };
      });

      const rollbackAuditLog = await this.deps.auditService.recordCapturedEvent(principal, {
        action: "audit.batch_rollback",
        resource: `audit-batch:${batchId}`,
        spaceId: outcome.restoredDoc.spaceId,
        documentId: outcome.restoredDoc.id,
        summary: `Batch-undid ${ctx.docBatchAuditIds.length} changes on "${outcome.restoredDoc.title}" to v${targetRevision.version}`,
        beforeRevisionId: outcome.beforeRevId,
        afterRevisionId: outcome.afterRevId,
        diffPreview: outcome.diffPreview,
        reversible: Boolean(outcome.beforeRevId && outcome.afterRevId),
        batchId: null,
        executionMode: "autonomous",
      });

      await this.deps.auditRepo.markAuditLogsReversed(
        principal.workspaceId,
        ctx.docBatchAuditIds,
        rollbackAuditLog.id,
      );
      if (ctx.docBatchAfterRevIds.length > 0) {
        await this.deps.revisionLinkRepo.markRevisionsReversed(
          ctx.docBatchAfterRevIds,
          rollbackAuditLog.id,
        );
      }

      this.deps.sseHub?.publish({
        type: "audit.rolled_back",
        workspaceId: principal.workspaceId,
        spaceId: outcome.restoredDoc.spaceId,
        documentId: outcome.restoredDoc.id,
        documentKind: outcome.restoredDoc.kind,
        tags: outcome.restoredDoc.tags,
        actorType: principal.actorType,
        payload: {
          restoredRevisionId: targetRevision.id,
          rollbackAuditLog,
          affectedAuditIds: [],
          document: outcome.restoredDoc,
          ...(outcome.restoredNodes ? { nodes: outcome.restoredNodes } : {}),
        },
      });

      items.push({
        auditLogId: ctx.earliestEntry.id,
        documentId: outcome.restoredDoc.id,
        restoredRevisionId: targetRevision.id,
        rollbackAuditLog,
        document: outcome.restoredDoc,
        ...(outcome.restoredNodes ? { nodes: outcome.restoredNodes } : {}),
      });
    }

    // Restore schema updates before attempting empty folder-space cleanup
    const schemaEntries = reversibleSpaceEntries.filter(
      (e) => e.action === "import.schema.update",
    );
    for (const entry of schemaEntries) {
      if (!entry.spaceId) continue;
      let priorFields: PropertyFieldDefinition[] = [];
      try {
        if (entry.diffPreview?.oldSnippet) {
          priorFields = propertyFieldDefinitionSchema.array().parse(
            JSON.parse(entry.diffPreview.oldSnippet),
          );
        }
      } catch {
        priorFields = [];
      }
      const restoredSchema = await this.deps.spaceRepo.upsertSpacePropertySchema(
        principal.workspaceId,
        { spaceId: entry.spaceId, fields: priorFields },
      );
      const schemaRollbackLog = await this.deps.auditService.recordCapturedEvent(principal, {
        action: "audit.batch_rollback",
        resource: `audit-batch:${batchId}`,
        spaceId: entry.spaceId,
        summary: `Restored space property schema after rolling back batch ${batchId}`,
        reversible: false,
        batchId: null,
        executionMode: "autonomous",
      });
      await this.deps.auditRepo.markAuditLogsReversed(
        principal.workspaceId,
        [entry.id],
        schemaRollbackLog.id,
      );
      this.deps.sseHub?.publish({
        type: "space_schema.updated",
        workspaceId: principal.workspaceId,
        spaceId: entry.spaceId,
        actorType: principal.actorType,
        payload: { spaceId: entry.spaceId, schema: restoredSchema },
      });
      restoredSchemaSpaceIds.push(entry.spaceId);
    }

    const createdSpaceEntries = reversibleSpaceEntries
      .filter((e) => e.action === "import.space.create")
      .reverse();
    for (const entry of createdSpaceEntries) {
      if (!entry.spaceId) continue;
      const spaceRecord = await this.deps.spaceRepo.getSpaceById(
        principal.workspaceId,
        entry.spaceId,
      );
      if (!spaceRecord) continue;
      const deleted = await this.deps.spaceRepo.deleteSpaceIfEmpty(
        principal.workspaceId,
        entry.spaceId,
      );
      if (!deleted) continue;
      this.deps.spacesCache?.invalidate(principal.workspaceId);
      const spaceRollbackLog = await this.deps.auditService.recordCapturedEvent(principal, {
        action: "audit.batch_rollback",
        resource: `audit-batch:${batchId}`,
        spaceId: entry.spaceId,
        summary: `Removed imported empty space "${spaceRecord.name}"`,
        reversible: false,
        batchId: null,
        executionMode: "autonomous",
      });
      await this.deps.auditRepo.markAuditLogsReversed(
        principal.workspaceId,
        [entry.id],
        spaceRollbackLog.id,
      );
      this.deps.sseHub?.publish({
        type: "space.archived",
        workspaceId: principal.workspaceId,
        spaceId: spaceRecord.id,
        actorType: principal.actorType,
        payload: { space: spaceRecord },
      });
      deletedSpaceIds.push(spaceRecord.id);
    }

    const batchResult: BatchRollbackResult = {
      batchId,
      rolledBackCount:
        items.length +
        deletedDocumentIds.length +
        deletedSpaceIds.length +
        restoredSchemaSpaceIds.length,
      skippedAlreadyReversedCount,
      conflicts: [],
      items,
      ...(deletedDocumentIds.length > 0 ? { deletedDocumentIds } : {}),
      ...(deletedSpaceIds.length > 0 ? { deletedSpaceIds } : {}),
      ...(restoredSchemaSpaceIds.length > 0 ? { restoredSchemaSpaceIds } : {}),
    };

    const primaryDoc = items[0]?.document;
    this.deps.sseHub?.publish({
      type: "audit.batch_rolled_back",
      workspaceId: principal.workspaceId,
      spaceId: primaryDoc?.spaceId ?? null,
      documentId: primaryDoc?.id,
      documentKind: primaryDoc?.kind,
      tags: primaryDoc?.tags,
      actorType: principal.actorType,
      payload: batchResult,
    });

    return batchResult;
  }
}
