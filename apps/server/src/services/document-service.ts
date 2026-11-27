import {
  buildCompactDiffPreview,
  buildScaffoldMarkdown,
  computeRevisionDiff,
  evaluateScopeAccess,
  extractExcerpt,
  extractInlineTags,
  extractPendingBlocks,
  InkadeError,
  isSystemInternalDocument,
  markdownToPlainText,
  patchMarkdownSection,
  replacePendingBlock,
  resolveAllowedSpaceIds,
  rewriteWikilinksTitle,
  scaffoldDocumentInputSchema,
  validatePropertiesAgainstSchema,
  type CreateDocumentInput,
  type DocumentId,
  type DocumentLink,
  type DocumentRecord,
  type DocumentRevision,
  type DocumentSummary,
  type OutlineNode,
  type OutlineNodeId,
  type PatchDocumentSectionInput,
  type PropertySchemaValidationResult,
  type RevisionDiffResult,
  type RevisionId,
  type ScaffoldDocumentInput,
  type SpaceId,
  type UpdateDocumentInput,
  type WorkspaceId,
} from "@inkade/core";
import type {
  DocumentRepo,
  ListDocumentsOptions,
  OutlineRepo,
  OutlineRevisionRestoreResult,
  RevisionLinkRepo,
  SearchConfigRepo,
  SpaceRepo,
  TransactionRunner,
} from "@inkade/db";
import type { WorkspaceSpacesCache } from "../cache/workspace-spaces-cache.ts";
import type { SseHub } from "../realtime/sse-hub.ts";
import type { Principal } from "../types.ts";
import type { AuditService } from "./audit-service.ts";
import { buildSubtreeMarkdown } from "./document-promote.ts";
import {
  assertScope,
  getAllWorkspaceSpaces,
  resolveOutlineNodeDocumentId,
} from "./scope-guard.ts";
import type { WakeService } from "./wake-service.ts";

export interface DocumentServiceRepos {
  readonly tx: TransactionRunner;
  readonly documentRepo: DocumentRepo;
  readonly outlineRepo: OutlineRepo;
  readonly revisionLinkRepo: RevisionLinkRepo;
  readonly spaceRepo: SpaceRepo;
  readonly searchConfigRepo: SearchConfigRepo;
  readonly spacesCache?: WorkspaceSpacesCache | undefined;
}

export type RestoreOutlineRevisionSnapshotFn = (
  principal: Principal,
  documentId: DocumentId,
  targetRevisionId: RevisionId,
  changeSummary?: string,
) => Promise<OutlineRevisionRestoreResult>;

export interface PromoteOutlineSubtreeInput {
  readonly documentId?: DocumentId | undefined;
  readonly targetSpaceId: SpaceId;
  readonly title?: string | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly keepLinkInNode?: boolean | undefined;
}

export interface PromoteOutlineSubtreeResult {
  readonly article: DocumentRecord;
  readonly updatedNode: OutlineNode | null;
}

export class DocumentService {
  constructor(
    private readonly repos: DocumentServiceRepos,
    private readonly sseHub: SseHub,
    private readonly onDocumentChanged?: (workspaceId: WorkspaceId, documentId: DocumentId) => void,
    private readonly auditService?: AuditService,
    private readonly restoreOutlineRevisionSnapshot?: RestoreOutlineRevisionSnapshotFn,
    private readonly wakeService?: WakeService,
  ) {}

  private async normalizePropertiesInput(
    workspaceId: WorkspaceId,
    spaceId: SpaceId,
    rawProperties: Readonly<Record<string, unknown>> | null | undefined,
  ): Promise<Record<string, unknown> | null | undefined> {
    if (rawProperties === undefined) return undefined;
    if (rawProperties === null) return null;
    const schema = await this.repos.spaceRepo.getSpacePropertySchema(workspaceId, { spaceId });
    if (!schema || schema.fields.length === 0) {
      return { ...rawProperties };
    }
    const validation = validatePropertiesAgainstSchema(rawProperties, schema.fields);
    if (!validation.valid) {
      throw new InkadeError(
        "VALIDATION_ERROR",
        validation.errors.map((err) => err.message).join("; "),
        { errors: validation.errors },
      );
    }
    return validation.normalizedProperties;
  }

  async getSchemaValidationHints(
    principal: Principal,
    spaceId: SpaceId,
    properties: Readonly<Record<string, unknown>> | null | undefined,
  ): Promise<PropertySchemaValidationResult | null> {
    const schema = await this.repos.spaceRepo.getSpacePropertySchema(principal.workspaceId, {
      spaceId,
    });
    if (!schema || schema.fields.length === 0) {
      return null;
    }
    const validation = validatePropertiesAgainstSchema(properties, schema.fields);
    if (validation.warnings.length === 0 && validation.missingRequired.length === 0) {
      return null;
    }
    return validation;
  }

  async listDocuments(
    principal: Principal,
    options?: ListDocumentsOptions,
  ): Promise<readonly DocumentSummary[]> {
    const allSpaces = await getAllWorkspaceSpaces(
      this.repos.spacesCache ?? this.repos.spaceRepo,
      principal.workspaceId,
    );

    if (options?.spaceId) {
      assertScope(
        principal.scope,
        "read",
        { spaceId: options.spaceId, resourceType: "space" },
        allSpaces,
      );
    }

    const allowedSpaces = resolveAllowedSpaceIds(principal.scope, allSpaces);
    const spaceIds = allowedSpaces === "*" ? undefined : [...allowedSpaces];
    if (
      (spaceIds && spaceIds.length === 0) ||
      (principal.scope.allowedKinds && principal.scope.allowedKinds.length === 0)
    ) {
      return [];
    }

    return this.repos.documentRepo.listDocumentSummaries(principal.workspaceId, {
      ...options,
      spaceIds,
      allowedKinds: principal.scope.allowedKinds,
      tagAllowlist: principal.scope.tagAllowlist,
      limit: options?.limit ?? 100,
      offset: options?.offset ?? 0,
    });
  }

