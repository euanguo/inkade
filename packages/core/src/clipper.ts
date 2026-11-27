import { z } from "zod";
import { matchGlob } from "./glob.ts";
import { spaceIdSchema } from "./ids.ts";
import type {
  AdeThreadBinding,
  DocumentHighlight,
  DocumentRecord,
  DocumentTemplate,
} from "./types/index.ts";

export const DEFAULT_HIGHLIGHT_CONTEXT_CHARS = 64;
export const MAX_HIGHLIGHT_QUOTE_CHARS = 4000;
export const MAX_HIGHLIGHT_CONTEXT_CHARS = 1000;

const TRACKING_QUERY_PARAMS = new Set([
  "fbclid",
  "gclid",
  "dclid",
  "gbraid",
  "wbraid",
  "msclkid",
  "mc_cid",
  "mc_eid",
  "igshid",
  "igsh",
  "ref_src",
  "ref_url",
  "spm",
  "spm_id_from",
  "vd_source",
  "share_source",
  "share_medium",
  "share_plat",
  "share_from",
  "share_tag",
  "chksm",
  "poc_token",
  "from_source",
  "nsukey",
  "mpshare",
  "srcid",
  "_hsenc",
  "_hsmi",
  "vero_id",
  "yclid",
]);

const WECHAT_TRACKING_PARAMS = new Set([
  "chksm",
  "scene",
  "ascene",
  "clicktime",
  "enterid",
  "pass_ticket",
  "exportkey",
  "devicetype",
  "abtest_cookie",
  "subscene",
  "sessionid",
]);

function isTrackingParam(key: string, hostname: string): boolean {
  const lower = key.toLowerCase();
  if (lower.startsWith("utm_")) return true;
  if (TRACKING_QUERY_PARAMS.has(lower)) return true;
  if (hostname === "mp.weixin.qq.com" && WECHAT_TRACKING_PARAMS.has(lower)) return true;
  return false;
}

/**
 * Normalizes a web URL for stable clip deduplication and lookup across extension, web, and server.
 */
export function normalizeClipUrl(
  rawUrl: string,
  options?: { readonly stripTrackingParams?: boolean | undefined },
): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return "";

  const stripTracking = options?.stripTrackingParams ?? true;
  try {
    const parsed = new URL(trimmed);
    const protocol = parsed.protocol.toLowerCase();
    const hostname = parsed.hostname.toLowerCase();
    let port = parsed.port;
    if ((protocol === "http:" && port === "80") || (protocol === "https:" && port === "443")) {
      port = "";
    }
    const host = port ? `${hostname}:${port}` : hostname;

    const pathname = parsed.pathname.replace(/\/+$/, "") || "/";

    const entries: Array<[string, string]> = [];
    for (const [k, v] of parsed.searchParams.entries()) {
      if (stripTracking && isTrackingParam(k, hostname)) {
        continue;
      }
      entries.push([k, v]);
    }
    entries.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));

    const searchParams = new URLSearchParams();
    for (const [k, v] of entries) {
      searchParams.append(k, v);
    }
    const qs = searchParams.toString();
    return `${protocol}//${host}${pathname}${qs ? `?${qs}` : ""}`;
  } catch {
    return trimmed;
  }
}

export interface AnchorMatchResult {
  readonly start: number;
  readonly end: number;
  readonly exact: boolean;
}

export interface AnchorSpec {
  readonly quote: string;
  readonly prefixContext?: string | undefined;
  readonly suffixContext?: string | undefined;
}

function scoreContextSimilarity(
  text: string,
  matchStart: number,
  matchEnd: number,
  prefixContext: string,
  suffixContext: string,
): number {
  let score = 0;
  if (prefixContext) {
    const windowBefore = text.slice(Math.max(0, matchStart - prefixContext.length), matchStart);
    const minLen = Math.min(windowBefore.length, prefixContext.length);
    for (let k = 1; k <= minLen; k++) {
      if (windowBefore[windowBefore.length - k] === prefixContext[prefixContext.length - k]) {
        score += 2;
      } else {
        break;
      }
    }
  }
  if (suffixContext) {
    const windowAfter = text.slice(matchEnd, matchEnd + suffixContext.length);
    const minLen = Math.min(windowAfter.length, suffixContext.length);
    for (let k = 0; k < minLen; k++) {
      if (windowAfter[k] === suffixContext[k]) {
        score += 2;
      } else {
        break;
      }
    }
  }
  return score;
}

