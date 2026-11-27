import {
  buildEmbeddingModelKey,
  chunkDocumentContent,
  computeLocalTextEmbedding,
  computeRrfFusion,
  cosineSimilarity,
  DEFAULT_LOCAL_EMBEDDING_DIMENSIONS,
  EMBEDDING_PROVIDER_DEFAULTS,
  evaluateScopeAccess,
  hashTextForEmbedding,
  InkadeError,
  isSystemInternalDocument,
  resolveAllowedSpaceIds,
  type ChunkEmbeddingRecord,
  type DocumentChunkId,
  type DocumentChunkRecord,
  type DocumentEmbeddingRecord,
  type DocumentId,
  type DocumentKind,
  type DocumentRecord,
  type EmbeddingProviderPreset,
  type OutlineNode,
  type OutlineNodeId,
  type ReindexSearchResult,
  type RelatedDocumentHit,
  type SearchIndexStatus,
  type SemanticSearchHit,
  type SemanticSearchInput,
  type SemanticSearchResult,
  type SpaceId,
  type TestEmbeddingInput,
  type TestEmbeddingResult,
  type WorkspaceId,
} from "@inkade/core";
import type {
  AttachmentRepo,
  DocumentRepo,
  OutlineRepo,
  SearchConfigRepo,
  SpaceRepo,
} from "@inkade/db";
import { embed as aiEmbed, embedMany as aiEmbedMany, type EmbeddingModel } from "ai";
import type { WorkspaceSpacesCache } from "../cache/workspace-spaces-cache.ts";
import type { ServerLogger } from "../logger.ts";
import type { Principal } from "../types.ts";
import {
  createAiSdkEmbeddingModel,
  validateAiEndpointUrl,
} from "./ai-provider-factory.ts";
import type { AuditService } from "./audit-service.ts";
import { defaultDnsResolver, type DnsResolver, type FetchFn } from "./clipper-service.ts";
import { OramaIndexService, type OramaChunkEntry } from "./orama-index-service.ts";
import { assertAdminPrincipal, assertScope, getAllWorkspaceSpaces } from "./scope-guard.ts";

export interface EmbeddingProvider {
  readonly providerName: "local" | "ollama" | "openai" | "openai-compatible";
  readonly model: string;
  embed(text: string): Promise<readonly number[]>;
  embedMany?(texts: readonly string[]): Promise<readonly (readonly number[])[]>;
}

export type EmbeddingFetchFn = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface SemanticSearchRepos {
  readonly searchConfigRepo: SearchConfigRepo;
  readonly documentRepo: DocumentRepo;
  readonly outlineRepo: OutlineRepo;
  readonly spaceRepo: SpaceRepo;
  readonly attachmentRepo?: AttachmentRepo | undefined;
}

export interface SemanticSearchServiceOptions {
  readonly embeddingProvider?: EmbeddingProvider | undefined;
  readonly fetchFn?: EmbeddingFetchFn | undefined;
  readonly resolveDns?: DnsResolver | undefined;
  readonly allowLocalForTest?: boolean | undefined;
  readonly spacesCache?: WorkspaceSpacesCache | undefined;
  readonly auditService?: AuditService | undefined;
  readonly logger?: ServerLogger | undefined;
  readonly oramaIndex?: OramaIndexService | undefined;
}

export interface ChunkSearchHit {
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
  readonly score: number;
  readonly keywordScore?: number | undefined;
  readonly semanticScore?: number | undefined;
  readonly matchSource: "hybrid" | "semantic" | "keyword";
  readonly updatedAt: string;
}

export interface SearchChunksInput extends SemanticSearchInput {
  readonly documentIds?: readonly DocumentId[] | undefined;
}

class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly providerName = "local" as const;
  readonly model = "local-ngram-128";

  embed(text: string): Promise<readonly number[]> {
    return Promise.resolve(computeLocalTextEmbedding(text, DEFAULT_LOCAL_EMBEDDING_DIMENSIONS));
  }

  embedMany(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
    return Promise.resolve(
      texts.map((text) => computeLocalTextEmbedding(text, DEFAULT_LOCAL_EMBEDDING_DIMENSIONS)),
    );
  }
}

class VercelAiSdkEmbeddingProvider implements EmbeddingProvider {
  readonly providerName: "ollama" | "openai" | "openai-compatible";
  readonly model: string;
  private readonly sdkModel: EmbeddingModel;

  constructor(options: {
    readonly providerName: "ollama" | "openai" | "openai-compatible";
    readonly model: string;
    readonly sdkModel: EmbeddingModel;
  }) {
    this.providerName = options.providerName;
    this.model = options.model;
    this.sdkModel = options.sdkModel;
  }

  async embed(text: string): Promise<readonly number[]> {
    const res = await aiEmbed({
      model: this.sdkModel,
      value: text,
      maxRetries: 0,
    });
    if (!Array.isArray(res.embedding) || res.embedding.length === 0) {
      throw new Error(`${this.providerName} embedding response missing vector`);
    }
    return res.embedding;
  }

  async embedMany(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
    if (texts.length === 0) return [];
    const res = await aiEmbedMany({
      model: this.sdkModel,
      values: [...texts],
      maxRetries: 0,
    });
    return res.embeddings;
  }
}

