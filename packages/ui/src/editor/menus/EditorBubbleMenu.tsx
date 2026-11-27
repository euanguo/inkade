"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type { HighlightColor, SelectionAnchor } from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import { isNodeRangeSelection } from "@tiptap/extension-node-range";
import { NodeSelection } from "@tiptap/pm/state";
import { type Editor, useEditorState } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import {
  BoldIcon,
  CheckSquareIcon,
  ChevronDownIcon,
  CodeIcon,
  EraserIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  HighlighterIcon,
  ItalicIcon,
  Link2Icon,
  ListIcon,
  ListOrderedIcon,
  PencilIcon,
  PilcrowIcon,
  QuoteIcon,
  SigmaIcon,
  SparklesIcon,
  StrikethroughIcon,
  UnderlineIcon,
  Wand2Icon,
} from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { cn } from "../../lib/utils.ts";
import { SelectionActionBar } from "../../patterns/SelectionActionBar.tsx";
import { Button } from "../../primitives/button.tsx";
import { Form, FormControl, FormField, FormItem, FormMessage } from "../../primitives/form.tsx";
import { GlideHighlight } from "../../primitives/glide-highlight.tsx";
import { Input } from "../../primitives/input.tsx";
import { Separator } from "../../primitives/separator.tsx";
import { normalizeExternalUrl } from "../markdown-utils.ts";

export interface EditorBubbleMenuProps {
  readonly editor: Editor;
  readonly disabled?: boolean | undefined;
  readonly onHighlightSelection?: ((input: {
    readonly quote: string;
    readonly color: HighlightColor;
  }) => void) | undefined;
  readonly onCreateHighlight?: ((input: {
    readonly quote: string;
    readonly prefixContext: string;
    readonly suffixContext: string;
    readonly color: HighlightColor;
    readonly noteMarkdown?: string | undefined;
  }) => void) | undefined;
  readonly onAskAgent?: ((anchor: SelectionAnchor) => void) | undefined;
  readonly onOpenAiMenu: () => void;
}

const HIGHLIGHT_SWATCHES: ReadonlyArray<{ readonly color: HighlightColor; readonly cls: string }> = [
  { color: "amber", cls: "bg-amber-400" },
  { color: "emerald", cls: "bg-emerald-400" },
  { color: "blue", cls: "bg-blue-400" },
  { color: "rose", cls: "bg-rose-400" },
];

