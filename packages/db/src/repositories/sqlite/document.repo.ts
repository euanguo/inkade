import { and, asc, desc, eq, isNull } from "drizzle-orm";
import {
  createId,
  extractExcerpt,
  extractInlineTags,
  ID_PREFIXES,
  InkadeError,
  isValidDailyDate,
  markdownToPlainText,
  type ActorType,
  type CreateDocumentInput,
  type DocumentId,
  type DocumentRecord,
  type DocumentSummary,
  type UpdateDocumentInput,
} from "@inkade/core";
import { documentRevisions, documents } from "../../schema/sqlite.ts";
import type {
  CreateDocumentOptions,
  DocumentRepo,
  ListDocumentsOptions,
  UpdateDocumentContentDirectInput,
  UpdateDocumentOptions,
} from "../ports/document.port.ts";
import {
  buildDocumentListConditions,
  DOCUMENT_SUMMARY_COLUMNS,
  encodeOptionalJson,
  finalizeCreatedDocumentSync,
  requireDocumentSync,
  requireSpaceSync,
  restoreActiveOutlineNodesFtsSync,
} from "./document-helpers.ts";
import {
  addDocumentTagsSync,
  computeUniqueDocumentSlugSync,
  deleteDocumentFtsSync,
  loadTagsForDocumentsSync,
  nowIso,
  replaceDocumentTagsSync,
  resolvePendingIncomingLinksSync,
  syncOutgoingLinksSync,
  syncToPromise,
  upsertFtsEntrySync,
  type SqliteRepoContext,
} from "./helpers.ts";
import { mapDocumentRow, mapDocumentSummaryRow } from "./mappers.ts";
import { deleteDocumentTasksSync, syncDocumentTasksForDocumentSync } from "./task-sync-helpers.ts";

export class SqliteDocumentRepo implements DocumentRepo {
  constructor(private readonly ctx: SqliteRepoContext) {}

  listDocumentSummaries(
    workspaceId: string,
    options?: ListDocumentsOptions,
  ): Promise<readonly DocumentSummary[]> {
    return syncToPromise(() => {
      const conditions = buildDocumentListConditions(workspaceId, options);
      if (!conditions) return [];
      let query = this.ctx.db
        .select(DOCUMENT_SUMMARY_COLUMNS)
        .from(documents)
        .where(and(...conditions))
        .orderBy(desc(documents.pinned), desc(documents.updatedAt), asc(documents.id))
        .$dynamic();
      if (options?.limit !== null) {
        query = query.limit(options?.limit ?? 100).offset(options?.offset ?? 0);
      }
      const rows = query.all();
      const tagsMap = loadTagsForDocumentsSync(this.ctx.db, rows.map((r) => r.id));
      return rows.map((row) => mapDocumentSummaryRow(row, tagsMap.get(row.id) ?? []));
    });
  }

  listDocuments(
    workspaceId: string,
    options?: ListDocumentsOptions,
  ): Promise<readonly DocumentRecord[]> {
    return syncToPromise(() => {
      const conditions = buildDocumentListConditions(workspaceId, options);
      if (!conditions) return [];
      let query = this.ctx.db
        .select()
        .from(documents)
        .where(and(...conditions))
        .orderBy(desc(documents.pinned), desc(documents.updatedAt), asc(documents.id))
        .$dynamic();
      if (options?.limit !== null) {
        query = query.limit(options?.limit ?? 100).offset(options?.offset ?? 0);
      }
      const rows = query.all();
      const tagsMap = loadTagsForDocumentsSync(this.ctx.db, rows.map((r) => r.id));
      return rows.map((row) => mapDocumentRow(row, tagsMap.get(row.id) ?? []));
    });
  }

  getDocumentById(workspaceId: string, documentId: string): Promise<DocumentRecord | null> {
    return syncToPromise(() => {
      const row = this.ctx.db
        .select()
        .from(documents)
        .where(and(eq(documents.workspaceId, workspaceId), eq(documents.id, documentId)))
        .get();
      if (!row) return null;
      const tags = loadTagsForDocumentsSync(this.ctx.db, [row.id]).get(row.id) ?? [];
      return mapDocumentRow(row, tags);
    });
  }