export function createEmbeddingProviderFromEnv(
  fetchFn: EmbeddingFetchFn = (input, init) => globalThis.fetch(input, init),
): EmbeddingProvider {
  const providerRaw = (process.env.INKADE_EMBEDDING_PROVIDER ?? "local").trim().toLowerCase();
  const customFetch = fetchFn as unknown as FetchFn;

  if (providerRaw === "openai" || providerRaw === "openai-compatible") {
    const apiKey = (process.env.INKADE_EMBEDDING_API_KEY ?? "").trim();
    const baseUrl = (
      process.env.INKADE_EMBEDDING_BASE_URL ?? "https://api.openai.com/v1"
    ).trim();
    const model = (process.env.INKADE_EMBEDDING_MODEL ?? "text-embedding-3-small").trim();
    if (apiKey || process.env.INKADE_EMBEDDING_BASE_URL) {
      const preset = providerRaw === "openai" ? "openai" : "openai-compatible";
      return new VercelAiSdkEmbeddingProvider({
        providerName: preset,
        model,
        sdkModel: createAiSdkEmbeddingModel({
          provider: preset,
          baseUrl,
          model,
          apiKey,
          fetchFn: customFetch,
        }),
      });
    }
  }

  if (providerRaw === "ollama") {
    const baseUrl = (process.env.INKADE_EMBEDDING_BASE_URL ?? "http://127.0.0.1:11434").trim();
    const model = (process.env.INKADE_EMBEDDING_MODEL ?? "nomic-embed-text").trim();
    return new VercelAiSdkEmbeddingProvider({
      providerName: "ollama",
      model,
      sdkModel: createAiSdkEmbeddingModel({
        provider: "ollama",
        baseUrl,
        model,
        apiKey: "",
        fetchFn: customFetch,
      }),
    });
  }

  return new LocalEmbeddingProvider();
}

function averageVectors(vectors: readonly (readonly number[])[]): number[] {
  const first = vectors[0];
  if (!first || first.length === 0) return [];
  const dim = first.length;
  const sum = new Array<number>(dim).fill(0);
  let count = 0;
  for (const vec of vectors) {
    if (vec.length !== dim) continue;
    count += 1;
    for (let i = 0; i < dim; i++) {
      sum[i] = (sum[i] ?? 0) + (vec[i] ?? 0);
    }
  }
  if (count === 0) return [];
  let normSq = 0;
  for (let i = 0; i < dim; i++) {
    const v = (sum[i] ?? 0) / count;
    sum[i] = v;
    normSq += v * v;
  }
  if (normSq === 0) return sum;
  const norm = Math.sqrt(normSq);
  for (let i = 0; i < dim; i++) {
    sum[i] = Number(((sum[i] ?? 0) / norm).toFixed(8));
  }
  return sum;
}

function buildDocumentEmbeddingText(
  doc: DocumentRecord,
  outlineNodes?: readonly OutlineNode[],
): string {
  const parts: string[] = [doc.title];
  if (doc.tags.length > 0) {
    parts.push(doc.tags.map((tag) => `#${tag}`).join(" "));
  }
  const bodyText = (doc.contentText || doc.contentMarkdown).trim();
  if (bodyText) {
    parts.push(bodyText);
  }
  if (outlineNodes && outlineNodes.length > 0) {
    const outlineLines = outlineNodes
      .filter((n) => n.deletedAt === null)
      .map((n) => [n.contentText, n.noteText].filter(Boolean).join(" "))
      .filter(Boolean);
    if (outlineLines.length > 0) {
      parts.push(outlineLines.join("\n"));
    }
  }
  return parts.join("\n").trim();
}

export class SemanticSearchService {
  private readonly injectedProvider: EmbeddingProvider | undefined;
  private readonly envFallbackProvider: EmbeddingProvider;
  private readonly fallbackProvider = new LocalEmbeddingProvider();
  private fetchFn: FetchFn;
  private resolveDns: DnsResolver;
  private allowLocalForTest: boolean;
  private readonly spacesCache: WorkspaceSpacesCache | undefined;
  private readonly auditService: AuditService | undefined;
  private readonly logger: ServerLogger | undefined;
  readonly oramaIndex: OramaIndexService;
  private readonly pendingJobs = new Map<string, Promise<void>>();
  private readonly reindexProgress = new Map<
    WorkspaceId,
    {
      active: boolean;
      processedDocs: number;
      totalDocs: number;
      processedChunks: number;
    }
  >();

  constructor(
    private readonly repos: SemanticSearchRepos,
    options?: SemanticSearchServiceOptions,
  ) {
    this.injectedProvider = options?.embeddingProvider;
    this.fetchFn = (options?.fetchFn as FetchFn | undefined) ?? ((input, init) => fetch(input, init));
    this.resolveDns = options?.resolveDns ?? defaultDnsResolver;
    this.allowLocalForTest = options?.allowLocalForTest ?? false;
    this.envFallbackProvider = createEmbeddingProviderFromEnv(this.fetchFn as EmbeddingFetchFn);
    this.spacesCache = options?.spacesCache;
    this.auditService = options?.auditService;
    this.logger = options?.logger;
    this.oramaIndex = options?.oramaIndex ?? new OramaIndexService();
  }

  setTestTransport(transport: {
    readonly fetchFn?: FetchFn | undefined;
    readonly resolveDns?: DnsResolver | undefined;
    readonly allowLocalForTest?: boolean | undefined;
  }): void {
    if (transport.fetchFn !== undefined) this.fetchFn = transport.fetchFn;
    if (transport.resolveDns !== undefined) this.resolveDns = transport.resolveDns;
    if (transport.allowLocalForTest !== undefined) this.allowLocalForTest = transport.allowLocalForTest;
  }

  get providerName(): string {
    return (this.injectedProvider ?? this.envFallbackProvider).providerName;
  }

  get modelName(): string {
    return (this.injectedProvider ?? this.envFallbackProvider).model;
  }

