"use client";

import {
  asOutlineNodeId,
  buildOutlineBlockDeepLink,
  type AdeThreadBinding,
  type BatchOutlineNodesResult,
  type DocumentId,
  type OutlineNode,
  type OutlineNodeId,
} from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import { baseKeymap } from "@tiptap/pm/commands";
import { history, redo, undo } from "@tiptap/pm/history";
import { keymap } from "@tiptap/pm/keymap";
import { EditorState, Plugin, TextSelection } from "@tiptap/pm/state";
import { EditorView } from "@tiptap/pm/view";
import {
  ChevronRightIcon,
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  IndentDecreaseIcon,
  IndentIncreaseIcon,
  PlusIcon,
  Redo2Icon,
  Undo2Icon,
} from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEventListener, useMediaQuery } from "usehooks-ts";
import { INKADE_MEDIA_QUERIES } from "../lib/breakpoints.ts";
import { cn } from "../lib/utils.ts";
import { Button } from "../primitives/button.tsx";
import {
  createClientTempNodeId,
  isNodeBindingProtected,
  outlineToProseMirrorDoc,
} from "./outline-diff-ops.ts";
import {
  createOutlineKeymapPlugin,
  handleOutlineClick,
  handleOutlinePaste,
  indentOutlineSelection,
  outdentOutlineSelection,
} from "./outline-editor/outline-commands.tsx";
import { OutlineHoverPreviewCard } from "./outline-editor/OutlineHoverPreviewCard.tsx";
import { OutlineItemNodeView } from "./outline-editor/OutlineItemNodeView.ts";
import { OutlineMetaPortals } from "./outline-editor/OutlineMetaPortals.tsx";
import { OutlineMirrorDialog } from "./outline-editor/OutlineMirrorDialog.tsx";
import { OutlineNodeActionMenu } from "./outline-editor/OutlineNodeActionMenu.tsx";
import {
  OutlineRolloverAndDeleteDialogs,
  OutlineRolloverBanner,
} from "./outline-editor/OutlineRolloverBannerAndDialogs.tsx";
import { OutlineTriggerPopover } from "./outline-editor/OutlineTriggerPopover.tsx";
import {
  buildLivePreviewDecorations,
  outlineDecoPluginKey,
} from "./outline-editor/outline-live-preview.ts";
import { computePreviewDeferDate, findItemPosByNodeId } from "./outline-editor/pm-helpers.ts";
import type {
  HoverPreviewState,
  NodeActionMenuState,
  NodeViewActionBridge,
  OutlineKindLabels,
  OutlineLatestState,
  ProseMirrorOutlineEditorProps,
} from "./outline-editor/types.ts";
import { useAnchoredFloatingPosition } from "./outline-editor/use-anchored-floating.ts";
import { useOutlineSync } from "./outline-editor/use-outline-sync.ts";
import { useOutlineTriggers } from "./outline-editor/use-outline-triggers.ts";
import { collectSubtreeIds, getOutlineBreadcrumbs } from "./outline-helpers.ts";
import { outlineSchema } from "./outline-schema.ts";
import {
  createInkadeYjsProseMirrorPlugins,
  prosemirrorToYXmlFragment,
  yjsRedoCommand,
  yjsUndoCommand,
  ySyncPluginKey,
} from "./yjs-collaboration.ts";

