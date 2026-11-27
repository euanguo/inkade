import { Database } from "bun:sqlite";
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  tokenizeForSearch,
  tokenScopeSchema,
  agentStepsListSchema,
  agentSteeringListSchema,
  nullablePendingApprovalSchema,
  nullableSelectionAnchorSchema,
  diffPreviewSchema,
  savedViewFilterSchema,
  parseJsonWithSchema,
  cloneDefaultUserPreferences,
  parseUserPreferences,
} from "../packages/core/src/index.ts";
import {
  createSqliteDatabase,
  createSqliteRepositories,
  seedDefaultWorkspace,
} from "../packages/db/src/index.ts";

export type DbMigrationMode = "reset" | "migrate-data";

export interface DbMigrationReport {
  readonly mode: DbMigrationMode;
  readonly dbPath: string;
  readonly backupPath: string | null;
  readonly migratedTables: Readonly<Record<string, number>>;
  readonly backfilledFtsRows: number;
}

const ORDERED_COPY_TABLES = [
  "users",
  "sessions",
  "accounts",
  "verifications",
  "workspaces",
  "spaces",
  "documents",
  "document_tags",
  "outline_nodes",
  "document_revisions",
  "document_links",
  "ade_thread_bindings",
  "api_tokens",
  "project_scope_rules",
  "attachments",
  "document_highlights",
  "audit_logs",
  "document_templates",
  "share_links",
  "saved_views",
  "space_property_schemas",
  "document_embeddings",
  "document_yjs_states",
  "ai_settings",
  "user_preferences",
] as const;

function removeDbFiles(dbPath: string): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    const candidate = `${dbPath}${suffix}`;
    if (existsSync(candidate)) {
      rmSync(candidate, { force: true });
    }
  }
}

export function backupSqliteDatabase(dbPath: string): string | null {
  if (!existsSync(dbPath)) {
    return null;
  }

  // Checkpoint WAL so the backup copy captures committed pages cleanly.
  const src = new Database(dbPath);
  try {
    src.exec("PRAGMA wal_checkpoint(TRUNCATE);");
  } finally {
    src.close();
  }

  const backupDir = join(dirname(dbPath), "backups");
  mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const baseName = basename(dbPath, ".db");
  const backupPath = join(backupDir, `${baseName}-pre-refactor-${stamp}.db`);
  copyFileSync(dbPath, backupPath);
  const backupDb = new Database(backupPath);
  try {
    backupDb.exec("PRAGMA journal_mode = DELETE;");
  } finally {
    backupDb.close();
  }
  return backupPath;
}

function getExistingColumns(sqlite: Database, table: string): Set<string> {
  const rows = sqlite
    .query<{ name: string }, []>(`PRAGMA table_info("${table}");`)
    .all();
  return new Set(rows.map((r) => r.name));
}

function tableExists(sqlite: Database, table: string): boolean {
  const row = sqlite
    .query<{ name: string }, [string]>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    )
    .get(table);
  return row !== null;
}