  getDocumentBySlug(workspaceId: string, slug: string): Promise<DocumentRecord | null> {
    return syncToPromise(() => {
      const row = this.ctx.db
        .select()
        .from(documents)
        .where(and(eq(documents.workspaceId, workspaceId), eq(documents.slug, slug)))
        .get();
      if (!row) return null;
      const tags = loadTagsForDocumentsSync(this.ctx.db, [row.id]).get(row.id) ?? [];
      return mapDocumentRow(row, tags);
    });
  }

  findActiveDailyDocumentId(workspaceId: string, dailyDate: string): Promise<DocumentId | null> {
    return syncToPromise(() => {
      const row = this.ctx.db
        .select({ id: documents.id })
        .from(documents)
        .where(
          and(eq(documents.workspaceId, workspaceId), eq(documents.dailyDate, dailyDate), isNull(documents.trashedAt)),
        )
        .get();
      return row ? (row.id as DocumentId) : null;
    });
  }

  getOrCreateDailyOutline(
    workspaceId: string,
    dailySpaceId: string,
    dailyDate: string,
    title?: string,
  ): Promise<{ readonly document: DocumentRecord; readonly created: boolean }> {
    return syncToPromise(() => {
      if (!isValidDailyDate(dailyDate)) {
        throw new InkadeError("VALIDATION_ERROR", `Invalid dailyDate "${dailyDate}"`);
      }
      return this.ctx.tx.runSyncAtomic(() => {
        const existing = this.ctx.db
          .select()
          .from(documents)
          .where(
            and(eq(documents.workspaceId, workspaceId), eq(documents.dailyDate, dailyDate), isNull(documents.trashedAt)),
          )
          .get();
        if (existing) {
          const tags = loadTagsForDocumentsSync(this.ctx.db, [existing.id]).get(existing.id) ?? [];
          return { document: mapDocumentRow(existing, tags), created: false };
        }
        requireSpaceSync(this.ctx, workspaceId, dailySpaceId);

        const docId = createId(ID_PREFIXES.document);
        const docTitle = title ?? `Daily · ${dailyDate}`;
        const slug = computeUniqueDocumentSlugSync(this.ctx.sqlite, workspaceId, `daily-${dailyDate}`);
        const ts = nowIso();
        const row: typeof documents.$inferSelect = {
          id: docId, workspaceId, spaceId: dailySpaceId, kind: "outline", title: docTitle, slug,
          dailyDate, contentMarkdown: "", contentJson: null, contentText: "", excerpt: "",
          sourceUrl: null, sourceMetaJson: null, propertiesJson: null, version: 1, pinned: false,
          unreadAgentUpdate: false, lastEditedByType: "system", trashedAt: null, createdAt: ts, updatedAt: ts,
        };
        this.ctx.db.insert(documents).values(row).run();
        const document = finalizeCreatedDocumentSync(this.ctx, {
          workspaceId, row, tags: [], changeSummary: "Initialized daily outline",
          actorType: "system", actorId: null, outlineSnapshotJson: "[]",
        });
        return { document, created: true };
      });
    });
  }

