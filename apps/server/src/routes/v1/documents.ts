import type { Hono } from "hono";
import { z } from "zod";
import {
  asAttachmentId,
  asDocumentId,
  asHighlightId,
  asShareLinkId,
  asSpaceId,
  createDocumentHighlightInputSchema,
  createDocumentInputSchema,
  createHighlightCommentInputSchema,
  createShareLinkInputSchema,
  dailyDateSchema,
  DOCX_MIME_TYPE,
  highlightStatusSchema,
  importConflictPolicySchema,
  InkadeError,
  linkDocumentTargetInputSchema,
  patchDocumentSectionInputSchema,
  scaffoldDocumentInputSchema,
  sendHighlightToAgentInputSchema,
  updateDocumentHighlightInputSchema,
  updateDocumentInputSchema,
} from "@inkade/core";
import type { InkadeServices } from "../../services/index.ts";
import type { InkadeAppEnv } from "../../types.ts";
import { zValidate } from "../validation.ts";
import {
  attachmentJsonBodySchema,
  deleteDocumentQuerySchema,
  documentGraphQuerySchema,
  exportDocumentQuerySchema,
  listAttachmentsQuerySchema,
  listDocumentsQuerySchema,
  listShareLinksQuerySchema,
  relatedDocumentsQuerySchema,
  revisionDiffQuerySchema,
} from "./schemas.ts";

