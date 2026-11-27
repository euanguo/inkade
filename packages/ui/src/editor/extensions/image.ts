import Image from "@tiptap/extension-image";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { ImageNodeView } from "../node-views/ImageNodeView.tsx";
import type { ImageAlignPreset, ImageWidthPreset } from "../types.ts";

function normalizeWidth(raw: unknown): ImageWidthPreset {
  if (raw === "sm" || raw === "md" || raw === "lg" || raw === "full") {
    return raw;
  }
  return "full";
}

function normalizeAlign(raw: unknown): ImageAlignPreset {
  if (raw === "left" || raw === "right") {
    return raw;
  }
  return "center";
}

export const InkadeImageExtension = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      widthPreset: {
        default: "full" satisfies ImageWidthPreset,
        parseHTML: (el) => normalizeWidth(el.getAttribute("data-width-preset")),
        renderHTML: (attrs) => ({
          "data-width-preset": normalizeWidth(attrs.widthPreset),
        }),
      },
      align: {
        default: "center" satisfies ImageAlignPreset,
        parseHTML: (el) => normalizeAlign(el.getAttribute("data-align")),
        renderHTML: (attrs) => ({
          "data-align": normalizeAlign(attrs.align),
        }),
      },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageNodeView);
  },

  markdownTokenizer: {
    name: "image",
    level: "block",
    start(src: string) {
      return src.search(/^<!--\s*inkade:image\b/m);
    },
    tokenize(src: string) {
      // Allow escaped brackets (`\[v2\]`) as well as one level of balanced brackets (`[v2]`) in alt text without backtracking ambiguity.
      const match =
        /^<!--\s*inkade:image\s+([^>]*?)-->[ \t]*\n![ \t]*\[((?:\\.|\[(?:\\.|[^[\]\\\n])*\]|[^[\]\\\n])*)\]\(([^)\s]+)(?:\s+"([^"\n]*)")?\)[ \t]*(?:\n+|$)/.exec(
          src,
        );
      if (!match) return undefined;
      const meta = match[1] ?? "";
      const widthMatch = /\bwidth=(sm|md|lg|full)\b/.exec(meta);
      const alignMatch = /\balign=(left|center|right)\b/.exec(meta);
      const rawAlt = match[2] ?? "";
      const alt = rawAlt.replace(/\\([\\[\]])/g, "$1");
      const href = match[3] ?? "";
      const title = match[4] ?? "";
      return {
        type: "image",
        raw: match[0],
        href,
        text: alt,
        title: title || undefined,
        widthPreset: normalizeWidth(widthMatch?.[1]),
        align: normalizeAlign(alignMatch?.[1]),
      };
    },
  },

  parseMarkdown(token, helpers) {
    const extra = token as {
      href?: unknown;
      title?: unknown;
      text?: unknown;
      widthPreset?: unknown;
      align?: unknown;
    };
    const rawText = typeof extra.text === "string" ? extra.text : "";
    const alt = rawText.replace(/\\([\\[\]])/g, "$1");
    return helpers.createNode("image", {
      src: typeof extra.href === "string" ? extra.href : "",
      title: typeof extra.title === "string" ? extra.title : undefined,
      alt,
      widthPreset: normalizeWidth(extra.widthPreset),
      align: normalizeAlign(extra.align),
    });
  },

  renderMarkdown(node) {
    const src = String(node.attrs?.src ?? "");
    const rawAlt = String(node.attrs?.alt ?? "");
    const escapedAlt = rawAlt.replace(/([\\[\]])/g, "\\$1");
    const title = String(node.attrs?.title ?? "");
    const escapedTitle = title ? ` "${title.replace(/"/g, '\\"')}"` : "";
    const widthPreset = normalizeWidth(node.attrs?.widthPreset);
    const align = normalizeAlign(node.attrs?.align);
    const mdImage = `![${escapedAlt}](${src}${escapedTitle})`;
    if (widthPreset === "full" && align === "center") {
      return mdImage;
    }
    return `<!-- inkade:image width=${widthPreset} align=${align} -->\n${mdImage}`;
  },
}).configure({
  inline: false,
  allowBase64: true,
});
