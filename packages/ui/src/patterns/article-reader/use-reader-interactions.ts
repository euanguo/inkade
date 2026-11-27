import type {
  AdeThreadBinding,
  DocumentHighlight,
  HighlightColor,
  HighlightId,
  ReaderTypographyPrefs,
  SelectionAnchor,
  TocEntry,
} from "@inkade/core";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { useCopyToClipboard, useEventListener } from "usehooks-ts";
import {
  type MarginaliaAnchorPosition,
  matchHighlightAnchor,
} from "../MarginaliaOverlay.tsx";
import {
  collectTextSegments,
  findNearestHeadingSlug,
  findScrollParent,
  type FloatingSelectionState,
  scrollElementWithinScrollParent,
  unwrapInkadeMarks,
  wrapTextRangeWithMark,
} from "./reader-dom-helpers.ts";

export interface UseReaderInteractionsOptions {
  readonly docId: string;
  readonly docTitle: string;
  readonly contentMarkdown: string;
  readonly renderedMarkdown: string;
  readonly toc: readonly TocEntry[];
  readonly showToc: boolean;
  readonly highlights: readonly DocumentHighlight[];
  readonly bindings: readonly AdeThreadBinding[];
  readonly prefs: ReaderTypographyPrefs;
  readonly enableKeyboardNav: boolean;
  readonly rootRef: React.RefObject<HTMLDivElement | null>;
  readonly proseRef: React.RefObject<HTMLDivElement | null>;
  readonly progressBarRef: React.RefObject<HTMLDivElement | null>;
  readonly onCreateHighlight?: ((input: {
    readonly quote: string;
    readonly prefixContext: string;
    readonly suffixContext: string;
    readonly color: HighlightColor;
    readonly noteMarkdown?: string;
  }) => void) | undefined;
  readonly onAskAgent?: ((anchor: SelectionAnchor) => void) | undefined;
  readonly onCopyQuoteLink?: ((anchor: SelectionAnchor) => void) | undefined;
}

