import type { HighlightColor } from "@inkade/core";
import { Mark, mergeAttributes } from "@tiptap/react";

function normalizeHighlightColor(raw: unknown): HighlightColor {
  const value = (typeof raw === "string" ? raw : "amber").toLowerCase();
  if (value === "emerald" || value === "blue" || value === "rose") {
    return value;
  }
  return "amber";
}

export const InkadeHighlightMark = Mark.create({
  name: "inkadeHighlight",
  markdownTokenName: "inkadeHighlight",

  addAttributes() {
    return {
      color: { default: "amber" satisfies HighlightColor },
    };
  },

  parseHTML() {
    return [
      {
        tag: "mark[data-inkade-mark]",
        getAttrs: (el) => {
          if (typeof el === "string") return false;
          return { color: normalizeHighlightColor(el.getAttribute("data-color")) };
        },
      },
      {
        tag: "mark",
        getAttrs: (el) => {
          if (typeof el === "string") return false;
          return { color: normalizeHighlightColor(el.getAttribute("data-color")) };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const color = normalizeHighlightColor(HTMLAttributes.color);
    return [
      "mark",
      mergeAttributes(HTMLAttributes, {
        "data-inkade-mark": "true",
        "data-color": color,
      }),
      0,
    ];
  },

  markdownTokenizer: {
    name: "inkadeHighlight",
    level: "inline",
    start(src: string) {
      const eqIdx = src.indexOf("==");
      const markIdx = src.search(/<mark\b[^>]*data-inkade-mark/i);
      if (eqIdx === -1) return markIdx;
      if (markIdx === -1) return eqIdx;
      return Math.min(eqIdx, markIdx);
    },
    tokenize(src: string, _tokens, helpers) {
      const htmlMatch =
        /^<mark\b[^>]*data-inkade-mark=["']true["'][^>]*data-color=["'](amber|emerald|blue|rose)["'][^>]*>([\s\S]+?)<\/mark>/i.exec(
          src,
        ) ??
        /^<mark\b[^>]*data-color=["'](amber|emerald|blue|rose)["'][^>]*data-inkade-mark=["']true["'][^>]*>([\s\S]+?)<\/mark>/i.exec(
          src,
        );
      if (htmlMatch && htmlMatch[2]) {
        return {
          type: "inkadeHighlight",
          raw: htmlMatch[0],
          color: normalizeHighlightColor(htmlMatch[1]),
          tokens: helpers.inlineTokens(htmlMatch[2]),
        };
      }

      const eqMatch = /^==(?!=)(?!\s)([^\n=]|[^\n=][^\n]*?[^\s=])==/.exec(src);
      if (eqMatch && eqMatch[1]) {
        return {
          type: "inkadeHighlight",
          raw: eqMatch[0],
          color: "amber" satisfies HighlightColor,
          tokens: helpers.inlineTokens(eqMatch[1]),
        };
      }
      return undefined;
    },
  },

  parseMarkdown(token, helpers) {
    const color = normalizeHighlightColor((token as { color?: string }).color);
    return helpers.applyMark(
      "inkadeHighlight",
      helpers.parseInline(token.tokens ?? []),
      { color },
    );
  },

  renderMarkdown(node, h) {
    const color = normalizeHighlightColor(node.attrs?.color);
    const inner = h.renderChildren(node);
    if (color === "amber") {
      return `==${inner}==`;
    }
    return `<mark data-inkade-mark="true" data-color="${color}">${inner}</mark>`;
  },
});
