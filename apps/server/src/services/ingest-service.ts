import { randomBytes } from "node:crypto";
import { basename } from "node:path";
import { parseFeed } from "feedsmith";
import {
  createId,
  ID_PREFIXES,
  InkadeError,
  todayLocalDateString,
  type AudioTranscribeTarget,
  type AudioTranscribeResult,
  type AuditBatchId,
  type CreateIngestWebhookInput,
  type CreateIngestWebhookResponse,
  type CreateRssFeedInput,
  type DocumentId,
  type DocumentRecord,
  type IngestWebhookId,
  type IngestWebhookRecord,
  type OutlineNode,
  type ParsedWebhookIngestPayload,
  type RssFeedId,
  type RssFeedRecord,
  type RssSyncResult,
  type SpaceId,
  type UpdateIngestWebhookInput,
  type UpdateRssFeedInput,
} from "@inkade/core";
import {
  DEFAULT_SPACE_IDS,
  type AttachmentRepo,
  type DocumentRepo,
  type SearchConfigRepo,
  type SpaceRepo,
} from "@inkade/db";
import { sha256Hex } from "../auth/tokens.ts";
import type { WorkspaceSpacesCache } from "../cache/workspace-spaces-cache.ts";
import type { SseHub } from "../realtime/sse-hub.ts";
import type { Principal } from "../types.ts";
import { validateAiEndpointUrl } from "./ai-provider-factory.ts";
import type { AttachmentService } from "./attachment-service.ts";
import type { AuditService } from "./audit-service.ts";
import {
  assertSafeExternalUrl,
  defaultDnsResolver,
  parseClipHtml,
  readBytesWithLimit,
  type DnsResolver,
  type FetchFn,
} from "./clipper-service.ts";
import type { DocumentService } from "./document-service.ts";
import type { OutlineService } from "./outline-service.ts";
import { assertAdminPrincipal, assertScope, getAllWorkspaceSpaces } from "./scope-guard.ts";

const MAX_RSS_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const FETCH_TIMEOUT_MS = 15_000;
const WEBHOOK_RATE_WINDOW_MS = 60_000;
const WEBHOOK_RATE_LIMIT = 60;
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

export interface IngestServiceTransport {
  readonly fetchFn?: FetchFn | undefined;
  readonly resolveDns?: DnsResolver | undefined;
  readonly allowLocalForTest?: boolean | undefined;
}

