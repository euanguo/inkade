import { randomBytes } from "node:crypto";
import {
  assertGovernanceAllowed,
  evaluateScopeAccess,
  evaluateViewQueryOnDocuments,
  extractArtifactBlocks,
  extractInkadeViewBlocks,
  InkadeError,
  INTERNAL_HIDDEN_PROPERTY_KEYS,
  isSystemInternalDocument,
  replaceInkadeArtifactFencesWithFallback,
  type CreateShareLinkInput,
  type DocumentId,
  type DocumentRecord,
  type DocumentSummary,
  type InkadeViewSpec,
  type PropertyFieldDefinition,
  type PublicSharedDocument,
  type ShareLink,
  type ShareLinkId,
  type ViewQueryDocumentItem,
  type ViewQueryResponse,
} from "@inkade/core";
import type { AttachmentRepo, DocumentRepo, OutlineRepo, SpaceRepo } from "@inkade/db";
import type { WorkspaceSpacesCache } from "../cache/workspace-spaces-cache.ts";
import type { SseHub } from "../realtime/sse-hub.ts";
import type { Principal } from "../types.ts";
import { assertScope, getAllWorkspaceSpaces } from "./scope-guard.ts";

export class ShareService {
  constructor(
    private readonly spaceRepo: SpaceRepo,
    private readonly documentRepo: DocumentRepo,
    private readonly outlineRepo: OutlineRepo,
    private readonly sseHub: SseHub,
    private readonly spacesCache?: WorkspaceSpacesCache,
    private readonly attachmentRepo?: AttachmentRepo,
  ) {}

  async listShareLinks(
    principal: Principal,
    documentId?: DocumentId,
  ): Promise<readonly ShareLink[]> {
    const allSpaces = await getAllWorkspaceSpaces(
      this.spacesCache ?? this.spaceRepo,
      principal.workspaceId,
    );

    if (documentId) {
      const doc = await this.documentRepo.getDocumentById(principal.workspaceId, documentId);
      if (!doc || doc.trashedAt !== null) {
        throw new InkadeError("NOT_FOUND", `Document "${documentId}" not found`);
      }
      assertScope(
        principal.scope,
        "read",
        { spaceId: doc.spaceId, kind: doc.kind, tags: doc.tags },
        allSpaces,
      );
      return this.spaceRepo.listShareLinks(principal.workspaceId, documentId);
    }

    const links = await this.spaceRepo.listShareLinks(principal.workspaceId);
    if (links.length === 0) return [];

    const docCache = new Map<DocumentId, DocumentRecord | null>();
    await Promise.all(
      [...new Set(links.map((l) => l.documentId))].map(async (id) => {
        docCache.set(id, await this.documentRepo.getDocumentById(principal.workspaceId, id));
      }),
    );

    return links.filter((link) => {
      const doc = docCache.get(link.documentId);
      if (!doc || doc.trashedAt !== null) return false;
      return evaluateScopeAccess(
        principal.scope,
        "read",
        { spaceId: doc.spaceId, kind: doc.kind, tags: doc.tags },
        allSpaces,
      ).allowed;
    });
  }

  async createShareLink(
    principal: Principal,
    input: CreateShareLinkInput,
  ): Promise<ShareLink> {
    assertGovernanceAllowed(principal.kind, principal.scope, "share_link.create");
    const [doc, allSpaces] = await Promise.all([
      this.documentRepo.getDocumentById(principal.workspaceId, input.documentId),
      getAllWorkspaceSpaces(this.spacesCache ?? this.spaceRepo, principal.workspaceId),
    ]);
    if (!doc || doc.trashedAt !== null) {
      throw new InkadeError("NOT_FOUND", `Document "${input.documentId}" not found`);
    }
    assertScope(
      principal.scope,
      "write",
      { spaceId: doc.spaceId, kind: doc.kind, tags: doc.tags },
      allSpaces,
    );

    if (input.expiresAt !== undefined && input.expiresAt !== null) {
      const ts = Date.parse(input.expiresAt);
      if (Number.isNaN(ts)) {
        throw new InkadeError("VALIDATION_ERROR", "expiresAt must be a valid ISO timestamp");
      }
    }

    const token = randomBytes(24).toString("base64url");
    const shareLink = await this.spaceRepo.createShareLink(principal.workspaceId, {
      documentId: input.documentId,
      token,
      expiresAt: input.expiresAt ?? null,
    });

    this.sseHub.publish({
      type: "share.created",
      workspaceId: principal.workspaceId,
      spaceId: doc.spaceId,
      documentId: doc.id,
      documentKind: doc.kind,
      tags: doc.tags,
      actorType: principal.actorType,
      payload: { shareLink },
    });

    return shareLink;
  }

