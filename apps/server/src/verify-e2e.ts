import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { DocumentId, InkadeEvent, PublicSitePayload } from "@inkade/core";
import { DEFAULT_SPACE_IDS } from "@inkade/db";
import { createInkadeClient, subscribeInkadeEvents } from "@inkade/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { unzipSync, zipSync } from "fflate";
import { createInkadeApp } from "./app.ts";

function createCookieFetch(cookieStore: Map<string, string>): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    if (cookieStore.size > 0) {
      const cookieHeader = [...cookieStore.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
      headers.set("cookie", cookieHeader);
    }

    const response = await fetch(input, { ...init, headers });
    const setCookies = response.headers.getSetCookie?.() ?? [];
    for (const raw of setCookies) {
      const firstPart = raw.split(";")[0];
      if (!firstPart) continue;
      const eqIdx = firstPart.indexOf("=");
      if (eqIdx > 0) {
        const name = firstPart.slice(0, eqIdx).trim();
        const val = firstPart.slice(eqIdx + 1).trim();
        if (val) cookieStore.set(name, val);
        else cookieStore.delete(name);
      }
    }
    return response;
  }) as typeof fetch;
}

async function waitFor<T>(
  predicate: () => T | undefined | null | false,
  timeoutMs = 5000,
  label = "condition",
): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = predicate();
    if (value) return value;
    await Bun.sleep(20);
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for: ${label}`);
}

function readToolText(result: unknown): string {
  if (!result || typeof result !== "object" || !("content" in result)) {
    return "";
  }
  const content = (result as { content?: unknown }).content;
  const items = Array.isArray(content) ? content : [];
  const first = items[0] as { text?: string } | undefined;
  return first?.text ?? "";
}

async function runE2E(): Promise<void> {
  const webDistDir = resolve(import.meta.dir, "../../web/dist");
  if (!existsSync(join(webDistDir, "index.html"))) {
    throw new Error(`Built Web SPA not found at ${webDistDir}. Run "bun run build:web" first.`);
  }

  const tempDir = mkdtempSync(join(tmpdir(), "inkade-e2e-"));
  const instance = createInkadeApp({
    dbPath: join(tempDir, "inkade-e2e.db"),
    dataDir: tempDir,
    localAutoAuth: false,
    authSecret: "inkade-e2e-verification-secret-key-min-32-chars",
    webDistDir,
  });
  await instance.ready;

  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: instance.app.fetch,
    idleTimeout: 30,
  });
  const baseUrl = `http://127.0.0.1:${server.port}`;

  const cleanups: Array<() => Promise<void> | void> = [];

  try {
    // -----------------------------------------------------------------------
    // Journey 1: Bootstrap, Better Auth, Daily Outline, Rollover & Wikilink
    // -----------------------------------------------------------------------
    const cookies = new Map<string, string>();
    const cookieFetch = createCookieFetch(cookies);
    const ownerSdk = createInkadeClient({ baseUrl, fetch: cookieFetch });

    const health = await ownerSdk.bootstrap.health();
    assert.equal(health.ok, true);

    const bootstrapBefore = await ownerSdk.bootstrap.status();
    assert.equal(bootstrapBefore.initialized, false);

    const setup = await ownerSdk.bootstrap.setupOwner({
      name: "Inkade Owner",
      email: "owner@inkade.local",
      password: "inkade-strong-password-2026",
    });
    assert.equal(setup.initialized, true);
    const ownerWhoami = await ownerSdk.auth.whoami();
    assert.equal(ownerWhoami.principalKind, "user");
    assert.equal(ownerWhoami.scope.permission, "admin");

    const yesterday = await ownerSdk.documents.getDaily("2026-11-23");
    const today = await ownerSdk.documents.getDaily("2026-11-24");

    const doneTodo = await ownerSdk.outlineNodes.create({
      documentId: yesterday.document.id,
      contentMarkdown: "Ship Phase 0 architecture blueprint",
      checked: true,
    });
    assert.equal(doneTodo.checked, true);

    const pendingParent = await ownerSdk.outlineNodes.create({
      documentId: yesterday.document.id,
      contentMarkdown: "E2E Architecture Checklist",
      checked: null,
    });
    await ownerSdk.outlineNodes.create({
      documentId: yesterday.document.id,
      parentNodeId: pendingParent.id,
      contentMarkdown: "Verify Streamable HTTP /mcp write-back",
      checked: false,
    });

    const rolled = await ownerSdk.outlineNodes.rollover(yesterday.document.id, today.document.id);
    assert.equal(rolled.length, 2);
    assert.ok(rolled.some((n) => n.contentMarkdown.includes("Verify Streamable HTTP /mcp")));

    const dispatchNode = await ownerSdk.outlineNodes.create({
      documentId: today.document.id,
      contentMarkdown: "Investigate [[Agent Architecture Benchmark]] for Inkade E2E",
      checked: false,
    });
    console.log("[E2E 1/5] Bootstrap, Better Auth, Daily rollover & forward wikilink OK");

    // -----------------------------------------------------------------------
    // Journey 2: Scoped Write Token + SSE + BB Binding + MCP Node Reply
    // -----------------------------------------------------------------------
    const { rawToken: agentToken } = await ownerSdk.tokens.create({
      name: "bb-agent-worker",
      scope: {
        permission: "write",
        spaceIds: [DEFAULT_SPACE_IDS.daily, DEFAULT_SPACE_IDS.research],
        includeDescendants: true,
        denyHardDelete: true,
      },
    });

    const sseEvents: InkadeEvent[] = [];
    let sseOpen = false;
    const sseSub = subscribeInkadeEvents(
      { baseUrl, token: agentToken },
      {
        onOpen: () => {
          sseOpen = true;
        },
        onEvent: (evt) => {
          sseEvents.push(evt);
        },
      },
    );
    cleanups.push(() => sseSub.unsubscribe());
    await waitFor(() => sseOpen, 5000, "agent SSE open");

    let binding = await ownerSdk.threadBindings.upsert({
      documentId: today.document.id,
      nodeId: dispatchNode.id,
      adeKind: "bb",
      externalThreadId: "thr_e2e_bb_001",
      deepLink: "/threads/thr_e2e_bb_001",
      title: "Benchmark ADE Agent Architecture",
      status: "queued",
    });
    for (const nextStatus of ["running", "waiting_input", "completed"] as const) {
      binding = await ownerSdk.threadBindings.update(binding.id, {
        status: nextStatus,
        lastSummary: `Transitioned to ${nextStatus}`,
        unreadResult: nextStatus === "completed",
      });
    }
    assert.equal(binding.status, "completed");

    const mcpClient = new Client({ name: "inkade-e2e-agent", version: "1.0.0" });
    const mcpTransport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${agentToken}` } },
    });
    await mcpClient.connect(mcpTransport);
    cleanups.push(() => mcpTransport.close());

    const whoamiTool = await mcpClient.callTool({ name: "whoami_scope", arguments: {} });
    assert.notEqual(whoamiTool.isError, true);
    assert.ok(readToolText(whoamiTool).includes("bb-agent-worker"));

    const replyTool = await mcpClient.callTool({
      name: "append_node_reply",
      arguments: {
        documentId: today.document.id,
        parentNodeId: dispatchNode.id,
        contentMarkdown: "Agent conclusion written back safely via /mcp.",
        sourceBindingId: binding.id,
      },
    });
    assert.notEqual(replyTool.isError, true);
    const replyPayload = JSON.parse(readToolText(replyTool)) as {
      node: { id: string; parentNodeId: string };
    };
    assert.equal(replyPayload.node.parentNodeId, dispatchNode.id);

    await waitFor(
      () =>
        sseEvents.find(
          (e) => e.type === "outline.node.created" && e.documentId === today.document.id,
        ),
      5000,
      "SSE node created event",
    );
    const preservedBindings = await ownerSdk.threadBindings.list({ nodeId: dispatchNode.id });
    assert.equal(preservedBindings.length, 1);
    assert.equal(preservedBindings[0]?.id, binding.id);
    console.log("[E2E 2/5] Thread lifecycle + MCP append_node_reply + SSE stream OK");

    // -----------------------------------------------------------------------
    // Journey 3: MCP Article Create + Section Patch + Backlinks + Selection Anchor
    // -----------------------------------------------------------------------
    const reportCreateRes = await mcpClient.callTool({
      name: "create_document",
      arguments: {
        spaceId: DEFAULT_SPACE_IDS.research,
        kind: "article",
        title: "Agent Architecture Benchmark",
        contentMarkdown:
          "# Agent Architecture Benchmark\n\n## Executive Summary\n\nInitial draft findings.\n\n## Methodology\n\nMeasured across real tool chains.\n",
        tags: ["architecture", "shared"],
      },
    });
    assert.notEqual(reportCreateRes.isError, true);
    const reportCreated = JSON.parse(readToolText(reportCreateRes)) as {
      document: { id: DocumentId; unreadAgentUpdate: boolean; version: number };
    };
    assert.equal(reportCreated.document.unreadAgentUpdate, true);
    assert.equal(reportCreated.document.version, 1);

    const backlinks = await ownerSdk.documents.listBacklinks(reportCreated.document.id);
    assert.ok(
      backlinks.some((link) => link.sourceNodeId === dispatchNode.id),
      "Expected forward wikilink from outline node to resolve in backlinks",
    );

    const patchRes = await mcpClient.callTool({
      name: "patch_document_section",
      arguments: {
        documentId: reportCreated.document.id,
        headingPath: "Executive Summary",
        mode: "append",
        markdown: "Latency remained under 15ms across scoped requests.",
        expectedVersion: 1,
        changeSummary: "Added latency measurements",
      },
    });
    assert.notEqual(patchRes.isError, true);

    const diffRes = await mcpClient.callTool({
      name: "get_revision_diff",
      arguments: {
        documentId: reportCreated.document.id,
        fromVersion: 1,
        toVersion: 2,
      },
    });
    assert.notEqual(diffRes.isError, true);
    const diffPayload = JSON.parse(readToolText(diffRes)) as {
      diff: { additions: number; unifiedPatch: string };
    };
    assert.ok(diffPayload.diff.additions > 0);
    assert.ok(diffPayload.diff.unifiedPatch.includes("Latency remained under 15ms"));

    const readAck = await ownerSdk.documents.markAgentUpdateRead(reportCreated.document.id);
    assert.equal(readAck.unreadAgentUpdate, false);

    const anchorBinding = await ownerSdk.threadBindings.upsert({
      documentId: reportCreated.document.id,
      nodeId: null,
      selectionAnchor: {
        quote: "Latency remained under 15ms across scoped requests.",
        headingSlug: "executive-summary",
        startOffset: 62,
        endOffset: 112,
      },
      adeKind: "bb",
      externalThreadId: "thr_e2e_followup_002",
      title: "Follow up on latency benchmark",
      status: "running",
    });
    assert.equal(
      anchorBinding.selectionAnchor?.quote,
      "Latency remained under 15ms across scoped requests.",
    );
    console.log("[E2E 3/5] MCP article create/patch, backlink resolution, diff & highlight anchor OK");

    // -----------------------------------------------------------------------
    // Journey 4: Security Matrix, Scope Isolation, Deny Hard Delete, Hot Scope Update
    // -----------------------------------------------------------------------
    await ownerSdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.research,
      kind: "article",
      title: "Internal Only Secret",
      contentMarkdown: "Confidential e2e_secret_marker_xyz in Research.",
      tags: ["internal"],
    });
    await ownerSdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.inbox,
      kind: "clip",
      title: "Shared Inbox Clip",
      contentMarkdown: "Clipped e2e_secret_marker_xyz in Inbox.",
      tags: ["shared"],
    });

    const { token: restrictedTokenRecord, rawToken: restrictedRawToken } =
      await ownerSdk.tokens.create({
        name: "restricted-reader",
        scope: {
          permission: "read",
          spaceIds: [DEFAULT_SPACE_IDS.research],
          includeDescendants: true,
          tagAllowlist: ["shared"],
          denyHardDelete: true,
        },
      });
    const restrictedSdk = createInkadeClient({ baseUrl, token: restrictedRawToken });

    const restrictedSseEvents: InkadeEvent[] = [];
    let restrictedSseOpen = false;
    const restrictedSub = subscribeInkadeEvents(
      { baseUrl, token: restrictedRawToken },
      {
        onOpen: () => {
          restrictedSseOpen = true;
        },
        onEvent: (evt) => {
          restrictedSseEvents.push(evt);
        },
      },
    );
    cleanups.push(() => restrictedSub.unsubscribe());
    await waitFor(() => restrictedSseOpen, 5000, "restricted SSE open");

    let restWriteBlocked = false;
    try {
      await restrictedSdk.documents.create({
        spaceId: DEFAULT_SPACE_IDS.research,
        kind: "article",
        title: "Should Fail",
        contentMarkdown: "blocked",
        tags: ["shared"],
      });
    } catch (err: unknown) {
      if ((err as { status?: number }).status === 403) restWriteBlocked = true;
    }
    assert.equal(restWriteBlocked, true);

    const restrictedMcp = new Client({ name: "restricted-mcp", version: "1.0.0" });
    const restrictedTransport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${restrictedRawToken}` } },
    });
    await restrictedMcp.connect(restrictedTransport);
    cleanups.push(() => restrictedTransport.close());

    const mcpWriteAttempt = await restrictedMcp.callTool({
      name: "create_document",
      arguments: {
        spaceId: DEFAULT_SPACE_IDS.research,
        kind: "article",
        title: "Blocked MCP Doc",
        contentMarkdown: "nope",
        tags: ["shared"],
      },
    });
    assert.equal(mcpWriteAttempt.isError, true);

    let dailyBlocked = false;
    try {
      await restrictedSdk.documents.getDaily("2026-11-24");
    } catch (err: unknown) {
      if ((err as { status?: number }).status === 403) dailyBlocked = true;
    }
    assert.equal(dailyBlocked, true);

    const restrictedHits = await restrictedSdk.search.query({ q: "e2e_secret_marker_xyz" });
    assert.equal(restrictedHits.length, 0);

    const inboxEventDoc = await ownerSdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.inbox,
      kind: "clip",
      title: "Another Shared Inbox Clip",
      contentMarkdown: "must stay hidden from research-only SSE",
      tags: ["shared"],
    });
    const publicResearchDoc = await ownerSdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.research,
      kind: "article",
      title: "Shared Visible Research",
      contentMarkdown: "visible over SSE",
      tags: ["shared"],
    });
    await waitFor(
      () => restrictedSseEvents.find((e) => e.documentId === publicResearchDoc.id),
      5000,
      "restricted SSE receives authorized event",
    );
    assert.equal(
      restrictedSseEvents.some((e) => e.documentId === inboxEventDoc.id),
      false,
    );

    let hardDeleteBlocked = false;
    try {
      const writeAgentSdk = createInkadeClient({ baseUrl, token: agentToken });
      await writeAgentSdk.documents.delete(reportCreated.document.id, { hard: true });
    } catch (err: unknown) {
      if ((err as { code?: string }).code === "HARD_DELETE_BLOCKED") hardDeleteBlocked = true;
    }
    assert.equal(hardDeleteBlocked, true);

    await ownerSdk.tokens.update(restrictedTokenRecord.id, {
      scope: {
        permission: "write",
        spaceIds: [DEFAULT_SPACE_IDS.research, DEFAULT_SPACE_IDS.daily],
        includeDescendants: true,
        denyHardDelete: true,
      },
    });
    const hotDaily = await restrictedSdk.documents.getDaily("2026-11-24");
    assert.equal(hotDaily.document.id, today.document.id);
    console.log("[E2E 4/5] Scoped enforcement matrix, SSE isolation, denyHardDelete & hot-reload OK");

    // -----------------------------------------------------------------------
    // Journey 5: Attachments SHA-256 + ZIP Export + Static Built Web PWA
    // -----------------------------------------------------------------------
    const payloadBytes = new TextEncoder().encode("inkade-binary-attachment-payload-2026");
    const expectedSha = createHash("sha256").update(payloadBytes).digest("hex");
    const uploaded = await ownerSdk.attachments.upload({
      documentId: reportCreated.document.id,
      filename: "benchmark.txt",
      mimeType: "text/plain",
      data: payloadBytes,
    });
    assert.equal(uploaded.attachment.sha256, expectedSha);
    const downloadedBytes = await ownerSdk.attachments.download(uploaded.attachment.id);
    assert.equal(new TextDecoder().decode(downloadedBytes), "inkade-binary-attachment-payload-2026");

    const zipBytes = await ownerSdk.workspace.exportZip();
    const unzipped = unzipSync(zipBytes);
    const zipEntries = Object.keys(unzipped);
    const reportZipEntry = unzipped["research/agent-architecture-benchmark.md"];
    assert.ok(
      reportZipEntry !== undefined,
      `ZIP missing expected article entry; got: ${zipEntries.join(", ")}`,
    );
    const exportedMd = new TextDecoder().decode(reportZipEntry);
    assert.ok(exportedMd.startsWith("---\n"), "Exported Markdown should contain YAML frontmatter");
    assert.ok(exportedMd.includes("Latency remained under 15ms"));

    const spaRes = await fetch(`${baseUrl}/`);
    assert.equal(spaRes.status, 200);
    const spaHtml = await spaRes.text();
    assert.ok(spaHtml.includes('<div id="root"'), "Root should serve built Web SPA");

    const manifestRes = await fetch(`${baseUrl}/manifest.webmanifest`);
    assert.equal(manifestRes.status, 200);
    const manifestJson = (await manifestRes.json()) as { name?: string };
    assert.ok(Boolean(manifestJson.name), "PWA manifest should contain app name");

    console.log("[E2E 5/5] Attachments, ZIP export, and built Web PWA serving OK");

    // -------------------------------------------------------------------------
    // [E2E 6/6] V6 Enterprise: Schema MCP, Tasks Inbox isolation, Context Pack +
    // Ask citations, Import Hub rollback, Digital Garden + RSS, Briefings
    // -------------------------------------------------------------------------

    // 6a. Space Property Schema via MCP (authorized write/read + unauthorized denial)
    const upsertSchemaRes = await mcpClient.callTool({
      name: "upsert_space_schema",
      arguments: {
        spaceId: DEFAULT_SPACE_IDS.research,
        fields: [
          {
            key: "stage",
            label: "Stage",
            type: "select",
            options: [
              { value: "draft", label: "Draft", color: "slate" },
              { value: "ready", label: "Ready", color: "emerald" },
            ],
            showInTable: true,
            showInCard: true,
            requiredByAgent: false,
          },
          {
            key: "priority_score",
            label: "Priority Score",
            type: "number",
            options: [],
            showInTable: true,
            showInCard: true,
            requiredByAgent: false,
          },
          {
            key: "internal_secret",
            label: "Internal Secret",
            type: "text",
            options: [],
            showInTable: false,
            showInCard: false,
            requiredByAgent: false,
          },
        ],
      },
    });
    assert.notEqual(upsertSchemaRes.isError, true, "upsert_space_schema should succeed on Research");

    const getSchemaRes = await mcpClient.callTool({
      name: "get_space_schema",
      arguments: { spaceId: DEFAULT_SPACE_IDS.research },
    });
    assert.notEqual(getSchemaRes.isError, true);
    assert.ok(readToolText(getSchemaRes).includes("priority_score"));

    const deniedInboxSchema = await mcpClient.callTool({
      name: "get_space_schema",
      arguments: { spaceId: DEFAULT_SPACE_IDS.inbox },
    });
    assert.equal(deniedInboxSchema.isError, true, "Unauthorized Inbox schema read must fail");

    // 6b. Tasks Inbox container invisibility across library, search, and workspace summary
    const standaloneTask = await ownerSdk.tasks.create({
      title: "V6 standalone isolated inbox task",
    });
    assert.ok(standaloneTask.node.contentMarkdown.includes("V6 standalone isolated inbox task"));
    assert.equal(standaloneTask.document.properties?.systemRole, "tasks_inbox");

    const allListedDocs = await ownerSdk.documents.list({ limit: 200 });
    assert.equal(
      allListedDocs.some(
        (doc) => doc.title === "Tasks Inbox" || doc.properties?.systemRole === "tasks_inbox",
      ),
      false,
      "Library listing must hide Tasks Inbox container",
    );
    const inboxSearchHits = await ownerSdk.search.query({ q: "Tasks Inbox" });
    assert.equal(
      inboxSearchHits.some((hit) => hit.title === "Tasks Inbox"),
      false,
      "FTS search must hide Tasks Inbox container",
    );
    const wsSummary = await ownerSdk.workspace.summary();
    assert.equal(
      wsSummary.spaces.some((space) => space.slug === "tasks-inbox" || space.name === "Tasks Inbox"),
      false,
      "Workspace summary must exclude system Tasks Inbox container",
    );

    // 6c. Context Pack CRUD + TokenScope isolation + /ask RAG citations
    const scopedResearchSdk = createInkadeClient({ baseUrl, token: agentToken });
    const inboxConfidentialDoc = await ownerSdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.inbox,
      kind: "article",
      title: "Confidential Inbox Budget 998877",
      contentMarkdown: "Confidential inbox secret token V6_SECRET_998877.",
    });
    const researchRagDoc = await ownerSdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.research,
      kind: "article",
      title: "V6 Orama Hybrid Retrieval Architecture",
      contentMarkdown:
        "Inkade V6 combines Orama BM25 retrieval with TokenScope SQL pushdown and grounded [1] citations.",
      properties: {
        stage: "ready",
        priority_score: 95,
        internal_secret: "DO_NOT_LEAK_PUBLICLY",
      },
    });

    await ownerSdk.search.reindex();
    const askResult = await scopedResearchSdk.ai.askStream({
      question: "How does Inkade V6 retrieval combine Orama BM25 and TokenScope?",
    });
    assert.ok(askResult.citations.length >= 1, "/ask should return grounded citations");
    assert.ok(askResult.fullText.includes("[1]"), "/ask answer should contain bracket citation");
    assert.equal(
      askResult.citations.some((c) => c.docId === inboxConfidentialDoc.id),
      false,
      "Scoped /ask must never cite unauthorized Inbox documents",
    );

    const contextPack = await ownerSdk.contextPacks.create({
      name: "V6 Live Context Pack",
      slug: "v6-live-pack",
      description: "Live E2E pack",
      maxTokens: 520,
      rules: {
        pinnedDocIds: [inboxConfidentialDoc.id, researchRagDoc.id],
        recentDays: 30,
        excludeSystem: true,
      },
    });
    assert.equal(contextPack.slug, "v6-live-pack");

    const scopedPackRendered = await scopedResearchSdk.contextPacks.getBySlug("v6-live-pack", {
      maxTokens: 520,
    });
    assert.ok(scopedPackRendered.totalTokens <= 520);
    assert.ok(scopedPackRendered.items.some((i) => i.docId === researchRagDoc.id));
    assert.equal(
      scopedPackRendered.items.some((i) => i.docId === inboxConfidentialDoc.id),
      false,
      "Context Pack must enforce TokenScope isolation",
    );

    const mcpPackTool = await mcpClient.callTool({
      name: "read_context_pack",
      arguments: { slug: "v6-live-pack", maxTokens: 520 },
    });
    assert.notEqual(mcpPackTool.isError, true);
    const mcpPackText = readToolText(mcpPackTool);
    assert.ok(mcpPackText.includes("inkade://pack/v6-live-pack"));
    assert.equal(mcpPackText.includes("V6_SECRET_998877"), false);

    // 6d. Import Hub Dry-Run preview -> Commit -> Batch Rollback
    const obsidianZip = zipSync({
      "Notes/V6 Imported Vault Spec.md": new TextEncoder().encode(
        "# V6 Imported Vault Spec\n\nReferences [[V6 Orama Hybrid Retrieval Architecture]].\n",
      ),
    });
    const obsidianBase64 = Buffer.from(obsidianZip).toString("base64");
    const importPreview = await ownerSdk.importHub.preview({
      format: "obsidian",
      filename: "v6-vault.zip",
      payloadBase64: obsidianBase64,
      targetSpaceId: DEFAULT_SPACE_IDS.research,
      conflictPolicy: "rename",
    });
    assert.ok(importPreview.documentsToCreate >= 1);
    assert.ok(importPreview.wikilinksToRebind >= 1);

    const importCommit = await ownerSdk.importHub.commit({
      format: "obsidian",
      filename: "v6-vault.zip",
      payloadBase64: obsidianBase64,
      targetSpaceId: DEFAULT_SPACE_IDS.research,
      conflictPolicy: "rename",
    });
    assert.ok(Boolean(importCommit.batchId));
    assert.equal(importCommit.createdDocumentIds.length, 1);
    const importedDocId = importCommit.createdDocumentIds[0]!;
    const importedDoc = await ownerSdk.documents.get(importedDocId);
    assert.equal(importedDoc.title, "V6 Imported Vault Spec");

    const importRollback = await ownerSdk.auditLogs.rollbackBatch(importCommit.batchId, {
      force: true,
    });
    assert.ok(importRollback.rolledBackCount >= 1);
    const docsAfterImportRollback = await ownerSdk.documents.list({ limit: 200 });
    assert.equal(
      docsAfterImportRollback.some((d) => d.id === importedDocId),
      false,
      "Batch rollback should revert imported document",
    );

    // 6e. Digital Garden /site/:slug JSON allowlist + /site/:slug/feed.xml RSS + isolation
    await ownerSdk.publicSites.create({
      slug: "v6-live-garden",
      title: "V6 Live Digital Garden",
      subtitle: "Public research garden",
      sourceType: "space",
      sourceId: DEFAULT_SPACE_IDS.research,
      exposedFields: ["stage"],
      enableRss: true,
      enabled: true,
    });

    const publicSiteRes = await fetch(`${baseUrl}/api/v1/public/sites/v6-live-garden`);
    assert.equal(publicSiteRes.status, 200);
    const publicSiteJson = (await publicSiteRes.json()) as PublicSitePayload;
    const exposedDoc = publicSiteJson.documents.find((d) => d.id === researchRagDoc.id);
    assert.ok(exposedDoc !== undefined, "Public Garden should include Research document");
    assert.equal(exposedDoc.properties.stage, "ready");
    assert.equal(exposedDoc.properties.internal_secret, undefined, "Non-allowlisted property must strip");
    assert.equal(
      publicSiteJson.documents.some((d) => d.id === inboxConfidentialDoc.id),
      false,
      "Public Garden must isolate non-source Inbox documents",
    );

    const siteFeedRes = await fetch(`${baseUrl}/site/v6-live-garden/feed.xml`);
    assert.equal(siteFeedRes.status, 200);
    assert.ok((siteFeedRes.headers.get("content-type") ?? "").includes("xml"));
    const siteFeedXml = await siteFeedRes.text();
    assert.ok(siteFeedXml.includes("<rss"), "Digital Garden feed.xml should return RSS 2.0 XML");
    assert.ok(siteFeedXml.includes("V6 Orama Hybrid Retrieval Architecture"));
    assert.equal(siteFeedXml.includes("Confidential Inbox Budget 998877"), false);

    // 6f. Scheduled Agent Briefing: cron nextRunAt, runNow citations + batch rollback,
    // plus simulateError -> listRuns(failed) -> dismissRun
    const briefingJob = await ownerSdk.briefings.createJob({
      name: "V6 Live Research Briefing",
      cronExpr: "30 7 * * *",
      timezone: "Asia/Shanghai",
      promptTemplate: "Summarize research highlights with [1] citations.",
      sources: {
        spaceIds: [DEFAULT_SPACE_IDS.research],
        includeClipsLastDays: 1,
        includeRssFeeds: false,
        includeTasks: false,
        contextPackIds: [],
        maxItemsPerSource: 5,
      },
      target: {
        mode: "daily_section",
        sectionHeading: "## V6 Live Briefing",
        targetSpaceId: null,
        titleTemplate: "Agent Briefing · {{date}}",
        tags: ["briefing"],
      },
      enabled: true,
    });
    assert.ok(Boolean(briefingJob.nextRunAt), "croner should compute nextRunAt");

    const runSuccess = await ownerSdk.briefings.runJobNow(briefingJob.id);
    assert.equal(runSuccess.status, "succeeded");
    assert.ok(runSuccess.citations.length >= 1);
    assert.ok(Boolean(runSuccess.batchId));
    assert.ok(Boolean(runSuccess.documentId));

    const briefingDoc = await ownerSdk.documents.get(runSuccess.documentId!);
    assert.ok(Boolean(briefingDoc.dailyDate));
    const dailyWithBriefing = await ownerSdk.documents.getDaily(briefingDoc.dailyDate!);
    assert.ok(
      dailyWithBriefing.nodes.some((n) => n.contentMarkdown.includes("V6 Live Briefing")),
      "Successful briefing run should write heading node into Daily outline",
    );

    const briefingRollback = await ownerSdk.auditLogs.rollbackBatch(runSuccess.batchId!, {
      force: true,
    });
    assert.ok(briefingRollback.rolledBackCount >= 1);
    const dailyAfterBriefingRollback = await ownerSdk.documents.getDaily(briefingDoc.dailyDate!);
    assert.equal(
      dailyAfterBriefingRollback.nodes.some((n) => n.contentMarkdown.includes("V6 Live Briefing")),
      false,
      "Batch rollback should erase written briefing nodes",
    );

    const runError = await ownerSdk.briefings.runJobNow(briefingJob.id, {
      simulateError: "Simulated provider timeout in live E2E",
    });
    assert.equal(runError.status, "failed");
    assert.ok(runError.errorMessage?.includes("Simulated provider timeout"));

    const undismissedFailed = await ownerSdk.briefings.listRuns({
      jobId: briefingJob.id,
      status: "failed",
      undismissedOnly: true,
    });
    assert.equal(
      undismissedFailed.some((r) => r.id === runError.id),
      true,
      "Failed briefing run should appear in undismissed failure runs",
    );

    const dismissedRun = await ownerSdk.briefings.dismissRun(runError.id);
    assert.ok(Boolean(dismissedRun.dismissedAt));
    const remainingFailed = await ownerSdk.briefings.listRuns({
      jobId: briefingJob.id,
      status: "failed",
      undismissedOnly: true,
    });
    assert.equal(remainingFailed.length, 0);

    console.log(
      "[E2E 6/6] V6 Schema MCP, Tasks Inbox isolation, Context Pack + /ask, Import Hub rollback, Garden + RSS, and Briefings OK",
    );
    console.log("ALL 6 LIVE E2E JOURNEYS PASSED.");
  } finally {
    for (const fn of cleanups) {
      try {
        await fn();
      } catch {
        // ignore cleanup errors
      }
    }
    void server.stop(true);
    instance.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
}

await runE2E();
