import type {
  ConnectPingStatus,
  ContextPack,
  ContextPackId,
  CreateContextPackInput,
  RenderedContextPack,
  UpdateContextPackInput,
} from "@inkade/core";
import { buildQuery, type InkadeHttpTransport } from "../http-transport.ts";

export interface GetContextPackOptions {
  readonly maxTokens?: number | undefined;
}

export interface ContextPacksResource {
  list(): Promise<readonly ContextPack[]>;
  create(input: CreateContextPackInput): Promise<ContextPack>;
  getBySlug(slug: string, options?: GetContextPackOptions): Promise<RenderedContextPack>;
  update(packId: ContextPackId, input: UpdateContextPackInput): Promise<ContextPack>;
  delete(packId: ContextPackId): Promise<void>;
}

export interface ConnectResource {
  status(): Promise<ConnectPingStatus>;
}

export function createContextPacksResource(transport: InkadeHttpTransport): ContextPacksResource {
  return {
    async list() {
      const res = await transport.requestJson<{ readonly packs: readonly ContextPack[] }>(
        "/api/v1/context-packs",
      );
      return res.packs;
    },

    async create(input) {
      const res = await transport.requestJson<{ readonly pack: ContextPack }>(
        "/api/v1/context-packs",
        {
          method: "POST",
          body: JSON.stringify(input),
        },
      );
      return res.pack;
    },

    getBySlug(slug, options) {
      const query = buildQuery({
        maxTokens: options?.maxTokens,
      });
      return transport.requestJson<RenderedContextPack>(
        `/api/v1/context-packs/${encodeURIComponent(slug)}${query}`,
      );
    },

    async update(packId, input) {
      const res = await transport.requestJson<{ readonly pack: ContextPack }>(
        `/api/v1/context-packs/${packId}`,
        {
          method: "PATCH",
          body: JSON.stringify(input),
        },
      );
      return res.pack;
    },

    async delete(packId) {
      await transport.requestJson<{ readonly deleted: boolean }>(
        `/api/v1/context-packs/${packId}`,
        {
          method: "DELETE",
        },
      );
    },
  };
}

export function createConnectResource(transport: InkadeHttpTransport): ConnectResource {
  return {
    status() {
      return transport.requestJson<ConnectPingStatus>("/api/v1/connect/status");
    },
  };
}
