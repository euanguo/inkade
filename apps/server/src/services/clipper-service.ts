import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { extractArticleFromDocument } from "@inkade/clipper-core/extractor";
import { parseHTML } from "linkedom";
import {
  evaluateScopeAccess,
  InkadeError,
  normalizeClipUrl,
  type ClipLookupResult,
  type DocumentRecord,
  type IngestClipUrlInput,
} from "@inkade/core";
import {
  DEFAULT_SPACE_IDS,
  type DocumentRepo,
  type RevisionLinkRepo,
  type SpaceRepo,
  type ThreadBindingRepo,
} from "@inkade/db";
import type { WorkspaceSpacesCache } from "../cache/workspace-spaces-cache.ts";
import type { ServerLogger } from "../logger.ts";
import type { Principal } from "../types.ts";
import type { AttachmentService } from "./attachment-service.ts";
import type { DocumentService } from "./document-service.ts";
import { assertScope, getAllWorkspaceSpaces } from "./scope-guard.ts";

const MAX_REDIRECTS = 5;
const MAX_HTML_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_MIRRORED_IMAGES = 20;
const FETCH_TIMEOUT_MS = 15_000;

export type DnsResolver = (hostname: string) => Promise<readonly string[]>;
export type FetchFn = (input: string | URL, init?: RequestInit) => Promise<Response>;

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata",
  "0.0.0.0",
]);

function normalizeIpv4Mapped(ip: string): string {
  const lower = ip.toLowerCase();
  if (lower.startsWith("::ffff:")) {
    const rest = lower.slice(7);
    if (isIP(rest) === 4) return rest;
    // Handle hex representation like ::ffff:7f00:0001
    const parts = rest.split(":");
    if (parts.length === 2) {
      const hi = Number.parseInt(parts[0] ?? "", 16);
      const lo = Number.parseInt(parts[1] ?? "", 16);
      if (Number.isFinite(hi) && Number.isFinite(lo)) {
        return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
      }
    }
  }
  return lower;
}

export function isPrivateOrReservedIp(rawIp: string): boolean {
  const ip = normalizeIpv4Mapped(rawIp.trim().replace(/^\[|\]$/g, ""));
  const version = isIP(ip);
  if (version === 4) {
    const octets = ip.split(".").map((n) => Number.parseInt(n, 10));
    if (octets.length !== 4 || octets.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
      return true;
    }
    const [a = 0, b = 0, c = 0] = octets;
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
    if (a === 127) return true; // 127.0.0.0/8 loopback
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local & cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 0 && c === 0) return true; // 192.0.0.0/24
    if (a === 192 && b === 0 && c === 2) return true; // 192.0.2.0/24 TEST-NET-1
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15
    if (a === 198 && b === 51 && c === 100) return true; // 198.51.100.0/24
    if (a === 203 && b === 0 && c === 113) return true; // 203.0.113.0/24
    if (a >= 224) return true; // 224.0.0.0/4 multicast & 240.0.0.0/4 reserved
    return false;
  }

  if (version === 6) {
    const clean = ip.split("%")[0] ?? ip;
    if (clean === "::" || clean === "::1") return true;
    if (/^0+:0+:0+:0+:0+:0+:0+:[01]$/.test(clean)) return true;
    // fc00::/7 (fc.. or fd..)
    if (/^f[cd]/i.test(clean)) return true;
    // fe80::/10 (fe8..feb)
    if (/^fe[89ab]/i.test(clean)) return true;
    // ff00::/8 multicast
    if (/^ff/i.test(clean)) return true;
    return false;
  }

  return true;
}

export async function defaultDnsResolver(hostname: string): Promise<readonly string[]> {
  const entries = await dnsLookup(hostname, { all: true });
  return entries.map((e) => e.address);
}

