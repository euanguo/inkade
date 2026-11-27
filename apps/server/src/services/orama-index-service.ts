import {
  create,
  insertMultiple,
  removeMultiple,
  search,
  type AnyOrama,
  type Tokenizer,
} from "@orama/orama";
import {
  tokenizeForSearch,
  type DocumentChunkId,
  type DocumentChunkRecord,
  type DocumentId,
  type DocumentKind,
  type OutlineNodeId,
  type SemanticSearchMode,
  type SpaceId,
  type WorkspaceId,
} from "@inkade/core";

export interface OramaChunkEntry {
  readonly chunk: DocumentChunkRecord;
  readonly title: string;
  readonly spaceId: SpaceId;
  readonly kind: DocumentKind;
  readonly tags: readonly string[];
  readonly vector: readonly number[];
}

export interface OramaChunkHit {
  readonly chunkId: DocumentChunkId;
  readonly docId: DocumentId;
  readonly spaceId: SpaceId;
  readonly kind: DocumentKind;
  readonly title: string;
  readonly headingPath: string | null;
  readonly nodeId: OutlineNodeId | null;
  readonly snippet: string;
  readonly contentText: string;
  readonly tags: readonly string[];
  readonly updatedAt: string;
  readonly score: number;
}

interface OramaDocShape {
  readonly id: string;
  readonly chunkId: string;
  readonly docId: string;
  readonly spaceId: string;
  readonly kind: string;
  readonly tags: string[];
  readonly title: string;
  readonly headingPath: string;
  readonly nodeId: string;
  readonly snippet: string;
  readonly contentText: string;
  readonly updatedAt: string;
  readonly embedding: number[];
}

interface OramaBucket {
  readonly key: string;
  readonly workspaceId: WorkspaceId;
  readonly modelKey: string;
  readonly dimensions: number;
  readonly db: AnyOrama;
  readonly docChunkIds: Map<string, string[]>;
  hydrated: boolean;
  opTail: Promise<void>;
}

function createCjkTokenizer(): Tokenizer {
  return {
    language: "english",
    normalizationCache: new Map<string, string>(),
    tokenize(raw: string): string[] {
      if (!raw || typeof raw !== "string") return [];
      const tokenized = tokenizeForSearch(raw);
      return tokenized ? tokenized.split(/\s+/).filter(Boolean) : [];
    },
  };
}

/**
 * Pure-TS `@orama/orama` hybrid BM25 + dense vector index partitioned by
 * `(workspaceId, modelKey, dimensions)`. Works cleanly on macOS/Linux/Windows
 * with zero native SQLite loadExtension requirements.
 */
export class OramaIndexService {
  private readonly buckets = new Map<string, OramaBucket>();

  private bucketKey(workspaceId: WorkspaceId, modelKey: string, dimensions: number): string {
    return `${workspaceId}::${modelKey}::${dimensions}`;
  }

  private createBucket(
    workspaceId: WorkspaceId,
    modelKey: string,
    dimensions: number,
  ): OramaBucket {
    const dim = Math.max(1, Math.floor(dimensions));
    const vectorType: `vector[${number}]` = `vector[${dim}]`;
    const db = create({
      schema: {
        chunkId: "string",
        docId: "enum",
        spaceId: "enum",
        kind: "enum",
        tags: "enum[]",
        title: "string",
        headingPath: "string",
        nodeId: "string",
        snippet: "string",
        contentText: "string",
        updatedAt: "string",
        embedding: vectorType,
      } as const,
      components: {
        tokenizer: createCjkTokenizer(),
      },
    });
    const key = this.bucketKey(workspaceId, modelKey, dim);
    const bucket: OramaBucket = {
      key,
      workspaceId,
      modelKey,
      dimensions: dim,
      db,
      docChunkIds: new Map<string, string[]>(),
      hydrated: false,
      opTail: Promise.resolve(),
    };
    this.buckets.set(key, bucket);
    return bucket;
  }

  private getOrCreateBucket(
    workspaceId: WorkspaceId,
    modelKey: string,
    dimensions: number,
  ): OramaBucket {
    const key = this.bucketKey(workspaceId, modelKey, Math.max(1, Math.floor(dimensions)));
    return this.buckets.get(key) ?? this.createBucket(workspaceId, modelKey, dimensions);
  }

