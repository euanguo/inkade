import { describe, expect, test } from "bun:test";
import {
  asContextPackId,
  asDocumentId,
  asOutlineNodeId,
  asSpaceId,
  asWorkspaceId,
  assembleContextPack,
  buildHostConnectConfig,
  chunkDocumentContent,
  CONNECT_HOST_KINDS,
  connectHostToHarnessName,
  countBpeTokens,
  truncateToTokenBudget,
  type ContextPack,
  type DocumentRecord,
  type OutlineNode,
} from "./index.ts";

function makeDoc(
  overrides: Partial<DocumentRecord> & { readonly id: DocumentRecord["id"] },
): DocumentRecord {
  const now = "2026-11-25T10:00:00.000Z";
  return {
    id: overrides.id,
    workspaceId: asWorkspaceId("ws_default"),
    spaceId: overrides.spaceId ?? asSpaceId("spc_research"),
    kind: overrides.kind ?? "article",
    title: overrides.title ?? "Untitled",
    slug: overrides.slug ?? "untitled",
    dailyDate: overrides.dailyDate ?? null,
    excerpt: overrides.excerpt ?? "",
    contentMarkdown: overrides.contentMarkdown ?? "",
    contentJson: null,
    contentText: overrides.contentText ?? overrides.contentMarkdown ?? "",
    tags: overrides.tags ?? [],
    properties: overrides.properties ?? {},
    pinned: overrides.pinned ?? false,
    version: overrides.version ?? 1,
    unreadAgentUpdate: false,
    lastEditedByType: "human",
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    trashedAt: overrides.trashedAt ?? null,
  };
}