  async getDocument(principal: Principal, documentId: DocumentId): Promise<DocumentRecord> {
    const doc = await this.repos.documentRepo.getDocumentById(principal.workspaceId, documentId);
    if (!doc) {
      throw new InkadeError("NOT_FOUND", `Document "${documentId}" not found`);
    }
    const allSpaces = await getAllWorkspaceSpaces(this.repos.spacesCache ?? this.repos.spaceRepo, principal.workspaceId);
    assertScope(
      principal.scope,
      "read",
      { spaceId: doc.spaceId, kind: doc.kind, tags: doc.tags },
      allSpaces,
    );
    return doc;
  }

  private async createDocumentInternal(
    principal: Principal,
    input: CreateDocumentInput,
    auditMeta?: {
      readonly changeSummary?: string | undefined;
      readonly auditSummary?: string | undefined;
      readonly fallbackAction?: string | undefined;
    },
  ): Promise<DocumentRecord> {
    const allSpaces = await getAllWorkspaceSpaces(
      this.repos.spacesCache ?? this.repos.spaceRepo,
      principal.workspaceId,
    );
    const effectiveTags = [
      ...new Set([...(input.tags ?? []), ...extractInlineTags(input.contentMarkdown ?? "")]),
    ];
    assertScope(
      principal.scope,
      "write",
      { spaceId: input.spaceId, kind: input.kind, tags: effectiveTags },
      allSpaces,
    );

    const normalizedInput = await this.normalizePropertiesInput(
      principal.workspaceId,
      input.spaceId,
      input.properties,
    );
    const createPayload: CreateDocumentInput =
      normalizedInput !== undefined ? { ...input, properties: normalizedInput } : input;

    const batchCtx = this.auditService?.ensureActiveBatchContext(principal);
    const created = await this.repos.documentRepo.createDocument(
      principal.workspaceId,
      createPayload,
      {
        actorType: principal.actorType,
        actorId: principal.actorId,
        unreadAgentUpdate: principal.actorType === "agent",
        changeSummary: auditMeta?.changeSummary,
        batchId: batchCtx?.batchId,
        executionMode: batchCtx?.executionMode,
      },
    );

    const afterRev = await this.repos.revisionLinkRepo.getRevision(created.id, created.version);
    await this.auditService?.captureOrRecord(principal, {
      spaceId: created.spaceId,
      documentId: created.id,
      beforeRevisionId: null,
      afterRevisionId: afterRev?.id ?? null,
      diffPreview: buildCompactDiffPreview("", created.contentMarkdown),
      reversible: false,
      irreversibleReason: "Initial document creation has no prior revision",
      summary: auditMeta?.auditSummary ?? `Created ${created.kind} "${created.title}"`,
      fallbackAction: auditMeta?.fallbackAction ?? "document.create",
      fallbackResource: `document:${created.id}`,
    });

    this.sseHub.publish({
      type: "document.created",
      workspaceId: principal.workspaceId,
      spaceId: created.spaceId,
      documentId: created.id,
      documentKind: created.kind,
      tags: created.tags,
      actorType: principal.actorType,
      payload: { document: created },
    });
    this.onDocumentChanged?.(principal.workspaceId, created.id);

    return created;
  }

  async createDocument(
    principal: Principal,
    input: CreateDocumentInput,
  ): Promise<DocumentRecord> {
    return this.createDocumentInternal(principal, input);
  }

  async scaffoldDocument(
    principal: Principal,
    rawInput: ScaffoldDocumentInput,
  ): Promise<DocumentRecord> {
    const input = scaffoldDocumentInputSchema.parse(rawInput);
    const contentMarkdown = buildScaffoldMarkdown({
      title: input.title,
      introMarkdown: input.introMarkdown,
      sections: input.sections,
      bindingId: input.bindingId,
      status: "generating",
    });
    const pendingCount = extractPendingBlocks(contentMarkdown).length;
    return this.createDocumentInternal(
      principal,
      {
        spaceId: input.spaceId,
        kind: "article",
        title: input.title,
        ...(input.slug !== undefined ? { slug: input.slug } : {}),
        contentMarkdown,
        tags: input.tags,
        ...(input.properties !== undefined ? { properties: input.properties } : {}),
        pinned: input.pinned,
      },
      {
        changeSummary: `Initial scaffold (${pendingCount} pending block${pendingCount === 1 ? "" : "s"})`,
        auditSummary: `Scaffolded article "${input.title}" (${pendingCount} pending block${pendingCount === 1 ? "" : "s"})`,
        fallbackAction: "document.scaffold",
      },
    );
  }

