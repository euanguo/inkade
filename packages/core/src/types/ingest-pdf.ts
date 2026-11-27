import { z } from "zod";
import {
  documentIdSchema,
  outlineNodeIdSchema,
  spaceIdSchema,
  type AttachmentId,
  type AuditBatchId,
  type DocumentAssetId,
  type DocumentId,
  type IngestWebhookId,
  type OutlineNodeId,
  type RssFeedId,
  type SpaceId,
  type WorkspaceId,
} from "../ids.ts";
import {
  documentKindSchema,
  highlightColorSchema,
  type DocumentKind,
} from "./common.ts";
import type { DocumentRecord } from "./document.ts";
import type { OutlineNode } from "./outline.ts";

export const IMPORT_FORMATS = ["obsidian", "notion", "readwise", "html", "docx"] as const;
export type ImportFormat = (typeof IMPORT_FORMATS)[number];
export const importFormatSchema = z.enum(IMPORT_FORMATS);

export const IMPORT_CONFLICT_POLICIES = ["rename", "skip", "overwrite"] as const;
export type ImportConflictPolicy = (typeof IMPORT_CONFLICT_POLICIES)[number];
export const importConflictPolicySchema = z.enum(IMPORT_CONFLICT_POLICIES);

export const importPreviewInputSchema = z
  .object({
    format: importFormatSchema,
    filename: z.string().trim().max(300).optional(),
    payloadBase64: z.string().max(40_000_000).optional(),
    payloadText: z.string().max(20_000_000).optional(),
    targetSpaceId: spaceIdSchema.optional(),
    conflictPolicy: importConflictPolicySchema.default("rename"),
    defaultTags: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  })
  .refine((v) => Boolean(v.payloadBase64 || v.payloadText), {
    message: "Either payloadBase64 or payloadText must be provided",
  });
export type ImportPreviewInput = z.input<typeof importPreviewInputSchema>;
export type ParsedImportPreviewInput = z.infer<typeof importPreviewInputSchema>;

export const importCommitInputSchema = importPreviewInputSchema;
export type ImportCommitInput = ImportPreviewInput;
export type ParsedImportCommitInput = ParsedImportPreviewInput;

export interface ImportPreviewItem {
  readonly sourcePath: string;
  readonly title: string;
  readonly kind: DocumentKind;
  readonly targetSpaceName: string;
  readonly action: "create" | "skip" | "overwrite" | "rename";
  readonly wikilinksCount: number;
  readonly attachmentCount: number;
  readonly tags: readonly string[];
  readonly schemaFieldsCount: number;
  readonly dedupeMatchedDocId?: DocumentId | null | undefined;
}

export interface ImportPreviewResult {
  readonly format: ImportFormat;
  readonly targetSpaceId: SpaceId;
  readonly conflictPolicy: ImportConflictPolicy;
  readonly totalFiles: number;
  readonly documentsToCreate: number;
  readonly documentsToUpdate: number;
  readonly documentsSkipped: number;
  readonly spacesToCreate: number;
  readonly schemaFieldsToAdd: number;
  readonly attachmentsToImport: number;
  readonly wikilinksToRebind: number;
  readonly warnings: readonly string[];
  readonly items: readonly ImportPreviewItem[];
}

export interface ImportCommitResult {
  readonly batchId: AuditBatchId;
  readonly format: ImportFormat;
  readonly createdDocumentIds: readonly DocumentId[];
  readonly updatedDocumentIds: readonly DocumentId[];
  readonly skippedCount: number;
  readonly createdSpaceIds: readonly SpaceId[];
  readonly attachmentIds: readonly AttachmentId[];
  readonly schemaUpdatedSpaceIds: readonly SpaceId[];
  readonly wikilinksReboundCount: number;
  readonly warnings: readonly string[];
}

/**
 * Strips trailing 32-hex Notion export UUID suffixes from file or folder names
 * (e.g. `"Project Roadmap 1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d"` -> `"Project Roadmap"`).
 */
