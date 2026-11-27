import { createOrderKeyBetween, type OutlineNode, type OutlineNodeId } from "@inkade/core";

export interface FlattenedOutlineNode {
  readonly node: OutlineNode;
  readonly depth: number;
  readonly hasChildren: boolean;
  readonly childCount: number;
  readonly parentId: OutlineNodeId | null;
  readonly siblingIndex: number;
  readonly siblingCount: number;
  readonly ancestorIds: readonly OutlineNodeId[];
}

export interface OutlineBreadcrumbItem {
  readonly id: OutlineNodeId | "__root__";
  readonly label: string;
}

export type OutlineKeyboardAction =
  | { readonly type: "noop" }
  | {
      readonly type: "create_below";
      readonly parentNodeId: OutlineNodeId | null;
      readonly afterNodeId: OutlineNodeId | null;
      readonly beforeNodeId: OutlineNodeId | null;
    }
  | {
      readonly type: "indent";
      readonly nodeId: OutlineNodeId;
      readonly newParentNodeId: OutlineNodeId;
      readonly afterNodeId: OutlineNodeId | null;
    }
  | {
      readonly type: "outdent";
      readonly nodeId: OutlineNodeId;
      readonly newParentNodeId: OutlineNodeId | null;
      readonly afterNodeId: OutlineNodeId;
    }
  | {
      readonly type: "move_up";
      readonly nodeId: OutlineNodeId;
      readonly parentNodeId: OutlineNodeId | null;
      readonly afterNodeId: OutlineNodeId | null;
      readonly beforeNodeId: OutlineNodeId;
    }
  | {
      readonly type: "move_down";
      readonly nodeId: OutlineNodeId;
      readonly parentNodeId: OutlineNodeId | null;
      readonly afterNodeId: OutlineNodeId;
      readonly beforeNodeId: OutlineNodeId | null;
    }
  | {
      readonly type: "cycle_todo";
      readonly nodeId: OutlineNodeId;
      readonly nextChecked: boolean | null;
    }
  | {
      readonly type: "toggle_collapse";
      readonly nodeId: OutlineNodeId;
      readonly nextCollapsed: boolean;
    }
  | { readonly type: "collapse_all" }
  | { readonly type: "expand_all" }
  | {
      readonly type: "delete_or_outdent_empty";
      readonly nodeId: OutlineNodeId;
      readonly hasBindings: boolean;
      readonly focusTargetId: OutlineNodeId | null;
    }
  | { readonly type: "focus_prev"; readonly targetNodeId: OutlineNodeId }
  | { readonly type: "focus_next"; readonly targetNodeId: OutlineNodeId };

export interface KeyboardEventLike {
  readonly key: string;
  readonly metaKey?: boolean | undefined;
  readonly ctrlKey?: boolean | undefined;
  readonly altKey?: boolean | undefined;
  readonly shiftKey?: boolean | undefined;
  readonly isComposing?: boolean | undefined;
  readonly keyCode?: number | undefined;
  readonly nativeEvent?: {
    readonly isComposing?: boolean | undefined;
    readonly keyCode?: number | undefined;
  } | undefined;
}

/**
 * Checks IME composition on both React synthetic events and underlying DOM events.
 * Prevents Enter / Backspace / Tab from firing outline mutations during CJK input.
 */
export function isImeComposing(event: KeyboardEventLike): boolean {
  return Boolean(
    event.isComposing ||
      event.keyCode === 229 ||
      event.nativeEvent?.isComposing ||
      event.nativeEvent?.keyCode === 229,
  );
}

/**
 * Compares fractional-indexing orderKeys using strict ASCII code-unit order.
 */
