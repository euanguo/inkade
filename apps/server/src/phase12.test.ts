import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as Y from "yjs";
import { asWorkspaceId } from "@inkade/core";
import { DEFAULT_SPACE_IDS } from "@inkade/db";
import { createInkadeClient } from "@inkade/sdk";
import {
  YJS_SYNC_MSG_STEP_1,
  YJS_SYNC_MSG_STEP_2,
  YJS_SYNC_MSG_UPDATE,
  YjsDocumentSyncClient,
} from "@inkade/sdk/sync";
import { createInkadeApp, type InkadeAppInstance } from "./app.ts";
import type { EmbeddingProvider } from "./services/semantic-search-service.ts";

interface Phase12Harness {
  readonly baseUrl: string;
  readonly instance: InkadeAppInstance;
  readonly server: ReturnType<typeof Bun.serve>;
  readonly tempDir: string;
}

const activeHarnesses: Phase12Harness[] = [];

async function startPhase12Server(options?: {
  embeddingProvider?: EmbeddingProvider | undefined;
}): Promise<Phase12Harness> {
  const tempDir = mkdtempSync(join(tmpdir(), "inkade-phase12-test-"));
  const instance = createInkadeApp({
    dbPath: join(tempDir, "inkade.db"),
    dataDir: tempDir,
    localAutoAuth: true,
    authSecret: "test-secret-key-for-inkade-phase12-suite-32bytes",
    embeddingProvider: options?.embeddingProvider,
  });
  await instance.ready;

  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: (req, bunServer) => instance.fetch(req, bunServer),
    websocket: instance.websocket,
    idleTimeout: 30,
  });

  const harness: Phase12Harness = {
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

async function waitFor<T>(
  predicate: () => Promise<T | undefined | null | false> | T | undefined | null | false,
  timeoutMs = 3000,
): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const val = await predicate();
    if (val) return val;
    await Bun.sleep(15);
  }
  throw new Error("Timed out waiting for condition");
}

function encodeYjsFrame(type: number, payload: Uint8Array): Uint8Array {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, type);
  encoding.writeVarUint8Array(enc, payload);
  return encoding.toUint8Array(enc);
}

function decodeYjsFrame(bytes: Uint8Array): { msgType: number; payload: Uint8Array } | null {
  try {
    const dec = decoding.createDecoder(bytes);
    return {
      msgType: decoding.readVarUint(dec),
      payload: decoding.readVarUint8Array(dec),
    };
  } catch {
    return null;
  }
}

