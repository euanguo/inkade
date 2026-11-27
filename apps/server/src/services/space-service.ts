import {
  evaluateScopeAccess,
  InkadeError,
  spacePropertySchemaFieldsArraySchema,
  type CreateSpaceInput,
  type Space,
  type SpaceId,
  type SpacePropertySchema,
  type TemplateId,
  type UpdateSpaceInput,
  type UpsertSpacePropertySchemaInput,
} from "@inkade/core";
import type { ListSpacesOptions, SpaceRepo } from "@inkade/db";
import type { WorkspaceSpacesCache } from "../cache/workspace-spaces-cache.ts";
import type { SseHub } from "../realtime/sse-hub.ts";
import type { Principal } from "../types.ts";
import { assertAdminPrincipal, assertScope, getAllWorkspaceSpaces } from "./scope-guard.ts";

export class SpaceService {
  constructor(
    private readonly spaceRepo: SpaceRepo,
    private readonly sseHub: SseHub,
    private readonly spacesCache?: WorkspaceSpacesCache,
  ) {}

  async listSpaces(
    principal: Principal,
    options?: ListSpacesOptions,
  ): Promise<readonly Space[]> {
    const allSpaces = await getAllWorkspaceSpaces(
      this.spacesCache ?? this.spaceRepo,
      principal.workspaceId,
    );
    const spaces = options?.includeArchived
      ? allSpaces
      : allSpaces.filter((space) => space.archivedAt === null);

    return spaces.filter(
      (space) =>
        evaluateScopeAccess(
          principal.scope,
          "read",
          { spaceId: space.id, resourceType: "space" },
          allSpaces,
        ).allowed,
    );
  }

  async getSpace(principal: Principal, spaceId: SpaceId): Promise<Space> {
    const allSpaces = await getAllWorkspaceSpaces(
      this.spacesCache ?? this.spaceRepo,
      principal.workspaceId,
    );
    const space = allSpaces.find((item) => item.id === spaceId);
    if (!space) {
      throw new InkadeError("NOT_FOUND", `Space "${spaceId}" not found`);
    }
    assertScope(principal.scope, "read", { spaceId: space.id, resourceType: "space" }, allSpaces);
    return space;
  }

  async createSpace(principal: Principal, input: CreateSpaceInput): Promise<Space> {
    const allSpaces = await getAllWorkspaceSpaces(
      this.spacesCache ?? this.spaceRepo,
      principal.workspaceId,
    );

    if (input.parentId) {
      assertScope(
        principal.scope,
        "write",
        { spaceId: input.parentId, resourceType: "space" },
        allSpaces,
      );
    } else {
      assertScope(principal.scope, "write", { spaceId: "*", resourceType: "space" }, allSpaces);
    }

    const created = await this.spaceRepo.createSpace(principal.workspaceId, input);
    this.spacesCache?.invalidate(principal.workspaceId);
    this.sseHub.publish({
      type: "space.created",
      workspaceId: principal.workspaceId,
      spaceId: created.id,
      actorType: principal.actorType,
      payload: { space: created },
    });
    return created;
  }

  async updateSpace(
    principal: Principal,
    spaceId: SpaceId,
    input: UpdateSpaceInput,
  ): Promise<Space> {
    const allSpaces = await getAllWorkspaceSpaces(
      this.spacesCache ?? this.spaceRepo,
      principal.workspaceId,
    );
    const current = allSpaces.find((item) => item.id === spaceId);
    if (!current) {
      throw new InkadeError("NOT_FOUND", `Space "${spaceId}" not found`);
    }

    assertScope(principal.scope, "write", { spaceId, resourceType: "space" }, allSpaces);

    if (input.parentId !== undefined && input.parentId !== current.parentId) {
      if (input.parentId !== null) {
        assertScope(
          principal.scope,
          "write",
          { spaceId: input.parentId, resourceType: "space" },
          allSpaces,
        );
      } else {
        assertScope(principal.scope, "write", { spaceId: "*", resourceType: "space" }, allSpaces);
      }
    }

    const updated = await this.spaceRepo.updateSpace(principal.workspaceId, spaceId, input);
    this.spacesCache?.invalidate(principal.workspaceId);
    this.sseHub.publish({
      type: "space.updated",
      workspaceId: principal.workspaceId,
      spaceId: updated.id,
      actorType: principal.actorType,
      payload: { space: updated },
    });
    return updated;
  }

