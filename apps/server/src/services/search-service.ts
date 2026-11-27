import {
  resolveAllowedSpaceIds,
  type SearchHit,
  type SearchQueryInput,
} from "@inkade/core";
import type { SearchConfigRepo, SpaceRepo } from "@inkade/db";
import type { WorkspaceSpacesCache } from "../cache/workspace-spaces-cache.ts";
import type { Principal } from "../types.ts";
import { assertScope, getAllWorkspaceSpaces } from "./scope-guard.ts";

export class SearchService {
  constructor(
    private readonly searchConfigRepo: SearchConfigRepo,
    private readonly spaceRepo: SpaceRepo,
    private readonly spacesCache?: WorkspaceSpacesCache,
  ) {}

  async search(principal: Principal, input: SearchQueryInput): Promise<readonly SearchHit[]> {
    const allSpaces = await getAllWorkspaceSpaces(
      this.spacesCache ?? this.spaceRepo,
      principal.workspaceId,
    );

    if (input.spaceId) {
      assertScope(
        principal.scope,
        "read",
        { spaceId: input.spaceId, resourceType: "space" },
        allSpaces,
      );
    }

    const allowedSpaces = resolveAllowedSpaceIds(principal.scope, allSpaces);
    const searchSpaceIds = input.spaceId
      ? [input.spaceId]
      : allowedSpaces === "*"
        ? undefined
        : [...allowedSpaces];

    if (searchSpaceIds && searchSpaceIds.length === 0) {
      return [];
    }
    if (principal.scope.allowedKinds && principal.scope.allowedKinds.length === 0) {
      return [];
    }

    return this.searchConfigRepo.searchFts(principal.workspaceId, input.q, {
      spaceIds: searchSpaceIds,
      kind: input.kind,
      allowedKinds: principal.scope.allowedKinds,
      tag: input.tag,
      tagAllowlist: principal.scope.tagAllowlist,
      limit: input.limit ?? 25,
    });
  }
}