export function compareOrderKeys(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Builds a parent -> sorted active children map.
 */
export function buildOutlineChildrenMap(
  nodes: readonly OutlineNode[],
): Map<OutlineNodeId | null, OutlineNode[]> {
  const active = nodes.filter((n) => n.deletedAt === null);
  const activeIds = new Set(active.map((n) => n.id));
  const map = new Map<OutlineNodeId | null, OutlineNode[]>();

  for (const node of active) {
    const parentKey =
      node.parentNodeId !== null && activeIds.has(node.parentNodeId)
        ? node.parentNodeId
        : null;
    const list = map.get(parentKey);
    if (list) {
      list.push(node);
    } else {
      map.set(parentKey, [node]);
    }
  }

  for (const siblings of map.values()) {
    siblings.sort((a, b) => {
      const cmp = compareOrderKeys(a.orderKey, b.orderKey);
      return cmp !== 0 ? cmp : compareOrderKeys(a.id, b.id);
    });
  }

  return map;
}

/**
 * Flattens visible outline nodes in depth-first pre-order, respecting collapsed
 * ancestors and optional bullet zoom-in `focusRootId`.
 */
export function flattenVisibleOutline(
  nodes: readonly OutlineNode[],
  focusRootId: OutlineNodeId | null = null,
): FlattenedOutlineNode[] {
  const childrenMap = buildOutlineChildrenMap(nodes);
  const activeById = new Map(
    nodes.filter((n) => n.deletedAt === null).map((n) => [n.id, n]),
  );
  const startParentId =
    focusRootId !== null && activeById.has(focusRootId) ? focusRootId : null;

  const result: FlattenedOutlineNode[] = [];
  const visited = new Set<OutlineNodeId>();

  function walk(
    parentId: OutlineNodeId | null,
    depth: number,
    ancestorIds: readonly OutlineNodeId[],
  ): void {
    const siblings = childrenMap.get(parentId) ?? [];
    for (let i = 0; i < siblings.length; i++) {
      const node = siblings[i];
      if (!node || visited.has(node.id)) continue;
      visited.add(node.id);

      const children = childrenMap.get(node.id) ?? [];
      result.push({
        node,
        depth,
        hasChildren: children.length > 0,
        childCount: children.length,
        parentId,
        siblingIndex: i,
        siblingCount: siblings.length,
        ancestorIds,
      });

      if (!node.collapsed && children.length > 0) {
        walk(node.id, depth + 1, [...ancestorIds, node.id]);
      }
    }
  }

  walk(startParentId, 0, startParentId ? [startParentId] : []);
  return result;
}

/**
 * Collects all active descendant IDs under `rootNodeId` (excluding `rootNodeId` itself).
 */
export function collectSubtreeIds(
  nodes: readonly OutlineNode[],
  rootNodeId: OutlineNodeId,
): OutlineNodeId[] {
  const childrenMap = buildOutlineChildrenMap(nodes);
  const collected: OutlineNodeId[] = [];
  const queue = [...(childrenMap.get(rootNodeId) ?? [])];
  const seen = new Set<OutlineNodeId>([rootNodeId]);

  while (queue.length > 0) {
    const next = queue.shift();
    if (!next || seen.has(next.id)) continue;
    seen.add(next.id);
    collected.push(next.id);
    const children = childrenMap.get(next.id);
    if (children) {
      queue.push(...children);
    }
  }

  return collected;
}

/**
 * Computes hierarchical breadcrumbs from root down to `focusRootId`.
 */
export function getOutlineBreadcrumbs(
  nodes: readonly OutlineNode[],
  focusRootId: OutlineNodeId | null,
  rootLabel = "Root",
): OutlineBreadcrumbItem[] {
  if (!focusRootId) {
    return [{ id: "__root__", label: rootLabel }];
  }

  const byId = new Map(
    nodes.filter((n) => n.deletedAt === null).map((n) => [n.id, n]),
  );
  const chain: OutlineBreadcrumbItem[] = [];
  const visited = new Set<OutlineNodeId>();
  let currentId: OutlineNodeId | null = focusRootId;

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const node = byId.get(currentId);
    if (!node) break;
    const rawLabel = (node.contentText || node.contentMarkdown).trim();
    chain.unshift({
      id: node.id,
      label: rawLabel.length > 48 ? `${rawLabel.slice(0, 47)}…` : rawLabel || "Untitled",
    });
    currentId = node.parentNodeId;
  }

  return [{ id: "__root__", label: rootLabel }, ...chain];
}

/**
 * Cycles todo state: normal (`null`) -> unchecked (`false`) -> checked (`true`) -> normal (`null`).
 */
export function cycleTodoState(checked: boolean | null): boolean | null {
  if (checked === null) return false;
  if (checked === false) return true;
  return null;
}

/**
 * Computes the move target (`parentNodeId`, `afterNodeId`, `beforeNodeId`, `orderKey`)
 * when dragging `draggedId` onto `targetId` at `position`. Returns `null` if invalid or cyclic.
 */
