import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { asOutlineNodeId } from "@inkade/core";
import { DEFAULT_SPACE_IDS } from "@inkade/db";
import { createInkadeClient } from "@inkade/sdk";
import { createInkadeApp, type InkadeAppInstance } from "./app.ts";
import type { DnsResolver, FetchFn } from "./services/clipper-service.ts";

interface Phase7Harness {
  readonly baseUrl: string;
  readonly instance: InkadeAppInstance;
  readonly server: ReturnType<typeof Bun.serve>;
  readonly tempDir: string;
}

const activeHarnesses: Phase7Harness[] = [];

async function startPhase7Server(options?: {
  clipperResolveDns?: DnsResolver | undefined;
  clipperFetch?: FetchFn | undefined;
}): Promise<Phase7Harness> {
  const tempDir = mkdtempSync(join(tmpdir(), "inkade-phase7-test-"));
  const instance = createInkadeApp({
    dbPath: join(tempDir, "inkade.db"),
    dataDir: tempDir,
    localAutoAuth: true,
    authSecret: "test-secret-key-for-inkade-phase7-suite-32bytes",
    clipperResolveDns: options?.clipperResolveDns,
    clipperFetch: options?.clipperFetch,
  });
  await instance.ready;

  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: instance.app.fetch,
    idleTimeout: 30,
  });

  const harness: Phase7Harness = {
    baseUrl: `http://127.0.0.1:${server.port}`,
    instance,
    server,
    tempDir,
  };
  activeHarnesses.push(harness);
  return harness;
}

afterEach(() => {
  while (activeHarnesses.length > 0) {
    const h = activeHarnesses.pop();
    if (!h) continue;
    void h.server.stop(true);
    h.instance.close();
    rmSync(h.tempDir, { recursive: true, force: true });
  }
});

async function expectRejectsMatch(
  promise: Promise<unknown>,
  expected: Record<string, unknown>,
): Promise<void> {
  let rejected = false;
  let caught: unknown;
  try {
    await promise;
  } catch (err) {
    rejected = true;
    caught = err;
  }
  expect(rejected).toBe(true);
  expect(caught).toMatchObject(expected);
}

function readToolText(result: Record<string, unknown>): string {
  const items = Array.isArray(result.content) ? result.content : [];
  const first = items[0] as { text?: string } | undefined;
  return first?.text ?? "";
}

