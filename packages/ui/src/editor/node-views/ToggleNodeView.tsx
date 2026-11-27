"use client";

import { useInkadeTranslation } from "@inkade/i18n";
import { Selection } from "@tiptap/pm/state";
import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { ChevronRightIcon } from "lucide-react";
import type React from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "../../lib/utils.ts";
import { GridDisclosure } from "../../primitives/grid-disclosure.tsx";
import { useEditorSurface } from "../context.tsx";

export function ToggleNodeView({
  editor,
  getPos,
  node,
  updateAttributes,
}: ReactNodeViewProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const { readOnly } = useEditorSurface();
  const attrOpen = node.attrs?.open !== false;
  const [localOpen, setLocalOpen] = useState(attrOpen);
  const summaryInputRef = useRef<HTMLInputElement>(null);
  const didCheckAutoFocusRef = useRef(false);

  useEffect(() => {
    setLocalOpen(attrOpen);
  }, [attrOpen]);
  const isOpen = readOnly ? localOpen : attrOpen;
  const summary = String(node.attrs?.summary ?? "");

  // Auto-focus the summary input synchronously when a fresh empty Toggle block is inserted interactively
  useLayoutEffect(() => {
    if (didCheckAutoFocusRef.current) return;
    didCheckAutoFocusRef.current = true;
    if (readOnly || summary !== "" || !editor.isFocused) return;
    const input = summaryInputRef.current;
    input?.focus();
    if (
      typeof requestAnimationFrame === "undefined" ||
      (typeof document !== "undefined" && document.activeElement === input)
    ) {
      return;
    }
    let cancelled = false;
    const rafId = requestAnimationFrame(() => {
      if (!cancelled && summaryInputRef.current) {
        summaryInputRef.current.focus();
      }
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
    };
  }, [editor, readOnly, summary]);

  const toggleOpenState = (): void => {
    if (readOnly) {
      setLocalOpen((prev) => !prev);
      return;
    }
    updateAttributes({ open: !isOpen });
  };

  const focusBody = (): void => {
    if (readOnly || typeof getPos !== "function") return;
    const pos = getPos();
    if (typeof pos !== "number") return;
    if (!isOpen) {
      updateAttributes({ open: true });
    }
    const moveSelection = (): void => {
      const currentPos = getPos();
      if (typeof currentPos !== "number") return;
      const clamped = Math.min(editor.state.doc.content.size, currentPos + 1);
      const resolved = editor.state.doc.resolve(clamped);
      const selection = Selection.near(resolved, 1);
      editor.view.dispatch(editor.state.tr.setSelection(selection));
      editor.view.focus();
    };
    if (!isOpen && typeof requestAnimationFrame !== "undefined") {
      requestAnimationFrame(moveSelection);
    } else {
      moveSelection();
    }
  };

  return (
    <NodeViewWrapper
      className="inkade-editor-toggle my-3"
      data-open={isOpen ? "true" : "false"}
      data-type="inkade-toggle"
    >
      <div className="flex items-center gap-1.5" contentEditable={false}>
        <button
          aria-expanded={isOpen}
          aria-label={isOpen ? t("outline.collapseSubtree") : t("outline.expandSubtree")}
          className="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--border-focus)]"
          onClick={toggleOpenState}
          type="button"
        >
          <ChevronRightIcon
            className={cn(
              "size-3.5 transition-transform duration-[var(--duration-quick)] ease-[var(--ease-out-strong)]",
              isOpen && "rotate-90",
            )}
          />
        </button>
        <input
          className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-foreground outline-none placeholder:text-muted-foreground/70"
          onChange={(e) => updateAttributes({ summary: e.target.value })}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "Enter" || e.key === "ArrowDown" || e.key === "Escape") {
              e.preventDefault();
              focusBody();
            }
          }}
          placeholder={t("editor.toggleSummaryPlaceholder")}
          readOnly={readOnly}
          ref={summaryInputRef}
          value={summary}
        />
      </div>
      <GridDisclosure open={isOpen}>
        <div className="pt-2 pl-6">
          <NodeViewContent className="[&>p:first-child]:mt-0 [&>p:last-child]:mb-0" />
        </div>
      </GridDisclosure>
    </NodeViewWrapper>
  );
}