  async revokeShareLink(principal: Principal, shareLinkId: ShareLinkId): Promise<ShareLink> {
    assertGovernanceAllowed(principal.kind, principal.scope, "share_link.revoke");
    const existing = await this.spaceRepo.getShareLinkById(principal.workspaceId, shareLinkId);
    if (!existing) {
      throw new InkadeError("NOT_FOUND", `Share link "${shareLinkId}" not found`);
    }
    const [doc, allSpaces] = await Promise.all([
      this.documentRepo.getDocumentById(principal.workspaceId, existing.documentId),
      getAllWorkspaceSpaces(this.spacesCache ?? this.spaceRepo, principal.workspaceId),
    ]);
    if (!doc) {
      throw new InkadeError("NOT_FOUND", `Document "${existing.documentId}" not found`);
    }
    assertScope(
      principal.scope,
      "write",
      { spaceId: doc.spaceId, kind: doc.kind, tags: doc.tags },
      allSpaces,
    );

    const revoked = await this.spaceRepo.revokeShareLink(principal.workspaceId, shareLinkId);
    this.sseHub.publish({
      type: "share.revoked",
      workspaceId: principal.workspaceId,
      spaceId: doc.spaceId,
      documentId: doc.id,
      documentKind: doc.kind,
      tags: doc.tags,
      actorType: principal.actorType,
      payload: { shareLink: revoked },
    });
    return revoked;
  }

  async getPublicShare(token: string): Promise<PublicSharedDocument> {
    const shareLink = await this.spaceRepo.getShareLinkByToken(token);
    if (!shareLink || shareLink.revokedAt !== null) {
      throw new InkadeError("NOT_FOUND", "Share link not found or revoked");
    }
    if (shareLink.expiresAt !== null && Date.parse(shareLink.expiresAt) <= Date.now()) {
      throw new InkadeError("NOT_FOUND", "Share link has expired");
    }

    const doc = await this.documentRepo.getDocumentById(
      shareLink.workspaceId,
      shareLink.documentId,
    );
    if (!doc || doc.trashedAt !== null || isSystemInternalDocument(doc)) {
      throw new InkadeError("NOT_FOUND", "Shared document is no longer available");
    }

    const nodes =
      doc.kind === "outline"
        ? (await this.outlineRepo.listOutlineNodes(doc.id)).map((n) => ({
            id: n.id,
            parentNodeId: n.parentNodeId,
            orderKey: n.orderKey,
            contentMarkdown: n.contentMarkdown,
            contentText: n.contentText,
            noteMarkdown: n.noteMarkdown,
            noteText: n.noteText,
            checked: n.checked,
            collapsed: n.collapsed,
            createdAt: n.createdAt,
            updatedAt: n.updatedAt,
          }))
        : undefined;

    const [embeddedViews, docArtifacts] = await Promise.all([
      this.resolvePublicEmbeddedViews(shareLink.workspaceId, doc),
      this.attachmentRepo && extractArtifactBlocks(doc.contentMarkdown).length > 0
        ? this.attachmentRepo.listDocumentArtifactsByDocument(shareLink.workspaceId, doc.id)
        : Promise.resolve([]),
    ]);
    const artifactsById = new Map(
      docArtifacts.map((item) => [
        item.id,
        { title: item.title, fallbackMarkdown: item.fallbackMarkdown },
      ]),
    );
    const safeContentMarkdown = replaceInkadeArtifactFencesWithFallback(
      doc.contentMarkdown,
      artifactsById,
    );

    return {
      document: {
        id: doc.id,
        kind: doc.kind,
        title: doc.title,
        slug: doc.slug,
        dailyDate: doc.dailyDate,
        contentMarkdown: safeContentMarkdown,
        excerpt: doc.excerpt,
        tags: doc.tags,
        sourceUrl: doc.sourceUrl,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      },
      ...(nodes ? { nodes } : {}),
      ...(embeddedViews ? { embeddedViews } : {}),
      shareLink: {
        id: shareLink.id,
        expiresAt: shareLink.expiresAt,
        createdAt: shareLink.createdAt,
      },
    };
  }

