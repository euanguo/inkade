import { asOutlineNodeId, parseOutlineBlockDeepLink } from "@inkade/core";
import type { useInkadeTranslation } from "@inkade/i18n";
import { keymap } from "@tiptap/pm/keymap";
import { Fragment } from "@tiptap/pm/model";
import {
  type Command,
  type EditorState,
  type Plugin,
  TextSelection,
  type Transaction,
} from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import {
  CalendarDaysIcon,
  CheckSquareIcon,
  Code2Icon,
  FileOutputIcon,
  GitBranchIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  InfoIcon,
  LightbulbIcon,
  Link2Icon,
  MessageSquarePlusIcon,
  MinusIcon,
  QuoteIcon,
  RepeatIcon,
  SendIcon,
  TriangleAlertIcon,
} from "lucide-react";
import {
  createClientTempNodeId,
  isMultiLineOutlinePaste,
  isNodeBindingProtected,
  parseIndentedMarkdownToOutlineEntries,
  parsedEntriesToProseMirrorItems,
} from "../outline-diff-ops.ts";
import { getOutlineItemAttrs, outlineSchema } from "../outline-schema.ts";
import {
  findEnclosingOutlineItem,
  findNoteInItem,
  findPreviousOutlineItemPos,
  getChildOutlineItems,
  getParaBoundsInItem,
} from "./pm-helpers.ts";
import type {
  OutlineDeferTarget,
  OutlineLatestState,
  PendingDeleteGuard,
  SlashCommandOption,
} from "./types.ts";

export function buildOutlineSlashCommands(
  t: ReturnType<typeof useInkadeTranslation>["t"],
): readonly SlashCommandOption[] {
  return [
    {
      id: "todo",
      label: t("outline.slashTodoLabel"),
      description: t("outline.slashTodoDesc"),
      keywords: "todo task checkbox 待办",
      icon: <CheckSquareIcon className="size-3.5" />,
    },
    {
      id: "note",
      label: t("outline.slashNoteLabel"),
      description: t("outline.slashNoteDesc"),
      keywords: "note subline 备注",
      icon: <MessageSquarePlusIcon className="size-3.5" />,
    },
    {
      id: "heading1",
      label: t("editor.slashHeading1"),
      description: t("editor.slashHeading1Desc"),
      keywords: "h1 heading title 标题",
      icon: <Heading1Icon className="size-3.5" />,
    },
    {
      id: "heading2",
      label: t("editor.slashHeading2"),
      description: t("editor.slashHeading2Desc"),
      keywords: "h2 heading subheading 标题",
      icon: <Heading2Icon className="size-3.5" />,
    },
    {
      id: "heading3",
      label: t("editor.slashHeading3"),
      description: t("editor.slashHeading3Desc"),
      keywords: "h3 heading 小标题",
      icon: <Heading3Icon className="size-3.5" />,
    },
    {
      id: "quote",
      label: t("editor.slashBlockquote"),
      description: t("editor.slashBlockquoteDesc"),
      keywords: "quote blockquote 引用",
      icon: <QuoteIcon className="size-3.5" />,
    },
    {
      id: "callout-note",
      label: t("editor.slashCalloutNote"),
      description: t("editor.slashCalloutDesc"),
      keywords: "callout note info 提示",
      icon: <InfoIcon className="size-3.5" />,
    },
    {
      id: "callout-tip",
      label: t("editor.slashCalloutTip"),
      description: t("editor.slashCalloutDesc"),
      keywords: "callout tip 技巧",
      icon: <LightbulbIcon className="size-3.5" />,
    },
    {
      id: "callout-warning",
      label: t("editor.slashCalloutWarning"),
      description: t("editor.slashCalloutDesc"),
      keywords: "callout warn warning 警告",
      icon: <TriangleAlertIcon className="size-3.5" />,
    },
    {
      id: "code",
      label: t("editor.slashCodeBlock"),
      description: t("editor.slashCodeBlockDesc"),
      keywords: "code snippet 代码",
      icon: <Code2Icon className="size-3.5" />,
    },
    {
      id: "mermaid",
      label: t("editor.slashMermaid"),
      description: t("editor.slashMermaidDesc"),
      keywords: "mermaid diagram 图表",
      icon: <GitBranchIcon className="size-3.5" />,
    },
    {
      id: "divider",
      label: t("editor.slashDivider"),
      description: t("editor.slashDividerDesc"),
      keywords: "divider hr line 分割线",
      icon: <MinusIcon className="size-3.5" />,
    },
    {
      id: "today",
      label: t("editor.mentionTodayLabel"),
      description: t("editor.slashTodayDesc"),
      keywords: "today date 今天 日期",
      icon: <CalendarDaysIcon className="size-3.5" />,
    },
    {
      id: "tomorrow",
      label: t("editor.mentionTomorrowLabel"),
      description: t("editor.slashTomorrowDesc"),
      keywords: "tomorrow date 明天 日期",
      icon: <CalendarDaysIcon className="size-3.5" />,
    },
    {
      id: "dispatch",
      label: t("outline.slashDispatchLabel"),
      description: t("outline.slashDispatchDesc"),
      keywords: "ade agent dispatch 派单",
      icon: <SendIcon className="size-3.5" />,
    },
    {
      id: "promote",
      label: t("outline.slashPromoteLabel"),
      description: t("outline.slashPromoteDesc"),
      keywords: "promote article 转为文章",
      icon: <FileOutputIcon className="size-3.5" />,
    },
    {
      id: "link",
      label: t("outline.slashLinkLabel"),
      description: t("outline.slashLinkDesc"),
      keywords: "link wikilink 双链",
      icon: <Link2Icon className="size-3.5" />,
    },
    {
      id: "blockref",
      label: t("outline.slashBlockRefLabel"),
      description: t("outline.slashBlockRefDesc"),
      keywords: "blockref embed 块引用",
      icon: <RepeatIcon className="size-3.5" />,
    },
    {
      id: "mirror",
      label: t("mirrorNode.slashMirrorLabel"),
      description: t("mirrorNode.slashMirrorDesc"),
      keywords: "mirror 镜像 同步",
      icon: <RepeatIcon className="size-3.5 text-teal-600 dark:text-teal-400" />,
    },
  ];
}