describe("Phase 12B Hybrid Semantic RAG & Yjs Real-Time Sync", () => {
  test("Hybrid semantic search, related docs, reindex, scope boundary, audit logs, and MCP semantic_search", async () => {
    const { baseUrl } = await startPhase12Server();
    const adminSdk = createInkadeClient({ baseUrl });

    // Create documents across Research (accessible to scoped token) and Inbox (forbidden)
    const docRag = await adminSdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.research,
      kind: "article",
      title: "混合语义检索与 RRF 融合架构",
      contentMarkdown:
        "本文探讨 SQLite FTS5 BM25 关键词检索与本地向量余弦相似度 Reciprocal Rank Fusion 的混合排序实践。",
      tags: ["rag", "public"],
    });

    const docCrdt = await adminSdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.research,
      kind: "article",
      title: "Yjs CRDT 多端实时协同协议",
      contentMarkdown:
        "利用 Yjs 与 IndexedDB 实现离线编辑和 WebSocket 房间增量合并，避免双引擎内容冲突。",
      tags: ["yjs", "public"],
    });

    const docVectorNotes = await adminSdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.research,
      kind: "article",
      title: "向量检索与 BM25 调优记录",
      contentMarkdown: "对比余弦相似度和 RRF k=60 参数在中文知识库中的召回效果。",
      tags: ["rag", "internal"],
    });

    const docSecretInbox = await adminSdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.inbox,
      kind: "clip",
      title: "Secret RAG Benchmark",
      contentMarkdown: "Confidential SQLite FTS5 BM25 RRF vector similarity benchmark.",
      tags: ["public"],
    });

    // Reindex workspace as admin
    const reindexRes = await adminSdk.search.reindex();
    expect(reindexRes.indexedCount + reindexRes.skippedCount).toBeGreaterThanOrEqual(4);
    expect(reindexRes.provider).toBe("local");

    // Admin hybrid search ranks docRag #1 for its topic and merges FTS + vector hits
    const hybridRes = await adminSdk.search.semantic({
      q: "混合语义检索 Reciprocal Rank Fusion",
      mode: "hybrid",
      limit: 10,
    });
    expect(hybridRes.hits.length).toBeGreaterThanOrEqual(1);
    expect(hybridRes.hits[0]?.documentId).toBe(docRag.id);
    expect(hybridRes.hits[0]?.matchSource).toBe("hybrid");

    // Semantic-only mode works offline via deterministic local vectorizer
    const semanticOnly = await adminSdk.search.semantic({
      q: "Yjs 协同 离线",
      mode: "semantic",
      limit: 5,
    });
    expect(semanticOnly.hits[0]?.documentId).toBe(docCrdt.id);
    expect(semanticOnly.hits[0]?.matchSource).toBe("semantic");

    // Related documents finds docVectorNotes (and ranks Research docs above unrelated CRDT doc)
    const related = await adminSdk.documents.related(docRag.id, 5);
    expect(related.length).toBeGreaterThanOrEqual(2);
    expect(related.map((r) => r.documentId)).toContain(docVectorNotes.id);
    const vecIdx = related.findIndex((r) => r.documentId === docVectorNotes.id);
    const crdtIdx = related.findIndex((r) => r.documentId === docCrdt.id);
    if (crdtIdx >= 0) {
      expect(vecIdx).toBeLessThan(crdtIdx);
    }

    // Create scoped token restricted to Research + tag "public"
    const { token: scopedTokenMeta, rawToken } = await adminSdk.tokens.create({
      name: "rag-reader",
      scope: {
        permission: "read",
        spaceIds: [DEFAULT_SPACE_IDS.research],
        includeDescendants: true,
        tagAllowlist: ["public"],
        denyHardDelete: true,
      },
    });
    const scopedSdk = createInkadeClient({ baseUrl, token: rawToken });

    // Non-admin cannot reindex workspace
    await expectRejectsMatch(scopedSdk.search.reindex(), {
      status: 403,
      code: "FORBIDDEN",
    });

    // Scoped token cannot see Inbox doc or "internal"-tagged Research doc in semantic search
    const scopedSearch = await scopedSdk.search.semantic({
      q: "BM25 RRF 向量检索",
      mode: "hybrid",
    });
    const scopedIds = scopedSearch.hits.map((h) => h.documentId);
    expect(scopedIds).toContain(docRag.id);
    expect(scopedIds).not.toContain(docSecretInbox.id);
    expect(scopedIds).not.toContain(docVectorNotes.id);

    // Scoped token cannot see internal-tagged doc in related documents either
    const scopedRelated = await scopedSdk.documents.related(docRag.id, 5);
    expect(scopedRelated.map((r) => r.documentId)).not.toContain(docVectorNotes.id);
    expect(scopedRelated.map((r) => r.documentId)).not.toContain(docSecretInbox.id);

    // Scoped token cannot query related docs for forbidden document
    await expectRejectsMatch(scopedSdk.documents.related(docSecretInbox.id), {
      status: 403,
      code: "FORBIDDEN",
    });

    // Audit log recorded token call for semantic_search
    const logs = await adminSdk.auditLogs.list({ tokenId: scopedTokenMeta.id });
    expect(logs.some((l) => l.action === "semantic_search" && l.decision === "allowed")).toBe(true);

    // MCP exposes 30 tools including semantic_search with strict scope enforcement
    const mcpClient = new Client({ name: "inkade-p12-mcp", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: {
        headers: { authorization: `Bearer ${rawToken}` },
      },
    });
    await mcpClient.connect(transport);
    try {
      const tools = await mcpClient.listTools();
      expect(tools.tools).toHaveLength(45);
      expect(tools.tools.map((t) => t.name)).toContain("semantic_search");
      expect(tools.tools.map((t) => t.name)).toContain("scaffold_document");
      expect(tools.tools.map((t) => t.name)).toContain("request_human_decision");

      const mcpRes = await mcpClient.callTool({
        name: "semantic_search",
        arguments: {
          q: "RRF 向量检索",
          mode: "hybrid",
          limit: 5,
        },
      });
      expect(mcpRes.isError).not.toBe(true);
      const parsed = JSON.parse(readToolText(mcpRes)) as {
        hits: Array<{ documentId: string }>;
      };
      expect(parsed.hits.map((h) => h.documentId)).toContain(docRag.id);
      expect(parsed.hits.map((h) => h.documentId)).not.toContain(docSecretInbox.id);
      expect(parsed.hits.map((h) => h.documentId)).not.toContain(docVectorNotes.id);
    } finally {
      await transport.close();
    }
  });

  test("Custom pluggable EmbeddingProvider overrides local embedder cleanly", async () => {
    const customProvider: EmbeddingProvider = {
      providerName: "openai",
      model: "mock-embed-3",
      embed(text: string): Promise<readonly number[]> {
        if (text.includes("quantum") || text.includes("qubit")) return Promise.resolve([1, 0, 0, 0]);
        if (text.includes("cooking") || text.includes("pasta")) return Promise.resolve([0, 1, 0, 0]);
        return Promise.resolve([0.1, 0.1, 0, 0]);
      },
    };

    const { baseUrl } = await startPhase12Server({ embeddingProvider: customProvider });
    const sdk = createInkadeClient({ baseUrl });

    const quantumDoc = await sdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.research,
      kind: "article",
      title: "Hardware Alpha",
      contentMarkdown: "Superconducting qubit error correction",
    });
    await sdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.research,
      kind: "article",
      title: "Kitchen Notes",
      contentMarkdown: "Fresh pasta boiling timing",
    });

    const res = await sdk.search.semantic({ q: "quantum", mode: "semantic" });
    expect(res.provider).toBe("openai");
    expect(res.model).toBe("mock-embed-3");
    expect(res.hits[0]?.documentId).toBe(quantumDoc.id);
  });

  test("WebSocket /api/v1/sync/:docId enforces auth, scope, read-only write-gate, CRDT broadcast, and snapshot persistence", async () => {
    const { baseUrl, instance } = await startPhase12Server();
    const adminSdk = createInkadeClient({ baseUrl });

    const article = await adminSdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.research,
      kind: "article",
      title: "Collaborative Spec",
      contentMarkdown: "# Collaborative Spec",
      tags: ["collab"],
    });

    const secretDoc = await adminSdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.inbox,
      kind: "clip",
      title: "Private Inbox Item",
      contentMarkdown: "Secret",
      tags: ["private"],
    });

    // Outline doc with node + AdeThreadBinding must remain intact after Yjs sync
    const daily = await adminSdk.documents.getDaily("2026-11-24");
    const outlineNode = await adminSdk.outlineNodes.create({
      documentId: daily.document.id,
      contentMarkdown: "Keep stable nodeId",
    });
    const binding = await adminSdk.threadBindings.upsert({
      documentId: daily.document.id,
      nodeId: outlineNode.id,
      adeKind: "bb",
      externalThreadId: "thr_p12_keep",
      title: "Keep binding",
    });

    const { rawToken: readToken } = await adminSdk.tokens.create({
      name: "ws-readonly",
      scope: {
        permission: "read",
        spaceIds: [DEFAULT_SPACE_IDS.research],
        includeDescendants: true,
        denyHardDelete: true,
      },
    });
    const { rawToken: writeToken } = await adminSdk.tokens.create({
      name: "ws-writer",
      scope: {
        permission: "write",
        spaceIds: [DEFAULT_SPACE_IDS.research],
        includeDescendants: true,
        denyHardDelete: true,
      },
    });

    // 1. Invalid token HTTP upgrade must fail 401
    const unauthRes = await fetch(`${baseUrl}/api/v1/sync/${article.id}?token=ink_invalid_xyz`);
    expect(unauthRes.status).toBe(401);

    // 2. Token outside document scope must fail 403
    const forbiddenRes = await fetch(`${baseUrl}/api/v1/sync/${secretDoc.id}?token=${writeToken}`);
    expect(forbiddenRes.status).toBe(403);

    // 3. Two write-authorized real WebSocket clients collaborate via YjsDocumentSyncClient
    const docClient1 = new YjsDocumentSyncClient({
      docId: article.id,
      baseUrl,
      token: writeToken,
      enableIndexedDb: false,
    });
    const docClient2 = new YjsDocumentSyncClient({
      docId: article.id,
      baseUrl,
      token: writeToken,
      enableIndexedDb: false,
    });

    await docClient1.connect();
    await docClient2.connect();
    await waitFor(() => docClient1.synced && docClient2.synced);

    docClient1.ydoc.getText("markdown").insert(0, "Hello ");
    await waitFor(() => docClient2.ydoc.getText("markdown").toJSON() === "Hello ");

    docClient2.ydoc.getText("markdown").insert(6, "Inkade!");
    await waitFor(() => docClient1.ydoc.getText("markdown").toJSON() === "Hello Inkade!");

    // 4. Read-only WebSocket client receives state, but mutations are rejected by server write-gate
    const wsUrl = `${baseUrl.replace("http://", "ws://")}/api/v1/sync/${article.id}?token=${encodeURIComponent(readToken)}`;
    const readWs = new WebSocket(wsUrl);
    readWs.binaryType = "arraybuffer";

    const readClientDoc = new Y.Doc();
    const errorBox: { value: { type?: string; code?: string } | null } = { value: null };
    let initialSynced = false;

    await new Promise<void>((resolve, reject) => {
      readWs.addEventListener("open", () => {
        readWs.send(encodeYjsFrame(YJS_SYNC_MSG_STEP_1, Y.encodeStateVector(readClientDoc)));
      });
      readWs.addEventListener("message", (evt) => {
        if (typeof evt.data === "string") {
          errorBox.value = JSON.parse(evt.data) as { type?: string; code?: string };
          return;
        }
        const buf = evt.data instanceof ArrayBuffer ? new Uint8Array(evt.data) : null;
        if (!buf) return;
        const decoded = decodeYjsFrame(buf);
        if (
          decoded &&
          (decoded.msgType === YJS_SYNC_MSG_STEP_2 || decoded.msgType === YJS_SYNC_MSG_UPDATE)
        ) {
          Y.applyUpdate(readClientDoc, decoded.payload);
          initialSynced = true;
          resolve();
        }
      });
      readWs.addEventListener("error", () => reject(new Error("WebSocket error")));
    });

    expect(initialSynced).toBe(true);
    expect(readClientDoc.getText("markdown").toJSON()).toBe("Hello Inkade!");

    // Attempt mutation from read-only client -> must be rejected and NOT reach docClient1
    const evilDoc = new Y.Doc();
    Y.applyUpdate(evilDoc, Y.encodeStateAsUpdate(readClientDoc));
    let capturedEvilUpdate: Uint8Array | null = null;
    evilDoc.on("update", (u) => {
      capturedEvilUpdate = u;
    });
    evilDoc.getText("markdown").insert(0, "UNAUTHORIZED ");
    readWs.send(encodeYjsFrame(YJS_SYNC_MSG_UPDATE, capturedEvilUpdate!));

    const errObserved = await waitFor(() => errorBox.value);
    expect(errObserved.type).toBe("error");
    expect(errObserved.code).toBe("FORBIDDEN");

    await Bun.sleep(40);
    expect(docClient1.ydoc.getText("markdown").toJSON()).toBe("Hello Inkade!");

    readWs.close();
    await docClient1.disconnect();
    await docClient2.disconnect();

    // 5. Persisted Yjs snapshot survives room eviction / new client reconnect
    const persistedBase64 = await waitFor(() =>
      instance.repos.searchConfig.getDocumentYjsState(
        asWorkspaceId("ws_default"),
        article.id,
      ),
    );
    expect(persistedBase64).toBeTruthy();

    const docClient3 = new YjsDocumentSyncClient({
      docId: article.id,
      baseUrl,
      token: writeToken,
      enableIndexedDb: false,
    });
    await docClient3.connect();
    await waitFor(() => docClient3.synced);
    expect(docClient3.ydoc.getText("markdown").toJSON()).toBe("Hello Inkade!");
    await docClient3.disconnect();

    // 6. Dual-Engine Write Integrity: outline node & thread binding untouched
    const nodesAfter = await adminSdk.outlineNodes.list(daily.document.id);
    const bindingsAfter = await adminSdk.threadBindings.list({ documentId: daily.document.id });
    expect(nodesAfter.some((n) => n.id === outlineNode.id)).toBe(true);
    expect(bindingsAfter.some((b) => b.id === binding.id)).toBe(true);
  });
});
