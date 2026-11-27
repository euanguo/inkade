import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync, strFromU8 } from "fflate";
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
  const tempDir = mkdtempSync(join(tmpdir(), "inkade-phase45-test-"));
  const instance = createInkadeApp({
    dbPath: join(tempDir, "inkade.db"),
    dataDir: tempDir,
    localAutoAuth: true,
    authSecret: "test-secret-key-for-inkade-phase45-suite-32bytes",
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

describe("Phase 45 — Workspace WebGL Knowledge Graph & Digital Garden Publishing", () => {
  test("builds workspace graph with explicit/mirror/semantic edges, enforces TokenScope, and links targets cleanly", async () => {
    const { baseUrl, instance } = await startTestServer();
    const adminSdk = createInkadeClient({ baseUrl });

    // Seed related Research documents + Outline mirror + Secret Inbox doc + System/Trashed docs
    const docAnchor = await adminSdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.research,
      kind: "article",
      title: "WebGL Graph Architecture",
      tags: ["graph", "public"],
      contentMarkdown:
        "# Graph Architecture\n\nWebGL force atlas layout clustering algorithms for large knowledge graphs.\n\nLinks to [[Outline Topic Hub]].",
    });
    const docSemanticPeer = await adminSdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.research,
      kind: "article",
      title: "WebGL Graph Clustering Notes",
      tags: ["graph", "public"],
      contentMarkdown:
        "# Clustering\n\nWebGL force atlas layout clustering algorithms optimize edge rendering latency.",
    });
    const docOutlineHub = await adminSdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.research,
      kind: "outline",
      title: "Outline Topic Hub",
      tags: ["hub"],
    });
    const sourceNode = await adminSdk.outlineNodes.create({
      documentId: docOutlineHub.id,
      parentNodeId: null,
      contentMarkdown: "Canonical hub node for graph research",
    });

    const docMirrorHost = await adminSdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.projects,
      kind: "outline",
      title: "Projects Execution Board",
      tags: ["ops"],
    });
    await adminSdk.outlineNodes.create({
      documentId: docMirrorHost.id,
      parentNodeId: null,
      contentMarkdown: "Mirrored canonical node",
      mirrorOfNodeId: sourceNode.id,
    });

    const docSecretInbox = await adminSdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.inbox,
      kind: "article",
      title: "Private Executive Strategy",
      tags: ["confidential"],
      contentMarkdown:
        "Confidential roadmap linking to [[WebGL Graph Architecture]].",
    });

    const docTrashed = await adminSdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.research,
      kind: "article",
      title: "Archived Old Graph Draft",
      contentMarkdown: "This trashed draft should never appear in workspace graph.",
    });
    await adminSdk.documents.delete(docTrashed.id);

    const docSystem = await instance.repos.document.createDocument(
      docAnchor.workspaceId,
      {
        spaceId: DEFAULT_SPACE_IDS.research,
        kind: "article",
        title: "Internal Tasks Inbox Store",
        contentMarkdown: "System internal document hidden from graph",
        properties: { systemRole: "tasks_inbox" },
      },
      { actorType: "system" },
    );

    const fullGraph = await adminSdk.workspace.graph({
      semanticThreshold: 0.2,
    });

    const nodeIds = new Set(fullGraph.nodes.map((n) => n.id));
    expect(nodeIds.has(docAnchor.id)).toBe(true);
    expect(nodeIds.has(docSemanticPeer.id)).toBe(true);
    expect(nodeIds.has(docOutlineHub.id)).toBe(true);
    expect(nodeIds.has(docMirrorHost.id)).toBe(true);
    expect(nodeIds.has(docSecretInbox.id)).toBe(true);
    expect(nodeIds.has(docTrashed.id)).toBe(false);
    expect(nodeIds.has(docSystem.id)).toBe(false);

    expect(
      fullGraph.edges.some(
        (e) =>
          e.kind === "explicit" &&
          ((e.source === docAnchor.id && e.target === docOutlineHub.id) ||
            (e.source === docOutlineHub.id && e.target === docAnchor.id)),
      ),
    ).toBe(true);
    expect(
      fullGraph.edges.some(
        (e) =>
          e.kind === "mirror" &&
          ((e.source === docOutlineHub.id && e.target === docMirrorHost.id) ||
            (e.source === docMirrorHost.id && e.target === docOutlineHub.id)),
      ),
    ).toBe(true);
    expect(
      fullGraph.edges.some(
        (e) =>
          e.kind === "semantic" &&
          ((e.source === docAnchor.id && e.target === docSemanticPeer.id) ||
            (e.source === docSemanticPeer.id && e.target === docAnchor.id)),
      ),
    ).toBe(true);

    // Filter by space & disable semantic edges
    const filteredGraph = await adminSdk.workspace.graph({
      spaceId: DEFAULT_SPACE_IDS.research,
      kind: "article",
      tag: "graph",
      includeSemantic: false,
    });
    expect(filteredGraph.edges.some((e) => e.kind === "semantic")).toBe(false);
    expect(filteredGraph.nodes.every((n) => n.kind === "article")).toBe(true);

    // Scoped Research token never sees Inbox secrets or edges pointing into Inbox
    const researchToken = await adminSdk.tokens.create({
      name: "graph-research-scope",
      scope: {
        permission: "write",
        spaceIds: [DEFAULT_SPACE_IDS.research],
        includeDescendants: true,
        denyHardDelete: true,
      },
    });
    const researchSdk = createInkadeClient({ baseUrl, token: researchToken.rawToken });

    const scopedGraph = await researchSdk.workspace.graph({ semanticThreshold: 0.2 });
    const scopedNodeIds = new Set(scopedGraph.nodes.map((n) => n.id));
    expect(scopedNodeIds.has(docSecretInbox.id)).toBe(false);
    expect(scopedNodeIds.has(docMirrorHost.id)).toBe(false);
    expect(
      scopedGraph.edges.every(
        (e) => scopedNodeIds.has(e.source) && scopedNodeIds.has(e.target),
      ),
    ).toBe(true);

    // One-click linkTarget works on both article and outline docs
    const linkArticleRes = await researchSdk.documents.linkTarget(
      docAnchor.id,
      docSemanticPeer.id,
    );
    expect(linkArticleRes.linked).toBe(true);
    expect(linkArticleRes.alreadyLinked).toBe(false);
    expect(linkArticleRes.createdNodeId).toBeNull();
    expect(linkArticleRes.document.contentMarkdown).toContain(
      "[[WebGL Graph Clustering Notes]]",
    );

    const repeatLinkRes = await researchSdk.documents.linkTarget(
      docAnchor.id,
      docSemanticPeer.id,
    );
    expect(repeatLinkRes.alreadyLinked).toBe(true);

    const linkOutlineRes = await researchSdk.documents.linkTarget(
      docOutlineHub.id,
      docSemanticPeer.id,
    );
    expect(linkOutlineRes.linked).toBe(true);
    expect(linkOutlineRes.createdNodeId).not.toBeNull();
    const outlineNodesAfter = await researchSdk.outlineNodes.list(docOutlineHub.id);
    expect(outlineNodesAfter.some((n) => n.id === sourceNode.id)).toBe(true);
    expect(
      outlineNodesAfter.some((n) => n.contentMarkdown.includes("[[WebGL Graph Clustering Notes]]")),
    ).toBe(true);

    // Self-linking or cross-scope linking is rejected by server
    let selfLinkFailed = false;
    try {
      await researchSdk.documents.linkTarget(docAnchor.id, docAnchor.id);
    } catch {
      selfLinkFailed = true;
    }
    expect(selfLinkFailed).toBe(true);

    let crossScopeLinkFailed = false;
    try {
      await researchSdk.documents.linkTarget(docAnchor.id, docSecretInbox.id);
    } catch {
      crossScopeLinkFailed = true;
    }
    expect(crossScopeLinkFailed).toBe(true);
  });

  test("publishes Space & SavedView Digital Gardens with strict guest isolation, RSS/Atom feeds, and static ZIP export", async () => {
    const { baseUrl, instance } = await startTestServer();
    const adminSdk = createInkadeClient({ baseUrl });

    const subSpace = await adminSdk.spaces.create({
      parentId: DEFAULT_SPACE_IDS.research,
      name: "Published Field Essays",
    });

    await adminSdk.spaces.upsertSchema(DEFAULT_SPACE_IDS.research, {
      fields: [
        {
          key: "status",
          label: "Status",
          type: "select",
          options: [{ value: "published", label: "Published", color: "emerald" }],
          showInTable: true,
          showInCard: true,
          requiredByAgent: false,
        },
        {
          key: "secretNotes",
          label: "Internal Editorial Notes",
          type: "text",
          options: [],
          showInTable: false,
          showInCard: false,
          requiredByAgent: false,
        },
      ],
    });

    const publicArticle = await adminSdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.research,
      kind: "article",
      title: "Local First Garden Essay",
      tags: ["garden", "essay"],
      properties: {
        status: "published",
        secretNotes: "SECRET_INTERNAL_PROP_VALUE",
        _internalToken: "hidden-underscore",
      },
      contentMarkdown: [
        "---",
        "frontmatterSecret: TOP_SECRET_FRONTMATTER",
        "---",
        "# Public Essay",
        "",
        "Cross reference to [[Subspace Outline Notes]] and private [[Executive Compensation Plan]].",
        "",
        "```ts",
        "export const gardenReady = true;",
        "```",
        "",
        "```inkade-view",
        '{"mode":"table"}',
        "```",
      ].join("\n"),
    });

    const publicSubOutline = await adminSdk.documents.create({
      spaceId: subSpace.id,
      kind: "outline",
      title: "Subspace Outline Notes",
      tags: ["garden"],
    });
    await adminSdk.outlineNodes.create({
      documentId: publicSubOutline.id,
      parentNodeId: null,
      contentMarkdown: "Points back to [[Local First Garden Essay]]",
    });

    // Private Inbox note referencing publicArticle + trashed & system docs must NEVER leak to guests
    const privateInboxDoc = await adminSdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.inbox,
      kind: "article",
      title: "Executive Compensation Plan",
      tags: ["private"],
      contentMarkdown: "CONFIDENTIAL_PAYROLL_LEAK linking [[Local First Garden Essay]].",
    });

    const trashedResearch = await adminSdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.research,
      kind: "article",
      title: "Deleted Garden Draft",
      contentMarkdown: "TRASHED_DRAFT_SHOULD_NOT_APPEAR",
    });
    await adminSdk.documents.delete(trashedResearch.id);

    const systemDoc = await instance.repos.document.createDocument(
      publicArticle.workspaceId,
      {
        spaceId: DEFAULT_SPACE_IDS.research,
        kind: "article",
        title: "System Backing Doc",
        contentMarkdown: "SYSTEM_ROLE_SHOULD_NOT_APPEAR",
        properties: { systemRole: "tasks_inbox" },
      },
      { actorType: "system" },
    );

    // Non-admin scoped token cannot manage public_sites
    const scopedToken = await adminSdk.tokens.create({
      name: "non-admin-writer",
      scope: {
        permission: "write",
        spaceIds: [DEFAULT_SPACE_IDS.research],
        includeDescendants: true,
        denyHardDelete: true,
      },
    });
    const scopedSdk = createInkadeClient({ baseUrl, token: scopedToken.rawToken });
    let scopedCreateDenied = false;
    try {
      await scopedSdk.publicSites.create({
        title: "Unauthorized Site",
        sourceType: "space",
        sourceId: DEFAULT_SPACE_IDS.research,
      });
    } catch {
      scopedCreateDenied = true;
    }
    expect(scopedCreateDenied).toBe(true);

    // Admin creates Space Digital Garden with exposedFields allowlist ["status"]
    const site = await adminSdk.publicSites.create({
      slug: "research-notes",
      title: "Research Field Notes",
      subtitle: "Selected public essays and outlines",
      sourceType: "space",
      sourceId: DEFAULT_SPACE_IDS.research,
      exposedFields: ["status", "_internalToken", "systemRole"],
      enableRss: true,
      enabled: true,
    });
    expect(site.slug).toBe("research-notes");
    expect(site.exposedFields).toEqual(["status"]);

    // Unauthenticated guest access works without Bearer token & strictly isolates content
    const publicSiteRes = await fetch(`${baseUrl}/api/v1/public/sites/research-notes`);
    expect(publicSiteRes.status).toBe(200);
    const publicPayloadText = await publicSiteRes.text();
    expect(publicPayloadText).not.toContain("SECRET_INTERNAL_PROP_VALUE");
    expect(publicPayloadText).not.toContain("TOP_SECRET_FRONTMATTER");
    expect(publicPayloadText).not.toContain("CONFIDENTIAL_PAYROLL_LEAK");
    expect(publicPayloadText).not.toContain("TRASHED_DRAFT_SHOULD_NOT_APPEAR");
    expect(publicPayloadText).not.toContain("SYSTEM_ROLE_SHOULD_NOT_APPEAR");
    expect(publicPayloadText).not.toContain("Deleted Garden Draft");
    expect(publicPayloadText).not.toContain("System Backing Doc");

    const guestSdk = createInkadeClient({ baseUrl: baseUrl });
    const siteData = await guestSdk.publicSites.getPublic("research-notes");
    const publishedIds = new Set(siteData.documents.map((d) => d.id));
    expect(publishedIds.has(publicArticle.id)).toBe(true);
    expect(publishedIds.has(publicSubOutline.id)).toBe(true);
    expect(publishedIds.has(privateInboxDoc.id)).toBe(false);
    expect(publishedIds.has(trashedResearch.id)).toBe(false);
    expect(publishedIds.has(systemDoc.id)).toBe(false);
    expect(siteData.spaces.some((s) => s.id === subSpace.id)).toBe(true);

    const docDetailPayload = await guestSdk.publicSites.getPublicDoc(
      "research-notes",
      publicArticle.slug,
    );

    expect(docDetailPayload.document.properties).toEqual({ status: "published" });
    expect(docDetailPayload.document.contentMarkdown).not.toContain("TOP_SECRET_FRONTMATTER");
    expect(docDetailPayload.document.backlinks.map((b) => b.id)).toEqual([publicSubOutline.id]);

    // Embedded ```inkade-view``` inside guest doc only sees garden-scoped docs
    const viewSnapshots = Object.values(docDetailPayload.document.embeddedViews ?? {});
    expect(viewSnapshots.length).toBeGreaterThanOrEqual(1);
    const snapshotIds = new Set(viewSnapshots[0]!.documents.map((d) => d.id));
    expect(snapshotIds.has(publicArticle.id)).toBe(true);
    expect(snapshotIds.has(publicSubOutline.id)).toBe(true);
    expect(snapshotIds.has(privateInboxDoc.id)).toBe(false);
    expect(snapshotIds.has(trashedResearch.id)).toBe(false);
    expect(snapshotIds.has(systemDoc.id)).toBe(false);

    // RSS 2.0 and Atom feeds work unauthenticated via `feed`
    const rssRes = await fetch(`${baseUrl}/api/v1/public/sites/research-notes/feed.xml`);
    expect(rssRes.status).toBe(200);
    expect(rssRes.headers.get("content-type")).toContain("application/rss+xml");
    const rssXml = await rssRes.text();
    expect(rssXml).toContain("<rss");
    expect(rssXml).toContain("Research Field Notes");
    expect(rssXml).toContain("Local First Garden Essay");
    expect(rssXml).not.toContain("CONFIDENTIAL_PAYROLL_LEAK");

    const atomRes = await fetch(`${baseUrl}/api/v1/public/sites/research-notes/feed.xml?format=atom`);
    expect(atomRes.status).toBe(200);
    expect(atomRes.headers.get("content-type")).toContain("application/atom+xml");
    const atomXml = await atomRes.text();
    expect(atomXml).toContain("<feed");

    // Static HTML + Shiki CSS ZIP export contains clean offline pages
    const zipBytes = await adminSdk.publicSites.exportZip(site.id);
    const archive = unzipSync(zipBytes);
    expect(archive["index.html"]).toBeDefined();
    expect(archive["styles.css"]).toBeDefined();
    expect(archive["feed.xml"]).toBeDefined();
    expect(archive[`${publicArticle.slug}.html`]).toBeDefined();
    expect(archive[`${publicSubOutline.slug}.html`]).toBeDefined();

    const exportedDocHtml = strFromU8(archive[`${publicArticle.slug}.html`]!);
    expect(exportedDocHtml).toContain("shiki");
    expect(exportedDocHtml).toContain("gardenReady");
    expect(exportedDocHtml).toContain("Local First Garden Essay");
    expect(exportedDocHtml).not.toContain("TOP_SECRET_FRONTMATTER");
    expect(exportedDocHtml).not.toContain("SECRET_INTERNAL_PROP_VALUE");
    expect(exportedDocHtml).not.toContain("CONFIDENTIAL_PAYROLL_LEAK");

    // SavedView-backed Digital Garden filters precisely by SavedView query
    const essayView = await adminSdk.savedViews.create({
      name: "Essays Only",
      displayMode: "table",
      filter: { tag: "essay" },
    });
    const viewSite = await adminSdk.publicSites.create({
      slug: "essays-view",
      title: "Essays Stream",
      subtitle: "",
      sourceType: "saved_view",
      sourceId: essayView.id,
      exposedFields: ["status"],
      enableRss: false,
      enabled: true,
    });
    const viewSiteRes = await fetch(`${baseUrl}/api/v1/public/sites/essays-view`);
    expect(viewSiteRes.status).toBe(200);
    const viewSiteJson = (await viewSiteRes.json()) as {
      documents: Array<{ id: string }>;
    };
    expect(viewSiteJson.documents.map((d) => d.id)).toEqual([publicArticle.id]);

    // Disabled RSS returns 404
    const disabledFeedRes = await fetch(`${baseUrl}/api/v1/public/sites/essays-view/feed.xml`);
    expect(disabledFeedRes.status).toBe(404);

    // Pausing public site immediately blocks public routes
    await adminSdk.publicSites.update(site.id, { enabled: false });
    const pausedRes = await fetch(`${baseUrl}/api/v1/public/sites/research-notes`);
    expect(pausedRes.status).toBe(404);

    // Deleting sites cleans up
    await adminSdk.publicSites.delete(site.id);
    await adminSdk.publicSites.delete(viewSite.id);
    const sitesRemaining = await adminSdk.publicSites.list();
    expect(sitesRemaining).toHaveLength(0);
  });
});