function buildNormalizedTextIndex(text: string): {
  readonly normalized: string;
  readonly origStarts: readonly number[];
  readonly origEnds: readonly number[];
} {
  let normalized = "";
  const origStarts: number[] = [];
  const origEnds: number[] = [];
  let inSpace = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i] ?? "";
    if (/\s/.test(ch)) {
      if (!inSpace && normalized.length > 0) {
        normalized += " ";
        origStarts.push(i);
        origEnds.push(i + 1);
        inSpace = true;
      } else if (inSpace && origEnds.length > 0) {
        origEnds[origEnds.length - 1] = i + 1;
      }
    } else {
      normalized += ch;
      origStarts.push(i);
      origEnds.push(i + 1);
      inSpace = false;
    }
  }

  return { normalized, origStarts, origEnds };
}

/**
 * Strips common inline Markdown punctuation (backticks, emphasis, strikethrough,
 * highlights, links, wikilinks) while leaving snake_case underscores untouched.
 */
function stripInlineMarkdownFormatting(raw: string): string {
  return raw
    .replace(/\[\[[^|\]]+\|([^\]]+)\]\]/g, "$1")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\[([^\]\n]+)\]\([^)\n]+\)/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/==([^=\n]+)==/g, "$1")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/__([^_\n]+)__/g, "$1")
    .replace(/~~([^~\n]+)~~/g, "$1")
    .replace(/(^|[^\w])\*([^*\n]+)\*(?=[^\w]|$)/g, "$1$2")
    .replace(/(^|[^\w])_([^_\n]+)_(?=[^\w]|$)/g, "$1$2");
}

function findFuzzyRangeInNormalizedIndex(
  normalizedLower: string,
  origStarts: readonly number[],
  origEnds: readonly number[],
  candidateLower: string,
  prefixLower: string,
  suffixLower: string,
): AnchorMatchResult | null {
  if (!candidateLower) return null;
  const fuzzyMatches: number[] = [];
  let fIdx = normalizedLower.indexOf(candidateLower);
  while (fIdx !== -1) {
    fuzzyMatches.push(fIdx);
    fIdx = normalizedLower.indexOf(candidateLower, fIdx + Math.max(1, candidateLower.length));
  }
  if (fuzzyMatches.length === 0) return null;

  let bestNormStart = fuzzyMatches[0]!;
  let bestScore = -1;
  for (const normStart of fuzzyMatches) {
    const score = scoreContextSimilarity(
      normalizedLower,
      normStart,
      normStart + candidateLower.length,
      prefixLower,
      suffixLower,
    );
    if (score > bestScore) {
      bestScore = score;
      bestNormStart = normStart;
    }
  }
  const start = origStarts[bestNormStart] ?? 0;
  const endIdx = bestNormStart + candidateLower.length - 1;
  const end = origEnds[endIdx] ?? start + candidateLower.length;
  return { start, end, exact: false };
}

/**
 * Builds a normalized index on raw Markdown `text` by omitting inline Markdown
 * delimiters (`**`, `__`, `` ` ``, `==`, `~~`, and `[...](url)` URL suffixes)
 * so plain DOM quotes can still locate exact character offsets in raw Markdown.
 */
