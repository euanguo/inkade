import { zipSync, type Zippable } from "fflate";
import {
  asAttachmentId,
  buildDocumentExportFrontmatter,
  evaluateScopeAccess,
  formatUtcIsoDate,
  markdownToDocxFiles,
  parseMarkdownWithFrontmatter,
  renderOutlineNodesToMarkdown,
  resolveAllowedSpaceIds,
  serializeMarkdownWithFrontmatter,
  type DocxExportMediaAsset,
  type DocumentId,
  type DocumentRecord,
  type OutlineNode,
  type PropertyFieldDefinition,
  type Space,
  type SpaceId,
} from "@inkade/core";
import type { DocumentRepo, OutlineRepo, SpaceRepo } from "@inkade/db";
import type { WorkspaceSpacesCache } from "../cache/workspace-spaces-cache.ts";
import type { Principal } from "../types.ts";
import type { AttachmentService } from "./attachment-service.ts";
import type { AuditService } from "./audit-service.ts";
import { encodeDocxPackage } from "./docx-codec.ts";
import type { DocumentService } from "./document-service.ts";
import { getAllWorkspaceSpaces } from "./scope-guard.ts";

function buildSpacePathMap(spaces: readonly Space[]): Map<SpaceId, string> {
  const byId = new Map(spaces.map((s) => [s.id, s]));
  const memo = new Map<SpaceId, string>();

  const resolvePath = (spaceId: SpaceId, visited = new Set<SpaceId>()): string => {
    const cached = memo.get(spaceId);
    if (cached !== undefined) return cached;
    const space = byId.get(spaceId);
    if (!space) return "uncategorized";
    if (visited.has(spaceId)) return space.slug;
    visited.add(spaceId);

    const path =
      space.parentId && byId.has(space.parentId)
        ? `${resolvePath(space.parentId, visited)}/${space.slug}`
        : space.slug;
    memo.set(spaceId, path);
    return path;
  };

  for (const space of spaces) {
    resolvePath(space.id);
  }
  return memo;
}

function formatDocumentWithFrontmatter(
  doc: DocumentRecord,
  spacePath: string,
  outlineNodes: readonly OutlineNode[],
  schemaFields: readonly PropertyFieldDefinition[] = [],
): string {
  const { frontmatter, keyOrder } = buildDocumentExportFrontmatter(doc, spacePath, schemaFields);

  let body = doc.contentMarkdown.trimEnd();
  if (doc.kind === "outline") {
    const renderedOutline = renderOutlineNodesToMarkdown(outlineNodes);
    if (renderedOutline) {
      body = body ? `${body}\n\n${renderedOutline}` : renderedOutline;
    }
  }

  return serializeMarkdownWithFrontmatter({
    bodyMarkdown: body,
    frontmatter,
    existingMarkdown: doc.contentMarkdown,
    keyOrder,
  });
}

export class ExportService {
  constructor(
    private readonly documentRepo: DocumentRepo,
    private readonly outlineRepo: OutlineRepo,
    private readonly spaceRepo: SpaceRepo,
    private readonly documentService: DocumentService,
    private readonly auditService?: AuditService,
    private readonly spacesCache?: WorkspaceSpacesCache,
    private readonly attachmentService?: AttachmentService,
  ) {}

