import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { asWorkspaceId, type InkadeEvent } from "@inkade/core";
import { DEFAULT_SPACE_IDS } from "@inkade/db";
import { createInkadeClient, subscribeInkadeEvents } from "@inkade/sdk";
import { INKADE_TOOL_CATALOG } from "@inkade/sdk/tools";
import { createInkadeApp, type InkadeAppInstance } from "./app.ts";
import { REGISTERED_MCP_TOOL_NAMES } from "./mcp/server.ts";

interface Phase2Harness {
  readonly baseUrl: string;
  readonly instance: InkadeAppInstance;
  readonly server: ReturnType<typeof Bun.serve>;
  readonly tempDir: string;
}

const activeHarnesses: Phase2Harness[] = [];

async function startPhase2Server(): Promise<Phase2Harness> {
  const tempDir = mkdtempSync(join(tmpdir(), "inkade-phase2-mcp-test-"));
  const instance = createInkadeApp({
    dbPath: join(tempDir, "inkade.db"),
    dataDir: tempDir,
    localAutoAuth: true,
    authSecret: "test-secret-key-for-inkade-phase2-mcp-suite-32b",
  });
  await instance.ready;

  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: instance.app.fetch,
    idleTimeout: 30,
  });

  const harness: Phase2Harness = {
    baseUrl: `http://127.0.0.1:${server.port}`,
    instance,
    server,
    tempDir,
  };
  activeHarnesses.push(harness);
  return harness;
}

