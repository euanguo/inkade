import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { asSpaceId } from "@inkade/core";
import { DEFAULT_SPACE_IDS } from "@inkade/db";
import { createInkadeClient } from "@inkade/sdk";
import { createInkadeApp } from "./app.ts";

const servers: Array<ReturnType<typeof Bun.serve>> = [];
const tempDirs: string[] = [];

afterAll(async () => {
  await Promise.all(servers.map((srv) => srv.stop(true)));
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

async function startPhase44Server() {
  const dir = mkdtempSync(join(tmpdir(), "inkade-phase44-test-"));
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

function escapePdfLiteral(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function buildMinimalPdfBytes(pagesText: readonly string[]): Uint8Array {
  const pageCount = Math.max(1, pagesText.length);
  const objects: string[] = [];

  const kidRefs = pagesText.map((_, idx) => `${4 + idx * 2} 0 R`).join(" ");
  objects[1] = "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n";
  objects[2] = `2 0 obj\n<< /Type /Pages /Count ${pageCount} /Kids [${kidRefs}] >>\nendobj\n`;
  objects[3] =
    "3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n";

  pagesText.forEach((rawText, idx) => {
    const pageObjId = 4 + idx * 2;
    const streamObjId = 5 + idx * 2;
    const streamBody = `BT\n/F1 12 Tf\n72 720 Td\n(${escapePdfLiteral(rawText)}) Tj\nET\n`;
    objects[pageObjId] =
      `${pageObjId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${streamObjId} 0 R >>\nendobj\n`;
    objects[streamObjId] =
      `${streamObjId} 0 obj\n<< /Length ${Buffer.byteLength(streamBody, "utf8")} >>\nstream\n${streamBody}endstream\nendobj\n`;
  });

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = Buffer.byteLength(pdf, "utf8");
    pdf += objects[id]!;
  }
  const xrefPos = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length}\n`;
  pdf += "0000000000 65535 f \n";
  for (let id = 1; id < objects.length; id++) {
    pdf += `${String(offsets[id]!).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

describe("V6 Phase 44: Import Hub, Native PDF, Omnichannel Ingest & Outliner Mirror", () => {
  test("Obsidian ZIP & Notion ZIP import preview, commit, schema sync, wikilink rebind & batch rollback", async () => {
    const { baseUrl } = await startPhase44Server();
    const sdk = createInkadeClient({ baseUrl });

    const pngStub = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const obsidianZip = zipSync({
      "Engineering/Design Doc.md": new TextEncoder().encode(
        [
          "---",
          "status: draft",
          "tags: [architecture, backend]",
          "aliases: [SysDesign]",
          "---",
          "# Design Doc",
          "",
          "Linked to [[Engineering/Roadmap]] and embedded ![[diagram.png]].",
          "",
          "```ts",
          "const keepCode = '[[Engineering/Roadmap]]';",
          "```",
        ].join("\n"),
      ),
      "Engineering/Roadmap.md": new TextEncoder().encode("# Q4 Roadmap\n\nTargets #planning"),
      "attachments/diagram.png": pngStub,
    });

    const obsidianB64 = Buffer.from(obsidianZip).toString("base64");
    const preview = await sdk.importHub.preview({
      format: "obsidian",
      filename: "vault.zip",
      payloadBase64: obsidianB64,
      conflictPolicy: "rename",
    });

    expect(preview.items).toHaveLength(2);
    expect(preview.spacesToCreate).toBeGreaterThanOrEqual(1);
    expect(preview.attachmentsToImport).toBe(1);
    expect(preview.wikilinksToRebind).toBeGreaterThanOrEqual(2);

    const committed = await sdk.importHub.commit({
      format: "obsidian",
      filename: "vault.zip",
      payloadBase64: obsidianB64,
      conflictPolicy: "rename",
    });

    expect(committed.createdDocumentIds).toHaveLength(2);
    expect(committed.attachmentIds).toHaveLength(1);
    expect(committed.createdSpaceIds.length).toBeGreaterThanOrEqual(1);
    expect(committed.wikilinksReboundCount).toBeGreaterThanOrEqual(2);

    const docsAfterCommit = await sdk.documents.list({ limit: 50 });
    const designSummary = docsAfterCommit.find((d) => d.title === "Design Doc");
    expect(designSummary).toBeDefined();
    const designFull = await sdk.documents.get(designSummary!.id);
    expect(designFull.contentMarkdown).toContain("/api/v1/attachments/");
    expect(designFull.contentMarkdown).toContain("[[Roadmap]]");
    expect(designFull.contentMarkdown).toContain("const keepCode = '[[Engineering/Roadmap]]';");

    // Notion ZIP export with trailing UUIDs + CSV database columns -> space property schema
    const notionZip = zipSync({
      "Specs a1b2c3d4e5f6789012345678901234ef/Tracker 1234567890abcdef1234567890abcdef.csv":
        new TextEncoder().encode(
          "Name,Owner,Priority\nLaunch Checklist,Euan,P1\nSecurity Audit,Alex,P0\n",
        ),
      "Specs a1b2c3d4e5f6789012345678901234ef/API Spec fedcba9876543210fedcba9876543210.md":
        new TextEncoder().encode("# API Spec\n\nSee [Launch Checklist](Tracker%20row.md)\n"),
    });
    const notionCommit = await sdk.importHub.commit({
      format: "notion",
      filename: "notion.zip",
      payloadBase64: Buffer.from(notionZip).toString("base64"),
      targetSpaceId: asSpaceId(DEFAULT_SPACE_IDS.research),
    });
    expect(notionCommit.createdDocumentIds.length).toBeGreaterThanOrEqual(3);
    expect(notionCommit.schemaUpdatedSpaceIds.length).toBeGreaterThanOrEqual(1);

    const targetSchema = await sdk.spaces.getSchema(notionCommit.schemaUpdatedSpaceIds[0]!);
    expect(targetSchema?.fields.some((f) => f.key === "owner")).toBe(true);

    // Atomic batch rollback cleanly removes imported Obsidian docs and empty imported spaces
    const rolled = await sdk.auditLogs.rollbackBatch(committed.batchId, { force: true });
    expect(rolled.rolledBackCount).toBeGreaterThanOrEqual(2);
    expect(rolled.deletedDocumentIds).toHaveLength(2);

    const docsAfterRollback = await sdk.documents.list({ limit: 50 });
    expect(docsAfterRollback.some((d) => d.id === designSummary!.id)).toBe(false);
  });

  test("Readwise CSV dedupe and HTML defuddle import", async () => {
    const { baseUrl } = await startPhase44Server();
    const sdk = createInkadeClient({ baseUrl });

    const csvPayload = [
      "Title,Author,URL,Highlight,Note,Tags",
      '"Designing Data Intensive Apps","Martin Kleppmann","https://dataintensive.net/ch1","Reliability means continuing to work correctly.","Key invariant","systems,db"',
      '"Designing Data Intensive Apps","Martin Kleppmann","https://dataintensive.net/ch1","Scalability describes a system capacity to cope with load.","Second insight","systems,db"',
    ].join("\n");

    const first = await sdk.importHub.commit({
      format: "readwise",
      filename: "readwise.csv",
      payloadText: csvPayload,
      conflictPolicy: "skip",
    });
    expect(first.createdDocumentIds).toHaveLength(1);
    const readwiseDoc = await sdk.documents.get(first.createdDocumentIds[0]!);
    expect(readwiseDoc.contentMarkdown).toContain("Reliability means continuing to work correctly.");
    expect(readwiseDoc.contentMarkdown).toContain("Scalability describes a system capacity");

    const duplicateReimport = await sdk.importHub.commit({
      format: "readwise",
      filename: "readwise.csv",
      payloadText: csvPayload,
      conflictPolicy: "skip",
    });
    expect(duplicateReimport.createdDocumentIds).toHaveLength(0);
    expect(duplicateReimport.skippedCount).toBe(1);

    const htmlCommit = await sdk.importHub.commit({
      format: "html",
      filename: "essay.html",
      payloadText:
        "<html><head><title>Clean Architecture Notes</title></head><body><nav>Menu</nav><article><h1>Clean Architecture Notes</h1><p>Dependencies always point inward toward domain rules.</p></article></body></html>",
    });
    expect(htmlCommit.createdDocumentIds).toHaveLength(1);
    const htmlDoc = await sdk.documents.get(htmlCommit.createdDocumentIds[0]!);
    expect(htmlDoc.contentMarkdown).toContain("Dependencies always point inward");
  });

  test("Native PDF workspace upload, Range stream, TokenScope isolation, page chunks, annotations & distill", async () => {
    const { baseUrl } = await startPhase44Server();
    const sdk = createInkadeClient({ baseUrl });

    const pdfBytes = buildMinimalPdfBytes([
      "Quantum Fourier Transform accelerates eigenvalue estimation in page one.",
      "Phase estimation circuit architecture overview in page two.",
    ]);
    const pdfBlob = new Blob([new Uint8Array(pdfBytes)], { type: "application/pdf" });

    const uploaded = await sdk.pdf.upload({
      file: pdfBlob,
      filename: "quantum-paper.pdf",
      spaceId: asSpaceId(DEFAULT_SPACE_IDS.research),
      title: "Quantum Paper Study",
    });

    expect(uploaded.asset.pageCount).toBe(2);
    expect(uploaded.asset.extractedPages).toHaveLength(2);
    expect(uploaded.asset.extractedPages?.[0]?.text).toContain("Quantum Fourier Transform");

    // Range request returns HTTP 206 Partial Content
    const rangeRes = await fetch(
      `${baseUrl}/api/v1/pdf-assets/${uploaded.asset.id}/file`,
      { headers: { range: "bytes=0-7" } },
    );
    expect(rangeRes.status).toBe(206);
    expect(await rangeRes.text()).toBe("%PDF-1.4");

    // TokenScope isolation rejects cross-space token reading research PDF
    const { rawToken: inboxOnlyToken } = await sdk.tokens.create({
      name: "inbox-only-agent",
      scope: {
        permission: "write",
        spaceIds: [DEFAULT_SPACE_IDS.inbox],
        includeDescendants: false,
      },
    });
    const scopedRes = await fetch(
      `${baseUrl}/api/v1/pdf-assets/${uploaded.asset.id}/file`,
      { headers: { authorization: `Bearer ${inboxOnlyToken}` } },
    );
    expect(scopedRes.status).toBe(403);

    // Searchable FTS + PDF page chunk indexing
    const ftsHits = await sdk.search.query({ q: "eigenvalue" });
    expect(ftsHits.some((h) => h.documentId === uploaded.document.id)).toBe(true);

    // Create PDF coordinate annotation -> automatically appends companion outline citation node
    const annResult = await sdk.pdf.createAnnotation(uploaded.asset.id, {
      page: 2,
      rects: [{ x: 0.1, y: 0.25, width: 0.5, height: 0.04 }],
      quote: "Phase estimation circuit architecture overview",
      color: "emerald",
    });
    expect(annResult.asset.annotations).toHaveLength(1);
    expect(annResult.createdNode?.contentMarkdown).toContain(
      `inkade://pdf/${uploaded.document.id}#page=2`,
    );

    // Silent fallback AI page distillation -> creates distilled outline node
    const distilled = await sdk.pdf.distillPage(uploaded.asset.id, { page: 1 });
    expect(distilled.usedFallback).toBe(true);
    expect(distilled.createdNode.contentMarkdown).toContain("Quantum Fourier Transform");

    const updatedNodes = await sdk.outlineNodes.list(uploaded.document.id);
    expect(updatedNodes.length).toBeGreaterThanOrEqual(3);
  });

  test("Omnichannel ingest: private webhook, conditional RSS feed with SSRF guard & Whisper audio", async () => {
    const { baseUrl, instance } = await startPhase44Server();
    const sdk = createInkadeClient({ baseUrl });

    // Private Webhook (public unauthenticated POST + rate limit / token scope)
    const createdWebhook = await sdk.webhooks.create({
      name: "Shortcuts",
      targetSpaceId: asSpaceId(DEFAULT_SPACE_IDS.inbox),
      defaultKind: "clip",
      tags: ["shortcut"],
    });
    expect(createdWebhook.rawToken.startsWith("ink_whk_")).toBe(true);

    const whRes = await fetch(`${baseUrl}${createdWebhook.ingestPath}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Captured via Webhook",
        contentMarkdown: "Hello from iOS Shortcuts",
      }),
    });
    expect(whRes.status).toBe(201);
    const whBody = (await whRes.json()) as { readonly document: { readonly title: string } };
    expect(whBody.document.title).toBe("Captured via Webhook");

    // SSRF guard blocks loopback IP on RSS creation
    let ssrfBlocked = false;
    try {
      await sdk.rssFeeds.create({ url: "http://127.0.0.1:9999/feed.xml" });
    } catch {
      ssrfBlocked = true;
    }
    expect(ssrfBlocked).toBe(true);

    // Mock public external RSS feed with conditional 304 check
    let rssCalls = 0;
    instance.services.ingest.setTestTransport({
      allowLocalForTest: true,
      resolveDns: () => Promise.resolve(["93.184.216.34"]),
      fetchFn: (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        if (url.includes("whisper.local")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                text: "Decided to adopt Phase 44 architecture.",
                language: "en",
                duration: 4.2,
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              },
            ),
          );
        }
        rssCalls += 1;
        const headers = new Headers(init?.headers);
        if (rssCalls > 1 && headers.get("if-none-match") === '"etag-v1"') {
          return Promise.resolve(new Response(null, { status: 304 }));
        }
        const rssXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Engineering Feed</title>
<item><title>Zero Copy Streams</title><link>https://example.org/zero-copy</link><description><![CDATA[<p>Streaming bytes efficiently across workers.</p>]]></description></item>
</channel></rss>`;
        return Promise.resolve(
          new Response(rssXml, {
            status: 200,
            headers: {
              "content-type": "application/rss+xml",
              etag: '"etag-v1"',
            },
          }),
        );
      },
    });

    const feed = await sdk.rssFeeds.create({
      url: "https://example.org/rss.xml",
      targetSpaceId: asSpaceId(DEFAULT_SPACE_IDS.inbox),
    });
    const sync1 = await sdk.rssFeeds.sync(feed.id);
    expect(sync1.createdCount).toBe(1);
    expect(sync1.notModified).toBe(false);

    const sync2 = await sdk.rssFeeds.sync(feed.id);
    expect(sync2.notModified).toBe(true);
    expect(sync2.createdCount).toBe(0);

    // Audio Whisper upload + transcript to clip document
    const fakeWav = new Blob([new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00])], {
      type: "audio/wav",
    });
    const audioRes = await sdk.ingestAudio.transcribe({
      file: fakeWav,
      filename: "standup.wav",
      target: "clip",
      title: "Standup Voice Memo",
      transcriptionEndpoint: "https://whisper.local/v1/audio/transcriptions",
    });
    expect(audioRes.text).toBe("Decided to adopt Phase 44 architecture.");
    expect(audioRes.document?.title).toBe("Standup Voice Memo");
  });

  test("Outliner Mirror bidirectional sync, cycle rejection & AdeThreadBinding preservation", async () => {
    const { baseUrl } = await startPhase44Server();
    const sdk = createInkadeClient({ baseUrl });

    const docA = await sdk.documents.create({
      spaceId: asSpaceId(DEFAULT_SPACE_IDS.inbox),
      kind: "outline",
      title: "Project Plan",
    });
    const docB = await sdk.documents.create({
      spaceId: asSpaceId(DEFAULT_SPACE_IDS.research),
      kind: "outline",
      title: "Weekly Sprint",
    });

    const nodeA = await sdk.outlineNodes.create({
      documentId: docA.id,
      parentNodeId: null,
      contentMarkdown: "Deploy multi-region SQLite replication",
      checked: false,
    });

    const bindingA = await sdk.threadBindings.upsert({
      documentId: docA.id,
      nodeId: nodeA.id,
      adeKind: "bb",
      externalThreadId: "thr_mirror_source",
      title: "Replication thread",
      status: "running",
    });

    const mirrored = await sdk.outlineNodes.mirror(nodeA.id, {
      targetDocumentId: docB.id,
      parentNodeId: null,
    });
    expect(mirrored.node.mirrorOfNodeId).toBe(nodeA.id);
    expect(mirrored.node.id).not.toBe(nodeA.id);
    expect(mirrored.node.contentMarkdown).toBe("Deploy multi-region SQLite replication");

    // Mutate mirror node in docB -> bidirectional sync propagates to canonical node in docA while preserving binding
    await sdk.outlineNodes.update(mirrored.node.id, {
      contentMarkdown: "Deploy multi-region SQLite replication [verified]",
      checked: true,
    });

    const refreshedDocANodes = await sdk.outlineNodes.list(docA.id);
    const updatedNodeA = refreshedDocANodes.find((n) => n.id === nodeA.id);
    expect(updatedNodeA?.contentMarkdown).toBe(
      "Deploy multi-region SQLite replication [verified]",
    );
    expect(updatedNodeA?.checked).toBe(true);

    const bindingsAfterSync = await sdk.threadBindings.list({ documentId: docA.id });
    expect(bindingsAfterSync.some((b) => b.id === bindingA.id && b.nodeId === nodeA.id)).toBe(true);

    // Self-mirror cycle is rejected cleanly
    let cycleRejected = false;
    try {
      await sdk.outlineNodes.update(nodeA.id, { mirrorOfNodeId: mirrored.node.id });
    } catch {
      cycleRejected = true;
    }
    expect(cycleRejected).toBe(true);

    // Cross-workspace outline node search finds mirrored & canonical nodes
    const searchMatches = await sdk.outlineNodes.search("SQLite replication", 10);
    expect(searchMatches.length).toBeGreaterThanOrEqual(2);
  });
});
