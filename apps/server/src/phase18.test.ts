import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { asApprovalId, autonomyLevelToScopePatch, type InkadeEvent } from "@inkade/core";
import { DEFAULT_SPACE_IDS } from "@inkade/db";
import { createInkadeClient, subscribeInkadeEvents } from "@inkade/sdk";
import { createInkadeApp, type InkadeAppInstance } from "./app.ts";

interface Phase18Harness {
  readonly baseUrl: string;
  readonly instance: InkadeAppInstance;
  readonly server: ReturnType<typeof Bun.serve>;
  readonly tempDir: string;
}

const activeHarnesses: Phase18Harness[] = [];

async function startPhase18Server(): Promise<Phase18Harness> {
  const tempDir = mkdtempSync(join(tmpdir(), "inkade-phase18-test-"));
  const instance = createInkadeApp({
    dbPath: join(tempDir, "inkade.db"),
    dataDir: tempDir,
    localAutoAuth: true,
    authSecret: "test-secret-key-for-inkade-phase18-suite-32bytes",
  });
  await instance.ready;

  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: instance.app.fetch,
    idleTimeout: 30,
  });

  const harness: Phase18Harness = {
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
  predicate: () => T | undefined | null | false,
  timeoutMs = 3000,
): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const val = predicate();
    if (val) return val;
    await Bun.sleep(15);
  }
  throw new Error("Timed out waiting for condition");
}