  async updateDocument(
    principal: Principal,
    documentId: DocumentId,
    input: UpdateDocumentInput,
  ): Promise<DocumentRecord> {
    const current = await this.repos.documentRepo.getDocumentById(principal.workspaceId, documentId);
    if (!current) {
      throw new InkadeError("NOT_FOUND", `Document "${documentId}" not found`);
    }
    if (current.trashedAt !== null) {
      throw new InkadeError(
        "CONFLICT",
        `Document "${documentId}" is in trash and must be restored before updating`,
      );
    }
    if (
      current.kind === "outline" &&
      input.contentMarkdown !== undefined &&
      input.contentMarkdown !== current.contentMarkdown
    ) {
      throw new InkadeError(
        "VALIDATION_ERROR",
        "Outline documents must be mutated via outline node operations",
      );
    }
    const allSpaces = await getAllWorkspaceSpaces(this.repos.spacesCache ?? this.repos.spaceRepo, principal.workspaceId);

    assertScope(
      principal.scope,
      "write",
      { spaceId: current.spaceId, kind: current.kind, tags: current.tags },
      allSpaces,
    );

    if (input.spaceId && input.spaceId !== current.spaceId) {
      assertScope(
        principal.scope,
        "write",
        { spaceId: input.spaceId, kind: current.kind, tags: input.tags ?? current.tags },
        allSpaces,
      );
    }

    if (input.tags !== undefined) {
      assertScope(
        principal.scope,
        "write",
        {
          spaceId: input.spaceId ?? current.spaceId,
          kind: current.kind,
          tags: input.tags,
        },
        allSpaces,
      );
    }

    const targetSpaceId = input.spaceId ?? current.spaceId;
    const normalizedProperties = await this.normalizePropertiesInput(
      principal.workspaceId,
      targetSpaceId,
      input.properties,
    );
    const updatePayload: UpdateDocumentInput =
      normalizedProperties !== undefined ? { ...input, properties: normalizedProperties } : input;

    const batchCtx = this.auditService?.ensureActiveBatchContext(principal);
    const { beforeRev, updated, updatedBacklinkSources } = await this.repos.tx.runInTx(async () => {
      const preRev = await this.repos.revisionLinkRepo.getLatestRevision(documentId);
      const nextDoc = await this.repos.documentRepo.updateDocument(
        principal.workspaceId,
        documentId,
        updatePayload,
        {
          actorType: principal.actorType,
          actorId: principal.actorId,
          batchId: batchCtx?.batchId,
          executionMode: batchCtx?.executionMode,
        },
      );

      const touchedSources: DocumentRecord[] = [];
      if (input.syncBacklinks && input.title && input.title !== current.title) {
        const candidateSrcIds = await this.repos.revisionLinkRepo.listIncomingLinkSourceDocIds(
          principal.workspaceId,
          documentId,
          current.title,
        );
        const now = new Date().toISOString();
        const isUnrestrictedAdmin =
          principal.scope.permission === "admin" &&
          principal.scope.spaceIds === "*" &&
          (principal.scope.tagAllowlist === undefined || principal.scope.tagAllowlist.length === 0) &&
          principal.scope.allowedKinds === undefined;

        for (const srcId of candidateSrcIds) {
          if (srcId === documentId) continue;
          const srcDoc = await this.repos.documentRepo.getDocumentById(principal.workspaceId, srcId);
          if (!srcDoc || srcDoc.trashedAt !== null) continue;
          if (
            !isUnrestrictedAdmin &&
            !evaluateScopeAccess(
              principal.scope,
              "write",
              { spaceId: srcDoc.spaceId, kind: srcDoc.kind, tags: srcDoc.tags },
              allSpaces,
            ).allowed
          ) {
            continue;
          }

          let srcModified = false;
          let latestVersion = srcDoc.version;
          const changeSummary = `Synced wikilink title "${current.title}" -> "${input.title}"`;

          if (srcDoc.contentMarkdown) {
            const rewriteRes = rewriteWikilinksTitle(
              srcDoc.contentMarkdown,
              current.title,
              current.slug,
              input.title,
            );
            if (rewriteRes.changed && rewriteRes.markdown !== srcDoc.contentMarkdown) {
              const rewritten = rewriteRes.markdown;
              const nextText = markdownToPlainText(rewritten);
              const nextExcerpt = extractExcerpt(rewritten);
              latestVersion += 1;
              await this.repos.documentRepo.updateDocumentContentDirect(
                principal.workspaceId,
                srcDoc.id,
                {
                  contentMarkdown: rewritten,
                  contentText: nextText,
                  excerpt: nextExcerpt,
                  version: latestVersion,
                  updatedAt: now,
                },
              );
              await this.repos.revisionLinkRepo.createRevision({
                documentId: srcDoc.id,
                version: latestVersion,
                contentMarkdown: rewritten,
                changeSummary,
                actorType: principal.actorType,
                actorId: principal.actorId,
                createdAt: now,
              });
              await this.repos.revisionLinkRepo.syncOutgoingLinks(
                principal.workspaceId,
                srcDoc.id,
                null,
                rewritten,
              );
              await this.repos.searchConfigRepo.upsertFtsEntry({
                entityKey: `doc:${srcDoc.id}`,
                workspaceId: principal.workspaceId,
                entityType: "document",
                documentId: srcDoc.id,
                nodeId: null,
                spaceId: srcDoc.spaceId,
                kind: srcDoc.kind,
                title: srcDoc.title,
                body: nextText,
              });
              srcModified = true;
            }
          }

          if (srcDoc.kind === "outline") {
            const srcNodes = await this.repos.outlineRepo.listOutlineNodes(srcDoc.id);
            let outlineChanged = false;
            for (const node of srcNodes) {
              const contentRewrite = rewriteWikilinksTitle(
                node.contentMarkdown,
                current.title,
                current.slug,
                input.title,
              );
              const prevNoteMd = node.noteMarkdown ?? "";
              const noteRewrite = prevNoteMd
                ? rewriteWikilinksTitle(prevNoteMd, current.title, current.slug, input.title)
                : { markdown: "", changed: false };
              if (!contentRewrite.changed && !noteRewrite.changed) {
                continue;
              }
              const nextNodeMd = contentRewrite.markdown;
              const nextNoteMd = noteRewrite.markdown;
              if (!outlineChanged) {
                await this.repos.revisionLinkRepo.ensureOutlineBaselineRevision(
                  { id: srcDoc.id, version: latestVersion, createdAt: srcDoc.createdAt },
                  now,
                );
                outlineChanged = true;
              }
              const nextNodeText = markdownToPlainText(nextNodeMd);
              const nextNoteText = markdownToPlainText(nextNoteMd);
              await this.repos.outlineRepo.updateOutlineNodeDirect(srcDoc.id, node.id, {
                contentMarkdown: nextNodeMd,
                contentText: nextNodeText,
                noteMarkdown: nextNoteMd,
                noteText: nextNoteText,
                updatedAt: now,
              });
              await this.repos.revisionLinkRepo.syncOutgoingLinks(
                principal.workspaceId,
                srcDoc.id,
                node.id,
                [nextNodeMd, nextNoteMd].filter(Boolean).join("\n"),
              );
              await this.repos.searchConfigRepo.upsertFtsEntry({
                entityKey: `nod:${node.id}`,
                workspaceId: principal.workspaceId,
                entityType: "outline_node",
                documentId: srcDoc.id,
                nodeId: node.id,
                spaceId: srcDoc.spaceId,
                kind: srcDoc.kind,
                title: srcDoc.title,
                body: [nextNodeText, nextNoteText].filter(Boolean).join(" "),
              });
            }

            if (outlineChanged) {
              await this.repos.revisionLinkRepo.recordOutlinePostMutationRevision({
                documentId: srcDoc.id,
                currentVersion: latestVersion,
                actorType: principal.actorType,
                actorId: principal.actorId,
                changeSummary,
                ts: now,
              });
              srcModified = true;
            }
          }

          if (srcModified) {
            const refreshedSrc = await this.repos.documentRepo.getDocumentById(
              principal.workspaceId,
              srcDoc.id,
            );
            if (refreshedSrc) {
              touchedSources.push(refreshedSrc);
            }
          }
        }
      }

      return { beforeRev: preRev, updated: nextDoc, updatedBacklinkSources: touchedSources };
    });

    for (const afterSrc of updatedBacklinkSources) {
      this.sseHub.publish({
        type: "document.updated",
        workspaceId: principal.workspaceId,
        spaceId: afterSrc.spaceId,
        documentId: afterSrc.id,
        documentKind: afterSrc.kind,
        tags: afterSrc.tags,
        actorType: principal.actorType,
        payload: { document: afterSrc },
      });
      this.onDocumentChanged?.(principal.workspaceId, afterSrc.id);
    }

    if (updated.version !== current.version) {
      const afterRev = await this.repos.revisionLinkRepo.getRevision(updated.id, updated.version);
      await this.auditService?.captureOrRecord(principal, {
        spaceId: updated.spaceId,
        documentId: updated.id,
        beforeRevisionId: beforeRev?.id ?? null,
        afterRevisionId: afterRev?.id ?? null,
        diffPreview: buildCompactDiffPreview(current.contentMarkdown, updated.contentMarkdown),
        reversible: Boolean(beforeRev && afterRev),
        irreversibleReason:
          beforeRev && afterRev ? null : "Missing before/after revision snapshot",
        summary: input.changeSummary ?? `Updated "${updated.title}" (v${updated.version})`,
        fallbackAction: "document.update",
        fallbackResource: `document:${updated.id}`,
      });
    } else {
      await this.auditService?.captureOrRecord(principal, {
        spaceId: updated.spaceId,
        documentId: updated.id,
        beforeRevisionId: null,
        afterRevisionId: null,
        diffPreview: null,
        reversible: false,
        irreversibleReason: "Metadata update did not create a content revision",
        summary: `Updated metadata on "${updated.title}"`,
        fallbackAction: "document.update",
        fallbackResource: `document:${updated.id}`,
      });
    }

    this.sseHub.publish({
      type: "document.updated",
      workspaceId: principal.workspaceId,
      spaceId: updated.spaceId,
      documentId: updated.id,
      documentKind: updated.kind,
      tags: updated.tags,
      actorType: principal.actorType,
      payload: { document: updated },
    });
    this.onDocumentChanged?.(principal.workspaceId, updated.id);
    await this.wakeService?.claimUnownedForDocumentWrite(principal, updated.id);

    return updated;
  }