  private runSerialized<T>(bucket: OramaBucket, fn: () => Promise<T>): Promise<T> {
    const next = bucket.opTail.then(fn, fn);
    bucket.opTail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  isBucketHydrated(workspaceId: WorkspaceId, modelKey: string, dimensions: number): boolean {
    const key = this.bucketKey(workspaceId, modelKey, Math.max(1, Math.floor(dimensions)));
    return this.buckets.get(key)?.hydrated ?? false;
  }

  hasAnyHydratedForModel(workspaceId: WorkspaceId, modelKey: string): boolean {
    const prefix = `${workspaceId}::${modelKey}::`;
    for (const [key, bucket] of this.buckets) {
      if (key.startsWith(prefix) && bucket.hydrated) {
        return true;
      }
    }
    return false;
  }

  getActiveDimensionsForModel(workspaceId: WorkspaceId, modelKey: string): number | null {
    const prefix = `${workspaceId}::${modelKey}::`;
    for (const [key, bucket] of this.buckets) {
      if (key.startsWith(prefix) && bucket.hydrated) {
        return bucket.dimensions;
      }
    }
    return null;
  }

  async replaceWorkspaceIndex(
    workspaceId: WorkspaceId,
    modelKey: string,
    dimensions: number,
    entries: readonly OramaChunkEntry[],
  ): Promise<void> {
    const bucket = this.createBucket(workspaceId, modelKey, dimensions);
    await this.runSerialized(bucket, async () => {
      const valid = entries.filter((e) => e.vector.length === bucket.dimensions);
      if (valid.length > 0) {
        const docs: OramaDocShape[] = valid.map((e) => ({
          id: e.chunk.id,
          chunkId: e.chunk.id,
          docId: e.chunk.docId,
          spaceId: e.spaceId,
          kind: e.kind,
          tags: [...e.tags],
          title: e.title,
          headingPath: e.chunk.headingPath ?? "",
          nodeId: e.chunk.nodeId ?? "",
          snippet: e.chunk.snippet,
          contentText: e.chunk.contentText,
          updatedAt: e.chunk.updatedAt,
          embedding: [...e.vector],
        }));
        await insertMultiple(bucket.db, docs, 250);
        for (const e of valid) {
          const list = bucket.docChunkIds.get(e.chunk.docId);
          if (list) list.push(e.chunk.id);
          else bucket.docChunkIds.set(e.chunk.docId, [e.chunk.id]);
        }
      }
      bucket.hydrated = true;
    });
  }

  async upsertDocumentEntries(
    workspaceId: WorkspaceId,
    modelKey: string,
    dimensions: number,
    docId: DocumentId,
    entries: readonly OramaChunkEntry[],
  ): Promise<void> {
    // Remove stale doc entries across any other dimension buckets for this workspace+model
    for (const bucket of this.buckets.values()) {
      if (
        bucket.workspaceId === workspaceId &&
        bucket.modelKey === modelKey &&
        bucket.dimensions !== dimensions
      ) {
        await this.removeFromBucket(bucket, docId);
      }
    }

    const bucket = this.getOrCreateBucket(workspaceId, modelKey, dimensions);
    await this.runSerialized(bucket, async () => {
      const oldIds = bucket.docChunkIds.get(docId);
      if (oldIds && oldIds.length > 0) {
        await removeMultiple(bucket.db, oldIds);
        bucket.docChunkIds.delete(docId);
      }
      const valid = entries.filter((e) => e.vector.length === bucket.dimensions);
      if (valid.length > 0) {
        const docs = valid.map((e) => ({
          id: e.chunk.id,
          chunkId: e.chunk.id,
          docId: e.chunk.docId,
          spaceId: e.spaceId,
          kind: e.kind,
          tags: [...e.tags],
          title: e.title,
          headingPath: e.chunk.headingPath ?? "",
          nodeId: e.chunk.nodeId ?? "",
          snippet: e.chunk.snippet,
          contentText: e.chunk.contentText,
          updatedAt: e.chunk.updatedAt,
          embedding: [...e.vector],
        }));
        await insertMultiple(bucket.db, docs, 100);
        bucket.docChunkIds.set(
          docId,
          valid.map((e) => e.chunk.id),
        );
      }
    });
  }

  private async removeFromBucket(bucket: OramaBucket, docId: DocumentId): Promise<void> {
    await this.runSerialized(bucket, async () => {
      const oldIds = bucket.docChunkIds.get(docId);
      if (oldIds && oldIds.length > 0) {
        await removeMultiple(bucket.db, oldIds);
        bucket.docChunkIds.delete(docId);
      }
    });
  }

  async removeDocument(workspaceId: WorkspaceId, docId: DocumentId): Promise<void> {
    const tasks: Promise<void>[] = [];
    for (const bucket of this.buckets.values()) {
      if (bucket.workspaceId === workspaceId) {
        tasks.push(this.removeFromBucket(bucket, docId));
      }
    }
    await Promise.all(tasks);
  }

  async searchChunks(params: {
    readonly workspaceId: WorkspaceId;
    readonly modelKey: string;
    readonly dimensions: number;
    readonly mode: SemanticSearchMode;
    readonly queryText: string;
    readonly queryVector: readonly number[];
    readonly authorizedDocIds: readonly DocumentId[];
    readonly spaceIds?: readonly SpaceId[] | undefined;
    readonly kind?: DocumentKind | undefined;
    readonly tag?: string | undefined;
    readonly limit: number;
  }): Promise<readonly OramaChunkHit[]> {
    if (params.authorizedDocIds.length === 0) {
      return [];
    }

    const bucket = this.buckets.get(
      this.bucketKey(params.workspaceId, params.modelKey, Math.max(1, Math.floor(params.dimensions))),
    );
    if (!bucket || bucket.docChunkIds.size === 0) {
      return [];
    }

    return this.runSerialized(bucket, async () => {
      const where: Record<string, unknown> = {
        docId: { in: [...params.authorizedDocIds] },
      };
      if (params.spaceIds && params.spaceIds.length > 0) {
        where.spaceId = { in: [...params.spaceIds] };
      }
      if (params.kind) {
        where.kind = { eq: params.kind };
      }
      if (params.tag) {
        where.tags = { containsAny: [params.tag] };
      }

      const hasTokens = tokenizeForSearch(params.queryText).length > 0;
      const effectiveMode: SemanticSearchMode =
        params.mode === "hybrid" && !hasTokens ? "semantic" : params.mode;

      if (effectiveMode === "keyword" && !hasTokens) {
        return [];
      }

      const limit = Math.max(1, Math.min(params.limit, 100));
      let result;

      if (effectiveMode === "hybrid") {
        result = await search(bucket.db, {
          mode: "hybrid",
          term: params.queryText,
          vector: {
            value: [...params.queryVector],
            property: "embedding",
          },
          where: where as never,
          limit,
          similarity: 0.01,
          threshold: 0,
          hybridWeights: { text: 0.45, vector: 0.55 },
          boost: {
            title: 2,
            headingPath: 1.5,
          },
        });
      } else if (effectiveMode === "semantic") {
        result = await search(bucket.db, {
          mode: "vector",
          vector: {
            value: [...params.queryVector],
            property: "embedding",
          },
          where: where as never,
          limit,
          similarity: 0.01,
        });
      } else {
        result = await search(bucket.db, {
          mode: "fulltext",
          term: params.queryText,
          where: where as never,
          limit,
          threshold: 0,
          boost: {
            title: 2,
            headingPath: 1.5,
          },
        });
      }

      return result.hits.map((hit) => {
        const doc = hit.document as unknown as OramaDocShape;
        return {
          chunkId: doc.chunkId as DocumentChunkId,
          docId: doc.docId as DocumentId,
          spaceId: doc.spaceId as SpaceId,
          kind: doc.kind as DocumentKind,
          title: doc.title,
          headingPath: doc.headingPath || null,
          nodeId: (doc.nodeId || null) as OutlineNodeId | null,
          snippet: doc.snippet,
          contentText: doc.contentText,
          tags: Array.isArray(doc.tags) ? doc.tags : [],
          updatedAt: doc.updatedAt,
          score: hit.score,
        };
      });
    });
  }
}
