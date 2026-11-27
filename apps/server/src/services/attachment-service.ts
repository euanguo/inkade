import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, resolve, sep } from "node:path";
import {
  createId,
  evaluateScopeAccess,
  ID_PREFIXES,
  InkadeError,
  type AttachmentId,
  type AttachmentRecord,
  type DocumentId,
  type DocumentRecord,
} from "@inkade/core";
import type {
  AttachmentRepo,
  DocumentRepo,
  ListAttachmentsOptions,
  SpaceRepo,
} from "@inkade/db";
import { sha256Hex } from "../auth/tokens.ts";
import type { WorkspaceSpacesCache } from "../cache/workspace-spaces-cache.ts";
import type { Principal } from "../types.ts";
import { assertAdminPrincipal, assertScope, getAllWorkspaceSpaces } from "./scope-guard.ts";

export interface UploadAttachmentInput {
  readonly documentId?: DocumentId | null | undefined;
  readonly filename: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
}

export interface UploadAttachmentResult {
  readonly attachment: AttachmentRecord;
  readonly downloadUrl: string;
}

export interface AttachmentUploadSpec {
  readonly uploadUrl: string;
  readonly method: "POST";
  readonly contentTypes: readonly string[];
  readonly documentId: DocumentId | null;
  readonly filename: string;
  readonly mimeType: string;
}

export class AttachmentService {
  private readonly attachmentsRoot: string;

  constructor(
    private readonly attachmentRepo: AttachmentRepo,
    private readonly documentRepo: DocumentRepo,
    private readonly spaceRepo: SpaceRepo,
    dataDir: string,
    private readonly spacesCache?: WorkspaceSpacesCache,
  ) {
    this.attachmentsRoot = resolve(dataDir, "attachments");
  }

  private resolveSafeBlobPath(storageKey: string): string {
    const target = resolve(this.attachmentsRoot, storageKey);
    const rootWithSep = this.attachmentsRoot.endsWith(sep)
      ? this.attachmentsRoot
      : `${this.attachmentsRoot}${sep}`;
    if (!target.startsWith(rootWithSep)) {
      throw new InkadeError("VALIDATION_ERROR", "Invalid attachment storage key");
    }
    return target;
  }

  private async assertUploadAuthorized(
    principal: Principal,
    documentId: DocumentId | null | undefined,
  ): Promise<void> {
    if (documentId) {
      const [doc, allSpaces] = await Promise.all([
        this.documentRepo.getDocumentById(principal.workspaceId, documentId),
        getAllWorkspaceSpaces(this.spacesCache ?? this.spaceRepo, principal.workspaceId),
      ]);
      if (!doc || doc.trashedAt !== null) {
        throw new InkadeError("NOT_FOUND", `Document "${documentId}" not found`);
      }
      assertScope(
        principal.scope,
        "append",
        { spaceId: doc.spaceId, kind: doc.kind, tags: doc.tags },
        allSpaces,
      );
      return;
    }

    if (principal.scope.permission === "read") {
      throw new InkadeError("FORBIDDEN", 'token permission "read" cannot upload attachments');
    }
  }

  async createUploadSpec(
    principal: Principal,
    input: {
      readonly documentId?: DocumentId | null | undefined;
      readonly filename: string;
      readonly mimeType?: string | undefined;
    },
  ): Promise<AttachmentUploadSpec> {
    await this.assertUploadAuthorized(principal, input.documentId);
    const cleanFilename = basename(input.filename.trim() || "attachment.bin");
    return {
      uploadUrl: "/api/v1/attachments",
      method: "POST",
      contentTypes: ["multipart/form-data", "application/json"],
      documentId: input.documentId ?? null,
      filename: cleanFilename,
      mimeType: input.mimeType?.trim() || "application/octet-stream",
    };
  }

  async uploadAttachment(
    principal: Principal,
    input: UploadAttachmentInput,
  ): Promise<UploadAttachmentResult> {
    await this.assertUploadAuthorized(principal, input.documentId);

    const attachmentId = createId(ID_PREFIXES.attachment);
    const safeFilename = basename(input.filename.trim() || "attachment.bin");
    const mimeType = input.mimeType.trim() || "application/octet-stream";
    const sha256 = await sha256Hex(input.bytes);
    const storageKey = `${principal.workspaceId}/${attachmentId}`;
    const blobPath = this.resolveSafeBlobPath(storageKey);

    await mkdir(dirname(blobPath), { recursive: true });
    await writeFile(blobPath, input.bytes);

    const attachment = await this.attachmentRepo.createAttachment(principal.workspaceId, {
      id: attachmentId,
      documentId: input.documentId ?? null,
      mimeType,
      byteSize: input.bytes.byteLength,
      sha256,
      storageKey,
      filename: safeFilename,
    });

    return {
      attachment,
      downloadUrl: `/api/v1/attachments/${attachment.id}/download`,
    };
  }