  async patchDocumentSection(
    principal: Principal,
    documentId: DocumentId,
    input: PatchDocumentSectionInput,
  ): Promise<DocumentRecord> {
    const current = await this.repos.documentRepo.getDocumentById(principal.workspaceId, documentId);
    if (!current) {
      throw new InkadeError("NOT_FOUND", `Document "${documentId}" not found`);
    }
    if (current.trashedAt !== null) {
      throw new InkadeError(
        "CONFLICT",
        `Document "${documentId}" is in trash and must be restored before patching`,
      );
    }
    if (current.kind === "outline") {
      throw new InkadeError(
        "VALIDATION_ERROR",
        "Outline documents do not support markdown section patching",
      );
    }

    const allSpaces = await getAllWorkspaceSpaces(this.repos.spacesCache ?? this.repos.spaceRepo, principal.workspaceId);
    assertScope(
      principal.scope,
      "write",
      { spaceId: current.spaceId, kind: current.kind, tags: current.tags },
      allSpaces,
    );

    if (input.expectedVersion !== undefined && input.expectedVersion !== current.version) {
      throw new InkadeError(
        "VERSION_CONFLICT",
        `Version mismatch for document "${documentId}": expected ${input.expectedVersion}, actual ${current.version}`,
        { expectedVersion: input.expectedVersion, actualVersion: current.version },
      );
    }

    const targetPendingId =
      typeof input.targetPendingId === "string" && input.targetPendingId.trim().length > 0
        ? input.targetPendingId.trim()
        : undefined;

    let nextMarkdown: string;
    if (targetPendingId) {
      const replaced = replacePendingBlock(current.contentMarkdown, targetPendingId, input.markdown);
      if (!replaced.ok) {
        throw new InkadeError(
          "CONFLICT",
          `Pending block "${targetPendingId}" was not found in document "${documentId}" (it may have been removed or converted to prose by a human)`,
          {
            reason: replaced.reason,
            targetPendingId,
            remainingPendingIds: extractPendingBlocks(current.contentMarkdown).map((b) => b.id),
          },
        );
      }
      nextMarkdown = replaced.markdown;
    } else if (input.headingPath) {
      nextMarkdown = patchMarkdownSection(
        current.contentMarkdown,
        input.headingPath,
        input.mode ?? "replace",
        input.markdown,
        { createIfMissing: input.createIfMissing },
      );
    } else {
      throw new InkadeError(
        "VALIDATION_ERROR",
        "Either targetPendingId or headingPath must be provided",
      );
    }

    const targetLabel = targetPendingId
      ? `pending:${targetPendingId}`
      : Array.isArray(input.headingPath)
        ? input.headingPath.join(" > ")
        : (input.headingPath ?? "section");

    const batchCtx = this.auditService?.ensureActiveBatchContext(principal);
    const beforeRev = await this.repos.revisionLinkRepo.getLatestRevision(documentId);
    const updated = await this.repos.documentRepo.updateDocument(
      principal.workspaceId,
      documentId,
      {
        contentMarkdown: nextMarkdown,
        expectedVersion: input.expectedVersion ?? current.version,
        changeSummary: input.changeSummary ?? `Patched section (${targetLabel})`,
      },
      {
        actorType: principal.actorType,
        actorId: principal.actorId,
        batchId: batchCtx?.batchId,
        executionMode: batchCtx?.executionMode,
      },
    );

    if (updated.version !== current.version) {
      const afterRev = await this.repos.revisionLinkRepo.getRevision(updated.id, updated.version);
      await this.auditService?.captureOrRecord(principal, {
        spaceId: updated.spaceId,
        documentId: updated.id,
        beforeRevisionId: beforeRev?.id ?? null,
        afterRevisionId: afterRev?.id ?? null,
        diffPreview: buildCompactDiffPreview(current.contentMarkdown, updated.contentMarkdown),
        reversible: Boolean(beforeRev && afterRev),
        irreversibleReason:
          beforeRev && afterRev ? null : "Missing before/after revision snapshot",
        summary: input.changeSummary ?? `Patched section "${targetLabel}"`,
        fallbackAction: "document.patch_section",
        fallbackResource: `document:${updated.id}`,
      });
    }

    this.sseHub.publish({
      type: "document.updated",
      workspaceId: principal.workspaceId,
      spaceId: updated.spaceId,
      documentId: updated.id,
      documentKind: updated.kind,
      tags: updated.tags,
      actorType: principal.actorType,
      payload: { document: updated },
    });
    this.onDocumentChanged?.(principal.workspaceId, updated.id);
    await this.wakeService?.claimUnownedForDocumentWrite(principal, updated.id);

    return updated;
  }

