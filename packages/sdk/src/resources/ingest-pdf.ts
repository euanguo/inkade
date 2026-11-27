import type {
  AudioTranscribeJsonInput,
  AudioTranscribeResult,
  AudioTranscribeTarget,
  CreateIngestWebhookInput,
  CreateIngestWebhookResponse,
  CreatePdfAnnotationInput,
  CreateRssFeedInput,
  DocumentAsset,
  DocumentAssetId,
  DocumentId,
  ImportCommitInput,
  ImportCommitResult,
  ImportConflictPolicy,
  ImportFormat,
  ImportPreviewInput,
  ImportPreviewResult,
  IngestWebhookId,
  IngestWebhookRecord,
  PdfAnnotationMutationResult,
  PdfDistillPageInput,
  PdfDistillPageResult,
  RssFeedId,
  RssFeedRecord,
  RssSyncResult,
  SpaceId,
  UpdateIngestWebhookInput,
  UpdatePdfAnnotationInput,
  UpdateRssFeedInput,
  UploadPdfWorkspaceResult,
  WebhookIngestPayload,
  WebhookIngestResult,
} from "@inkade/core";
import type { InkadeHttpTransport } from "../http-transport.ts";

export interface ImportMultipartInput {
  readonly format: ImportFormat;
  readonly file: Blob;
  readonly filename?: string | undefined;
  readonly targetSpaceId?: SpaceId | undefined;
  readonly conflictPolicy?: ImportConflictPolicy | undefined;
  readonly defaultTags?: readonly string[] | undefined;
}

export interface UploadPdfMultipartInput {
  readonly file: Blob;
  readonly filename?: string | undefined;
  readonly spaceId?: SpaceId | undefined;
  readonly title?: string | undefined;
  readonly documentId?: DocumentId | undefined;
  readonly tags?: readonly string[] | undefined;
}

export interface AudioTranscribeMultipartInput {
  readonly file: Blob;
  readonly filename?: string | undefined;
  readonly language?: string | undefined;
  readonly title?: string | undefined;
  readonly spaceId?: SpaceId | undefined;
  readonly target?: AudioTranscribeTarget | undefined;
  readonly documentId?: DocumentId | undefined;
  readonly dailyDate?: string | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly transcriptionEndpoint?: string | undefined;
  readonly transcriptionModel?: string | undefined;
}

function buildImportFormData(input: ImportMultipartInput): FormData {
  const fd = new FormData();
  fd.set("format", input.format);
  fd.set("file", input.file, input.filename ?? "import.bin");
  if (input.filename) fd.set("filename", input.filename);
  if (input.targetSpaceId) fd.set("targetSpaceId", input.targetSpaceId);
  if (input.conflictPolicy) fd.set("conflictPolicy", input.conflictPolicy);
  if (input.defaultTags && input.defaultTags.length > 0) {
    fd.set("defaultTags", JSON.stringify(input.defaultTags));
  }
  return fd;
}

export interface ImportResource {
  preview(input: ImportPreviewInput | ImportMultipartInput): Promise<ImportPreviewResult>;
  commit(input: ImportCommitInput | ImportMultipartInput): Promise<ImportCommitResult>;
}