  private async resolveActiveEmbedder(workspaceId: WorkspaceId): Promise<EmbeddingProvider> {
    if (this.injectedProvider) {
      return this.injectedProvider;
    }

    const settings = await this.repos.searchConfigRepo.getAiSettingsSecret(workspaceId);
    if (settings.embeddingProvider === "local") {
      if ((process.env.INKADE_EMBEDDING_PROVIDER ?? "local").trim().toLowerCase() !== "local") {
        return this.envFallbackProvider;
      }
      return this.fallbackProvider;
    }

    const preset = settings.embeddingProvider;
    const defaults = EMBEDDING_PROVIDER_DEFAULTS[preset];
    const baseUrl = settings.embeddingBaseUrl.trim() || defaults.baseUrl;
    const model = settings.embeddingModel.trim() || defaults.model;
    const apiKey = settings.embeddingApiKey.trim() || settings.apiKey.trim();

    if (!baseUrl) {
      return this.fallbackProvider;
    }
    if ((preset === "openai" || preset === "openai-compatible") && !apiKey) {
      return this.fallbackProvider;
    }

    try {
      const validated = await validateAiEndpointUrl(baseUrl, {
        allowPrivateLoopback: preset === "ollama",
        resolveDns: this.resolveDns,
        allowLocalForTest: this.allowLocalForTest,
      });
      return new VercelAiSdkEmbeddingProvider({
        providerName: preset,
        model,
        sdkModel: createAiSdkEmbeddingModel({
          provider: preset,
          baseUrl: validated,
          model,
          apiKey,
          fetchFn: this.fetchFn,
        }),
      });
    } catch (err) {
      this.logger?.warn({ err, workspaceId, preset }, "Invalid embedding endpoint; falling back to local");
      return this.fallbackProvider;
    }
  }

  private async embedTextsWithFallback(
    embedder: EmbeddingProvider,
    texts: readonly string[],
  ): Promise<{
    readonly vectors: readonly (readonly number[])[];
    readonly provider: string;
    readonly model: string;
    readonly modelKey: string;
  }> {
    if (texts.length === 0) {
      return {
        vectors: [],
        provider: embedder.providerName,
        model: embedder.model,
        modelKey: buildEmbeddingModelKey(embedder.providerName, embedder.model),
      };
    }

    try {
      const vectors = embedder.embedMany
        ? await embedder.embedMany(texts)
        : await Promise.all(texts.map((text) => embedder.embed(text)));
      const firstLen = vectors[0]?.length ?? 0;
      if (vectors.length !== texts.length || firstLen === 0) {
        throw new Error("Embedding batch dimension mismatch");
      }
      return {
        vectors,
        provider: embedder.providerName,
        model: embedder.model,
        modelKey: buildEmbeddingModelKey(embedder.providerName, embedder.model),
      };
    } catch (err) {
      if (embedder.providerName !== "local") {
        this.logger?.warn({ err, model: embedder.model }, "Embedding provider failed, falling back to local-ngram-128");
      }
      const vectors = await this.fallbackProvider.embedMany(texts);
      return {
        vectors,
        provider: this.fallbackProvider.providerName,
        model: this.fallbackProvider.model,
        modelKey: buildEmbeddingModelKey(
          this.fallbackProvider.providerName,
          this.fallbackProvider.model,
        ),
      };
    }
  }

  async testEmbeddingConnection(
    principal: Principal,
    input: TestEmbeddingInput = {},
  ): Promise<TestEmbeddingResult> {
    const allSpaces = await getAllWorkspaceSpaces(
      this.spacesCache ?? this.repos.spaceRepo,
      principal.workspaceId,
    );
    assertAdminPrincipal(principal, allSpaces);

    const settings = await this.repos.searchConfigRepo.getAiSettingsSecret(principal.workspaceId);
    const preset: EmbeddingProviderPreset = input.embeddingProvider ?? settings.embeddingProvider;
    const defaults = EMBEDDING_PROVIDER_DEFAULTS[preset];
    const model = (input.embeddingModel ?? settings.embeddingModel ?? "").trim() || defaults.model;
    const modelKey = buildEmbeddingModelKey(preset, model);
    const start = performance.now();

    if (preset === "local") {
      const vec = await this.fallbackProvider.embed("inkade embedding connectivity check");
      return {
        ok: true,
        provider: "local",
        model: this.fallbackProvider.model,
        modelKey: buildEmbeddingModelKey("local", this.fallbackProvider.model),
        dimensions: vec.length,
        latencyMs: Math.max(1, Math.round(performance.now() - start)),
      };
    }

    const baseUrl = (input.embeddingBaseUrl ?? settings.embeddingBaseUrl ?? "").trim() || defaults.baseUrl;
    const apiKey =
      (input.embeddingApiKey ?? "").trim() ||
      settings.embeddingApiKey.trim() ||
      settings.apiKey.trim();

    const validatedBase = await validateAiEndpointUrl(baseUrl, {
      allowPrivateLoopback: preset === "ollama",
      resolveDns: this.resolveDns,
      allowLocalForTest: this.allowLocalForTest,
    });

    if ((preset === "openai" || preset === "openai-compatible") && !apiKey) {
      throw new InkadeError(
        "VALIDATION_ERROR",
        "Embedding API key is required for OpenAI / OpenAI-compatible provider",
      );
    }

    const sdkModel = createAiSdkEmbeddingModel({
      provider: preset,
      baseUrl: validatedBase,
      model,
      apiKey,
      fetchFn: this.fetchFn,
    });

    try {
      const res = await aiEmbed({
        model: sdkModel,
        value: "inkade connectivity check",
        maxRetries: 0,
      });
      return {
        ok: true,
        provider: preset,
        model,
        modelKey,
        dimensions: res.embedding.length,
        latencyMs: Math.max(1, Math.round(performance.now() - start)),
      };
    } catch (err) {
      return {
        ok: false,
        provider: preset,
        model,
        modelKey,
        dimensions: 0,
        latencyMs: Math.max(1, Math.round(performance.now() - start)),
        message: err instanceof Error ? err.message : "Embedding connection failed",
      };
    }
  }

