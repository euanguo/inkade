import {
  asDocumentId,
  asOutlineNodeId,
  asThreadBindingId,
  type DocumentId,
  type OutlineNodeId,
  type ThreadBindingId,
} from "@inkade/core";
import { Schema } from "@tiptap/pm/model";

export interface OutlineItemAttrs {
  readonly nodeId: string | null;
  readonly checked: boolean | null;
  readonly collapsed: boolean;
  readonly authorType: "human" | "agent";
  readonly sourceBindingId: ThreadBindingId | null;
  readonly mirrorOfNodeId: OutlineNodeId | null;
  readonly rolledOverToDocId: DocumentId | null;
}

/**
 * ProseMirror schema for Inkade's recursive outliner:
 * `outlineDoc -> outlineItem+`
 * `outlineItem -> outlineParagraph outlineNote? outlineItem*`
 */
export const outlineSchema = new Schema({
  topNode: "outlineDoc",
  nodes: {
    outlineDoc: {
      content: "outlineItem+",
    },
    outlineItem: {
      content: "outlineParagraph outlineNote? outlineItem*",
      defining: true,
      attrs: {
        nodeId: { default: null },
        checked: { default: null },
        collapsed: { default: false },
        authorType: { default: "human" },
        sourceBindingId: { default: null },
        mirrorOfNodeId: { default: null },
        rolledOverToDocId: { default: null },
      },
      parseDOM: [
        {
          tag: "div[data-outline-item]",
          getAttrs(dom) {
            if (!(dom instanceof HTMLElement)) return false;
            const checkedRaw = dom.getAttribute("data-checked");
            const checked =
              checkedRaw === "true" ? true : checkedRaw === "false" ? false : null;
            return {
              nodeId: dom.getAttribute("data-node-id") || null,
              checked,
              collapsed: dom.getAttribute("data-collapsed") === "true",
              authorType: dom.getAttribute("data-author-type") === "agent" ? "agent" : "human",
              sourceBindingId: dom.getAttribute("data-source-binding-id") || null,
              mirrorOfNodeId: dom.getAttribute("data-mirror-of-node-id") || null,
              rolledOverToDocId: dom.getAttribute("data-rolled-over-to-doc-id") || null,
            };
          },
        },
      ],
      toDOM(node) {
        const attrs = node.attrs as OutlineItemAttrs;
        return [
          "div",
          {
            "data-outline-item": "true",
            ...(attrs.nodeId ? { "data-node-id": attrs.nodeId } : {}),
            ...(attrs.checked !== null ? { "data-checked": String(attrs.checked) } : {}),
            "data-collapsed": String(Boolean(attrs.collapsed)),
            "data-author-type": attrs.authorType,
            ...(attrs.sourceBindingId ? { "data-source-binding-id": attrs.sourceBindingId } : {}),
            ...(attrs.mirrorOfNodeId ? { "data-mirror-of-node-id": attrs.mirrorOfNodeId } : {}),
            ...(attrs.rolledOverToDocId
              ? { "data-rolled-over-to-doc-id": attrs.rolledOverToDocId }
              : {}),
          },
          0,
        ];
      },
    },
    outlineParagraph: {
      content: "text*",
      defining: true,
      marks: "",
      parseDOM: [{ tag: "p[data-outline-paragraph]" }],
      toDOM() {
        return ["p", { "data-outline-paragraph": "true" }, 0];
      },
    },
    outlineNote: {
      content: "text*",
      defining: true,
      marks: "",
      parseDOM: [{ tag: "div[data-outline-note]" }],
      toDOM() {
        return ["div", { "data-outline-note": "true" }, 0];
      },
    },
    text: {
      group: "inline",
    },
  },
});

export function getOutlineItemAttrs(attrs: Record<string, unknown>): OutlineItemAttrs {
  const checked =
    attrs["checked"] === true ? true : attrs["checked"] === false ? false : null;
  return {
    nodeId: typeof attrs["nodeId"] === "string" && attrs["nodeId"] ? attrs["nodeId"] : null,
    checked,
    collapsed: Boolean(attrs["collapsed"]),
    authorType: attrs["authorType"] === "agent" ? "agent" : "human",
    sourceBindingId:
      typeof attrs["sourceBindingId"] === "string" && attrs["sourceBindingId"]
        ? asThreadBindingId(attrs["sourceBindingId"])
        : null,
    mirrorOfNodeId:
      typeof attrs["mirrorOfNodeId"] === "string" && attrs["mirrorOfNodeId"]
        ? asOutlineNodeId(attrs["mirrorOfNodeId"])
        : null,
    rolledOverToDocId:
      typeof attrs["rolledOverToDocId"] === "string" && attrs["rolledOverToDocId"]
        ? asDocumentId(attrs["rolledOverToDocId"])
        : null,
  };
}
