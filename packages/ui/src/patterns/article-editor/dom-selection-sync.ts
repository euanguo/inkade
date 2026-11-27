import { isNodeRangeSelection } from "@tiptap/extension-node-range";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import type { TriggerMatch } from "../../editor/types.ts";

export function triggersEqual(a: TriggerMatch | null, b: TriggerMatch | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.kind === b.kind &&
    a.query === b.query &&
    a.rangeFrom === b.rangeFrom &&
    a.rangeTo === b.rangeTo
  );
}

/**
 * Syncs native DOM text selection back to ProseMirror on mouseup when not marquee-dragging,
 * guarding against contenteditable=false blocks and unmapped DOM nodes.
 */
export function syncDomMouseSelectionToProseMirror(
  editor: Editor | null,
  readOnly: boolean,
  isMarqueeDragging: boolean,
): void {
  if (!editor || readOnly || editor.isDestroyed) return;
  if (isMarqueeDragging) return;
  if (
    isNodeRangeSelection(editor.state.selection) ||
    editor.state.selection instanceof NodeSelection
  ) {
    return;
  }
  const sel = typeof window !== "undefined" ? window.getSelection() : null;
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
  if (!sel.anchorNode || !sel.focusNode) return;

  const anchorEl =
    sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode.parentElement;
  const focusEl =
    sel.focusNode instanceof Element ? sel.focusNode : sel.focusNode.parentElement;
  if (
    anchorEl?.closest('[contenteditable="false"]') ||
    focusEl?.closest('[contenteditable="false"]')
  ) {
    return;
  }

  const pmDom = editor.view.dom;
  if (!pmDom.contains(sel.anchorNode) || !pmDom.contains(sel.focusNode)) {
    return;
  }

  try {
    const anchorPos = editor.view.posAtDOM(sel.anchorNode, sel.anchorOffset);
    const focusPos = editor.view.posAtDOM(sel.focusNode, sel.focusOffset);
    if (anchorPos === focusPos) return;
    const from = Math.min(anchorPos, focusPos);
    const to = Math.max(anchorPos, focusPos);
    if (
      !editor.isFocused ||
      editor.state.selection.from !== from ||
      editor.state.selection.to !== to
    ) {
      const { doc: pmDoc, tr } = editor.state;
      tr.setSelection(TextSelection.create(pmDoc, anchorPos, focusPos));
      editor.view.dispatch(tr);
      if (!editor.isFocused) {
        editor.view.focus();
      }
    }
  } catch {
    // Ignore non-mapped DOM selections
  }
}
