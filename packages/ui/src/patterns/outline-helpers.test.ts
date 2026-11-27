import { describe, expect, it } from "bun:test";
import { asDocumentId, asOutlineNodeId, type OutlineNode, type OutlineNodeId } from "@inkade/core";
import {
  computeDropMoveTarget,
  cycleTodoState,
  extractSlashTrigger,
  extractWikilinkTrigger,
  flattenVisibleOutline,
  getOutlineBreadcrumbs,
  isImeComposing,
  resolveOutlineKeyboardAction,
} from "./outline-helpers.ts";

function makeNode(
  overrides: Omit<Partial<OutlineNode>, "id" | "parentNodeId"> & {
    readonly id: string;
    readonly parentNodeId?: string | null | undefined;
  },
): OutlineNode {
  const { id, parentNodeId, ...rest } = overrides;
  return {
    documentId: asDocumentId("doc_1"),
    orderKey: "a0",
    contentMarkdown: id,
    contentText: id,
    checked: null,
    collapsed: false,
    authorType: "human",
    authorId: null,
    sourceBindingId: null,
    createdAt: "2026-11-24T00:00:00.000Z",
    updatedAt: "2026-11-24T00:00:00.000Z",
    deletedAt: null,
    ...rest,
    id: asOutlineNodeId(id),
    parentNodeId: parentNodeId ? asOutlineNodeId(parentNodeId) : null,
  };
}

const sampleNodes: OutlineNode[] = [
  makeNode({ id: "n1", orderKey: "a0", contentText: "Project Alpha", contentMarkdown: "Project Alpha" }),
  makeNode({
    id: "n1_1",
    parentNodeId: "n1",
    orderKey: "a0",
    contentText: "Concurrency lock",
    contentMarkdown: "Concurrency lock",
  }),
  makeNode({
    id: "n1_2",
    parentNodeId: "n1",
    orderKey: "a1",
    contentText: "Write tests",
    contentMarkdown: "Write tests",
    checked: false,
  }),
  makeNode({
    id: "n2",
    orderKey: "a1",
    collapsed: true,
    contentText: "Collapsed Root",
    contentMarkdown: "Collapsed Root",
  }),
  makeNode({
    id: "n2_1",
    parentNodeId: "n2",
    orderKey: "a0",
    contentText: "Hidden child",
    contentMarkdown: "Hidden child",
  }),
  makeNode({
    id: "n_deleted",
    orderKey: "a2",
    deletedAt: "2026-11-24T01:00:00.000Z",
  }),
];