  async trashDocument(principal: Principal, documentId: DocumentId): Promise<DocumentRecord> {
    const current = await this.repos.documentRepo.getDocumentById(principal.workspaceId, documentId);
    if (!current) {
      throw new InkadeError("NOT_FOUND", `Document "${documentId}" not found`);
    }
    const allSpaces = await getAllWorkspaceSpaces(this.repos.spacesCache ?? this.repos.spaceRepo, principal.workspaceId);
    assertScope(
      principal.scope,
      "soft_delete",
      { spaceId: current.spaceId, kind: current.kind, tags: current.tags },
      allSpaces,
    );

    const trashed = await this.repos.documentRepo.trashDocument(principal.workspaceId, documentId);
    await this.auditService?.captureOrRecord(principal, {
      spaceId: trashed.spaceId,
      documentId: trashed.id,
      reversible: false,
      irreversibleReason: "Document moved to trash (use restore endpoint)",
      summary: `Trashed "${trashed.title}"`,
      fallbackAction: "document.trash",
      fallbackResource: `document:${trashed.id}`,
    });
    this.sseHub.publish({
      type: "document.trashed",
      workspaceId: principal.workspaceId,
      spaceId: trashed.spaceId,
      documentId: trashed.id,
      documentKind: trashed.kind,
      tags: trashed.tags,
      actorType: principal.actorType,
      payload: { document: trashed },
    });
    this.onDocumentChanged?.(principal.workspaceId, trashed.id);
    return trashed;
  }

