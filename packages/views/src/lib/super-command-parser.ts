import {
  type DocumentId,
  type DocumentKind,
  type DocumentRecord,
  isValidDailyDate,
  type SpaceId,
} from "@inkade/core";
import { getTodayDailyDate, shiftDailyDate } from "./dates.ts";

export interface NaturalDateMatch {
  readonly date: string;
  readonly kind: "today" | "yesterday" | "tomorrow" | "explicit";
}

export interface ParsedSuperCommandQuery {
  readonly raw: string;
  readonly textQuery: string;
  readonly tags: readonly string[];
  readonly spaceQuery: string | null;
  readonly kind: DocumentKind | null;
  readonly unreadOnly: boolean;
  readonly waitingOnly: boolean;
  readonly naturalDate: NaturalDateMatch | null;
  readonly hasStructuredFilters: boolean;
}

export interface NestedTagTreeNode {
  readonly segment: string;
  readonly fullPath: string;
  readonly directCount: number;
  readonly totalCount: number;
  readonly children: readonly NestedTagTreeNode[];
}

const VALID_KINDS = new Set<DocumentKind>(["article", "clip", "outline"]);

function tokenizeCommandInput(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i] ?? "";
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
      continue;
    }
    if (!inQuotes && /\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }
  if (current) {
    tokens.push(current);
  }
  return tokens;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

/**
 * Resolves natural language dates (`today`/`今天`, `yesterday`/`昨天`, `tomorrow`/`明天`, or `YYYY-MM-DD`).
 */
export function parseNaturalDateQuery(
  input: string,
  todayStr: string = getTodayDailyDate(),
): NaturalDateMatch | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();

  if (lower === "today" || trimmed === "今天" || trimmed === "今日") {
    return { date: todayStr, kind: "today" };
  }
  if (lower === "yesterday" || trimmed === "昨天" || trimmed === "昨日") {
    return { date: shiftDailyDate(todayStr, -1), kind: "yesterday" };
  }
  if (lower === "tomorrow" || trimmed === "明天" || trimmed === "明日") {
    return { date: shiftDailyDate(todayStr, 1), kind: "tomorrow" };
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed) && isValidDailyDate(trimmed)) {
    return { date: trimmed, kind: "explicit" };
  }
  return null;
}

/**
 * Parses super ⌘K query tokens: `#tag`, `space:<name>`, `kind:article|clip|outline`,
 * `is:unread`, `@waiting`, plus remaining free-text search and natural dates.
 */