describe("Phase 43 — Chunking, Context Packs & Connect Config Helpers", () => {
  test("chunkDocumentContent splits long Markdown sections under H1-H3 headings with BPE bounds and ~15% overlap", () => {
    const repeatedParagraph = Array.from(
      { length: 24 },
      (_, idx) =>
        `Segment ${idx}: Inkade stores normalized chunk embeddings inside SQLite Float32 BLOB rows and synchronizes Orama hybrid BM25 + dense vector indices cleanly.`,
    ).join("\n\n");

    const markdown = [
      "# System Architecture",
      "",
      "High-level overview paragraph introducing the unified dual engine.",
      "",
      "## Storage & Indexing",
      "",
      "### Chunk Pipeline",
      "",
      repeatedParagraph,
      "",
      "## Retrieval Strategy",
      "",
      "Hybrid fusion combines keyword lexical signals and cosine similarity cleanly.",
    ].join("\n");

    const chunks = chunkDocumentContent(
      {
        title: "Architecture Spec",
        kind: "article",
        contentMarkdown: markdown,
        tags: ["rag", "architecture"],
      },
      { minTokens: 400, maxTokens: 560, overlapRatio: 0.15 },
    );

    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks.some((c) => c.headingPath?.includes("Chunk Pipeline"))).toBe(true);
    expect(chunks.some((c) => c.headingPath?.includes("Retrieval Strategy"))).toBe(true);

    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBe(countBpeTokens(chunk.contentText));
      expect(chunk.tokenCount).toBeLessThanOrEqual(680);
      expect(chunk.contentHash.length).toBeGreaterThan(8);
    }

    // Multi-chunk long section retains trailing overlap context in the next chunk
    const pipelineChunks = chunks.filter((c) => c.headingPath?.includes("Chunk Pipeline"));
    expect(pipelineChunks.length).toBeGreaterThanOrEqual(2);
    const firstTailWords = pipelineChunks[0]!.contentText.slice(-120).trim();
    const hasOverlapToken = firstTailWords
      .split(/\s+/)
      .filter((w) => w.length > 5)
      .some((w) => pipelineChunks[1]!.contentText.includes(w));
    expect(hasOverlapToken).toBe(true);
  });

  test("chunkDocumentContent splits Outline documents along first-level subtrees with stable nodeId anchors", () => {
    const docId = asDocumentId("doc_daily_1");
    const rootA = asOutlineNodeId("nod_root_a");
    const childA = asOutlineNodeId("nod_child_a");
    const rootB = asOutlineNodeId("nod_root_b");

    const nodes: OutlineNode[] = [
      {
        id: rootA,
        documentId: docId,
        parentNodeId: null,
        orderKey: "a0",
        contentMarkdown: "Design Orama hybrid index #engineering",
        contentText: "Design Orama hybrid index #engineering",
        checked: false,
        collapsed: false,
        authorType: "human",
        authorId: null,
        sourceBindingId: null,
        priority: "p1",
        scheduledDate: "2026-11-25",
        dueDate: null,
        durationMin: null,
        recurrenceRule: null,
        completedAt: null,
        createdAt: "2026-11-25T08:00:00.000Z",
        updatedAt: "2026-11-25T08:00:00.000Z",
        deletedAt: null,
      },
      {
        id: childA,
        documentId: docId,
        parentNodeId: rootA,
        orderKey: "a0",
        contentMarkdown: "Benchmark CJK bigram tokenization latency.",
        contentText: "Benchmark CJK bigram tokenization latency.",
        checked: null,
        collapsed: false,
        authorType: "human",
        authorId: null,
        sourceBindingId: null,
        priority: "none",
        scheduledDate: null,
        dueDate: null,
        durationMin: null,
        recurrenceRule: null,
        completedAt: null,
        createdAt: "2026-11-25T08:01:00.000Z",
        updatedAt: "2026-11-25T08:01:00.000Z",
        deletedAt: null,
      },
      {
        id: rootB,
        documentId: docId,
        parentNodeId: null,
        orderKey: "a1",
        contentMarkdown: "Prepare weekly release notes #release",
        contentText: "Prepare weekly release notes #release",
        checked: false,
        collapsed: false,
        authorType: "human",
        authorId: null,
        sourceBindingId: null,
        priority: "p2",
        scheduledDate: "2026-11-25",
        dueDate: null,
        durationMin: null,
        recurrenceRule: null,
        completedAt: null,
        createdAt: "2026-11-25T09:00:00.000Z",
        updatedAt: "2026-11-25T09:00:00.000Z",
        deletedAt: null,
      },
    ];

    const chunks = chunkDocumentContent(
      {
        docId,
        title: "2026-11-25",
        kind: "outline",
        contentMarkdown: "",
        outlineNodes: nodes,
      },
      { minTokens: 120, maxTokens: 520 },
    );

    expect(chunks.some((c) => c.nodeId === rootA && c.contentText.includes("Benchmark CJK"))).toBe(
      true,
    );
    expect(chunks.some((c) => c.nodeId === rootB && c.contentText.includes("weekly release"))).toBe(
      true,
    );
  });

  test("assembleContextPack prioritizes pinned docs over recent docs and enforces BPE token budget", () => {
    const pinnedDoc = makeDoc({
      id: asDocumentId("doc_pinned"),
      title: "Pinned Constitution",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const recentDocA = makeDoc({
      id: asDocumentId("doc_recent_a"),
      title: "Recent Architecture Note",
      updatedAt: "2026-11-25T10:00:00.000Z",
    });
    const recentDocB = makeDoc({
      id: asDocumentId("doc_recent_b"),
      title: "Large Secondary Log",
      updatedAt: "2026-11-24T10:00:00.000Z",
    });

    const largeBody = Array.from(
      { length: 45 },
      (_, idx) => `Entry ${idx}: Detailed telemetry event and structured audit log verification block.`,
    ).join("\n");

    const pack: ContextPack = {
      id: asContextPackId("pack_core"),
      workspaceId: asWorkspaceId("ws_default"),
      slug: "core-architecture",
      name: "Core Architecture",
      description: "Important workspace references",
      rules: {
        pinnedDocIds: [pinnedDoc.id],
        excludeSystem: true,
      },
      maxTokens: 280,
      createdAt: "2026-11-25T00:00:00.000Z",
      updatedAt: "2026-11-25T00:00:00.000Z",
    };

    const rendered = assembleContextPack({
      pack,
      candidates: [
        { doc: recentDocA, bodyText: "Concise architecture summary paragraph.", explicitPinned: false },
        { doc: recentDocB, bodyText: largeBody, explicitPinned: false },
        { doc: pinnedDoc, bodyText: "Always enforce server-side TokenScope boundaries.", explicitPinned: true },
      ],
    });

    expect(rendered.uri).toBe("inkade://pack/core-architecture");
    expect(rendered.budgetTokens).toBe(280);
    expect(rendered.totalTokens).toBeLessThanOrEqual(280);
    expect(rendered.items[0]?.docId).toBe(pinnedDoc.id);
    expect(rendered.items[0]?.pinned).toBe(true);
    expect(rendered.truncated).toBe(true);
    expect(rendered.renderedMarkdown).toContain("Pinned Constitution");
    expect(truncateToTokenBudget("one two three four five six seven eight", 4).length).toBeGreaterThan(0);
  });

  test("buildHostConnectConfig formats Claude Code, Cursor, Codex, OpenCode, BB/Paseo, and HTTP URL", () => {
    const token = "ink_test_token_123";
    const baseUrl = "https://inkade.example.com/";

    const claude = buildHostConnectConfig({ host: "claude_code", baseUrl, token });
    expect(claude).toContain("claude mcp add --transport http inkade https://inkade.example.com/mcp");
    expect(claude).toContain(`Authorization: Bearer ${token}`);

    const cursor = JSON.parse(buildHostConnectConfig({ host: "cursor", baseUrl, token })) as {
      mcpServers: { inkade: { url: string; headers: { Authorization: string } } };
    };
    expect(cursor.mcpServers.inkade.url).toBe("https://inkade.example.com/mcp");
    expect(cursor.mcpServers.inkade.headers.Authorization).toBe(`Bearer ${token}`);

    const codex = buildHostConnectConfig({ host: "codex", baseUrl, token });
    expect(codex).toContain("[mcp_servers.inkade]");
    expect(codex).toContain('url = "https://inkade.example.com/mcp"');
    expect(codex).toContain(`Authorization = "Bearer ${token}"`);

    const opencode = JSON.parse(buildHostConnectConfig({ host: "opencode", baseUrl, token })) as {
      mcp: { inkade: { type: string; url: string } };
    };
    expect(opencode.mcp.inkade.type).toBe("remote");
    expect(opencode.mcp.inkade.url).toBe("https://inkade.example.com/mcp");

    const bb = JSON.parse(buildHostConnectConfig({ host: "bb_paseo", baseUrl, token })) as {
      mcpServers: { inkade: { type: string; url: string } };
    };
    expect(bb.mcpServers.inkade.type).toBe("http");

    expect(buildHostConnectConfig({ host: "http_url", baseUrl, token })).toBe(
      "https://inkade.example.com/mcp",
    );

    expect(CONNECT_HOST_KINDS).toContain("antigravity");
    expect(CONNECT_HOST_KINDS).toContain("copilot");
    expect(CONNECT_HOST_KINDS).toContain("pi");

    const antigravity = JSON.parse(
      buildHostConnectConfig({ host: "antigravity", baseUrl, token }),
    ) as { mcpServers: { inkade: { serverUrl: string; headers: { Authorization: string } } } };
    expect(antigravity.mcpServers.inkade.serverUrl).toBe("https://inkade.example.com/mcp");
    expect(antigravity.mcpServers.inkade.headers.Authorization).toBe(`Bearer ${token}`);

    const copilot = JSON.parse(buildHostConnectConfig({ host: "copilot", baseUrl, token })) as {
      mcpServers: { inkade: { type: string; url: string } };
    };
    expect(copilot.mcpServers.inkade.type).toBe("http");
    expect(copilot.mcpServers.inkade.url).toBe("https://inkade.example.com/mcp");

    const pi = JSON.parse(buildHostConnectConfig({ host: "pi", baseUrl, token })) as {
      mcpServers: { inkade: { type: string; url: string } };
    };
    expect(pi.mcpServers.inkade.type).toBe("http");
    expect(pi.mcpServers.inkade.url).toBe("https://inkade.example.com/mcp");

    expect(connectHostToHarnessName("claude_code")).toBe("claude-code");
    expect(connectHostToHarnessName("antigravity")).toBe("antigravity");
    expect(connectHostToHarnessName("copilot")).toBe("copilot");
    expect(connectHostToHarnessName("pi")).toBe("pi");
    expect(connectHostToHarnessName("bb_paseo")).toBe("any");
  });

  test("chunkDocumentContent keeps table cells space-separated and excludes titles, #tags, and inkade-view blocks from chunk snippets", () => {
    const markdown = [
      "# Execution Metrics",
      "",
      "| Metric | Q3 Target | Owner |",
      "| :--- | :--- | :--- |",
      "| Latency | 42ms | Core |",
      "",
      "```inkade-view",
      "mode: table",
      "space: spc_research",
      "```",
      "",
      "Final rollout stays within SLA targets.",
    ].join("\n");

    const chunks = chunkDocumentContent({
      title: "Quarterly Ops Spec",
      kind: "article",
      contentMarkdown: markdown,
      tags: ["ops", "benchmark"],
    });

    expect(chunks.length).toBeGreaterThanOrEqual(1);
    const snippet = chunks.map((c) => c.snippet ?? "").join(" ");
    expect(snippet).toContain("Metric Q3 Target Owner");
    expect(snippet).toContain("Latency 42ms Core");
    expect(snippet).not.toContain("MetricQ3");
    expect(snippet).not.toContain("mode: table");
    expect(snippet).not.toContain("Quarterly Ops Spec");
    expect(snippet).not.toContain("#ops");

    const emptyChunks = chunkDocumentContent({
      title: "Empty Note Title",
      kind: "article",
      contentMarkdown: "",
      tags: ["empty"],
    });
    expect(emptyChunks.every((c) => (c.snippet ?? "") === "")).toBe(true);
  });
});
