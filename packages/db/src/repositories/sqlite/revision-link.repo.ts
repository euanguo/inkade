import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import {
  asDocumentId,
  createId,
  ID_PREFIXES,
  InkadeError,
  outlineSnapshotSchema,
  parseJsonWithSchema,
  type ActorType,
  type AuditLogId,
  type CreateDocumentHighlightInput,
  type DocumentHighlight,
  type DocumentId,
  type DocumentLink,
  type DocumentRevision,
  type HighlightComment,
  type HighlightCommentId,
  type HighlightId,
  type HighlightStatus,
  type RevisionId,
  type UpdateDocumentHighlightInput,
  type WakeEventId,
} from "@inkade/core";
import {
  adeThreadBindings,
  documentHighlights,
  documentLinks,
  documentRevisions,
  documents,
  highlightComments,
} from "../../schema/sqlite.ts";
import type {
  CreateHighlightCommentRecordInput,
  CreateRevisionRecordInput,
  RecordOutlinePostMutationRevisionInput,
  RevisionLinkRepo,
  RevisionWithOutlineSnapshot,
  WorkspaceDocumentLinkEdge,
} from "../ports/revision-link.port.ts";
import {
  nowIso,
  resolvePendingIncomingLinksSync,
  syncOutgoingLinksSync,
  syncToPromise,
  type SqliteRepoContext,
} from "./helpers.ts";
import {
  mapHighlightCommentRow,
  mapHighlightRow,
  mapLinkRow,
  mapRevisionRow,
} from "./mappers.ts";
import {
  ensureOutlineBaselineRevisionSync,
  recordOutlinePostMutationRevisionSync,
} from "./revision-helpers.ts";

export class SqliteRevisionLinkRepo implements RevisionLinkRepo {
  constructor(private readonly ctx: SqliteRepoContext) {}

  listRevisions(documentId: string): Promise<readonly DocumentRevision[]> {
    return syncToPromise(() => {
      const rows = this.ctx.db
        .select()
        .from(documentRevisions)
        .where(eq(documentRevisions.documentId, documentId))
        .orderBy(desc(documentRevisions.version))
        .all();
      return rows.map(mapRevisionRow);
    });
  }

  getRevision(documentId: string, version: number): Promise<DocumentRevision | null> {
    return syncToPromise(() => {
      const row = this.ctx.db
        .select()
        .from(documentRevisions)
        .where(
          and(
            eq(documentRevisions.documentId, documentId),
            eq(documentRevisions.version, version),
          ),
        )
        .get();
      return row ? mapRevisionRow(row) : null;
    });
  }

  getRevisionById(revisionId: string): Promise<RevisionWithOutlineSnapshot | null> {
    return syncToPromise(() => {
      const row = this.ctx.db
        .select()
        .from(documentRevisions)
        .where(eq(documentRevisions.id, revisionId))
        .get();
      if (!row) return null;
      const outlineSnapshot = parseJsonWithSchema(
        row.outlineSnapshotJson,
        outlineSnapshotSchema.nullable(),
        null,
      );
      return {
        ...mapRevisionRow(row),
        outlineSnapshot,
      };
    });
  }

  getLatestRevision(documentId: string): Promise<DocumentRevision | null> {
    return syncToPromise(() => {
      const row = this.ctx.db
        .select()
        .from(documentRevisions)
        .where(eq(documentRevisions.documentId, documentId))
        .orderBy(desc(documentRevisions.version))
        .limit(1)
        .get();
      return row ? mapRevisionRow(row) : null;
    });
  }

  createRevision(input: CreateRevisionRecordInput): Promise<DocumentRevision> {
    return syncToPromise(() => {
      const row: typeof documentRevisions.$inferSelect = {
        id: input.id ?? createId(ID_PREFIXES.revision),
        documentId: input.documentId,
        version: input.version,
        contentMarkdown: input.contentMarkdown,
        outlineSnapshotJson: input.outlineSnapshotJson ?? null,
        changeSummary: input.changeSummary ?? null,
        actorType: input.actorType,
        actorId: input.actorId ?? null,
        batchId: input.batchId ?? null,
        executionMode: input.executionMode ?? "autonomous",
        reversedByAuditId: input.reversedByAuditId ?? null,
        createdAt: input.createdAt ?? nowIso(),
      };
      this.ctx.db.insert(documentRevisions).values(row).run();
      return mapRevisionRow(row);
    });
  }

