import {
  assertGovernanceAllowed,
  type ProjectRuleId,
  type ProjectScopeRule,
  type ProjectScopeRuleInput,
} from "@inkade/core";
import type { SpaceRepo, TokenRuleRepo } from "@inkade/db";
import type { WorkspaceSpacesCache } from "../cache/workspace-spaces-cache.ts";
import type { Principal } from "../types.ts";
import { assertAdminPrincipal, getAllWorkspaceSpaces } from "./scope-guard.ts";

export type UpdateProjectScopeRuleInput = {
  readonly [K in keyof ProjectScopeRuleInput]?: ProjectScopeRuleInput[K] | undefined;
};

export class ScopeRuleService {
  constructor(
    private readonly tokenRuleRepo: TokenRuleRepo,
    private readonly spaceRepo: SpaceRepo,
    private readonly spacesCache?: WorkspaceSpacesCache,
  ) {}

  async listRules(principal: Principal): Promise<readonly ProjectScopeRule[]> {
    return this.tokenRuleRepo.listProjectScopeRules(principal.workspaceId);
  }

  async createRule(
    principal: Principal,
    input: ProjectScopeRuleInput,
  ): Promise<ProjectScopeRule> {
    assertGovernanceAllowed(principal.kind, principal.scope, "scope_rule.create");
    const allSpaces = await getAllWorkspaceSpaces(
      this.spacesCache ?? this.spaceRepo,
      principal.workspaceId,
    );
    assertAdminPrincipal(principal, allSpaces);
    return this.tokenRuleRepo.createProjectScopeRule(principal.workspaceId, input);
  }

  async updateRule(
    principal: Principal,
    ruleId: ProjectRuleId,
    input: UpdateProjectScopeRuleInput,
  ): Promise<ProjectScopeRule> {
    assertGovernanceAllowed(principal.kind, principal.scope, "scope_rule.update");
    const allSpaces = await getAllWorkspaceSpaces(
      this.spacesCache ?? this.spaceRepo,
      principal.workspaceId,
    );
    assertAdminPrincipal(principal, allSpaces);
    const cleaned = Object.fromEntries(
      Object.entries(input).filter(([, value]) => value !== undefined),
    ) as Partial<ProjectScopeRuleInput>;
    return this.tokenRuleRepo.updateProjectScopeRule(principal.workspaceId, ruleId, cleaned);
  }

  async deleteRule(principal: Principal, ruleId: ProjectRuleId): Promise<void> {
    assertGovernanceAllowed(principal.kind, principal.scope, "scope_rule.delete");
    const allSpaces = await getAllWorkspaceSpaces(
      this.spacesCache ?? this.spaceRepo,
      principal.workspaceId,
    );
    assertAdminPrincipal(principal, allSpaces);
    await this.tokenRuleRepo.deleteProjectScopeRule(principal.workspaceId, ruleId);
  }
}
