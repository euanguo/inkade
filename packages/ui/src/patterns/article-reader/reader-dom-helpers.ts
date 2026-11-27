import type { DocumentRecord, SelectionAnchor } from "@inkade/core";

export type ReaderWorkspaceDoc = Pick<
  DocumentRecord,
  "id" | "title" | "slug" | "kind" | "spaceId" | "excerpt" | "tags"
>;

export interface FloatingSelectionState {
  readonly anchor: SelectionAnchor;
  readonly prefixContext: string;
  readonly suffixContext: string;
  readonly top: number;
  readonly left: number;
}

export interface TextSegmentEntry {
  readonly node: Text;
  readonly start: number;
  readonly end: number;
}

export function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  if (typeof window === "undefined") return null;
  let parent = el?.parentElement ?? null;
  while (parent) {
    if (parent.getAttribute("data-slot") === "scroll-area-viewport") {
      return parent;
    }
    const style = window.getComputedStyle(parent);
    if (style.overflowY === "auto" || style.overflowY === "scroll") {
      return parent;
    }
    parent = parent.parentElement;
  }
  return null;
}

export function scrollElementWithinScrollParent(
  el: HTMLElement | null | undefined,
  block: "start" | "center",
  offsetPx = 20,
): void {
  if (!el || typeof window === "undefined") return;
  const scrollParent = findScrollParent(el);
  if (!scrollParent) {
    el.scrollIntoView({ behavior: "smooth", block });
    return;
  }
  const parentRect = scrollParent.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  const nextTop =
    block === "center"
      ? scrollParent.scrollTop + (elRect.top - parentRect.top) - (parentRect.height - elRect.height) / 2
      : scrollParent.scrollTop + (elRect.top - parentRect.top) - offsetPx;
  scrollParent.scrollTo({ top: Math.max(0, nextTop), behavior: "smooth" });
}

export function computeReadingStats(
  markdown: string,
): { readonly wordCount: number; readonly minutes: number } {
  const plain = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/[#>*_\-[\]()!|]/g, " ")
    .trim();
  if (!plain) return { wordCount: 0, minutes: 1 };
  const cjkChars = (plain.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) ?? []).length;
  const nonCjk = plain.replace(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g, " ").trim();
  const latinWords = nonCjk ? nonCjk.split(/\s+/).filter(Boolean).length : 0;
  const total = cjkChars + latinWords;
  return {
    wordCount: total,
    minutes: Math.max(1, Math.ceil(total / 260)),
  };
}

export function findNearestHeadingSlug(
  node: Node | null,
  container: HTMLElement,
): string | undefined {
  let current: Node | null = node;
  while (current && current !== container) {
    if (current instanceof HTMLElement) {
      if (/^H[1-6]$/.test(current.tagName) && current.id) {
        return current.id;
      }
      let prev = current.previousElementSibling;
      while (prev) {
        if (/^H[1-6]$/.test(prev.tagName) && prev.id) {
          return prev.id;
        }
        prev = prev.previousElementSibling;
      }
    }
    current = current.parentNode;
  }
  return undefined;
}

export function unwrapInkadeMarks(container: HTMLElement): void {
  const marks = container.querySelectorAll("mark[data-inkade-dynamic-mark]");
  for (const mark of marks) {
    const parent = mark.parentNode;
    if (!parent) continue;
    while (mark.firstChild) {
      parent.insertBefore(mark.firstChild, mark);
    }
    parent.removeChild(mark);
    parent.normalize();
  }
}

export function collectTextSegments(container: HTMLElement): {
  readonly fullText: string;
  readonly segments: readonly TextSegmentEntry[];
} {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.closest("[data-inkade-ui-overlay]")) return NodeFilter.FILTER_REJECT;
      if (parent.closest(".katex")) return NodeFilter.FILTER_REJECT;
      return node.nodeValue ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });

  const segments: TextSegmentEntry[] = [];
  let fullText = "";
  let current = walker.nextNode();
  while (current) {
    const textNode = current as Text;
    const len = textNode.nodeValue?.length ?? 0;
    segments.push({ node: textNode, start: fullText.length, end: fullText.length + len });
    fullText += textNode.nodeValue ?? "";
    current = walker.nextNode();
  }
  return { fullText, segments };
}

export function wrapTextRangeWithMark(
  segments: readonly TextSegmentEntry[],
  matchStart: number,
  matchEnd: number,
  attrs: Readonly<Record<string, string>>,
): HTMLElement | null {
  let firstMark: HTMLElement | null = null;
  for (const seg of segments) {
    if (seg.end <= matchStart || seg.start >= matchEnd) continue;
    const localStart = Math.max(0, matchStart - seg.start);
    const localEnd = Math.min(seg.end - seg.start, matchEnd - seg.start);
    if (localEnd <= localStart) continue;

    try {
      const range = document.createRange();
      range.setStart(seg.node, localStart);
      range.setEnd(seg.node, localEnd);
      const mark = document.createElement("mark");
      mark.setAttribute("data-inkade-mark", "true");
      mark.setAttribute("data-inkade-dynamic-mark", "true");
      for (const [k, v] of Object.entries(attrs)) {
        mark.setAttribute(k, v);
      }
      range.surroundContents(mark);
      if (!firstMark) firstMark = mark;
    } catch {
      // Skip ranges crossing incompatible inline boundaries
    }
  }
  return firstMark;
}