  async getIndexStatus(principal: Principal): Promise<SearchIndexStatus> {
    const embedder = await this.resolveActiveEmbedder(principal.workspaceId);
    const modelKey = buildEmbeddingModelKey(embedder.providerName, embedder.model);
    const stats = await this.repos.searchConfigRepo.getEmbeddingIndexStats(
      principal.workspaceId,
      modelKey,
    );
    const allDocs = await this.repos.documentRepo.listDocumentSummaries(principal.workspaceId, {
      includeTrashed: false,
      includeSystem: false,
      limit: null,
    });

    const fallbackDim =
      embedder.providerName === "local"
        ? DEFAULT_LOCAL_EMBEDDING_DIMENSIONS
        : (EMBEDDING_PROVIDER_DEFAULTS[embedder.providerName]?.dimensions ??
            DEFAULT_LOCAL_EMBEDDING_DIMENSIONS);

    const progress = this.reindexProgress.get(principal.workspaceId) ?? {
      active: false,
      processedDocs: 0,
      totalDocs: 0,
      processedChunks: 0,
    };

    return {
      provider: embedder.providerName,
      model: embedder.model,
      modelKey,
      dimensions: stats.dimensions ?? fallbackDim,
      totalDocuments: allDocs.length,
      indexedDocuments: stats.indexedDocuments,
      totalChunks: stats.totalChunks,
      indexedChunks: stats.indexedChunks,
      pendingJobs: this.pendingJobs.size,
      lastIndexedAt: stats.lastIndexedAt,
      reindexing: { ...progress },
    };
  }

  async indexDocument(
    doc: DocumentRecord,
    outlineNodes?: readonly OutlineNode[],
  ): Promise<{
    readonly record: DocumentEmbeddingRecord | null;
    readonly skipped: boolean;
    readonly chunksCount: number;
  }> {
    if (doc.trashedAt !== null || isSystemInternalDocument(doc)) {
      await this.repos.searchConfigRepo.deleteDocumentChunks(doc.workspaceId, doc.id);
      await this.repos.searchConfigRepo.deleteDocumentEmbedding(doc.workspaceId, doc.id);
      await this.oramaIndex.removeDocument(doc.workspaceId, doc.id);
      return { record: null, skipped: true, chunksCount: 0 };
    }

    const embedder = await this.resolveActiveEmbedder(doc.workspaceId);
    const preferredModelKey = buildEmbeddingModelKey(embedder.providerName, embedder.model);

    const nodes =
      outlineNodes ??
      (doc.kind === "outline" ? await this.repos.outlineRepo.listOutlineNodes(doc.id) : undefined);

    const pdfAsset = this.repos.attachmentRepo
      ? await this.repos.attachmentRepo.getDocumentAssetByDocumentId(doc.workspaceId, doc.id)
      : null;

    const drafts = chunkDocumentContent({
      docId: doc.id,
      title: doc.title,
      kind: doc.kind,
      contentMarkdown: doc.contentMarkdown,
      contentText: doc.contentText,
      tags: doc.tags,
      outlineNodes: nodes,
      pdfPages: pdfAsset?.assetKind === "pdf" ? pdfAsset.extractedPages : undefined,
    });

    const persistedChunks = await this.repos.searchConfigRepo.replaceDocumentChunks(
      doc.workspaceId,
      doc.id,
      drafts,
    );

    const existingChunkEmbeddings = await this.repos.searchConfigRepo.listChunkEmbeddings(
      doc.workspaceId,
      preferredModelKey,
      { docIds: [doc.id] },
    );
    const embByChunkId = new Map<DocumentChunkId, ChunkEmbeddingRecord>(
      existingChunkEmbeddings.map((e) => [e.chunkId, e]),
    );

    const missingChunks = persistedChunks.filter((c) => {
      const existing = embByChunkId.get(c.id);
      return !existing || existing.vector.length === 0;
    });

    let effectiveModelKey = preferredModelKey;
    let effectiveModel = embedder.model;
    let changedEmbeddings = false;

    if (missingChunks.length > 0) {
      const embedded = await this.embedTextsWithFallback(
        embedder,
        missingChunks.map((c) => c.contentText),
      );
      effectiveModelKey = embedded.modelKey;
      effectiveModel = embedded.model;

      const toStore = missingChunks.map((chunk, idx) => {
        const vector = embedded.vectors[idx] ?? [];
        return {
          chunkId: chunk.id,
          modelKey: effectiveModelKey,
          dimensions: vector.length,
          vector,
        };
      });

      await this.repos.searchConfigRepo.upsertChunkEmbeddings(doc.workspaceId, toStore);
      changedEmbeddings = true;

      if (effectiveModelKey === preferredModelKey) {
        for (const item of toStore) {
          embByChunkId.set(item.chunkId, {
            chunkId: item.chunkId,
            workspaceId: doc.workspaceId,
            modelKey: item.modelKey,
            dimensions: item.dimensions,
            vector: item.vector,
            updatedAt: doc.updatedAt,
          });
        }
      } else {
        // Reload embeddings under fallback model key if provider degraded
        const fallbackList = await this.repos.searchConfigRepo.listChunkEmbeddings(
          doc.workspaceId,
          effectiveModelKey,
          { docIds: [doc.id] },
        );
        embByChunkId.clear();
        for (const item of fallbackList) {
          embByChunkId.set(item.chunkId, item);
        }
        // Compute any remaining chunks missing under fallbackModelKey
        const missingUnderFallback = persistedChunks.filter((c) => !embByChunkId.has(c.id));
        if (missingUnderFallback.length > 0) {
          const fallbackVecs = await this.fallbackProvider.embedMany(
            missingUnderFallback.map((c) => c.contentText),
          );
          const extraStore = missingUnderFallback.map((c, idx) => ({
            chunkId: c.id,
            modelKey: effectiveModelKey,
            dimensions: (fallbackVecs[idx] ?? []).length,
            vector: fallbackVecs[idx] ?? [],
          }));
          await this.repos.searchConfigRepo.upsertChunkEmbeddings(doc.workspaceId, extraStore);
          for (const item of extraStore) {
            embByChunkId.set(item.chunkId, {
              chunkId: item.chunkId,
              workspaceId: doc.workspaceId,
              modelKey: item.modelKey,
              dimensions: item.dimensions,
              vector: item.vector,
              updatedAt: doc.updatedAt,
            });
          }
        }
      }
    }

    const oramaEntries: OramaChunkEntry[] = [];
    for (const chunk of persistedChunks) {
      const emb = embByChunkId.get(chunk.id);
      if (!emb || emb.vector.length === 0) continue;
      oramaEntries.push({
        chunk,
        title: doc.title,
        spaceId: doc.spaceId,
        kind: doc.kind,
        tags: doc.tags,
        vector: emb.vector,
      });
    }

    const dimensions = oramaEntries[0]?.vector.length ?? DEFAULT_LOCAL_EMBEDDING_DIMENSIONS;
    if (oramaEntries.length > 0) {
      await this.oramaIndex.upsertDocumentEntries(
        doc.workspaceId,
        effectiveModelKey,
        dimensions,
        doc.id,
        oramaEntries,
      );
    } else {
      await this.oramaIndex.removeDocument(doc.workspaceId, doc.id);
    }

    // Keep legacy doc-level `document_embeddings` synchronized for related docs compatibility
    const fullText = buildDocumentEmbeddingText(doc, nodes);
    const contentHash = hashTextForEmbedding(fullText);
    const docVector = averageVectors(oramaEntries.map((e) => e.vector));
    const existingDocEmb = await this.repos.searchConfigRepo.getDocumentEmbedding(
      doc.workspaceId,
      doc.id,
    );

    if (
      existingDocEmb &&
      existingDocEmb.contentHash === contentHash &&
      existingDocEmb.model === effectiveModel &&
      existingDocEmb.vector.length === docVector.length &&
      !changedEmbeddings
    ) {
      return { record: existingDocEmb, skipped: true, chunksCount: persistedChunks.length };
    }

    const saved =
      docVector.length > 0
        ? await this.repos.searchConfigRepo.upsertDocumentEmbedding(doc.workspaceId, {
            documentId: doc.id,
            model: effectiveModel,
            dimensions: docVector.length,
            vector: docVector,
            contentHash,
          })
        : null;

    return {
      record: saved,
      skipped: !changedEmbeddings && Boolean(existingDocEmb),
      chunksCount: persistedChunks.length,
    };
  }

