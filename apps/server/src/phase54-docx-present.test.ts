import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync, zipSync } from "fflate";
import {
  asSpaceId,
  deriveDocumentTrustTier,
  DOCX_MIME_TYPE,
  splitMarkdownIntoSlides,
} from "@inkade/core";
import { DEFAULT_SPACE_IDS } from "@inkade/db";
import { createInkadeClient, InkadeApiError } from "@inkade/sdk";
import { createInkadeApp } from "./app.ts";
import { buildDocxBytesFromMarkdown } from "./services/docx-codec.ts";

const servers: Array<ReturnType<typeof Bun.serve>> = [];
const tempDirs: string[] = [];

const TINY_PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48,
  0x44, 0x52, 0x00, 0x00, 0x00, 0x08, 0x00, 0x00, 0x00, 0x06, 0x08, 0x06, 0x00, 0x00,
  0x00, 0x8e, 0xd4, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78,
  0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

afterAll(async () => {
  await Promise.all(servers.map((srv) => srv.stop(true)));
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

async function startPhase54Server() {
  const dir = mkdtempSync(join(tmpdir(), "inkade-phase54-test-"));
  tempDirs.push(dir);
  const instance = createInkadeApp({
    dbPath: join(dir, "inkade.sqlite"),
    dataDir: dir,
    localAutoAuth: true,
  });
  await instance.ready;
  const srv = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: instance.app.fetch });
  servers.push(srv);
  return {
    instance,
    baseUrl: `http://127.0.0.1:${srv.port}`,
  };
}