export function stripNotionUuidSuffix(rawName: string): string {
  const withoutExt = rawName.replace(/\.(md|markdown|csv|html?)$/i, "");
  const stripped = withoutExt.replace(/[\s_-]+[0-9a-f]{32}$/i, "").trim();
  return stripped || withoutExt.trim() || "Untitled";
}

export const ASSET_KINDS = ["pdf", "audio"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];
export const assetKindSchema = z.enum(ASSET_KINDS);

export const pdfRectSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0).max(1),
  height: z.number().min(0).max(1),
});
export type PdfRect = z.infer<typeof pdfRectSchema>;

export const pdfAnnotationSchema = z.object({
  id: z.string().trim().min(1).max(80),
  page: z.number().int().min(1).max(10000),
  rects: z.array(pdfRectSchema).min(1).max(50),
  quote: z.string().trim().min(1).max(8000),
  color: highlightColorSchema.default("amber"),
  noteNodeId: outlineNodeIdSchema.nullable().optional(),
  noteDocumentId: documentIdSchema.nullable().optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});
export type PdfAnnotation = z.infer<typeof pdfAnnotationSchema>;
export const pdfAnnotationArraySchema = z.array(pdfAnnotationSchema);

export const pdfExtractedPageSchema = z.object({
  page: z.number().int().min(1),
  text: z.string(),
});
export const pdfExtractedPageArraySchema = z.array(pdfExtractedPageSchema);

export const createPdfAnnotationInputSchema = z.object({
  page: z.number().int().min(1).max(10000),
  rects: z.array(pdfRectSchema).min(1).max(50),
  quote: z.string().trim().min(1).max(8000),
  color: highlightColorSchema.default("amber"),
  createCompanionNode: z.boolean().default(true),
  parentNodeId: outlineNodeIdSchema.nullable().optional(),
});
export type CreatePdfAnnotationInput = z.input<typeof createPdfAnnotationInputSchema>;
export type ParsedCreatePdfAnnotationInput = z.infer<typeof createPdfAnnotationInputSchema>;

export const updatePdfAnnotationInputSchema = z.object({
  color: highlightColorSchema.optional(),
  quote: z.string().trim().min(1).max(8000).optional(),
  noteNodeId: outlineNodeIdSchema.nullable().optional(),
});
export type UpdatePdfAnnotationInput = z.infer<typeof updatePdfAnnotationInputSchema>;

export const pdfDistillPageInputSchema = z.object({
  page: z.number().int().min(1).max(10000),
  prompt: z.string().trim().max(1000).optional(),
  targetLanguage: z.enum(["zh-CN", "en-US"]).optional(),
});
export type PdfDistillPageInput = z.input<typeof pdfDistillPageInputSchema>;

export interface PdfExtractedPage {
  readonly page: number;
  readonly text: string;
}

