import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { asAuditBatchId, quietModeToScopePatch } from "@inkade/core";
import { DEFAULT_SPACE_IDS } from "@inkade/db";
import { createInkadeClient } from "@inkade/sdk";
import { createInkadeApp } from "./app.ts";

const servers: Array<ReturnType<typeof Bun.serve>> = [];
const tempDirs: string[] = [];

afterAll(async () => {
  await Promise.all(servers.map((srv) => srv.stop(true)));
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

async function startPhase40Server() {
  const dir = mkdtempSync(join(tmpdir(), "inkade-phase40-test-"));
  tempDirs.push(dir);
  const instance = createInkadeApp({
    dbPath: join(dir, "inkade.sqlite"),
    dataDir: dir,
    localAutoAuth: true,
  });
  await instance.ready;
  const { app } = instance;
  const srv = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: app.fetch });
  servers.push(srv);
  return { baseUrl: `http://127.0.0.1:${srv.port}` };
}

describe("V6 Phase 40: Quiet Autonomy Governance, Batch Rollback & Tasks Inbox Guard", () => {
  test("Tasks Inbox system document stays hidden from Library, Search, Summary while tasks appear in /tasks", async () => {
    const { baseUrl } = await startPhase40Server();
    const ownerSdk = createInkadeClient({ baseUrl });

    const createdTask = await ownerSdk.tasks.create({
      title: "隐身系统文档中的待办验证 #hidden-check p1",
    });
    expect(createdTask.document.properties?.systemRole).toBe("tasks_inbox");

    const docs = await ownerSdk.documents.list({ limit: 200 });
    expect(docs.some((d) => d.id === createdTask.document.id)).toBe(false);
    expect(docs.some((d) => d.title === "Tasks Inbox")).toBe(false);

    const searchHits = await ownerSdk.search.query({ q: "Tasks Inbox" });
    expect(searchHits.some((h) => h.documentId === createdTask.document.id)).toBe(false);

    const semantic = await ownerSdk.search.semantic({ q: "待办验证", mode: "hybrid" });
    expect(semantic.hits.some((h) => h.documentId === createdTask.document.id)).toBe(false);

    const summary = await ownerSdk.workspace.summary();
    const inboxSpaceStat = summary.spaces.find((s) => s.spaceId === DEFAULT_SPACE_IDS.inbox);
    expect(inboxSpaceStat?.activeCount ?? 0).toBe(0);

    const tasks = await ownerSdk.tasks.list({ status: "open" });
    expect(tasks.some((t) => t.node.id === createdTask.node.id)).toBe(true);
  });

  test("Multi-document batchId rollback rewinds cleanly, detects manual conflicts, and honors acknowledge-silent", async () => {
    const { baseUrl } = await startPhase40Server();
    const ownerSdk = createInkadeClient({ baseUrl });

    const docA = await ownerSdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.research,
      kind: "article",
      title: "Architecture Draft A",
      contentMarkdown: "# A\n\nOriginal A",
    });
    const docB = await ownerSdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.research,
      kind: "article",
      title: "Architecture Draft B",
      contentMarkdown: "# B\n\nOriginal B",
    });

    const { rawToken } = await ownerSdk.tokens.create({
      name: "quiet-writer",
      scope: {
        ...quietModeToScopePatch("autonomous"),
        spaceIds: [DEFAULT_SPACE_IDS.research],
        includeDescendants: true,
      },
    });

    const sharedBatchId = asAuditBatchId("bat_phase40_shared_1");
    const mcpClient = new Client({ name: "phase40-mcp", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: {
        headers: {
          authorization: `Bearer ${rawToken}`,
          "x-inkade-batch-id": sharedBatchId,
        },
      },
    });
    await mcpClient.connect(transport);
    try {
      const resA = await mcpClient.callTool({
        name: "update_document",
        arguments: {
          documentId: docA.id,
          contentMarkdown: "# A\n\nAgent Quiet Update A",
          changeSummary: "Quiet autonomous edit A",
        },
      });
      expect(resA.isError).not.toBe(true);

      const resB = await mcpClient.callTool({
        name: "update_document",
        arguments: {
          documentId: docB.id,
          contentMarkdown: "# B\n\nAgent Quiet Update B",
          changeSummary: "Quiet autonomous edit B",
        },
      });
      expect(resB.isError).not.toBe(true);

      const questionRes = await mcpClient.callTool({
        name: "request_human_decision",
        arguments: {
          documentId: docA.id,
          question: "Should section 2 be published externally?",
          options: ["Keep internal", "Publish"],
          urgency: "high",
        },
      });
      expect(questionRes.isError).not.toBe(true);
    } finally {
      await transport.close();
    }

    // Verify unreadAgentUpdate -> acknowledge-silent clears it cleanly
    const beforeAck = await ownerSdk.documents.get(docA.id);
    expect(beforeAck.unreadAgentUpdate).toBe(true);
    const acked = await ownerSdk.documents.acknowledgeSilent(docA.id);
    expect(acked.unreadAgentUpdate).toBe(false);

    // Verify batch digest summary contains both docs under sharedBatchId
    const batches = await ownerSdk.auditLogs.listBatches(20);
    const sharedSummary = batches.find((b) => b.batchId === sharedBatchId);
    expect(sharedSummary).toBeDefined();
    expect([...(sharedSummary?.documentIds ?? [])].sort()).toEqual([docA.id, docB.id].sort());

    // Simulate human edit on docB after batch -> conflict detected unless force: true
    await ownerSdk.documents.update(docB.id, {
      contentMarkdown: "# B\n\nHuman edited after agent",
    });

    const guardedRollback = await ownerSdk.auditLogs.rollbackBatch(sharedBatchId);
    expect(guardedRollback.rolledBackCount).toBe(0);
    expect(guardedRollback.conflicts).toHaveLength(1);
    expect(guardedRollback.conflicts[0]?.documentId).toBe(docB.id);

    // Force rollback rewinds both documents atomically
    const forcedRollback = await ownerSdk.auditLogs.rollbackBatch(sharedBatchId, { force: true });
    expect(forcedRollback.rolledBackCount).toBe(2);
    expect((await ownerSdk.documents.get(docA.id)).contentMarkdown).toBe("# A\n\nOriginal A");
    expect((await ownerSdk.documents.get(docB.id)).contentMarkdown).toBe("# B\n\nOriginal B");

    // Re-running batch rollback is idempotent (already reversed)
    const repeatRollback = await ownerSdk.auditLogs.rollbackBatch(sharedBatchId);
    expect(repeatRollback.rolledBackCount).toBe(0);
    expect(repeatRollback.skippedAlreadyReversedCount).toBeGreaterThanOrEqual(2);

    // Verify human decision question landed as blocking_question waiting_input
    const bindings = await ownerSdk.threadBindings.list({ documentId: docA.id });
    const questionBinding = bindings.find(
      (b) => b.pendingApproval?.requestKind === "blocking_question",
    );
    expect(questionBinding?.status).toBe("waiting_input");
    expect(questionBinding?.pendingApproval?.question).toBe(
      "Should section 2 be published externally?",
    );
  });
});
