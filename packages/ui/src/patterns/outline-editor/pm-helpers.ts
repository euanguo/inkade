import type { Node as PMNode, ResolvedPos } from "@tiptap/pm/model";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { getOutlineItemAttrs } from "../outline-schema.ts";
import type { OutlineDeferTarget } from "./types.ts";

export interface EnclosingItemInfo {
  readonly item: PMNode;
  readonly itemPos: number;
  readonly itemDepth: number;
  readonly parent: PMNode;
  readonly parentPos: number;
  readonly indexInParent: number;
  readonly textNode: PMNode;
  readonly textPos: number;
  readonly isNote: boolean;
}

export function extractOutlineAtTrigger(
  text: string,
  cursorOffset: number,
): { readonly startIndex: number; readonly query: string } | null {
  const slice = text.slice(0, cursorOffset);
  const match = /(?:^|\s)(@([^\s@]*))$/.exec(slice);
  if (!match || !match[1]) return null;
  const startIndex = match.index + (match[0].length - match[1].length);
  return {
    startIndex,
    query: match[2] ?? "",
  };
}

export function computePreviewDeferDate(baseDate: string, target: OutlineDeferTarget): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(baseDate);
  const dt = match
    ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
    : new Date();
  const safeDt = Number.isNaN(dt.getTime()) ? new Date() : dt;
  const deltaDays = target === "tomorrow" ? 1 : (8 - safeDt.getUTCDay()) % 7 || 7;
  const next = new Date(safeDt.getTime() + deltaDays * 86_400_000);
  return next.toISOString().slice(0, 10);
}

export function findEnclosingOutlineItem($pos: ResolvedPos): EnclosingItemInfo | null {
  for (let d = $pos.depth; d >= 1; d--) {
    const node = $pos.node(d);
    if (node.type.name === "outlineItem") {
      const itemPos = $pos.before(d);
      const parentDepth = d - 1;
      const parent = $pos.node(parentDepth);
      const parentPos = parentDepth === 0 ? 0 : $pos.before(parentDepth);
      const indexInParent = $pos.index(parentDepth);
      const inNote = $pos.parent.type.name === "outlineNote";
      const textNode = $pos.parent;
      const textPos = $pos.before($pos.depth);
      return {
        item: node,
        itemPos,
        itemDepth: d,
        parent,
        parentPos,
        indexInParent,
        textNode,
        textPos,
        isNote: inNote,
      };
    }
  }
  return null;
}

export function getParaBoundsInItem(item: PMNode, itemPos: number): { from: number; to: number } {
  const para = item.child(0);
  return {
    from: itemPos + 2,
    to: itemPos + 1 + para.nodeSize - 1,
  };
}

export function findNoteInItem(
  item: PMNode,
  itemPos: number,
): { node: PMNode; pos: number; childIndex: number } | null {
  let offset = itemPos + 1;
  for (let i = 0; i < item.childCount; i++) {
    const child = item.child(i);
    if (child.type.name === "outlineNote") {
      return { node: child, pos: offset, childIndex: i };
    }
    offset += child.nodeSize;
  }
  return null;
}

export function getChildOutlineItems(item: PMNode): PMNode[] {
  const children: PMNode[] = [];
  for (let i = 0; i < item.childCount; i++) {
    const child = item.child(i);
    if (child.type.name === "outlineItem") {
      children.push(child);
    }
  }
  return children;
}

export function findPreviousOutlineItemPos(doc: PMNode, targetItemPos: number): number | null {
  let prevVisiblePos: number | null = null;
  let stop = false;

  function walk(container: PMNode, basePos: number): void {
    let offset = basePos;
    for (let i = 0; i < container.childCount; i++) {
      if (stop) return;
      const child = container.child(i);
      if (child.type.name === "outlineItem") {
        if (offset === targetItemPos) {
          stop = true;
          return;
        }
        prevVisiblePos = offset;
        if (!child.attrs["collapsed"]) {
          walk(child, offset + 1);
        }
      }
      offset += child.nodeSize;
    }
  }

  walk(doc, 0);
  return prevVisiblePos;
}

export function findItemPosByNodeId(doc: PMNode, targetNodeId: string): number | null {
  let found: number | null = null;
  doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (node.type.name === "outlineItem" && node.attrs["nodeId"] === targetNodeId) {
      found = pos;
      return false;
    }
    return true;
  });
  return found;
}

export function applyTempIdMapToState(
  state: EditorState,
  tempIdMap: Readonly<Record<string, string>>,
): Transaction | null {
  const entries = Object.entries(tempIdMap);
  if (entries.length === 0) return null;
  const map = new Map(entries);
  const tr = state.tr;
  let changed = false;

  state.doc.descendants((node, pos) => {
    if (node.type.name === "outlineItem") {
      const currentId = getOutlineItemAttrs(node.attrs).nodeId;
      if (currentId && map.has(currentId)) {
        tr.setNodeMarkup(pos, undefined, {
          ...node.attrs,
          nodeId: map.get(currentId),
        });
        changed = true;
      }
    }
    return true;
  });

  if (!changed) return null;
  tr.setMeta("addToHistory", false);
  tr.setMeta("inkadeReconcile", true);
  return tr;
}