export interface DocumentAsset {
  readonly id: DocumentAssetId;
  readonly workspaceId: WorkspaceId;
  readonly attachmentId: AttachmentId;
  readonly companionDocumentId: DocumentId | null;
  readonly assetKind: AssetKind;
  readonly pageCount: number;
  readonly annotations: readonly PdfAnnotation[];
  readonly extractedPages?: readonly PdfExtractedPage[] | undefined;
  readonly filename?: string | undefined;
  readonly mimeType?: string | undefined;
  readonly byteSize?: number | undefined;
  readonly downloadUrl?: string | undefined;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface UploadPdfWorkspaceResult {
  readonly asset: DocumentAsset;
  readonly document: DocumentRecord;
  readonly nodes: readonly OutlineNode[];
  readonly downloadUrl: string;
}

export interface PdfAnnotationMutationResult {
  readonly asset: DocumentAsset;
  readonly annotation: PdfAnnotation;
  readonly createdNode?: OutlineNode | null | undefined;
}

export interface PdfDistillPageResult {
  readonly assetId: DocumentAssetId;
  readonly page: number;
  readonly summaryMarkdown: string;
  readonly createdNode: OutlineNode;
  readonly usedFallback: boolean;
}

/**
 * Formats a viewport-independent PDF citation URI (`inkade://pdf/{docId}#page=N&rect=x,y,w,h`).
 */
export function buildPdfCitationUri(
  docId: DocumentId | string,
  page: number,
  rects?: readonly PdfRect[],
): string {
  const base = `inkade://pdf/${docId}#page=${Math.max(1, Math.floor(page))}`;
  const first = rects?.[0];
  if (!first) return base;
  const r = [first.x, first.y, first.width, first.height]
    .map((n) => Number(n.toFixed(4)))
    .join(",");
  return `${base}&rect=${r}`;
}

export interface ParsedPdfCitationUri {
  readonly docId: DocumentId;
  readonly page: number;
  readonly rect: PdfRect | null;
}

export function parsePdfCitationUri(uri: string): ParsedPdfCitationUri | null {
  const match = /^inkade:\/\/pdf\/([^#/?\s]+)#([^?\s]+)/i.exec(uri.trim());
  if (!match?.[1] || !match[2]) return null;
  const params = new URLSearchParams(match[2]);
  const pageRaw = Number.parseInt(params.get("page") ?? "", 10);
  if (!Number.isFinite(pageRaw) || pageRaw < 1) return null;

  let rect: PdfRect | null = null;
  const rectRaw = params.get("rect");
  if (rectRaw) {
    const parts = rectRaw.split(",").map((s) => Number.parseFloat(s));
    if (
      parts.length === 4 &&
      parts.every((n) => Number.isFinite(n) && n >= 0 && n <= 1)
    ) {
      rect = {
        x: parts[0]!,
        y: parts[1]!,
        width: parts[2]!,
        height: parts[3]!,
      };
    }
  }

  return {
    docId: match[1] as DocumentId,
    page: pageRaw,
    rect,
  };
}

/**
 * Formats an Outliner node deep link (`inkade://doc/{docId}#node={nodeId}`).
 */
export function buildOutlineBlockDeepLink(
  docId: DocumentId | string,
  nodeId: OutlineNodeId | string,
): string {
  return `inkade://doc/${docId}#node=${nodeId}`;
}

export function parseOutlineBlockDeepLink(
  uri: string,
): { readonly docId: DocumentId; readonly nodeId: OutlineNodeId } | null {
  const match = /^inkade:\/\/doc\/([^#/?\s]+)#node=([^\s&]+)/i.exec(uri.trim());
  if (!match?.[1] || !match[2]) return null;
  return {
    docId: match[1] as DocumentId,
    nodeId: match[2] as OutlineNodeId,
  };
}

// ---------------------------------------------------------------------------
// Omnichannel Ingest: RSS Feeds, Private Webhooks, Voice Transcription
// ---------------------------------------------------------------------------

export interface RssFeedRecord {
  readonly id: RssFeedId;
  readonly workspaceId: WorkspaceId;
  readonly url: string;
  readonly title: string;
  readonly targetSpaceId: SpaceId;
  readonly enabled: boolean;
  readonly etag: string | null;
  readonly lastModified: string | null;
  readonly lastFetchedAt: string | null;
  readonly lastError: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export const createRssFeedInputSchema = z.object({
  url: z.url().max(2000),
  title: z.string().trim().min(1).max(200).optional(),
  targetSpaceId: spaceIdSchema.optional(),
  enabled: z.boolean().default(true),
});
export type CreateRssFeedInput = z.input<typeof createRssFeedInputSchema>;
export type ParsedCreateRssFeedInput = z.infer<typeof createRssFeedInputSchema>;

export const updateRssFeedInputSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  targetSpaceId: spaceIdSchema.optional(),
  enabled: z.boolean().optional(),
});
export type UpdateRssFeedInput = z.infer<typeof updateRssFeedInputSchema>;

export interface RssSyncResult {
  readonly feed: RssFeedRecord;
  readonly fetchedCount: number;
  readonly createdCount: number;
  readonly skippedCount: number;
  readonly notModified: boolean;
  readonly createdDocumentIds: readonly DocumentId[];
}

export interface IngestWebhookRecord {
  readonly id: IngestWebhookId;
  readonly workspaceId: WorkspaceId;
  readonly name: string;
  readonly tokenPrefix: string;
  readonly targetSpaceId: SpaceId;
  readonly defaultKind: DocumentKind;
  readonly tags: readonly string[];
  readonly enabled: boolean;
  readonly lastUsedAt: string | null;
  readonly createdAt: string;
}

export const createIngestWebhookInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  targetSpaceId: spaceIdSchema.optional(),
  defaultKind: documentKindSchema.default("clip"),
  tags: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  enabled: z.boolean().default(true),
});
export type CreateIngestWebhookInput = z.input<typeof createIngestWebhookInputSchema>;
export type ParsedCreateIngestWebhookInput = z.infer<typeof createIngestWebhookInputSchema>;

export const updateIngestWebhookInputSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  targetSpaceId: spaceIdSchema.optional(),
  defaultKind: documentKindSchema.optional(),
  tags: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  enabled: z.boolean().optional(),
});
export type UpdateIngestWebhookInput = z.infer<typeof updateIngestWebhookInputSchema>;

