import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { asThreadBindingId, extractPendingBlocks } from "@inkade/core";
import { DEFAULT_SPACE_IDS, DEFAULT_WORKSPACE_ID } from "@inkade/db";
import { createInkadeClient } from "@inkade/sdk";
import { createInkadeApp, type InkadeAppInstance } from "./app.ts";
import type { McpStructuredErrorPayload } from "./mcp/server.ts";

interface Phase50Harness {
  readonly baseUrl: string;
  readonly instance: InkadeAppInstance;
  readonly server: ReturnType<typeof Bun.serve>;
  readonly tempDir: string;
}

const activeHarnesses: Phase50Harness[] = [];

async function startPhase50Server(): Promise<Phase50Harness> {
  const tempDir = mkdtempSync(join(tmpdir(), "inkade-phase50-test-"));
  const instance = createInkadeApp({
    dbPath: join(tempDir, "inkade.db"),
    dataDir: tempDir,
    localAutoAuth: true,
    authSecret: "test-secret-key-for-inkade-phase50-suite-32bytes",
  });
  await instance.ready;

  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: (req, bunServer) => instance.fetch(req, bunServer),
    websocket: instance.websocket,
    idleTimeout: 30,
  });

  const harness: Phase50Harness = {
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

async function expectRejectsMatch(
  promise: Promise<unknown>,
  expected: { readonly status: number; readonly code: string },
): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeDefined();
  expect(caught).toMatchObject(expected);
}

