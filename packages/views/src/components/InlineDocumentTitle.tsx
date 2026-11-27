"use client";

import { useInkadeTranslation } from "@inkade/i18n";
import { cn } from "@inkade/ui";
import type React from "react";
import { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from "react";
import { useDebounceCallback } from "usehooks-ts";

export interface InlineDocumentTitleHandle {
  readonly focusEnd: () => void;
}

export interface InlineDocumentTitleProps {
  readonly title: string;
  readonly documentId: string;
  readonly readOnly?: boolean | undefined;
  readonly onCommitTitle: (nextTitle: string) => void;
  readonly onEnterToBody?: (() => void) | undefined;
  readonly className?: string | undefined;
}

/**
 * Seamless Notion/Capacities-style inline editable document title (`<h1 contentEditable>`).
 * Preserves true semantic heading role, zero layout shift on click, direct caret placement
 * where clicked, CJK IME safety, debounced auto-save, and smooth Enter/ArrowDown flow into body.
 */
export const InlineDocumentTitle = forwardRef<InlineDocumentTitleHandle, InlineDocumentTitleProps>(
  function InlineDocumentTitle(
    { title, documentId, readOnly = false, onCommitTitle, onEnterToBody, className },
    ref,
  ): React.ReactElement {
    const { t } = useInkadeTranslation();
    const headingRef = useRef<HTMLHeadingElement>(null);
    const composingRef = useRef(false);
    const lastCommittedRef = useRef(title);
    const lastDocIdRef = useRef(documentId);
    const onCommitRef = useRef(onCommitTitle);
    onCommitRef.current = onCommitTitle;

    const scheduleCommit = useDebounceCallback(() => {
      const el = headingRef.current;
      if (!el) return;
      const cleaned = (el.textContent ?? "").replace(/\r?\n/g, " ").trim();
      if (cleaned && cleaned !== lastCommittedRef.current) {
        lastCommittedRef.current = cleaned;
        onCommitRef.current(cleaned);
      }
    }, 750);

    // Initialize & sync DOM text before paint without letting React clobber caret while typing
    useLayoutEffect(() => {
      const el = headingRef.current;
      const switched = lastDocIdRef.current !== documentId;
      lastDocIdRef.current = documentId;

      if (switched) {
        scheduleCommit.cancel();
        lastCommittedRef.current = title;
        if (el && el.textContent !== title) {
          el.textContent = title;
        }
        return;
      }

      const isFocused = typeof document !== "undefined" && document.activeElement === el;
      if (!isFocused && el && el.textContent !== title) {
        lastCommittedRef.current = title;
        el.textContent = title;
      }
    }, [documentId, scheduleCommit, title]);

    useImperativeHandle(
      ref,
      () => ({
        focusEnd: () => {
          const el = headingRef.current;
          if (!el) return;
          el.focus();
          const sel = window.getSelection();
          if (sel) {
            const range = document.createRange();
            range.selectNodeContents(el);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
          }
        },
      }),
      [],
    );

    const flushCommit = (): void => {
      scheduleCommit.cancel();
      const el = headingRef.current;
      if (!el) return;
      const cleaned = (el.textContent ?? "").replace(/\r?\n/g, " ").trim();
      if (!cleaned) {
        // Never persist an empty title; restore last known good title on blur
        el.textContent = lastCommittedRef.current;
        return;
      }
      if (cleaned !== lastCommittedRef.current) {
        lastCommittedRef.current = cleaned;
        onCommitRef.current(cleaned);
      }
    };

    return (
      <h1
        className={cn(
          "inkade-inline-title min-w-0 break-words rounded-md text-2xl font-bold tracking-tight text-foreground outline-none transition-colors sm:text-3xl leading-[1.22]",
          !readOnly && "cursor-text",
          className,
        )}
        contentEditable={readOnly ? false : "plaintext-only"}
        data-placeholder={t("document.untitledPlaceholder")}
        data-testid="document-inline-title"
        onBlur={flushCommit}
        onCompositionEnd={() => {
          composingRef.current = false;
          scheduleCommit();
        }}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onInput={() => {
          if (composingRef.current) return;
          scheduleCommit();
        }}
        onKeyDown={(e) => {
          if (composingRef.current || e.nativeEvent.isComposing || e.keyCode === 229) return;
          if (e.key === "Enter") {
            e.preventDefault();
            flushCommit();
            headingRef.current?.blur();
            onEnterToBody?.();
            return;
          }
          if (e.key === "ArrowDown" && !e.shiftKey && !e.metaKey && !e.ctrlKey && onEnterToBody) {
            e.preventDefault();
            flushCommit();
            headingRef.current?.blur();
            onEnterToBody();
            return;
          }
          if (e.key === "Escape") {
            e.preventDefault();
            scheduleCommit.cancel();
            if (headingRef.current) {
              headingRef.current.textContent = lastCommittedRef.current;
              headingRef.current.blur();
            }
          }
        }}
        onPaste={(e) => {
          if (readOnly) return;
          e.preventDefault();
          const plain = e.clipboardData.getData("text/plain").replace(/\r?\n/g, " ");
          document.execCommand("insertText", false, plain);
        }}
        ref={headingRef}
        spellCheck={false}
        suppressContentEditableWarning
      />
    );
  },
);
