import type { AdeThreadBinding, SelectionAnchor } from "@inkade/core";
import type { useInkadeTranslation } from "@inkade/i18n";
import type { Editor } from "@tiptap/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEventListener } from "usehooks-ts";
import type {
  BlockRefTriggerItem,
  MentionTriggerItem,
} from "../../editor/menus/TriggerCommandMenu.tsx";
import type {
  MentionDocumentCandidate,
  SlashCommandItem,
  TriggerMatch,
} from "../../editor/types.ts";
import {
  buildArticleSlashCommands,
  computeArticleTriggerItems,
  extractArticleDocToc,
} from "./slash-commands.tsx";

export interface UseArticleTriggersOptions {
  readonly editor: Editor | null;
  readonly docId: string;
  readonly docTitle: string;
  readonly mode: "rich" | "source";
  readonly sourceDraft: string;
  readonly bindings: readonly AdeThreadBinding[];
  readonly mentionCandidates: readonly MentionDocumentCandidate[];
  readonly t: ReturnType<typeof useInkadeTranslation>["t"];
  readonly triggerMatch: TriggerMatch | null;
  readonly setTriggerMatch: (next: TriggerMatch | null) => void;
  readonly triggerMatchRef: React.RefObject<TriggerMatch | null>;
  readonly triggerSelectedIdx: number;
  readonly setTriggerSelectedIdx: (next: number) => void;
  readonly triggerStateRef: React.RefObject<{
    match: TriggerMatch | null;
    itemsCount: number;
    selectedIdx: number;
    onSelect: (index: number) => void;
  }>;
  readonly onOpenImageDialog: () => void;
  readonly onOpenTemplatePicker: () => void;
  readonly onOpenChipPicker: () => void;
  readonly onInsertBindingChip: (binding: AdeThreadBinding) => void;
  readonly onBindAdeThread?: ((query: string) => void) | undefined;
  readonly onDispatchAde?: ((payload: {
    readonly anchor: SelectionAnchor;
    readonly instruction?: string | undefined;
  }) => void) | undefined;
  readonly onCreateLinkedDocument?: ((params: {
    readonly title: string;
    readonly kind: "article" | "outline";
  }) => Promise<{ readonly id: string; readonly title: string } | null>) | undefined;
}

