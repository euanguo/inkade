import { z } from "zod";
import {
  spaceIdSchema,
  type DocumentChunkId,
  type DocumentId,
  type OutlineNodeId,
  type SpaceId,
  type WorkspaceId,
} from "../ids.ts";
import {
  documentKindSchema,
  semanticSearchModeSchema,
  type DocumentKind,
  type SemanticSearchMode,
} from "./common.ts";

export interface SearchHit {
  readonly entityType: "document" | "outline_node";
  readonly documentId: DocumentId;
  readonly nodeId: OutlineNodeId | null;
  readonly spaceId: SpaceId;
  readonly kind: DocumentKind;
  readonly title: string;
  readonly snippet: string;
  readonly tags: readonly string[];
  readonly score: number;
  readonly updatedAt: string;
}

export const searchQueryInputSchema = z.object({
  q: z.string().trim().min(1).max(300),
  spaceId: spaceIdSchema.optional(),
  kind: documentKindSchema.optional(),
  tag: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(100).default(25),
});
export type SearchQueryInput = z.input<typeof searchQueryInputSchema>;
export type ParsedSearchQueryInput = z.infer<typeof searchQueryInputSchema>;

export interface WorkspaceSummary {
  readonly spaces: readonly {
    readonly spaceId: SpaceId;
    readonly slug: string;
    readonly name: string;
    readonly activeCount: number;
  }[];
  readonly inboxCount: number;
  readonly attentionThreadsCount: number;
  readonly tags: readonly {
    readonly tag: string;
    readonly count: number;
  }[];
  readonly dailyActivity: readonly {
    readonly date: string;
    readonly documentId: DocumentId | null;
    readonly nodeCount: number;
    readonly openTaskCount: number;
    readonly completedTaskCount: number;
  }[];
}

export interface DocumentEmbeddingRecord {
  readonly documentId: DocumentId;
  readonly workspaceId: WorkspaceId;
  readonly model: string;
  readonly dimensions: number;
  readonly vector: readonly number[];
  readonly contentHash: string;
  readonly updatedAt: string;
}

export interface DocumentChunkRecord {
  readonly id: DocumentChunkId;
  readonly workspaceId: WorkspaceId;
  readonly docId: DocumentId;
  readonly chunkIndex: number;
  readonly headingPath: string | null;
  readonly nodeId: OutlineNodeId | null;
  readonly tokenCount: number;
  readonly snippet: string;
  readonly contentText: string;
  readonly contentHash: string;
  readonly updatedAt: string;
}

export interface ChunkEmbeddingRecord {
  readonly chunkId: DocumentChunkId;
  readonly workspaceId: WorkspaceId;
  readonly modelKey: string;
  readonly dimensions: number;
  readonly vector: readonly number[];
  readonly updatedAt: string;
}

export interface SearchIndexStatus {
  readonly provider: string;
  readonly model: string;
  readonly modelKey: string;
  readonly dimensions: number;
  readonly totalDocuments: number;
  readonly indexedDocuments: number;
  readonly totalChunks: number;
  readonly indexedChunks: number;
  readonly pendingJobs: number;
  readonly lastIndexedAt: string | null;
  readonly reindexing: {
    readonly active: boolean;
    readonly processedDocs: number;
    readonly totalDocs: number;
    readonly processedChunks: number;
  };
}

export const semanticSearchInputSchema = z.object({
  q: z.string().trim().min(1).max(500),
  spaceId: spaceIdSchema.optional(),
  kind: documentKindSchema.optional(),
  tag: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(100).default(20),
  mode: semanticSearchModeSchema.default("hybrid"),
});
export type SemanticSearchRequestInput = z.input<typeof semanticSearchInputSchema>;
export type SemanticSearchInput = z.infer<typeof semanticSearchInputSchema>;

export interface SemanticSearchHit {
  readonly documentId: DocumentId;
  readonly spaceId: SpaceId;
  readonly kind: DocumentKind;
  readonly title: string;
  readonly snippet: string;
  readonly tags: readonly string[];
  readonly score: number;
  readonly keywordScore?: number | undefined;
  readonly semanticScore?: number | undefined;
  readonly matchSource: "hybrid" | "semantic" | "keyword";
  readonly headingPath?: string | null | undefined;
  readonly nodeId?: OutlineNodeId | null | undefined;
  readonly chunkId?: DocumentChunkId | null | undefined;
  readonly updatedAt: string;
}

export interface SemanticSearchResult {
  readonly hits: readonly SemanticSearchHit[];
  readonly mode: SemanticSearchMode;
  readonly provider: string;
  readonly model: string;
}

export interface RelatedDocumentHit {
  readonly documentId: DocumentId;
  readonly spaceId: SpaceId;
  readonly kind: DocumentKind;
  readonly title: string;
  readonly excerpt: string;
  readonly tags: readonly string[];
  readonly similarity: number;
  readonly updatedAt: string;
}

export interface ReindexSearchResult {
  readonly indexedCount: number;
  readonly skippedCount: number;
  readonly provider: string;
  readonly model: string;
}