  async restoreDocument(principal: Principal, documentId: DocumentId): Promise<DocumentRecord> {
    const current = await this.repos.documentRepo.getDocumentById(principal.workspaceId, documentId);
    if (!current) {
      throw new InkadeError("NOT_FOUND", `Document "${documentId}" not found`);
    }
    const allSpaces = await getAllWorkspaceSpaces(this.repos.spacesCache ?? this.repos.spaceRepo, principal.workspaceId);
    assertScope(
      principal.scope,
      "write",
      { spaceId: current.spaceId, kind: current.kind, tags: current.tags },
      allSpaces,
    );

    const restored = await this.repos.documentRepo.restoreDocument(principal.workspaceId, documentId);
    await this.auditService?.captureOrRecord(principal, {
      spaceId: restored.spaceId,
      documentId: restored.id,
      reversible: false,
      irreversibleReason: "Document restored from trash",
      summary: `Restored "${restored.title}" from trash`,
      fallbackAction: "document.restore",
      fallbackResource: `document:${restored.id}`,
    });
    this.sseHub.publish({
      type: "document.restored",
      workspaceId: principal.workspaceId,
      spaceId: restored.spaceId,
      documentId: restored.id,
      documentKind: restored.kind,
      tags: restored.tags,
      actorType: principal.actorType,
      payload: { document: restored },
    });
    this.onDocumentChanged?.(principal.workspaceId, restored.id);
    return restored;
  }

  async hardDeleteDocument(principal: Principal, documentId: DocumentId): Promise<void> {
    const current = await this.repos.documentRepo.getDocumentById(principal.workspaceId, documentId);
    if (!current) {
      throw new InkadeError("NOT_FOUND", `Document "${documentId}" not found`);
    }
    const allSpaces = await getAllWorkspaceSpaces(this.repos.spacesCache ?? this.repos.spaceRepo, principal.workspaceId);
    assertScope(
      principal.scope,
      "hard_delete",
      { spaceId: current.spaceId, kind: current.kind, tags: current.tags },
      allSpaces,
    );

    await this.repos.documentRepo.hardDeleteDocument(principal.workspaceId, documentId);
    await this.auditService?.captureOrRecord(principal, {
      spaceId: current.spaceId,
      documentId: current.id,
      reversible: false,
      irreversibleReason: "Permanent hard deletion cannot be undone",
      summary: `Hard-deleted "${current.title}"`,
      fallbackAction: "document.hard_delete",
      fallbackResource: `document:${current.id}`,
    });
    this.sseHub.publish({
      type: "document.deleted",
      workspaceId: principal.workspaceId,
      spaceId: current.spaceId,
      documentId: current.id,
      documentKind: current.kind,
      tags: current.tags,
      actorType: principal.actorType,
      payload: { documentId },
    });
    this.onDocumentChanged?.(principal.workspaceId, current.id);
  }

  async markAgentUpdateRead(principal: Principal, documentId: DocumentId): Promise<DocumentRecord> {
    const current = await this.repos.documentRepo.getDocumentById(principal.workspaceId, documentId);
    if (!current) {
      throw new InkadeError("NOT_FOUND", `Document "${documentId}" not found`);
    }
    const allSpaces = await getAllWorkspaceSpaces(this.repos.spacesCache ?? this.repos.spaceRepo, principal.workspaceId);
    assertScope(
      principal.scope,
      "write",
      { spaceId: current.spaceId, kind: current.kind, tags: current.tags },
      allSpaces,
    );

    const updated = await this.repos.documentRepo.markDocumentAgentUpdateRead(principal.workspaceId, documentId);
    this.sseHub.publish({
      type: "document.updated",
      workspaceId: principal.workspaceId,
      spaceId: updated.spaceId,
      documentId: updated.id,
      documentKind: updated.kind,
      tags: updated.tags,
      actorType: principal.actorType,
      payload: { document: updated },
    });
    return updated;
  }

  async acknowledgeSilent(
    principal: Principal,
    documentId: DocumentId,
  ): Promise<DocumentRecord> {
    return this.markAgentUpdateRead(principal, documentId);
  }

  async listRevisions(
    principal: Principal,
    documentId: DocumentId,
  ): Promise<readonly DocumentRevision[]> {
    await this.getDocument(principal, documentId);
    return this.repos.revisionLinkRepo.listRevisions(documentId);
  }

  async getRevisionDiff(
    principal: Principal,
    documentId: DocumentId,
    fromVersion: number,
    toVersion: number,
  ): Promise<{
    readonly documentId: DocumentId;
    readonly fromVersion: number;
    readonly toVersion: number;
    readonly diff: RevisionDiffResult;
  }> {
    const doc = await this.getDocument(principal, documentId);
    const [fromRev, toRev] = await Promise.all([
      this.repos.revisionLinkRepo.getRevision(documentId, fromVersion),
      this.repos.revisionLinkRepo.getRevision(documentId, toVersion),
    ]);
    if (!fromRev) {
      throw new InkadeError(
        "NOT_FOUND",
        `Revision v${fromVersion} not found for document "${documentId}"`,
      );
    }
    if (!toRev) {
      throw new InkadeError(
        "NOT_FOUND",
        `Revision v${toVersion} not found for document "${documentId}"`,
      );
    }
    return {
      documentId,
      fromVersion,
      toVersion,
      diff: computeRevisionDiff(fromRev.contentMarkdown, toRev.contentMarkdown, {
        filename: `${doc.slug}.md`,
      }),
    };
  }