export function useReaderInteractions({
  docId,
  docTitle,
  contentMarkdown,
  renderedMarkdown,
  toc,
  showToc,
  highlights,
  bindings,
  prefs,
  enableKeyboardNav,
  rootRef,
  proseRef,
  progressBarRef,
  onCreateHighlight,
  onAskAgent,
  onCopyQuoteLink,
}: UseReaderInteractionsOptions) {
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const [selectionState, setSelectionState] = useState<FloatingSelectionState | null>(null);
  const [noteComposerOpen, setNoteComposerOpen] = useState(false);
  const [noteInput, setNoteInput] = useState("");
  const [noteColor, setNoteColor] = useState<HighlightColor>("amber");
  const [anchorPositions, setAnchorPositions] = useState<readonly MarginaliaAnchorPosition[]>([]);
  const [activeHighlightId, setActiveHighlightId] = useState<HighlightId | null>(null);
  const [cursorIndex, setCursorIndex] = useState<number>(-1);

  const [, copyReaderQuoteToClipboard] = useCopyToClipboard();

  // Track reading scroll progress directly in the DOM without React re-renders
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof window === "undefined") return;

    const scrollParent = findScrollParent(el);
    let rafId = 0;

    const computeProgress = () => {
      rafId = 0;
      const bar = progressBarRef.current;
      if (!bar) return;
      let ratio = 0;
      if (scrollParent) {
        const max = scrollParent.scrollHeight - scrollParent.clientHeight;
        ratio = max > 0 ? Math.min(1, Math.max(0, scrollParent.scrollTop / max)) : 0;
      } else {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        ratio = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      }
      bar.style.transform = `scaleX(${ratio})`;
    };

    const scheduleProgress = () => {
      if (rafId !== 0) return;
      rafId = requestAnimationFrame(computeProgress);
    };

    computeProgress();
    const target: EventTarget = scrollParent ?? window;
    target.addEventListener("scroll", scheduleProgress, { passive: true });
    return () => {
      if (rafId !== 0) cancelAnimationFrame(rafId);
      target.removeEventListener("scroll", scheduleProgress);
    };
  }, [docId, progressBarRef, renderedMarkdown, rootRef]);

  // Sync active heading in right-rail TOC via IntersectionObserver only when internal TOC is visible
  useEffect(() => {
    const container = proseRef.current;
    if (!showToc || !container || toc.length === 0 || typeof IntersectionObserver === "undefined") {
      return;
    }

    const headings = [...container.querySelectorAll<HTMLElement>("h1[id], h2[id], h3[id], h4[id]")];
    if (headings.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        const firstVisible = visible[0];
        if (firstVisible?.target instanceof HTMLElement && firstVisible.target.id) {
          setActiveSlug(firstVisible.target.id);
        }
      },
      { rootMargin: "-72px 0px -65% 0px", threshold: [0, 1] },
    );

    for (const h of headings) {
      observer.observe(h);
    }
    return () => observer.disconnect();
  }, [proseRef, showToc, toc, renderedMarkdown]);

  // Apply persistent DOM highlights + measure vertical anchor positions for Marginalia rail
  useLayoutEffect(() => {
    const container = proseRef.current;
    if (!container) return;

    unwrapInkadeMarks(container);
    const hasQuotedBinding = bindings.some((b) => Boolean(b.selectionAnchor?.quote));
    if (highlights.length === 0 && !hasQuotedBinding) {
      setAnchorPositions((prev) => (prev.length === 0 ? prev : []));
      return;
    }

    const { fullText, segments } = collectTextSegments(container);
    const containerRect = container.getBoundingClientRect();

    interface PendingMarkWrap {
      readonly start: number;
      readonly end: number;
      readonly attrs: Readonly<Record<string, string>>;
      readonly kind: "highlight" | "binding";
      readonly id: string;
    }

    const wraps: PendingMarkWrap[] = [];
    for (const hl of highlights) {
      const match = matchHighlightAnchor(fullText, {
        quote: hl.quote,
        prefixContext: hl.prefixContext,
        suffixContext: hl.suffixContext,
      });
      if (!match) continue;
      wraps.push({
        start: match.start,
        end: match.end,
        kind: "highlight",
        id: hl.id,
        attrs: {
          "data-highlight-id": hl.id,
          "data-color": hl.color,
          ...(activeHighlightId === hl.id ? { "data-active": "true" } : {}),
        },
      });
    }

    for (const binding of bindings) {
      if (!binding.selectionAnchor?.quote) continue;
      const match = matchHighlightAnchor(fullText, {
        quote: binding.selectionAnchor.quote,
      });
      if (!match) continue;
      wraps.push({
        start: match.start,
        end: match.end,
        kind: "binding",
        id: binding.id,
        attrs: {
          "data-binding-id": binding.id,
          "data-color": "blue",
        },
      });
    }

    // Wrap from end of document backward so earlier offsets in shared Text nodes remain valid
    wraps.sort((a, b) => b.start - a.start || b.end - a.end);
    for (const w of wraps) {
      wrapTextRangeWithMark(segments, w.start, w.end, w.attrs);
    }

    const nextPositions: MarginaliaAnchorPosition[] = [];
    const seenKeys = new Set<string>();
    const renderedMarks = container.querySelectorAll<HTMLElement>(
      "mark[data-highlight-id], mark[data-binding-id]",
    );
    for (const mark of renderedMarks) {
      const hlId = mark.getAttribute("data-highlight-id");
      const bindId = mark.getAttribute("data-binding-id");
      const kind: "highlight" | "binding" | null = hlId ? "highlight" : bindId ? "binding" : null;
      const id = hlId ?? bindId;
      if (!kind || !id) continue;
      const key = `${kind}:${id}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      const rect = mark.getBoundingClientRect();
      nextPositions.push({
        kind,
        id,
        top: Math.max(0, rect.top - containerRect.top),
      });
    }

    setAnchorPositions((prev) => {
      if (
        prev.length === nextPositions.length &&
        prev.every(
          (p, i) =>
            p.kind === nextPositions[i]?.kind &&
            p.id === nextPositions[i]?.id &&
            Math.abs(p.top - (nextPositions[i]?.top ?? 0)) < 1,
        )
      ) {
        return prev;
      }
      return nextPositions;
    });

    return () => {
      unwrapInkadeMarks(container);
    };
  }, [highlights, bindings, renderedMarkdown, activeHighlightId, prefs, proseRef]);

  // Apply Readwise-style paragraph keyboard cursor attribute
  useEffect(() => {
    const container = proseRef.current;
    if (!container) return;
    const blocks = [
      ...container.querySelectorAll<HTMLElement>(
        ".inkade-prose > p, .inkade-prose > h1, .inkade-prose > h2, .inkade-prose > h3, .inkade-prose > h4, .inkade-prose > blockquote, .inkade-prose > ul > li, .inkade-prose > ol > li, .inkade-prose > .inkade-callout",
      ),
    ];
    for (const [idx, el] of blocks.entries()) {
      if (idx === cursorIndex) {
        el.setAttribute("data-reader-cursor", "true");
      } else {
        el.removeAttribute("data-reader-cursor");
      }
    }
  }, [cursorIndex, proseRef, renderedMarkdown]);

  const getCursorBlockAnchor = useCallback((): {
    readonly anchor: SelectionAnchor;
    readonly prefixContext: string;
    readonly suffixContext: string;
    readonly top: number;
  } | null => {
    const container = proseRef.current;
    if (!container || cursorIndex < 0) return null;
    const blocks = [
      ...container.querySelectorAll<HTMLElement>(
        ".inkade-prose > p, .inkade-prose > h1, .inkade-prose > h2, .inkade-prose > h3, .inkade-prose > h4, .inkade-prose > blockquote, .inkade-prose > ul > li, .inkade-prose > ol > li, .inkade-prose > .inkade-callout",
      ),
    ];
    const target = blocks[cursorIndex];
    if (!target) return null;
    const quote = (target.textContent ?? "").trim();
    if (!quote) return null;
    const headingSlug = findNearestHeadingSlug(target, container);
    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const startOffset = contentMarkdown.indexOf(quote);
    return {
      anchor: {
        quote,
        ...(headingSlug ? { headingSlug } : {}),
        ...(startOffset >= 0 ? { startOffset, endOffset: startOffset + quote.length } : {}),
      },
      prefixContext:
        startOffset > 0 ? contentMarkdown.slice(Math.max(0, startOffset - 64), startOffset) : "",
      suffixContext:
        startOffset >= 0
          ? contentMarkdown.slice(startOffset + quote.length, startOffset + quote.length + 64)
          : "",
      top: Math.max(0, targetRect.top - containerRect.top),
    };
  }, [contentMarkdown, cursorIndex, proseRef]);

  const onEnableKeyboardNavKeyDown = useCallback(
    (event: KeyboardEvent): void => {
      if (!enableKeyboardNav) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable ||
          target.closest("[role='dialog']"))
      ) {
        return;
      }

      const container = proseRef.current;
      if (!container) return;
      const blocks = [
        ...container.querySelectorAll<HTMLElement>(
          ".inkade-prose > p, .inkade-prose > h1, .inkade-prose > h2, .inkade-prose > h3, .inkade-prose > h4, .inkade-prose > blockquote, .inkade-prose > ul > li, .inkade-prose > ol > li, .inkade-prose > .inkade-callout",
        ),
      ];
      if (blocks.length === 0) return;

      if (event.key === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        const nextIdx = Math.min(blocks.length - 1, cursorIndex < 0 ? 0 : cursorIndex + 1);
        setCursorIndex(nextIdx);
        blocks[nextIdx]?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      } else if (event.key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        const nextIdx = Math.max(0, cursorIndex < 0 ? 0 : cursorIndex - 1);
        setCursorIndex(nextIdx);
        blocks[nextIdx]?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      } else if (event.key === "Escape" && cursorIndex >= 0) {
        setCursorIndex(-1);
        setSelectionState(null);
        setNoteComposerOpen(false);
      } else if (event.key === "h" && onCreateHighlight) {
        const activeSel = selectionState ?? getCursorBlockAnchor();
        if (!activeSel) return;
        event.preventDefault();
        onCreateHighlight({
          quote: activeSel.anchor.quote,
          prefixContext: activeSel.prefixContext,
          suffixContext: activeSel.suffixContext,
          color: "amber",
        });
        setSelectionState(null);
      } else if (event.key === "n" && onCreateHighlight) {
        const activeSel = selectionState ?? getCursorBlockAnchor();
        if (!activeSel) return;
        event.preventDefault();
        if (!selectionState && "top" in activeSel) {
          setSelectionState({
            anchor: activeSel.anchor,
            prefixContext: activeSel.prefixContext,
            suffixContext: activeSel.suffixContext,
            top: activeSel.top,
            left: 12,
          });
        }
        setNoteComposerOpen(true);
      } else if (event.key === "g" && onAskAgent) {
        const activeSel = selectionState ?? getCursorBlockAnchor();
        if (!activeSel) return;
        event.preventDefault();
        onAskAgent(activeSel.anchor);
        setSelectionState(null);
      }
    },
    [
      enableKeyboardNav,
      proseRef,
      cursorIndex,
      selectionState,
      getCursorBlockAnchor,
      onCreateHighlight,
      onAskAgent,
    ],
  );

  useEventListener("keydown", onEnableKeyboardNavKeyDown);

  const updateSelectionToolbar = useCallback((): void => {
    const container = proseRef.current;
    if (!container || typeof window === "undefined") {
      setSelectionState(null);
      return;
    }

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      if (!noteComposerOpen) {
        setSelectionState(null);
      }
      return;
    }

    const quote = selection.toString().trim();
    if (!quote) {
      setSelectionState(null);
      return;
    }

    const range = selection.getRangeAt(0);
    const proseRoot = container.querySelector<HTMLElement>(".inkade-prose") ?? container;
    if (!proseRoot.contains(range.commonAncestorContainer)) {
      setSelectionState(null);
      return;
    }

    const rect = range.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const headingSlug = findNearestHeadingSlug(range.startContainer, proseRoot);
    const { fullText, segments } = collectTextSegments(proseRoot);

    let selStart = -1;
    let selEnd = -1;
    const preRange = document.createRange();
    try {
      preRange.selectNodeContents(proseRoot);
      preRange.setEnd(range.startContainer, range.startOffset);
      selStart = preRange.toString().length;
      preRange.setEnd(range.endContainer, range.endOffset);
      selEnd = preRange.toString().length;
    } catch {
      const firstSeg = segments.find((s) => s.node === range.startContainer);
      if (firstSeg) {
        selStart = firstSeg.start + range.startOffset;
        selEnd = selStart + quote.length;
      }
    }

    const fallbackIdx = fullText.indexOf(quote);
    const resolvedStart = selStart >= 0 ? selStart : fallbackIdx;
    const resolvedEnd = selEnd > resolvedStart ? selEnd : resolvedStart + quote.length;
    const prefixContext =
      resolvedStart > 0 ? fullText.slice(Math.max(0, resolvedStart - 64), resolvedStart) : "";
    const suffixContext =
      resolvedStart >= 0 ? fullText.slice(resolvedEnd, resolvedEnd + 64) : "";
    const startOffset =
      prefixContext.length > 0
        ? contentMarkdown.indexOf(quote, Math.max(0, resolvedStart - 120))
        : contentMarkdown.indexOf(quote);

    const anchor: SelectionAnchor = {
      quote,
      ...(headingSlug ? { headingSlug } : {}),
      ...(startOffset >= 0 ? { startOffset, endOffset: startOffset + quote.length } : {}),
    };

    setNoteComposerOpen(false);
    setNoteInput("");
    setSelectionState({
      anchor,
      prefixContext,
      suffixContext,
      top: Math.max(0, rect.top - containerRect.top - 52),
      left: Math.max(0, Math.min(rect.left - containerRect.left, Math.max(40, containerRect.width - 340))),
    });
  }, [contentMarkdown, noteComposerOpen, proseRef]);

  const handleSelectionEscape = useCallback(
    (event: KeyboardEvent): void => {
      if (selectionState && event.key === "Escape") {
        setSelectionState(null);
        setNoteComposerOpen(false);
      }
    },
    [selectionState],
  );

  const handleSelectionPointerDown = useCallback(
    (event: PointerEvent): void => {
      if (!selectionState) return;
      const target = event.target instanceof Element ? event.target : null;
      if (
        target?.closest('[data-slot="selection-action-bar"]') ||
        target?.closest('[data-inkade-ui-overlay="true"]')
      ) {
        return;
      }
      setSelectionState(null);
      setNoteComposerOpen(false);
    },
    [selectionState],
  );

  useEventListener("keydown", handleSelectionEscape);
  useEventListener("pointerdown", handleSelectionPointerDown, undefined, { capture: true });

  const handleCopyQuote = useCallback(
    (anchor: SelectionAnchor): void => {
      if (onCopyQuoteLink) {
        onCopyQuoteLink(anchor);
      } else {
        const ref = anchor.headingSlug
          ? `[[${docTitle}#${anchor.headingSlug}]]`
          : `[[${docTitle}]]`;
        void copyReaderQuoteToClipboard(`> ${anchor.quote}\n\n— ${ref}`);
      }
      setSelectionState(null);
    },
    [copyReaderQuoteToClipboard, docTitle, onCopyQuoteLink],
  );

  const handleJumpToHighlight = useCallback(
    (highlightId: HighlightId): void => {
      setActiveHighlightId(highlightId);
      const el = proseRef.current?.querySelector<HTMLElement>(
        `mark[data-highlight-id="${CSS.escape(highlightId)}"]`,
      );
      scrollElementWithinScrollParent(el, "center");
    },
    [proseRef],
  );

  const handleSelectTocSlug = useCallback(
    (slug: string): void => {
      setActiveSlug(slug);
      const el = proseRef.current?.querySelector<HTMLElement>(`#${CSS.escape(slug)}`);
      scrollElementWithinScrollParent(el, "start", 20);
    },
    [proseRef],
  );

  return {
    activeSlug,
    selectionState,
    setSelectionState,
    noteComposerOpen,
    setNoteComposerOpen,
    noteInput,
    setNoteInput,
    noteColor,
    setNoteColor,
    anchorPositions,
    activeHighlightId,
    setActiveHighlightId,
    updateSelectionToolbar,
    handleCopyQuote,
    handleJumpToHighlight,
    handleSelectTocSlug,
  };
}
