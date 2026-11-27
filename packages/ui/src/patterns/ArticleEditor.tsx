"use client";

import {
  asHighlightId,
  type AdeThreadBinding,
  type DocumentKind,
  type HighlightId,
  type ReaderFontSizePref,
  stripLeadingDuplicateTitle,
} from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import { Selection } from "@tiptap/pm/state";
import { type Editor, EditorContent, useEditor } from "@tiptap/react";
import type React from "react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type { DebouncedState } from "usehooks-ts";
import { EditorSurfaceContext } from "../editor/context.tsx";
import { DocumentFindBar } from "../editor/DocumentFindBar.tsx";
import { EditorMarqueeSelection } from "../editor/EditorMarqueeSelection.tsx";
import { createArticleEditorExtensions } from "../editor/extensions/create-extensions.ts";
import { inkadeHighlightsDecorationKey } from "../editor/extensions/highlights-decoration.ts";
import { InkadeSearchReplaceExtension } from "../editor/extensions/search-replace.ts";
import {
  detectEditorTrigger,
  sanitizeSerializedMarkdown,
} from "../editor/markdown-utils.ts";
import {
  AdeInlineActionMenu,
  type AdeInlineActionMenuProps,
  type AdeInlineActionSelection,
} from "../editor/menus/AdeInlineActionMenu.tsx";
import { EditorBubbleMenu } from "../editor/menus/EditorBubbleMenu.tsx";
import { EditorDragHandle } from "../editor/menus/EditorDragHandle.tsx";
import { LinkBubblePopover } from "../editor/menus/LinkBubblePopover.tsx";
import { TableFloatingToolbar } from "../editor/menus/TableFloatingToolbar.tsx";
import { TriggerCommandMenu } from "../editor/menus/TriggerCommandMenu.tsx";
import type {
  ArticleEditorHandle,
  ArticleEditorProps,
  MentionDocumentCandidate,
  TriggerMatch,
} from "../editor/types.ts";
import { useResolvedTheme } from "../lib/use-resolved-theme.ts";
import { cn } from "../lib/utils.ts";
import { Textarea } from "../primitives/textarea.tsx";
import {
  ArticleEditorDialogs,
  ArticleEditorTopChrome,
} from "./article-editor/ArticleEditorChrome.tsx";
import { ArticleFormattingToolbar } from "./article-editor/ArticleFormattingToolbar.tsx";
import {
  syncDomMouseSelectionToProseMirror,
  triggersEqual,
} from "./article-editor/dom-selection-sync.ts";
import { useArticleEditorSync } from "./article-editor/use-article-editor-sync.ts";
import { useArticleTriggers } from "./article-editor/use-article-triggers.ts";

export interface ExtendedArticleEditorProps extends ArticleEditorProps {
  readonly fontSize?: ReaderFontSizePref | undefined;
  readonly onAiRewriteStream?: AdeInlineActionMenuProps["onAiRewriteStream"] | undefined;
  readonly onOpenAiSettings?: (() => void) | undefined;
  readonly suppressInnerSepiaBox?: boolean | undefined;
  readonly findOpen?: boolean | undefined;
  readonly onFindOpenChange?: ((open: boolean) => void) | undefined;
}