  createDocument(
    workspaceId: string,
    input: CreateDocumentInput,
    options?: CreateDocumentOptions,
  ): Promise<DocumentRecord> {
    return syncToPromise(() =>
      this.ctx.tx.runSyncAtomic(() => {
        requireSpaceSync(this.ctx, workspaceId, input.spaceId);
        if (input.dailyDate) {
          const colliding = this.ctx.db
            .select({ id: documents.id })
            .from(documents)
            .where(
              and(eq(documents.workspaceId, workspaceId), eq(documents.dailyDate, input.dailyDate), isNull(documents.trashedAt)),
            )
            .get();
          if (colliding) {
            throw new InkadeError("CONFLICT", `Active daily outline for "${input.dailyDate}" already exists`);
          }
        }
        const docId = options?.id ?? createId(ID_PREFIXES.document);
        const slug = computeUniqueDocumentSlugSync(this.ctx.sqlite, workspaceId, input.slug ?? input.title);
        const contentMarkdown = input.contentMarkdown ?? "";
        const actorType: ActorType = options?.actorType ?? "human";
        const ts = nowIso();
        const row: typeof documents.$inferSelect = {
          id: docId, workspaceId, spaceId: input.spaceId, kind: input.kind, title: input.title, slug,
          dailyDate: input.dailyDate ?? null, contentMarkdown,
          contentJson: input.contentJson ? JSON.stringify(input.contentJson) : null,
          contentText: markdownToPlainText(contentMarkdown), excerpt: extractExcerpt(contentMarkdown),
          sourceUrl: input.sourceUrl ?? null,
          sourceMetaJson: input.sourceMeta ? JSON.stringify(input.sourceMeta) : null,
          propertiesJson: input.properties ? JSON.stringify(input.properties) : null,
          version: 1, pinned: input.pinned ?? false,
          unreadAgentUpdate: options?.unreadAgentUpdate ?? actorType === "agent",
          lastEditedByType: actorType, trashedAt: null, createdAt: ts, updatedAt: ts,
        };
        this.ctx.db.insert(documents).values(row).run();
        const savedTags = replaceDocumentTagsSync(this.ctx.db, docId, [
          ...(input.tags ?? []),
          ...extractInlineTags(contentMarkdown),
        ]);
        return finalizeCreatedDocumentSync(this.ctx, {
          workspaceId, row, tags: savedTags,
          changeSummary: options?.changeSummary ?? "Initial version",
          actorType, actorId: options?.actorId ?? null,
          outlineSnapshotJson: input.kind === "outline" ? "[]" : null,
          batchId: options?.batchId ?? null,
          executionMode: options?.executionMode ?? "autonomous",
        });
      }),
    );
  }