function buildMarkdownStrippedIndex(text: string): {
  readonly normalized: string;
  readonly origStarts: readonly number[];
  readonly origEnds: readonly number[];
} {
  let normalized = "";
  const origStarts: number[] = [];
  const origEnds: number[] = [];
  let prevSpace = false;
  let i = 0;

  while (i < text.length) {
    const two = text.slice(i, i + 2);
    if (two === "**" || two === "__" || two === "==" || two === "~~" || two === "[[" || two === "]]") {
      i += 2;
      continue;
    }
    const ch = text[i]!;
    if (ch === "`") {
      i += 1;
      continue;
    }
    if (ch === "]" && text[i + 1] === "(") {
      const closeParen = text.indexOf(")", i + 2);
      const newline = text.indexOf("\n", i + 2);
      if (closeParen !== -1 && (newline === -1 || closeParen < newline)) {
        i = closeParen + 1;
        continue;
      }
    }
    if (ch === "[" && text.indexOf("](", i + 1) !== -1) {
      const nl = text.indexOf("\n", i + 1);
      const linkSep = text.indexOf("](", i + 1);
      if (nl === -1 || linkSep < nl) {
        i += 1;
        continue;
      }
    }
    if (/\s/.test(ch)) {
      if (!prevSpace && normalized.length > 0) {
        normalized += " ";
        origStarts.push(i);
        origEnds.push(i + 1);
        prevSpace = true;
      }
      i += 1;
      continue;
    }
    prevSpace = false;
    normalized += ch;
    origStarts.push(i);
    origEnds.push(i + 1);
    i += 1;
  }

  return { normalized, origStarts, origEnds };
}

/**
 * Triple-context fuzzy anchor matcher (`quote`, `prefixContext`, `suffixContext`)
 * mapping persisted W3C TextQuoteSelector highlights or ADE `selectionAnchor`s onto document text.
 */
