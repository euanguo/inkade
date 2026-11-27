import { mergeAttributes, Node, ReactNodeViewRenderer } from "@tiptap/react";
import { InkadeViewNodeView } from "../node-views/InkadeViewNodeView.tsx";

const DEFAULT_INKADE_VIEW_YAML = "mode: table\ncolumns:\n  - title\n  - updatedAt\nlimit: 12";

export const InkadeViewExtension = Node.create({
  name: "inkadeView",
  group: "block",
  atom: true,
  selectable: true,
  markdownTokenName: "inkadeView",

  addAttributes() {
    return {
      rawYaml: { default: DEFAULT_INKADE_VIEW_YAML },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="inkade-view"]',
        getAttrs: (el) => {
          if (typeof el === "string") return false;
          return {
            rawYaml: el.getAttribute("data-yaml") ?? DEFAULT_INKADE_VIEW_YAML,
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const rawYaml = String(HTMLAttributes.rawYaml ?? DEFAULT_INKADE_VIEW_YAML);
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "inkade-view",
        "data-yaml": rawYaml,
      }),
    ];
  },

  markdownTokenizer: {
    name: "inkadeView",
    level: "block",
    start(src: string) {
      return src.search(/^```inkade-view\b/m);
    },
    tokenize(src: string) {
      const match = /^```inkade-view[ \t]*\r?\n([\s\S]*?)```(?:\s*\r?\n+|$)/.exec(src);
      if (!match) return undefined;
      return {
        type: "inkadeView",
        raw: match[0],
        rawYaml: (match[1] ?? "").replace(/\r?\n$/, ""),
        tokens: [],
      };
    },
  },

  parseMarkdown(token, helpers) {
    return helpers.createNode("inkadeView", {
      rawYaml: String((token as { rawYaml?: string }).rawYaml ?? DEFAULT_INKADE_VIEW_YAML),
    });
  },

  renderMarkdown(node) {
    const rawYaml = String(node.attrs?.rawYaml ?? DEFAULT_INKADE_VIEW_YAML).trimEnd();
    return `\`\`\`inkade-view\n${rawYaml}\n\`\`\``;
  },

  addNodeView() {
    return ReactNodeViewRenderer(InkadeViewNodeView);
  },
});
