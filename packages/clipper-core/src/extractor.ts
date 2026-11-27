import {
  buildHighlightContextFromText,
  DEFAULT_HIGHLIGHT_CONTEXT_CHARS,
  MAX_HIGHLIGHT_CONTEXT_CHARS,
  MAX_HIGHLIGHT_QUOTE_CHARS,
} from "@inkade/core";
import Defuddle, { type DefuddleResponse } from "defuddle/full";
import {
  createInkadeTurndownService,
  htmlToInkadeMarkdown,
  pickBestSrcsetCandidate,
} from "./markdown.ts";
import { cloneDocumentWithFlattenedShadowDom } from "./shadow-dom.ts";

export const DEFAULT_MAX_EXTRACTED_IMAGES = 30;
export {
  buildHighlightContextFromText,
  DEFAULT_HIGHLIGHT_CONTEXT_CHARS,
  MAX_HIGHLIGHT_CONTEXT_CHARS,
  MAX_HIGHLIGHT_QUOTE_CHARS,
};

export interface ExtractedPageMeta {
  readonly domain: string;
  readonly description?: string | undefined;
  readonly author?: string | undefined;
  readonly published?: string | undefined;
  readonly site?: string | undefined;
  readonly favicon?: string | undefined;
  readonly image?: string | undefined;
  readonly language?: string | undefined;
  readonly wordCount?: number | undefined;
  readonly schemaOrgData?: unknown;
  readonly schemaTypes?: readonly string[] | undefined;
}

export interface ExtractedArticle {
  readonly url: string;
  readonly title: string;
  readonly markdown: string;
  readonly excerpt: string;
  readonly htmlSnapshot: string;
  readonly cleanHtml: string;
  readonly imageUrls: readonly string[];
  readonly meta: ExtractedPageMeta;
  readonly variables: Readonly<Record<string, string>>;
  readonly extractor: string;
}

export interface ExtractedHighlightAnchor {
  readonly url: string;
  readonly title: string;
  readonly quote: string;
  readonly prefixContext: string;
  readonly suffixContext: string;
}

export interface PageExtractionBundle {
  readonly article: ExtractedArticle;
  readonly selection: ExtractedHighlightAnchor | null;
  readonly selectionMarkdown?: string | undefined;
}

export type ClipperFetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface ExtractArticleOptions {
  readonly fetchFn?: ClipperFetchLike | undefined;
  readonly language?: string | undefined;
  readonly contentSelector?: string | undefined;
  readonly useAsync?: boolean | undefined;
  readonly pointerTargetElement?: Element | null | undefined;
  readonly adapterOverride?: SiteAdapterExecutor | undefined;
}

export interface SiteAdapterExecutionContext {
  readonly pointerTargetElement?: Element | null | undefined;
  readonly fetchFn?: ClipperFetchLike | undefined;
}

export interface SiteAdapterResult {
  readonly id: string;
  readonly title?: string | undefined;
  readonly author?: string | undefined;
  readonly published?: string | undefined;
  readonly site?: string | undefined;
  readonly description?: string | undefined;
  readonly image?: string | undefined;
  readonly contentHtml?: string | undefined;
  readonly markdown?: string | undefined;
  readonly imageUrls?: readonly string[] | undefined;
  readonly variables?: Readonly<Record<string, string>> | undefined;
}

export type SiteAdapterExecutor = (
  doc: Document,
  pageUrl: string,
  ctx: SiteAdapterExecutionContext,
) => Promise<SiteAdapterResult | null> | SiteAdapterResult | null;

let registeredSiteAdapterRunner: SiteAdapterExecutor | null = null;

export function registerSiteAdapterRunner(runner: SiteAdapterExecutor | null): void {
  registeredSiteAdapterRunner = runner;
}

function safeDomain(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return "";
  }
}

export function resolveAbsoluteHttpUrl(
  rawSrc: string | null | undefined,
  baseUrl: string,
): string | null {
  if (!rawSrc) return null;
  const trimmed = rawSrc.trim();
  if (!trimmed || trimmed.startsWith("data:") || trimmed.startsWith("javascript:")) {
    return null;
  }
  try {
    const resolved = new URL(trimmed, baseUrl);
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
      return null;
    }
    return resolved.toString();
  } catch {
    return null;
  }
}

