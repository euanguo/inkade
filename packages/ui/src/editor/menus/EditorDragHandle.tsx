"use client";

import { useInkadeTranslation } from "@inkade/i18n";
import DragHandle from "@tiptap/extension-drag-handle-react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { type Editor, useEditorState } from "@tiptap/react";
import { cn } from "../../lib/utils.ts";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckSquareIcon,
  ChevronRightIcon,
  CodeIcon,
  CopyIcon,
  GripVerticalIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  InfoIcon,
  ListIcon,
  ListOrderedIcon,
  PilcrowIcon,
  PlusIcon,
  QuoteIcon,
  Trash2Icon,
} from "lucide-react";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../primitives/button.tsx";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
} from "../../primitives/menu.tsx";
import type { BlockTurnIntoTarget } from "../types.ts";

export interface EditorDragHandleProps {
  readonly editor: Editor;
  readonly onDragStateChange?: ((dragging: boolean) => void) | undefined;
}

const DRAG_HANDLE_POSITION_CONFIG = {
  placement: "left-start" as const,
  strategy: "absolute" as const,
};

type DragHandleNestedConfig = Exclude<
  React.ComponentProps<typeof DragHandle>["nested"],
  boolean | undefined
>;

const DRAG_HANDLE_NESTED_CONFIG: DragHandleNestedConfig = {
  defaultRules: true,
  edgeDetection: "none",
  rules: [
    {
      id: "excludeTableCalloutQuoteDescendants",
      evaluate: ({ $pos, depth }) => {
        for (let d = depth - 1; d >= 1; d -= 1) {
          const ancestorName = $pos.node(d).type.name;
          if (
            ancestorName === "table" ||
            ancestorName === "inkadeCallout" ||
            ancestorName === "blockquote"
          ) {
            return 1000;
          }
        }
        return 0;
      },
    },
  ],
};

