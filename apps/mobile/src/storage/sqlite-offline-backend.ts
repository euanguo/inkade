import type { DocumentRecord } from "@inkade/core";
import type { OfflineCacheBackend, OfflineQueuedMutation } from "@inkade/sdk/offline";

export interface SqliteDbDriver {
  execAsync(source: string): Promise<void>;
  runAsync(source: string, params: unknown[]): Promise<unknown>;
  getFirstAsync<T>(source: string, params: unknown[]): Promise<T | null>;
  getAllAsync<T>(source: string, params: unknown[]): Promise<T[]>;
}

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS cached_documents (
    id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL,
    space_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    payload_json TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_cached_documents_space ON cached_documents(space_id, updated_at);
  CREATE TABLE IF NOT EXISTS offline_mutations (
    id TEXT PRIMARY KEY NOT NULL,
    queued_at TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    payload_json TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_offline_mutations_queued ON offline_mutations(queued_at);
`;

async function openDefaultExpoSqliteDriver(): Promise<SqliteDbDriver> {
  const sqlite = await import("expo-sqlite");
  const db = await sqlite.openDatabaseAsync("inkade-mobile-offline.db");
  return {
    execAsync: (sql) => db.execAsync(sql),
    runAsync: (sql, params) => db.runAsync(sql, params as never),
    getFirstAsync: <T>(sql: string, params: unknown[]) =>
      db.getFirstAsync<T>(sql, params as never),
    getAllAsync: <T>(sql: string, params: unknown[]) =>
      db.getAllAsync<T>(sql, params as never),
  };
}

export class SqliteOfflineCacheBackend implements OfflineCacheBackend {
  private initPromise: Promise<SqliteDbDriver> | null = null;

  constructor(private readonly driverFactory: () => Promise<SqliteDbDriver> = openDefaultExpoSqliteDriver) {}

  private async getDb(): Promise<SqliteDbDriver> {
    if (!this.initPromise) {
      this.initPromise = this.driverFactory()
        .then(async (driver) => {
          await driver.execAsync(SCHEMA_SQL);
          return driver;
        })
        .catch((err) => {
          this.initPromise = null;
          throw err;
        });
    }
    return this.initPromise;
  }

  async getDocument(documentId: string): Promise<DocumentRecord | null> {
    const db = await this.getDb();
    const row = await db.getFirstAsync<{ payload_json: string }>(
      "SELECT payload_json FROM cached_documents WHERE id = ? LIMIT 1",
      [documentId],
    );
    if (!row?.payload_json) return null;
    try {
      return JSON.parse(row.payload_json) as DocumentRecord;
    } catch {
      return null;
    }
  }

  async putDocument(document: DocumentRecord): Promise<void> {
    const db = await this.getDb();
    await db.runAsync(
      `INSERT INTO cached_documents (id, workspace_id, space_id, kind, updated_at, payload_json)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         workspace_id = excluded.workspace_id,
         space_id = excluded.space_id,
         kind = excluded.kind,
         updated_at = excluded.updated_at,
         payload_json = excluded.payload_json`,
      [
        document.id,
        document.workspaceId,
        document.spaceId,
        document.kind,
        document.updatedAt,
        JSON.stringify(document),
      ],
    );
  }

  async listDocuments(): Promise<readonly DocumentRecord[]> {
    const db = await this.getDb();
    const rows = await db.getAllAsync<{ payload_json: string }>(
      "SELECT payload_json FROM cached_documents ORDER BY updated_at DESC",
      [],
    );
    const docs: DocumentRecord[] = [];
    for (const row of rows) {
      try {
        docs.push(JSON.parse(row.payload_json) as DocumentRecord);
      } catch {
        // skip corrupted row
      }
    }
    return docs;
  }

  async deleteDocument(documentId: string): Promise<void> {
    const db = await this.getDb();
    await db.runAsync("DELETE FROM cached_documents WHERE id = ?", [documentId]);
  }

  async clearDocuments(): Promise<void> {
    const db = await this.getDb();
    await db.runAsync("DELETE FROM cached_documents", []);
  }

  async listMutations(): Promise<readonly OfflineQueuedMutation[]> {
    const db = await this.getDb();
    const rows = await db.getAllAsync<{ payload_json: string }>(
      "SELECT payload_json FROM offline_mutations ORDER BY queued_at ASC, id ASC",
      [],
    );
    const mutations: OfflineQueuedMutation[] = [];
    for (const row of rows) {
      try {
        mutations.push(JSON.parse(row.payload_json) as OfflineQueuedMutation);
      } catch {
        // skip corrupted row
      }
    }
    return mutations;
  }

  async putMutation(mutation: OfflineQueuedMutation): Promise<void> {
    const db = await this.getDb();
    await db.runAsync(
      `INSERT INTO offline_mutations (id, queued_at, attempts, payload_json)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         queued_at = excluded.queued_at,
         attempts = excluded.attempts,
         payload_json = excluded.payload_json`,
      [mutation.id, mutation.queuedAt, mutation.attempts, JSON.stringify(mutation)],
    );
  }

  async deleteMutation(mutationId: string): Promise<void> {
    const db = await this.getDb();
    await db.runAsync("DELETE FROM offline_mutations WHERE id = ?", [mutationId]);
  }

  async clearMutations(): Promise<void> {
    const db = await this.getDb();
    await db.runAsync("DELETE FROM offline_mutations", []);
  }
}
