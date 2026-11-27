import type { Node as PMNode } from "@tiptap/pm/model";
import { PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { getOutlineItemAttrs } from "../outline-schema.ts";
import { findEnclosingOutlineItem } from "./pm-helpers.ts";

export const outlineDecoPluginKey = new PluginKey("inkadeOutlineDecorations");

const HIDDEN_MARKDOWN_DELIMITER_CLASS =
  "text-[0px] leading-none text-transparent opacity-0 select-none pointer-events-none";

function overlapsRange(ranges: readonly [number, number][], start: number, end: number): boolean {
  return ranges.some(([a, b]) => start < b && end > a);
}

export function buildLivePreviewDecorations(
  doc: PMNode,
  selFrom: number,
  selTo: number,
  metaSlots: Map<string, HTMLElement>,
  needsMetaSlot: (attrs: ReturnType<typeof getOutlineItemAttrs>) => boolean,
  highlightedNodeId: string | null | undefined,
  emptyLineHint: string | null,
): DecorationSet {
  const decorations: Decoration[] = [];

  if (selFrom >= 0 && selFrom <= doc.content.size) {
    const activeEnclosing = findEnclosingOutlineItem(doc.resolve(selFrom));
    if (activeEnclosing) {
      decorations.push(
        Decoration.node(
          activeEnclosing.itemPos,
          activeEnclosing.itemPos + activeEnclosing.item.nodeSize,
          { "data-focused": "true" },
        ),
      );
      if (
        emptyLineHint &&
        selFrom === selTo &&
        !activeEnclosing.isNote &&
        activeEnclosing.textNode.type.name === "outlineParagraph" &&
        activeEnclosing.textNode.textContent.length === 0
      ) {
        decorations.push(
          Decoration.node(
            activeEnclosing.textPos,
            activeEnclosing.textPos + activeEnclosing.textNode.nodeSize,
            { "data-empty-hint": emptyLineHint },
          ),
        );
      }
    }
  }

  doc.descendants((node, pos) => {
    if (node.type.name === "outlineItem") {
      const attrs = getOutlineItemAttrs(node.attrs);
      const keyId = attrs.nodeId;

      if (highlightedNodeId && keyId === highlightedNodeId) {
        decorations.push(
          Decoration.node(pos, pos + node.nodeSize, {
            class:
              "rounded-lg bg-brand-subtle/35 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--primary)_48%,transparent)]",
          }),
        );
      }

      if (keyId && needsMetaSlot(attrs)) {
        const para = node.child(0);
        const afterParaPos = pos + 1 + para.nodeSize;
        decorations.push(
          Decoration.widget(
            afterParaPos,
            () => {
              let host = metaSlots.get(keyId);
              if (!host) {
                host = document.createElement("div");
                host.className = "inkade-pm-meta-host";
                metaSlots.set(keyId, host);
              }
              return host;
            },
            { side: -1, key: `meta:${keyId}` },
          ),
        );
      }
      return true;
    }

    if (node.type.name !== "outlineParagraph" && node.type.name !== "outlineNote") {
      return true;
    }

    const text = node.textContent;
    if (!text) return false;
    const textStart = pos + 1;
    const occupied: Array<[number, number]> = [];
    const cursorInside = (s: number, e: number): boolean =>
      selFrom <= textStart + e && selTo >= textStart + s;

    const pushHiddenDelimited = (
      from: number,
      to: number,
      attrs: Record<string, string>,
      openEnd: number,
      closeStart: number,
    ) => {
      if (openEnd > from) {
        decorations.push(
          Decoration.inline(from, openEnd, {
            class: HIDDEN_MARKDOWN_DELIMITER_CLASS,
          }),
        );
      }
      if (closeStart > openEnd) {
        decorations.push(Decoration.inline(openEnd, closeStart, attrs));
      }
      if (to > closeStart) {
        decorations.push(
          Decoration.inline(closeStart, to, {
            class: HIDDEN_MARKDOWN_DELIMITER_CLASS,
          }),
        );
      }
    };

    // 1. Inline code `...`
    const codeRegex = /`([^`\n]+)`/g;
    let m: RegExpExecArray | null;
    while ((m = codeRegex.exec(text)) !== null) {
      const s = m.index;
      const e = s + m[0].length;
      if (overlapsRange(occupied, s, e)) continue;
      occupied.push([s, e]);
      const attrs = {
        class: "rounded bg-muted px-1 py-0.5 font-mono text-[0.88em] text-foreground",
      };
      if (cursorInside(s, e)) {
        decorations.push(Decoration.inline(textStart + s, textStart + e, attrs));
      } else {
        pushHiddenDelimited(textStart + s, textStart + e, attrs, textStart + s + 1, textStart + e - 1);
      }
    }

    // 2. Markdown links [label](url) including inkade://pdf and inkade://doc deep links
    const linkRegex = /\[([^\]\n]+)\]\(((?:https?:\/\/|inkade:\/\/)[^\s)]+)\)/g;
    while ((m = linkRegex.exec(text)) !== null) {
      const s = m.index;
      const e = s + m[0].length;
      if (overlapsRange(occupied, s, e)) continue;
      occupied.push([s, e]);
      const labelLen = (m[1] ?? "").length;
      const url = m[2] ?? "";
      const isPdfCitation = url.startsWith("inkade://pdf/");
      const isDocBlockLink = url.startsWith("inkade://doc/");
      const attrs: Record<string, string> = isPdfCitation
        ? {
            class:
              "inline [box-decoration-break:clone] rounded-sm border border-amber-500/35 bg-amber-500/12 px-1 py-[1px] text-amber-800 underline decoration-amber-500/45 underline-offset-2 cursor-pointer dark:text-amber-300",
            "data-inkade-pdf-citation": url,
          }
        : isDocBlockLink
          ? {
              class:
                "inline [box-decoration-break:clone] rounded-sm border border-teal-500/35 bg-teal-500/12 px-1 py-[1px] text-teal-800 underline decoration-teal-500/45 underline-offset-2 cursor-pointer dark:text-teal-300",
              "data-inkade-doc-block": url,
            }
          : {
              class:
                "text-primary underline decoration-primary/45 underline-offset-2 cursor-pointer",
              "data-external-url": url,
            };
      if (cursorInside(s, e)) {
        decorations.push(Decoration.inline(textStart + s, textStart + e, attrs));
      } else {
        pushHiddenDelimited(
          textStart + s,
          textStart + e,
          attrs,
          textStart + s + 1,
          textStart + s + 1 + labelLen,
        );
      }
    }

    // 3. Wikilinks [[target]] / [[target|alias]]
    const wikiRegex = /\[\[([^[\]\n]+)\]\]/g;
    while ((m = wikiRegex.exec(text)) !== null) {
      const s = m.index;
      const e = s + m[0].length;
      if (overlapsRange(occupied, s, e)) continue;
      occupied.push([s, e]);
      const inner = (m[1] ?? "").trim();
      const pipeIdx = inner.indexOf("|");
      const targetPart = (pipeIdx >= 0 ? inner.slice(0, pipeIdx) : inner).trim();
      const hashIdx = targetPart.indexOf("#");
      const targetDoc = (hashIdx >= 0 ? targetPart.slice(0, hashIdx) : targetPart).trim();
      const attrs = {
        class:
          "inline [box-decoration-break:clone] rounded-sm bg-brand-subtle/75 px-1 py-[1px] text-brand-subtle-foreground underline decoration-primary/40 underline-offset-2 cursor-pointer",
        "data-wikilink": targetDoc,
      };
      if (cursorInside(s, e)) {
        decorations.push(Decoration.inline(textStart + s, textStart + e, attrs));
      } else {
        pushHiddenDelimited(textStart + s, textStart + e, attrs, textStart + s + 2, textStart + e - 2);
      }
    }

    // 4. Block references / mirrors ((nodeId))
    const blockRefRegex = /\(\(([^()\n]+)\)\)/g;
    while ((m = blockRefRegex.exec(text)) !== null) {
      const s = m.index;
      const e = s + m[0].length;
      if (overlapsRange(occupied, s, e)) continue;
      occupied.push([s, e]);
      const refId = (m[1] ?? "").trim();
      decorations.push(
        Decoration.inline(textStart + s, textStart + e, {
          class:
            "rounded border border-teal-500/25 bg-teal-500/10 px-1 py-[1px] font-mono text-[0.85em] text-teal-700 dark:text-teal-300 cursor-pointer",
          "data-block-ref": refId,
        }),
      );
    }

    // 5. Bold **...**
    const boldRegex = /\*\*([^*\n]+)\*\*/g;
    while ((m = boldRegex.exec(text)) !== null) {
      const s = m.index;
      const e = s + m[0].length;
      if (overlapsRange(occupied, s, e)) continue;
      occupied.push([s, e]);
      const attrs = { class: "font-semibold text-foreground" };
      if (cursorInside(s, e)) {
        decorations.push(Decoration.inline(textStart + s, textStart + e, attrs));
      } else {
        pushHiddenDelimited(textStart + s, textStart + e, attrs, textStart + s + 2, textStart + e - 2);
      }
    }

    // 6. Italic *...*
    const italicRegex = /(^|[^*])\*([^*\n]+)\*(?!\*)/g;
    while ((m = italicRegex.exec(text)) !== null) {
      const leadLen = (m[1] ?? "").length;
      const s = m.index + leadLen;
      const e = m.index + m[0].length;
      if (overlapsRange(occupied, s, e)) continue;
      occupied.push([s, e]);
      const attrs = { class: "italic" };
      if (cursorInside(s, e)) {
        decorations.push(Decoration.inline(textStart + s, textStart + e, attrs));
      } else {
        pushHiddenDelimited(textStart + s, textStart + e, attrs, textStart + s + 1, textStart + e - 1);
      }
    }

    // 7. Strikethrough ~~...~~
    const strikeRegex = /~~([^~\n]+)~~/g;
    while ((m = strikeRegex.exec(text)) !== null) {
      const s = m.index;
      const e = s + m[0].length;
      if (overlapsRange(occupied, s, e)) continue;
      occupied.push([s, e]);
      const attrs = { class: "line-through text-muted-foreground" };
      if (cursorInside(s, e)) {
        decorations.push(Decoration.inline(textStart + s, textStart + e, attrs));
      } else {
        pushHiddenDelimited(textStart + s, textStart + e, attrs, textStart + s + 2, textStart + e - 2);
      }
    }

    // 8. Inline #tags styled with Bear TagPill palette
    const tagRegex = /(^|[\s(])#([a-zA-Z0-9_\u4e00-\u9fa5][a-zA-Z0-9_/\-\u4e00-\u9fa5]*)/g;
    while ((m = tagRegex.exec(text)) !== null) {
      const leadLen = (m[1] ?? "").length;
      const s = m.index + leadLen;
      const e = m.index + m[0].length;
      const tagName = m[2] ?? "";
      if (!tagName || overlapsRange(occupied, s, e)) continue;
      occupied.push([s, e]);
      decorations.push(
        Decoration.inline(textStart + s, textStart + e, {
          class:
            "mx-0.5 inline-block whitespace-nowrap rounded-sm border border-border/75 bg-muted/65 px-1.5 py-[1px] text-[0.85em] font-medium text-muted-foreground hover:bg-muted hover:text-foreground no-underline cursor-pointer align-baseline transition-colors duration-[var(--duration-micro)]",
          "data-outline-tag": tagName,
        }),
      );
    }

    return false;
  });

  return DecorationSet.create(doc, decorations);
}