/**
 * Extracts deduplicated http/https image URLs from an HTML fragment or document element,
 * resolving relative paths and lazy-loaded attributes.
 */
export function collectImageUrlsFromDocument(
  root: ParentNode,
  baseUrl: string,
  limit = DEFAULT_MAX_EXTRACTED_IMAGES,
): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  const images = root.querySelectorAll("img");
  for (const img of images) {
    if (urls.length >= limit) break;
    const candidate =
      img.getAttribute("data-original") ??
      img.getAttribute("data-actualsrc") ??
      img.getAttribute("data-src") ??
      pickBestSrcsetCandidate(img.getAttribute("srcset")) ??
      img.getAttribute("src");
    const resolved = resolveAbsoluteHttpUrl(candidate, baseUrl);
    if (resolved && !seen.has(resolved)) {
      seen.add(resolved);
      urls.push(resolved);
    }
  }
  return urls;
}

/**
 * Extracts deduplicated http/https image URLs embedded in Markdown image syntax.
 */
export function collectImageUrlsFromMarkdown(
  markdown: string,
  baseUrl: string,
  limit = DEFAULT_MAX_EXTRACTED_IMAGES,
): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  const regex = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  for (const match of markdown.matchAll(regex)) {
    if (urls.length >= limit) break;
    const resolved = resolveAbsoluteHttpUrl(match[1], baseUrl);
    if (resolved && !seen.has(resolved)) {
      seen.add(resolved);
      urls.push(resolved);
    }
  }
  return urls;
}

export function extractSchemaTypes(schemaOrgData: unknown): string[] {
  const types = new Set<string>();
  const visit = (node: unknown) => {
    if (!node) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (typeof node === "object") {
      const record = node as Record<string, unknown>;
      const rawType = record["@type"];
      if (typeof rawType === "string" && rawType.trim()) {
        types.add(rawType.trim());
      } else if (Array.isArray(rawType)) {
        for (const t of rawType) {
          if (typeof t === "string" && t.trim()) types.add(t.trim());
        }
      }
      for (const val of Object.values(record)) {
        if (val && typeof val === "object") visit(val);
      }
    }
  };
  visit(schemaOrgData);
  return [...types];
}

function readSchemaOrgFromDom(doc: Document): unknown[] {
  const blocks: unknown[] = [];
  for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
    const raw = script.textContent?.trim();
    if (!raw) continue;
    try {
      blocks.push(JSON.parse(raw));
    } catch {
      // ignore invalid ld+json blocks
    }
  }
  return blocks;
}

function readDomMediaHints(doc: Document, pageUrl: string): {
  readonly favicon?: string | undefined;
  readonly image?: string | undefined;
} {
  const rawFavicon =
    doc.querySelector('link[rel~="icon"]')?.getAttribute("href") ??
    doc.querySelector('link[rel="shortcut icon"]')?.getAttribute("href") ??
    doc.querySelector('link[rel="apple-touch-icon"]')?.getAttribute("href") ??
    undefined;
  const rawCoverImage =
    doc.querySelector('meta[property="og:image"]')?.getAttribute("content") ??
    doc.querySelector('meta[name="twitter:image"]')?.getAttribute("content") ??
    doc.querySelector('meta[property="twitter:image"]')?.getAttribute("content") ??
    undefined;

  const favicon = resolveAbsoluteHttpUrl(rawFavicon, pageUrl) ?? undefined;
  const image = resolveAbsoluteHttpUrl(rawCoverImage, pageUrl) ?? undefined;
  return { favicon, image };
}

