import { basename, extname } from "node:path";
import { extractText } from "unpdf";
import { generateText } from "ai";
import {
  buildPdfCitationUri,
  createId,
  InkadeError,
  type CreatePdfAnnotationInput,
  type DocumentAsset,
  type DocumentAssetId,
  type DocumentId,
  type OutlineNode,
  type PdfAnnotation,
  type PdfAnnotationMutationResult,
  type PdfDistillPageInput,
  type PdfDistillPageResult,
  type PdfExtractedPage,
  type SpaceId,
  type UpdatePdfAnnotationInput,
  type UploadPdfWorkspaceResult,
} from "@inkade/core";
import {
  DEFAULT_SPACE_IDS,
  type AttachmentRepo,
  type DocumentRepo,
  type OutlineRepo,
  type SearchConfigRepo,
  type SpaceRepo,
} from "@inkade/db";
import type { WorkspaceSpacesCache } from "../cache/workspace-spaces-cache.ts";
import type { SseHub } from "../realtime/sse-hub.ts";
import type { Principal } from "../types.ts";
import { createChatLanguageModel, validateAiEndpointUrl } from "./ai-provider-factory.ts";
import type { AttachmentService } from "./attachment-service.ts";
import { defaultDnsResolver, type DnsResolver, type FetchFn } from "./clipper-service.ts";
import type { DocumentService } from "./document-service.ts";
import type { OutlineService } from "./outline-service.ts";
import { assertScope, getAllWorkspaceSpaces } from "./scope-guard.ts";

const MAX_PDF_BYTES = 50 * 1024 * 1024;

export interface PdfServiceTransport {
  readonly fetchFn?: FetchFn | undefined;
  readonly resolveDns?: DnsResolver | undefined;
  readonly allowLocalForTest?: boolean | undefined;
}