  markRevisionsReversed(
    revisionIds: readonly (RevisionId | string)[],
    reversedByAuditId: AuditLogId | string,
  ): Promise<void> {
    return syncToPromise(() => {
      if (revisionIds.length === 0) return;
      this.ctx.db
        .update(documentRevisions)
        .set({ reversedByAuditId })
        .where(inArray(documentRevisions.id, [...revisionIds]))
        .run();
    });
  }

  ensureOutlineBaselineRevision(
    doc: { readonly id: string; readonly version: number; readonly createdAt: string },
    ts?: string,
  ): Promise<void> {
    return syncToPromise(() => ensureOutlineBaselineRevisionSync(this.ctx.db, doc, ts ?? nowIso()));
  }

  recordOutlinePostMutationRevision(
    input: RecordOutlinePostMutationRevisionInput,
  ): Promise<DocumentRevision> {
    return syncToPromise(() => {
      const saved = recordOutlinePostMutationRevisionSync(this.ctx.db, {
        documentId: input.documentId,
        currentVersion: input.currentVersion,
        actorType: input.actorType,
        actorId: input.actorId ?? null,
        changeSummary: input.changeSummary,
        batchId: input.batchId,
        executionMode: input.executionMode,
        ts: input.ts ?? nowIso(),
        updateLastEditedBy: input.updateLastEditedBy,
      });
      return mapRevisionRow(saved);
    });
  }

  listBacklinks(workspaceId: string, documentId: string): Promise<readonly DocumentLink[]> {
    return syncToPromise(() => {
      const rows = this.ctx.db
        .select()
        .from(documentLinks)
        .where(
          and(
            eq(documentLinks.workspaceId, workspaceId),
            eq(documentLinks.targetDocumentId, documentId),
          ),
        )
        .all();
      return rows.map(mapLinkRow);
    });
  }

  listOutgoingLinks(workspaceId: string, documentId: string): Promise<readonly DocumentLink[]> {
    return syncToPromise(() => {
      const rows = this.ctx.db
        .select()
        .from(documentLinks)
        .where(
          and(
            eq(documentLinks.workspaceId, workspaceId),
            eq(documentLinks.sourceDocumentId, documentId),
          ),
        )
        .all();
      return rows.map(mapLinkRow);
    });
  }

  listIncomingLinkSourceDocIds(
    workspaceId: string,
    renamedDocId: string,
    oldTitle: string,
  ): Promise<readonly DocumentId[]> {
    return syncToPromise(() => {
      const rows = this.ctx.sqlite
        .query<{ source_document_id: string }, [string, string, string, string]>(
          `SELECT DISTINCT source_document_id
           FROM document_links
           WHERE workspace_id = ?
             AND source_document_id != ?
             AND (target_document_id = ? OR lower(target_slug_or_title) = lower(?))`,
        )
        .all(workspaceId, renamedDocId, renamedDocId, oldTitle);
      return rows.map((r) => asDocumentId(r.source_document_id));
    });
  }

  syncOutgoingLinks(
    workspaceId: string,
    sourceDocumentId: string,
    sourceNodeId: string | null,
    markdown: string,
  ): Promise<void> {
    return syncToPromise(() =>
      syncOutgoingLinksSync(
        this.ctx.sqlite,
        this.ctx.db,
        workspaceId,
        sourceDocumentId,
        sourceNodeId,
        markdown,
      ),
    );
  }

