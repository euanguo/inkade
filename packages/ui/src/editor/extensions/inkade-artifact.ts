import {
  formatInkadeArtifactFence,
  INKADE_ARTIFACT_FENCE_LANG,
  parseInkadeArtifactPayload,
} from "@inkade/core";
import { mergeAttributes, Node, ReactNodeViewRenderer } from "@tiptap/react";
import { InkadeArtifactNodeView } from "../node-views/InkadeArtifactNodeView.tsx";

export const InkadeArtifactExtension = Node.create({
  name: "inkadeArtifact",
  group: "block",
  atom: true,
  selectable: true,
  markdownTokenName: "inkadeArtifact",

  addAttributes() {
    return {
      artifactId: { default: "" },
      title: { default: "" },
      height: { default: undefined },
    };
  },

  parseHTML() {
    return [
      {
        tag: `div[data-type="${INKADE_ARTIFACT_FENCE_LANG}"]`,
        getAttrs: (el) => {
          if (typeof el === "string") return false;
          const heightRaw = el.getAttribute("data-height");
          const parsedHeight = heightRaw ? Number(heightRaw) : undefined;
          return {
            artifactId: el.getAttribute("data-artifact-id") ?? "",
            title: el.getAttribute("data-title") ?? "",
            height:
              parsedHeight !== undefined && Number.isFinite(parsedHeight) && parsedHeight > 0
                ? parsedHeight
                : undefined,
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const artifactId = String(HTMLAttributes.artifactId ?? "");
    const title = String(HTMLAttributes.title ?? "");
    const heightRaw: unknown = HTMLAttributes.height;
    const height =
      typeof heightRaw === "number" && Number.isFinite(heightRaw) && heightRaw > 0
        ? String(Math.round(heightRaw))
        : undefined;
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": INKADE_ARTIFACT_FENCE_LANG,
        "data-artifact-id": artifactId,
        "data-title": title,
        ...(height ? { "data-height": height } : {}),
      }),
    ];
  },

  markdownTokenizer: {
    name: "inkadeArtifact",
    level: "block",
    start(src: string) {
      return src.search(/^```inkade-artifact\b/m);
    },
    tokenize(src: string) {
      const match = /^```inkade-artifact[ \t]*\r?\n([\s\S]*?)```(?:\s*\r?\n+|$)/.exec(src);
      if (!match) return undefined;
      const body = (match[1] ?? "").replace(/\r?\n$/, "");
      const payload = parseInkadeArtifactPayload(body);
      return {
        type: "inkadeArtifact",
        raw: match[0],
        artifactId: payload.id,
        title: payload.title ?? "",
        height: payload.height,
        tokens: [],
      };
    },
  },

  parseMarkdown(token, helpers) {
    const parsed = token as { artifactId?: string; title?: string; height?: number };
    return helpers.createNode("inkadeArtifact", {
      artifactId: String(parsed.artifactId ?? ""),
      title: String(parsed.title ?? ""),
      height: parsed.height,
    });
  },

  renderMarkdown(node) {
    return formatInkadeArtifactFence({
      id: String(node.attrs?.artifactId ?? ""),
      ...(typeof node.attrs?.title === "string" && node.attrs.title.trim()
        ? { title: node.attrs.title.trim() }
        : {}),
      ...(typeof node.attrs?.height === "number" && Number.isFinite(node.attrs.height)
        ? { height: node.attrs.height }
        : {}),
    });
  },

  addNodeView() {
    return ReactNodeViewRenderer(InkadeArtifactNodeView);
  },
});
