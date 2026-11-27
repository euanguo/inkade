import type {
  AdeThreadBinding,
  BatchOutlineNodesResult,
  CreateOutlineNodeInput,
  DocumentId,
  DocumentKind,
  DocumentRecord,
  MoveOutlineNodeInput,
  OutlineBatchOperation,
  OutlineNode,
  OutlineNodeId,
  UpdateOutlineNodeInput,
} from "@inkade/core";
import type React from "react";
import type * as Y from "yjs";

export type ProseMirrorWorkspaceDocSummary = Pick<
  DocumentRecord,
  "id" | "title" | "slug" | "kind" | "excerpt" | "updatedAt"
>;

export interface WorkspaceOutlineSearchMatch {
  readonly node: OutlineNode;
  readonly documentId: DocumentId;
  readonly documentTitle: string;
}

export type OutlineDeferTarget = "tomorrow" | "next_monday";

export interface ProseMirrorOutlineEditorProps {
  readonly documentId: DocumentId;
  readonly rootTitle?: string | undefined;
  readonly hideRootBreadcrumbTitle?: boolean | undefined;
  readonly deferBaseDate?: string | undefined;
  readonly nodes: readonly OutlineNode[];
  readonly bindings?: readonly AdeThreadBinding[] | undefined;
  readonly workspaceDocs?: readonly ProseMirrorWorkspaceDocSummary[] | undefined;
  readonly workspaceTags?: readonly string[] | undefined;
  readonly rolloverTodos?: readonly OutlineNode[] | undefined;
  readonly rolloverDocDatesById?: ReadonlyMap<DocumentId, string> | undefined;
  readonly highlightedNodeId?: OutlineNodeId | null | undefined;
  readonly initialFocusRootId?: OutlineNodeId | null | undefined;
  readonly onFocusRootChange?: ((nodeId: OutlineNodeId | null) => void) | undefined;
  readonly onRolloverAll?: (() => void) | undefined;
  readonly onRolloverSelected?: ((nodeIds: readonly OutlineNodeId[]) => void) | undefined;
  readonly onDismissRollover?: (() => void) | undefined;
  readonly onDeferNode?: ((
    node: OutlineNode,
    target: OutlineDeferTarget,
  ) => Promise<{ readonly targetDocId: DocumentId; readonly targetDate: string } | void> | void) | undefined;
  readonly onBatchMutate?: ((
    operations: readonly OutlineBatchOperation[],
  ) => Promise<BatchOutlineNodesResult | void> | void) | undefined;
  readonly onCreateNode?: ((input: CreateOutlineNodeInput) => void) | undefined;
  readonly onUpdateNode?: ((nodeId: OutlineNodeId, patch: UpdateOutlineNodeInput) => void) | undefined;
  readonly onMoveNode?: ((nodeId: OutlineNodeId, move: MoveOutlineNodeInput) => void) | undefined;
  readonly onDeleteNode?: ((nodeId: OutlineNodeId) => void) | undefined;
  readonly onBatchCollapseChange?: ((
    collapsed: boolean,
    scopeNodeIds: readonly OutlineNodeId[],
  ) => void) | undefined;
  readonly onDispatchToAde?: ((node: OutlineNode) => void) | undefined;
  readonly onPromoteToArticle?: ((
    node: OutlineNode,
    subtree: readonly OutlineNode[],
  ) => void) | undefined;
  readonly onOpenDocument?: ((docIdOrSlug: string) => void) | undefined;
  readonly onOpenDate?: ((date: string) => void) | undefined;
  readonly onClickTag?: ((tag: string) => void) | undefined;
  readonly onOpenBinding?: ((binding: AdeThreadBinding) => void) | undefined;
  readonly onMarkBindingRead?: ((binding: AdeThreadBinding) => void) | undefined;
  readonly onUnbindBinding?: ((binding: AdeThreadBinding) => void) | undefined;
  readonly onCreateMirror?:
    | ((
        sourceNode: OutlineNode,
        placement: {
          readonly targetDocumentId: DocumentId;
          readonly parentNodeId?: OutlineNodeId | null | undefined;
          readonly afterNodeId?: OutlineNodeId | undefined;
        },
      ) => Promise<OutlineNode | void> | void)
    | undefined;
  readonly onSearchWorkspaceNodes?:
    | ((query: string) => Promise<readonly WorkspaceOutlineSearchMatch[]>)
    | undefined;
  readonly onCopyBlockLink?: ((nodeId: OutlineNodeId, deepLinkUri: string) => void) | undefined;
  readonly onOpenMirroredSource?: ((mirrorOfNodeId: OutlineNodeId) => void) | undefined;
  readonly onOpenPdfCitation?: ((uri: string) => void) | undefined;
  readonly onOpenBlockDeepLink?: ((uri: string) => void) | undefined;
  readonly readOnly?: boolean | undefined;
  readonly collaborativeDoc?: Y.Doc | undefined;
  readonly syncFragmentName?: string | undefined;
  readonly className?: string | undefined;
}