export function parseSuperCommandQuery(
  raw: string,
  todayStr: string = getTodayDailyDate(),
): ParsedSuperCommandQuery {
  const tokens = tokenizeCommandInput(raw.trim());
  const tags: string[] = [];
  const seenTags = new Set<string>();
  const textParts: string[] = [];
  let spaceQuery: string | null = null;
  let kind: DocumentKind | null = null;
  let unreadOnly = false;
  let waitingOnly = false;

  for (const token of tokens) {
    const lower = token.toLowerCase();

    if (lower === "is:unread") {
      unreadOnly = true;
      continue;
    }
    if (lower === "@waiting") {
      waitingOnly = true;
      continue;
    }
    if (lower.startsWith("kind:")) {
      const candidate = unquote(lower.slice("kind:".length)).toLowerCase() as DocumentKind;
      if (VALID_KINDS.has(candidate)) {
        kind = candidate;
        continue;
      }
    }
    if (lower.startsWith("space:")) {
      const candidate = unquote(token.slice("space:".length));
      if (candidate) {
        spaceQuery = candidate;
        continue;
      }
    }
    if (token.startsWith("#") && token.length > 1) {
      const normalizedTag = token.slice(1).replace(/^#+/, "").trim();
      if (normalizedTag) {
        const key = normalizedTag.toLowerCase();
        if (!seenTags.has(key)) {
          seenTags.add(key);
          tags.push(normalizedTag);
        }
        continue;
      }
    }

    textParts.push(token);
  }

  const textQuery = textParts.join(" ").trim();
  const hasStructuredFilters =
    tags.length > 0 || spaceQuery !== null || kind !== null || unreadOnly || waitingOnly;
  const naturalDate = !hasStructuredFilters ? parseNaturalDateQuery(textQuery, todayStr) : null;

  return {
    raw,
    textQuery,
    tags,
    spaceQuery,
    kind,
    unreadOnly,
    waitingOnly,
    naturalDate,
    hasStructuredFilters,
  };
}

export function tagMatchesFilter(docTag: string, filterTag: string): boolean {
  const normalizedDoc = docTag.trim().replace(/^#+/, "").toLowerCase();
  const normalizedFilter = filterTag.trim().replace(/^#+/, "").toLowerCase();
  if (!normalizedFilter) return true;
  return (
    normalizedDoc === normalizedFilter || normalizedDoc.startsWith(`${normalizedFilter}/`)
  );
}

export interface DocumentSuperFilterContext {
  readonly spaceNameById: ReadonlyMap<SpaceId, string>;
  readonly spaceSlugById: ReadonlyMap<SpaceId, string>;
  readonly waitingDocIds: ReadonlySet<DocumentId>;
}

export function matchesDocumentSuperFilters(
  doc: Pick<
    DocumentRecord,
    "id" | "title" | "excerpt" | "kind" | "spaceId" | "tags" | "unreadAgentUpdate"
  >,
  parsed: ParsedSuperCommandQuery,
  ctx: DocumentSuperFilterContext,
): boolean {
  if (parsed.kind && doc.kind !== parsed.kind) {
    return false;
  }
  if (parsed.unreadOnly && !doc.unreadAgentUpdate) {
    return false;
  }
  if (parsed.waitingOnly && !ctx.waitingDocIds.has(doc.id)) {
    return false;
  }
  if (parsed.spaceQuery) {
    const q = parsed.spaceQuery.toLowerCase();
    const spaceName = (ctx.spaceNameById.get(doc.spaceId) ?? "").toLowerCase();
    const spaceSlug = (ctx.spaceSlugById.get(doc.spaceId) ?? "").toLowerCase();
    if (!spaceName.includes(q) && !spaceSlug.includes(q)) {
      return false;
    }
  }
  for (const requiredTag of parsed.tags) {
    if (!doc.tags.some((t) => tagMatchesFilter(t, requiredTag))) {
      return false;
    }
  }
  if (parsed.textQuery) {
    const q = parsed.textQuery.toLowerCase();
    const hitTitle = doc.title.toLowerCase().includes(q);
    const hitExcerpt = doc.excerpt.toLowerCase().includes(q);
    const hitTags = doc.tags.some((t) => t.toLowerCase().includes(q));
    if (!hitTitle && !hitExcerpt && !hitTags) {
      return false;
    }
  }
  return true;
}

interface MutableTagNode {
  segment: string;
  fullPath: string;
  directCount: number;
  children: Map<string, MutableTagNode>;
}

function finalizeTagNodes(map: Map<string, MutableTagNode>): NestedTagTreeNode[] {
  const nodes: NestedTagTreeNode[] = [];
  for (const entry of map.values()) {
    const children = finalizeTagNodes(entry.children);
    const childrenTotal = children.reduce((sum, child) => sum + child.totalCount, 0);
    nodes.push({
      segment: entry.segment,
      fullPath: entry.fullPath,
      directCount: entry.directCount,
      totalCount: entry.directCount + childrenTotal,
      children,
    });
  }
  nodes.sort((a, b) => b.totalCount - a.totalCount || a.segment.localeCompare(b.segment));
  return nodes;
}

/**
 * Builds a Bear-style collapsible `#a/b/c` nested tag tree from flat tag counts.
 */
export function buildNestedTagTree(
  tags: ReadonlyArray<{ readonly tag: string; readonly count: number }>,
): NestedTagTreeNode[] {
  const root = new Map<string, MutableTagNode>();

  for (const item of tags) {
    const clean = item.tag.trim().replace(/^#+/, "");
    const segments = clean
      .split("/")
      .map((s) => s.trim())
      .filter(Boolean);
    if (segments.length === 0) continue;

    let currentMap = root;
    let builtPath = "";
    for (let i = 0; i < segments.length; i += 1) {
      const seg = segments[i]!;
      builtPath = builtPath ? `${builtPath}/${seg}` : seg;
      const key = seg.toLowerCase();
      let node = currentMap.get(key);
      if (!node) {
        node = {
          segment: seg,
          fullPath: builtPath,
          directCount: 0,
          children: new Map<string, MutableTagNode>(),
        };
        currentMap.set(key, node);
      }
      if (i === segments.length - 1) {
        node.directCount += Math.max(0, item.count);
      }
      currentMap = node.children;
    }
  }

  return finalizeTagNodes(root);
}

/**
 * Extracts the first valid http/https URL from an explicit URL field or free-form capture text.
 */
export function extractDetectedUrl(sourceUrl: string, text: string): string | null {
  const candidates = [sourceUrl.trim(), ...Array.from(text.matchAll(/https?:\/\/[^\s<>"'`]+/gi), (m) => m[0])];
  for (const raw of candidates) {
    if (!raw) continue;
    const cleaned = raw.replace(/[),.;:!?]+$/u, "");
    try {
      const parsed = new URL(cleaned);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return parsed.toString();
      }
    } catch {
      // ignore invalid URLs
    }
  }
  return null;
}