export interface CreateOutlineKeymapOptions {
  readonly latestRef: React.RefObject<OutlineLatestState>;
  readonly undoHandler: Command;
  readonly redoHandler: Command;
  readonly executeToggleTodo: (itemPos: number) => void;
  readonly executeDeferNode: (
    itemPos: number,
    target: OutlineDeferTarget,
    knownNodeId?: string | null,
  ) => Promise<void>;
  readonly executeToggleCollapse: (itemPos: number) => void;
  readonly executeAddOrFocusNote: (itemPos: number) => void;
  readonly executeProtectedDelete: (
    itemPos: number,
    nodeId: string | null,
    sourceBindingId: string | null,
    force?: boolean,
  ) => void;
  readonly setDeleteGuard: (guard: PendingDeleteGuard | null) => void;
}

export function indentOutlineSelection(
  state: EditorState,
  dispatch?: (tr: Transaction) => void,
): boolean {
  const info = findEnclosingOutlineItem(state.selection.$from);
  if (!info || info.indexInParent <= 0) return false;

  const prevSibling = info.parent.child(info.indexInParent - 1);
  if (prevSibling.type.name !== "outlineItem") return false;
  if (!dispatch) return true;

  const cursorRelOffset = state.selection.$from.parentOffset;
  const prevSiblingPos =
    info.parentPos +
    (info.itemDepth - 1 === 0 ? 0 : 1) +
    (() => {
      let sum = 0;
      for (let i = 0; i < info.indexInParent - 1; i++) {
        sum += info.parent.child(i).nodeSize;
      }
      return sum;
    })();

  let tr = state.tr.delete(info.itemPos, info.itemPos + info.item.nodeSize);
  const mappedPrevPos = tr.mapping.map(prevSiblingPos);
  const mappedPrev = tr.doc.nodeAt(mappedPrevPos);
  if (!mappedPrev) return false;

  if (mappedPrev.attrs["collapsed"]) {
    tr = tr.setNodeMarkup(mappedPrevPos, undefined, {
      ...mappedPrev.attrs,
      collapsed: false,
    });
  }

  const insertPos = mappedPrevPos + mappedPrev.nodeSize - 1;
  tr = tr.insert(insertPos, info.item);

  const newParaStart = insertPos + 2;
  const maxOff = info.item.child(0).content.size;
  tr = tr.setSelection(
    TextSelection.create(tr.doc, newParaStart + Math.min(cursorRelOffset, maxOff)),
  );
  dispatch(tr);
  return true;
}

