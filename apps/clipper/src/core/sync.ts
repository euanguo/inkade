import type { ExtractedArticle } from "@inkade/clipper-core/extractor";
import {
  todayLocalDateString,
  type AdeKind,
  type AdeThreadBinding,
  type AttachmentId,
  type ClipLookupResult,
  type DocumentHighlight,
  type DocumentId,
  type DocumentRecord,
  type HighlightColor,
  type OutlineNode,
  type ScopeEffectiveSummary,
  type Space,
  type SpaceId,
} from "@inkade/core";
import { createInkadeClient, type FetchLike, type InkadeClient } from "@inkade/sdk";
import type { ClipExtractionMode } from "../shared/storage.ts";
import { inferClipImageFilename, mirrorImagesAndPatchDocument } from "./image-mirror.ts";

export { inferClipImageFilename };

export interface ClipperConnectionInfo {
  readonly tokenName: string;
  readonly principalKind: "token" | "user";
  readonly scopeSummary: ScopeEffectiveSummary;
  readonly visibleSpaces: readonly Space[];
  readonly defaultSpaceId: SpaceId | "";
}

export interface SyncClipPageInput {
  readonly extracted: ExtractedArticle;
  readonly spaceId?: SpaceId | undefined;
  readonly title?: string | undefined;
  readonly markdownOverride?: string | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly properties?: Record<string, unknown> | null | undefined;
  readonly existingDocumentId?: DocumentId | undefined;
  readonly updateMetadataOnly?: boolean | undefined;
  readonly mode?: ClipExtractionMode | undefined;
  readonly mirrorImages?: boolean | undefined;
  readonly asyncMirror?: boolean | undefined;
  readonly compressWebp?: boolean | undefined;
  readonly saveHtmlSnapshot?: boolean | undefined;
  readonly appendToDaily?: boolean | undefined;
  readonly dailyLineOverride?: string | undefined;
  readonly fetchFn?: FetchLike | typeof fetch | undefined;
  readonly onBackgroundTasks?: ((promise: Promise<void>) => void) | undefined;
}

export interface LocalInkadeProbeResult {
  readonly serverUrl: string;
  readonly service: string;
  readonly dialect: string;
}

const DEFAULT_LOCAL_SERVER_CANDIDATES = [
  "http://127.0.0.1:4100",
  "http://127.0.0.1:3456",
  "http://localhost:4100",
  "http://localhost:3456",
] as const;

