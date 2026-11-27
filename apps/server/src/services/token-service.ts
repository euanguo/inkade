import {
  assertGovernanceAllowed,
  evaluateScopeAccess,
  summarizeEffectiveScope,
  type ApiTokenId,
  type ApiTokenRecord,
  type CreateApiTokenInput,
  type ScopeEffectiveSummary,
  type Space,
  type TokenScope,
  type UpdateApiTokenInput,
  type UserId,
  type WorkspaceId,
} from "@inkade/core";
import type { SpaceRepo, TokenRuleRepo } from "@inkade/db";
import { generateRawApiToken, sha256Hex } from "../auth/tokens.ts";
import type { TokenScopeCache } from "../cache/token-scope-cache.ts";
import type { WorkspaceSpacesCache } from "../cache/workspace-spaces-cache.ts";
import type { SseHub } from "../realtime/sse-hub.ts";
import type { Principal } from "../types.ts";
import { assertAdminPrincipal, getAllWorkspaceSpaces } from "./scope-guard.ts";

export interface WhoAmIScopeResult {
  readonly workspaceId: WorkspaceId;
  readonly principalKind: "token" | "user";
  readonly tokenId: ApiTokenId | null;
  readonly tokenName: string;
  readonly userId: UserId | null;
  readonly scope: TokenScope;
  readonly visibleSpaces: readonly Space[];
  readonly effectiveSummary: ScopeEffectiveSummary;
}

export interface CreateApiTokenResult {
  readonly token: ApiTokenRecord;
  readonly rawToken: string;
}

export class TokenService {
  constructor(
    private readonly tokenRuleRepo: TokenRuleRepo,
    private readonly spaceRepo: SpaceRepo,
    private readonly sseHub: SseHub,
    private readonly spacesCache?: WorkspaceSpacesCache,
    private readonly tokenScopeCache?: TokenScopeCache,
  ) {}

  async whoamiScope(principal: Principal): Promise<WhoAmIScopeResult> {
    const allSpaces = await getAllWorkspaceSpaces(
      this.spacesCache ?? this.spaceRepo,
      principal.workspaceId,
    );
    const activeSpaces = allSpaces.filter((s) => s.archivedAt === null);
    const visibleSpaces = activeSpaces.filter(
      (space) =>
        evaluateScopeAccess(
          principal.scope,
          "read",
          { spaceId: space.id, resourceType: "space" },
          allSpaces,
        ).allowed,
    );

    return {
      workspaceId: principal.workspaceId,
      principalKind: principal.kind,
      tokenId: principal.kind === "token" ? principal.tokenId : null,
      tokenName: principal.kind === "token" ? principal.tokenName : "Owner Session",
      userId: principal.kind === "user" ? principal.userId : null,
      scope: principal.scope,
      visibleSpaces,
      effectiveSummary: summarizeEffectiveScope(principal.scope, allSpaces),
    };
  }

  async listTokens(principal: Principal): Promise<readonly ApiTokenRecord[]> {
    const allSpaces = await getAllWorkspaceSpaces(
      this.spacesCache ?? this.spaceRepo,
      principal.workspaceId,
    );
    assertAdminPrincipal(principal, allSpaces);
    return this.tokenRuleRepo.listApiTokens(principal.workspaceId);
  }

  async createToken(
    principal: Principal,
    input: CreateApiTokenInput,
  ): Promise<CreateApiTokenResult> {
    assertGovernanceAllowed(principal.kind, principal.scope, "token.create");
    const allSpaces = await getAllWorkspaceSpaces(
      this.spacesCache ?? this.spaceRepo,
      principal.workspaceId,
    );
    assertAdminPrincipal(principal, allSpaces);

    const { rawToken, tokenPrefix } = generateRawApiToken();
    const tokenHash = await sha256Hex(rawToken);
    const token = await this.tokenRuleRepo.createApiToken(principal.workspaceId, {
      ...input,
      tokenHash,
      tokenPrefix,
    });

    this.sseHub.publish({
      type: "token.updated",
      workspaceId: principal.workspaceId,
      spaceId: null,
      actorType: principal.actorType,
      payload: { action: "created", token },
    });

    return { token, rawToken };
  }

  async updateToken(
    principal: Principal,
    tokenId: ApiTokenId,
    input: UpdateApiTokenInput,
  ): Promise<ApiTokenRecord> {
    assertGovernanceAllowed(principal.kind, principal.scope, "token.update");
    const allSpaces = await getAllWorkspaceSpaces(
      this.spacesCache ?? this.spaceRepo,
      principal.workspaceId,
    );
    assertAdminPrincipal(principal, allSpaces);

    const token = await this.tokenRuleRepo.updateApiToken(principal.workspaceId, tokenId, input);
    this.tokenScopeCache?.invalidateToken(tokenId, principal.workspaceId);
    this.sseHub.publish({
      type: "token.updated",
      workspaceId: principal.workspaceId,
      spaceId: null,
      actorType: principal.actorType,
      payload: { action: "updated", token },
    });

    return token;
  }

  async revokeToken(principal: Principal, tokenId: ApiTokenId): Promise<ApiTokenRecord> {
    assertGovernanceAllowed(principal.kind, principal.scope, "token.revoke");
    const allSpaces = await getAllWorkspaceSpaces(
      this.spacesCache ?? this.spaceRepo,
      principal.workspaceId,
    );
    assertAdminPrincipal(principal, allSpaces);

    const token = await this.tokenRuleRepo.revokeApiToken(principal.workspaceId, tokenId);
    this.tokenScopeCache?.invalidateToken(tokenId, principal.workspaceId);
    this.sseHub.publish({
      type: "token.updated",
      workspaceId: principal.workspaceId,
      spaceId: null,
      actorType: principal.actorType,
      payload: { action: "revoked", token },
    });

    return token;
  }
}
