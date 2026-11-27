import { mergeAttributes, Node, ReactNodeViewRenderer } from "@tiptap/react";
import { ToggleNodeView } from "../node-views/ToggleNodeView.tsx";

function unescapeSummary(raw: string): string {
  return raw
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}

export const InkadeToggleExtension = Node.create({
  name: "inkadeToggle",
  group: "block",
  content: "block+",
  defining: true,
  markdownTokenName: "inkadeToggle",

  addAttributes() {
    return {
      summary: { default: "" },
      open: { default: true },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'details[data-type="inkade-toggle"]',
        getAttrs: (el) => {
          if (typeof el === "string") return false;
          return {
            summary: el.getAttribute("data-summary") ?? "",
            open: el.getAttribute("data-open") !== "false",
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "details",
      mergeAttributes(HTMLAttributes, {
        "data-type": "inkade-toggle",
        "data-summary": String(HTMLAttributes.summary ?? ""),
        "data-open": HTMLAttributes.open === false ? "false" : "true",
      }),
      0,
    ];
  },

  markdownTokenizer: {
    name: "inkadeToggle",
    level: "block",
    start(src: string) {
      return src.search(/^<details(?:\s[^>]*)?>/im);
    },
    tokenize(src: string, _tokens, helpers) {
      const openMatch =
        /^<details(\s[^>]*)?>\s*\n?<summary>([\s\S]*?)<\/summary>\s*\n?/i.exec(src);
      if (!openMatch) return undefined;

      const attrs = openMatch[1] ?? "";
      const isOpen = !/\bdata-open=["']false["']/i.test(attrs);
      const summary = unescapeSummary(openMatch[2] ?? "");

      // Depth-count nested <details>...</details> pairs so nested toggles never prematurely close the outer block
      const tagRegex = /<\/?details\b[^>]*>/gi;
      tagRegex.lastIndex = openMatch[0].length;
      let depth = 1;
      let bodyEndIdx = -1;
      let rawEndIdx = -1;
      let tagMatch: RegExpExecArray | null;
      while ((tagMatch = tagRegex.exec(src)) !== null) {
        if (tagMatch[0].startsWith("</")) {
          depth -= 1;
          if (depth === 0) {
            bodyEndIdx = tagMatch.index;
            rawEndIdx = tagMatch.index + tagMatch[0].length;
            break;
          }
        } else {
          depth += 1;
        }
      }
      if (bodyEndIdx < 0 || rawEndIdx < 0) return undefined;

      const trailingWs = /^\s*(?:\n+|$)/.exec(src.slice(rawEndIdx));
      const fullRaw = src.slice(0, rawEndIdx + (trailingWs ? trailingWs[0].length : 0));
      const bodyMarkdown = src.slice(openMatch[0].length, bodyEndIdx).trim();

      return {
        type: "inkadeToggle",
        raw: fullRaw,
        summary,
        open: isOpen,
        tokens: bodyMarkdown ? helpers.blockTokens(`${bodyMarkdown}\n`) : [],
      };
    },
  },

  parseMarkdown(token, helpers) {
    const t = token as { summary?: string; open?: boolean };
    const parsedChildren = helpers.parseChildren(token.tokens ?? []);
    return helpers.createNode(
      "inkadeToggle",
      {
        summary: String(t.summary ?? ""),
        open: t.open ?? true,
      },
      parsedChildren.length > 0 ? parsedChildren : [helpers.createNode("paragraph", {}, [])],
    );
  },

  renderMarkdown(node, h) {
    const rawSummary = String(node.attrs?.summary ?? "");
    const safeSummary = rawSummary
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    const inner = h.renderChildren(node, "\n\n").trim();
    const openAttr = node.attrs?.open === false ? ' data-open="false"' : "";
    return `<details${openAttr}>\n<summary>${safeSummary}</summary>\n\n${inner}\n\n</details>`;
  },

  addNodeView() {
    return ReactNodeViewRenderer(ToggleNodeView);
  },
});