export async function probeLocalInkadeServers(
  fetchFn: FetchLike | typeof fetch = globalThis.fetch,
  candidates: readonly string[] = DEFAULT_LOCAL_SERVER_CANDIDATES,
): Promise<LocalInkadeProbeResult | null> {
  for (const rawCandidate of candidates) {
    const base = rawCandidate.replace(/\/+$/, "");
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 1500) : undefined;
    try {
      const res = await fetchFn(`${base}/api/v1/health`, {
        method: "GET",
        ...(controller ? { signal: controller.signal } : {}),
      });
      if (!res.ok) continue;
      const body = (await res.json()) as {
        readonly ok?: boolean;
        readonly service?: string;
        readonly dialect?: string;
      };
      if (body?.ok) {
        return {
          serverUrl: base,
          service: body.service ?? "inkade",
          dialect: body.dialect ?? "sqlite",
        };
      }
    } catch {
      // try next candidate
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
  return null;
}

export interface SyncClipPageResult {
  readonly document: DocumentRecord;
  readonly mirroredImages: number;
  readonly mirrorPending: boolean;
  readonly conflictSkipped: boolean;
  readonly snapshotAttachmentId?: AttachmentId | undefined;
  readonly dailyNode?: OutlineNode | undefined;
  readonly mode: ClipExtractionMode;
}

export interface SyncHighlightInput {
  readonly url: string;
  readonly title?: string | undefined;
  readonly spaceId?: SpaceId | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly extracted?: ExtractedArticle | undefined;
  readonly existingDocumentId?: DocumentId | undefined;
  readonly mirrorImages?: boolean | undefined;
  readonly saveHtmlSnapshot?: boolean | undefined;
  readonly compressWebp?: boolean | undefined;
  readonly anchor: {
    readonly quote: string;
    readonly prefixContext?: string | undefined;
    readonly suffixContext?: string | undefined;
  };
  readonly color?: HighlightColor | undefined;
  readonly noteMarkdown?: string | undefined;
}

export interface SyncHighlightResult {
  readonly document: DocumentRecord;
  readonly highlight: DocumentHighlight;
  readonly createdClip: boolean;
}

export interface DispatchClipToAdeInput {
  readonly url: string;
  readonly title?: string | undefined;
  readonly spaceId?: SpaceId | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly extracted?: ExtractedArticle | undefined;
  readonly existingDocumentId?: DocumentId | undefined;
  readonly adeKind: AdeKind;
  readonly prompt: string;
  readonly selectionAnchor?: {
    readonly quote: string;
    readonly prefixContext?: string | undefined;
    readonly suffixContext?: string | undefined;
  } | undefined;
  readonly appendToDaily?: boolean | undefined;
}

export interface DispatchClipToAdeResult {
  readonly document: DocumentRecord;
  readonly binding: AdeThreadBinding;
  readonly highlight?: DocumentHighlight | undefined;
  readonly dailyNode?: OutlineNode | undefined;
}

export function createClipperSdkClient(config: {
  readonly serverUrl: string;
  readonly token: string;
  readonly fetch?: FetchLike | typeof fetch | undefined;
}): InkadeClient {
  return createInkadeClient({
    baseUrl: config.serverUrl,
    token: config.token,
    ...(config.fetch ? { fetch: config.fetch } : {}),
  });
}

export async function resolveClipperConnection(
  client: InkadeClient,
): Promise<ClipperConnectionInfo> {
  const whoami = await client.auth.whoami();
  const visibleSpaces = whoami.visibleSpaces;
  const activeSpaces = visibleSpaces.filter((space) => space.archivedAt === null);
  const inbox =
    activeSpaces.find((space) => space.slug === "inbox") ??
    activeSpaces[0] ??
    visibleSpaces[0];

  return {
    tokenName: whoami.tokenName,
    principalKind: whoami.principalKind,
    scopeSummary: whoami.effectiveSummary,
    visibleSpaces,
    defaultSpaceId: inbox?.id ?? "",
  };
}

export async function resolveTargetSpaceId(
  client: InkadeClient,
  preferredSpaceId: SpaceId | undefined,
): Promise<SpaceId> {
  if (preferredSpaceId) {
    return preferredSpaceId;
  }
  const connection = await resolveClipperConnection(client);
  if (!connection.defaultSpaceId) {
    throw new Error("No visible target Space available for this token");
  }
  return connection.defaultSpaceId;
}

export async function lookupClipState(
  client: InkadeClient,
  pageUrl: string,
): Promise<ClipLookupResult> {
  return client.clips.lookup(pageUrl);
}

/**
 * Appends a clipped document reference to Today's Daily outline without overwriting existing nodes.
 */
export async function appendClipToDaily(
  client: InkadeClient,
  input: {
    readonly title: string;
    readonly url: string;
    readonly documentId: string;
    readonly customMarkdown?: string | undefined;
    readonly date?: string | undefined;
  },
): Promise<OutlineNode> {
  const dateStr = input.date ?? todayLocalDateString();
  const daily = await client.documents.getDaily(dateStr);
  const contentMarkdown =
    input.customMarkdown?.trim() ||
    `- [[${input.title}]] ([source](${input.url})) #clip`;

  return client.outlineNodes.create({
    documentId: daily.document.id,
    contentMarkdown,
  });
}

/**
 * Clips a web page to Inkade either via browser DOM extraction (supporting logged-in pages)
 * or via server `/api/v1/clips/ingest-url`, with optional asynchronous optimistic image mirroring
 * and Daily outline appending.
 */
export async function syncClipPage(
  client: InkadeClient,
  input: SyncClipPageInput,
): Promise<SyncClipPageResult> {
  const mode: ClipExtractionMode = input.mode ?? "client-dom";
  const mirrorImages = input.mirrorImages ?? true;
  const saveHtmlSnapshot = input.saveHtmlSnapshot ?? true;
  const tags = input.tags ?? [];
  const finalTitle = input.title?.trim() || input.extracted.title;
  const contentMarkdown = input.markdownOverride ?? input.extracted.markdown;

  if (mode === "server-ingest") {
    const ingested = await client.clips.ingestUrl({
      url: input.extracted.url,
      ...(input.spaceId ? { spaceId: input.spaceId } : {}),
      tags: [...tags],
      title: finalTitle,
      mirrorImages,
      saveHtmlSnapshot,
    });
    let dailyNode: OutlineNode | undefined;
    if (input.appendToDaily) {
      dailyNode = await appendClipToDaily(client, {
        title: ingested.document.title,
        url: input.extracted.url,
        documentId: ingested.document.id,
        customMarkdown: input.dailyLineOverride,
      });
    }
    return {
      document: ingested.document,
      mirroredImages: ingested.mirroredImages,
      mirrorPending: false,
      conflictSkipped: false,
      ...(dailyNode ? { dailyNode } : {}),
      mode: "server-ingest",
    };
  }

  const baseSourceMeta: Record<string, unknown> = {
    ...input.extracted.meta,
    extractor: `extension-${input.extracted.extractor}`,
  };

  let doc: DocumentRecord;
  if (input.existingDocumentId && input.updateMetadataOnly) {
    doc = await client.documents.update(input.existingDocumentId, {
      ...(input.spaceId ? { spaceId: input.spaceId } : {}),
      title: finalTitle,
      tags: [...tags],
      ...(input.properties !== undefined ? { properties: input.properties } : {}),
      changeSummary: "Updated web clip metadata from extension",
    });
    let dailyNode: OutlineNode | undefined;
    if (input.appendToDaily) {
      try {
        dailyNode = await appendClipToDaily(client, {
          title: doc.title,
          url: input.extracted.url,
          documentId: doc.id,
          customMarkdown: input.dailyLineOverride,
        });
      } catch {
        // Non-fatal if Daily space is outside token scope
      }
    }
    return {
      document: doc,
      mirroredImages: 0,
      mirrorPending: false,
      conflictSkipped: false,
      ...(dailyNode ? { dailyNode } : {}),
      mode: "client-dom",
    };
  }

  if (input.existingDocumentId) {
    doc = await client.documents.update(input.existingDocumentId, {
      ...(input.spaceId ? { spaceId: input.spaceId } : {}),
      title: finalTitle,
      contentMarkdown,
      tags: [...tags],
      sourceMeta: baseSourceMeta,
      ...(input.properties !== undefined ? { properties: input.properties } : {}),
      changeSummary: "Updated web clip from extension",
    });
  } else {
    const spaceId = await resolveTargetSpaceId(client, input.spaceId);
    doc = await client.documents.create({
      spaceId,
      kind: "clip",
      title: finalTitle,
      contentMarkdown,
      tags: [...tags],
      sourceUrl: input.extracted.url,
      sourceMeta: baseSourceMeta,
      ...(input.properties !== undefined ? { properties: input.properties } : {}),
      pinned: false,
    });
  }

  let dailyNode: OutlineNode | undefined;
  if (input.appendToDaily) {
    try {
      dailyNode = await appendClipToDaily(client, {
        title: doc.title,
        url: input.extracted.url,
        documentId: doc.id,
        customMarkdown: input.dailyLineOverride,
      });
    } catch {
      // Non-fatal if Daily space is outside token scope
    }
  }

  const runPostCreateAssets = async (): Promise<{
    mirroredImages: number;
    snapshotAttachmentId?: AttachmentId | undefined;
    conflictSkipped: boolean;
  }> => {
    let snapshotAttachmentId: AttachmentId | undefined;
    if (saveHtmlSnapshot && input.extracted.htmlSnapshot.trim().length > 0) {
      try {
        const snap = await client.attachments.upload({
          documentId: doc.id,
          filename: "snapshot.html",
          mimeType: "text/html; charset=utf-8",
          data: new TextEncoder().encode(input.extracted.htmlSnapshot),
        });
        snapshotAttachmentId = snap.attachment.id;
      } catch {
        // Non-fatal
      }
    }

    if (mirrorImages && input.extracted.imageUrls.length > 0) {
      const mirrorResult = await mirrorImagesAndPatchDocument(client, {
        documentId: doc.id,
        expectedVersion: doc.version,
        originalMarkdown: contentMarkdown,
        imageUrls: input.extracted.imageUrls,
        baseSourceMeta,
        snapshotAttachmentId,
        compressWebp: input.compressWebp,
        fetchFn: input.fetchFn,
      });
      return {
        mirroredImages: mirrorResult.mirroredImages,
        snapshotAttachmentId,
        conflictSkipped: mirrorResult.conflictSkipped,
      };
    }

    if (snapshotAttachmentId) {
      try {
        await client.documents.update(doc.id, {
          expectedVersion: doc.version,
          sourceMeta: {
            ...baseSourceMeta,
            snapshotAttachmentId,
            mirroredImages: 0,
          },
        });
      } catch {
        // Ignore version conflict when patching snapshot metadata
      }
    }

    return {
      mirroredImages: 0,
      snapshotAttachmentId,
      conflictSkipped: false,
    };
  };

  if (input.asyncMirror && input.onBackgroundTasks) {
    input.onBackgroundTasks(
      runPostCreateAssets().then(() => undefined).catch(() => undefined),
    );
    return {
      document: doc,
      mirroredImages: 0,
      mirrorPending: mirrorImages && input.extracted.imageUrls.length > 0,
      conflictSkipped: false,
      ...(dailyNode ? { dailyNode } : {}),
      mode: "client-dom",
    };
  }

  const post = await runPostCreateAssets();
  let refreshedDoc = doc;
  if (post.mirroredImages > 0 && !post.conflictSkipped) {
    try {
      refreshedDoc = await client.documents.get(doc.id);
    } catch {
      // Keep original doc snapshot if reload fails
    }
  }

  return {
    document: refreshedDoc,
    mirroredImages: post.mirroredImages,
    mirrorPending: false,
    conflictSkipped: post.conflictSkipped,
    ...(post.snapshotAttachmentId ? { snapshotAttachmentId: post.snapshotAttachmentId } : {}),
    ...(dailyNode ? { dailyNode } : {}),
    mode: "client-dom",
  };
}

/**
 * Syncs a W3C-anchored page highlight to Inkade, automatically creating the parent clip
 * document via `/api/v1/clips/lookup` deduplication if the URL has not been clipped yet.
 */
export async function syncHighlightToInkade(
  client: InkadeClient,
  input: SyncHighlightInput,
): Promise<SyncHighlightResult> {
  let targetDoc: DocumentRecord | null = null;
  let createdClip = false;

  if (input.existingDocumentId) {
    targetDoc = await client.documents.get(input.existingDocumentId);
  } else {
    const existing = await lookupClipState(client, input.url);
    targetDoc = existing.document;
  }

  if (!targetDoc) {
    if (input.extracted) {
      const clipped = await syncClipPage(client, {
        extracted: input.extracted,
        spaceId: input.spaceId,
        title: input.title,
        tags: input.tags,
        mode: "client-dom",
        mirrorImages: input.mirrorImages ?? false,
        saveHtmlSnapshot: input.saveHtmlSnapshot ?? false,
        compressWebp: input.compressWebp,
      });
      targetDoc = clipped.document;
    } else {
      const spaceId = await resolveTargetSpaceId(client, input.spaceId);
      const fallbackTitle = input.title?.trim() || input.url;
      targetDoc = await client.documents.create({
        spaceId,
        kind: "clip",
        title: fallbackTitle,
        contentMarkdown: `> ${input.anchor.quote.replace(/\n/g, "\n> ")}`,
        tags: [...(input.tags ?? [])],
        sourceUrl: input.url,
        sourceMeta: {
          extractor: "extension-highlight",
        },
        pinned: false,
      });
    }
    createdClip = true;
  }

  const highlight = await client.highlights.create(targetDoc.id, {
    quote: input.anchor.quote,
    prefixContext: input.anchor.prefixContext ?? "",
    suffixContext: input.anchor.suffixContext ?? "",
    color: input.color ?? "amber",
    noteMarkdown: input.noteMarkdown ?? "",
  });

  return {
    document: targetDoc,
    highlight,
    createdClip,
  };
}

/**
 * Saves a single right-clicked image directly as an attachment-backed Clip document.
 */
export async function saveImageClipToInkade(
  client: InkadeClient,
  input: {
    readonly imageUrl: string;
    readonly pageUrl: string;
    readonly pageTitle?: string | undefined;
    readonly spaceId?: SpaceId | undefined;
    readonly tags?: readonly string[] | undefined;
    readonly fetchFn?: FetchLike | typeof fetch | undefined;
  },
): Promise<{ readonly document: DocumentRecord; readonly uploaded: boolean }> {
  const spaceId = await resolveTargetSpaceId(client, input.spaceId);
  const domain = (() => {
    try {
      return new URL(input.pageUrl).hostname;
    } catch {
      return "image";
    }
  })();

  const title = input.pageTitle?.trim()
    ? `${input.pageTitle.trim()} — Image`
    : `Image from ${domain}`;

  const doc = await client.documents.create({
    spaceId,
    kind: "clip",
    title,
    contentMarkdown: `![Saved image](${input.imageUrl})\n\nSource: [${input.pageUrl}](${input.pageUrl})`,
    tags: [...(input.tags ?? [])],
    sourceUrl: input.pageUrl,
    sourceMeta: {
      domain,
      extractor: "extension-image",
      imageUrl: input.imageUrl,
    },
    pinned: false,
  });

  const fetchImpl =
    input.fetchFn ?? ((u: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(u, init));
  try {
    const res = await fetchImpl(input.imageUrl, { method: "GET" });
    if (res.ok) {
      const mimeType =
        res.headers.get("content-type")?.split(";")[0]?.trim() || "image/png";
      if (mimeType.startsWith("image/")) {
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (bytes.byteLength > 0) {
          const uploaded = await client.attachments.upload({
            documentId: doc.id,
            filename: inferClipImageFilename(input.imageUrl, mimeType, 0),
            mimeType,
            data: bytes,
          });
          const updated = await client.documents.update(doc.id, {
            expectedVersion: doc.version,
            contentMarkdown: `![Saved image](${uploaded.downloadUrl})\n\nSource: [${input.pageUrl}](${input.pageUrl})`,
            changeSummary: "Mirrored single clipped image",
          });
          return { document: updated, uploaded: true };
        }
      }
    }
  } catch {
    // Keep original image URL if fetch fails
  }

  return { document: doc, uploaded: false };
}

/**
 * Clips only the user's selected passage (Markdown) without saving the rest of the page.
 */
export async function syncSelectionClipToInkade(
  client: InkadeClient,
  input: {
    readonly url: string;
    readonly title: string;
    readonly selectionMarkdown: string;
    readonly spaceId?: SpaceId | undefined;
    readonly tags?: readonly string[] | undefined;
  },
): Promise<DocumentRecord> {
  const spaceId = await resolveTargetSpaceId(client, input.spaceId);
  const body = `${input.selectionMarkdown.trim()}\n\n---\nSource: [${input.url}](${input.url})`;
  return client.documents.create({
    spaceId,
    kind: "clip",
    title: input.title.trim() || input.url,
    contentMarkdown: body,
    tags: [...(input.tags ?? [])],
    sourceUrl: input.url,
    sourceMeta: {
      extractor: "extension-selection",
    },
    pinned: false,
  });
}

let pendingThreadCounter = 0;

function createPendingThreadId(): string {
  const unique =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
      : (++pendingThreadCounter).toString(36);
  return `thr_pending_${Date.now().toString(36)}_${unique}`;
}

/**
 * Creates an Inkade clip (if needed), optional highlight, optional Daily node,
 * and a queued `AdeThreadBinding` so BB / Paseo / Cindy can claim and execute it immediately.
 */
export async function dispatchClipToAde(
  client: InkadeClient,
  input: DispatchClipToAdeInput,
): Promise<DispatchClipToAdeResult> {
  let doc: DocumentRecord | null = null;
  if (input.existingDocumentId) {
    doc = await client.documents.get(input.existingDocumentId);
  } else {
    const lookup = await lookupClipState(client, input.url);
    doc = lookup.document;
  }

  if (!doc) {
    if (input.extracted) {
      const clipped = await syncClipPage(client, {
        extracted: input.extracted,
        spaceId: input.spaceId,
        title: input.title,
        tags: input.tags,
        mode: "client-dom",
        mirrorImages: false,
        saveHtmlSnapshot: false,
      });
      doc = clipped.document;
    } else {
      const spaceId = await resolveTargetSpaceId(client, input.spaceId);
      const quoteBlock = input.selectionAnchor?.quote
        ? `\n\n> ${input.selectionAnchor.quote.replace(/\n/g, "\n> ")}`
        : "";
      doc = await client.documents.create({
        spaceId,
        kind: "clip",
        title: input.title?.trim() || input.url,
        contentMarkdown: `Source: [${input.url}](${input.url})${quoteBlock}`,
        tags: [...(input.tags ?? [])],
        sourceUrl: input.url,
        sourceMeta: { extractor: "extension-ade-dispatch" },
        pinned: false,
      });
    }
  }

  let highlight: DocumentHighlight | undefined;
  if (input.selectionAnchor?.quote.trim()) {
    highlight = await client.highlights.create(doc.id, {
      quote: input.selectionAnchor.quote.trim(),
      prefixContext: input.selectionAnchor.prefixContext ?? "",
      suffixContext: input.selectionAnchor.suffixContext ?? "",
      color: "blue",
      noteMarkdown: input.prompt.trim(),
    });
  }

  let dailyNode: OutlineNode | undefined;
  if (input.appendToDaily) {
    try {
      dailyNode = await appendClipToDaily(client, {
        title: doc.title,
        url: input.url,
        documentId: doc.id,
        customMarkdown: `[[${doc.title}]] — ${input.prompt.trim()}`,
      });
    } catch {
      // Ignore if daily space not writable
    }
  }

  const binding = await client.threadBindings.upsert({
    documentId: doc.id,
    nodeId: dailyNode?.id ?? null,
    ...(input.selectionAnchor?.quote.trim()
      ? { selectionAnchor: { quote: input.selectionAnchor.quote.trim() } }
      : {}),
    adeKind: input.adeKind,
    externalThreadId: createPendingThreadId(),
    title: input.prompt.trim().slice(0, 280) || doc.title,
    status: "queued",
    lastSummary: input.prompt.trim(),
  });

  return {
    document: doc,
    binding,
    ...(highlight ? { highlight } : {}),
    ...(dailyNode ? { dailyNode } : {}),
  };
}
