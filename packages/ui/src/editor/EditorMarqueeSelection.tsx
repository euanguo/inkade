"use client";

import { NodeRangeSelection } from "@tiptap/extension-node-range";
import { TextSelection } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface EditorMarqueeSelectionProps {
  readonly editor: Editor;
  readonly surfaceRef: React.RefObject<HTMLDivElement | null>;
  readonly onDraggingChange?: ((dragging: boolean) => void) | undefined;
}

interface MarqueeRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

const DRAG_THRESHOLD_PX = 5;

const IGNORE_MARQUEE_SELECTOR = [
  "button",
  "a",
  "input",
  "textarea",
  "select",
  "[role='menu']",
  "[role='menuitem']",
  "[role='toolbar']",
  "[role='dialog']",
  "[data-slot='editor-bubble-menu']",
  "[data-testid='editor-bubble-menu']",
  ".inkade-drag-handle",
  ".column-resize-handle",
  "[data-testid='outline-tick-scrubber']",
  "header",
  "footer",
  ".inkade-inline-title",
  "[data-slot='table-floating-toolbar']",
  "[data-slot='link-bubble-popover']",
].join(", ");

interface TopBlockEntry {
  readonly pos: number;
  readonly end: number;
  readonly rect: DOMRect;
}

function collectTopBlocks(editor: Editor): TopBlockEntry[] {
  const blocks: TopBlockEntry[] = [];
  editor.state.doc.forEach((child, offset) => {
    const dom = editor.view.nodeDOM(offset);
    if (dom instanceof Element) {
      blocks.push({
        pos: offset,
        end: offset + child.nodeSize,
        rect: dom.getBoundingClientRect(),
      });
    }
  });
  return blocks;
}

function rectsIntersect(a: DOMRect, b: MarqueeRect): boolean {
  return (
    a.bottom >= b.top &&
    a.top <= b.top + b.height &&
    a.right >= b.left &&
    a.left <= b.left + b.width
  );
}

/**
 * Enables Notion/Feishu-style rubber-band marquee block selection when dragging
 * from blank margins around the prose column, committing a multi-block
 * `NodeRangeSelection` without interfering with normal in-text drag selection.
 */
