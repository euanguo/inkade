import NodeRange, { isNodeRangeSelection } from "@tiptap/extension-node-range";

/**
 * Restricts TipTap NodeRange mouse selection to explicit `Mod` (Cmd/Ctrl) drags
 * and preserves native character/line selection for Shift+Arrow and Mod+A.
 */
export const InkadeNodeRangeExtension = NodeRange.extend({
  addOptions() {
    return {
      ...this.parent?.(),
      depth: undefined,
      key: "Mod" as const,
    };
  },

  addKeyboardShortcuts() {
    return {
      "Shift-ArrowUp": ({ editor }) => {
        const { state, view } = editor;
        if (!isNodeRangeSelection(state.selection)) {
          return false;
        }
        const next = state.selection.extendBackwards();
        view.dispatch(state.tr.setSelection(next));
        return true;
      },
      "Shift-ArrowDown": ({ editor }) => {
        const { state, view } = editor;
        if (!isNodeRangeSelection(state.selection)) {
          return false;
        }
        const next = state.selection.extendForwards();
        view.dispatch(state.tr.setSelection(next));
        return true;
      },
      "Mod-a": () => false,
    };
  },
});
