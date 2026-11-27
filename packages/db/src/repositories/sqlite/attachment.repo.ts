import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  artifactCapabilitiesArraySchema,
  artifactCapabilitiesSchema,
  asAttachmentId,
  asDocumentArtifactId,
  asDocumentAssetId,
  asDocumentId,
  asWorkspaceId,
  createId,
  ID_PREFIXES,
  InkadeError,
  parseJsonWithSchema,
  pdfAnnotationArraySchema,
  pdfExtractedPageArraySchema,
  type AssetKind,
  type AttachmentId,
  type AttachmentRecord,
  type DocumentArtifact,
  type DocumentArtifactId,
  type DocumentArtifactSummary,
  type DocumentAsset,
  type DocumentAssetId,
  type DocumentId,
} from "@inkade/core";
import {
  attachments,
  documentArtifacts,
  documentAssets,
  documents,
} from "../../schema/sqlite.ts";
import type {
  AttachmentRepo,
  CreateAttachmentInput,
  CreateDocumentArtifactRepoInput,
  CreateDocumentAssetInput,
  ListAttachmentsOptions,
  UpdateDocumentArtifactRepoPatch,
  UpdateDocumentAssetPatch,
} from "../ports/attachment.port.ts";
import { nowIso, syncToPromise, type SqliteRepoContext } from "./helpers.ts";
import { mapAttachmentRow } from "./mappers.ts";

