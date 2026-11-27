import {
  createOrderKeysBetween,
  type DocumentId,
  type OutlineBatchOperation,
  type OutlineNode,
  type OutlineNodeId,
  type ThreadBindingId,
} from "@inkade/core";
import type { Node as PMNode, Schema } from "@tiptap/pm/model";
import { buildOutlineChildrenMap, collectSubtreeIds, compareOrderKeys } from "./outline-helpers.ts";
import { getOutlineItemAttrs, outlineSchema } from "./outline-schema.ts";

function buildPMTextChildren(schema: Schema, text: string): PMNode[] {
  return text.length > 0 ? [schema.text(text)] : [];
}

/**
 * Converts Inkade `OutlineNode[]` into a ProseMirror `outlineDoc` node,
 * preserving stable `nodeId` attributes and hierarchical tree structure.
 */
export function outlineToProseMirrorDoc(
  nodes: readonly OutlineNode[],
  focusRootId: OutlineNodeId | null = null,
  schema: Schema = outlineSchema,
): PMNode {
  const activeById = new Map(
    nodes.filter((n) => n.deletedAt === null).map((n) => [n.id, n]),
  );
  const startParentId =
    focusRootId !== null && activeById.has(focusRootId) ? focusRootId : null;
  const childrenMap = buildOutlineChildrenMap(nodes);
  const visited = new Set<OutlineNodeId>();

  const itemType = schema.nodes["outlineItem"];
  const paraType = schema.nodes["outlineParagraph"];
  const noteType = schema.nodes["outlineNote"];
  const docType = schema.nodes["outlineDoc"];
  if (!itemType || !paraType || !noteType || !docType) {
    throw new Error("Invalid outline schema: missing required node types");
  }

  function buildItem(node: OutlineNode): PMNode | null {
    if (visited.has(node.id)) return null;
    visited.add(node.id);

    const children: PMNode[] = [
      paraType!.create(null, buildPMTextChildren(schema, node.contentMarkdown)),
    ];

    if (node.noteMarkdown && node.noteMarkdown.length > 0) {
      children.push(noteType!.create(null, buildPMTextChildren(schema, node.noteMarkdown)));
    }

    for (const child of childrenMap.get(node.id) ?? []) {
      const childPm = buildItem(child);
      if (childPm) children.push(childPm);
    }

    return itemType!.create(
      {
        nodeId: node.id,
        checked: node.checked,
        collapsed: node.collapsed,
        authorType: node.authorType,
        sourceBindingId: node.sourceBindingId,
        mirrorOfNodeId: node.mirrorOfNodeId ?? null,
        rolledOverToDocId: node.rolledOverToDocId ?? null,
      },
      children,
    );
  }

  const rootItems: PMNode[] = [];
  for (const rootNode of childrenMap.get(startParentId) ?? []) {
    const built = buildItem(rootNode);
    if (built) rootItems.push(built);
  }

  if (rootItems.length === 0) {
    rootItems.push(
      itemType.create(
        {
          nodeId: null,
          checked: null,
          collapsed: false,
          authorType: "human",
          sourceBindingId: null,
          mirrorOfNodeId: null,
          rolledOverToDocId: null,
        },
        [paraType.create()],
      ),
    );
  }

  return docType.create(null, rootItems);
}

interface ExtractedPMItem {
  readonly refId: string;
  readonly persistedId: OutlineNodeId | null;
  readonly parentRefId: OutlineNodeId | string | null;
  readonly contentMarkdown: string;
  readonly noteMarkdown: string;
  readonly checked: boolean | null;
  readonly collapsed: boolean;
  readonly authorType: "human" | "agent";
  readonly sourceBindingId: ThreadBindingId | null;
  readonly mirrorOfNodeId: OutlineNodeId | null;
  readonly rolledOverToDocId: DocumentId | null;
}

function longestIncreasingSubsequenceIds(
  orderedIds: readonly OutlineNodeId[],
  rankById: ReadonlyMap<OutlineNodeId, number>,
): Set<OutlineNodeId> {
  if (orderedIds.length === 0) return new Set();
  const tails: number[] = [];
  const tailIndices: number[] = [];
  const prevIndex = new Array<number>(orderedIds.length).fill(-1);

  for (let i = 0; i < orderedIds.length; i++) {
    const id = orderedIds[i]!;
    const rank = rankById.get(id);
    if (rank === undefined) continue;

    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((tails[mid] ?? 0) < rank) lo = mid + 1;
      else hi = mid;
    }
    tails[lo] = rank;
    tailIndices[lo] = i;
    prevIndex[i] = lo > 0 ? (tailIndices[lo - 1] ?? -1) : -1;
  }

  const keep = new Set<OutlineNodeId>();
  let cur = tailIndices[tails.length - 1] ?? -1;
  while (cur >= 0) {
    const id = orderedIds[cur];
    if (id) keep.add(id);
    cur = prevIndex[cur] ?? -1;
  }
  return keep;
}

