import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { countBpeTokens } from "@inkade/core";
import { DEFAULT_SPACE_IDS } from "@inkade/db";
import { createInkadeClient, InkadeApiError } from "@inkade/sdk";
import { createInkadeApp, type InkadeAppInstance } from "./app.ts";

interface Harness {
  readonly baseUrl: string;
  readonly instance: InkadeAppInstance;
  readonly server: ReturnType<typeof Bun.serve>;
  readonly tempDir: string;
}

const activeHarnesses: Harness[] = [];

async function startTestServer(): Promise<Harness> {
  const tempDir = mkdtempSync(join(tmpdir(), "inkade-phase43-test-"));
  const instance = createInkadeApp({
    dbPath: join(tempDir, "inkade.db"),
    dataDir: tempDir,
    localAutoAuth: true,
    authSecret: "test-secret-key-for-inkade-phase43-suite-32bytes",
  });
  await instance.ready;

  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: instance.app.fetch,
    idleTimeout: 30,
  });

  const h: Harness = {
    baseUrl: `http://127.0.0.1:${server.port}`,
    instance,
    server,
    tempDir,
  };
  activeHarnesses.push(h);
  return h;
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

function readToolText(res: Awaited<ReturnType<Client["callTool"]>>): string {
  const items = res.content as Array<{ type?: string; text?: string }>;
  return items.map((c) => c.text ?? "").join("\n");
}

