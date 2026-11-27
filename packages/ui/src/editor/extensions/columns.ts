import { mergeAttributes, Node } from "@tiptap/react";

const COL_SEPARATOR = "<!-- inkade:col -->";

export const InkadeColumnExtension = Node.create({
  name: "inkadeColumn",
  content: "block+",
  isolating: true,
  markdownTokenName: "inkadeColumn",

  parseHTML() {
    return [{ tag: 'div[data-type="inkade-column"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "inkade-column",
        class: "inkade-editor-column",
      }),
      0,
    ];
  },

  renderMarkdown(node, h) {
    return h.renderChildren(node, "\n\n").trim();
  },
});

export const InkadeColumnsExtension = Node.create({
  name: "inkadeColumns",
  group: "block",
  content: "inkadeColumn{2}",
  isolating: true,
  markdownTokenName: "inkadeColumns",

  parseHTML() {
    return [{ tag: 'div[data-type="inkade-columns"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "inkade-columns",
        class: "inkade-editor-columns",
      }),
      0,
    ];
  },

  markdownTokenizer: {
    name: "inkadeColumns",
    level: "block",
    start(src: string) {
      return src.search(/^(?:<!--\s*inkade:columns\s*-->|:::columns\b)/m);
    },
    tokenize(src: string, _tokens, helpers) {
      const htmlMatch =
        /^<!--\s*inkade:columns\s*-->\s*\n([\s\S]*?)\n<!--\s*\/inkade:columns\s*-->(?:\s*\n+|$)/.exec(
          src,
        );
      if (htmlMatch) {
        const body = htmlMatch[1] ?? "";
        const rawCols = body.split(/\n*<!--\s*inkade:col\s*-->\n*/);
        const leftMd = (rawCols[0] ?? "").trim();
        const rightMd = (rawCols.slice(1).join("\n\n") || "").trim();
        return {
          type: "inkadeColumns",
          raw: htmlMatch[0],
          leftTokens: leftMd ? helpers.blockTokens(`${leftMd}\n`) : [],
          rightTokens: rightMd ? helpers.blockTokens(`${rightMd}\n`) : [],
          tokens: [],
        };
      }

      const fenceMatch =
        /^:::columns\s*\n:::col(?:umn)?\s*\n([\s\S]*?)\n:::\s*\n:::col(?:umn)?\s*\n([\s\S]*?)\n:::\s*\n:::(?:\s*\n+|$)/.exec(
          src,
        );
      if (fenceMatch) {
        const leftMd = (fenceMatch[1] ?? "").trim();
        const rightMd = (fenceMatch[2] ?? "").trim();
        return {
          type: "inkadeColumns",
          raw: fenceMatch[0],
          leftTokens: leftMd ? helpers.blockTokens(`${leftMd}\n`) : [],
          rightTokens: rightMd ? helpers.blockTokens(`${rightMd}\n`) : [],
          tokens: [],
        };
      }

      return undefined;
    },
  },

  parseMarkdown(token, helpers) {
    const t = token as {
      leftTokens?: Parameters<typeof helpers.parseChildren>[0];
      rightTokens?: Parameters<typeof helpers.parseChildren>[0];
    };
    const leftChildren = helpers.parseChildren(t.leftTokens ?? []);
    const rightChildren = helpers.parseChildren(t.rightTokens ?? []);
    const leftCol = helpers.createNode(
      "inkadeColumn",
      {},
      leftChildren.length > 0 ? leftChildren : [helpers.createNode("paragraph", {}, [])],
    );
    const rightCol = helpers.createNode(
      "inkadeColumn",
      {},
      rightChildren.length > 0 ? rightChildren : [helpers.createNode("paragraph", {}, [])],
    );
    return helpers.createNode("inkadeColumns", {}, [leftCol, rightCol]);
  },

  renderMarkdown(node, h) {
    const columns = node.content ?? [];
    const parts = columns.map((col) => h.renderChildren(col, "\n\n").trim());
    const left = parts[0] ?? "";
    const right = parts[1] ?? "";
    return `<!-- inkade:columns -->\n\n${left}\n\n${COL_SEPARATOR}\n\n${right}\n\n<!-- /inkade:columns -->`;
  },
});
