"use client";

import type { DocumentKind } from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import { type Editor, useEditorState } from "@tiptap/react";
import {
  BoldIcon,
  Code2Icon,
  CodeIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  ImageIcon,
  ItalicIcon,
  LayoutTemplateIcon,
  Link2Icon,
  ListIcon,
  ListOrderedIcon,
  CheckSquareIcon,
  QuoteIcon,
  SparklesIcon,
  StrikethroughIcon,
  TableIcon,
  UnderlineIcon,
  Wand2Icon,
} from "lucide-react";
import type React from "react";
import type { MentionDocumentCandidate } from "../../editor/types.ts";
import { cn } from "../../lib/utils.ts";
import { Badge } from "../../primitives/badge.tsx";
import { Button } from "../../primitives/button.tsx";
import { GlideHighlight } from "../../primitives/glide-highlight.tsx";
import { Input } from "../../primitives/input.tsx";
import { Popover, PopoverPopup, PopoverTrigger } from "../../primitives/popover.tsx";
import { Separator } from "../../primitives/separator.tsx";

export interface ArticleFormattingToolbarProps {
  readonly editor: Editor;
  readonly borderless: boolean;
  readonly filteredDocs: readonly MentionDocumentCandidate[];
  readonly kindLabels: Readonly<Record<DocumentKind, string>>;
  readonly templatesCount: number;
  readonly bindingsCount: number;
  readonly wikilinkOpen: boolean;
  readonly wikilinkFilter: string;
  readonly onWikilinkOpenChange: (open: boolean) => void;
  readonly onWikilinkFilterChange: (value: string) => void;
  readonly onInsertWikilink: (title: string) => void;
  readonly onOpenImageDialog: () => void;
  readonly onOpenTemplatePicker: () => void;
  readonly onOpenChipPicker: () => void;
  readonly onOpenAiMenu: () => void;
}

