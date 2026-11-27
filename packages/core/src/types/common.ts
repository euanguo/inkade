import { z } from "zod";
import { DEFAULT_HOST_KIND, adeKindSchema, type AdeKind } from "../hosts.ts";
import { isValidDailyDate } from "../ids.ts";

export { DEFAULT_HOST_KIND, adeKindSchema, type AdeKind };

export const DOCUMENT_KINDS = ["outline", "article", "clip"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
export const documentKindSchema = z.enum(DOCUMENT_KINDS);

export const ACTOR_TYPES = ["human", "agent", "system"] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];
export const actorTypeSchema = z.enum(ACTOR_TYPES);

export const ADE_THREAD_STATUSES = [
  "queued",
  "running",
  "waiting_input",
  "completed",
  "failed",
  "archived",
] as const;
export type AdeThreadStatus = (typeof ADE_THREAD_STATUSES)[number];
export const adeThreadStatusSchema = z.enum(ADE_THREAD_STATUSES);

export const TOKEN_PERMISSIONS = ["read", "append", "write", "admin"] as const;
export type TokenPermission = (typeof TOKEN_PERMISSIONS)[number];
export const tokenPermissionSchema = z.enum(TOKEN_PERMISSIONS);

export const SCOPE_ACTIONS = [
  "read",
  "append",
  "write",
  "soft_delete",
  "hard_delete",
  "admin",
] as const;
export type ScopeAction = (typeof SCOPE_ACTIONS)[number];

export const PROJECT_SCOPE_RULE_MATCH_TYPES = [
  "git_remote",
  "repo_name",
  "path_glob",
] as const;
export type ProjectScopeRuleMatchType = (typeof PROJECT_SCOPE_RULE_MATCH_TYPES)[number];
export const projectScopeRuleMatchTypeSchema = z.enum(PROJECT_SCOPE_RULE_MATCH_TYPES);

export const PATCH_MODES = ["replace", "append", "prepend"] as const;
export type SectionPatchMode = (typeof PATCH_MODES)[number];
export const sectionPatchModeSchema = z.enum(PATCH_MODES);

export const LIBRARY_VIEW_MODES = ["list", "grid", "table", "board"] as const;
export type LibraryViewMode = (typeof LIBRARY_VIEW_MODES)[number];
export const libraryViewModeSchema = z.enum(LIBRARY_VIEW_MODES);

export const LIBRARY_SORT_FIELDS = ["updatedAt", "createdAt", "title", "kind"] as const;
export type LibrarySortField = (typeof LIBRARY_SORT_FIELDS)[number];
export const librarySortFieldSchema = z.enum(LIBRARY_SORT_FIELDS);

export const SORT_DIRECTIONS = ["asc", "desc"] as const;
export type SortDirection = (typeof SORT_DIRECTIONS)[number];
export const sortDirectionSchema = z.enum(SORT_DIRECTIONS);

export const HIGHLIGHT_COLORS = ["amber", "emerald", "blue", "rose"] as const;
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];
export const highlightColorSchema = z.enum(HIGHLIGHT_COLORS);

export const AUDIT_PRINCIPAL_KINDS = ["user", "token"] as const;
export type AuditPrincipalKind = (typeof AUDIT_PRINCIPAL_KINDS)[number];
export const auditPrincipalKindSchema = z.enum(AUDIT_PRINCIPAL_KINDS);

export const AUDIT_TRANSPORTS = ["rest", "mcp", "system"] as const;
export type AuditTransport = (typeof AUDIT_TRANSPORTS)[number];
export const auditTransportSchema = z.enum(AUDIT_TRANSPORTS);

export const AUDIT_DECISIONS = ["allowed", "denied"] as const;
export type AuditDecision = (typeof AUDIT_DECISIONS)[number];
export const auditDecisionSchema = z.enum(AUDIT_DECISIONS);

export const EXECUTION_MODES = ["autonomous", "sandbox_only", "read_only"] as const;
export type ExecutionMode = (typeof EXECUTION_MODES)[number];
export const executionModeSchema = z.enum(EXECUTION_MODES);

export const SEMANTIC_SEARCH_MODES = ["hybrid", "semantic", "keyword"] as const;
export type SemanticSearchMode = (typeof SEMANTIC_SEARCH_MODES)[number];
export const semanticSearchModeSchema = z.enum(SEMANTIC_SEARCH_MODES);

export const dailyDateSchema = z
  .string()
  .refine(isValidDailyDate, { message: "dailyDate must be a valid YYYY-MM-DD calendar date" });

export const isoTimestampSchema = z.iso.datetime({ offset: true });
