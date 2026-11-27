import { matchHighlightAnchor, type AnchorSpec, type DocumentHighlight } from "@inkade/core";

export interface TextNodeSegment {
  readonly node: Text;
  readonly start: number;
  readonly end: number;
}

export interface DocumentTextIndex {
  readonly fullText: string;
  readonly segments: readonly TextNodeSegment[];
}

export interface ViewportRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface HighlightOverlayGeometry {
  readonly highlight: DocumentHighlight;
  readonly rects: readonly ViewportRect[];
  readonly anchorRect: ViewportRect;
}

const IGNORED_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "TEXTAREA",
  "INPUT",
  "SELECT",
  "OPTION",
  "SVG",
  "TEMPLATE",
]);

function isExcludedUiChrome(el: Element, allowInsideShadow: boolean): boolean {
  if (!allowInsideShadow && el.id === "inkade-clipper-root") return true;
  if (el.getAttribute?.("data-inkade-ui-chrome") === "true") return true;
  return false;
}

function isElementExcluded(
  el: Element | null,
  stopAt: Node,
  allowInsideShadow: boolean,
): boolean {
  let curr: Element | null = el;
  while (curr && curr !== stopAt) {
    if (isExcludedUiChrome(curr, allowInsideShadow)) return true;
    if (IGNORED_TAGS.has(curr.tagName.toUpperCase())) return true;
    curr = curr.parentElement;
  }
  return false;
}

/**
 * Walks visible DOM text nodes in document order (skipping scripts, inputs, and clipper UI chrome)
 * and builds a contiguous character-offset index for non-invasive W3C anchor resolution.
 */
export function buildDocumentTextIndex(
  root: Node,
  options?: { readonly allowInsideShadow?: boolean | undefined },
): DocumentTextIndex {
  const allowInsideShadow =
    options?.allowInsideShadow ??
    Boolean(root.nodeType === 1 && (root as Element).closest?.("#inkade-clipper-root"));
  const segments: TextNodeSegment[] = [];
  const parts: string[] = [];
  let cursor = 0;

  const walk = (node: Node) => {
    // Node.ELEMENT_NODE === 1
    if (node.nodeType === 1) {
      const el = node as Element;
      if (isExcludedUiChrome(el, allowInsideShadow)) return;
      if (IGNORED_TAGS.has(el.tagName.toUpperCase())) return;
      for (let i = 0; i < el.childNodes.length; i++) {
        const child = el.childNodes[i];
        if (child) walk(child);
      }
      return;
    }

    // Node.TEXT_NODE === 3
    if (node.nodeType === 3) {
      const text = node.textContent ?? "";
      if (text.length === 0) return;
      if (isElementExcluded(node.parentElement, root, allowInsideShadow)) return;
      const start = cursor;
      const end = start + text.length;
      segments.push({ node: node as Text, start, end });
      parts.push(text);
      cursor = end;
      return;
    }

    // Document / DocumentFragment
    for (let i = 0; i < node.childNodes.length; i++) {
      const child = node.childNodes[i];
      if (child) walk(child);
    }
  };

  walk(root);

  return {
    fullText: parts.join(""),
    segments,
  };
}

export interface ResolvedNodeOffsets {
  readonly startNode: Text;
  readonly startOffset: number;
  readonly endNode: Text;
  readonly endOffset: number;
}

/**
 * Resolves contiguous character offsets in `index` to exact `(TextNode, offset)` endpoints.
 */
export function resolveHighlightNodeOffsets(
  index: DocumentTextIndex,
  startOffset: number,
  endOffset: number,
): ResolvedNodeOffsets | null {
  if (index.segments.length === 0 || endOffset <= startOffset) return null;

  let startNode: Text | null = null;
  let startNodeOffset = 0;
  let endNode: Text | null = null;
  let endNodeOffset = 0;

  for (const seg of index.segments) {
    if (!startNode && startOffset >= seg.start && startOffset < seg.end) {
      startNode = seg.node;
      startNodeOffset = startOffset - seg.start;
    }
    if (endOffset > seg.start && endOffset <= seg.end) {
      endNode = seg.node;
      endNodeOffset = endOffset - seg.start;
      break;
    }
  }

  if (!startNode || !endNode) return null;
  return {
    startNode,
    startOffset: startNodeOffset,
    endNode,
    endOffset: endNodeOffset,
  };
}