export function EditorDragHandle({
  editor,
  onDragStateChange,
}: EditorDragHandleProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const [activeTarget, setActiveTarget] = useState<{
    readonly node: PMNode;
    readonly pos: number;
  } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const hasActiveSelection = useEditorState({
    editor,
    selector: (ctx) => !ctx.editor.state.selection.empty,
  });
  const gripRef = useRef<HTMLButtonElement | null>(null);
  const didDragRef = useRef(false);
  const onDragStateChangeRef = useRef(onDragStateChange);
  onDragStateChangeRef.current = onDragStateChange;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const clearDrag = (): void => {
      if (!didDragRef.current) return;
      didDragRef.current = false;
      setIsDragging(false);
      onDragStateChangeRef.current?.(false);
    };
    window.addEventListener("dragend", clearDrag);
    window.addEventListener("drop", clearDrag);
    window.addEventListener("pointerup", clearDrag);
    return () => {
      window.removeEventListener("dragend", clearDrag);
      window.removeEventListener("drop", clearDrag);
      window.removeEventListener("pointerup", clearDrag);
    };
  }, []);

  const handleMenuOpenChange = (nextOpen: boolean): void => {
    setMenuOpen(nextOpen);
    try {
      editor.view.dispatch(editor.state.tr.setMeta("lockDragHandle", nextOpen));
    } catch {
      // Ignore if view is unmounted
    }
  };

  const resolveTopLevelPos = (pos: number): number => {
    try {
      const resolved = editor.state.doc.resolve(Math.min(pos, editor.state.doc.content.size));
      return resolved.depth >= 1 ? resolved.before(1) : pos;
    } catch {
      return pos;
    }
  };

  /**
   * Resolves a safe sibling insertion position after `activeTarget`, walking up out of
   * strict containers (e.g. `bulletList` / `orderedList` / `taskList`) so block inserts stay valid.
   */
  const resolveBlockInsertPos = (pos: number, node: PMNode): { readonly insertPos: number; readonly nodePos: number; readonly targetNode: PMNode } => {
    const paragraphType = editor.state.schema.nodes.paragraph;
    if (!paragraphType) {
      return { insertPos: pos + node.nodeSize, nodePos: pos, targetNode: node };
    }
    try {
      let currentPos = pos;
      let currentNode = node;
      let $after = editor.state.doc.resolve(Math.min(currentPos + currentNode.nodeSize, editor.state.doc.content.size));
      while ($after.depth >= 1 && !$after.parent.canReplaceWith($after.index(), $after.index(), paragraphType)) {
        const parentPos = $after.before($after.depth);
        const parentNode = editor.state.doc.nodeAt(parentPos);
        if (!parentNode) break;
        currentPos = parentPos;
        currentNode = parentNode;
        $after = editor.state.doc.resolve(Math.min(currentPos + currentNode.nodeSize, editor.state.doc.content.size));
      }
      return {
        insertPos: Math.min(currentPos + currentNode.nodeSize, editor.state.doc.content.size),
        nodePos: currentPos,
        targetNode: currentNode,
      };
    } catch {
      return { insertPos: pos + node.nodeSize, nodePos: pos, targetNode: node };
    }
  };

  const insertBlockBelowAndSlash = (): void => {
    if (!activeTarget) return;
    const node = editor.state.doc.nodeAt(activeTarget.pos);
    if (!node) return;
    const { insertPos } = resolveBlockInsertPos(activeTarget.pos, node);
    editor
      .chain()
      .focus()
      .insertContentAt(insertPos, { type: "paragraph", content: [{ type: "text", text: "/" }] })
      .setTextSelection(Math.min(insertPos + 2, editor.state.doc.content.size + 5))
      .run();
  };

  const moveBlockDirection = (direction: "up" | "down"): void => {
    if (!activeTarget) return;
    const pos = resolveTopLevelPos(activeTarget.pos);
    const { state, view } = editor;
    const node = state.doc.nodeAt(pos);
    if (!node) return;

    const topNodes: Array<{ pos: number; size: number }> = [];
    state.doc.forEach((child, offset) => {
      topNodes.push({ pos: offset, size: child.nodeSize });
    });

    const idx = topNodes.findIndex((item) => item.pos === pos);
    if (idx < 0) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    const swapTarget = topNodes[swapIdx];
    if (!swapTarget) return;

    const tr = state.tr;
    if (direction === "up") {
      tr.delete(pos, pos + node.nodeSize);
      tr.insert(swapTarget.pos, node);
    } else {
      const insertAfterPos = swapTarget.pos + swapTarget.size;
      tr.insert(insertAfterPos, node);
      tr.delete(pos, pos + node.nodeSize);
    }
    view.dispatch(tr);
  };

  const duplicateBlock = (): void => {
    if (!activeTarget) return;
    const { state, view } = editor;
    const node = state.doc.nodeAt(activeTarget.pos);
    if (!node) return;
    try {
      view.dispatch(state.tr.insert(activeTarget.pos + node.nodeSize, node.copy(node.content)));
    } catch {
      const topPos = resolveTopLevelPos(activeTarget.pos);
      const topNode = state.doc.nodeAt(topPos);
      if (topNode) {
        view.dispatch(state.tr.insert(topPos + topNode.nodeSize, topNode.copy(topNode.content)));
      }
    }
  };

  const copyBlockText = (): void => {
    if (!activeTarget) return;
    const node = editor.state.doc.nodeAt(activeTarget.pos);
    if (!node) return;
    const text = node.textContent.trim();
    if (text && typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(text);
    }
  };

  const deleteBlock = (): void => {
    if (!activeTarget) return;
    const { state, view } = editor;
    const node = state.doc.nodeAt(activeTarget.pos);
    if (!node) return;
    if (state.doc.childCount === 1 && activeTarget.pos === 0) {
      editor
        .chain()
        .focus()
        .deleteRange({ from: 0, to: node.nodeSize })
        .insertContentAt(0, { type: "paragraph" })
        .run();
      return;
    }
    try {
      view.dispatch(state.tr.delete(activeTarget.pos, activeTarget.pos + node.nodeSize));
    } catch {
      const topPos = resolveTopLevelPos(activeTarget.pos);
      const topNode = state.doc.nodeAt(topPos);
      if (topNode) {
        view.dispatch(state.tr.delete(topPos, topPos + topNode.nodeSize));
      }
    }
  };

  const turnBlockInto = (target: BlockTurnIntoTarget): void => {
    if (!activeTarget) return;
    const pos = activeTarget.pos;
    const node = editor.state.doc.nodeAt(pos);
    if (!node) return;
    const nonConvertibleAtoms = new Set([
      "image",
      "inkadeMathBlock",
      "inkadeColumns",
      "table",
      "horizontalRule",
    ]);
    if (nonConvertibleAtoms.has(node.type.name)) {
      return;
    }
    const text = node.textContent;
    const innerPos = Math.min(editor.state.doc.content.size, pos + 1);

    // Turning a wrapper block (callout / toggle) into a flat block unwraps its outer container cleanly
    if (node.type.name === "inkadeCallout" || node.type.name === "inkadeToggle") {
      const inlineContent = text ? [{ type: "text", text }] : [];
      if (target === "paragraph") {
        editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).insertContentAt(pos, { type: "paragraph", content: inlineContent }).run();
        return;
      }
      if (target === "h1" || target === "h2" || target === "h3") {
        const level = target === "h1" ? 1 : target === "h2" ? 2 : 3;
        editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).insertContentAt(pos, { type: "heading", attrs: { level }, content: inlineContent }).run();
        return;
      }
      if (target === "code") {
        editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).insertContentAt(pos, { type: "codeBlock", content: inlineContent }).run();
        return;
      }
    }

    editor.chain().focus().setTextSelection(innerPos).run();

    if (target === "paragraph") {
      if (!editor.isActive("paragraph")) editor.chain().focus().setParagraph().run();
    } else if (target === "h1") {
      if (!editor.isActive("heading", { level: 1 })) editor.chain().focus().setHeading({ level: 1 }).run();
    } else if (target === "h2") {
      if (!editor.isActive("heading", { level: 2 })) editor.chain().focus().setHeading({ level: 2 }).run();
    } else if (target === "h3") {
      if (!editor.isActive("heading", { level: 3 })) editor.chain().focus().setHeading({ level: 3 }).run();
    } else if (target === "bullet") {
      if (!editor.isActive("bulletList")) editor.chain().focus().toggleBulletList().run();
    } else if (target === "ordered") {
      if (!editor.isActive("orderedList")) editor.chain().focus().toggleOrderedList().run();
    } else if (target === "task") {
      if (!editor.isActive("taskList")) editor.chain().focus().toggleTaskList().run();
    } else if (target === "blockquote") {
      if (!editor.isActive("blockquote")) editor.chain().focus().toggleBlockquote().run();
    } else if (target === "code") {
      if (!editor.isActive("codeBlock")) editor.chain().focus().toggleCodeBlock().run();
    } else if (target === "callout") {
      if (node.type.name === "inkadeCallout") return;
      editor
        .chain()
        .focus()
        .deleteRange({ from: pos, to: pos + node.nodeSize })
        .insertContentAt(pos, {
          type: "inkadeCallout",
          attrs: { kind: "note" },
          content: [{ type: "paragraph", content: text ? [{ type: "text", text }] : [] }],
        })
        .run();
    } else if (target === "toggle") {
      if (node.type.name === "inkadeToggle") return;
      editor
        .chain()
        .focus()
        .deleteRange({ from: pos, to: pos + node.nodeSize })
        .insertContentAt(pos, {
          type: "inkadeToggle",
          attrs: { summary: text.slice(0, 60), open: true },
          content: [{ type: "paragraph" }],
        })
        .run();
    }
  };

  return (
    <DragHandle
      className={cn(
        "inkade-drag-handle not-typeset z-10 hidden items-center gap-0.5 -my-0.5 py-0.5 pr-2 data-[target-kind=listItem]:pr-7 data-[target-kind=taskItem]:pr-3 md:flex",
        hasActiveSelection && !isDragging && "pointer-events-none opacity-0",
      )}
      computePositionConfig={DRAG_HANDLE_POSITION_CONFIG}
      editor={editor}
      nested={DRAG_HANDLE_NESTED_CONFIG}
      onElementDragEnd={() => {
        setIsDragging(false);
        onDragStateChangeRef.current?.(false);
        requestAnimationFrame(() => {
          didDragRef.current = false;
        });
      }}
      onElementDragStart={() => {
        didDragRef.current = true;
        setIsDragging(true);
        onDragStateChangeRef.current?.(true);
        if (menuOpen) {
          handleMenuOpenChange(false);
        }
      }}
      onNodeChange={({ node, pos }) => {
        if (menuOpen) return;
        const handleEl = gripRef.current?.closest<HTMLElement>(".inkade-drag-handle");
        if (handleEl) {
          handleEl.dataset.targetKind = node?.type.name ?? "";
        }
        setActiveTarget((prev) => {
          if (!node) return prev === null ? prev : null;
          if (prev && prev.pos === pos && prev.node === node) return prev;
          return { node, pos };
        });
      }}
    >
      <div className="flex items-center gap-0.5 pt-0.5">
        <Button
          aria-label={t("editor.blockHandleInsertAria")}
          className="size-5 text-muted-foreground/75 hover:text-foreground"
          onClick={insertBlockBelowAndSlash}
          size="icon-xs"
          type="button"
          variant="ghost"
        >
          <PlusIcon className="size-3.5" />
        </Button>

        <button
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          aria-label={t("editor.blockHandleMenuAria")}
          className="inline-flex size-5 cursor-grab items-center justify-center rounded-md text-muted-foreground/75 transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--border-focus)] active:cursor-grabbing"
          data-drag-handle-grip="true"
          onClick={() => {
            if (didDragRef.current) return;
            handleMenuOpenChange(!menuOpen);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            handleMenuOpenChange(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleMenuOpenChange(true);
            }
          }}
          ref={gripRef}
          type="button"
        >
          <GripVerticalIcon className="size-3.5" />
        </button>

        <Menu onOpenChange={handleMenuOpenChange} open={menuOpen}>
          <MenuPopup align="start" anchor={gripRef}>
            <MenuItem onClick={() => moveBlockDirection("up")}>
              <ArrowUpIcon />
              {t("editor.blockMoveUp")}
            </MenuItem>
            <MenuItem onClick={() => moveBlockDirection("down")}>
              <ArrowDownIcon />
              {t("editor.blockMoveDown")}
            </MenuItem>
            <MenuSeparator />
            <MenuSub>
              <MenuSubTrigger>
                <PilcrowIcon />
                {t("editor.blockTurnInto")}
              </MenuSubTrigger>
              <MenuSubPopup>
                <MenuItem onClick={() => turnBlockInto("paragraph")}>
                  <PilcrowIcon />
                  {t("editor.slashParagraph")}
                </MenuItem>
                <MenuItem onClick={() => turnBlockInto("h1")}>
                  <Heading1Icon />
                  {t("editor.slashHeading1")}
                </MenuItem>
                <MenuItem onClick={() => turnBlockInto("h2")}>
                  <Heading2Icon />
                  {t("editor.slashHeading2")}
                </MenuItem>
                <MenuItem onClick={() => turnBlockInto("h3")}>
                  <Heading3Icon />
                  {t("editor.slashHeading3")}
                </MenuItem>
                <MenuItem onClick={() => turnBlockInto("bullet")}>
                  <ListIcon />
                  {t("editor.slashBulletList")}
                </MenuItem>
                <MenuItem onClick={() => turnBlockInto("ordered")}>
                  <ListOrderedIcon />
                  {t("editor.slashOrderedList")}
                </MenuItem>
                <MenuItem onClick={() => turnBlockInto("task")}>
                  <CheckSquareIcon />
                  {t("editor.slashTaskList")}
                </MenuItem>
                <MenuItem onClick={() => turnBlockInto("blockquote")}>
                  <QuoteIcon />
                  {t("editor.blockquote")}
                </MenuItem>
                <MenuItem onClick={() => turnBlockInto("code")}>
                  <CodeIcon />
                  {t("editor.slashCodeBlock")}
                </MenuItem>
                <MenuItem onClick={() => turnBlockInto("callout")}>
                  <InfoIcon />
                  {t("editor.slashCalloutNote")}
                </MenuItem>
                <MenuItem onClick={() => turnBlockInto("toggle")}>
                  <ChevronRightIcon />
                  {t("editor.slashToggle")}
                </MenuItem>
              </MenuSubPopup>
            </MenuSub>
            <MenuItem
              onClick={() => {
                if (!activeTarget) return;
                const node = editor.state.doc.nodeAt(activeTarget.pos);
                if (!node) return;
                const { insertPos } = resolveBlockInsertPos(activeTarget.pos, node);
                editor
                  .chain()
                  .focus()
                  .insertContentAt(insertPos, {
                    type: "inkadeCallout",
                    attrs: { kind: "note" },
                    content: [{ type: "paragraph" }],
                  })
                  .run();
              }}
            >
              <InfoIcon />
              {t("editor.blockInsertCalloutBelow")}
            </MenuItem>
            <MenuItem
              onClick={() => {
                if (!activeTarget) return;
                const node = editor.state.doc.nodeAt(activeTarget.pos);
                if (!node) return;
                const { insertPos } = resolveBlockInsertPos(activeTarget.pos, node);
                editor
                  .chain()
                  .focus()
                  .insertContentAt(insertPos, {
                    type: "inkadeToggle",
                    attrs: { summary: "", open: true },
                    content: [{ type: "paragraph" }],
                  })
                  .run();
              }}
            >
              <ChevronRightIcon />
              {t("editor.blockInsertToggleBelow")}
            </MenuItem>
            <MenuItem onClick={duplicateBlock}>
              <CopyIcon />
              {t("editor.blockDuplicate")}
            </MenuItem>
            <MenuItem onClick={copyBlockText}>
              <CopyIcon />
              {t("editor.blockCopyLink")}
            </MenuItem>
            <MenuSeparator />
            <MenuItem onClick={deleteBlock} variant="destructive">
              <Trash2Icon />
              {t("editor.blockDelete")}
            </MenuItem>
          </MenuPopup>
        </Menu>
      </div>
    </DragHandle>
  );
}
