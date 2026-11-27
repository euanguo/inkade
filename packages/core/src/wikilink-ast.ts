// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- load ambient module types for untyped micromark-extension-wiki-link across workspace tsconfigs
/// <reference path="./vendor-wikilink.d.ts" />
import type { Nodes } from "mdast";
import { fromMarkdown as wikiLinkFromMarkdown, toMarkdown as wikiLinkToMarkdown } from "mdast-util-wiki-link";
import { syntax as wikiLinkSyntax } from "micromark-extension-wiki-link";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified, type Processor } from "unified";

export interface ParsedObsidianWikiLink {
  readonly startOffset: number;
  readonly endOffset: number;
  readonly isEmbed: boolean;
  readonly target: string;
  readonly anchor: string | null;
  readonly alias: string | null;
  readonly raw: string;
}

interface WikiLinkMdastNode {
  readonly type: "wikiLink";
  readonly value?: string;
  readonly data?: {
    readonly alias?: string;
  };
  readonly position?: {
    readonly start?: { readonly offset?: number };
    readonly end?: { readonly offset?: number };
  };
}

function remarkObsidianWikiLinks(this: Processor): void {
  const data = this.data() as Record<string, unknown>;
  const micromarkExtensions =
    (data.micromarkExtensions as unknown[] | undefined) ?? (data.micromarkExtensions = []);
  const fromMarkdownExtensions =
    (data.fromMarkdownExtensions as unknown[] | undefined) ??
    (data.fromMarkdownExtensions = []);
  const toMarkdownExtensions =
    (data.toMarkdownExtensions as unknown[] | undefined) ?? (data.toMarkdownExtensions = []);

  micromarkExtensions.push(wikiLinkSyntax({ aliasDivider: "|" }));
  fromMarkdownExtensions.push(wikiLinkFromMarkdown());
  toMarkdownExtensions.push(wikiLinkToMarkdown({ aliasDivider: "|" }));
}

const obsidianWikiLinkProcessor = unified()
  .use(remarkParse)
  .use(remarkFrontmatter, ["yaml"])
  .use(remarkGfm)
  .use(remarkObsidianWikiLinks);

function splitTargetAndAnchor(rawTarget: string): {
  readonly target: string;
  readonly anchor: string | null;
} {
  const hashIdx = rawTarget.indexOf("#");
  if (hashIdx < 0) {
    return { target: rawTarget.trim(), anchor: null };
  }
  const target = rawTarget.slice(0, hashIdx).trim();
  const anchorRaw = rawTarget.slice(hashIdx + 1).trim();
  return {
    target,
    anchor: anchorRaw.length > 0 ? anchorRaw : null,
  };
}

function isWikiLinkNode(node: unknown): node is WikiLinkMdastNode {
  return Boolean(node) && typeof node === "object" && (node as { type?: string }).type === "wikiLink";
}

function walkWikiLinks(
  node: Nodes | WikiLinkMdastNode,
  visit: (link: WikiLinkMdastNode) => void,
  visitEmbedText?: (textNode: {
    readonly value: string;
    readonly startOffset: number;
  }) => void,
): void {
  if (isWikiLinkNode(node)) {
    visit(node);
    return;
  }
  if (node.type === "code" || node.type === "inlineCode" || node.type === "html") {
    return;
  }
  if (
    node.type === "text" &&
    visitEmbedText &&
    typeof node.value === "string" &&
    typeof node.position?.start?.offset === "number"
  ) {
    visitEmbedText({
      value: node.value,
      startOffset: node.position.start.offset,
    });
    return;
  }
  if ("children" in node && Array.isArray(node.children)) {
    for (const child of node.children) {
      walkWikiLinks(child, visit, visitEmbedText);
    }
  }
}

/**
 * Parses Obsidian `[[target#anchor|alias]]` and `![[asset]]` embeds from Markdown AST
 * via `micromark-extension-wiki-link` + `mdast-util-wiki-link` (ignoring fenced/inline code).
 */