  updateDocument(
    workspaceId: string,
    documentId: string,
    input: UpdateDocumentInput,
    options?: UpdateDocumentOptions,
  ): Promise<DocumentRecord> {
    return syncToPromise(() =>
      this.ctx.tx.runSyncAtomic(() => {
        const current = requireDocumentSync(this.ctx, workspaceId, documentId);
        if (input.expectedVersion !== undefined && input.expectedVersion !== current.version) {
          throw new InkadeError(
            "VERSION_CONFLICT",
            `Version mismatch for document "${documentId}": expected ${input.expectedVersion}, actual ${current.version}`,
            { expectedVersion: input.expectedVersion, actualVersion: current.version },
          );
        }
        const nextSpaceId = input.spaceId ?? current.spaceId;
        if (input.spaceId && input.spaceId !== current.spaceId) requireSpaceSync(this.ctx, workspaceId, input.spaceId);

        const nextTitle = input.title ?? current.title;
        const nextSlug =
          input.slug !== undefined
            ? computeUniqueDocumentSlugSync(this.ctx.sqlite, workspaceId, input.slug, documentId)
            : current.slug;
        const nextMarkdown = input.contentMarkdown ?? current.contentMarkdown;
        const mdChanged = input.contentMarkdown !== undefined && nextMarkdown !== current.contentMarkdown;
        const nextText = mdChanged ? markdownToPlainText(nextMarkdown) : current.contentText;
        const actorType: ActorType = options?.actorType ?? "human";
        const nextVersion = mdChanged ? current.version + 1 : current.version;
        const nextUnread =
          input.unreadAgentUpdate !== undefined
            ? input.unreadAgentUpdate
            : actorType === "agent" && mdChanged
              ? true
              : current.unreadAgentUpdate;
        const ts = nowIso();

        this.ctx.db
          .update(documents)
          .set({
            spaceId: nextSpaceId, title: nextTitle, slug: nextSlug, contentMarkdown: nextMarkdown,
            contentJson: encodeOptionalJson(input.contentJson, current.contentJson),
            contentText: nextText, excerpt: mdChanged ? extractExcerpt(nextMarkdown) : current.excerpt,
            sourceUrl: input.sourceUrl !== undefined ? input.sourceUrl : current.sourceUrl,
            sourceMetaJson: encodeOptionalJson(input.sourceMeta, current.sourceMetaJson),
            propertiesJson: encodeOptionalJson(input.properties, current.propertiesJson),
            version: nextVersion, pinned: input.pinned ?? current.pinned,
            unreadAgentUpdate: nextUnread, lastEditedByType: actorType, updatedAt: ts,
          })
          .where(and(eq(documents.workspaceId, workspaceId), eq(documents.id, documentId)))
          .run();

        const inlineTags = extractInlineTags(nextMarkdown);
        const savedTags =
          input.tags !== undefined
            ? replaceDocumentTagsSync(this.ctx.db, documentId, [...input.tags, ...inlineTags])
            : mdChanged && inlineTags.length > 0
              ? addDocumentTagsSync(this.ctx.sqlite, this.ctx.db, documentId, inlineTags)
              : (loadTagsForDocumentsSync(this.ctx.db, [documentId]).get(documentId) ?? []);

        if (mdChanged) {
          this.ctx.db
            .insert(documentRevisions)
            .values({
              id: createId(ID_PREFIXES.revision), documentId, version: nextVersion,
              contentMarkdown: nextMarkdown, changeSummary: input.changeSummary ?? null,
              actorType, actorId: options?.actorId ?? null,
              batchId: options?.batchId ?? null,
              executionMode: options?.executionMode ?? "autonomous",
              reversedByAuditId: null,
              createdAt: ts,
            })
            .run();
          syncOutgoingLinksSync(this.ctx.sqlite, this.ctx.db, workspaceId, documentId, null, nextMarkdown);
        }
        if (nextTitle !== current.title || nextSlug !== current.slug) {
          resolvePendingIncomingLinksSync(this.ctx.sqlite, workspaceId, { id: documentId, slug: nextSlug, title: nextTitle });
        }
        if (current.trashedAt === null) {
          upsertFtsEntrySync(this.ctx.sqlite, {
            entityKey: `doc:${documentId}`, workspaceId, entityType: "document",
            documentId, nodeId: null, spaceId: nextSpaceId, kind: current.kind, title: nextTitle, body: nextText,
          });
          if (nextSpaceId !== current.spaceId) {
            this.ctx.sqlite
              .query("UPDATE search_fts SET space_id = ? WHERE document_id = ? AND entity_type = 'outline_node'")
              .run(nextSpaceId, documentId);
          }
          if (
            mdChanged ||
            input.tags !== undefined ||
            input.spaceId !== undefined ||
            input.properties !== undefined
          ) {
            syncDocumentTasksForDocumentSync(this.ctx, workspaceId, documentId);
          }
        }
        return mapDocumentRow(requireDocumentSync(this.ctx, workspaceId, documentId), savedTags);
      }),
    );
  }

  trashDocument(workspaceId: string, documentId: string): Promise<DocumentRecord> {
    return syncToPromise(() =>
      this.ctx.tx.runSyncAtomic(() => {
        const current = requireDocumentSync(this.ctx, workspaceId, documentId);
        const ts = current.trashedAt ?? nowIso();
        this.ctx.db
          .update(documents)
          .set({ trashedAt: ts, updatedAt: ts })
          .where(and(eq(documents.workspaceId, workspaceId), eq(documents.id, documentId)))
          .run();
        deleteDocumentFtsSync(this.ctx.sqlite, documentId);
        deleteDocumentTasksSync(this.ctx, documentId);
        const tags = loadTagsForDocumentsSync(this.ctx.db, [documentId]).get(documentId) ?? [];
        return mapDocumentRow({ ...current, trashedAt: ts, updatedAt: ts }, tags);
      }),
    );
  }

