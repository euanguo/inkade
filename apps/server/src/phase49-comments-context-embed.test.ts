import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  asUserId,
  INKADE_EMBED_PROTOCOL,
  type InkadeEvent,
  type TokenScope,
} from "@inkade/core";
import { DEFAULT_SPACE_IDS, DEFAULT_WORKSPACE_ID } from "@inkade/db";
import { createInkadeClient, InkadeApiError, subscribeInkadeEvents } from "@inkade/sdk";
import { createInkadeApp, type InkadeAppInstance } from "./app.ts";
import {
  DEFAULT_VIEWER_CONTEXT_TTL_MS,
  ViewerContextStore,
} from "./services/viewer-context-store.ts";
import type { Principal } from "./types.ts";

interface Phase49Harness {
  readonly baseUrl: string;
  readonly instance: InkadeAppInstance;
  readonly server: ReturnType<typeof Bun.serve>;
  readonly tempDir: string;
}

const activeHarnesses: Phase49Harness[] = [];

async function startPhase49Server(opts?: {
  readonly localAutoAuth?: boolean;
}): Promise<Phase49Harness> {
  const tempDir = mkdtempSync(join(tmpdir(), "inkade-phase49-test-"));
  const instance = createInkadeApp({
    dbPath: join(tempDir, "inkade.db"),
    dataDir: tempDir,
    localAutoAuth: opts?.localAutoAuth ?? true,
    authSecret: "test-secret-key-for-inkade-phase49-suite-32bytes",
  });
  await instance.ready;
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: instance.fetch,
    websocket: instance.websocket,
    idleTimeout: 30,
  });
  const harness: Phase49Harness = {
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
    const h = activeHarnesses.pop()!;
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
    },
    actorType: "human",
    actorId: asUserId("usr_local_owner"),
  };
}

function makeScopedPrincipal(tokenName: string, scope: TokenScope): Principal {
  return {
    kind: "token",
    tokenId: `tok_${tokenName}` as never,
    tokenName,
    workspaceId: DEFAULT_WORKSPACE_ID,
    scope,
    actorType: "agent",
    actorId: `tok_${tokenName}` as never,
  };
}

function readToolText(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const content = result.content as Array<{ type: string; text?: string }>;
  return content.find((c) => c.type === "text")?.text ?? "";
}