  async getAttachment(principal: Principal, attachmentId: AttachmentId): Promise<AttachmentRecord> {
    const attachment = await this.attachmentRepo.getAttachmentById(
      principal.workspaceId,
      attachmentId,
    );
    if (!attachment) {
      throw new InkadeError("NOT_FOUND", `Attachment "${attachmentId}" not found`);
    }

    if (attachment.documentId) {
      const [doc, allSpaces] = await Promise.all([
        this.documentRepo.getDocumentById(principal.workspaceId, attachment.documentId),
        getAllWorkspaceSpaces(this.spacesCache ?? this.spaceRepo, principal.workspaceId),
      ]);
      if (doc) {
        assertScope(
          principal.scope,
          "read",
          { spaceId: doc.spaceId, kind: doc.kind, tags: doc.tags },
          allSpaces,
        );
      }
    }

    return attachment;
  }

  async downloadAttachment(
    principal: Principal,
    attachmentId: AttachmentId,
  ): Promise<{ readonly attachment: AttachmentRecord; readonly bytes: Uint8Array }> {
    const attachment = await this.getAttachment(principal, attachmentId);
    const blobPath = this.resolveSafeBlobPath(attachment.storageKey);

    let data: Buffer;
    try {
      data = await readFile(blobPath);
    } catch {
      throw new InkadeError("NOT_FOUND", `Attachment blob "${attachmentId}" is missing on disk`);
    }

    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const actualHash = await sha256Hex(bytes);
    if (actualHash !== attachment.sha256) {
      throw new InkadeError("INTERNAL_ERROR", `Attachment "${attachmentId}" failed SHA-256 check`);
    }

    return { attachment, bytes };
  }

  async listAttachments(
    principal: Principal,
    options?: ListAttachmentsOptions,
  ): Promise<readonly AttachmentRecord[]> {
    const [allSpaces, items] = await Promise.all([
      getAllWorkspaceSpaces(this.spacesCache ?? this.spaceRepo, principal.workspaceId),
      this.attachmentRepo.listAttachments(principal.workspaceId, options),
    ]);
    if (items.length === 0) return [];

    const docCache = new Map<DocumentId, DocumentRecord | null>();
    const docIds = [
      ...new Set(items.map((a) => a.documentId).filter((id): id is DocumentId => Boolean(id))),
    ];
    await Promise.all(
      docIds.map(async (docId) => {
        docCache.set(docId, await this.documentRepo.getDocumentById(principal.workspaceId, docId));
      }),
    );

    const isAdmin =
      principal.scope.permission === "admin" && principal.scope.spaceIds === "*";

    return items.filter((att) => {
      if (!att.documentId) {
        return isAdmin;
      }
      const doc = docCache.get(att.documentId);
      if (!doc || doc.trashedAt !== null) {
        return isAdmin;
      }
      return evaluateScopeAccess(
        principal.scope,
        "read",
        { spaceId: doc.spaceId, kind: doc.kind, tags: doc.tags },
        allSpaces,
      ).allowed;
    });
  }

  async cleanupOrphans(principal: Principal): Promise<{
    readonly deletedCount: number;
    readonly freedBytes: number;
    readonly deletedIds: readonly AttachmentId[];
  }> {
    const allSpaces = await getAllWorkspaceSpaces(
      this.spacesCache ?? this.spaceRepo,
      principal.workspaceId,
    );
    assertAdminPrincipal(principal, allSpaces);

    const orphans = await this.attachmentRepo.findOrphanAttachments(principal.workspaceId);
    const deletedIds: AttachmentId[] = [];
    let freedBytes = 0;

    for (const att of orphans) {
      const blobPath = this.resolveSafeBlobPath(att.storageKey);
      await rm(blobPath, { force: true }).catch(() => {});
      await this.attachmentRepo.deleteAttachment(principal.workspaceId, att.id);
      deletedIds.push(att.id);
      freedBytes += att.byteSize;
    }

    return {
      deletedCount: deletedIds.length,
      freedBytes,
      deletedIds,
    };
  }
}