/**
 * Maps a character span `[start, end)` in `index` onto a live DOM `Range`.
 */
export function mapOffsetSpanToRange(
  doc: Document,
  index: DocumentTextIndex,
  startOffset: number,
  endOffset: number,
): Range | null {
  const endpoints = resolveHighlightNodeOffsets(index, startOffset, endOffset);
  if (!endpoints) return null;

  try {
    const range = doc.createRange();
    range.setStart(endpoints.startNode, endpoints.startOffset);
    range.setEnd(endpoints.endNode, endpoints.endOffset);
    return range;
  } catch {
    return null;
  }
}

/**
 * Locates a W3C TextQuoteSelector highlight inside `rootNode ?? doc.body` without mutating DOM nodes.
 */
export function locateHighlightRange(
  doc: Document,
  anchor: AnchorSpec,
  prebuiltIndex?: DocumentTextIndex,
  rootNode?: Node | null,
): { readonly range: Range; readonly exact: boolean } | null {
  const targetRoot = rootNode ?? doc.body;
  if (!targetRoot) return null;
  const allowInsideShadow = Boolean(rootNode && rootNode !== doc.body);
  const index = prebuiltIndex ?? buildDocumentTextIndex(targetRoot, { allowInsideShadow });
  const match = matchHighlightAnchor(index.fullText, anchor);
  if (!match) return null;

  const range = mapOffsetSpanToRange(doc, index, match.start, match.end);
  if (!range) return null;
  return { range, exact: match.exact };
}

function mergeLineRects(rawRects: readonly ViewportRect[]): ViewportRect[] {
  const valid = rawRects.filter((r) => r.width >= 1 && r.height >= 1);
  if (valid.length <= 1) return valid;

  const sorted = [...valid].sort((a, b) =>
    Math.abs(a.top - b.top) <= 4 ? a.left - b.left : a.top - b.top,
  );
  const merged: ViewportRect[] = [];

  for (const rect of sorted) {
    const prev = merged[merged.length - 1];
    if (
      prev &&
      Math.abs(prev.top - rect.top) <= 4 &&
      Math.abs(prev.height - rect.height) <= 6 &&
      rect.left <= prev.left + prev.width + 2
    ) {
      const right = Math.max(prev.left + prev.width, rect.left + rect.width);
      const bottom = Math.max(prev.top + prev.height, rect.top + rect.height);
      const top = Math.min(prev.top, rect.top);
      const left = Math.min(prev.left, rect.left);
      merged[merged.length - 1] = {
        left,
        top,
        width: right - left,
        height: bottom - top,
      };
    } else {
      merged.push(rect);
    }
  }
  return merged;
}

/**
 * Computes viewport rectangles for all highlights under `rootNode ?? doc.body`.
 */
export function computeHighlightGeometries(
  doc: Document,
  highlights: readonly DocumentHighlight[],
  rootNode?: Node | null,
): HighlightOverlayGeometry[] {
  const targetRoot = rootNode ?? doc.body;
  if (!targetRoot || highlights.length === 0) return [];
  const allowInsideShadow = Boolean(rootNode && rootNode !== doc.body);
  const index = buildDocumentTextIndex(targetRoot, { allowInsideShadow });
  const results: HighlightOverlayGeometry[] = [];

  for (const highlight of highlights) {
    const located = locateHighlightRange(
      doc,
      {
        quote: highlight.quote,
        prefixContext: highlight.prefixContext,
        suffixContext: highlight.suffixContext,
      },
      index,
      targetRoot,
    );
    if (!located) continue;
    const rawList = Array.from(located.range.getClientRects?.() ?? []).map((r) => ({
      left: r.left,
      top: r.top,
      width: r.width,
      height: r.height,
    }));
    const rects = mergeLineRects(rawList);
    if (rects.length === 0) continue;

    results.push({
      highlight,
      rects,
      anchorRect: rects[0]!,
    });
  }

  return results;
}