  resolvePendingIncomingLinks(
    workspaceId: string,
    targetDoc: { readonly id: string; readonly slug: string; readonly title: string },
  ): Promise<void> {
    return syncToPromise(() =>
      resolvePendingIncomingLinksSync(this.ctx.sqlite, workspaceId, targetDoc),
    );
  }

  deleteLinksForNodes(nodeIds: readonly string[]): Promise<void> {
    return syncToPromise(() => {
      if (nodeIds.length === 0) return;
      this.ctx.db
        .delete(documentLinks)
        .where(inArray(documentLinks.sourceNodeId, [...nodeIds]))
        .run();
    });
  }

  private countCommentsForHighlightSync(workspaceId: string, highlightId: string): number {
    const row = this.ctx.db
      .select({ count: sql<number>`count(*)` })
      .from(highlightComments)
      .where(
        and(
          eq(highlightComments.workspaceId, workspaceId),
          eq(highlightComments.highlightId, highlightId),
        ),
      )
      .get();
    return Number(row?.count ?? 0);
  }

  listDocumentHighlights(
    workspaceId: string,
    documentId: string,
  ): Promise<readonly DocumentHighlight[]> {
    return syncToPromise(() => {
      const rows = this.ctx.db
        .select()
        .from(documentHighlights)
        .where(
          and(
            eq(documentHighlights.workspaceId, workspaceId),
            eq(documentHighlights.documentId, documentId),
          ),
        )
        .orderBy(desc(documentHighlights.createdAt))
        .all();
      const counts = this.ctx.db
        .select({
          highlightId: highlightComments.highlightId,
          count: sql<number>`count(*)`,
        })
        .from(highlightComments)
        .where(
          and(
            eq(highlightComments.workspaceId, workspaceId),
            eq(highlightComments.documentId, documentId),
          ),
        )
        .groupBy(highlightComments.highlightId)
        .all();
      const countMap = new Map(counts.map((c) => [c.highlightId, Number(c.count)]));
      return rows.map((row) => mapHighlightRow(row, countMap.get(row.id) ?? 0));
    });
  }

  getDocumentHighlightById(
    workspaceId: string,
    highlightId: HighlightId | string,
  ): Promise<DocumentHighlight | null> {
    return syncToPromise(() => {
      const row = this.ctx.db
        .select()
        .from(documentHighlights)
        .where(
          and(
            eq(documentHighlights.workspaceId, workspaceId),
            eq(documentHighlights.id, highlightId),
          ),
        )
        .get();
      if (!row) return null;
      return mapHighlightRow(row, this.countCommentsForHighlightSync(workspaceId, row.id));
    });
  }

  createDocumentHighlight(
    workspaceId: string,
    documentId: string,
    input: CreateDocumentHighlightInput,
    options?: { readonly id?: string | undefined },
  ): Promise<DocumentHighlight> {
    return syncToPromise(() => {
      const doc = this.ctx.db
        .select({ id: documents.id, trashedAt: documents.trashedAt })
        .from(documents)
        .where(and(eq(documents.workspaceId, workspaceId), eq(documents.id, documentId)))
        .get();
      if (!doc || doc.trashedAt !== null) {
        throw new InkadeError("NOT_FOUND", `Document "${documentId}" not found`);
      }

      if (input.bindingId) {
        const binding = this.ctx.db
          .select({ id: adeThreadBindings.id })
          .from(adeThreadBindings)
          .where(
            and(
              eq(adeThreadBindings.workspaceId, workspaceId),
              eq(adeThreadBindings.id, input.bindingId),
            ),
          )
          .get();
        if (!binding) {
          throw new InkadeError("NOT_FOUND", `Thread binding "${input.bindingId}" not found`);
        }
      }

      const id = options?.id ?? createId(ID_PREFIXES.highlight);
      const ts = nowIso();
      const row: typeof documentHighlights.$inferSelect = {
        id,
        workspaceId,
        documentId,
        quote: input.quote,
        prefixContext: input.prefixContext ?? "",
        suffixContext: input.suffixContext ?? "",
        color: input.color ?? "amber",
        noteMarkdown: input.noteMarkdown ?? "",
        bindingId: input.bindingId ?? null,
        status: "open",
        resolvedAt: null,
        resolvedByType: null,
        createdAt: ts,
        updatedAt: ts,
      };
      this.ctx.db.insert(documentHighlights).values(row).run();
      return mapHighlightRow(row, 0);
    });
  }