function buildFallbackPageDistillation(
  page: number,
  pageText: string,
  targetLanguage?: "zh-CN" | "en-US",
): string {
  const clean = pageText.replace(/\s+/g, " ").trim();
  const sentences = clean
    .split(/(?<=[。！？.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, 4);
  const isZh = targetLanguage === "zh-CN" || (targetLanguage !== "en-US" && /[\u4e00-\u9fff]/.test(clean));
  if (sentences.length === 0) {
    return isZh ? `第 ${page} 页未提取到可提炼文本。` : `Page ${page} has no extractable text.`;
  }
  const heading = isZh ? `第 ${page} 页要点提炼` : `Page ${page} Key Takeaways`;
  return `${heading}: ${sentences.join(" · ")}`;
}

export class PdfService {
  private fetchFn: FetchFn;
  private resolveDns: DnsResolver;
  private allowLocalForTest: boolean;

  constructor(
    private readonly deps: {
      readonly attachmentRepo: AttachmentRepo;
      readonly documentRepo: DocumentRepo;
      readonly outlineRepo: OutlineRepo;
      readonly spaceRepo: SpaceRepo;
      readonly searchConfigRepo: SearchConfigRepo;
      readonly attachmentService: AttachmentService;
      readonly documentService: DocumentService;
      readonly outlineService: OutlineService;
      readonly sseHub: SseHub;
      readonly spacesCache?: WorkspaceSpacesCache | undefined;
      readonly onDocumentChanged?: (workspaceId: Principal["workspaceId"], docId: DocumentId) => void;
    },
    transport?: PdfServiceTransport,
  ) {
    this.fetchFn = transport?.fetchFn ?? ((input, init) => fetch(input, init));
    this.resolveDns = transport?.resolveDns ?? defaultDnsResolver;
    this.allowLocalForTest = transport?.allowLocalForTest ?? false;
  }

  setTestTransport(transport: PdfServiceTransport): void {
    if (transport.fetchFn !== undefined) this.fetchFn = transport.fetchFn;
    if (transport.resolveDns !== undefined) this.resolveDns = transport.resolveDns;
    if (transport.allowLocalForTest !== undefined) this.allowLocalForTest = transport.allowLocalForTest;
  }

  private async extractPdfPages(bytes: Uint8Array): Promise<{
    readonly totalPages: number;
    readonly pages: PdfExtractedPage[];
  }> {
    try {
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      const res = await extractText(copy, { mergePages: false });
      const rawPages = Array.isArray(res.text) ? res.text : [String(res.text ?? "")];
      const pages: PdfExtractedPage[] = rawPages.map((text, idx) => ({
        page: idx + 1,
        text: String(text ?? "").trim(),
      }));
      return {
        totalPages: Math.max(res.totalPages || pages.length, pages.length),
        pages,
      };
    } catch {
      return { totalPages: 1, pages: [] };
    }
  }

  private async indexPdfPagesToFts(
    workspaceId: Principal["workspaceId"],
    asset: DocumentAsset,
    doc: { readonly id: DocumentId; readonly spaceId: SpaceId; readonly kind: string; readonly title: string },
    pages: readonly PdfExtractedPage[],
  ): Promise<void> {
    for (const p of pages) {
      if (!p.text.trim()) continue;
      await this.deps.searchConfigRepo.upsertFtsEntry({
        entityKey: `pdf:${asset.id}:p${p.page}`,
        workspaceId,
        entityType: "document",
        documentId: doc.id,
        nodeId: null,
        spaceId: doc.spaceId,
        kind: doc.kind,
        title: `${doc.title} (Page ${p.page})`,
        body: p.text,
      });
    }
  }

  async uploadPdfWorkspace(
    principal: Principal,
    input: {
      readonly filename: string;
      readonly bytes: Uint8Array;
      readonly mimeType?: string | undefined;
      readonly spaceId?: SpaceId | undefined;
      readonly title?: string | undefined;
      readonly documentId?: DocumentId | undefined;
      readonly tags?: readonly string[] | undefined;
    },
  ): Promise<UploadPdfWorkspaceResult> {
    if (input.bytes.byteLength === 0) {
      throw new InkadeError("VALIDATION_ERROR", "PDF payload is empty");
    }
    if (input.bytes.byteLength > MAX_PDF_BYTES) {
      throw new InkadeError("VALIDATION_ERROR", `PDF exceeds maximum ${MAX_PDF_BYTES} bytes`);
    }

    const cleanFilename = basename(input.filename.trim() || "document.pdf");
    const defaultTitle =
      input.title?.trim() ||
      basename(cleanFilename, extname(cleanFilename)).trim() ||
      "PDF Study";

    const allSpaces = await getAllWorkspaceSpaces(
      this.deps.spacesCache ?? this.deps.spaceRepo,
      principal.workspaceId,
    );

    let companionDoc;
    if (input.documentId) {
      companionDoc = await this.deps.documentRepo.getDocumentById(
        principal.workspaceId,
        input.documentId,
      );
      if (!companionDoc || companionDoc.trashedAt !== null) {
        throw new InkadeError("NOT_FOUND", `Document "${input.documentId}" not found`);
      }
      assertScope(
        principal.scope,
        "write",
        { spaceId: companionDoc.spaceId, kind: companionDoc.kind, tags: companionDoc.tags },
        allSpaces,
      );
    } else {
      const activeSpaces = allSpaces.filter((s) => s.archivedAt === null);
      const targetSpace =
        (input.spaceId ? activeSpaces.find((s) => s.id === input.spaceId) : undefined) ??
        activeSpaces.find((s) => s.id === DEFAULT_SPACE_IDS.research) ??
        activeSpaces.find((s) => s.slug === "research") ??
        activeSpaces[0];
      if (!targetSpace) {
        throw new InkadeError("NOT_FOUND", "No target space available for PDF workspace");
      }
      companionDoc = await this.deps.documentService.createDocument(principal, {
        spaceId: targetSpace.id,
        kind: "outline",
        title: defaultTitle,
        contentMarkdown: "",
        tags: [...new Set(["pdf", ...(input.tags ?? [])])],
        properties: { pdfPageCount: 1 },
      });
    }

    const uploaded = await this.deps.attachmentService.uploadAttachment(principal, {
      documentId: companionDoc.id,
      filename: cleanFilename,
      mimeType: "application/pdf",
      bytes: input.bytes,
    });

    const extracted = await this.extractPdfPages(input.bytes);
    const asset = await this.deps.attachmentRepo.createDocumentAsset(principal.workspaceId, {
      attachmentId: uploaded.attachment.id,
      companionDocumentId: companionDoc.id,
      assetKind: "pdf",
      pageCount: extracted.totalPages,
      annotations: [],
      extractedPages: extracted.pages,
    });

    const updatedDoc = await this.deps.documentService.updateDocument(principal, companionDoc.id, {
      properties: {
        ...(companionDoc.properties ?? {}),
        pdfAssetId: asset.id,
        pdfAttachmentId: uploaded.attachment.id,
        pdfPageCount: extracted.totalPages,
      },
      changeSummary: `Attached PDF "${cleanFilename}" (${extracted.totalPages} pages)`,
    });

    let nodes = await this.deps.outlineRepo.listOutlineNodes(updatedDoc.id);
    if (nodes.length === 0) {
      await this.deps.outlineService.createNode(principal, {
        documentId: updatedDoc.id,
        parentNodeId: null,
        contentMarkdown: `${cleanFilename} (${extracted.totalPages}p)`,
        checked: null,
        collapsed: false,
      });
      nodes = await this.deps.outlineRepo.listOutlineNodes(updatedDoc.id);
    }

    await this.indexPdfPagesToFts(principal.workspaceId, asset, updatedDoc, extracted.pages);
    this.deps.onDocumentChanged?.(principal.workspaceId, updatedDoc.id);

    this.deps.sseHub.publish({
      type: "document_asset.updated",
      workspaceId: principal.workspaceId,
      spaceId: updatedDoc.spaceId,
      documentId: updatedDoc.id,
      documentKind: updatedDoc.kind,
      tags: updatedDoc.tags,
      actorType: principal.actorType,
      payload: {
        action: "created",
        assetId: asset.id,
        companionDocumentId: updatedDoc.id,
      },
    });

    return {
      asset,
      document: updatedDoc,
      nodes,
      downloadUrl: `/api/v1/pdf-assets/${asset.id}/file`,
    };
  }

  private async assertAssetAccess(
    principal: Principal,
    asset: DocumentAsset,
    action: "read" | "write",
  ): Promise<void> {
    const allSpaces = await getAllWorkspaceSpaces(
      this.deps.spacesCache ?? this.deps.spaceRepo,
      principal.workspaceId,
    );
    if (asset.companionDocumentId) {
      const doc = await this.deps.documentRepo.getDocumentById(
        principal.workspaceId,
        asset.companionDocumentId,
      );
      if (doc) {
        assertScope(
          principal.scope,
          action,
          { spaceId: doc.spaceId, kind: doc.kind, tags: doc.tags },
          allSpaces,
        );
        return;
      }
    }
    if (action === "write" && principal.scope.permission === "read") {
      throw new InkadeError("FORBIDDEN", 'token permission "read" cannot modify PDF assets');
    }
  }

  async listPdfAssets(principal: Principal): Promise<readonly DocumentAsset[]> {
    const [assets, allSpaces] = await Promise.all([
      this.deps.attachmentRepo.listDocumentAssets(principal.workspaceId, { assetKind: "pdf" }),
      getAllWorkspaceSpaces(this.deps.spacesCache ?? this.deps.spaceRepo, principal.workspaceId),
    ]);
    const results: DocumentAsset[] = [];
    for (const asset of assets) {
      if (asset.companionDocumentId) {
        const doc = await this.deps.documentRepo.getDocumentById(
          principal.workspaceId,
          asset.companionDocumentId,
        );
        if (!doc || doc.trashedAt !== null) continue;
        try {
          assertScope(
            principal.scope,
            "read",
            { spaceId: doc.spaceId, kind: doc.kind, tags: doc.tags },
            allSpaces,
          );
        } catch {
          continue;
        }
      }
      results.push({
        ...asset,
        downloadUrl: `/api/v1/pdf-assets/${asset.id}/file`,
      });
    }
    return results;
  }

  async getPdfAssetById(principal: Principal, assetId: DocumentAssetId): Promise<DocumentAsset> {
    const asset = await this.deps.attachmentRepo.getDocumentAssetById(
      principal.workspaceId,
      assetId,
    );
    if (!asset) {
      throw new InkadeError("NOT_FOUND", `Document asset "${assetId}" not found`);
    }
    await this.assertAssetAccess(principal, asset, "read");
    return {
      ...asset,
      downloadUrl: `/api/v1/pdf-assets/${asset.id}/file`,
    };
  }

  async getPdfAssetByDocumentId(
    principal: Principal,
    documentId: DocumentId,
  ): Promise<DocumentAsset | null> {
    const doc = await this.deps.documentRepo.getDocumentById(principal.workspaceId, documentId);
    if (!doc || doc.trashedAt !== null) {
      throw new InkadeError("NOT_FOUND", `Document "${documentId}" not found`);
    }
    const allSpaces = await getAllWorkspaceSpaces(
      this.deps.spacesCache ?? this.deps.spaceRepo,
      principal.workspaceId,
    );
    assertScope(
      principal.scope,
      "read",
      { spaceId: doc.spaceId, kind: doc.kind, tags: doc.tags },
      allSpaces,
    );
    const asset = await this.deps.attachmentRepo.getDocumentAssetByDocumentId(
      principal.workspaceId,
      documentId,
    );
    if (!asset || asset.assetKind !== "pdf") return null;
    return {
      ...asset,
      downloadUrl: `/api/v1/pdf-assets/${asset.id}/file`,
    };
  }

  async downloadPdfBytes(
    principal: Principal,
    assetId: DocumentAssetId,
  ): Promise<{ readonly asset: DocumentAsset; readonly bytes: Uint8Array }> {
    const asset = await this.getPdfAssetById(principal, assetId);
    const { bytes } = await this.deps.attachmentService.downloadAttachment(
      principal,
      asset.attachmentId,
    );
    return { asset, bytes };
  }

  async createAnnotation(
    principal: Principal,
    assetId: DocumentAssetId,
    input: CreatePdfAnnotationInput,
  ): Promise<PdfAnnotationMutationResult> {
    const asset = await this.getPdfAssetById(principal, assetId);
    await this.assertAssetAccess(principal, asset, "write");

    const ts = new Date().toISOString();
    const annotationId = createId("ann" as never) as string;
    let createdNode: OutlineNode | null = null;

    if (input.createCompanionNode !== false && asset.companionDocumentId) {
      const citationUri = buildPdfCitationUri(asset.companionDocumentId, input.page, input.rects);
      const cleanQuote = input.quote.replace(/\s+/g, " ").trim();
      createdNode = await this.deps.outlineService.createNode(principal, {
        documentId: asset.companionDocumentId,
        parentNodeId: input.parentNodeId ?? null,
        contentMarkdown: `> ${cleanQuote} ([Page ${input.page}](${citationUri}))`,
        noteMarkdown: citationUri,
        checked: null,
        collapsed: false,
      });
    }

    const annotation: PdfAnnotation = {
      id: annotationId,
      page: input.page,
      rects: input.rects,
      quote: input.quote.trim(),
      color: input.color ?? "amber",
      noteNodeId: createdNode?.id ?? null,
      noteDocumentId: asset.companionDocumentId,
      createdAt: ts,
      updatedAt: ts,
    };

    const updatedAsset = await this.deps.attachmentRepo.updateDocumentAsset(
      principal.workspaceId,
      asset.id,
      {
        annotations: [...asset.annotations, annotation],
      },
    );

    this.deps.sseHub.publish({
      type: "document_asset.updated",
      workspaceId: principal.workspaceId,
      spaceId: null,
      documentId: updatedAsset.companionDocumentId ?? undefined,
      actorType: principal.actorType,
      payload: {
        action: "updated",
        assetId: updatedAsset.id,
        companionDocumentId: updatedAsset.companionDocumentId,
      },
    });

    return {
      asset: { ...updatedAsset, downloadUrl: `/api/v1/pdf-assets/${updatedAsset.id}/file` },
      annotation,
      createdNode,
    };
  }

  async updateAnnotation(
    principal: Principal,
    assetId: DocumentAssetId,
    annotationId: string,
    patch: UpdatePdfAnnotationInput,
  ): Promise<DocumentAsset> {
    const asset = await this.getPdfAssetById(principal, assetId);
    await this.assertAssetAccess(principal, asset, "write");
    const existing = asset.annotations.find((a) => a.id === annotationId);
    if (!existing) {
      throw new InkadeError("NOT_FOUND", `PDF annotation "${annotationId}" not found`);
    }
    const ts = new Date().toISOString();
    const nextAnnotations = asset.annotations.map((a) =>
      a.id === annotationId
        ? {
            ...a,
            ...(patch.color !== undefined ? { color: patch.color } : {}),
            ...(patch.quote !== undefined ? { quote: patch.quote.trim() } : {}),
            ...(patch.noteNodeId !== undefined ? { noteNodeId: patch.noteNodeId } : {}),
            updatedAt: ts,
          }
        : a,
    );
    const updated = await this.deps.attachmentRepo.updateDocumentAsset(
      principal.workspaceId,
      asset.id,
      { annotations: nextAnnotations },
    );
    return { ...updated, downloadUrl: `/api/v1/pdf-assets/${updated.id}/file` };
  }

  async deleteAnnotation(
    principal: Principal,
    assetId: DocumentAssetId,
    annotationId: string,
  ): Promise<DocumentAsset> {
    const asset = await this.getPdfAssetById(principal, assetId);
    await this.assertAssetAccess(principal, asset, "write");
    const nextAnnotations = asset.annotations.filter((a) => a.id !== annotationId);
    if (nextAnnotations.length === asset.annotations.length) {
      throw new InkadeError("NOT_FOUND", `PDF annotation "${annotationId}" not found`);
    }
    const updated = await this.deps.attachmentRepo.updateDocumentAsset(
      principal.workspaceId,
      asset.id,
      { annotations: nextAnnotations },
    );
    return { ...updated, downloadUrl: `/api/v1/pdf-assets/${updated.id}/file` };
  }

  async distillPage(
    principal: Principal,
    assetId: DocumentAssetId,
    input: PdfDistillPageInput,
  ): Promise<PdfDistillPageResult> {
    const asset = await this.getPdfAssetById(principal, assetId);
    await this.assertAssetAccess(principal, asset, "write");
    if (!asset.companionDocumentId) {
      throw new InkadeError("VALIDATION_ERROR", "PDF asset has no companion outline document");
    }

    const pageEntry = (asset.extractedPages ?? []).find((p) => p.page === input.page);
    const pageText = pageEntry?.text?.trim() ?? "";
    const settings = await this.deps.searchConfigRepo.getAiSettingsSecret(principal.workspaceId);
    const canUseLlm =
      pageText.length > 0 &&
      settings.enabled &&
      Boolean(settings.model.trim()) &&
      Boolean(settings.baseUrl.trim()) &&
      (settings.provider === "ollama" || Boolean(settings.apiKey.trim()));

    let summaryMarkdown = "";
    let usedFallback = true;

    if (canUseLlm) {
      try {
        await validateAiEndpointUrl(settings.baseUrl, {
          allowPrivateLoopback: settings.provider === "ollama",
          resolveDns: this.resolveDns,
          allowLocalForTest: this.allowLocalForTest,
        });
        const languageHint =
          input.targetLanguage === "zh-CN"
            ? "Write concise bullet summary in Simplified Chinese."
            : input.targetLanguage === "en-US"
              ? "Write concise bullet summary in English."
              : "Match the language of the PDF excerpt.";
        const model = createChatLanguageModel({
          provider: settings.provider,
          baseUrl: settings.baseUrl,
          model: settings.model,
          apiKey: settings.apiKey,
          fetchFn: this.fetchFn,
        });
        const result = await generateText({
          model,
          system: `Distill key insights from PDF page ${input.page} into one concise paragraph or bullet summary. ${languageHint}`,
          prompt: [
            input.prompt ? `Focus: ${input.prompt}` : null,
            `PDF Page ${input.page} Text:\n${pageText.slice(0, 12000)}`,
          ]
            .filter(Boolean)
            .join("\n\n"),
          temperature: settings.temperature,
        });
        if (result.text.trim()) {
          summaryMarkdown = result.text.trim();
          usedFallback = false;
        }
      } catch {
        usedFallback = true;
      }
    }

    if (!summaryMarkdown) {
      summaryMarkdown = buildFallbackPageDistillation(
        input.page,
        pageText,
        input.targetLanguage,
      );
    }

    const citationUri = buildPdfCitationUri(asset.companionDocumentId, input.page);
    const createdNode = await this.deps.outlineService.createNode(principal, {
      documentId: asset.companionDocumentId,
      parentNodeId: null,
      contentMarkdown: `[Page ${input.page}](${citationUri}) · ${summaryMarkdown.replace(/\s+/g, " ").trim()}`,
      noteMarkdown: citationUri,
      checked: null,
      collapsed: false,
      authorType: usedFallback ? "human" : "agent",
    });

    return {
      assetId: asset.id,
      page: input.page,
      summaryMarkdown,
      createdNode,
      usedFallback,
    };
  }
}