  scheduleIndexDocument(workspaceId: WorkspaceId, documentId: DocumentId): void {
    const key = `${workspaceId}:${documentId}`;
    if (this.pendingJobs.has(key)) return;

    const job = (async () => {
      try {
        const doc = await this.repos.documentRepo.getDocumentById(workspaceId, documentId);
        if (!doc) {
          await this.repos.searchConfigRepo.deleteDocumentChunks(workspaceId, documentId);
          await this.repos.searchConfigRepo.deleteDocumentEmbedding(workspaceId, documentId);
          await this.oramaIndex.removeDocument(workspaceId, documentId);
          return;
        }
        await this.indexDocument(doc);
      } catch (err) {
        this.logger?.warn({ err, workspaceId, documentId }, "Background embedding indexing failed");
      } finally {
        this.pendingJobs.delete(key);
      }
    })();

    this.pendingJobs.set(key, job);
  }

  async reindexWorkspace(principal: Principal): Promise<ReindexSearchResult> {
    const allSpaces = await getAllWorkspaceSpaces(
      this.spacesCache ?? this.repos.spaceRepo,
      principal.workspaceId,
    );
    assertAdminPrincipal(principal, allSpaces);

    const embedder = await this.resolveActiveEmbedder(principal.workspaceId);
    const docs = await this.repos.documentRepo.listDocuments(principal.workspaceId, {
      includeTrashed: false,
      includeSystem: false,
      limit: null,
    });
    const visibleDocs = docs.filter((d) => !isSystemInternalDocument(d));

    const progress = {
      active: true,
      processedDocs: 0,
      totalDocs: visibleDocs.length,
      processedChunks: 0,
    };
    this.reindexProgress.set(principal.workspaceId, progress);

    let indexedCount = 0;
    let skippedCount = 0;
    try {
      for (const doc of visibleDocs) {
        const res = await this.indexDocument(doc);
        if (res.skipped) skippedCount++;
        else indexedCount++;
        progress.processedDocs += 1;
        progress.processedChunks += res.chunksCount;
      }
    } finally {
      progress.active = false;
    }

    return {
      indexedCount,
      skippedCount,
      provider: embedder.providerName,
      model: embedder.model,
    };
  }