  async restoreRevision(
    principal: Principal,
    documentId: DocumentId,
    targetVersion: number,
  ): Promise<DocumentRecord> {
    const current = await this.repos.documentRepo.getDocumentById(principal.workspaceId, documentId);
    if (!current) {
      throw new InkadeError("NOT_FOUND", `Document "${documentId}" not found`);
    }
    if (current.trashedAt !== null) {
      throw new InkadeError(
        "CONFLICT",
        `Document "${documentId}" is in trash and must be restored before restoring revisions`,
      );
    }
    const allSpaces = await getAllWorkspaceSpaces(this.repos.spacesCache ?? this.repos.spaceRepo, principal.workspaceId);
    assertScope(
      principal.scope,
      "write",
      { spaceId: current.spaceId, kind: current.kind, tags: current.tags },
      allSpaces,
    );

    const rev = await this.repos.revisionLinkRepo.getRevision(documentId, targetVersion);
    if (!rev) {
      throw new InkadeError(
        "NOT_FOUND",
        `Revision v${targetVersion} not found for document "${documentId}"`,
      );
    }

    const beforeRev = await this.repos.revisionLinkRepo.getLatestRevision(documentId);
    let updated: DocumentRecord;
    if (current.kind === "outline") {
      if (!this.restoreOutlineRevisionSnapshot) {
        throw new InkadeError("INTERNAL_ERROR", "Outline revision restore handler is not configured");
      }
      updated = (
        await this.restoreOutlineRevisionSnapshot(
          principal,
          documentId,
          rev.id,
          `Restored to revision v${targetVersion}`,
        )
      ).document;
    } else {
      updated = await this.repos.documentRepo.updateDocument(
        principal.workspaceId,
        documentId,
        {
          contentMarkdown: rev.contentMarkdown,
          changeSummary: `Restored to revision v${targetVersion}`,
        },
        {
          actorType: principal.actorType,
          actorId: principal.actorId,
        },
      );
    }

    if (updated.version !== current.version) {
      const afterRev = await this.repos.revisionLinkRepo.getRevision(updated.id, updated.version);
      await this.auditService?.captureOrRecord(principal, {
        spaceId: updated.spaceId,
        documentId: updated.id,
        beforeRevisionId: beforeRev?.id ?? null,
        afterRevisionId: afterRev?.id ?? null,
        diffPreview: buildCompactDiffPreview(current.contentMarkdown, updated.contentMarkdown),
        reversible: Boolean(beforeRev && afterRev),
        irreversibleReason:
          beforeRev && afterRev ? null : "Missing before/after revision snapshot",
        summary: `Restored "${updated.title}" to revision v${targetVersion}`,
        fallbackAction: "document.restore_revision",
        fallbackResource: `document:${updated.id}`,
      });
    }

    if (current.kind !== "outline") {
      this.sseHub.publish({
        type: "document.updated",
        workspaceId: principal.workspaceId,
        spaceId: updated.spaceId,
        documentId: updated.id,
        documentKind: updated.kind,
        tags: updated.tags,
        actorType: principal.actorType,
        payload: { document: updated },
      });
      this.onDocumentChanged?.(principal.workspaceId, updated.id);
    }

    return updated;
  }

  async listBacklinks(
    principal: Principal,
    documentId: DocumentId,
  ): Promise<readonly DocumentLink[]> {
    await this.getDocument(principal, documentId);
    const allSpaces = await getAllWorkspaceSpaces(this.repos.spacesCache ?? this.repos.spaceRepo, principal.workspaceId);
    const links = await this.repos.revisionLinkRepo.listBacklinks(principal.workspaceId, documentId);
    if (links.length === 0) return [];

    const sourceDocs = new Map<DocumentId, DocumentRecord | null>();
    const uniqueSourceIds = [...new Set(links.map((link) => link.sourceDocumentId))];
    await Promise.all(
      uniqueSourceIds.map(async (srcId) => {
        const doc = await this.repos.documentRepo.getDocumentById(principal.workspaceId, srcId);
        sourceDocs.set(srcId, doc);
      }),
    );

    return links.filter((link) => {
      const src = sourceDocs.get(link.sourceDocumentId);
      if (!src || src.trashedAt !== null) return false;
      return evaluateScopeAccess(
        principal.scope,
        "read",
        { spaceId: src.spaceId, kind: src.kind, tags: src.tags },
        allSpaces,
      ).allowed;
    });
  }