/**
 * Compiles structural and content differences between `prevNodes` and a ProseMirror
 * `nextDoc` into minimal, ordered `OutlineBatchOperation[]` (`create` / `move` / `update` / `delete`).
 * Never drops existing `nodeId`s on mid-line splits or unaffected nodes.
 */
export function prosemirrorToOutlineBatchOps(
  prevNodes: readonly OutlineNode[],
  nextDoc: PMNode,
  focusRootId: OutlineNodeId | null = null,
): OutlineBatchOperation[] {
  const allActive = prevNodes.filter((n) => n.deletedAt === null);
  const allActiveById = new Map(allActive.map((n) => [n.id, n]));
  const scopedRootId =
    focusRootId !== null && allActiveById.has(focusRootId) ? focusRootId : null;

  let prevScoped: OutlineNode[];
  if (scopedRootId) {
    const subtreeSet = new Set(collectSubtreeIds(allActive, scopedRootId));
    prevScoped = allActive.filter((n) => subtreeSet.has(n.id));
  } else {
    prevScoped = allActive;
  }
  const prevById = new Map<OutlineNodeId, OutlineNode>(prevScoped.map((n) => [n.id, n]));
  const prevByRawId = new Map<string, OutlineNode>(prevScoped.map((n) => [n.id, n]));

  // Walk nextDoc in pre-order DFS to extract items with unique refs
  const extracted: ExtractedPMItem[] = [];
  const usedPersistedIds = new Set<OutlineNodeId>();
  const usedTempIds = new Set<string>();
  let tempCounter = 0;

  function allocateTempId(preferred: string | null): string {
    if (preferred && !prevByRawId.has(preferred) && !usedTempIds.has(preferred)) {
      usedTempIds.add(preferred);
      return preferred;
    }
    let candidate = `temp_node_${++tempCounter}`;
    while (usedTempIds.has(candidate) || prevByRawId.has(candidate)) {
      candidate = `temp_node_${++tempCounter}`;
    }
    usedTempIds.add(candidate);
    return candidate;
  }

  function walkPMItem(pmItem: PMNode, parentRefId: string | null): void {
    const attrs = getOutlineItemAttrs(pmItem.attrs);
    let contentMarkdown = "";
    let noteMarkdown = "";
    const childItems: PMNode[] = [];

    for (let i = 0; i < pmItem.childCount; i++) {
      const child = pmItem.child(i);
      if (child.type.name === "outlineParagraph") {
        contentMarkdown = child.textContent;
      } else if (child.type.name === "outlineNote") {
        noteMarkdown = child.textContent;
      } else if (child.type.name === "outlineItem") {
        childItems.push(child);
      }
    }

    const persistedNode = attrs.nodeId ? prevByRawId.get(attrs.nodeId) : undefined;
    const persistedId =
      persistedNode && !usedPersistedIds.has(persistedNode.id) ? persistedNode.id : null;
    if (persistedId) {
      usedPersistedIds.add(persistedId);
    }
    const refId = persistedId ?? allocateTempId(attrs.nodeId);

    extracted.push({
      refId,
      persistedId,
      parentRefId,
      contentMarkdown,
      noteMarkdown,
      checked: attrs.checked,
      collapsed: attrs.collapsed,
      authorType: attrs.authorType,
      sourceBindingId: attrs.sourceBindingId,
      mirrorOfNodeId: attrs.mirrorOfNodeId,
      rolledOverToDocId: attrs.rolledOverToDocId,
    });

    for (const childItem of childItems) {
      walkPMItem(childItem, refId);
    }
  }

  for (let i = 0; i < nextDoc.childCount; i++) {
    const topChild = nextDoc.child(i);
    if (topChild.type.name === "outlineItem") {
      walkPMItem(topChild, scopedRootId);
    }
  }

  // Empty placeholder check: when prev had 0 nodes and PM only has a single untouched blank row
  if (
    prevScoped.length === 0 &&
    extracted.length === 1 &&
    extracted[0] &&
    extracted[0].persistedId === null &&
    extracted[0].contentMarkdown === "" &&
    extracted[0].noteMarkdown === "" &&
    extracted[0].checked === null
  ) {
    return [];
  }

  // Group extracted items by parentRefId in exact target visual order
  const nextChildrenByParent = new Map<string | null, ExtractedPMItem[]>();
  for (const item of extracted) {
    const list = nextChildrenByParent.get(item.parentRefId);
    if (list) list.push(item);
    else nextChildrenByParent.set(item.parentRefId, [item]);
  }

  // Build previous sorted sibling lists to compute minimal orderKey moves via LIS
  const prevChildrenMap = buildOutlineChildrenMap(allActive);
  const computedOrderKeyByRef = new Map<string, string>();
  const needsMoveRefs = new Set<string>();

  for (const [parentRefId, targetSiblings] of nextChildrenByParent.entries()) {
    const resolvedPrevParentId: OutlineNodeId | null =
      parentRefId === null
        ? null
        : parentRefId === scopedRootId
          ? scopedRootId
          : (prevByRawId.get(parentRefId)?.id ?? null);
    const prevSiblings =
      parentRefId === null || resolvedPrevParentId !== null
        ? (prevChildrenMap.get(resolvedPrevParentId) ?? [])
        : [];
    const prevRank = new Map<OutlineNodeId, number>();
    prevSiblings.forEach((s, idx) => prevRank.set(s.id, idx));

    const stayingIds = targetSiblings
      .filter((item) => item.persistedId !== null && prevRank.has(item.persistedId))
      .map((item) => item.persistedId!);
    const anchorSet = longestIncreasingSubsequenceIds(stayingIds, prevRank);

    // Collect anchor positions in targetSiblings
    const anchorIndices: number[] = [];
    targetSiblings.forEach((item, idx) => {
      if (item.persistedId && anchorSet.has(item.persistedId)) {
        anchorIndices.push(idx);
        const orig = prevById.get(item.persistedId);
        if (orig) {
          computedOrderKeyByRef.set(item.refId, orig.orderKey);
        }
      }
    });

    // Assign fractional keys for every gap between anchors
    let cursor = 0;
    for (let aIdx = 0; aIdx <= anchorIndices.length; aIdx++) {
      const nextAnchorTargetIdx =
        aIdx < anchorIndices.length ? anchorIndices[aIdx]! : targetSiblings.length;
      const gapCount = nextAnchorTargetIdx - cursor;
      if (gapCount > 0) {
        const prevAnchorIdx = aIdx > 0 ? anchorIndices[aIdx - 1]! : -1;
        const prevKey =
          prevAnchorIdx >= 0
            ? (computedOrderKeyByRef.get(targetSiblings[prevAnchorIdx]!.refId) ?? null)
            : null;
        const nextKey =
          nextAnchorTargetIdx < targetSiblings.length
            ? (computedOrderKeyByRef.get(targetSiblings[nextAnchorTargetIdx]!.refId) ?? null)
            : null;

        // Guard against duplicate orderKeys on legacy anchors
        const safeKeys =
          prevKey !== null && nextKey !== null && compareOrderKeys(prevKey, nextKey) >= 0
            ? createOrderKeysBetween(prevKey, null, gapCount)
            : createOrderKeysBetween(prevKey, nextKey, gapCount);

        for (let g = 0; g < gapCount; g++) {
          const item = targetSiblings[cursor + g]!;
          computedOrderKeyByRef.set(item.refId, safeKeys[g]!);
          if (item.persistedId !== null) {
            needsMoveRefs.add(item.refId);
          }
        }
      }
      cursor = nextAnchorTargetIdx + 1;
    }

    // Also mark any persisted node whose parentNodeId changed
    for (const item of targetSiblings) {
      if (item.persistedId) {
        const orig = prevById.get(item.persistedId);
        if (orig && orig.parentNodeId !== item.parentRefId) {
          needsMoveRefs.add(item.refId);
        }
      }
    }
  }

  const createOps: OutlineBatchOperation[] = [];
  const moveOps: OutlineBatchOperation[] = [];
  const updateOps: OutlineBatchOperation[] = [];
  const deleteOps: OutlineBatchOperation[] = [];

  // 1 & 2 & 3. Walk extracted in pre-order (parents always precede children)
  for (const item of extracted) {
    const orderKey = computedOrderKeyByRef.get(item.refId);

    if (item.persistedId === null) {
      createOps.push({
        op: "create",
        tempId: item.refId,
        parentNodeId: item.parentRefId,
        ...(orderKey ? { orderKey } : {}),
        contentMarkdown: item.contentMarkdown,
        ...(item.noteMarkdown ? { noteMarkdown: item.noteMarkdown } : {}),
        checked: item.checked,
        collapsed: item.collapsed,
        authorType: item.authorType,
        ...(item.sourceBindingId ? { sourceBindingId: item.sourceBindingId } : {}),
        ...(item.mirrorOfNodeId ? { mirrorOfNodeId: item.mirrorOfNodeId } : {}),
      });
      continue;
    }

    const orig = prevById.get(item.persistedId);
    if (!orig) continue;

    if (needsMoveRefs.has(item.refId)) {
      moveOps.push({
        op: "move",
        nodeId: item.persistedId,
        parentNodeId: item.parentRefId,
        ...(orderKey ? { orderKey } : {}),
      });
    }

    const origNote = orig.noteMarkdown ?? "";
    const origMirror = orig.mirrorOfNodeId ?? null;
    const contentChanged = item.contentMarkdown !== orig.contentMarkdown;
    const noteChanged = item.noteMarkdown !== origNote;
    const checkedChanged = item.checked !== orig.checked;
    const collapsedChanged = item.collapsed !== orig.collapsed;
    const mirrorChanged = item.mirrorOfNodeId !== origMirror;

    if (contentChanged || noteChanged || checkedChanged || collapsedChanged || mirrorChanged) {
      updateOps.push({
        op: "update",
        nodeId: item.persistedId,
        ...(contentChanged ? { contentMarkdown: item.contentMarkdown } : {}),
        ...(noteChanged ? { noteMarkdown: item.noteMarkdown } : {}),
        ...(checkedChanged ? { checked: item.checked } : {}),
        ...(collapsedChanged ? { collapsed: item.collapsed } : {}),
        ...(mirrorChanged ? { mirrorOfNodeId: item.mirrorOfNodeId } : {}),
      });
    }
  }

  // 4. Delete ops: only top-most deleted nodes (children are deleted with parent's subtree)
  const deletedSet = new Set<OutlineNodeId>();
  for (const prevNode of prevScoped) {
    if (!usedPersistedIds.has(prevNode.id)) {
      deletedSet.add(prevNode.id);
    }
  }
  for (const prevNode of prevScoped) {
    if (!deletedSet.has(prevNode.id)) continue;
    let hasDeletedAncestor = false;
    let cursor = prevNode.parentNodeId;
    const seen = new Set<OutlineNodeId>([prevNode.id]);
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      if (deletedSet.has(cursor)) {
        hasDeletedAncestor = true;
        break;
      }
      cursor = prevById.get(cursor)?.parentNodeId ?? null;
    }
    if (!hasDeletedAncestor) {
      deleteOps.push({
        op: "delete",
        nodeId: prevNode.id,
      });
    }
  }

  return [...createOps, ...moveOps, ...updateOps, ...deleteOps];
}

