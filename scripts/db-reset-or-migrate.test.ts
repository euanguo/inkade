import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSqliteDatabase, createSqliteRepositories } from "../packages/db/src/index.ts";
import { runDbResetOrMigrate } from "./db-reset-or-migrate.ts";

describe("scripts/db-reset-or-migrate", () => {
  test("backs up and migrates a pre-refactor legacy database preserving data and rebuilding CJK FTS5", async () => {
    const dir = mkdtempSync(join(tmpdir(), "inkade-script-migrate-"));
    const dbFile = join(dir, "legacy.db");

    const legacy = new Database(dbFile, { create: true });
    legacy.exec(`
      CREATE TABLE workspaces (id TEXT PRIMARY KEY NOT NULL, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, owner_user_id TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE spaces (id TEXT PRIMARY KEY NOT NULL, workspace_id TEXT NOT NULL, parent_id TEXT, slug TEXT NOT NULL, name TEXT NOT NULL, icon TEXT, color TEXT, default_kind TEXT, sort_order INTEGER NOT NULL DEFAULT 0, archived_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE documents (id TEXT PRIMARY KEY NOT NULL, workspace_id TEXT NOT NULL, space_id TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, slug TEXT NOT NULL, daily_date TEXT, content_markdown TEXT NOT NULL DEFAULT '', content_json TEXT, content_text TEXT NOT NULL DEFAULT '', excerpt TEXT NOT NULL DEFAULT '', source_url TEXT, source_meta_json TEXT, properties_json TEXT, version INTEGER NOT NULL DEFAULT 1, pinned INTEGER NOT NULL DEFAULT 0, unread_agent_update INTEGER NOT NULL DEFAULT 0, last_edited_by_type TEXT NOT NULL DEFAULT 'human', trashed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE outline_nodes (id TEXT PRIMARY KEY NOT NULL, document_id TEXT NOT NULL, parent_node_id TEXT, order_key TEXT NOT NULL, content_markdown TEXT NOT NULL DEFAULT '', content_text TEXT NOT NULL DEFAULT '', checked INTEGER, collapsed INTEGER NOT NULL DEFAULT 0, author_type TEXT NOT NULL DEFAULT 'human', author_id TEXT, source_binding_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT);
    `);
    const ts = "2026-11-24T00:00:00.000Z";
    legacy
      .query("INSERT INTO workspaces VALUES (?, ?, ?, ?, ?, ?)")
      .run("ws_default", "personal", "Personal", "usr_1", ts, ts);
    legacy
      .query("INSERT INTO spaces (id, workspace_id, parent_id, slug, name, sort_order, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?)")
      .run("spc_research", "ws_default", "research", "Research", 30, ts, ts);
    legacy
      .query("INSERT INTO documents (id, workspace_id, space_id, kind, title, slug, content_markdown, content_text, excerpt, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)")
      .run("doc_zh", "ws_default", "spc_research", "article", "分布式知识库检索", "zh-rag", "正文包含混合索引", "正文包含混合索引", "正文包含混合索引", ts, ts);
    legacy
      .query("INSERT INTO outline_nodes (id, document_id, parent_node_id, order_key, content_markdown, content_text, created_at, updated_at) VALUES (?, ?, NULL, 'a0', ?, ?, ?, ?)")
      .run("nod_1", "doc_zh", "验证中文分词器", "验证中文分词器", ts, ts);
    legacy.close();

    try {
      const report = await runDbResetOrMigrate({ mode: "migrate-data", dbPath: dbFile });
      expect(report.backupPath).not.toBeNull();
      expect(existsSync(report.backupPath!)).toBe(true);
      expect(report.migratedTables.documents).toBe(1);
      expect(report.backfilledFtsRows).toBe(2);

      const { sqlite, db } = createSqliteDatabase(dbFile);
      const repos = createSqliteRepositories(sqlite, db);
      const preserved = await repos.document.getDocumentById("ws_default", "doc_zh");
      expect(preserved?.title).toBe("分布式知识库检索");
      const ftsHits = await repos.searchConfig.searchFts("ws_default", "知识库");
      expect(ftsHits.some((h) => h.documentId === "doc_zh")).toBe(true);
      const nodeHits = await repos.searchConfig.searchFts("ws_default", "分词器");
      expect(nodeHits.some((h) => h.nodeId === "nod_1")).toBe(true);
      sqlite.close();

      // Test --mode=reset rebuilds cleanly from zero
      const resetReport = await runDbResetOrMigrate({ mode: "reset", dbPath: dbFile });
      expect(resetReport.backupPath).not.toBeNull();
      expect(resetReport.migratedTables.documents).toBeGreaterThanOrEqual(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