  async exportDocumentDocx(
    principal: Principal,
    documentId: DocumentId,
  ): Promise<{ readonly filename: string; readonly bytes: Uint8Array }> {
    const doc = await this.documentService.getDocument(principal, documentId);
    const outlineNodes =
      doc.kind === "outline" ? await this.outlineRepo.listOutlineNodes(doc.id) : [];

    let body = parseMarkdownWithFrontmatter(doc.contentMarkdown).bodyMarkdown.trimEnd();
    if (doc.kind === "outline") {
      const renderedOutline = renderOutlineNodesToMarkdown(outlineNodes);
      if (renderedOutline) {
        body = body ? `${body}\n\n${renderedOutline}` : renderedOutline;
      }
    }

    const media: DocxExportMediaAsset[] = [];
    if (this.attachmentService && body.includes("/api/v1/attachments/")) {
      const seenUrls = new Set<string>();
      const attUrlRegex =
        /(?:https?:\/\/[^/\s)"']+)?(\/api\/v1\/attachments\/([a-zA-Z0-9_-]+)\/download)/g;
      for (const match of body.matchAll(attUrlRegex)) {
        const fullOrPathUrl = match[0];
        const rawAttId = match[2];
        if (!fullOrPathUrl || !rawAttId || seenUrls.has(fullOrPathUrl)) continue;
        seenUrls.add(fullOrPathUrl);
        try {
          const { attachment, bytes } = await this.attachmentService.downloadAttachment(
            principal,
            asAttachmentId(rawAttId),
          );
          media.push({
            url: fullOrPathUrl,
            bytes,
            mimeType: attachment.mimeType,
            filename: attachment.filename,
          });
        } catch {
          // Graceful fallback when attachment is missing or outside caller scope
        }
      }
    }

    const pkg = markdownToDocxFiles({
      title: doc.title,
      markdown: body,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      media,
    });
    const bytes = encodeDocxPackage(pkg.files);

    await this.auditService
      ?.recordCapturedEvent(principal, {
        action: "document.export.docx",
        resource: `document:${doc.id}:export.docx`,
        spaceId: doc.spaceId,
        documentId: doc.id,
        reversible: false,
        irreversibleReason: "Exported DOCX artifacts leave server control",
        summary: `Exported "${doc.title}" as DOCX`,
      })
      .catch(() => {});

    return {
      filename: `${doc.slug || doc.id}.docx`,
      bytes,
    };
  }

  async exportDocumentMarkdown(
    principal: Principal,
    documentId: DocumentId,
  ): Promise<{ readonly filename: string; readonly markdown: string }> {
    const doc = await this.documentService.getDocument(principal, documentId);
    const [allSpaces, spaceSchema] = await Promise.all([
      getAllWorkspaceSpaces(this.spacesCache ?? this.spaceRepo, principal.workspaceId),
      this.spaceRepo.getSpacePropertySchema(principal.workspaceId, { spaceId: doc.spaceId }),
    ]);
    const spacePaths = buildSpacePathMap(allSpaces);
    const outlineNodes =
      doc.kind === "outline" ? await this.outlineRepo.listOutlineNodes(doc.id) : [];
    const markdown = formatDocumentWithFrontmatter(
      doc,
      spacePaths.get(doc.spaceId) ?? doc.spaceId,
      outlineNodes,
      spaceSchema?.fields ?? [],
    );
    await this.auditService
      ?.recordCapturedEvent(principal, {
        action: "document.export.markdown",
        resource: `document:${doc.id}:export.md`,
        spaceId: doc.spaceId,
        documentId: doc.id,
        reversible: false,
        irreversibleReason: "Exported Markdown artifacts leave server control",
        summary: `Exported "${doc.title}" as Markdown`,
      })
      .catch(() => {});
    return {
      filename: `${doc.slug || doc.id}.md`,
      markdown,
    };
  }

  async exportWorkspaceZip(
    principal: Principal,
  ): Promise<{ readonly filename: string; readonly bytes: Uint8Array }> {
    const allSpaces = await getAllWorkspaceSpaces(
      this.spacesCache ?? this.spaceRepo,
      principal.workspaceId,
    );
    const allowedSpaces = resolveAllowedSpaceIds(principal.scope, allSpaces);
    const authorizedDocs = await this.documentRepo.listDocuments(principal.workspaceId, {
      spaceIds: allowedSpaces === "*" ? undefined : [...allowedSpaces],
      allowedKinds: principal.scope.allowedKinds,
      tagAllowlist: principal.scope.tagAllowlist,
      includeTrashed: false,
      limit: null,
    });

    const spacePaths = buildSpacePathMap(allSpaces);
    const spaceSchemas = await this.spaceRepo.listSpacePropertySchemas(principal.workspaceId);
    const schemaBySpaceId = new Map<string, readonly PropertyFieldDefinition[]>();
    for (const schema of spaceSchemas) {
      if (schema.spaceId) {
        schemaBySpaceId.set(schema.spaceId, schema.fields);
      }
    }
    const filteredDocs = authorizedDocs.filter(
      (doc) =>
        evaluateScopeAccess(
          principal.scope,
          "read",
          { spaceId: doc.spaceId, kind: doc.kind, tags: doc.tags },
          allSpaces,
        ).allowed,
    );

    const encoder = new TextEncoder();
    const files: Zippable = {};
    const usedPaths = new Set<string>();

    for (const doc of filteredDocs) {
      const spacePath = spacePaths.get(doc.spaceId) ?? "uncategorized";
      const baseName = doc.slug || doc.id;
      let candidatePath = `${spacePath}/${baseName}.md`;
      let suffix = 2;
      while (usedPaths.has(candidatePath)) {
        candidatePath = `${spacePath}/${baseName}-${suffix}.md`;
        suffix++;
      }
      usedPaths.add(candidatePath);

      const outlineNodes =
        doc.kind === "outline" ? await this.outlineRepo.listOutlineNodes(doc.id) : [];
      const content = formatDocumentWithFrontmatter(
        doc,
        spacePath,
        outlineNodes,
        schemaBySpaceId.get(doc.spaceId) ?? [],
      );
      files[candidatePath] = encoder.encode(content);
    }

    const zipBytes = zipSync(files);
    const dateStamp = formatUtcIsoDate(new Date());
    await this.auditService
      ?.recordCapturedEvent(principal, {
        action: "workspace.export.zip",
        resource: `workspace:${principal.workspaceId}:export.zip`,
        spaceId: null,
        documentId: null,
        reversible: false,
        irreversibleReason: "Exported ZIP archive leaves server control",
        summary: `Exported ${filteredDocs.length} documents to ZIP archive`,
      })
      .catch(() => {});
    return {
      filename: `inkade-export-${dateStamp}.zip`,
      bytes: zipBytes,
    };
  }
}