  private async ensureHydratedAndIndexed(
    workspaceId: WorkspaceId,
    authorizedDocs: readonly DocumentRecord[],
    embedder: EmbeddingProvider,
  ): Promise<{
    readonly modelKey: string;
    readonly provider: string;
    readonly model: string;
    readonly dimensions: number;
    readonly chunksById: ReadonlyMap<DocumentChunkId, DocumentChunkRecord>;
    readonly chunksByDocId: ReadonlyMap<DocumentId, readonly DocumentChunkRecord[]>;
  }> {
    const targetModelKey = buildEmbeddingModelKey(embedder.providerName, embedder.model);
    const docIds = authorizedDocs.map((d) => d.id);
    const docMap = new Map(authorizedDocs.map((d) => [d.id, d]));

    let chunks = await this.repos.searchConfigRepo.listDocumentChunks(workspaceId, { docIds });
    let embeddings = await this.repos.searchConfigRepo.listChunkEmbeddings(
      workspaceId,
      targetModelKey,
      { docIds },
    );

    const chunksByDocPre = new Map<DocumentId, DocumentChunkRecord[]>();
    for (const c of chunks) {
      const list = chunksByDocPre.get(c.docId) ?? [];
      list.push(c);
      chunksByDocPre.set(c.docId, list);
    }
    const embByChunkPre = new Map<DocumentChunkId, ChunkEmbeddingRecord>(
      embeddings.map((e) => [e.chunkId, e]),
    );

    const docsNeedingIndex: DocumentRecord[] = [];
    for (const doc of authorizedDocs) {
      const docChunks = chunksByDocPre.get(doc.id);
      if (!docChunks || docChunks.length === 0) {
        docsNeedingIndex.push(doc);
        continue;
      }
      const missingVec = docChunks.some((c) => {
        const emb = embByChunkPre.get(c.id);
        return !emb || emb.vector.length === 0;
      });
      if (missingVec) {
        docsNeedingIndex.push(doc);
      }
    }

    let usedProvider = embedder.providerName;
    let usedModel = embedder.model;
    let effectiveModelKey = targetModelKey;

    if (docsNeedingIndex.length > 0) {
      for (const doc of docsNeedingIndex) {
        await this.indexDocument(doc);
      }
      chunks = await this.repos.searchConfigRepo.listDocumentChunks(workspaceId, { docIds });
      embeddings = await this.repos.searchConfigRepo.listChunkEmbeddings(
        workspaceId,
        targetModelKey,
        { docIds },
      );

      // Check if provider fell back to local during indexDocument
      if (embeddings.length === 0 && targetModelKey !== "local:local-ngram-128") {
        const localKey = "local:local-ngram-128";
        const localEmbeddings = await this.repos.searchConfigRepo.listChunkEmbeddings(
          workspaceId,
          localKey,
          { docIds },
        );
        if (localEmbeddings.length > 0) {
          embeddings = localEmbeddings;
          effectiveModelKey = localKey;
          usedProvider = this.fallbackProvider.providerName;
          usedModel = this.fallbackProvider.model;
        }
      }
    }

    const chunksById = new Map<DocumentChunkId, DocumentChunkRecord>(chunks.map((c) => [c.id, c]));
    const chunksByDocId = new Map<DocumentId, DocumentChunkRecord[]>();
    for (const c of chunks) {
      const list = chunksByDocId.get(c.docId) ?? [];
      list.push(c);
      chunksByDocId.set(c.docId, list);
    }

    const embByChunk = new Map<DocumentChunkId, ChunkEmbeddingRecord>(
      embeddings.map((e) => [e.chunkId, e]),
    );
    const activeDimensions =
      embeddings[0]?.dimensions ??
      this.oramaIndex.getActiveDimensionsForModel(workspaceId, effectiveModelKey) ??
      DEFAULT_LOCAL_EMBEDDING_DIMENSIONS;

    if (!this.oramaIndex.isBucketHydrated(workspaceId, effectiveModelKey, activeDimensions)) {
      // Load ALL workspace non-system chunks for this modelKey into Orama at once
      const allWorkspaceDocs = await this.repos.documentRepo.listDocuments(workspaceId, {
        includeTrashed: false,
        includeSystem: false,
        limit: null,
      });
      const allDocMap = new Map(
        allWorkspaceDocs
          .filter((d) => !isSystemInternalDocument(d))
          .map((d) => [d.id, d]),
      );
      const allChunks = await this.repos.searchConfigRepo.listDocumentChunks(workspaceId);
      const allEmbs = await this.repos.searchConfigRepo.listChunkEmbeddings(
        workspaceId,
        effectiveModelKey,
      );
      const allEmbMap = new Map(allEmbs.map((e) => [e.chunkId, e]));

      const entries: OramaChunkEntry[] = [];
      for (const c of allChunks) {
        const d = allDocMap.get(c.docId) ?? docMap.get(c.docId);
        const emb = allEmbMap.get(c.id) ?? embByChunk.get(c.id);
        if (!d || !emb || emb.vector.length !== activeDimensions) continue;
        entries.push({
          chunk: c,
          title: d.title,
          spaceId: d.spaceId,
          kind: d.kind,
          tags: d.tags,
          vector: emb.vector,
        });
      }
      await this.oramaIndex.replaceWorkspaceIndex(
        workspaceId,
        effectiveModelKey,
        activeDimensions,
        entries,
      );
    }

    return {
      modelKey: effectiveModelKey,
      provider: usedProvider,
      model: usedModel,
      dimensions: activeDimensions,
      chunksById,
      chunksByDocId,
    };
  }

  private async resolveAuthorizedDocs(
    principal: Principal,
    input: {
      readonly spaceId?: SpaceId | undefined;
      readonly kind?: DocumentKind | undefined;
      readonly tag?: string | undefined;
      readonly documentIds?: readonly DocumentId[] | undefined;
    },
  ): Promise<{
    readonly allSpaces: Awaited<ReturnType<typeof getAllWorkspaceSpaces>>;
    readonly searchSpaceIds: SpaceId[] | undefined;
    readonly authorizedDocs: DocumentRecord[];
  }> {
    const allSpaces = await getAllWorkspaceSpaces(
      this.spacesCache ?? this.repos.spaceRepo,
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
      return { allSpaces, searchSpaceIds: [], authorizedDocs: [] };
    }

    const docIdFilterSet =
      input.documentIds !== undefined ? new Set<DocumentId>(input.documentIds) : null;
    if (docIdFilterSet && docIdFilterSet.size === 0) {
      return { allSpaces, searchSpaceIds, authorizedDocs: [] };
    }

    const allDocs = await this.repos.documentRepo.listDocuments(principal.workspaceId, {
      spaceIds: searchSpaceIds,
      kind: input.kind,
      allowedKinds: principal.scope.allowedKinds,
      tag: input.tag,
      tagAllowlist: principal.scope.tagAllowlist,
      includeTrashed: false,
      includeSystem: false,
      limit: null,
    });

    const authorizedDocs = allDocs.filter((doc) => {
      if (isSystemInternalDocument(doc)) return false;
      if (docIdFilterSet && !docIdFilterSet.has(doc.id)) return false;
      if (input.tag && !doc.tags.includes(input.tag)) return false;
      return evaluateScopeAccess(
        principal.scope,
        "read",
        { spaceId: doc.spaceId, kind: doc.kind, tags: doc.tags },
        allSpaces,
      ).allowed;
    });

    return { allSpaces, searchSpaceIds, authorizedDocs };
  }

