import GithubSlugger from "github-slugger";
import type { Nodes, Root } from "mdast";
import { toString as mdastToString } from "mdast-util-to-string";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { InkadeError } from "./errors.ts";
import {
  ARTIFACT_DEFAULT_HEIGHT_PX,
  ARTIFACT_MAX_HEIGHT_PX,
  ARTIFACT_MIN_HEIGHT_PX,
} from "./types/artifact.ts";
import type { ExtractedWikilink, SectionPatchMode, TocEntry } from "./types/index.ts";

const markdownParser = unified().use(remarkParse).use(remarkFrontmatter, ["yaml"]).use(remarkGfm);

interface InternalSectionEntry extends TocEntry {
  readonly slugPath: readonly string[];
  readonly headingEndOffset: number;
}

function parseAst(markdown: string): Root {
  return markdownParser.parse(markdown);
}

function buildSectionIndex(markdown: string): InternalSectionEntry[] {
  const tree = parseAst(markdown);
  const slugger = new GithubSlugger();
  const headings: Array<{
    depth: number;
    text: string;
    slug: string;
    startOffset: number;
    headingEndOffset: number;
  }> = [];

  for (const child of tree.children) {
    if (child.type !== "heading") continue;
    const heading = child;
    const text = mdastToString(heading).trim();
    const slug = slugger.slug(text || "section");
    const startOffset = heading.position?.start.offset ?? 0;
    const headingEndOffset = heading.position?.end.offset ?? startOffset;
    headings.push({
      depth: heading.depth,
      text,
      slug,
      startOffset,
      headingEndOffset,
    });
  }

  const stack: Array<{ depth: number; text: string; slug: string }> = [];
  const rawPaths: Array<{ path: string[]; slugPath: string[] }> = [];

  for (const h of headings) {
    while (stack.length > 0 && (stack[stack.length - 1]?.depth ?? 0) >= h.depth) {
      stack.pop();
    }
    stack.push({ depth: h.depth, text: h.text, slug: h.slug });
    rawPaths.push({
      path: stack.map((item) => item.text),
      slugPath: stack.map((item) => item.slug),
    });
  }

  return headings.map((h, idx) => {
    let endOffset = markdown.length;
    for (let j = idx + 1; j < headings.length; j++) {
      const next = headings[j];
      if (next && next.depth <= h.depth) {
        endOffset = next.startOffset;
        break;
      }
    }
    const paths = rawPaths[idx] ?? { path: [h.text], slugPath: [h.slug] };
    return {
      depth: h.depth,
      text: h.text,
      slug: h.slug,
      path: paths.path,
      slugPath: paths.slugPath,
      startOffset: h.startOffset,
      headingEndOffset: h.headingEndOffset,
      endOffset,
    };
  });
}

/**
 * Extracts a hierarchical Table of Contents using the remark AST (code blocks ignored).
 */
export function extractToc(markdown: string): TocEntry[] {
  return buildSectionIndex(markdown).map(
    ({ depth, text, slug, path, startOffset, endOffset }) => ({
      depth,
      text,
      slug,
      path,
      startOffset,
      endOffset,
    }),
  );
}

function collectPlainSegments(
  node: Nodes,
  out: string[],
  options?: { readonly skipCodeBlocks?: boolean | undefined },
): void {
  if (node.type === "code") {
    const lang = (node.lang ?? "").trim().toLowerCase();
    if (
      options?.skipCodeBlocks ||
      lang === "inkade-view" ||
      lang === "inkade_view" ||
      lang === INKADE_PENDING_FENCE_LANG
    ) {
      return;
    }
    if (lang === INKADE_ARTIFACT_FENCE_LANG || lang === "inkade_artifact") {
      const payload = parseInkadeArtifactPayload(node.value ?? "");
      if (payload.title) {
        out.push(payload.title);
      }
      return;
    }
    const text = mdastToString(node).trim();
    if (text) out.push(text);
    return;
  }
  if (
    node.type === "heading" ||
    node.type === "paragraph" ||
    node.type === "tableCell"
  ) {
    const text = mdastToString(node).trim();
    if (text) out.push(text);
    return;
  }
  if (node.type === "text" || node.type === "inlineCode") {
    const text = node.value.trim();
    if (text) out.push(text);
    return;
  }
  if ("children" in node && Array.isArray(node.children)) {
    for (const child of node.children) {
      collectPlainSegments(child, out, options);
    }
  }
}

/**
 * Strips raw internal `inkade://...` URI literals and unclosed trailing wiki/markdown
 * tokens when slicing text down to a human-readable excerpt budget.
 */
