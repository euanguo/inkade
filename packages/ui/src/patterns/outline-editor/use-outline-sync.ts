import {
  asOutlineNodeId,
  type AdeThreadBinding,
  type BatchOutlineNodesResult,
  type OutlineNode,
  type OutlineNodeId,
} from "@inkade/core";
import { TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { useCallback, useEffect, useState } from "react";
import { useDebounceCallback } from "usehooks-ts";
import type * as Y from "yjs";
import {
  createClientTempNodeId,
  isNodeBindingProtected,
  outlineToProseMirrorDoc,
  prosemirrorToOutlineBatchOps,
} from "../outline-diff-ops.ts";
import { cycleTodoState } from "../outline-helpers.ts";
import { getOutlineItemAttrs, outlineSchema } from "../outline-schema.ts";
import {
  applyTempIdMapToState,
  findItemPosByNodeId,
  findNoteInItem,
  findPreviousOutlineItemPos,
  getParaBoundsInItem,
} from "./pm-helpers.ts";
import type {
  OutlineDeferTarget,
  OutlineLatestState,
  PendingDeleteGuard,
} from "./types.ts";

export interface UseOutlineSyncOptions {
  readonly viewRef: React.RefObject<EditorView | null>;
  readonly editorHostRef: React.RefObject<HTMLDivElement | null>;
  readonly metaSlotsMapRef: React.RefObject<Map<string, HTMLElement>>;
  readonly lastSyncedNodesRef: React.RefObject<readonly OutlineNode[]>;
  readonly pendingFlushRef: React.RefObject<boolean>;
  readonly inFlightBatchRef: React.RefObject<boolean>;
  readonly inFlightPromiseRef: React.RefObject<Promise<BatchOutlineNodesResult | null> | null>;
  readonly isApplyingExternalRef: React.RefObject<boolean>;
  readonly latestRef: React.RefObject<OutlineLatestState>;
  readonly nodes: readonly OutlineNode[];
  readonly bindings: readonly AdeThreadBinding[];
  readonly focusRootId: OutlineNodeId | null;
  readonly highlightedNodeId?: OutlineNodeId | null | undefined;
  readonly collaborativeDoc?: Y.Doc | undefined;
  readonly syncFragmentName: string;
}

export function useOutlineSync({
  viewRef,
  editorHostRef,
  metaSlotsMapRef,
  lastSyncedNodesRef,
  pendingFlushRef,
  inFlightBatchRef,
  inFlightPromiseRef,
  isApplyingExternalRef,
  latestRef,
  nodes,
  bindings,
  focusRootId,
  highlightedNodeId,
  collaborativeDoc,
  syncFragmentName,
}: UseOutlineSyncOptions) {
  const [deleteGuard, setDeleteGuard] = useState<PendingDeleteGuard | null>(null);
  const [metaSlotEntries, setMetaSlotEntries] = useState<
    Array<{ readonly nodeId: string; readonly el: HTMLElement }>
  >([]);

  const syncMetaSlotsState = useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    const activeEntries: Array<{ readonly nodeId: string; readonly el: HTMLElement }> = [];
    const seen = new Set<string>();
    view.state.doc.descendants((node) => {
      if (node.type.name === "outlineItem") {
        const id = getOutlineItemAttrs(node.attrs).nodeId;
        if (id && !seen.has(id)) {
          const el = metaSlotsMapRef.current.get(id);
          if (el && el.isConnected) {
            seen.add(id);
            activeEntries.push({ nodeId: id, el });
          }
        }
      }
      return true;
    });
    setMetaSlotEntries(activeEntries);
  }, [metaSlotsMapRef, viewRef]);

  const flushChanges = useCallback(async (): Promise<BatchOutlineNodesResult | null> => {
    const view = viewRef.current;
    if (!view || latestRef.current.readOnly) return null;
    if (inFlightBatchRef.current && inFlightPromiseRef.current) {
      pendingFlushRef.current = true;
      const settled = await inFlightPromiseRef.current;
      if (pendingFlushRef.current && viewRef.current === view) {
        return flushChanges();
      }
      return settled;
    }

    const ops = prosemirrorToOutlineBatchOps(
      lastSyncedNodesRef.current,
      view.state.doc,
      latestRef.current.focusRootId,
    );
    if (ops.length === 0) {
      pendingFlushRef.current = false;
      return null;
    }

    pendingFlushRef.current = false;

    if (latestRef.current.onBatchMutate) {
      inFlightBatchRef.current = true;
      const runBatch = async (): Promise<BatchOutlineNodesResult | null> => {
        try {
          const result = await latestRef.current.onBatchMutate!(ops);
          if (result && viewRef.current === view) {
            lastSyncedNodesRef.current = result.nodes;
            const reconcileTr = applyTempIdMapToState(view.state, result.tempIdMap);
            if (reconcileTr) {
              isApplyingExternalRef.current = true;
              view.dispatch(reconcileTr);
              isApplyingExternalRef.current = false;
              syncMetaSlotsState();
            }
          }
          return result ?? null;
        } finally {
          inFlightBatchRef.current = false;
          inFlightPromiseRef.current = null;
          if (pendingFlushRef.current && viewRef.current === view) {
            void flushChanges();
          }
        }
      };
      const promise = runBatch();
      inFlightPromiseRef.current = promise;
      return promise;
    }

    for (const op of ops) {
      if (op.op === "create") {
        latestRef.current.onCreateNode?.({
          documentId: latestRef.current.documentId,
          parentNodeId: op.parentNodeId ? asOutlineNodeId(op.parentNodeId) : null,
          orderKey: op.orderKey,
          contentMarkdown: op.contentMarkdown,
          noteMarkdown: op.noteMarkdown,
          checked: op.checked ?? null,
          collapsed: op.collapsed ?? false,
          authorType: op.authorType ?? "human",
          sourceBindingId: op.sourceBindingId,
          mirrorOfNodeId:
            op.mirrorOfNodeId == null ? op.mirrorOfNodeId : asOutlineNodeId(op.mirrorOfNodeId),
        });
      } else if (op.op === "update") {
        latestRef.current.onUpdateNode?.(op.nodeId, {
          contentMarkdown: op.contentMarkdown,
          noteMarkdown: op.noteMarkdown,
          checked: op.checked,
          collapsed: op.collapsed,
          mirrorOfNodeId:
            op.mirrorOfNodeId == null ? op.mirrorOfNodeId : asOutlineNodeId(op.mirrorOfNodeId),
        });
      } else if (op.op === "move") {
        latestRef.current.onMoveNode?.(op.nodeId, {
          parentNodeId:
            op.parentNodeId === null ? null : asOutlineNodeId(op.parentNodeId),
          orderKey: op.orderKey,
        });
      } else if (op.op === "delete") {
        latestRef.current.onDeleteNode?.(op.nodeId);
      }
    }
    return null;
  }, [
    inFlightBatchRef,
    inFlightPromiseRef,
    isApplyingExternalRef,
    lastSyncedNodesRef,
    latestRef,
    pendingFlushRef,
    syncMetaSlotsState,
    viewRef,
  ]);

  const triggerFlushChanges = useCallback(() => {
    void flushChanges();
  }, [flushChanges]);

  const debouncedSync = useDebounceCallback(triggerFlushChanges, 280);

  const scheduleFlush = useCallback(
    (immediate = false) => {
      debouncedSync.cancel();
      pendingFlushRef.current = true;
      if (immediate) {
        void flushChanges();
        return;
      }
      debouncedSync();
    },
    [debouncedSync, flushChanges, pendingFlushRef],
  );

  const ensurePersistedNode = useCallback(
    async (itemPos: number, knownNodeId?: string | null): Promise<OutlineNode | null> => {
      const view = viewRef.current;
      if (!view) return null;
      const item = view.state.doc.nodeAt(itemPos);
      if (!item || item.type.name !== "outlineItem") return null;

      const rawAttrs = getOutlineItemAttrs(item.attrs);
      let resolvedId = knownNodeId ?? rawAttrs.nodeId;

      debouncedSync.cancel();

      let nodeObj = resolvedId
        ? latestRef.current.activeById.get(asOutlineNodeId(resolvedId))
        : undefined;
      if (pendingFlushRef.current || !nodeObj) {
        pendingFlushRef.current = true;
        const batchRes = await flushChanges();
        if (batchRes) {
          if (resolvedId && batchRes.tempIdMap[resolvedId]) {
            resolvedId = batchRes.tempIdMap[resolvedId] ?? resolvedId;
          }
          const expectedText = item.child(0).textContent;
          nodeObj =
            (resolvedId ? batchRes.nodes.find((n) => n.id === resolvedId) : undefined) ??
            batchRes.created.find((n) => n.contentMarkdown === expectedText);
        } else if (resolvedId) {
          nodeObj = latestRef.current.activeById.get(asOutlineNodeId(resolvedId));
        }
      }
      return nodeObj ?? null;
    },
    [debouncedSync, flushChanges, latestRef, pendingFlushRef, viewRef],
  );

  const executeDeferNode = useCallback(
    async (itemPos: number, target: OutlineDeferTarget, knownNodeId?: string | null) => {
      const view = viewRef.current;
      const deferFn = latestRef.current.onDeferNode;
      if (!view || latestRef.current.readOnly || !deferFn) return;
      const nodeObj = await ensurePersistedNode(itemPos, knownNodeId);
      if (!nodeObj) return;
      const result = await deferFn(nodeObj, target);
      if (result?.targetDocId && viewRef.current === view) {
        const targetPos = findItemPosByNodeId(view.state.doc, nodeObj.id);
        if (targetPos !== null) {
          const targetNode = view.state.doc.nodeAt(targetPos);
          if (targetNode) {
            const tr = view.state.tr.setNodeMarkup(targetPos, undefined, {
              ...targetNode.attrs,
              rolledOverToDocId: result.targetDocId,
            });
            tr.setMeta("addToHistory", false);
            tr.setMeta("inkadeExternalSync", true);
            view.dispatch(tr);
            syncMetaSlotsState();
          }
        }
      }
    },
    [ensurePersistedNode, latestRef, syncMetaSlotsState, viewRef],
  );

  const executeToggleTodo = useCallback(
    (itemPos: number) => {
      const view = viewRef.current;
      if (!view || latestRef.current.readOnly) return;
      const item = view.state.doc.nodeAt(itemPos);
      if (!item || item.type.name !== "outlineItem") return;
      const attrs = getOutlineItemAttrs(item.attrs);
      const tr = view.state.tr.setNodeMarkup(itemPos, undefined, {
        ...item.attrs,
        checked: cycleTodoState(attrs.checked),
      });
      view.dispatch(tr);
    },
    [latestRef, viewRef],
  );

  const executeToggleCollapse = useCallback(
    (itemPos: number) => {
      const view = viewRef.current;
      if (!view) return;
      const item = view.state.doc.nodeAt(itemPos);
      if (!item || item.type.name !== "outlineItem") return;
      const attrs = getOutlineItemAttrs(item.attrs);
      const tr = view.state.tr.setNodeMarkup(itemPos, undefined, {
        ...item.attrs,
        collapsed: !attrs.collapsed,
      });
      view.dispatch(tr);
    },
    [viewRef],
  );

  const executeAddOrFocusNote = useCallback(
    (itemPos: number) => {
      const view = viewRef.current;
      if (!view || latestRef.current.readOnly) return;
      const item = view.state.doc.nodeAt(itemPos);
      if (!item || item.type.name !== "outlineItem") return;

      const existing = findNoteInItem(item, itemPos);
      if (existing) {
        const tr = view.state.tr.setSelection(
          TextSelection.create(view.state.doc, existing.pos + 1 + existing.node.content.size),
        );
        view.dispatch(tr);
        view.focus();
        return;
      }

      const insertPos = itemPos + 1 + item.child(0).nodeSize;
      const noteNode = outlineSchema.nodes["outlineNote"].create();
      let tr = view.state.tr.insert(insertPos, noteNode);
      tr = tr.setSelection(TextSelection.create(tr.doc, insertPos + 1));
      view.dispatch(tr);
      view.focus();
    },
    [latestRef, viewRef],
  );

  const executeProtectedDelete = useCallback(
    (itemPos: number, nodeId: string | null, sourceBindingId: string | null, force = false) => {
      const view = viewRef.current;
      if (!view || latestRef.current.readOnly) return;

      if (
        !force &&
        isNodeBindingProtected(
          { nodeId, sourceBindingId },
          latestRef.current.bindingsCountByNode,
        )
      ) {
        if (nodeId) {
          setDeleteGuard({
            nodeId,
            bindingCount:
              (latestRef.current.bindingsCountByNode.get(asOutlineNodeId(nodeId)) ?? 0) || 1,
          });
        }
        return;
      }

      const item = view.state.doc.nodeAt(itemPos);
      if (!item) return;

      if (view.state.doc.childCount === 1 && itemPos === 0) {
        const para = item.child(0);
        const tr = view.state.tr
          .delete(1, item.nodeSize - 1)
          .insert(1, outlineSchema.nodes["outlineParagraph"].create())
          .setNodeMarkup(0, undefined, {
            nodeId: createClientTempNodeId(),
            checked: null,
            collapsed: false,
            authorType: "human",
            sourceBindingId: null,
            mirrorOfNodeId: null,
            rolledOverToDocId: null,
          });
        if (para.nodeSize > 0) {
          view.dispatch(tr);
        }
        return;
      }

      const prevPos = findPreviousOutlineItemPos(view.state.doc, itemPos);
      let tr = view.state.tr.delete(itemPos, itemPos + item.nodeSize);
      if (prevPos !== null) {
        const mappedPrev = tr.mapping.map(prevPos);
        const prevNode = tr.doc.nodeAt(mappedPrev);
        if (prevNode) {
          const bounds = getParaBoundsInItem(prevNode, mappedPrev);
          tr = tr.setSelection(TextSelection.create(tr.doc, bounds.to));
        }
      }
      view.dispatch(tr);
      view.focus();
    },
    [latestRef, viewRef],
  );

  // Re-sync ProseMirror doc when external `nodes` or `focusRootId` changes
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (collaborativeDoc && collaborativeDoc.getXmlFragment(syncFragmentName).length > 0) return;
    if (view.composing || pendingFlushRef.current || inFlightBatchRef.current) return;

    const currentOps = prosemirrorToOutlineBatchOps(nodes, view.state.doc, focusRootId);
    if (currentOps.length === 0) {
      lastSyncedNodesRef.current = nodes;
      const tr = view.state.tr.setMeta("inkadeRefreshDecos", true);
      tr.setMeta("addToHistory", false);
      isApplyingExternalRef.current = true;
      view.dispatch(tr);
      isApplyingExternalRef.current = false;
      requestAnimationFrame(() => syncMetaSlotsState());
      return;
    }

    const nextDoc = outlineToProseMirrorDoc(nodes, focusRootId, outlineSchema);
    isApplyingExternalRef.current = true;
    const tr = view.state.tr.replaceWith(0, view.state.doc.content.size, nextDoc.content);
    tr.setMeta("addToHistory", false);
    tr.setMeta("inkadeExternalSync", true);
    view.dispatch(tr);
    isApplyingExternalRef.current = false;
    lastSyncedNodesRef.current = nodes;
    requestAnimationFrame(() => syncMetaSlotsState());
  }, [
    collaborativeDoc,
    focusRootId,
    inFlightBatchRef,
    isApplyingExternalRef,
    lastSyncedNodesRef,
    nodes,
    pendingFlushRef,
    syncFragmentName,
    syncMetaSlotsState,
    viewRef,
  ]);

  // Re-run decorations when bindings or highlightedNodeId change
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const tr = view.state.tr.setMeta("inkadeRefreshDecos", true);
    tr.setMeta("addToHistory", false);
    isApplyingExternalRef.current = true;
    view.dispatch(tr);
    isApplyingExternalRef.current = false;
    requestAnimationFrame(() => syncMetaSlotsState());
  }, [bindings, highlightedNodeId, isApplyingExternalRef, syncMetaSlotsState, viewRef]);

  // Scroll highlighted node into view when jumped to from Tasks / Search
  useEffect(() => {
    if (!highlightedNodeId || !editorHostRef.current) return;
    const el = editorHostRef.current.querySelector(
      `[data-outline-item][data-node-id="${CSS.escape(highlightedNodeId)}"]`,
    );
    if (el instanceof HTMLElement) {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [editorHostRef, highlightedNodeId, nodes]);

  const handleConfirmProtectedDelete = useCallback((): void => {
    if (!deleteGuard || !viewRef.current) return;
    const pos = findItemPosByNodeId(viewRef.current.state.doc, deleteGuard.nodeId);
    if (pos !== null) {
      executeProtectedDelete(pos, deleteGuard.nodeId, null, true);
    }
    setDeleteGuard(null);
  }, [deleteGuard, executeProtectedDelete, viewRef]);

  return {
    deleteGuard,
    setDeleteGuard,
    metaSlotEntries,
    syncMetaSlotsState,
    debouncedSync,
    scheduleFlush,
    ensurePersistedNode,
    executeDeferNode,
    executeToggleTodo,
    executeToggleCollapse,
    executeAddOrFocusNote,
    executeProtectedDelete,
    handleConfirmProtectedDelete,
  };
}