  async searchChunks(
    principal: Principal,
    input: SearchChunksInput,
  ): Promise<readonly ChunkSearchHit[]> {
    const { searchSpaceIds, authorizedDocs } = await this.resolveAuthorizedDocs(principal, input);
    if (authorizedDocs.length === 0) return [];

    const authorizedDocMap = new Map(authorizedDocs.map((d) => [d.id, d]));
    const authorizedDocIds = authorizedDocs.map((d) => d.id);
    const embedder = await this.resolveActiveEmbedder(principal.workspaceId);

    const { modelKey, dimensions, chunksByDocId } = await this.ensureHydratedAndIndexed(
      principal.workspaceId,
      authorizedDocs,
      embedder,
    );

    // 1. SQLite FTS5 lexical hits mapped to chunks
    const ftsEntries: Array<{
      readonly key: string;
      readonly chunkHit: ChunkSearchHit;
    }> = [];

    if (input.mode === "keyword" || input.mode === "hybrid") {
      const ftsHits = await this.repos.searchConfigRepo.searchFts(
        principal.workspaceId,
        input.q,
        {
          spaceIds: searchSpaceIds,
          kind: input.kind,
          allowedKinds: principal.scope.allowedKinds,
          tag: input.tag,
          tagAllowlist: principal.scope.tagAllowlist,
          includeSystem: false,
          limit: Math.min(Math.max(input.limit * 4, 40), 100),
        },
      );

      for (const hit of ftsHits) {
        const doc = authorizedDocMap.get(hit.documentId);
        if (!doc) continue;
        const docChunks = chunksByDocId.get(doc.id) ?? [];
        const matchedChunk =
          (hit.nodeId ? docChunks.find((c) => c.nodeId === hit.nodeId) : undefined) ??
          docChunks[0];
        if (!matchedChunk) continue;
        const chunkKey = matchedChunk.id;
        if (ftsEntries.some((e) => e.key === chunkKey)) continue;
        ftsEntries.push({
          key: chunkKey,
          chunkHit: {
            chunkId: matchedChunk.id,
            docId: doc.id,
            spaceId: doc.spaceId,
            kind: doc.kind,
            title: doc.title,
            headingPath: matchedChunk.headingPath,
            nodeId: hit.nodeId ?? matchedChunk.nodeId,
            snippet: hit.snippet || matchedChunk.snippet || doc.excerpt || "",
            contentText: matchedChunk.contentText,
            tags: doc.tags,
            score: hit.score,
            keywordScore: hit.score,
            matchSource: "keyword",
            updatedAt: doc.updatedAt,
          },
        });
      }
    }

    if (input.mode === "keyword") {
      // Also run Orama fulltext when FTS5 returns empty (e.g. exact punctuation/case queries)
      if (ftsEntries.length >= input.limit) {
        return ftsEntries.slice(0, input.limit).map((e) => e.chunkHit);
      }
      const oramaTextHits = await this.oramaIndex.searchChunks({
        workspaceId: principal.workspaceId,
        modelKey,
        dimensions,
        mode: "keyword",
        queryText: input.q,
        queryVector: [],
        authorizedDocIds,
        spaceIds: searchSpaceIds,
        kind: input.kind,
        tag: input.tag,
        limit: input.limit,
      });
      const seen = new Set(ftsEntries.map((e) => e.key));
      const merged = ftsEntries.map((e) => e.chunkHit);
      for (const oh of oramaTextHits) {
        if (seen.has(oh.chunkId)) continue;
        seen.add(oh.chunkId);
        merged.push({
          chunkId: oh.chunkId,
          docId: oh.docId,
          spaceId: oh.spaceId,
          kind: oh.kind,
          title: oh.title,
          headingPath: oh.headingPath,
          nodeId: oh.nodeId,
          snippet: oh.snippet,
          contentText: oh.contentText,
          tags: oh.tags,
          score: oh.score,
          keywordScore: oh.score,
          matchSource: "keyword",
          updatedAt: oh.updatedAt,
        });
      }
      return merged.slice(0, input.limit);
    }

    // 2. Orama Hybrid / Vector chunk retrieval
    const queryEmbResult = await this.embedTextsWithFallback(embedder, [input.q]);
    const queryVector = queryEmbResult.vectors[0] ?? [];
    const effectiveModelKey =
      queryEmbResult.modelKey === modelKey || queryVector.length === dimensions
        ? modelKey
        : queryEmbResult.modelKey;

    const oramaHits = await this.oramaIndex.searchChunks({
      workspaceId: principal.workspaceId,
      modelKey: effectiveModelKey,
      dimensions: queryVector.length || dimensions,
      mode: input.mode === "semantic" ? "semantic" : "hybrid",
      queryText: input.q,
      queryVector,
      authorizedDocIds,
      spaceIds: searchSpaceIds,
      kind: input.kind,
      tag: input.tag,
      limit: Math.max(input.limit * 3, 40),
    });

    if (input.mode === "semantic") {
      return oramaHits.slice(0, input.limit).map((oh) => ({
        chunkId: oh.chunkId,
        docId: oh.docId,
        spaceId: oh.spaceId,
        kind: oh.kind,
        title: oh.title,
        headingPath: oh.headingPath,
        nodeId: oh.nodeId,
        snippet: oh.snippet,
        contentText: oh.contentText,
        tags: oh.tags,
        score: oh.score,
        semanticScore: oh.score,
        matchSource: "semantic",
        updatedAt: oh.updatedAt,
      }));
    }

    // 3. Fuse FTS5 & Orama chunk rankings with RRF (k = 60)
    const ftsMap = new Map(ftsEntries.map((e) => [e.key, e.chunkHit]));
    const oramaMap = new Map(oramaHits.map((oh) => [oh.chunkId, oh]));

    const fused = computeRrfFusion<ChunkSearchHit>(
      [
        ftsEntries.map((e) => ({ key: e.key, item: e.chunkHit })),
        oramaHits.map((oh) => ({
          key: oh.chunkId,
          item: {
            chunkId: oh.chunkId,
            docId: oh.docId,
            spaceId: oh.spaceId,
            kind: oh.kind,
            title: oh.title,
            headingPath: oh.headingPath,
            nodeId: oh.nodeId,
            snippet: oh.snippet,
            contentText: oh.contentText,
            tags: oh.tags,
            score: oh.score,
            semanticScore: oh.score,
            matchSource: "semantic",
            updatedAt: oh.updatedAt,
          },
        })),
      ],
      { k: 60 },
    );

    return fused.slice(0, input.limit).map((entry) => {
      const kw = ftsMap.get(entry.key);
      const sem = oramaMap.get(entry.key as DocumentChunkId);
      const matchSource: SemanticSearchHit["matchSource"] =
        kw && sem ? "hybrid" : sem ? "semantic" : "keyword";

      return {
        ...entry.item,
        score: entry.score,
        ...(kw ? { keywordScore: kw.score, snippet: kw.snippet } : {}),
        ...(sem ? { semanticScore: sem.score } : {}),
        matchSource,
      };
    });
  }

