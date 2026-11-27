import { z } from "zod";
import { InkadeError } from "./errors.ts";
import type { SpaceId } from "./ids.ts";
import {
  EXECUTION_MODES,
  executionModeSchema,
  type DocumentKind,
  type ExecutionMode,
  type ScopeAction,
  type ScopeDecision,
  type ScopeEffectiveSummary,
  type ScopeTarget,
  type Space,
  type TokenPermission,
  type TokenScope,
} from "./types/index.ts";

export const QUIET_AUTONOMY_MODES = EXECUTION_MODES;
export type QuietAutonomyMode = ExecutionMode;
export const quietAutonomyModeSchema = executionModeSchema;

export interface QuietGovernanceSummary {
  readonly mode: QuietAutonomyMode;
  readonly allowedActions: readonly string[];
  readonly blockedActions: readonly string[];
  readonly rollbackGuaranteed: boolean;
}

export const AUTONOMY_LEVELS = ["auto", "draft", "ask"] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];
export const autonomyLevelSchema = z.enum(AUTONOMY_LEVELS);

export interface AutonomyPolicySummary {
  readonly level: AutonomyLevel;
  readonly autoActions: readonly string[];
  readonly approvalRequiredActions: readonly string[];
  readonly lockedActions: readonly string[];
}

export const ADMIN_USER_SCOPE: TokenScope = {
  permission: "admin",
  spaceIds: "*",
  includeDescendants: true,
  denyHardDelete: false,
  allowGovernanceMutation: true,
};

export const PERMISSION_RANK: Readonly<Record<TokenPermission, number>> = {
  read: 1,
  append: 2,
  write: 3,
  admin: 4,
};

const ACTION_REQUIRED_RANK: Readonly<Record<ScopeAction, number>> = {
  read: 1,
  append: 2,
  write: 3,
  soft_delete: 3,
  hard_delete: 4,
  admin: 4,
};

/**
 * Resolve every Space ID reachable under `scope`, respecting descendant inheritance.
 */
export function resolveAllowedSpaceIds(
  scope: TokenScope,
  allSpaces: readonly Pick<Space, "id" | "parentId">[],
): ReadonlySet<SpaceId> | "*" {
  if (scope.spaceIds === "*") {
    return "*";
  }

  const allowed = new Set<SpaceId>(scope.spaceIds);
  if (!scope.includeDescendants || allowed.size === 0) {
    return allowed;
  }

  const childrenByParent = new Map<SpaceId, SpaceId[]>();
  for (const space of allSpaces) {
    if (space.parentId === null) continue;
    const list = childrenByParent.get(space.parentId);
    if (list) {
      list.push(space.id);
    } else {
      childrenByParent.set(space.parentId, [space.id]);
    }
  }

  const queue = [...allowed];
  while (queue.length > 0) {
    const current = queue.pop();
    if (!current) continue;
    const children = childrenByParent.get(current);
    if (!children) continue;
    for (const childId of children) {
      if (!allowed.has(childId)) {
        allowed.add(childId);
        queue.push(childId);
      }
    }
  }

  return allowed;
}

/**
 * Pure server-side scope evaluator shared by REST API, /mcp, FTS5 search, SSE, and ADE adapters.
 */
export function evaluateScopeAccess(
  scope: TokenScope,
  action: ScopeAction,
  target: ScopeTarget,
  allSpaces: readonly Pick<Space, "id" | "parentId">[],
): ScopeDecision {
  if (action === "hard_delete" && scope.denyHardDelete) {
    return { allowed: false, reason: "hard_delete is blocked by token policy" };
  }

  if (PERMISSION_RANK[scope.permission] < ACTION_REQUIRED_RANK[action]) {
    return {
      allowed: false,
      reason: `token permission "${scope.permission}" cannot perform "${action}"`,
    };
  }

  const allowedSpaces = resolveAllowedSpaceIds(scope, allSpaces);
  if (allowedSpaces !== "*" && (target.spaceId === "*" || !allowedSpaces.has(target.spaceId))) {
    return {
      allowed: false,
      reason: `space "${target.spaceId}" is outside token whitelist`,
    };
  }

  const resourceType = target.resourceType ?? "document";

  if (resourceType !== "space" && scope.allowedKinds !== undefined) {
    if (target.kind === undefined || !scope.allowedKinds.includes(target.kind)) {
      return {
        allowed: false,
        reason: `document kind "${target.kind ?? "unknown"}" is not permitted by token`,
      };
    }
  }

  if (
    resourceType !== "space" &&
    scope.tagAllowlist !== undefined &&
    scope.tagAllowlist.length > 0
  ) {
    const targetTags = target.tags ?? [];
    const hasMatch =
      targetTags.length > 0 && targetTags.some((tag) => scope.tagAllowlist?.includes(tag));
    if (!hasMatch) {
      return {
        allowed: false,
        reason: "document tags do not match token tag allowlist",
      };
    }
  }

  return { allowed: true };
}

