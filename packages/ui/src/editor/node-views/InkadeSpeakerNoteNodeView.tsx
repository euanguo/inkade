"use client";

import { useInkadeTranslation } from "@inkade/i18n";
import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { NotebookTextIcon, Trash2Icon } from "lucide-react";
import type React from "react";
import { Button } from "../../primitives/button.tsx";
import { Textarea } from "../../primitives/textarea.tsx";
import { useEditorSurface } from "../context.tsx";

export function InkadeSpeakerNoteNodeView({
  deleteNode,
  node,
  selected,
  updateAttributes,
}: ReactNodeViewProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const { readOnly } = useEditorSurface();
  const note = String(node.attrs?.note ?? "");

  return (
    <NodeViewWrapper
      className={
        selected
          ? "my-2 rounded-lg border border-dashed border-primary/50 bg-muted/45 px-3 py-2 text-xs ring-2 ring-primary/25"
          : "my-2 rounded-lg border border-dashed border-border/80 bg-muted/35 px-3 py-2 text-xs"
      }
      contentEditable={false}
      data-inkade-speaker-note="true"
      data-type="inkade-speaker-note"
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 font-medium text-muted-foreground">
          <NotebookTextIcon className="size-3.5 text-primary/80" />
          <span>{t("editor.speakerNoteLabel")}</span>
        </span>
        {!readOnly && (
          <Button
            aria-label={t("editor.removeSpeakerNote")}
            onClick={deleteNode}
            size="icon-xs"
            title={t("editor.removeSpeakerNote")}
            type="button"
            variant="ghost"
          >
            <Trash2Icon className="size-3" />
          </Button>
        )}
      </div>
      {readOnly ? (
        <p className="whitespace-pre-wrap leading-relaxed text-foreground/85 [overflow-wrap:anywhere]">
          {note}
        </p>
      ) : (
        <Textarea
          aria-label={t("editor.speakerNoteLabel")}
          className="min-h-10 resize-y border-border/60 bg-background/80 px-2.5 py-1.5 text-xs leading-relaxed"
          onChange={(event) => updateAttributes({ note: event.target.value })}
          onKeyDown={(event) => {
            event.stopPropagation();
          }}
          placeholder={t("editor.speakerNotePlaceholder")}
          rows={Math.min(5, Math.max(1, note.split("\n").length))}
          value={note}
        />
      )}
    </NodeViewWrapper>
  );
}
