import type {
  CreatePublicSiteInput,
  PublicSite,
  PublicSiteDocumentPayload,
  PublicSiteId,
  PublicSitePayload,
  UpdatePublicSiteInput,
} from "@inkade/core";
import type { InkadeHttpTransport } from "../http-transport.ts";

export interface PublicSitesResource {
  list(): Promise<readonly PublicSite[]>;
  create(input: CreatePublicSiteInput): Promise<PublicSite>;
  update(siteId: PublicSiteId, input: UpdatePublicSiteInput): Promise<PublicSite>;
  delete(siteId: PublicSiteId): Promise<void>;
  exportZip(siteId: PublicSiteId): Promise<Uint8Array>;
  getPublic(slug: string): Promise<PublicSitePayload>;
  getPublicDoc(slug: string, docSlug: string): Promise<PublicSiteDocumentPayload>;
}

export function createPublicSitesResource(transport: InkadeHttpTransport): PublicSitesResource {
  return {
    async list() {
      const res = await transport.requestJson<{ readonly sites: readonly PublicSite[] }>(
        "/api/v1/public-sites",
      );
      return res.sites;
    },

    async create(input) {
      const res = await transport.requestJson<{ readonly site: PublicSite }>(
        "/api/v1/public-sites",
        {
          method: "POST",
          body: JSON.stringify(input),
        },
      );
      return res.site;
    },

    async update(siteId, input) {
      const res = await transport.requestJson<{ readonly site: PublicSite }>(
        `/api/v1/public-sites/${encodeURIComponent(siteId)}`,
        {
          method: "PATCH",
          body: JSON.stringify(input),
        },
      );
      return res.site;
    },

    async delete(siteId) {
      await transport.requestJson<{ readonly deleted: boolean }>(
        `/api/v1/public-sites/${encodeURIComponent(siteId)}`,
        {
          method: "DELETE",
        },
      );
    },

    async exportZip(siteId) {
      const response = await transport.requestRaw(
        `/api/v1/public-sites/${encodeURIComponent(siteId)}/export.zip`,
      );
      return new Uint8Array(await response.arrayBuffer());
    },

    getPublic(slug) {
      return transport.requestJson<PublicSitePayload>(
        `/api/v1/public/sites/${encodeURIComponent(slug)}`,
      );
    },

    getPublicDoc(slug, docSlug) {
      return transport.requestJson<PublicSiteDocumentPayload>(
        `/api/v1/public/sites/${encodeURIComponent(slug)}/docs/${encodeURIComponent(docSlug)}`,
      );
    },
  };
}
