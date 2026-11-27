import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { asUserId, type InkadeEvent } from "@inkade/core";
import { DEFAULT_SPACE_IDS, DEFAULT_WORKSPACE_ID } from "@inkade/db";
import { createInkadeClient, subscribeInkadeEvents } from "@inkade/sdk";
import { createInkadeApp, type InkadeAppInstance } from "./app.ts";
import type { Principal } from "./types.ts";

interface Phase48Harness {
  readonly baseUrl: string;
  readonly instance: InkadeAppInstance;
  readonly server: ReturnType<typeof Bun.serve>;
  readonly tempDir: string;
}

const activeHarnesses: Phase48Harness[] = [];

async function startPhase48Server(): Promise<Phase48Harness> {
  const tempDir = mkdtempSync(join(tmpdir(), "inkade-phase48-test-"));
  const instance = createInkadeApp({
    dbPath: join(tempDir, "inkade.db"),
    dataDir: tempDir,
    localAutoAuth: true,
    authSecret: "test-secret-key-for-inkade-phase48-suite-32bytes",
  });
  await instance.ready;

  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: (req, bunServer) => instance.fetch(req, bunServer),
    websocket: instance.websocket,
    idleTimeout: 30,
  });

  const harness: Phase48Harness = {
    baseUrl: `http://127.0.0.1:${server.port}`,
    instance,
    server,
    tempDir,
  };
  activeHarnesses.push(harness);
  return harness;
}

afterEach(async () => {
  while (activeHarnesses.length > 0) {
    const h = activeHarnesses.pop();
    if (!h) continue;
    await h.server.stop(true);
    h.instance.close();
    rmSync(h.tempDir, { recursive: true, force: true });
  }
});

function makeOwnerPrincipal(): Principal {
  return {
    kind: "user",
    userId: asUserId("usr_local_owner"),
    workspaceId: DEFAULT_WORKSPACE_ID,
    scope: {
      permission: "admin",
      spaceIds: "*",
      includeDescendants: true,
      denyHardDelete: false,
      allowGovernanceMutation: true,
    },
    actorType: "human",
    actorId: asUserId("usr_local_owner"),
  };
}

function readToolText(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const content = result.content as Array<{ type: string; text?: string }>;
  return content.find((c) => c.type === "text")?.text ?? "";
}

