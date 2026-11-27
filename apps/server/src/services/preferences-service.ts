import type { UserPreferencesPatch, UserPreferencesRecord } from "@inkade/core";
import type { SearchConfigRepo } from "@inkade/db";
import type { SseHub } from "../realtime/sse-hub.ts";
import type { Principal } from "../types.ts";

export function resolvePreferencePrincipalKey(principal: Principal): string {
  if (principal.kind === "user") {
    return `user:${principal.userId}`;
  }
  return `token:${principal.tokenId}`;
}

export class PreferencesService {
  constructor(
    private readonly searchConfigRepo: SearchConfigRepo,
    private readonly sseHub: SseHub,
  ) {}

  async getPreferences(principal: Principal): Promise<UserPreferencesRecord> {
    const principalKey = resolvePreferencePrincipalKey(principal);
    return this.searchConfigRepo.getUserPreferences(principal.workspaceId, principalKey);
  }

  async updatePreferences(
    principal: Principal,
    patch: UserPreferencesPatch,
  ): Promise<UserPreferencesRecord> {
    const principalKey = resolvePreferencePrincipalKey(principal);
    const updated = await this.searchConfigRepo.upsertUserPreferences(
      principal.workspaceId,
      principalKey,
      patch,
    );
    this.sseHub.publish({
      type: "preferences.updated",
      workspaceId: principal.workspaceId,
      spaceId: null,
      actorType: principal.actorType,
      payload: {
        principalKey,
        updatedAt: updated.updatedAt,
      },
    });
    return updated;
  }
}
