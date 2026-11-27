import type { Nodes, Root } from "mdast";
import { toString as mdastToString } from "mdast-util-to-string";
import { countTokens, decode, encode } from "gpt-tokenizer/encoding/cl100k_base";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { hashTextForEmbedding } from "./rag.ts";
import {
  INKADE_ARTIFACT_FENCE_LANG,
  parseInkadeArtifactPayload,
  trimReadableExcerpt,
} from "./markdown.ts";
import type { DocumentKind, OutlineNode } from "./types/index.ts";
import type { DocumentId, OutlineNodeId } from "./ids.ts";

export const DEFAULT_CHUNK_TARGET_TOKENS = 520;
export const DEFAULT_CHUNK_MIN_TOKENS = 400;
export const DEFAULT_CHUNK_MAX_TOKENS = 700;
export const DEFAULT_CHUNK_OVERLAP_RATIO = 0.15;

export interface ChunkingOptions {
  readonly minTokens?: number | undefined;
  readonly maxTokens?: number | undefined;
  readonly overlapRatio?: number | undefined;
}

export interface DocumentChunkDraft {
  readonly chunkIndex: number;
  readonly headingPath: string | null;
  readonly nodeId: OutlineNodeId | null;
  readonly tokenCount: number;
  readonly snippet: string;
  readonly contentText: string;
  readonly contentHash: string;
}

const markdownChunkParser = unified()
  .use(remarkParse)
  .use(remarkFrontmatter, ["yaml"])
  .use(remarkGfm);

/**
 * Counts exact BPE tokens using `cl100k_base` (via `gpt-tokenizer`).
 */
export function countBpeTokens(text: string): number {
  if (!text) return 0;
  return countTokens(text);
}

/**
 * Truncates text cleanly to at most `maxTokens` BPE tokens without splitting surrogate pairs.
 */
export function truncateToTokenBudget(text: string, maxTokens: number): string {
  const limit = Math.max(0, Math.floor(maxTokens));
  if (!text || limit === 0) return "";
  const ids = encode(text);
  if (ids.length <= limit) return text;
  const sliced = decode(ids.slice(0, limit));
  return sliced.replace(/\uFFFD+$/g, "").trimEnd();
}

function makeSnippet(text: string, maxChars = 200): string {
  return trimReadableExcerpt(text, maxChars);
}

/**
 * Normalizes a chunk, search, or briefing snippet by removing redundant title/heading
 * prefixes, leading hashtag dumps, internal `inkade://` URI templates, and broken
 * wikilink/markdown tails.
 */
export function cleanDisplaySnippet(
  rawText: string,
  options?: {
    readonly title?: string | undefined;
    readonly headingPath?: string | null | undefined;
    readonly maxLength?: number | undefined;
  },
): string {
  const maxLen = options?.maxLength ?? 200;
  let text = rawText.replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return "";

  const escapeRe = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const candidates = [options?.title?.trim(), options?.headingPath?.trim()].filter(
    (v): v is string => Boolean(v && v.length > 0),
  );

  // Strip repeated leading title / heading prefixes and standalone #tag bursts
  for (let pass = 0; pass < 4; pass++) {
    const before = text;
    for (const prefix of candidates) {
      const re = new RegExp(`^${escapeRe(prefix)}(?:[\\s:：·—-]+|$)`, "i");
      text = text.replace(re, "").trimStart();
    }
    text = text.replace(/^(?:#[\p{L}\p{N}_/-]+\s*)+(?=\S|$)/gu, "").trimStart();
    if (text === before) break;
  }

  // Strip coalesced section heading markers `[Parent > Child]`, trailing `[Citations]`,
  // literal wikilink wrappers `[[Title|Alias]]` -> Title/Alias, and embedded `[N]` ref numbers
  text = text.replace(/\[[^\]\n]+\s>\s[^\]\n]+\]\s*/g, " ");
  text = text.replace(/\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g, (_, target: string, alias?: string) =>
    (alias ?? target).trim(),
  );
  text = text.replace(/(?:^|\s)\[\d+\](?=\s|$)/g, " ");
  text = text.replace(/\s+([。，、；：！？])/g, "$1").replace(/\s+/g, " ").trim();
  text = text.replace(/^(?:\[Citations\]|Citations)\s*/i, "").trimStart();

  return trimReadableExcerpt(text, maxLen);
}