export function summarizeEffectiveScope(
  scope: TokenScope,
  allSpaces: readonly Pick<Space, "id" | "parentId">[],
): ScopeEffectiveSummary {
  const resolved = resolveAllowedSpaceIds(scope, allSpaces);
  return {
    permission: scope.permission,
    allowedSpaceIds: resolved === "*" ? "*" : [...resolved],
    includeDescendants: scope.includeDescendants,
    tagAllowlist: scope.tagAllowlist ? [...scope.tagAllowlist] : null,
    allowedKinds: scope.allowedKinds ? [...scope.allowedKinds] : null,
    denyHardDelete: scope.denyHardDelete,
    allowGovernanceMutation: scope.allowGovernanceMutation === true,
  };
}

/**
 * Enforces owner-only governance mutations: API tokens are rejected with 403 FORBIDDEN
 * unless `scope.allowGovernanceMutation` is explicitly `true`.
 */
export function assertGovernanceAllowed(
  principalKind: "user" | "token",
  scope: TokenScope,
  action: string,
): void {
  if (principalKind === "token" && scope.allowGovernanceMutation !== true) {
    throw new InkadeError(
      "FORBIDDEN",
      `Governance mutation "${action}" is owner-only; API tokens require allowGovernanceMutation: true`,
    );
  }
}

const PERMISSION_BY_RANK: readonly TokenPermission[] = ["read", "append", "write", "admin"];

/**
 * Computes the strict intersection of two TokenScopes so scheduled/delegated executions
 * can never exceed either the caller principal or an assigned token scope policy.
 */
export function intersectTokenScopes(
  base: TokenScope,
  overlay: TokenScope,
  allSpaces: readonly Pick<Space, "id" | "parentId">[],
  options?: { readonly forceDenyHardDelete?: boolean | undefined },
): TokenScope {
  const minRank = Math.min(PERMISSION_RANK[base.permission], PERMISSION_RANK[overlay.permission]);
  const permission = PERMISSION_BY_RANK[Math.max(0, minRank - 1)] ?? "read";

  const baseSpaces = resolveAllowedSpaceIds(base, allSpaces);
  const overlaySpaces = resolveAllowedSpaceIds(overlay, allSpaces);

  let spaceIds: "*" | SpaceId[];
  let includeDescendants = false;
  if (baseSpaces === "*" && overlaySpaces === "*") {
    spaceIds = "*";
    includeDescendants = base.includeDescendants && overlay.includeDescendants;
  } else if (baseSpaces === "*") {
    spaceIds = overlaySpaces === "*" ? "*" : [...overlaySpaces];
  } else if (overlaySpaces === "*") {
    spaceIds = [...baseSpaces];
  } else {
    spaceIds = [...baseSpaces].filter((id) => overlaySpaces.has(id));
  }

  let tagAllowlist: string[] | undefined;
  if (base.tagAllowlist && base.tagAllowlist.length > 0 && overlay.tagAllowlist && overlay.tagAllowlist.length > 0) {
    const overlayTagSet = new Set(overlay.tagAllowlist);
    tagAllowlist = base.tagAllowlist.filter((t) => overlayTagSet.has(t));
  } else if (base.tagAllowlist && base.tagAllowlist.length > 0) {
    tagAllowlist = [...base.tagAllowlist];
  } else if (overlay.tagAllowlist && overlay.tagAllowlist.length > 0) {
    tagAllowlist = [...overlay.tagAllowlist];
  }

  let allowedKinds: DocumentKind[] | undefined;
  if (base.allowedKinds && overlay.allowedKinds) {
    const overlayKindSet = new Set(overlay.allowedKinds);
    allowedKinds = base.allowedKinds.filter((k) => overlayKindSet.has(k));
  } else if (base.allowedKinds) {
    allowedKinds = [...base.allowedKinds];
  } else if (overlay.allowedKinds) {
    allowedKinds = [...overlay.allowedKinds];
  }

  return {
    permission,
    spaceIds,
    includeDescendants,
    ...(tagAllowlist !== undefined ? { tagAllowlist } : {}),
    ...(allowedKinds !== undefined ? { allowedKinds } : {}),
    denyHardDelete: options?.forceDenyHardDelete === true || base.denyHardDelete || overlay.denyHardDelete,
    ...(base.allowGovernanceMutation === true && overlay.allowGovernanceMutation === true
      ? { allowGovernanceMutation: true }
      : {}),
  };
}

