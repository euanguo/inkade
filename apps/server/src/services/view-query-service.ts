import {
  evaluateScopeAccess,
  evaluateViewQueryOnDocuments,
  isSystemInternalDocument,
  resolveAllowedSpaceIds,
  type DocumentSummary,
  type PropertyFieldDefinition,
  type ViewQueryRequest,
  type ViewQueryResponse,
} from "@inkade/core";
import type { DocumentRepo, SpaceRepo } from "@inkade/db";
import type { WorkspaceSpacesCache } from "../cache/workspace-spaces-cache.ts";
import type { Principal } from "../types.ts";
import { assertScope, getAllWorkspaceSpaces } from "./scope-guard.ts";

export class ViewQueryService {
  constructor(
    private readonly documentRepo: DocumentRepo,
    private readonly spaceRepo: SpaceRepo,
    private readonly spacesCache?: WorkspaceSpacesCache,
  ) {}

  async queryView(principal: Principal, input: ViewQueryRequest): Promise<ViewQueryResponse> {
    const allSpaces = await getAllWorkspaceSpaces(
      this.spacesCache ?? this.spaceRepo,
      principal.workspaceId,
    );

    if (input.spaceId) {
      const targetExists = allSpaces.some((space) => space.id === input.spaceId);
      if (targetExists) {
        assertScope(
          principal.scope,
          "read",
          { spaceId: input.spaceId, resourceType: "space" },
          allSpaces,
        );
      } else {
        return {
          documents: [],
          totalCount: 0,
          limit: input.limit ?? 50,
          offset: input.offset ?? 0,
          schemaFields: [],
          numericAggregates: [],
        };
      }
    }

    const allowedSpaces = resolveAllowedSpaceIds(principal.scope, allSpaces);
    const spaceFilterIds = input.spaceId
      ? [input.spaceId]
      : allowedSpaces === "*"
        ? undefined
        : [...allowedSpaces];

    const candidates = await this.documentRepo.listDocuments(principal.workspaceId, {
      spaceIds: spaceFilterIds,
      allowedKinds: principal.scope.allowedKinds,
      tagAllowlist: principal.scope.tagAllowlist,
      includeTrashed: false,
      limit: null,
    });

    const authorizedDocs: DocumentSummary[] = candidates.filter(
      (doc) =>
        doc.trashedAt === null &&
        !isSystemInternalDocument(doc) &&
        evaluateScopeAccess(
          principal.scope,
          "read",
          { spaceId: doc.spaceId, kind: doc.kind, tags: doc.tags },
          allSpaces,
        ).allowed,
    );

    const schemaFields: PropertyFieldDefinition[] = [];
    if (input.spaceId) {
      const schema = await this.spaceRepo.getSpacePropertySchema(principal.workspaceId, {
        spaceId: input.spaceId,
      });
      if (schema) {
        schemaFields.push(...schema.fields);
      }
    } else {
      const allSchemas = await this.spaceRepo.listSpacePropertySchemas(principal.workspaceId);
      const seenKeys = new Set<string>();
      for (const schema of allSchemas) {
        if (!schema.spaceId) continue;
        const spaceAllowed = evaluateScopeAccess(
          principal.scope,
          "read",
          { spaceId: schema.spaceId, resourceType: "space" },
          allSpaces,
        ).allowed;
        if (!spaceAllowed) continue;
        for (const field of schema.fields) {
          if (seenKeys.has(field.key)) continue;
          seenKeys.add(field.key);
          schemaFields.push(field);
        }
      }
    }

    return evaluateViewQueryOnDocuments(authorizedDocs, schemaFields, input);
  }
}