function mapDocumentAssetRow(
  row: typeof documentAssets.$inferSelect,
  att?: typeof attachments.$inferSelect | null,
): DocumentAsset {
  return {
    id: asDocumentAssetId(row.id),
    workspaceId: asWorkspaceId(row.workspaceId),
    attachmentId: asAttachmentId(row.attachmentId),
    companionDocumentId: row.companionDocumentId ? asDocumentId(row.companionDocumentId) : null,
    assetKind: row.assetKind === "audio" ? "audio" : "pdf",
    pageCount: row.pageCount,
    annotations: parseJsonWithSchema(row.annotationsJson, pdfAnnotationArraySchema, []),
    extractedPages: parseJsonWithSchema(
      row.extractedPagesJson,
      pdfExtractedPageArraySchema,
      [],
    ),
    ...(att
      ? {
          filename: att.filename,
          mimeType: att.mimeType,
          byteSize: att.byteSize,
          downloadUrl: `/api/v1/attachments/${att.id}/download`,
        }
      : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapDocumentArtifactRow(
  row: typeof documentArtifacts.$inferSelect,
): DocumentArtifact {
  return {
    id: asDocumentArtifactId(row.id),
    workspaceId: asWorkspaceId(row.workspaceId),
    documentId: asDocumentId(row.documentId),
    title: row.title,
    htmlSource: row.htmlSource,
    capabilities: parseJsonWithSchema(row.capabilitiesJson, artifactCapabilitiesSchema, {}),
    sources: parseJsonWithSchema(row.sourcesJson, artifactCapabilitiesArraySchema, []),
    fallbackMarkdown: row.fallbackMarkdown,
    heightPx: row.heightPx,
    sha256: row.sha256,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

function mapDocumentArtifactSummaryRow(row: {
  readonly id: string;
  readonly workspaceId: string;
  readonly documentId: string;
  readonly title: string;
  readonly capabilitiesJson: string;
  readonly sourcesJson: string;
  readonly fallbackMarkdown: string;
  readonly heightPx: number;
  readonly sha256: string;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}): DocumentArtifactSummary {
  return {
    id: asDocumentArtifactId(row.id),
    workspaceId: asWorkspaceId(row.workspaceId),
    documentId: asDocumentId(row.documentId),
    title: row.title,
    capabilities: parseJsonWithSchema(row.capabilitiesJson, artifactCapabilitiesSchema, {}),
    sources: parseJsonWithSchema(row.sourcesJson, artifactCapabilitiesArraySchema, []),
    fallbackMarkdown: row.fallbackMarkdown,
    heightPx: row.heightPx,
    sha256: row.sha256,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class SqliteAttachmentRepo implements AttachmentRepo {
  constructor(private readonly ctx: SqliteRepoContext) {}

  createAttachment(
    workspaceId: string,
    input: CreateAttachmentInput,
  ): Promise<AttachmentRecord> {
    return syncToPromise(() => {
      const attId = input.id ?? createId(ID_PREFIXES.attachment);
      const ts = nowIso();
      const row: typeof attachments.$inferSelect = {
        id: attId,
        workspaceId,
        documentId: input.documentId ?? null,
        mimeType: input.mimeType,
        byteSize: input.byteSize,
        sha256: input.sha256,
        storageKey: input.storageKey,
        filename: input.filename,
        createdAt: ts,
      };
      this.ctx.db.insert(attachments).values(row).run();
      return mapAttachmentRow(row);
    });
  }

  getAttachmentById(
    workspaceId: string,
    attachmentId: string,
  ): Promise<AttachmentRecord | null> {
    return syncToPromise(() => {
      const row = this.ctx.db
        .select()
        .from(attachments)
        .where(and(eq(attachments.workspaceId, workspaceId), eq(attachments.id, attachmentId)))
        .get();
      return row ? mapAttachmentRow(row) : null;
    });
  }

  listAttachments(
    workspaceId: string,
    options?: ListAttachmentsOptions,
  ): Promise<readonly AttachmentRecord[]> {
    return syncToPromise(() => {
      const conditions = [eq(attachments.workspaceId, workspaceId)];
      if (options?.documentId) {
        conditions.push(eq(attachments.documentId, options.documentId));
      }
      if (options?.orphanOnly) {
        conditions.push(isNull(attachments.documentId));
      }
      const rows = this.ctx.db
        .select()
        .from(attachments)
        .where(and(...conditions))
        .orderBy(desc(attachments.createdAt))
        .all();
      return rows.map(mapAttachmentRow);
    });
  }

  listAttachmentsByDocument(
    workspaceId: string,
    documentId: string,
  ): Promise<readonly AttachmentRecord[]> {
    return this.listAttachments(workspaceId, { documentId: asDocumentId(documentId) });
  }

  deleteAttachment(workspaceId: string, attachmentId: string): Promise<void> {
    return syncToPromise(() => {
      const existing = this.ctx.db
        .select({ id: attachments.id })
        .from(attachments)
        .where(and(eq(attachments.workspaceId, workspaceId), eq(attachments.id, attachmentId)))
        .get();
      if (!existing) {
        throw new InkadeError("NOT_FOUND", `Attachment "${attachmentId}" not found`);
      }
      this.ctx.db.delete(attachments).where(eq(attachments.id, attachmentId)).run();
    });
  }

  findOrphanAttachments(workspaceId: string): Promise<readonly AttachmentRecord[]> {
    return syncToPromise(() => {
      const candidates = this.ctx.db
        .select()
        .from(attachments)
        .where(and(eq(attachments.workspaceId, workspaceId), isNull(attachments.documentId)))
        .all();
      if (candidates.length === 0) return [];

      const activeDocTexts = this.ctx.db
        .select({ contentMarkdown: documents.contentMarkdown })
        .from(documents)
        .where(and(eq(documents.workspaceId, workspaceId), isNull(documents.trashedAt)))
        .all();
      const activeNodeTexts = this.ctx.sqlite
        .query<{ content_markdown: string; note_markdown: string }, [string]>(
          `SELECT n.content_markdown, COALESCE(n.note_markdown, '') AS note_markdown
           FROM outline_nodes n
           INNER JOIN documents d ON n.document_id = d.id
           WHERE d.workspace_id = ? AND d.trashed_at IS NULL AND n.deleted_at IS NULL`,
        )
        .all(workspaceId);

      const corpus = [
        ...activeDocTexts.map((d) => d.contentMarkdown),
        ...activeNodeTexts.map((n) => `${n.content_markdown}\n${n.note_markdown}`),
      ].join("\n");

      return candidates.filter((att) => !corpus.includes(att.id)).map(mapAttachmentRow);
    });
  }

  createDocumentAsset(
    workspaceId: string,
    input: CreateDocumentAssetInput,
  ): Promise<DocumentAsset> {
    return syncToPromise(() => {
      const att = this.ctx.db
        .select()
        .from(attachments)
        .where(
          and(
            eq(attachments.workspaceId, workspaceId),
            eq(attachments.id, input.attachmentId),
          ),
        )
        .get();
      if (!att) {
        throw new InkadeError("NOT_FOUND", `Attachment "${input.attachmentId}" not found`);
      }

      const id = input.id ?? createId(ID_PREFIXES.documentAsset);
      const ts = nowIso();
      const row: typeof documentAssets.$inferSelect = {
        id,
        workspaceId,
        attachmentId: input.attachmentId,
        companionDocumentId: input.companionDocumentId ?? null,
        assetKind: input.assetKind,
        pageCount: input.pageCount ?? 0,
        annotationsJson: JSON.stringify(input.annotations ?? []),
        extractedPagesJson: JSON.stringify(input.extractedPages ?? []),
        createdAt: ts,
        updatedAt: ts,
      };
      this.ctx.db.insert(documentAssets).values(row).run();
      return mapDocumentAssetRow(row, att);
    });
  }

  private hydrateDocumentAssetRow(
    row: typeof documentAssets.$inferSelect | undefined,
  ): DocumentAsset | null {
    if (!row) return null;
    const att = this.ctx.db
      .select()
      .from(attachments)
      .where(eq(attachments.id, row.attachmentId))
      .get();
    return mapDocumentAssetRow(row, att ?? null);
  }

  getDocumentAssetById(
    workspaceId: string,
    assetId: DocumentAssetId | string,
  ): Promise<DocumentAsset | null> {
    return syncToPromise(() => {
      const row = this.ctx.db
        .select()
        .from(documentAssets)
        .where(
          and(eq(documentAssets.workspaceId, workspaceId), eq(documentAssets.id, assetId)),
        )
        .get();
      return this.hydrateDocumentAssetRow(row);
    });
  }

  getDocumentAssetByDocumentId(
    workspaceId: string,
    documentId: DocumentId | string,
  ): Promise<DocumentAsset | null> {
    return syncToPromise(() => {
      const row = this.ctx.db
        .select()
        .from(documentAssets)
        .where(
          and(
            eq(documentAssets.workspaceId, workspaceId),
            eq(documentAssets.companionDocumentId, documentId),
          ),
        )
        .orderBy(desc(documentAssets.updatedAt))
        .get();
      return this.hydrateDocumentAssetRow(row);
    });
  }

  getDocumentAssetByAttachmentId(
    workspaceId: string,
    attachmentId: AttachmentId | string,
  ): Promise<DocumentAsset | null> {
    return syncToPromise(() => {
      const row = this.ctx.db
        .select()
        .from(documentAssets)
        .where(
          and(
            eq(documentAssets.workspaceId, workspaceId),
            eq(documentAssets.attachmentId, attachmentId),
          ),
        )
        .orderBy(desc(documentAssets.updatedAt))
        .get();
      return this.hydrateDocumentAssetRow(row);
    });
  }

  listDocumentAssets(
    workspaceId: string,
    options?: { readonly assetKind?: AssetKind | undefined },
  ): Promise<readonly DocumentAsset[]> {
    return syncToPromise(() => {
      const conds = [eq(documentAssets.workspaceId, workspaceId)];
      if (options?.assetKind) {
        conds.push(eq(documentAssets.assetKind, options.assetKind));
      }
      const rows = this.ctx.db
        .select()
        .from(documentAssets)
        .where(and(...conds))
        .orderBy(desc(documentAssets.updatedAt))
        .all();
      if (rows.length === 0) return [];
      const attIds = [...new Set(rows.map((r) => r.attachmentId))];
      const attMap = new Map(
        this.ctx.db
          .select()
          .from(attachments)
          .where(inArray(attachments.id, attIds))
          .all()
          .map((a) => [a.id, a]),
      );
      return rows.map((row) => mapDocumentAssetRow(row, attMap.get(row.attachmentId) ?? null));
    });
  }

  updateDocumentAsset(
    workspaceId: string,
    assetId: DocumentAssetId | string,
    patch: UpdateDocumentAssetPatch,
  ): Promise<DocumentAsset> {
    return syncToPromise(() => {
      const existing = this.ctx.db
        .select()
        .from(documentAssets)
        .where(
          and(eq(documentAssets.workspaceId, workspaceId), eq(documentAssets.id, assetId)),
        )
        .get();
      if (!existing) {
        throw new InkadeError("NOT_FOUND", `Document asset "${assetId}" not found`);
      }
      const ts = nowIso();
      const next: typeof documentAssets.$inferSelect = {
        ...existing,
        companionDocumentId:
          patch.companionDocumentId !== undefined
            ? patch.companionDocumentId
            : existing.companionDocumentId,
        pageCount: patch.pageCount !== undefined ? patch.pageCount : existing.pageCount,
        annotationsJson:
          patch.annotations !== undefined
            ? JSON.stringify(patch.annotations)
            : existing.annotationsJson,
        extractedPagesJson:
          patch.extractedPages !== undefined
            ? JSON.stringify(patch.extractedPages)
            : existing.extractedPagesJson,
        updatedAt: ts,
      };
      this.ctx.db
        .update(documentAssets)
        .set({
          companionDocumentId: next.companionDocumentId,
          pageCount: next.pageCount,
          annotationsJson: next.annotationsJson,
          extractedPagesJson: next.extractedPagesJson,
          updatedAt: next.updatedAt,
        })
        .where(eq(documentAssets.id, existing.id))
        .run();
      return this.hydrateDocumentAssetRow(next)!;
    });
  }

  deleteDocumentAsset(
    workspaceId: string,
    assetId: DocumentAssetId | string,
  ): Promise<void> {
    return syncToPromise(() => {
      const existing = this.ctx.db
        .select({ id: documentAssets.id })
        .from(documentAssets)
        .where(
          and(eq(documentAssets.workspaceId, workspaceId), eq(documentAssets.id, assetId)),
        )
        .get();
      if (!existing) {
        throw new InkadeError("NOT_FOUND", `Document asset "${assetId}" not found`);
      }
      this.ctx.db.delete(documentAssets).where(eq(documentAssets.id, existing.id)).run();
    });
  }

  createDocumentArtifact(
    workspaceId: string,
    input: CreateDocumentArtifactRepoInput,
  ): Promise<DocumentArtifact> {
    return syncToPromise(() => {
      const id = input.id ?? createId(ID_PREFIXES.documentArtifact);
      const ts = nowIso();
      const row: typeof documentArtifacts.$inferSelect = {
        id,
        workspaceId,
        documentId: input.documentId,
        title: input.title,
        htmlSource: input.htmlSource,
        capabilitiesJson: JSON.stringify(input.capabilities ?? {}),
        sourcesJson: JSON.stringify(input.sources ?? []),
        fallbackMarkdown: input.fallbackMarkdown,
        heightPx: input.heightPx,
        sha256: input.sha256,
        version: 1,
        createdAt: ts,
        updatedAt: ts,
        deletedAt: null,
      };
      this.ctx.db.insert(documentArtifacts).values(row).run();
      return mapDocumentArtifactRow(row);
    });
  }

  getDocumentArtifactById(
    workspaceId: string,
    artifactId: DocumentArtifactId | string,
    options?: { readonly includeDeleted?: boolean | undefined },
  ): Promise<DocumentArtifact | null> {
    return syncToPromise(() => {
      const conds = [
        eq(documentArtifacts.workspaceId, workspaceId),
        eq(documentArtifacts.id, artifactId),
      ];
      if (!options?.includeDeleted) {
        conds.push(isNull(documentArtifacts.deletedAt));
      }
      const row = this.ctx.db
        .select()
        .from(documentArtifacts)
        .where(and(...conds))
        .get();
      return row ? mapDocumentArtifactRow(row) : null;
    });
  }

  listDocumentArtifactsByDocument(
    workspaceId: string,
    documentId: DocumentId | string,
    options?: { readonly includeDeleted?: boolean | undefined },
  ): Promise<readonly DocumentArtifactSummary[]> {
    return syncToPromise(() => {
      const conds = [
        eq(documentArtifacts.workspaceId, workspaceId),
        eq(documentArtifacts.documentId, documentId),
      ];
      if (!options?.includeDeleted) {
        conds.push(isNull(documentArtifacts.deletedAt));
      }
      const rows = this.ctx.db
        .select({
          id: documentArtifacts.id,
          workspaceId: documentArtifacts.workspaceId,
          documentId: documentArtifacts.documentId,
          title: documentArtifacts.title,
          capabilitiesJson: documentArtifacts.capabilitiesJson,
          sourcesJson: documentArtifacts.sourcesJson,
          fallbackMarkdown: documentArtifacts.fallbackMarkdown,
          heightPx: documentArtifacts.heightPx,
          sha256: documentArtifacts.sha256,
          version: documentArtifacts.version,
          createdAt: documentArtifacts.createdAt,
          updatedAt: documentArtifacts.updatedAt,
        })
        .from(documentArtifacts)
        .where(and(...conds))
        .orderBy(desc(documentArtifacts.updatedAt))
        .all();
      return rows.map(mapDocumentArtifactSummaryRow);
    });
  }

  updateDocumentArtifact(
    workspaceId: string,
    artifactId: DocumentArtifactId | string,
    patch: UpdateDocumentArtifactRepoPatch,
  ): Promise<DocumentArtifact> {
    return syncToPromise(() => {
      const existing = this.ctx.db
        .select()
        .from(documentArtifacts)
        .where(
          and(
            eq(documentArtifacts.workspaceId, workspaceId),
            eq(documentArtifacts.id, artifactId),
            isNull(documentArtifacts.deletedAt),
          ),
        )
        .get();
      if (!existing) {
        throw new InkadeError("NOT_FOUND", `Document artifact "${artifactId}" not found`);
      }
      const ts = patch.updatedAt ?? nowIso();
      const next: typeof documentArtifacts.$inferSelect = {
        ...existing,
        title: patch.title !== undefined ? patch.title : existing.title,
        htmlSource: patch.htmlSource !== undefined ? patch.htmlSource : existing.htmlSource,
        capabilitiesJson:
          patch.capabilities !== undefined
            ? JSON.stringify(patch.capabilities)
            : existing.capabilitiesJson,
        sourcesJson:
          patch.sources !== undefined ? JSON.stringify(patch.sources) : existing.sourcesJson,
        fallbackMarkdown:
          patch.fallbackMarkdown !== undefined
            ? patch.fallbackMarkdown
            : existing.fallbackMarkdown,
        heightPx: patch.heightPx !== undefined ? patch.heightPx : existing.heightPx,
        sha256: patch.sha256 !== undefined ? patch.sha256 : existing.sha256,
        version: patch.version !== undefined ? patch.version : existing.version + 1,
        updatedAt: ts,
      };
      this.ctx.db
        .update(documentArtifacts)
        .set({
          title: next.title,
          htmlSource: next.htmlSource,
          capabilitiesJson: next.capabilitiesJson,
          sourcesJson: next.sourcesJson,
          fallbackMarkdown: next.fallbackMarkdown,
          heightPx: next.heightPx,
          sha256: next.sha256,
          version: next.version,
          updatedAt: next.updatedAt,
        })
        .where(eq(documentArtifacts.id, existing.id))
        .run();
      return mapDocumentArtifactRow(next);
    });
  }

  softDeleteDocumentArtifact(
    workspaceId: string,
    artifactId: DocumentArtifactId | string,
  ): Promise<DocumentArtifact> {
    return syncToPromise(() => {
      const existing = this.ctx.db
        .select()
        .from(documentArtifacts)
        .where(
          and(
            eq(documentArtifacts.workspaceId, workspaceId),
            eq(documentArtifacts.id, artifactId),
            isNull(documentArtifacts.deletedAt),
          ),
        )
        .get();
      if (!existing) {
        throw new InkadeError("NOT_FOUND", `Document artifact "${artifactId}" not found`);
      }
      const ts = nowIso();
      const next: typeof documentArtifacts.$inferSelect = {
        ...existing,
        deletedAt: ts,
        updatedAt: ts,
      };
      this.ctx.db
        .update(documentArtifacts)
        .set({
          deletedAt: ts,
          updatedAt: ts,
        })
        .where(eq(documentArtifacts.id, existing.id))
        .run();
      return mapDocumentArtifactRow(next);
    });
  }
}
