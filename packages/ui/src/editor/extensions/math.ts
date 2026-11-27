import { InputRule, mergeAttributes, Node, ReactNodeViewRenderer } from "@tiptap/react";
import { InlineMathNodeView } from "../node-views/InlineMathNodeView.tsx";
import { MathBlockNodeView } from "../node-views/MathBlockNodeView.tsx";

const CURRENCY_RANGE_LATEX_REGEX = /^\d+(?:[.,]\d+)?\s*[-/–—]\s*$/;
const INLINE_MATH_MULTI_INPUT_REGEX = /(?:^|[^\\$])(\$(?!\$)(?!\s)([^$\n]*?[^\s\\$])\$(?!\$))$/;
const INLINE_MATH_SINGLE_INPUT_REGEX = /(?:^|[^\\$])(\$([^\s$\\])\$(?!\$))$/;

export function isCurrencyRangeLatex(latex: string): boolean {
  return CURRENCY_RANGE_LATEX_REGEX.test(latex);
}

export const InkadeMathBlockExtension = Node.create({
  name: "inkadeMathBlock",
  group: "block",
  atom: true,
  selectable: true,
  markdownTokenName: "inkadeMathBlock",

  addAttributes() {
    return {
      latex: { default: "E = mc^2" },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="inkade-math-block"]',
        getAttrs: (el) => {
          if (typeof el === "string") return false;
          return { latex: el.getAttribute("data-latex") ?? "" };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const latex = String(HTMLAttributes.latex ?? "");
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "inkade-math-block",
        "data-latex": latex,
      }),
    ];
  },

  markdownTokenizer: {
    name: "inkadeMathBlock",
    level: "block",
    start(src: string) {
      return src.search(/^\$\$/m);
    },
    tokenize(src: string) {
      const match =
        /^\$\$\s*\n([\s\S]*?)\n\$\$(?:\s*\n+|$)/.exec(src) ??
        /^\$\$([^\n]+?)\$\$(?:\s*\n+|$)/.exec(src);
      if (!match) return undefined;
      return {
        type: "inkadeMathBlock",
        raw: match[0],
        latex: (match[1] ?? "").trim(),
        tokens: [],
      };
    },
  },

  parseMarkdown(token, helpers) {
    return helpers.createNode("inkadeMathBlock", {
      latex: String((token as { latex?: string }).latex ?? ""),
    });
  },

  renderMarkdown(node) {
    const latex = String(node.attrs?.latex ?? "");
    return `$$\n${latex}\n$$`;
  },

  addNodeView() {
    return ReactNodeViewRenderer(MathBlockNodeView);
  },
});

export const InkadeInlineMathExtension = Node.create({
  name: "inkadeInlineMath",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  markdownTokenName: "inkadeInlineMath",

  addAttributes() {
    return {
      latex: { default: "" },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-type="inkade-inline-math"]',
        getAttrs: (el) => {
          if (typeof el === "string") return false;
          return { latex: el.getAttribute("data-latex") ?? "" };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const latex = String(HTMLAttributes.latex ?? "");
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-type": "inkade-inline-math",
        "data-latex": latex,
      }),
      `$${latex}$`,
    ];
  },

  renderText({ node }) {
    return `$${String(node.attrs?.latex ?? "")}$`;
  },

  markdownTokenizer: {
    name: "inkadeInlineMath",
    level: "inline",
    start(src: string) {
      let idx = src.indexOf("$");
      while (idx !== -1) {
        const prev = idx > 0 ? src[idx - 1] : "";
        const next = src[idx + 1] ?? "";
        if (prev !== "\\" && next !== "$" && next !== "" && !/\s/.test(next)) {
          return idx;
        }
        idx = src.indexOf("$", idx + 1);
      }
      return -1;
    },
    tokenize(src: string) {
      const match =
        /^\$(?!\$)(?!\s)([^$\n]*?[^\s\\$])\$(?!\$)(?!\d)/.exec(src) ??
        /^\$([^\s$\\])\$(?!\$)(?!\d)/.exec(src);
      if (!match || !match[1]) return undefined;
      const latex = match[1];
      // Guard against currency ranges like "$5-$10" or "$100/$200"
      if (isCurrencyRangeLatex(latex)) {
        return undefined;
      }
      return {
        type: "inkadeInlineMath",
        raw: match[0],
        latex,
        tokens: [],
      };
    },
  },

  parseMarkdown(token, helpers) {
    return helpers.createNode("inkadeInlineMath", {
      latex: String((token as { latex?: string }).latex ?? ""),
    });
  },

  renderMarkdown(node) {
    const latex = String(node.attrs?.latex ?? "").trim();
    return latex ? `$${latex}$` : "";
  },

  addInputRules() {
    const createInlineMathRule = (find: RegExp) =>
      new InputRule({
        find,
        handler: ({ state, range, match }) => {
          const fullToken = match[1];
          const latex = match[2];
          if (!fullToken || !latex || isCurrencyRangeLatex(latex)) {
            return null;
          }
          if (state.selection.$from.parent.type.spec.code) {
            return null;
          }
          const tokenStart = range.to - fullToken.length;
          if (
            state.schema.marks.code &&
            state.doc.rangeHasMark(tokenStart, range.to, state.schema.marks.code)
          ) {
            return null;
          }
          const node = this.type.create({ latex });
          state.tr.replaceWith(tokenStart, range.to, node);
          return;
        },
      });

    return [
      createInlineMathRule(INLINE_MATH_MULTI_INPUT_REGEX),
      createInlineMathRule(INLINE_MATH_SINGLE_INPUT_REGEX),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(InlineMathNodeView);
  },
});