export function computeDropMoveTarget(
  nodes: readonly OutlineNode[],
  draggedId: OutlineNodeId,
  targetId: OutlineNodeId,
  position: "above" | "below" | "child",
): {
  readonly parentNodeId: OutlineNodeId | null;
  readonly afterNodeId: OutlineNodeId | null;
  readonly beforeNodeId: OutlineNodeId | null;
  readonly orderKey: string;
} | null {
  if (draggedId === targetId) return null;

  const activeById = new Map(
    nodes.filter((n) => n.deletedAt === null).map((n) => [n.id, n]),
  );
  const targetNode = activeById.get(targetId);
  if (!targetNode || !activeById.has(draggedId)) return null;

  const subtreeIds = new Set(collectSubtreeIds(nodes, draggedId));
  if (subtreeIds.has(targetId)) {
    return null;
  }

  const childrenMap = buildOutlineChildrenMap(nodes);

  if (position === "child") {
    const targetChildren = (childrenMap.get(targetId) ?? []).filter(
      (n) => n.id !== draggedId,
    );
    const lastChild = targetChildren[targetChildren.length - 1] ?? null;
    const orderKey = createOrderKeyBetween(lastChild?.orderKey ?? null, null);
    return {
      parentNodeId: targetId,
      afterNodeId: lastChild?.id ?? null,
      beforeNodeId: null,
      orderKey,
    };
  }

  const parentNodeId =
    targetNode.parentNodeId !== null && activeById.has(targetNode.parentNodeId)
      ? targetNode.parentNodeId
      : null;
  const siblings = (childrenMap.get(parentNodeId) ?? []).filter(
    (n) => n.id !== draggedId,
  );
  const targetIndex = siblings.findIndex((n) => n.id === targetId);
  if (targetIndex < 0) return null;

  if (position === "above") {
    const prev = targetIndex > 0 ? siblings[targetIndex - 1] ?? null : null;
    const orderKey = createOrderKeyBetween(
      prev?.orderKey ?? null,
      targetNode.orderKey,
    );
    return {
      parentNodeId,
      afterNodeId: prev?.id ?? null,
      beforeNodeId: targetNode.id,
      orderKey,
    };
  }

  const next = targetIndex + 1 < siblings.length ? siblings[targetIndex + 1] ?? null : null;
  const orderKey = createOrderKeyBetween(
    targetNode.orderKey,
    next?.orderKey ?? null,
  );
  return {
    parentNodeId,
    afterNodeId: targetNode.id,
    beforeNodeId: next?.id ?? null,
    orderKey,
  };
}

/**
 * Pure keyboard action resolver for `ProseMirrorOutlineEditor`.
 */