export function createImportResource(transport: InkadeHttpTransport): ImportResource {
  return {
    preview(input) {
      if ("file" in input) {
        return transport.requestJson<ImportPreviewResult>("/api/v1/import/preview", {
          method: "POST",
          body: buildImportFormData(input),
        });
      }
      return transport.requestJson<ImportPreviewResult>("/api/v1/import/preview", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },

    commit(input) {
      if ("file" in input) {
        return transport.requestJson<ImportCommitResult>("/api/v1/import/commit", {
          method: "POST",
          body: buildImportFormData(input),
        });
      }
      return transport.requestJson<ImportCommitResult>("/api/v1/import/commit", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
  };
}

export interface PdfResource {
  listAssets(): Promise<readonly DocumentAsset[]>;
  upload(input: UploadPdfMultipartInput): Promise<UploadPdfWorkspaceResult>;
  getByDocument(documentId: DocumentId): Promise<{ readonly asset: DocumentAsset | null }>;
  getAsset(assetId: DocumentAssetId): Promise<DocumentAsset>;
  getFileUrl(assetId: DocumentAssetId): string;
  fetchBytes(assetId: DocumentAssetId, headers?: Record<string, string>): Promise<Uint8Array>;
  createAnnotation(
    assetId: DocumentAssetId,
    input: CreatePdfAnnotationInput,
  ): Promise<PdfAnnotationMutationResult>;
  updateAnnotation(
    assetId: DocumentAssetId,
    annotationId: string,
    input: UpdatePdfAnnotationInput,
  ): Promise<DocumentAsset>;
  deleteAnnotation(assetId: DocumentAssetId, annotationId: string): Promise<DocumentAsset>;
  distillPage(assetId: DocumentAssetId, input: PdfDistillPageInput): Promise<PdfDistillPageResult>;
}

export function createPdfResource(transport: InkadeHttpTransport): PdfResource {
  return {
    async listAssets() {
      const res = await transport.requestJson<{ readonly assets: readonly DocumentAsset[] }>(
        "/api/v1/pdf-assets",
      );
      return res.assets;
    },

    upload(input) {
      const fd = new FormData();
      fd.set("file", input.file, input.filename ?? "document.pdf");
      if (input.filename) fd.set("filename", input.filename);
      if (input.spaceId) fd.set("spaceId", input.spaceId);
      if (input.title) fd.set("title", input.title);
      if (input.documentId) fd.set("documentId", input.documentId);
      if (input.tags && input.tags.length > 0) fd.set("tags", JSON.stringify(input.tags));
      return transport.requestJson<UploadPdfWorkspaceResult>("/api/v1/pdf/upload", {
        method: "POST",
        body: fd,
      });
    },

    getByDocument(documentId) {
      return transport.requestJson<{ readonly asset: DocumentAsset | null }>(
        `/api/v1/documents/${encodeURIComponent(documentId)}/pdf-asset`,
      );
    },

    async getAsset(assetId) {
      const res = await transport.requestJson<{ readonly asset: DocumentAsset }>(
        `/api/v1/pdf-assets/${encodeURIComponent(assetId)}`,
      );
      return res.asset;
    },

    getFileUrl(assetId) {
      const { baseUrl } = transport.getConnectionConfig();
      return `${baseUrl}/api/v1/pdf-assets/${encodeURIComponent(assetId)}/file`;
    },

    async fetchBytes(assetId, headers) {
      const res = await transport.requestRaw(
        `/api/v1/pdf-assets/${encodeURIComponent(assetId)}/file`,
        headers ? { headers } : {},
      );
      return new Uint8Array(await res.arrayBuffer());
    },

    createAnnotation(assetId, input) {
      return transport.requestJson<PdfAnnotationMutationResult>(
        `/api/v1/pdf-assets/${encodeURIComponent(assetId)}/annotations`,
        {
          method: "POST",
          body: JSON.stringify(input),
        },
      );
    },

    async updateAnnotation(assetId, annotationId, input) {
      const res = await transport.requestJson<{ readonly asset: DocumentAsset }>(
        `/api/v1/pdf-assets/${encodeURIComponent(assetId)}/annotations/${encodeURIComponent(annotationId)}`,
        {
          method: "PATCH",
          body: JSON.stringify(input),
        },
      );
      return res.asset;
    },

    async deleteAnnotation(assetId, annotationId) {
      const res = await transport.requestJson<{ readonly asset: DocumentAsset }>(
        `/api/v1/pdf-assets/${encodeURIComponent(assetId)}/annotations/${encodeURIComponent(annotationId)}`,
        { method: "DELETE" },
      );
      return res.asset;
    },

    distillPage(assetId, input) {
      return transport.requestJson<PdfDistillPageResult>(
        `/api/v1/pdf-assets/${encodeURIComponent(assetId)}/distill-page`,
        {
          method: "POST",
          body: JSON.stringify(input),
        },
      );
    },
  };
}

export interface RssFeedsResource {
  list(): Promise<readonly RssFeedRecord[]>;
  create(input: CreateRssFeedInput): Promise<RssFeedRecord>;
  update(id: RssFeedId, input: UpdateRssFeedInput): Promise<RssFeedRecord>;
  delete(id: RssFeedId): Promise<void>;
  sync(id: RssFeedId): Promise<RssSyncResult>;
  syncAll(): Promise<readonly RssSyncResult[]>;
}

export function createRssFeedsResource(transport: InkadeHttpTransport): RssFeedsResource {
  return {
    async list() {
      const res = await transport.requestJson<{ readonly feeds: readonly RssFeedRecord[] }>(
        "/api/v1/rss-feeds",
      );
      return res.feeds;
    },

    async create(input) {
      const res = await transport.requestJson<{ readonly feed: RssFeedRecord }>(
        "/api/v1/rss-feeds",
        {
          method: "POST",
          body: JSON.stringify(input),
        },
      );
      return res.feed;
    },

    async update(id, input) {
      const res = await transport.requestJson<{ readonly feed: RssFeedRecord }>(
        `/api/v1/rss-feeds/${encodeURIComponent(id)}`,
        {
          method: "PATCH",
          body: JSON.stringify(input),
        },
      );
      return res.feed;
    },

    async delete(id) {
      await transport.requestJson<{ readonly deleted: boolean }>(
        `/api/v1/rss-feeds/${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
    },

    sync(id) {
      return transport.requestJson<RssSyncResult>(
        `/api/v1/rss-feeds/${encodeURIComponent(id)}/sync`,
        { method: "POST" },
      );
    },

    async syncAll() {
      const res = await transport.requestJson<{ readonly results: readonly RssSyncResult[] }>(
        "/api/v1/rss-feeds/sync",
        { method: "POST" },
      );
      return res.results;
    },
  };
}

export interface WebhooksResource {
  list(): Promise<readonly IngestWebhookRecord[]>;
  create(input: CreateIngestWebhookInput): Promise<CreateIngestWebhookResponse>;
  update(id: IngestWebhookId, input: UpdateIngestWebhookInput): Promise<IngestWebhookRecord>;
  delete(id: IngestWebhookId): Promise<void>;
  ingest(webhookToken: string, payload: WebhookIngestPayload): Promise<WebhookIngestResult>;
}

export function createWebhooksResource(transport: InkadeHttpTransport): WebhooksResource {
  return {
    async list() {
      const res = await transport.requestJson<{
        readonly webhooks: readonly IngestWebhookRecord[];
      }>("/api/v1/ingest-webhooks");
      return res.webhooks;
    },

    create(input) {
      return transport.requestJson<CreateIngestWebhookResponse>("/api/v1/ingest-webhooks", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },

    async update(id, input) {
      const res = await transport.requestJson<{ readonly webhook: IngestWebhookRecord }>(
        `/api/v1/ingest-webhooks/${encodeURIComponent(id)}`,
        {
          method: "PATCH",
          body: JSON.stringify(input),
        },
      );
      return res.webhook;
    },

    async delete(id) {
      await transport.requestJson<{ readonly deleted: boolean }>(
        `/api/v1/ingest-webhooks/${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
    },

    ingest(webhookToken, payload) {
      return transport.requestJson<WebhookIngestResult>(
        `/api/v1/ingest/${encodeURIComponent(webhookToken)}`,
        {
          method: "POST",
          body: JSON.stringify(payload),
        },
      );
    },
  };
}

export interface IngestAudioResource {
  transcribe(
    input: AudioTranscribeMultipartInput | AudioTranscribeJsonInput,
  ): Promise<AudioTranscribeResult>;
}

export function createIngestAudioResource(transport: InkadeHttpTransport): IngestAudioResource {
  return {
    transcribe(input) {
      if ("file" in input) {
        const fd = new FormData();
        fd.set("file", input.file, input.filename ?? "voice-memo.webm");
        if (input.filename) fd.set("filename", input.filename);
        if (input.language) fd.set("language", input.language);
        if (input.title) fd.set("title", input.title);
        if (input.spaceId) fd.set("spaceId", input.spaceId);
        if (input.target) fd.set("target", input.target);
        if (input.documentId) fd.set("documentId", input.documentId);
        if (input.dailyDate) fd.set("dailyDate", input.dailyDate);
        if (input.tags && input.tags.length > 0) fd.set("tags", JSON.stringify(input.tags));
        if (input.transcriptionEndpoint) {
          fd.set("transcriptionEndpoint", input.transcriptionEndpoint);
        }
        if (input.transcriptionModel) fd.set("transcriptionModel", input.transcriptionModel);
        return transport.requestJson<AudioTranscribeResult>("/api/v1/ingest/audio", {
          method: "POST",
          body: fd,
        });
      }
      return transport.requestJson<AudioTranscribeResult>("/api/v1/ingest/audio", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
  };
}