export function outdentOutlineSelection(
  state: EditorState,
  dispatch?: (tr: Transaction) => void,
): boolean {
  const info = findEnclosingOutlineItem(state.selection.$from);
  if (!info || info.itemDepth <= 1) return false;

  const parentItem = info.parent;
  const parentPos = info.parentPos;
  if (parentItem.type.name !== "outlineItem") return false;
  if (!dispatch) return true;

  const cursorRelOffset = state.selection.$from.parentOffset;
  let tr = state.tr.delete(info.itemPos, info.itemPos + info.item.nodeSize);
  const mappedParentPos = tr.mapping.map(parentPos);
  const mappedParent = tr.doc.nodeAt(mappedParentPos);
  if (!mappedParent) return false;

  const insertAfterParentPos = mappedParentPos + mappedParent.nodeSize;
  tr = tr.insert(insertAfterParentPos, info.item);

  const newParaStart = insertAfterParentPos + 2;
  const maxOff = info.item.child(0).content.size;
  tr = tr.setSelection(
    TextSelection.create(tr.doc, newParaStart + Math.min(cursorRelOffset, maxOff)),
  );
  dispatch(tr);
  return true;
}

export function createOutlineKeymapPlugin({
  latestRef,
  undoHandler,
  redoHandler,
  executeToggleTodo,
  executeDeferNode,
  executeToggleCollapse,
  executeAddOrFocusNote,
  executeProtectedDelete,
  setDeleteGuard,
}: CreateOutlineKeymapOptions): Plugin {
  const indentCommand = (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    if (latestRef.current.readOnly) return false;
    indentOutlineSelection(state, dispatch);
    return true;
  };

  const outdentCommand = (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    if (latestRef.current.readOnly) return false;
    outdentOutlineSelection(state, dispatch);
    return true;
  };

  const moveSiblingCommand =
    (direction: "up" | "down") =>
    (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
      if (latestRef.current.readOnly) return false;
      const info = findEnclosingOutlineItem(state.selection.$from);
      if (!info) return false;

      const itemIndices: number[] = [];
      for (let i = 0; i < info.parent.childCount; i++) {
        if (info.parent.child(i).type.name === "outlineItem") {
          itemIndices.push(i);
        }
      }
      const posInItems = itemIndices.indexOf(info.indexInParent);
      const swapIdx = direction === "up" ? posInItems - 1 : posInItems + 1;
      if (posInItems < 0 || swapIdx < 0 || swapIdx >= itemIndices.length) return true;
      if (!dispatch) return true;

      const targetChildIdx = itemIndices[swapIdx]!;
      const targetNode = info.parent.child(targetChildIdx);
      const cursorRel = state.selection.$from.parentOffset;

      let tr = state.tr;
      if (direction === "up") {
        const targetPos = info.itemPos - targetNode.nodeSize;
        tr = tr.delete(info.itemPos, info.itemPos + info.item.nodeSize);
        tr = tr.insert(targetPos, info.item);
        tr = tr.setSelection(
          TextSelection.create(
            tr.doc,
            targetPos + 2 + Math.min(cursorRel, info.item.child(0).content.size),
          ),
        );
      } else {
        const afterTargetPos = info.itemPos + info.item.nodeSize + targetNode.nodeSize;
        tr = tr.insert(afterTargetPos, info.item);
        tr = tr.delete(info.itemPos, info.itemPos + info.item.nodeSize);
        const newItemPos = afterTargetPos - info.item.nodeSize;
        tr = tr.setSelection(
          TextSelection.create(
            tr.doc,
            newItemPos + 2 + Math.min(cursorRel, info.item.child(0).content.size),
          ),
        );
      }
      dispatch(tr);
      return true;
    };

  const enterCommand = (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    if (latestRef.current.readOnly) return false;
    const info = findEnclosingOutlineItem(state.selection.$from);
    if (!info) return false;
    if (!dispatch) return true;

    const attrs = getOutlineItemAttrs(info.item.attrs);
    const newTodoChecked = attrs.checked !== null ? false : null;
    const itemType = outlineSchema.nodes["outlineItem"];
    const paraType = outlineSchema.nodes["outlineParagraph"];

    if (info.isNote) {
      const sibling = itemType.create(
        {
          nodeId: createClientTempNodeId(),
          checked: newTodoChecked,
          collapsed: false,
          authorType: "human",
          sourceBindingId: null,
          mirrorOfNodeId: null,
          rolledOverToDocId: null,
        },
        [paraType.create()],
      );
      const insertPos = info.itemPos + info.item.nodeSize;
      let tr = state.tr.insert(insertPos, sibling);
      tr = tr.setSelection(TextSelection.create(tr.doc, insertPos + 2));
      dispatch(tr);
      return true;
    }

    const para = info.item.child(0);
    const offset = state.selection.$from.parentOffset;
    const text = para.textContent;
    const childItems = getChildOutlineItems(info.item);

    if (offset === text.length && childItems.length > 0 && !attrs.collapsed) {
      const note = findNoteInItem(info.item, info.itemPos);
      const insertPos = info.itemPos + 1 + para.nodeSize + (note ? note.node.nodeSize : 0);
      const newChild = itemType.create(
        {
          nodeId: createClientTempNodeId(),
          checked: newTodoChecked,
          collapsed: false,
          authorType: "human",
          sourceBindingId: null,
          mirrorOfNodeId: null,
          rolledOverToDocId: null,
        },
        [paraType.create()],
      );
      let tr = state.tr.insert(insertPos, newChild);
      tr = tr.setSelection(TextSelection.create(tr.doc, insertPos + 2));
      dispatch(tr);
      return true;
    }

    if (offset === 0 && text.length > 0) {
      const newAbove = itemType.create(
        {
          nodeId: createClientTempNodeId(),
          checked: newTodoChecked,
          collapsed: false,
          authorType: "human",
          sourceBindingId: null,
          mirrorOfNodeId: null,
          rolledOverToDocId: null,
        },
        [paraType.create()],
      );
      let tr = state.tr.insert(info.itemPos, newAbove);
      tr = tr.setSelection(TextSelection.create(tr.doc, info.itemPos + 2));
      dispatch(tr);
      return true;
    }

    const afterText = text.slice(offset);
    const paraFrom = info.itemPos + 2;
    const paraTo = paraFrom + para.content.size;

    let tr = state.tr;
    if (offset < text.length) {
      tr = tr.delete(paraFrom + offset, paraTo);
    }
    const mappedItemPos = tr.mapping.map(info.itemPos);
    const mappedItem = tr.doc.nodeAt(mappedItemPos);
    if (!mappedItem) return false;

    const insertPos = mappedItemPos + mappedItem.nodeSize;
    const trailingItem = itemType.create(
      {
        nodeId: createClientTempNodeId(),
        checked: newTodoChecked,
        collapsed: false,
        authorType: "human",
        sourceBindingId: null,
        mirrorOfNodeId: null,
        rolledOverToDocId: null,
      },
      [paraType.create(null, afterText.length > 0 ? [outlineSchema.text(afterText)] : [])],
    );
    tr = tr.insert(insertPos, trailingItem);
    tr = tr.setSelection(TextSelection.create(tr.doc, insertPos + 2));
    dispatch(tr);
    return true;
  };

  const backspaceCommand = (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    if (latestRef.current.readOnly) return false;
    if (!state.selection.empty) return false;
    const $from = state.selection.$from;
    if ($from.parentOffset !== 0) return false;

    const info = findEnclosingOutlineItem($from);
    if (!info) return false;

    if (info.isNote) {
      if (info.textNode.content.size === 0) {
        if (!dispatch) return true;
        const noteInfo = findNoteInItem(info.item, info.itemPos);
        if (!noteInfo) return false;
        let tr = state.tr.delete(noteInfo.pos, noteInfo.pos + noteInfo.node.nodeSize);
        const bounds = getParaBoundsInItem(info.item, info.itemPos);
        tr = tr.setSelection(TextSelection.create(tr.doc, bounds.to));
        dispatch(tr);
        return true;
      }
      return true;
    }

    const attrs = getOutlineItemAttrs(info.item.attrs);
    const paraText = info.textNode.textContent;
    const childItems = getChildOutlineItems(info.item);

    if (paraText.length === 0) {
      if (info.itemDepth > 1) {
        return outdentCommand(state, dispatch);
      }
      if (childItems.length > 0) return true;

      if (
        isNodeBindingProtected(
          { nodeId: attrs.nodeId, sourceBindingId: attrs.sourceBindingId },
          latestRef.current.bindingsCountByNode,
        )
      ) {
        if (dispatch && attrs.nodeId) {
          setDeleteGuard({
            nodeId: attrs.nodeId,
            bindingCount:
              (latestRef.current.bindingsCountByNode.get(asOutlineNodeId(attrs.nodeId)) ?? 0) || 1,
          });
        }
        return true;
      }

      if (state.doc.childCount <= 1) return true;
      if (!dispatch) return true;
      executeProtectedDelete(info.itemPos, attrs.nodeId, attrs.sourceBindingId);
      return true;
    }

    const prevPos = findPreviousOutlineItemPos(state.doc, info.itemPos);
    if (prevPos === null) return true;
    const prevItem = state.doc.nodeAt(prevPos);
    if (!prevItem || prevItem.type.name !== "outlineItem") return true;

    const hasNote = Boolean(findNoteInItem(info.item, info.itemPos));
    if (
      isNodeBindingProtected(
        { nodeId: attrs.nodeId, sourceBindingId: attrs.sourceBindingId },
        latestRef.current.bindingsCountByNode,
      )
    ) {
      if (dispatch && attrs.nodeId) {
        setDeleteGuard({
          nodeId: attrs.nodeId,
          bindingCount:
            (latestRef.current.bindingsCountByNode.get(asOutlineNodeId(attrs.nodeId)) ?? 0) || 1,
        });
      }
      return true;
    }

    if (childItems.length > 0 || hasNote) {
      return true;
    }

    if (!dispatch) return true;

    const prevBounds = getParaBoundsInItem(prevItem, prevPos);
    const joinPos = prevBounds.to;
    let tr = state.tr.insertText(paraText, joinPos);
    const mappedItemPos = tr.mapping.map(info.itemPos);
    const mappedItem = tr.doc.nodeAt(mappedItemPos);
    if (mappedItem) {
      tr = tr.delete(mappedItemPos, mappedItemPos + mappedItem.nodeSize);
    }
    tr = tr.setSelection(TextSelection.create(tr.doc, joinPos));
    dispatch(tr);
    return true;
  };

  return keymap({
    "Mod-z": undoHandler,
    "Mod-Shift-z": redoHandler,
    "Mod-y": redoHandler,
    Tab: indentCommand,
    "Shift-Tab": outdentCommand,
    "Alt-ArrowUp": moveSiblingCommand("up"),
    "Alt-ArrowDown": moveSiblingCommand("down"),
    "Mod-Enter": (st, dispatch) => {
      const info = findEnclosingOutlineItem(st.selection.$from);
      if (!info) return false;
      if (dispatch) executeToggleTodo(info.itemPos);
      return true;
    },
    "Alt-Enter": (st, dispatch) => {
      if (latestRef.current.readOnly || !latestRef.current.onDeferNode) return false;
      const info = findEnclosingOutlineItem(st.selection.$from);
      if (!info) return false;
      if (dispatch) {
        void executeDeferNode(info.itemPos, "tomorrow");
      }
      return true;
    },
    "Mod-.": (st, dispatch) => {
      const info = findEnclosingOutlineItem(st.selection.$from);
      if (!info) return false;
      if (getChildOutlineItems(info.item).length === 0) return true;
      if (dispatch) executeToggleCollapse(info.itemPos);
      return true;
    },
    "Shift-Enter": (st, dispatch) => {
      const info = findEnclosingOutlineItem(st.selection.$from);
      if (!info) return false;
      if (dispatch) {
        if (info.isNote) {
          const bounds = getParaBoundsInItem(info.item, info.itemPos);
          dispatch(st.tr.setSelection(TextSelection.create(st.doc, bounds.to)));
        } else {
          executeAddOrFocusNote(info.itemPos);
        }
      }
      return true;
    },
    Enter: enterCommand,
    Backspace: backspaceCommand,
  });
}

