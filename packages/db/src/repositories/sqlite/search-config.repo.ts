import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  AI_PROVIDER_DEFAULTS,
  asContextPackId,
  asDocumentChunkId,
  asDocumentId,
  asIngestWebhookId,
  asOutlineNodeId,
  asRssFeedId,
  asSpaceId,
  asWorkspaceId,
  buildFtsMatchQuery,
  cloneDefaultUserPreferences,
  contextPackRulesSchema,
  createId,
  EMBEDDING_PROVIDER_DEFAULTS,
  ID_PREFIXES,
  InkadeError,
  maskApiKey,
  mergeUserPreferences,
  numberArraySchema,
  parseJsonWithSchema,
  parseUserPreferences,
  slugifyContextPackName,
  stringArraySchema,
  type AiProviderPreset,
  type AiSettingsRecord,
  type CalendarEventCacheRecord,
  type CalendarSubId,
  type CalendarSubscription,
  type ChunkEmbeddingRecord,
  type ContextPack,
  type ContextPackId,
  type CreateCalendarSubscriptionInput,
  type CreateContextPackInput,
  type CreateIngestWebhookInput,
  type CreateRssFeedInput,
  type DocumentChunkDraft,
  type DocumentChunkId,
  type DocumentChunkRecord,
  type DocumentEmbeddingRecord,
  type DocumentId,
  type DocumentKind,
  type EmbeddingProviderPreset,
  type IngestWebhookId,
  type IngestWebhookRecord,
  type RssFeedId,
  type RssFeedRecord,
  type SearchHit,
  type SpaceId,
  type UpdateAiSettingsInput,
  type UpdateCalendarSubscriptionInput,
  type UpdateContextPackInput,
  type UpdateIngestWebhookInput,
  type UpdateRssFeedInput,
  type UserPreferencesPatch,
  type UserPreferencesRecord,
} from "@inkade/core";
import {
  aiSettings,
  calendarEventsCache,
  calendarSubscriptions,
  chunkEmbeddings,
  contextPacks,
  documentChunks,
  documentEmbeddings,
  documents,
  documentYjsStates,
  ingestWebhooks,
  rssFeeds,
  userPreferences,
} from "../../schema/sqlite.ts";
import type {
  AiSettingsSecretRecord,
  SearchConfigRepo,
  SearchFtsOptions,
  UpsertFtsEntryInput,
} from "../ports/search-config.port.ts";
import {
  deleteDocumentFtsSync,
  loadTagsForDocumentsSync,
  nowIso,
  syncToPromise,
  upsertFtsEntrySync,
  type SqliteRepoContext,
} from "./helpers.ts";
import { mapCalendarEventCacheRow, mapCalendarSubscriptionRow } from "./mappers.ts";

