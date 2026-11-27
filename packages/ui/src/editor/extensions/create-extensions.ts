import type { AdeThreadBinding, DocumentHighlight, HighlightId } from "@inkade/core";
import FileHandler from "@tiptap/extension-file-handler";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { TableCell, TableHeader, TableKit } from "@tiptap/extension-table";
import TaskList from "@tiptap/extension-task-list";
import Typography from "@tiptap/extension-typography";
import { Markdown } from "@tiptap/markdown";
import type { Extensions } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type React from "react";
import type * as Y from "yjs";
import { AdeThreadChipExtension } from "../../patterns/ade-thread-chip-extension.tsx";
import { InkadeYjsCollaborationExtension } from "../../patterns/yjs-collaboration.ts";
import { InkadeCalloutExtension } from "./callout.ts";
import { InkadeCodeBlockExtension } from "./code-block.ts";
import { InkadeColumnExtension, InkadeColumnsExtension } from "./columns.ts";
import { InkadeHighlightMark } from "./highlight.ts";
import { InkadeHighlightsDecorationExtension } from "./highlights-decoration.ts";
import { InkadeImageExtension } from "./image.ts";
import { InkadeArtifactExtension } from "./inkade-artifact.ts";
import { InkadePendingExtension } from "./inkade-pending.ts";
import { InkadeViewExtension } from "./inkade-view.ts";
import { InkadeInlineMathExtension, InkadeMathBlockExtension } from "./math.ts";
import { InkadeNodeRangeExtension } from "./node-range.ts";
import { InkadeSpeakerNoteExtension } from "./speaker-note.ts";
import { InkadeTaskItem } from "./task-item.ts";
import { InkadeToggleExtension } from "./toggle.ts";
import { InkadeWikilinkExtension } from "./wikilink.ts";

function buildInkadeTableCellAttributes() {
  return {
    highlightColor: {
      default: null,
      parseHTML: (el: HTMLElement) => el.getAttribute("data-highlight-color") ?? null,
      renderHTML: (attrs: Record<string, unknown>) =>
        typeof attrs.highlightColor === "string" && attrs.highlightColor
          ? {
              "data-highlight-color": attrs.highlightColor,
              style: `background-color: ${attrs.highlightColor}`,
            }
          : {},
    },
    align: {
      default: null,
      parseHTML: (el: HTMLElement) =>
        el.getAttribute("data-align") || el.style.textAlign || null,
      renderHTML: (attrs: Record<string, unknown>) =>
        typeof attrs.align === "string" && attrs.align
          ? {
              "data-align": attrs.align,
              style: `text-align: ${attrs.align}`,
            }
          : {},
    },
  };
}

export const InkadeTableCell = TableCell.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      ...buildInkadeTableCellAttributes(),
    };
  },
});

export const InkadeTableHeader = TableHeader.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      ...buildInkadeTableCellAttributes(),
    };
  },
});

export interface CreateEditorExtensionsOptions {
  readonly emptyDocPlaceholder: string;
  readonly focusedLinePlaceholder: string;
  readonly getEmptyDocPlaceholder?: (() => string) | undefined;
  readonly getFocusedLinePlaceholder?: (() => string) | undefined;
  readonly yjsFragment: Y.XmlFragment | null;
  readonly getBindingById: (id: string) => AdeThreadBinding | undefined;
  readonly getHighlights?: (() => readonly DocumentHighlight[]) | undefined;
  readonly getActiveHighlightId?: (() => HighlightId | null) | undefined;
  readonly onOpenBinding?: ((binding: AdeThreadBinding) => void) | undefined;
  readonly onOpenWikilink?: ((target: string, event?: React.MouseEvent) => void) | undefined;
  readonly onFilesDroppedOrPasted?: ((files: File[], pos?: number) => void) | undefined;
}

export function createArticleEditorExtensions({
  emptyDocPlaceholder,
  focusedLinePlaceholder,
  getEmptyDocPlaceholder,
  getFocusedLinePlaceholder,
  yjsFragment,
  getBindingById,
  getHighlights,
  getActiveHighlightId,
  onOpenBinding,
  onOpenWikilink,
  onFilesDroppedOrPasted,
}: CreateEditorExtensionsOptions): Extensions {
  return [
    StarterKit.configure({
      link: false,
      codeBlock: false,
      dropcursor: { color: "var(--primary)", width: 2 },
      ...(yjsFragment ? { undoRedo: false } : {}),
    }),
    Link.configure({
      openOnClick: false,
      autolink: true,
      linkOnPaste: true,
    }),
    Typography,
    Placeholder.configure({
      showOnlyCurrent: true,
      includeChildren: false,
      placeholder: ({ editor, node }) => {
        if (editor.isEmpty) return getEmptyDocPlaceholder?.() ?? emptyDocPlaceholder;
        if (node.type.name === "paragraph") {
          return getFocusedLinePlaceholder?.() ?? focusedLinePlaceholder;
        }
        return "";
      },
    }),
    TaskList,
    InkadeTaskItem.configure({
      nested: true,
      HTMLAttributes: {
        "data-type": "taskItem",
      },
    }),
    TableKit.configure({
      table: {
        resizable: true,
      },
      tableCell: false,
      tableHeader: false,
    }),
    InkadeTableCell,
    InkadeTableHeader,
    InkadeImageExtension,
    InkadePendingExtension,
    InkadeViewExtension,
    InkadeArtifactExtension,
    InkadeCodeBlockExtension,
    InkadeNodeRangeExtension.configure({
      key: "Mod",
    }),
    ...(onFilesDroppedOrPasted
      ? [
          FileHandler.configure({
            consumePasteEvent: true,
            onDrop: (_editor, files, pos) => {
              if (files.length > 0) {
                onFilesDroppedOrPasted(files, pos);
              }
            },
            onPaste: (_editor, files) => {
              if (files.length > 0) {
                onFilesDroppedOrPasted(files);
              }
            },
          }),
        ]
      : []),
    Markdown,
    InkadeCalloutExtension,
    InkadeToggleExtension,
    InkadeColumnsExtension,
    InkadeColumnExtension,
    InkadeMathBlockExtension,
    InkadeInlineMathExtension,
    InkadeSpeakerNoteExtension,
    AdeThreadChipExtension.configure({
      onOpenBinding,
      getBindingById,
    }),
    InkadeWikilinkExtension.configure({
      onOpenWikilink,
    }),
    InkadeHighlightMark,
    ...(getHighlights
      ? [
          InkadeHighlightsDecorationExtension.configure({
            getHighlights,
            getActiveHighlightId: getActiveHighlightId ?? (() => null),
          }),
        ]
      : []),
    ...(yjsFragment
      ? [InkadeYjsCollaborationExtension.configure({ fragment: yjsFragment })]
      : []),
  ];
}