  async archiveSpace(principal: Principal, spaceId: SpaceId): Promise<Space> {
    const allSpaces = await getAllWorkspaceSpaces(
      this.spacesCache ?? this.spaceRepo,
      principal.workspaceId,
    );
    const current = allSpaces.find((item) => item.id === spaceId);
    if (!current) {
      throw new InkadeError("NOT_FOUND", `Space "${spaceId}" not found`);
    }
    assertScope(principal.scope, "soft_delete", { spaceId, resourceType: "space" }, allSpaces);

    const archived = await this.spaceRepo.archiveSpace(principal.workspaceId, spaceId);
    this.spacesCache?.invalidate(principal.workspaceId);
    this.sseHub.publish({
      type: "space.archived",
      workspaceId: principal.workspaceId,
      spaceId: archived.id,
      actorType: principal.actorType,
      payload: { space: archived },
    });
    return archived;
  }

  async listSpaceSchemas(principal: Principal): Promise<readonly SpacePropertySchema[]> {
    const [allSpaces, schemas] = await Promise.all([
      getAllWorkspaceSpaces(this.spacesCache ?? this.spaceRepo, principal.workspaceId),
      this.spaceRepo.listSpacePropertySchemas(principal.workspaceId),
    ]);
    return schemas.filter((schema) => {
      if (schema.spaceId) {
        return evaluateScopeAccess(
          principal.scope,
          "read",
          { spaceId: schema.spaceId, resourceType: "space" },
          allSpaces,
        ).allowed;
      }
      return true;
    });
  }

  async getSpaceSchema(
    principal: Principal,
    spaceId: SpaceId,
    options?: { readonly templateId?: TemplateId | undefined },
  ): Promise<SpacePropertySchema | null> {
    const allSpaces = await getAllWorkspaceSpaces(
      this.spacesCache ?? this.spaceRepo,
      principal.workspaceId,
    );
    if (options?.templateId) {
      assertScope(principal.scope, "read", { spaceId, resourceType: "space" }, allSpaces);
      return this.spaceRepo.getSpacePropertySchema(principal.workspaceId, {
        templateId: options.templateId,
      });
    }
    const space = allSpaces.find((item) => item.id === spaceId);
    if (!space) {
      throw new InkadeError("NOT_FOUND", `Space "${spaceId}" not found`);
    }
    assertScope(principal.scope, "read", { spaceId: space.id, resourceType: "space" }, allSpaces);
    return this.spaceRepo.getSpacePropertySchema(principal.workspaceId, { spaceId });
  }

  async upsertSpaceSchema(
    principal: Principal,
    spaceId: SpaceId,
    input: UpsertSpacePropertySchemaInput,
  ): Promise<SpacePropertySchema> {
    const allSpaces = await getAllWorkspaceSpaces(
      this.spacesCache ?? this.spaceRepo,
      principal.workspaceId,
    );
    if (input.templateId) {
      assertAdminPrincipal(principal, allSpaces);
    } else {
      const space = allSpaces.find((item) => item.id === spaceId);
      if (!space) {
        throw new InkadeError("NOT_FOUND", `Space "${spaceId}" not found`);
      }
      assertScope(principal.scope, "write", { spaceId: space.id, resourceType: "space" }, allSpaces);
    }

    const fields = spacePropertySchemaFieldsArraySchema.parse(input.fields);
    const saved = await this.spaceRepo.upsertSpacePropertySchema(
      principal.workspaceId,
      input.templateId ? { templateId: input.templateId, fields } : { spaceId, fields },
    );

    this.sseHub.publish({
      type: "space_schema.updated",
      workspaceId: principal.workspaceId,
      spaceId: saved.spaceId,
      actorType: principal.actorType,
      payload: { spaceId: saved.spaceId, schema: saved },
    });
    return saved;
  }
}
