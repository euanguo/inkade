import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { unzipSync } from "fflate";
import type { InkadeEvent } from "@inkade/core";
import { DEFAULT_SPACE_IDS } from "@inkade/db";
import { createInkadeClient, subscribeInkadeEvents } from "@inkade/sdk";
import { createInkadeApp, type InkadeAppInstance } from "./app.ts";
import {
  buildBetterAuthTrustedOrigins,
  isPlaceholderAuthSecret,
} from "./auth/better-auth.ts";

interface TestHarness {
  readonly baseUrl: string;
  readonly instance: InkadeAppInstance;
  readonly server: ReturnType<typeof Bun.serve>;
  readonly tempDir: string;
}

const activeHarnesses: TestHarness[] = [];

async function startTestServer(options?: {
  localAutoAuth?: boolean;
}): Promise<TestHarness> {
  const tempDir = mkdtempSync(join(tmpdir(), "inkade-server-test-"));
  const instance = createInkadeApp({
    dbPath: join(tempDir, "inkade.db"),
    dataDir: tempDir,
    localAutoAuth: options?.localAutoAuth ?? false,
    authSecret: "test-secret-key-for-inkade-integration-suite-32bytes",
  });
  await instance.ready;

  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: instance.app.fetch,
    idleTimeout: 30,
  });

  const harness: TestHarness = {
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

function createCookieFetch(cookieStore: Map<string, string>): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    if (cookieStore.size > 0) {
      const cookieHeader = [...cookieStore.entries()]
        .map(([k, v]) => `${k}=${v}`)
        .join("; ");
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
  timeoutMs = 3000,
): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = predicate();
    if (value) return value;
    await Bun.sleep(20);
  }
  throw new Error("Timed out waiting for condition");
}

function readToolText(result: Record<string, unknown>): string {
  const items = Array.isArray(result.content) ? result.content : [];
  const first = items[0] as { text?: string } | undefined;
  return first?.text ?? "";
}

