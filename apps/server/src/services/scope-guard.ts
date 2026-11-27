import {
  evaluateScopeAccess,
  InkadeError,
  type DocumentId,
  type OutlineNodeId,
  type ScopeAction,
  type ScopeTarget,
  type Space,
  type TokenScope,
  type WorkspaceId,
} from "@inkade/core";
import type { OutlineRepo, SpaceRepo } from "@inkade/db";
import type { WorkspaceSpacesCache } from "../cache/workspace-spaces-cache.ts";
import type { Principal } from "../types.ts";

export type WorkspaceSpacesSource = WorkspaceSpacesCache | SpaceRepo;

export async function getAllWorkspaceSpaces(
  source: WorkspaceSpacesSource,
  workspaceId: WorkspaceId,
): Promise<readonly Space[]> {
  if ("getAll" in source) {
    return source.getAll(workspaceId);
  }
  return source.listSpaces(workspaceId, { includeArchived: true });
}

export function assertScope(
  scope: TokenScope,
  action: ScopeAction,
  target: ScopeTarget,
  allSpaces: readonly Pick<Space, "id" | "parentId">[],
): void {
  const decision = evaluateScopeAccess(scope, action, target, allSpaces);
  if (!decision.allowed) {
    if (action === "hard_delete" && scope.denyHardDelete) {
      throw new InkadeError(
        "HARD_DELETE_BLOCKED",
        decision.reason ?? "hard_delete is blocked by token policy",
      );
    }
    throw new InkadeError("FORBIDDEN", decision.reason ?? `Access denied for "${action}"`);
  }
}

export function assertAdminPrincipal(
  principal: Principal,
  allSpaces: readonly Pick<Space, "id" | "parentId">[],
): void {
  if (principal.scope.permission !== "admin" || principal.scope.spaceIds !== "*") {
    throw new InkadeError("FORBIDDEN", "Admin permission across all spaces is required");
  }
  assertScope(principal.scope, "admin", { spaceId: "*", resourceType: "space" }, allSpaces);
}

export async function resolveOutlineNodeDocumentId(
  outlineRepo: OutlineRepo,
  workspaceId: WorkspaceId,
  nodeId: OutlineNodeId,
): Promise<DocumentId> {
  const documentId = await outlineRepo.findDocumentIdByNodeId(workspaceId, nodeId);
  if (!documentId) {
    throw new InkadeError("NOT_FOUND", `Outline node "${nodeId}" not found`);
  }
  return documentId;
}
