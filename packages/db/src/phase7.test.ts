import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InkadeError } from "@inkade/core";
import {
  createSqliteDatabase,
  createSqliteRepositories,
  DEFAULT_SPACE_IDS,
  seedDefaultWorkspace,
} from "./index.ts";

describe("Drizzle Single-Source Migrations & CJK FTS5", () => {
  test("applies single-source Drizzle migrations idempotently and enforces partial unique daily index", () => {
    const dir = mkdtempSync(join(tmpdir(), "inkade-drizzle-mig-"));
    const dbFile = join(dir, "inkade.db");
    try {
      const bundle1 = createSqliteDatabase(dbFile);
      const migrations1 = bundle1.sqlite
        .query<{ hash: string; created_at: number }, []>(
          "SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at ASC",
        )
        .all();
      expect(migrations1).toHaveLength(12);

      const tables = bundle1.sqlite
        .query<{ name: string }, []>(
          "SELECT name FROM sqlite_master WHERE type IN ('table', 'view') ORDER BY name",
        )
        .all()
        .map((r) => r.name);
      for (const tbl of [
        "users",
        "workspaces",
        "spaces",
        "documents",
        "outline_nodes",
        "document_tasks",
        "calendar_subscriptions",
        "calendar_events_cache",
        "document_highlights",
        "highlight_comments",
        "audit_logs",
        "document_templates",
        "share_links",
        "saved_views",
        "space_property_schemas",
        "user_preferences",
        "search_fts",
        "document_chunks",
        "chunk_embeddings",
        "context_packs",
        "document_assets",
        "document_artifacts",
        "rss_feeds",
        "ingest_webhooks",
        "public_sites",
        "agent_briefing_jobs",
        "agent_briefing_runs",
        "thread_wake_events",
        "bridge_sessions",
      ]) {
        expect(tables).toContain(tbl);
      }

      const idx = bundle1.sqlite
        .query<{ name: string; sql: string }, []>(
          "SELECT name, sql FROM sqlite_master WHERE name = 'idx_documents_workspace_daily_date'",
        )
        .get();
      expect(idx?.sql).toContain("WHERE daily_date IS NOT NULL AND trashed_at IS NULL");
      bundle1.sqlite.close();

      // Re-opening applies zero duplicate migrations
      const bundle2 = createSqliteDatabase(dbFile);
      const migrations2 = bundle2.sqlite
        .query<{ hash: string; created_at: number }, []>(
          "SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at ASC",
        )
        .all();
      expect(migrations2).toEqual(migrations1);
      bundle2.sqlite.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("ranks CJK title matches above body-only matches, indexes node notes, and pushes scope filters to SQL FTS", async () => {
    const { sqlite, db } = createSqliteDatabase(":memory:");
    try {
      const repos = createSqliteRepositories(sqlite, db);
      const { workspace } = await seedDefaultWorkspace(repos, { dailyDate: "2026-11-24" });

      const spaces = await repos.space.listSpaces(workspace.id);
      expect(spaces.find((s) => s.id === DEFAULT_SPACE_IDS.daily)?.color).toBe("amber");
      expect(spaces.find((s) => s.id === DEFAULT_SPACE_IDS.inbox)?.color).toBe("indigo");
      expect(spaces.find((s) => s.id === DEFAULT_SPACE_IDS.research)?.color).toBe("emerald");
      expect(spaces.find((s) => s.id === DEFAULT_SPACE_IDS.projects)?.color).toBe("blue");

      const bodyOnlyDoc = await repos.document.createDocument(workspace.id, {
        spaceId: DEFAULT_SPACE_IDS.research,
        kind: "article",
        title: "工程实践笔记",
        contentMarkdown: "我们在本地持久化场景采用了架构方案。",
        tags: ["eng"],
        pinned: false,
      });

      const titleMatchDoc = await repos.document.createDocument(workspace.id, {
        spaceId: DEFAULT_SPACE_IDS.research,
        kind: "article",
        title: "架构演进指南",
        contentMarkdown: "包含核心模块说明。",
        tags: ["arch"],
        pinned: false,
      });

      const ranked = await repos.searchConfig.searchFts(workspace.id, "架构");
      expect(ranked.length).toBeGreaterThanOrEqual(2);
      expect(ranked[0]?.documentId).toBe(titleMatchDoc.id);
      expect(ranked.some((h) => h.documentId === bodyOnlyDoc.id)).toBe(true);

      const tagScopedHits = await repos.searchConfig.searchFts(workspace.id, "架构", {
        tagAllowlist: ["arch"],
      });
      expect(tagScopedHits.some((h) => h.documentId === titleMatchDoc.id)).toBe(true);
      expect(tagScopedHits.some((h) => h.documentId === bodyOnlyDoc.id)).toBe(false);

      const { document: daily } = await repos.document.getOrCreateDailyOutline(
        workspace.id,
        DEFAULT_SPACE_IDS.daily,
        "2026-11-24",
      );
      const noteNode = await repos.outline.createOutlineNode(workspace.id, {
        documentId: daily.id,
        parentNodeId: null,
        contentMarkdown: "Main task",
        noteMarkdown: "副行备注：支持拼音与中文检索 #notes-tag",
        checked: false,
        collapsed: false,
        authorType: "human",
      });
      expect(noteNode.noteText).toContain("副行备注");

      const noteHits = await repos.searchConfig.searchFts(workspace.id, "副行");
      expect(noteHits.some((h) => h.nodeId === noteNode.id)).toBe(true);
      const refreshedDaily = await repos.document.getDocumentById(workspace.id, daily.id);
      expect(refreshedDaily?.tags).toContain("notes-tag");

      // Trashed daily doc releases unique daily_date constraint so creating active doc succeeds
      await repos.document.trashDocument(workspace.id, daily.id);
      const recreated = await repos.document.createDocument(workspace.id, {
        spaceId: DEFAULT_SPACE_IDS.daily,
        kind: "outline",
        title: "Daily replacement",
        dailyDate: "2026-11-24",
        contentMarkdown: "",
      });
      expect(recreated.id).not.toBe(daily.id);

      let restoreConflict = false;
      try {
        await repos.document.restoreDocument(workspace.id, daily.id);
      } catch (err) {
        restoreConflict = err instanceof InkadeError && err.code === "CONFLICT";
      }
      expect(restoreConflict).toBe(true);

      // System internal docs (`systemRole: "tasks_inbox"`) stay hidden unless includeSystem: true
      const sysDoc = await repos.document.createDocument(workspace.id, {
        spaceId: DEFAULT_SPACE_IDS.inbox,
        kind: "outline",
        title: "Tasks Inbox",
        contentMarkdown: "- [ ] Secret system task 架构检查",
        properties: { systemRole: "tasks_inbox" },
      });
      const defaultDocs = await repos.document.listDocumentSummaries(workspace.id);
      expect(defaultDocs.some((d) => d.id === sysDoc.id)).toBe(false);
      const defaultFts = await repos.searchConfig.searchFts(workspace.id, "架构");
      expect(defaultFts.some((h) => h.documentId === sysDoc.id)).toBe(false);
      const sysIncludedDocs = await repos.document.listDocuments(workspace.id, {
        includeSystem: true,
      });
      expect(sysIncludedDocs.some((d) => d.id === sysDoc.id)).toBe(true);
    } finally {
      sqlite.close();
    }
  });
});