export interface CreateIngestWebhookResponse {
  readonly webhook: IngestWebhookRecord;
  readonly rawToken: string;
  readonly ingestPath: string;
}

export const webhookIngestPayloadSchema = z
  .object({
    title: z.string().trim().max(500).optional(),
    contentMarkdown: z.string().max(1_000_000).optional(),
    text: z.string().max(1_000_000).optional(),
    url: z.url().max(2000).optional(),
    tags: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
    kind: documentKindSchema.optional(),
    properties: z.record(z.string(), z.unknown()).optional(),
    sourceMeta: z.record(z.string(), z.unknown()).optional(),
  })
  .refine(
    (v) => Boolean(v.contentMarkdown?.trim() || v.text?.trim() || v.url?.trim() || v.title?.trim()),
    { message: "Webhook payload must provide contentMarkdown, text, title, or url" },
  );
export type WebhookIngestPayload = z.input<typeof webhookIngestPayloadSchema>;
export type ParsedWebhookIngestPayload = z.infer<typeof webhookIngestPayloadSchema>;

export interface WebhookIngestResult {
  readonly webhookId: IngestWebhookId;
  readonly document: DocumentRecord;
  readonly batchId: AuditBatchId;
}

export const audioTranscribeTargetSchema = z.enum(["clip", "daily", "document"]);
export type AudioTranscribeTarget = z.infer<typeof audioTranscribeTargetSchema>;

export const audioTranscribeJsonInputSchema = z.object({
  filename: z.string().trim().min(1).max(255).default("voice-memo.webm"),
  mimeType: z.string().trim().min(1).max(120).default("audio/webm"),
  contentBase64: z.string().min(1).max(40_000_000),
  language: z.string().trim().max(24).optional(),
  title: z.string().trim().max(300).optional(),
  spaceId: spaceIdSchema.optional(),
  target: audioTranscribeTargetSchema.default("clip"),
  documentId: documentIdSchema.optional(),
  dailyDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  tags: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  transcriptionEndpoint: z.url().max(500).optional(),
  transcriptionModel: z.string().trim().max(120).optional(),
});
export type AudioTranscribeJsonInput = z.input<typeof audioTranscribeJsonInputSchema>;

export interface AudioTranscribeResult {
  readonly text: string;
  readonly language: string | null;
  readonly durationSec: number | null;
  readonly attachmentId: AttachmentId;
  readonly assetId: DocumentAssetId;
  readonly document?: DocumentRecord | null | undefined;
  readonly node?: OutlineNode | null | undefined;
}

export const createMirrorNodeInputSchema = z.object({
  targetDocumentId: documentIdSchema,
  parentNodeId: outlineNodeIdSchema.nullable().default(null),
  afterNodeId: outlineNodeIdSchema.nullable().optional(),
  beforeNodeId: outlineNodeIdSchema.nullable().optional(),
});
export type CreateMirrorNodeInput = z.input<typeof createMirrorNodeInputSchema>;
