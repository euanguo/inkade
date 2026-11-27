"use client";

import { useInkadeTranslation } from "@inkade/i18n";
import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import katex from "katex";
import { CheckIcon, SigmaIcon, Trash2Icon } from "lucide-react";
import type React from "react";
import { useMemo, useState } from "react";
import { cn } from "../../lib/utils.ts";
import { Button } from "../../primitives/button.tsx";
import { Input } from "../../primitives/input.tsx";
import { Popover, PopoverPopup, PopoverTrigger } from "../../primitives/popover.tsx";
import { useEditorSurface } from "../context.tsx";

export function InlineMathNodeView({
  deleteNode,
  editor,
  node,
  selected,
  updateAttributes,
}: ReactNodeViewProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const { readOnly } = useEditorSurface();
  const latex = String(node.attrs?.latex ?? "");
  const [open, setOpen] = useState(!readOnly && latex.trim() === "");
  const [draft, setDraft] = useState(latex);

  const renderedHtml = useMemo(() => {
    const source = open ? draft : latex;
    if (!source.trim()) return "";
    try {
      return katex.renderToString(source, {
        displayMode: false,
        throwOnError: false,
      });
    } catch {
      return "";
    }
  }, [draft, latex, open]);

  const handleOpenChange = (nextOpen: boolean): void => {
    if (readOnly) return;
    if (nextOpen) {
      setDraft(latex);
      setOpen(true);
    } else {
      const cleaned = draft.trim();
      if (!cleaned && !latex.trim()) {
        setOpen(false);
        deleteNode();
        editor.commands.focus();
        return;
      }
      if (cleaned !== latex && cleaned.length > 0) {
        updateAttributes({ latex: cleaned });
      }
      setOpen(false);
    }
  };

  const pillContent = (
    <span
      className={cn(
        "mx-0.5 inline-flex items-center rounded-sm border px-1.5 py-[1px] align-baseline leading-snug transition-colors",
        selected || open
          ? "border-foreground/35 bg-accent/65"
          : "border-transparent bg-muted/50",
        !readOnly && "cursor-pointer hover:bg-accent",
      )}
    >
      {renderedHtml ? (
        <span dangerouslySetInnerHTML={{ __html: renderedHtml }} />
      ) : (
        <span className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground">
          <SigmaIcon className="size-3" />
          {latex ? `$${latex}$` : t("editor.slashInlineMath")}
        </span>
      )}
    </span>
  );

  if (readOnly) {
    return (
      <NodeViewWrapper
        as="span"
        contentEditable={false}
        data-latex={latex}
        data-type="inkade-inline-math"
      >
        {pillContent}
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper
      as="span"
      contentEditable={false}
      data-latex={latex}
      data-type="inkade-inline-math"
    >
      <Popover onOpenChange={handleOpenChange} open={open}>
        <PopoverTrigger nativeButton={false} render={<span role="button" tabIndex={0} />}>
          {pillContent}
        </PopoverTrigger>
        <PopoverPopup align="start" className="w-76" viewportClassName="gap-2 p-2.5">
          <div className="flex items-center justify-between text-[11px] font-medium text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <SigmaIcon className="size-3" />
              {t("editor.mathEditTitle")}
            </span>
          </div>
          <form
            className="flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              const cleaned = draft.trim();
              setOpen(false);
              if (cleaned) {
                updateAttributes({ latex: cleaned });
                editor.commands.focus();
              } else {
                deleteNode();
                editor.commands.focus();
              }
            }}
          >
            <Input
              autoFocus
              className="flex-1 font-mono text-xs"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  setDraft(latex);
                  setOpen(false);
                  if (!latex.trim()) {
                    deleteNode();
                  }
                  editor.commands.focus();
                }
              }}
              placeholder={t("editor.mathInlinePlaceholder")}
              size="sm"
              value={draft}
            />
            <Button
              aria-label={t("common.confirm")}
              size="icon-sm"
              type="submit"
              variant="default"
            >
              <CheckIcon />
            </Button>
            <Button
              aria-label={t("common.delete")}
              onClick={() => {
                setOpen(false);
                deleteNode();
                editor.commands.focus();
              }}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <Trash2Icon className="text-destructive-foreground" />
            </Button>
          </form>
          {renderedHtml && (
            <div
              className="overflow-x-auto rounded-md bg-muted/45 px-2.5 py-1.5 text-center text-sm"
              dangerouslySetInnerHTML={{ __html: renderedHtml }}
            />
          )}
        </PopoverPopup>
      </Popover>
    </NodeViewWrapper>
  );
}
