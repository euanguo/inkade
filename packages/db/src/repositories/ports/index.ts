export * from "./transaction.ts";
export * from "./workspace.port.ts";
export * from "./space.port.ts";
export * from "./document.port.ts";
export * from "./outline.port.ts";
export * from "./revision-link.port.ts";
export * from "./thread-binding.port.ts";
export * from "./token-rule.port.ts";
export * from "./audit.port.ts";
export * from "./attachment.port.ts";
export * from "./search-config.port.ts";

import type { AttachmentRepo } from "./attachment.port.ts";
import type { AuditRepo } from "./audit.port.ts";
import type { DocumentRepo } from "./document.port.ts";
import type { OutlineRepo } from "./outline.port.ts";
import type { RevisionLinkRepo } from "./revision-link.port.ts";
import type { SearchConfigRepo } from "./search-config.port.ts";
import type { SpaceRepo } from "./space.port.ts";
import type { ThreadBindingRepo } from "./thread-binding.port.ts";
import type { TokenRuleRepo } from "./token-rule.port.ts";
import type { StorageDialect, TransactionRunner } from "./transaction.ts";
import type { WorkspaceRepo } from "./workspace.port.ts";

/**
 * Typed collection of narrow domain repository ports + TransactionRunner.
 * Services and helpers destructure ONLY the narrow ports they actually depend on.
 */
export interface InkadeRepositories {
  readonly dialect: StorageDialect;
  readonly tx: TransactionRunner;
  readonly workspace: WorkspaceRepo;
  readonly space: SpaceRepo;
  readonly document: DocumentRepo;
  readonly outline: OutlineRepo;
  readonly revisionLink: RevisionLinkRepo;
  readonly threadBinding: ThreadBindingRepo;
  readonly tokenRule: TokenRuleRepo;
  readonly audit: AuditRepo;
  readonly attachment: AttachmentRepo;
  readonly searchConfig: SearchConfigRepo;
}