export function parseObsidianWikiLinks(markdown: string): ParsedObsidianWikiLink[] {
  if (!markdown || !markdown.includes("[[")) {
    return [];
  }

  const tree = obsidianWikiLinkProcessor.parse(markdown);
  const byStartOffset = new Map<number, ParsedObsidianWikiLink>();

  walkWikiLinks(
    tree,
    (node) => {
      const rawStart = node.position?.start?.offset;
      const rawEnd = node.position?.end?.offset;
      if (typeof rawStart !== "number" || typeof rawEnd !== "number" || rawEnd <= rawStart) {
        return;
      }

      const isEmbed = rawStart > 0 && markdown[rawStart - 1] === "!";
      const startOffset = isEmbed ? rawStart - 1 : rawStart;
      const endOffset = rawEnd;
      const raw = markdown.slice(startOffset, endOffset);

      const inner = raw.slice(isEmbed ? 3 : 2, -2);
      const pipeIdx = inner.indexOf("|");
      const targetPart = (pipeIdx >= 0 ? inner.slice(0, pipeIdx) : inner).trim();
      const aliasRaw = pipeIdx >= 0 ? inner.slice(pipeIdx + 1).trim() : "";
      const { target, anchor } = splitTargetAndAnchor(targetPart);
      if (!target && !anchor) {
        return;
      }

      byStartOffset.set(startOffset, {
        startOffset,
        endOffset,
        isEmbed,
        target,
        anchor,
        alias: aliasRaw.length > 0 ? aliasRaw : null,
        raw,
      });
    },
    (textNode) => {
      // micromark CommonMark image parser consumes `![` before wikiLinkSyntax; recover embeds strictly inside AST text nodes
      if (!textNode.value.includes("![[")) return;
      const embedRegex = /!\[\[([^[\]\n]+)\]\]/g;
      let match: RegExpExecArray | null;
      while ((match = embedRegex.exec(textNode.value)) !== null) {
        const startOffset = textNode.startOffset + match.index;
        const raw = match[0];
        const endOffset = startOffset + raw.length;
        const inner = (match[1] ?? "").trim();
        const pipeIdx = inner.indexOf("|");
        const targetPart = (pipeIdx >= 0 ? inner.slice(0, pipeIdx) : inner).trim();
        const aliasRaw = pipeIdx >= 0 ? inner.slice(pipeIdx + 1).trim() : "";
        const { target, anchor } = splitTargetAndAnchor(targetPart);
        if (!target && !anchor) continue;
        if (!byStartOffset.has(startOffset)) {
          byStartOffset.set(startOffset, {
            startOffset,
            endOffset,
            isEmbed: true,
            target,
            anchor,
            alias: aliasRaw.length > 0 ? aliasRaw : null,
            raw,
          });
        }
      }
    },
  );

  return [...byStartOffset.values()].sort((a, b) => a.startOffset - b.startOffset);
}

/**
 * Rewrites Obsidian `[[WikiLink]]` and `![[asset]]` tokens via descending-offset surgical AST edits.
 * Return `null` from `resolver` to leave a link unchanged.
 */
export function rewriteObsidianWikiLinks(
  markdown: string,
  resolver: (link: ParsedObsidianWikiLink) => string | null,
): { readonly markdown: string; readonly rewrittenCount: number } {
  const links = parseObsidianWikiLinks(markdown);
  if (links.length === 0) {
    return { markdown, rewrittenCount: 0 };
  }

  const edits: Array<{ readonly start: number; readonly end: number; readonly replacement: string }> = [];
  for (const link of links) {
    const replacement = resolver(link);
    if (replacement !== null && replacement !== link.raw) {
      edits.push({ start: link.startOffset, end: link.endOffset, replacement });
    }
  }

  if (edits.length === 0) {
    return { markdown, rewrittenCount: 0 };
  }

  edits.sort((a, b) => b.start - a.start);
  let output = markdown;
  for (const edit of edits) {
    output = `${output.slice(0, edit.start)}${edit.replacement}${output.slice(edit.end)}`;
  }
  return { markdown: output, rewrittenCount: edits.length };
}