  updateDocumentHighlight(
    workspaceId: string,
    highlightId: HighlightId | string,
    input: UpdateDocumentHighlightInput,
  ): Promise<DocumentHighlight> {
    return syncToPromise(() => {
      const current = this.ctx.db
        .select()
        .from(documentHighlights)
        .where(
          and(
            eq(documentHighlights.workspaceId, workspaceId),
            eq(documentHighlights.id, highlightId),
          ),
        )
        .get();
      if (!current) {
        throw new InkadeError("NOT_FOUND", `Highlight "${highlightId}" not found`);
      }
      const ts = nowIso();
      this.ctx.db
        .update(documentHighlights)
        .set({
          color: input.color ?? current.color,
          noteMarkdown: input.noteMarkdown ?? current.noteMarkdown,
          bindingId: input.bindingId !== undefined ? input.bindingId : current.bindingId,
          status: input.status ?? current.status,
          resolvedAt: input.resolvedAt !== undefined ? input.resolvedAt : current.resolvedAt,
          resolvedByType:
            input.resolvedByType !== undefined ? input.resolvedByType : current.resolvedByType,
          updatedAt: ts,
        })
        .where(eq(documentHighlights.id, highlightId))
        .run();

      const updated = this.ctx.db
        .select()
        .from(documentHighlights)
        .where(eq(documentHighlights.id, highlightId))
        .get();
      if (!updated) {
        throw new InkadeError("INTERNAL_ERROR", "Failed to read updated highlight");
      }
      return mapHighlightRow(updated, this.countCommentsForHighlightSync(workspaceId, updated.id));
    });
  }

  deleteDocumentHighlight(workspaceId: string, highlightId: HighlightId | string): Promise<void> {
    return syncToPromise(() => {
      const current = this.ctx.db
        .select({ id: documentHighlights.id })
        .from(documentHighlights)
        .where(
          and(
            eq(documentHighlights.workspaceId, workspaceId),
            eq(documentHighlights.id, highlightId),
          ),
        )
        .get();
      if (!current) {
        throw new InkadeError("NOT_FOUND", `Highlight "${highlightId}" not found`);
      }
      this.ctx.db.delete(documentHighlights).where(eq(documentHighlights.id, highlightId)).run();
    });
  }

  listHighlightComments(
    workspaceId: string,
    highlightId: HighlightId | string,
  ): Promise<readonly HighlightComment[]> {
    return syncToPromise(() => {
      const rows = this.ctx.db
        .select()
        .from(highlightComments)
        .where(
          and(
            eq(highlightComments.workspaceId, workspaceId),
            eq(highlightComments.highlightId, highlightId),
          ),
        )
        .orderBy(asc(highlightComments.createdAt), asc(highlightComments.id))
        .all();
      return rows.map(mapHighlightCommentRow);
    });
  }

  listDocumentHighlightComments(
    workspaceId: string,
    documentId: string,
  ): Promise<readonly HighlightComment[]> {
    return syncToPromise(() => {
      const rows = this.ctx.db
        .select()
        .from(highlightComments)
        .where(
          and(
            eq(highlightComments.workspaceId, workspaceId),
            eq(highlightComments.documentId, documentId),
          ),
        )
        .orderBy(asc(highlightComments.createdAt), asc(highlightComments.id))
        .all();
      return rows.map(mapHighlightCommentRow);
    });
  }