async function connectMcp(baseUrl: string, token?: string): Promise<Client> {
  const client = new Client({ name: "phase2-test-client", version: "1.0.0" });
  const transport = token
    ? new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
        requestInit: { headers: { authorization: `Bearer ${token}` } },
      })
    : new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`));
  await client.connect(transport);
  return client;
}

afterEach(() => {
  while (activeHarnesses.length > 0) {
    const h = activeHarnesses.pop()!;
    void h.server.stop(true);
    h.instance.close();
    rmSync(h.tempDir, { recursive: true, force: true });
  }
});

describe("Phase 2 MCP realtime SSE, claim/get tools, and tool catalog", () => {
  test("aligns INKADE_TOOL_CATALOG 1:1 with REGISTERED_MCP_TOOL_NAMES and live MCP listTools", async () => {
    const { baseUrl } = await startPhase2Server();
    const mcp = await connectMcp(baseUrl);
    try {
      const listed = await mcp.listTools();
      const serverToolNames = listed.tools.map((t) => t.name).sort();
      const catalogMcpNames = INKADE_TOOL_CATALOG.map((t) => t.mcpName).sort();
      const registeredConst = [...REGISTERED_MCP_TOOL_NAMES].sort();

      expect(serverToolNames).toEqual(registeredConst);
      expect(catalogMcpNames).toEqual(registeredConst);

      const listedByName = new Map(listed.tools.map((tool) => [tool.name, tool]));
      for (const catalogTool of INKADE_TOOL_CATALOG) {
        const listedTool = listedByName.get(catalogTool.mcpName);
        expect(listedTool?.annotations).toMatchObject(catalogTool.annotations);
      }
    } finally {
      await mcp.close();
    }
  });

  test("emits transient scoped agent.tool.started/finished without polluting replay buffer or leaking cross-space", async () => {
    const { baseUrl, instance } = await startPhase2Server();
    const adminClient = createInkadeClient({ baseUrl });

    const researchDoc = await adminClient.documents.create({
      spaceId: DEFAULT_SPACE_IDS.research,
      kind: "article",
      title: "Private Research Paper",
      contentMarkdown: "# Findings\nConfidential notes.",
    });

    const restrictedToken = await adminClient.tokens.create({
      name: "Daily Only Token",
      scope: {
        permission: "write",
        spaceIds: [DEFAULT_SPACE_IDS.daily],
        includeDescendants: true,
        denyHardDelete: true,
      },
    });
    const researchToken = await adminClient.tokens.create({
      name: "Research Agent",
      scope: {
        permission: "read",
        spaceIds: [DEFAULT_SPACE_IDS.research],
        includeDescendants: true,
        denyHardDelete: true,
      },
    });

    const adminEvents: InkadeEvent[] = [];
    const restrictedEvents: InkadeEvent[] = [];

    const adminSub = subscribeInkadeEvents(
      { baseUrl },
      { onEvent: (evt) => adminEvents.push(evt) },
    );
    const restrictedSub = subscribeInkadeEvents(
      { baseUrl, token: restrictedToken.rawToken },
      { onEvent: (evt) => restrictedEvents.push(evt) },
    );

    const mcp = await connectMcp(baseUrl, researchToken.rawToken);
    try {
      await new Promise((r) => setTimeout(r, 80));

      const res = await mcp.callTool({
        name: "get_document",
        arguments: { documentId: researchDoc.id },
      });
      expect(res.isError).toBeFalsy();

      await new Promise((r) => setTimeout(r, 80));

      const adminToolEvents = adminEvents.filter((e) => e.type.startsWith("agent.tool."));
      expect(adminToolEvents.some((e) => e.type === "agent.tool.started")).toBe(true);
      expect(adminToolEvents.some((e) => e.type === "agent.tool.finished")).toBe(true);

      const started = adminToolEvents.find((e) => e.type === "agent.tool.started");
      if (!started) {
        throw new Error("Expected agent.tool.started event");
      }
      expect(started.payload.toolName).toBe("get_document");
      expect(started.payload.tokenName).toBe("Research Agent");
      expect(started.payload.transport).toBe("mcp");
      expect(started.payload.mutating).toBe(false);

      const finished = adminToolEvents.find((e) => e.type === "agent.tool.finished");
      if (!finished) {
        throw new Error("Expected agent.tool.finished event");
      }
      expect(finished.payload.invocationId).toBe(started.payload.invocationId);
      expect(finished.payload.status).toBe("ok");

      // Restricted Daily token must NOT see Research Space agent.tool.* activity!
      expect(restrictedEvents.some((e) => e.type.startsWith("agent.tool."))).toBe(false);

      // Transient events must NOT enter SSE replay ring buffer!
      const replay = instance.sseHub.getEventsSince(0, asWorkspaceId("ws_default"));
      expect(replay.some((e) => e.type.startsWith("agent.tool."))).toBe(false);
    } finally {
      await mcp.close();
      adminSub.unsubscribe();
      restrictedSub.unsubscribe();
    }
  });

  test("claim_thread_binding and get_thread_binding complete headless MCP coordination loop", async () => {
    const { baseUrl } = await startPhase2Server();
    const adminClient = createInkadeClient({ baseUrl });
    const doc = await adminClient.documents.create({
      spaceId: DEFAULT_SPACE_IDS.research,
      kind: "article",
      title: "MCP Claim Loop Spec",
      contentMarkdown: "# Loop",
    });

    const pending = await adminClient.threadBindings.upsert({
      documentId: doc.id,
      nodeId: null,
      adeKind: "any",
      externalThreadId: "thr_pending_mcp_1",
      title: "Queue via Web",
      status: "queued",
      unreadResult: false,
    });

    await adminClient.threadBindings.steer(pending.id, {
      text: "Check SQLite WAL constraints too",
      mode: "interrupt",
    });

    const mcp = await connectMcp(baseUrl);
    try {
      const claimRes = await mcp.callTool({
        name: "claim_thread_binding",
        arguments: {
          bindingId: pending.id,
          adeKind: "cursor",
          externalThreadId: "cur_thread_42",
          status: "running",
        },
      });
      expect(claimRes.isError).toBeFalsy();
      const claimParsed = JSON.parse(
        (claimRes.content as Array<{ text: string }>)[0]!.text,
      ) as { binding: { adeKind: string; externalThreadId: string } };
      expect(claimParsed.binding.adeKind).toBe("cursor");
      expect(claimParsed.binding.externalThreadId).toBe("cur_thread_42");

      const getRes = await mcp.callTool({
        name: "get_thread_binding",
        arguments: {
          bindingId: pending.id,
          consumeSteering: true,
        },
      });
      expect(getRes.isError).toBeFalsy();
      const getParsed = JSON.parse(
        (getRes.content as Array<{ text: string }>)[0]!.text,
      ) as { binding: { steeringQueue?: Array<{ deliveredAt: string | null }> } };
      expect(getParsed.binding.steeringQueue?.length).toBe(1);
      expect(getParsed.binding.steeringQueue?.[0]?.deliveredAt).not.toBeNull();
    } finally {
      await mcp.close();
    }
  });
});