export function useArticleTriggers({
  editor,
  docId,
  docTitle,
  mode,
  sourceDraft,
  bindings,
  mentionCandidates,
  t,
  triggerMatch,
  setTriggerMatch,
  triggerMatchRef,
  triggerSelectedIdx,
  triggerStateRef,
  onOpenImageDialog,
  onOpenTemplatePicker,
  onOpenChipPicker,
  onInsertBindingChip,
  onBindAdeThread,
  onDispatchAde,
  onCreateLinkedDocument,
}: UseArticleTriggersOptions) {
  const [creatingMentionDoc, setCreatingMentionDoc] = useState(false);
  const creatingMentionRef = useRef(false);

  // Dismiss floating trigger command menu when clicking outside
  useEventListener(
    "pointerdown",
    (e: PointerEvent) => {
      if (!triggerMatchRef.current) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest('[data-slot="trigger-command-menu"]')) return;
      triggerMatchRef.current = null;
      setTriggerMatch(null);
    },
    undefined,
    { capture: true },
  );

  const slashCommands = useMemo<readonly SlashCommandItem[]>(() => {
    if (!editor) return [];
    return buildArticleSlashCommands({
      editor,
      t,
      docTitle,
      bindings,
      onOpenImageDialog,
      onOpenTemplatePicker,
      onOpenChipPicker,
      onInsertBindingChip,
      onDispatchAde,
    });
  }, [
    bindings,
    docTitle,
    editor,
    onDispatchAde,
    onInsertBindingChip,
    onOpenChipPicker,
    onOpenImageDialog,
    onOpenTemplatePicker,
    t,
  ]);

  const docTocEntries = useMemo(() => {
    if (triggerMatch?.kind !== "blockref") return [];
    return extractArticleDocToc(mode, sourceDraft, editor);
  }, [editor, mode, sourceDraft, triggerMatch?.kind]);

  const activeTriggerItems = useMemo(
    () =>
      computeArticleTriggerItems({
        triggerMatch,
        slashCommands,
        mentionCandidates,
        docId,
        docTitle,
        docTocEntries,
        t,
      }),
    [docId, docTitle, docTocEntries, mentionCandidates, slashCommands, t, triggerMatch],
  );

  const handleSelectTriggerItem = useCallback(
    (index: number): void => {
      if (!editor || !triggerMatch) return;
      const clampedIdx = Math.max(0, Math.min(index, activeTriggerItems.length - 1));
      const item = activeTriggerItems[clampedIdx];
      if (!item) return;

      const clearTrigger = (): void => {
        triggerMatchRef.current = null;
        setTriggerMatch(null);
      };

      if (triggerMatch.kind === "mention") {
        const mentionItem = item as MentionTriggerItem;
        const { rangeFrom, rangeTo } = triggerMatch;

        if (mentionItem.itemKind === "date") {
          editor
            .chain()
            .focus()
            .deleteRange({ from: rangeFrom, to: rangeTo })
            .insertContent([
              { type: "inkadeWikilink", attrs: { target: mentionItem.isoDate } },
              { type: "text", text: " " },
            ])
            .run();
          clearTrigger();
          return;
        }

        if (mentionItem.itemKind === "doc") {
          editor
            .chain()
            .focus()
            .deleteRange({ from: rangeFrom, to: rangeTo })
            .insertContent([
              { type: "inkadeWikilink", attrs: { target: mentionItem.title } },
              { type: "text", text: " " },
            ])
            .run();
          clearTrigger();
          return;
        }

        if (mentionItem.itemKind === "bind-ade") {
          editor.chain().focus().deleteRange({ from: rangeFrom, to: rangeTo }).run();
          clearTrigger();
          if (onBindAdeThread) {
            onBindAdeThread(mentionItem.query);
          } else if (onDispatchAde) {
            onDispatchAde({ anchor: { quote: mentionItem.query || docTitle } });
          }
          return;
        }

        if (!onCreateLinkedDocument) {
          editor
            .chain()
            .focus()
            .deleteRange({ from: rangeFrom, to: rangeTo })
            .insertContent([
              { type: "inkadeWikilink", attrs: { target: mentionItem.title } },
              { type: "text", text: " " },
            ])
            .run();
          clearTrigger();
          return;
        }

        if (creatingMentionRef.current) return;
        creatingMentionRef.current = true;
        setCreatingMentionDoc(true);
        void (async () => {
          try {
            const created = await onCreateLinkedDocument({
              title: mentionItem.title,
              kind: mentionItem.docKind,
            });
            if (created) {
              const maxPos = editor.state.doc.content.size;
              const safeFrom = Math.min(rangeFrom, maxPos);
              const safeTo = Math.min(rangeTo, maxPos);
              editor
                .chain()
                .focus()
                .deleteRange({ from: safeFrom, to: safeTo })
                .insertContent([
                  { type: "inkadeWikilink", attrs: { target: created.title } },
                  { type: "text", text: " " },
                ])
                .run();
              clearTrigger();
            }
          } finally {
            creatingMentionRef.current = false;
            setCreatingMentionDoc(false);
          }
        })();
        return;
      }

      editor
        .chain()
        .focus()
        .deleteRange({ from: triggerMatch.rangeFrom, to: triggerMatch.rangeTo })
        .run();

      if (triggerMatch.kind === "slash") {
        (item as SlashCommandItem).run();
      } else if (triggerMatch.kind === "wikilink") {
        const d = item as MentionDocumentCandidate;
        editor
          .chain()
          .focus()
          .insertContent([
            { type: "inkadeWikilink", attrs: { target: d.title } },
            { type: "text", text: " " },
          ])
          .run();
      } else {
        const refItem = item as BlockRefTriggerItem;
        editor
          .chain()
          .focus()
          .insertContent([
            { type: "inkadeWikilink", attrs: { target: refItem.label } },
            { type: "text", text: " " },
          ])
          .run();
      }

      clearTrigger();
    },
    [
      activeTriggerItems,
      docTitle,
      editor,
      onBindAdeThread,
      onCreateLinkedDocument,
      onDispatchAde,
      setTriggerMatch,
      triggerMatch,
      triggerMatchRef,
    ],
  );

  useEffect(() => {
    triggerStateRef.current = {
      match: triggerMatch,
      itemsCount: activeTriggerItems.length,
      selectedIdx: triggerSelectedIdx,
      onSelect: handleSelectTriggerItem,
    };
  }, [
    activeTriggerItems.length,
    handleSelectTriggerItem,
    triggerMatch,
    triggerSelectedIdx,
    triggerStateRef,
  ]);

  return {
    creatingMentionDoc,
    activeTriggerItems,
    handleSelectTriggerItem,
  };
}
