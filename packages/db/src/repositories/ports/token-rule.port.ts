import type {
  ApiTokenId,
  ApiTokenRecord,
  CreateApiTokenInput,
  ProjectScopeRule,
  ProjectScopeRuleInput,
  UpdateApiTokenInput,
} from "@inkade/core";

export interface CreateApiTokenRecordInput extends CreateApiTokenInput {
  readonly id?: ApiTokenId | undefined;
  readonly tokenHash: string;
  readonly tokenPrefix: string;
}

export interface ApiTokenWithHash {
  readonly token: ApiTokenRecord;
  readonly tokenHash: string;
}

export interface TokenRuleRepo {
  createApiToken(workspaceId: string, input: CreateApiTokenRecordInput): Promise<ApiTokenRecord>;
  findApiTokenByHash(tokenHash: string): Promise<ApiTokenWithHash | null>;
  getApiTokenById(workspaceId: string, tokenId: string): Promise<ApiTokenRecord | null>;
  listApiTokens(workspaceId: string): Promise<readonly ApiTokenRecord[]>;
  updateApiToken(
    workspaceId: string,
    tokenId: string,
    input: UpdateApiTokenInput,
  ): Promise<ApiTokenRecord>;
  revokeApiToken(workspaceId: string, tokenId: string): Promise<ApiTokenRecord>;
  touchApiTokenLastUsed(tokenId: string, atIso?: string): Promise<void>;

  listProjectScopeRules(workspaceId: string): Promise<readonly ProjectScopeRule[]>;
  getProjectScopeRuleById(
    workspaceId: string,
    ruleId: string,
  ): Promise<ProjectScopeRule | null>;
  createProjectScopeRule(
    workspaceId: string,
    input: ProjectScopeRuleInput,
    options?: { readonly id?: string | undefined },
  ): Promise<ProjectScopeRule>;
  updateProjectScopeRule(
    workspaceId: string,
    ruleId: string,
    input: Partial<ProjectScopeRuleInput>,
  ): Promise<ProjectScopeRule>;
  deleteProjectScopeRule(workspaceId: string, ruleId: string): Promise<void>;
}
