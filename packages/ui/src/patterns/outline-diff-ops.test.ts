import { describe, expect, it } from "bun:test";
import { asDocumentId, asOutlineNodeId, asThreadBindingId, type OutlineNode } from "@inkade/core";
import {
  isNodeBindingProtected,
  outlineToProseMirrorDoc,
  parsedEntriesToProseMirrorItems,
  parseIndentedMarkdownToOutlineEntries,
  prosemirrorToOutlineBatchOps,
} from "./outline-diff-ops.ts";
import { outlineSchema } from "./outline-schema.ts";

function makeNode(
  overrides: Omit<Partial<OutlineNode>, "id" | "parentNodeId" | "sourceBindingId"> & {
    readonly id: string;
    readonly parentNodeId?: string | null | undefined;
    readonly sourceBindingId?: string | null | undefined;
  },
): OutlineNode {
  const { id, parentNodeId, sourceBindingId, ...rest } = overrides;
  return {
    documentId: asDocumentId("doc_1"),
    orderKey: "a0",
    contentMarkdown: id,
    contentText: id,
    noteMarkdown: "",
    noteText: "",
    checked: null,
    collapsed: false,
    authorType: "human",
    authorId: null,
    mirrorOfNodeId: null,
    rolledOverToDocId: null,
    createdAt: "2026-11-24T00:00:00.000Z",
    updatedAt: "2026-11-24T00:00:00.000Z",
    deletedAt: null,
    ...rest,
    id: asOutlineNodeId(id),
    parentNodeId: parentNodeId ? asOutlineNodeId(parentNodeId) : null,
    sourceBindingId: sourceBindingId ? asThreadBindingId(sourceBindingId) : null,
  };
}