export function resolveOutlineKeyboardAction(params: {
  readonly nodeId: OutlineNodeId;
  readonly flatNodes: readonly FlattenedOutlineNode[];
  readonly allNodes: readonly OutlineNode[];
  readonly bindingsCountByNode: ReadonlyMap<OutlineNodeId, number>;
  readonly isContentEmpty: boolean;
  readonly selectionAtStart?: boolean | undefined;
  readonly focusRootId?: OutlineNodeId | null | undefined;
  readonly event: KeyboardEventLike;
}): OutlineKeyboardAction {
  const {
    nodeId,
    flatNodes,
    allNodes,
    bindingsCountByNode,
    isContentEmpty,
    focusRootId = null,
    event,
  } = params;

  if (isImeComposing(event)) {
    return { type: "noop" };
  }

  const flatIdx = flatNodes.findIndex((item) => item.node.id === nodeId);
  const current = flatIdx >= 0 ? flatNodes[flatIdx] : undefined;
  if (!current) {
    return { type: "noop" };
  }

  const mod = Boolean(event.metaKey || event.ctrlKey);
  const alt = Boolean(event.altKey);
  const shift = Boolean(event.shiftKey);
  const childrenMap = buildOutlineChildrenMap(allNodes);
  const siblings = childrenMap.get(current.parentId) ?? [];
  const sibIdx = siblings.findIndex((n) => n.id === nodeId);

  // Cmd/Ctrl + Enter: cycle normal -> unchecked -> checked -> normal
  if (mod && event.key === "Enter") {
    return {
      type: "cycle_todo",
      nodeId,
      nextChecked: cycleTodoState(current.node.checked),
    };
  }

  // Cmd/Ctrl + .: toggle collapse on current node
  if (mod && event.key === ".") {
    return {
      type: "toggle_collapse",
      nodeId,
      nextCollapsed: !current.node.collapsed,
    };
  }

  // Cmd/Ctrl + ArrowUp / ArrowDown: collapse all / expand all
  if (mod && event.key === "ArrowUp") {
    return { type: "collapse_all" };
  }
  if (mod && event.key === "ArrowDown") {
    return { type: "expand_all" };
  }

  // Alt + ArrowUp / ArrowDown: reorder within same parent
  if (alt && event.key === "ArrowUp") {
    if (sibIdx <= 0) return { type: "noop" };
    const beforeNode = siblings[sibIdx - 1];
    const afterNode = sibIdx >= 2 ? siblings[sibIdx - 2] ?? null : null;
    if (!beforeNode) return { type: "noop" };
    return {
      type: "move_up",
      nodeId,
      parentNodeId: current.parentId,
      afterNodeId: afterNode?.id ?? null,
      beforeNodeId: beforeNode.id,
    };
  }

  if (alt && event.key === "ArrowDown") {
    if (sibIdx < 0 || sibIdx >= siblings.length - 1) return { type: "noop" };
    const afterNode = siblings[sibIdx + 1];
    const beforeNode = sibIdx + 2 < siblings.length ? siblings[sibIdx + 2] ?? null : null;
    if (!afterNode) return { type: "noop" };
    return {
      type: "move_down",
      nodeId,
      parentNodeId: current.parentId,
      afterNodeId: afterNode.id,
      beforeNodeId: beforeNode?.id ?? null,
    };
  }

  // Tab / Shift+Tab: indent / outdent
  if (event.key === "Tab") {
    if (shift) {
      // Cannot outdent above focusRootId or root
      if (current.parentId === null || current.parentId === focusRootId) {
        return { type: "noop" };
      }
      const parentNode = allNodes.find((n) => n.id === current.parentId && n.deletedAt === null);
      if (!parentNode) return { type: "noop" };
      return {
        type: "outdent",
        nodeId,
        newParentNodeId: parentNode.parentNodeId,
        afterNodeId: parentNode.id,
      };
    }

    if (sibIdx <= 0) return { type: "noop" };
    const prevSibling = siblings[sibIdx - 1];
    if (!prevSibling) return { type: "noop" };
    const prevChildren = childrenMap.get(prevSibling.id) ?? [];
    const lastChild = prevChildren[prevChildren.length - 1] ?? null;
    return {
      type: "indent",
      nodeId,
      newParentNodeId: prevSibling.id,
      afterNodeId: lastChild?.id ?? null,
    };
  }

  // Enter (plain): create sibling below, or first child if expanded with children
  if (event.key === "Enter" && !mod && !alt && !shift) {
    if (current.hasChildren && !current.node.collapsed) {
      const ownChildren = childrenMap.get(nodeId) ?? [];
      const firstChild = ownChildren[0] ?? null;
      return {
        type: "create_below",
        parentNodeId: nodeId,
        afterNodeId: null,
        beforeNodeId: firstChild?.id ?? null,
      };
    }
    const nextSibling = sibIdx >= 0 && sibIdx + 1 < siblings.length ? siblings[sibIdx + 1] ?? null : null;
    return {
      type: "create_below",
      parentNodeId: current.parentId,
      afterNodeId: nodeId,
      beforeNodeId: nextSibling?.id ?? null,
    };
  }

  // Backspace on empty node: outdent first if nested, else delete (guarding active bindings)
  if (event.key === "Backspace" && isContentEmpty && !mod && !alt) {
    if (current.parentId !== null && current.parentId !== focusRootId) {
      const parentNode = allNodes.find((n) => n.id === current.parentId && n.deletedAt === null);
      if (parentNode) {
        return {
          type: "outdent",
          nodeId,
          newParentNodeId: parentNode.parentNodeId,
          afterNodeId: parentNode.id,
        };
      }
    }
    const prevFlat = flatIdx > 0 ? flatNodes[flatIdx - 1] ?? null : null;
    const hasBindings = (bindingsCountByNode.get(nodeId) ?? 0) > 0;
    return {
      type: "delete_or_outdent_empty",
      nodeId,
      hasBindings,
      focusTargetId: prevFlat?.node.id ?? null,
    };
  }

  // ArrowUp / ArrowDown (plain): navigate focus between visible rows
  if (!mod && !alt && !shift && event.key === "ArrowUp") {
    const prevFlat = flatIdx > 0 ? flatNodes[flatIdx - 1] ?? null : null;
    return prevFlat ? { type: "focus_prev", targetNodeId: prevFlat.node.id } : { type: "noop" };
  }

  if (!mod && !alt && !shift && event.key === "ArrowDown") {
    const nextFlat = flatIdx + 1 < flatNodes.length ? flatNodes[flatIdx + 1] ?? null : null;
    return nextFlat ? { type: "focus_next", targetNodeId: nextFlat.node.id } : { type: "noop" };
  }

  return { type: "noop" };
}

/**
 * Detects an active `[[wikilink` trigger immediately before `cursorPos`.
 */
export function extractWikilinkTrigger(
  text: string,
  cursorPos: number,
): { readonly query: string; readonly startIndex: number } | null {
  const before = text.slice(0, Math.max(0, cursorPos));
  const lastOpen = before.lastIndexOf("[[");
  if (lastOpen < 0) return null;
  const afterOpen = before.slice(lastOpen + 2);
  if (afterOpen.includes("]]") || afterOpen.includes("\n")) return null;
  return { query: afterOpen, startIndex: lastOpen };
}

/**
 * Detects an active `/slash` command trigger at line start or after whitespace.
 */
export function extractSlashTrigger(
  text: string,
  cursorPos: number,
): { readonly query: string; readonly startIndex: number } | null {
  const before = text.slice(0, Math.max(0, cursorPos));
  const match = /(?:^|\s)\/([^\s/]*)$/.exec(before);
  if (!match) return null;
  const full = match[0];
  const slashOffset = full.indexOf("/");
  const startIndex = match.index + slashOffset;
  return { query: match[1] ?? "", startIndex };
}
