import type {
  CreateSpaceInput,
  Space,
  SpaceId,
  SpacePropertySchema,
  TemplateId,
  UpdateSpaceInput,
  UpsertSpacePropertySchemaInput,
} from "@inkade/core";
import { buildQuery, type InkadeHttpTransport } from "../http-transport.ts";

export interface SpacesResource {
  list(options?: { readonly includeArchived?: boolean | undefined }): Promise<readonly Space[]>;
  get(spaceId: SpaceId): Promise<Space>;
  create(input: CreateSpaceInput): Promise<Space>;
  update(spaceId: SpaceId, input: UpdateSpaceInput): Promise<Space>;
  archive(spaceId: SpaceId): Promise<Space>;
  listSchemas(): Promise<readonly SpacePropertySchema[]>;
  getSchema(
    spaceId: SpaceId,
    options?: { readonly templateId?: TemplateId | undefined },
  ): Promise<SpacePropertySchema | null>;
  upsertSchema(
    spaceId: SpaceId,
    input: UpsertSpacePropertySchemaInput,
  ): Promise<SpacePropertySchema>;
}

export function createSpacesResource(transport: InkadeHttpTransport): SpacesResource {
  return {
    async list(options) {
      const query = buildQuery({ includeArchived: options?.includeArchived });
      const res = await transport.requestJson<{ readonly spaces: readonly Space[] }>(
        `/api/v1/spaces${query}`,
      );
      return res.spaces;
    },

    async get(spaceId) {
      const res = await transport.requestJson<{ readonly space: Space }>(
        `/api/v1/spaces/${encodeURIComponent(spaceId)}`,
      );
      return res.space;
    },

    async create(input) {
      const res = await transport.requestJson<{ readonly space: Space }>("/api/v1/spaces", {
        method: "POST",
        body: JSON.stringify({ parentId: null, ...input }),
      });
      return res.space;
    },

    async update(spaceId, input) {
      const res = await transport.requestJson<{ readonly space: Space }>(
        `/api/v1/spaces/${encodeURIComponent(spaceId)}`,
        {
          method: "PATCH",
          body: JSON.stringify(input),
        },
      );
      return res.space;
    },

    async archive(spaceId) {
      const res = await transport.requestJson<{ readonly space: Space }>(
        `/api/v1/spaces/${encodeURIComponent(spaceId)}/archive`,
        { method: "POST" },
      );
      return res.space;
    },

    async listSchemas() {
      const res = await transport.requestJson<{ readonly schemas: readonly SpacePropertySchema[] }>(
        "/api/v1/spaces/schemas",
      );
      return res.schemas;
    },

    async getSchema(spaceId, options) {
      const query = buildQuery({ templateId: options?.templateId });
      const res = await transport.requestJson<{ readonly schema: SpacePropertySchema | null }>(
        `/api/v1/spaces/${encodeURIComponent(spaceId)}/schema${query}`,
      );
      return res.schema;
    },

    async upsertSchema(spaceId, input) {
      const res = await transport.requestJson<{ readonly schema: SpacePropertySchema }>(
        `/api/v1/spaces/${encodeURIComponent(spaceId)}/schema`,
        {
          method: "PUT",
          body: JSON.stringify(input),
        },
      );
      return res.schema;
    },
  };
}