describe("Phase 43 — Orama Hybrid Vector RAG, Ask Inkade, Connect AI & Context Packs", () => {
  test("chunks Markdown/Outline docs, searches via Orama hybrid BM25+vector, isolates multi-dimension embeddings, and excludes system/unauthorized docs", async () => {
    const { baseUrl, instance } = await startTestServer();
    const adminSdk = createInkadeClient({ baseUrl });

    const docResearch = await adminSdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.research,
      kind: "article",
      title: "Orama 混合检索引擎设计",
      tags: ["public", "rag"],
      contentMarkdown: [
        "# Retrieval Architecture",
        "",
        "Inkade adopts Orama hybrid BM25 lexical scoring combined with chunk-level dense vector similarity.",
        "",
        "## Float32 Storage",
        "",
        "Chunk embeddings persist in SQLite chunk_embeddings BLOB rows keyed by embedding model dimension.",
      ].join("\n"),
    });

    const daily = await adminSdk.documents.getDaily("2026-11-25");
    const outlineNode = await adminSdk.outlineNodes.create({
      documentId: daily.document.id,
      parentNodeId: null,
      contentMarkdown: "Verify Orama CJK bigram tokenization on Chinese notes #rag",
    });

    const docSecretInbox = await adminSdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.inbox,
      kind: "article",
      title: "Confidential Payroll Budget",
      tags: ["private"],
      contentMarkdown: "Restricted executive payroll compensation forecast 2027.",
    });

    // Insert a system-internal document directly via repo; must never surface in search/RAG/index
    await instance.repos.document.createDocument(
      docResearch.workspaceId,
      {
        spaceId: DEFAULT_SPACE_IDS.inbox,
        kind: "article",
        title: "Internal Tasks Backing Store",
        contentMarkdown: "Orama confidential system store secret payroll token.",
        properties: { systemRole: "tasks_inbox" },
      },
      { actorType: "system" },
    );

    const reindex = await adminSdk.search.reindex();
    expect(reindex.indexedCount + reindex.skippedCount).toBeGreaterThanOrEqual(3);
    expect(reindex.provider).toBe("local");

    const status = await adminSdk.search.indexStatus();
    expect(status.provider).toBe("local");
    expect(status.dimensions).toBe(128);
    expect(status.indexedDocuments).toBeGreaterThanOrEqual(3);
    expect(status.indexedChunks).toBeGreaterThanOrEqual(2);
    expect(status.lastIndexedAt).not.toBeNull();
    expect(status.reindexing.active).toBe(false);

    const hybridRes = await adminSdk.search.semantic({
      q: "Orama Float32 混合检索",
      mode: "hybrid",
      limit: 10,
    });
    expect(hybridRes.hits.some((h) => h.documentId === docResearch.id)).toBe(true);
    expect(hybridRes.hits.every((h) => h.title !== "Internal Tasks Backing Store")).toBe(true);

    // Scoped Research token never sees Inbox secrets
    const researchToken = await adminSdk.tokens.create({
      name: "research-reader",
      scope: {
        permission: "read",
        spaceIds: [DEFAULT_SPACE_IDS.research],
        includeDescendants: true,
        denyHardDelete: true,
      },
    });
    const researchSdk = createInkadeClient({ baseUrl, token: researchToken.rawToken });
    const scopedRes = await researchSdk.search.semantic({
      q: "payroll compensation Orama",
      mode: "hybrid",
      limit: 10,
    });
    expect(scopedRes.hits.some((h) => h.documentId === docSecretInbox.id)).toBe(false);
    expect(scopedRes.hits.every((h) => h.spaceId === DEFAULT_SPACE_IDS.research)).toBe(true);

    // Multi-dimension external embedding switch + POST /api/v1/ai/test-embedding
    instance.services.aiRewrite.setTestTransport({ allowLocalForTest: true });
    instance.services.semanticSearch.setTestTransport({
      allowLocalForTest: true,
      fetchFn: (_input, init) => {
        const body =
          typeof init?.body === "string"
            ? (JSON.parse(init.body) as { input?: string | string[] })
            : {};
        const items = Array.isArray(body.input) ? body.input : [String(body.input ?? "")];
        const data = items.map((text, index) => ({
          object: "embedding",
          index,
          embedding: Array.from({ length: 8 }, (_, d) =>
            text.toLowerCase().includes("orama") ? (d === 0 ? 0.95 : 0.1) : (d === 4 ? 0.9 : 0.05),
          ),
        }));
        return Promise.resolve(
          new Response(JSON.stringify({ object: "list", model: "mini-8d", data }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      },
    });

    // Non-admin blocked from testing embedding connection
    let testDenied: unknown = null;
    try {
      await researchSdk.ai.testEmbedding({ embeddingProvider: "local" });
    } catch (err) {
      testDenied = err;
    }
    expect(testDenied).toBeInstanceOf(InkadeApiError);
    expect((testDenied as InkadeApiError).status).toBe(403);

    const embTestRes = await adminSdk.ai.testEmbedding({
      embeddingProvider: "openai-compatible",
      embeddingBaseUrl: "https://emb.example.invalid/v1",
      embeddingModel: "mini-8d",
      embeddingApiKey: "emb-secret",
    });
    expect(embTestRes.ok).toBe(true);
    expect(embTestRes.dimensions).toBe(8);
    expect(embTestRes.model).toBe("mini-8d");

    await adminSdk.ai.updateSettings({
      embeddingProvider: "openai-compatible",
      embeddingBaseUrl: "https://emb.example.invalid/v1",
      embeddingModel: "mini-8d",
      embeddingApiKey: "emb-secret",
    });

    const reindex8d = await adminSdk.search.reindex();
    expect(reindex8d.provider).toBe("openai-compatible");
    expect(reindex8d.model).toBe("mini-8d");

    const status8d = await adminSdk.search.indexStatus();
    expect(status8d.dimensions).toBe(8);
    expect(status8d.provider).toBe("openai-compatible");

    const semantic8d = await adminSdk.search.semantic({
      q: "Orama architecture",
      mode: "semantic",
      limit: 5,
    });
    expect(semantic8d.hits.some((h) => h.documentId === docResearch.id)).toBe(true);
    expect(outlineNode.id.length).toBeGreaterThan(0);
  });

  test("Ask Inkade streams offline fallback evidence and mocked Vercel AI SDK answers with strict TokenScope enforcement", async () => {
    const { baseUrl, instance } = await startTestServer();
    const adminSdk = createInkadeClient({ baseUrl });

    const docSpec = await adminSdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.research,
      kind: "article",
      title: "Query Engine Specification",
      tags: ["public", "spec"],
      contentMarkdown: [
        "# Indexing Pipeline",
        "",
        Array.from(
          { length: 34 },
          (_, i) =>
            `Pipeline overview sentence ${i}: Inkade normalizes document blocks, deduplicates chunk hashes, and coordinates storage updates incrementally.`,
        ).join(" "),
        "",
        "## Hybrid Scoring",
        "",
        "Orama executes BM25 + Float32 cosine scoring with reciprocal fusion ranking across hybrid semantic queries.",
      ].join("\n"),
    });

    const docPrivate = await adminSdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.inbox,
      kind: "article",
      title: "Top Secret M&A Note",
      tags: ["secret"],
      contentMarkdown: "Project Falcon acquisition price is 99M USD confidential.",
    });

    await adminSdk.search.reindex();

    const researchToken = await adminSdk.tokens.create({
      name: "ask-researcher",
      scope: {
        permission: "read",
        spaceIds: [DEFAULT_SPACE_IDS.research],
        includeDescendants: true,
        denyHardDelete: true,
      },
    });
    const researchSdk = createInkadeClient({ baseUrl, token: researchToken.rawToken });

    // 1) Offline fallback mode streams citations & grounded summary cleanly without configured LLM
    let metaFallback = false;
    const offlineDeltas: string[] = [];
    const offlineRes = await researchSdk.ai.askStream(
      {
        question: "How does Orama hybrid scoring work?",
        context: { mode: "all" },
        mode: "hybrid",
      },
      {
        onMeta: (m) => {
          metaFallback = m.fallbackMode;
        },
        onDelta: (chunk) => offlineDeltas.push(chunk),
      },
    );
    expect(metaFallback).toBe(true);
    expect(offlineRes.fallbackMode).toBe(true);
    expect(offlineRes.citations.some((c) => c.docId === docSpec.id)).toBe(true);
    expect(offlineRes.citations.some((c) => c.docId === docPrivate.id)).toBe(false);
    expect(offlineRes.fullText).toContain("[1]");
    expect(offlineDeltas.length).toBeGreaterThan(0);

    // 2) Cross-space Ask context request is rejected with 403 FORBIDDEN
    let forbiddenErr: unknown = null;
    try {
      await researchSdk.ai.askStream({
        question: "What is Project Falcon?",
        context: { mode: "space", spaceId: DEFAULT_SPACE_IDS.inbox },
      });
    } catch (err) {
      forbiddenErr = err;
    }
    expect(forbiddenErr).toBeInstanceOf(InkadeApiError);
    expect((forbiddenErr as InkadeApiError).status).toBe(403);

    // 3) Mocked external LLM SSE stream through Vercel AI SDK
    instance.services.aiRewrite.setTestTransport({ allowLocalForTest: true });
    instance.services.ask.setTestTransport({
      allowLocalForTest: true,
      fetchFn: () => {
        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ choices: [{ delta: { content: "Orama merges BM25 and " } }] })}\n\n`,
              ),
            );
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  choices: [
                    {
                      delta: { content: "Float32 vector scores [1]." },
                      finish_reason: "stop",
                    },
                  ],
                })}\n\n`,
              ),
            );
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          },
        });
        return Promise.resolve(
          new Response(stream, {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          }),
        );
      },
    });

    await adminSdk.ai.updateSettings({
      enabled: true,
      provider: "openai",
      baseUrl: "https://api.openai.example/v1",
      model: "gpt-4o-mini",
      apiKey: "sk-mock-ask-key",
    });

    const llmRes = await researchSdk.ai.askStream({
      question: "How does scoring work?",
      context: { mode: "documents", documentIds: [docSpec.id] },
    });
    expect(llmRes.fallbackMode).toBe(false);
    expect(llmRes.provider).toBe("openai");
    expect(llmRes.fullText).toBe("Orama merges BM25 and Float32 vector scores [1].");
    expect(llmRes.citations[0]?.headingPath).toContain("Hybrid Scoring");
  });

  test("Context Packs enforce CRUD permissions, TokenScope intersection, BPE maxTokens cap, MCP tools/resources, and /connect/status telemetry", async () => {
    const { baseUrl } = await startTestServer();
    const adminSdk = createInkadeClient({ baseUrl });

    const docResearch = await adminSdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.research,
      kind: "article",
      title: "Research Core Guide",
      tags: ["core"],
      contentMarkdown: Array.from(
        { length: 40 },
        (_, i) => `Guideline ${i}: Keep domain logic pure inside packages/core with strict invariants.`,
      ).join("\n"),
    });

    const docInboxSecret = await adminSdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.inbox,
      kind: "article",
      title: "Private Inbox Diary",
      tags: ["core"],
      contentMarkdown: "Private diary thoughts never meant for research tokens.",
    });

    const researchToken = await adminSdk.tokens.create({
      name: "pack-reader",
      scope: {
        permission: "read",
        spaceIds: [DEFAULT_SPACE_IDS.research],
        includeDescendants: true,
        denyHardDelete: true,
      },
    });
    const researchSdk = createInkadeClient({ baseUrl, token: researchToken.rawToken });

    // Non-admin cannot create Context Packs
    let packDenied: unknown = null;
    try {
      await researchSdk.contextPacks.create({
        name: "Unauthorized Pack",
        rules: {},
      });
    } catch (err) {
      packDenied = err;
    }
    expect(packDenied).toBeInstanceOf(InkadeApiError);
    expect((packDenied as InkadeApiError).status).toBe(403);

    // Admin creates a tight-budget pack pinning docInboxSecret + docResearch
    const pack = await adminSdk.contextPacks.create({
      name: "Agent Kickoff Pack",
      slug: "agent-kickoff",
      description: "Architecture + pinned onboarding",
      maxTokens: 520,
      rules: {
        pinnedDocIds: [docInboxSecret.id, docResearch.id],
        recentDays: 30,
        excludeSystem: true,
      },
    });
    expect(pack.slug).toBe("agent-kickoff");

    const listed = await adminSdk.contextPacks.list();
    expect(listed.some((p) => p.id === pack.id)).toBe(true);

    // Admin sees docInboxSecret + docResearch bounded <= 520 BPE tokens
    const adminRendered = await adminSdk.contextPacks.getBySlug("agent-kickoff", { maxTokens: 520 });
    expect(adminRendered.totalTokens).toBeLessThanOrEqual(520);
    expect(countBpeTokens(adminRendered.renderedMarkdown)).toBe(adminRendered.totalTokens);
    expect(adminRendered.items.some((i) => i.docId === docInboxSecret.id)).toBe(true);

    // Research-only token gets ONLY authorized Research docs via REST & MCP
    const scopedRendered = await researchSdk.contextPacks.getBySlug("agent-kickoff", { maxTokens: 500 });
    expect(scopedRendered.totalTokens).toBeLessThanOrEqual(500);
    expect(scopedRendered.items.some((i) => i.docId === docInboxSecret.id)).toBe(false);
    expect(scopedRendered.items.some((i) => i.docId === docResearch.id)).toBe(true);

    const mcpClient = new Client({ name: "inkade-p43-mcp", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: {
        headers: { authorization: `Bearer ${researchToken.rawToken}` },
      },
    });
    await mcpClient.connect(transport);
    try {
      const packsTool = await mcpClient.callTool({ name: "list_context_packs", arguments: {} });
      expect(packsTool.isError).not.toBe(true);
      expect(readToolText(packsTool)).toContain("agent-kickoff");

      const readPackTool = await mcpClient.callTool({
        name: "read_context_pack",
        arguments: { slug: "agent-kickoff", maxTokens: 500 },
      });
      expect(readPackTool.isError).not.toBe(true);
      const mcpPackPayload = JSON.parse(readToolText(readPackTool)) as {
        uri: string;
        totalTokens: number;
        renderedMarkdown: string;
      };
      expect(mcpPackPayload.uri).toBe("inkade://pack/agent-kickoff");
      expect(mcpPackPayload.totalTokens).toBeLessThanOrEqual(500);
      expect(mcpPackPayload.renderedMarkdown).not.toContain("Private Inbox Diary");
      expect(mcpPackPayload.renderedMarkdown).toContain("Research Core Guide");

      const resource = await mcpClient.readResource({ uri: "inkade://pack/agent-kickoff" });
      const resText = (resource.contents[0] as { text?: string })?.text ?? "";
      expect(resText).toContain("Research Core Guide");
      expect(resText).not.toContain("Private Inbox Diary");
    } finally {
      await mcpClient.close();
    }

    // Connection ping + MCP telemetry reflects calls
    const connectStatus = await adminSdk.connect.status();
    expect(connectStatus.ok).toBe(true);
    expect(connectStatus.totalTools).toBe(45);
    expect(connectStatus.contextPacksCount).toBe(1);
    expect(connectStatus.mcpEndpoint).toContain("/mcp");
    expect(connectStatus.recentMcpCalls.some((c) => c.action === "read_context_pack")).toBe(true);

    // Update + delete pack
    const updatedPack = await adminSdk.contextPacks.update(pack.id, { maxTokens: 800 });
    expect(updatedPack.maxTokens).toBe(800);
    await adminSdk.contextPacks.delete(pack.id);
    const afterDelete = await adminSdk.contextPacks.list();
    expect(afterDelete.some((p) => p.id === pack.id)).toBe(false);
  });
});
