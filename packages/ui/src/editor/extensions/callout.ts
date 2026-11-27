import { mergeAttributes, Node, ReactNodeViewRenderer } from "@tiptap/react";
import type { GfmCalloutKind } from "../../patterns/remark-inkade-wikilinks.ts";
import { CalloutNodeView } from "../node-views/CalloutNodeView.tsx";

export const CALLOUT_KINDS: readonly GfmCalloutKind[] = [
  "note",
  "tip",
  "important",
  "warning",
  "caution",
];

function normalizeCalloutKind(raw: unknown): GfmCalloutKind {
  const lower = (typeof raw === "string" ? raw : "note").toLowerCase();
  if (lower === "tip" || lower === "important" || lower === "warning" || lower === "caution") {
    return lower;
  }
  return "note";
}

export const InkadeCalloutExtension = Node.create({
  name: "inkadeCallout",
  group: "block",
  content: "block+",
  defining: true,
  markdownTokenName: "inkadeCallout",

  addAttributes() {
    return {
      kind: { default: "note" satisfies GfmCalloutKind },
      title: { default: "" },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="inkade-callout"]',
        getAttrs: (el) => {
          if (typeof el === "string") return false;
          return {
            kind: normalizeCalloutKind(el.getAttribute("data-callout") ?? el.getAttribute("kind")),
            title: el.getAttribute("data-title") ?? "",
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const title = typeof HTMLAttributes.title === "string" ? HTMLAttributes.title : "";
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "inkade-callout",
        "data-callout": normalizeCalloutKind(HTMLAttributes.kind),
        ...(title ? { "data-title": title } : {}),
      }),
      0,
    ];
  },

  markdownTokenizer: {
    name: "inkadeCallout",
    level: "block",
    start(src: string) {
      return src.search(/^>\s*\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/im);
    },
    tokenize(src: string, _tokens, helpers) {
      const match =
        /^(>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]([^\n]*)(?:\n>[ \t]?[^\n]*)*)(?:\n+|$)/i.exec(
          src,
        );
      if (!match || !match[1]) return undefined;
      const kind = normalizeCalloutKind(match[2]);
      const title = (match[3] ?? "").trim();
      const bodyLines = match[1]
        .split("\n")
        .slice(1)
        .map((line) => line.replace(/^>[ \t]?/, ""));
      const bodyMarkdown = bodyLines.join("\n").trim();
      return {
        type: "inkadeCallout",
        raw: match[0],
        kind,
        title,
        tokens: bodyMarkdown ? helpers.blockTokens(`${bodyMarkdown}\n`) : [],
      };
    },
  },

  parseMarkdown(token, helpers) {
    const kind = normalizeCalloutKind((token as { kind?: string }).kind);
    const title = typeof (token as { title?: unknown }).title === "string"
      ? (token as { title: string }).title
      : "";
    const parsedChildren = helpers.parseChildren(token.tokens ?? []);
    return helpers.createNode(
      "inkadeCallout",
      { kind, title },
      parsedChildren.length > 0 ? parsedChildren : [helpers.createNode("paragraph", {}, [])],
    );
  },

  renderMarkdown(node, h) {
    const kind = normalizeCalloutKind(node.attrs?.kind).toUpperCase();
    const title = typeof node.attrs?.title === "string" ? node.attrs.title.trim() : "";
    const header = title ? `> [!${kind}] ${title}` : `> [!${kind}]`;
    const inner = h.renderChildren(node, "\n\n").trim();
    if (!inner) return header;
    const quoted = inner
      .split("\n")
      .map((line) => (line.length > 0 ? `> ${line}` : ">"))
      .join("\n");
    return `${header}\n${quoted}`;
  },

  addNodeView() {
    return ReactNodeViewRenderer(CalloutNodeView);
  },
});