function buildExcerpt(markdown: string, description?: string): string {
  const plain = markdown
    .replace(/^#+\s+/gm, "")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[`*_>#~-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const source = plain || description?.trim() || "";
  return source.length > 220 ? `${source.slice(0, 217)}…` : source;
}

export function countArticleWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  const cjkChars = (trimmed.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const latinWords = trimmed
    .replace(/[\u4e00-\u9fff]/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;
  return cjkChars + latinWords;
}

export function absolutizeRelativeMarkdownUrls(markdown: string, baseUrl: string): string {
  return markdown.replace(
    /!\[([^\]]*)\]\(([^)\s]+)(\s+"[^"]*")?\)/g,
    (full, alt: string, rawHref: string, titleSuffix: string | undefined) => {
      const resolved = resolveAbsoluteHttpUrl(rawHref, baseUrl);
      if (!resolved) return full;
      return `![${alt}](${resolved}${titleSuffix ?? ""})`;
    },
  );
}

function resolveDefuddleConstructor(): typeof Defuddle {
  const mod = Defuddle as unknown as { default?: typeof Defuddle };
  return typeof mod?.default === "function" ? mod.default : Defuddle;
}

function finalizeExtractedArticle(params: {
  doc: Document;
  pageUrl: string;
  title: string;
  markdown: string;
  cleanHtml: string;
  extractor: string;
  meta: ExtractedPageMeta;
  extraImages?: readonly string[] | undefined;
  variables?: Readonly<Record<string, string>> | undefined;
}): ExtractedArticle {
  const { doc, pageUrl } = params;
  const domain = safeDomain(pageUrl);
  const absolutizedMd = absolutizeRelativeMarkdownUrls(params.markdown, pageUrl).trim();

  const mdImages = collectImageUrlsFromMarkdown(absolutizedMd, pageUrl);
  const domImages = collectImageUrlsFromDocument(doc, pageUrl);
  const extraResolved = (params.extraImages ?? [])
    .map((u) => resolveAbsoluteHttpUrl(u, pageUrl))
    .filter((u): u is string => Boolean(u));
  const mergedImages = [...new Set([...extraResolved, ...mdImages, ...domImages])].slice(
    0,
    DEFAULT_MAX_EXTRACTED_IMAGES,
  );

  const wordCount = params.meta.wordCount ?? countArticleWords(absolutizedMd);
  const finalMeta: ExtractedPageMeta = {
    ...params.meta,
    domain: params.meta.domain || domain,
    wordCount,
  };

  return {
    url: pageUrl,
    title: params.title || domain || pageUrl,
    markdown: absolutizedMd,
    excerpt: buildExcerpt(absolutizedMd, finalMeta.description),
    htmlSnapshot: doc.documentElement?.outerHTML ?? "",
    cleanHtml: params.cleanHtml,
    imageUrls: mergedImages,
    meta: finalMeta,
    variables: params.variables ?? {},
    extractor: params.extractor,
  };
}

function extractFallbackFromBody(
  doc: Document,
  baseMeta: ExtractedPageMeta,
): { readonly markdown: string; readonly cleanHtml: string; readonly description?: string } {
  const td = createInkadeTurndownService();
  const metaDesc =
    doc.querySelector('meta[name="description"]')?.getAttribute("content")?.trim() ??
    doc.querySelector('meta[property="og:description"]')?.getAttribute("content")?.trim() ??
    "";

  const bodyClone = doc.body?.cloneNode(true) as Element | undefined;
  if (!bodyClone) {
    return {
      markdown: metaDesc,
      cleanHtml: metaDesc ? `<p>${metaDesc}</p>` : "",
      ...(metaDesc ? { description: metaDesc } : {}),
    };
  }

  for (const el of bodyClone.querySelectorAll(
    "script, style, noscript, nav, footer, aside, #inkade-clipper-root",
  )) {
    el.remove();
  }
  const cleanHtml = bodyClone.innerHTML ?? "";
  const bodyMd = td.turndown(cleanHtml).trim();
  return {
    markdown: bodyMd || metaDesc || "",
    cleanHtml,
    ...(metaDesc && !baseMeta.description ? { description: metaDesc } : {}),
  };
}

function buildDefuddleInstance(
  clonedDoc: Document,
  pageUrl: string,
  options?: ExtractArticleOptions,
): Defuddle {
  const DefuddleCtor = resolveDefuddleConstructor();
  return new DefuddleCtor(clonedDoc, {
    url: pageUrl,
    markdown: false,
    separateMarkdown: false,
    useAsync: options?.useAsync ?? Boolean(options?.fetchFn),
    includeReplies: "extractors",
    ...(options?.fetchFn ? { fetch: options.fetchFn as typeof globalThis.fetch } : {}),
    ...(options?.language ? { language: options.language } : {}),
    ...(options?.contentSelector ? { contentSelector: options.contentSelector } : {}),
  });
}

function finalizeDefuddleOutcome(params: {
  doc: Document;
  clonedDoc: Document;
  pageUrl: string;
  domSchemas: readonly unknown[];
  domMedia: { readonly favicon?: string | undefined; readonly image?: string | undefined };
  parsed: DefuddleResponse | null;
}): ExtractedArticle {
  const { doc, clonedDoc, pageUrl, domSchemas, domMedia, parsed } = params;
  const domain = safeDomain(pageUrl);
  const ogTitle =
    doc.querySelector('meta[property="og:title"]')?.getAttribute("content")?.trim() ?? "";
  const docTitle = doc.querySelector("title")?.textContent?.trim() ?? "";

  let defuddleTitle = "";
  let defuddleHtml = "";
  let defuddleMd = "";
  let extractor = parsed ? "defuddle-full" : "fallback";
  let variables: Record<string, string> = {};
  let meta: ExtractedPageMeta = {
    domain,
    ...(domMedia.favicon ? { favicon: domMedia.favicon } : {}),
    ...(domMedia.image ? { image: domMedia.image } : {}),
    ...(domSchemas.length > 0
      ? { schemaOrgData: domSchemas, schemaTypes: extractSchemaTypes(domSchemas) }
      : {}),
  };

  if (parsed) {
    defuddleTitle = parsed.title?.trim() ?? "";
    defuddleHtml = parsed.content?.trim() ?? "";
    defuddleMd = parsed.contentMarkdown?.trim() ?? "";
    if (parsed.extractorType) {
      extractor = `defuddle:${parsed.extractorType}`;
    }
    if (parsed.variables) {
      variables = parsed.variables;
    }
    const rawSchemaOrg = (parsed as { schemaOrgData?: unknown }).schemaOrgData;
    const schemaData = rawSchemaOrg ?? (domSchemas.length > 0 ? domSchemas : undefined);
    const resolvedFavicon = resolveAbsoluteHttpUrl(parsed.favicon, pageUrl) ?? domMedia.favicon;
    const resolvedImage = resolveAbsoluteHttpUrl(parsed.image, pageUrl) ?? domMedia.image;

    meta = {
      domain: parsed.domain || domain,
      ...(parsed.description ? { description: parsed.description } : {}),
      ...(parsed.author ? { author: parsed.author } : {}),
      ...(parsed.published ? { published: parsed.published } : {}),
      ...(parsed.site ? { site: parsed.site } : {}),
      ...(resolvedFavicon ? { favicon: resolvedFavicon } : {}),
      ...(resolvedImage ? { image: resolvedImage } : {}),
      ...(parsed.language ? { language: parsed.language } : {}),
      ...(parsed.wordCount ? { wordCount: parsed.wordCount } : {}),
      ...(schemaData ? { schemaOrgData: schemaData, schemaTypes: extractSchemaTypes(schemaData) } : {}),
    };
  }

  const td = createInkadeTurndownService();
  let markdown = defuddleHtml ? td.turndown(defuddleHtml).trim() : defuddleMd;
  let cleanHtml = defuddleHtml;

  if (!markdown) {
    extractor = "fallback";
    const fallback = extractFallbackFromBody(clonedDoc, meta);
    markdown = fallback.markdown;
    cleanHtml = fallback.cleanHtml;
    if (fallback.description) {
      meta = { ...meta, description: fallback.description };
    }
  }

  return finalizeExtractedArticle({
    doc,
    pageUrl,
    title: defuddleTitle || ogTitle || docTitle || domain || pageUrl,
    markdown,
    cleanHtml,
    extractor,
    meta,
    variables,
  });
}

/**
 * Synchronous article extraction using Shadow DOM flattening + defuddle/full + GFM Turndown.
 */
export function extractArticleFromDocument(
  doc: Document,
  pageUrl: string,
  options?: ExtractArticleOptions,
): ExtractedArticle {
  const clonedDoc = cloneDocumentWithFlattenedShadowDom(doc);
  const domSchemas = readSchemaOrgFromDom(doc);
  const domMedia = readDomMediaHints(doc, pageUrl);
  let parsed: DefuddleResponse | null = null;
  try {
    const defuddle = buildDefuddleInstance(clonedDoc, pageUrl, { ...options, useAsync: false });
    parsed = defuddle.parse();
  } catch {
    parsed = null;
  }

  return finalizeDefuddleOutcome({
    doc,
    clonedDoc,
    pageUrl,
    domSchemas,
    domMedia,
    parsed,
  });
}

/**
 * Full async article extraction pipeline:
 * 1) Dedicated SiteAdapter (if registered & matched)
 * 2) Shadow DOM flattened `defuddle/full` `parseAsync()` (26 built-in site extractors)
 * 3) Clean body fallback.
 */
export async function extractArticleFromDocumentAsync(
  doc: Document,
  pageUrl: string,
  options?: ExtractArticleOptions,
): Promise<ExtractedArticle> {
  const domain = safeDomain(pageUrl);
  const ogTitle =
    doc.querySelector('meta[property="og:title"]')?.getAttribute("content")?.trim() ?? "";
  const docTitle = doc.querySelector("title")?.textContent?.trim() ?? "";
  const domSchemas = readSchemaOrgFromDom(doc);
  const domMedia = readDomMediaHints(doc, pageUrl);

  const adapterRunner = options?.adapterOverride ?? registeredSiteAdapterRunner;
  if (adapterRunner && !options?.contentSelector) {
    try {
      const adapterResult = await adapterRunner(doc, pageUrl, {
        pointerTargetElement: options?.pointerTargetElement,
        fetchFn: options?.fetchFn,
      });
      if (adapterResult && (adapterResult.markdown?.trim() || adapterResult.contentHtml?.trim())) {
        const cleanHtml = adapterResult.contentHtml?.trim() ?? "";
        const markdown =
          adapterResult.markdown?.trim() ||
          (cleanHtml ? htmlToInkadeMarkdown(cleanHtml) : "");
        if (markdown) {
          const resolvedAdapterImage =
            resolveAbsoluteHttpUrl(adapterResult.image, pageUrl) ?? domMedia.image;
          const meta: ExtractedPageMeta = {
            domain,
            ...(adapterResult.description ? { description: adapterResult.description } : {}),
            ...(adapterResult.author ? { author: adapterResult.author } : {}),
            ...(adapterResult.published ? { published: adapterResult.published } : {}),
            ...(adapterResult.site ? { site: adapterResult.site } : {}),
            ...(domMedia.favicon ? { favicon: domMedia.favicon } : {}),
            ...(resolvedAdapterImage ? { image: resolvedAdapterImage } : {}),
            ...(domSchemas.length > 0
              ? { schemaOrgData: domSchemas, schemaTypes: extractSchemaTypes(domSchemas) }
              : {}),
          };
          return finalizeExtractedArticle({
            doc,
            pageUrl,
            title: adapterResult.title?.trim() || ogTitle || docTitle || domain || pageUrl,
            markdown,
            cleanHtml,
            extractor: `adapter:${adapterResult.id}`,
            meta,
            extraImages: adapterResult.imageUrls,
            variables: adapterResult.variables,
          });
        }
      }
    } catch {
      // Fall through cleanly to defuddle/full
    }
  }

  const clonedDoc = cloneDocumentWithFlattenedShadowDom(doc);
  let parsed: DefuddleResponse | null = null;
  try {
    const defuddle = buildDefuddleInstance(clonedDoc, pageUrl, options);
    parsed = await defuddle.parseAsync();
  } catch {
    parsed = null;
  }

  return finalizeDefuddleOutcome({
    doc,
    clonedDoc,
    pageUrl,
    domSchemas,
    domMedia,
    parsed,
  });
}

/**
 * Extracts clean Markdown & metadata from a single chosen DOM region (used by RegionPicker).
 */
export function extractRegionFromElement(element: Element, pageUrl: string): ExtractedArticle {
  const doc = element.ownerDocument;
  const clone = element.cloneNode(true) as Element;
  for (const el of clone.querySelectorAll("script, style, noscript, #inkade-clipper-root")) {
    el.remove();
  }
  const td = createInkadeTurndownService();
  const cleanHtml = clone.outerHTML ?? clone.innerHTML ?? "";
  const markdown = absolutizeRelativeMarkdownUrls(td.turndown(cleanHtml).trim(), pageUrl);
  const heading =
    clone.querySelector("h1, h2, h3")?.textContent?.trim() ??
    doc.querySelector("title")?.textContent?.trim() ??
    safeDomain(pageUrl);

  const imageUrls = [
    ...new Set([
      ...collectImageUrlsFromMarkdown(markdown, pageUrl),
      ...collectImageUrlsFromDocument(clone, pageUrl),
    ]),
  ].slice(0, DEFAULT_MAX_EXTRACTED_IMAGES);

  return {
    url: pageUrl,
    title: heading || pageUrl,
    markdown,
    excerpt: buildExcerpt(markdown),
    htmlSnapshot: cleanHtml,
    cleanHtml,
    imageUrls,
    meta: {
      domain: safeDomain(pageUrl),
      wordCount: countArticleWords(markdown),
    },
    variables: {},
    extractor: "region-picker",
  };
}

/**
 * Extracts Markdown from the current DOM selection if non-empty.
 */
export function extractSelectionMarkdown(
  doc: Document,
  pageUrl: string,
  selectionOverride?: Selection | null,
): string {
  const selection = selectionOverride ?? doc.defaultView?.getSelection?.() ?? null;
  if (!selection || selection.rangeCount === 0) {
    return selection?.toString().trim() ?? "";
  }
  try {
    const container = doc.createElement("div");
    for (let i = 0; i < selection.rangeCount; i++) {
      container.appendChild(selection.getRangeAt(i).cloneContents());
    }
    const md = htmlToInkadeMarkdown(container.innerHTML);
    return absolutizeRelativeMarkdownUrls(md || selection.toString().trim(), pageUrl);
  } catch {
    return selection.toString().trim();
  }
}

/**
 * Extracts a W3C TextQuoteSelector-compatible highlight anchor from the current DOM Selection.
 */
export function extractSelectionHighlightAnchor(
  doc: Document,
  options?: {
    readonly pageUrl?: string | undefined;
    readonly title?: string | undefined;
    readonly selection?: Selection | null | undefined;
    readonly rootNode?: Node | null | undefined;
    readonly contextLength?: number | undefined;
  },
): ExtractedHighlightAnchor | null {
  const selection = options?.selection ?? doc.defaultView?.getSelection?.() ?? null;
  if (!selection) return null;

  const rawQuote = selection.toString();
  const quote = rawQuote.trim().slice(0, MAX_HIGHLIGHT_QUOTE_CHARS);
  if (!quote) return null;

  const contextLen = Math.max(
    0,
    Math.min(options?.contextLength ?? DEFAULT_HIGHLIGHT_CONTEXT_CHARS, MAX_HIGHLIGHT_CONTEXT_CHARS),
  );

  let prefixContext = "";
  let suffixContext = "";
  const scopeRoot = options?.rootNode ?? doc.body ?? null;

  if (selection.rangeCount > 0 && scopeRoot) {
    try {
      const range = selection.getRangeAt(0);
      const beforeRange = doc.createRange();
      beforeRange.selectNodeContents(scopeRoot);
      beforeRange.setEnd(range.startContainer, range.startOffset);
      const beforeText = beforeRange.toString();
      prefixContext = beforeText.slice(Math.max(0, beforeText.length - contextLen));

      const afterRange = doc.createRange();
      afterRange.selectNodeContents(scopeRoot);
      afterRange.setStart(range.endContainer, range.endOffset);
      const afterText = afterRange.toString();
      suffixContext = afterText.slice(0, contextLen);
    } catch {
      const fallback = buildHighlightContextFromText(
        scopeRoot.textContent ?? "",
        quote,
        undefined,
        contextLen,
      );
      if (fallback) {
        prefixContext = fallback.prefixContext;
        suffixContext = fallback.suffixContext;
      }
    }
  } else {
    const fallback = buildHighlightContextFromText(
      scopeRoot?.textContent ?? doc.body?.textContent ?? "",
      quote,
      undefined,
      contextLen,
    );
    if (fallback) {
      prefixContext = fallback.prefixContext;
      suffixContext = fallback.suffixContext;
    }
  }

  const url = options?.pageUrl ?? doc.location?.href ?? "";
  const title =
    options?.title ??
    doc.querySelector("title")?.textContent?.trim() ??
    safeDomain(url) ??
    "";

  return {
    url,
    title,
    quote,
    prefixContext,
    suffixContext,
  };
}
