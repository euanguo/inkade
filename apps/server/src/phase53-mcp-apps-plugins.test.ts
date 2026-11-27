import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SHIPPED_HARNESS_WAKE_PROFILES_BY_NAME } from "@inkade/core";
import { DEFAULT_SPACE_IDS } from "@inkade/db";
import { createInkadeClient } from "@inkade/sdk";
import { createInkadeApp, type InkadeAppInstance } from "./app.ts";
import { supportsMcpAppsUi } from "./mcp/mcp-apps.ts";

interface Phase53Harness {
  readonly baseUrl: string;
  readonly instance: InkadeAppInstance;
  readonly server: ReturnType<typeof Bun.serve>;
  readonly tempDir: string;
}

const activeHarnesses: Phase53Harness[] = [];

async function startPhase53Server(): Promise<Phase53Harness> {
  const tempDir = mkdtempSync(join(tmpdir(), "inkade-phase53-test-"));
  const instance = createInkadeApp({
    dbPath: join(tempDir, "inkade.db"),
    dataDir: tempDir,
    localAutoAuth: true,
    authSecret: "test-secret-key-for-inkade-phase53-suite-32bytes",
  });
  await instance.ready;

  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: (req, bunServer) => instance.fetch(req, bunServer),
    websocket: instance.websocket,
    idleTimeout: 30,
  });

  const harness: Phase53Harness = {
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

describe("Phase 53 — MCP Apps show_inkade_view & multi-ADE plugin bundle builder", () => {
  test("supportsMcpAppsUi accurately detects io.modelcontextprotocol/ui across experimental and extensions", () => {
    expect(supportsMcpAppsUi(undefined)).toBe(false);
    expect(supportsMcpAppsUi({})).toBe(false);
    expect(supportsMcpAppsUi({ roots: {} })).toBe(false);
    expect(supportsMcpAppsUi({ experimental: { "io.modelcontextprotocol/ui": false } })).toBe(false);
    expect(supportsMcpAppsUi({ experimental: { "io.modelcontextprotocol/ui": {} } })).toBe(true);
    expect(
      supportsMcpAppsUi({ extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html"] } } }),
    ).toBe(true);
  });

  test("exposes show_inkade_view exclusively to MCP Apps clients, enforces scope, issues 60s single-use embedTicket, and includes CSP & fallback shell", async () => {
    const { baseUrl } = await startPhase53Server();
    const ownerSdk = createInkadeClient({ baseUrl });

    const researchDoc = await ownerSdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.research,
      kind: "article",
      title: "Phase 53 MCP Apps View",
      contentMarkdown: "# Overview\n\n## Details\n\nContent.",
    });

    const dailyOnlyToken = await ownerSdk.tokens.create({
      name: "Daily Scoped UI Agent",
      scope: {
        permission: "read",
        spaceIds: [DEFAULT_SPACE_IDS.daily],
        includeDescendants: true,
        denyHardDelete: true,
      },
    });

    // 1. Plain MCP client MUST NOT see show_inkade_view
    const plainClient = new Client({ name: "plain-mcp-client", version: "1.0.0" });
    const plainTransport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`));
    await plainClient.connect(plainTransport);

    // 2. MCP Apps UI client (advertising experimental["io.modelcontextprotocol/ui"])
    const uiClient = new Client(
      { name: "mcp-apps-host", version: "1.0.0" },
      {
        capabilities: {
          experimental: {
            "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] },
          },
        },
      },
    );
    const uiTransport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`));
    await uiClient.connect(uiTransport);

    // 3. Scoped MCP Apps client (extensions["io.modelcontextprotocol/ui"]) restricted to Daily space
    const scopedUiClient = new Client(
      { name: "scoped-mcp-apps-host", version: "1.0.0" },
      {
        capabilities: {
          extensions: {
            "io.modelcontextprotocol/ui": {},
          },
        },
      },
    );
    const scopedUiTransport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: {
        headers: {
          authorization: `Bearer ${dailyOnlyToken.rawToken}`,
        },
      },
    });
    await scopedUiClient.connect(scopedUiTransport);

    try {
      const plainTools = await plainClient.listTools();
      expect(plainTools.tools.some((t) => t.name === "show_inkade_view")).toBe(false);

      const uiTools = await uiClient.listTools();
      const showTool = uiTools.tools.find((t) => t.name === "show_inkade_view");
      expect(showTool).toBeDefined();
      const toolMeta = showTool?._meta as {
        ui?: { csp?: { frameDomains?: string[] } };
        "openai/ui"?: { permissions?: { loopbackNetwork?: boolean } };
      };
      expect(toolMeta?.ui?.csp?.frameDomains).toContain(baseUrl);
      expect(toolMeta?.["openai/ui"]?.permissions?.loopbackNetwork).toBe(true);

      // Invoke show_inkade_view for document
      const docViewRes = await uiClient.callTool({
        name: "show_inkade_view",
        arguments: {
          target: "document",
          documentId: researchDoc.id,
          headingSlug: "details",
        },
      });
      expect(docViewRes.isError).not.toBe(true);

      const contentBlocks = docViewRes.content as Array<{
        type: string;
        text?: string;
        resource?: { uri: string; mimeType?: string; text?: string; _meta?: Record<string, unknown> };
      }>;
      const textPayload = JSON.parse(
        contentBlocks.find((c) => c.type === "text")?.text ?? "{}",
      ) as {
        ok: boolean;
        target: string;
        resourceUri: string;
        embedUrl: string;
        browserUrl: string;
        ttlSeconds: number;
      };
      expect(textPayload.ok).toBe(true);
      expect(textPayload.target).toBe("document");
      expect(textPayload.ttlSeconds).toBe(60);
      expect(textPayload.embedUrl).toContain(`/docs/${researchDoc.id}`);
      expect(textPayload.embedUrl).toContain("embed=1");
      expect(textPayload.embedUrl).toContain("chrome=minimal");
      expect(textPayload.embedUrl).toContain("heading=details");

      const embedUrlObj = new URL(textPayload.embedUrl);
      const issuedTicket = embedUrlObj.searchParams.get("embedTicket") ?? "";
      expect(issuedTicket.startsWith("etk_")).toBe(true);

      // Verify single-use embedTicket exchanges cleanly once and rejects replay
      const exchanged = await ownerSdk.auth.exchangeEmbedTicket(issuedTicket);
      expect(exchanged.accessToken.startsWith("ink_emb_")).toBe(true);
      let replayStatus = 0;
      const replayRes = await fetch(`${baseUrl}/api/v1/auth/embed-ticket/exchange`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ticket: issuedTicket }),
      });
      replayStatus = replayRes.status;
      expect(replayStatus).toBe(401);

      // Verify embedded resource + CSP + securitypolicyviolation + 10s ready timeout + fallback button
      const htmlBlock = contentBlocks.find((c) => c.type === "resource")?.resource;
      expect(htmlBlock?.uri).toBe(textPayload.resourceUri);
      expect(htmlBlock?.mimeType).toBe("text/html;profile=mcp-app");
      expect(htmlBlock?.text).toContain("securitypolicyviolation");
      expect(htmlBlock?.text).toContain("inkade.ready");
      expect(htmlBlock?.text).toContain("10000");
      expect(htmlBlock?.text).toContain("在浏览器中打开");
      expect(htmlBlock?.text).toContain("复制页面地址");

      // Also verify resources/read works on the issued ui:// URI
      const readCard = await uiClient.readResource({ uri: textPayload.resourceUri });
      expect((readCard.contents[0] as { text?: string })?.text).toBe(htmlBlock?.text);

      const resultMeta = docViewRes._meta as typeof toolMeta;
      expect(resultMeta?.ui?.csp?.frameDomains).toContain(baseUrl);
      expect(resultMeta?.["openai/ui"]?.permissions?.loopbackNetwork).toBe(true);

      // Verify diff, daily, tasks, and inbox targets
      const diffRes = await uiClient.callTool({
        name: "show_inkade_view",
        arguments: {
          target: "diff",
          documentId: researchDoc.id,
          fromVersion: 1,
          toVersion: 2,
        },
      });
      expect(diffRes.isError).not.toBe(true);
      const diffPayload = JSON.parse(
        (diffRes.content as Array<{ type: string; text?: string }>)[0]?.text ?? "{}",
      ) as { embedUrl: string };
      expect(diffPayload.embedUrl).toContain("view=diff");
      expect(diffPayload.embedUrl).toContain("fromVersion=1");
      expect(diffPayload.embedUrl).toContain("toVersion=2");

      // Scope boundary: Daily-only token cannot open Research document via show_inkade_view
      const forbiddenRes = await scopedUiClient.callTool({
        name: "show_inkade_view",
        arguments: {
          target: "document",
          documentId: researchDoc.id,
        },
      });
      expect(forbiddenRes.isError).toBe(true);
      expect(
        (forbiddenRes.content as Array<{ text?: string }>)[0]?.text ?? "",
      ).toContain("FORBIDDEN");
    } finally {
      await plainTransport.close();
      await uiTransport.close();
      await scopedUiTransport.close();
    }
  });

  test("build-ade-plugins generates all 7 ADE bundles, exact bridge hooks/MCP commands, and 4 marketplace indexes", async () => {
    const repoRoot = resolve(import.meta.dir, "../../..");
    const modPath = join(repoRoot, "scripts", "build-ade-plugins.mjs");
    const mod = (await import(modPath)) as {
      buildAdePlugins: () => {
        readonly distRoot: string;
        readonly zipPath: string;
        readonly harnesses: readonly string[];
        readonly marketplaces: readonly string[];
      };
    };

    const result = mod.buildAdePlugins();
    const distRoot = result.distRoot;

    expect(result.harnesses).toEqual([
      "claude-code",
      "codex",
      "cursor",
      "copilot",
      "antigravity",
      "opencode",
      "pi",
    ]);

    // Check required bundle files per harness
    const expectedFiles: readonly { readonly harness: string; readonly files: readonly string[] }[] = [
      {
        harness: "claude-code",
        files: [
          ".claude-plugin/plugin.json",
          ".mcp.json",
          "hooks/hooks.json",
          "monitors/monitors.json",
          "skills/inkade/SKILL.md",
          "skills/inkade/bin/inkade-bridge.mjs",
        ],
      },
      {
        harness: "codex",
        files: [
          "plugin.json",
          "mcp.json",
          "hooks/hooks.json",
          "skills/inkade/SKILL.md",
          "skills/inkade/bin/inkade-bridge.mjs",
        ],
      },
      {
        harness: "cursor",
        files: [
          ".cursor-plugin/plugin.json",
          "mcp.json",
          "hooks/hooks.json",
          "skills/inkade/SKILL.md",
          "skills/inkade/bin/inkade-bridge.mjs",
        ],
      },
      {
        harness: "copilot",
        files: [
          "plugin.json",
          ".mcp.json",
          "hooks/hooks.json",
          "skills/inkade/SKILL.md",
          "skills/inkade/bin/inkade-bridge.mjs",
        ],
      },
      {
        harness: "antigravity",
        files: [
          "plugin.json",
          "mcp_config.json",
          "hooks.json",
          "skills/inkade/SKILL.md",
          "skills/inkade/bin/inkade-bridge.mjs",
        ],
      },
      {
        harness: "opencode",
        files: [
          "plugin.json",
          "opencode.json",
          "hooks/hooks.json",
          "skills/inkade/SKILL.md",
          "skills/inkade/bin/inkade-bridge.mjs",
        ],
      },
      {
        harness: "pi",
        files: [
          "plugin.json",
          "mcp.json",
          "extensions/inkade.mjs",
          "skills/inkade/SKILL.md",
          "skills/inkade/bin/inkade-bridge.mjs",
        ],
      },
    ];

    for (const entry of expectedFiles) {
      expect(SHIPPED_HARNESS_WAKE_PROFILES_BY_NAME[entry.harness]).toBeDefined();
      for (const relFile of entry.files) {
        const full = join(distRoot, entry.harness, relFile);
        expect(existsSync(full)).toBe(true);
      }

      const mcpFile = entry.files.find(
        (f) => f.endsWith("mcp.json") || f === "mcp_config.json" || f === "opencode.json",
      )!;
      const mcpRaw = readFileSync(join(distRoot, entry.harness, mcpFile), "utf8");
      expect(mcpRaw).toContain("inkade-bridge.mjs");
      expect(mcpRaw).toContain("mcp");
      expect(mcpRaw).toContain(`"${entry.harness}"`);

      const hooksFile = entry.files.find((f) => f.endsWith("hooks.json"));
      if (hooksFile) {
        const hooksRaw = readFileSync(join(distRoot, entry.harness, hooksFile), "utf8");
        expect(hooksRaw).toContain("inkade-bridge.mjs");
        expect(hooksRaw).toContain(`hook `);
        expect(hooksRaw).toContain(`--harness ${entry.harness}`);
      }

      const binPath = join(distRoot, entry.harness, "skills/inkade/bin/inkade-bridge.mjs");
      expect(statSync(binPath).size).toBeGreaterThan(1024);
    }

    // Verify all 4 root marketplace indexes
    for (const mpRel of [
      ".claude-plugin/marketplace.json",
      ".agents/plugins/marketplace.json",
      ".cursor-plugin/marketplace.json",
      ".github/plugin/marketplace.json",
    ]) {
      const mpPath = join(distRoot, mpRel);
      expect(existsSync(mpPath)).toBe(true);
      const parsed = JSON.parse(readFileSync(mpPath, "utf8")) as { plugins: unknown[] };
      expect(Array.isArray(parsed.plugins)).toBe(true);
      expect(parsed.plugins.length).toBeGreaterThan(0);
    }

    // Verify zip archive & /api/v1/connect/plugins/archive download route
    expect(existsSync(result.zipPath)).toBe(true);
    const zipBytes = readFileSync(result.zipPath);
    expect(zipBytes[0]).toBe(0x50); // 'P'
    expect(zipBytes[1]).toBe(0x4b); // 'K'

    const { baseUrl } = await startPhase53Server();
    const prevEnv = process.env.INKADE_PLUGINS_ZIP_PATH;
    process.env.INKADE_PLUGINS_ZIP_PATH = result.zipPath;
    try {
      const dlRes = await fetch(`${baseUrl}/api/v1/connect/plugins/archive`);
      expect(dlRes.status).toBe(200);
      expect(dlRes.headers.get("content-type")).toBe("application/zip");
      const buf = new Uint8Array(await dlRes.arrayBuffer());
      expect(buf[0]).toBe(0x50);
      expect(buf[1]).toBe(0x4b);
    } finally {
      if (prevEnv === undefined) {
        delete process.env.INKADE_PLUGINS_ZIP_PATH;
      } else {
        process.env.INKADE_PLUGINS_ZIP_PATH = prevEnv;
      }
    }
  });
});