  createHighlightComment(
    workspaceId: string,
    input: CreateHighlightCommentRecordInput,
  ): Promise<HighlightComment> {
    return syncToPromise(() => {
      const id = input.id ?? createId(ID_PREFIXES.highlightComment);
      const createdAt = input.createdAt ?? nowIso();
      const row: typeof highlightComments.$inferSelect = {
        id,
        workspaceId,
        highlightId: input.highlightId,
        documentId: input.documentId,
        authorType: input.authorType,
        authorId: input.authorId ?? null,
        authorName: input.authorName,
        bodyMarkdown: input.bodyMarkdown,
        sentToAgentAt: input.sentToAgentAt ?? null,
        wakeEventId: input.wakeEventId ?? null,
        createdAt,
      };
      this.ctx.db.insert(highlightComments).values(row).run();
      return mapHighlightCommentRow(row);
    });
  }

  markHighlightCommentsSentToAgent(
    workspaceId: string,
    commentIds: readonly (HighlightCommentId | string)[],
    wakeEventId: WakeEventId | string,
    sentAt: string,
  ): Promise<readonly HighlightComment[]> {
    return syncToPromise(() => {
      if (commentIds.length === 0) return [];
      this.ctx.db
        .update(highlightComments)
        .set({
          sentToAgentAt: sentAt,
          wakeEventId,
        })
        .where(
          and(
            eq(highlightComments.workspaceId, workspaceId),
            inArray(highlightComments.id, [...commentIds]),
          ),
        )
        .run();

      const rows = this.ctx.db
        .select()
        .from(highlightComments)
        .where(
          and(
            eq(highlightComments.workspaceId, workspaceId),
            inArray(highlightComments.id, [...commentIds]),
          ),
        )
        .orderBy(asc(highlightComments.createdAt), asc(highlightComments.id))
        .all();
      return rows.map(mapHighlightCommentRow);
    });
  }

  updateHighlightStatus(
    workspaceId: string,
    highlightId: HighlightId | string,
    input: {
      readonly status: HighlightStatus;
      readonly resolvedAt: string | null;
      readonly resolvedByType: ActorType | null;
    },
  ): Promise<DocumentHighlight> {
    return syncToPromise(() => {
      const current = this.ctx.db
        .select()
        .from(documentHighlights)
        .where(
          and(
            eq(documentHighlights.workspaceId, workspaceId),
            eq(documentHighlights.id, highlightId),
          ),
        )
        .get();
      if (!current) {
        throw new InkadeError("NOT_FOUND", `Highlight "${highlightId}" not found`);
      }
      const ts = nowIso();
      this.ctx.db
        .update(documentHighlights)
        .set({
          status: input.status,
          resolvedAt: input.resolvedAt,
          resolvedByType: input.resolvedByType,
          updatedAt: ts,
        })
        .where(eq(documentHighlights.id, highlightId))
        .run();
      const updated = this.ctx.db
        .select()
        .from(documentHighlights)
        .where(eq(documentHighlights.id, highlightId))
        .get();
      if (!updated) {
        throw new InkadeError("INTERNAL_ERROR", "Failed to read updated highlight");
      }
      return mapHighlightRow(updated, this.countCommentsForHighlightSync(workspaceId, updated.id));
    });
  }

  listWorkspaceDocumentLinks(workspaceId: string): Promise<readonly WorkspaceDocumentLinkEdge[]> {
    return syncToPromise(() => {
      const rows = this.ctx.db
        .select({
          sourceDocumentId: documentLinks.sourceDocumentId,
          targetDocumentId: documentLinks.targetDocumentId,
        })
        .from(documentLinks)
        .where(
          and(
            eq(documentLinks.workspaceId, workspaceId),
            isNotNull(documentLinks.targetDocumentId),
          ),
        )
        .all();

      const seen = new Set<string>();
      const edges: WorkspaceDocumentLinkEdge[] = [];
      for (const row of rows) {
        if (!row.targetDocumentId || row.sourceDocumentId === row.targetDocumentId) continue;
        const key = `${row.sourceDocumentId}->${row.targetDocumentId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({
          sourceDocumentId: asDocumentId(row.sourceDocumentId),
          targetDocumentId: asDocumentId(row.targetDocumentId),
        });
      }
      return edges;
    });
  }
}