describe("Phase 18 Server Control Plane, Away Summary, Storage Buckets & Reversible Ledger", () => {
  test("approve & steer thread bindings enforce scopes, emit SSE events, and record audit logs", async () => {
    const { baseUrl } = await startPhase18Server();
    const adminSdk = createInkadeClient({ baseUrl });

    const researchDoc = await adminSdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.research,
      kind: "article",
      title: "Phase 18 Control Spec",
      contentMarkdown: "# Control Spec\n\nInitial content.",
      tags: ["control"],
    });
    const secretInboxDoc = await adminSdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.inbox,
      kind: "clip",
      title: "Private Inbox",
      contentMarkdown: "Confidential note",
      tags: ["private"],
    });

    const binding = await adminSdk.threadBindings.upsert({
      documentId: researchDoc.id,
      adeKind: "bb",
      externalThreadId: "thr_ctrl_1",
      title: "Rewrite Control Spec",
      status: "waiting_input",
      unreadResult: true,
      pendingApproval: {
        id: asApprovalId("apr_ctrl_1"),
        action: "Replace Overview section",
        risk: "medium",
        diffPreview: { oldSnippet: "Initial content.", newSnippet: "Updated spec." },
      },
    });
    const inboxBinding = await adminSdk.threadBindings.upsert({
      documentId: secretInboxDoc.id,
      adeKind: "bb",
      externalThreadId: "thr_inbox_secret",
      title: "Secret Inbox Thread",
      status: "waiting_input",
    });

    // Subscribe SSE to verify live control events
    const events: InkadeEvent[] = [];
    let opened = false;
    const sub = subscribeInkadeEvents(
      { baseUrl },
      {
        onOpen: () => {
          opened = true;
        },
        onEvent: (evt) => events.push(evt),
      },
    );
    await waitFor(() => opened);

    // Tokens for read ("ask"), append ("draft"), and out-of-space write
    const { rawToken: askToken } = await adminSdk.tokens.create({
      name: "ask-token",
      scope: {
        ...autonomyLevelToScopePatch("ask"),
        spaceIds: [DEFAULT_SPACE_IDS.research],
        includeDescendants: true,
      },
    });
    const { rawToken: draftToken } = await adminSdk.tokens.create({
      name: "draft-token",
      scope: {
        ...autonomyLevelToScopePatch("draft"),
        spaceIds: [DEFAULT_SPACE_IDS.research],
        includeDescendants: true,
      },
    });
    const { rawToken: otherSpaceToken } = await adminSdk.tokens.create({
      name: "daily-only-token",
      scope: {
        ...autonomyLevelToScopePatch("auto"),
        spaceIds: [DEFAULT_SPACE_IDS.daily],
        includeDescendants: true,
      },
    });

    const askSdk = createInkadeClient({ baseUrl, token: askToken });
    const draftSdk = createInkadeClient({ baseUrl, token: draftToken });
    const otherSdk = createInkadeClient({ baseUrl, token: otherSpaceToken });

    // Read-only and draft tokens cannot approve; out-of-space token cannot approve or steer
    await expectRejectsMatch(askSdk.threadBindings.approve(binding.id, { decision: "approved" }), {
      status: 403,
      code: "FORBIDDEN",
    });
    await expectRejectsMatch(draftSdk.threadBindings.approve(binding.id, { decision: "approved" }), {
      status: 403,
      code: "FORBIDDEN",
    });
    await expectRejectsMatch(otherSdk.threadBindings.approve(binding.id, { decision: "approved" }), {
      status: 403,
      code: "FORBIDDEN",
    });
    await expectRejectsMatch(otherSdk.threadBindings.steer(binding.id, { text: "Nope", mode: "queued" }), {
      status: 403,
      code: "FORBIDDEN",
    });
    await expectRejectsMatch(askSdk.threadBindings.steer(binding.id, { text: "Nope", mode: "queued" }), {
      status: 403,
      code: "FORBIDDEN",
    });

    // Draft token CAN steer within its allowed space; whitespace steering fails validation
    await expectRejectsMatch(draftSdk.threadBindings.steer(binding.id, { text: "   ", mode: "queued" }), {
      status: 400,
      code: "VALIDATION_ERROR",
    });

    const steered = await draftSdk.threadBindings.steer(binding.id, {
      text: "Keep SQLite invariants intact",
      mode: "interrupt",
    });
    expect(steered.steeringQueue).toHaveLength(1);
    expect(steered.steeringQueue?.[0]?.mode).toBe("interrupt");
    expect(steered.steeringQueue?.[0]?.deliveredAt).toBeNull();

    // Admin approves with adjustment note -> status becomes running & decision persisted
    const approved = await adminSdk.threadBindings.approve(binding.id, {
      decision: "adjusted",
      note: "Use concise headings",
      alwaysAllow: false,
    });
    expect(approved.status).toBe("running");
    expect(approved.unreadResult).toBe(false);
    expect(approved.pendingApproval?.decision).toBe("adjusted");
    expect(approved.pendingApproval?.decisionNote).toBe("Use concise headings");
    expect(approved.pendingApproval?.decidedAt).toBeTruthy();

    // Admin denies inboxBinding -> status transitions cleanly to failed
    const denied = await adminSdk.threadBindings.approve(inboxBinding.id, {
      decision: "denied",
      note: "Too risky",
    });
    expect(denied.status).toBe("failed");
    expect(denied.pendingApproval?.decision).toBe("denied");

    await waitFor(
      () =>
        events.some((e) => e.type === "thread.binding.steered") &&
        events.some((e) => e.type === "thread.binding.approved"),
    );
    sub.unsubscribe();

    const logs = await adminSdk.auditLogs.list({ documentId: researchDoc.id });
    expect(logs.some((l) => l.action === "thread.binding.steer" && l.decision === "allowed")).toBe(
      true,
    );
    expect(logs.some((l) => l.action === "thread.binding.approve" && l.decision === "allowed")).toBe(
      true,
    );
  });

  test("away-summary orders priorities, honors since filter, and enforces scope; storage-buckets aggregates accurately", async () => {
    const { baseUrl } = await startPhase18Server();
    const adminSdk = createInkadeClient({ baseUrl });

    const oldDoc = await adminSdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.research,
      kind: "article",
      title: "Older Research Doc",
      contentMarkdown: "Older content",
      tags: ["public"],
    });
    await adminSdk.threadBindings.upsert({
      documentId: oldDoc.id,
      adeKind: "bb",
      externalThreadId: "thr_old_done",
      title: "Old Completed Job",
      status: "completed",
      lastSummary: "Finished earlier",
      unreadResult: true,
    });

    await Bun.sleep(25);
    const sinceCutoff = new Date().toISOString();
    await Bun.sleep(25);

    const recentDoc = await adminSdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.research,
      kind: "article",
      title: "Recent Agent Report",
      contentMarkdown: "Agent generated draft",
      tags: ["public"],
    });
    await adminSdk.documents.update(recentDoc.id, {
      contentMarkdown: "Agent generated draft v2",
      unreadAgentUpdate: true,
    });

    const secretInboxDoc = await adminSdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.inbox,
      kind: "clip",
      title: "Secret Inbox Clip",
      contentMarkdown: "Secret clip body",
      tags: ["secret"],
    });
    await adminSdk.attachments.upload({
      documentId: recentDoc.id,
      filename: "chart.png",
      mimeType: "image/png",
      data: new Uint8Array(512),
    });
    await adminSdk.attachments.upload({
      documentId: secretInboxDoc.id,
      filename: "secret.png",
      mimeType: "image/png",
      data: new Uint8Array(4096),
    });

    await adminSdk.threadBindings.upsert({
      documentId: recentDoc.id,
      adeKind: "bb",
      externalThreadId: "thr_recent_done",
      title: "Recent Completed",
      status: "completed",
      lastSummary: "Done",
      unreadResult: true,
    });
    await adminSdk.threadBindings.upsert({
      documentId: recentDoc.id,
      adeKind: "paseo",
      externalThreadId: "thr_recent_fail",
      title: "Recent Failed",
      status: "failed",
      lastSummary: "Timeout",
      unreadResult: true,
    });
    await adminSdk.threadBindings.upsert({
      documentId: recentDoc.id,
      adeKind: "bb",
      externalThreadId: "thr_recent_wait",
      title: "Recent Needs Decision",
      status: "waiting_input",
      lastSummary: "Approve SQLite schema change",
      unreadResult: true,
    });
    await adminSdk.threadBindings.upsert({
      documentId: secretInboxDoc.id,
      adeKind: "bb",
      externalThreadId: "thr_secret_wait",
      title: "Secret Waiting Decision",
      status: "waiting_input",
      unreadResult: true,
    });

    // Create scoped token restricted to Research + tag "public"
    const { rawToken } = await adminSdk.tokens.create({
      name: "scoped-reader",
      scope: {
        permission: "read",
        spaceIds: [DEFAULT_SPACE_IDS.research],
        includeDescendants: true,
        tagAllowlist: ["public"],
        denyHardDelete: true,
      },
    });
    const scopedSdk = createInkadeClient({ baseUrl, token: rawToken });

    // Invalid since query returns 400 VALIDATION_ERROR
    await expectRejectsMatch(adminSdk.workspace.awaySummary({ since: "not-a-valid-date" }), {
      status: 400,
      code: "VALIDATION_ERROR",
    });

    // Scoped away-summary since cutoff excludes oldDoc & secretInboxDoc, and preserves priority order
    const scopedAway = await scopedSdk.workspace.awaySummary({ since: sinceCutoff });
    expect(scopedAway.counts).toEqual({
      needsDecision: 1,
      failed: 1,
      completed: 1,
      unreadDocuments: 1,
    });
    expect(scopedAway.items.map((i) => i.category)).toEqual([
      "needs_decision",
      "failed",
      "completed",
      "unread_document",
    ]);
    expect(scopedAway.items.some((i) => i.documentId === secretInboxDoc.id)).toBe(false);
    expect(scopedAway.items.some((i) => i.title === "Old Completed Job")).toBe(false);
    expect(scopedAway.elapsedMs).toBeGreaterThanOrEqual(0);

    // Admin away-summary sees secret Inbox binding too
    const adminAway = await adminSdk.workspace.awaySummary({ since: sinceCutoff });
    expect(adminAway.items.some((i) => i.documentId === secretInboxDoc.id)).toBe(true);

    // Storage buckets aggregate counts & byte sizes with scope boundary
    const adminBuckets = await adminSdk.workspace.storageBuckets();
    const scopedBuckets = await scopedSdk.workspace.storageBuckets();
    expect(adminBuckets.clipCount).toBe(1);
    expect(adminBuckets.articleCount).toBeGreaterThanOrEqual(2);
    expect(adminBuckets.outlineCount).toBeGreaterThanOrEqual(1);
    expect(adminBuckets.attachmentBytes).toBe(512 + 4096);
    expect(adminBuckets.quotaLimitBytes).toBeGreaterThan(0);
    expect(adminBuckets.remainingPercent).toBeLessThanOrEqual(100);
    expect(adminBuckets.buckets).toHaveLength(5);

    expect(scopedBuckets.clipCount).toBe(0);
    expect(scopedBuckets.attachmentBytes).toBe(512);
  });

  test("dual-engine audit rollback preserves outline nodeId & bindings, restores articles, computes cascade, and blocks unauthorized/irreversible entries", async () => {
    const { baseUrl } = await startPhase18Server();
    const adminSdk = createInkadeClient({ baseUrl });

    // --- 1. Article edit + downstream cascade + rollback + rollback-of-rollback ---
    const article = await adminSdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.research,
      kind: "article",
      title: "Reversible Article",
      contentMarkdown: "# Reversible Article\n\n## Section A\n\nOriginal paragraph.",
      tags: ["reversible"],
    });
    const patched1 = await adminSdk.documents.patchSection(article.id, {
      headingPath: "Section A",
      mode: "replace",
      markdown: "First agent edit.",
      expectedVersion: article.version,
      changeSummary: "First edit",
    });
    await adminSdk.documents.patchSection(article.id, {
      headingPath: "Section A",
      mode: "append",
      markdown: "Second downstream edit.",
      expectedVersion: patched1.version,
      changeSummary: "Second edit",
    });

    const articleLogs = await adminSdk.auditLogs.list({ documentId: article.id });
    const firstEditLog = articleLogs.find((l) => l.summary === "First edit");
    const secondEditLog = articleLogs.find((l) => l.summary === "Second edit");
    const createLog = articleLogs.find((l) => l.action === "POST /api/v1/documents");

    expect(firstEditLog?.reversible).toBe(true);
    expect(firstEditLog?.beforeRevisionId).toBeTruthy();
    expect(firstEditLog?.afterRevisionId).toBeTruthy();
    expect(firstEditLog?.diffPreview?.oldSnippet).toContain("Original paragraph.");
    expect(firstEditLog?.diffPreview?.newSnippet).toContain("First agent edit.");
    expect(createLog?.reversible).toBe(false);
    expect(createLog?.irreversibleReason).toBeTruthy();

    // Scoped tokens: read-only, draft, and out-of-space write cannot rollback articleLog
    const { rawToken: readToken } = await adminSdk.tokens.create({
      name: "read-only",
      scope: {
        ...autonomyLevelToScopePatch("ask"),
        spaceIds: [DEFAULT_SPACE_IDS.research],
        includeDescendants: true,
      },
    });
    const { rawToken: wrongSpaceToken } = await adminSdk.tokens.create({
      name: "daily-write",
      scope: {
        ...autonomyLevelToScopePatch("auto"),
        spaceIds: [DEFAULT_SPACE_IDS.daily],
        includeDescendants: true,
      },
    });
    const { rawToken: researchWriteToken } = await adminSdk.tokens.create({
      name: "research-write",
      scope: {
        ...autonomyLevelToScopePatch("auto"),
        spaceIds: [DEFAULT_SPACE_IDS.research],
        includeDescendants: true,
      },
    });

    await expectRejectsMatch(
      createInkadeClient({ baseUrl, token: readToken }).auditLogs.rollback(firstEditLog!.id),
      { status: 403, code: "FORBIDDEN" },
    );
    await expectRejectsMatch(
      createInkadeClient({ baseUrl, token: wrongSpaceToken }).auditLogs.rollback(firstEditLog!.id),
      { status: 403, code: "FORBIDDEN" },
    );

    // Irreversible creation entry cannot be rolled back
    await expectRejectsMatch(adminSdk.auditLogs.rollback(createLog!.id), {
      status: 409,
      code: "CONFLICT",
    });

    // Authorized research write token rolls back firstEditLog -> cascade includes secondEditLog!
    const rollbackRes = await createInkadeClient({
      baseUrl,
      token: researchWriteToken,
    }).auditLogs.rollback(firstEditLog!.id);
    expect(firstEditLog?.beforeRevisionId).toBeTruthy();
    expect(rollbackRes.restoredRevisionId).toBe(firstEditLog!.beforeRevisionId!);
    expect(rollbackRes.affectedAuditIds).toContain(secondEditLog!.id);
    expect(rollbackRes.document.contentMarkdown).toContain("Original paragraph.");
    expect(rollbackRes.document.contentMarkdown).not.toContain("First agent edit.");
    expect(rollbackRes.rollbackAuditLog.reversible).toBe(true);
    expect(rollbackRes.rollbackAuditLog.action).toBe("audit.rollback");

    // Export logs are recorded with reversible: false and reject rollback
    await adminSdk.documents.exportMarkdown(article.id);
    const afterExportLogs = await adminSdk.auditLogs.list({ documentId: article.id });
    const exportLog = afterExportLogs.find((l) => l.action === "document.export.markdown");
    expect(exportLog?.reversible).toBe(false);
    expect(exportLog?.irreversibleReason).toBeTruthy();
    await expectRejectsMatch(adminSdk.auditLogs.rollback(exportLog!.id), {
      status: 409,
      code: "CONFLICT",
    });

    // --- 2. Outline rollback via stable nodeId preserving AdeThreadBinding ---
    const daily = await adminSdk.documents.getDaily("2026-11-24");
    const rootNode = await adminSdk.outlineNodes.create({
      documentId: daily.document.id,
      contentMarkdown: "Original Outline Node",
      checked: false,
    });
    const bound = await adminSdk.threadBindings.upsert({
      documentId: daily.document.id,
      nodeId: rootNode.id,
      adeKind: "bb",
      externalThreadId: "thr_outline_keep",
      title: "Bound to Outline Node",
      status: "running",
    });

    // Mutate via MCP (also verifies MCP audit revision diff capture & progressSteps/pendingApproval!)
    const { rawToken: mcpWriteToken } = await adminSdk.tokens.create({
      name: "mcp-outline-agent",
      scope: {
        ...autonomyLevelToScopePatch("auto"),
        spaceIds: [DEFAULT_SPACE_IDS.daily, DEFAULT_SPACE_IDS.research],
        includeDescendants: true,
      },
    });
    const mcpClient = new Client({ name: "inkade-phase18-mcp", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${mcpWriteToken}` } },
    });
    await mcpClient.connect(transport);
    try {
      const updateNodeRes = await mcpClient.callTool({
        name: "update_outline_node",
        arguments: {
          documentId: daily.document.id,
          nodeId: rootNode.id,
          contentMarkdown: "Mutated by MCP Agent",
          checked: true,
        },
      });
      expect(updateNodeRes.isError).not.toBe(true);

      const childRes = await mcpClient.callTool({
        name: "append_node_reply",
        arguments: {
          documentId: daily.document.id,
          parentNodeId: rootNode.id,
          contentMarkdown: "Extra child from MCP",
        },
      });
      expect(childRes.isError).not.toBe(true);

      // Update binding with progressSteps & pendingApproval via MCP
      const mcpBindingRes = await mcpClient.callTool({
        name: "update_thread_binding",
        arguments: {
          bindingId: bound.id,
          progressSteps: [
            {
              id: "stp_mcp_1",
              label: "Inspect outline",
              status: "completed",
              durationMs: 95,
              sources: [{ label: "Daily · 2026-11-24", kind: "outline" }],
            },
            {
              id: "stp_mcp_2",
              label: "Confirm rewrite",
              status: "running",
            },
          ],
          pendingApproval: {
            id: "apr_mcp_1",
            action: "Finalize outline rewrite",
            risk: "low",
          },
        },
      });
      expect(mcpBindingRes.isError).not.toBe(true);
      const parsedMcpBinding = JSON.parse(readToolText(mcpBindingRes)) as {
        binding: { status: string; progressSteps?: unknown[]; pendingApproval?: { action: string } };
      };
      expect(parsedMcpBinding.binding.status).toBe("waiting_input");
      expect(parsedMcpBinding.binding.progressSteps).toHaveLength(2);
      expect(parsedMcpBinding.binding.pendingApproval?.action).toBe("Finalize outline rewrite");

      // Scope enforcement via MCP: daily+research token cannot bind to secret Inbox doc
      const inboxDoc = await adminSdk.documents.create({
        spaceId: DEFAULT_SPACE_IDS.inbox,
        kind: "clip",
        title: "Forbidden Inbox",
        contentMarkdown: "nope",
      });
      const forbiddenBind = await mcpClient.callTool({
        name: "bind_thread",
        arguments: {
          documentId: inboxDoc.id,
          adeKind: "bb",
          externalThreadId: "thr_forbidden_mcp",
          title: "Should fail",
        },
      });
      expect(forbiddenBind.isError).toBe(true);
      expect(readToolText(forbiddenBind)).toContain("FORBIDDEN");
    } finally {
      await transport.close();
    }

    const dailyLogs = await adminSdk.auditLogs.list({ documentId: daily.document.id });
    const mcpNodeEditLog = dailyLogs.find(
      (l) => l.transport === "mcp" && l.action === "update_outline_node",
    );
    expect(mcpNodeEditLog?.reversible).toBe(true);
    expect(mcpNodeEditLog?.beforeRevisionId).toBeTruthy();
    expect(mcpNodeEditLog?.diffPreview?.oldSnippet).toContain("Original Outline Node");
    expect(mcpNodeEditLog?.diffPreview?.newSnippet).toContain("Mutated by MCP Agent");

    const outlineRollback = await adminSdk.auditLogs.rollback(mcpNodeEditLog!.id);
    expect(outlineRollback.document.kind).toBe("outline");
    expect(outlineRollback.nodes?.find((n) => n.id === rootNode.id)?.contentMarkdown).toBe(
      "Original Outline Node",
    );
    expect(outlineRollback.nodes?.find((n) => n.id === rootNode.id)?.checked).toBe(false);
    expect(
      outlineRollback.nodes?.some((n) => n.contentMarkdown === "Extra child from MCP"),
    ).toBe(false);

    // Binding reference on stable nodeId MUST still be intact!
    const preservedBindings = await adminSdk.threadBindings.list({
      documentId: daily.document.id,
      nodeId: rootNode.id,
    });
    expect(preservedBindings).toHaveLength(1);
    expect(preservedBindings[0]?.id).toBe(bound.id);
    expect(preservedBindings[0]?.nodeId).toBe(rootNode.id);
  });
});