function sanitizeRowForTargetTable(
  table: string,
  row: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...row };
  if (table === "api_tokens" && typeof next.scope_json === "string") {
    const valid = parseJsonWithSchema(next.scope_json, tokenScopeSchema, {
      permission: "read",
      spaceIds: [],
      includeDescendants: true,
      denyHardDelete: true,
    });
    next.scope_json = JSON.stringify(valid);
  }
  if (table === "ade_thread_bindings") {
    if (typeof next.progress_steps_json === "string") {
      next.progress_steps_json = JSON.stringify(
        parseJsonWithSchema(next.progress_steps_json, agentStepsListSchema, []),
      );
    }
    if (typeof next.pending_approval_json === "string") {
      const parsed = parseJsonWithSchema(
        next.pending_approval_json,
        nullablePendingApprovalSchema,
        null,
      );
      next.pending_approval_json = parsed ? JSON.stringify(parsed) : null;
    }
    if (typeof next.steering_queue_json === "string") {
      next.steering_queue_json = JSON.stringify(
        parseJsonWithSchema(next.steering_queue_json, agentSteeringListSchema, []),
      );
    }
    if (typeof next.selection_anchor_json === "string") {
      const parsed = parseJsonWithSchema(
        next.selection_anchor_json,
        nullableSelectionAnchorSchema,
        null,
      );
      next.selection_anchor_json = parsed ? JSON.stringify(parsed) : null;
    }
  }
  if (table === "audit_logs" && typeof next.diff_preview_json === "string") {
    const parsed = parseJsonWithSchema(next.diff_preview_json, diffPreviewSchema.nullable(), null);
    next.diff_preview_json = parsed ? JSON.stringify(parsed) : null;
  }
  if (table === "saved_views") {
    if (typeof next.filter_json === "string") {
      const parsed = parseJsonWithSchema(next.filter_json, savedViewFilterSchema, {});
      next.filter_json = JSON.stringify(parsed);
    }
    if (
      typeof next.display_mode !== "string" ||
      (next.display_mode !== "grid" && next.display_mode !== "table" && next.display_mode !== "board")
    ) {
      next.display_mode = "grid";
    }
  }
  if (table === "user_preferences" && typeof next.prefs_json === "string") {
    try {
      const parsed = parseUserPreferences(JSON.parse(next.prefs_json));
      next.prefs_json = JSON.stringify(parsed);
    } catch {
      next.prefs_json = JSON.stringify(cloneDefaultUserPreferences());
    }
  }
  return next;
}

