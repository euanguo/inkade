import type { Database } from "bun:sqlite";
import type { InkadeSqliteDb } from "../../client.ts";
import type { InkadeRepositories } from "../ports/index.ts";
import { SqliteAttachmentRepo } from "./attachment.repo.ts";
import { SqliteAuditRepo } from "./audit.repo.ts";
import { SqliteDocumentRepo } from "./document.repo.ts";
import type { SqliteRepoContext } from "./helpers.ts";
import { SqliteOutlineRepo } from "./outline.repo.ts";
import { SqliteRevisionLinkRepo } from "./revision-link.repo.ts";
import { SqliteSearchConfigRepo } from "./search-config.repo.ts";
import { SqliteSpaceRepo } from "./space.repo.ts";
import { SqliteThreadBindingRepo } from "./thread-binding.repo.ts";
import { SqliteTokenRuleRepo } from "./token-rule.repo.ts";
import { SqliteTransactionRunner } from "./transaction.ts";
import { SqliteWorkspaceRepo } from "./workspace.repo.ts";

/**
 * Instantiates all 10 narrow SQLite repositories plus the reentrant TransactionRunner.
 */
export function createSqliteRepositories(
  sqlite: Database,
  db: InkadeSqliteDb,
): InkadeRepositories {
  const tx = new SqliteTransactionRunner(sqlite);
  const ctx: SqliteRepoContext = { sqlite, db, tx };
  return {
    dialect: "sqlite",
    tx,
    workspace: new SqliteWorkspaceRepo(ctx),
    space: new SqliteSpaceRepo(ctx),
    document: new SqliteDocumentRepo(ctx),
    outline: new SqliteOutlineRepo(ctx),
    revisionLink: new SqliteRevisionLinkRepo(ctx),
    threadBinding: new SqliteThreadBindingRepo(ctx),
    tokenRule: new SqliteTokenRuleRepo(ctx),
    audit: new SqliteAuditRepo(ctx),
    attachment: new SqliteAttachmentRepo(ctx),
    searchConfig: new SqliteSearchConfigRepo(ctx),
  };
}

export * from "./transaction.ts";
export * from "./workspace.repo.ts";
export * from "./space.repo.ts";
export * from "./document.repo.ts";
export * from "./outline.repo.ts";
export * from "./revision-link.repo.ts";
export * from "./thread-binding.repo.ts";
export * from "./token-rule.repo.ts";
export * from "./audit.repo.ts";
export * from "./attachment.repo.ts";
export * from "./search-config.repo.ts";