describe("Phase 54 Server: DOCX import/export interop, attachment rewrite, scope checks & slide split", () => {
  test("exports document via GET /api/v1/documents/:id/export?format=docx with embedded images, degrades Inkade blocks & hides speaker notes", async () => {
    const { baseUrl } = await startPhase54Server();
    const sdk = createInkadeClient({ baseUrl });

    // Upload an image attachment via REST
    const attFd = new FormData();
    attFd.set("file", new Blob([TINY_PNG_BYTES], { type: "image/png" }), "chart.png");
    attFd.set("filename", "chart.png");
    const attRes = await fetch(`${baseUrl}/api/v1/attachments`, {
      method: "POST",
      body: attFd,
    });
    expect(attRes.status).toBe(201);
    const attJson = (await attRes.json()) as {
      readonly attachment: { readonly id: string };
      readonly downloadUrl: string;
    };

    const reportMarkdown = [
      "# Phase 54 Architecture & Office Interop",
      "",
      "Executive summary with **strong emphasis** and [Inkade](https://inkade.dev).",
      "",
      "<!-- notes: Private presenter cue: highlight 0-GPL compliance -->",
      "",
      "## Benchmark Table",
      "",
      "| Metric | Value |",
      "| --- | --- |",
      "| License Violations | 0 |",
      "| Round-Trip | Lossless |",
      "",
      `![Chart Preview](${attJson.downloadUrl})`,
      "",
      "```inkade-pending",
      "id: sec_future",
      "label: Drafting appendix...",
      "status: queued",
      "```",
      "",
      "```inkade-view",
      "mode: table",
      "spaceId: spc_research",
      "```",
      "",
      "```inkade-artifact",
      "title: ROI Model",
      "fallbackMarkdown: Estimated savings 120 hours/year.",
      "```",
    ].join("\n");

    const doc = await sdk.documents.create({
      spaceId: asSpaceId(DEFAULT_SPACE_IDS.research),
      kind: "article",
      title: "Phase 54 Architecture & Office Interop",
      contentMarkdown: reportMarkdown,
      tags: ["phase-54", "interop"],
    });

    // 1. Export via ?format=docx (SDK & raw HTTP)
    const rawRes = await fetch(`${baseUrl}/api/v1/documents/${doc.id}/export?format=docx`);
    expect(rawRes.status).toBe(200);
    expect(rawRes.headers.get("content-type")).toBe(DOCX_MIME_TYPE);
    expect(rawRes.headers.get("content-disposition")).toContain(".docx");

    const docxBytes = await sdk.documents.exportDocx(doc.id);
    expect(docxBytes[0]).toBe(0x50);
    expect(docxBytes[1]).toBe(0x4b);

    const unzipped = unzipSync(docxBytes);
    expect(unzipped["word/document.xml"]).toBeDefined();
    expect(unzipped["word/media/image1.png"]).toEqual(TINY_PNG_BYTES);

    const docXml = new TextDecoder().decode(unzipped["word/document.xml"]);
    expect(docXml).not.toContain("Private presenter cue");
    expect(docXml).toContain("strong emphasis");
    expect(docXml).toContain("[Pending Section] Drafting appendix...");
    expect(docXml).toContain("[Inkade Live View]");
    expect(docXml).toContain("[Interactive Artifact] ROI Model");
    expect(docXml).toContain("Estimated savings 120 hours/year.");

    // 2. Existing export.md route and ?format=markdown remain intact
    const mdExport = await sdk.documents.exportMarkdown(doc.id);
    expect(mdExport).toContain("Phase 54 Architecture & Office Interop");
    const mdViaExportQuery = await fetch(
      `${baseUrl}/api/v1/documents/${doc.id}/export?format=markdown`,
    );
    expect(mdViaExportQuery.status).toBe(200);
    expect(await mdViaExportQuery.text()).toContain("Phase 54 Architecture & Office Interop");

    // 3. Import Hub preview & commit using exported .docx (including /api/v1/imports/preview alias & sourceType)
    const previewRes = await fetch(`${baseUrl}/api/v1/imports/preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sourceType: "docx",
        filename: "phase54-roundtrip.docx",
        payloadBase64: Buffer.from(docxBytes).toString("base64"),
        conflictPolicy: "rename",
      }),
    });
    expect(previewRes.status).toBe(200);
    const previewJson = (await previewRes.json()) as {
      readonly format: string;
      readonly documentsToCreate: number;
      readonly attachmentsToImport: number;
      readonly items: readonly { readonly attachmentCount: number; readonly title: string }[];
    };
    expect(previewJson.format).toBe("docx");
    expect(previewJson.documentsToCreate).toBe(1);
    expect(previewJson.attachmentsToImport).toBe(1);
    expect(previewJson.items[0]?.attachmentCount).toBe(1);

    const committed = await sdk.importHub.commit({
      format: "docx",
      filename: "phase54-roundtrip.docx",
      payloadBase64: Buffer.from(docxBytes).toString("base64"),
      targetSpaceId: asSpaceId(DEFAULT_SPACE_IDS.research),
      conflictPolicy: "rename",
    });
    expect(committed.createdDocumentIds).toHaveLength(1);
    expect(committed.attachmentIds).toHaveLength(1);

    const reimportedDoc = await sdk.documents.get(committed.createdDocumentIds[0]!);
    expect(reimportedDoc.kind).toBe("article");
    expect(deriveDocumentTrustTier(reimportedDoc)).toBe("external_ingest");
    expect(reimportedDoc.contentMarkdown.trim().startsWith(`# ${doc.title}`)).toBe(false);
    expect(reimportedDoc.contentMarkdown).toContain("/api/v1/attachments/");
    expect(reimportedDoc.contentMarkdown).toContain("**strong emphasis**");
    expect(reimportedDoc.contentMarkdown).toContain("| Metric | Value |");
    expect(reimportedDoc.contentMarkdown).toContain("[Inkade](https://inkade.dev)");

    // Verify extracted image attachment is actually stored & downloadable
    const newAttachmentId = committed.attachmentIds[0]!;
    const downloadedImgRes = await fetch(
      `${baseUrl}/api/v1/attachments/${newAttachmentId}/download`,
    );
    expect(downloadedImgRes.status).toBe(200);
    expect(new Uint8Array(await downloadedImgRes.arrayBuffer())).toEqual(TINY_PNG_BYTES);

    // Atomic batch rollback deletes imported document
    const rolled = await sdk.auditLogs.rollbackBatch(committed.batchId, { force: true });
    expect(rolled.deletedDocumentIds).toContain(reimportedDoc.id);
  });

  test("supports quick single .docx upload via POST /api/v1/documents/import-docx, ZIP of multiple .docx files, and enforces Space scope", async () => {
    const { baseUrl } = await startPhase54Server();
    const sdk = createInkadeClient({ baseUrl });

    const { bytes: sampleDocx } = buildDocxBytesFromMarkdown({
      title: "Quick Word Brief",
      markdown: [
        "# Quick Word Brief",
        "",
        "## Summary",
        "",
        "- Item A",
        "- Item B",
        "",
        "![Diagram](/api/v1/attachments/att_local_stub/download)",
      ].join("\n"),
      media: [
        {
          url: "/api/v1/attachments/att_local_stub/download",
          bytes: TINY_PNG_BYTES,
          mimeType: "image/png",
          filename: "stub.png",
        },
      ],
    });

    // Multipart upload via SDK
    const quickImported = await sdk.documents.importDocx({
      file: new Blob([new Uint8Array(sampleDocx)], { type: DOCX_MIME_TYPE }),
      filename: "quick-brief.docx",
      spaceId: asSpaceId(DEFAULT_SPACE_IDS.research),
      title: "Custom Override Title",
      tags: ["brief", "word"],
    });

    expect(quickImported.document.title).toBe("Custom Override Title");
    expect(quickImported.document.tags).toEqual(["brief", "word"]);
    expect(quickImported.document.contentMarkdown.trim().startsWith("# Quick Word Brief")).toBe(false);
    expect(quickImported.document.contentMarkdown).toContain("## Summary");
    expect(quickImported.attachmentIds).toHaveLength(1);
    expect(quickImported.document.contentMarkdown).toContain(
      `/api/v1/attachments/${quickImported.attachmentIds[0]}/download`,
    );

    // Multi-DOCX ZIP bundle import creates folder spaces cleanly without image collision
    const { bytes: docxOne } = buildDocxBytesFromMarkdown({
      title: "Alpha Report",
      markdown: "# Alpha Report\n\n![A](mem://a.png)",
      media: [{ url: "mem://a.png", bytes: TINY_PNG_BYTES, mimeType: "image/png", filename: "a.png" }],
    });
    const { bytes: docxTwo } = buildDocxBytesFromMarkdown({
      title: "Beta Report",
      markdown: "# Beta Report\n\n![B](mem://b.png)",
      media: [{ url: "mem://b.png", bytes: TINY_PNG_BYTES, mimeType: "image/png", filename: "b.png" }],
    });
    const bundleZip = zipSync({
      "Reports/Alpha.docx": docxOne,
      "Reports/Beta.docx": docxTwo,
    });
    const zipCommit = await sdk.importHub.commit({
      format: "docx",
      filename: "reports-bundle.zip",
      payloadBase64: Buffer.from(bundleZip).toString("base64"),
      targetSpaceId: asSpaceId(DEFAULT_SPACE_IDS.research),
    });
    expect(zipCommit.createdDocumentIds).toHaveLength(2);
    expect(zipCommit.attachmentIds).toHaveLength(2);
    expect(zipCommit.createdSpaceIds).toHaveLength(1);

    // Scoped token restricted to Inbox cannot export Research document as DOCX
    const issued = await sdk.tokens.create({
      name: "Inbox Only Token",
      scope: {
        spaceIds: [asSpaceId(DEFAULT_SPACE_IDS.inbox)],
        permission: "read",
      },
    });
    const scopedSdk = createInkadeClient({ baseUrl, token: issued.rawToken });
    let forbiddenErr: unknown = null;
    try {
      await scopedSdk.documents.exportDocx(quickImported.document.id);
    } catch (err) {
      forbiddenErr = err;
    }
    expect(forbiddenErr).toBeInstanceOf(InkadeApiError);
    expect((forbiddenErr as InkadeApiError).status).toBe(403);

    // Verify slide split parity on imported report
    const slides = splitMarkdownIntoSlides(quickImported.document.contentMarkdown, quickImported.document.title);
    expect(slides.slides.length).toBeGreaterThanOrEqual(2);
  });
});