export async function runDbResetOrMigrate(options: {
  readonly mode: DbMigrationMode;
  readonly dbPath: string;
}): Promise<DbMigrationReport> {
  const dbPath = resolve(options.dbPath);
  const backupPath = backupSqliteDatabase(dbPath);
  removeDbFiles(dbPath);

  if (options.mode === "reset" || !backupPath) {
    const { sqlite, db } = createSqliteDatabase(dbPath);
    try {
      const repos = createSqliteRepositories(sqlite, db);
      await seedDefaultWorkspace(repos);
      const docCount =
        sqlite.query<{ c: number }, []>("SELECT count(*) AS c FROM documents").get()?.c ?? 0;
      return {
        mode: options.mode,
        dbPath,
        backupPath,
        migratedTables: { documents: docCount },
        backfilledFtsRows:
          sqlite.query<{ c: number }, []>("SELECT count(*) AS c FROM search_fts").get()?.c ?? 0,
      };
    } finally {
      sqlite.close();
    }
  }

  // --mode=migrate-data: apply clean Drizzle schema, then replay & sanitize legacy data
  const legacy = new Database(backupPath, { readonly: true });
  const targetBundle = createSqliteDatabase(dbPath);
  const counts: Record<string, number> = {};
  let backfilledFtsRows = 0;

  try {
    const target = targetBundle.sqlite;
    target.exec("PRAGMA foreign_keys = OFF;");
    target.transaction(() => {
      for (const table of ORDERED_COPY_TABLES) {
        if (!tableExists(legacy, table) || !tableExists(target, table)) {
          counts[table] = 0;
          continue;
        }
        const legacyCols = getExistingColumns(legacy, table);
        const targetCols = getExistingColumns(target, table);
        const commonCols = [...targetCols].filter((col) => legacyCols.has(col));
        if (commonCols.length === 0) {
          counts[table] = 0;
          continue;
        }

        const selectSql = `SELECT ${commonCols.map((c) => `"${c}"`).join(", ")} FROM "${table}"`;
        const rows = legacy.query<Record<string, unknown>, []>(selectSql).all();
        if (rows.length === 0) {
          counts[table] = 0;
          continue;
        }

        const placeholders = commonCols.map(() => "?").join(", ");
        const insertSql = `INSERT OR IGNORE INTO "${table}" (${commonCols
          .map((c) => `"${c}"`)
          .join(", ")}) VALUES (${placeholders})`;
        const insertStmt = target.query(insertSql);

        for (const rawRow of rows) {
          const sanitized = sanitizeRowForTargetTable(table, rawRow);
          insertStmt.run(...commonCols.map((c) => sanitized[c] as string | number | null));
        }
        counts[table] = rows.length;
      }

      // Rebuild FTS5 index from active documents and active outline nodes
      target.exec("DELETE FROM search_fts;");
      const insertFts = target.query(
        `INSERT INTO search_fts (
          entity_key, workspace_id, entity_type, document_id, node_id, space_id, kind, title, body, tokens
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );

      const activeDocs = target
        .query<{
          id: string;
          workspace_id: string;
          space_id: string;
          kind: string;
          title: string;
          content_text: string;
        }, []>(
          `SELECT id, workspace_id, space_id, kind, title, COALESCE(content_text, '') AS content_text
           FROM documents WHERE trashed_at IS NULL`,
        )
        .all();

      const docMeta = new Map(activeDocs.map((d) => [d.id, d]));
      for (const doc of activeDocs) {
        insertFts.run(
          `doc:${doc.id}`,
          doc.workspace_id,
          "document",
          doc.id,
          null,
          doc.space_id,
          doc.kind,
          doc.title,
          doc.content_text,
          tokenizeForSearch(`${doc.title} ${doc.content_text}`),
        );
        backfilledFtsRows++;
      }

      const activeNodes = target
        .query<{
          id: string;
          document_id: string;
          content_text: string;
          note_text: string;
        }, []>(
          `SELECT id, document_id, COALESCE(content_text, '') AS content_text, COALESCE(note_text, '') AS note_text
           FROM outline_nodes WHERE deleted_at IS NULL`,
        )
        .all();

      for (const node of activeNodes) {
        const parentDoc = docMeta.get(node.document_id);
        if (!parentDoc) continue;
        const body = [node.content_text, node.note_text].filter(Boolean).join(" ");
        insertFts.run(
          `nod:${node.id}`,
          parentDoc.workspace_id,
          "outline_node",
          node.document_id,
          node.id,
          parentDoc.space_id,
          parentDoc.kind,
          parentDoc.title,
          body,
          tokenizeForSearch(`${parentDoc.title} ${body}`),
        );
        backfilledFtsRows++;
      }
    })();
    target.exec("PRAGMA foreign_keys = ON;");
    const check = target.query<{ integrity_check: string }, []>("PRAGMA integrity_check;").get();
    if (check?.integrity_check !== "ok") {
      throw new Error(`SQLite integrity check failed: ${check?.integrity_check ?? "unknown"}`);
    }

    return {
      mode: options.mode,
      dbPath,
      backupPath,
      migratedTables: counts,
      backfilledFtsRows,
    };
  } finally {
    legacy.close();
    targetBundle.sqlite.close();
  }
}

function parseCliArgs(argv: readonly string[]): {
  mode: DbMigrationMode;
  dbPath: string;
} {
  let mode: DbMigrationMode | null = null;
  let dbPath = process.env.INKADE_DB_PATH ?? "data/inkade.db";
  for (const arg of argv) {
    if (arg === "--mode=reset") mode = "reset";
    else if (arg === "--mode=migrate-data") mode = "migrate-data";
    else if (arg.startsWith("--db=")) dbPath = arg.slice("--db=".length);
  }
  if (!mode) {
    throw new Error(
      "Usage: bun run scripts/db-reset-or-migrate.ts --mode=reset|migrate-data [--db=data/inkade.db]",
    );
  }
  return { mode, dbPath };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseCliArgs(process.argv.slice(2));
  const report = await runDbResetOrMigrate(args);
  console.log(JSON.stringify(report, null, 2));
}