export const ArticleEditor = forwardRef<ArticleEditorHandle, ExtendedArticleEditorProps>(
  function ArticleEditor(
    {
      document: doc,
      bindings = [],
      workspaceDocs = [],
      spaces = [],
      highlights = [],
      activeHighlightId = null,
      mentionDocuments,
      templates = [],
      hasVersionConflict = false,
      isDirty = false,
      serverSyncToken,
      saving = false,
      autosaveStatus = "idle",
      onChangeMarkdown,
      onSave,
      onResolveConflict,
      onUploadFile,
      onOpenBinding,
      onOpenWikilink,
      onOpenDocument,
      onQueryInkadeView,
      embeddedViewSnapshots,
      onIssueArtifactTicket,
      onSubmitArtifactComment,
      onOpenSecuritySettings,
      onCreateMissingDoc,
      onSelectHighlight,
      onCreateHighlight,
      onAskAgent,
      onDispatchAde,
      onCreateLinkedDocument,
      onBindAdeThread,
      onHighlightSelection,
      onAiRewrite,
      onAiRewriteStream,
      onOpenAiSettings,
      onExitEdit,
      onFocusTitle,
      stripDuplicateTitle = false,
      hideTopChrome = false,
      mode: controlledMode,
      onModeChange,
      showToolbar: controlledShowToolbar,
      onShowToolbarChange,
      borderless = false,
      defaultShowToolbar = false,
      readerFont = "sans",
      fontSize = "base",
      readerMeasure = "72ch",
      paperMode = "default",
      suppressInnerSepiaBox = false,
      findOpen: controlledFindOpen,
      onFindOpenChange,
      theme: explicitTheme,
      readOnly = false,
      collaborativeDoc,
      syncFragmentName = "prosemirror",
      className,
    },
    ref,
  ): React.ReactElement {
    const { t } = useInkadeTranslation();

    const [uncontrolledFindOpen, setUncontrolledFindOpen] = useState(false);
    const effectiveFindOpen = controlledFindOpen ?? uncontrolledFindOpen;
    const setFindOpen = useCallback(
      (next: boolean) => {
        if (controlledFindOpen === undefined) {
          setUncontrolledFindOpen(next);
        }
        onFindOpenChange?.(next);
      },
      [controlledFindOpen, onFindOpenChange],
    );

    const incomingMarkdown = useMemo(
      () =>
        stripDuplicateTitle
          ? stripLeadingDuplicateTitle(doc.contentMarkdown, doc.title)
          : doc.contentMarkdown,
      [doc.contentMarkdown, doc.title, stripDuplicateTitle],
    );

    const [uncontrolledMode, setUncontrolledMode] = useState<"rich" | "source">("rich");
    const mode = controlledMode ?? uncontrolledMode;
    const setMode = useCallback(
      (next: "rich" | "source") => {
        if (controlledMode === undefined) setUncontrolledMode(next);
        onModeChange?.(next);
      },
      [controlledMode, onModeChange],
    );

    const [uncontrolledShowToolbar, setUncontrolledShowToolbar] = useState(defaultShowToolbar);
    const showToolbar = controlledShowToolbar ?? uncontrolledShowToolbar;
    const setShowToolbar = useCallback(
      (next: boolean | ((prev: boolean) => boolean)) => {
        const resolved = typeof next === "function" ? next(showToolbar) : next;
        if (controlledShowToolbar === undefined) setUncontrolledShowToolbar(resolved);
        onShowToolbarChange?.(resolved);
      },
      [controlledShowToolbar, onShowToolbarChange, showToolbar],
    );

    const [sourceDraft, setSourceDraft] = useState<string>(incomingMarkdown);
    const [wikilinkOpen, setWikilinkOpen] = useState(false);
    const [wikilinkFilter, setWikilinkFilter] = useState("");
    const [chipPopoverOpen, setChipPopoverOpen] = useState(false);
    const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
    const [imageDialogOpen, setImageDialogOpen] = useState(false);

    const [triggerMatch, setTriggerMatch] = useState<TriggerMatch | null>(null);
    const triggerMatchRef = useRef<TriggerMatch | null>(null);
    const [triggerSelectedIdx, setTriggerSelectedIdx] = useState(0);
    const [aiSelectionRange, setAiSelectionRange] = useState<AdeInlineActionSelection | null>(null);
    const [isMarqueeDragging, setIsMarqueeDragging] = useState(false);
    const [isBlockDragging, setIsBlockDragging] = useState(false);
    const isMarqueeDraggingRef = useRef(false);
    const editorSurfaceRef = useRef<HTMLDivElement | null>(null);
    const sourceTextareaRef = useRef<HTMLTextAreaElement>(null);
    const handleMarqueeDraggingChange = useCallback((dragging: boolean) => {
      isMarqueeDraggingRef.current = dragging;
      setIsMarqueeDragging(dragging);
    }, []);

    const lastEmittedMarkdownRef = useRef<string>(incomingMarkdown);
    const onChangeMarkdownRef = useRef(onChangeMarkdown);
    onChangeMarkdownRef.current = onChangeMarkdown;
    const onSaveRef = useRef(onSave);
    onSaveRef.current = onSave;
    const onFocusTitleRef = useRef(onFocusTitle);
    onFocusTitleRef.current = onFocusTitle;
    const onOpenBindingRef = useRef(onOpenBinding);
    onOpenBindingRef.current = onOpenBinding;
    const onOpenWikilinkRef = useRef(onOpenWikilink);
    onOpenWikilinkRef.current = onOpenWikilink;
    const emptyPlaceholderRef = useRef(t("editor.placeholder"));
    emptyPlaceholderRef.current = t("editor.placeholder");
    const focusedPlaceholderRef = useRef(t("editor.placeholderFocused"));
    focusedPlaceholderRef.current = t("editor.placeholderFocused");
    const editorRef = useRef<Editor | null>(null);
    const docVersionRef = useRef(doc.version);
    docVersionRef.current = doc.version;

    const noopDebounce = useRef<DebouncedState<(activeEditor: Editor) => void> | null>(null);
    const fileInsertRef = useRef<(files: File[], pos?: number) => void>(() => {});
    const triggerStateRef = useRef<{
      match: TriggerMatch | null;
      itemsCount: number;
      selectedIdx: number;
      onSelect: (index: number) => void;
    }>({
      match: null,
      itemsCount: 0,
      selectedIdx: 0,
      onSelect: () => {},
    });

    const kindLabels: Readonly<Record<DocumentKind, string>> = useMemo(
      () => ({
        outline: t("common.kindOutline"),
        article: t("common.kindArticle"),
        clip: t("common.kindClip"),
      }),
      [t],
    );

    const bindingMapRef = useRef(new Map<string, AdeThreadBinding>());
    bindingMapRef.current = new Map(bindings.map((b) => [b.id, b]));
    const highlightsRef = useRef(highlights);
    highlightsRef.current = highlights;
    const activeHighlightIdRef = useRef<HighlightId | null>(activeHighlightId);
    activeHighlightIdRef.current = activeHighlightId;

    const yjsFragment = useMemo(
      () => (collaborativeDoc ? collaborativeDoc.getXmlFragment(syncFragmentName) : null),
      [collaborativeDoc, syncFragmentName],
    );

    const resolvedTheme = useResolvedTheme(explicitTheme);

    const surfaceContextValue = useMemo(
      () => ({
        theme: resolvedTheme,
        paperMode,
        readOnly,
        workspaceDocs,
        spaces,
        bindings,
        onOpenBinding: (binding: AdeThreadBinding) => onOpenBindingRef.current?.(binding),
        onOpenWikilink,
        onOpenDocument,
        onCreateMissingDoc,
        onQueryInkadeView,
        embeddedViewSnapshots,
        onIssueArtifactTicket,
        onSubmitArtifactComment,
        onOpenSecuritySettings,
      }),
      [
        bindings,
        embeddedViewSnapshots,
        onCreateMissingDoc,
        onIssueArtifactTicket,
        onOpenDocument,
        onOpenSecuritySettings,
        onOpenWikilink,
        onQueryInkadeView,
        onSubmitArtifactComment,
        paperMode,
        readOnly,
        resolvedTheme,
        spaces,
        workspaceDocs,
      ],
    );

    const openAiMenuAtSelection = useCallback(
      (activeEditor: NonNullable<ReturnType<typeof useEditor>>): void => {
        const { from, to, empty, $from } = activeEditor.state.selection;
        const rangeFrom = empty ? $from.start() : from;
        const rangeTo = empty ? $from.end() : to;
        const selectedText = activeEditor.state.doc.textBetween(rangeFrom, rangeTo, "\n");
        setAiSelectionRange({ from: rangeFrom, to: rangeTo, text: selectedText });
      },
      [],
    );

    const updateTrigger = useCallback(
      (activeEditor: NonNullable<ReturnType<typeof useEditor>>): void => {
        if (!activeEditor.isEditable) {
          if (triggerMatchRef.current !== null) {
            triggerMatchRef.current = null;
            setTriggerMatch(null);
          }
          return;
        }
        const { from, empty, $from } = activeEditor.state.selection;
        let detected: TriggerMatch | null = null;
        if (empty && $from.parent.isTextblock && $from.parent.type.name !== "codeBlock") {
          const textBefore = $from.parent.textBetween(0, $from.parentOffset, "\n", "\ufffc");
          detected = detectEditorTrigger(textBefore, from);
        }
        if (!triggersEqual(triggerMatchRef.current, detected)) {
          triggerMatchRef.current = detected;
          setTriggerMatch(detected);
          setTriggerSelectedIdx(0);
        }
      },
      [],
    );

    const editor = useEditor(
      {
        editable: !readOnly,
        extensions: [
          ...createArticleEditorExtensions({
            emptyDocPlaceholder: emptyPlaceholderRef.current,
            focusedLinePlaceholder: focusedPlaceholderRef.current,
            getEmptyDocPlaceholder: () => emptyPlaceholderRef.current,
            getFocusedLinePlaceholder: () => focusedPlaceholderRef.current,
            yjsFragment,
            getBindingById: (id) => bindingMapRef.current.get(id),
            getHighlights: () => highlightsRef.current,
            getActiveHighlightId: () => activeHighlightIdRef.current,
            onOpenBinding: (binding) => onOpenBindingRef.current?.(binding),
            onOpenWikilink: (target, event) => onOpenWikilinkRef.current?.(target, event),
            onFilesDroppedOrPasted: (files, pos) => fileInsertRef.current(files, pos),
          }),
          InkadeSearchReplaceExtension,
        ],
        ...(yjsFragment && yjsFragment.length > 0
          ? {}
          : { content: incomingMarkdown, contentType: "markdown" as const }),
        editorProps: {
          attributes: {
            class: "inkade-prose min-h-[380px] outline-none focus:outline-none",
          },
          handleKeyDown: (view, event) => {
            if (event.isComposing || event.keyCode === 229) return false;
            const activeEd = editorRef.current;

            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
              if (onSaveRef.current) {
                event.preventDefault();
                noopDebounce.current?.cancel();
                const md = activeEd
                  ? sanitizeSerializedMarkdown(activeEd.getMarkdown())
                  : lastEmittedMarkdownRef.current;
                lastEmittedMarkdownRef.current = md;
                onChangeMarkdownRef.current?.(md);
                onSaveRef.current(md, docVersionRef.current);
                return true;
              }
            }

            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "j") {
              if (activeEd && activeEd.isEditable) {
                event.preventDefault();
                openAiMenuAtSelection(activeEd);
                return true;
              }
            }

            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
              event.preventDefault();
              setFindOpen(true);
              return true;
            }

            const tState = triggerStateRef.current;
            if (tState.match) {
              if (event.key === "Escape") {
                event.preventDefault();
                triggerMatchRef.current = null;
                setTriggerMatch(null);
                return true;
              }
              if (tState.itemsCount > 0) {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setTriggerSelectedIdx((i) => (i + 1) % tState.itemsCount);
                  return true;
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setTriggerSelectedIdx((i) => (i - 1 + tState.itemsCount) % tState.itemsCount);
                  return true;
                }
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  tState.onSelect(tState.selectedIdx);
                  return true;
                }
              }
            }

            if (
              event.key === "ArrowUp" &&
              !event.metaKey &&
              !event.ctrlKey &&
              !event.altKey &&
              !event.shiftKey &&
              onFocusTitleRef.current
            ) {
              const { selection } = view.state;
              if (selection.empty && selection.$from.depth >= 1) {
                let atVeryFirstBlock = true;
                for (let d = 0; d < selection.$from.depth; d += 1) {
                  if (selection.$from.index(d) !== 0) {
                    atVeryFirstBlock = false;
                    break;
                  }
                }
                if (atVeryFirstBlock && view.endOfTextblock("up")) {
                  event.preventDefault();
                  onFocusTitleRef.current();
                  return true;
                }
              }
            }

            return false;
          },
        },
        onUpdate({ editor: activeEditor }) {
          updateTrigger(activeEditor);
          noopDebounce.current?.(activeEditor);
        },
        onSelectionUpdate({ editor: activeEditor }) {
          updateTrigger(activeEditor);
        },
        onBlur({ editor: activeEditor }) {
          if (noopDebounce.current?.isPending()) {
            noopDebounce.current.cancel();
            if (!activeEditor.isDestroyed) {
              const md = sanitizeSerializedMarkdown(activeEditor.getMarkdown());
              if (md !== lastEmittedMarkdownRef.current) {
                lastEmittedMarkdownRef.current = md;
                onChangeMarkdownRef.current?.(md);
              }
            }
          }
        },
      },
      [yjsFragment],
    );

    editorRef.current = editor;

    // Refresh Placeholder extension text when locale changes
    useEffect(() => {
      if (!editor || editor.isDestroyed) return;
      editor.view.dispatch(editor.state.tr);
    }, [editor, t]);

    // Sync editable prop when readOnly changes
    useEffect(() => {
      if (editor && editor.isEditable !== !readOnly) {
        editor.setEditable(!readOnly);
      }
    }, [editor, readOnly]);

    // Refresh ProseMirror decorations whenever highlights or activeHighlightId change
    useEffect(() => {
      if (!editor || editor.isDestroyed) return;
      editor.view.dispatch(editor.state.tr.setMeta(inkadeHighlightsDecorationKey, true));
    }, [activeHighlightId, editor, highlights]);

    const { uploading, flushMarkdown, handleFileInsert, handleSourceChange } =
      useArticleEditorSync({
        docId: doc.id,
        docVersion: doc.version,
        incomingMarkdown,
        serverSyncToken,
        hasVersionConflict,
        isDirty,
        readOnly,
        mode,
        sourceDraft,
        setSourceDraft,
        yjsFragment,
        editor,
        onChangeMarkdown,
        onUploadFile,
        onChangeMarkdownRef,
        lastEmittedMarkdownRef,
        debouncedEmitRef: noopDebounce,
        fileInsertRef,
        triggerMatchRef,
        setTriggerMatch,
        setAiSelectionRange,
      });

    const handleSwitchMode = useCallback(
      (nextMode: "rich" | "source"): void => {
        if (nextMode === mode) return;
        if (nextMode === "source" && editor) {
          const md = flushMarkdown();
          setSourceDraft(md);
        } else if (nextMode === "rich" && editor) {
          lastEmittedMarkdownRef.current = sourceDraft;
          editor.commands.setContent(sourceDraft, { contentType: "markdown", emitUpdate: false });
        }
        setMode(nextMode);
      },
      [editor, flushMarkdown, mode, setMode, sourceDraft],
    );

    useImperativeHandle(
      ref,
      () => ({
        focusStart: () => {
          if (mode === "source") {
            const textarea = sourceTextareaRef.current;
            if (!textarea) return;
            textarea.focus();
            textarea.setSelectionRange(0, 0);
            return;
          }
          if (mode === "rich" && editor && !editor.isDestroyed) {
            const { state, view } = editor;
            view.dispatch(state.tr.setSelection(Selection.atStart(state.doc)).scrollIntoView());
            view.focus();
            if (typeof document !== "undefined" && document.activeElement !== view.dom) {
              view.dom.focus();
            }
          }
        },
        focusEnd: () => {
          if (mode === "source") {
            const textarea = sourceTextareaRef.current;
            if (!textarea) return;
            textarea.focus();
            const len = textarea.value.length;
            textarea.setSelectionRange(len, len);
            return;
          }
          if (mode === "rich" && editor && !editor.isDestroyed) {
            const { state, view } = editor;
            view.dispatch(state.tr.setSelection(Selection.atEnd(state.doc)).scrollIntoView());
            view.focus();
            if (typeof document !== "undefined" && document.activeElement !== view.dom) {
              view.dom.focus();
            }
          }
        },
        flushMarkdown,
        getMode: () => mode,
        setMode: handleSwitchMode,
        toggleToolbar: () => {
          setShowToolbar((prev) => !prev);
          editor?.chain().focus().run();
        },
      }),
      [editor, flushMarkdown, handleSwitchMode, mode, setShowToolbar],
    );

    const handleInsertWikilink = (title: string): void => {
      const token = `[[${title}]] `;
      if (mode === "source") {
        handleSourceChange(
          `${sourceDraft}${sourceDraft.endsWith(" ") || !sourceDraft ? "" : " "}${token}`,
        );
      } else if (editor) {
        editor
          .chain()
          .focus()
          .insertContent([
            { type: "inkadeWikilink", attrs: { target: title } },
            { type: "text", text: " " },
          ])
          .run();
      }
      setWikilinkOpen(false);
      setWikilinkFilter("");
    };

    const handleInsertBindingChip = useCallback(
      (binding: AdeThreadBinding): void => {
        if (mode === "source") {
          const next = `${sourceDraft}\n[[ade:${binding.id}:${binding.adeKind}|${binding.title}]]\n`;
          setSourceDraft(next);
          lastEmittedMarkdownRef.current = next;
          onChangeMarkdownRef.current?.(next);
        } else if (editor) {
          editor
            .chain()
            .focus()
            .insertContent({
              type: "adeThreadChip",
              attrs: {
                bindingId: binding.id,
                adeKind: binding.adeKind,
                status: binding.status,
                title: binding.title,
                externalThreadId: binding.externalThreadId,
              },
            })
            .run();
        }
        setChipPopoverOpen(false);
      },
      [editor, mode, sourceDraft],
    );

    const mentionCandidates = useMemo<readonly MentionDocumentCandidate[]>(
      () => mentionDocuments ?? workspaceDocs,
      [mentionDocuments, workspaceDocs],
    );

    const filteredDocs = useMemo(() => {
      const q = wikilinkFilter.trim().toLowerCase();
      return mentionCandidates
        .filter((d) => d.id !== doc.id && (!q || d.title.toLowerCase().includes(q)))
        .slice(0, 8);
    }, [mentionCandidates, wikilinkFilter, doc.id]);

    const { creatingMentionDoc, activeTriggerItems, handleSelectTriggerItem } =
      useArticleTriggers({
        editor,
        docId: doc.id,
        docTitle: doc.title,
        mode,
        sourceDraft,
        bindings,
        mentionCandidates,
        t,
        triggerMatch,
        setTriggerMatch,
        triggerMatchRef,
        triggerSelectedIdx,
        setTriggerSelectedIdx,
        triggerStateRef,
        onOpenImageDialog: () => setImageDialogOpen(true),
        onOpenTemplatePicker: () => setTemplatePickerOpen(true),
        onOpenChipPicker: () => setChipPopoverOpen(true),
        onInsertBindingChip: handleInsertBindingChip,
        onBindAdeThread,
        onDispatchAde,
        onCreateLinkedDocument,
      });

    const measureMaxWidthClass =
      readerMeasure === "full"
        ? "max-w-none"
        : readerMeasure === "65ch"
          ? "max-w-[65ch]"
          : readerMeasure === "88ch"
            ? "max-w-[88ch]"
            : "max-w-[74ch]";

    return (
      <div
        className={cn(
          "flex flex-col overflow-visible",
          borderless
            ? "bg-transparent text-foreground"
            : "rounded-lg border bg-card text-card-foreground",
          paperMode === "sepia" &&
            !suppressInnerSepiaBox &&
            "inkade-paper-sepia rounded-lg border px-6 py-5 sm:px-8",
          className,
        )}
      >
        <ArticleEditorTopChrome
          autosaveStatus={autosaveStatus}
          borderless={borderless}
          docVersion={doc.version}
          editor={editor}
          hasSaveHandler={Boolean(onSave)}
          hasVersionConflict={hasVersionConflict}
          hideTopChrome={hideTopChrome}
          mode={mode}
          onExitEdit={onExitEdit}
          onOpenAiMenu={() => editor && openAiMenuAtSelection(editor)}
          onResolveConflict={onResolveConflict}
          onSaveClick={() => onSave?.(flushMarkdown(), doc.version)}
          onSwitchMode={handleSwitchMode}
          onToggleToolbar={() => {
            setShowToolbar((prev) => !prev);
            editor?.chain().focus().run();
          }}
          readOnly={readOnly}
          saving={saving}
          showToolbar={showToolbar}
          uploading={uploading}
        />

        {mode === "rich" && editor && showToolbar && !readOnly && (
          <ArticleFormattingToolbar
            bindingsCount={bindings.length}
            borderless={borderless}
            editor={editor}
            filteredDocs={filteredDocs}
            kindLabels={kindLabels}
            onInsertWikilink={handleInsertWikilink}
            onOpenAiMenu={() => openAiMenuAtSelection(editor)}
            onOpenChipPicker={() => setChipPopoverOpen(true)}
            onOpenImageDialog={() => setImageDialogOpen(true)}
            onOpenTemplatePicker={() => setTemplatePickerOpen(true)}
            onWikilinkFilterChange={setWikilinkFilter}
            onWikilinkOpenChange={setWikilinkOpen}
            templatesCount={templates.length}
            wikilinkFilter={wikilinkFilter}
            wikilinkOpen={wikilinkOpen}
          />
        )}

        <div className={cn(borderless ? "px-0 pt-0 pb-8" : "p-4 sm:p-6")}>
          {mode === "rich" ? (
            <div
              className={cn("relative w-full", !readOnly && !borderless && "sm:pl-8")}
              onClick={(e) => {
                const targetEl = (e.target as HTMLElement | null)?.closest<HTMLElement>(
                  "mark[data-highlight-id]",
                );
                if (targetEl) {
                  const hlId = targetEl.getAttribute("data-highlight-id");
                  if (hlId && hlId.trim().length > 0) {
                    onSelectHighlight?.(asHighlightId(hlId));
                  }
                }
              }}
              onMouseUp={() =>
                syncDomMouseSelectionToProseMirror(editor, readOnly, isMarqueeDraggingRef.current)
              }
              ref={editorSurfaceRef}
            >
              {editor && !readOnly && (
                <>
                  <EditorMarqueeSelection
                    editor={editor}
                    onDraggingChange={handleMarqueeDraggingChange}
                    surfaceRef={editorSurfaceRef}
                  />
                  <EditorDragHandle editor={editor} onDragStateChange={setIsBlockDragging} />
                  <EditorBubbleMenu
                    disabled={aiSelectionRange !== null || isMarqueeDragging || isBlockDragging}
                    editor={editor}
                    onAskAgent={onAskAgent}
                    onCreateHighlight={onCreateHighlight}
                    onHighlightSelection={onHighlightSelection}
                    onOpenAiMenu={() => openAiMenuAtSelection(editor)}
                  />
                  <LinkBubblePopover disabled={isBlockDragging} editor={editor} />
                  <TableFloatingToolbar disabled={isBlockDragging} editor={editor} />

                  {triggerMatch && (
                    <TriggerCommandMenu
                      creatingMentionDoc={creatingMentionDoc}
                      editor={editor}
                      items={activeTriggerItems}
                      kindLabels={kindLabels}
                      onHoverIndex={setTriggerSelectedIdx}
                      onSelectIndex={handleSelectTriggerItem}
                      selectedIdx={triggerSelectedIdx}
                      triggerMatch={triggerMatch}
                    />
                  )}

                  {aiSelectionRange && (
                    <AdeInlineActionMenu
                      docTitle={doc.title}
                      editor={editor}
                      onAiRewrite={onAiRewrite}
                      onAiRewriteStream={onAiRewriteStream}
                      onClose={() => setAiSelectionRange(null)}
                      onDispatchAde={onDispatchAde}
                      onOpenAiSettings={onOpenAiSettings}
                      selectionRange={aiSelectionRange}
                    />
                  )}
                </>
              )}

              <DocumentFindBar
                canReplace={!readOnly}
                editor={editor}
                onClose={() => setFindOpen(false)}
                open={effectiveFindOpen}
              />

              <EditorSurfaceContext.Provider value={surfaceContextValue}>
                <div
                  className={cn("inkade-prose-host w-full", measureMaxWidthClass)}
                  data-font={readerFont}
                  data-measure={readerMeasure}
                  data-paper={paperMode === "sepia" ? "sepia" : undefined}
                  data-size={fontSize}
                >
                  <EditorContent editor={editor} />
                </div>
              </EditorSurfaceContext.Provider>
            </div>
          ) : (
            <Textarea
              className={cn(
                "min-h-[460px] w-full font-mono text-sm leading-relaxed",
                measureMaxWidthClass,
              )}
              onChange={(e) => handleSourceChange(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s" && onSaveRef.current) {
                  e.preventDefault();
                  onSaveRef.current(sourceDraft, docVersionRef.current);
                }
              }}
              readOnly={readOnly}
              ref={sourceTextareaRef}
              value={sourceDraft}
            />
          )}
        </div>

        <ArticleEditorDialogs
          bindings={bindings}
          canUploadImage={Boolean(onUploadFile) || typeof FileReader !== "undefined"}
          chipPopoverOpen={chipPopoverOpen}
          editor={editor}
          imageDialogOpen={imageDialogOpen}
          onChipPopoverOpenChange={setChipPopoverOpen}
          onImageDialogOpenChange={setImageDialogOpen}
          onInsertBindingChip={handleInsertBindingChip}
          onTemplatePickerOpenChange={setTemplatePickerOpen}
          onUploadFile={async (file) => {
            await handleFileInsert(file);
          }}
          readOnly={readOnly}
          templatePickerOpen={templatePickerOpen}
          templates={templates}
          uploading={uploading}
        />
      </div>
    );
  },
);
