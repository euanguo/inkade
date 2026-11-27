import { mergeAttributes, Node, ReactNodeViewRenderer } from "@tiptap/react";
import { InkadeSpeakerNoteNodeView } from "../node-views/InkadeSpeakerNoteNodeView.tsx";

function normalizeSpeakerNoteAttr(rawBody: string): string {
  const normalized = rawBody.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  while (lines.length > 0 && lines[0]?.trim() === "") lines.shift();
  while (lines.length > 0 && lines[lines.length - 1]?.trim() === "") lines.pop();
  if (lines.length === 0) return "";
  let minIndent = Number.POSITIVE_INFINITY;
  for (const line of lines) {
    if (!line.trim()) continue;
    const match = /^([ \t]*)/.exec(line);
    const indentLen = match?.[1]?.length ?? 0;
    if (indentLen < minIndent) minIndent = indentLen;
  }
  const stripLen = Number.isFinite(minIndent) ? minIndent : 0;
  return lines
    .map((line) => (line.length >= stripLen ? line.slice(stripLen).trimEnd() : line.trimEnd()))
    .join("\n")
    .trim();
}

export const InkadeSpeakerNoteExtension = Node.create({
  name: "inkadeSpeakerNote",
  group: "block",
  atom: true,
  selectable: true,
  markdownTokenName: "inkadeSpeakerNote",

  addAttributes() {
    return {
      note: { default: "" },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="inkade-speaker-note"]',
        getAttrs: (el) => {
          if (typeof el === "string") return false;
          return {
            note: el.getAttribute("data-note") ?? "",
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const note = String(HTMLAttributes.note ?? "");
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "inkade-speaker-note",
        "data-note": note,
      }),
    ];
  },

  markdownTokenizer: {
    name: "inkadeSpeakerNote",
    level: "block",
    start(src: string) {
      return src.search(/^[ \t]*<!--\s*notes\s*:/im);
    },
    tokenize(src: string) {
      const match = /^[ \t]*<!--\s*notes\s*:([\s\S]*?)-->[ \t]*(?:\r?\n+|$)/i.exec(src);
      if (!match) return undefined;
      return {
        type: "inkadeSpeakerNote",
        raw: match[0],
        note: normalizeSpeakerNoteAttr(match[1] ?? ""),
        tokens: [],
      };
    },
  },

  parseMarkdown(token, helpers) {
    return helpers.createNode("inkadeSpeakerNote", {
      note: String((token as { note?: string }).note ?? ""),
    });
  },

  renderMarkdown(node) {
    const note = String(node.attrs?.note ?? "").trim();
    if (!note) return "";
    if (note.includes("\n")) {
      return `<!-- notes:\n${note}\n-->`;
    }
    return `<!-- notes: ${note} -->`;
  },

  addNodeView() {
    return ReactNodeViewRenderer(InkadeSpeakerNoteNodeView);
  },
});