function highlightSnippetFallback(snippet: string, rawQuery: string): string {
  if (!snippet || snippet.includes("<mark>")) return snippet;
  const terms = rawQuery
    .trim()
    .split(/[^\p{L}\p{N}_]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length >= 1)
    .sort((a, b) => b.length - a.length);
  if (terms.length === 0) return snippet;
  const regex = new RegExp(
    `(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
    "gi",
  );
  return snippet.replace(regex, "<mark>$1</mark>");
}

function normalizeAiProviderPreset(raw: string): AiProviderPreset {
  if (
    raw === "openai" ||
    raw === "anthropic" ||
    raw === "deepseek" ||
    raw === "ollama" ||
    raw === "custom"
  ) {
    return raw;
  }
  return "custom";
}

function normalizeEmbeddingProviderPreset(raw: string): EmbeddingProviderPreset {
  if (
    raw === "local" ||
    raw === "ollama" ||
    raw === "openai" ||
    raw === "openai-compatible"
  ) {
    return raw;
  }
  return "local";
}

function encodeFloat32Vector(vector: readonly number[]): Buffer {
  const arr = new Float32Array(vector.length);
  for (let i = 0; i < vector.length; i++) {
    arr[i] = vector[i] ?? 0;
  }
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
}

function decodeFloat32Vector(raw: Uint8Array | Buffer): number[] {
  if (!raw || raw.byteLength === 0 || raw.byteLength % 4 !== 0) {
    return [];
  }
  const aligned = new Uint8Array(raw.byteLength);
  aligned.set(raw);
  const f32 = new Float32Array(aligned.buffer);
  return Array.from(f32);
}

function mapContextPackRow(row: typeof contextPacks.$inferSelect): ContextPack {
  const rules = parseJsonWithSchema(row.rulesJson, contextPackRulesSchema, {
    excludeSystem: true,
  });
  return {
    id: asContextPackId(row.id),
    workspaceId: asWorkspaceId(row.workspaceId),
    slug: row.slug,
    name: row.name,
    description: row.description,
    rules,
    maxTokens: row.maxTokens,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapRssFeedRow(row: typeof rssFeeds.$inferSelect): RssFeedRecord {
  return {
    id: asRssFeedId(row.id),
    workspaceId: asWorkspaceId(row.workspaceId),
    url: row.url,
    title: row.title,
    targetSpaceId: asSpaceId(row.targetSpaceId),
    enabled: Boolean(row.enabled),
    etag: row.etag,
    lastModified: row.lastModified,
    lastFetchedAt: row.lastFetchedAt,
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapIngestWebhookRow(row: typeof ingestWebhooks.$inferSelect): IngestWebhookRecord {
  return {
    id: asIngestWebhookId(row.id),
    workspaceId: asWorkspaceId(row.workspaceId),
    name: row.name,
    tokenPrefix: row.tokenPrefix,
    targetSpaceId: asSpaceId(row.targetSpaceId),
    defaultKind: row.defaultKind as DocumentKind,
    tags: parseJsonWithSchema(row.tagsJson, stringArraySchema, []),
    enabled: Boolean(row.enabled),
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt,
  };
}

export class SqliteSearchConfigRepo implements SearchConfigRepo {
  constructor(private readonly ctx: SqliteRepoContext) {}

  private mapAiSettingsRow(row: typeof aiSettings.$inferSelect): AiSettingsRecord {
    const provider = normalizeAiProviderPreset(row.provider);
    const embeddingProvider = normalizeEmbeddingProviderPreset(row.embeddingProvider);
    return {
      workspaceId: asWorkspaceId(row.workspaceId),
      enabled: Boolean(row.enabled),
      provider,
      baseUrl: row.baseUrl,
      model: row.model,
      hasApiKey: row.apiKey.trim().length > 0,
      apiKeyMasked: maskApiKey(row.apiKey),
      temperature: Number.isFinite(row.temperature) ? row.temperature : 0.3,
      embeddingProvider,
      embeddingBaseUrl: row.embeddingBaseUrl,
      embeddingModel: row.embeddingModel,
      hasEmbeddingApiKey: row.embeddingApiKey.trim().length > 0,
      embeddingApiKeyMasked: maskApiKey(row.embeddingApiKey),
      updatedAt: row.updatedAt,
    };
  }

  searchFts(
    workspaceId: string,
    query: string,
    options?: SearchFtsOptions,
  ): Promise<readonly SearchHit[]> {
    return syncToPromise(() => {
      const ftsQuery = buildFtsMatchQuery(query);
      if (!ftsQuery) return [];
      if (options?.spaceIds !== undefined && options.spaceIds.length === 0) return [];
      if (options?.allowedKinds !== undefined && options.allowedKinds.length === 0) return [];

      const whereClauses: string[] = ["workspace_id = ?", "search_fts MATCH ?"];
      const params: Array<string | number> = [query.trim(), workspaceId, ftsQuery];

      if (!options?.includeSystem) {
        whereClauses.push(
          "EXISTS (SELECT 1 FROM documents d WHERE d.id = search_fts.document_id AND d.trashed_at IS NULL AND (d.properties_json IS NULL OR (json_extract(d.properties_json, '$.systemRole') IS NULL AND coalesce(json_extract(d.properties_json, '$.isSystemInternal'), 0) != 1)) AND d.space_id != '_system' AND d.space_id NOT LIKE 'spc\\_\\_system%' ESCAPE '\\')",
        );
      }

      if (options?.spaceIds && options.spaceIds.length > 0) {
        whereClauses.push(`space_id IN (${options.spaceIds.map(() => "?").join(", ")})`);
        params.push(...options.spaceIds);
      }
      if (options?.kind) {
        whereClauses.push("kind = ?");
        params.push(options.kind);
      }
      if (options?.allowedKinds && options.allowedKinds.length > 0) {
        whereClauses.push(`kind IN (${options.allowedKinds.map(() => "?").join(", ")})`);
        params.push(...options.allowedKinds);
      }
      if (options?.tag) {
        whereClauses.push(
          "EXISTS (SELECT 1 FROM document_tags dt WHERE dt.document_id = search_fts.document_id AND dt.tag = ?)",
        );
        params.push(options.tag);
      }
      if (options?.tagAllowlist && options.tagAllowlist.length > 0) {
        whereClauses.push(
          `EXISTS (SELECT 1 FROM document_tags dt WHERE dt.document_id = search_fts.document_id AND dt.tag IN (${options.tagAllowlist.map(() => "?").join(", ")}))`,
        );
        params.push(...options.tagAllowlist);
      }
      params.push(Math.min(Math.max(options?.limit ?? 25, 1), 100));

      const rows = this.ctx.sqlite
        .query<{
          entity_type: "document" | "outline_node";
          document_id: string;
          node_id: string | null;
          space_id: string;
          kind: DocumentKind;
          title: string;
          snippet: string | null;
          rank: number;
        }, Array<string | number>>(
          `SELECT entity_type, document_id, node_id, space_id, kind, title,
             snippet(search_fts, 8, '<mark>', '</mark>', '…', 20) AS snippet,
             (CASE WHEN instr(lower(title), lower(?)) > 0 THEN -50.0 ELSE 0.0 END) +
               bm25(search_fts, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 10.0, 2.0, 1.0) AS rank
           FROM search_fts WHERE ${whereClauses.join(" AND ")} ORDER BY rank ASC LIMIT ?`,
        )
        .all(...params);
      if (rows.length === 0) return [];

      const docIds = [...new Set(rows.map((r) => r.document_id))];
      const tagsMap = loadTagsForDocumentsSync(this.ctx.db, docIds);
      const updatedAtMap = new Map(
        this.ctx.db
          .select({ id: documents.id, updatedAt: documents.updatedAt })
          .from(documents)
          .where(inArray(documents.id, docIds))
          .all()
          .map((d) => [d.id, d.updatedAt]),
      );

      return rows.map((row) => ({
        entityType: row.entity_type,
        documentId: asDocumentId(row.document_id),
        nodeId: row.node_id ? asOutlineNodeId(row.node_id) : null,
        spaceId: asSpaceId(row.space_id),
        kind: row.kind,
        title: row.title,
        snippet: highlightSnippetFallback(row.snippet ?? "", query),
        tags: tagsMap.get(row.document_id) ?? [],
        score: Math.abs(row.rank),
        updatedAt: updatedAtMap.get(row.document_id) ?? nowIso(),
      }));
    });
  }

  upsertFtsEntry(entry: UpsertFtsEntryInput): Promise<void> {
    return syncToPromise(() => upsertFtsEntrySync(this.ctx.sqlite, entry));
  }

  deleteDocumentFts(documentId: string): Promise<void> {
    return syncToPromise(() => deleteDocumentFtsSync(this.ctx.sqlite, documentId));
  }

  deleteNodesFts(nodeIds: readonly string[]): Promise<void> {
    return syncToPromise(() => {
      for (const id of nodeIds) {
        this.ctx.sqlite.query("DELETE FROM search_fts WHERE entity_key = ?").run(`nod:${id}`);
      }
    });
  }

  updateDocumentNodesFtsSpace(documentId: string, spaceId: string): Promise<void> {
    return syncToPromise(() => {
      this.ctx.sqlite
        .query("UPDATE search_fts SET space_id = ? WHERE document_id = ? AND entity_type = 'outline_node'")
        .run(spaceId, documentId);
    });
  }

  getDocumentEmbedding(workspaceId: string, documentId: DocumentId | string): Promise<DocumentEmbeddingRecord | null> {
    return syncToPromise(() => {
      const row = this.ctx.db
        .select()
        .from(documentEmbeddings)
        .where(and(eq(documentEmbeddings.workspaceId, workspaceId), eq(documentEmbeddings.documentId, documentId)))
        .get();
      return row
        ? {
            documentId: asDocumentId(row.documentId),
            workspaceId: asWorkspaceId(row.workspaceId),
            model: row.model,
            dimensions: row.dimensions,
            vector: parseJsonWithSchema(row.vectorJson, numberArraySchema, []),
            contentHash: row.contentHash,
            updatedAt: row.updatedAt,
          }
        : null;
    });
  }

  listDocumentEmbeddings(workspaceId: string, model?: string): Promise<readonly DocumentEmbeddingRecord[]> {
    return syncToPromise(() => {
      const conds = [eq(documentEmbeddings.workspaceId, workspaceId)];
      if (model) conds.push(eq(documentEmbeddings.model, model));
      return this.ctx.db
        .select()
        .from(documentEmbeddings)
        .where(and(...conds))
        .all()
        .map((row) => ({
          documentId: asDocumentId(row.documentId),
          workspaceId: asWorkspaceId(row.workspaceId),
          model: row.model,
          dimensions: row.dimensions,
          vector: parseJsonWithSchema(row.vectorJson, numberArraySchema, []),
          contentHash: row.contentHash,
          updatedAt: row.updatedAt,
        }));
    });
  }

  upsertDocumentEmbedding(
    workspaceId: string,
    input: {
      readonly documentId: DocumentId | string;
      readonly model: string;
      readonly dimensions: number;
      readonly vector: readonly number[];
      readonly contentHash: string;
    },
  ): Promise<DocumentEmbeddingRecord> {
    return syncToPromise(() => {
      const ts = nowIso();
      const vectorJson = JSON.stringify(input.vector);
      this.ctx.db
        .insert(documentEmbeddings)
        .values({ documentId: input.documentId, workspaceId, model: input.model, dimensions: input.dimensions, vectorJson, contentHash: input.contentHash, updatedAt: ts })
        .onConflictDoUpdate({
          target: documentEmbeddings.documentId,
          set: { workspaceId, model: input.model, dimensions: input.dimensions, vectorJson, contentHash: input.contentHash, updatedAt: ts },
        })
        .run();
      return {
        documentId: asDocumentId(input.documentId),
        workspaceId: asWorkspaceId(workspaceId),
        model: input.model,
        dimensions: input.dimensions,
        vector: [...input.vector],
        contentHash: input.contentHash,
        updatedAt: ts,
      };
    });
  }

  deleteDocumentEmbedding(workspaceId: string, documentId: DocumentId | string): Promise<void> {
    return syncToPromise(() => {
      this.ctx.db
        .delete(documentEmbeddings)
        .where(and(eq(documentEmbeddings.workspaceId, workspaceId), eq(documentEmbeddings.documentId, documentId)))
        .run();
    });
  }

  getDocumentYjsState(workspaceId: string, documentId: string): Promise<string | null> {
    return syncToPromise(() => {
      const row = this.ctx.db
        .select({ stateBase64: documentYjsStates.stateBase64 })
        .from(documentYjsStates)
        .where(and(eq(documentYjsStates.workspaceId, workspaceId), eq(documentYjsStates.documentId, documentId)))
        .get();
      return row?.stateBase64 ?? null;
    });
  }

  upsertDocumentYjsState(workspaceId: string, documentId: string, stateBase64: string): Promise<void> {
    return syncToPromise(() => {
      const ts = nowIso();
      this.ctx.db
        .insert(documentYjsStates)
        .values({ documentId, workspaceId, stateBase64, updatedAt: ts })
        .onConflictDoUpdate({ target: documentYjsStates.documentId, set: { workspaceId, stateBase64, updatedAt: ts } })
        .run();
    });
  }

  async getAiSettings(workspaceId: string): Promise<AiSettingsRecord> {
    const s = await this.getAiSettingsSecret(workspaceId);
    return {
      workspaceId: s.workspaceId,
      enabled: s.enabled,
      provider: s.provider,
      baseUrl: s.baseUrl,
      model: s.model,
      hasApiKey: s.apiKey.trim().length > 0,
      apiKeyMasked: maskApiKey(s.apiKey),
      temperature: s.temperature,
      embeddingProvider: s.embeddingProvider,
      embeddingBaseUrl: s.embeddingBaseUrl,
      embeddingModel: s.embeddingModel,
      hasEmbeddingApiKey: s.embeddingApiKey.trim().length > 0,
      embeddingApiKeyMasked: maskApiKey(s.embeddingApiKey),
      updatedAt: s.updatedAt,
    };
  }

  getAiSettingsSecret(workspaceId: string): Promise<AiSettingsSecretRecord> {
    return syncToPromise(() => {
      const row = this.ctx.db.select().from(aiSettings).where(eq(aiSettings.workspaceId, workspaceId)).get();
      if (!row) {
        return {
          workspaceId: asWorkspaceId(workspaceId),
          enabled: false,
          provider: "openai",
          baseUrl: AI_PROVIDER_DEFAULTS.openai.baseUrl,
          model: AI_PROVIDER_DEFAULTS.openai.model,
          apiKey: "",
          temperature: 0.3,
          embeddingProvider: "local",
          embeddingBaseUrl: EMBEDDING_PROVIDER_DEFAULTS.local.baseUrl,
          embeddingModel: EMBEDDING_PROVIDER_DEFAULTS.local.model,
          embeddingApiKey: "",
          updatedAt: nowIso(),
        };
      }
      const provider = normalizeAiProviderPreset(row.provider);
      const embeddingProvider = normalizeEmbeddingProviderPreset(row.embeddingProvider);
      return {
        workspaceId: asWorkspaceId(row.workspaceId),
        enabled: Boolean(row.enabled),
        provider,
        baseUrl: row.baseUrl,
        model: row.model,
        apiKey: row.apiKey,
        temperature: Number.isFinite(row.temperature) ? row.temperature : 0.3,
        embeddingProvider,
        embeddingBaseUrl: row.embeddingBaseUrl,
        embeddingModel: row.embeddingModel || EMBEDDING_PROVIDER_DEFAULTS[embeddingProvider].model,
        embeddingApiKey: row.embeddingApiKey,
        updatedAt: row.updatedAt,
      };
    });
  }

  async upsertAiSettings(workspaceId: string, input: UpdateAiSettingsInput): Promise<AiSettingsRecord> {
    const cur = await this.getAiSettingsSecret(workspaceId);
    const nextProvider = input.provider ?? cur.provider;
    const changed = input.provider !== undefined && input.provider !== cur.provider;
    const def = AI_PROVIDER_DEFAULTS[nextProvider];
    const nextBaseUrl = input.baseUrl !== undefined ? input.baseUrl.trim() : changed && def.baseUrl ? def.baseUrl : cur.baseUrl;
    const nextModel = input.model !== undefined ? input.model.trim() || def.model : changed ? def.model : cur.model;
    const nextKey = input.clearApiKey ? "" : input.apiKey !== undefined && input.apiKey.trim().length > 0 ? input.apiKey.trim() : cur.apiKey;

    const nextEmbProvider = input.embeddingProvider ?? cur.embeddingProvider;
    const embChanged = input.embeddingProvider !== undefined && input.embeddingProvider !== cur.embeddingProvider;
    const embDef = EMBEDDING_PROVIDER_DEFAULTS[nextEmbProvider];
    const nextEmbBaseUrl =
      input.embeddingBaseUrl !== undefined
        ? input.embeddingBaseUrl.trim()
        : embChanged
          ? embDef.baseUrl
          : cur.embeddingBaseUrl;
    const nextEmbModel =
      input.embeddingModel !== undefined
        ? input.embeddingModel.trim() || embDef.model
        : embChanged
          ? embDef.model
          : cur.embeddingModel;
    const nextEmbKey = input.clearEmbeddingApiKey
      ? ""
      : input.embeddingApiKey !== undefined && input.embeddingApiKey.trim().length > 0
        ? input.embeddingApiKey.trim()
        : cur.embeddingApiKey;

    const ts = nowIso();
    const vals = {
      workspaceId,
      enabled: input.enabled ?? cur.enabled,
      provider: nextProvider,
      baseUrl: nextBaseUrl,
      model: nextModel,
      apiKey: nextKey,
      temperature: input.temperature ?? cur.temperature,
      embeddingProvider: nextEmbProvider,
      embeddingBaseUrl: nextEmbBaseUrl,
      embeddingModel: nextEmbModel,
      embeddingApiKey: nextEmbKey,
      updatedAt: ts,
    };
    this.ctx.db.insert(aiSettings).values(vals).onConflictDoUpdate({ target: aiSettings.workspaceId, set: vals }).run();
    const saved = this.ctx.db.select().from(aiSettings).where(eq(aiSettings.workspaceId, workspaceId)).get();
    return saved ? this.mapAiSettingsRow(saved) : this.getAiSettings(workspaceId);
  }

  getUserPreferences(workspaceId: string, principalKey: string): Promise<UserPreferencesRecord> {
    return syncToPromise(() => {
      const row = this.ctx.db
        .select()
        .from(userPreferences)
        .where(and(eq(userPreferences.workspaceId, workspaceId), eq(userPreferences.principalKey, principalKey)))
        .get();
      if (!row) return { preferences: cloneDefaultUserPreferences(), updatedAt: null };
      try {
        return { preferences: parseUserPreferences(JSON.parse(row.prefsJson) as unknown), updatedAt: row.updatedAt };
      } catch {
        return { preferences: cloneDefaultUserPreferences(), updatedAt: row.updatedAt };
      }
    });
  }

  upsertUserPreferences(workspaceId: string, principalKey: string, patch: UserPreferencesPatch): Promise<UserPreferencesRecord> {
    return syncToPromise(() =>
      this.ctx.tx.runSyncAtomic(() => {
        const existing = this.ctx.db
          .select()
          .from(userPreferences)
          .where(and(eq(userPreferences.workspaceId, workspaceId), eq(userPreferences.principalKey, principalKey)))
          .get();
        let base = cloneDefaultUserPreferences();
        if (existing) {
          try {
            base = parseUserPreferences(JSON.parse(existing.prefsJson) as unknown);
          } catch {
            base = cloneDefaultUserPreferences();
          }
        }
        const next = mergeUserPreferences(base, patch);
        const ts = nowIso();
        const prefsJson = JSON.stringify(next);
        this.ctx.db
          .insert(userPreferences)
          .values({ workspaceId, principalKey, prefsJson, updatedAt: ts })
          .onConflictDoUpdate({ target: [userPreferences.workspaceId, userPreferences.principalKey], set: { prefsJson, updatedAt: ts } })
          .run();
        return { preferences: next, updatedAt: ts };
      }),
    );
  }

  listCalendarSubscriptions(workspaceId: string): Promise<readonly CalendarSubscription[]> {
    return syncToPromise(() => {
      const rows = this.ctx.db
        .select()
        .from(calendarSubscriptions)
        .where(eq(calendarSubscriptions.workspaceId, workspaceId))
        .orderBy(asc(calendarSubscriptions.createdAt), asc(calendarSubscriptions.id))
        .all();
      return rows.map(mapCalendarSubscriptionRow);
    });
  }

  getCalendarSubscriptionById(
    workspaceId: string,
    subscriptionId: CalendarSubId | string,
  ): Promise<CalendarSubscription | null> {
    return syncToPromise(() => {
      const row = this.ctx.db
        .select()
        .from(calendarSubscriptions)
        .where(
          and(
            eq(calendarSubscriptions.workspaceId, workspaceId),
            eq(calendarSubscriptions.id, subscriptionId),
          ),
        )
        .get();
      return row ? mapCalendarSubscriptionRow(row) : null;
    });
  }

  createCalendarSubscription(
    workspaceId: string,
    input: CreateCalendarSubscriptionInput,
    options?: { readonly id?: string | undefined },
  ): Promise<CalendarSubscription> {
    return syncToPromise(() => {
      const ts = nowIso();
      const row: typeof calendarSubscriptions.$inferSelect = {
        id: options?.id ?? createId(ID_PREFIXES.calendarSub),
        workspaceId,
        name: input.name,
        url: input.url,
        color: input.color ?? "#3b82f6",
        enabled: input.enabled ?? true,
        etag: null,
        lastModified: null,
        lastSyncedAt: null,
        lastError: null,
        createdAt: ts,
        updatedAt: ts,
      };
      this.ctx.db.insert(calendarSubscriptions).values(row).run();
      return mapCalendarSubscriptionRow(row);
    });
  }

  updateCalendarSubscription(
    workspaceId: string,
    subscriptionId: CalendarSubId | string,
    patch: UpdateCalendarSubscriptionInput & {
      readonly etag?: string | null | undefined;
      readonly lastModified?: string | null | undefined;
      readonly lastSyncedAt?: string | null | undefined;
      readonly lastError?: string | null | undefined;
    },
  ): Promise<CalendarSubscription> {
    return syncToPromise(() => {
      const existing = this.ctx.db
        .select()
        .from(calendarSubscriptions)
        .where(
          and(
            eq(calendarSubscriptions.workspaceId, workspaceId),
            eq(calendarSubscriptions.id, subscriptionId),
          ),
        )
        .get();
      if (!existing) {
        throw new InkadeError("NOT_FOUND", `Calendar subscription "${subscriptionId}" not found`);
      }
      const ts = nowIso();
      this.ctx.db
        .update(calendarSubscriptions)
        .set({
          name: patch.name ?? existing.name,
          url: patch.url ?? existing.url,
          color: patch.color ?? existing.color,
          enabled: patch.enabled ?? existing.enabled,
          etag: patch.etag !== undefined ? patch.etag : existing.etag,
          lastModified: patch.lastModified !== undefined ? patch.lastModified : existing.lastModified,
          lastSyncedAt: patch.lastSyncedAt !== undefined ? patch.lastSyncedAt : existing.lastSyncedAt,
          lastError: patch.lastError !== undefined ? patch.lastError : existing.lastError,
          updatedAt: ts,
        })
        .where(eq(calendarSubscriptions.id, subscriptionId))
        .run();
      const updated = this.ctx.db
        .select()
        .from(calendarSubscriptions)
        .where(eq(calendarSubscriptions.id, subscriptionId))
        .get();
      if (!updated) {
        throw new InkadeError("INTERNAL_ERROR", "Failed to load updated calendar subscription");
      }
      return mapCalendarSubscriptionRow(updated);
    });
  }

  deleteCalendarSubscription(
    workspaceId: string,
    subscriptionId: CalendarSubId | string,
  ): Promise<void> {
    return syncToPromise(() => {
      const existing = this.ctx.db
        .select({ id: calendarSubscriptions.id })
        .from(calendarSubscriptions)
        .where(
          and(
            eq(calendarSubscriptions.workspaceId, workspaceId),
            eq(calendarSubscriptions.id, subscriptionId),
          ),
        )
        .get();
      if (!existing) {
        throw new InkadeError("NOT_FOUND", `Calendar subscription "${subscriptionId}" not found`);
      }
      this.ctx.db
        .delete(calendarSubscriptions)
        .where(eq(calendarSubscriptions.id, subscriptionId))
        .run();
    });
  }

  replaceCalendarEventsCache(
    workspaceId: string,
    subscriptionId: CalendarSubId | string,
    events: readonly Omit<
      CalendarEventCacheRecord,
      "id" | "subscriptionId" | "workspaceId" | "updatedAt"
    >[],
  ): Promise<readonly CalendarEventCacheRecord[]> {
    return syncToPromise(() =>
      this.ctx.tx.runSyncAtomic(() => {
        const sub = this.ctx.db
          .select({ id: calendarSubscriptions.id })
          .from(calendarSubscriptions)
          .where(
            and(
              eq(calendarSubscriptions.workspaceId, workspaceId),
              eq(calendarSubscriptions.id, subscriptionId),
            ),
          )
          .get();
        if (!sub) {
          throw new InkadeError("NOT_FOUND", `Calendar subscription "${subscriptionId}" not found`);
        }
        this.ctx.db
          .delete(calendarEventsCache)
          .where(eq(calendarEventsCache.subscriptionId, subscriptionId))
          .run();
        const ts = nowIso();
        const inserted: (typeof calendarEventsCache.$inferSelect)[] = events.map((ev) => ({
          id: createId(ID_PREFIXES.calendarEvent),
          subscriptionId,
          workspaceId,
          uid: ev.uid,
          title: ev.title,
          description: ev.description ?? null,
          location: ev.location ?? null,
          startAt: ev.startAt,
          endAt: ev.endAt,
          allDay: ev.allDay,
          timezone: ev.timezone ?? null,
          rrule: ev.rrule ?? null,
          exdatesJson: JSON.stringify(ev.exdates ?? []),
          rawSummaryJson: "{}",
          updatedAt: ts,
        }));
        if (inserted.length > 0) {
          this.ctx.db.insert(calendarEventsCache).values(inserted).run();
        }
        return inserted.map(mapCalendarEventCacheRow);
      }),
    );
  }

  listCalendarEventsCache(
    workspaceId: string,
    options?: {
      readonly subscriptionId?: CalendarSubId | string | undefined;
      readonly onlyEnabledSubscriptions?: boolean | undefined;
    },
  ): Promise<
    readonly (CalendarEventCacheRecord & {
      readonly subscriptionName: string;
      readonly color: string;
    })[]
  > {
    return syncToPromise(() => {
      const conds = [eq(calendarEventsCache.workspaceId, workspaceId)];
      if (options?.subscriptionId) {
        conds.push(eq(calendarEventsCache.subscriptionId, options.subscriptionId));
      }
      if (options?.onlyEnabledSubscriptions !== false) {
        conds.push(eq(calendarSubscriptions.enabled, true));
      }
      const rows = this.ctx.db
        .select({
          event: calendarEventsCache,
          subscriptionName: calendarSubscriptions.name,
          color: calendarSubscriptions.color,
        })
        .from(calendarEventsCache)
        .innerJoin(
          calendarSubscriptions,
          eq(calendarEventsCache.subscriptionId, calendarSubscriptions.id),
        )
        .where(and(...conds))
        .orderBy(asc(calendarEventsCache.startAt), asc(calendarEventsCache.id))
        .all();

      return rows.map((row) => ({
        ...mapCalendarEventCacheRow(row.event),
        subscriptionName: row.subscriptionName,
        color: row.color,
      }));
    });
  }

  replaceDocumentChunks(
    workspaceId: string,
    docId: DocumentId | string,
    chunks: readonly DocumentChunkDraft[],
  ): Promise<readonly DocumentChunkRecord[]> {
    return syncToPromise(() =>
      this.ctx.tx.runSyncAtomic(() => {
        const existing = this.ctx.db
          .select()
          .from(documentChunks)
          .where(and(eq(documentChunks.workspaceId, workspaceId), eq(documentChunks.docId, docId)))
          .orderBy(asc(documentChunks.chunkIndex))
          .all();

        const existingByIdx = new Map(existing.map((r) => [r.chunkIndex, r]));
        const isUnchanged =
          existing.length === chunks.length &&
          chunks.every((draft, i) => {
            const cur = existing[i];
            return (
              cur &&
              cur.chunkIndex === draft.chunkIndex &&
              cur.contentHash === draft.contentHash &&
              cur.headingPath === (draft.headingPath ?? null) &&
              cur.nodeId === (draft.nodeId ?? null)
            );
          });

        if (isUnchanged) {
          return existing.map((row) => ({
            id: asDocumentChunkId(row.id),
            workspaceId: asWorkspaceId(row.workspaceId),
            docId: asDocumentId(row.docId),
            chunkIndex: row.chunkIndex,
            headingPath: row.headingPath,
            nodeId: row.nodeId ? asOutlineNodeId(row.nodeId) : null,
            tokenCount: row.tokenCount,
            snippet: row.snippet,
            contentText: row.contentText,
            contentHash: row.contentHash,
            updatedAt: row.updatedAt,
          }));
        }

        const ts = nowIso();
        const keptIds = new Set<string>();
        const results: DocumentChunkRecord[] = [];

        // Remove chunks with chunkIndex beyond the new count first so unique constraint never clashes.
        if (existing.length > chunks.length) {
          const dropIds = existing
            .filter((row) => row.chunkIndex >= chunks.length)
            .map((row) => row.id);
          if (dropIds.length > 0) {
            this.ctx.db.delete(documentChunks).where(inArray(documentChunks.id, dropIds)).run();
          }
        }

        for (const draft of chunks) {
          const prev = existingByIdx.get(draft.chunkIndex);
          if (prev && prev.contentHash === draft.contentHash) {
            // Keep same ID so existing chunk_embeddings survive incremental updates.
            if (
              prev.headingPath !== (draft.headingPath ?? null) ||
              prev.nodeId !== (draft.nodeId ?? null) ||
              prev.snippet !== draft.snippet ||
              prev.tokenCount !== draft.tokenCount
            ) {
              this.ctx.db
                .update(documentChunks)
                .set({
                  headingPath: draft.headingPath ?? null,
                  nodeId: draft.nodeId ?? null,
                  tokenCount: draft.tokenCount,
                  snippet: draft.snippet,
                  updatedAt: ts,
                })
                .where(eq(documentChunks.id, prev.id))
                .run();
            }
            keptIds.add(prev.id);
            results.push({
              id: asDocumentChunkId(prev.id),
              workspaceId: asWorkspaceId(workspaceId),
              docId: asDocumentId(docId),
              chunkIndex: draft.chunkIndex,
              headingPath: draft.headingPath ?? null,
              nodeId: draft.nodeId ?? null,
              tokenCount: draft.tokenCount,
              snippet: draft.snippet,
              contentText: draft.contentText,
              contentHash: draft.contentHash,
              updatedAt: prev.updatedAt,
            });
            continue;
          }

          if (prev) {
            this.ctx.db.delete(documentChunks).where(eq(documentChunks.id, prev.id)).run();
          }
          const newId = createId(ID_PREFIXES.documentChunk);
          this.ctx.db
            .insert(documentChunks)
            .values({
              id: newId,
              workspaceId,
              docId,
              chunkIndex: draft.chunkIndex,
              headingPath: draft.headingPath ?? null,
              nodeId: draft.nodeId ?? null,
              tokenCount: draft.tokenCount,
              snippet: draft.snippet,
              contentText: draft.contentText,
              contentHash: draft.contentHash,
              updatedAt: ts,
            })
            .run();
          keptIds.add(newId);
          results.push({
            id: newId,
            workspaceId: asWorkspaceId(workspaceId),
            docId: asDocumentId(docId),
            chunkIndex: draft.chunkIndex,
            headingPath: draft.headingPath ?? null,
            nodeId: draft.nodeId ?? null,
            tokenCount: draft.tokenCount,
            snippet: draft.snippet,
            contentText: draft.contentText,
            contentHash: draft.contentHash,
            updatedAt: ts,
          });
        }

        // Clean any leftover legacy rows for this doc not in keptIds
        const staleIds = existing.filter((r) => !keptIds.has(r.id)).map((r) => r.id);
        if (staleIds.length > 0) {
          this.ctx.db.delete(documentChunks).where(inArray(documentChunks.id, staleIds)).run();
        }

        return results;
      }),
    );
  }

  listDocumentChunks(
    workspaceId: string,
    options?: {
      readonly docId?: DocumentId | string | undefined;
      readonly docIds?: readonly (DocumentId | string)[] | undefined;
    },
  ): Promise<readonly DocumentChunkRecord[]> {
    return syncToPromise(() => {
      if (options?.docIds !== undefined && options.docIds.length === 0) {
        return [];
      }
      const conds = [eq(documentChunks.workspaceId, workspaceId)];
      if (options?.docId) {
        conds.push(eq(documentChunks.docId, options.docId));
      }
      if (options?.docIds && options.docIds.length > 0) {
        conds.push(inArray(documentChunks.docId, [...options.docIds]));
      }
      return this.ctx.db
        .select()
        .from(documentChunks)
        .where(and(...conds))
        .orderBy(asc(documentChunks.docId), asc(documentChunks.chunkIndex))
        .all()
        .map((row) => ({
          id: asDocumentChunkId(row.id),
          workspaceId: asWorkspaceId(row.workspaceId),
          docId: asDocumentId(row.docId),
          chunkIndex: row.chunkIndex,
          headingPath: row.headingPath,
          nodeId: row.nodeId ? asOutlineNodeId(row.nodeId) : null,
          tokenCount: row.tokenCount,
          snippet: row.snippet,
          contentText: row.contentText,
          contentHash: row.contentHash,
          updatedAt: row.updatedAt,
        }));
    });
  }

  deleteDocumentChunks(workspaceId: string, docId: DocumentId | string): Promise<void> {
    return syncToPromise(() => {
      this.ctx.db
        .delete(documentChunks)
        .where(and(eq(documentChunks.workspaceId, workspaceId), eq(documentChunks.docId, docId)))
        .run();
    });
  }

  listChunkEmbeddings(
    workspaceId: string,
    modelKey: string,
    options?: {
      readonly docIds?: readonly (DocumentId | string)[] | undefined;
    },
  ): Promise<readonly ChunkEmbeddingRecord[]> {
    return syncToPromise(() => {
      if (options?.docIds !== undefined && options.docIds.length === 0) {
        return [];
      }
      const conds = [
        eq(chunkEmbeddings.workspaceId, workspaceId),
        eq(chunkEmbeddings.modelKey, modelKey),
      ];
      if (options?.docIds && options.docIds.length > 0) {
        conds.push(inArray(documentChunks.docId, [...options.docIds]));
      }
      const rows = this.ctx.db
        .select({
          chunkId: chunkEmbeddings.chunkId,
          workspaceId: chunkEmbeddings.workspaceId,
          modelKey: chunkEmbeddings.modelKey,
          dimensions: chunkEmbeddings.dimensions,
          vectorBlob: chunkEmbeddings.vectorBlob,
          updatedAt: chunkEmbeddings.updatedAt,
        })
        .from(chunkEmbeddings)
        .innerJoin(documentChunks, eq(chunkEmbeddings.chunkId, documentChunks.id))
        .where(and(...conds))
        .all();

      return rows.map((row) => ({
        chunkId: asDocumentChunkId(row.chunkId),
        workspaceId: asWorkspaceId(row.workspaceId),
        modelKey: row.modelKey,
        dimensions: row.dimensions,
        vector: decodeFloat32Vector(row.vectorBlob),
        updatedAt: row.updatedAt,
      }));
    });
  }

  upsertChunkEmbeddings(
    workspaceId: string,
    items: readonly {
      readonly chunkId: DocumentChunkId | string;
      readonly modelKey: string;
      readonly dimensions: number;
      readonly vector: readonly number[];
    }[],
  ): Promise<void> {
    return syncToPromise(() => {
      if (items.length === 0) return;
      const ts = nowIso();
      this.ctx.tx.runSyncAtomic(() => {
        for (const item of items) {
          const vectorBlob = encodeFloat32Vector(item.vector);
          this.ctx.db
            .insert(chunkEmbeddings)
            .values({
              chunkId: item.chunkId,
              workspaceId,
              modelKey: item.modelKey,
              dimensions: item.dimensions,
              vectorBlob,
              updatedAt: ts,
            })
            .onConflictDoUpdate({
              target: [chunkEmbeddings.chunkId, chunkEmbeddings.modelKey],
              set: {
                workspaceId,
                dimensions: item.dimensions,
                vectorBlob,
                updatedAt: ts,
              },
            })
            .run();
        }
      });
    });
  }

  getEmbeddingIndexStats(
    workspaceId: string,
    modelKey: string,
  ): Promise<{
    readonly totalChunks: number;
    readonly indexedChunks: number;
    readonly indexedDocuments: number;
    readonly dimensions: number | null;
    readonly lastIndexedAt: string | null;
  }> {
    return syncToPromise(() => {
      const chunkStats = this.ctx.sqlite
        .query<{ total_chunks: number }, [string]>(
          `SELECT COUNT(*) AS total_chunks
           FROM document_chunks dc
           INNER JOIN documents d ON d.id = dc.doc_id
           WHERE dc.workspace_id = ? AND d.trashed_at IS NULL`,
        )
        .get(workspaceId);

      const embStats = this.ctx.sqlite
        .query<{
          indexed_chunks: number;
          indexed_docs: number;
          dimensions: number | null;
          last_indexed_at: string | null;
        }, [string, string]>(
          `SELECT
             COUNT(ce.chunk_id) AS indexed_chunks,
             COUNT(DISTINCT dc.doc_id) AS indexed_docs,
             MAX(ce.dimensions) AS dimensions,
             MAX(ce.updated_at) AS last_indexed_at
           FROM chunk_embeddings ce
           INNER JOIN document_chunks dc ON dc.id = ce.chunk_id
           INNER JOIN documents d ON d.id = dc.doc_id
           WHERE ce.workspace_id = ? AND ce.model_key = ? AND d.trashed_at IS NULL`,
        )
        .get(workspaceId, modelKey);

      return {
        totalChunks: chunkStats?.total_chunks ?? 0,
        indexedChunks: embStats?.indexed_chunks ?? 0,
        indexedDocuments: embStats?.indexed_docs ?? 0,
        dimensions: embStats?.dimensions ?? null,
        lastIndexedAt: embStats?.last_indexed_at ?? null,
      };
    });
  }

  listContextPacks(workspaceId: string): Promise<readonly ContextPack[]> {
    return syncToPromise(() =>
      this.ctx.db
        .select()
        .from(contextPacks)
        .where(eq(contextPacks.workspaceId, workspaceId))
        .orderBy(desc(contextPacks.updatedAt))
        .all()
        .map(mapContextPackRow),
    );
  }

  getContextPackById(
    workspaceId: string,
    packId: ContextPackId | string,
  ): Promise<ContextPack | null> {
    return syncToPromise(() => {
      const row = this.ctx.db
        .select()
        .from(contextPacks)
        .where(and(eq(contextPacks.workspaceId, workspaceId), eq(contextPacks.id, packId)))
        .get();
      return row ? mapContextPackRow(row) : null;
    });
  }

  getContextPackBySlug(workspaceId: string, slug: string): Promise<ContextPack | null> {
    return syncToPromise(() => {
      const row = this.ctx.db
        .select()
        .from(contextPacks)
        .where(and(eq(contextPacks.workspaceId, workspaceId), eq(contextPacks.slug, slug.trim().toLowerCase())))
        .get();
      return row ? mapContextPackRow(row) : null;
    });
  }

  createContextPack(
    workspaceId: string,
    input: CreateContextPackInput & { readonly slug: string },
    options?: { readonly id?: string | undefined },
  ): Promise<ContextPack> {
    return syncToPromise(() => {
      const cleanSlug = (input.slug || slugifyContextPackName(input.name)).trim().toLowerCase();
      const existing = this.ctx.db
        .select({ id: contextPacks.id })
        .from(contextPacks)
        .where(and(eq(contextPacks.workspaceId, workspaceId), eq(contextPacks.slug, cleanSlug)))
        .get();
      if (existing) {
        throw new InkadeError("CONFLICT", `Context pack slug "${cleanSlug}" already exists`);
      }

      const id = options?.id ? asContextPackId(options.id) : createId(ID_PREFIXES.contextPack);
      const ts = nowIso();
      const rules = contextPackRulesSchema.parse(input.rules ?? {});
      const row = {
        id,
        workspaceId,
        slug: cleanSlug,
        name: input.name.trim(),
        description: (input.description ?? "").trim(),
        rulesJson: JSON.stringify(rules),
        maxTokens: input.maxTokens ?? 12000,
        createdAt: ts,
        updatedAt: ts,
      };
      this.ctx.db.insert(contextPacks).values(row).run();
      return mapContextPackRow(row);
    });
  }

  updateContextPack(
    workspaceId: string,
    packId: ContextPackId | string,
    input: UpdateContextPackInput,
  ): Promise<ContextPack> {
    return syncToPromise(() => {
      const existing = this.ctx.db
        .select()
        .from(contextPacks)
        .where(and(eq(contextPacks.workspaceId, workspaceId), eq(contextPacks.id, packId)))
        .get();
      if (!existing) {
        throw new InkadeError("NOT_FOUND", `Context pack "${packId}" not found`);
      }

      const nextSlug = input.slug !== undefined ? input.slug.trim().toLowerCase() : existing.slug;
      if (nextSlug !== existing.slug) {
        const collision = this.ctx.db
          .select({ id: contextPacks.id })
          .from(contextPacks)
          .where(and(eq(contextPacks.workspaceId, workspaceId), eq(contextPacks.slug, nextSlug)))
          .get();
        if (collision) {
          throw new InkadeError("CONFLICT", `Context pack slug "${nextSlug}" already exists`);
        }
      }

      const nextRules =
        input.rules !== undefined
          ? contextPackRulesSchema.parse(input.rules)
          : parseJsonWithSchema(existing.rulesJson, contextPackRulesSchema, {
              excludeSystem: true,
            });
      const ts = nowIso();
      this.ctx.db
        .update(contextPacks)
        .set({
          slug: nextSlug,
          name: input.name !== undefined ? input.name.trim() : existing.name,
          description: input.description !== undefined ? input.description.trim() : existing.description,
          rulesJson: JSON.stringify(nextRules),
          maxTokens: input.maxTokens ?? existing.maxTokens,
          updatedAt: ts,
        })
        .where(eq(contextPacks.id, existing.id))
        .run();

      const updated = this.ctx.db
        .select()
        .from(contextPacks)
        .where(eq(contextPacks.id, existing.id))
        .get();
      if (!updated) {
        throw new InkadeError("NOT_FOUND", `Context pack "${packId}" not found`);
      }
      return mapContextPackRow(updated);
    });
  }

  deleteContextPack(workspaceId: string, packId: ContextPackId | string): Promise<void> {
    return syncToPromise(() => {
      const existing = this.ctx.db
        .select({ id: contextPacks.id })
        .from(contextPacks)
        .where(and(eq(contextPacks.workspaceId, workspaceId), eq(contextPacks.id, packId)))
        .get();
      if (!existing) {
        throw new InkadeError("NOT_FOUND", `Context pack "${packId}" not found`);
      }
      this.ctx.db.delete(contextPacks).where(eq(contextPacks.id, existing.id)).run();
    });
  }

  listRssFeeds(workspaceId: string): Promise<readonly RssFeedRecord[]> {
    return syncToPromise(() =>
      this.ctx.db
        .select()
        .from(rssFeeds)
        .where(eq(rssFeeds.workspaceId, workspaceId))
        .orderBy(desc(rssFeeds.updatedAt))
        .all()
        .map(mapRssFeedRow),
    );
  }

  getRssFeedById(workspaceId: string, feedId: RssFeedId | string): Promise<RssFeedRecord | null> {
    return syncToPromise(() => {
      const row = this.ctx.db
        .select()
        .from(rssFeeds)
        .where(and(eq(rssFeeds.workspaceId, workspaceId), eq(rssFeeds.id, feedId)))
        .get();
      return row ? mapRssFeedRow(row) : null;
    });
  }

  createRssFeed(
    workspaceId: string,
    input: Omit<CreateRssFeedInput, "targetSpaceId" | "title"> & {
      readonly title: string;
      readonly targetSpaceId: SpaceId;
    },
    options?: { readonly id?: string | undefined },
  ): Promise<RssFeedRecord> {
    return syncToPromise(() => {
      const id = options?.id ? asRssFeedId(options.id) : createId(ID_PREFIXES.rssFeed);
      const ts = nowIso();
      const row: typeof rssFeeds.$inferSelect = {
        id,
        workspaceId,
        url: input.url.trim(),
        title: input.title.trim(),
        targetSpaceId: input.targetSpaceId,
        enabled: input.enabled ?? true,
        etag: null,
        lastModified: null,
        lastFetchedAt: null,
        lastError: null,
        createdAt: ts,
        updatedAt: ts,
      };
      this.ctx.db.insert(rssFeeds).values(row).run();
      return mapRssFeedRow(row);
    });
  }

  updateRssFeed(
    workspaceId: string,
    feedId: RssFeedId | string,
    patch: UpdateRssFeedInput & {
      readonly etag?: string | null | undefined;
      readonly lastModified?: string | null | undefined;
      readonly lastFetchedAt?: string | null | undefined;
      readonly lastError?: string | null | undefined;
    },
  ): Promise<RssFeedRecord> {
    return syncToPromise(() => {
      const existing = this.ctx.db
        .select()
        .from(rssFeeds)
        .where(and(eq(rssFeeds.workspaceId, workspaceId), eq(rssFeeds.id, feedId)))
        .get();
      if (!existing) {
        throw new InkadeError("NOT_FOUND", `RSS feed "${feedId}" not found`);
      }
      const ts = nowIso();
      const next: typeof rssFeeds.$inferSelect = {
        ...existing,
        title: patch.title !== undefined ? patch.title.trim() : existing.title,
        targetSpaceId: patch.targetSpaceId ?? existing.targetSpaceId,
        enabled: patch.enabled ?? existing.enabled,
        etag: patch.etag !== undefined ? patch.etag : existing.etag,
        lastModified: patch.lastModified !== undefined ? patch.lastModified : existing.lastModified,
        lastFetchedAt: patch.lastFetchedAt !== undefined ? patch.lastFetchedAt : existing.lastFetchedAt,
        lastError: patch.lastError !== undefined ? patch.lastError : existing.lastError,
        updatedAt: ts,
      };
      this.ctx.db
        .update(rssFeeds)
        .set({
          title: next.title,
          targetSpaceId: next.targetSpaceId,
          enabled: next.enabled,
          etag: next.etag,
          lastModified: next.lastModified,
          lastFetchedAt: next.lastFetchedAt,
          lastError: next.lastError,
          updatedAt: next.updatedAt,
        })
        .where(eq(rssFeeds.id, existing.id))
        .run();
      return mapRssFeedRow(next);
    });
  }

  deleteRssFeed(workspaceId: string, feedId: RssFeedId | string): Promise<void> {
    return syncToPromise(() => {
      const existing = this.ctx.db
        .select({ id: rssFeeds.id })
        .from(rssFeeds)
        .where(and(eq(rssFeeds.workspaceId, workspaceId), eq(rssFeeds.id, feedId)))
        .get();
      if (!existing) {
        throw new InkadeError("NOT_FOUND", `RSS feed "${feedId}" not found`);
      }
      this.ctx.db.delete(rssFeeds).where(eq(rssFeeds.id, existing.id)).run();
    });
  }

  listIngestWebhooks(workspaceId: string): Promise<readonly IngestWebhookRecord[]> {
    return syncToPromise(() =>
      this.ctx.db
        .select()
        .from(ingestWebhooks)
        .where(eq(ingestWebhooks.workspaceId, workspaceId))
        .orderBy(desc(ingestWebhooks.createdAt))
        .all()
        .map(mapIngestWebhookRow),
    );
  }

  getIngestWebhookById(
    workspaceId: string,
    webhookId: IngestWebhookId | string,
  ): Promise<IngestWebhookRecord | null> {
    return syncToPromise(() => {
      const row = this.ctx.db
        .select()
        .from(ingestWebhooks)
        .where(
          and(eq(ingestWebhooks.workspaceId, workspaceId), eq(ingestWebhooks.id, webhookId)),
        )
        .get();
      return row ? mapIngestWebhookRow(row) : null;
    });
  }

  findIngestWebhookByTokenHash(tokenHash: string): Promise<IngestWebhookRecord | null> {
    return syncToPromise(() => {
      const row = this.ctx.db
        .select()
        .from(ingestWebhooks)
        .where(eq(ingestWebhooks.tokenHash, tokenHash))
        .get();
      return row ? mapIngestWebhookRow(row) : null;
    });
  }

  createIngestWebhook(
    workspaceId: string,
    input: Omit<CreateIngestWebhookInput, "targetSpaceId"> & {
      readonly targetSpaceId: SpaceId;
      readonly tokenHash: string;
      readonly tokenPrefix: string;
    },
    options?: { readonly id?: string | undefined },
  ): Promise<IngestWebhookRecord> {
    return syncToPromise(() => {
      const id = options?.id
        ? asIngestWebhookId(options.id)
        : createId(ID_PREFIXES.ingestWebhook);
      const ts = nowIso();
      const row: typeof ingestWebhooks.$inferSelect = {
        id,
        workspaceId,
        name: input.name.trim(),
        tokenHash: input.tokenHash,
        tokenPrefix: input.tokenPrefix,
        targetSpaceId: input.targetSpaceId,
        defaultKind: input.defaultKind ?? "clip",
        tagsJson: JSON.stringify(input.tags ?? []),
        enabled: input.enabled ?? true,
        lastUsedAt: null,
        createdAt: ts,
      };
      this.ctx.db.insert(ingestWebhooks).values(row).run();
      return mapIngestWebhookRow(row);
    });
  }

  updateIngestWebhook(
    workspaceId: string,
    webhookId: IngestWebhookId | string,
    patch: UpdateIngestWebhookInput,
  ): Promise<IngestWebhookRecord> {
    return syncToPromise(() => {
      const existing = this.ctx.db
        .select()
        .from(ingestWebhooks)
        .where(
          and(eq(ingestWebhooks.workspaceId, workspaceId), eq(ingestWebhooks.id, webhookId)),
        )
        .get();
      if (!existing) {
        throw new InkadeError("NOT_FOUND", `Ingest webhook "${webhookId}" not found`);
      }
      const next: typeof ingestWebhooks.$inferSelect = {
        ...existing,
        name: patch.name !== undefined ? patch.name.trim() : existing.name,
        targetSpaceId: patch.targetSpaceId ?? existing.targetSpaceId,
        defaultKind: patch.defaultKind ?? existing.defaultKind,
        tagsJson: patch.tags !== undefined ? JSON.stringify(patch.tags) : existing.tagsJson,
        enabled: patch.enabled ?? existing.enabled,
      };
      this.ctx.db
        .update(ingestWebhooks)
        .set({
          name: next.name,
          targetSpaceId: next.targetSpaceId,
          defaultKind: next.defaultKind,
          tagsJson: next.tagsJson,
          enabled: next.enabled,
        })
        .where(eq(ingestWebhooks.id, existing.id))
        .run();
      return mapIngestWebhookRow(next);
    });
  }

  deleteIngestWebhook(workspaceId: string, webhookId: IngestWebhookId | string): Promise<void> {
    return syncToPromise(() => {
      const existing = this.ctx.db
        .select({ id: ingestWebhooks.id })
        .from(ingestWebhooks)
        .where(
          and(eq(ingestWebhooks.workspaceId, workspaceId), eq(ingestWebhooks.id, webhookId)),
        )
        .get();
      if (!existing) {
        throw new InkadeError("NOT_FOUND", `Ingest webhook "${webhookId}" not found`);
      }
      this.ctx.db.delete(ingestWebhooks).where(eq(ingestWebhooks.id, existing.id)).run();
    });
  }

  touchIngestWebhookLastUsed(
    webhookId: IngestWebhookId | string,
    timestamp: string,
  ): Promise<void> {
    return syncToPromise(() => {
      this.ctx.db
        .update(ingestWebhooks)
        .set({ lastUsedAt: timestamp })
        .where(eq(ingestWebhooks.id, webhookId))
        .run();
    });
  }
}