export function handleOutlinePaste(
  view: EditorView,
  event: ClipboardEvent,
  latestRef: React.RefObject<OutlineLatestState>,
  scheduleFlush: (immediate?: boolean) => void,
): boolean {
  if (latestRef.current.readOnly) return false;
  const plain = event.clipboardData?.getData("text/plain") ?? "";
  if (!isMultiLineOutlinePaste(plain)) return false;

  const entries = parseIndentedMarkdownToOutlineEntries(plain);
  if (entries.length === 0) return false;

  const pmItems = parsedEntriesToProseMirrorItems(entries, outlineSchema).map((item) =>
    item.type.create({ ...item.attrs, nodeId: createClientTempNodeId() }, item.content),
  );
  if (pmItems.length === 0) return false;

  event.preventDefault();
  const info = findEnclosingOutlineItem(view.state.selection.$from);
  if (!info) return false;

  const currentEmpty =
    info.item.child(0).textContent.trim().length === 0 &&
    getChildOutlineItems(info.item).length === 0;

  let tr = view.state.tr;
  if (currentEmpty && pmItems[0]) {
    const first = pmItems[0];
    const replaced = first.type.create(
      {
        ...first.attrs,
        nodeId: getOutlineItemAttrs(info.item.attrs).nodeId ?? createClientTempNodeId(),
      },
      first.content,
    );
    tr = tr.replaceWith(
      info.itemPos,
      info.itemPos + info.item.nodeSize,
      Fragment.fromArray([replaced, ...pmItems.slice(1)]),
    );
  } else {
    const insertPos = info.itemPos + info.item.nodeSize;
    tr = tr.insert(insertPos, Fragment.fromArray(pmItems));
  }

  view.dispatch(tr);
  scheduleFlush(true);
  return true;
}