export async function assertSafeExternalUrl(
  rawUrl: string,
  resolveDns: DnsResolver = defaultDnsResolver,
): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new InkadeError("VALIDATION_ERROR", `Invalid URL: "${rawUrl}"`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new InkadeError(
      "FORBIDDEN",
      `URL protocol "${parsed.protocol}" is blocked by SSRF policy`,
    );
  }

  if (parsed.username || parsed.password) {
    throw new InkadeError("FORBIDDEN", "URLs with embedded credentials are not allowed");
  }

  const hostname = parsed.hostname.toLowerCase();
  const bareHost = hostname.replace(/^\[|\]$/g, "");
  if (!bareHost) {
    throw new InkadeError("VALIDATION_ERROR", "URL hostname is empty");
  }

  if (
    BLOCKED_HOSTNAMES.has(bareHost) ||
    bareHost.endsWith(".localhost") ||
    bareHost.endsWith(".local") ||
    bareHost.endsWith(".internal")
  ) {
    throw new InkadeError(
      "FORBIDDEN",
      `Target host "${bareHost}" is blocked by SSRF policy`,
    );
  }

  if (isIP(bareHost) !== 0) {
    if (isPrivateOrReservedIp(bareHost)) {
      throw new InkadeError(
        "FORBIDDEN",
        `Target IP "${bareHost}" is in a private or reserved network range`,
      );
    }
    return parsed;
  }

  let resolvedIps: readonly string[];
  try {
    resolvedIps = await resolveDns(bareHost);
  } catch (err) {
    throw new InkadeError(
      "VALIDATION_ERROR",
      `Failed to resolve hostname "${bareHost}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (resolvedIps.length === 0) {
    throw new InkadeError("VALIDATION_ERROR", `Hostname "${bareHost}" resolved to no addresses`);
  }

  for (const ip of resolvedIps) {
    if (isPrivateOrReservedIp(ip)) {
      throw new InkadeError(
        "FORBIDDEN",
        `Target host "${bareHost}" resolved to blocked IP "${ip}"`,
      );
    }
  }

  return parsed;
}

export async function readBytesWithLimit(response: Response, maxBytes: number): Promise<Uint8Array> {
  const contentLength = response.headers.get("content-length");
  if (contentLength) {
    const declared = Number(contentLength);
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new InkadeError(
        "VALIDATION_ERROR",
        `Remote response exceeds maximum allowed size of ${maxBytes} bytes`,
      );
    }
  }

  const reader = response.body?.getReader();
  if (!reader) {
    const buf = new Uint8Array(await response.arrayBuffer());
    if (buf.byteLength > maxBytes) {
      throw new InkadeError(
        "VALIDATION_ERROR",
        `Remote response exceeds maximum allowed size of ${maxBytes} bytes`,
      );
    }
    return buf;
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new InkadeError(
          "VALIDATION_ERROR",
          `Remote response exceeds maximum allowed size of ${maxBytes} bytes`,
        );
      }
      chunks.push(value);
    }
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export function parseClipHtml(
  html: string,
  pageUrl: string,
): {
  readonly title: string;
  readonly markdown: string;
  readonly meta: Record<string, unknown>;
  readonly extractor: "tier1-defuddle" | "fallback";
} {
  const { document } = parseHTML(html);
  const extracted = extractArticleFromDocument(document, pageUrl, { useAsync: false });
  const extractor: "tier1-defuddle" | "fallback" =
    extracted.extractor === "fallback" ? "fallback" : "tier1-defuddle";
  return {
    title: extracted.title,
    markdown: extracted.markdown,
    meta: { ...extracted.meta },
    extractor,
  };
}

function inferImageFilename(imageUrl: string, mimeType: string, idx: number): string {
  try {
    const pathname = new URL(imageUrl).pathname;
    const last = pathname.split("/").filter(Boolean).pop();
    if (last && /\.[a-zA-Z0-9]{2,5}$/.test(last)) {
      return last.slice(0, 120);
    }
  } catch {
    // ignore
  }
  const ext = mimeType.includes("png")
    ? "png"
    : mimeType.includes("webp")
      ? "webp"
      : mimeType.includes("gif")
        ? "gif"
        : mimeType.includes("svg")
          ? "svg"
          : "jpg";
  return `clip-image-${idx + 1}.${ext}`;
}

export interface ClipperServiceDeps {
  readonly spaceRepo: SpaceRepo;
  readonly documentRepo: DocumentRepo;
  readonly revisionLinkRepo: RevisionLinkRepo;
  readonly threadBindingRepo: ThreadBindingRepo;
  readonly spacesCache?: WorkspaceSpacesCache | undefined;
  readonly logger?: ServerLogger | undefined;
  readonly documentService: DocumentService;
  readonly attachmentService: AttachmentService;
  readonly resolveDns?: DnsResolver | undefined;
  readonly fetchFn?: FetchFn | undefined;
}

export class ClipperService {
  private readonly resolveDns: DnsResolver;
  private readonly fetchFn: FetchFn;

  constructor(private readonly deps: ClipperServiceDeps) {
    this.resolveDns = deps.resolveDns ?? defaultDnsResolver;
    this.fetchFn =
      deps.fetchFn ?? ((input, init) => globalThis.fetch(input, init));
  }

  private async safeFetch(
    rawUrl: string,
    maxBytes: number,
  ): Promise<{ readonly finalUrl: string; readonly response: Response; readonly bytes: Uint8Array }> {
    let currentUrl = rawUrl;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const validatedUrl = await assertSafeExternalUrl(currentUrl, this.resolveDns);
      const response = await this.fetchFn(validatedUrl.toString(), {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: {
          "user-agent": "InkadeClipper/1.0 (+https://inkade.local)",
          accept: "text/html,application/xhtml+xml,image/*;q=0.9,*/*;q=0.8",
        },
      });

      if (
        response.status === 301 ||
        response.status === 302 ||
        response.status === 303 ||
        response.status === 307 ||
        response.status === 308
      ) {
        const location = response.headers.get("location");
        if (!location) {
          throw new InkadeError(
            "VALIDATION_ERROR",
            `Redirect response (${response.status}) missing Location header`,
          );
        }
        currentUrl = new URL(location, validatedUrl).toString();
        continue;
      }

      if (!response.ok) {
        throw new InkadeError(
          "VALIDATION_ERROR",
          `Failed to fetch URL (${response.status} ${response.statusText})`,
        );
      }

      const bytes = await readBytesWithLimit(response, maxBytes);
      return { finalUrl: validatedUrl.toString(), response, bytes };
    }

    throw new InkadeError("VALIDATION_ERROR", `Too many redirects (>${MAX_REDIRECTS})`);
  }

  private async sanitizeOptionalMetadataUrl(rawUrl: unknown): Promise<string | undefined> {
    if (typeof rawUrl !== "string" || !rawUrl.trim()) return undefined;
    try {
      const validated = await assertSafeExternalUrl(rawUrl.trim(), this.resolveDns);
      return validated.toString();
    } catch {
      return undefined;
    }
  }

  async lookupByUrl(principal: Principal, rawUrl: string): Promise<ClipLookupResult> {
    const normalizedUrl = normalizeClipUrl(rawUrl);
    if (!normalizedUrl) {
      return {
        found: false,
        normalizedUrl,
        document: null,
        highlights: [],
        threadBindings: [],
      };
    }

    const [allSpaces, clips] = await Promise.all([
      getAllWorkspaceSpaces(this.deps.spacesCache ?? this.deps.spaceRepo, principal.workspaceId),
      this.deps.documentRepo.listDocuments(principal.workspaceId, {
        kind: "clip",
        allowedKinds: principal.scope.allowedKinds,
        tagAllowlist: principal.scope.tagAllowlist,
        includeTrashed: false,
        limit: null,
      }),
    ]);

    const matches = clips
      .filter(
        (doc) =>
          typeof doc.sourceUrl === "string" &&
          doc.sourceUrl.trim().length > 0 &&
          normalizeClipUrl(doc.sourceUrl) === normalizedUrl &&
          evaluateScopeAccess(
            principal.scope,
            "read",
            { spaceId: doc.spaceId, kind: doc.kind, tags: doc.tags },
            allSpaces,
          ).allowed,
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

    const match = matches[0] ?? null;
    if (!match) {
      return {
        found: false,
        normalizedUrl,
        document: null,
        highlights: [],
        threadBindings: [],
      };
    }

    const [highlights, threadBindings] = await Promise.all([
      this.deps.revisionLinkRepo.listDocumentHighlights(principal.workspaceId, match.id),
      this.deps.threadBindingRepo.listThreadBindings(principal.workspaceId, { documentId: match.id }),
    ]);

    return {
      found: true,
      normalizedUrl,
      document: match,
      highlights,
      threadBindings,
    };
  }

  async ingestUrl(
    principal: Principal,
    input: IngestClipUrlInput,
  ): Promise<{ readonly document: DocumentRecord; readonly mirroredImages: number }> {
    const allSpaces = await getAllWorkspaceSpaces(
      this.deps.spacesCache ?? this.deps.spaceRepo,
      principal.workspaceId,
    );
    const targetSpace =
      (input.spaceId ? allSpaces.find((s) => s.id === input.spaceId) : undefined) ??
      allSpaces.find((s) => s.id === DEFAULT_SPACE_IDS.inbox && s.archivedAt === null) ??
      allSpaces.find((s) => s.slug === "inbox" && s.archivedAt === null) ??
      allSpaces.find((s) => s.archivedAt === null);

    if (!targetSpace) {
      throw new InkadeError("NOT_FOUND", "Target space for web clip not found");
    }

    const tags = input.tags ?? [];
    assertScope(
      principal.scope,
      "write",
      { spaceId: targetSpace.id, kind: "clip", tags },
      allSpaces,
    );

    const fetched = await this.safeFetch(input.url, MAX_HTML_BYTES);
    let html = new TextDecoder().decode(fetched.bytes);
    let parsed = parseClipHtml(html, fetched.finalUrl);
    let extractorLabel: string = parsed.extractor;

    // Optional Tier 2 headless SPA fallback via INKADE_CLIPPER_RENDERER
    const tier2Endpoint = process.env.INKADE_CLIPPER_RENDERER?.trim();
    if (tier2Endpoint && parsed.markdown.trim().length < 80) {
      try {
        const t2Res = await this.fetchFn(tier2Endpoint, {
          method: "POST",
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: fetched.finalUrl }),
        });
        if (t2Res.ok) {
          const payload = (await t2Res.json()) as { html?: string; finalUrl?: string };
          if (typeof payload.html === "string" && payload.html.trim().length > 0) {
            html = payload.html;
            parsed = parseClipHtml(html, payload.finalUrl ?? fetched.finalUrl);
            extractorLabel = "tier2-renderer";
          }
        }
      } catch {
        // Keep Tier 1 output if Tier 2 renderer fails
      }
    }

    const rawFavicon = parsed.meta.favicon;
    const rawCoverImage = parsed.meta.image;
    const [safeFaviconUrl, safeExternalCoverUrl] = await Promise.all([
      this.sanitizeOptionalMetadataUrl(rawFavicon),
      this.sanitizeOptionalMetadataUrl(rawCoverImage),
    ]);

    const cleanBaseMeta: Record<string, unknown> = {
      ...parsed.meta,
      extractor: extractorLabel,
      favicon: safeFaviconUrl,
      faviconUrl: safeFaviconUrl,
      image: safeExternalCoverUrl,
      coverImageUrl: safeExternalCoverUrl,
    };

    const finalTitle = input.title?.trim() || parsed.title;
    let doc = await this.deps.documentService.createDocument(principal, {
      spaceId: targetSpace.id,
      kind: "clip",
      title: finalTitle,
      contentMarkdown: parsed.markdown,
      tags,
      sourceUrl: fetched.finalUrl,
      sourceMeta: cleanBaseMeta,
      pinned: false,
    });

    let snapshotAttachmentId: string | undefined;
    if (input.saveHtmlSnapshot !== false && html.length > 0) {
      try {
        const snap = await this.deps.attachmentService.uploadAttachment(principal, {
          documentId: doc.id,
          filename: "snapshot.html",
          mimeType: "text/html; charset=utf-8",
          bytes: new TextEncoder().encode(html),
        });
        snapshotAttachmentId = snap.attachment.id;
      } catch (err) {
        // Non-fatal if snapshot attachment fails
        this.deps.logger?.warn({ err, documentId: doc.id }, "Clip snapshot attachment failed");
      }
    }

    let mirroredImages = 0;
    let updatedMarkdown = parsed.markdown;
    const mirroredReplacements = new Map<string, string>();
    if (input.mirrorImages !== false && updatedMarkdown.includes("![")) {
      const imageMatches = [...updatedMarkdown.matchAll(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g)];
      let processed = 0;

      for (const match of imageMatches) {
        if (processed >= MAX_MIRRORED_IMAGES) break;
        const imgUrl = match[2];
        if (!imgUrl || mirroredReplacements.has(imgUrl)) continue;
        processed++;

        try {
          const imgRes = await this.safeFetch(imgUrl, MAX_IMAGE_BYTES);
          const mimeType =
            imgRes.response.headers.get("content-type")?.split(";")[0]?.trim() ||
            "application/octet-stream";
          if (!mimeType.startsWith("image/")) continue;

          const uploaded = await this.deps.attachmentService.uploadAttachment(principal, {
            documentId: doc.id,
            filename: inferImageFilename(imgRes.finalUrl, mimeType, mirroredImages),
            mimeType,
            bytes: imgRes.bytes,
          });
          mirroredReplacements.set(imgUrl, uploaded.downloadUrl);
          mirroredImages++;
        } catch {
          // Keep original URL if image mirroring fails or is blocked by SSRF
        }
      }

      if (mirroredReplacements.size > 0) {
        for (const [origUrl, localUrl] of mirroredReplacements.entries()) {
          updatedMarkdown = updatedMarkdown.split(origUrl).join(localUrl);
        }
      }
    }

    const mirroredCoverUrl =
      safeExternalCoverUrl && mirroredReplacements.get(safeExternalCoverUrl)
        ? mirroredReplacements.get(safeExternalCoverUrl)
        : safeExternalCoverUrl;

    if (
      updatedMarkdown !== parsed.markdown ||
      snapshotAttachmentId ||
      mirroredCoverUrl !== safeExternalCoverUrl
    ) {
      doc = await this.deps.documentService.updateDocument(principal, doc.id, {
        ...(updatedMarkdown !== parsed.markdown
          ? { contentMarkdown: updatedMarkdown, changeSummary: "Mirrored clip images" }
          : {}),
        sourceMeta: {
          ...cleanBaseMeta,
          image: mirroredCoverUrl,
          coverImageUrl: mirroredCoverUrl,
          ...(snapshotAttachmentId ? { snapshotAttachmentId } : {}),
          mirroredImages,
        },
      });
    }

    return { document: doc, mirroredImages };
  }
}
