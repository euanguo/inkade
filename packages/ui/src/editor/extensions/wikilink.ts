import { mergeAttributes, Node, ReactNodeViewRenderer } from "@tiptap/react";
import type React from "react";
import { WikilinkNodeView } from "../node-views/WikilinkNodeView.tsx";

export interface InkadeWikilinkOptions {
  readonly onOpenWikilink?: ((target: string, event?: React.MouseEvent) => void) | undefined;
}

export const InkadeWikilinkExtension = Node.create<InkadeWikilinkOptions>({
  name: "inkadeWikilink",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  markdownTokenName: "inkadeWikilink",

  addOptions() {
    return {
      onOpenWikilink: undefined,
    };
  },

  addAttributes() {
    return {
      target: { default: "" },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-type="inkade-wikilink"]',
        getAttrs: (el) => {
          if (typeof el === "string") return false;
          return { target: el.getAttribute("data-target") ?? "" };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const target = String(HTMLAttributes.target ?? "");
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-type": "inkade-wikilink",
        "data-target": target,
      }),
      `[[${target}]]`,
    ];
  },

  renderText({ node }) {
    return `[[${String(node.attrs?.target ?? "")}]]`;
  },

  markdownTokenizer: {
    name: "inkadeWikilink",
    level: "inline",
    start(src: string) {
      let idx = src.indexOf("[[");
      while (idx !== -1) {
        if (!src.slice(idx).startsWith("[[ade:")) {
          return idx;
        }
        idx = src.indexOf("[[", idx + 2);
      }
      return -1;
    },
    tokenize(src: string) {
      if (src.startsWith("[[ade:")) return undefined;
      const match = /^\[\[([^[\]\n]+?)\]\]/.exec(src);
      if (!match || !match[1]) return undefined;
      return {
        type: "inkadeWikilink",
        raw: match[0],
        target: match[1],
        tokens: [],
      };
    },
  },

  parseMarkdown(token, helpers) {
    return helpers.createNode("inkadeWikilink", {
      target: String((token as { target?: string }).target ?? ""),
    });
  },

  renderMarkdown(node) {
    return `[[${String(node.attrs?.target ?? "")}]]`;
  },

  addNodeView() {
    return ReactNodeViewRenderer(WikilinkNodeView);
  },
});