export function ArticleFormattingToolbar({
  editor,
  borderless,
  filteredDocs,
  kindLabels,
  templatesCount,
  bindingsCount,
  wikilinkOpen,
  wikilinkFilter,
  onWikilinkOpenChange,
  onWikilinkFilterChange,
  onInsertWikilink,
  onOpenImageDialog,
  onOpenTemplatePicker,
  onOpenChipPicker,
  onOpenAiMenu,
}: ArticleFormattingToolbarProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const activeState = useEditorState({
    editor,
    selector: (ctx) => ({
      bold: ctx.editor.isActive("bold"),
      italic: ctx.editor.isActive("italic"),
      underline: ctx.editor.isActive("underline"),
      strike: ctx.editor.isActive("strike"),
      code: ctx.editor.isActive("code"),
      h1: ctx.editor.isActive("heading", { level: 1 }),
      h2: ctx.editor.isActive("heading", { level: 2 }),
      h3: ctx.editor.isActive("heading", { level: 3 }),
      bulletList: ctx.editor.isActive("bulletList"),
      orderedList: ctx.editor.isActive("orderedList"),
      taskList: ctx.editor.isActive("taskList"),
      blockquote: ctx.editor.isActive("blockquote"),
      codeBlock: ctx.editor.isActive("codeBlock"),
    }),
  });

  return (
    <div
      className={cn(
        "not-typeset mb-2 flex flex-wrap items-center gap-1 border-b py-1.5",
        borderless ? "border-border/50 bg-transparent px-0" : "bg-background px-3",
      )}
      data-testid="editor-static-toolbar"
    >
      <Button
        aria-label={t("editor.bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
        size="icon-xs"
        type="button"
        variant={activeState.bold ? "secondary" : "ghost"}
      >
        <BoldIcon />
      </Button>
      <Button
        aria-label={t("editor.italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        size="icon-xs"
        type="button"
        variant={activeState.italic ? "secondary" : "ghost"}
      >
        <ItalicIcon />
      </Button>
      <Button
        aria-label={t("editor.underline")}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        size="icon-xs"
        type="button"
        variant={activeState.underline ? "secondary" : "ghost"}
      >
        <UnderlineIcon />
      </Button>
      <Button
        aria-label={t("editor.strike")}
        onClick={() => editor.chain().focus().toggleStrike().run()}
        size="icon-xs"
        type="button"
        variant={activeState.strike ? "secondary" : "ghost"}
      >
        <StrikethroughIcon />
      </Button>
      <Button
        aria-label={t("editor.inlineCode")}
        onClick={() => editor.chain().focus().toggleCode().run()}
        size="icon-xs"
        type="button"
        variant={activeState.code ? "secondary" : "ghost"}
      >
        <CodeIcon />
      </Button>

      <Separator className="mx-1 h-4" orientation="vertical" />

      <Button
        aria-label={t("editor.heading1")}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        size="icon-xs"
        type="button"
        variant={activeState.h1 ? "secondary" : "ghost"}
      >
        <Heading1Icon />
      </Button>
      <Button
        aria-label={t("editor.heading2")}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        size="icon-xs"
        type="button"
        variant={activeState.h2 ? "secondary" : "ghost"}
      >
        <Heading2Icon />
      </Button>
      <Button
        aria-label={t("editor.heading3")}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        size="icon-xs"
        type="button"
        variant={activeState.h3 ? "secondary" : "ghost"}
      >
        <Heading3Icon />
      </Button>

      <Separator className="mx-1 h-4" orientation="vertical" />

      <Button
        aria-label={t("editor.bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        size="icon-xs"
        type="button"
        variant={activeState.bulletList ? "secondary" : "ghost"}
      >
        <ListIcon />
      </Button>
      <Button
        aria-label={t("editor.orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        size="icon-xs"
        type="button"
        variant={activeState.orderedList ? "secondary" : "ghost"}
      >
        <ListOrderedIcon />
      </Button>
      <Button
        aria-label={t("editor.taskList")}
        onClick={() => editor.chain().focus().toggleTaskList().run()}
        size="icon-xs"
        type="button"
        variant={activeState.taskList ? "secondary" : "ghost"}
      >
        <CheckSquareIcon />
      </Button>
      <Button
        aria-label={t("editor.blockquote")}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        size="icon-xs"
        type="button"
        variant={activeState.blockquote ? "secondary" : "ghost"}
      >
        <QuoteIcon />
      </Button>
      <Button
        aria-label={t("editor.slashCodeBlock")}
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        size="icon-xs"
        type="button"
        variant={activeState.codeBlock ? "secondary" : "ghost"}
      >
        <Code2Icon />
      </Button>
      <Button
        aria-label={t("editor.slashImage")}
        onClick={onOpenImageDialog}
        size="icon-xs"
        type="button"
        variant="ghost"
      >
        <ImageIcon />
      </Button>
      <Button
        aria-label={t("editor.insertTable")}
        onClick={() =>
          editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
        }
        size="icon-xs"
        type="button"
        variant="ghost"
      >
        <TableIcon />
      </Button>

      <Separator className="mx-1 h-4" orientation="vertical" />

      <Popover onOpenChange={onWikilinkOpenChange} open={wikilinkOpen}>
        <PopoverTrigger render={<Button size="xs" type="button" variant="ghost" />}>
          <Link2Icon />
          {t("editor.insertWikilink")}
        </PopoverTrigger>
        <PopoverPopup align="start" className="w-72" viewportClassName="gap-2 p-2.5">
          <Input
            autoFocus
            onChange={(e) => onWikilinkFilterChange(e.target.value)}
            placeholder={t("editor.filterWorkspaceDocs")}
            size="sm"
            value={wikilinkFilter}
          />
          <div className="max-h-48 overflow-y-auto [scrollbar-gutter:stable]">
            {filteredDocs.length === 0 ? (
              <span className="block px-2 py-2 text-xs text-muted-foreground">
                {t("editor.noMatchingDocs")}
              </span>
            ) : (
              <GlideHighlight
                className="flex flex-col gap-0.5"
                highlightClassName="rounded-[var(--radius-menu-item)] bg-accent"
                mode="pointer"
              >
                {filteredDocs.map((item) => (
                  <button
                    className="relative z-10 flex w-full cursor-pointer items-center justify-between gap-2 rounded-[var(--radius-menu-item)] px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent in-data-[glide-visible=true]:hover:bg-transparent"
                    data-glide-item
                    key={item.id}
                    onClick={() => onInsertWikilink(item.title)}
                    type="button"
                  >
                    <span className="truncate">{item.title}</span>
                    <Badge size="sm" variant="outline">
                      {kindLabels[item.kind]}
                    </Badge>
                  </button>
                ))}
              </GlideHighlight>
            )}
          </div>
        </PopoverPopup>
      </Popover>

      {templatesCount > 0 && (
        <Button onClick={onOpenTemplatePicker} size="xs" type="button" variant="ghost">
          <LayoutTemplateIcon />
          {t("editor.slashTemplate")}
        </Button>
      )}

      {bindingsCount > 0 && (
        <Button onClick={onOpenChipPicker} size="xs" type="button" variant="ghost">
          <SparklesIcon />
          {t("editor.embedThread")}
        </Button>
      )}

      <Button onClick={onOpenAiMenu} size="xs" type="button" variant="ghost">
        <Wand2Icon />
        <span>{t("editor.bubbleAiRewrite")}</span>
      </Button>
    </div>
  );
}