export function registerDocumentRoutes(
  router: Hono<InkadeAppEnv>,
  services: InkadeServices,
): void {
  router.get("/documents", zValidate("query", listDocumentsQuerySchema), async (c) => {
    const query = c.req.valid("query");
    const items = await services.document.listDocuments(c.get("principal"), query);
    return c.json({ documents: items });
  });

  router.post("/documents", zValidate("json", createDocumentInputSchema), async (c) => {
    const principal = c.get("principal");
    const doc = await services.document.createDocument(principal, c.req.valid("json"));
    const schemaValidation = await services.document.getSchemaValidationHints(
      principal,
      doc.spaceId,
      doc.properties,
    );
    return c.json({ document: doc, ...(schemaValidation ? { schemaValidation } : {}) }, 201);
  });

  router.post("/documents/scaffold", zValidate("json", scaffoldDocumentInputSchema), async (c) => {
    const principal = c.get("principal");
    const doc = await services.document.scaffoldDocument(principal, c.req.valid("json"));
    const schemaValidation = await services.document.getSchemaValidationHints(
      principal,
      doc.spaceId,
      doc.properties,
    );
    return c.json({ document: doc, ...(schemaValidation ? { schemaValidation } : {}) }, 201);
  });

  router.get(
    "/documents/daily/:date",
    zValidate("param", z.object({ date: dailyDateSchema })),
    async (c) => {
      const { date } = c.req.valid("param");
      const result = await services.outline.getOrCreateDailyOutline(c.get("principal"), date);
      return c.json(result);
    },
  );

  router.get("/documents/:id", async (c) => {
    const doc = await services.document.getDocument(
      c.get("principal"),
      asDocumentId(c.req.param("id")),
    );
    return c.json({ document: doc });
  });

  router.patch("/documents/:id", zValidate("json", updateDocumentInputSchema), async (c) => {
    const principal = c.get("principal");
    const doc = await services.document.updateDocument(
      principal,
      asDocumentId(c.req.param("id")),
      c.req.valid("json"),
    );
    const schemaValidation = await services.document.getSchemaValidationHints(
      principal,
      doc.spaceId,
      doc.properties,
    );
    return c.json({ document: doc, ...(schemaValidation ? { schemaValidation } : {}) });
  });

  router.delete("/documents/:id", zValidate("query", deleteDocumentQuerySchema), async (c) => {
    const { hard } = c.req.valid("query");
    const id = asDocumentId(c.req.param("id"));
    if (hard) {
      await services.document.hardDeleteDocument(c.get("principal"), id);
      return c.json({ deleted: true, id });
    }
    const document = await services.document.trashDocument(c.get("principal"), id);
    return c.json({ document });
  });

  router.post(
    "/documents/:id/patch-section",
    zValidate("json", patchDocumentSectionInputSchema),
    async (c) => {
      const document = await services.document.patchDocumentSection(
        c.get("principal"),
        asDocumentId(c.req.param("id")),
        c.req.valid("json"),
      );
      return c.json({ document });
    },
  );

  router.get("/documents/:id/revisions", async (c) => {
    const revisions = await services.document.listRevisions(
      c.get("principal"),
      asDocumentId(c.req.param("id")),
    );
    return c.json({ revisions });
  });

  router.get(
    "/documents/:id/revisions/diff",
    zValidate("query", revisionDiffQuerySchema),
    async (c) => {
      const { from, to } = c.req.valid("query");
      const result = await services.document.getRevisionDiff(
        c.get("principal"),
        asDocumentId(c.req.param("id")),
        from,
        to,
      );
      return c.json(result);
    },
  );

  router.post(
    "/documents/:id/revisions/:version/restore",
    zValidate("param", z.object({ id: z.string().min(1), version: z.coerce.number().int().positive() })),
    async (c) => {
      const { id, version } = c.req.valid("param");
      const document = await services.document.restoreRevision(
        c.get("principal"),
        asDocumentId(id),
        version,
      );
      return c.json({ document });
    },
  );

  router.post("/documents/:id/trash", async (c) => {
    const document = await services.document.trashDocument(
      c.get("principal"),
      asDocumentId(c.req.param("id")),
    );
    return c.json({ document });
  });

  router.post("/documents/:id/restore", async (c) => {
    const document = await services.document.restoreDocument(
      c.get("principal"),
      asDocumentId(c.req.param("id")),
    );
    return c.json({ document });
  });

  router.post("/documents/:id/read-agent-update", async (c) => {
    const document = await services.document.markAgentUpdateRead(
      c.get("principal"),
      asDocumentId(c.req.param("id")),
    );
    return c.json({ document });
  });

  router.post("/documents/:id/acknowledge-silent", async (c) => {
    const document = await services.document.acknowledgeSilent(
      c.get("principal"),
      asDocumentId(c.req.param("id")),
    );
    return c.json({ document });
  });

  router.get("/documents/:id/backlinks", async (c) => {
    const backlinks = await services.document.listBacklinks(
      c.get("principal"),
      asDocumentId(c.req.param("id")),
    );
    return c.json({ backlinks });
  });

  router.get("/documents/:id/unlinked-mentions", async (c) => {
    const mentions = await services.workspace.findUnlinkedMentions(
      c.get("principal"),
      asDocumentId(c.req.param("id")),
    );
    return c.json({ mentions });
  });

  router.get("/documents/:id/graph", zValidate("query", documentGraphQuerySchema), async (c) => {
    const { depth } = c.req.valid("query");
    const graph = await services.workspace.getDocumentGraph(
      c.get("principal"),
      asDocumentId(c.req.param("id")),
      depth,
    );
    return c.json(graph);
  });

  router.post(
    "/documents/:id/link-target",
    zValidate("json", linkDocumentTargetInputSchema),
    async (c) => {
      const result = await services.document.linkDocumentTarget(
        c.get("principal"),
        asDocumentId(c.req.param("id")),
        c.req.valid("json").targetDocumentId,
      );
      return c.json(result);
    },
  );

  router.get(
    "/documents/:id/related",
    zValidate("query", relatedDocumentsQuerySchema),
    async (c) => {
      const { limit } = c.req.valid("query");
      const related = await services.semanticSearch.getRelatedDocuments(
        c.get("principal"),
        asDocumentId(c.req.param("id")),
        limit,
      );
      return c.json({ related });
    },
  );

  router.get("/documents/:id/highlights", async (c) => {
    const highlights = await services.highlight.listHighlights(
      c.get("principal"),
      asDocumentId(c.req.param("id")),
    );
    return c.json({ highlights });
  });

  router.post(
    "/documents/:id/highlights",
    zValidate("json", createDocumentHighlightInputSchema),
    async (c) => {
      const highlight = await services.highlight.createHighlight(
        c.get("principal"),
        asDocumentId(c.req.param("id")),
        c.req.valid("json"),
      );
      return c.json({ highlight }, 201);
    },
  );

  router.patch(
    "/highlights/:id",
    zValidate("json", updateDocumentHighlightInputSchema),
    async (c) => {
      const highlight = await services.highlight.updateHighlight(
        c.get("principal"),
        asHighlightId(c.req.param("id")),
        c.req.valid("json"),
      );
      return c.json({ highlight });
    },
  );

  router.delete("/highlights/:id", async (c) => {
    const id = asHighlightId(c.req.param("id"));
    await services.highlight.deleteHighlight(c.get("principal"), id);
    return c.json({ deleted: true, id });
  });

  router.get("/documents/:id/comment-threads", async (c) => {
    const rawStatus = c.req.query("status");
    const statusParsed =
      rawStatus === "all"
        ? "all"
        : rawStatus
          ? highlightStatusSchema.parse(rawStatus)
          : "all";
    const threads = await services.highlight.listCommentThreads(
      c.get("principal"),
      asDocumentId(c.req.param("id")),
      statusParsed,
    );
    return c.json({ threads });
  });

  router.get("/highlights/:id/comments", async (c) => {
    const thread = await services.highlight.listComments(
      c.get("principal"),
      asHighlightId(c.req.param("id")),
    );
    return c.json(thread);
  });

  router.post(
    "/highlights/:id/comments",
    zValidate("json", createHighlightCommentInputSchema),
    async (c) => {
      const result = await services.highlight.addComment(
        c.get("principal"),
        asHighlightId(c.req.param("id")),
        c.req.valid("json"),
      );
      return c.json(result, 201);
    },
  );

  router.post(
    "/highlights/:id/send-to-agent",
    zValidate("json", sendHighlightToAgentInputSchema),
    async (c) => {
      const result = await services.highlight.sendHighlightToAgent(
        c.get("principal"),
        asHighlightId(c.req.param("id")),
        c.req.valid("json"),
      );
      return c.json(result);
    },
  );

  router.post("/highlights/:id/resolve", async (c) => {
    const highlight = await services.highlight.resolveHighlight(
      c.get("principal"),
      asHighlightId(c.req.param("id")),
    );
    return c.json({ highlight });
  });

  router.post("/highlights/:id/reopen", async (c) => {
    const highlight = await services.highlight.reopenHighlight(
      c.get("principal"),
      asHighlightId(c.req.param("id")),
    );
    return c.json({ highlight });
  });

  router.get("/documents/:id/export.md", async (c) => {
    const { filename, markdown } = await services.export.exportDocumentMarkdown(
      c.get("principal"),
      asDocumentId(c.req.param("id")),
    );
    return new Response(markdown, {
      status: 200,
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "content-disposition": `attachment; filename="${filename.replace(/"/g, "")}"`,
      },
    });
  });

  router.get(
    "/documents/:id/export",
    zValidate("query", exportDocumentQuerySchema),
    async (c) => {
      const { format } = c.req.valid("query");
      const docId = asDocumentId(c.req.param("id"));
      if (format === "docx") {
        const { filename, bytes } = await services.export.exportDocumentDocx(
          c.get("principal"),
          docId,
        );
        const body = new Uint8Array(bytes.byteLength);
        body.set(bytes);
        const asciiFallback =
          filename
            .replace(/[^\x20-\x7E]/g, "_")
            .replace(/["\\]/g, "_")
            .trim() || "document.docx";
        return new Response(body, {
          status: 200,
          headers: {
            "content-type": DOCX_MIME_TYPE,
            "content-length": String(bytes.byteLength),
            "content-disposition": `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
          },
        });
      }
      const { filename, markdown } = await services.export.exportDocumentMarkdown(
        c.get("principal"),
        docId,
      );
      const asciiFallback =
        filename
          .replace(/[^\x20-\x7E]/g, "_")
          .replace(/["\\]/g, "_")
          .trim() || "document.md";
      return new Response(markdown, {
        status: 200,
        headers: {
          "content-type": "text/markdown; charset=utf-8",
          "content-disposition": `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        },
      });
    },
  );

  router.post("/documents/import-docx", async (c) => {
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
        (fileEntry instanceof File && fileEntry.name ? fileEntry.name : "document.docx");
      const spaceIdRaw = fd.get("spaceId") ?? fd.get("targetSpaceId");
      const titleRaw = fd.get("title");
      const conflictRaw = fd.get("conflictPolicy");
      const tagsRaw = fd.get("tags");
      let tags: string[] | undefined;
      if (typeof tagsRaw === "string" && tagsRaw.trim()) {
        const trimmed = tagsRaw.trim();
        if (trimmed.startsWith("[")) {
          try {
            const parsed: unknown = JSON.parse(trimmed);
            if (Array.isArray(parsed)) {
              tags = parsed.map((v) => String(v).trim()).filter(Boolean);
            }
          } catch {
            tags = undefined;
          }
        }
        if (!tags) {
          tags = trimmed
            .split(/[,\s]+/)
            .map((t) => t.trim().replace(/^#+/, ""))
            .filter(Boolean);
        }
      }
      const conflictPolicy =
        typeof conflictRaw === "string" && conflictRaw.trim()
          ? importConflictPolicySchema.parse(conflictRaw.trim())
          : undefined;

      const result = await services.importHub.importSingleDocx(principal, {
        filename,
        bytes,
        ...(typeof spaceIdRaw === "string" && spaceIdRaw.trim()
          ? { spaceId: asSpaceId(spaceIdRaw.trim()) }
          : {}),
        ...(typeof titleRaw === "string" && titleRaw.trim() ? { title: titleRaw.trim() } : {}),
        ...(tags && tags.length > 0 ? { tags } : {}),
        ...(conflictPolicy ? { conflictPolicy } : {}),
      });
      return c.json(result, 201);
    }

    const rawJson = (await c.req.json().catch(() => null)) as {
      filename?: unknown;
      contentBase64?: unknown;
      payloadBase64?: unknown;
      spaceId?: unknown;
      targetSpaceId?: unknown;
      title?: unknown;
      tags?: unknown;
      conflictPolicy?: unknown;
    } | null;
    const rawB64 =
      typeof rawJson?.contentBase64 === "string"
        ? rawJson.contentBase64
        : typeof rawJson?.payloadBase64 === "string"
          ? rawJson.payloadBase64
          : "";
    if (!rawB64) {
      throw new InkadeError(
        "VALIDATION_ERROR",
        "contentBase64, payloadBase64, or multipart file is required",
      );
    }
    const cleanB64 = rawB64.includes(",") ? rawB64.slice(rawB64.indexOf(",") + 1) : rawB64;
    const buf = Buffer.from(cleanB64, "base64");
    const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    const spaceRaw =
      typeof rawJson?.spaceId === "string"
        ? rawJson.spaceId
        : typeof rawJson?.targetSpaceId === "string"
          ? rawJson.targetSpaceId
          : undefined;
    const tags = Array.isArray(rawJson?.tags)
      ? rawJson.tags.map((v) => String(v).trim()).filter(Boolean)
      : undefined;
    const conflictPolicy =
      rawJson?.conflictPolicy !== undefined
        ? importConflictPolicySchema.parse(rawJson.conflictPolicy)
        : undefined;

    const result = await services.importHub.importSingleDocx(principal, {
      filename:
        typeof rawJson?.filename === "string" && rawJson.filename.trim()
          ? rawJson.filename.trim()
          : "document.docx",
      bytes,
      ...(spaceRaw && spaceRaw.trim() ? { spaceId: asSpaceId(spaceRaw.trim()) } : {}),
      ...(typeof rawJson?.title === "string" && rawJson.title.trim()
        ? { title: rawJson.title.trim() }
        : {}),
      ...(tags && tags.length > 0 ? { tags } : {}),
      ...(conflictPolicy ? { conflictPolicy } : {}),
    });
    return c.json(result, 201);
  });

  router.get("/export/zip", async (c) => {
    const { filename, bytes } = await services.export.exportWorkspaceZip(c.get("principal"));
    const body = new Uint8Array(bytes.byteLength);
    body.set(bytes);
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${filename}"`,
      },
    });
  });

  router.get("/share-links", zValidate("query", listShareLinksQuerySchema), async (c) => {
    const shareLinks = await services.share.listShareLinks(
      c.get("principal"),
      c.req.valid("query").documentId,
    );
    return c.json({ shareLinks });
  });

  router.post("/share-links", zValidate("json", createShareLinkInputSchema), async (c) => {
    const shareLink = await services.share.createShareLink(
      c.get("principal"),
      c.req.valid("json"),
    );
    return c.json({ shareLink }, 201);
  });

  router.delete("/share-links/:id", async (c) => {
    const shareLink = await services.share.revokeShareLink(
      c.get("principal"),
      asShareLinkId(c.req.param("id")),
    );
    return c.json({ shareLink });
  });

  router.get("/attachments", zValidate("query", listAttachmentsQuerySchema), async (c) => {
    const items = await services.attachment.listAttachments(
      c.get("principal"),
      c.req.valid("query"),
    );
    return c.json({ attachments: items });
  });

  router.post("/attachments/cleanup-orphans", async (c) => {
    const result = await services.attachment.cleanupOrphans(c.get("principal"));
    return c.json(result);
  });

  router.post("/attachments", async (c) => {
    const contentType = c.req.header("content-type") ?? "";
    const principal = c.get("principal");

    if (contentType.includes("multipart/form-data")) {
      const formData = await c.req.formData();
      const fileEntry = formData.get("file");
      if (!(fileEntry instanceof Blob)) {
        throw new InkadeError("VALIDATION_ERROR", 'Multipart field "file" is required');
      }
      const docIdRaw = formData.get("documentId");
      const filenameRaw = formData.get("filename");
      const mimeTypeRaw = formData.get("mimeType");
      const inferredName =
        typeof filenameRaw === "string" && filenameRaw.trim()
          ? filenameRaw
          : fileEntry instanceof File && fileEntry.name
            ? fileEntry.name
            : "attachment.bin";
      const mimeType =
        typeof mimeTypeRaw === "string" && mimeTypeRaw.trim()
          ? mimeTypeRaw
          : fileEntry.type || "application/octet-stream";
      const bytes = new Uint8Array(await fileEntry.arrayBuffer());
      const result = await services.attachment.uploadAttachment(principal, {
        documentId:
          typeof docIdRaw === "string" && docIdRaw.trim() ? asDocumentId(docIdRaw.trim()) : null,
        filename: inferredName,
        mimeType,
        bytes,
      });
      return c.json(result, 201);
    }

    const rawJson: unknown = await c.req.json().catch(() => null);
    const parsed = attachmentJsonBodySchema.safeParse(rawJson);
    if (!parsed.success) {
      throw new InkadeError("VALIDATION_ERROR", "Invalid attachment upload payload", {
        issues: parsed.error.issues,
      });
    }

    const buffer = Buffer.from(parsed.data.contentBase64, "base64");
    const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const result = await services.attachment.uploadAttachment(principal, {
      documentId: parsed.data.documentId ?? null,
      filename: parsed.data.filename,
      mimeType: parsed.data.mimeType,
      bytes,
    });
    return c.json(result, 201);
  });

  router.get("/attachments/:id", async (c) => {
    const attachment = await services.attachment.getAttachment(
      c.get("principal"),
      asAttachmentId(c.req.param("id")),
    );
    return c.json({ attachment });
  });

  const safeInlineAttachmentMimes = new Set([
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/gif",
    "image/webp",
    "image/avif",
    "application/pdf",
  ]);

  router.get("/attachments/:id/download", async (c) => {
    const { attachment, bytes } = await services.attachment.downloadAttachment(
      c.get("principal"),
      asAttachmentId(c.req.param("id")),
    );
    const body = new Uint8Array(bytes.byteLength);
    body.set(bytes);
    const normalizedMime = attachment.mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
    const isSafeInline =
      safeInlineAttachmentMimes.has(normalizedMime) ||
      normalizedMime.startsWith("audio/") ||
      normalizedMime.startsWith("video/");
    const disposition = isSafeInline ? "inline" : "attachment";
    const rawName = attachment.filename.replace(/[\r\n"]/g, "") || "attachment.bin";
    const asciiFallback = rawName.replace(/[^\x20-\x7e]/g, "_") || "attachment.bin";
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": attachment.mimeType || "application/octet-stream",
        "content-length": String(attachment.byteSize),
        "content-disposition": `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(rawName)}`,
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
      },
    });
  });
}
