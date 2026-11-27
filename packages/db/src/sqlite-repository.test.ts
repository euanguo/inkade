import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  asAgentStepId,
  asApiTokenId,
  asApprovalId,
  asDocumentId,
  asSteeringNoteId,
  computeRevisionDiff,
  InkadeError,
  patchMarkdownSection,
} from "@inkade/core";
import {
  createSqliteDatabase,
  createSqliteRepositories,
  DEFAULT_SPACE_IDS,
  seedDefaultWorkspace,
} from "./index.ts";

function setupMemoryRepos() {
  const { sqlite, db } = createSqliteDatabase(":memory:");
  const repos = createSqliteRepositories(sqlite, db);
  return { sqlite, db, repos };
}

describe("Narrow SQLite Repositories", () => {
  test("enables WAL mode on disk database and enforces idempotent seeding", async () => {
    const dir = mkdtempSync(join(tmpdir(), "inkade-db-test-"));
    const dbFile = join(dir, "inkade.sqlite");
    const { sqlite, db } = createSqliteDatabase(dbFile);
    try {
      const mode = sqlite.query<{ journal_mode: string }, []>("PRAGMA journal_mode;").get();
      expect(mode?.journal_mode.toLowerCase()).toBe("wal");

      const repos = createSqliteRepositories(sqlite, db);
      const first = await seedDefaultWorkspace(repos, { dailyDate: "2026-11-24" });
      expect(first.seeded).toBe(true);

      const second = await seedDefaultWorkspace(repos, { dailyDate: "2026-11-24" });
      expect(second.seeded).toBe(false);

      const spaces = await repos.space.listSpaces(first.workspace.id);
      expect(spaces.map((s) => s.id)).toEqual([
        DEFAULT_SPACE_IDS.daily,
        DEFAULT_SPACE_IDS.inbox,
        DEFAULT_SPACE_IDS.research,
        DEFAULT_SPACE_IDS.projects,
      ]);

      const daily = await repos.document.getOrCreateDailyOutline(
        first.workspace.id,
        DEFAULT_SPACE_IDS.daily,
        "2026-11-24",
      );
      expect(daily.created).toBe(false);

      const welcome = await repos.document.getDocumentBySlug(
        first.workspace.id,
        "welcome-to-inkade",
      );
      expect(welcome).not.toBeNull();
      expect(welcome?.pinned).toBe(true);
    } finally {
      sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("rejects cycles when reparenting spaces and supports archiving", async () => {
    const { sqlite, repos } = setupMemoryRepos();
    try {
      const { workspace } = await seedDefaultWorkspace(repos, { dailyDate: "2026-11-24" });
      const child = await repos.space.createSpace(workspace.id, {
        parentId: DEFAULT_SPACE_IDS.research,
        name: "AI Agents",
      });
      const grandChild = await repos.space.createSpace(workspace.id, {
        parentId: child.id,
        name: "ADE Frameworks",
      });

      let cycleRejected = false;
      let cycleErr: unknown;
      try {
        await repos.space.updateSpace(workspace.id, DEFAULT_SPACE_IDS.research, {
          parentId: grandChild.id,
        });
      } catch (err) {
        cycleRejected = true;
        cycleErr = err;
      }
      expect(cycleRejected).toBe(true);
      expect(cycleErr).toMatchObject({ code: "INVALID_PARENT_CYCLE" });

      const archived = await repos.space.archiveSpace(workspace.id, grandChild.id);
      expect(archived.archivedAt).not.toBeNull();

      const activeSpaces = await repos.space.listSpaces(workspace.id);
      expect(activeSpaces.some((s) => s.id === grandChild.id)).toBe(false);
    } finally {
      sqlite.close();
    }
  });

  test("manages outline nodes, fractional ordering, cycle detection, soft-delete subtree, and preserves ADE bindings", async () => {
    const { sqlite, repos } = setupMemoryRepos();
    try {
      const { workspace } = await seedDefaultWorkspace(repos, { dailyDate: "2026-11-24" });
      const { document: daily } = await repos.document.getOrCreateDailyOutline(
        workspace.id,
        DEFAULT_SPACE_IDS.daily,
        "2026-11-24",
      );

      const n1 = await repos.outline.createOutlineNode(workspace.id, {
        documentId: daily.id,
        parentNodeId: null,
        contentMarkdown: "Investigate Hono MCP streaming",
        checked: false,
        collapsed: false,
        authorType: "human",
      });
      const n2 = await repos.outline.createOutlineNode(workspace.id, {
        documentId: daily.id,
        parentNodeId: null,
        contentMarkdown: "Review cosscom/ui Base UI components",
        checked: false,
        collapsed: false,
        authorType: "human",
      });
      const n1Child = await repos.outline.createOutlineNode(workspace.id, {
        documentId: daily.id,
        parentNodeId: n1.id,
        contentMarkdown: "Check Streamable HTTP auth hook",
        checked: null,
        collapsed: false,
        authorType: "agent",
      });

      const resolvedDocId = await repos.outline.findDocumentIdByNodeId(workspace.id, n1.id);
      expect(resolvedDocId).toBe(daily.id);

      const binding = await repos.threadBinding.upsertThreadBinding(workspace.id, {
        documentId: daily.id,
        nodeId: n1.id,
        adeKind: "bb",
        externalThreadId: "thr_hono_123",
        title: "Hono MCP streaming investigation",
        status: "running",
        unreadResult: false,
      });

      const moved = await repos.outline.moveOutlineNode(workspace.id, daily.id, n1.id, {
        parentNodeId: n2.id,
      });
      expect(moved.id).toBe(n1.id);
      expect(moved.parentNodeId).toBe(n2.id);

      const bindingsForNode = await repos.threadBinding.listThreadBindings(workspace.id, {
        nodeId: n1.id,
      });
      expect(bindingsForNode).toHaveLength(1);
      expect(bindingsForNode[0]?.id).toBe(binding.id);

      let moveCycleRejected = false;
      let moveCycleErr: unknown;
      try {
        await repos.outline.moveOutlineNode(workspace.id, daily.id, n2.id, {
          parentNodeId: n1Child.id,
        });
      } catch (err) {
        moveCycleRejected = true;
        moveCycleErr = err;
      }
      expect(moveCycleRejected).toBe(true);
      expect(moveCycleErr).toMatchObject({ code: "INVALID_PARENT_CYCLE" });

      const n2LastChild = await repos.outline.createOutlineNode(workspace.id, {
        documentId: daily.id,
        parentNodeId: n2.id,
        contentMarkdown: "Last child",
        checked: null,
        collapsed: false,
        authorType: "human",
      });
      const n2MiddleChild = await repos.outline.createOutlineNode(workspace.id, {
        documentId: daily.id,
        parentNodeId: n2.id,
        afterNodeId: n1.id,
        beforeNodeId: n2LastChild.id,
        contentMarkdown: "Middle child",
        checked: null,
        collapsed: false,
        authorType: "human",
      });

      const n2Children = (await repos.outline.listOutlineNodes(daily.id)).filter(
        (node) => node.parentNodeId === n2.id,
      );
      expect(n2Children.map((node) => node.id)).toEqual([
        n1.id,
        n2MiddleChild.id,
        n2LastChild.id,
      ]);

      const deleted = await repos.outline.softDeleteOutlineNode(workspace.id, daily.id, n2.id);
      expect(deleted.map((d) => d.id)).toContain(n1Child.id);
      expect(deleted.map((d) => d.id)).toContain(n2.id);

      const hitsAfterDelete = await repos.searchConfig.searchFts(workspace.id, "Streamable");
      expect(hitsAfterDelete).toHaveLength(0);
    } finally {
      sqlite.close();
    }
  });

  test("enforces optimistic locking, stores revisions, resolves forward/backward wikilinks, and runs safe FTS5 search", async () => {
    const { sqlite, repos } = setupMemoryRepos();
    try {
      const { workspace } = await seedDefaultWorkspace(repos, { dailyDate: "2026-11-24" });
      const { document: daily } = await repos.document.getOrCreateDailyOutline(
        workspace.id,
        DEFAULT_SPACE_IDS.daily,
        "2026-11-24",
      );

      const refNode = await repos.outline.createOutlineNode(workspace.id, {
        documentId: daily.id,
        parentNodeId: null,
        contentMarkdown: "See [[MCP Security Model]] for details on C++ / foo-bar parsing.",
        checked: null,
        collapsed: false,
        authorType: "human",
      });

      const article = await repos.document.createDocument(
        workspace.id,
        {
          spaceId: DEFAULT_SPACE_IDS.research,
          kind: "article",
          title: "MCP Security Model",
          contentMarkdown: "# MCP Security Model\n\n## Overview\n\nInitial overview.\n",
          tags: ["security", "mcp"],
          pinned: false,
        },
        { actorType: "agent", actorId: "tok_agent_1", changeSummary: "Agent initial draft" },
      );

      expect(article.unreadAgentUpdate).toBe(true);
      expect(article.version).toBe(1);

      const backlinks = await repos.revisionLink.listBacklinks(workspace.id, article.id);
      expect(backlinks).toHaveLength(1);
      expect(backlinks[0]?.sourceDocumentId).toBe(daily.id);
      expect(backlinks[0]?.sourceNodeId).toBe(refNode.id);

      const patchedMarkdown = patchMarkdownSection(
        article.contentMarkdown,
        "Overview",
        "append",
        "Server enforces token scopes for REST and /mcp.",
      );
      const updated = await repos.document.updateDocument(
        workspace.id,
        article.id,
        {
          contentMarkdown: patchedMarkdown,
          expectedVersion: 1,
          changeSummary: "Added enforcement guarantee",
        },
        { actorType: "agent", actorId: "tok_agent_1" },
      );
      expect(updated.version).toBe(2);

      let versionRejected = false;
      try {
        await repos.document.updateDocument(workspace.id, article.id, {
          contentMarkdown: "stale write",
          expectedVersion: 1,
        });
      } catch (err) {
        versionRejected = err instanceof InkadeError && err.code === "VERSION_CONFLICT";
      }
      expect(versionRejected).toBe(true);

      const revisions = await repos.revisionLink.listRevisions(article.id);
      expect(revisions.map((r) => r.version)).toEqual([2, 1]);
      const diff = computeRevisionDiff(
        revisions[1]?.contentMarkdown ?? "",
        revisions[0]?.contentMarkdown ?? "",
      );
      expect(diff.additions).toBeGreaterThan(0);

      const acked = await repos.document.markDocumentAgentUpdateRead(workspace.id, article.id);
      expect(acked.unreadAgentUpdate).toBe(false);

      const searchHits = await repos.searchConfig.searchFts(workspace.id, 'C++ "foo-bar"');
      expect(searchHits.some((h) => h.nodeId === refNode.id)).toBe(true);

      const filteredHits = await repos.searchConfig.searchFts(workspace.id, "enforces", {
        spaceIds: [DEFAULT_SPACE_IDS.research],
        kind: "article",
      });
      expect(filteredHits.some((h) => h.documentId === article.id)).toBe(true);

      await repos.document.trashDocument(workspace.id, article.id);
      expect(await repos.searchConfig.searchFts(workspace.id, "enforces")).toHaveLength(0);

      await repos.document.restoreDocument(workspace.id, article.id);
      expect((await repos.searchConfig.searchFts(workspace.id, "enforces")).length).toBeGreaterThan(
        0,
      );
    } finally {
      sqlite.close();
    }
  });

  test("supports API tokens, selection-anchored bindings, scope rules, audit logs, buckets, AI settings, and user preferences", async () => {
    const { sqlite, repos } = setupMemoryRepos();
    try {
      const { workspace } = await seedDefaultWorkspace(repos, { dailyDate: "2026-11-24" });
      const ts = "2026-11-24T00:00:00.000Z";
      const article = await repos.document.createDocument(workspace.id, {
        spaceId: DEFAULT_SPACE_IDS.research,
        kind: "article",
        title: "UI Design Notes",
        contentMarkdown: "# UI Design Notes\n\nAdopt cosscom/ui Base UI components.\n",
        tags: ["ui"],
        pinned: false,
      });

      const createdToken = await repos.tokenRule.createApiToken(workspace.id, {
        name: "BB Agent Token",
        tokenHash: "sha256_demo_hash",
        tokenPrefix: "ink_demo",
        scope: {
          permission: "read",
          spaceIds: [DEFAULT_SPACE_IDS.research],
          includeDescendants: true,
          denyHardDelete: true,
        },
      });
      expect(createdToken.scope.permission).toBe("read");

      const updatedToken = await repos.tokenRule.updateApiToken(workspace.id, createdToken.id, {
        scope: {
          permission: "write",
          spaceIds: [DEFAULT_SPACE_IDS.research, DEFAULT_SPACE_IDS.daily],
          includeDescendants: true,
          denyHardDelete: true,
        },
      });
      expect(updatedToken.scope.permission).toBe("write");
      const foundByHash = await repos.tokenRule.findApiTokenByHash("sha256_demo_hash");
      expect(foundByHash?.token.scope.permission).toBe("write");
      await repos.tokenRule.touchApiTokenLastUsed(createdToken.id);
      await repos.tokenRule.revokeApiToken(workspace.id, createdToken.id);
      expect((await repos.tokenRule.getApiTokenById(workspace.id, createdToken.id))?.revokedAt).not.toBeNull();

      const binding = await repos.threadBinding.upsertThreadBinding(workspace.id, {
        documentId: article.id,
        nodeId: null,
        selectionAnchor: {
          quote: "Adopt cosscom/ui Base UI components.",
          headingSlug: "ui-design-notes",
          startOffset: 18,
          endOffset: 54,
        },
        adeKind: "bb",
        externalThreadId: "thr_ui_design",
        title: "Verify cosscom/ui tokens",
        status: "waiting_input",
        lastSummary: "Waiting on palette confirmation",
        unreadResult: true,
        progressSteps: [
          { id: asAgentStepId("stp_1"), label: "Scan code", status: "completed", durationMs: 120 },
        ],
        pendingApproval: {
          id: asApprovalId("apr_1"),
          action: "Modify outline item",
          risk: "medium",
          diffPreview: { oldSnippet: "old", newSnippet: "new" },
        },
        steeringQueue: [
          { id: asSteeringNoteId("str_1"), text: "Preserve subtasks", mode: "queued", createdAt: ts, deliveredAt: null },
        ],
      });
      expect(binding.selectionAnchor?.quote).toBe("Adopt cosscom/ui Base UI components.");
      expect(binding.progressSteps).toHaveLength(1);
      expect(binding.pendingApproval?.action).toBe("Modify outline item");

      await repos.tokenRule.createProjectScopeRule(workspace.id, {
        matchType: "repo_name",
        pattern: "inkade",
        writableSpaceIds: [DEFAULT_SPACE_IDS.projects],
        readonlySpaceIds: [DEFAULT_SPACE_IDS.research],
        priority: 10,
      });
      await repos.tokenRule.createProjectScopeRule(workspace.id, {
        matchType: "path_glob",
        pattern: "**/personal/**",
        writableSpaceIds: [DEFAULT_SPACE_IDS.daily],
        readonlySpaceIds: [],
        priority: 50,
      });
      expect((await repos.tokenRule.listProjectScopeRules(workspace.id)).map((r) => r.priority)).toEqual([50, 10]);

      const audit = await repos.audit.createAuditLog(workspace.id, {
        principalKind: "token",
        tokenId: asApiTokenId("tok_1"),
        tokenName: "agent",
        transport: "mcp",
        action: "update_outline_node",
        resource: "mcp:update_outline_node",
        spaceId: DEFAULT_SPACE_IDS.research,
        documentId: article.id,
        decision: "allowed",
        diffPreview: { oldSnippet: "old", newSnippet: "new" },
        reversible: true,
      });
      expect((await repos.audit.getAuditLogById(workspace.id, audit.id))?.reversible).toBe(true);

      const clip = await repos.document.createDocument(workspace.id, {
        spaceId: DEFAULT_SPACE_IDS.inbox,
        kind: "clip",
        title: "Sample clip",
        contentMarkdown: "Clipped content body",
        tags: ["clip"],
        pinned: false,
      });
      await repos.attachment.createAttachment(workspace.id, {
        documentId: clip.id,
        filename: "img.png",
        mimeType: "image/png",
        byteSize: 2048,
        sha256: "abc",
        storageKey: "ws_default/att_1",
      });
      await repos.searchConfig.upsertDocumentEmbedding(workspace.id, {
        documentId: clip.id,
        model: "local",
        dimensions: 4,
        vector: [0.5, 0.5, 0.5, 0.5],
        contentHash: "hash_1",
      });
      const buckets = await repos.audit.getStorageBuckets(workspace.id);
      expect(buckets.clipCount).toBe(1);
      expect(buckets.attachmentBytes).toBe(2048);

      const updatedAi = await repos.searchConfig.upsertAiSettings(workspace.id, {
        enabled: true,
        provider: "deepseek",
        apiKey: "sk-secret-value-9876",
        temperature: 0.5,
      });
      expect(updatedAi.apiKeyMasked).toBe("sk-...9876");
      const clearedAi = await repos.searchConfig.upsertAiSettings(workspace.id, {
        clearApiKey: true,
      });
      expect(clearedAi.hasApiKey).toBe(false);

      const prefs1 = await repos.searchConfig.upsertUserPreferences(workspace.id, "user:usr_1", {
        tasks: { viewMode: "board", boardGroupBy: "priority" },
        layout: { workspaceCanvasWidth: "centered" },
      });
      expect(prefs1.preferences.tasks.viewMode).toBe("board");
      const prefs2 = await repos.searchConfig.upsertUserPreferences(workspace.id, "user:usr_1", {
        tasks: { viewMode: "agenda" },
      });
      expect(prefs2.preferences.tasks.boardGroupBy).toBe("priority");
    } finally {
      sqlite.close();
    }
  });

  test("TransactionRunner rolls back failed async multi-repo tx, supports nested savepoints, and paginates >1,000 DocumentSummary rows in SQL", async () => {
    const { sqlite, repos } = setupMemoryRepos();
    try {
      const { workspace } = await seedDefaultWorkspace(repos, { dailyDate: "2026-11-24" });

      // 1. Async multi-step tx rollback
      let rolledBack = false;
      try {
        await repos.tx.runInTx(async () => {
          await repos.space.createSpace(workspace.id, {
            parentId: null,
            name: "Ephemeral Tx Space",
          });
          throw new Error("boom inside tx");
        });
      } catch {
        rolledBack = true;
      }
      expect(rolledBack).toBe(true);
      const spacesAfter = await repos.space.listSpaces(workspace.id);
      expect(spacesAfter.some((s) => s.name === "Ephemeral Tx Space")).toBe(false);

      // 2. Nested savepoint rollback leaves outer work committed
      await repos.tx.runInTx(async () => {
        await repos.space.createSpace(workspace.id, { parentId: null, name: "Outer Space" });
        try {
          await repos.tx.runInTx(async () => {
            await repos.space.createSpace(workspace.id, { parentId: null, name: "Inner Savepoint Space" });
            throw new Error("inner abort");
          });
        } catch {
          // caught inner failure
        }
      });
      const finalSpaces = await repos.space.listSpaces(workspace.id);
      expect(finalSpaces.some((s) => s.name === "Outer Space")).toBe(true);
      expect(finalSpaces.some((s) => s.name === "Inner Savepoint Space")).toBe(false);

      // 3. >1,000 docs true SQL pagination + lightweight DocumentSummary projection + SQL scope pushdown
      const ts = "2026-11-24T12:00:00.000Z";
      await repos.tx.runInTx(() => {
        const stmt = sqlite.query(
          `INSERT INTO documents (
            id, workspace_id, space_id, kind, title, slug, daily_date,
            content_markdown, content_json, content_text, excerpt,
            version, pinned, unread_agent_update, last_edited_by_type, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?, 1, 0, 0, 'human', ?, ?)`,
        );
        const tagStmt = sqlite.query("INSERT INTO document_tags (document_id, tag) VALUES (?, ?)");
        for (let i = 0; i < 1150; i++) {
          const id = asDocumentId(`doc_bulk_${i.toString().padStart(4, "0")}`);
          const spaceId = i % 2 === 0 ? DEFAULT_SPACE_IDS.research : DEFAULT_SPACE_IDS.projects;
          const kind = i % 3 === 0 ? "clip" : "article";
          stmt.run(
            id,
            workspace.id,
            spaceId,
            kind,
            `Bulk Note ${i}`,
            `bulk-note-${i}`,
            `Huge secret markdown payload ${i}`,
            `Huge secret markdown payload ${i}`,
            `Excerpt ${i}`,
            `2026-11-${String(10 + (i % 15)).padStart(2, "0")}T00:${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}.000Z`,
            ts,
          );
          tagStmt.run(id, i % 5 === 0 ? "priority-tag" : "general-tag");
        }
        return Promise.resolve();
      });

      const pageLate = await repos.document.listDocumentSummaries(workspace.id, {
        limit: 100,
        offset: 1050,
      });
      expect(pageLate.length).toBeGreaterThanOrEqual(100);
      const sample = pageLate[0]!;
      expect("contentMarkdown" in sample).toBe(false);
      expect("contentJson" in sample).toBe(false);
      expect("contentText" in sample).toBe(false);

      const scopedAll = await repos.document.listDocumentSummaries(workspace.id, {
        spaceIds: [DEFAULT_SPACE_IDS.research],
        allowedKinds: ["article"],
        tagAllowlist: ["priority-tag"],
        limit: null,
      });
      expect(scopedAll.length).toBeGreaterThan(30);
      for (const item of scopedAll) {
        expect(item.spaceId).toBe(DEFAULT_SPACE_IDS.research);
        expect(item.kind).toBe("article");
        expect(item.tags).toContain("priority-tag");
      }
    } finally {
      sqlite.close();
    }
  });
});