export interface ParsedMarkdownOutlineEntry {
  readonly contentMarkdown: string;
  readonly checked: boolean | null;
  readonly children: readonly ParsedMarkdownOutlineEntry[];
}

function measureIndentWidth(leadingWhitespace: string): number {
  let width = 0;
  for (const ch of leadingWhitespace) {
    if (ch === "\t") width += 2;
    else width += 1;
  }
  return width;
}

function stripListAndTodoPrefix(rawLine: string): {
  readonly contentMarkdown: string;
  readonly checked: boolean | null;
} {
  let text = rawLine.trim();
  // Strip bullet or ordered list prefix: "- ", "* ", "+ ", "1. ", "1) "
  const listMatch = /^(?:[-*+]|\d+[.)])\s+(.*)$/.exec(text);
  if (listMatch) {
    text = (listMatch[1] ?? "").trim();
  }

  // Strip todo prefix: "[ ] ", "[x] ", "[X] "
  const todoMatch = /^\[([ xX])\]\s*(.*)$/.exec(text);
  if (todoMatch) {
    const marker = todoMatch[1];
    return {
      checked: marker === "x" || marker === "X",
      contentMarkdown: (todoMatch[2] ?? "").trim(),
    };
  }

  return {
    checked: null,
    contentMarkdown: text,
  };
}