export function matchHighlightAnchor(text: string, anchor: AnchorSpec): AnchorMatchResult | null {
  const quote = anchor.quote.trim();
  if (!text || !quote) return null;

  const prefix = anchor.prefixContext ?? "";
  const suffix = anchor.suffixContext ?? "";

  // 1. Exact occurrence search, disambiguated by prefix/suffix similarity
  const exactMatches: number[] = [];
  let idx = text.indexOf(quote);
  while (idx !== -1) {
    exactMatches.push(idx);
    idx = text.indexOf(quote, idx + Math.max(1, quote.length));
  }

  if (exactMatches.length === 1) {
    const start = exactMatches[0]!;
    return { start, end: start + quote.length, exact: true };
  }
  if (exactMatches.length > 1) {
    let bestStart = exactMatches[0]!;
    let bestScore = -1;
    for (const start of exactMatches) {
      const score = scoreContextSimilarity(text, start, start + quote.length, prefix, suffix);
      if (score > bestScore) {
        bestScore = score;
        bestStart = start;
      }
    }
    return { start: bestStart, end: bestStart + quote.length, exact: true };
  }

  // 2. Whitespace-collapsed & case-insensitive match mapped back to original offsets
  const { normalized, origStarts, origEnds } = buildNormalizedTextIndex(text);
  const normQuote = quote.replace(/\s+/g, " ");
  const normLower = normalized.toLowerCase();
  const quoteLower = normQuote.toLowerCase();
  const normPrefixLower = prefix.replace(/\s+/g, " ").toLowerCase();
  const normSuffixLower = suffix.replace(/\s+/g, " ").toLowerCase();

  const directFuzzy = findFuzzyRangeInNormalizedIndex(
    normLower,
    origStarts,
    origEnds,
    quoteLower,
    normPrefixLower,
    normSuffixLower,
  );
  if (directFuzzy) {
    return directFuzzy;
  }

  // 2.5 Inline Markdown-stripped fallback (covers Markdown quotes matched against DOM plain text & vice versa)
  const strippedQuoteLower = stripInlineMarkdownFormatting(quote).replace(/\s+/g, " ").trim().toLowerCase();
  const strippedPrefixLower = stripInlineMarkdownFormatting(prefix).replace(/\s+/g, " ").trim().toLowerCase();
  const strippedSuffixLower = stripInlineMarkdownFormatting(suffix).replace(/\s+/g, " ").trim().toLowerCase();

  if (strippedQuoteLower && strippedQuoteLower !== quoteLower) {
    const strippedMatch = findFuzzyRangeInNormalizedIndex(
      normLower,
      origStarts,
      origEnds,
      strippedQuoteLower,
      strippedPrefixLower,
      strippedSuffixLower,
    );
    if (strippedMatch) {
      return strippedMatch;
    }
  }

  if (/[`*_=~\[\]]/.test(text)) {
    const mdIdx = buildMarkdownStrippedIndex(text);
    const mdNormLower = mdIdx.normalized.toLowerCase();
    const mdMatch = findFuzzyRangeInNormalizedIndex(
      mdNormLower,
      mdIdx.origStarts,
      mdIdx.origEnds,
      strippedQuoteLower || quoteLower,
      strippedPrefixLower,
      strippedSuffixLower,
    );
    if (mdMatch) {
      return mdMatch;
    }
  }

  // 3. Partial anchor fallback when paragraph edges were slightly edited
  const effectivePartialQuote =
    quoteLower.length >= 24 ? quoteLower : strippedQuoteLower.length >= 24 ? strippedQuoteLower : "";
  if (effectivePartialQuote.length >= 24) {
    const head = effectivePartialQuote.slice(
      0,
      Math.min(28, Math.floor(effectivePartialQuote.length * 0.55)),
    );
    const headIdx = normLower.indexOf(head);
    if (headIdx !== -1) {
      const start = origStarts[headIdx] ?? 0;
      const end = origEnds[Math.min(origEnds.length - 1, headIdx + head.length - 1)] ?? start;
      return { start, end, exact: false };
    }
  }

  return null;
}

/**
 * Computes W3C-style prefixContext / quote / suffixContext around a quote within fullText.
 */
export function buildHighlightContextFromText(
  fullText: string,
  rawQuote: string,
  startOffset?: number,
  contextLength = DEFAULT_HIGHLIGHT_CONTEXT_CHARS,
): {
  readonly quote: string;
  readonly prefixContext: string;
  readonly suffixContext: string;
} | null {
  const quote = rawQuote.trim().slice(0, MAX_HIGHLIGHT_QUOTE_CHARS);
  if (!quote) return null;

  const clampedContext = Math.max(0, Math.min(contextLength, MAX_HIGHLIGHT_CONTEXT_CHARS));
  const idx =
    typeof startOffset === "number" && startOffset >= 0
      ? startOffset
      : fullText.indexOf(quote);

  if (idx < 0) {
    return {
      quote,
      prefixContext: "",
      suffixContext: "",
    };
  }

  const prefixStart = Math.max(0, idx - clampedContext);
  const suffixEnd = Math.min(fullText.length, idx + quote.length + clampedContext);
  return {
    quote,
    prefixContext: fullText.slice(prefixStart, idx),
    suffixContext: fullText.slice(idx + quote.length, suffixEnd),
  };
}

// --- Clipper Templates & Lookup Contracts ---

export const CLIPPER_TRIGGER_TYPES = ["url-prefix", "glob", "regex", "schema-type"] as const;
export type ClipperTriggerType = (typeof CLIPPER_TRIGGER_TYPES)[number];
export const clipperTriggerTypeSchema = z.enum(CLIPPER_TRIGGER_TYPES);

export const CLIPPER_PROPERTY_TYPES = ["text", "number", "boolean", "list", "date"] as const;
export type ClipperPropertyType = (typeof CLIPPER_PROPERTY_TYPES)[number];
export const clipperPropertyTypeSchema = z.enum(CLIPPER_PROPERTY_TYPES);

export const CLIPPER_TEMPLATE_BEHAVIORS = ["create", "append-existing", "daily-only"] as const;
export type ClipperTemplateBehavior = (typeof CLIPPER_TEMPLATE_BEHAVIORS)[number];
export const clipperTemplateBehaviorSchema = z.enum(CLIPPER_TEMPLATE_BEHAVIORS);

export const clipperTemplateTriggerSchema = z.object({
  type: clipperTriggerTypeSchema,
  pattern: z.string().trim().min(1).max(500),
});
export type ClipperTemplateTrigger = z.infer<typeof clipperTemplateTriggerSchema>;

export const clipperPropertyMappingSchema = z.object({
  key: z.string().trim().min(1).max(120),
  valueTemplate: z.string().max(4000),
  type: clipperPropertyTypeSchema.default("text"),
});
export type ClipperPropertyMapping = z.infer<typeof clipperPropertyMappingSchema>;

export const clipperTemplateSchema = z.object({
  id: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(120),
  description: z.string().max(500).default(""),
  enabled: z.boolean().default(true),
  priority: z.number().int().default(0),
  triggers: z.array(clipperTemplateTriggerSchema).default([]),
  behavior: clipperTemplateBehaviorSchema.default("create"),
  targetSpaceId: spaceIdSchema.or(z.literal("")).optional(),
  titleTemplate: z.string().trim().min(1).max(500).default("{{title}}"),
  contentTemplate: z.string().default("{{content}}"),
  tagsTemplate: z.string().max(1000).default(""),
  properties: z.array(clipperPropertyMappingSchema).default([]),
  appendToDaily: z.boolean().default(false),
  dailyLineTemplate: z.string().max(1000).default("- [[{{title}}]] ({{url}})"),
  mirrorImages: z.boolean().default(true),
  saveHtmlSnapshot: z.boolean().default(true),
});
export type ClipperTemplate = z.infer<typeof clipperTemplateSchema>;

export const clipLookupQuerySchema = z.object({
  url: z.string().url(),
});
export type ClipLookupQuery = z.infer<typeof clipLookupQuerySchema>;

export interface ClipLookupResult {
  readonly found: boolean;
  readonly normalizedUrl: string;
  readonly document: DocumentRecord | null;
  readonly highlights: readonly DocumentHighlight[];
  readonly threadBindings: readonly AdeThreadBinding[];
}

export const CLIPPER_TEMPLATE_MARKER = "<!-- inkade-clipper-template:v1 -->";

export function serializeClipperTemplateToDocumentTemplate(template: ClipperTemplate): {
  readonly name: string;
  readonly kind: "clip";
  readonly description: string;
  readonly contentMarkdown: string;
  readonly isDefaultDaily: false;
} {
  const safeJson = JSON.stringify(template, null, 2).replace(/-->/g, "--\\u003e");
  return {
    name: `[Clipper] ${template.name}`.slice(0, 120),
    kind: "clip",
    description: template.description.slice(0, 500),
    contentMarkdown: `${CLIPPER_TEMPLATE_MARKER}\n\`\`\`json\n${safeJson}\n\`\`\`\n`,
    isDefaultDaily: false,
  };
}

export function parseClipperTemplateFromDocumentTemplate(
  docTemplate: Pick<DocumentTemplate, "kind" | "contentMarkdown">,
): ClipperTemplate | null {
  if (docTemplate.kind !== "clip") return null;
  if (!docTemplate.contentMarkdown.includes(CLIPPER_TEMPLATE_MARKER)) return null;

  const match = /```json\s*([\s\S]*?)\s*```/m.exec(docTemplate.contentMarkdown);
  if (!match?.[1]) return null;

  try {
    const parsedJson = JSON.parse(match[1]) as unknown;
    const validated = clipperTemplateSchema.safeParse(parsedJson);
    return validated.success ? validated.data : null;
  } catch {
    return null;
  }
}

/**
 * Matches a single ClipperTemplate trigger against a page URL and extracted Schema.org JSON-LD.
 */
export function matchClipperTrigger(
  trigger: ClipperTemplateTrigger,
  context: { readonly url: string; readonly schemaTypes?: readonly string[] | undefined },
): boolean {
  const pattern = trigger.pattern.trim();
  if (!pattern) return false;

  if (trigger.type === "url-prefix") {
    return context.url.toLowerCase().startsWith(pattern.toLowerCase());
  }
  if (trigger.type === "glob") {
    return matchGlob(pattern, context.url);
  }
  if (trigger.type === "regex") {
    try {
      const re = new RegExp(pattern, "i");
      return re.test(context.url);
    } catch {
      return false;
    }
  }
  if (trigger.type === "schema-type") {
    const targetLower = pattern.toLowerCase();
    return (context.schemaTypes ?? []).some((t) => t.toLowerCase() === targetLower);
  }
  return false;
}