function splitLongTextByTokens(
  text: string,
  maxTokens: number,
  overlapTokens: number,
): string[] {
  const clean = text.trim();
  if (!clean) return [];
  const tokenIds = encode(clean);
  if (tokenIds.length <= maxTokens) {
    return [clean];
  }

  const safeMax = Math.max(32, maxTokens);
  const safeOverlap = Math.min(Math.max(0, overlapTokens), Math.floor(safeMax * 0.4));
  const step = Math.max(16, safeMax - safeOverlap);

  const pieces: string[] = [];
  for (let start = 0; start < tokenIds.length; start += step) {
    const end = Math.min(tokenIds.length, start + safeMax);
    const segment = decode(tokenIds.slice(start, end))
      .replace(/^\uFFFD+|\uFFFD+$/g, "")
      .trim();
    if (segment) {
      pieces.push(segment);
    }
    if (end >= tokenIds.length) {
      break;
    }
  }
  return pieces;
}

interface RawSemanticSection {
  readonly headingPath: string | null;
  readonly nodeId: OutlineNodeId | null;
  readonly blocks: readonly string[];
}

function extractNodePlainText(node: Nodes): string {
  if (node.type === "yaml") return "";
  if (node.type === "code") {
    const lang = (node.lang ?? "").trim().toLowerCase();
    if (lang === "inkade-view" || lang === "inkade_view" || lang === "inkade-pending") return "";
    if (lang === INKADE_ARTIFACT_FENCE_LANG || lang === "inkade_artifact") {
      const payload = parseInkadeArtifactPayload(node.value ?? "");
      return payload.title ? `[Artifact] ${payload.title}` : "";
    }
    const label = node.lang ? `[${node.lang}] ` : "";
    return `${label}${node.value}`.trim();
  }
  if (node.type === "list") {
    return node.children
      .map((item) => mdastToString(item).replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join(" · ");
  }
  if (node.type === "table") {
    return node.children
      .map((row) =>
        row.type === "tableRow"
          ? row.children
              .map((cell) => mdastToString(cell).replace(/\s+/g, " ").trim())
              .filter(Boolean)
              .join(" ")
          : mdastToString(row).replace(/\s+/g, " ").trim(),
      )
      .filter(Boolean)
      .join(" · ");
  }
  return mdastToString(node).replace(/\s+/g, " ").trim();
}

function extractMarkdownSections(markdown: string, docTitle: string): RawSemanticSection[] {
  const trimmed = markdown.trim();
  if (!trimmed) {
    return docTitle.trim()
      ? [{ headingPath: null, nodeId: null, blocks: [docTitle.trim()] }]
      : [];
  }

  const tree: Root = markdownChunkParser.parse(trimmed);
  const sections: Array<{
    headingPath: string | null;
    blocks: string[];
  }> = [];

  const headingStack: Array<{ depth: number; text: string }> = [];
  let currentHeadingPath: string | null = null;
  let currentBlocks: string[] = [];

  const flushCurrent = () => {
    if (currentBlocks.length > 0) {
      sections.push({
        headingPath: currentHeadingPath,
        blocks: currentBlocks,
      });
      currentBlocks = [];
    }
  };

  for (const child of tree.children) {
    if (child.type === "yaml") continue;
    if (child.type === "heading") {
      const headingText = mdastToString(child).replace(/\s+/g, " ").trim();
      if (child.depth <= 3) {
        flushCurrent();
        while (
          headingStack.length > 0 &&
          (headingStack[headingStack.length - 1]?.depth ?? 0) >= child.depth
        ) {
          headingStack.pop();
        }
        if (headingText) {
          headingStack.push({ depth: child.depth, text: headingText });
        }
        currentHeadingPath =
          headingStack.length > 0 ? headingStack.map((h) => h.text).join(" > ") : null;
        if (headingText) {
          currentBlocks.push(headingText);
        }
      } else if (headingText) {
        currentBlocks.push(headingText);
      }
      continue;
    }

    const blockText = extractNodePlainText(child);
    if (blockText) {
      currentBlocks.push(blockText);
    }
  }
  flushCurrent();

  if (sections.length === 0 && docTitle.trim()) {
    return [{ headingPath: null, nodeId: null, blocks: [docTitle.trim()] }];
  }

  return sections.map((section) => ({
    headingPath: section.headingPath,
    nodeId: null,
    blocks: section.blocks,
  }));
}

function extractOutlineSubtreeSections(
  outlineNodes: readonly OutlineNode[],
): RawSemanticSection[] {
  const active = outlineNodes.filter((n) => n.deletedAt === null);
  if (active.length === 0) return [];

  const childrenByParent = new Map<string, OutlineNode[]>();
  const roots: OutlineNode[] = [];
  const activeIdSet = new Set(active.map((n) => n.id));

  for (const node of active) {
    if (!node.parentNodeId || !activeIdSet.has(node.parentNodeId)) {
      roots.push(node);
    } else {
      const list = childrenByParent.get(node.parentNodeId);
      if (list) list.push(node);
      else childrenByParent.set(node.parentNodeId, [node]);
    }
  }

  const sortNodes = (list: OutlineNode[]) =>
    list.sort((a, b) => a.orderKey.localeCompare(b.orderKey));
  sortNodes(roots);
  for (const list of childrenByParent.values()) {
    sortNodes(list);
  }

  const formatNodeLine = (node: OutlineNode, depth: number): string => {
    const indent = depth > 0 ? `${"  ".repeat(depth)}- ` : "- ";
    const checkPrefix =
      node.checked === true ? "[x] " : node.checked === false ? "[ ] " : "";
    const main = (node.contentText || node.contentMarkdown || "").replace(/\s+/g, " ").trim();
    const note = (node.noteText ?? node.noteMarkdown ?? "").replace(/\s+/g, " ").trim();
    if (!main && !note) return "";
    return note ? `${indent}${checkPrefix}${main}\n${"  ".repeat(depth + 1)}${note}` : `${indent}${checkPrefix}${main}`;
  };

  const collectLines = (node: OutlineNode, depth: number, out: string[]): void => {
    const line = formatNodeLine(node, depth);
    if (line) out.push(line);
    const children = childrenByParent.get(node.id) ?? [];
    for (const child of children) {
      collectLines(child, depth + 1, out);
    }
  };

  const sections: RawSemanticSection[] = [];
  for (const root of roots) {
    const rootLabel = (root.contentText || root.contentMarkdown).replace(/\s+/g, " ").trim();
    const blocks: string[] = [];
    collectLines(root, 0, blocks);
    if (blocks.length === 0) continue;
    sections.push({
      headingPath: rootLabel ? makeSnippet(rootLabel, 80) : null,
      nodeId: root.id,
      blocks,
    });
  }

  return sections;
}

function packSectionIntoChunks(
  section: RawSemanticSection,
  docTitle: string,
  tags: readonly string[],
  maxTokens: number,
  overlapTokens: number,
): Array<{
  readonly headingPath: string | null;
  readonly nodeId: OutlineNodeId | null;
  readonly contentText: string;
  readonly snippetText: string;
}> {
  const cleanTitle = docTitle.trim();
  let cleanHeading = section.headingPath ? section.headingPath.trim() : "";
  if (cleanTitle && cleanHeading) {
    const prefix = `${cleanTitle} > `;
    if (cleanHeading.toLowerCase().startsWith(prefix.toLowerCase())) {
      cleanHeading = cleanHeading.slice(prefix.length).trim();
    } else if (cleanHeading.toLowerCase() === cleanTitle.toLowerCase()) {
      cleanHeading = "";
    }
  }

  const prefixLines: string[] = [];
  if (cleanTitle) {
    prefixLines.push(cleanTitle);
  }
  if (cleanHeading) {
    prefixLines.push(cleanHeading);
  }
  if (tags.length > 0) {
    prefixLines.push(tags.map((t) => `#${t}`).join(" "));
  }
  const header = prefixLines.join("\n");
  const headerTokens = header ? countBpeTokens(`${header}\n`) : 0;
  const bodyBudget = Math.max(120, maxTokens - headerTokens);

  const chunks: Array<{
    readonly headingPath: string | null;
    readonly nodeId: OutlineNodeId | null;
    readonly contentText: string;
    readonly snippetText: string;
  }> = [];

  const toSnippetSource = (rawBody: string): string =>
    cleanDisplaySnippet(rawBody, {
      title: cleanTitle,
      headingPath: section.headingPath ?? cleanHeading,
      maxLength: 200,
    });

  let currentBlocks: string[] = [];
  let currentTokens = 0;

  const flushBlocks = () => {
    if (currentBlocks.length === 0) return;
    const body = currentBlocks.join("\n\n").trim();
    if (!body) {
      currentBlocks = [];
      currentTokens = 0;
      return;
    }
    const contentText = header ? `${header}\n\n${body}` : body;
    chunks.push({
      headingPath: section.headingPath,
      nodeId: section.nodeId,
      contentText,
      snippetText: toSnippetSource(body),
    });

    // Retain trailing ~15% overlap blocks for next chunk when continuing within same section.
    const overlapCarry: string[] = [];
    let overlapCount = 0;
    for (let i = currentBlocks.length - 1; i >= 0; i--) {
      const blk = currentBlocks[i] ?? "";
      const blkTokens = countBpeTokens(blk);
      if (overlapCount + blkTokens > overlapTokens && overlapCarry.length > 0) {
        break;
      }
      overlapCarry.unshift(blk);
      overlapCount += blkTokens;
      if (overlapCount >= overlapTokens) break;
    }
    currentBlocks = overlapCarry;
    currentTokens = overlapCount;
  };

  for (const block of section.blocks) {
    const blockTokens = countBpeTokens(block);
    if (blockTokens > bodyBudget) {
      if (currentBlocks.length > 0) {
        flushBlocks();
        currentBlocks = [];
        currentTokens = 0;
      }
      const splits = splitLongTextByTokens(block, bodyBudget, overlapTokens);
      for (const piece of splits) {
        const contentText = header ? `${header}\n\n${piece}` : piece;
        chunks.push({
          headingPath: section.headingPath,
          nodeId: section.nodeId,
          contentText,
          snippetText: toSnippetSource(piece),
        });
      }
      continue;
    }

    if (currentTokens + blockTokens > bodyBudget && currentBlocks.length > 0) {
      flushBlocks();
      // Ensure the newly added block does not overflow after overlap carry
      while (currentTokens + blockTokens > bodyBudget && currentBlocks.length > 0) {
        const removed = currentBlocks.shift() ?? "";
        currentTokens = Math.max(0, currentTokens - countBpeTokens(removed));
      }
    }

    currentBlocks.push(block);
    currentTokens += blockTokens;
  }

  if (currentBlocks.length > 0) {
    const body = currentBlocks.join("\n\n").trim();
    if (body) {
      const contentText = header ? `${header}\n\n${body}` : body;
      const lastChunk = chunks[chunks.length - 1];
      if (!lastChunk || lastChunk.contentText !== contentText) {
        chunks.push({
          headingPath: section.headingPath,
          nodeId: section.nodeId,
          contentText,
          snippetText: toSnippetSource(body),
        });
      }
    }
  }

  return chunks;
}

/**
 * Splits an Inkade document (Markdown article/clip or Outline subtree) into semantic BPE-bounded chunks
 * targeting 400–700 tokens with ~15% overlap while preserving `headingPath` and `nodeId` anchors.
 */
export function chunkDocumentContent(
  input: {
    readonly docId?: DocumentId | undefined;
    readonly title: string;
    readonly kind: DocumentKind;
    readonly contentMarkdown: string;
    readonly contentText?: string | undefined;
    readonly tags?: readonly string[] | undefined;
    readonly outlineNodes?: readonly OutlineNode[] | undefined;
    readonly pdfPages?: readonly { readonly page: number; readonly text: string }[] | undefined;
  },
  options?: ChunkingOptions,
): readonly DocumentChunkDraft[] {
  const minTokens = Math.max(64, options?.minTokens ?? DEFAULT_CHUNK_MIN_TOKENS);
  const maxTokens = Math.max(minTokens, options?.maxTokens ?? DEFAULT_CHUNK_MAX_TOKENS);
  const overlapRatio = Math.min(0.4, Math.max(0, options?.overlapRatio ?? DEFAULT_CHUNK_OVERLAP_RATIO));
  const overlapTokens = Math.round(maxTokens * overlapRatio);
  const tags = input.tags ?? [];

  let rawSections: RawSemanticSection[] = [];
  if (input.kind === "outline" && input.outlineNodes && input.outlineNodes.length > 0) {
    rawSections = extractOutlineSubtreeSections(input.outlineNodes);
  }
  if (rawSections.length === 0) {
    const mdSource = input.contentMarkdown.trim() || (input.contentText ?? "").trim();
    rawSections = extractMarkdownSections(mdSource, input.title);
  }
  if (input.pdfPages && input.pdfPages.length > 0) {
    for (const pdfPage of input.pdfPages) {
      const clean = pdfPage.text.replace(/\s+/g, " ").trim();
      if (!clean) continue;
      rawSections.push({
        headingPath: `Page ${pdfPage.page}`,
        nodeId: null,
        blocks: [clean],
      });
    }
  }

  // Coalesce consecutive tiny sections (keeping distinct sections if combining would exceed minTokens..maxTokens).
  const coalesced: RawSemanticSection[] = [];
  for (const sec of rawSections) {
    const secText = sec.blocks.join("\n");
    const secTokens = countBpeTokens(secText);
    const prev = coalesced[coalesced.length - 1];
    if (
      prev &&
      secTokens < Math.floor(minTokens * 0.45) &&
      countBpeTokens(prev.blocks.join("\n")) + secTokens <= maxTokens - 60 &&
      prev.nodeId === sec.nodeId &&
      !prev.headingPath?.startsWith("Page ") &&
      !sec.headingPath?.startsWith("Page ")
    ) {
      coalesced[coalesced.length - 1] = {
        headingPath: prev.headingPath ?? sec.headingPath,
        nodeId: prev.nodeId ?? sec.nodeId,
        blocks: [
          ...prev.blocks,
          ...(sec.headingPath && sec.headingPath !== prev.headingPath
            ? [`[${sec.headingPath}]`, ...sec.blocks]
            : sec.blocks),
        ],
      };
    } else {
      coalesced.push(sec);
    }
  }

  const expanded: Array<{
    readonly headingPath: string | null;
    readonly nodeId: OutlineNodeId | null;
    readonly contentText: string;
    readonly snippetText: string;
  }> = [];

  for (const sec of coalesced) {
    expanded.push(...packSectionIntoChunks(sec, input.title, tags, maxTokens, overlapTokens));
  }

  if (expanded.length === 0 && input.title.trim()) {
    const fallbackText = [input.title.trim(), ...tags.map((t) => `#${t}`)].join("\n");
    expanded.push({
      headingPath: null,
      nodeId: null,
      contentText: fallbackText,
      snippetText: "",
    });
  }

  return expanded.map((item, chunkIndex) => ({
    chunkIndex,
    headingPath: item.headingPath,
    nodeId: item.nodeId,
    tokenCount: countBpeTokens(item.contentText),
    snippet: makeSnippet(item.snippetText),
    contentText: item.contentText,
    contentHash: hashTextForEmbedding(item.contentText),
  }));
}