  async promoteOutlineSubtreeToArticle(
    principal: Principal,
    nodeId: OutlineNodeId,
    input: PromoteOutlineSubtreeInput,
  ): Promise<PromoteOutlineSubtreeResult> {
    const sourceDocumentId =
      input.documentId ??
      (await resolveOutlineNodeDocumentId(this.repos.outlineRepo, principal.workspaceId, nodeId));

    const sourceDoc = await this.getDocument(principal, sourceDocumentId);
    if (sourceDoc.trashedAt !== null) {
      throw new InkadeError("NOT_FOUND", `Document "${sourceDocumentId}" not found`);
    }

    const allSpaces = await getAllWorkspaceSpaces(this.repos.spacesCache ?? this.repos.spaceRepo, principal.workspaceId);
    const tags = input.tags ? [...input.tags] : [...sourceDoc.tags];
    assertScope(
      principal.scope,
      "write",
      { spaceId: input.targetSpaceId, kind: "article", tags },
      allSpaces,
    );

    const keepLink = input.keepLinkInNode ?? true;
    if (keepLink) {
      assertScope(
        principal.scope,
        "write",
        { spaceId: sourceDoc.spaceId, kind: sourceDoc.kind, tags: sourceDoc.tags },
        allSpaces,
      );
    }

    const nodes = await this.repos.outlineRepo.listOutlineNodes(sourceDocumentId);
    const rootNode = nodes.find((n) => n.id === nodeId);
    if (!rootNode) {
      throw new InkadeError("NOT_FOUND", `Outline node "${nodeId}" not found`);
    }

    const { title, markdown } = buildSubtreeMarkdown(rootNode, nodes, input.title);
    const article = await this.createDocument(principal, {
      spaceId: input.targetSpaceId,
      kind: "article",
      title,
      contentMarkdown: markdown,
      tags,
      pinned: false,
    });

    let updatedNode: OutlineNode | null = null;
    if (keepLink) {
      const wikilink = `[[${article.title}]]`;
      const nextNodeMarkdown = rootNode.contentMarkdown.includes(wikilink)
        ? rootNode.contentMarkdown
        : rootNode.contentMarkdown.trim().length > 0
          ? `${rootNode.contentMarkdown.trim()} — ${wikilink}`
          : wikilink;

      updatedNode = await this.repos.outlineRepo.updateOutlineNode(
        principal.workspaceId,
        sourceDocumentId,
        nodeId,
        { contentMarkdown: nextNodeMarkdown },
      );

      this.sseHub.publish({
        type: "outline.node.updated",
        workspaceId: principal.workspaceId,
        spaceId: sourceDoc.spaceId,
        documentId: sourceDoc.id,
        documentKind: sourceDoc.kind,
        tags: sourceDoc.tags,
        actorType: principal.actorType,
        payload: { node: updatedNode },
      });
    }

    return { article, updatedNode };
  }

  async linkDocumentTarget(
    principal: Principal,
    sourceDocumentId: DocumentId,
    targetDocumentId: DocumentId,
  ): Promise<{
    readonly document: DocumentRecord;
    readonly linked: boolean;
    readonly alreadyLinked: boolean;
    readonly createdNodeId: OutlineNodeId | null;
  }> {
    if (sourceDocumentId === targetDocumentId) {
      throw new InkadeError("VALIDATION_ERROR", "Cannot link a document to itself");
    }

    const [sourceDoc, targetDoc, allSpaces] = await Promise.all([
      this.repos.documentRepo.getDocumentById(principal.workspaceId, sourceDocumentId),
      this.repos.documentRepo.getDocumentById(principal.workspaceId, targetDocumentId),
      getAllWorkspaceSpaces(this.repos.spacesCache ?? this.repos.spaceRepo, principal.workspaceId),
    ]);

    if (!sourceDoc || sourceDoc.trashedAt !== null || isSystemInternalDocument(sourceDoc)) {
      throw new InkadeError("NOT_FOUND", `Document "${sourceDocumentId}" not found`);
    }
    if (!targetDoc || targetDoc.trashedAt !== null || isSystemInternalDocument(targetDoc)) {
      throw new InkadeError("NOT_FOUND", `Target document "${targetDocumentId}" not found`);
    }

    assertScope(
      principal.scope,
      "write",
      { spaceId: sourceDoc.spaceId, kind: sourceDoc.kind, tags: sourceDoc.tags },
      allSpaces,
    );
    assertScope(
      principal.scope,
      "read",
      { spaceId: targetDoc.spaceId, kind: targetDoc.kind, tags: targetDoc.tags },
      allSpaces,
    );

    const outgoing = await this.repos.revisionLinkRepo.listOutgoingLinks(
      principal.workspaceId,
      sourceDoc.id,
    );
    if (outgoing.some((link) => link.targetDocumentId === targetDoc.id)) {
      return {
        document: sourceDoc,
        linked: true,
        alreadyLinked: true,
        createdNodeId: null,
      };
    }

    const wikilink = `[[${targetDoc.title}]]`;
    if (sourceDoc.kind === "outline") {
      const batchCtx = this.auditService?.ensureActiveBatchContext(principal);
      const authorType = principal.kind === "token" ? "agent" : "human";
      const createdNode = await this.repos.outlineRepo.createOutlineNode(
        principal.workspaceId,
        {
          documentId: sourceDoc.id,
          parentNodeId: null,
          contentMarkdown: wikilink,
          authorType,
          authorId: principal.actorId,
        },
        {
          batchId: batchCtx?.batchId,
          executionMode: batchCtx?.executionMode,
        },
      );

      this.sseHub.publish({
        type: "outline.node.created",
        workspaceId: principal.workspaceId,
        spaceId: sourceDoc.spaceId,
        documentId: sourceDoc.id,
        documentKind: sourceDoc.kind,
        tags: sourceDoc.tags,
        actorType: principal.actorType,
        payload: { node: createdNode },
      });
      this.onDocumentChanged?.(principal.workspaceId, sourceDoc.id);

      const refreshed =
        (await this.repos.documentRepo.getDocumentById(principal.workspaceId, sourceDoc.id)) ??
        sourceDoc;
      return {
        document: refreshed,
        linked: true,
        alreadyLinked: false,
        createdNodeId: createdNode.id,
      };
    }

    const trimmed = sourceDoc.contentMarkdown.trimEnd();
    const nextMarkdown = trimmed.length > 0 ? `${trimmed}\n\n${wikilink}\n` : `${wikilink}\n`;
    const updated = await this.updateDocument(principal, sourceDoc.id, {
      contentMarkdown: nextMarkdown,
      expectedVersion: sourceDoc.version,
      changeSummary: `Link [[${targetDoc.title}]]`,
    });

    return {
      document: updated,
      linked: true,
      alreadyLinked: false,
      createdNodeId: null,
    };
  }
}