  private async resolvePublicEmbeddedViews(
    workspaceId: DocumentRecord["workspaceId"],
    doc: DocumentRecord,
  ): Promise<Record<string, ViewQueryResponse> | undefined> {
    const extracted = extractInkadeViewBlocks(doc.contentMarkdown);
    const validBlocks = extracted.filter(
      (b): b is {
        readonly raw: string;
        readonly parsed: { readonly ok: true; readonly spec: InkadeViewSpec };
      } => b.parsed.ok,
    );
    if (validBlocks.length === 0) return undefined;

    const [activeLinks, schemas] = await Promise.all([
      this.spaceRepo.listActiveShareLinksByWorkspace(workspaceId),
      this.spaceRepo.listSpacePropertySchemas(workspaceId),
    ]);

    const tokenByDocId = new Map<DocumentId, string>();
    for (const link of activeLinks) {
      if (!tokenByDocId.has(link.documentId)) {
        tokenByDocId.set(link.documentId, link.token);
      }
    }

    const publicDocs: DocumentSummary[] = [];
    if (tokenByDocId.size > 0) {
      const workspaceDocs = await this.documentRepo.listDocuments(workspaceId, {
        includeTrashed: false,
        limit: null,
      });
      for (const candidate of workspaceDocs) {
        if (
          candidate.trashedAt !== null ||
          isSystemInternalDocument(candidate) ||
          !tokenByDocId.has(candidate.id)
        ) {
          continue;
        }
        const safeProperties: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(candidate.properties ?? {})) {
          if (INTERNAL_HIDDEN_PROPERTY_KEYS.has(key) || key.startsWith("_")) continue;
          safeProperties[key] = val;
        }
        publicDocs.push({
          ...candidate,
          properties: safeProperties,
        });
      }
    }

    const schemaBySpaceId = new Map<string, readonly PropertyFieldDefinition[]>();
    for (const schema of schemas) {
      if (schema.spaceId) {
        schemaBySpaceId.set(schema.spaceId, schema.fields);
      }
    }

    const result: Record<string, ViewQueryResponse> = {};
    for (const block of validBlocks) {
      const { spec } = block.parsed;
      const schemaFields: PropertyFieldDefinition[] = [];
      if (spec.spaceId) {
        schemaFields.push(...(schemaBySpaceId.get(spec.spaceId) ?? []));
      } else {
        const seen = new Set<string>();
        const allowedSpaceIds = new Set(publicDocs.map((d) => d.spaceId));
        for (const spaceId of allowedSpaceIds) {
          for (const field of schemaBySpaceId.get(spaceId) ?? []) {
            if (seen.has(field.key)) continue;
            seen.add(field.key);
            schemaFields.push(field);
          }
        }
      }

      const evaluated = evaluateViewQueryOnDocuments(publicDocs, schemaFields, spec);
      const docsWithShareToken: ViewQueryDocumentItem[] = evaluated.documents.map((item) => ({
        ...item,
        publicShareToken: tokenByDocId.get(item.id) ?? null,
      }));
      const snapshot: ViewQueryResponse = {
        ...evaluated,
        documents: docsWithShareToken,
      };
      result[block.raw] = snapshot;
      const trimmed = block.raw.trim();
      if (trimmed !== block.raw) {
        result[trimmed] = snapshot;
      }
    }

    return result;
  }
}
