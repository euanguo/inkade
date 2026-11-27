import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as authSchema from "./schema/auth-sqlite.ts";
import * as coreSchema from "./schema/sqlite.ts";

export const sqliteSchema = {
  ...coreSchema,
  ...authSchema,
};

export type InkadeSqliteDb = BunSQLiteDatabase<typeof sqliteSchema>;

export interface SqliteDatabaseBundle {
  readonly sqlite: Database;
  readonly db: InkadeSqliteDb;
}

const DEFAULT_MIGRATIONS_FOLDER = resolve(
  fileURLToPath(new URL("../drizzle", import.meta.url)),
);

/**
 * Resolves the canonical Drizzle SQLite migrations folder relative to `@inkade/db`.
 */
export function resolveSqliteMigrationsFolder(): string {
  return DEFAULT_MIGRATIONS_FOLDER;
}

/**
 * Optionally loads the `sqlite-vec` native extension when explicitly enabled and installed.
 * Default single-process startup works without any native vector extension via SQLite JSON vectors.
 */
export async function tryLoadSqliteVec(sqlite: Database): Promise<boolean> {
  if (process.env.INKADE_SQLITE_VEC !== "true") {
    return false;
  }
  try {
    const modName = "sqlite-vec";
    const sqliteVec = (await import(modName)) as { load?: (db: Database) => void };
    if (typeof sqliteVec.load === "function") {
      sqliteVec.load(sqlite);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export interface CreateSqliteDatabaseOptions {
  readonly migrationsFolder?: string;
}

/**
 * Opens SQLite, configures WAL/FK/timeout PRAGMAs, and applies single-source Drizzle migrations.
 */
export function createSqliteDatabase(
  dbPath: string,
  options?: CreateSqliteDatabaseOptions,
): SqliteDatabaseBundle {
  const isMemory = dbPath === ":memory:" || dbPath.startsWith("file::memory:");
  if (!isMemory) {
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  const sqlite = new Database(dbPath, { create: true });
  if (!isMemory) {
    sqlite.exec("PRAGMA journal_mode = WAL;");
  }
  sqlite.exec("PRAGMA foreign_keys = ON;");
  sqlite.exec("PRAGMA busy_timeout = 5000;");
  sqlite.exec("PRAGMA synchronous = NORMAL;");

  const db = drizzle(sqlite, { schema: sqliteSchema });
  migrate(db, {
    migrationsFolder: options?.migrationsFolder ?? DEFAULT_MIGRATIONS_FOLDER,
  });

  return { sqlite, db };
}
