import type { Context, Hono } from "hono";
import {
  asDocumentAssetId,
  asDocumentId,
  asIngestWebhookId,
  asRssFeedId,
  asSpaceId,
  audioTranscribeJsonInputSchema,
  createIngestWebhookInputSchema,
  createPdfAnnotationInputSchema,
  createRssFeedInputSchema,
  importCommitInputSchema,
  importConflictPolicySchema,
  importFormatSchema,
  importPreviewInputSchema,
  InkadeError,
  pdfDistillPageInputSchema,
  updateIngestWebhookInputSchema,
  updatePdfAnnotationInputSchema,
  updateRssFeedInputSchema,
  webhookIngestPayloadSchema,
} from "@inkade/core";
import type { InkadeServices } from "../../services/index.ts";
import type { InkadeAppEnv } from "../../types.ts";
import { zValidate } from "../validation.ts";

const MAX_WEBHOOK_BODY_BYTES = 1024 * 1024;

function parseTagsCsvOrJson(raw: FormDataEntryValue | null): string[] | undefined {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((v) => String(v).trim()).filter(Boolean);
      }
    } catch {
      // fall back to comma split
    }
  }
  return trimmed
    .split(/[,\s]+/)
    .map((t) => t.trim().replace(/^#+/, ""))
    .filter(Boolean);
}

async function parseImportMultipartOrJson(c: {
  req: {
    header: (name: string) => string | undefined;
    formData: () => Promise<FormData>;
    json: <T = unknown>() => Promise<T>;
  };
}) {
  const contentType = c.req.header("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const fd = await c.req.formData();
    const rawFormat = fd.get("format") ?? fd.get("sourceType");
    const formatParsed = importFormatSchema.safeParse(rawFormat);
    if (!formatParsed.success) {
      throw new InkadeError("VALIDATION_ERROR", "Valid import format is required");
    }
    const fileEntry = fd.get("file");
    const payloadTextEntry = fd.get("payloadText");
    let payloadBase64: string | undefined;
    let payloadText: string | undefined;
    let filename: string | undefined;

    if (fileEntry instanceof Blob) {
      const bytes = new Uint8Array(await fileEntry.arrayBuffer());
      payloadBase64 = Buffer.from(bytes).toString("base64");
      filename =
        (typeof fd.get("filename") === "string" && (fd.get("filename") as string).trim()) ||
        (fileEntry instanceof File && fileEntry.name ? fileEntry.name : "upload");
    } else if (typeof payloadTextEntry === "string" && payloadTextEntry.trim()) {
      payloadText = payloadTextEntry;
    } else {
      throw new InkadeError("VALIDATION_ERROR", 'Multipart field "file" or "payloadText" is required');
    }

    const spaceIdRaw = fd.get("targetSpaceId");
    const conflictRaw = fd.get("conflictPolicy");
    const conflictPolicy =
      typeof conflictRaw === "string" && conflictRaw.trim()
        ? importConflictPolicySchema.parse(conflictRaw.trim())
        : "rename";
    const defaultTags = parseTagsCsvOrJson(fd.get("defaultTags"));

    return importPreviewInputSchema.parse({
      format: formatParsed.data,
      ...(filename ? { filename } : {}),
      ...(payloadBase64 ? { payloadBase64 } : {}),
      ...(payloadText ? { payloadText } : {}),
      ...(typeof spaceIdRaw === "string" && spaceIdRaw.trim()
        ? { targetSpaceId: asSpaceId(spaceIdRaw.trim()) }
        : {}),
      conflictPolicy,
      ...(defaultTags ? { defaultTags } : {}),
    });
  }

  const rawJson: unknown = await c.req.json().catch(() => null);
  const normalizedJson =
    rawJson && typeof rawJson === "object" && !Array.isArray(rawJson)
      ? {
          ...(rawJson as Record<string, unknown>),
          format:
            (rawJson as Record<string, unknown>).format ??
            (rawJson as Record<string, unknown>).sourceType,
        }
      : rawJson;
  const parsed = importPreviewInputSchema.safeParse(normalizedJson);
  if (!parsed.success) {
    throw new InkadeError("VALIDATION_ERROR", "Invalid import payload", {
      issues: parsed.error.issues,
    });
  }
  return parsed.data;
}

function parseByteRangeHeader(
  rangeHeader: string | undefined,
  totalLength: number,
): { readonly start: number; readonly end: number } | null {
  if (!rangeHeader) return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
  if (!match) return null;
  const startRaw = match[1] ?? "";
  const endRaw = match[2] ?? "";
  if (!startRaw && !endRaw) return null;

  let start = startRaw ? Number.parseInt(startRaw, 10) : 0;
  let end = endRaw ? Number.parseInt(endRaw, 10) : totalLength - 1;
  if (!startRaw && endRaw) {
    const suffixLen = Number.parseInt(endRaw, 10);
    start = Math.max(0, totalLength - suffixLen);
    end = totalLength - 1;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end || start >= totalLength) {
    return null;
  }
  return { start, end: Math.min(end, totalLength - 1) };
}

export function registerPublicIngestRoutes(
  router: Hono<InkadeAppEnv>,
  services: InkadeServices,
): void {
  router.post("/ingest/:webhookToken", async (c, next) => {
    const webhookToken = c.req.param("webhookToken");
    if (webhookToken === "audio") {
      return next();
    }
    const contentLength = Number(c.req.header("content-length") ?? 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_WEBHOOK_BODY_BYTES) {
      throw new InkadeError(
        "VALIDATION_ERROR",
        `Webhook payload exceeds maximum ${MAX_WEBHOOK_BODY_BYTES} bytes`,
      );
    }

    const rawText = await c.req.text();
    if (Buffer.byteLength(rawText, "utf8") > MAX_WEBHOOK_BODY_BYTES) {
      throw new InkadeError(
        "VALIDATION_ERROR",
        `Webhook payload exceeds maximum ${MAX_WEBHOOK_BODY_BYTES} bytes`,
      );
    }

    const contentType = c.req.header("content-type") ?? "";
    let candidate: unknown;
    if (contentType.includes("application/json") || rawText.trim().startsWith("{")) {
      try {
        candidate = JSON.parse(rawText);
      } catch {
        throw new InkadeError("VALIDATION_ERROR", "Malformed JSON webhook body");
      }
    } else {
      candidate = { contentMarkdown: rawText };
    }

    const parsed = webhookIngestPayloadSchema.safeParse(candidate);
    if (!parsed.success) {
      throw new InkadeError("VALIDATION_ERROR", "Invalid webhook ingest payload", {
        issues: parsed.error.issues,
      });
    }

    const result = await services.ingest.ingestByWebhookToken(webhookToken, parsed.data);
    return c.json(result, 201);
  });
}

export function registerIngestAndPdfRoutes(
  router: Hono<InkadeAppEnv>,
  services: InkadeServices,
): void {
  // -------------------------------------------------------------------------
  // Import Hub
  // -------------------------------------------------------------------------
  const handleImportPreview = async (c: Context<InkadeAppEnv>) => {
    const input = await parseImportMultipartOrJson(c);
    const preview = await services.importHub.previewImport(c.get("principal"), input);
    return c.json(preview);
  };
  const handleImportCommit = async (c: Context<InkadeAppEnv>) => {
    const input = await parseImportMultipartOrJson(c);
    const parsed = importCommitInputSchema.parse(input);
    const result = await services.importHub.commitImport(c.get("principal"), parsed);
    return c.json(result, 201);
  };

  router.post("/import/preview", handleImportPreview);
  router.post("/imports/preview", handleImportPreview);

  router.post("/import/commit", handleImportCommit);
  router.post("/imports/commit", handleImportCommit);

  // -------------------------------------------------------------------------
  // Native PDF Workspace & Coordinate Annotations
  // -------------------------------------------------------------------------
  router.get("/pdf-assets", async (c) => {
    const assets = await services.pdf.listPdfAssets(c.get("principal"));
    return c.json({ assets });
  });

  router.post("/pdf/upload", async (c) => {
    const principal = c.get("principal");
    const contentType = c.req.header("content-type") ?? "";

    if (contentType.includes("multipart/form-data")) {
      const fd = await c.req.formData();
      const fileEntry = fd.get("file");
      if (!(fileEntry instanceof Blob)) {
        throw new InkadeError("VALIDATION_ERROR", 'Multipart field "file" is required');
      }
      const bytes = new Uint8Array(await fileEntry.arrayBuffer());
      const filenameRaw = fd.get("filename");
      const filename =
        (typeof filenameRaw === "string" && filenameRaw.trim()) ||
        (fileEntry instanceof File && fileEntry.name ? fileEntry.name : "document.pdf");
      const spaceIdRaw = fd.get("spaceId");
      const titleRaw = fd.get("title");
      const docIdRaw = fd.get("documentId");
      const tags = parseTagsCsvOrJson(fd.get("tags"));

      const result = await services.pdf.uploadPdfWorkspace(principal, {
        filename,
        mimeType: fileEntry.type || "application/pdf",
        bytes,
        ...(typeof spaceIdRaw === "string" && spaceIdRaw.trim()
          ? { spaceId: asSpaceId(spaceIdRaw.trim()) }
          : {}),
        ...(typeof titleRaw === "string" && titleRaw.trim() ? { title: titleRaw.trim() } : {}),
        ...(typeof docIdRaw === "string" && docIdRaw.trim()
          ? { documentId: asDocumentId(docIdRaw.trim()) }
          : {}),
        ...(tags ? { tags } : {}),
      });
      return c.json(result, 201);
    }

    const rawJson = (await c.req.json().catch(() => null)) as {
      filename?: string;
      contentBase64?: string;
      spaceId?: string;
      title?: string;
      documentId?: string;
      tags?: string[];
    } | null;
    if (!rawJson || !rawJson.contentBase64) {
      throw new InkadeError("VALIDATION_ERROR", "contentBase64 or multipart file is required");
    }
    const cleanB64 = rawJson.contentBase64.includes(",")
      ? rawJson.contentBase64.slice(rawJson.contentBase64.indexOf(",") + 1)
      : rawJson.contentBase64;
    const buf = Buffer.from(cleanB64, "base64");
    const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    const result = await services.pdf.uploadPdfWorkspace(principal, {
      filename: rawJson.filename?.trim() || "document.pdf",
      bytes,
      ...(rawJson.spaceId ? { spaceId: asSpaceId(rawJson.spaceId) } : {}),
      ...(rawJson.title ? { title: rawJson.title } : {}),
      ...(rawJson.documentId ? { documentId: asDocumentId(rawJson.documentId) } : {}),
      ...(rawJson.tags ? { tags: rawJson.tags } : {}),
    });
    return c.json(result, 201);
  });

  router.get("/documents/:id/pdf-asset", async (c) => {
    const asset = await services.pdf.getPdfAssetByDocumentId(
      c.get("principal"),
      asDocumentId(c.req.param("id")),
    );
    return c.json({ asset });
  });

  router.get("/pdf-assets/:assetId", async (c) => {
    const asset = await services.pdf.getPdfAssetById(
      c.get("principal"),
      asDocumentAssetId(c.req.param("assetId")),
    );
    return c.json({ asset });
  });

  router.get("/pdf-assets/:assetId/file", async (c) => {
    const { asset, bytes } = await services.pdf.downloadPdfBytes(
      c.get("principal"),
      asDocumentAssetId(c.req.param("assetId")),
    );
    const range = parseByteRangeHeader(c.req.header("range"), bytes.byteLength);
    const safeName = (asset.filename ?? "document.pdf").replace(/"/g, "");
    if (range) {
      const slice = bytes.slice(range.start, range.end + 1);
      return new Response(slice, {
        status: 206,
        headers: {
          "content-type": "application/pdf",
          "accept-ranges": "bytes",
          "content-range": `bytes ${range.start}-${range.end}/${bytes.byteLength}`,
          "content-length": String(slice.byteLength),
          "content-disposition": `inline; filename="${safeName}"`,
        },
      });
    }
    const body = new Uint8Array(bytes.byteLength);
    body.set(bytes);
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "accept-ranges": "bytes",
        "content-length": String(bytes.byteLength),
        "content-disposition": `inline; filename="${safeName}"`,
      },
    });
  });

  router.post(
    "/pdf-assets/:assetId/annotations",
    zValidate("json", createPdfAnnotationInputSchema),
    async (c) => {
      const result = await services.pdf.createAnnotation(
        c.get("principal"),
        asDocumentAssetId(c.req.param("assetId")),
        c.req.valid("json"),
      );
      return c.json(result, 201);
    },
  );

  router.patch(
    "/pdf-assets/:assetId/annotations/:annotationId",
    zValidate("json", updatePdfAnnotationInputSchema),
    async (c) => {
      const asset = await services.pdf.updateAnnotation(
        c.get("principal"),
        asDocumentAssetId(c.req.param("assetId")),
        c.req.param("annotationId"),
        c.req.valid("json"),
      );
      return c.json({ asset });
    },
  );

  router.delete("/pdf-assets/:assetId/annotations/:annotationId", async (c) => {
    const asset = await services.pdf.deleteAnnotation(
      c.get("principal"),
      asDocumentAssetId(c.req.param("assetId")),
      c.req.param("annotationId"),
    );
    return c.json({ asset });
  });

  router.post(
    "/pdf-assets/:assetId/distill-page",
    zValidate("json", pdfDistillPageInputSchema),
    async (c) => {
      const result = await services.pdf.distillPage(
        c.get("principal"),
        asDocumentAssetId(c.req.param("assetId")),
        c.req.valid("json"),
      );
      return c.json(result, 201);
    },
  );

  // -------------------------------------------------------------------------
  // RSS / Atom / JSON Feeds
  // -------------------------------------------------------------------------
  router.get("/rss-feeds", async (c) => {
    const feeds = await services.ingest.listFeeds(c.get("principal"));
    return c.json({ feeds });
  });

  router.post("/rss-feeds", zValidate("json", createRssFeedInputSchema), async (c) => {
    const feed = await services.ingest.createFeed(c.get("principal"), c.req.valid("json"));
    return c.json({ feed }, 201);
  });

  router.patch("/rss-feeds/:id", zValidate("json", updateRssFeedInputSchema), async (c) => {
    const feed = await services.ingest.updateFeed(
      c.get("principal"),
      asRssFeedId(c.req.param("id")),
      c.req.valid("json"),
    );
    return c.json({ feed });
  });

  router.delete("/rss-feeds/:id", async (c) => {
    const id = asRssFeedId(c.req.param("id"));
    await services.ingest.deleteFeed(c.get("principal"), id);
    return c.json({ deleted: true, id });
  });

  router.post("/rss-feeds/:id/sync", async (c) => {
    const result = await services.ingest.syncFeed(
      c.get("principal"),
      asRssFeedId(c.req.param("id")),
    );
    return c.json(result);
  });

  router.post("/rss-feeds/sync", async (c) => {
    const results = await services.ingest.syncAllEnabledFeeds(c.get("principal"));
    return c.json({ results });
  });

  // -------------------------------------------------------------------------
  // Private Ingest Webhooks
  // -------------------------------------------------------------------------
  router.get("/ingest-webhooks", async (c) => {
    const webhooks = await services.ingest.listWebhooks(c.get("principal"));
    return c.json({ webhooks });
  });

  router.post(
    "/ingest-webhooks",
    zValidate("json", createIngestWebhookInputSchema),
    async (c) => {
      const created = await services.ingest.createWebhook(c.get("principal"), c.req.valid("json"));
      return c.json(created, 201);
    },
  );

  router.patch(
    "/ingest-webhooks/:id",
    zValidate("json", updateIngestWebhookInputSchema),
    async (c) => {
      const webhook = await services.ingest.updateWebhook(
        c.get("principal"),
        asIngestWebhookId(c.req.param("id")),
        c.req.valid("json"),
      );
      return c.json({ webhook });
    },
  );

  router.delete("/ingest-webhooks/:id", async (c) => {
    const id = asIngestWebhookId(c.req.param("id"));
    await services.ingest.deleteWebhook(c.get("principal"), id);
    return c.json({ deleted: true, id });
  });

  // -------------------------------------------------------------------------
  // Voice Memo Transcription
  // -------------------------------------------------------------------------
  router.post("/ingest/audio", async (c) => {
    const principal = c.get("principal");
    const contentType = c.req.header("content-type") ?? "";

    if (contentType.includes("multipart/form-data")) {
      const fd = await c.req.formData();
      const fileEntry = fd.get("file");
      if (!(fileEntry instanceof Blob)) {
        throw new InkadeError("VALIDATION_ERROR", 'Multipart field "file" is required');
      }
      const bytes = new Uint8Array(await fileEntry.arrayBuffer());
      const filenameRaw = fd.get("filename");
      const filename =
        (typeof filenameRaw === "string" && filenameRaw.trim()) ||
        (fileEntry instanceof File && fileEntry.name ? fileEntry.name : "voice-memo.webm");
      const spaceIdRaw = fd.get("spaceId");
      const docIdRaw = fd.get("documentId");
      const targetRaw = fd.get("target");
      const target =
        targetRaw === "daily" || targetRaw === "document" || targetRaw === "clip"
          ? targetRaw
          : "clip";
      const result = await services.ingest.transcribeAudioAndSave(principal, {
        filename,
        mimeType: fileEntry.type || "audio/webm",
        bytes,
        target,
        ...(typeof fd.get("language") === "string" ? { language: fd.get("language") as string } : {}),
        ...(typeof fd.get("title") === "string" ? { title: fd.get("title") as string } : {}),
        ...(typeof spaceIdRaw === "string" && spaceIdRaw.trim()
          ? { spaceId: asSpaceId(spaceIdRaw.trim()) }
          : {}),
        ...(typeof docIdRaw === "string" && docIdRaw.trim()
          ? { documentId: asDocumentId(docIdRaw.trim()) }
          : {}),
        ...(typeof fd.get("dailyDate") === "string"
          ? { dailyDate: fd.get("dailyDate") as string }
          : {}),
        ...(parseTagsCsvOrJson(fd.get("tags"))
          ? { tags: parseTagsCsvOrJson(fd.get("tags")) }
          : {}),
        ...(typeof fd.get("transcriptionEndpoint") === "string" &&
        (fd.get("transcriptionEndpoint") as string).trim()
          ? { transcriptionEndpoint: (fd.get("transcriptionEndpoint") as string).trim() }
          : {}),
        ...(typeof fd.get("transcriptionModel") === "string" &&
        (fd.get("transcriptionModel") as string).trim()
          ? { transcriptionModel: (fd.get("transcriptionModel") as string).trim() }
          : {}),
      });
      return c.json(result, 201);
    }

    const rawJson: unknown = await c.req.json().catch(() => null);
    const parsed = audioTranscribeJsonInputSchema.safeParse(rawJson);
    if (!parsed.success) {
      throw new InkadeError("VALIDATION_ERROR", "Invalid audio transcription payload", {
        issues: parsed.error.issues,
      });
    }
    const cleanB64 = parsed.data.contentBase64.includes(",")
      ? parsed.data.contentBase64.slice(parsed.data.contentBase64.indexOf(",") + 1)
      : parsed.data.contentBase64;
    const buf = Buffer.from(cleanB64, "base64");
    const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    const result = await services.ingest.transcribeAudioAndSave(principal, {
      ...parsed.data,
      bytes,
    });
    return c.json(result, 201);
  });
}
