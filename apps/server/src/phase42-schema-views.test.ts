import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { importMarkdownWithFrontmatter } from "@inkade/core";
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
  const tempDir = mkdtempSync(join(tmpdir(), "inkade-phase42-test-"));
  const instance = createInkadeApp({
    dbPath: join(tempDir, "inkade.db"),
    dataDir: tempDir,
    localAutoAuth: true,
    authSecret: "test-secret-key-for-inkade-phase42-suite-32bytes",
  });
  await instance.ready;

  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: (req, bunServer) => instance.fetch(req, bunServer),
    websocket: instance.websocket,
    idleTimeout: 30,
  });

  const harness: Harness = {
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

function readToolText(res: Awaited<ReturnType<Client["callTool"]>>): string {
  const content = res.content as Array<{ type: string; text?: string }>;
  return content.find((c) => c.type === "text")?.text ?? "";
}

describe("Phase 42: Space property schemas, SavedView layouts, view queries, Frontmatter export & public share isolation", () => {
  test("manages Space property schemas via REST/MCP, enforces property validation, and exports schema Frontmatter", async () => {
    const { baseUrl } = await startTestServer();
    const adminSdk = createInkadeClient({ baseUrl });

    // Upsert 8-type schema on Research space
    const schema = await adminSdk.spaces.upsertSchema(DEFAULT_SPACE_IDS.research, {
      fields: [
        {
          key: "status",
          label: "Status",
          type: "select",
          options: [
            { value: "draft", label: "Draft", color: "slate" },
            { value: "review", label: "In Review", color: "amber" },
            { value: "done", label: "Done", color: "emerald" },
          ],
          showInTable: true,
          showInCard: true,
          requiredByAgent: true,
        },
        {
          key: "budget",
          label: "Budget",
          type: "number",
          options: [],
          numberFormat: "currency",
          numberUnit: "USD",
          showInTable: true,
          showInCard: true,
          requiredByAgent: false,
        },
        {
          key: "dueDate",
          label: "Due Date",
          type: "date",
          options: [],
          showInTable: true,
          showInCard: true,
          requiredByAgent: false,
        },
        {
          key: "approved",
          label: "Approved",
          type: "checkbox",
          options: [],
          showInTable: true,
          showInCard: false,
          requiredByAgent: false,
        },
        {
          key: "specUrl",
          label: "Spec URL",
          type: "url",
          options: [],
          showInTable: true,
          showInCard: false,
          requiredByAgent: false,
        },
      ],
    });
    expect(schema.spaceId).toBe(DEFAULT_SPACE_IDS.research);
    expect(schema.fields).toHaveLength(5);

    const loaded = await adminSdk.spaces.getSchema(DEFAULT_SPACE_IDS.research);
    expect(loaded?.id).toBe(schema.id);
    expect(loaded?.fields.map((f) => f.key)).toEqual([
      "status",
      "budget",
      "dueDate",
      "approved",
      "specUrl",
    ]);

    // Invalid property types fail server-side validation
    const invalidRes = await fetch(`${baseUrl}/api/v1/documents`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        spaceId: DEFAULT_SPACE_IDS.research,
        kind: "article",
        title: "Bad Budget",
        contentMarkdown: "test",
        properties: { budget: "not-a-number" },
      }),
    });
    expect(invalidRes.status).toBe(400);

    // Coerced create with missing requiredByAgent emits schemaValidation hints
    const partialRes = await fetch(`${baseUrl}/api/v1/documents`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        spaceId: DEFAULT_SPACE_IDS.research,
        kind: "article",
        title: "Q4 Architecture RFC",
        contentMarkdown: "# Q4 Architecture\n\nBody copy.",
        tags: ["rfc"],
        properties: {
          budget: "4200",
          dueDate: "2026-12-01",
          approved: "true",
          specUrl: "https://example.com/rfc",
          systemRole: "should-be-stripped-on-export",
        },
      }),
    });
    expect(partialRes.status).toBe(201);
    const partialJson = (await partialRes.json()) as {
      document: { id: string; properties: Record<string, unknown> };
      schemaValidation?: { missingRequired: string[] };
    };
    expect(partialJson.document.properties.budget).toBe(4200);
    expect(partialJson.document.properties.approved).toBe(true);
    expect(partialJson.schemaValidation?.missingRequired).toEqual(["status"]);

    // Export Markdown preserves YAML Frontmatter with schema key ordering & skips internal keys
    const exportRes = await fetch(
      `${baseUrl}/api/v1/documents/${partialJson.document.id}/export.md`,
    );
    expect(exportRes.status).toBe(200);
    const exportedMd = await exportRes.text();
    expect(exportedMd).toContain("budget: 4200");
    expect(exportedMd).toContain("dueDate: 2026-12-01");
    expect(exportedMd).not.toContain("systemRole");
    const reimported = importMarkdownWithFrontmatter(exportedMd);
    expect(reimported.title).toBe("Q4 Architecture RFC");
    expect(reimported.properties.budget).toBe(4200);
    expect(reimported.properties.approved).toBe(true);

    // Scoped agent token with MCP can read/write space schema within scope and create typed docs
    const tokenRes = await adminSdk.tokens.create({
      name: "research-schema-agent",
      scope: {
        permission: "write",
        spaceIds: [DEFAULT_SPACE_IDS.research],
        includeDescendants: true,
        denyHardDelete: true,
      },
    });
    const mcpClient = new Client({ name: "inkade-p42-mcp", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${tokenRes.rawToken}` } },
    });
    await mcpClient.connect(transport);
    try {
      const schemaTool = await mcpClient.callTool({
        name: "get_space_schema",
        arguments: { spaceId: DEFAULT_SPACE_IDS.research },
      });
      expect(schemaTool.isError).not.toBe(true);
      const parsedSchema = JSON.parse(readToolText(schemaTool)) as {
        schema: { fields: Array<{ key: string }> } | null;
      };
      expect(parsedSchema.schema?.fields.some((f) => f.key === "status")).toBe(true);

      const mcpDocTool = await mcpClient.callTool({
        name: "create_document",
        arguments: {
          spaceId: DEFAULT_SPACE_IDS.research,
          kind: "article",
          title: "Agent Typed Doc",
          contentMarkdown: "Created via MCP",
          properties: { status: "review", budget: 1800 },
        },
      });
      expect(mcpDocTool.isError).not.toBe(true);
      const createdPayload = JSON.parse(readToolText(mcpDocTool)) as {
        document: { properties: Record<string, unknown> };
        schemaValidation?: { missingRequired: string[] };
      };
      expect(createdPayload.document.properties.status).toBe("review");
      expect(createdPayload.schemaValidation).toBeUndefined();

      // Unauthorized Inbox space schema access fails with scope error
      const deniedSchema = await mcpClient.callTool({
        name: "get_space_schema",
        arguments: { spaceId: DEFAULT_SPACE_IDS.inbox },
      });
      expect(deniedSchema.isError).toBe(true);
    } finally {
      await transport.close();
    }
  });

  test("persists SavedView table/board layouts, enforces Scope in /views/query, and isolates PublicShare embedded views", async () => {
    const { baseUrl } = await startTestServer();
    const adminSdk = createInkadeClient({ baseUrl });

    // Extended SavedView round-trip
    const saved = await adminSdk.savedViews.create({
      name: "Research Kanban Board",
      displayMode: "board",
      groupByField: "status",
      visibleColumns: ["title", "status", "budget"],
      columnWidths: { title: 320, status: 140, budget: 120 },
      sortRules: [{ field: "budget", dir: "desc" }],
      filter: { spaceId: DEFAULT_SPACE_IDS.research, viewMode: "board" },
    });
    expect(saved.displayMode).toBe("board");
    expect(saved.groupByField).toBe("status");
    expect(saved.visibleColumns).toEqual(["title", "status", "budget"]);
    expect(saved.columnWidths).toEqual({ title: 320, status: 140, budget: 120 });
    expect(saved.sortRules).toEqual([{ field: "budget", dir: "desc" }]);

    const updatedView = await adminSdk.savedViews.update(saved.id, {
      displayMode: "table",
      columnWidths: { title: 400 },
    });
    expect(updatedView.displayMode).toBe("table");
    expect(updatedView.columnWidths).toEqual({ title: 400 });

    // Seed Research + Inbox docs and active/revoked share links
    const docShared = await adminSdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.research,
      kind: "article",
      title: "Shared Item One",
      contentMarkdown: "Shared details",
      tags: ["public-item"],
      properties: { status: "done", budget: 2500, _internalSecret: "do-not-expose" },
    });
    const docPrivate = await adminSdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.research,
      kind: "article",
      title: "Confidential Unshared Note",
      contentMarkdown: "Private financial notes",
      tags: ["public-item"],
      properties: { status: "done", budget: 9999 },
    });
    const docRevoked = await adminSdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.research,
      kind: "article",
      title: "Previously Shared Revoked Note",
      contentMarkdown: "Revoked",
      tags: ["public-item"],
      properties: { status: "done", budget: 5000 },
    });
    const docInbox = await adminSdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.inbox,
      kind: "article",
      title: "Inbox Private Doc",
      contentMarkdown: "Inbox only",
      properties: { budget: 777 },
    });

    const viewYaml = `mode: table\nspaceId: ${DEFAULT_SPACE_IDS.research}\ntag: public-item\ncolumns:\n  - title\n  - status\n  - budget`;
    const docHost = await adminSdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.research,
      kind: "article",
      title: "Public Dashboard",
      contentMarkdown: `# Live Overview\n\n\`\`\`inkade-view\n${viewYaml}\n\`\`\`\n`,
    });

    const hostShare = await adminSdk.shareLinks.create({ documentId: docHost.id });
    const sharedItemLink = await adminSdk.shareLinks.create({ documentId: docShared.id });
    const revokedLink = await adminSdk.shareLinks.create({ documentId: docRevoked.id });
    await adminSdk.shareLinks.revoke(revokedLink.id);

    // Scoped token only permitted on Research space
    const researchToken = await adminSdk.tokens.create({
      name: "research-reader",
      scope: {
        permission: "read",
        spaceIds: [DEFAULT_SPACE_IDS.research],
        includeDescendants: true,
        denyHardDelete: true,
      },
    });
    const scopedSdk = createInkadeClient({ baseUrl, token: researchToken.rawToken });
    const scopedQuery = await scopedSdk.views.query({ mode: "table" });
    const scopedIds = scopedQuery.documents.map((d) => d.id);
    expect(scopedIds).toContain(docShared.id);
    expect(scopedIds).toContain(docPrivate.id);
    expect(scopedIds).not.toContain(docInbox.id);

    let unauthorizedRejected = false;
    try {
      await scopedSdk.views.query({ spaceId: DEFAULT_SPACE_IDS.inbox });
    } catch {
      unauthorizedRejected = true;
    }
    expect(unauthorizedRejected).toBe(true);

    // PublicShare MUST only include docShared (active share link), never docPrivate or docRevoked
    const publicShare = await adminSdk.shareLinks.getPublic(hostShare.token);
    expect(publicShare.embeddedViews).toBeDefined();
    const snapshot = publicShare.embeddedViews?.[viewYaml];
    expect(snapshot).toBeDefined();
    expect(snapshot?.documents.map((d) => d.id)).toEqual([docShared.id]);
    expect(snapshot?.documents[0]?.publicShareToken).toBe(sharedItemLink.token);
    expect(snapshot?.documents[0]?.properties?._internalSecret).toBeUndefined();
    expect(snapshot?.documents.map((d) => d.id)).not.toContain(docPrivate.id);
    expect(snapshot?.documents.map((d) => d.id)).not.toContain(docRevoked.id);
  });
});
