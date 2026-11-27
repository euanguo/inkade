"use client";

import type { HighlightColor, SelectionAnchor } from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import { CopyIcon, MessageSquarePlusIcon, PencilIcon, QuoteIcon } from "lucide-react";
import type React from "react";
import { cn } from "../../lib/utils.ts";
import { Button } from "../../primitives/button.tsx";
import { Input } from "../../primitives/input.tsx";
import { HIGHLIGHT_COLOR_SWATCHES } from "../MarginaliaOverlay.tsx";
import { SelectionActionBar } from "../SelectionActionBar.tsx";
import type { FloatingSelectionState } from "./reader-dom-helpers.ts";

export interface ReaderSelectionToolbarProps {
  readonly docTitle: string;
  readonly selectionState: FloatingSelectionState;
  readonly noteComposerOpen: boolean;
  readonly noteInput: string;
  readonly noteColor: HighlightColor;
  readonly onNoteComposerOpenChange: (next: boolean | ((prev: boolean) => boolean)) => void;
  readonly onNoteInputChange: (value: string) => void;
  readonly onNoteColorChange: (color: HighlightColor) => void;
  readonly onClose: () => void;
  readonly onCreateHighlight?: ((input: {
    readonly quote: string;
    readonly prefixContext: string;
    readonly suffixContext: string;
    readonly color: HighlightColor;
    readonly noteMarkdown?: string;
  }) => void) | undefined;
  readonly onAskAgent?: ((anchor: SelectionAnchor) => void) | undefined;
  readonly onExcerptToDaily?: ((anchor: SelectionAnchor, markdownQuote: string) => void) | undefined;
  readonly onCopyQuote: (anchor: SelectionAnchor) => void;
}

export function ReaderSelectionToolbar({
  docTitle,
  selectionState,
  noteComposerOpen,
  noteInput,
  noteColor,
  onNoteComposerOpenChange,
  onNoteInputChange,
  onNoteColorChange,
  onClose,
  onCreateHighlight,
  onAskAgent,
  onExcerptToDaily,
  onCopyQuote,
}: ReaderSelectionToolbarProps): React.ReactElement {
  const { t } = useInkadeTranslation();

  const colorLabel = (color: HighlightColor): string =>
    color === "amber"
      ? t("reader.highlightAmber")
      : color === "emerald"
        ? t("reader.highlightEmerald")
        : color === "blue"
          ? t("reader.highlightBlue")
          : t("reader.highlightRose");

  return (
    <div
      className="absolute z-30"
      data-inkade-ui-overlay="true"
      style={{ top: `${selectionState.top}px`, left: `${selectionState.left}px` }}
    >
      <SelectionActionBar
        drawer={
          onCreateHighlight ? (
            <form
              className="flex w-80 max-w-[calc(100vw-24px)] flex-col gap-2 rounded-lg border border-[var(--border-overlay)] bg-popover p-2.5 text-popover-foreground shadow-[var(--shadow-overlay)]"
              key={noteComposerOpen ? "reader-note-open" : "reader-note-closed"}
              onSubmit={(e) => {
                e.preventDefault();
                onCreateHighlight({
                  quote: selectionState.anchor.quote,
                  prefixContext: selectionState.prefixContext,
                  suffixContext: selectionState.suffixContext,
                  color: noteColor,
                  noteMarkdown: noteInput.trim(),
                });
                onNoteComposerOpenChange(false);
                onNoteInputChange("");
                onClose();
              }}
            >
              <div className="flex items-center gap-1.5">
                {(["amber", "emerald", "blue", "rose"] as const).map((color) => (
                  <button
                    aria-label={colorLabel(color)}
                    className={cn(
                      "size-4 cursor-pointer rounded-full border",
                      HIGHLIGHT_COLOR_SWATCHES[color].dotClass,
                      noteColor === color && "ring-2 ring-foreground/50 ring-offset-1",
                    )}
                    key={color}
                    onClick={() => onNoteColorChange(color)}
                    type="button"
                  />
                ))}
              </div>
              <Input
                autoFocus={noteComposerOpen}
                onChange={(e) => onNoteInputChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    onClose();
                  }
                }}
                placeholder={t("reader.notePlaceholder")}
                size="sm"
                value={noteInput}
              />
              <div className="flex justify-end gap-1.5">
                <Button onClick={onClose} size="xs" type="button" variant="ghost">
                  {t("common.cancel")}
                </Button>
                <Button size="xs" type="submit">
                  {t("reader.saveNote")}
                </Button>
              </div>
            </form>
          ) : undefined
        }
        drawerOpen={Boolean(noteComposerOpen && onCreateHighlight)}
        morphKey={noteComposerOpen ? "note" : "bar"}
        pillClassName="px-1.5"
        shape="pill"
      >
        {onCreateHighlight && (
          <>
            {(["amber", "emerald", "blue", "rose"] as const).map((color) => (
              <button
                aria-label={colorLabel(color)}
                className={cn(
                  "mx-0.5 size-4 cursor-pointer rounded-full border transition-transform hover:scale-110 active:scale-95",
                  HIGHLIGHT_COLOR_SWATCHES[color].dotClass,
                )}
                key={color}
                onClick={() => {
                  onCreateHighlight({
                    quote: selectionState.anchor.quote,
                    prefixContext: selectionState.prefixContext,
                    suffixContext: selectionState.suffixContext,
                    color,
                  });
                  onClose();
                }}
                type="button"
              />
            ))}
            <Button
              className="rounded-full"
              onClick={() => onNoteComposerOpenChange((prev) => !prev)}
              size="xs"
              variant="ghost"
            >
              <PencilIcon />
              {t("reader.addNote")}
            </Button>
            <span aria-hidden className="mx-1 h-4 w-px bg-border" />
          </>
        )}

        {onAskAgent && (
          <Button
            className="rounded-full"
            onClick={() => {
              onAskAgent(selectionState.anchor);
              onClose();
            }}
            size="xs"
            variant="default"
          >
            <MessageSquarePlusIcon />
            {t("reader.askAgent")}
          </Button>
        )}
        {onExcerptToDaily && (
          <Button
            className="rounded-full"
            onClick={() => {
              const ref = selectionState.anchor.headingSlug
                ? `[[${docTitle}#${selectionState.anchor.headingSlug}]]`
                : `[[${docTitle}]]`;
              onExcerptToDaily(
                selectionState.anchor,
                `> ${selectionState.anchor.quote} (${ref})`,
              );
              onClose();
            }}
            size="xs"
            variant="ghost"
          >
            <QuoteIcon />
            {t("reader.excerptToDaily")}
          </Button>
        )}
        <Button
          className="rounded-full"
          onClick={() => onCopyQuote(selectionState.anchor)}
          size="xs"
          variant="ghost"
        >
          <CopyIcon />
          {t("reader.copyQuote")}
        </Button>
      </SelectionActionBar>
    </div>
  );
}