describe("Phase 48 — Wake routing bus, bridge sessions, and MCP piggyback", () => {
  test("coalesces steering/comment wakes within 1.5s and downgrades trust to collaborator", async () => {
    const { baseUrl, instance } = await startPhase48Server();
    const ownerSdk = createInkadeClient({ baseUrl });
    const ownerPrincipal = makeOwnerPrincipal();

    const doc = await ownerSdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.research,
      kind: "article",
      title: "Coalesce Spec",
      contentMarkdown: "# Intro\n\nInitial draft.",
    });

    const binding = await ownerSdk.threadBindings.upsert({
      documentId: doc.id,
      adeKind: "codex",
      externalThreadId: "thr_coalesce_1",
      title: "Codex Session",
      status: "running",
    });

    const first = await instance.services.wake.enqueueWake(ownerPrincipal, {
      documentId: doc.id,
      bindingId: binding.id,
      reason: "comment_sent",
      senderKind: "owner",
      senderName: "Euan",
      summary: "First note",
      messageText: "Please check https://owner.example.com/a",
    });

    const second = await instance.services.wake.enqueueWake(ownerPrincipal, {
      documentId: doc.id,
      bindingId: binding.id,
      reason: "comment_sent",
      senderKind: "collaborator",
      senderName: "Mallory",
      summary: "Second note",
      messageText: "Also check https://evil.example.com/b",
    });

    expect(second.id).toBe(first.id);
    expect(second.senderKind).toBe("collaborator");
    expect(second.formattedPromptText).toContain("From: Mallory (collaborator, not owner)");
    expect(second.formattedPromptText).toContain("Please check [link]");
    expect(second.formattedPromptText).toContain("Also check [link]");
    expect(second.formattedPromptText).not.toContain("https://evil.example.com");

    const polled = await ownerSdk.threadBindings.pollWakeEvents({
      adeKind: "codex",
      externalThreadId: "thr_coalesce_1",
    });
    expect(polled).toHaveLength(1);
    expect(polled[0]?.id).toBe(first.id);
    expect(polled[0]?.deliveryStatus).toBe("delivered");

    // Second poll sees zero pending wakes
    const polledAgain = await ownerSdk.threadBindings.pollWakeEvents({
      adeKind: "codex",
      externalThreadId: "thr_coalesce_1",
    });
    expect(polledAgain).toHaveLength(0);
  });

  test("enforces 20 requests/min rate limit per binding/unowned target with 429 RATE_LIMITED", async () => {
    const { baseUrl } = await startPhase48Server();
    const ownerSdk = createInkadeClient({ baseUrl });

    const doc = await ownerSdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.research,
      kind: "article",
      title: "Rate Limit Spec",
      contentMarkdown: "# Body",
    });
    const binding = await ownerSdk.threadBindings.upsert({
      documentId: doc.id,
      adeKind: "claude-code",
      externalThreadId: "cc_rate_1",
      title: "Rate Session",
      status: "running",
    });

    for (let i = 0; i < 20; i += 1) {
      await ownerSdk.threadBindings.steer(binding.id, {
        text: `Steer #${i + 1}`,
        mode: "queued",
      });
    }

    let caught: unknown;
    try {
      await ownerSdk.threadBindings.steer(binding.id, {
        text: "Steer #21",
        mode: "queued",
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect(caught).toMatchObject({ status: 429, code: "RATE_LIMITED" });
  });

  test("stores unowned wakes and transfers them once to claiming session or first agent document write", async () => {
    const { baseUrl, instance } = await startPhase48Server();
    const ownerSdk = createInkadeClient({ baseUrl });
    const ownerPrincipal = makeOwnerPrincipal();

    const docA = await ownerSdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.research,
      kind: "article",
      title: "Unowned Claim Binding Doc",
      contentMarkdown: "# A",
    });
    const docB = await ownerSdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.research,
      kind: "article",
      title: "Unowned First Write Doc",
      contentMarkdown: "# B",
    });

    // Insert stale (>1h old) unowned wake on docA
    const staleCreatedAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    await instance.repos.threadBinding.enqueueOrCoalesceWakeEvent(DEFAULT_WORKSPACE_ID, {
      bindingId: null,
      documentId: docA.id,
      targetAdeKind: null,
      targetExternalThreadId: null,
      targetWorkspacePath: null,
      senderKind: "owner",
      senderName: "Euan",
      reason: "unowned_request",
      summary: "Review doc A",
      formattedPromptText: "From: Euan (owner)\nReview doc A",
      sourcePayload: {
        kind: "inkade.wake.v1",
        wakeId: "wke_stale_seed" as never,
        reason: "unowned_request",
        senderKind: "owner",
        senderName: "Euan",
        documentId: docA.id,
        documentTitle: docA.title,
        summary: "Review doc A",
        createdAt: staleCreatedAt,
      },
      dedupeKey: null,
      createdAt: staleCreatedAt,
    });

    // Human owner edit does NOT steal unowned request
    await ownerSdk.documents.update(docA.id, {
      contentMarkdown: "# A\n\nHuman note.",
    });

    const pendingBinding = await ownerSdk.threadBindings.upsert({
      documentId: docA.id,
      adeKind: "any",
      externalThreadId: "thr_pending_claim_1",
      title: "Pending task",
      status: "queued",
    });

    // Agent 1 claims the binding -> gets unowned wake with >1h header
    await ownerSdk.threadBindings.claim(pendingBinding.id, {
      adeKind: "codex",
      externalThreadId: "codex_claimer_1",
    });

    const wakes1 = await ownerSdk.threadBindings.pollWakeEvents({
      adeKind: "codex",
      externalThreadId: "codex_claimer_1",
    });
    expect(wakes1).toHaveLength(1);
    expect(wakes1[0]?.formattedPromptText).toContain("[Unowned Request Transfer]");
    expect(wakes1[0]?.formattedPromptText).toContain("hour(s) ago");

    // Second binding on same doc gets nothing (one-time transfer)
    const pendingBinding2 = await ownerSdk.threadBindings.upsert({
      documentId: docA.id,
      adeKind: "any",
      externalThreadId: "thr_pending_claim_2",
      title: "Pending task 2",
      status: "queued",
    });
    await ownerSdk.threadBindings.claim(pendingBinding2.id, {
      adeKind: "codex",
      externalThreadId: "codex_claimer_2",
    });
    const wakes2 = await ownerSdk.threadBindings.pollWakeEvents({
      adeKind: "codex",
      externalThreadId: "codex_claimer_2",
    });
    expect(wakes2).toHaveLength(0);

    // Unowned wake on docB transferred on first agent write with X-Inkade-Session-Id
    await instance.services.wake.enqueueWake(ownerPrincipal, {
      documentId: docB.id,
      reason: "unowned_request",
      senderKind: "owner",
      senderName: "Euan",
      summary: "Handle doc B",
      messageText: "Please update doc B",
    });

    const agentToken = await ownerSdk.tokens.create({
      name: "DocB Agent",
      scope: {
        permission: "write",
        spaceIds: [DEFAULT_SPACE_IDS.research],
        includeDescendants: true,
        denyHardDelete: true,
      },
    });

    const mcpClient = new Client({ name: "agent-write-claimer", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: {
        headers: {
          authorization: `Bearer ${agentToken.rawToken}`,
          "x-inkade-host": "cursor",
          "x-inkade-session-id": "cursor_writer_1",
        },
      },
    });
    await mcpClient.connect(transport);
    try {
      const updateRes = await mcpClient.callTool({
        name: "update_document",
        arguments: {
          documentId: docB.id,
          contentMarkdown: "# B\n\nAgent touched it.",
        },
      });
      expect(updateRes.isError).toBeFalsy();
      const parsed = JSON.parse(readToolText(updateRes)) as {
        document: { id: string };
        _inkadeWakeMessages?: readonly { formattedPromptText: string }[];
      };
      expect(parsed.document.id).toBe(docB.id);
      expect(parsed._inkadeWakeMessages).toHaveLength(1);
      expect(parsed._inkadeWakeMessages?.[0]?.formattedPromptText).toContain(
        "[Unowned Request Transfer]",
      );
    } finally {
      await transport.close();
    }
  });

  test("supports bridge heartbeats, long-poll wait with AbortSignal, ACK, SSE, and Scope isolation", async () => {
    const { baseUrl } = await startPhase48Server();
    const ownerSdk = createInkadeClient({ baseUrl });

    const researchDoc = await ownerSdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.research,
      kind: "article",
      title: "Research Wake Target",
      contentMarkdown: "# Research",
    });
    const inboxDoc = await ownerSdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.inbox,
      kind: "article",
      title: "Private Inbox Target",
      contentMarkdown: "# Secret",
    });

    const researchBinding = await ownerSdk.threadBindings.upsert({
      documentId: researchDoc.id,
      adeKind: "codex",
      externalThreadId: "codex_live_1",
      title: "Research Codex",
      status: "running",
    });
    const inboxBinding = await ownerSdk.threadBindings.upsert({
      documentId: inboxDoc.id,
      adeKind: "cursor",
      externalThreadId: "codex_live_1",
      title: "Inbox Cursor",
      status: "running",
    });

    const session = await ownerSdk.threadBindings.heartbeatBridgeSession({
      harnessName: "codex",
      adeKind: "codex",
      externalThreadId: "codex_live_1",
      workspacePath: "/repo/inkade",
      pid: process.pid,
      capabilities: { wakesIdle: true },
    });
    expect(session.status).toBe("online");

    const listedSessions = await ownerSdk.threadBindings.listBridgeSessions({
      harnessName: "codex",
    });
    expect(listedSessions.some((s) => s.id === session.id)).toBe(true);

    const researchOnlyToken = await ownerSdk.tokens.create({
      name: "Research Scoped Bridge",
      scope: {
        permission: "append",
        spaceIds: [DEFAULT_SPACE_IDS.research],
        includeDescendants: true,
        denyHardDelete: true,
      },
    });
    const researchSdk = createInkadeClient({ baseUrl, token: researchOnlyToken.rawToken });

    const receivedEvents: InkadeEvent[] = [];
    const sub = subscribeInkadeEvents(
      { baseUrl, token: researchOnlyToken.rawToken },
      { onEvent: (evt) => receivedEvents.push(evt) },
    );

    try {
      // Steer inbox (forbidden to researchSdk) and research (allowed to researchSdk)
      const waitPromise = researchSdk.threadBindings.waitWakeEvents({
        externalThreadId: "codex_live_1",
        timeoutMs: 3000,
      });

      await new Promise((r) => setTimeout(r, 80));
      await ownerSdk.threadBindings.steer(inboxBinding.id, {
        text: "Secret inbox steering",
        mode: "queued",
      });
      await ownerSdk.threadBindings.steer(researchBinding.id, {
        text: "Authorized research steering",
        mode: "interrupt",
      });

      const waited = await waitPromise;
      expect(waited).toHaveLength(1);
      expect(waited[0]?.documentId).toBe(researchDoc.id);
      expect(waited[0]?.formattedPromptText).toContain("Authorized research steering");

      // Scoped token cannot ACK inbox wake or poll inbox doc explicitly
      const inboxPending = await ownerSdk.threadBindings.pollWakeEvents({
        documentId: inboxDoc.id,
        markDelivered: false,
      });
      expect(inboxPending).toHaveLength(1);

      let forbiddenErr: unknown;
      try {
        await researchSdk.threadBindings.ackWakeEvent(inboxPending[0]!.id);
      } catch (err) {
        forbiddenErr = err;
      }
      expect(forbiddenErr).toMatchObject({ status: 403, code: "FORBIDDEN" });

      // ACK research wake
      const acked = await researchSdk.threadBindings.ackWakeEvent(waited[0]!.id, {
        status: "acked",
      });
      expect(acked.deliveryStatus).toBe("acked");
      expect(acked.ackedAt).not.toBeNull();

      await new Promise((r) => setTimeout(r, 80));
      const wakeEvents = receivedEvents.filter(
        (e) => e.type === "wake.enqueued" || e.type === "wake.acked",
      );
      expect(wakeEvents.some((e) => e.documentId === researchDoc.id)).toBe(true);
      expect(wakeEvents.some((e) => e.documentId === inboxDoc.id)).toBe(false);

      // AbortSignal cancels wait cleanly
      const abortController = new AbortController();
      setTimeout(() => abortController.abort(), 50);
      let aborted = false;
      try {
        await researchSdk.threadBindings.waitWakeEvents(
          { externalThreadId: "codex_live_1", timeoutMs: 5000 },
          { signal: abortController.signal },
        );
      } catch {
        aborted = true;
      }
      expect(aborted).toBe(true);
    } finally {
      sub.unsubscribe();
    }
  });

  test("MCP poll_wake_events and X-Inkade-Session-Id piggyback leave plain MCP clients untouched", async () => {
    const { baseUrl } = await startPhase48Server();
    const ownerSdk = createInkadeClient({ baseUrl });

    const doc = await ownerSdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.research,
      kind: "article",
      title: "MCP Piggyback Doc",
      contentMarkdown: "# MCP",
    });
    const binding = await ownerSdk.threadBindings.upsert({
      documentId: doc.id,
      adeKind: "claude-code",
      externalThreadId: "cc_piggy_1",
      title: "CC Piggy",
      status: "running",
    });

    // Plain MCP client without session headers is completely unaffected
    const plainMcp = new Client({ name: "plain-mcp", version: "1.0.0" });
    const plainTransport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`));
    await plainMcp.connect(plainTransport);

    // Session-aware MCP client with X-Inkade-Session-Id
    const bridgeMcp = new Client({ name: "bridge-mcp", version: "1.0.0" });
    const bridgeTransport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: {
        headers: {
          "x-inkade-host": "claude-code",
          "x-inkade-session-id": "cc_piggy_1",
        },
      },
    });
    await bridgeMcp.connect(bridgeTransport);

    try {
      await ownerSdk.threadBindings.steer(binding.id, {
        text: "Steer via piggyback",
        mode: "queued",
      });

      const plainGet = await plainMcp.callTool({
        name: "get_document",
        arguments: { documentId: doc.id },
      });
      const plainJson = JSON.parse(readToolText(plainGet)) as Record<string, unknown>;
      expect(plainJson._inkadeWakeMessages).toBeUndefined();

      const bridgeGet = await bridgeMcp.callTool({
        name: "get_document",
        arguments: { documentId: doc.id },
      });
      const bridgeJson = JSON.parse(readToolText(bridgeGet)) as {
        document: { id: string };
        _inkadeWakeMessages?: readonly { formattedPromptText: string }[];
      };
      expect(bridgeJson.document.id).toBe(doc.id);
      expect(bridgeJson._inkadeWakeMessages).toHaveLength(1);
      expect(bridgeJson._inkadeWakeMessages?.[0]?.formattedPromptText).toContain(
        "Steer via piggyback",
      );

      // Direct poll_wake_events tool after another steer
      await ownerSdk.threadBindings.steer(binding.id, {
        text: "Steer via poll_wake_events",
        mode: "interrupt",
      });
      const polledTool = await bridgeMcp.callTool({
        name: "poll_wake_events",
        arguments: {},
      });
      const polledJson = JSON.parse(readToolText(polledTool)) as {
        wakes: readonly { formattedPromptText: string }[];
      };
      expect(polledJson.wakes).toHaveLength(1);
      expect(polledJson.wakes[0]?.formattedPromptText).toContain("Steer via poll_wake_events");
    } finally {
      await plainTransport.close();
      await bridgeTransport.close();
    }
  });
});
