import { describe, expect, test } from "bun:test";
import { asOutlineNodeId } from "@inkade/core";
import {
  createSqliteDatabase,
  createSqliteRepositories,
  DEFAULT_SPACE_IDS,
  seedDefaultWorkspace,
} from "./index.ts";

describe("Phase 45 Digital Garden public_sites and Workspace Graph DB queries", () => {
  test("runs 0007_v6_phase45_garden migration and supports public_sites CRUD with unique slug enforcement", async () => {
    const { sqlite, db } = createSqliteDatabase(":memory:");
    try {
      const repos = createSqliteRepositories(sqlite, db);
      const { workspace } = await seedDefaultWorkspace(repos, { dailyDate: "2026-11-25" });

      const created = await repos.space.createPublicSite(workspace.id, {
        slug: "research-garden",
        title: "Research Garden",
        subtitle: "Public field notes",
        sourceType: "space",
        sourceId: DEFAULT_SPACE_IDS.research,
        exposedFields: ["status", "category"],
        enableRss: true,
        enabled: true,
      });

      expect(created.id.startsWith("site_")).toBe(true);
      expect(created.slug).toBe("research-garden");
      expect(created.exposedFields).toEqual(["status", "category"]);

      let duplicateRejected = false;
      try {
        await repos.space.createPublicSite(workspace.id, {
          slug: "research-garden",
          title: "Duplicate Slug",
          subtitle: "",
          sourceType: "space",
          sourceId: DEFAULT_SPACE_IDS.research,
          exposedFields: [],
          enableRss: false,
          enabled: true,
        });
      } catch {
        duplicateRejected = true;
      }
      expect(duplicateRejected).toBe(true);

      const bySlug = await repos.space.getPublicSiteBySlug("research-garden");
      expect(bySlug?.id).toBe(created.id);

      const updated = await repos.space.updatePublicSite(workspace.id, created.id, {
        title: "Updated Garden",
        enabled: false,
        exposedFields: ["status"],
      });
      expect(updated.title).toBe("Updated Garden");
      expect(updated.enabled).toBe(false);
      expect(updated.exposedFields).toEqual(["status"]);

      const listed = await repos.space.listPublicSites(workspace.id);
      expect(listed).toHaveLength(1);

      await repos.space.deletePublicSite(workspace.id, created.id);
      expect(await repos.space.getPublicSiteById(workspace.id, created.id)).toBeNull();
    } finally {
      sqlite.close();
    }
  });

  test("lists resolved explicit document links and cross-document mirror node pairs", async () => {
    const { sqlite, db } = createSqliteDatabase(":memory:");
    try {
      const repos = createSqliteRepositories(sqlite, db);
      const { workspace } = await seedDefaultWorkspace(repos, { dailyDate: "2026-11-25" });

      const docA = await repos.document.createDocument(workspace.id, {
        spaceId: DEFAULT_SPACE_IDS.research,
        kind: "article",
        title: "Alpha Note",
        contentMarkdown: "Links to [[Beta Note]].",
        tags: ["graph"],
        pinned: false,
      });
      const docB = await repos.document.createDocument(workspace.id, {
        spaceId: DEFAULT_SPACE_IDS.research,
        kind: "outline",
        title: "Beta Note",
        contentMarkdown: "",
        tags: ["graph"],
        pinned: false,
      });
      await repos.revisionLink.syncOutgoingLinks(workspace.id, docA.id, null, docA.contentMarkdown);

      const sourceNode = await repos.outline.createOutlineNode(workspace.id, {
        documentId: docB.id,
        contentMarkdown: "Canonical node",
      });

      const docC = await repos.document.createDocument(workspace.id, {
        spaceId: DEFAULT_SPACE_IDS.inbox,
        kind: "outline",
        title: "Gamma Outline",
        contentMarkdown: "",
        tags: [],
        pinned: false,
      });
      await repos.outline.createOutlineNode(workspace.id, {
        documentId: docC.id,
        contentMarkdown: "Mirror of canonical node",
        mirrorOfNodeId: asOutlineNodeId(sourceNode.id),
      });

      const explicitLinks = await repos.revisionLink.listWorkspaceDocumentLinks(workspace.id);
      expect(explicitLinks).toEqual([
        {
          sourceDocumentId: docA.id,
          targetDocumentId: docB.id,
        },
      ]);

      const mirrorPairs = await repos.outline.listWorkspaceMirrorNodePairs(workspace.id);
      expect(mirrorPairs).toEqual([
        {
          mirrorDocumentId: docC.id,
          targetDocumentId: docB.id,
          mirrorOfNodeId: sourceNode.id,
        },
      ]);
    } finally {
      sqlite.close();
    }
  });
});
