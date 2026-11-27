"use client";

import { useInkadeTranslation } from "@inkade/i18n";
import { Selection } from "@tiptap/pm/state";
import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import katex from "katex";
import { CheckIcon, SigmaIcon, Trash2Icon } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../../lib/utils.ts";
import { Button } from "../../primitives/button.tsx";
import { GridDisclosure } from "../../primitives/grid-disclosure.tsx";
import { Textarea } from "../../primitives/textarea.tsx";
import { useEditorSurface } from "../context.tsx";

export function MathBlockNodeView({
  deleteNode,
  editor,
  getPos,
  node,
  selected,
  updateAttributes,
}: ReactNodeViewProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const { readOnly } = useEditorSurface();
  const latex = String(node.attrs?.latex ?? "");
  const [editing, setEditing] = useState(!readOnly && latex.trim() === "");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing || readOnly) return;
    const focusInput = (): void => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
    };
    if (typeof requestAnimationFrame === "undefined") {
      focusInput();
      return;
    }
    let cancelled = false;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      if (cancelled) return;
      raf2 = requestAnimationFrame(() => {
        if (!cancelled) focusInput();
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
  }, [editing, readOnly]);

  const finishEditing = useCallback((): void => {
    setEditing(false);
    const pos = typeof getPos === "function" ? getPos() : null;
    if (typeof pos !== "number") {
      editor.commands.focus();
      return;
    }
    const afterPos = pos + node.nodeSize;
    const docSize = editor.state.doc.content.size;
    const afterNode = afterPos < docSize ? editor.state.doc.nodeAt(afterPos) : null;
    if (!afterNode || !afterNode.isTextblock) {
      editor
        .chain()
        .focus()
        .insertContentAt(afterPos, { type: "paragraph" })
        .setTextSelection(Math.min(afterPos + 1, editor.state.doc.content.size + 1))
        .run();
      return;
    }
    const selection = Selection.near(editor.state.doc.resolve(afterPos), 1);
    editor.view.dispatch(editor.state.tr.setSelection(selection));
    editor.view.focus();
  }, [editor, getPos, node.nodeSize]);

  const renderedHtml = useMemo(() => {
    if (!latex.trim()) return "";
    try {
      return katex.renderToString(latex, {
        displayMode: true,
        throwOnError: false,
      });
    } catch {
      return "";
    }
  }, [latex]);

  return (
    <NodeViewWrapper
      className={cn(
        "group/math relative my-3 overflow-hidden rounded-lg border transition-colors",
        editing
          ? "border-foreground/35 bg-muted/30"
          : selected
            ? "border-border/80 bg-muted/30"
            : "border-transparent bg-muted/25 hover:border-border/75",
      )}
      contentEditable={false}
      data-slot="math-block-card"
      data-type="inkade-math-block"
    >
      <div
        className={cn(
          "overflow-x-auto px-4 py-3 text-center",
          !readOnly && "cursor-pointer",
        )}
        onClick={() => {
          if (!readOnly && !editing) setEditing(true);
        }}
        role={readOnly ? undefined : "button"}
        tabIndex={readOnly ? undefined : 0}
        onKeyDown={(e) => {
          if (!readOnly && !editing && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            setEditing(true);
          }
        }}
      >
        {renderedHtml ? (
          <div dangerouslySetInnerHTML={{ __html: renderedHtml }} />
        ) : (
          <span className="inline-flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
            <SigmaIcon className="size-3.5" />
            {t("editor.mathClickToEdit")}
          </span>
        )}
      </div>

      <GridDisclosure open={editing && !readOnly}>
        <div className="border-t border-border/70 bg-background/85 px-3 py-2.5">
          <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1 font-medium">
              <SigmaIcon className="size-3" />
              {t("editor.mathEditTitle")}
            </span>
            <span className="font-mono">{t("editor.mathConfirmHint")}</span>
          </div>
          <Textarea
            className="min-h-16 font-mono text-xs"
            onChange={(e) => updateAttributes({ latex: e.target.value })}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                finishEditing();
              } else if (e.key === "Escape") {
                e.preventDefault();
                finishEditing();
              }
            }}
            placeholder={t("editor.mathPlaceholder")}
            ref={textareaRef}
            value={latex}
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <Button
              onClick={() => {
                deleteNode();
                editor.commands.focus();
              }}
              size="xs"
              variant="ghost"
            >
              <Trash2Icon className="size-3 text-destructive-foreground" />
              {t("common.delete")}
            </Button>
            <Button
              onClick={() => finishEditing()}
              size="xs"
              variant="default"
            >
              <CheckIcon />
              {t("common.done")}
            </Button>
          </div>
        </div>
      </GridDisclosure>
    </NodeViewWrapper>
  );
}
