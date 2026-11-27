import type { DocumentHighlight, HighlightId } from "@inkade/core";
import { Extension } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { matchHighlightAnchor } from "../../patterns/MarginaliaOverlay.tsx";

export const inkadeHighlightsDecorationKey = new PluginKey("inkadeHighlightsDecoration");

export interface HighlightsDecorationOptions {
  readonly getHighlights: () => readonly DocumentHighlight[];
  readonly getActiveHighlightId: () => HighlightId | null;
}

interface TextSegment {
  readonly pmStart: number;
  readonly textStart: number;
  readonly textEnd: number;
}

function buildHighlightDecorations(
  doc: PMNode,
  highlights: readonly DocumentHighlight[],
  activeHighlightId: HighlightId | null,
): DecorationSet {
  if (highlights.length === 0) return DecorationSet.empty;

  const segments: TextSegment[] = [];
  let fullText = "";
  let seenTextblock = false;

  doc.descendants((node, pos) => {
    if (node.isTextblock) {
      if (seenTextblock && fullText.length > 0 && !fullText.endsWith(" ")) {
        fullText += " ";
      }
      seenTextblock = true;
    }
    if (node.isText && node.text) {
      const len = node.text.length;
      segments.push({
        pmStart: pos,
        textStart: fullText.length,
        textEnd: fullText.length + len,
      });
      fullText += node.text;
    }
    return true;
  });

  if (!fullText) return DecorationSet.empty;

  const decorations: Decoration[] = [];
  for (const hl of highlights) {
    const match = matchHighlightAnchor(fullText, {
      quote: hl.quote,
      prefixContext: hl.prefixContext,
      suffixContext: hl.suffixContext,
    });
    if (!match) continue;

    for (const seg of segments) {
      if (seg.textEnd <= match.start || seg.textStart >= match.end) continue;
      const localStart = Math.max(0, match.start - seg.textStart);
      const localEnd = Math.min(seg.textEnd - seg.textStart, match.end - seg.textStart);
      if (localEnd <= localStart) continue;

      decorations.push(
        Decoration.inline(seg.pmStart + localStart, seg.pmStart + localEnd, {
          nodeName: "mark",
          "data-inkade-mark": "true",
          "data-highlight-id": hl.id,
          "data-color": hl.color,
          ...(activeHighlightId === hl.id ? { "data-active": "true" } : {}),
        }),
      );
    }
  }

  return DecorationSet.create(doc, decorations);
}

export const InkadeHighlightsDecorationExtension = Extension.create<HighlightsDecorationOptions>({
  name: "inkadeHighlightsDecoration",

  addOptions() {
    return {
      getHighlights: () => [],
      getActiveHighlightId: () => null,
    };
  },

  addProseMirrorPlugins() {
    const { getHighlights, getActiveHighlightId } = this.options;
    let cachedDoc: PMNode | null = null;
    let cachedHighlights: readonly DocumentHighlight[] | null = null;
    let cachedActiveId: string | null = null;
    let cachedDecos = DecorationSet.empty;

    return [
      new Plugin({
        key: inkadeHighlightsDecorationKey,
        props: {
          decorations(state) {
            const highlights = getHighlights();
            const activeId = getActiveHighlightId();
            if (
              cachedDoc === state.doc &&
              cachedHighlights === highlights &&
              cachedActiveId === activeId
            ) {
              return cachedDecos;
            }
            cachedDoc = state.doc;
            cachedHighlights = highlights;
            cachedActiveId = activeId;
            cachedDecos = buildHighlightDecorations(state.doc, highlights, activeId);
            return cachedDecos;
          },
        },
      }),
    ];
  },
});