export type SlashCommandId =
  | "todo"
  | "note"
  | "heading1"
  | "heading2"
  | "heading3"
  | "quote"
  | "callout-note"
  | "callout-tip"
  | "callout-warning"
  | "code"
  | "mermaid"
  | "divider"
  | "today"
  | "tomorrow"
  | "dispatch"
  | "promote"
  | "link"
  | "blockref"
  | "mirror";

export interface SlashCommandOption {
  readonly id: SlashCommandId;
  readonly label: string;
  readonly description: string;
  readonly keywords?: string | undefined;
  readonly icon: React.ReactNode;
}

export type ActiveTriggerKind = "slash" | "at" | "wikilink" | "blockref" | "tag";

export interface ActiveTrigger {
  readonly kind: ActiveTriggerKind;
  readonly itemPos: number;
  readonly paraStart: number;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly query: string;
  readonly coords: { readonly top: number; readonly left: number; readonly bottom: number };
}

export interface FloatingAnchorRect {
  readonly left: number;
  readonly top: number;
  readonly bottom: number;
  readonly right?: number | undefined;
}

export interface HoverPreviewState {
  readonly kind: "wikilink" | "blockref";
  readonly target: string;
  readonly rect: { readonly left: number; readonly top: number; readonly bottom: number };
}

export interface PendingDeleteGuard {
  readonly nodeId: string;
  readonly bindingCount: number;
}

export interface NodeActionMenuState {
  readonly itemPos: number;
  readonly nodeId: string | null;
  readonly sourceBindingId: string | null;
  readonly rect: { readonly left: number; readonly top: number; readonly bottom: number };
}

export type OutlineTriggerItem =
  | { readonly type: "slash"; readonly cmd: SlashCommandOption }
  | {
      readonly type: "at-date";
      readonly id: string;
      readonly isoDate: string;
      readonly label: string;
    }
  | { readonly type: "at-doc"; readonly doc: ProseMirrorWorkspaceDocSummary }
  | { readonly type: "at-ade" }
  | { readonly type: "wikilink"; readonly doc: ProseMirrorWorkspaceDocSummary }
  | { readonly type: "blockref"; readonly node: OutlineNode }
  | { readonly type: "tag"; readonly tag: string };

export interface NodeViewActionBridge {
  readonly readOnly: () => boolean;
  readonly canDefer: () => boolean;
  readonly isBindingProtected: (nodeId: string | null, sourceBindingId: string | null) => boolean;
  readonly onZoomIn: (nodeId: string) => void;
  readonly onToggleTodo: (itemPos: number) => void;
  readonly onToggleCollapse: (itemPos: number) => void;
  readonly onAddNote: (itemPos: number) => void;
  readonly onOpenNodeMenu: (
    itemPos: number,
    nodeId: string | null,
    sourceBindingId: string | null,
    rect: DOMRect,
  ) => void;
  readonly onDropMove: (
    draggedId: string,
    targetId: string,
    pos: "above" | "below" | "child",
  ) => void;
}

export interface OutlineLatestState {
  readonly documentId: DocumentId;
  readonly nodes: readonly OutlineNode[];
  readonly activeNodes: readonly OutlineNode[];
  readonly activeById: ReadonlyMap<OutlineNodeId, OutlineNode>;
  readonly bindingsByNode: ReadonlyMap<OutlineNodeId, readonly AdeThreadBinding[]>;
  readonly bindingsCountByNode: ReadonlyMap<OutlineNodeId, number>;
  readonly focusRootId: OutlineNodeId | null;
  readonly readOnly: boolean;
  readonly highlightedNodeId: OutlineNodeId | null | undefined;
  readonly onBatchMutate: ProseMirrorOutlineEditorProps["onBatchMutate"];
  readonly onCreateNode: ProseMirrorOutlineEditorProps["onCreateNode"];
  readonly onUpdateNode: ProseMirrorOutlineEditorProps["onUpdateNode"];
  readonly onMoveNode: ProseMirrorOutlineEditorProps["onMoveNode"];
  readonly onDeleteNode: ProseMirrorOutlineEditorProps["onDeleteNode"];
  readonly onDeferNode: ProseMirrorOutlineEditorProps["onDeferNode"];
  readonly onDispatchToAde: ProseMirrorOutlineEditorProps["onDispatchToAde"];
  readonly onPromoteToArticle: ProseMirrorOutlineEditorProps["onPromoteToArticle"];
  readonly onOpenDocument: ProseMirrorOutlineEditorProps["onOpenDocument"];
  readonly onClickTag: ProseMirrorOutlineEditorProps["onClickTag"];
  readonly onOpenPdfCitation?: ProseMirrorOutlineEditorProps["onOpenPdfCitation"];
  readonly onOpenBlockDeepLink?: ProseMirrorOutlineEditorProps["onOpenBlockDeepLink"];
  readonly onOpenMirrorPull?:
    | ((context: { readonly itemPos: number; readonly nodeId: string | null }) => void)
    | undefined;
  readonly setFocusRootId: (nextId: OutlineNodeId | null) => void;
  readonly emptyLineHint: string;
}

export type OutlineKindLabels = Readonly<Record<DocumentKind, string>>;