describe("Phase 49 — Threaded comments, live viewer context, and Embed v1 relay", () => {
  test("manages highlight comment threads, Send to Agent wake routing, collaborator downgrade, resolve/reopen, and MCP tools", async () => {
    const { baseUrl } = await startPhase49Server();
    const ownerSdk = createInkadeClient({ baseUrl });

    const doc = await ownerSdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.research,
      kind: "article",
      title: "Phase 49 Research Draft",
      contentMarkdown: "# Proof\n\nEvery edge case deserves verification.\n",
    });

    const hlUnowned = await ownerSdk.highlights.create(doc.id, {
      quote: "Every edge case deserves verification.",
      noteMarkdown: "Double check boundary conditions",
    });
    expect(hlUnowned.status).toBe("open");
    expect(hlUnowned.commentCount).toBe(0);

    // 1. Add human comment & send without any binding/bridge session -> unowned wake
    const addedFirst = await ownerSdk.documents.addHighlightComment(hlUnowned.id, {
      bodyMarkdown: "Can an agent verify this claim?",
      authorName: "Euan",
    });
    expect(addedFirst.comment.authorType).toBe("human");
    expect(addedFirst.comment.sentToAgentAt).toBeNull();
    expect(addedFirst.highlight.commentCount).toBe(1);

    const unownedSend = await ownerSdk.documents.sendHighlightToAgent(hlUnowned.id, {});
    expect(unownedSend.deliveryTarget).toBe("unowned");
    expect(unownedSend.wakeEvent.reason).toBe("unowned_request");
    expect(unownedSend.wakeEvent.senderKind).toBe("owner");
    expect(unownedSend.comments[0]?.sentToAgentAt).not.toBeNull();
    expect(unownedSend.comments[0]?.wakeEventId).toBe(unownedSend.wakeEvent.id);

    // 2. Register online bridge session -> Send to Agent routes directly to bridge_session
    const bridgeSession = await ownerSdk.threadBindings.heartbeatBridgeSession({
      harnessName: "claude-code",
      adeKind: "claude-code",
      externalThreadId: "cc_phase49_sess_1",
      workspacePath: "/repo/inkade",
      pid: process.pid,
    });
    const hlBridge = await ownerSdk.highlights.create(doc.id, {
      quote: "Every edge case",
      noteMarkdown: "Target bridge session",
    });
    const bridgeSend = await ownerSdk.documents.sendHighlightToAgent(hlBridge.id, {
      bridgeSessionId: bridgeSession.id,
      bodyMarkdown: "Inspect bridge delivery path",
      senderName: "Euan",
    });
    expect(bridgeSend.deliveryTarget).toBe("bridge_session");
    expect(bridgeSend.wakeEvent.targetExternalThreadId).toBe("cc_phase49_sess_1");
    expect(bridgeSend.wakeEvent.senderKind).toBe("owner");

    // 3. Bound session + collaborator senderType downgrades trust to collaborator & sanitizes external links
    const binding = await ownerSdk.threadBindings.upsert({
      documentId: doc.id,
      adeKind: "codex",
      externalThreadId: "codex_phase49_bound",
      title: "Codex Reviewer",
      status: "running",
    });
    const collabSend = await ownerSdk.documents.sendHighlightToAgent(hlUnowned.id, {
      bindingId: binding.id,
      bodyMarkdown: "Untrusted collaborator link https://malicious.example/payload",
      senderType: "collaborator",
      senderName: "Guest Reviewer",
    });
    expect(collabSend.deliveryTarget).toBe("bound_session");
    expect(collabSend.wakeEvent.bindingId).toBe(binding.id);
    expect(collabSend.wakeEvent.senderKind).toBe("collaborator");
    expect(collabSend.wakeEvent.formattedPromptText).toContain(
      "From: Guest Reviewer (collaborator, not owner)",
    );
    expect(collabSend.wakeEvent.formattedPromptText).toContain("[link]");
    expect(collabSend.wakeEvent.formattedPromptText).not.toContain("malicious.example");

    // 4. Subscribe SSE & verify MCP list_comment_threads + reply_comment_thread(resolve: true)
    const agentToken = await ownerSdk.tokens.create({
      name: "Research Thread Replier",
      scope: {
        permission: "append",
        spaceIds: [DEFAULT_SPACE_IDS.research],
        includeDescendants: true,
        denyHardDelete: true,
      },
    });
    const observedEvents: InkadeEvent[] = [];
    const sub = subscribeInkadeEvents(
      { baseUrl },
      { onEvent: (evt) => observedEvents.push(evt) },
    );

    const mcpClient = new Client({ name: "phase49-mcp", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: {
        headers: { authorization: `Bearer ${agentToken.rawToken}` },
      },
    });
    await mcpClient.connect(transport);
    try {
      await new Promise((r) => setTimeout(r, 80));

      const openThreadsRes = await mcpClient.callTool({
        name: "list_comment_threads",
        arguments: { documentId: doc.id, status: "open" },
      });
      const openThreadsPayload = JSON.parse(readToolText(openThreadsRes)) as {
        readonly threads: readonly {
          readonly highlight: { readonly id: string; readonly status: string };
          readonly comments: readonly unknown[];
        }[];
      };
      expect(openThreadsPayload.threads).toHaveLength(2);

      const replyRes = await mcpClient.callTool({
        name: "reply_comment_thread",
        arguments: {
          highlightId: hlUnowned.id,
          bodyMarkdown: "Verified boundary conditions and added guard.",
          resolve: true,
        },
      });
      const replyPayload = JSON.parse(readToolText(replyRes)) as {
        readonly highlight: {
          readonly id: string;
          readonly status: string;
          readonly resolvedByType: string | null;
        };
        readonly comment: { readonly authorType: string; readonly bodyMarkdown: string };
      };
      expect(replyPayload.comment.authorType).toBe("agent");
      expect(replyPayload.highlight.status).toBe("resolved");
      expect(replyPayload.highlight.resolvedByType).toBe("agent");

      await new Promise((r) => setTimeout(r, 80));
      expect(observedEvents.some((e) => e.type === "highlight.comment.created")).toBe(true);
      expect(
        observedEvents.some(
          (e) => e.type === "highlight.resolved" && e.payload.resolved === true,
        ),
      ).toBe(true);

      // 5. Filtering open vs resolved + explicit reopen
      const openAfterResolve = await ownerSdk.documents.listCommentThreads(doc.id, "open");
      const resolvedAfterResolve = await ownerSdk.documents.listCommentThreads(doc.id, "resolved");
      expect(openAfterResolve.map((t) => t.highlight.id)).toEqual([hlBridge.id]);
      expect(resolvedAfterResolve.map((t) => t.highlight.id)).toEqual([hlUnowned.id]);

      const reopened = await ownerSdk.documents.reopenHighlight(hlUnowned.id);
      expect(reopened.status).toBe("open");
      expect(reopened.resolvedAt).toBeNull();
      expect(reopened.resolvedByType).toBeNull();

      const explicitResolved = await ownerSdk.documents.resolveHighlight(hlUnowned.id);
      expect(explicitResolved.status).toBe("resolved");
      expect(explicitResolved.resolvedByType).toBe("human");
    } finally {
      await transport.close();
      sub.unsubscribe();
    }
  });

  test("enforces strict TokenScope privacy (out_of_scope) and 30s TTL (unavailable) on ViewerContextStore, HTTP, and MCP", async () => {
    const { baseUrl, instance } = await startPhase49Server();
    const ownerSdk = createInkadeClient({ baseUrl });

    const researchDoc = await ownerSdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.research,
      kind: "article",
      title: "Secret Research Spec",
      contentMarkdown: "# Architecture\n\nConfidential details here.",
    });

    // Unit test 30s default constant + custom clock expiry & zero cross-scope leakage
    expect(DEFAULT_VIEWER_CONTEXT_TTL_MS).toBe(30_000);
    let fakeNow = 1_700_000_000_000;
    const store = new ViewerContextStore({
      documentRepo: instance.repos.document,
      spaceRepo: instance.repos.space,
      now: () => fakeNow,
    });
    const ownerPrincipal = makeOwnerPrincipal();
    await store.updateContext(ownerPrincipal, {
      documentId: researchDoc.id,
      viewMode: "reader",
      headingSlug: "architecture",
      selectedQuote: "Confidential details here.",
    });

    const inScopePrincipal = makeScopedPrincipal("in_scope", {
      permission: "read",
      spaceIds: [DEFAULT_SPACE_IDS.research],
      includeDescendants: true,
      denyHardDelete: true,
    });
    const outOfScopePrincipal = makeScopedPrincipal("out_scope", {
      permission: "read",
      spaceIds: [DEFAULT_SPACE_IDS.inbox],
      includeDescendants: true,
      denyHardDelete: true,
    });

    const visibleRes = await store.getContext(inScopePrincipal);
    expect(visibleRes.visible).toBe(true);
    if (visibleRes.visible) {
      expect(visibleRes.context.documentId).toBe(researchDoc.id);
      expect(visibleRes.context.headingSlug).toBe("architecture");
      expect(visibleRes.context.selectedQuote).toBe("Confidential details here.");
    }

    const deniedRes = await store.getContext(outOfScopePrincipal);
    expect(deniedRes).toEqual({ visible: false, reason: "out_of_scope" });
    expect("context" in deniedRes).toBe(false);

    // Just past 30s TTL -> unavailable
    fakeNow += DEFAULT_VIEWER_CONTEXT_TTL_MS + 1;
    expect(await store.getContext(inScopePrincipal)).toEqual({
      visible: false,
      reason: "unavailable",
    });

    // Full HTTP + MCP get_viewer_context integration check
    const researchToken = await ownerSdk.tokens.create({
      name: "Research Viewer Token",
      scope: {
        permission: "read",
        spaceIds: [DEFAULT_SPACE_IDS.research],
        includeDescendants: true,
        denyHardDelete: true,
      },
    });
    const inboxToken = await ownerSdk.tokens.create({
      name: "Inbox Only Token",
      scope: {
        permission: "read",
        spaceIds: [DEFAULT_SPACE_IDS.inbox],
        includeDescendants: true,
        denyHardDelete: true,
      },
    });

    await ownerSdk.documents.updateViewerContext({
      documentId: researchDoc.id,
      viewMode: "editor",
      headingSlug: "architecture",
      selectedQuote: "Confidential details here.",
    });

    const mcpResearch = new Client({ name: "mcp-research", version: "1.0.0" });
    const mcpInbox = new Client({ name: "mcp-inbox", version: "1.0.0" });
    const transportResearch = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${researchToken.rawToken}` } },
    });
    const transportInbox = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${inboxToken.rawToken}` } },
    });
    await mcpResearch.connect(transportResearch);
    await mcpInbox.connect(transportInbox);
    try {
      const okMcp = JSON.parse(
        readToolText(await mcpResearch.callTool({ name: "get_viewer_context", arguments: {} })),
      ) as Record<string, unknown>;
      expect(okMcp.visible).toBe(true);
      expect((okMcp.context as { documentTitle: string }).documentTitle).toBe(
        "Secret Research Spec",
      );

      const blockedRaw = readToolText(
        await mcpInbox.callTool({ name: "get_viewer_context", arguments: {} }),
      );
      expect(JSON.parse(blockedRaw)).toEqual({ visible: false, reason: "out_of_scope" });
      expect(blockedRaw).not.toContain("Secret Research Spec");
      expect(blockedRaw).not.toContain(researchDoc.id);

      // Clear viewer context (toggle off privacy switch)
      await ownerSdk.documents.updateViewerContext({ documentId: null });
      const afterClear = await ownerSdk.documents.getViewerContext();
      expect(afterClear).toEqual({ visible: false, reason: "unavailable" });
    } finally {
      await transportResearch.close();
      await transportInbox.close();
    }
  });

  test("relays embed commands & shell events across top-level WebView ticket sessions with strict token/session isolation", async () => {
    const { baseUrl, instance } = await startPhase49Server({ localAutoAuth: false });
    const ownerPrincipal = makeOwnerPrincipal();

    const docResearch = await instance.services.document.createDocument(ownerPrincipal, {
      spaceId: DEFAULT_SPACE_IDS.research,
      kind: "article",
      title: "Embed Research Doc",
      contentMarkdown: "# Intro\n\nHello embed world.",
    });
    const docInbox = await instance.services.document.createDocument(ownerPrincipal, {
      spaceId: DEFAULT_SPACE_IDS.inbox,
      kind: "article",
      title: "Embed Inbox Doc",
      contentMarkdown: "# Inbox\n\nPrivate note.",
    });

    const tokenA = await instance.services.token.createToken(ownerPrincipal, {
      name: "Host A",
      scope: {
        permission: "write",
        spaceIds: [DEFAULT_SPACE_IDS.research],
        includeDescendants: true,
        denyHardDelete: true,
      },
    });
    const tokenB = await instance.services.token.createToken(ownerPrincipal, {
      name: "Host B",
      scope: {
        permission: "write",
        spaceIds: [DEFAULT_SPACE_IDS.inbox],
        includeDescendants: true,
        denyHardDelete: true,
      },
    });

    const sdkHostA = createInkadeClient({ baseUrl, token: tokenA.rawToken });
    const sdkHostB = createInkadeClient({ baseUrl, token: tokenB.rawToken });

    const ticketA = await sdkHostA.auth.createEmbedTicket();
    const ticketB = await sdkHostB.auth.createEmbedTicket();
    const unauthSdk = createInkadeClient({ baseUrl });
    const sessionA = await unauthSdk.auth.exchangeEmbedTicket(ticketA.ticket);
    const sessionB = await unauthSdk.auth.exchangeEmbedTicket(ticketB.ticket);
    expect(sessionA.embedSessionId?.startsWith("esid_")).toBe(true);
    expect(sessionB.embedSessionId?.startsWith("esid_")).toBe(true);

    // Unauthenticated POST /embed/command without embedSessionId must be 401 when localAutoAuth=false
    let unauthRejected = false;
    try {
      await unauthSdk.auth.sendEmbedCommand({
        message: {
          protocol: INKADE_EMBED_PROTOCOL,
          type: "host.goto_anchor",
          payload: { documentId: docResearch.id },
        },
      });
    } catch (err) {
      unauthRejected = true;
      expect(err).toBeInstanceOf(InkadeApiError);
      if (err instanceof InkadeApiError) {
        expect(err.status).toBe(401);
      }
    }
    expect(unauthRejected).toBe(true);

    // Cross-scope host.goto_anchor via session B targeting research doc must fail 403
    const crossScopeRes = await fetch(`${baseUrl}/api/v1/embed/command`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        embedSessionId: sessionB.embedSessionId,
        message: {
          protocol: INKADE_EMBED_PROTOCOL,
          type: "host.goto_anchor",
          payload: { documentId: docResearch.id },
        },
      }),
    });
    expect(crossScopeRes.status).toBe(403);

    const eventsWebViewA: InkadeEvent[] = [];
    const eventsWebViewB: InkadeEvent[] = [];
    const eventsHostA: InkadeEvent[] = [];
    const eventsHostB: InkadeEvent[] = [];

    const subWebViewA = subscribeInkadeEvents(
      { baseUrl, token: sessionA.accessToken },
      { onEvent: (e) => eventsWebViewA.push(e) },
    );
    const subWebViewB = subscribeInkadeEvents(
      { baseUrl, token: sessionB.accessToken },
      { onEvent: (e) => eventsWebViewB.push(e) },
    );
    const subHostA = subscribeInkadeEvents(
      { baseUrl, token: tokenA.rawToken },
      { onEvent: (e) => eventsHostA.push(e) },
    );
    const subHostB = subscribeInkadeEvents(
      { baseUrl, token: tokenB.rawToken },
      { onEvent: (e) => eventsHostB.push(e) },
    );

    try {
      await new Promise((r) => setTimeout(r, 80));

      // Top-level host posts host.goto_anchor authenticated solely by embedSessionId A
      const cmdAck = await unauthSdk.auth.sendEmbedCommand({
        embedSessionId: sessionA.embedSessionId,
        message: {
          protocol: INKADE_EMBED_PROTOCOL,
          type: "host.goto_anchor",
          payload: {
            documentId: docResearch.id,
            headingSlug: "intro",
          },
        },
      });
      expect(cmdAck.ok).toBe(true);
      expect(cmdAck.embedSessionId).toBe(sessionA.embedSessionId!);

      // WebView A emits inkade.place_changed to Host A via /embed/shell-event
      const sdkWebViewA = createInkadeClient({ baseUrl, token: sessionA.accessToken });
      const shellAck = await sdkWebViewA.auth.emitEmbedShellEvent({
        embedSessionId: sessionA.embedSessionId,
        message: {
          protocol: INKADE_EMBED_PROTOCOL,
          type: "inkade.place_changed",
          payload: {
            documentId: docResearch.id,
            headingSlug: "intro",
          },
        },
      });
      expect(shellAck.ok).toBe(true);

      // Verify mismatch embedSessionId on /embed/shell-event is rejected with 403
      const mismatchRes = await fetch(`${baseUrl}/api/v1/embed/shell-event`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${sessionA.accessToken}`,
        },
        body: JSON.stringify({
          embedSessionId: sessionB.embedSessionId,
          message: {
            protocol: INKADE_EMBED_PROTOCOL,
            type: "inkade.place_changed",
            payload: { documentId: docInbox.id },
          },
        }),
      });
      expect(mismatchRes.status).toBe(403);

      await new Promise((r) => setTimeout(r, 100));

      expect(
        eventsWebViewA.some(
          (e) =>
            e.type === "embed.shell_event" &&
            e.payload.direction === "host_to_inkade" &&
            e.payload.embedSessionId === sessionA.embedSessionId &&
            e.payload.message.type === "host.goto_anchor",
        ),
      ).toBe(true);
      expect(eventsWebViewB.some((e) => e.type === "embed.shell_event")).toBe(false);

      expect(
        eventsHostA.some(
          (e) =>
            e.type === "embed.shell_event" &&
            e.payload.direction === "inkade_to_host" &&
            e.payload.embedSessionId === sessionA.embedSessionId &&
            e.payload.message.type === "inkade.place_changed",
        ),
      ).toBe(true);
      expect(eventsHostB.some((e) => e.type === "embed.shell_event")).toBe(false);
    } finally {
      subWebViewA.unsubscribe();
      subWebViewB.unsubscribe();
      subHostA.unsubscribe();
      subHostB.unsubscribe();
    }
  });
});