export function EditorMarqueeSelection({
  editor,
  surfaceRef,
  onDraggingChange,
}: EditorMarqueeSelectionProps): React.ReactElement | null {
  const [marqueeRect, setMarqueeRect] = useState<MarqueeRect | null>(null);
  const onDraggingChangeRef = useRef(onDraggingChange);
  onDraggingChangeRef.current = onDraggingChange;

  useEffect(() => {
    const surfaceEl = surfaceRef.current;
    if (!surfaceEl || editor.isDestroyed) return;

    const listenerRoot =
      surfaceEl.closest<HTMLElement>('[data-slot="document-canvas"]') ?? surfaceEl;

    let cleanupDragListeners: (() => void) | null = null;

    const handleMouseDown = (e: MouseEvent): void => {
      if (e.button !== 0 || e.altKey || e.ctrlKey || e.metaKey) return;
      if (!editor.isEditable || editor.isDestroyed) return;

      const targetEl = e.target as HTMLElement | null;
      if (targetEl?.closest(IGNORE_MARQUEE_SELECTOR)) return;

      const pmDom = editor.view.dom;
      // Never hijack presses inside prose content elements (paragraphs, tables, callouts, etc.).
      // Note that the desktop -3.5rem left gutter lives as padding on `pmDom` itself, where targetEl === pmDom.
      if (targetEl && pmDom.contains(targetEl) && targetEl !== pmDom) {
        return;
      }

      const pmRect = pmDom.getBoundingClientRect();
      const computed = window.getComputedStyle(pmDom);
      const padLeft = Number.parseFloat(computed.paddingLeft) || 0;
      const padRight = Number.parseFloat(computed.paddingRight) || 0;
      const contentLeft = pmRect.left + padLeft;
      const contentRight = pmRect.right - padRight;

      const firstChild = pmDom.firstElementChild;
      const lastChild = pmDom.lastElementChild;
      const contentTop = firstChild ? firstChild.getBoundingClientRect().top : pmRect.top;
      const contentBottom = lastChild ? lastChild.getBoundingClientRect().bottom : pmRect.bottom;
      const minActiveTop = Math.max(contentTop - 16, pmRect.top - 16);

      const startedInMargin =
        e.clientY >= minActiveTop &&
        (e.clientX < contentLeft - 2 ||
          e.clientX > contentRight + 2 ||
          e.clientY > contentBottom + 8);

      if (!startedInMargin) return;

      e.preventDefault();
      e.stopPropagation();
      window.getSelection()?.removeAllRanges();

      const startX = e.clientX;
      const startY = e.clientY;
      let didExceedThreshold = false;
      let hasNodeSelection = false;
      let lastRangeKey = "";

      const finish = (cancelled: boolean): void => {
        cleanupDragListeners?.();
        cleanupDragListeners = null;
        setMarqueeRect(null);
        if (didExceedThreshold) {
          onDraggingChangeRef.current?.(false);
        }

        if (editor.isDestroyed) return;

        if (cancelled) {
          if (hasNodeSelection) {
            const { doc, tr, selection } = editor.state;
            tr.setSelection(TextSelection.near(doc.resolve(Math.min(selection.from, doc.content.size))));
            editor.view.dispatch(tr);
          }
          return;
        }

        if (didExceedThreshold) {
          if (hasNodeSelection) {
            editor.view.focus();
          }
          return;
        }

        // Plain click in blank margin without dragging
        if (startY > contentBottom + 8) {
          editor.commands.focus("end");
        } else if (!editor.state.selection.empty) {
          const { doc, tr, selection } = editor.state;
          tr.setSelection(TextSelection.near(doc.resolve(Math.min(selection.from, doc.content.size))));
          editor.view.dispatch(tr);
          editor.view.focus();
        }
      };

      const handleMouseMove = (ev: MouseEvent): void => {
        if ((ev.buttons & 1) === 0 && didExceedThreshold) {
          finish(false);
          return;
        }
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (!didExceedThreshold) {
          if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
          didExceedThreshold = true;
          onDraggingChangeRef.current?.(true);
        }

        const nextRect: MarqueeRect = {
          left: Math.min(startX, ev.clientX),
          top: Math.min(startY, ev.clientY),
          width: Math.max(1, Math.abs(dx)),
          height: Math.max(1, Math.abs(dy)),
        };
        setMarqueeRect(nextRect);

        if (editor.isDestroyed) return;
        const blocks = collectTopBlocks(editor);
        let firstMatch: TopBlockEntry | null = null;
        let lastMatch: TopBlockEntry | null = null;

        for (const block of blocks) {
          if (rectsIntersect(block.rect, nextRect)) {
            if (!firstMatch) firstMatch = block;
            lastMatch = block;
          }
        }

        if (firstMatch && lastMatch) {
          const nextKey = `${firstMatch.pos}:${lastMatch.end}`;
          if (nextKey !== lastRangeKey) {
            const { doc, tr } = editor.state;
            const rangeSel = NodeRangeSelection.create(doc, firstMatch.pos, lastMatch.end, 0);
            editor.view.dispatch(tr.setSelection(rangeSel));
            lastRangeKey = nextKey;
            hasNodeSelection = true;
          }
        } else if (hasNodeSelection) {
          const { doc, tr, selection } = editor.state;
          tr.setSelection(TextSelection.near(doc.resolve(Math.min(selection.from, doc.content.size))));
          editor.view.dispatch(tr);
          lastRangeKey = "";
          hasNodeSelection = false;
        }
      };

      const handleMouseUp = (): void => {
        finish(false);
      };

      const handleKeyDown = (ev: KeyboardEvent): void => {
        if (ev.key === "Escape") {
          finish(true);
        }
      };

      const handleWindowBlur = (): void => {
        finish(false);
      };

      cleanupDragListeners = () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
        window.removeEventListener("keydown", handleKeyDown);
        window.removeEventListener("blur", handleWindowBlur);
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      window.addEventListener("keydown", handleKeyDown);
      window.addEventListener("blur", handleWindowBlur);
    };

    listenerRoot.addEventListener("mousedown", handleMouseDown, { capture: true });
    return () => {
      listenerRoot.removeEventListener("mousedown", handleMouseDown, { capture: true });
      cleanupDragListeners?.();
    };
  }, [editor, surfaceRef]);

  if (!marqueeRect || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      aria-hidden="true"
      className="pointer-events-none fixed z-30 rounded-md border border-primary/55 bg-primary/10"
      data-testid="editor-marquee-box"
      style={{
        left: `${marqueeRect.left}px`,
        top: `${marqueeRect.top}px`,
        width: `${marqueeRect.width}px`,
        height: `${marqueeRect.height}px`,
      }}
    />,
    document.body,
  );
}