describe("outline-helpers", () => {
  it("flattens visible nodes in order while hiding collapsed descendants and soft-deleted nodes", () => {
    const flat = flattenVisibleOutline(sampleNodes);
    expect(flat.map((f) => [f.node.id, f.depth])).toEqual([
      [asOutlineNodeId("n1"), 0],
      [asOutlineNodeId("n1_1"), 1],
      [asOutlineNodeId("n1_2"), 1],
      [asOutlineNodeId("n2"), 0],
    ]);
    expect(flat[0]?.hasChildren).toBe(true);
    expect(flat[3]?.hasChildren).toBe(true);
  });

  it("supports bullet zoom-in focus root and computes hierarchical breadcrumbs", () => {
    const zoomed = flattenVisibleOutline(sampleNodes, asOutlineNodeId("n1"));
    expect(zoomed.map((f) => [f.node.id, f.depth])).toEqual([
      [asOutlineNodeId("n1_1"), 0],
      [asOutlineNodeId("n1_2"), 0],
    ]);

    const crumbs = getOutlineBreadcrumbs(sampleNodes, asOutlineNodeId("n1_1"), "2026-11-24");
    expect(crumbs).toEqual([
      { id: "__root__", label: "2026-11-24" },
      { id: asOutlineNodeId("n1"), label: "Project Alpha" },
      { id: asOutlineNodeId("n1_1"), label: "Concurrency lock" },
    ]);
  });

  it("blocks all keyboard shortcuts during IME composition (isComposing or keyCode 229)", () => {
    const flat = flattenVisibleOutline(sampleNodes);
    const bindings = new Map<OutlineNodeId, number>();

    expect(isImeComposing({ key: "Enter", isComposing: true })).toBe(true);
    expect(isImeComposing({ key: "Enter", keyCode: 229 })).toBe(true);
    expect(
      isImeComposing({
        key: "Backspace",
        nativeEvent: { isComposing: true },
      }),
    ).toBe(true);

    const actionDuringIme = resolveOutlineKeyboardAction({
      nodeId: asOutlineNodeId("n1_1"),
      flatNodes: flat,
      allNodes: sampleNodes,
      bindingsCountByNode: bindings,
      isContentEmpty: false,
      event: { key: "Enter", isComposing: true },
    });
    expect(actionDuringIme).toEqual({ type: "noop" });

    const actionKey229 = resolveOutlineKeyboardAction({
      nodeId: asOutlineNodeId("n1_1"),
      flatNodes: flat,
      allNodes: sampleNodes,
      bindingsCountByNode: bindings,
      isContentEmpty: true,
      event: { key: "Backspace", nativeEvent: { keyCode: 229 } },
    });
    expect(actionKey229).toEqual({ type: "noop" });
  });

  it("resolves Enter, Tab, Shift+Tab, Alt+Arrows, Cmd+Enter, Cmd+., and protected Backspace", () => {
    const flat = flattenVisibleOutline(sampleNodes);
    const bindings = new Map<OutlineNodeId, number>([[asOutlineNodeId("n1_2"), 2]]);

    // Enter on expanded parent creates first child
    expect(
      resolveOutlineKeyboardAction({
        nodeId: asOutlineNodeId("n1"),
        flatNodes: flat,
        allNodes: sampleNodes,
        bindingsCountByNode: bindings,
        isContentEmpty: false,
        event: { key: "Enter" },
      }),
    ).toEqual({
      type: "create_below",
      parentNodeId: asOutlineNodeId("n1"),
      afterNodeId: null,
      beforeNodeId: asOutlineNodeId("n1_1"),
    });

    // Enter on leaf creates sibling below
    expect(
      resolveOutlineKeyboardAction({
        nodeId: asOutlineNodeId("n1_1"),
        flatNodes: flat,
        allNodes: sampleNodes,
        bindingsCountByNode: bindings,
        isContentEmpty: false,
        event: { key: "Enter" },
      }),
    ).toEqual({
      type: "create_below",
      parentNodeId: asOutlineNodeId("n1"),
      afterNodeId: asOutlineNodeId("n1_1"),
      beforeNodeId: asOutlineNodeId("n1_2"),
    });

    // Tab indents under previous sibling
    expect(
      resolveOutlineKeyboardAction({
        nodeId: asOutlineNodeId("n1_2"),
        flatNodes: flat,
        allNodes: sampleNodes,
        bindingsCountByNode: bindings,
        isContentEmpty: false,
        event: { key: "Tab" },
      }),
    ).toEqual({
      type: "indent",
      nodeId: asOutlineNodeId("n1_2"),
      newParentNodeId: asOutlineNodeId("n1_1"),
      afterNodeId: null,
    });

    // Shift+Tab outdents to parent's sibling level
    expect(
      resolveOutlineKeyboardAction({
        nodeId: asOutlineNodeId("n1_2"),
        flatNodes: flat,
        allNodes: sampleNodes,
        bindingsCountByNode: bindings,
        isContentEmpty: false,
        event: { key: "Tab", shiftKey: true },
      }),
    ).toEqual({
      type: "outdent",
      nodeId: asOutlineNodeId("n1_2"),
      newParentNodeId: null,
      afterNodeId: asOutlineNodeId("n1"),
    });

    // Alt+ArrowUp reorders within same parent
    expect(
      resolveOutlineKeyboardAction({
        nodeId: asOutlineNodeId("n1_2"),
        flatNodes: flat,
        allNodes: sampleNodes,
        bindingsCountByNode: bindings,
        isContentEmpty: false,
        event: { key: "ArrowUp", altKey: true },
      }),
    ).toEqual({
      type: "move_up",
      nodeId: asOutlineNodeId("n1_2"),
      parentNodeId: asOutlineNodeId("n1"),
      afterNodeId: null,
      beforeNodeId: asOutlineNodeId("n1_1"),
    });

    // Cmd/Ctrl+Enter cycles todo state
    expect(cycleTodoState(null)).toBe(false);
    expect(cycleTodoState(false)).toBe(true);
    expect(cycleTodoState(true)).toBe(null);

    expect(
      resolveOutlineKeyboardAction({
        nodeId: asOutlineNodeId("n1_2"),
        flatNodes: flat,
        allNodes: sampleNodes,
        bindingsCountByNode: bindings,
        isContentEmpty: false,
        event: { key: "Enter", metaKey: true },
      }),
    ).toEqual({
      type: "cycle_todo",
      nodeId: asOutlineNodeId("n1_2"),
      nextChecked: true,
    });

    // Cmd/Ctrl+. toggles collapse
    expect(
      resolveOutlineKeyboardAction({
        nodeId: asOutlineNodeId("n1"),
        flatNodes: flat,
        allNodes: sampleNodes,
        bindingsCountByNode: bindings,
        isContentEmpty: false,
        event: { key: ".", ctrlKey: true },
      }),
    ).toEqual({
      type: "toggle_collapse",
      nodeId: asOutlineNodeId("n1"),
      nextCollapsed: true,
    });

    // Backspace on empty root node with active bindings sets hasBindings=true
    const rootWithBindings = [
      makeNode({ id: "r1", orderKey: "a0" }),
      makeNode({ id: "r2", orderKey: "a1", contentMarkdown: "", contentText: "" }),
    ];
    const rootFlat = flattenVisibleOutline(rootWithBindings);
    expect(
      resolveOutlineKeyboardAction({
        nodeId: asOutlineNodeId("r2"),
        flatNodes: rootFlat,
        allNodes: rootWithBindings,
        bindingsCountByNode: new Map([[asOutlineNodeId("r2"), 1]]),
        isContentEmpty: true,
        event: { key: "Backspace" },
      }),
    ).toEqual({
      type: "delete_or_outdent_empty",
      nodeId: asOutlineNodeId("r2"),
      hasBindings: true,
      focusTargetId: asOutlineNodeId("r1"),
    });
  });

  it("computes fractional-index drop targets and blocks dropping into own subtree", () => {
    // Reject dropping parent into its own descendant
    expect(
      computeDropMoveTarget(sampleNodes, asOutlineNodeId("n1"), asOutlineNodeId("n1_1"), "above"),
    ).toBeNull();

    // Drop n2 above n1
    const moveAbove = computeDropMoveTarget(
      sampleNodes,
      asOutlineNodeId("n2"),
      asOutlineNodeId("n1"),
      "above",
    );
    expect(moveAbove).not.toBeNull();
    expect(moveAbove?.parentNodeId).toBeNull();
    expect(moveAbove?.beforeNodeId).toBe(asOutlineNodeId("n1"));
    expect(moveAbove && moveAbove.orderKey < "a0").toBe(true);

    // Drop n2 as child of n1 (after n1_2 whose orderKey is a1)
    const moveChild = computeDropMoveTarget(
      sampleNodes,
      asOutlineNodeId("n2"),
      asOutlineNodeId("n1"),
      "child",
    );
    expect(moveChild).not.toBeNull();
    expect(moveChild?.parentNodeId).toBe(asOutlineNodeId("n1"));
    expect(moveChild?.afterNodeId).toBe(asOutlineNodeId("n1_2"));
    expect(moveChild && moveChild.orderKey > "a1").toBe(true);
  });

  it("extracts [[wikilink]] and /slash triggers at cursor position", () => {
    expect(extractWikilinkTrigger("Check [[proj", 12)).toEqual({
      query: "proj",
      startIndex: 6,
    });
    expect(extractWikilinkTrigger("Done [[proj]] next", 18)).toBeNull();

    expect(extractSlashTrigger("/disp", 5)).toEqual({
      query: "disp",
      startIndex: 0,
    });
    expect(extractSlashTrigger("Task /to", 8)).toEqual({
      query: "to",
      startIndex: 5,
    });
    expect(extractSlashTrigger("https://example.com/path", 24)).toBeNull();
  });
});