export function trimReadableExcerpt(text: string, maxLength = 200): string {
  const normalized = text
    .replace(/`?inkade:\/\/[^\s)\]`"'<>]+`?/gi, "")
    .replace(/(?:^|\s)>?\s*\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/gi, " ")
    .replace(/\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  let sliced = normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd();
  // Trim trailing incomplete [[wikilink or [ref token so previews never end in "[[Orama..."
  sliced = sliced
    .replace(/\[\[[^[\]]*$/, "")
    .replace(/\[[^[\]]*$/, "")
    .replace(/[`*_]+$/, "")
    .replace(/[\s:：·\-—(/（【]+$/, "")
    .trimEnd();
  if (!sliced) {
    sliced = normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd();
  }
  return `${sliced}…`;
}

/**
 * Converts Markdown into clean plain text suitable for FTS5 indexing.
 */
export function markdownToPlainText(
  markdown: string,
  options?: { readonly skipCodeBlocks?: boolean | undefined },
): string {
  const safeMarkdown = typeof markdown === "string" ? markdown : "";
  if (!safeMarkdown.trim()) return "";
  const tree = parseAst(safeMarkdown);
  const segments: string[] = [];
  collectPlainSegments(tree, segments, options);

  return segments
    .join(" ")
    .replace(/\[\[([^[\]]+?)\]\]/g, (_, inner: string) => {
      const pipeIdx = inner.indexOf("|");
      if (pipeIdx >= 0) {
        return inner.slice(pipeIdx + 1).trim();
      }
      const hashIdx = inner.indexOf("#");
      return (hashIdx >= 0 ? inner.slice(0, hashIdx) : inner).trim();
    })
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extracts a concise plain-text excerpt from Markdown content (excluding code/query blocks).
 */
export function extractExcerpt(markdown: string, maxLength = 200): string {
  const plain = markdownToPlainText(markdown, { skipCodeBlocks: true });
  return trimReadableExcerpt(plain, maxLength);
}

function normalizeHeadingSegments(headingPath: string | readonly string[]): string[] {
  const raw =
    typeof headingPath === "string"
      ? headingPath.split(">").map((part) => part.trim())
      : headingPath.map((part) => part.trim());
  const segments = raw.filter((part) => part.length > 0);
  if (segments.length === 0) {
    throw new InkadeError("VALIDATION_ERROR", "headingPath must not be empty");
  }
  return segments;
}

function segmentMatches(entryText: string, entrySlug: string, query: string): boolean {
  const qLower = query.toLowerCase();
  return entryText.toLowerCase() === qLower || entrySlug.toLowerCase() === qLower;
}

function findMatchingSection(
  sections: readonly InternalSectionEntry[],
  segments: readonly string[],
): InternalSectionEntry | undefined {
  if (segments.length === 1) {
    const query = segments[0] ?? "";
    return sections.find((entry) => segmentMatches(entry.text, entry.slug, query));
  }

  // Exact top-down path match first.
  const exact = sections.find((entry) => {
    if (entry.path.length !== segments.length) return false;
    return segments.every((seg, idx) =>
      segmentMatches(entry.path[idx] ?? "", entry.slugPath[idx] ?? "", seg),
    );
  });
  if (exact) return exact;

  // Suffix match allows targeting e.g. ["Research", "Findings"] when nested under document H1.
  return sections.find((entry) => {
    if (entry.path.length < segments.length) return false;
    const offset = entry.path.length - segments.length;
    return segments.every((seg, idx) =>
      segmentMatches(
        entry.path[offset + idx] ?? "",
        entry.slugPath[offset + idx] ?? "",
        seg,
      ),
    );
  });
}

/**
 * Surgically replaces, appends, or prepends content inside a Markdown heading section
 * using AST byte offsets so all untouched sections remain byte-for-byte identical.
 */
export function patchMarkdownSection(
  markdown: string,
  headingPath: string | readonly string[],
  mode: SectionPatchMode,
  content: string,
  options?: { readonly createIfMissing?: boolean | undefined },
): string {
  const segments = normalizeHeadingSegments(headingPath);
  const sections = buildSectionIndex(markdown);
  const target = findMatchingSection(sections, segments);

  if (!target) {
    if (!options?.createIfMissing) {
      throw new InkadeError(
        "SECTION_NOT_FOUND",
        `Heading section "${segments.join(" > ")}" was not found`,
      );
    }

    const body = content.trim();
    const newTitle = segments[segments.length - 1] ?? "Section";

    if (segments.length > 1) {
      const parent = findMatchingSection(sections, segments.slice(0, -1));
      if (parent) {
        const depth = Math.min(parent.depth + 1, 6);
        const headingLine = `${"#".repeat(depth)} ${newTitle}`;
        const newSection = body ? `${headingLine}\n\n${body}` : headingLine;
        const beforeParentEnd = markdown.slice(0, parent.endOffset).replace(/\s+$/, "");
        const afterParentEnd = markdown.slice(parent.endOffset);
        const prefixSep = beforeParentEnd.length > 0 ? "\n\n" : "";
        const suffixSep = afterParentEnd.length > 0 ? "\n\n" : markdown.endsWith("\n") ? "\n" : "";
        return `${beforeParentEnd}${prefixSep}${newSection}${suffixSep}${afterParentEnd}`;
      }
    }

    const hasH1 = sections.some((s) => s.depth === 1);
    const depth = Math.min(segments.length === 1 && hasH1 ? 2 : segments.length, 6);
    const headingLine = `${"#".repeat(depth)} ${newTitle}`;
    const newSection = body ? `${headingLine}\n\n${body}` : headingLine;
    const trimmedDoc = markdown.replace(/\s+$/, "");
    const trailing = markdown.endsWith("\n") ? "\n" : "";
    return trimmedDoc ? `${trimmedDoc}\n\n${newSection}${trailing}` : `${newSection}${trailing}`;
  }

  const before = markdown.slice(0, target.startOffset);
  const headingLine = markdown.slice(target.startOffset, target.headingEndOffset);
  const existingBody = markdown.slice(target.headingEndOffset, target.endOffset).trim();
  const after = markdown.slice(target.endOffset);
  const incoming = content.trim();

  let nextBody = "";
  if (mode === "replace") {
    nextBody = incoming;
  } else if (mode === "append") {
    nextBody =
      existingBody && incoming
        ? `${existingBody}\n\n${incoming}`
        : existingBody || incoming;
  } else {
    nextBody =
      incoming && existingBody
        ? `${incoming}\n\n${existingBody}`
        : incoming || existingBody;
  }

  const sectionBlock = nextBody ? `${headingLine}\n\n${nextBody}` : headingLine;
  const separatorAfter = after.length > 0 ? "\n\n" : markdown.endsWith("\n") ? "\n" : "";
  return `${before}${sectionBlock}${separatorAfter}${after}`;
}

function walkNonCodeTextNodes(node: Nodes, visitText: (value: string) => void): void {
  if (node.type === "code" || node.type === "inlineCode" || node.type === "html") {
    return;
  }
  if (node.type === "text") {
    visitText(node.value);
    return;
  }
  if ("children" in node && Array.isArray(node.children)) {
    for (const child of node.children) {
      walkNonCodeTextNodes(child, visitText);
    }
  }
}

const WIKILINK_REGEX = /\[\[([^[\]]+?)\]\]/g;
const INLINE_TAG_REGEX = /(?:^|[\s(])#([a-zA-Z0-9_\u4e00-\u9fa5][a-zA-Z0-9_/\-\u4e00-\u9fa5]*)/g;

/**
 * Extracts `[[target]]`, `[[target#anchor]]`, `[[target|alias]]`, and `[[target#anchor|alias]]`
 * from Markdown text nodes (ignoring fenced and inline code).
 */
export function extractWikilinks(markdown: string): ExtractedWikilink[] {
  if (!markdown.includes("[[")) return [];
  const tree = parseAst(markdown);
  const results: ExtractedWikilink[] = [];

  walkNonCodeTextNodes(tree, (value) => {
    WIKILINK_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = WIKILINK_REGEX.exec(value)) !== null) {
      const inner = (match[1] ?? "").trim();
      if (!inner) continue;

      const pipeIndex = inner.indexOf("|");
      const targetPart = (pipeIndex >= 0 ? inner.slice(0, pipeIndex) : inner).trim();
      const aliasRaw = pipeIndex >= 0 ? inner.slice(pipeIndex + 1).trim() : "";
      const alias = aliasRaw.length > 0 ? aliasRaw : null;

      const hashIndex = targetPart.indexOf("#");
      const targetSlugOrTitle = (
        hashIndex >= 0 ? targetPart.slice(0, hashIndex) : targetPart
      ).trim();
      const anchorRaw = hashIndex >= 0 ? targetPart.slice(hashIndex + 1).trim() : "";
      const anchorText = anchorRaw.length > 0 ? anchorRaw : null;

      if (!targetSlugOrTitle) continue;

      const snippetStart = Math.max(0, match.index - 40);
      const snippetEnd = Math.min(value.length, match.index + match[0].length + 40);
      const contextSnippet = value.slice(snippetStart, snippetEnd).replace(/\s+/g, " ").trim();

      results.push({
        raw: match[0],
        targetSlugOrTitle,
        anchorText,
        alias,
        contextSnippet,
      });
    }
  });

  return results;
}

/**
 * Extracts inline `#tags` from Markdown prose while ignoring headings, code blocks, and URL fragments.
 */
export function extractInlineTags(markdown: string): string[] {
  if (!markdown.includes("#")) return [];
  const tree = parseAst(markdown);
  const seen = new Set<string>();

  function walkForTags(node: Nodes): void {
    if (
      node.type === "code" ||
      node.type === "inlineCode" ||
      node.type === "html" ||
      node.type === "link" ||
      node.type === "definition"
    ) {
      return;
    }
    if (node.type === "text") {
      INLINE_TAG_REGEX.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = INLINE_TAG_REGEX.exec(node.value)) !== null) {
        const tag = match[1];
        if (tag) {
          seen.add(tag);
        }
      }
      return;
    }
    if ("children" in node && Array.isArray(node.children)) {
      for (const child of node.children) {
        walkForTags(child);
      }
    }
  }

  walkForTags(tree);
  return [...seen];
}

/**
 * Generates a URL-safe slug for spaces and documents (supporting Unicode fallback).
 */
export function slugifyTitle(input: string): string {
  const slugger = new GithubSlugger();
  const slug = slugger.slug(input.trim());
  return slug.length > 0 ? slug : "untitled";
}

/**
 * Rewrites `[[target]]`, `[[target#anchor]]`, `[[target|alias]]`, and `[[target#anchor|alias]]`
 * occurrences matching `oldTitle` or `oldSlug` (case-insensitive) to `newTitle` inside
 * non-code Markdown text nodes.
 */
export function rewriteWikilinksTitle(
  markdown: string,
  oldTitle: string,
  oldSlug: string,
  newTitle: string,
): { readonly markdown: string; readonly changed: boolean } {
  if (!markdown.includes("[[")) {
    return { markdown, changed: false };
  }

  const normalizedTargets = new Set(
    [oldTitle.trim().toLowerCase(), oldSlug.trim().toLowerCase()].filter((t) => t.length > 0),
  );
  if (normalizedTargets.size === 0) {
    return { markdown, changed: false };
  }

  const tree = parseAst(markdown);
  const edits: Array<{ start: number; end: number; replacement: string }> = [];

  function walkPositions(node: Nodes): void {
    if (node.type === "code" || node.type === "inlineCode" || node.type === "html") {
      return;
    }
    if (node.type === "text" && node.position?.start.offset !== undefined && node.position?.end.offset !== undefined) {
      const startOffset = node.position.start.offset;
      const endOffset = node.position.end.offset;
      const slice = markdown.slice(startOffset, endOffset);
      WIKILINK_REGEX.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = WIKILINK_REGEX.exec(slice)) !== null) {
        const inner = match[1] ?? "";
        const pipeIndex = inner.indexOf("|");
        const targetPart = pipeIndex >= 0 ? inner.slice(0, pipeIndex) : inner;
        const aliasSuffix = pipeIndex >= 0 ? inner.slice(pipeIndex) : "";
        const hashIndex = targetPart.indexOf("#");
        const targetName = (hashIndex >= 0 ? targetPart.slice(0, hashIndex) : targetPart).trim();
        const anchorSuffix = hashIndex >= 0 ? targetPart.slice(hashIndex) : "";

        if (normalizedTargets.has(targetName.toLowerCase())) {
          const replacement = `[[${newTitle}${anchorSuffix}${aliasSuffix}]]`;
          if (replacement !== match[0]) {
            edits.push({
              start: startOffset + match.index,
              end: startOffset + match.index + match[0].length,
              replacement,
            });
          }
        }
      }
      return;
    }
    if ("children" in node && Array.isArray(node.children)) {
      for (const child of node.children) {
        walkPositions(child);
      }
    }
  }

  walkPositions(tree);
  if (edits.length === 0) {
    return { markdown, changed: false };
  }

  edits.sort((a, b) => b.start - a.start);
  let output = markdown;
  for (const edit of edits) {
    output = `${output.slice(0, edit.start)}${edit.replacement}${output.slice(edit.end)}`;
  }
  return { markdown: output, changed: output !== markdown };
}

/**
 * Strips a leading `# Title` heading from Markdown when it matches the document's
 * canonical title, preventing duplicated H1s when the page renders an inline title.
 */
export function stripLeadingDuplicateTitle(markdown: string, title: string): string {
  const safeMarkdown = typeof markdown === "string" ? markdown : "";
  const safeTitle = typeof title === "string" ? title : "";
  if (!safeTitle.trim()) return safeMarkdown;
  const lines = safeMarkdown.split("\n");
  let idx = 0;
  while (idx < lines.length && lines[idx]?.trim() === "") {
    idx += 1;
  }
  const first = lines[idx]?.trim() ?? "";
  const match = /^#\s+(.+?)\s*#*\s*$/.exec(first);
  if (match && match[1]?.trim().toLowerCase() === safeTitle.trim().toLowerCase()) {
    const rest = lines.slice(idx + 1);
    while (rest.length > 0 && rest[0]?.trim() === "") {
      rest.shift();
    }
    return rest.join("\n");
  }
  return safeMarkdown;
}

/**
 * Extracts a display-ready hostname (without leading `www.`) from an HTTP(S) URL.
 */
export function extractSourceDomain(sourceUrl?: string | null): string | null {
  if (!sourceUrl) return null;
  try {
    const hostname = new URL(sourceUrl).hostname.replace(/^www\./i, "");
    return hostname || null;
  } catch {
    return null;
  }
}

export const INKADE_PENDING_FENCE_LANG = "inkade-pending";

export const INKADE_PENDING_STATUSES = ["generating", "queued", "error"] as const;
export type InkadePendingStatus = (typeof INKADE_PENDING_STATUSES)[number];

export interface InkadePendingPayload {
  readonly id: string;
  readonly label: string;
  readonly bindingId?: string | undefined;
  readonly status: InkadePendingStatus;
}

export interface InkadePendingBlock extends InkadePendingPayload {
  readonly startOffset: number;
  readonly endOffset: number;
  readonly rawFence: string;
}

export interface ScaffoldSectionSpec {
  readonly heading: string;
  readonly level?: number | undefined;
  readonly pendingId?: string | undefined;
  readonly pendingLabel?: string | undefined;
  readonly initialMarkdown?: string | undefined;
}

export interface BuildScaffoldMarkdownInput {
  readonly title?: string | undefined;
  readonly introMarkdown?: string | undefined;
  readonly sections: readonly ScaffoldSectionSpec[];
  readonly bindingId?: string | undefined;
  readonly status?: InkadePendingStatus | undefined;
}

export type ReplacePendingBlockResult =
  | { readonly ok: true; readonly markdown: string }
  | { readonly ok: false; readonly reason: "PENDING_BLOCK_NOT_FOUND" };

function normalizePendingStatus(raw: unknown): InkadePendingStatus {
  const normalized = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (normalized === "queued" || normalized === "error" || normalized === "generating") {
    return normalized;
  }
  return "generating";
}

function parsePendingLinesFallback(rawBody: string): Record<string, string> {
  const record: Record<string, string> = {};
  for (const rawLine of rawBody.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^([a-zA-Z0-9_-]+)\s*:\s*(.*)$/.exec(trimmed);
    if (!match?.[1]) continue;
    let value = (match[2] ?? "").trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    record[match[1]] = value;
  }
  return record;
}

function readPendingField(record: Record<string, unknown>, key: string): string {
  const val = record[key];
  if (typeof val === "string") return val.trim();
  if (typeof val === "number" || typeof val === "boolean") return String(val).trim();
  return "";
}

/**
 * Parses the YAML/key-value body inside an ```inkade-pending fenced block.
 */
export function parseInkadePendingPayload(rawBody: string): InkadePendingPayload {
  const safeBody = typeof rawBody === "string" ? rawBody : "";
  let parsedRecord: Record<string, unknown> | null = null;
  if (safeBody.trim()) {
    try {
      const yamlValue: unknown = parseYaml(safeBody);
      if (yamlValue && typeof yamlValue === "object" && !Array.isArray(yamlValue)) {
        parsedRecord = yamlValue as Record<string, unknown>;
      }
    } catch {
      parsedRecord = null;
    }
    if (!parsedRecord) {
      parsedRecord = parsePendingLinesFallback(safeBody);
    }
  }
  const record = parsedRecord ?? {};
  const id = readPendingField(record, "id");
  const label = readPendingField(record, "label");
  const bindingId = readPendingField(record, "bindingId");
  const status = normalizePendingStatus(record.status);
  return {
    id,
    label,
    ...(bindingId ? { bindingId } : {}),
    status,
  };
}

/**
 * Serializes an `InkadePendingPayload` into canonical YAML for ```inkade-pending blocks.
 */
export function serializeInkadePendingPayload(payload: {
  readonly id: string;
  readonly label?: string | undefined;
  readonly bindingId?: string | undefined;
  readonly status?: InkadePendingStatus | undefined;
}): string {
  const obj: Record<string, string> = {
    id: payload.id.trim(),
    label: (payload.label ?? "").trim(),
  };
  const bindingId = payload.bindingId?.trim();
  if (bindingId) {
    obj.bindingId = bindingId;
  }
  obj.status = normalizePendingStatus(payload.status);
  return stringifyYaml(obj, { lineWidth: 0 }).trimEnd();
}

function chooseFenceMarker(content: string): string {
  let maxRun = 2;
  const matches = content.match(/`+/g);
  if (matches) {
    for (const run of matches) {
      if (run.length > maxRun) maxRun = run.length;
    }
  }
  return "`".repeat(Math.max(3, maxRun + 1));
}

/**
 * Extracts all valid ```inkade-pending fenced code blocks via the remark AST,
 * ignoring any fake fences nested inside ordinary code blocks.
 */
export function extractPendingBlocks(markdown: string): readonly InkadePendingBlock[] {
  if (typeof markdown !== "string" || !markdown.includes(INKADE_PENDING_FENCE_LANG)) {
    return [];
  }
  const tree = parseAst(markdown);
  const blocks: InkadePendingBlock[] = [];

  function walk(node: Nodes): void {
    if (node.type === "code") {
      if ((node.lang ?? "").trim().toLowerCase() === INKADE_PENDING_FENCE_LANG) {
        const startOffset = node.position?.start.offset;
        const endOffset = node.position?.end.offset;
        if (startOffset !== undefined && endOffset !== undefined) {
          const payload = parseInkadePendingPayload(node.value ?? "");
          if (payload.id) {
            blocks.push({
              ...payload,
              startOffset,
              endOffset,
              rawFence: markdown.slice(startOffset, endOffset),
            });
          }
        }
      }
      return;
    }
    if ("children" in node && Array.isArray(node.children)) {
      for (const child of node.children) {
        walk(child);
      }
    }
  }

  walk(tree);
  return blocks;
}

/**
 * Builds canonical Markdown with headings and ```inkade-pending placeholder blocks
 * for progressive skeleton authoring.
 */
export function buildScaffoldMarkdown(input: BuildScaffoldMarkdownInput): string {
  const parts: string[] = [];
  const title = input.title?.trim();
  if (title) {
    parts.push(`# ${title}`);
  }
  const intro = input.introMarkdown?.trim();
  if (intro) {
    parts.push(intro);
  }

  const usedIds = new Set<string>();
  for (const section of input.sections) {
    const explicitId = section.pendingId?.trim();
    if (explicitId) {
      usedIds.add(explicitId);
    }
  }

  input.sections.forEach((section, index) => {
    const rawLevel = section.level ?? 2;
    const level = Math.min(6, Math.max(1, Number.isFinite(rawLevel) ? Math.trunc(rawLevel) : 2));
    const headingText = section.heading.trim();
    const sectionParts: string[] = [`${"#".repeat(level)} ${headingText}`];

    const initial = section.initialMarkdown?.trim() ?? "";
    if (initial) {
      sectionParts.push(initial);
    }

    const explicitId = section.pendingId?.trim();
    const explicitLabel = section.pendingLabel?.trim();
    const shouldEmitPending = !initial || Boolean(explicitId || explicitLabel);

    if (shouldEmitPending) {
      let pendingId = explicitId ?? "";
      if (!pendingId) {
        const slugBase = slugifyTitle(headingText).replace(/[^a-zA-Z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
        const candidateBase = `sec_${slugBase || String(index + 1)}`;
        pendingId = candidateBase;
        let suffix = 2;
        while (usedIds.has(pendingId)) {
          pendingId = `${candidateBase}_${suffix}`;
          suffix += 1;
        }
        usedIds.add(pendingId);
      }

      const label = explicitLabel || headingText;
      const body = serializeInkadePendingPayload({
        id: pendingId,
        label,
        bindingId: input.bindingId,
        status: input.status ?? "generating",
      });
      const fence = chooseFenceMarker(body);
      sectionParts.push(`${fence}${INKADE_PENDING_FENCE_LANG}\n${body}\n${fence}`);
    }

    parts.push(sectionParts.join("\n\n"));
  });

  if (parts.length === 0) {
    return "";
  }
  return `${parts.join("\n\n")}\n`;
}

/**
 * Replaces the ```inkade-pending block matching `pendingId` with `replacementMarkdown`
 * using AST byte offsets. Returns `PENDING_BLOCK_NOT_FOUND` if a human has already
 * removed or converted the placeholder block.
 */
export function replacePendingBlock(
  markdown: string,
  pendingId: string,
  replacementMarkdown: string,
): ReplacePendingBlockResult {
  const normalizedId = typeof pendingId === "string" ? pendingId.trim() : "";
  if (!normalizedId) {
    return { ok: false, reason: "PENDING_BLOCK_NOT_FOUND" };
  }
  const blocks = extractPendingBlocks(markdown);
  const target = blocks.find((block) => block.id === normalizedId);
  if (!target) {
    return { ok: false, reason: "PENDING_BLOCK_NOT_FOUND" };
  }

  const before = markdown.slice(0, target.startOffset);
  const after = markdown.slice(target.endOffset);
  const incoming = replacementMarkdown.trim();

  if (!incoming) {
    const cleanBefore = before.replace(/[ \t]+$/, "").replace(/\n+$/, "");
    const cleanAfter = after.replace(/^\n+/, "");
    if (!cleanBefore && !cleanAfter) {
      return { ok: true, markdown: "" };
    }
    if (!cleanBefore) {
      return { ok: true, markdown: cleanAfter };
    }
    if (!cleanAfter) {
      return { ok: true, markdown: markdown.endsWith("\n") ? `${cleanBefore}\n` : cleanBefore };
    }
    return { ok: true, markdown: `${cleanBefore}\n\n${cleanAfter}` };
  }

  return {
    ok: true,
    markdown: `${before}${incoming}${after}`,
  };
}

// ---------------------------------------------------------------------------
// Presentation Mode: Slide Splitting & Speaker Notes Extraction
// ---------------------------------------------------------------------------

export interface MarkdownPresentationSlide {
  readonly index: number;
  readonly title: string;
  readonly markdown: string;
  readonly speakerNotes: string;
}

export interface SplitMarkdownSlidesResult {
  readonly slides: readonly MarkdownPresentationSlide[];
}

const SPEAKER_NOTES_COMMENT_REGEX = /<!--\s*notes\s*:([\s\S]*?)-->/gi;

function normalizeSpeakerNoteBody(rawBody: string): string {
  const normalized = rawBody.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  while (lines.length > 0 && lines[0]?.trim() === "") lines.shift();
  while (lines.length > 0 && lines[lines.length - 1]?.trim() === "") lines.pop();
  if (lines.length === 0) return "";
  let minIndent = Number.POSITIVE_INFINITY;
  for (const line of lines) {
    if (!line.trim()) continue;
    const match = /^([ \t]*)/.exec(line);
    const indentLen = match?.[1]?.length ?? 0;
    if (indentLen < minIndent) minIndent = indentLen;
  }
  const stripLen = Number.isFinite(minIndent) ? minIndent : 0;
  return lines
    .map((line) => (line.length >= stripLen ? line.slice(stripLen).trimEnd() : line.trimEnd()))
    .join("\n")
    .trim();
}

function extractAndStripSpeakerNotes(source: string): {
  readonly markdown: string;
  readonly speakerNotes: string;
} {
  const safe = typeof source === "string" ? source : "";
  if (!safe || !/<!--\s*notes\s*:/i.test(safe)) {
    return { markdown: safe.trim(), speakerNotes: "" };
  }

  const tree = parseAst(safe);
  const collectedNotes: string[] = [];
  const edits: Array<{ readonly start: number; readonly end: number; readonly replacement: string }> = [];

  function walk(node: Nodes): void {
    if (node.type === "code" || node.type === "inlineCode") {
      return;
    }
    if (node.type === "html" && typeof node.value === "string") {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start !== undefined && end !== undefined) {
        const rawSlice = safe.slice(start, end);
        SPEAKER_NOTES_COMMENT_REGEX.lastIndex = 0;
        let hasNote = false;
        const stripped = rawSlice.replace(SPEAKER_NOTES_COMMENT_REGEX, (_full, body: string) => {
          hasNote = true;
          const cleanNote = normalizeSpeakerNoteBody(body);
          if (cleanNote) collectedNotes.push(cleanNote);
          return "";
        });

        if (hasNote) {
          if (stripped.trim() === "") {
            // Check whether the HTML node occupies whole lines
            let lineStart = start;
            while (lineStart > 0 && (safe[lineStart - 1] === " " || safe[lineStart - 1] === "\t")) {
              lineStart -= 1;
            }
            const atLineStart = lineStart === 0 || safe[lineStart - 1] === "\n";

            let lineEnd = end;
            while (lineEnd < safe.length && (safe[lineEnd] === " " || safe[lineEnd] === "\t")) {
              lineEnd += 1;
            }
            const atLineEnd =
              lineEnd === safe.length || safe[lineEnd] === "\n" || safe.slice(lineEnd, lineEnd + 2) === "\r\n";

            if (atLineStart && atLineEnd) {
              let delStart = lineStart;
              let delEnd = lineEnd;
              if (safe.slice(delEnd, delEnd + 2) === "\r\n") {
                delEnd += 2;
              } else if (safe[delEnd] === "\n") {
                delEnd += 1;
              }
              // Collapse blank line seam when both sides become adjacent blank lines
              const precededByBlank =
                delStart === 0 ||
                safe.slice(Math.max(0, delStart - 2), delStart) === "\n\n" ||
                safe.slice(Math.max(0, delStart - 4), delStart) === "\r\n\r\n";
              const followedByNewline = safe[delEnd] === "\n" || safe.slice(delEnd, delEnd + 2) === "\r\n";
              if (precededByBlank && followedByNewline) {
                delEnd += safe.slice(delEnd, delEnd + 2) === "\r\n" ? 2 : 1;
              } else if (delEnd === safe.length) {
                while (delStart > 0 && (safe[delStart - 1] === "\n" || safe[delStart - 1] === "\r")) {
                  delStart -= 1;
                }
              }
              edits.push({ start: delStart, end: delEnd, replacement: "" });
            } else {
              // Inline HTML comment inside a paragraph
              const delStart = start;
              let delEnd = end;
              if (safe[delStart - 1] === " " && safe[delEnd] === " ") {
                delEnd += 1;
              }
              edits.push({ start: delStart, end: delEnd, replacement: "" });
            }
          } else {
            edits.push({ start, end, replacement: stripped.trim() });
          }
        }
      }
      return;
    }

    if ("children" in node && Array.isArray(node.children)) {
      for (const child of node.children) {
        walk(child);
      }
    }
  }

  walk(tree);

  if (edits.length === 0) {
    return { markdown: safe.trim(), speakerNotes: "" };
  }

  let output = safe;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    output = `${output.slice(0, edit.start)}${edit.replacement}${output.slice(edit.end)}`;
  }

  return {
    markdown: output.trim(),
    speakerNotes: collectedNotes.join("\n\n"),
  };
}

/**
 * Strips presentation speaker note comments (`<!-- notes: ... -->`) outside code blocks
 * so normal article reading and HTML/DOCX exports do not leak private presenter notes.
 */
export function stripMarkdownSpeakerNotes(markdown: string): string {
  return extractAndStripSpeakerNotes(markdown).markdown;
}

function extractFirstHeadingText(markdown: string): string {
  if (!markdown.trim()) return "";
  const tree = parseAst(markdown);
  for (const child of tree.children) {
    if (child.type === "heading") {
      return mdastToString(child).trim();
    }
  }
  return "";
}

function startsWithH1(markdown: string): boolean {
  if (!markdown.trim()) return false;
  const tree = parseAst(markdown);
  const first = tree.children.find((n) => n.type !== "yaml");
  return Boolean(first && first.type === "heading" && first.depth === 1);
}

function extractFirstPlainLine(markdown: string): string {
  const plain = markdownToPlainText(markdown);
  const firstLine = plain.split(/\r?\n/).find((l) => l.trim().length > 0)?.trim() ?? "";
  return firstLine.length > 72 ? `${firstLine.slice(0, 71)}…` : firstLine;
}

/**
 * Splits a Markdown report into presentation slides:
 * 1) Extracts and strips `<!-- notes: ... -->` HTML comments into `speakerNotes`.
 * 2) Splits by top-level `---` (`thematicBreak`) AST nodes when present (never splitting inside code blocks).
 * 3) Otherwise splits by top-level `## ` headings, generating a title cover frame at index 0.
 */
export function splitMarkdownIntoSlides(
  markdown: string,
  documentTitle?: string,
): SplitMarkdownSlidesResult {
  const safe = typeof markdown === "string" ? markdown : "";
  const rawTree = parseAst(safe);
  const firstNode = rawTree.children[0];
  let body = safe;
  let fmTitle = "";

  if (firstNode && firstNode.type === "yaml" && firstNode.position?.end.offset !== undefined) {
    body = safe.slice(firstNode.position.end.offset).replace(/^(?:\r?\n){1,2}/, "");
    try {
      const parsedFm: unknown = parseYaml(firstNode.value ?? "");
      if (parsedFm && typeof parsedFm === "object" && !Array.isArray(parsedFm)) {
        const rawTitle = (parsedFm as Record<string, unknown>).title;
        if (typeof rawTitle === "string") fmTitle = rawTitle.trim();
      }
    } catch {
      fmTitle = "";
    }
  }

  const effectiveTitle = (documentTitle ?? "").trim() || fmTitle;
  const bodyTree = parseAst(body);

  const thematicBreaks = bodyTree.children.filter(
    (n) =>
      n.type === "thematicBreak" &&
      n.position?.start.offset !== undefined &&
      n.position?.end.offset !== undefined,
  );

  if (thematicBreaks.length > 0) {
    const rawChunks: string[] = [];
    let cursor = 0;
    for (const br of thematicBreaks) {
      const start = br.position!.start.offset!;
      const end = br.position!.end.offset!;
      rawChunks.push(body.slice(cursor, start));
      cursor = end;
    }
    rawChunks.push(body.slice(cursor));

    const slides: MarkdownPresentationSlide[] = [];
    for (const rawChunk of rawChunks) {
      const cleaned = extractAndStripSpeakerNotes(rawChunk);
      if (!cleaned.markdown && !cleaned.speakerNotes) continue;
      const idx = slides.length;
      const slideTitle =
        extractFirstHeadingText(cleaned.markdown) ||
        (idx === 0 && effectiveTitle ? effectiveTitle : "") ||
        extractFirstPlainLine(cleaned.markdown) ||
        `Slide ${idx + 1}`;
      slides.push({
        index: idx,
        title: slideTitle,
        markdown: cleaned.markdown,
        speakerNotes: cleaned.speakerNotes,
      });
    }

    if (slides.length === 0 && effectiveTitle) {
      return {
        slides: [
          {
            index: 0,
            title: effectiveTitle,
            markdown: `# ${effectiveTitle}`,
            speakerNotes: "",
          },
        ],
      };
    }

    return { slides };
  }

  const h2Nodes = bodyTree.children.filter(
    (n) =>
      n.type === "heading" &&
      n.depth === 2 &&
      n.position?.start.offset !== undefined,
  );

  if (h2Nodes.length > 0) {
    const slides: MarkdownPresentationSlide[] = [];
    const firstH2Start = h2Nodes[0]!.position!.start.offset!;
    const rawCover = body.slice(0, firstH2Start);
    const coverCleaned = extractAndStripSpeakerNotes(rawCover);
    let coverMarkdown = coverCleaned.markdown;

    if (effectiveTitle && !startsWithH1(coverMarkdown)) {
      coverMarkdown = coverMarkdown
        ? `# ${effectiveTitle}\n\n${coverMarkdown}`
        : `# ${effectiveTitle}`;
    }

    if (coverMarkdown || coverCleaned.speakerNotes) {
      const coverTitle =
        extractFirstHeadingText(coverMarkdown) ||
        effectiveTitle ||
        extractFirstPlainLine(coverMarkdown) ||
        "Cover";
      slides.push({
        index: 0,
        title: coverTitle,
        markdown: coverMarkdown,
        speakerNotes: coverCleaned.speakerNotes,
      });
    }

    for (let i = 0; i < h2Nodes.length; i += 1) {
      const h2 = h2Nodes[i]!;
      const start = h2.position!.start.offset!;
      const end =
        i + 1 < h2Nodes.length ? h2Nodes[i + 1]!.position!.start.offset! : body.length;
      const sectionRaw = body.slice(start, end);
      const sectionCleaned = extractAndStripSpeakerNotes(sectionRaw);
      const sectionTitle =
        mdastToString(h2).trim() ||
        extractFirstHeadingText(sectionCleaned.markdown) ||
        `Slide ${slides.length + 1}`;
      slides.push({
        index: slides.length,
        title: sectionTitle,
        markdown: sectionCleaned.markdown,
        speakerNotes: sectionCleaned.speakerNotes,
      });
    }

    return { slides };
  }

  const singleCleaned = extractAndStripSpeakerNotes(body);
  let singleMarkdown = singleCleaned.markdown;
  if (!singleMarkdown && !singleCleaned.speakerNotes && !effectiveTitle) {
    return { slides: [] };
  }
  if (effectiveTitle && !startsWithH1(singleMarkdown)) {
    singleMarkdown = singleMarkdown ? `# ${effectiveTitle}\n\n${singleMarkdown}` : `# ${effectiveTitle}`;
  }
  const singleTitle =
    extractFirstHeadingText(singleMarkdown) ||
    effectiveTitle ||
    extractFirstPlainLine(singleMarkdown) ||
    "Slide 1";

  return {
    slides: [
      {
        index: 0,
        title: singleTitle,
        markdown: singleMarkdown,
        speakerNotes: singleCleaned.speakerNotes,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Interactive Document Artifacts (```inkade-artifact)
// ---------------------------------------------------------------------------

export const INKADE_ARTIFACT_FENCE_LANG = "inkade-artifact";

export interface InkadeArtifactFencePayload {
  readonly id: string;
  readonly title?: string | undefined;
  readonly height?: number | undefined;
}

export interface InkadeArtifactBlock extends InkadeArtifactFencePayload {
  readonly startOffset: number;
  readonly endOffset: number;
  readonly rawFence: string;
  readonly rawBody: string;
}

function clampArtifactHeightPx(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const num =
    typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.trim()) : Number.NaN;
  if (!Number.isFinite(num) || num <= 0) return undefined;
  return Math.min(ARTIFACT_MAX_HEIGHT_PX, Math.max(ARTIFACT_MIN_HEIGHT_PX, Math.round(num)));
}

/**
 * Parses the YAML/key-value body inside an ```inkade-artifact fenced block.
 */
export function parseInkadeArtifactPayload(rawBody: string): InkadeArtifactFencePayload {
  const safeBody = typeof rawBody === "string" ? rawBody : "";
  let parsedRecord: Record<string, unknown> | null = null;
  if (safeBody.trim()) {
    try {
      const yamlValue: unknown = parseYaml(safeBody);
      if (yamlValue && typeof yamlValue === "object" && !Array.isArray(yamlValue)) {
        parsedRecord = yamlValue as Record<string, unknown>;
      }
    } catch {
      parsedRecord = null;
    }
    if (!parsedRecord) {
      parsedRecord = parsePendingLinesFallback(safeBody);
    }
  }
  const record = parsedRecord ?? {};
  const id = readPendingField(record, "id");
  const title = readPendingField(record, "title") || undefined;
  const height = clampArtifactHeightPx(record.height ?? record.heightPx);
  return {
    id,
    ...(title ? { title } : {}),
    ...(height !== undefined ? { height } : {}),
  };
}

/**
 * Serializes an `InkadeArtifactFencePayload` into canonical YAML for ```inkade-artifact blocks.
 */
export function serializeInkadeArtifactPayload(payload: {
  readonly id: string;
  readonly title?: string | undefined;
  readonly height?: number | undefined;
}): string {
  const obj: Record<string, string | number> = {
    id: payload.id.trim(),
  };
  const title = payload.title?.trim();
  if (title) {
    obj.title = title;
  }
  const height = clampArtifactHeightPx(payload.height);
  if (height !== undefined) {
    obj.height = height;
  }
  return stringifyYaml(obj, { lineWidth: 0 }).trimEnd();
}

/**
 * Formats a complete ```inkade-artifact fenced Markdown block.
 */
export function formatInkadeArtifactFence(payload: {
  readonly id: string;
  readonly title?: string | undefined;
  readonly height?: number | undefined;
}): string {
  const body = serializeInkadeArtifactPayload({
    id: payload.id,
    title: payload.title,
    height: payload.height ?? ARTIFACT_DEFAULT_HEIGHT_PX,
  });
  const fence = chooseFenceMarker(body);
  return `${fence}${INKADE_ARTIFACT_FENCE_LANG}\n${body}\n${fence}`;
}

/**
 * Extracts all valid ```inkade-artifact fenced code blocks via remark AST,
 * ignoring fake fences nested inside outer code blocks.
 */
export function extractArtifactBlocks(markdown: string): readonly InkadeArtifactBlock[] {
  if (typeof markdown !== "string" || !markdown.includes(INKADE_ARTIFACT_FENCE_LANG)) {
    return [];
  }
  const tree = parseAst(markdown);
  const blocks: InkadeArtifactBlock[] = [];

  function walk(node: Nodes): void {
    if (node.type === "code") {
      if ((node.lang ?? "").trim().toLowerCase() === INKADE_ARTIFACT_FENCE_LANG) {
        const startOffset = node.position?.start.offset;
        const endOffset = node.position?.end.offset;
        if (startOffset !== undefined && endOffset !== undefined) {
          const rawBody = node.value ?? "";
          const payload = parseInkadeArtifactPayload(rawBody);
          if (payload.id) {
            blocks.push({
              ...payload,
              startOffset,
              endOffset,
              rawFence: markdown.slice(startOffset, endOffset),
              rawBody,
            });
          }
        }
      }
      return;
    }

    if ("children" in node && Array.isArray(node.children)) {
      for (const child of node.children) {
        walk(child);
      }
    }
  }

  walk(tree);
  return blocks;
}

/**
 * Replaces ```inkade-artifact fenced blocks with safe static `fallbackMarkdown`
 * (or a clean title fallback when an artifact record is unavailable), leaving
 * nested code examples untouched via remark AST offsets.
 */
export function replaceInkadeArtifactFencesWithFallback(
  markdown: string,
  artifactsById: ReadonlyMap<
    string,
    { readonly title?: string | undefined; readonly fallbackMarkdown: string }
  >,
): string {
  const blocks = extractArtifactBlocks(markdown);
  if (blocks.length === 0) {
    return markdown;
  }

  const sorted = [...blocks].sort((a, b) => b.startOffset - a.startOffset);
  let output = markdown;
  for (const block of sorted) {
    const matched = artifactsById.get(block.id);
    const fallback = matched?.fallbackMarkdown?.trim();
    const title = (matched?.title ?? block.title ?? "").trim();
    const replacement = fallback
      ? fallback
      : title
        ? `> **${title}**`
        : "";
    output = `${output.slice(0, block.startOffset)}${replacement}${output.slice(block.endOffset)}`;
  }
  return output;
}