interface ParsedFeedEntry {
  readonly title: string;
  readonly url: string | null;
  readonly markdown: string;
  readonly publishedAt: string | null;
  readonly author: string | null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function extractFeedEntries(rawFeedText: string, feedUrl: string): {
  readonly feedTitle: string;
  readonly items: ParsedFeedEntry[];
} {
  let parsed: ReturnType<typeof parseFeed>;
  try {
    parsed = parseFeed(rawFeedText);
  } catch (err) {
    throw new InkadeError(
      "VALIDATION_ERROR",
      `Failed to parse feed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const items: ParsedFeedEntry[] = [];
  let feedTitle = feedUrl;

  const feedObj = parsed.feed as Record<string, unknown>;
  if (typeof feedObj.title === "string" && feedObj.title.trim()) {
    feedTitle = feedObj.title.trim();
  } else if (
    feedObj.title &&
    typeof feedObj.title === "object" &&
    "value" in feedObj.title &&
    typeof (feedObj.title as { value?: unknown }).value === "string"
  ) {
    feedTitle = ((feedObj.title as { value: string }).value).trim() || feedTitle;
  }

  const rawEntries = Array.isArray(feedObj.items)
    ? (feedObj.items as Array<Record<string, unknown>>)
    : Array.isArray(feedObj.entries)
      ? (feedObj.entries as Array<Record<string, unknown>>)
      : [];

  for (const item of rawEntries.slice(0, 50)) {
    const titleVal =
      typeof item.title === "string"
        ? item.title.trim()
        : item.title && typeof item.title === "object" && "value" in item.title
          ? asString((item.title as { value?: unknown }).value)
          : "";

    let linkUrl: string | null = null;
    if (typeof item.link === "string" && item.link.trim()) {
      linkUrl = item.link.trim();
    } else if (typeof item.url === "string" && item.url.trim()) {
      linkUrl = item.url.trim();
    } else if (Array.isArray(item.links)) {
      const alt = item.links.find(
        (l) =>
          l &&
          typeof l === "object" &&
          typeof (l as { href?: unknown }).href === "string" &&
          (!(l as { rel?: unknown }).rel || (l as { rel?: unknown }).rel === "alternate"),
      ) as { href?: string } | undefined;
      if (alt?.href) linkUrl = alt.href.trim();
    }

    const htmlCandidate =
      asString((item.content as { encoded?: unknown } | undefined)?.encoded) ||
      asString((item.content as { value?: unknown } | undefined)?.value) ||
      asString(item.content_html) ||
      asString(item.content) ||
      asString(item.description) ||
      asString((item.summary as { value?: unknown } | undefined)?.value) ||
      asString(item.summary) ||
      asString(item.content_text);

    let markdown = htmlCandidate;
    if (htmlCandidate && /<[a-z][\s\S]*>/i.test(htmlCandidate)) {
      const clipped = parseClipHtml(
        `<html><body><article>${htmlCandidate}</article></body></html>`,
        linkUrl ?? feedUrl,
      );
      markdown = clipped.markdown.trim() || htmlCandidate.replace(/<[^>]+>/g, " ").trim();
    }

    const finalTitle = titleVal || linkUrl || "Feed Item";
    const publishedAt =
      asString(item.pubDate) ||
      asString(item.published) ||
      asString(item.updated) ||
      asString(item.date_published) ||
      null;
    const author =
      asString(item.author) ||
      asString((item.author as { name?: unknown } | undefined)?.name) ||
      asString((item.dc as { creator?: unknown } | undefined)?.creator) ||
      null;

    items.push({
      title: finalTitle,
      url: linkUrl,
      markdown: markdown || finalTitle,
      publishedAt,
      author,
    });
  }

  return { feedTitle, items };
}

export class IngestService {
  private fetchFn: FetchFn;
  private resolveDns: DnsResolver;
  private allowLocalForTest: boolean;
  private readonly webhookRateBuckets = new Map<string, number[]>();

  constructor(
    private readonly deps: {
      readonly searchConfigRepo: SearchConfigRepo;
      readonly attachmentRepo: AttachmentRepo;
      readonly documentRepo: DocumentRepo;
      readonly spaceRepo: SpaceRepo;
      readonly spacesCache?: WorkspaceSpacesCache | undefined;
      readonly documentService: DocumentService;
      readonly outlineService: OutlineService;
      readonly attachmentService: AttachmentService;
      readonly auditService: AuditService;
      readonly sseHub: SseHub;
      readonly onDocumentChanged?: (workspaceId: Principal["workspaceId"], docId: DocumentId) => void;
    },
    transport?: IngestServiceTransport,
  ) {
    this.fetchFn = transport?.fetchFn ?? ((input, init) => fetch(input, init));
    this.resolveDns = transport?.resolveDns ?? defaultDnsResolver;
    this.allowLocalForTest = transport?.allowLocalForTest ?? false;
  }

  setTestTransport(transport: IngestServiceTransport): void {
    if (transport.fetchFn !== undefined) this.fetchFn = transport.fetchFn;
    if (transport.resolveDns !== undefined) this.resolveDns = transport.resolveDns;
    if (transport.allowLocalForTest !== undefined) this.allowLocalForTest = transport.allowLocalForTest;
  }

  private async resolveDefaultCaptureSpaceId(
    principal: Principal,
    requestedSpaceId?: SpaceId,
  ): Promise<SpaceId> {
    const allSpaces = await getAllWorkspaceSpaces(
      this.deps.spacesCache ?? this.deps.spaceRepo,
      principal.workspaceId,
    );
    const active = allSpaces.filter((s) => s.archivedAt === null);
    const space =
      (requestedSpaceId ? active.find((s) => s.id === requestedSpaceId) : undefined) ??
      active.find((s) => s.id === DEFAULT_SPACE_IDS.inbox) ??
      active.find((s) => s.slug === "inbox") ??
      active[0];
    if (!space) {
      throw new InkadeError("NOT_FOUND", "Target capture space not found");
    }
    assertScope(
      principal.scope,
      "write",
      { spaceId: space.id, resourceType: "space" },
      allSpaces,
    );
    return space.id;
  }

  // -------------------------------------------------------------------------
  // Private Webhook Management & Ingestion
  // -------------------------------------------------------------------------

  async listWebhooks(principal: Principal): Promise<readonly IngestWebhookRecord[]> {
    const allSpaces = await getAllWorkspaceSpaces(
      this.deps.spacesCache ?? this.deps.spaceRepo,
      principal.workspaceId,
    );
    assertAdminPrincipal(principal, allSpaces);
    return this.deps.searchConfigRepo.listIngestWebhooks(principal.workspaceId);
  }

  async createWebhook(
    principal: Principal,
    input: CreateIngestWebhookInput,
  ): Promise<CreateIngestWebhookResponse> {
    const allSpaces = await getAllWorkspaceSpaces(
      this.deps.spacesCache ?? this.deps.spaceRepo,
      principal.workspaceId,
    );
    assertAdminPrincipal(principal, allSpaces);
    const targetSpaceId = await this.resolveDefaultCaptureSpaceId(
      principal,
      input.targetSpaceId,
    );

    const rawToken = `ink_whk_${randomBytes(24).toString("base64url")}`;
    const tokenHash = await sha256Hex(rawToken);
    const tokenPrefix = rawToken.slice(0, 14);
    const webhook = await this.deps.searchConfigRepo.createIngestWebhook(principal.workspaceId, {
      name: input.name,
      targetSpaceId,
      defaultKind: input.defaultKind ?? "clip",
      tags: input.tags ?? [],
      enabled: input.enabled ?? true,
      tokenHash,
      tokenPrefix,
    });

    this.deps.sseHub.publish({
      type: "ingest_webhook.updated",
      workspaceId: principal.workspaceId,
      spaceId: webhook.targetSpaceId,
      actorType: principal.actorType,
      payload: { action: "created", webhookId: webhook.id },
    });

    return {
      webhook,
      rawToken,
      ingestPath: `/api/v1/ingest/${rawToken}`,
    };
  }

  async updateWebhook(
    principal: Principal,
    webhookId: IngestWebhookId,
    patch: UpdateIngestWebhookInput,
  ): Promise<IngestWebhookRecord> {
    const allSpaces = await getAllWorkspaceSpaces(
      this.deps.spacesCache ?? this.deps.spaceRepo,
      principal.workspaceId,
    );
    assertAdminPrincipal(principal, allSpaces);
    if (patch.targetSpaceId) {
      await this.resolveDefaultCaptureSpaceId(principal, patch.targetSpaceId);
    }
    const updated = await this.deps.searchConfigRepo.updateIngestWebhook(
      principal.workspaceId,
      webhookId,
      patch,
    );
    this.deps.sseHub.publish({
      type: "ingest_webhook.updated",
      workspaceId: principal.workspaceId,
      spaceId: updated.targetSpaceId,
      actorType: principal.actorType,
      payload: { action: "updated", webhookId: updated.id },
    });
    return updated;
  }

  async deleteWebhook(principal: Principal, webhookId: IngestWebhookId): Promise<void> {
    const allSpaces = await getAllWorkspaceSpaces(
      this.deps.spacesCache ?? this.deps.spaceRepo,
      principal.workspaceId,
    );
    assertAdminPrincipal(principal, allSpaces);
    await this.deps.searchConfigRepo.deleteIngestWebhook(principal.workspaceId, webhookId);
    this.deps.sseHub.publish({
      type: "ingest_webhook.updated",
      workspaceId: principal.workspaceId,
      spaceId: null,
      actorType: principal.actorType,
      payload: { action: "deleted", webhookId },
    });
  }

  private enforceWebhookRateLimit(webhookId: string): void {
    const now = Date.now();
    const bucket = (this.webhookRateBuckets.get(webhookId) ?? []).filter(
      (ts) => now - ts < WEBHOOK_RATE_WINDOW_MS,
    );
    if (bucket.length >= WEBHOOK_RATE_LIMIT) {
      throw new InkadeError("FORBIDDEN", "Webhook rate limit exceeded; retry in 60 seconds");
    }
    bucket.push(now);
    this.webhookRateBuckets.set(webhookId, bucket);
  }

  async ingestByWebhookToken(
    rawToken: string,
    payload: ParsedWebhookIngestPayload,
  ): Promise<{
    readonly webhookId: IngestWebhookId;
    readonly document: DocumentRecord;
    readonly batchId: AuditBatchId;
  }> {
    const cleanToken = rawToken.trim();
    if (!cleanToken) {
      throw new InkadeError("UNAUTHORIZED", "Missing webhook token");
    }
    const tokenHash = await sha256Hex(cleanToken);
    const webhook = await this.deps.searchConfigRepo.findIngestWebhookByTokenHash(tokenHash);
    if (!webhook || !webhook.enabled) {
      throw new InkadeError("UNAUTHORIZED", "Invalid or disabled webhook token");
    }

    this.enforceWebhookRateLimit(webhook.id);

    const scopedPrincipal: Principal = {
      kind: "token",
      actorType: "agent",
      actorId: `whk_${webhook.id}` as never,
      workspaceId: webhook.workspaceId,
      tokenId: `tok_${webhook.id}` as never,
      tokenName: `Webhook:${webhook.name}`,
      scope: {
        permission: "write",
        spaceIds: [webhook.targetSpaceId],
        includeDescendants: false,
        denyHardDelete: true,
      },
    };

    const body = (payload.contentMarkdown ?? payload.text ?? "").trim();
    const inferredTitle =
      payload.title?.trim() ||
      body.split(/\r?\n/)[0]?.replace(/^#+\s*/, "").trim().slice(0, 120) ||
      payload.url ||
      `Webhook Capture (${webhook.name})`;
    const kind = payload.kind ?? webhook.defaultKind;
    const tags = [...new Set([...webhook.tags, ...(payload.tags ?? [])])];
    const batchId: AuditBatchId = createId(ID_PREFIXES.auditBatch);

    const created = await this.deps.auditService.runWithBatchContext({ batchId }, async () => {
      const doc = await this.deps.documentService.createDocument(scopedPrincipal, {
        spaceId: webhook.targetSpaceId,
        kind,
        title: inferredTitle,
        contentMarkdown: kind === "outline" ? "" : body || inferredTitle,
        tags,
        sourceUrl: payload.url,
        sourceMeta: {
          ...(payload.sourceMeta ?? {}),
          ingestChannel: "webhook",
          webhookId: webhook.id,
          webhookName: webhook.name,
        },
        properties: payload.properties,
      });

      if (kind === "outline" && body) {
        const lines = body
          .split(/\r?\n/)
          .map((l) => l.replace(/^\s*[-*]\s+/, "").trim())
          .filter(Boolean);
        for (const line of lines.slice(0, 100)) {
          await this.deps.outlineService.createNode(scopedPrincipal, {
            documentId: doc.id,
            parentNodeId: null,
            contentMarkdown: line,
            checked: null,
            collapsed: false,
          });
        }
      }
      return doc;
    });

    await this.deps.searchConfigRepo.touchIngestWebhookLastUsed(
      webhook.id,
      new Date().toISOString(),
    );
    this.deps.sseHub.publish({
      type: "ingest_webhook.updated",
      workspaceId: webhook.workspaceId,
      spaceId: webhook.targetSpaceId,
      documentId: created.id,
      actorType: "agent",
      payload: { action: "ingested", webhookId: webhook.id },
    });

    return {
      webhookId: webhook.id,
      document: created,
      batchId,
    };
  }

  // -------------------------------------------------------------------------
  // RSS / Atom / JSON Feed Management & Conditional Sync
  // -------------------------------------------------------------------------

  private async safeFetchFeed(
    rawUrl: string,
    headers: Record<string, string>,
  ): Promise<{ readonly status: number; readonly text: string; readonly etag: string | null; readonly lastModified: string | null }> {
    let currentUrl = rawUrl;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!this.allowLocalForTest) {
        await assertSafeExternalUrl(currentUrl, this.resolveDns);
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      let res: Response;
      try {
        res = await this.fetchFn(currentUrl, {
          headers: {
            "user-agent": "Inkade-Feed-Reader/1.0",
            accept: "application/rss+xml, application/atom+xml, application/feed+json, application/xml, text/xml, */*",
            ...headers,
          },
          redirect: "manual",
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      if (res.status === 304) {
        return {
          status: 304,
          text: "",
          etag: res.headers.get("etag"),
          lastModified: res.headers.get("last-modified"),
        };
      }

      if (res.status === 301 || res.status === 302 || res.status === 303 || res.status === 307 || res.status === 308) {
        const location = res.headers.get("location");
        if (!location) {
          throw new InkadeError("VALIDATION_ERROR", "Feed redirect missing location header");
        }
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }

      if (!res.ok) {
        throw new InkadeError("VALIDATION_ERROR", `Feed fetch failed with HTTP ${res.status}`);
      }

      const bytes = await readBytesWithLimit(res, MAX_RSS_BYTES);
      return {
        status: res.status,
        text: new TextDecoder().decode(bytes),
        etag: res.headers.get("etag"),
        lastModified: res.headers.get("last-modified"),
      };
    }
    throw new InkadeError("VALIDATION_ERROR", "Too many feed redirects");
  }

  async listFeeds(principal: Principal): Promise<readonly RssFeedRecord[]> {
    const allSpaces = await getAllWorkspaceSpaces(
      this.deps.spacesCache ?? this.deps.spaceRepo,
      principal.workspaceId,
    );
    const feeds = await this.deps.searchConfigRepo.listRssFeeds(principal.workspaceId);
    return feeds.filter((f) => {
      try {
        assertScope(principal.scope, "read", { spaceId: f.targetSpaceId, resourceType: "space" }, allSpaces);
        return true;
      } catch {
        return false;
      }
    });
  }

  async createFeed(principal: Principal, input: CreateRssFeedInput): Promise<RssFeedRecord> {
    if (!this.allowLocalForTest) {
      await assertSafeExternalUrl(input.url, this.resolveDns);
    }
    const targetSpaceId = await this.resolveDefaultCaptureSpaceId(
      principal,
      input.targetSpaceId,
    );
    const derivedTitle =
      input.title?.trim() || new URL(input.url).hostname.replace(/^www\./i, "");
    const feed = await this.deps.searchConfigRepo.createRssFeed(principal.workspaceId, {
      url: input.url,
      title: derivedTitle,
      targetSpaceId,
      enabled: input.enabled ?? true,
    });
    this.deps.sseHub.publish({
      type: "rss_feed.updated",
      workspaceId: principal.workspaceId,
      spaceId: feed.targetSpaceId,
      actorType: principal.actorType,
      payload: { action: "created", feedId: feed.id },
    });
    return feed;
  }

  async updateFeed(
    principal: Principal,
    feedId: RssFeedId,
    patch: UpdateRssFeedInput,
  ): Promise<RssFeedRecord> {
    const existing = await this.deps.searchConfigRepo.getRssFeedById(
      principal.workspaceId,
      feedId,
    );
    if (!existing) {
      throw new InkadeError("NOT_FOUND", `RSS feed "${feedId}" not found`);
    }
    const allSpaces = await getAllWorkspaceSpaces(
      this.deps.spacesCache ?? this.deps.spaceRepo,
      principal.workspaceId,
    );
    assertScope(
      principal.scope,
      "write",
      { spaceId: existing.targetSpaceId, resourceType: "space" },
      allSpaces,
    );
    if (patch.targetSpaceId) {
      await this.resolveDefaultCaptureSpaceId(principal, patch.targetSpaceId);
    }
    const updated = await this.deps.searchConfigRepo.updateRssFeed(
      principal.workspaceId,
      feedId,
      patch,
    );
    this.deps.sseHub.publish({
      type: "rss_feed.updated",
      workspaceId: principal.workspaceId,
      spaceId: updated.targetSpaceId,
      actorType: principal.actorType,
      payload: { action: "updated", feedId: updated.id },
    });
    return updated;
  }

  async deleteFeed(principal: Principal, feedId: RssFeedId): Promise<void> {
    const existing = await this.deps.searchConfigRepo.getRssFeedById(
      principal.workspaceId,
      feedId,
    );
    if (!existing) {
      throw new InkadeError("NOT_FOUND", `RSS feed "${feedId}" not found`);
    }
    const allSpaces = await getAllWorkspaceSpaces(
      this.deps.spacesCache ?? this.deps.spaceRepo,
      principal.workspaceId,
    );
    assertScope(
      principal.scope,
      "write",
      { spaceId: existing.targetSpaceId, resourceType: "space" },
      allSpaces,
    );
    await this.deps.searchConfigRepo.deleteRssFeed(principal.workspaceId, feedId);
    this.deps.sseHub.publish({
      type: "rss_feed.updated",
      workspaceId: principal.workspaceId,
      spaceId: existing.targetSpaceId,
      actorType: principal.actorType,
      payload: { action: "deleted", feedId },
    });
  }

  async syncFeed(principal: Principal, feedId: RssFeedId): Promise<RssSyncResult> {
    const feed = await this.deps.searchConfigRepo.getRssFeedById(principal.workspaceId, feedId);
    if (!feed) {
      throw new InkadeError("NOT_FOUND", `RSS feed "${feedId}" not found`);
    }
    const allSpaces = await getAllWorkspaceSpaces(
      this.deps.spacesCache ?? this.deps.spaceRepo,
      principal.workspaceId,
    );
    assertScope(
      principal.scope,
      "write",
      { spaceId: feed.targetSpaceId, resourceType: "space" },
      allSpaces,
    );

    const headers: Record<string, string> = {};
    if (feed.etag) headers["if-none-match"] = feed.etag;
    if (feed.lastModified) headers["if-modified-since"] = feed.lastModified;

    const now = new Date().toISOString();
    let fetched;
    try {
      fetched = await this.safeFetchFeed(feed.url, headers);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.deps.searchConfigRepo.updateRssFeed(principal.workspaceId, feed.id, {
        lastFetchedAt: now,
        lastError: message,
      });
      throw err;
    }

    if (fetched.status === 304) {
      const updatedFeed = await this.deps.searchConfigRepo.updateRssFeed(
        principal.workspaceId,
        feed.id,
        {
          lastFetchedAt: now,
          lastError: null,
          ...(fetched.etag ? { etag: fetched.etag } : {}),
          ...(fetched.lastModified ? { lastModified: fetched.lastModified } : {}),
        },
      );
      return {
        feed: updatedFeed,
        fetchedCount: 0,
        createdCount: 0,
        skippedCount: 0,
        notModified: true,
        createdDocumentIds: [],
      };
    }

    const { feedTitle, items } = extractFeedEntries(fetched.text, feed.url);
    const existingDocs = await this.deps.documentRepo.listDocuments(principal.workspaceId, {
      includeTrashed: false,
      includeSystem: false,
      limit: null,
    });
    const seenUrls = new Set(
      existingDocs
        .map((d) => d.sourceUrl?.trim().toLowerCase())
        .filter((u): u is string => Boolean(u)),
    );

    const createdDocumentIds: DocumentId[] = [];
    let skippedCount = 0;

    for (const item of items) {
      const urlKey = item.url?.trim().toLowerCase();
      if (urlKey && seenUrls.has(urlKey)) {
        skippedCount += 1;
        continue;
      }
      if (urlKey) seenUrls.add(urlKey);

      const created = await this.deps.documentService.createDocument(principal, {
        spaceId: feed.targetSpaceId,
        kind: "clip",
        title: item.title,
        contentMarkdown: item.markdown,
        tags: ["rss"],
        sourceUrl: item.url ?? undefined,
        sourceMeta: {
          ingestChannel: "rss",
          feedId: feed.id,
          feedTitle,
          publishedAt: item.publishedAt,
          author: item.author,
        },
      });
      createdDocumentIds.push(created.id);
    }

    const updatedFeed = await this.deps.searchConfigRepo.updateRssFeed(
      principal.workspaceId,
      feed.id,
      {
        title: feedTitle || feed.title,
        etag: fetched.etag ?? feed.etag,
        lastModified: fetched.lastModified ?? feed.lastModified,
        lastFetchedAt: now,
        lastError: null,
      },
    );

    this.deps.sseHub.publish({
      type: "rss_feed.updated",
      workspaceId: principal.workspaceId,
      spaceId: updatedFeed.targetSpaceId,
      actorType: principal.actorType,
      payload: { action: "synced", feedId: updatedFeed.id },
    });

    return {
      feed: updatedFeed,
      fetchedCount: items.length,
      createdCount: createdDocumentIds.length,
      skippedCount,
      notModified: false,
      createdDocumentIds,
    };
  }

  async syncAllEnabledFeeds(principal: Principal): Promise<readonly RssSyncResult[]> {
    const feeds = (await this.listFeeds(principal)).filter((f) => f.enabled);
    const results: RssSyncResult[] = [];
    for (const feed of feeds) {
      results.push(await this.syncFeed(principal, feed.id));
    }
    return results;
  }

  // -------------------------------------------------------------------------
  // Voice Memo Transcription (OpenAI Whisper / whisper.cpp compatible)
  // -------------------------------------------------------------------------

  async transcribeAudioAndSave(
    principal: Principal,
    input: {
      readonly filename: string;
      readonly mimeType: string;
      readonly bytes: Uint8Array;
      readonly language?: string | undefined;
      readonly title?: string | undefined;
      readonly spaceId?: SpaceId | undefined;
      readonly target?: AudioTranscribeTarget | undefined;
      readonly documentId?: DocumentId | undefined;
      readonly dailyDate?: string | undefined;
      readonly tags?: readonly string[] | undefined;
      readonly transcriptionEndpoint?: string | undefined;
      readonly transcriptionModel?: string | undefined;
    },
  ): Promise<AudioTranscribeResult> {
    if (input.bytes.byteLength === 0) {
      throw new InkadeError("VALIDATION_ERROR", "Audio payload is empty");
    }
    if (input.bytes.byteLength > MAX_AUDIO_BYTES) {
      throw new InkadeError("VALIDATION_ERROR", `Audio exceeds maximum ${MAX_AUDIO_BYTES} bytes`);
    }

    const settings = await this.deps.searchConfigRepo.getAiSettingsSecret(principal.workspaceId);
    const rawEndpoint =
      input.transcriptionEndpoint?.trim() ||
      (settings.baseUrl.trim()
        ? `${settings.baseUrl.replace(/\/+$/, "").replace(/\/chat\/completions$/, "")}/audio/transcriptions`
        : "");
    if (!rawEndpoint) {
      throw new InkadeError(
        "VALIDATION_ERROR",
        "No Whisper transcription endpoint configured. Set AI baseUrl in Settings or pass transcriptionEndpoint.",
      );
    }

    const safeEndpoint = await validateAiEndpointUrl(rawEndpoint, {
      allowPrivateLoopback: true,
      resolveDns: this.resolveDns,
      allowLocalForTest: this.allowLocalForTest,
    });

    const cleanFilename = basename(input.filename.trim() || "voice-memo.webm");
    const uploadRes = await this.deps.attachmentService.uploadAttachment(principal, {
      documentId: input.documentId ?? null,
      filename: cleanFilename,
      mimeType: input.mimeType || "audio/webm",
      bytes: input.bytes,
    });

    const asset = await this.deps.attachmentRepo.createDocumentAsset(principal.workspaceId, {
      attachmentId: uploadRes.attachment.id,
      companionDocumentId: input.documentId ?? null,
      assetKind: "audio",
      pageCount: 0,
    });

    const formData = new FormData();
    const audioCopy = new Uint8Array(input.bytes.byteLength);
    audioCopy.set(input.bytes);
    formData.append(
      "file",
      new Blob([audioCopy], { type: input.mimeType || "audio/webm" }),
      cleanFilename,
    );
    formData.append("model", input.transcriptionModel?.trim() || "whisper-1");
    if (input.language?.trim()) {
      formData.append("language", input.language.trim());
    }

    const headers: Record<string, string> = {};
    if (settings.apiKey.trim()) {
      headers["authorization"] = `Bearer ${settings.apiKey.trim()}`;
    }

    const response = await this.fetchFn(safeEndpoint, {
      method: "POST",
      headers,
      body: formData,
    });
    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new InkadeError(
        "INTERNAL_ERROR",
        `Transcription gateway returned HTTP ${response.status}: ${errText.slice(0, 200)}`,
      );
    }

    const json = (await response.json().catch(() => ({}))) as {
      text?: unknown;
      language?: unknown;
      duration?: unknown;
    };
    const transcript = typeof json.text === "string" ? json.text.trim() : "";
    if (!transcript) {
      throw new InkadeError("VALIDATION_ERROR", "Transcription response did not include text");
    }

    const target = input.target ?? "clip";
    const audioLinkMd = `[${cleanFilename}](${uploadRes.downloadUrl})`;
    let savedDoc: DocumentRecord | null = null;
    let createdNode: OutlineNode | null = null;

    if (target === "daily") {
      const dateStr = input.dailyDate ?? todayLocalDateString();
      const daily = await this.deps.outlineService.getOrCreateDailyOutline(principal, dateStr);
      createdNode = await this.deps.outlineService.createNode(principal, {
        documentId: daily.document.id,
        parentNodeId: null,
        contentMarkdown: `${transcript} (${audioLinkMd})`,
        checked: null,
        collapsed: false,
      });
      savedDoc = daily.document;
    } else if (target === "document" && input.documentId) {
      const doc = await this.deps.documentRepo.getDocumentById(
        principal.workspaceId,
        input.documentId,
      );
      if (!doc || doc.trashedAt !== null) {
        throw new InkadeError("NOT_FOUND", `Document "${input.documentId}" not found`);
      }
      if (doc.kind === "outline") {
        createdNode = await this.deps.outlineService.createNode(principal, {
          documentId: doc.id,
          parentNodeId: null,
          contentMarkdown: `${transcript} (${audioLinkMd})`,
          checked: null,
          collapsed: false,
        });
        savedDoc = doc;
      } else {
        const nextMd = `${doc.contentMarkdown.trimEnd()}\n\n${transcript}\n\n${audioLinkMd}`.trim();
        savedDoc = await this.deps.documentService.updateDocument(principal, doc.id, {
          contentMarkdown: nextMd,
          changeSummary: "Appended voice transcription",
        });
      }
    } else {
      const targetSpaceId = await this.resolveDefaultCaptureSpaceId(principal, input.spaceId);
      const docTitle =
        input.title?.trim() ||
        transcript.split(/[。！？.!?\r\n]/)[0]?.trim().slice(0, 80) ||
        `Voice Note (${new Date().toISOString().slice(0, 10)})`;
      savedDoc = await this.deps.documentService.createDocument(principal, {
        spaceId: targetSpaceId,
        kind: "clip",
        title: docTitle,
        contentMarkdown: `${transcript}\n\n---\n${audioLinkMd}`,
        tags: [...new Set(["voice", ...(input.tags ?? [])])],
        sourceMeta: {
          ingestChannel: "audio",
          attachmentId: uploadRes.attachment.id,
          assetId: asset.id,
          language: typeof json.language === "string" ? json.language : (input.language ?? null),
        },
      });
    }

    if (savedDoc && asset.companionDocumentId !== savedDoc.id) {
      await this.deps.attachmentRepo.updateDocumentAsset(principal.workspaceId, asset.id, {
        companionDocumentId: savedDoc.id,
      });
    }

    return {
      text: transcript,
      language: typeof json.language === "string" ? json.language : (input.language ?? null),
      durationSec: typeof json.duration === "number" ? json.duration : null,
      attachmentId: uploadRes.attachment.id,
      assetId: asset.id,
      document: savedDoc,
      node: createdNode,
    };
  }
}
