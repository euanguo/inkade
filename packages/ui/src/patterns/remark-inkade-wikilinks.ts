export interface MdastTextNode {
  type: "text";
  value: string;
}

export interface MdastLinkNode {
  type: "link";
  url: string;
  data?: { hProperties?: Record<string, unknown> } | undefined;
  children: MdastNode[];
}

export interface MdastParagraphNode {
  type: "paragraph";
  children: MdastNode[];
}

export interface MdastBlockquoteNode {
  type: "blockquote";
  data?: { hProperties?: Record<string, unknown> } | undefined;
  children: MdastNode[];
}

export interface MdastNode {
  type: string;
  value?: string;
  url?: string;
  data?: { hName?: string | undefined; hProperties?: Record<string, unknown> | undefined } | undefined;
  children?: MdastNode[];
}

export interface MdastRoot {
  type: "root";
  children: MdastNode[];
}

export interface ParsedWikilink {
  readonly raw: string;
  readonly target: string;
  readonly heading: string | null;
  readonly alias: string | null;
  readonly displayText: string;
  readonly fullTarget: string;
  readonly isAdeThread: boolean;
  readonly adeBindingId?: string | undefined;
  readonly adeKind?: string | undefined;
}

const WIKILINK_PATTERN = /\[\[([^[\]]+?)\]\]/g;
const CALLOUT_HEADER_PATTERN =
  /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:[ \t]+([^\n]+))?(?:\r?\n|$)/i;

const SKIPPED_NODE_TYPES = new Set([
  "code",
  "inlineCode",
  "html",
  "link",
  "linkReference",
  "definition",
  "math",
  "inlineMath",
]);

/**
 * Parses the inner text of `[[...]]` into target, optional heading anchor, and optional alias.
 * Also recognizes `[[ade:bindingId:adeKind|Title]]` inline ADE references.
 */
export function parseWikilinkInner(rawInner: string): ParsedWikilink | null {
  const inner = rawInner.trim();
  if (!inner) return null;

  const pipeIdx = inner.indexOf("|");
  const targetPart = (pipeIdx >= 0 ? inner.slice(0, pipeIdx) : inner).trim();
  const aliasRaw = pipeIdx >= 0 ? inner.slice(pipeIdx + 1).trim() : "";
  const alias = aliasRaw.length > 0 ? aliasRaw : null;

  if (targetPart.startsWith("ade:")) {
    const [, bindingId = "", adeKind = "any"] = targetPart.split(":");
    const displayText = alias ?? (bindingId || "ADE Thread");
    return {
      raw: `[[${rawInner}]]`,
      target: targetPart,
      heading: null,
      alias,
      displayText,
      fullTarget: targetPart,
      isAdeThread: true,
      adeBindingId: bindingId,
      adeKind,
    };
  }

  const hashIdx = targetPart.indexOf("#");
  const target = (hashIdx >= 0 ? targetPart.slice(0, hashIdx) : targetPart).trim();
  const headingRaw = hashIdx >= 0 ? targetPart.slice(hashIdx + 1).trim() : "";
  const heading = headingRaw.length > 0 ? headingRaw : null;

  if (!target) return null;

  const fullTarget = heading ? `${target}#${heading}` : target;
  const displayText = alias ?? (heading ? `${target} › ${heading}` : target);

  return {
    raw: `[[${rawInner}]]`,
    target,
    heading,
    alias,
    displayText,
    fullTarget,
    isAdeThread: false,
  };
}

function splitTextIntoWikilinkNodes(value: string): Array<MdastTextNode | MdastLinkNode> | null {
  if (!value.includes("[[")) return null;
  WIKILINK_PATTERN.lastIndex = 0;

  const nodes: Array<MdastTextNode | MdastLinkNode> = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let matchedAny = false;

  while ((match = WIKILINK_PATTERN.exec(value)) !== null) {
    const rawInner = match[1] ?? "";
    const parsed = parseWikilinkInner(rawInner);
    if (!parsed) continue;

    matchedAny = true;
    if (match.index > lastIndex) {
      nodes.push({ type: "text", value: value.slice(lastIndex, match.index) });
    }

    const url = parsed.isAdeThread
      ? `ade-thread:${encodeURIComponent(parsed.adeBindingId ?? "")}?kind=${encodeURIComponent(parsed.adeKind ?? "any")}&title=${encodeURIComponent(parsed.displayText)}`
      : `wikilink:${encodeURIComponent(parsed.fullTarget)}`;

    nodes.push({
      type: "link",
      url,
      data: {
        hProperties: {
          "data-wikilink": parsed.fullTarget,
          "data-wikilink-target": parsed.target,
          ...(parsed.heading ? { "data-wikilink-heading": parsed.heading } : {}),
          ...(parsed.alias ? { "data-wikilink-alias": parsed.alias } : {}),
        },
      },
      children: [{ type: "text", value: parsed.displayText }],
    });

    lastIndex = match.index + match[0].length;
  }

  if (!matchedAny) return null;

  if (lastIndex < value.length) {
    nodes.push({ type: "text", value: value.slice(lastIndex) });
  }
  return nodes;
}

