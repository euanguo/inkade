import type {
  ReindexSearchResult,
  SearchHit,
  SearchIndexStatus,
  SearchQueryInput,
  SemanticSearchRequestInput,
  SemanticSearchResult,
} from "@inkade/core";
import { buildQuery, type InkadeHttpTransport } from "../http-transport.ts";

export interface SearchResource {
  query(input: SearchQueryInput): Promise<readonly SearchHit[]>;
  semantic(input: SemanticSearchRequestInput): Promise<SemanticSearchResult>;
  indexStatus(): Promise<SearchIndexStatus>;
  reindex(): Promise<ReindexSearchResult>;
}

export function createSearchResource(transport: InkadeHttpTransport): SearchResource {
  return {
    async query(input) {
      const query = buildQuery({
        q: input.q,
        spaceId: input.spaceId,
        kind: input.kind,
        tag: input.tag,
        limit: input.limit,
      });
      const res = await transport.requestJson<{ readonly hits: readonly SearchHit[] }>(
        `/api/v1/search${query}`,
      );
      return res.hits;
    },

    semantic(input) {
      return transport.requestJson<SemanticSearchResult>("/api/v1/search/semantic", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },

    async indexStatus() {
      const res = await transport.requestJson<{ readonly status: SearchIndexStatus }>(
        "/api/v1/search/index-status",
      );
      return res.status;
    },

    reindex() {
      return transport.requestJson<ReindexSearchResult>("/api/v1/search/reindex", {
        method: "POST",
      });
    },
  };
}