describe("Phase 7 Server, Security, Clipper & MCP Expansion", () => {
  test("Batch outline mutation supports tempId hierarchy, order preservation, and atomic tx rollback", async () => {
    const { baseUrl } = await startPhase7Server();
    const sdk = createInkadeClient({ baseUrl });

    const daily = await sdk.documents.getDaily("2026-11-24");

    const batchRes = await sdk.outlineNodes.batch({
      documentId: daily.document.id,
      operations: [
        {
          op: "create",
          tempId: "tmp_root",
          parentNodeId: null,
          contentMarkdown: "Parent item #batch-tag",
          noteMarkdown: "Secondary note line",
          checked: false,
        },
        {
          op: "create",
          tempId: "tmp_c1",
          parentNodeId: "tmp_root",
          contentMarkdown: "Child 1",
          checked: false,
        },
        {
          op: "create",
          tempId: "tmp_c2",
          parentNodeId: "tmp_root",
          contentMarkdown: "Child 2",
          checked: true,
        },
        {
          op: "create",
          tempId: "tmp_mirror",
          parentNodeId: null,
          contentMarkdown: "Mirrored node",
          mirrorOfNodeId: "tmp_root",
        },
      ],
    });

    const realRootId = batchRes.tempIdMap.tmp_root;
    const realChild1Id = batchRes.tempIdMap.tmp_c1;
    const realChild2Id = batchRes.tempIdMap.tmp_c2;
    const realMirrorId = batchRes.tempIdMap.tmp_mirror;
    expect(realRootId).toBeTruthy();
    expect(realChild1Id).toBeTruthy();
    expect(realChild2Id).toBeTruthy();
    expect(realMirrorId).toBeTruthy();

    const child1 = batchRes.nodes.find((n) => n.id === realChild1Id);
    const child2 = batchRes.nodes.find((n) => n.id === realChild2Id);
    const mirror = batchRes.nodes.find((n) => n.id === realMirrorId);
    expect(child1?.parentNodeId).toBe(realRootId);
    expect(child2?.parentNodeId).toBe(realRootId);
    expect((child1?.orderKey ?? "") < (child2?.orderKey ?? "")).toBe(true);
    expect(mirror?.mirrorOfNodeId).toBe(realRootId);

    const updatedDailyDoc = await sdk.documents.get(daily.document.id);
    expect(updatedDailyDoc.tags).toContain("batch-tag");

    // Atomic rollback: valid create followed by non-existent nodeId update must leave DB unchanged.
    const countBefore = (await sdk.outlineNodes.list(daily.document.id)).length;
    await expectRejectsMatch(
      sdk.outlineNodes.batch({
        documentId: daily.document.id,
        operations: [
          {
            op: "create",
            tempId: "tmp_should_rollback",
            parentNodeId: null,
            contentMarkdown: "Must NOT persist",
          },
          {
            op: "update",
            nodeId: asOutlineNodeId("nod_does_not_exist"),
            contentMarkdown: "Boom",
          },
        ],
      }),
      { status: 404, code: "NOT_FOUND" },
    );

    const nodesAfterFailure = await sdk.outlineNodes.list(daily.document.id);
    expect(nodesAfterFailure).toHaveLength(countBefore);
    expect(nodesAfterFailure.some((n) => n.contentMarkdown === "Must NOT persist")).toBe(false);
  });

  test("Concurrent thread binding claim is race-safe and returns 409 Conflict to loser", async () => {
    const { baseUrl } = await startPhase7Server();
    const sdk = createInkadeClient({ baseUrl });

    const daily = await sdk.documents.getDaily("2026-11-24");
    const node = await sdk.outlineNodes.create({
      documentId: daily.document.id,
      contentMarkdown: "Dispatch from mobile",
      checked: false,
    });

    const pendingBinding = await sdk.threadBindings.upsert({
      documentId: daily.document.id,
      nodeId: node.id,
      adeKind: "bb",
      externalThreadId: "thr_pending_race_1",
      title: "Pending Mobile Dispatch",
      status: "queued",
    });

    const [resA, resB] = await Promise.allSettled([
      sdk.threadBindings.claim(pendingBinding.id, {
        externalThreadId: "thr_real_worker_a",
        status: "running",
      }),
      sdk.threadBindings.claim(pendingBinding.id, {
        externalThreadId: "thr_real_worker_b",
        status: "running",
      }),
    ]);

    const fulfilled = [resA, resB].filter((r) => r.status === "fulfilled");
    const rejected = [resA, resB].filter(
      (r): r is PromiseRejectedResult => r.status === "rejected",
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({ status: 409, code: "CONFLICT" });

    const bindings = await sdk.threadBindings.list({ documentId: daily.document.id });
    expect(bindings).toHaveLength(1);
    expect(["thr_real_worker_a", "thr_real_worker_b"]).toContain(
      bindings[0]?.externalThreadId ?? "",
    );
  });

  test("Clipper blocks SSRF (loopback, RFC1918, metadata, IPv6, DNS rebinding, redirects) and ingests safe HTML with image mirroring", async () => {
    const fakePng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const mockFetch: FetchFn = (input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "https://public.example.com/redirect-to-metadata") {
        return Promise.resolve(
          new Response(null, {
            status: 302,
            headers: { location: "http://169.254.169.254/latest/meta-data/" },
          }),
        );
      }
      if (url === "https://public.example.com/article") {
        const html = `<!doctype html>
          <html>
            <head>
              <title>Inkade Clipper Architecture</title>
              <meta name="description" content="Clean Markdown clipping" />
              <link rel="icon" href="/favicon.ico" />
              <meta property="og:image" content="https://cdn.example.com/hero.png" />
            </head>
            <body>
              <article>
                <h1>Inkade Clipper Architecture</h1>
                <p>Defuddle cleans noisy web markup into crisp Markdown.</p>
                <p><img src="https://cdn.example.com/diagram.png" alt="Architecture" /></p>
                <p><img src="http://127.0.0.1:9999/secret.png" alt="Blocked" /></p>
              </article>
            </body>
          </html>`;
        return Promise.resolve(
          new Response(html, {
            status: 200,
            headers: { "content-type": "text/html; charset=utf-8" },
          }),
        );
      }
      if (url === "https://public.example.com/unsafe-media") {
        const html = `<!doctype html>
          <html>
            <head>
              <title>Unsafe Media Clip</title>
              <link rel="icon" href="http://127.0.0.1:9000/private.ico" />
              <meta property="og:image" content="http://169.254.169.254/latest/meta.png" />
            </head>
            <body>
              <article>
                <h1>Unsafe Media Clip</h1>
                <p>Page body without trusted metadata images.</p>
              </article>
            </body>
          </html>`;
        return Promise.resolve(
          new Response(html, {
            status: 200,
            headers: { "content-type": "text/html; charset=utf-8" },
          }),
        );
      }
      if (url === "https://cdn.example.com/diagram.png") {
        return Promise.resolve(
          new Response(fakePng, {
            status: 200,
            headers: { "content-type": "image/png" },
          }),
        );
      }
      return Promise.resolve(new Response("Not Found", { status: 404 }));
    };

    const mockDns: DnsResolver = (hostname) => {
      if (hostname === "rebind.example.com") {
        return Promise.resolve(["10.0.0.42"]);
      }
      return Promise.resolve(["93.184.216.34"]);
    };

    const { baseUrl } = await startPhase7Server({
      clipperResolveDns: mockDns,
      clipperFetch: mockFetch,
    });
    const sdk = createInkadeClient({ baseUrl });

    const ssrfTargets = [
      "http://localhost:3000/api/v1/whoami",
      "http://127.0.0.1:8080/admin",
      "http://169.254.169.254/latest/meta-data/",
      "http://10.1.2.3/internal",
      "http://172.16.5.4/internal",
      "http://192.168.1.1/router",
      "http://[::1]/loopback",
      "https://rebind.example.com/secret",
      "https://public.example.com/redirect-to-metadata",
      "file:///etc/passwd",
    ];

    for (const target of ssrfTargets) {
      await expectRejectsMatch(sdk.clips.ingestUrl({ url: target }), {
        status: 403,
        code: "FORBIDDEN",
      });
    }

    const ingested = await sdk.clips.ingestUrl({
      url: "https://public.example.com/article",
      tags: ["clipping"],
      mirrorImages: true,
      saveHtmlSnapshot: true,
    });

    expect(ingested.document.kind).toBe("clip");
    expect(ingested.document.spaceId).toBe(DEFAULT_SPACE_IDS.inbox);
    expect(ingested.document.title).toContain("Inkade Clipper Architecture");
    expect(ingested.document.contentMarkdown).toContain("Defuddle cleans noisy web markup");
    expect(ingested.mirroredImages).toBe(1);
    expect(ingested.document.contentMarkdown).toContain("/api/v1/attachments/");
    expect(ingested.document.contentMarkdown).not.toContain("https://cdn.example.com/diagram.png");

    const clipAttachments = await sdk.attachments.list({ documentId: ingested.document.id });
    expect(clipAttachments.length).toBe(2); // snapshot.html + diagram.png
    expect(ingested.document.sourceMeta?.faviconUrl).toBe("https://public.example.com/favicon.ico");
    expect(ingested.document.sourceMeta?.coverImageUrl).toBe("https://cdn.example.com/hero.png");

    const unsafeMedia = await sdk.clips.ingestUrl({
      url: "https://public.example.com/unsafe-media",
      mirrorImages: false,
      saveHtmlSnapshot: false,
    });
    expect(unsafeMedia.document.sourceMeta?.faviconUrl).toBeUndefined();
    expect(unsafeMedia.document.sourceMeta?.favicon).toBeUndefined();
    expect(unsafeMedia.document.sourceMeta?.coverImageUrl).toBeUndefined();
    expect(unsafeMedia.document.sourceMeta?.image).toBeUndefined();
  });

  test("Enforces scope & records audit_logs across summary, tasks, graph, mentions, highlights, templates, shares, views, and syncBacklinks", async () => {
    const { baseUrl } = await startPhase7Server();
    const adminSdk = createInkadeClient({ baseUrl });

    // Create documents in Research (authorized for scoped token) and Inbox (forbidden for scoped token)
    const researchTarget = await adminSdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.research,
      kind: "article",
      title: "Vector Search Spec",
      contentMarkdown: "# Vector Search Spec\n\nCovers BM25 and CJK tokenization. #search",
      tags: ["architecture"],
    });
    expect(researchTarget.tags).toContain("search");

    const researchSource = await adminSdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.research,
      kind: "article",
      title: "Search Overview",
      contentMarkdown: "Links to [[Vector Search Spec]] and mentions Vector Search Spec again.",
      tags: [],
    });

    const inboxSecret = await adminSdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.inbox,
      kind: "clip",
      title: "Private Inbox Clip",
      contentMarkdown: "Mentions Vector Search Spec and [[Vector Search Spec]] privately.",
      tags: ["secret"],
    });

    const daily = await adminSdk.documents.getDaily("2026-11-24");
    const taskNode = await adminSdk.outlineNodes.create({
      documentId: daily.document.id,
      contentMarkdown: "Benchmark CJK FTS5 #perf",
      checked: false,
    });
    await adminSdk.threadBindings.upsert({
      documentId: daily.document.id,
      nodeId: taskNode.id,
      adeKind: "bb",
      externalThreadId: "thr_attention_1",
      title: "Awaiting user decision",
      status: "waiting_input",
      unreadResult: true,
    });

    // Scoped token: write on Research + Daily, NO access to Inbox
    const { token: scopedTokenMeta, rawToken: scopedRaw } = await adminSdk.tokens.create({
      name: "scoped-research-daily",
      scope: {
        permission: "write",
        spaceIds: [DEFAULT_SPACE_IDS.research, DEFAULT_SPACE_IDS.daily],
        includeDescendants: true,
        denyHardDelete: true,
      },
    });
    const scopedSdk = createInkadeClient({ baseUrl, token: scopedRaw });

    // Workspace summary respects scope (no Inbox docs counted)
    const adminSummary = await adminSdk.workspace.summary();
    expect(adminSummary.inboxCount).toBe(1);
    expect(adminSummary.attentionThreadsCount).toBe(1);
    expect(adminSummary.dailyActivity).toHaveLength(90);

    const scopedSummary = await scopedSdk.workspace.summary();
    expect(scopedSummary.spaces.some((s) => s.spaceId === DEFAULT_SPACE_IDS.inbox)).toBe(false);
    expect(scopedSummary.inboxCount).toBe(0);

    // Tasks aggregation
    const openTasks = await scopedSdk.tasks.list({ status: "open" });
    expect(openTasks.some((t) => t.node.id === taskNode.id)).toBe(true);
    expect(openTasks.find((t) => t.node.id === taskNode.id)?.bindings).toHaveLength(1);

    // Unlinked mentions & graph exclude Inbox secret doc for scoped token
    const scopedMentions = await scopedSdk.documents.unlinkedMentions(researchTarget.id);
    expect(scopedMentions.some((m) => m.documentId === researchSource.id)).toBe(true);
    expect(scopedMentions.some((m) => m.documentId === inboxSecret.id)).toBe(false);

    const scopedGraph = await scopedSdk.documents.graph(researchTarget.id, 2);
    expect(scopedGraph.nodes.some((n) => n.id === researchSource.id)).toBe(true);
    expect(scopedGraph.nodes.some((n) => n.id === inboxSecret.id)).toBe(false);

    // syncBacklinks: true rewrites Research doc, leaves Inbox secret doc untouched!
    const renamed = await scopedSdk.documents.update(researchTarget.id, {
      title: "Hybrid Search Spec",
      syncBacklinks: true,
    });
    expect(renamed.title).toBe("Hybrid Search Spec");
    expect((await adminSdk.documents.get(researchSource.id)).contentMarkdown).toContain(
      "[[Hybrid Search Spec]]",
    );
    expect((await adminSdk.documents.get(inboxSecret.id)).contentMarkdown).toContain(
      "[[Vector Search Spec]]",
    );

    // Highlights CRUD + scope boundary
    const hl = await scopedSdk.highlights.create(researchTarget.id, {
      quote: "BM25 and CJK tokenization",
      color: "emerald",
      noteMarkdown: "Verify 1-char queries",
    });
    expect((await scopedSdk.highlights.list(researchTarget.id)).map((h) => h.id)).toContain(hl.id);
    await expectRejectsMatch(scopedSdk.highlights.create(inboxSecret.id, { quote: "Mentions" }), {
      status: 403,
      code: "FORBIDDEN",
    });

    // Templates + apply + default daily template
    const dailyTpl = await adminSdk.templates.create({
      name: "Auto Daily",
      kind: "outline",
      contentMarkdown: "- [ ] Review {{date}} ({{weekday}}) in {{space}}",
      isDefaultDaily: true,
    });
    const newDaily = await scopedSdk.documents.getDaily("2099-03-15");
    expect(newDaily.created).toBe(true);
    expect(newDaily.nodes.some((n) => n.contentMarkdown.includes("Review 2099-03-15"))).toBe(true);

    const appliedArticle = await scopedSdk.templates.apply(
      (await adminSdk.templates.list("article"))[0]!.id,
      {
        spaceId: DEFAULT_SPACE_IDS.research,
        title: "Applied Brief",
      },
    );
    expect(appliedArticle.document.spaceId).toBe(DEFAULT_SPACE_IDS.research);
    await adminSdk.templates.delete(dailyTpl.id);

    // Share links are owner-only governance mutations (API tokens without allowGovernanceMutation must be rejected)
    await expectRejectsMatch(scopedSdk.shareLinks.create({ documentId: researchTarget.id }), {
      status: 403,
      code: "FORBIDDEN",
    });

    // Owner session can create & revoke share links; unauthenticated public route hides workspace/space IDs
    const share = await adminSdk.shareLinks.create({ documentId: researchTarget.id });
    const anonSdk = createInkadeClient({ baseUrl });
    const publicPayload = await anonSdk.shareLinks.getPublic(share.token);
    expect(publicPayload.document.title).toBe("Hybrid Search Spec");
    expect((publicPayload as unknown as Record<string, unknown>).workspaceId).toBeUndefined();
    expect((publicPayload.document as unknown as Record<string, unknown>).spaceId).toBeUndefined();

    await adminSdk.shareLinks.revoke(share.id);
    await expectRejectsMatch(anonSdk.shareLinks.getPublic(share.token), {
      status: 404,
      code: "NOT_FOUND",
    });

    // Saved views CRUD (admin-guarded mutation)
    const view = await adminSdk.savedViews.create({
      name: "Research Articles",
      filter: { spaceId: DEFAULT_SPACE_IDS.research, kind: "article" },
    });
    expect((await scopedSdk.savedViews.list()).map((v) => v.id)).toContain(view.id);
    await expectRejectsMatch(scopedSdk.savedViews.create({ name: "Unauthorized View" }), {
      status: 403,
      code: "FORBIDDEN",
    });

    // Orphan attachment cleanup
    const orphanUpload = await adminSdk.attachments.upload({
      filename: "orphan.txt",
      mimeType: "text/plain",
      data: new TextEncoder().encode("orphan bytes"),
    });
    const cleanupRes = await adminSdk.attachments.cleanupOrphans();
    expect(cleanupRes.deletedIds).toContain(orphanUpload.attachment.id);
    expect(cleanupRes.deletedCount).toBeGreaterThanOrEqual(1);

    // Audit logs recorded both allowed mutations and denied attempts; non-admin cannot read audit logs
    await expectRejectsMatch(scopedSdk.auditLogs.list(), {
      status: 403,
      code: "FORBIDDEN",
    });
    const logs = await adminSdk.auditLogs.list({ tokenId: scopedTokenMeta.id });
    expect(logs.some((l) => l.decision === "allowed")).toBe(true);
    expect(logs.some((l) => l.decision === "denied")).toBe(true);

    // Verify new MCP tools end-to-end
    const mcpClient = new Client({ name: "inkade-phase7-mcp", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${scopedRaw}` } },
    });
    await mcpClient.connect(transport);
    try {
      const tasksRes = await mcpClient.callTool({
        name: "list_tasks",
        arguments: { status: "open" },
      });
      expect(tasksRes.isError).not.toBe(true);
      expect(readToolText(tasksRes)).toContain("Benchmark CJK FTS5");

      const batchMcpRes = await mcpClient.callTool({
        name: "batch_mutate_outline",
        arguments: {
          documentId: daily.document.id,
          operations: [
            {
              op: "create",
              tempId: "mcp_t1",
              parentNodeId: null,
              contentMarkdown: "Batch via MCP",
            },
          ],
        },
      });
      expect(batchMcpRes.isError).not.toBe(true);
      expect(readToolText(batchMcpRes)).toContain("Batch via MCP");

      const hlMcpRes = await mcpClient.callTool({
        name: "create_highlight",
        arguments: {
          documentId: researchTarget.id,
          quote: "CJK tokenization",
          color: "blue",
        },
      });
      expect(hlMcpRes.isError).not.toBe(true);

      const listHlMcpRes = await mcpClient.callTool({
        name: "list_highlights",
        arguments: { documentId: researchTarget.id },
      });
      expect(readToolText(listHlMcpRes)).toContain("CJK tokenization");

      const listTplRes = await mcpClient.callTool({
        name: "list_templates",
        arguments: { kind: "article" },
      });
      const tpls = JSON.parse(readToolText(listTplRes)) as {
        templates: Array<{ id: string }>;
      };
      expect(tpls.templates.length).toBeGreaterThan(0);

      const fromTplRes = await mcpClient.callTool({
        name: "create_from_template",
        arguments: {
          templateId: tpls.templates[0]!.id,
          spaceId: DEFAULT_SPACE_IDS.research,
          title: "MCP Template Article",
        },
      });
      expect(fromTplRes.isError).not.toBe(true);
      expect(readToolText(fromTplRes)).toContain("MCP Template Article");

      // Scoped token calling get_audit_logs via MCP must be denied & logged
      const deniedAuditRes = await mcpClient.callTool({
        name: "get_audit_logs",
        arguments: {},
      });
      expect(deniedAuditRes.isError).toBe(true);
      expect(readToolText(deniedAuditRes)).toContain("FORBIDDEN");
    } finally {
      await transport.close();
    }

    const mcpLogs = await adminSdk.auditLogs.list({ transport: "mcp", tokenId: scopedTokenMeta.id });
    expect(mcpLogs.some((l) => l.action === "batch_mutate_outline" && l.decision === "allowed")).toBe(
      true,
    );
    expect(mcpLogs.some((l) => l.action === "get_audit_logs" && l.decision === "denied")).toBe(
      true,
    );
  });
});