  restoreDocument(workspaceId: string, documentId: string): Promise<DocumentRecord> {
    return syncToPromise(() =>
      this.ctx.tx.runSyncAtomic(() => {
        const current = requireDocumentSync(this.ctx, workspaceId, documentId);
        if (current.dailyDate !== null && current.trashedAt !== null) {
          const colliding = this.ctx.db
            .select({ id: documents.id })
            .from(documents)
            .where(
              and(eq(documents.workspaceId, workspaceId), eq(documents.dailyDate, current.dailyDate), isNull(documents.trashedAt)),
            )
            .get();
          if (colliding && colliding.id !== documentId) {
            throw new InkadeError("CONFLICT", `An active daily outline for "${current.dailyDate}" already exists`);
          }
        }
        const ts = nowIso();
        this.ctx.db
          .update(documents)
          .set({ trashedAt: null, updatedAt: ts })
          .where(and(eq(documents.workspaceId, workspaceId), eq(documents.id, documentId)))
          .run();
        upsertFtsEntrySync(this.ctx.sqlite, {
          entityKey: `doc:${documentId}`, workspaceId, entityType: "document", documentId, nodeId: null,
          spaceId: current.spaceId, kind: current.kind, title: current.title, body: current.contentText,
        });
        restoreActiveOutlineNodesFtsSync(this.ctx, workspaceId, current);
        syncDocumentTasksForDocumentSync(this.ctx, workspaceId, documentId);
        const tags = loadTagsForDocumentsSync(this.ctx.db, [documentId]).get(documentId) ?? [];
        return mapDocumentRow({ ...current, trashedAt: null, updatedAt: ts }, tags);
      }),
    );
  }

  hardDeleteDocument(workspaceId: string, documentId: string): Promise<void> {
    return syncToPromise(() =>
      this.ctx.tx.runSyncAtomic(() => {
        requireDocumentSync(this.ctx, workspaceId, documentId);
        deleteDocumentFtsSync(this.ctx.sqlite, documentId);
        this.ctx.db.delete(documents).where(and(eq(documents.workspaceId, workspaceId), eq(documents.id, documentId))).run();
      }),
    );
  }

  markDocumentAgentUpdateRead(workspaceId: string, documentId: string): Promise<DocumentRecord> {
    return this.setDocumentUnreadAgentUpdate(workspaceId, documentId, false);
  }

  setDocumentUnreadAgentUpdate(
    workspaceId: string,
    documentId: string,
    unread: boolean,
  ): Promise<DocumentRecord> {
    return syncToPromise(() => {
      const current = requireDocumentSync(this.ctx, workspaceId, documentId);
      this.ctx.db
        .update(documents)
        .set({ unreadAgentUpdate: unread })
        .where(and(eq(documents.workspaceId, workspaceId), eq(documents.id, documentId)))
        .run();
      const tags = loadTagsForDocumentsSync(this.ctx.db, [documentId]).get(documentId) ?? [];
      return mapDocumentRow({ ...current, unreadAgentUpdate: unread }, tags);
    });
  }

  updateDocumentContentDirect(workspaceId: string, documentId: string, patch: UpdateDocumentContentDirectInput): Promise<void> {
    return syncToPromise(() => {
      this.ctx.db
        .update(documents)
        .set({ contentMarkdown: patch.contentMarkdown, contentText: patch.contentText, excerpt: patch.excerpt, version: patch.version, updatedAt: patch.updatedAt })
        .where(and(eq(documents.workspaceId, workspaceId), eq(documents.id, documentId)))
        .run();
      syncDocumentTasksForDocumentSync(this.ctx, workspaceId, documentId);
    });
  }

  bumpDocumentVersion(documentId: string, version: number, updatedAt: string, actorType?: ActorType): Promise<void> {
    return syncToPromise(() => {
      this.ctx.db
        .update(documents)
        .set({ version, updatedAt, ...(actorType !== undefined ? { lastEditedByType: actorType } : {}) })
        .where(eq(documents.id, documentId))
        .run();
    });
  }

  touchDocumentUpdatedAt(documentId: string, updatedAt: string, actorType?: ActorType): Promise<void> {
    return syncToPromise(() => {
      this.ctx.db
        .update(documents)
        .set({ updatedAt, ...(actorType !== undefined ? { lastEditedByType: actorType } : {}) })
        .where(eq(documents.id, documentId))
        .run();
    });
  }

  addDocumentTags(documentId: string, extraTags: readonly string[]): Promise<readonly string[]> {
    return syncToPromise(() => addDocumentTagsSync(this.ctx.sqlite, this.ctx.db, documentId, extraTags));
  }

  listTagsForDocuments(documentIds: readonly string[]): Promise<ReadonlyMap<string, readonly string[]>> {
    return syncToPromise(() => loadTagsForDocumentsSync(this.ctx.db, documentIds));
  }
}