  async hybridSearch(
    principal: Principal,
    input: SemanticSearchInput,
  ): Promise<SemanticSearchResult> {
    const embedder = await this.resolveActiveEmbedder(principal.workspaceId);

    if (principal.kind === "token" && this.auditService) {
      await this.auditService
        .recordPrincipalEvent(principal, {
          transport: "rest",
          action: "semantic_search",
          resource: "search:semantic",
          spaceId: input.spaceId ?? null,
          decision: "allowed",
          summary: `Semantic search (${input.mode}): ${input.q.slice(0, 80)}`,
        })
        .catch(() => {});
    }

    const chunkHits = await this.searchChunks(principal, {
      ...input,
      limit: Math.min(100, Math.max(input.limit * 4, 40)),
    });

    // Deduplicate to document level keeping highest-scoring chunk per document
    const bestByDoc = new Map<DocumentId, ChunkSearchHit>();
    for (const chunkHit of chunkHits) {
      if (!bestByDoc.has(chunkHit.docId)) {
        bestByDoc.set(chunkHit.docId, chunkHit);
      }
    }

    const hits: SemanticSearchHit[] = [...bestByDoc.values()]
      .slice(0, input.limit)
      .map((chunkHit) => ({
        documentId: chunkHit.docId,
        spaceId: chunkHit.spaceId,
        kind: chunkHit.kind,
        title: chunkHit.title,
        snippet: chunkHit.snippet,
        tags: chunkHit.tags,
        score: chunkHit.score,
        ...(chunkHit.keywordScore !== undefined ? { keywordScore: chunkHit.keywordScore } : {}),
        ...(chunkHit.semanticScore !== undefined ? { semanticScore: chunkHit.semanticScore } : {}),
        matchSource: chunkHit.matchSource,
        headingPath: chunkHit.headingPath,
        nodeId: chunkHit.nodeId,
        chunkId: chunkHit.chunkId,
        updatedAt: chunkHit.updatedAt,
      }));

    return {
      hits,
      mode: input.mode,
      provider: embedder.providerName,
      model: embedder.model,
    };
  }

  async getRelatedDocuments(
    principal: Principal,
    documentId: DocumentId,
    limit = 10,
  ): Promise<readonly RelatedDocumentHit[]> {
    const sourceDoc = await this.repos.documentRepo.getDocumentById(
      principal.workspaceId,
      documentId,
    );
    if (!sourceDoc || sourceDoc.trashedAt !== null || isSystemInternalDocument(sourceDoc)) {
      throw new InkadeError("NOT_FOUND", `Document "${documentId}" not found`);
    }

    const allSpaces = await getAllWorkspaceSpaces(
      this.spacesCache ?? this.repos.spaceRepo,
      principal.workspaceId,
    );
    assertScope(
      principal.scope,
      "read",
      { spaceId: sourceDoc.spaceId, kind: sourceDoc.kind, tags: sourceDoc.tags },
      allSpaces,
    );

    const { authorizedDocs } = await this.resolveAuthorizedDocs(principal, {});
    const embedder = await this.resolveActiveEmbedder(principal.workspaceId);

    for (const doc of authorizedDocs) {
      const existing = await this.repos.searchConfigRepo.getDocumentEmbedding(
        principal.workspaceId,
        doc.id,
      );
      if (!existing || existing.vector.length === 0 || existing.model !== embedder.model) {
        await this.indexDocument(doc);
      }
    }

    const existingList = await this.repos.searchConfigRepo.listDocumentEmbeddings(
      principal.workspaceId,
    );
    const byDocId = new Map<DocumentId, DocumentEmbeddingRecord>(
      existingList.map((e) => [e.documentId, e]),
    );
    const sourceEmbedding = byDocId.get(sourceDoc.id);
    if (!sourceEmbedding || sourceEmbedding.vector.length === 0) {
      return [];
    }

    const candidates: RelatedDocumentHit[] = [];
    for (const doc of authorizedDocs) {
      if (doc.id === sourceDoc.id) continue;
      const emb = byDocId.get(doc.id);
      if (!emb || emb.vector.length !== sourceEmbedding.vector.length) continue;
      const similarity = cosineSimilarity(sourceEmbedding.vector, emb.vector);
      if (similarity <= 0) continue;
      candidates.push({
        documentId: doc.id,
        spaceId: doc.spaceId,
        kind: doc.kind,
        title: doc.title,
        excerpt: doc.excerpt,
        tags: doc.tags,
        similarity,
        updatedAt: doc.updatedAt,
      });
    }

    candidates.sort((a, b) => b.similarity - a.similarity);
    return candidates.slice(0, Math.max(1, Math.min(limit, 50)));
  }
}