function transformChildren(children: MdastNode[]): void {
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (!child || SKIPPED_NODE_TYPES.has(child.type)) continue;

    if (child.type === "text" && typeof child.value === "string") {
      const replacement = splitTextIntoWikilinkNodes(child.value);
      if (replacement) {
        children.splice(i, 1, ...replacement);
        i += replacement.length - 1;
      }
      continue;
    }

    if (Array.isArray(child.children)) {
      transformChildren(child.children);
    }
  }
}

/**
 * MIT remark AST plugin converting `[[Title]]` and `[[Title#Heading|Alias]]`
 * into interactive `wikilink:` AST nodes while ignoring fenced and inline code.
 */
export function remarkInkadeWikilinks(): (tree: MdastRoot) => void {
  return (tree: MdastRoot) => {
    if (!Array.isArray(tree.children)) return;
    transformChildren(tree.children);
  };
}

export type GfmCalloutKind = "note" | "tip" | "important" | "warning" | "caution";

function transformCalloutsInChildren(children: MdastNode[]): void {
  for (const child of children) {
    if (!child) continue;
    if (child.type === "blockquote" && Array.isArray(child.children)) {
      const bq = child as MdastBlockquoteNode;
      const firstPara = bq.children[0];
      if (firstPara && firstPara.type === "paragraph" && Array.isArray(firstPara.children)) {
        const para = firstPara as MdastParagraphNode;
        const firstInline = para.children[0];
        if (firstInline && firstInline.type === "text" && typeof firstInline.value === "string") {
          const match = CALLOUT_HEADER_PATTERN.exec(firstInline.value);
          if (match) {
            const kind = (match[1] ?? "note").toLowerCase() as GfmCalloutKind;
            const customTitle = match[2]?.trim();
            const remaining = firstInline.value.slice(match[0].length);
            if (remaining.length > 0) {
              firstInline.value = remaining;
            } else {
              para.children.shift();
              if (para.children[0]?.type === "break") {
                para.children.shift();
              }
            }
            if (para.children.length === 0) {
              bq.children.shift();
            }
            bq.data = {
              ...bq.data,
              hProperties: {
                ...(bq.data?.hProperties ?? {}),
                "data-callout": kind,
                ...(customTitle ? { "data-callout-title": customTitle } : {}),
              },
            };
          }
        }
      }
    }
    if (Array.isArray(child.children)) {
      transformCalloutsInChildren(child.children);
    }
  }
}

/**
 * MIT remark AST plugin converting GitHub-style `> [!NOTE|TIP|IMPORTANT|WARNING|CAUTION]`
 * blockquotes into structured semantic callout metadata for `ArticleReader`.
 */
export function remarkInkadeCallouts(): (tree: MdastRoot) => void {
  return (tree: MdastRoot) => {
    if (!Array.isArray(tree.children)) return;
    transformCalloutsInChildren(tree.children);
  };
}

const HIGHLIGHT_PATTERN = /==(?!=)(?!\s)([^\n=]|[^\n=][^\n]*?[^\s=])==/g;

function splitTextIntoHighlightNodes(value: string): MdastNode[] | null {
  if (!value.includes("==")) return null;
  HIGHLIGHT_PATTERN.lastIndex = 0;

  const nodes: MdastNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let matchedAny = false;

  while ((match = HIGHLIGHT_PATTERN.exec(value)) !== null) {
    const innerText = match[1];
    if (!innerText) continue;
    matchedAny = true;
    if (match.index > lastIndex) {
      nodes.push({ type: "text", value: value.slice(lastIndex, match.index) });
    }
    nodes.push({
      type: "emphasis",
      data: {
        hName: "mark",
        hProperties: {
          "data-inkade-mark": "true",
          "data-color": "amber",
        },
      },
      children: [{ type: "text", value: innerText }],
    });
    lastIndex = match.index + match[0].length;
  }

  if (!matchedAny) return null;
  if (lastIndex < value.length) {
    nodes.push({ type: "text", value: value.slice(lastIndex) });
  }
  return nodes;
}

function transformHighlightsInChildren(children: MdastNode[]): void {
  for (let i = 0; i < children.length; i += 1) {
    const child = children[i];
    if (!child || SKIPPED_NODE_TYPES.has(child.type)) continue;
    if (child.type === "text" && typeof child.value === "string") {
      const replacement = splitTextIntoHighlightNodes(child.value);
      if (replacement) {
        children.splice(i, 1, ...replacement);
        i += replacement.length - 1;
      }
      continue;
    }
    if (Array.isArray(child.children)) {
      transformHighlightsInChildren(child.children);
    }
  }
}

/**
 * MIT remark AST plugin converting `==highlighted text==` syntax into `<mark data-inkade-mark="true" data-color="amber">`
 * for parity between `ArticleEditor` and `ArticleReader`.
 */
export function remarkInkadeHighlights(): (tree: MdastRoot) => void {
  return (tree: MdastRoot) => {
    if (!Array.isArray(tree.children)) return;
    transformHighlightsInChildren(tree.children);
  };
}