/**
 * Parses pasted multi-line indented Markdown (`- item`, `- [ ] todo`, nested tabs/2-space/4-space indent)
 * into a hierarchical tree of outline entries.
 */
export function parseIndentedMarkdownToOutlineEntries(
  markdown: string,
): ParsedMarkdownOutlineEntry[] {
  const rawLines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const roots: Array<{
    contentMarkdown: string;
    checked: boolean | null;
    children: ParsedMarkdownOutlineEntry[];
  }> = [];

  interface StackFrame {
    readonly indent: number;
    readonly children: Array<{
      contentMarkdown: string;
      checked: boolean | null;
      children: ParsedMarkdownOutlineEntry[];
    }>;
  }

  const stack: StackFrame[] = [{ indent: -1, children: roots }];

  for (const rawLine of rawLines) {
    if (!rawLine.trim()) continue;
    const indentMatch = /^([ \t]*)/.exec(rawLine);
    const indent = measureIndentWidth(indentMatch?.[1] ?? "");
    const { contentMarkdown, checked } = stripListAndTodoPrefix(rawLine);
    if (!contentMarkdown && checked === null) continue;

    while (stack.length > 1 && indent <= stack[stack.length - 1]!.indent) {
      stack.pop();
    }

    const entry = {
      contentMarkdown,
      checked,
      children: [] as Array<{
        contentMarkdown: string;
        checked: boolean | null;
        children: ParsedMarkdownOutlineEntry[];
      }>,
    };

    stack[stack.length - 1]!.children.push(entry);
    stack.push({ indent, children: entry.children });
  }

  return roots;
}