/**
 * Maps a Quiet Autonomy execution mode onto a server-enforced TokenScope patch.
 * Hard delete is ALWAYS denied regardless of execution mode.
 */
export function quietModeToScopePatch(
  mode: QuietAutonomyMode,
): Pick<TokenScope, "permission" | "denyHardDelete"> {
  switch (mode) {
    case "autonomous":
      return { permission: "write", denyHardDelete: true };
    case "sandbox_only":
      return { permission: "append", denyHardDelete: true };
    case "read_only":
      return { permission: "read", denyHardDelete: true };
    default: {
      const _exhaustive: never = mode;
      return _exhaustive;
    }
  }
}

/**
 * Summarizes effective Quiet Autonomy guardrails for a TokenScope.
 * Under Quiet Autonomy, agents never hit intrusive pre-write approval prompts;
 * boundaries are enforced via space/tag scopes, hard-delete locks, and 1-click batch rollback.
 */
export function deriveQuietGovernanceSummary(scope: TokenScope): QuietGovernanceSummary {
  switch (scope.permission) {
    case "admin":
      return {
        mode: "autonomous",
        allowedActions: ["read", "append", "write", "soft_delete", "admin"],
        blockedActions: scope.denyHardDelete ? ["hard_delete"] : [],
        rollbackGuaranteed: true,
      };
    case "write":
      return {
        mode: "autonomous",
        allowedActions: ["read", "append", "write", "soft_delete"],
        blockedActions: ["hard_delete", "admin"],
        rollbackGuaranteed: true,
      };
    case "append":
      return {
        mode: "sandbox_only",
        allowedActions: ["read", "append"],
        blockedActions: ["write", "soft_delete", "hard_delete", "admin"],
        rollbackGuaranteed: true,
      };
    case "read":
      return {
        mode: "read_only",
        allowedActions: ["read"],
        blockedActions: ["append", "write", "soft_delete", "hard_delete", "admin"],
        rollbackGuaranteed: true,
      };
    default: {
      const _exhaustive: never = scope.permission;
      return _exhaustive;
    }
  }
}

/**
 * Maps a high-level agent autonomy preset onto a server-enforced TokenScope patch.
 * Hard delete is ALWAYS denied regardless of autonomy level.
 */
export function autonomyLevelToScopePatch(
  level: AutonomyLevel,
): Pick<TokenScope, "permission" | "denyHardDelete"> {
  switch (level) {
    case "auto":
      return quietModeToScopePatch("autonomous");
    case "draft":
      return quietModeToScopePatch("sandbox_only");
    case "ask":
      return quietModeToScopePatch("read_only");
    default: {
      const _exhaustive: never = level;
      return _exhaustive;
    }
  }
}

/**
 * Summarizes effective autonomous, approval-gated, and locked actions for a TokenScope.
 * Kept for compatibility with legacy callers; routine writes never gate behind human pre-approval.
 */
export function deriveAutonomyPolicy(scope: TokenScope): AutonomyPolicySummary {
  const quiet = deriveQuietGovernanceSummary(scope);
  switch (scope.permission) {
    case "admin":
    case "write":
      return {
        level: "auto",
        autoActions: quiet.allowedActions,
        approvalRequiredActions: [],
        lockedActions: quiet.blockedActions,
      };
    case "append":
      return {
        level: "draft",
        autoActions: quiet.allowedActions,
        approvalRequiredActions: [],
        lockedActions: quiet.blockedActions,
      };
    case "read":
      return {
        level: "ask",
        autoActions: quiet.allowedActions,
        approvalRequiredActions: [],
        lockedActions: quiet.blockedActions,
      };
    default: {
      const _exhaustive: never = scope.permission;
      return _exhaustive;
    }
  }
}
