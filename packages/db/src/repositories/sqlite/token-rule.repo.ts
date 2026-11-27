import { and, asc, desc, eq } from "drizzle-orm";
import {
  createId,
  ID_PREFIXES,
  InkadeError,
  type ApiTokenRecord,
  type ProjectScopeRule,
  type ProjectScopeRuleInput,
  type UpdateApiTokenInput,
} from "@inkade/core";
import { apiTokens, projectScopeRules } from "../../schema/sqlite.ts";
import type {
  ApiTokenWithHash,
  CreateApiTokenRecordInput,
  TokenRuleRepo,
} from "../ports/token-rule.port.ts";
import { nowIso, syncToPromise, type SqliteRepoContext } from "./helpers.ts";
import { mapApiTokenRow, mapProjectRuleRow } from "./mappers.ts";

export class SqliteTokenRuleRepo implements TokenRuleRepo {
  constructor(private readonly ctx: SqliteRepoContext) {}

  createApiToken(workspaceId: string, input: CreateApiTokenRecordInput): Promise<ApiTokenRecord> {
    return syncToPromise(() => {
      const tokenId = input.id ?? createId(ID_PREFIXES.apiToken);
      const ts = nowIso();
      const row: typeof apiTokens.$inferSelect = {
        id: tokenId,
        workspaceId,
        name: input.name,
        tokenHash: input.tokenHash,
        tokenPrefix: input.tokenPrefix,
        scopeJson: JSON.stringify(input.scope),
        expiresAt: input.expiresAt ?? null,
        revokedAt: null,
        lastUsedAt: null,
        createdAt: ts,
        updatedAt: ts,
      };
      this.ctx.db.insert(apiTokens).values(row).run();
      return mapApiTokenRow(row);
    });
  }

  findApiTokenByHash(tokenHash: string): Promise<ApiTokenWithHash | null> {
    return syncToPromise(() => {
      const row = this.ctx.db
        .select()
        .from(apiTokens)
        .where(eq(apiTokens.tokenHash, tokenHash))
        .get();
      if (!row) return null;
      return {
        token: mapApiTokenRow(row),
        tokenHash: row.tokenHash,
      };
    });
  }

  getApiTokenById(workspaceId: string, tokenId: string): Promise<ApiTokenRecord | null> {
    return syncToPromise(() => {
      const row = this.ctx.db
        .select()
        .from(apiTokens)
        .where(and(eq(apiTokens.workspaceId, workspaceId), eq(apiTokens.id, tokenId)))
        .get();
      return row ? mapApiTokenRow(row) : null;
    });
  }

  listApiTokens(workspaceId: string): Promise<readonly ApiTokenRecord[]> {
    return syncToPromise(() => {
      const rows = this.ctx.db
        .select()
        .from(apiTokens)
        .where(eq(apiTokens.workspaceId, workspaceId))
        .orderBy(desc(apiTokens.createdAt))
        .all();
      return rows.map(mapApiTokenRow);
    });
  }

  updateApiToken(
    workspaceId: string,
    tokenId: string,
    input: UpdateApiTokenInput,
  ): Promise<ApiTokenRecord> {
    return syncToPromise(() => {
      const current = this.ctx.db
        .select()
        .from(apiTokens)
        .where(and(eq(apiTokens.workspaceId, workspaceId), eq(apiTokens.id, tokenId)))
        .get();
      if (!current) {
        throw new InkadeError("NOT_FOUND", `API token "${tokenId}" not found`);
      }
      const ts = nowIso();
      this.ctx.db
        .update(apiTokens)
        .set({
          name: input.name ?? current.name,
          scopeJson: input.scope ? JSON.stringify(input.scope) : current.scopeJson,
          expiresAt: input.expiresAt !== undefined ? input.expiresAt : current.expiresAt,
          updatedAt: ts,
        })
        .where(eq(apiTokens.id, tokenId))
        .run();

      const updated = this.ctx.db.select().from(apiTokens).where(eq(apiTokens.id, tokenId)).get();
      if (!updated) {
        throw new InkadeError("INTERNAL_ERROR", "Failed to read updated API token");
      }
      return mapApiTokenRow(updated);
    });
  }

  revokeApiToken(workspaceId: string, tokenId: string): Promise<ApiTokenRecord> {
    return syncToPromise(() => {
      const current = this.ctx.db
        .select()
        .from(apiTokens)
        .where(and(eq(apiTokens.workspaceId, workspaceId), eq(apiTokens.id, tokenId)))
        .get();
      if (!current) {
        throw new InkadeError("NOT_FOUND", `API token "${tokenId}" not found`);
      }
      const ts = current.revokedAt ?? nowIso();
      this.ctx.db
        .update(apiTokens)
        .set({ revokedAt: ts, updatedAt: nowIso() })
        .where(eq(apiTokens.id, tokenId))
        .run();

      const updated = this.ctx.db.select().from(apiTokens).where(eq(apiTokens.id, tokenId)).get();
      if (!updated) {
        throw new InkadeError("INTERNAL_ERROR", "Failed to read revoked API token");
      }
      return mapApiTokenRow(updated);
    });
  }

