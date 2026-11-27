import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { buildSandboxArtifactOrigin, extractArtifactBlocks, type InkadeEvent } from "@inkade/core";
import { DEFAULT_SPACE_IDS } from "@inkade/db";
import { createInkadeClient, subscribeInkadeEvents } from "@inkade/sdk";
import { createInkadeApp, type InkadeAppInstance } from "./app.ts";
import type { McpStructuredErrorPayload } from "./mcp/server.ts";
import type { CreateInkadeAppOptions } from "./types.ts";

interface Phase51Harness {
  readonly baseUrl: string;
  readonly instance: InkadeAppInstance;
  readonly server: ReturnType<typeof Bun.serve>;
  readonly tempDir: string;
}

const activeHarnesses: Phase51Harness[] = [];

async function startPhase51Server(
  options: Omit<CreateInkadeAppOptions, "dbPath" | "dataDir"> = {},
): Promise<Phase51Harness> {
  const tempDir = mkdtempSync(join(tmpdir(), "inkade-phase51-test-"));
  const instance = createInkadeApp({
    dbPath: join(tempDir, "inkade.db"),
    dataDir: tempDir,
    localAutoAuth: true,
    authSecret: "test-secret-key-for-inkade-phase51-suite-32bytes",
    ...options,
  });
  await instance.ready;

  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: (req, bunServer) => instance.fetch(req, bunServer),
    websocket: instance.websocket,
    idleTimeout: 30,
  });

  const harness: Phase51Harness = {
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

function readToolText(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const content = result.content as Array<{ type: string; text?: string }>;
  return content.find((c) => c.type === "text")?.text ?? "";
}

const VALID_ARTIFACT_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Compound Savings Model</title>
  <style>body { font-family: sans-serif; padding: 12px; }</style>
</head>
<body>
  <h1 id="heading">Compound Savings Model</h1>
  <div id="sources"></div>
  <script>
    (async function() {
      if (window.inkade) {
        var theme = await window.inkade.use("theme");
        theme.onChange(function() {});
        var sources = await window.inkade.use("sources");
        document.getElementById("sources").textContent = JSON.stringify(sources);
      }
    })();
  </script>
</body>
</html>`;

describe("Phase 51 — Sandboxed Document Artifacts & Dual-Origin Isolation", () => {
  test("SDK & REST artifact lifecycle: validate, create with fence append, sha256 lock, SSE events, and soft delete", async () => {
    const { baseUrl, instance } = await startPhase51Server();
    const sdk = createInkadeClient({ baseUrl });

    const invalidCheck = await sdk.artifacts.validate({
      htmlSource: '<html><body><script>fetch("https://evil.example/data")</script></body></html>',
      capabilities: { network: "none" },
    });
    expect(invalidCheck.valid).toBe(false);
    expect(invalidCheck.errors.length).toBeGreaterThanOrEqual(2);

    const validCheck = await sdk.artifacts.validate({
      htmlSource: VALID_ARTIFACT_HTML,
      capabilities: { theme: true, sources: true, network: "none" },
    });
    expect(validCheck.valid).toBe(true);

    const createdDoc = await sdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.research,
      kind: "article",
      title: "Retirement Planning Note",
      contentMarkdown: "# Retirement\n\nModeling compounding assumptions.",
    });

    const seqBefore = instance.sseHub.currentSeq;
    const receivedEvents: Array<Extract<InkadeEvent, { type: "document_artifact.updated" }>> = [];
    const sub = subscribeInkadeEvents(
      { baseUrl, lastEventId: String(seqBefore) },
      {
        onEvent: (event) => {
          if (event.type === "document_artifact.updated") {
            receivedEvents.push(event);
          }
        },
      },
    );

    try {
      const created = await sdk.artifacts.create(createdDoc.id, {
        title: "Compound Savings Model",
        htmlSource: VALID_ARTIFACT_HTML,
        capabilities: { theme: true, sources: true, comment: true, network: "none" },
        sources: [{ kind: "document", label: "Self", documentId: createdDoc.id }],
        fallbackMarkdown: "| Year | Total |\n| --- | --- |\n| 10 | $18,000 |",
        heightPx: 440,
        appendFenceToDocument: true,
      });

      expect(created.artifact.id.startsWith("art_")).toBe(true);
      expect(created.artifact.version).toBe(1);
      expect(created.fenceMarkdown).toContain("```inkade-artifact");
      expect(created.document?.contentMarkdown).toContain(`id: ${created.artifact.id}`);

      const summaries = await sdk.artifacts.list(createdDoc.id);
      expect(summaries).toHaveLength(1);
      expect(summaries[0]?.id).toBe(created.artifact.id);
      expect(summaries[0] ? "htmlSource" in summaries[0] : true).toBe(false);

      let conflictErr: unknown;
      try {
        await sdk.artifacts.update(created.artifact.id, {
          ifMatchSha256: "wrong_sha256_hash",
          heightPx: 500,
        });
      } catch (err) {
        conflictErr = err;
      }
      expect(conflictErr).toMatchObject({ status: 409, code: "VERSION_CONFLICT" });

      const updated = await sdk.artifacts.update(created.artifact.id, {
        ifMatchSha256: created.artifact.sha256,
        title: "Compound Savings Model v2",
        heightPx: 520,
      });
      expect(updated.artifact.version).toBe(2);
      expect(updated.artifact.heightPx).toBe(520);

      const deleted = await sdk.artifacts.delete(created.artifact.id);
      expect(deleted.deleted).toBe(true);
      expect(await sdk.artifacts.list(createdDoc.id)).toHaveLength(0);

      let missingErr: unknown;
      try {
        await sdk.artifacts.get(created.artifact.id);
      } catch (err) {
        missingErr = err;
      }
      expect(missingErr).toMatchObject({ status: 404, code: "NOT_FOUND" });

      await new Promise((r) => setTimeout(r, 80));
      expect(receivedEvents.map((e) => e.payload.action)).toContain("created");
      expect(receivedEvents.map((e) => e.payload.action)).toContain("updated");
      expect(receivedEvents.map((e) => e.payload.action)).toContain("deleted");
    } finally {
      sub.unsubscribe();
    }
  });

  test("MCP tools (45 total), TokenScope enforcement on artifacts & sources, and sha256 conflict recovery", async () => {
    const { baseUrl } = await startPhase51Server();
    const ownerSdk = createInkadeClient({ baseUrl });

    const researchDoc = await ownerSdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.research,
      kind: "article",
      title: "Scoped Artifact Research",
      contentMarkdown: "# Research Base",
    });
    const secretInboxDoc = await ownerSdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.inbox,
      kind: "article",
      title: "Secret Inbox Doc",
      contentMarkdown: "Confidential notes.",
    });

    const issued = await ownerSdk.tokens.create({
      name: "phase51-research-agent",
      scope: {
        permission: "write",
        spaceIds: [DEFAULT_SPACE_IDS.research],
        includeDescendants: true,
        denyHardDelete: true,
      },
    });

    const mcpClient = new Client({ name: "phase51-mcp-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: {
        headers: {
          authorization: `Bearer ${issued.rawToken}`,
        },
      },
    });
    await mcpClient.connect(transport);

    try {
      const listed = await mcpClient.listTools();
      const toolNames = listed.tools.map((t) => t.name);
      expect(toolNames).toContain("validate_document_artifact");
      expect(toolNames).toContain("create_document_artifact");
      expect(toolNames).toContain("update_document_artifact");

      const valOut = await mcpClient.callTool({
        name: "validate_document_artifact",
        arguments: {
          htmlSource: VALID_ARTIFACT_HTML,
          capabilities: { theme: true, sources: true, network: "none" },
        },
      });
      const valJson = JSON.parse(readToolText(valOut)) as { valid: boolean };
      expect(valJson.valid).toBe(true);

      const forbiddenCrossScopeSource = await mcpClient.callTool({
        name: "create_document_artifact",
        arguments: {
          documentId: researchDoc.id,
          title: "Exfiltration Attempt",
          htmlSource: VALID_ARTIFACT_HTML,
          capabilities: { theme: true, sources: true, network: "none" },
          sources: [{ kind: "document", documentId: secretInboxDoc.id }],
          fallbackMarkdown: "Blocked.",
        },
      });
      expect(forbiddenCrossScopeSource.isError).toBe(true);
      const sourceErrPayload = JSON.parse(
        readToolText(forbiddenCrossScopeSource),
      ) as McpStructuredErrorPayload;
      expect(sourceErrPayload.error.code).toBe("FORBIDDEN");

      const createdOut = await mcpClient.callTool({
        name: "create_document_artifact",
        arguments: {
          documentId: researchDoc.id,
          title: "Research Calc",
          htmlSource: VALID_ARTIFACT_HTML,
          capabilities: { theme: true, sources: true, network: "none" },
          sources: [{ kind: "document", documentId: researchDoc.id }],
          fallbackMarkdown: "| Key | Val |\n| --- | --- |\n| k | 1 |",
          appendFenceToDocument: true,
        },
      });
      expect(createdOut.isError).toBeFalsy();
      const createdJson = JSON.parse(readToolText(createdOut)) as {
        artifact: { id: string; sha256: string };
        fenceMarkdown: string;
      };
      expect(createdJson.artifact.id.startsWith("art_")).toBe(true);

      const staleUpdate = await mcpClient.callTool({
        name: "update_document_artifact",
        arguments: {
          artifactId: createdJson.artifact.id,
          ifMatchSha256: "stale_hash",
          heightPx: 550,
        },
      });
      expect(staleUpdate.isError).toBe(true);
      const conflictPayload = JSON.parse(readToolText(staleUpdate)) as {
        error: { code: string; fix: string };
        current?: { sha256?: string };
      };
      expect(conflictPayload.error.code).toBe("VERSION_CONFLICT");
      expect(conflictPayload.current?.sha256).toBe(createdJson.artifact.sha256);

      const retryUpdate = await mcpClient.callTool({
        name: "update_document_artifact",
        arguments: {
          artifactId: createdJson.artifact.id,
          ifMatchSha256: conflictPayload.current?.sha256,
          heightPx: 550,
        },
      });
      expect(retryUpdate.isError).toBeFalsy();
      const retryJson = JSON.parse(readToolText(retryUpdate)) as {
        artifact: { heightPx: number };
      };
      expect(retryJson.artifact.heightPx).toBe(550);
    } finally {
      await mcpClient.close();
    }
  });

  test("Dual-origin sandbox host enforces 421 host binding, strips Cookie/Set-Cookie, injects live sources & strict CSP", async () => {
    const { baseUrl, server } = await startPhase51Server();
    const sdk = createInkadeClient({ baseUrl });

    const dataDoc = await sdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.research,
      kind: "article",
      title: "Sandbox Source Doc",
      tags: ["telemetry"],
      contentMarkdown: "Source data payload.",
    });

    const created = await sdk.artifacts.create(dataDoc.id, {
      title: "Telemetry Visualizer",
      htmlSource: VALID_ARTIFACT_HTML,
      capabilities: { theme: true, sources: true, comment: true, network: "none" },
      sources: [
        { kind: "document", label: "Primary Source", documentId: dataDoc.id },
        {
          kind: "inkade_view",
          label: "Telemetry View",
          query: { mode: "table", tags: ["telemetry"], limit: 10 },
        },
      ],
      fallbackMarkdown: "Telemetry table fallback.",
    });

    const expectedOrigin = buildSandboxArtifactOrigin(created.artifact.id, {
      appOrigin: baseUrl,
    }).origin;
    const expectedSubdomain = new URL(expectedOrigin).hostname.replace(/\.sandbox\.localhost$/, "");
    const ticket = await sdk.artifacts.issueSandboxTicket(created.artifact.id);
    expect(ticket.ticket.startsWith("sbx_")).toBe(true);
    expect(ticket.mode).toBe("dev_localhost");
    expect(ticket.sameSite).toBe(false);
    expect(ticket.sandboxOrigin).toBe(expectedOrigin);

    const apiOnSandboxHost = await fetch(`${baseUrl}/api/v1/documents`, {
      headers: { host: `${expectedSubdomain}.sandbox.localhost:${server.port}` },
    });
    expect(apiOnSandboxHost.status).toBe(421);

    const wrongHostRes = await fetch(`${baseUrl}/sandbox/${ticket.ticket}`, {
      headers: { host: `127.0.0.1:${server.port}` },
    });
    expect(wrongHostRes.status).toBe(421);

    const wrongSubdomainRes = await fetch(`${baseUrl}/sandbox/${ticket.ticket}`, {
      headers: { host: `art-other.sandbox.localhost:${server.port}` },
    });
    expect(wrongSubdomainRes.status).toBe(421);

    const validSandboxRes = await fetch(`${baseUrl}/sandbox/${ticket.ticket}`, {
      headers: {
        host: `${expectedSubdomain}.sandbox.localhost:${server.port}`,
        cookie: "inkade.session_token=TOP_SECRET_SESSION",
      },
    });
    expect(validSandboxRes.status).toBe(200);
    expect(validSandboxRes.headers.get("set-cookie")).toBeNull();
    expect(validSandboxRes.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(validSandboxRes.headers.get("referrer-policy")).toBe("no-referrer");
    expect(validSandboxRes.headers.get("x-content-type-options")).toBe("nosniff");

    const csp = validSandboxRes.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain(`frame-ancestors http://127.0.0.1:${server.port}`);

    const html = await validSandboxRes.text();
    expect(html).toContain('data-inkade-sandbox-runtime="1"');
    expect(html).toContain("Sandbox Source Doc");
    expect(html).not.toContain("TOP_SECRET_SESSION");

    const unknownSandboxRes = await fetch(`${baseUrl}/sandbox/sbx_nonexistent`, {
      headers: { host: `${expectedSubdomain}.sandbox.localhost:${server.port}` },
    });
    expect(unknownSandboxRes.status).toBe(401);

    const extraPathRes = await fetch(`${baseUrl}/sandbox/foo/bar`, {
      headers: { host: `${expectedSubdomain}.sandbox.localhost:${server.port}` },
    });
    expect(extraPathRes.status).toBe(404);

    const sandboxPathOnAppHost = await fetch(`${baseUrl}/sandbox/foo/bar`);
    expect(sandboxPathOnAppHost.status).toBe(421);
  });

  test("Production dual-origin validation, INKADE_SANDBOX_SAME_SITE 4-layer defenses, and collaborator comment wakeups", async () => {
    expect(() =>
      createInkadeApp({
        appOrigin: "https://notes.example.com",
        sandboxOrigin: "https://sandbox.notes.example.com",
        skipSeed: true,
        localAutoAuth: true,
      }),
    ).toThrow(/same-site|distinct|sandbox/i);

    const { baseUrl, instance } = await startPhase51Server({
      appOrigin: "https://notes.example.com",
      sandboxOrigin: "https://sandbox.notes.example.com",
      sandboxSameSite: true,
    });
    const sdk = createInkadeClient({ baseUrl });

    const runtimeStatus = await sdk.artifacts.getRuntimeConfig();
    expect(runtimeStatus.mode).toBe("same_site");
    expect(runtimeStatus.sameSite).toBe(true);
    expect(runtimeStatus.hostCookiePrefixEnabled).toBe(true);
    expect(instance.auth.options.advanced?.cookiePrefix).toBe("__Host-inkade");

    const doc = await sdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.research,
      kind: "article",
      title: "SameSite Policy Doc",
      contentMarkdown: "Testing defense in depth.",
    });

    const created = await sdk.artifacts.create(doc.id, {
      title: "SameSite Widget",
      htmlSource: VALID_ARTIFACT_HTML,
      capabilities: { theme: true, sources: true, comment: true, network: "none" },
      fallbackMarkdown: "Widget fallback.",
    });

    const sameSiteTicket = await sdk.artifacts.issueSandboxTicket(created.artifact.id);
    expect(sameSiteTicket.sameSite).toBe(true);

    const sbxRes = await fetch(`${baseUrl}/sandbox/${sameSiteTicket.ticket}`, {
      headers: { host: "sandbox.notes.example.com" },
    });
    expect(sbxRes.status).toBe(200);
    expect(sbxRes.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(sbxRes.headers.get("cross-origin-opener-policy")).toBe("same-origin-allow-popups");
    expect(sbxRes.headers.get("origin-agent-cluster")).toBe("?1");

    const badSecFetch = await fetch(`${baseUrl}/api/v1/documents`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "sec-fetch-site": "cross-site",
      },
      body: "{}",
    });
    expect(badSecFetch.status).toBe(403);

    const cookieWithoutSecFetch = await fetch(`${baseUrl}/api/v1/documents`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "__Host-inkade.session_token=abc",
      },
      body: "{}",
    });
    expect(cookieWithoutSecFetch.status).toBe(403);

    const badOrigin = await fetch(`${baseUrl}/api/v1/documents`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "sec-fetch-site": "same-origin",
        origin: "https://evil.example.com",
      },
      body: "{}",
    });
    expect(badOrigin.status).toBe(403);

    const commentRes = await sdk.artifacts.submitComment(created.artifact.id, {
      handoffNote: "Please add monthly amortization breakdown",
      authorName: "Alice",
    });
    expect(commentRes.highlight.id.startsWith("hl_")).toBe(true);
    expect(commentRes.wakeEvent.senderKind).toBe("collaborator");

    const noCommentArtifact = await sdk.artifacts.create(doc.id, {
      title: "ReadOnly Widget",
      htmlSource: VALID_ARTIFACT_HTML,
      capabilities: { theme: true, sources: true, comment: false },
      fallbackMarkdown: "Read only fallback.",
    });
    const deniedCommentRes = await fetch(
      `${baseUrl}/api/v1/artifacts/${noCommentArtifact.artifact.id}/comments`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "sec-fetch-site": "same-origin",
        },
        body: JSON.stringify({ handoffNote: "Should fail" }),
      },
    );
    expect(deniedCommentRes.status).toBe(403);
  });

  test("Public shares and Digital Gardens degrade ```inkade-artifact``` blocks into static fallbackMarkdown", async () => {
    const { baseUrl } = await startPhase51Server();
    const sdk = createInkadeClient({ baseUrl });

    const doc = await sdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.research,
      kind: "article",
      title: "Published Model",
      contentMarkdown: "# Published Report\n\nSummary follows.",
    });

    const created = await sdk.artifacts.create(doc.id, {
      title: "Interactive Chart",
      htmlSource: VALID_ARTIFACT_HTML,
      capabilities: { theme: true, sources: true },
      fallbackMarkdown: "**Chart Snapshot:** Revenue +24% YoY",
      appendFenceToDocument: true,
    });

    expect(extractArtifactBlocks(created.document!.contentMarkdown)).toHaveLength(1);

    const shareLink = await sdk.shareLinks.create({ documentId: doc.id });
    const publicShare = await sdk.shareLinks.getPublic(shareLink.token);
    expect(publicShare.document.contentMarkdown).toContain("**Chart Snapshot:** Revenue +24% YoY");
    expect(publicShare.document.contentMarkdown).not.toContain("inkade-artifact");

    await sdk.publicSites.create({
      slug: "research-garden",
      title: "Research Garden",
      sourceType: "space",
      sourceId: DEFAULT_SPACE_IDS.research,
      enabled: true,
      enableRss: true,
    });

    const publicSite = await sdk.publicSites.getPublic("research-garden");
    expect(publicSite.activeDocument?.contentMarkdown).toContain(
      "**Chart Snapshot:** Revenue +24% YoY",
    );
    expect(publicSite.activeDocument?.contentMarkdown).not.toContain("inkade-artifact");

    const feedRes = await fetch(`${baseUrl}/api/v1/public/sites/research-garden/feed.xml`);
    expect(feedRes.status).toBe(200);
    const feedXml = await feedRes.text();
    expect(feedXml).toContain("Revenue +24% YoY");
    expect(feedXml).not.toContain("inkade-artifact");
  });

  test("Dev loopback mode honors loopback Origin/Referer aliases and INKADE_FRAME_ANCESTORS even when appOrigin is configured", async () => {
    const { baseUrl, server } = await startPhase51Server({
      appOrigin: "http://localhost:3499",
      frameAncestors: "http://localhost:5173 https://ade.example.com javascript:alert(1)",
    });
    const sdk = createInkadeClient({ baseUrl });

    const doc = await sdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.research,
      kind: "article",
      title: "Loopback Alias Verification",
      contentMarkdown: "# Test",
    });

    const created = await sdk.artifacts.create(doc.id, {
      title: "Loopback Sandbox Widget",
      htmlSource: VALID_ARTIFACT_HTML,
      fallbackMarkdown: "Fallback table",
      capabilities: { theme: true, sources: true, comment: true },
    });

    const ticketRes = await fetch(
      `${baseUrl}/api/v1/artifacts/${created.artifact.id}/sandbox-ticket`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: `http://127.0.0.1:${server.port}`,
        },
        body: "{}",
      },
    );
    expect(ticketRes.status).toBe(201);
    const ticket = (await ticketRes.json()) as {
      readonly ticket: string;
      readonly sandboxOrigin: string;
      readonly mode: string;
    };
    const expectedOrigin = buildSandboxArtifactOrigin(created.artifact.id, {
      appOrigin: `http://127.0.0.1:${server.port}`,
    }).origin;
    expect(ticket.mode).toBe("dev_localhost");
    expect(ticket.sandboxOrigin).toBe(expectedOrigin);

    const sandboxHost = new URL(ticket.sandboxOrigin).host;
    const htmlRes = await fetch(`${baseUrl}/sandbox/${ticket.ticket}`, {
      headers: { host: sandboxHost },
    });
    expect(htmlRes.status).toBe(200);
    const csp = htmlRes.headers.get("content-security-policy") ?? "";
    expect(csp).toContain(`http://127.0.0.1:${server.port}`);
    expect(csp).toContain(`http://localhost:${server.port}`);
    expect(csp).toContain(`http://[::1]:${server.port}`);
    expect(csp).toContain("http://localhost:5173");
    expect(csp).toContain("https://ade.example.com");
    expect(csp).not.toContain("javascript:");
  });
});