export function handleOutlineClick(
  event: MouseEvent,
  latestRef: React.RefObject<OutlineLatestState>,
): boolean {
  const target = event.target;
  if (!(target instanceof Element)) return false;

  const tagEl = target.closest("[data-outline-tag]");
  if (tagEl) {
    const tag = tagEl.getAttribute("data-outline-tag");
    if (tag && latestRef.current.onClickTag) {
      event.preventDefault();
      latestRef.current.onClickTag(tag);
      return true;
    }
  }

  const wikiEl = target.closest("[data-wikilink]");
  if (wikiEl) {
    const docKey = wikiEl.getAttribute("data-wikilink");
    if (docKey && latestRef.current.onOpenDocument) {
      event.preventDefault();
      latestRef.current.onOpenDocument(docKey);
      return true;
    }
  }

  const blockRefEl = target.closest("[data-block-ref]");
  if (blockRefEl) {
    const rawRefId = blockRefEl.getAttribute("data-block-ref");
    const refId = rawRefId ? asOutlineNodeId(rawRefId) : null;
    if (refId && latestRef.current.activeById.has(refId)) {
      event.preventDefault();
      latestRef.current.setFocusRootId(refId);
      return true;
    }
  }

  const pdfCiteEl = target.closest("[data-inkade-pdf-citation]");
  if (pdfCiteEl) {
    const uri = pdfCiteEl.getAttribute("data-inkade-pdf-citation");
    if (uri && latestRef.current.onOpenPdfCitation) {
      event.preventDefault();
      latestRef.current.onOpenPdfCitation(uri);
      return true;
    }
  }

  const docBlockEl = target.closest("[data-inkade-doc-block]");
  if (docBlockEl) {
    const uri = docBlockEl.getAttribute("data-inkade-doc-block");
    if (uri) {
      event.preventDefault();
      if (latestRef.current.onOpenBlockDeepLink) {
        latestRef.current.onOpenBlockDeepLink(uri);
        return true;
      }
      const parsed = parseOutlineBlockDeepLink(uri);
      if (parsed && latestRef.current.onOpenDocument) {
        latestRef.current.onOpenDocument(parsed.docId);
        return true;
      }
    }
  }

  const urlEl = target.closest("[data-external-url]");
  if (urlEl) {
    const url = urlEl.getAttribute("data-external-url");
    if (url && (event.metaKey || event.ctrlKey || latestRef.current.readOnly)) {
      event.preventDefault();
      window.open(url, "_blank", "noopener,noreferrer");
      return true;
    }
  }

  return false;
}