export function ProseMirrorOutlineEditor({
  documentId,
  rootTitle,
  hideRootBreadcrumbTitle = false,
  deferBaseDate,
  nodes,
  bindings = [],
  workspaceDocs = [],
  workspaceTags = [],
  rolloverTodos = [],
  rolloverDocDatesById,
  highlightedNodeId,
  initialFocusRootId = null,
  onFocusRootChange,
  onRolloverAll,
  onRolloverSelected,
  onDismissRollover,
  onDeferNode,
  onBatchMutate,
  onCreateNode,
  onUpdateNode,
  onMoveNode,
  onDeleteNode,
  onBatchCollapseChange,
  onDispatchToAde,
  onPromoteToArticle,
  onOpenDocument,
  onOpenDate,
  onClickTag,
  onOpenBinding,
  onMarkBindingRead,
  onUnbindBinding,
  onCreateMirror,
  onSearchWorkspaceNodes,
  onCopyBlockLink,
  onOpenMirroredSource,
  onOpenPdfCitation,
  onOpenBlockDeepLink,
  readOnly = false,
  collaborativeDoc,
  syncFragmentName = "outline",
  className,
}: ProseMirrorOutlineEditorProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const isMdUp = useMediaQuery(INKADE_MEDIA_QUERIES.md);
  const resolvedEmptyLineHint = isMdUp
    ? t("outline.emptyLineHint")
    : t("outline.emptyLineHintCompact");
  const resolvedRootTitle = rootTitle ?? t("outline.defaultTitle");

  const [focusRootId, setFocusRootIdState] = useState<OutlineNodeId | null>(initialFocusRootId);
  const [rolloverDialogOpen, setRolloverDialogOpen] = useState(false);
  const [rolloverSelection, setRolloverSelection] = useState<Set<OutlineNodeId>>(() => new Set());
  const [hoverPreview, setHoverPreview] = useState<HoverPreviewState | null>(null);
  const [nodeMenu, setNodeMenu] = useState<NodeActionMenuState | null>(null);
  const [mirrorDialogState, setMirrorDialogState] = useState<
    | { readonly mode: "push"; readonly sourceNode: OutlineNode }
    | { readonly mode: "pull"; readonly insertAfterNodeId?: OutlineNodeId | undefined }
    | null
  >(null);
  const [isComposingIme, setIsComposingIme] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const editorHostRef = useRef<HTMLDivElement>(null);
  const nodeMenuFloatingRef = useRef<HTMLDivElement>(null);
  const triggerFloatingRef = useRef<HTMLDivElement>(null);
  const hoverPreviewFloatingRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  const metaSlotsMapRef = useRef<Map<string, HTMLElement>>(new Map());
  const lastSyncedNodesRef = useRef<readonly OutlineNode[]>(nodes);
  const pendingFlushRef = useRef<boolean>(false);
  const inFlightBatchRef = useRef<boolean>(false);
  const inFlightPromiseRef = useRef<Promise<BatchOutlineNodesResult | null> | null>(null);
  const isApplyingExternalRef = useRef<boolean>(false);

  useEffect(() => {
    setFocusRootIdState(initialFocusRootId);
  }, [initialFocusRootId]);

  const setFocusRootId = useCallback(
    (nextId: OutlineNodeId | null) => {
      setFocusRootIdState(nextId);
      onFocusRootChange?.(nextId);
    },
    [onFocusRootChange],
  );

  const activeNodes = useMemo(() => nodes.filter((n) => n.deletedAt === null), [nodes]);
  const activeById = useMemo(
    () => new Map<OutlineNodeId, OutlineNode>(activeNodes.map((n) => [n.id, n])),
    [activeNodes],
  );

  const bindingsByNode = useMemo(() => {
    const map = new Map<OutlineNodeId, AdeThreadBinding[]>();
    for (const b of bindings) {
      if (!b.nodeId) continue;
      const list = map.get(b.nodeId);
      if (list) list.push(b);
      else map.set(b.nodeId, [b]);
    }
    return map;
  }, [bindings]);

  const bindingsCountByNode = useMemo(() => {
    const map = new Map<OutlineNodeId, number>();
    for (const [nodeId, list] of bindingsByNode.entries()) {
      map.set(nodeId, list.length);
    }
    return map;
  }, [bindingsByNode]);

  const docsByKey = useMemo(() => {
    const map = new Map<string, (typeof workspaceDocs)[number]>();
    for (const doc of workspaceDocs) {
      map.set(doc.title.toLowerCase(), doc);
      map.set(doc.slug.toLowerCase(), doc);
      map.set(doc.id.toLowerCase(), doc);
    }
    return map;
  }, [workspaceDocs]);

  const allKnownTags = useMemo(() => {
    const set = new Set<string>(workspaceTags);
    for (const n of activeNodes) {
      const matches = n.contentMarkdown.matchAll(
        /(?:^|[\s(])#([a-zA-Z0-9_\u4e00-\u9fa5][a-zA-Z0-9_/\-\u4e00-\u9fa5]*)/g,
      );
      for (const m of matches) {
        if (m[1]) set.add(m[1]);
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [activeNodes, workspaceTags]);

  const breadcrumbs = useMemo(
    () => getOutlineBreadcrumbs(activeNodes, focusRootId, resolvedRootTitle),
    [activeNodes, focusRootId, resolvedRootTitle],
  );

  const handleOpenMirrorPull = useCallback(
    (context: { readonly itemPos: number; readonly nodeId: string | null }) => {
      if (context.nodeId && !context.nodeId.startsWith("temp_")) {
        setMirrorDialogState({
          mode: "pull",
          insertAfterNodeId: asOutlineNodeId(context.nodeId),
        });
      } else {
        setMirrorDialogState({ mode: "pull" });
      }
    },
    [],
  );

  const latestRef = useRef<OutlineLatestState>({
    documentId,
    nodes,
    activeNodes,
    activeById,
    bindingsByNode,
    bindingsCountByNode,
    focusRootId,
    readOnly,
    highlightedNodeId,
    onBatchMutate,
    onCreateNode,
    onUpdateNode,
    onMoveNode,
    onDeleteNode,
    onDeferNode,
    onDispatchToAde,
    onPromoteToArticle,
    onOpenDocument,
    onClickTag,
    onOpenPdfCitation,
    onOpenBlockDeepLink,
    onOpenMirrorPull: handleOpenMirrorPull,
    setFocusRootId,
    emptyLineHint: resolvedEmptyLineHint,
  });

  latestRef.current = {
    documentId,
    nodes,
    activeNodes,
    activeById,
    bindingsByNode,
    bindingsCountByNode,
    focusRootId,
    readOnly,
    highlightedNodeId,
    onBatchMutate,
    onCreateNode,
    onUpdateNode,
    onMoveNode,
    onDeleteNode,
    onDeferNode,
    onDispatchToAde,
    onPromoteToArticle,
    onOpenDocument,
    onClickTag,
    onOpenPdfCitation,
    onOpenBlockDeepLink,
    onOpenMirrorPull: handleOpenMirrorPull,
    setFocusRootId,
    emptyLineHint: resolvedEmptyLineHint,
  };

  const {
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
  } = useOutlineSync({
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
  });

  const {
    activeTrigger,
    activeTriggerRef,
    setActiveTrigger,
    triggerIndex,
    setTriggerIndex,
    updateTriggerFromView,
    filteredTriggerItems,
    applyTriggerOption,
    triggerSelectionRef,
  } = useOutlineTriggers({
    viewRef,
    latestRef,
    documentId,
    activeNodes,
    workspaceDocs,
    allKnownTags,
    t,
  });

  const nodeMenuCoords = useAnchoredFloatingPosition(nodeMenu?.rect ?? null, nodeMenuFloatingRef);
  const triggerCoords = useAnchoredFloatingPosition(activeTrigger?.coords ?? null, triggerFloatingRef);
  const hoverPreviewCoords = useAnchoredFloatingPosition(
    hoverPreview?.rect ?? null,
    hoverPreviewFloatingRef,
  );

  // Initialize ProseMirror EditorView
  useEffect(() => {
    const host = editorHostRef.current;
    if (!host) return;

    const initialDoc = outlineToProseMirrorDoc(
      latestRef.current.nodes,
      latestRef.current.focusRootId,
      outlineSchema,
    );
    lastSyncedNodesRef.current = latestRef.current.nodes;

    const decoPlugin = new Plugin({
      key: outlineDecoPluginKey,
      props: {
        decorations: (state) =>
          buildLivePreviewDecorations(
            state.doc,
            state.selection.from,
            state.selection.to,
            metaSlotsMapRef.current,
            (attrs) => {
              const attrNodeId = attrs.nodeId ? asOutlineNodeId(attrs.nodeId) : null;
              return Boolean(
                attrs.authorType === "agent" ||
                  attrs.mirrorOfNodeId ||
                  attrs.rolledOverToDocId ||
                  (attrNodeId &&
                    (Boolean(latestRef.current.activeById.get(attrNodeId)?.rolledOverToDocId) ||
                      (latestRef.current.bindingsByNode.get(attrNodeId)?.length ?? 0) > 0)),
              );
            },
            latestRef.current.highlightedNodeId,
            latestRef.current.readOnly ? null : latestRef.current.emptyLineHint,
          ),
      },
    });

    const nodeViewBridge: NodeViewActionBridge = {
      readOnly: () => latestRef.current.readOnly,
      canDefer: () => !latestRef.current.readOnly && Boolean(latestRef.current.onDeferNode),
      isBindingProtected: (nodeId, sourceBindingId) =>
        isNodeBindingProtected(
          { nodeId, sourceBindingId },
          latestRef.current.bindingsCountByNode,
        ),
      onZoomIn: (nodeId) => {
        if (nodeId.trim()) {
          latestRef.current.setFocusRootId(asOutlineNodeId(nodeId));
        }
      },
      onToggleTodo: (itemPos) => executeToggleTodo(itemPos),
      onToggleCollapse: (itemPos) => executeToggleCollapse(itemPos),
      onAddNote: (itemPos) => executeAddOrFocusNote(itemPos),
      onOpenNodeMenu: (itemPos, nodeId, sourceBindingId, rect) => {
        setNodeMenu({
          itemPos,
          nodeId,
          sourceBindingId,
          rect: { left: rect.left, top: rect.top, bottom: rect.bottom },
        });
      },
      onDropMove: (draggedId, targetId, position) => {
        const view = viewRef.current;
        if (!view || latestRef.current.readOnly) return;
        const draggedPos = findItemPosByNodeId(view.state.doc, draggedId);
        const targetPos = findItemPosByNodeId(view.state.doc, targetId);
        if (draggedPos === null || targetPos === null || draggedPos === targetPos) return;
        const draggedNode = view.state.doc.nodeAt(draggedPos);
        const targetNode = view.state.doc.nodeAt(targetPos);
        if (!draggedNode || !targetNode) return;
        if (targetPos > draggedPos && targetPos < draggedPos + draggedNode.nodeSize) return;

        let tr = view.state.tr.delete(draggedPos, draggedPos + draggedNode.nodeSize);
        const mappedTargetPos = tr.mapping.map(targetPos);
        const mappedTarget = tr.doc.nodeAt(mappedTargetPos);
        if (!mappedTarget) return;

        let insertPos = mappedTargetPos;
        if (position === "below") {
          insertPos = mappedTargetPos + mappedTarget.nodeSize;
        } else if (position === "child") {
          if (mappedTarget.attrs["collapsed"]) {
            tr = tr.setNodeMarkup(mappedTargetPos, undefined, {
              ...mappedTarget.attrs,
              collapsed: false,
            });
          }
          insertPos = mappedTargetPos + mappedTarget.nodeSize - 1;
        }
        tr = tr.insert(insertPos, draggedNode);
        view.dispatch(tr);
      },
    };

    const yjsFragment = collaborativeDoc
      ? collaborativeDoc.getXmlFragment(syncFragmentName)
      : null;

    if (yjsFragment && yjsFragment.length === 0) {
      prosemirrorToYXmlFragment(initialDoc, yjsFragment);
    }

    const undoHandler = yjsFragment ? yjsUndoCommand : undo;
    const redoHandler = yjsFragment ? yjsRedoCommand : redo;

    const state = EditorState.create({
      ...(yjsFragment ? {} : { doc: initialDoc }),
      schema: outlineSchema,
      plugins: [
        ...(yjsFragment ? createInkadeYjsProseMirrorPlugins(yjsFragment) : [history()]),
        createOutlineKeymapPlugin({
          latestRef,
          undoHandler,
          redoHandler,
          executeToggleTodo,
          executeDeferNode,
          executeToggleCollapse,
          executeAddOrFocusNote,
          executeProtectedDelete,
          setDeleteGuard,
        }),
        keymap(baseKeymap),
        decoPlugin,
      ],
    });

    const view = new EditorView(host, {
      state,
      editable: () => !latestRef.current.readOnly,
      nodeViews: {
        outlineItem: (node, v, getPos) =>
          new OutlineItemNodeView(node, v, getPos, nodeViewBridge),
      },
      dispatchTransaction: (tr) => {
        const nextState = view.state.apply(tr);
        view.updateState(nextState);
        setCanUndo(undoHandler(nextState));
        setCanRedo(redoHandler(nextState));

        const isRemoteYjs = Boolean(tr.getMeta(ySyncPluginKey));
        if (!isApplyingExternalRef.current && !isRemoteYjs && tr.docChanged) {
          scheduleFlush(false);
        }
        if (tr.docChanged || tr.selectionSet) {
          updateTriggerFromView(view);
        }
        if (tr.docChanged) {
          requestAnimationFrame(() => syncMetaSlotsState());
        }
      },
      handleKeyDown: (v, event) => {
        if (v.composing || event.isComposing || event.keyCode === 229) {
          return false;
        }
        if (activeTriggerRef.current) {
          const { items, index, apply } = triggerSelectionRef.current;
          if (event.key === "ArrowDown" && items.length > 0) {
            event.preventDefault();
            setTriggerIndex((prev) => (prev + 1) % items.length);
            return true;
          }
          if (event.key === "ArrowUp" && items.length > 0) {
            event.preventDefault();
            setTriggerIndex((prev) => (prev - 1 + items.length) % items.length);
            return true;
          }
          if ((event.key === "Enter" || event.key === "Tab") && items.length > 0) {
            event.preventDefault();
            apply(Math.min(index, items.length - 1));
            return true;
          }
          if (event.key === "Escape") {
            event.preventDefault();
            setActiveTrigger(null);
            return true;
          }
        }
        return false;
      },
      handlePaste: (v, event) => handleOutlinePaste(v, event, latestRef, scheduleFlush),
      handleClick: (_v, _pos, event) => handleOutlineClick(event, latestRef),
    });

    const metaSlotsMap = metaSlotsMapRef.current;
    viewRef.current = view;
    requestAnimationFrame(() => syncMetaSlotsState());

    return () => {
      debouncedSync.cancel();
      view.destroy();
      viewRef.current = null;
      metaSlotsMap.clear();
    };
  }, [
    activeTriggerRef,
    collaborativeDoc,
    debouncedSync,
    documentId,
    executeAddOrFocusNote,
    executeDeferNode,
    executeProtectedDelete,
    executeToggleCollapse,
    executeToggleTodo,
    scheduleFlush,
    setActiveTrigger,
    setDeleteGuard,
    setTriggerIndex,
    syncFragmentName,
    syncMetaSlotsState,
    triggerSelectionRef,
    updateTriggerFromView,
  ]);

  const handleAddRootNode = (): void => {
    const view = viewRef.current;
    if (!view || readOnly) return;
    const itemType = outlineSchema.nodes["outlineItem"];
    const paraType = outlineSchema.nodes["outlineParagraph"];
    const newItem = itemType.create(
      {
        nodeId: createClientTempNodeId(),
        checked: null,
        collapsed: false,
        authorType: "human",
        sourceBindingId: null,
        mirrorOfNodeId: null,
        rolledOverToDocId: null,
      },
      [paraType.create()],
    );
    const insertPos = view.state.doc.content.size;
    let tr = view.state.tr.insert(insertPos, newItem);
    tr = tr.setSelection(TextSelection.create(tr.doc, insertPos + 2));
    view.dispatch(tr);
    view.focus();
  };

  const handleMouseOverEditor = (e: React.MouseEvent<HTMLDivElement>): void => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    const wikiEl = target.closest("[data-wikilink]");
    if (wikiEl) {
      const targetDoc = wikiEl.getAttribute("data-wikilink");
      if (targetDoc) {
        setHoverPreview({ kind: "wikilink", target: targetDoc, rect: wikiEl.getBoundingClientRect() });
        return;
      }
    }
    const blockRefEl = target.closest("[data-block-ref]");
    if (blockRefEl) {
      const targetRef = blockRefEl.getAttribute("data-block-ref");
      if (targetRef) {
        setHoverPreview({ kind: "blockref", target: targetRef, rect: blockRefEl.getBoundingClientRect() });
        return;
      }
    }
    setHoverPreview(null);
  };

  useEventListener("mousedown", (event: MouseEvent) => {
    if (!nodeMenu) return;
    const target = event.target;
    if (target instanceof Element && target.closest("[data-inkade-node-menu]")) return;
    setNodeMenu(null);
  });

  useEventListener("keydown", (event: KeyboardEvent) => {
    if (nodeMenu && event.key === "Escape") {
      setNodeMenu(null);
    }
  });

  const effectiveDeferBaseDate =
    deferBaseDate && /^\d{4}-\d{2}-\d{2}$/.test(deferBaseDate)
      ? deferBaseDate
      : new Date().toISOString().slice(0, 10);
  const tomorrowPreviewDate = computePreviewDeferDate(effectiveDeferBaseDate, "tomorrow");
  const nextMondayPreviewDate = computePreviewDeferDate(effectiveDeferBaseDate, "next_monday");

  const kindLabels: OutlineKindLabels = {
    outline: t("common.kindOutline"),
    article: t("common.kindArticle"),
    clip: t("common.kindClip"),
  };

  return (
    <div className={cn("mx-auto flex w-full max-w-[780px] flex-col gap-3", className)}>
      <OutlineRolloverBanner
        onDismissRollover={onDismissRollover}
        onOpenSelectDialog={
          onRolloverSelected
            ? () => {
                setRolloverSelection(new Set(rolloverTodos.map((item) => item.id)));
                setRolloverDialogOpen(true);
              }
            : undefined
        }
        onRolloverAll={onRolloverAll}
        rolloverCount={rolloverTodos.length}
      />

      <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2">
        <nav
          aria-label={t("outline.breadcrumbLabel")}
          className="flex flex-wrap items-center gap-1 text-sm"
        >
          {hideRootBreadcrumbTitle && breadcrumbs.length <= 1 ? (
            <span className="px-1 text-xs font-medium text-muted-foreground">
              {t("common.kindOutline")}
            </span>
          ) : (
            breadcrumbs.map((crumb, idx) => {
              const isLast = idx === breadcrumbs.length - 1;
              return (
                <span className="inline-flex items-center gap-1" key={crumb.id}>
                  {idx > 0 && <ChevronRightIcon className="size-3.5 text-muted-foreground" />}
                  <button
                    className={cn(
                      "cursor-pointer rounded px-1.5 py-0.5 text-left transition-colors hover:bg-muted",
                      isLast ? "font-semibold text-foreground" : "text-muted-foreground",
                    )}
                    onClick={() => setFocusRootId(crumb.id === "__root__" ? null : crumb.id)}
                    type="button"
                  >
                    {crumb.label}
                  </button>
                </span>
              );
            })
          )}
        </nav>

        <div className="flex items-center gap-1">
          {!readOnly && (
            <>
              <Button
                aria-label={t("outline.undo")}
                disabled={!canUndo}
                onClick={() => {
                  const v = viewRef.current;
                  if (v) {
                    (collaborativeDoc ? yjsUndoCommand : undo)(v.state, v.dispatch);
                    v.focus();
                  }
                }}
                size="icon-xs"
                title={t("outline.undo")}
                variant="ghost"
              >
                <Undo2Icon />
              </Button>
              <Button
                aria-label={t("outline.redo")}
                disabled={!canRedo}
                onClick={() => {
                  const v = viewRef.current;
                  if (v) {
                    (collaborativeDoc ? yjsRedoCommand : redo)(v.state, v.dispatch);
                    v.focus();
                  }
                }}
                size="icon-xs"
                title={t("outline.redo")}
                variant="ghost"
              >
                <Redo2Icon />
              </Button>
              <span className="inline-flex items-center gap-0.5 md:hidden">
                <Button
                  aria-label={t("outline.outdent")}
                  onClick={() => {
                    const v = viewRef.current;
                    if (v) {
                      outdentOutlineSelection(v.state, v.dispatch);
                      v.focus();
                    }
                  }}
                  size="icon-xs"
                  title={t("outline.outdent")}
                  variant="ghost"
                >
                  <IndentDecreaseIcon />
                </Button>
                <Button
                  aria-label={t("outline.indent")}
                  onClick={() => {
                    const v = viewRef.current;
                    if (v) {
                      indentOutlineSelection(v.state, v.dispatch);
                      v.focus();
                    }
                  }}
                  size="icon-xs"
                  title={t("outline.indent")}
                  variant="ghost"
                >
                  <IndentIncreaseIcon />
                </Button>
              </span>
            </>
          )}
          {onBatchCollapseChange && (
            <>
              <Button
                aria-label={t("outline.expandAll")}
                onClick={() => {
                  const ids = activeNodes.filter((n) => n.collapsed).map((n) => n.id);
                  onBatchCollapseChange(false, ids);
                }}
                size="icon-xs"
                title={t("outline.expandAll")}
                variant="ghost"
              >
                <ChevronsUpDownIcon />
              </Button>
              <Button
                aria-label={t("outline.collapseAll")}
                onClick={() => {
                  const parentIds = new Set(
                    activeNodes
                      .map((n) => n.parentNodeId)
                      .filter((id): id is OutlineNodeId => Boolean(id)),
                  );
                  onBatchCollapseChange(true, [...parentIds]);
                }}
                size="icon-xs"
                title={t("outline.collapseAll")}
                variant="ghost"
              >
                <ChevronsDownUpIcon />
              </Button>
            </>
          )}
          {!readOnly && (
            <Button onClick={handleAddRootNode} size="xs" variant="outline">
              <PlusIcon />
              {t("outline.newNode")}
            </Button>
          )}
        </div>
      </div>

      <div
        className={cn(
          "inkade-pm-outliner relative min-h-[160px] rounded-xl px-0.5 py-1",
          "[&_.ProseMirror]:outline-none [&_.ProseMirror]:flex [&_.ProseMirror]:flex-col [&_.ProseMirror]:gap-0.5",
          "[&_[data-outline-item][data-row-hover='true']>div>[data-outline-handle='true']]:opacity-100",
          "[&_[data-outline-item][data-focused='true']>div>[data-outline-handle='true']]:opacity-65",
          "[&_[data-outline-item][data-focused='true']>div>.inkade-bullet-halo]:shadow-[0_0_0_3px_color-mix(in_srgb,var(--primary)_18%,transparent)]",
          "[&_[data-outline-item][data-collapsed='true']>.inkade-pm-content>[data-outline-item]]:hidden",
          "[&_[data-outline-paragraph]]:min-h-6 [&_[data-outline-paragraph]]:py-0.5 [&_[data-outline-paragraph]]:pr-2 sm:[&_[data-outline-paragraph]]:pr-4 [&_[data-outline-paragraph]]:text-sm [&_[data-outline-paragraph]]:leading-relaxed [&_[data-outline-paragraph]]:text-foreground",
          "[&_[data-outline-paragraph][data-empty-hint]]:relative",
          "[&_[data-outline-paragraph][data-empty-hint]::before]:pointer-events-none [&_[data-outline-paragraph][data-empty-hint]::before]:select-none [&_[data-outline-paragraph][data-empty-hint]::before]:absolute [&_[data-outline-paragraph][data-empty-hint]::before]:inset-y-0 [&_[data-outline-paragraph][data-empty-hint]::before]:left-0 [&_[data-outline-paragraph][data-empty-hint]::before]:right-4 [&_[data-outline-paragraph][data-empty-hint]::before]:block [&_[data-outline-paragraph][data-empty-hint]::before]:leading-6 [&_[data-outline-paragraph][data-empty-hint]::before]:truncate [&_[data-outline-paragraph][data-empty-hint]::before]:text-xs [&_[data-outline-paragraph][data-empty-hint]::before]:text-muted-foreground/68 [&_[data-outline-paragraph][data-empty-hint]::before]:opacity-0 [&_[data-outline-paragraph][data-empty-hint]::before]:transition-opacity [&_[data-outline-paragraph][data-empty-hint]::before]:content-[attr(data-empty-hint)]",
          "[&_.ProseMirror:focus_[data-outline-paragraph][data-empty-hint]::before]:opacity-100",
          "[&_[data-outline-item]:only-child_[data-outline-paragraph][data-empty-hint]::before]:opacity-80",
          "[&[data-ime-composing='true']_[data-outline-paragraph]::before]:hidden",
          "[&_[data-outline-item][data-checked='true']>.inkade-pm-content>[data-outline-paragraph]]:text-muted-foreground/75 [&_[data-outline-item][data-checked='true']>.inkade-pm-content>[data-outline-paragraph]]:line-through [&_[data-outline-item][data-checked='true']>.inkade-pm-content>[data-outline-paragraph]]:decoration-muted-foreground/45",
          "[&_[data-outline-note]]:mb-1 [&_[data-outline-note]]:border-l-2 [&_[data-outline-note]]:border-border/70 [&_[data-outline-note]]:pl-2 [&_[data-outline-note]]:text-xs [&_[data-outline-note]]:leading-relaxed [&_[data-outline-note]]:text-muted-foreground",
          "[&_.inkade-pm-content>[data-outline-item]]:mt-0.5 [&_.inkade-pm-content>[data-outline-item]]:[margin-left:calc(28px-var(--inkade-content-pad,62px))]",
        )}
        data-ime-composing={isComposingIme ? "true" : undefined}
        onCompositionEnd={() => setIsComposingIme(false)}
        onCompositionStart={() => setIsComposingIme(true)}
        onMouseLeave={() => setHoverPreview(null)}
        onMouseOver={handleMouseOverEditor}
        ref={editorHostRef}
        role="tree"
      />

      <OutlineMetaPortals
        activeById={activeById}
        bindingsByNode={bindingsByNode}
        metaSlotEntries={metaSlotEntries}
        onFocusNode={setFocusRootId}
        onMarkBindingRead={onMarkBindingRead}
        onOpenBinding={onOpenBinding}
        onOpenDate={onOpenDate}
        onOpenDocument={onOpenDocument}
        onOpenMirroredSource={onOpenMirroredSource}
        onUnbindBinding={onUnbindBinding}
        rolloverDocDatesById={rolloverDocDatesById}
      />

      {nodeMenu && (
        <OutlineNodeActionMenu
          coords={nodeMenuCoords}
          floatingRef={nodeMenuFloatingRef}
          hasDeferHandler={Boolean(onDeferNode)}
          hasMirrorHandler={Boolean(onCreateMirror)}
          nextMondayPreviewDate={nextMondayPreviewDate}
          nodeMenu={nodeMenu}
          onAddOrFocusNote={executeAddOrFocusNote}
          onClose={() => setNodeMenu(null)}
          onCopyBlockLink={(itemPos, nodeId) => {
            void ensurePersistedNode(itemPos, nodeId).then((nodeObj) => {
              if (!nodeObj) return;
              const deepLink = buildOutlineBlockDeepLink(documentId, nodeObj.id);
              void navigator.clipboard?.writeText?.(deepLink).catch(() => {});
              onCopyBlockLink?.(nodeObj.id, deepLink);
            });
          }}
          onCreateMirror={(itemPos, nodeId) => {
            void ensurePersistedNode(itemPos, nodeId).then((nodeObj) => {
              if (!nodeObj) return;
              setMirrorDialogState({ mode: "push", sourceNode: nodeObj });
            });
          }}
          onDefer={(itemPos, target, nodeId) => void executeDeferNode(itemPos, target, nodeId)}
          onDeleteNode={(itemPos, nodeId, sourceBindingId) =>
            executeProtectedDelete(itemPos, nodeId, sourceBindingId)
          }
          onDispatchToAde={(itemPos, nodeId) => {
            void ensurePersistedNode(itemPos, nodeId).then((nodeObj) => {
              if (nodeObj) latestRef.current.onDispatchToAde?.(nodeObj);
            });
          }}
          onPromoteToArticle={(itemPos, nodeId) => {
            void ensurePersistedNode(itemPos, nodeId).then((nodeObj) => {
              if (!nodeObj) return;
              const subtreeIds = new Set(collectSubtreeIds(latestRef.current.activeNodes, nodeObj.id));
              const subtree = latestRef.current.activeNodes.filter((n) => subtreeIds.has(n.id));
              latestRef.current.onPromoteToArticle?.(nodeObj, subtree);
            });
          }}
          onToggleTodo={executeToggleTodo}
          onZoomIntoNode={(itemPos, nodeId) => {
            if (nodeId && !nodeId.startsWith("temp_")) {
              setFocusRootId(asOutlineNodeId(nodeId));
              return;
            }
            void ensurePersistedNode(itemPos, nodeId).then((nodeObj) => {
              if (nodeObj) setFocusRootId(nodeObj.id);
            });
          }}
          tomorrowPreviewDate={tomorrowPreviewDate}
        />
      )}

      {activeTrigger && (
        <OutlineTriggerPopover
          activeTrigger={activeTrigger}
          coords={triggerCoords}
          filteredTriggerItems={filteredTriggerItems}
          floatingRef={triggerFloatingRef}
          kindLabels={kindLabels}
          onSelectIndex={applyTriggerOption}
          triggerIndex={triggerIndex}
        />
      )}

      {hoverPreview && (
        <OutlineHoverPreviewCard
          activeById={activeById}
          coords={hoverPreviewCoords}
          docsByKey={docsByKey}
          floatingRef={hoverPreviewFloatingRef}
          hoverPreview={hoverPreview}
          kindLabels={kindLabels}
        />
      )}

      <OutlineRolloverAndDeleteDialogs
        deleteGuard={deleteGuard}
        onCloseDeleteGuard={() => setDeleteGuard(null)}
        onConfirmProtectedDelete={handleConfirmProtectedDelete}
        onConfirmRolloverSelected={() => {
          onRolloverSelected?.([...rolloverSelection]);
          setRolloverDialogOpen(false);
        }}
        onRolloverDialogOpenChange={setRolloverDialogOpen}
        onToggleRolloverItem={(id, checked) => {
          setRolloverSelection((prev) => {
            const updated = new Set(prev);
            if (checked) updated.add(id);
            else updated.delete(id);
            return updated;
          });
        }}
        rolloverDialogOpen={rolloverDialogOpen}
        rolloverSelection={rolloverSelection}
        rolloverTodos={rolloverTodos}
      />

      <OutlineMirrorDialog
        currentDocumentId={documentId}
        localNodes={activeNodes}
        onClose={() => setMirrorDialogState(null)}
        onConfirmPullMirror={async (match) => {
          if (onCreateMirror && mirrorDialogState?.mode === "pull") {
            await onCreateMirror(match.node, {
              targetDocumentId: documentId,
              parentNodeId: focusRootId,
              afterNodeId: mirrorDialogState.insertAfterNodeId,
            });
          }
        }}
        onConfirmPushMirror={async (sourceNode, targetDocumentId: DocumentId) => {
          if (onCreateMirror) {
            await onCreateMirror(sourceNode, { targetDocumentId, parentNodeId: null });
          }
        }}
        onSearchWorkspaceNodes={onSearchWorkspaceNodes}
        state={mirrorDialogState}
        workspaceDocs={workspaceDocs}
      />
    </div>
  );
}
