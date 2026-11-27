import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { DEFAULT_SPACE_IDS } from "@inkade/db";
import { createInkadeClient } from "@inkade/sdk";
import { createInkadeApp, type InkadeAppInstance } from "./app.ts";

interface Harness {
  readonly baseUrl: string;
  readonly instance: InkadeAppInstance;
  readonly server: ReturnType<typeof Bun.serve>;
  readonly tempDir: string;
}

const activeHarnesses: Harness[] = [];

async function startTestServer(): Promise<Harness> {
  const tempDir = mkdtempSync(join(tmpdir(), "inkade-phase31-test-"));
  const instance = createInkadeApp({
    dbPath: join(tempDir, "inkade.db"),
    dataDir: tempDir,
    localAutoAuth: true,
    authSecret: "test-secret-key-for-inkade-phase31-suite-32bytes",
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

function readToolJson<T>(result: Record<string, unknown>): T {
  const items = Array.isArray(result.content) ? result.content : [];
  const first = items[0] as { text?: string } | undefined;
  return JSON.parse(first?.text ?? "{}") as T;
}

describe("Phase 31 Enterprise Todo Domain, Non-Destructive Scheduling & Scope", () => {
  test("creates Anytime & scheduled tasks with quick syntax, projects subtasks, and reschedules non-destructively while preserving bindings", async () => {
    const { baseUrl } = await startTestServer();
    const sdk = createInkadeClient({ baseUrl });

    // 1. Create Anytime task with quick syntax
    const anytimeCreated = await sdk.tasks.create({
      title: "Architecture backlog review !2 anytime 45m",
      parseQuickSyntax: true,
    });
    expect(anytimeCreated.node.contentMarkdown).toBe("Architecture backlog review");
    expect(anytimeCreated.node.priority).toBe("p2");
    expect(anytimeCreated.node.durationMin).toBe(45);
    expect(anytimeCreated.node.scheduledDate).toBeUndefined();
    expect(anytimeCreated.document.dailyDate).toBeNull();

    // Add subtask child under the Anytime task
    await sdk.outlineNodes.create({
      documentId: anytimeCreated.document.id,
      parentNodeId: anytimeCreated.node.id,
      contentMarkdown: "Draft RFC appendix",
      checked: false,
    });

    // 2. Bind an ADE thread (queued -> running -> completed) and verify runningSince lifecycle
    const binding = await sdk.threadBindings.upsert({
      documentId: anytimeCreated.document.id,
      nodeId: anytimeCreated.node.id,
      adeKind: "codex",
      externalThreadId: "thr_p31_1",
      title: "Assist RFC",
      status: "queued",
    });
    expect(binding.runningSince).toBeUndefined();

    const runningBinding = await sdk.threadBindings.update(binding.id, { status: "running" });
    expect(typeof runningBinding.runningSince).toBe("string");

    // 3. Create task in Daily 2026-11-26 and non-destructively reschedule it to 2026-11-28 then back to Anytime (null)
    const dailyTask = await sdk.tasks.create({
      title: "Ship telemetry pipeline !1 明天 上午 1h",
      referenceDate: "2026-11-25",
    });
    expect(dailyTask.node.scheduledDate).toBe("2026-11-26");
    expect(dailyTask.node.scheduledSlot).toBe("morning");
    expect(dailyTask.node.durationMin).toBe(60);
    expect(dailyTask.document.dailyDate).toBe("2026-11-26");

    const movedToFuture = await sdk.tasks.reschedule({
      nodeId: dailyTask.node.id,
      scheduledDate: "2026-11-28",
      scheduledSlot: "afternoon",
    });
    expect(movedToFuture.id).toBe(dailyTask.node.id);
    expect(movedToFuture.documentId).toBe(dailyTask.document.id);
    expect(movedToFuture.scheduledDate).toBe("2026-11-28");
    expect(movedToFuture.scheduledSlot).toBe("afternoon");

    const listedDay28 = await sdk.tasks.list({ scheduledDate: "2026-11-28" });
    expect(listedDay28.some((t) => t.node.id === dailyTask.node.id)).toBe(true);

    // Move back into Anytime pool without moving document or dropping binding
    const unscheduled = await sdk.tasks.reschedule({
      nodeId: anytimeCreated.node.id,
      scheduledDate: "2026-11-29",
    });
    expect(unscheduled.id).toBe(anytimeCreated.node.id);
    const verifiedBinding = await sdk.threadBindings.get(binding.id);
    expect(verifiedBinding.nodeId).toBe(anytimeCreated.node.id);
    expect(verifiedBinding.status).toBe("running");

    const backToAnytime = await sdk.tasks.reschedule({
      nodeId: anytimeCreated.node.id,
      scheduledDate: null,
    });
    expect(backToAnytime.scheduledDate).toBeUndefined();

    const anytimeList = await sdk.tasks.list({ bucket: "anytime" });
    const foundAnytime = anytimeList.find((t) => t.node.id === anytimeCreated.node.id);
    expect(foundAnytime).toBeTruthy();
    expect(foundAnytime?.subtasks?.length).toBe(1);
    expect(foundAnytime?.bindings.length).toBe(1);

    const finishedBinding = await sdk.threadBindings.update(binding.id, { status: "completed" });
    expect(finishedBinding.runningSince).toBeUndefined();
  });

  test("auto-spawns next recurring task on completion and cleans it up cleanly on undo", async () => {
    const { baseUrl } = await startTestServer();
    const sdk = createInkadeClient({ baseUrl });

    const created = await sdk.tasks.create({
      title: "Weekly engineering sync",
      scheduledDate: "2026-11-25",
      priority: "p2",
      recurrenceRule: "weekly",
      parseQuickSyntax: false,
    });

    const completedRes = await sdk.tasks.update(created.node.id, { checked: true });
    expect(completedRes.node.checked).toBe(true);
    expect(completedRes.node.completedAt).toBeTruthy();
    expect(completedRes.spawnedNextNode).toBeTruthy();
    expect(completedRes.spawnedNextNode?.scheduledDate).toBe("2026-12-02");
    expect(completedRes.spawnedNextNode?.recurrenceRule).toBe("weekly");
    expect(completedRes.spawnedNextNode?.priority).toBe("p2");

    // Unchecking the parent task while the spawned instance is untouched softly removes the spawned child
    const undoneRes = await sdk.tasks.update(created.node.id, { checked: false });
    expect(undoneRes.node.checked).toBe(false);
    expect(undoneRes.node.completedAt).toBeUndefined();
    expect(undoneRes.deletedSpawnedNodeId).toBe(completedRes.spawnedNextNode?.id);

    const remainingNext = await sdk.tasks.list({ scheduledDate: "2026-12-02" });
    expect(remainingNext.some((t) => t.node.id === completedRes.spawnedNextNode?.id)).toBe(false);
  });

  test("enforces Server Scope on REST batch-update and MCP reschedule_task", async () => {
    const { baseUrl } = await startTestServer();
    const adminSdk = createInkadeClient({ baseUrl });

    const researchDoc = await adminSdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.research,
      kind: "outline",
      title: "Research Sprint",
    });
    const researchTask = await adminSdk.tasks.create({
      title: "Read paper",
      documentId: researchDoc.id,
      scheduledDate: "2026-11-26",
      parseQuickSyntax: false,
    });

    const inboxDoc = await adminSdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.inbox,
      kind: "outline",
      title: "Personal Inbox Notes",
    });
    const inboxTask = await adminSdk.tasks.create({
      title: "Private errand",
      documentId: inboxDoc.id,
      scheduledDate: "2026-11-26",
      parseQuickSyntax: false,
    });

    // Token restricted strictly to sp_research
    const issued = await adminSdk.tokens.create({
      name: "Research-Only Agent",
      scope: {
        permission: "write",
        spaceIds: [DEFAULT_SPACE_IDS.research],
        includeDescendants: true,
        denyHardDelete: true,
      },
    });
    const scopedSdk = createInkadeClient({ baseUrl, token: issued.rawToken });

    // Batch update touching an unauthorized inbox task must fail atomically with 403 before mutating researchTask
    let batchRejected = false;
    let batchErr: unknown;
    try {
      await scopedSdk.tasks.batchUpdate({
        nodeIds: [researchTask.node.id, inboxTask.node.id],
        priority: "p1",
      });
    } catch (err) {
      batchRejected = true;
      batchErr = err;
    }
    expect(batchRejected).toBe(true);
    expect(batchErr).toMatchObject({ status: 403 });

    const afterRejectedBatch = await adminSdk.outlineNodes.list(researchDoc.id);
    expect(afterRejectedBatch.find((n) => n.id === researchTask.node.id)?.priority).toBeUndefined();

    // Authorized batch update on researchTask succeeds
    const batchOk = await scopedSdk.tasks.batchUpdate({
      nodeIds: [researchTask.node.id],
      priority: "p1",
      scheduledSlot: "evening",
    });
    expect(batchOk.updated.length).toBe(1);
    expect(batchOk.updated[0]?.priority).toBe("p1");

    // Verify MCP reschedule_task enforces scope too
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${issued.rawToken}` } },
    });
    const mcpClient = new Client({ name: "phase31-test", version: "1.0.0" });
    await mcpClient.connect(transport);

    try {
      const okMcp = await mcpClient.callTool({
        name: "reschedule_task",
        arguments: {
          nodeId: researchTask.node.id,
          scheduledDate: "2026-11-30",
        },
      });
      expect(okMcp.isError).not.toBe(true);
      const parsedOk = readToolJson<{ node: { scheduledDate?: string } }>(okMcp);
      expect(parsedOk.node.scheduledDate).toBe("2026-11-30");

      const deniedMcp = await mcpClient.callTool({
        name: "reschedule_task",
        arguments: {
          nodeId: inboxTask.node.id,
          scheduledDate: "2026-11-30",
        },
      });
      expect(deniedMcp.isError).toBe(true);
    } finally {
      await mcpClient.close();
    }
  });
});