  touchApiTokenLastUsed(tokenId: string, atIso?: string): Promise<void> {
    return syncToPromise(() => {
      this.ctx.db
        .update(apiTokens)
        .set({ lastUsedAt: atIso ?? nowIso() })
        .where(eq(apiTokens.id, tokenId))
        .run();
    });
  }

  listProjectScopeRules(workspaceId: string): Promise<readonly ProjectScopeRule[]> {
    return syncToPromise(() => {
      const rows = this.ctx.db
        .select()
        .from(projectScopeRules)
        .where(eq(projectScopeRules.workspaceId, workspaceId))
        .orderBy(desc(projectScopeRules.priority), asc(projectScopeRules.createdAt))
        .all();
      return rows.map(mapProjectRuleRow);
    });
  }

  getProjectScopeRuleById(
    workspaceId: string,
    ruleId: string,
  ): Promise<ProjectScopeRule | null> {
    return syncToPromise(() => {
      const row = this.ctx.db
        .select()
        .from(projectScopeRules)
        .where(
          and(
            eq(projectScopeRules.workspaceId, workspaceId),
            eq(projectScopeRules.id, ruleId),
          ),
        )
        .get();
      return row ? mapProjectRuleRow(row) : null;
    });
  }

  createProjectScopeRule(
    workspaceId: string,
    input: ProjectScopeRuleInput,
    options?: { readonly id?: string | undefined },
  ): Promise<ProjectScopeRule> {
    return syncToPromise(() => {
      const ruleId = options?.id ?? createId(ID_PREFIXES.projectRule);
      const ts = nowIso();
      const row: typeof projectScopeRules.$inferSelect = {
        id: ruleId,
        workspaceId,
        matchType: input.matchType,
        pattern: input.pattern,
        writableSpaceIdsJson: JSON.stringify(input.writableSpaceIds ?? []),
        readonlySpaceIdsJson: JSON.stringify(input.readonlySpaceIds ?? []),
        defaultInboxSpaceId: input.defaultInboxSpaceId ?? null,
        defaultResearchSpaceId: input.defaultResearchSpaceId ?? null,
        extraInstructions: input.extraInstructions ?? null,
        priority: input.priority ?? 100,
        createdAt: ts,
        updatedAt: ts,
      };
      this.ctx.db.insert(projectScopeRules).values(row).run();
      return mapProjectRuleRow(row);
    });
  }

  updateProjectScopeRule(
    workspaceId: string,
    ruleId: string,
    input: Partial<ProjectScopeRuleInput>,
  ): Promise<ProjectScopeRule> {
    return syncToPromise(() => {
      const current = this.ctx.db
        .select()
        .from(projectScopeRules)
        .where(
          and(
            eq(projectScopeRules.workspaceId, workspaceId),
            eq(projectScopeRules.id, ruleId),
          ),
        )
        .get();
      if (!current) {
        throw new InkadeError("NOT_FOUND", `Project scope rule "${ruleId}" not found`);
      }

      const ts = nowIso();
      this.ctx.db
        .update(projectScopeRules)
        .set({
          matchType: input.matchType ?? current.matchType,
          pattern: input.pattern ?? current.pattern,
          writableSpaceIdsJson:
            input.writableSpaceIds !== undefined
              ? JSON.stringify(input.writableSpaceIds)
              : current.writableSpaceIdsJson,
          readonlySpaceIdsJson:
            input.readonlySpaceIds !== undefined
              ? JSON.stringify(input.readonlySpaceIds)
              : current.readonlySpaceIdsJson,
          defaultInboxSpaceId:
            input.defaultInboxSpaceId !== undefined
              ? input.defaultInboxSpaceId
              : current.defaultInboxSpaceId,
          defaultResearchSpaceId:
            input.defaultResearchSpaceId !== undefined
              ? input.defaultResearchSpaceId
              : current.defaultResearchSpaceId,
          extraInstructions:
            input.extraInstructions !== undefined
              ? input.extraInstructions
              : current.extraInstructions,
          priority: input.priority ?? current.priority,
          updatedAt: ts,
        })
        .where(eq(projectScopeRules.id, ruleId))
        .run();

      const updated = this.ctx.db
        .select()
        .from(projectScopeRules)
        .where(eq(projectScopeRules.id, ruleId))
        .get();
      if (!updated) {
        throw new InkadeError("INTERNAL_ERROR", "Failed to read updated project scope rule");
      }
      return mapProjectRuleRow(updated);
    });
  }

  deleteProjectScopeRule(workspaceId: string, ruleId: string): Promise<void> {
    return syncToPromise(() => {
      const existing = this.ctx.db
        .select({ id: projectScopeRules.id })
        .from(projectScopeRules)
        .where(
          and(
            eq(projectScopeRules.workspaceId, workspaceId),
            eq(projectScopeRules.id, ruleId),
          ),
        )
        .get();
      if (!existing) {
        throw new InkadeError("NOT_FOUND", `Project scope rule "${ruleId}" not found`);
      }
      this.ctx.db.delete(projectScopeRules).where(eq(projectScopeRules.id, ruleId)).run();
    });
  }
}