describe("Inkade Server & SDK Integration", () => {
  test("Better Auth bootstrap, owner setup, cookie session, and localAutoAuth safety", async () => {
    const { baseUrl } = await startTestServer({ localAutoAuth: false });
    const cookies = new Map<string, string>();
    const cookieFetch = createCookieFetch(cookies);
    const anonSdk = createInkadeClient({ baseUrl, fetch: cookieFetch });

    const health = await anonSdk.bootstrap.health();
    expect(health.ok).toBe(true);

    const beforeSetup = await anonSdk.bootstrap.status();
    expect(beforeSetup.initialized).toBe(false);
    expect(beforeSetup.hasUsers).toBe(false);
    expect(beforeSetup.authMode).toBe("better-auth");

    await expectRejectsMatch(anonSdk.auth.whoami(), {
      status: 401,
      code: "UNAUTHORIZED",
    });

    const setup = await anonSdk.bootstrap.setupOwner({
      name: "Alice",
      email: "alice@example.com",
      password: "super-secure-password-123",
    });
    expect(setup.initialized).toBe(true);
    expect(setup.user.email).toBe("alice@example.com");

    const afterSetup = await anonSdk.bootstrap.status();
    expect(afterSetup.initialized).toBe(true);
    expect(afterSetup.hasUsers).toBe(true);

    // Second setup attempt must fail with 409 CONFLICT.
    await expectRejectsMatch(
      anonSdk.bootstrap.setupOwner({
        name: "Bob",
        email: "bob@example.com",
        password: "another-password-123",
      }),
      { status: 409, code: "CONFLICT" },
    );

    // Session cookie from setup authenticates as admin user.
    const whoami = await anonSdk.auth.whoami();
    expect(whoami.principalKind).toBe("user");
    expect(whoami.scope.permission).toBe("admin");

    // Sign out and sign back in via Better Auth endpoint.
    cookies.clear();
    await expectRejectsMatch(anonSdk.auth.whoami(), { status: 401 });

    const signInRes = await cookieFetch(`${baseUrl}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "alice@example.com",
        password: "super-secure-password-123",
      }),
    });
    expect(signInRes.ok).toBe(true);
    const whoamiAfterSignIn = await anonSdk.auth.whoami();
    expect(whoamiAfterSignIn.userId).toBe(setup.user.id);

    // Even when localAutoAuth is true, invalid Bearer tokens must strictly fail 401.
    const devHarness = await startTestServer({ localAutoAuth: true });
    const devClient = createInkadeClient({ baseUrl: devHarness.baseUrl });
    const devWhoami = await devClient.auth.whoami();
    expect(devWhoami.principalKind).toBe("user");
    expect(devWhoami.scope.permission).toBe("admin");

    const badBearerClient = createInkadeClient({
      baseUrl: devHarness.baseUrl,
      token: "ink_definitely_invalid_token",
    });
    await expectRejectsMatch(badBearerClient.auth.whoami(), {
      status: 401,
      code: "UNAUTHORIZED",
    });
  });

  test("Scoped Token boundary matrix, hot-reload edits, FTS5, backlinks, and ZIP export", async () => {
    const { baseUrl } = await startTestServer({ localAutoAuth: true });
    const adminSdk = createInkadeClient({ baseUrl });

    const alphaSpace = await adminSdk.spaces.create({
      parentId: DEFAULT_SPACE_IDS.projects,
      name: "Alpha",
    });
    const alphaSubSpace = await adminSdk.spaces.create({
      parentId: alphaSpace.id,
      name: "Alpha Specs",
    });
    const secretSpace = await adminSdk.spaces.create({
      parentId: DEFAULT_SPACE_IDS.projects,
      name: "Secret",
    });

    // Seed secret and non-matching tagged docs.
    const secretDoc = await adminSdk.documents.create({
      spaceId: secretSpace.id,
      kind: "article",
      title: "Secret Roadmap",
      contentMarkdown: "# Secret\n\nContains zephyr codename and [[Public Alpha Spec]].",
      tags: ["public"],
    });
    const internalAlphaDoc = await adminSdk.documents.create({
      spaceId: alphaSpace.id,
      kind: "article",
      title: "Internal Alpha Notes",
      contentMarkdown: "# Internal\n\nAlso mentions zephyr without public tag.",
      tags: ["internal"],
    });

    // Create scoped token restricted to alphaSpace (+ descendants), article kind, tag "public".
    const { token: tokenRecord, rawToken } = await adminSdk.tokens.create({
      name: "alpha-agent",
      scope: {
        permission: "write",
        spaceIds: [alphaSpace.id],
        includeDescendants: true,
        allowedKinds: ["article"],
        tagAllowlist: ["public"],
        denyHardDelete: true,
      },
    });
    expect(rawToken.startsWith("ink_")).toBe(true);
    expect(tokenRecord.tokenPrefix).toBe(rawToken.slice(0, 12));

    const agentSdk = createInkadeClient({ baseUrl, token: rawToken });

    // Non-admin token cannot list or create tokens.
    await expectRejectsMatch(agentSdk.tokens.list(), {
      status: 403,
      code: "FORBIDDEN",
    });

    const whoami = await agentSdk.auth.whoami();
    expect(whoami.principalKind).toBe("token");
    expect(whoami.visibleSpaces.map((s) => s.id).sort()).toEqual(
      [alphaSpace.id, alphaSubSpace.id].sort(),
    );

    // Scope blocks secret space, disallowed kind, and missing tagAllowlist.
    await expectRejectsMatch(
      agentSdk.documents.create({
        spaceId: secretSpace.id,
        kind: "article",
        title: "Forbidden",
        contentMarkdown: "nope",
        tags: ["public"],
      }),
      { status: 403, code: "FORBIDDEN" },
    );

    await expectRejectsMatch(
      agentSdk.documents.create({
        spaceId: alphaSpace.id,
        kind: "clip",
        title: "Clip Forbidden",
        contentMarkdown: "nope",
        tags: ["public"],
      }),
      { status: 403, code: "FORBIDDEN" },
    );

    await expectRejectsMatch(
      agentSdk.documents.create({
        spaceId: alphaSpace.id,
        kind: "article",
        title: "Wrong Tag",
        contentMarkdown: "nope",
        tags: ["internal"],
      }),
      { status: 403, code: "FORBIDDEN" },
    );

    // Authorized creation in descendant space succeeds and marks unreadAgentUpdate.
    const publicDoc = await agentSdk.documents.create({
      spaceId: alphaSubSpace.id,
      kind: "article",
      title: "Public Alpha Spec",
      contentMarkdown: "# Public Alpha Spec\n\nBuilt on zephyr architecture.",
      tags: ["public"],
    });
    expect(publicDoc.unreadAgentUpdate).toBe(true);
    expect(publicDoc.lastEditedByType).toBe("agent");

    // Cannot read secret doc or internal-tagged doc.
    await expectRejectsMatch(agentSdk.documents.get(secretDoc.id), {
      status: 403,
      code: "FORBIDDEN",
    });
    await expectRejectsMatch(agentSdk.documents.get(internalAlphaDoc.id), {
      status: 403,
      code: "FORBIDDEN",
    });

    // List documents only exposes authorized docs.
    const visibleDocs = await agentSdk.documents.list();
    expect(visibleDocs.map((d) => d.id)).toEqual([publicDoc.id]);

    // FTS5 search strictly filters out secretSpace & internal-tagged docs.
    const hits = await agentSdk.search.query({ q: "zephyr" });
    expect(hits.map((h) => h.documentId)).toEqual([publicDoc.id]);

    // Backlinks from secretDoc to publicDoc are hidden from scoped token, visible to admin.
    const agentBacklinks = await agentSdk.documents.listBacklinks(publicDoc.id);
    expect(agentBacklinks).toHaveLength(0);
    const adminBacklinks = await adminSdk.documents.listBacklinks(publicDoc.id);
    expect(adminBacklinks.length).toBeGreaterThanOrEqual(1);

    // ZIP export only packages authorized documents.
    const zipBytes = await agentSdk.workspace.exportZip();
    const unzipped = unzipSync(zipBytes);
    const zipPaths = Object.keys(unzipped);
    expect(zipPaths).toEqual([`projects/alpha/alpha-specs/${publicDoc.slug}.md`]);

    // Hard delete is blocked by denyHardDelete: true.
    await expectRejectsMatch(agentSdk.documents.delete(publicDoc.id, { hard: true }), {
      status: 403,
      code: "HARD_DELETE_BLOCKED",
    });

    // Soft delete (trash) works, and admin can restore.
    const trashed = await agentSdk.documents.trash(publicDoc.id);
    expect(trashed.trashedAt).not.toBeNull();
    const restored = await adminSdk.documents.restore(publicDoc.id);
    expect(restored.trashedAt).toBeNull();

    // Hot-reload token scope edit takes effect on the very next request.
    await adminSdk.tokens.update(tokenRecord.id, {
      scope: {
        permission: "read",
        spaceIds: [secretSpace.id],
        includeDescendants: true,
        denyHardDelete: true,
      },
    });
    const secretReadNow = await agentSdk.documents.get(secretDoc.id);
    expect(secretReadNow.id).toBe(secretDoc.id);
    await expectRejectsMatch(agentSdk.documents.get(publicDoc.id), {
      status: 403,
      code: "FORBIDDEN",
    });

    // Revoking token immediately blocks next request.
    await adminSdk.tokens.revoke(tokenRecord.id);
    await expectRejectsMatch(agentSdk.documents.get(secretDoc.id), {
      status: 401,
      code: "UNAUTHORIZED",
    });
  });

  test("Section patching, optimistic locking, revisions, diff, restore, and markdown export", async () => {
    const { baseUrl } = await startTestServer({ localAutoAuth: true });
    const sdk = createInkadeClient({ baseUrl });

    const doc = await sdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.research,
      kind: "article",
      title: "Architecture Report",
      contentMarkdown: [
        "# Architecture Report",
        "",
        "## Overview",
        "",
        "Keep this paragraph byte-identical.",
        "",
        "## Findings",
        "",
        "- Finding A",
      ].join("\n"),
      tags: ["research"],
    });
    expect(doc.version).toBe(1);

    const patched = await sdk.documents.patchSection(doc.id, {
      headingPath: "Findings",
      mode: "append",
      markdown: "- Finding B",
      expectedVersion: 1,
      changeSummary: "Added Finding B",
    });
    expect(patched.version).toBe(2);
    expect(patched.contentMarkdown).toContain("Keep this paragraph byte-identical.");
    expect(patched.contentMarkdown).toContain("- Finding A\n\n- Finding B");

    // Stale expectedVersion must return 409 VERSION_CONFLICT.
    await expectRejectsMatch(
      sdk.documents.patchSection(doc.id, {
        headingPath: "Findings",
        mode: "append",
        markdown: "- Finding C",
        expectedVersion: 1,
      }),
      { status: 409, code: "VERSION_CONFLICT" },
    );

    const revisions = await sdk.documents.listRevisions(doc.id);
    expect(revisions.map((r) => r.version)).toEqual([2, 1]);

    const diffRes = await sdk.documents.getRevisionDiff(doc.id, 1, 2);
    expect(diffRes.diff.additions).toBeGreaterThan(0);
    expect(diffRes.diff.unifiedPatch).toContain("+ - Finding B".replace(" ", ""));

    const restored = await sdk.documents.restoreRevision(doc.id, 1);
    expect(restored.version).toBe(3);
    expect(restored.contentMarkdown).toBe(doc.contentMarkdown);

    const exportedMd = await sdk.documents.exportMarkdown(doc.id);
    expect(exportedMd).toContain(`id: ${doc.id}`);
    expect(exportedMd).toContain("title: Architecture Report");
    expect(exportedMd).toContain("Keep this paragraph byte-identical.");
  });

  test("Outline nodes, daily rollover, promote subtree to article, thread bindings, rules, and attachments", async () => {
    const { baseUrl } = await startTestServer({ localAutoAuth: true });
    const sdk = createInkadeClient({ baseUrl });

    const day1 = await sdk.documents.getDaily("2026-11-23");
    const day2 = await sdk.documents.getDaily("2026-11-24");

    const doneTask = await sdk.outlineNodes.create({
      documentId: day1.document.id,
      contentMarkdown: "Completed task",
      checked: true,
    });
    const openParent = await sdk.outlineNodes.create({
      documentId: day1.document.id,
      contentMarkdown: "Investigate Hono SSE",
      checked: false,
    });
    const openChild = await sdk.outlineNodes.create({
      documentId: day1.document.id,
      parentNodeId: openParent.id,
      contentMarkdown: "Check Last-Event-ID replay",
      checked: false,
    });

    expect(doneTask.checked).toBe(true);
    expect(openChild.parentNodeId).toBe(openParent.id);

    // Move & rollover unchecked subtree to day2.
    const rolled = await sdk.outlineNodes.rollover(day1.document.id, day2.document.id);
    expect(rolled.length).toBe(2);
    expect(rolled.some((n) => n.contentMarkdown.includes("Investigate Hono SSE"))).toBe(true);
    expect(rolled.some((n) => n.contentMarkdown.includes("Completed task"))).toBe(false);

    // Promote subtree to article in Research space.
    const promoted = await sdk.outlineNodes.promote(openParent.id, {
      targetSpaceId: DEFAULT_SPACE_IDS.research,
      title: "Hono SSE Research",
      tags: ["sse"],
    });
    expect(promoted.article.kind).toBe("article");
    expect(promoted.article.contentMarkdown).toContain("Check Last-Event-ID replay");
    expect(promoted.updatedNode?.contentMarkdown).toContain("[[Hono SSE Research]]");

    // Thread bindings CRUD.
    const binding = await sdk.threadBindings.upsert({
      documentId: day1.document.id,
      nodeId: openParent.id,
      adeKind: "bb",
      externalWorkspaceId: "proj_inkade",
      externalThreadId: "thr_123",
      title: "Investigate SSE",
      status: "running",
    });
    expect(binding.status).toBe("running");

    const updatedBinding = await sdk.threadBindings.update(binding.id, {
      status: "completed",
      lastSummary: "Verified SSE replay",
      unreadResult: true,
    });
    expect(updatedBinding.status).toBe("completed");
    expect(updatedBinding.unreadResult).toBe(true);

    const bindings = await sdk.threadBindings.list({ documentId: day1.document.id });
    expect(bindings).toHaveLength(1);

    await sdk.threadBindings.delete(binding.id);
    expect(await sdk.threadBindings.list({ documentId: day1.document.id })).toHaveLength(0);

    // Scope rules: admin CRUD, non-admin read-only.
    const rule = await sdk.scopeRules.create({
      matchType: "repo_name",
      pattern: "inkade",
      writableSpaceIds: [DEFAULT_SPACE_IDS.projects],
      readonlySpaceIds: [DEFAULT_SPACE_IDS.research],
      defaultInboxSpaceId: DEFAULT_SPACE_IDS.inbox,
      priority: 10,
    });
    const { rawToken: readToken } = await sdk.tokens.create({
      name: "reader",
      scope: {
        permission: "read",
        spaceIds: [DEFAULT_SPACE_IDS.research],
        includeDescendants: true,
        denyHardDelete: true,
      },
    });
    const readerSdk = createInkadeClient({ baseUrl, token: readToken });
    expect((await readerSdk.scopeRules.list()).map((r) => r.id)).toContain(rule.id);
    await expectRejectsMatch(readerSdk.scopeRules.create({ matchType: "repo_name", pattern: "x" }), {
      status: 403,
      code: "FORBIDDEN",
    });

    // Attachments upload/download + scope boundary.
    const payload = new TextEncoder().encode("hello inkade attachment");
    const uploaded = await sdk.attachments.upload({
      documentId: promoted.article.id,
      filename: "notes.txt",
      mimeType: "text/plain",
      data: payload,
    });
    const attMeta = await sdk.attachments.get(uploaded.attachment.id);
    expect(attMeta.byteSize).toBe(payload.byteLength);
    const downloaded = await sdk.attachments.download(uploaded.attachment.id);
    expect(new TextDecoder().decode(downloaded)).toBe("hello inkade attachment");

    // Reader with access to Research CAN download attachment bound to Research article.
    const readerBytes = await readerSdk.attachments.download(uploaded.attachment.id);
    expect(new TextDecoder().decode(readerBytes)).toBe("hello inkade attachment");

    // Token restricted to Daily CANNOT download attachment bound to Research article.
    const { rawToken: dailyOnlyToken } = await sdk.tokens.create({
      name: "daily-only",
      scope: {
        permission: "append",
        spaceIds: [DEFAULT_SPACE_IDS.daily],
        includeDescendants: true,
        denyHardDelete: true,
      },
    });
    const dailySdk = createInkadeClient({ baseUrl, token: dailyOnlyToken });
    await expectRejectsMatch(dailySdk.attachments.download(uploaded.attachment.id), {
      status: 403,
      code: "FORBIDDEN",
    });
  });

  test("Native Streamable HTTP /mcp exposes 30 tools & 3 resources with strict scope enforcement", async () => {
    const { baseUrl } = await startTestServer({ localAutoAuth: true });
    const adminSdk = createInkadeClient({ baseUrl });

    const { rawToken } = await adminSdk.tokens.create({
      name: "mcp-agent",
      scope: {
        permission: "write",
        spaceIds: [DEFAULT_SPACE_IDS.daily, DEFAULT_SPACE_IDS.research],
        includeDescendants: true,
        denyHardDelete: true,
      },
    });

    const mcpClient = new Client({ name: "inkade-test-client", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: {
        headers: {
          authorization: `Bearer ${rawToken}`,
        },
      },
    });

    await mcpClient.connect(transport);
    try {
      const toolsResult = await mcpClient.listTools();
      const toolNames = toolsResult.tools.map((t) => t.name).sort();
      expect(toolNames).toEqual(
        [
          "append_node_reply",
          "append_outline_node",
          "batch_mutate_outline",
          "bind_thread",
          "claim_thread_binding",
          "clip_url",
          "create_document",
          "create_document_artifact",
          "create_from_template",
          "create_highlight",
          "create_upload_url",
          "get_audit_logs",
          "get_daily_outline",
          "get_document",
          "get_revision_diff",
          "get_space_schema",
          "get_thread_binding",
          "get_viewer_context",
          "list_bound_threads",
          "list_comment_threads",
          "list_context_packs",
          "list_documents",
          "list_highlights",
          "list_revisions",
          "list_spaces",
          "list_tasks",
          "list_templates",
          "patch_document_section",
          "poll_wake_events",
          "read_context_pack",
          "reply_comment_thread",
          "request_human_decision",
          "reschedule_task",
          "scaffold_document",
          "search_documents",
          "semantic_search",
          "trash_document",
          "update_document",
          "update_document_artifact",
          "update_outline_node",
          "update_thread_binding",
          "upsert_task",
          "upsert_space_schema",
          "validate_document_artifact",
          "whoami_scope",
        ].sort(),
      );

      const resourcesResult = await mcpClient.listResources();
      expect(resourcesResult.resources.map((r) => r.uri)).toContain("inkade://scope");
      expect(resourcesResult.resources.map((r) => r.uri)).toContain("inkade://daily/today");

      const scopeResource = await mcpClient.readResource({ uri: "inkade://scope" });
      const scopeJson = JSON.parse(
        (scopeResource.contents[0] as { text: string }).text,
      ) as { tokenName: string };
      expect(scopeJson.tokenName).toBe("mcp-agent");

      // Create article via MCP in authorized space.
      const createdRes = await mcpClient.callTool({
        name: "create_document",
        arguments: {
          spaceId: DEFAULT_SPACE_IDS.research,
          kind: "article",
          title: "MCP Created Report",
          contentMarkdown: "# MCP Report\n\n## Summary\n\nInitial text.",
          tags: ["mcp"],
        },
      });
      expect(createdRes.isError).not.toBe(true);
      const createdPayload = JSON.parse(readToolText(createdRes)) as {
        document: { id: string; version: number };
      };

      // Attempt to create in forbidden Inbox space -> MCP must return isError: true with FORBIDDEN.
      const forbiddenRes = await mcpClient.callTool({
        name: "create_document",
        arguments: {
          spaceId: DEFAULT_SPACE_IDS.inbox,
          kind: "clip",
          title: "Forbidden Clip",
          contentMarkdown: "blocked",
        },
      });
      expect(forbiddenRes.isError).toBe(true);
      expect(readToolText(forbiddenRes)).toContain("FORBIDDEN");

      // Patch section + check revisions + diff via MCP.
      const patchedRes = await mcpClient.callTool({
        name: "patch_document_section",
        arguments: {
          documentId: createdPayload.document.id,
          headingPath: "Summary",
          mode: "append",
          markdown: "More findings.",
          expectedVersion: 1,
        },
      });
      expect(patchedRes.isError).not.toBe(true);

      const diffRes = await mcpClient.callTool({
        name: "get_revision_diff",
        arguments: {
          documentId: createdPayload.document.id,
          fromVersion: 1,
          toVersion: 2,
        },
      });
      expect(diffRes.isError).not.toBe(true);

      // Daily outline + node append + reply + thread binding via MCP.
      const dailyRes = await mcpClient.callTool({
        name: "get_daily_outline",
        arguments: { date: "2026-11-24" },
      });
      const dailyPayload = JSON.parse(readToolText(dailyRes)) as {
        document: { id: string };
      };

      const nodeRes = await mcpClient.callTool({
        name: "append_outline_node",
        arguments: {
          documentId: dailyPayload.document.id,
          contentMarkdown: "Task from MCP",
        },
      });
      const nodePayload = JSON.parse(readToolText(nodeRes)) as {
        node: { id: string };
      };

      const replyRes = await mcpClient.callTool({
        name: "append_node_reply",
        arguments: {
          documentId: dailyPayload.document.id,
          parentNodeId: nodePayload.node.id,
          contentMarkdown: "Reply from MCP",
        },
      });
      expect(replyRes.isError).not.toBe(true);

      const bindRes = await mcpClient.callTool({
        name: "bind_thread",
        arguments: {
          documentId: dailyPayload.document.id,
          nodeId: nodePayload.node.id,
          adeKind: "bb",
          externalThreadId: "thr_mcp_1",
          title: "MCP Thread",
        },
      });
      const bindPayload = JSON.parse(readToolText(bindRes)) as {
        binding: { id: string };
      };

      const listBoundRes = await mcpClient.callTool({
        name: "list_bound_threads",
        arguments: { documentId: dailyPayload.document.id },
      });
      expect(readToolText(listBoundRes)).toContain(bindPayload.binding.id);

      // Read document resource via URI template.
      const docResource = await mcpClient.readResource({
        uri: `inkade://doc/${createdPayload.document.id}`,
      });
      expect((docResource.contents[0] as { text: string }).text).toContain("More findings.");

      const uploadUrlRes = await mcpClient.callTool({
        name: "create_upload_url",
        arguments: {
          documentId: createdPayload.document.id,
          filename: "diagram.png",
          mimeType: "image/png",
        },
      });
      expect(uploadUrlRes.isError).not.toBe(true);
      expect(readToolText(uploadUrlRes)).toContain("/api/v1/attachments");
    } finally {
      await transport.close();
    }
  });

  test("Scope-filtered SSE hub and @inkade/sdk subscribeInkadeEvents with Last-Event-ID replay", async () => {
    const { baseUrl } = await startTestServer({ localAutoAuth: true });
    const adminSdk = createInkadeClient({ baseUrl });

    const { rawToken } = await adminSdk.tokens.create({
      name: "sse-watcher",
      scope: {
        permission: "read",
        spaceIds: [DEFAULT_SPACE_IDS.research],
        includeDescendants: true,
        tagAllowlist: ["public"],
        denyHardDelete: true,
      },
    });

    const received: InkadeEvent[] = [];
    let opened = false;
    const sub = subscribeInkadeEvents(
      { baseUrl, token: rawToken },
      {
        onOpen: () => {
          opened = true;
        },
        onEvent: (evt) => {
          received.push(evt);
        },
      },
    );

    await waitFor(() => opened);

    // 1. Secret space document event -> MUST NOT reach scoped SSE subscriber.
    await adminSdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.inbox,
      kind: "clip",
      title: "Private Inbox Clip",
      contentMarkdown: "secret",
      tags: ["public"],
    });

    // 2. Research doc without "public" tag -> MUST NOT reach scoped SSE subscriber.
    await adminSdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.research,
      kind: "article",
      title: "Internal Research",
      contentMarkdown: "internal only",
      tags: ["private"],
    });

    // 3. Research doc with "public" tag -> MUST reach scoped SSE subscriber.
    const visibleDoc = await adminSdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.research,
      kind: "article",
      title: "Public Research",
      contentMarkdown: "visible",
      tags: ["public"],
    });

    await waitFor(() => received.find((e) => e.documentId === visibleDoc.id));
    expect(received.every((e) => e.spaceId === DEFAULT_SPACE_IDS.research)).toBe(true);
    expect(received.map((e) => e.documentId)).toEqual([visibleDoc.id]);

    const cursor = sub.lastEventId;
    expect(cursor).not.toBeNull();
    sub.unsubscribe();

    // Publish another visible doc while disconnected, then replay via Last-Event-ID.
    const missedDoc = await adminSdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.research,
      kind: "article",
      title: "Missed While Offline",
      contentMarkdown: "replayed",
      tags: ["public"],
    });

    const replayed: InkadeEvent[] = [];
    const sub2 = subscribeInkadeEvents(
      { baseUrl, token: rawToken, lastEventId: cursor ?? undefined },
      {
        onEvent: (evt) => {
          replayed.push(evt);
        },
      },
    );

    try {
      await waitFor(() => replayed.find((e) => e.documentId === missedDoc.id));
      expect(replayed.map((e) => e.documentId)).toEqual([missedDoc.id]);
    } finally {
      sub2.unsubscribe();
    }
  });

  test("enforces single-owner signup lock, derives trustedOrigins for custom domains, and hardens attachment download headers", async () => {
    // 1. Placeholder auth secret detection + trusted origin derivation
    expect(isPlaceholderAuthSecret(undefined)).toBe(true);
    expect(isPlaceholderAuthSecret("short")).toBe(true);
    expect(isPlaceholderAuthSecret("change-me-in-production-min-32-chars")).toBe(true);
    expect(isPlaceholderAuthSecret("a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6")).toBe(false);

    const derived = buildBetterAuthTrustedOrigins({
      baseURL: "https://notes.example.com/custom-path",
      appOrigin: "https://app.example.com",
      envTrustedOrigins: "https://extra.example.com",
      envCorsOrigins: "https://cors.example.com",
    });
    expect(derived).toContain("https://notes.example.com");
    expect(derived).toContain("https://app.example.com");
    expect(derived).toContain("https://extra.example.com");
    expect(derived).toContain("https://cors.example.com");
    expect(derived).toContain("http://localhost:*");

    // 2. Single-owner registration lock (allowSignup=false by default after owner setup)
    const { baseUrl } = await startTestServer({ localAutoAuth: false });
    const cookies = new Map<string, string>();
    const cookieFetch = createCookieFetch(cookies);
    const anonSdk = createInkadeClient({ baseUrl, fetch: cookieFetch });

    const beforeSetup = await anonSdk.bootstrap.status();
    expect(beforeSetup.allowSignup).toBe(true);

    const setup = await anonSdk.bootstrap.setupOwner({
      name: "Owner",
      email: "owner@example.com",
      password: "super-secure-password-123",
    });
    expect(setup.initialized).toBe(true);

    const afterSetup = await anonSdk.bootstrap.status();
    expect(afterSetup.allowSignup).toBe(false);

    const rogueSignupRes = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Intruder",
        email: "intruder@example.com",
        password: "super-secure-password-123",
      }),
    });
    expect(rogueSignupRes.status).toBe(403);
    const roguePayload = (await rogueSignupRes.json()) as { error?: { code?: string } };
    expect(roguePayload.error?.code).toBe("SIGNUP_DISABLED");

    // 3. Attachment download XSS hardening: HTML/SVG forced to Content-Disposition: attachment + sandbox CSP + nosniff
    const htmlAttRes = await anonSdk.attachments.upload({
      filename: "evil.html",
      mimeType: "text/html",
      data: new TextEncoder().encode("<script>alert(1)</script>"),
    });
    const htmlDownloadRes = await cookieFetch(
      `${baseUrl}/api/v1/attachments/${htmlAttRes.attachment.id}/download`,
    );
    expect(htmlDownloadRes.status).toBe(200);
    expect(htmlDownloadRes.headers.get("content-disposition")).toContain("attachment;");
    expect(htmlDownloadRes.headers.get("x-content-type-options")).toBe("nosniff");
    expect(htmlDownloadRes.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");

    const svgAttRes = await anonSdk.attachments.upload({
      filename: "diagram.svg",
      mimeType: "image/svg+xml",
      data: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
    });
    const svgDownloadRes = await cookieFetch(
      `${baseUrl}/api/v1/attachments/${svgAttRes.attachment.id}/download`,
    );
    expect(svgDownloadRes.status).toBe(200);
    expect(svgDownloadRes.headers.get("content-disposition")).toContain("attachment;");
    expect(svgDownloadRes.headers.get("x-content-type-options")).toBe("nosniff");

    // Safe PNG stays inline while still enforcing nosniff + sandbox CSP
    const pngAttRes = await anonSdk.attachments.upload({
      filename: "photo.png",
      mimeType: "image/png",
      data: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    });
    const pngDownloadRes = await cookieFetch(
      `${baseUrl}/api/v1/attachments/${pngAttRes.attachment.id}/download`,
    );
    expect(pngDownloadRes.status).toBe(200);
    expect(pngDownloadRes.headers.get("content-disposition")).toContain("inline;");
    expect(pngDownloadRes.headers.get("x-content-type-options")).toBe("nosniff");
  });
});