/**
 * Converts parsed multi-line Markdown entries into ProseMirror `outlineItem` nodes
 * with `nodeId: null` ready to be inserted into an `outlineDoc`.
 */
export function parsedEntriesToProseMirrorItems(
  entries: readonly ParsedMarkdownOutlineEntry[],
  schema: Schema = outlineSchema,
): PMNode[] {
  const itemType = schema.nodes["outlineItem"];
  const paraType = schema.nodes["outlineParagraph"];
  if (!itemType || !paraType) {
    throw new Error("Invalid outline schema: missing outlineItem or outlineParagraph");
  }

  function toPMItem(entry: ParsedMarkdownOutlineEntry): PMNode {
    const children: PMNode[] = [
      paraType!.create(null, buildPMTextChildren(schema, entry.contentMarkdown)),
      ...entry.children.map(toPMItem),
    ];
    return itemType!.create(
      {
        nodeId: null,
        checked: entry.checked,
        collapsed: false,
        authorType: "human",
        sourceBindingId: null,
        mirrorOfNodeId: null,
        rolledOverToDocId: null,
      },
      children,
    );
  }

  return entries.map(toPMItem);
}

/**
 * Helper to detect whether pasted plain text should be parsed as multi-line structured outline items.
 */
export function isMultiLineOutlinePaste(text: string): boolean {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim().length > 0);
  return lines.length > 1;
}

/**
 * Checks whether deleting or merging an outline item at cursor offset 0 would destroy
 * an item with `sourceBindingId` or active `AdeThreadBinding`s.
 */
export function isNodeBindingProtected(
  node: Pick<OutlineNode, "id" | "sourceBindingId"> | { readonly nodeId: string | null; readonly sourceBindingId: string | null },
  bindingsCountByNode: ReadonlyMap<string, number>,
): boolean {
  const id = "id" in node ? node.id : node.nodeId;
  if (node.sourceBindingId) return true;
  if (id && (bindingsCountByNode.get(id) ?? 0) > 0) return true;
  return false;
}

/**
 * Counts all descendant `outlineItem` nodes under a ProseMirror `outlineItem` node.
 */
export function countOutlineHiddenDescendants(node: PMNode): number {
  let count = 0;
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child.type.name === "outlineItem") {
      count += 1 + countOutlineHiddenDescendants(child);
    }
  }
  return count;
}

let clientTempSeq = 0;

/**
 * Generates a unique client-side temporary node ID for ProseMirror items before persistence.
 */
export function createClientTempNodeId(): string {
  clientTempSeq += 1;
  return `temp_pm_${Date.now().toString(36)}_${clientTempSeq}`;
}

/**
 * Detects an active `((blockRef` trigger immediately before `cursorPos`.
 */
export function extractBlockRefTrigger(
  text: string,
  cursorPos: number,
): { readonly query: string; readonly startIndex: number } | null {
  const before = text.slice(0, Math.max(0, cursorPos));
  const lastOpen = before.lastIndexOf("((");
  if (lastOpen < 0) return null;
  const afterOpen = before.slice(lastOpen + 2);
  if (afterOpen.includes("))") || afterOpen.includes("\n")) return null;
  return { query: afterOpen, startIndex: lastOpen };
}

/**
 * Detects an active `#tag` trigger at line start or after whitespace.
 */
export function extractTagTrigger(
  text: string,
  cursorPos: number,
): { readonly query: string; readonly startIndex: number } | null {
  const before = text.slice(0, Math.max(0, cursorPos));
  const match = /(?:^|[\s(])#([a-zA-Z0-9_/\-\u4e00-\u9fa5]*)$/.exec(before);
  if (!match) return null;
  const full = match[0];
  const hashOffset = full.indexOf("#");
  return {
    query: match[1] ?? "",
    startIndex: match.index + hashOffset,
  };
}