describe("outline-diff-ops", () => {
  it("round-trips OutlineNode[] to ProseMirror doc and emits zero ops when unchanged", () => {
    const nodes: OutlineNode[] = [
      makeNode({
        id: "nod_1",
        orderKey: "a0",
        contentMarkdown: "Parent **bold**",
        noteMarkdown: "WorkFlowy note",
        checked: false,
      }),
      makeNode({
        id: "nod_1_1",
        parentNodeId: "nod_1",
        orderKey: "a0",
        contentMarkdown: "Child [[Spec]]",
      }),
      makeNode({
        id: "nod_2",
        orderKey: "a1",
        contentMarkdown: "Second root",
      }),
    ];

    const doc = outlineToProseMirrorDoc(nodes);
    expect(doc.childCount).toBe(2);
    expect(doc.child(0).attrs["nodeId"]).toBe("nod_1");
    expect(doc.child(0).child(0).textContent).toBe("Parent **bold**");
    expect(doc.child(0).child(1).type.name).toBe("outlineNote");
    expect(doc.child(0).child(1).textContent).toBe("WorkFlowy note");
    expect(doc.child(0).child(2).attrs["nodeId"]).toBe("nod_1_1");

    const ops = prosemirrorToOutlineBatchOps(nodes, doc);
    expect(ops).toEqual([]);
  });

  it("preserves original nodeId on mid-line Enter split and assigns tempId to trailing node", () => {
    const prevNodes: OutlineNode[] = [
      makeNode({
        id: "nod_bound",
        orderKey: "a0",
        contentMarkdown: "Hello world",
        sourceBindingId: "bnd_123",
        checked: false,
      }),
      makeNode({
        id: "nod_after",
        orderKey: "a1",
        contentMarkdown: "Existing second",
      }),
    ];

    const itemType = outlineSchema.nodes["outlineItem"];
    const paraType = outlineSchema.nodes["outlineParagraph"];
    const docType = outlineSchema.nodes["outlineDoc"];

    // Simulate mid-line split of "Hello world" -> original keeps nod_bound ("Hello"), new gets null ("world")
    const nextDoc = docType.create(null, [
      itemType.create(
        {
          nodeId: "nod_bound",
          checked: false,
          collapsed: false,
          authorType: "human",
          sourceBindingId: "bnd_123",
        },
        [paraType.create(null, [outlineSchema.text("Hello")])],
      ),
      itemType.create(
        {
          nodeId: null,
          checked: false,
          collapsed: false,
          authorType: "human",
          sourceBindingId: null,
        },
        [paraType.create(null, [outlineSchema.text("world")])],
      ),
      itemType.create(
        {
          nodeId: "nod_after",
          checked: null,
          collapsed: false,
          authorType: "human",
          sourceBindingId: null,
        },
        [paraType.create(null, [outlineSchema.text("Existing second")])],
      ),
    ]);

    const ops = prosemirrorToOutlineBatchOps(prevNodes, nextDoc);

    const createOps = ops.filter((o) => o.op === "create");
    const updateOps = ops.filter((o) => o.op === "update");
    const deleteOps = ops.filter((o) => o.op === "delete");
    const moveOps = ops.filter((o) => o.op === "move");

    expect(deleteOps).toEqual([]);
    expect(moveOps).toEqual([]);
    expect(createOps).toHaveLength(1);
    expect(createOps[0]).toMatchObject({
      op: "create",
      parentNodeId: null,
      contentMarkdown: "world",
      checked: false,
    });
    expect(createOps[0]?.op === "create" && createOps[0].tempId).toBeTruthy();
    expect(createOps[0]?.op === "create" && createOps[0].orderKey).toBeTruthy();
    if (createOps[0]?.op === "create" && createOps[0].orderKey) {
      expect(createOps[0].orderKey > "a0").toBe(true);
      expect(createOps[0].orderKey < "a1").toBe(true);
    }

    expect(updateOps).toEqual([
      {
        op: "update",
        nodeId: asOutlineNodeId("nod_bound"),
        contentMarkdown: "Hello",
      },
    ]);
  });

  it("parses multi-line indented Markdown into hierarchical child outlineItems in one batch", () => {
    const markdown = [
      "- Root goal",
      "  - [ ] Subtask A",
      "    - [x] Deep detail",
      "  * Subtask B",
      "    \t- Tab nested",
    ].join("\n");

    const entries = parseIndentedMarkdownToOutlineEntries(markdown);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.contentMarkdown).toBe("Root goal");
    expect(entries[0]?.children).toHaveLength(2);
    expect(entries[0]?.children[0]?.checked).toBe(false);
    expect(entries[0]?.children[0]?.children[0]?.checked).toBe(true);
    expect(entries[0]?.children[1]?.contentMarkdown).toBe("Subtask B");
    expect(entries[0]?.children[1]?.children[0]?.contentMarkdown).toBe("Tab nested");

    const pmItems = parsedEntriesToProseMirrorItems(entries);
    const doc = outlineSchema.nodes["outlineDoc"].create(null, pmItems);
    const ops = prosemirrorToOutlineBatchOps([], doc);

    expect(ops).toHaveLength(5);
    expect(ops.every((o) => o.op === "create")).toBe(true);

    const created = ops.filter((o): o is Extract<typeof o, { op: "create" }> => o.op === "create");
    const rootOp = created[0]!;
    const subAOp = created[1]!;
    const deepOp = created[2]!;
    const subBOp = created[3]!;
    const tabOp = created[4]!;

    expect(rootOp.parentNodeId).toBeNull();
    expect(subAOp.parentNodeId).toBe(rootOp.tempId);
    expect(deepOp.parentNodeId).toBe(subAOp.tempId);
    expect(subBOp.parentNodeId).toBe(rootOp.tempId);
    expect(tabOp.parentNodeId).toBe(subBOp.tempId);
    // Sibling order keys must strictly increase under same parent
    expect(subAOp.orderKey! < subBOp.orderKey!).toBe(true);
  });

  it("guards Backspace delete/merge on nodes with sourceBindingId or active ADE bindings", () => {
    const bindingsCount = new Map<string, number>([["nod_active", 2]]);
    expect(
      isNodeBindingProtected(
        { id: asOutlineNodeId("nod_source"), sourceBindingId: asThreadBindingId("bnd_1") },
        bindingsCount,
      ),
    ).toBe(true);
    expect(
      isNodeBindingProtected({ id: asOutlineNodeId("nod_active"), sourceBindingId: null }, bindingsCount),
    ).toBe(true);
    expect(
      isNodeBindingProtected({ id: asOutlineNodeId("nod_plain"), sourceBindingId: null }, bindingsCount),
    ).toBe(false);
  });

  it("compiles indent, outdent, reorder moves, updates, and top-most subtree deletes with orderKeys", () => {
    const prevNodes: OutlineNode[] = [
      makeNode({ id: "n1", orderKey: "a0", contentMarkdown: "First" }),
      makeNode({ id: "n2", orderKey: "a1", contentMarkdown: "Second" }),
      makeNode({ id: "n3", orderKey: "a2", contentMarkdown: "ToDelete" }),
      makeNode({ id: "n3_1", parentNodeId: "n3", orderKey: "a0", contentMarkdown: "DeletedChild" }),
    ];

    const itemType = outlineSchema.nodes["outlineItem"];
    const paraType = outlineSchema.nodes["outlineParagraph"];
    const docType = outlineSchema.nodes["outlineDoc"];

    // Reorder n2 before n1, and indent n1 under n2; delete n3 (and its child n3_1 implicitly)
    const nextDoc = docType.create(null, [
      itemType.create(
        { nodeId: "n2", checked: null, collapsed: false, authorType: "human" },
        [
          paraType.create(null, [outlineSchema.text("Second updated")]),
          itemType.create(
            { nodeId: "n1", checked: null, collapsed: false, authorType: "human" },
            [paraType.create(null, [outlineSchema.text("First")])],
          ),
        ],
      ),
    ]);

    const ops = prosemirrorToOutlineBatchOps(prevNodes, nextDoc);

    // Move happens before delete, and only n3 (top-most) is emitted for delete
    const moveOps = ops.filter((o): o is Extract<typeof o, { op: "move" }> => o.op === "move");
    const updateOps = ops.filter((o): o is Extract<typeof o, { op: "update" }> => o.op === "update");
    const deleteOps = ops.filter((o): o is Extract<typeof o, { op: "delete" }> => o.op === "delete");

    expect(moveOps).toHaveLength(1);
    expect(moveOps[0]).toMatchObject({
      op: "move",
      nodeId: "n1",
      parentNodeId: "n2",
    });
    expect(moveOps[0]?.orderKey).toBeTruthy();

    expect(updateOps).toEqual([
      {
        op: "update",
        nodeId: asOutlineNodeId("n2"),
        contentMarkdown: "Second updated",
      },
    ]);

    expect(deleteOps).toEqual([{ op: "delete", nodeId: asOutlineNodeId("n3") }]);

    // Ensure move precedes delete in batch order
    const firstMoveIdx = ops.findIndex((o) => o.op === "move");
    const firstDeleteIdx = ops.findIndex((o) => o.op === "delete");
    expect(firstMoveIdx).toBeGreaterThanOrEqual(0);
    expect(firstDeleteIdx).toBeGreaterThan(firstMoveIdx);
  });

  it("scopes diffs to focusRootId when zoomed into a subtree without deleting outer nodes", () => {
    const prevNodes: OutlineNode[] = [
      makeNode({ id: "root_a", orderKey: "a0", contentMarkdown: "Root A" }),
      makeNode({ id: "child_1", parentNodeId: "root_a", orderKey: "a0", contentMarkdown: "Child 1" }),
      makeNode({ id: "root_b", orderKey: "a1", contentMarkdown: "Root B (outside zoom)" }),
    ];

    const zoomedDoc = outlineToProseMirrorDoc(prevNodes, asOutlineNodeId("root_a"));
    expect(zoomedDoc.childCount).toBe(1);
    expect(zoomedDoc.child(0).attrs["nodeId"]).toBe("child_1");

    const itemType = outlineSchema.nodes["outlineItem"];
    const paraType = outlineSchema.nodes["outlineParagraph"];
    const docType = outlineSchema.nodes["outlineDoc"];

    const nextZoomedDoc = docType.create(null, [
      zoomedDoc.child(0),
      itemType.create(
        { nodeId: "temp_zoom_new", checked: false, collapsed: false, authorType: "human" },
        [paraType.create(null, [outlineSchema.text("Child 2")])],
      ),
    ]);

    const ops = prosemirrorToOutlineBatchOps(prevNodes, nextZoomedDoc, asOutlineNodeId("root_a"));
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({
      op: "create",
      tempId: "temp_zoom_new",
      parentNodeId: "root_a",
      contentMarkdown: "Child 2",
      checked: false,
    });
  });
});
