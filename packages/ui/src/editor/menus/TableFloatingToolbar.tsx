"use client";

import { useInkadeTranslation } from "@inkade/i18n";
import type { Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import {
  AlignCenterIcon,
  AlignLeftIcon,
  AlignRightIcon,
  ArrowDownAZIcon,
  ArrowDownToLineIcon,
  ArrowLeftToLineIcon,
  ArrowRightToLineIcon,
  ArrowUpAZIcon,
  ArrowUpToLineIcon,
  CheckIcon,
  CopyIcon,
  FileSpreadsheetIcon,
  HighlighterIcon,
  Rows3Icon,
  TableCellsMergeIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "../../primitives/button.tsx";
import { Separator } from "../../primitives/separator.tsx";
import {
  alignActiveTableColumn,
  computeActiveColumnNumericStats,
  extractActiveTableMatrix,
  formatMatrixAsCsv,
  formatMatrixAsGfmMarkdown,
  sortTableByActiveColumn,
  toggleActiveRowHighlight,
  type TableNumericStats,
} from "./table-actions.ts";

export interface TableFloatingToolbarProps {
  readonly editor: Editor;
  readonly disabled?: boolean | undefined;
}

export function TableFloatingToolbar({
  editor,
  disabled = false,
}: TableFloatingToolbarProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const [numericStats, setNumericStats] = useState<TableNumericStats | null>(null);
  const [copiedMode, setCopiedMode] = useState<"markdown" | "csv" | null>(null);

  useEffect(() => {
    const syncStats = (): void => {
      if (editor.isDestroyed || !editor.isActive("table")) {
        setNumericStats(null);
        return;
      }
      setNumericStats(computeActiveColumnNumericStats(editor));
    };
    syncStats();
    editor.on("selectionUpdate", syncStats);
    editor.on("transaction", syncStats);
    return () => {
      editor.off("selectionUpdate", syncStats);
      editor.off("transaction", syncStats);
    };
  }, [editor]);

  const getTableVirtualElement = useCallback(() => {
    try {
      const { from } = editor.state.selection;
      const domAtPos = editor.view.domAtPos(from);
      const el =
        domAtPos.node instanceof HTMLElement
          ? domAtPos.node
          : domAtPos.node.parentElement;
      const tableEl = el?.closest("table");
      if (!tableEl) return null;
      return {
        getBoundingClientRect: () => tableEl.getBoundingClientRect(),
        contextElement: tableEl,
      };
    } catch {
      return null;
    }
  }, [editor]);

  const handleCopyTable = async (format: "markdown" | "csv"): Promise<void> => {
    const matrix = extractActiveTableMatrix(editor);
    if (matrix.length === 0) return;
    const text = format === "markdown" ? formatMatrixAsGfmMarkdown(matrix) : formatMatrixAsCsv(matrix);
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
    }
    setCopiedMode(format);
    setTimeout(() => {
      setCopiedMode((prev) => (prev === format ? null : prev));
    }, 1500);
  };

  return (
    <BubbleMenu
      appendTo={() => document.body}
      className="z-50"
      editor={editor}
      getReferencedVirtualElement={getTableVirtualElement}
      options={{
        placement: "top-start",
        offset: 6,
        flip: true,
        shift: { padding: 8 },
        ...(typeof window !== "undefined" ? { scrollTarget: window } : {}),
      }}
      pluginKey="inkadeTableToolbar"
      shouldShow={({ editor: ed, state }) => {
        if (disabled || !ed.isEditable || ed.view.dragging) return false;
        if (!state.selection.empty) return false;
        return ed.isActive("table");
      }}
      updateDelay={80}
    >
      <div
        aria-label={t("editor.tableToolbarAria")}
        className="not-typeset flex max-w-[calc(100vw-24px)] flex-wrap items-center gap-0.5 rounded-lg border border-[var(--border-overlay)] bg-popover/98 p-1 text-popover-foreground shadow-[var(--shadow-overlay)] backdrop-blur-md"
        data-slot="editor-table-toolbar"
        data-testid="editor-table-toolbar"
        onMouseDown={(e) => e.preventDefault()}
        role="toolbar"
      >
        <Button
          aria-label={t("editor.tableAddRowBefore")}
          onClick={() => editor.chain().focus().addRowBefore().run()}
          size="icon-xs"
          title={t("editor.tableAddRowBefore")}
          type="button"
          variant="ghost"
        >
          <ArrowUpToLineIcon className="size-3.5" />
        </Button>
        <Button
          aria-label={t("editor.tableAddRowAfter")}
          onClick={() => editor.chain().focus().addRowAfter().run()}
          size="icon-xs"
          title={t("editor.tableAddRowAfter")}
          type="button"
          variant="ghost"
        >
          <ArrowDownToLineIcon className="size-3.5" />
        </Button>
        <Button
          aria-label={t("editor.tableDeleteRow")}
          onClick={() => editor.chain().focus().deleteRow().run()}
          size="xs"
          title={t("editor.tableDeleteRow")}
          type="button"
          variant="ghost"
        >
          <Rows3Icon className="size-3.5 text-muted-foreground" />
          <XIcon className="size-3 text-destructive-foreground" />
        </Button>

        <Separator className="mx-0.5 h-4" orientation="vertical" />

        <Button
          aria-label={t("editor.tableAddColBefore")}
          onClick={() => editor.chain().focus().addColumnBefore().run()}
          size="icon-xs"
          title={t("editor.tableAddColBefore")}
          type="button"
          variant="ghost"
        >
          <ArrowLeftToLineIcon className="size-3.5" />
        </Button>
        <Button
          aria-label={t("editor.tableAddColAfter")}
          onClick={() => editor.chain().focus().addColumnAfter().run()}
          size="icon-xs"
          title={t("editor.tableAddColAfter")}
          type="button"
          variant="ghost"
        >
          <ArrowRightToLineIcon className="size-3.5" />
        </Button>
        <Button
          aria-label={t("editor.tableDeleteCol")}
          onClick={() => editor.chain().focus().deleteColumn().run()}
          size="xs"
          title={t("editor.tableDeleteCol")}
          type="button"
          variant="ghost"
        >
          <TableCellsMergeIcon className="size-3.5 text-muted-foreground" />
          <XIcon className="size-3 text-destructive-foreground" />
        </Button>

        <Separator className="mx-0.5 h-4" orientation="vertical" />

        <Button
          aria-label={t("editor.tableSortAsc")}
          onClick={() => sortTableByActiveColumn(editor, "asc")}
          size="icon-xs"
          title={t("editor.tableSortAsc")}
          type="button"
          variant="ghost"
        >
          <ArrowUpAZIcon className="size-3.5" />
        </Button>
        <Button
          aria-label={t("editor.tableSortDesc")}
          onClick={() => sortTableByActiveColumn(editor, "desc")}
          size="icon-xs"
          title={t("editor.tableSortDesc")}
          type="button"
          variant="ghost"
        >
          <ArrowDownAZIcon className="size-3.5" />
        </Button>
        <Button
          aria-label={t("editor.tableAlignLeft")}
          onClick={() => alignActiveTableColumn(editor, "left")}
          size="icon-xs"
          title={t("editor.tableAlignLeft")}
          type="button"
          variant="ghost"
        >
          <AlignLeftIcon className="size-3.5" />
        </Button>
        <Button
          aria-label={t("editor.tableAlignCenter")}
          onClick={() => alignActiveTableColumn(editor, "center")}
          size="icon-xs"
          title={t("editor.tableAlignCenter")}
          type="button"
          variant="ghost"
        >
          <AlignCenterIcon className="size-3.5" />
        </Button>
        <Button
          aria-label={t("editor.tableAlignRight")}
          onClick={() => alignActiveTableColumn(editor, "right")}
          size="icon-xs"
          title={t("editor.tableAlignRight")}
          type="button"
          variant="ghost"
        >
          <AlignRightIcon className="size-3.5" />
        </Button>
        <Button
          aria-label={t("editor.tableCellHighlight")}
          onClick={() => toggleActiveRowHighlight(editor)}
          size="icon-xs"
          title={t("editor.tableCellHighlight")}
          type="button"
          variant="ghost"
        >
          <HighlighterIcon className="size-3.5" />
        </Button>

        <Separator className="mx-0.5 h-4" orientation="vertical" />

        <Button
          aria-label={t("editor.tableCopyMarkdown")}
          onClick={() => void handleCopyTable("markdown")}
          size="icon-xs"
          title={t("editor.tableCopyMarkdown")}
          type="button"
          variant="ghost"
        >
          {copiedMode === "markdown" ? (
            <CheckIcon className="size-3.5 text-success-foreground" />
          ) : (
            <CopyIcon className="size-3.5" />
          )}
        </Button>
        <Button
          aria-label={t("editor.tableCopyCsv")}
          onClick={() => void handleCopyTable("csv")}
          size="icon-xs"
          title={t("editor.tableCopyCsv")}
          type="button"
          variant="ghost"
        >
          {copiedMode === "csv" ? (
            <CheckIcon className="size-3.5 text-success-foreground" />
          ) : (
            <FileSpreadsheetIcon className="size-3.5" />
          )}
        </Button>

        <Button
          aria-label={t("editor.tableToggleHeader")}
          onClick={() => editor.chain().focus().toggleHeaderRow().run()}
          size="xs"
          title={t("editor.tableToggleHeader")}
          type="button"
          variant="ghost"
        >
          {t("editor.tableToggleHeader")}
        </Button>

        <Button
          aria-label={t("editor.tableDelete")}
          onClick={() => editor.chain().focus().deleteTable().run()}
          size="icon-xs"
          title={t("editor.tableDelete")}
          type="button"
          variant="ghost"
        >
          <Trash2Icon className="size-3.5 text-destructive-foreground" />
        </Button>

        {numericStats && (
          <span
            className="ml-1 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground tabular-nums"
            data-testid="table-numeric-summary"
          >
            {t("editor.tableNumericSummary", {
              count: numericStats.count,
              sum: numericStats.sum,
              avg: numericStats.avg,
            })}
          </span>
        )}
      </div>
    </BubbleMenu>
  );
}