describe("Phase 50 — Progressive Skeleton Authoring (inkade-pending)", () => {
  test("SDK scaffold & patchSection(targetPendingId) create revisions, emit SSE events, and guard deleted pending blocks", async () => {
    const { baseUrl, instance } = await startPhase50Server();
    const ownerSdk = createInkadeClient({ baseUrl });
    const bindingId = asThreadBindingId("bnd_phase50_demo");

    const seqBefore = instance.sseHub.currentSeq;
    const scaffolded = await ownerSdk.documents.scaffold({
      spaceId: DEFAULT_SPACE_IDS.research,
      title: "Progressive Streaming Research",
      introMarkdown: "Live outline published immediately.",
      tags: ["research", "streaming"],
      bindingId,
      sections: [
        { heading: "TL;DR", initialMarkdown: "Key takeaway upfront." },
        {
          heading: "1. Architecture",
          pendingId: "sec_arch",
          pendingLabel: "Inspecting DB ports and SSE routes...",
        },
        {
          heading: "2. Benchmarks",
          pendingId: "sec_bench",
          pendingLabel: "Measuring FTS5 latency...",
        },
      ],
    });

    expect(scaffolded.kind).toBe("article");
    expect(scaffolded.version).toBe(1);
    expect(scaffolded.tags).toEqual(["research", "streaming"]);

    const initialBlocks = extractPendingBlocks(scaffolded.contentMarkdown);
    expect(initialBlocks.map((b) => ({ id: b.id, bindingId: b.bindingId, status: b.status }))).toEqual([
      { id: "sec_arch", bindingId, status: "generating" },
      { id: "sec_bench", bindingId, status: "generating" },
    ]);

    const revisionsV1 = await ownerSdk.documents.listRevisions(scaffolded.id);
    expect(revisionsV1).toHaveLength(1);
    expect(revisionsV1[0]?.version).toBe(1);

    const eventsAfterScaffold = instance.sseHub.getEventsSince(seqBefore, DEFAULT_WORKSPACE_ID);
    expect(eventsAfterScaffold.some((e) => e.type === "document.created" && e.documentId === scaffolded.id)).toBe(
      true,
    );

    const patched = await ownerSdk.documents.patchSection(scaffolded.id, {
      targetPendingId: "sec_arch",
      markdown: "Inkade enforces 10 narrow repository ports in @inkade/db.",
      expectedVersion: 1,
    });
    expect(patched.version).toBe(2);
    expect(patched.contentMarkdown).toContain("Inkade enforces 10 narrow repository ports in @inkade/db.");
    expect(extractPendingBlocks(patched.contentMarkdown).map((b) => b.id)).toEqual(["sec_bench"]);

    const eventsAfterPatch = instance.sseHub.getEventsSince(seqBefore, DEFAULT_WORKSPACE_ID);
    expect(eventsAfterPatch.some((e) => e.type === "document.updated" && e.documentId === scaffolded.id)).toBe(
      true,
    );

    // Validation requires either targetPendingId or headingPath
    const invalidRes = await fetch(`${baseUrl}/api/v1/documents/${scaffolded.id}/patch-section`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "replace", markdown: "No target" }),
    });
    expect(invalidRes.status).toBe(400);

    // Human converts sec_bench to handwritten prose
    const humanEdited = patched.contentMarkdown.replace(
      /```inkade-pending[\s\S]*?sec_bench[\s\S]*?```/,
      "Human authored benchmark section.",
    );
    const afterHuman = await ownerSdk.documents.update(scaffolded.id, {
      contentMarkdown: humanEdited,
      expectedVersion: 2,
    });
    expect(afterHuman.version).toBe(3);

    // Subsequent patch targeting sec_bench is rejected with 409 CONFLICT
    await expectRejectsMatch(
      ownerSdk.documents.patchSection(scaffolded.id, {
        targetPendingId: "sec_bench",
        markdown: "Agent trying to overwrite human prose",
      }),
      { status: 409, code: "CONFLICT" },
    );
  });

  test("MCP scaffold_document & patch_document_section enforce TokenScope and return executionStatus: not_executed on deleted pending blocks", async () => {
    const { baseUrl } = await startPhase50Server();
    const ownerSdk = createInkadeClient({ baseUrl });

    const writeResearchToken = await ownerSdk.tokens.create({
      name: "p50-research-writer",
      scope: {
        permission: "write",
        spaceIds: [DEFAULT_SPACE_IDS.research],
        includeDescendants: true,
        tagAllowlist: ["ai-report"],
        denyHardDelete: true,
      },
    });
    const readResearchToken = await ownerSdk.tokens.create({
      name: "p50-research-reader",
      scope: {
        permission: "read",
        spaceIds: [DEFAULT_SPACE_IDS.research],
        includeDescendants: true,
        denyHardDelete: true,
      },
    });

    // Read-only token is rejected by REST scaffold endpoint
    const readSdk = createInkadeClient({ baseUrl, token: readResearchToken.rawToken });
    await expectRejectsMatch(
      readSdk.documents.scaffold({
        spaceId: DEFAULT_SPACE_IDS.research,
        title: "Denied Read Scaffold",
        tags: ["ai-report"],
        sections: [{ heading: "Section 1" }],
      }),
      { status: 403, code: "FORBIDDEN" },
    );

    const mcpClient = new Client({ name: "inkade-p50-mcp", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${writeResearchToken.rawToken}` } },
    });
    await mcpClient.connect(transport);

    try {
      const tools = await mcpClient.listTools();
      expect(tools.tools.map((t) => t.name)).toContain("scaffold_document");

      // Scope boundary: forbidden space (inbox)
      const forbiddenSpaceRes = await mcpClient.callTool({
        name: "scaffold_document",
        arguments: {
          spaceId: DEFAULT_SPACE_IDS.inbox,
          title: "Unauthorized Inbox Scaffold",
          tags: ["ai-report"],
          sections: [{ heading: "Private" }],
        },
      });
      expect(forbiddenSpaceRes.isError).toBe(true);
      const forbiddenSpaceBody = JSON.parse(readToolText(forbiddenSpaceRes)) as McpStructuredErrorPayload;
      expect(forbiddenSpaceBody.executionStatus).toBe("not_executed");
      expect(forbiddenSpaceBody.error.code).toBe("FORBIDDEN");

      // Scope boundary: missing required tagAllowlist tag
      const forbiddenTagRes = await mcpClient.callTool({
        name: "scaffold_document",
        arguments: {
          spaceId: DEFAULT_SPACE_IDS.research,
          title: "Missing Tag Scaffold",
          tags: ["other"],
          sections: [{ heading: "Intro" }],
        },
      });
      expect(forbiddenTagRes.isError).toBe(true);
      const forbiddenTagBody = JSON.parse(readToolText(forbiddenTagRes)) as McpStructuredErrorPayload;
      expect(forbiddenTagBody.executionStatus).toBe("not_executed");
      expect(forbiddenTagBody.error.code).toBe("FORBIDDEN");

      // Authorized scaffold_document
      const scaffoldRes = await mcpClient.callTool({
        name: "scaffold_document",
        arguments: {
          spaceId: DEFAULT_SPACE_IDS.research,
          title: "MCP Streaming Draft",
          tags: ["ai-report"],
          sections: [
            { heading: "1. Findings", pendingId: "sec_findings", pendingLabel: "Gathering findings..." },
            { heading: "2. Risks", pendingId: "sec_risks", pendingLabel: "Evaluating risks..." },
          ],
        },
      });
      expect(scaffoldRes.isError).not.toBe(true);
      const scaffoldPayload = JSON.parse(readToolText(scaffoldRes)) as {
        document: { id: string; version: number; contentMarkdown: string };
      };
      const docId = scaffoldPayload.document.id;
      expect(scaffoldPayload.document.version).toBe(1);
      expect(extractPendingBlocks(scaffoldPayload.document.contentMarkdown).map((b) => b.id)).toEqual([
        "sec_findings",
        "sec_risks",
      ]);

      // Fill first section via patch_document_section(targetPendingId)
      const patchRes = await mcpClient.callTool({
        name: "patch_document_section",
        arguments: {
          documentId: docId,
          targetPendingId: "sec_findings",
          markdown: "Validated finding: zero data loss under concurrent edits.",
          expectedVersion: 1,
        },
      });
      expect(patchRes.isError).not.toBe(true);
      const patchPayload = JSON.parse(readToolText(patchRes)) as {
        document: { version: number; contentMarkdown: string };
      };
      expect(patchPayload.document.version).toBe(2);
      expect(patchPayload.document.contentMarkdown).toContain(
        "Validated finding: zero data loss under concurrent edits.",
      );
      expect(extractPendingBlocks(patchPayload.document.contentMarkdown).map((b) => b.id)).toEqual([
        "sec_risks",
      ]);

      // Human removes sec_risks and writes manual prose
      const latestDoc = await ownerSdk.documents.get(scaffoldPayload.document.id as never);
      const humanProse = latestDoc.contentMarkdown.replace(
        /```inkade-pending[\s\S]*?sec_risks[\s\S]*?```/,
        "Human decided to author the risks section directly.",
      );
      const updatedByHuman = await ownerSdk.documents.update(latestDoc.id, {
        contentMarkdown: humanProse,
        expectedVersion: 2,
      });
      expect(updatedByHuman.version).toBe(3);

      // Agent tries to fill deleted sec_risks -> rejected with executionStatus: "not_executed" & current snapshot
      const conflictRes = await mcpClient.callTool({
        name: "patch_document_section",
        arguments: {
          documentId: docId,
          targetPendingId: "sec_risks",
          markdown: "Agent must not overwrite human text!",
        },
      });
      expect(conflictRes.isError).toBe(true);
      const conflictBody = JSON.parse(readToolText(conflictRes)) as McpStructuredErrorPayload & {
        current?: {
          documentId?: string;
          version?: number;
          contentMarkdown?: string;
          pendingBlocks?: readonly unknown[];
          details?: { reason?: string; targetPendingId?: string };
        };
      };
      expect(conflictBody.executionStatus).toBe("not_executed");
      expect(conflictBody.error.code).toBe("CONFLICT");
      expect(conflictBody.error.fix).toContain("get_document");
      expect(conflictBody.current?.documentId).toBe(docId);
      expect(conflictBody.current?.version).toBe(3);
      expect(conflictBody.current?.contentMarkdown).toContain(
        "Human decided to author the risks section directly.",
      );
      expect(conflictBody.current?.pendingBlocks).toEqual([]);
      expect(conflictBody.current?.details?.reason).toBe("PENDING_BLOCK_NOT_FOUND");
      expect(conflictBody.current?.details?.targetPendingId).toBe("sec_risks");

      // Verify human prose remained untouched
      const finalDoc = await ownerSdk.documents.get(latestDoc.id);
      expect(finalDoc.version).toBe(3);
      expect(finalDoc.contentMarkdown).toContain("Human decided to author the risks section directly.");
      expect(finalDoc.contentMarkdown).not.toContain("Agent must not overwrite human text!");
    } finally {
      await transport.close();
    }
  });
});