export function EditorBubbleMenu({
  editor,
  disabled = false,
  onHighlightSelection,
  onCreateHighlight,
  onAskAgent,
  onOpenAiMenu,
}: EditorBubbleMenuProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const [linkOpen, setLinkOpen] = useState(false);
  const [turnOpen, setTurnOpen] = useState(false);
  const [highlightOpen, setHighlightOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteColor, setNoteColor] = useState<HighlightColor>("amber");
  const [noteRange, setNoteRange] = useState<{
    readonly quote: string;
    readonly prefixContext: string;
    readonly suffixContext: string;
  } | null>(null);

  const linkSchema = useMemo(
    () =>
      z.object({
        href: z
          .string()
          .refine((val) => !val.trim() || normalizeExternalUrl(val) !== null, {
            message: t("validation.urlInvalid"),
          }),
      }),
    [t],
  );
  const noteSchema = useMemo(() => z.object({ note: z.string() }), []);
  const linkForm = useForm<{ href: string }>({
    resolver: zodResolver(linkSchema),
    defaultValues: { href: "" },
  });
  const noteForm = useForm<{ note: string }>({
    resolver: zodResolver(noteSchema),
    defaultValues: { note: "" },
  });

  const editorState = useEditorState({
    editor,
    selector: (ctx) => ({
      bold: ctx.editor.isActive("bold"),
      italic: ctx.editor.isActive("italic"),
      underline: ctx.editor.isActive("underline"),
      strike: ctx.editor.isActive("strike"),
      code: ctx.editor.isActive("code"),
      link: ctx.editor.isActive("link"),
      linkHref: String(ctx.editor.getAttributes("link").href ?? ""),
      highlight: ctx.editor.isActive("inkadeHighlight"),
      paragraph: ctx.editor.isActive("paragraph"),
      h1: ctx.editor.isActive("heading", { level: 1 }),
      h2: ctx.editor.isActive("heading", { level: 2 }),
      h3: ctx.editor.isActive("heading", { level: 3 }),
      bulletList: ctx.editor.isActive("bulletList"),
      orderedList: ctx.editor.isActive("orderedList"),
      taskList: ctx.editor.isActive("taskList"),
      blockquote: ctx.editor.isActive("blockquote"),
    }),
  });

  const currentBlockLabel = editorState.h1
    ? t("editor.heading1")
    : editorState.h2
      ? t("editor.heading2")
      : editorState.h3
        ? t("editor.heading3")
        : editorState.bulletList
          ? t("editor.bulletList")
          : editorState.orderedList
            ? t("editor.orderedList")
            : editorState.taskList
              ? t("editor.taskList")
              : editorState.blockquote
                ? t("editor.blockquote")
                : t("editor.bubbleTurnParagraph");

  const activeDrawer = turnOpen
    ? "turn"
    : highlightOpen
      ? "highlight"
      : linkOpen
        ? "link"
        : noteOpen && onCreateHighlight && noteRange
          ? "note"
          : null;

  useEffect(() => {
    if (typeof window === "undefined" || typeof requestAnimationFrame === "undefined") return;
    const raf = requestAnimationFrame(() => {
      window.dispatchEvent(new Event("resize"));
    });
    return () => cancelAnimationFrame(raf);
  }, [activeDrawer]);

  useEffect(() => {
    if (disabled || editor.isDestroyed) return;
    const { selection, doc } = editor.state;
    if (selection.empty) return;
    if (
      editor.isActive("codeBlock") ||
      editor.isActive("image") ||
      editor.isActive("inkadeMathBlock")
    ) {
      return;
    }
    if (doc.textBetween(selection.from, selection.to, " ").trim().length === 0) {
      return;
    }
    if (typeof requestAnimationFrame === "undefined") return;
    const raf = requestAnimationFrame(() => {
      if (!editor.isDestroyed) {
        editor.view.dispatch(editor.state.tr.setMeta("inkadeSelectionBubble", "show"));
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [disabled, editor]);

  const colorLabels: Readonly<Record<HighlightColor, string>> = {
    amber: t("reader.highlightAmber"),
    emerald: t("reader.highlightEmerald"),
    blue: t("reader.highlightBlue"),
    rose: t("reader.highlightRose"),
  };

  const drawerContent =
    activeDrawer === "turn" ? (
      <div
        className="w-44 max-w-[calc(100vw-24px)] rounded-lg border border-[var(--border-overlay)] bg-popover p-1 text-popover-foreground shadow-[var(--shadow-overlay)]"
        data-slot="editor-bubble-turn-panel"
      >
        <GlideHighlight
          className="flex flex-col gap-0.5"
          highlightClassName="rounded-[var(--radius-menu-item)] bg-accent"
          mode="pointer"
        >
          {(
            [
              {
                id: "paragraph",
                label: t("editor.slashParagraph"),
                icon: <PilcrowIcon className="size-3.5" />,
                active: editorState.paragraph,
                run: () => editor.chain().focus().setParagraph().run(),
              },
              {
                id: "h1",
                label: t("editor.heading1"),
                icon: <Heading1Icon className="size-3.5" />,
                active: editorState.h1,
                run: () => editor.chain().focus().setHeading({ level: 1 }).run(),
              },
              {
                id: "h2",
                label: t("editor.heading2"),
                icon: <Heading2Icon className="size-3.5" />,
                active: editorState.h2,
                run: () => editor.chain().focus().setHeading({ level: 2 }).run(),
              },
              {
                id: "h3",
                label: t("editor.heading3"),
                icon: <Heading3Icon className="size-3.5" />,
                active: editorState.h3,
                run: () => editor.chain().focus().setHeading({ level: 3 }).run(),
              },
              {
                id: "bullet",
                label: t("editor.bulletList"),
                icon: <ListIcon className="size-3.5" />,
                active: editorState.bulletList,
                run: () => editor.chain().focus().toggleBulletList().run(),
              },
              {
                id: "ordered",
                label: t("editor.orderedList"),
                icon: <ListOrderedIcon className="size-3.5" />,
                active: editorState.orderedList,
                run: () => editor.chain().focus().toggleOrderedList().run(),
              },
              {
                id: "task",
                label: t("editor.taskList"),
                icon: <CheckSquareIcon className="size-3.5" />,
                active: editorState.taskList,
                run: () => editor.chain().focus().toggleTaskList().run(),
              },
              {
                id: "quote",
                label: t("editor.blockquote"),
                icon: <QuoteIcon className="size-3.5" />,
                active: editorState.blockquote,
                run: () => editor.chain().focus().toggleBlockquote().run(),
              },
            ] as const
          ).map((opt) => (
            <button
              className={cn(
                "relative z-10 flex w-full cursor-pointer items-center gap-2 rounded-[var(--radius-menu-item)] px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent/60 in-data-[glide-visible=true]:hover:bg-transparent",
                opt.active
                  ? "bg-accent/70 text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
              data-glide-item
              key={opt.id}
              onClick={() => {
                opt.run();
                setTurnOpen(false);
              }}
              type="button"
            >
              {opt.icon}
              <span>{opt.label}</span>
            </button>
          ))}
        </GlideHighlight>
      </div>
    ) : activeDrawer === "highlight" ? (
      <div
        className="flex w-fit max-w-[calc(100vw-24px)] flex-wrap items-center gap-1.5 rounded-lg border border-[var(--border-overlay)] bg-popover px-2.5 py-1.5 text-popover-foreground shadow-[var(--shadow-overlay)]"
        data-slot="editor-bubble-highlight-panel"
      >
        {HIGHLIGHT_SWATCHES.map((sw) => (
          <button
            aria-label={colorLabels[sw.color]}
            className={cn(
              "size-4 cursor-pointer rounded-full border border-black/10 transition-transform hover:scale-110 dark:border-white/15",
              sw.cls,
            )}
            key={sw.color}
            onClick={() => {
              const { from, to } = editor.state.selection;
              const quote = editor.state.doc.textBetween(from, to, " ").trim();
              if (onCreateHighlight && quote) {
                const prefixContext = editor.state.doc
                  .textBetween(Math.max(0, from - 40), from, " ")
                  .slice(-40);
                const suffixContext = editor.state.doc
                  .textBetween(to, Math.min(editor.state.doc.content.size, to + 40), " ")
                  .slice(0, 40);
                onCreateHighlight({ quote, prefixContext, suffixContext, color: sw.color });
              } else if (onHighlightSelection && quote) {
                onHighlightSelection({ quote, color: sw.color });
              } else {
                editor.chain().focus().setMark("inkadeHighlight", { color: sw.color }).run();
              }
              setHighlightOpen(false);
            }}
            type="button"
          />
        ))}
        <Separator className="mx-0.5 h-3.5" orientation="vertical" />
        <Button
          aria-label={t("editor.bubbleHighlightClear")}
          onClick={() => {
            editor.chain().focus().unsetMark("inkadeHighlight").run();
            setHighlightOpen(false);
          }}
          size="icon-xs"
          type="button"
          variant="ghost"
        >
          <EraserIcon className="size-3.5" />
        </Button>
      </div>
    ) : activeDrawer === "link" ? (
      <form
        className="flex max-w-[calc(100vw-24px)] flex-col gap-1.5 rounded-lg border border-[var(--border-overlay)] bg-popover p-1.5 text-popover-foreground shadow-[var(--shadow-overlay)]"
        data-slot="editor-bubble-link-panel"
        noValidate
        onSubmit={(e) =>
          void linkForm.handleSubmit((values) => {
            const clean = normalizeExternalUrl(values.href);
            if (clean) {
              editor.chain().focus().extendMarkRange("link").setLink({ href: clean }).run();
            } else {
              editor.chain().focus().extendMarkRange("link").unsetLink().run();
            }
            setLinkOpen(false);
          })(e)
        }
      >
        <Form {...linkForm}>
          <FormField
            control={linkForm.control}
            name="href"
            render={({ field }) => (
              <FormItem className="gap-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <FormControl>
                    <Input
                      {...field}
                      autoFocus
                      className="w-52 max-w-[55vw] text-xs"
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          e.preventDefault();
                          setLinkOpen(false);
                        }
                      }}
                      placeholder={t("editor.bubbleLinkPlaceholder")}
                      size="sm"
                    />
                  </FormControl>
                  <Button size="sm" type="submit">
                    {t("editor.bubbleApplyLink")}
                  </Button>
                  {editorState.link && (
                    <Button
                      onClick={() => {
                        editor.chain().focus().extendMarkRange("link").unsetLink().run();
                        setLinkOpen(false);
                      }}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      {t("editor.bubbleRemoveLink")}
                    </Button>
                  )}
                </div>
                <FormMessage />
              </FormItem>
            )}
          />
        </Form>
      </form>
    ) : activeDrawer === "note" && onCreateHighlight && noteRange ? (
      <form
        className="flex w-80 max-w-[calc(100vw-24px)] flex-col gap-2 rounded-lg border border-[var(--border-overlay)] bg-popover p-2.5 text-popover-foreground shadow-[var(--shadow-overlay)]"
        data-slot="editor-bubble-note-panel"
        noValidate
        onSubmit={(e) =>
          void noteForm.handleSubmit((values) => {
            onCreateHighlight({
              quote: noteRange.quote,
              prefixContext: noteRange.prefixContext,
              suffixContext: noteRange.suffixContext,
              color: noteColor,
              noteMarkdown: values.note.trim(),
            });
            noteForm.reset({ note: "" });
            setNoteOpen(false);
            setNoteRange(null);
          })(e)
        }
      >
        <Form {...noteForm}>
          <div className="flex items-center gap-1.5">
            {HIGHLIGHT_SWATCHES.map((sw) => (
              <button
                aria-label={colorLabels[sw.color]}
                className={cn(
                  "size-4 cursor-pointer rounded-full border border-black/10 transition-transform hover:scale-110 dark:border-white/15",
                  sw.cls,
                  noteColor === sw.color && "outline-2 outline-offset-1 outline-foreground/75",
                )}
                key={sw.color}
                onClick={() => setNoteColor(sw.color)}
                type="button"
              />
            ))}
          </div>
          <FormField
            control={noteForm.control}
            name="note"
            render={({ field }) => (
              <FormItem className="gap-1">
                <FormControl>
                  <Input
                    {...field}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        e.preventDefault();
                        setNoteOpen(false);
                      }
                    }}
                    placeholder={t("reader.notePlaceholder")}
                    size="sm"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="flex justify-end gap-1.5">
            <Button
              onClick={() => setNoteOpen(false)}
              size="sm"
              type="button"
              variant="ghost"
            >
              {t("common.cancel")}
            </Button>
            <Button size="sm" type="submit">
              {t("reader.saveNote")}
            </Button>
          </div>
        </Form>
      </form>
    ) : null;

  return (
    <BubbleMenu
      appendTo={() => document.body}
      className="z-50"
      editor={editor}
      options={{
        placement: "top",
        offset: typeof window !== "undefined" && window.innerWidth < 640 ? 12 : 8,
        flip: true,
        shift: { padding: 12 },
        ...(typeof window !== "undefined" ? { scrollTarget: window } : {}),
        onHide: () => {
          setLinkOpen(false);
          setTurnOpen(false);
          setHighlightOpen(false);
          setNoteOpen(false);
        },
      }}
      pluginKey="inkadeSelectionBubble"
      shouldShow={({ editor: ed, state }) => {
        if (disabled || !ed.isEditable) return false;
        if (ed.view.dragging) return false;
        if (state.selection.empty) return false;
        if (state.selection instanceof NodeSelection || isNodeRangeSelection(state.selection)) {
          return false;
        }
        if (
          ed.isActive("codeBlock") ||
          ed.isActive("image") ||
          ed.isActive("inkadeMathBlock")
        ) {
          return false;
        }
        return state.doc.textBetween(state.selection.from, state.selection.to, " ").trim().length > 0;
      }}
      updateDelay={80}
    >
      <div
        className={cn("not-typeset relative z-50", disabled && "hidden")}
        data-testid="editor-bubble-menu"
        onMouseDown={(e) => {
          if ((e.target as HTMLElement).tagName !== "INPUT") {
            e.preventDefault();
          }
        }}
      >
        <SelectionActionBar
          drawer={drawerContent}
          drawerOpen={activeDrawer !== null}
          morphKey={`${currentBlockLabel}-${activeDrawer ?? "none"}`}
          pillClassName="bg-popover/98 backdrop-blur-md"
        >
          {/* Block Turn-Into Selector */}
          <Button
            aria-expanded={turnOpen}
            aria-label={t("editor.bubbleTurnIntoAria")}
            className="gap-1 px-1.5 text-xs font-medium"
            onClick={() => {
              setTurnOpen((prev) => !prev);
              setLinkOpen(false);
              setHighlightOpen(false);
              setNoteOpen(false);
            }}
            size="xs"
            type="button"
            variant={turnOpen ? "secondary" : "ghost"}
          >
            <span className="max-w-20 truncate">{currentBlockLabel}</span>
            <ChevronDownIcon className="size-3 opacity-70" />
          </Button>

          <Separator className="mx-0.5 h-4" orientation="vertical" />

          {/* Inline Marks */}
          <Button
            aria-label={t("editor.bold")}
            onClick={() => editor.chain().focus().toggleBold().run()}
            size="icon-xs"
            type="button"
            variant={editorState.bold ? "secondary" : "ghost"}
          >
            <BoldIcon />
          </Button>
          <Button
            aria-label={t("editor.italic")}
            onClick={() => editor.chain().focus().toggleItalic().run()}
            size="icon-xs"
            type="button"
            variant={editorState.italic ? "secondary" : "ghost"}
          >
            <ItalicIcon />
          </Button>
          <Button
            aria-label={t("editor.underline")}
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            size="icon-xs"
            type="button"
            variant={editorState.underline ? "secondary" : "ghost"}
          >
            <UnderlineIcon />
          </Button>
          <Button
            aria-label={t("editor.strike")}
            onClick={() => editor.chain().focus().toggleStrike().run()}
            size="icon-xs"
            type="button"
            variant={editorState.strike ? "secondary" : "ghost"}
          >
            <StrikethroughIcon />
          </Button>
          <Button
            aria-label={t("editor.inlineCode")}
            onClick={() => editor.chain().focus().toggleCode().run()}
            size="icon-xs"
            type="button"
            variant={editorState.code ? "secondary" : "ghost"}
          >
            <CodeIcon />
          </Button>
          <Button
            aria-label={t("editor.bubbleInlineMathAria")}
            onClick={() => {
              const { from, to } = editor.state.selection;
              const selected = editor.state.doc.textBetween(from, to, " ").trim();
              if (!selected) return;
              editor
                .chain()
                .focus()
                .deleteRange({ from, to })
                .insertContent({
                  type: "inkadeInlineMath",
                  attrs: { latex: selected },
                })
                .run();
            }}
            size="icon-xs"
            type="button"
            variant="ghost"
          >
            <SigmaIcon />
          </Button>

          <Separator className="mx-0.5 h-4" orientation="vertical" />

          {/* Link */}
          <Button
            aria-label={t("editor.bubbleApplyLink")}
            onClick={() => {
              linkForm.reset({ href: editorState.linkHref });
              setLinkOpen((prev) => !prev);
              setTurnOpen(false);
              setHighlightOpen(false);
              setNoteOpen(false);
            }}
            size="icon-xs"
            type="button"
            variant={editorState.link || linkOpen ? "secondary" : "ghost"}
          >
            <Link2Icon />
          </Button>

          {/* Highlight Picker */}
          <Button
            aria-label={t("editor.bubbleHighlight")}
            onClick={() => {
              setHighlightOpen((prev) => !prev);
              setLinkOpen(false);
              setTurnOpen(false);
              setNoteOpen(false);
            }}
            size="icon-xs"
            type="button"
            variant={editorState.highlight || highlightOpen ? "secondary" : "ghost"}
          >
            <HighlighterIcon />
          </Button>

          {onCreateHighlight && (
            <Button
              onClick={() => {
                const { from, to } = editor.state.selection;
                const quote = editor.state.doc.textBetween(from, to, " ").trim();
                if (!quote) return;
                const prefixContext = editor.state.doc
                  .textBetween(Math.max(0, from - 40), from, " ")
                  .slice(-40);
                const suffixContext = editor.state.doc
                  .textBetween(to, Math.min(editor.state.doc.content.size, to + 40), " ")
                  .slice(0, 40);
                setNoteRange({ quote, prefixContext, suffixContext });
                setNoteOpen((prev) => !prev);
                setLinkOpen(false);
                setTurnOpen(false);
                setHighlightOpen(false);
              }}
              size="xs"
              type="button"
              variant={noteOpen ? "secondary" : "ghost"}
            >
              <PencilIcon />
              {t("reader.addNote")}
            </Button>
          )}

          <Separator className="mx-0.5 h-4" orientation="vertical" />

          {onAskAgent && (
            <Button
              onClick={() => {
                const { from, to } = editor.state.selection;
                const quote = editor.state.doc.textBetween(from, to, "\n").trim();
                if (!quote) return;
                onAskAgent({ quote });
              }}
              size="xs"
              type="button"
              variant="ghost"
            >
              <SparklesIcon />
              {t("editor.bubbleAskAde")}
            </Button>
          )}

          <Button
            className="bg-primary/14 font-medium text-foreground hover:bg-primary/22 dark:bg-primary/22 dark:hover:bg-primary/30"
            onClick={onOpenAiMenu}
            size="xs"
            type="button"
            variant="ghost"
          >
            <Wand2Icon className="text-primary" />
            {t("editor.bubbleAiRewrite")}
          </Button>
        </SelectionActionBar>
      </div>
    </BubbleMenu>
  );
}
