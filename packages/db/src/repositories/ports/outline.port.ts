import type {
  ActorType,
  AuditBatchId,
  CreateOutlineNodeInput,
  DocumentId,
  DocumentKind,
  DocumentRevision,
  DocumentRecord,
  DocumentTaskRecord,
  ExecutionMode,
  MoveOutlineNodeInput,
  OutlineNode,
  OutlineNodeId,
  SpaceId,
  TaskPriority,
  TaskRecurrenceRule,
  TaskScheduleSlot,
  TaskSourceEngine,
  ThreadBindingId,
  UpdateOutlineNodeInput,
} from "@inkade/core";

export interface ListOutlineNodesOptions {
  readonly includeDeleted?: boolean | undefined;
}

export interface ResolveOrderKeyOptions {
  readonly excludeNodeId?: string | undefined;
  readonly afterNodeId?: string | null | undefined;
  readonly beforeNodeId?: string | null | undefined;
  readonly explicitOrderKey?: string | undefined;
}

export interface OutlineRevisionRestoreResult {
  readonly document: DocumentRecord;
  readonly nodes: readonly OutlineNode[];
  readonly beforeRevision: DocumentRevision | null;
  readonly afterRevision: DocumentRevision;
}

export interface InsertOutlineNodeDirectInput {
  readonly id?: OutlineNodeId | undefined;
  readonly documentId: string;
  readonly parentNodeId: string | null;
  readonly orderKey: string;
  readonly contentMarkdown: string;
  readonly contentText: string;
  readonly noteMarkdown: string;
  readonly noteText: string;
  readonly checked: boolean | null;
  readonly collapsed: boolean;
  readonly authorType: "human" | "agent";
  readonly authorId: string | null;
  readonly sourceBindingId: ThreadBindingId | string | null;
  readonly mirrorOfNodeId: string | null;
  readonly priority?: TaskPriority | null | undefined;
  readonly scheduledDate?: string | null | undefined;
  readonly scheduledSlot?: TaskScheduleSlot | null | undefined;
  readonly scheduledStartMin?: number | null | undefined;
  readonly dueDate?: string | null | undefined;
  readonly durationMin?: number | null | undefined;
  readonly recurrenceRule?: TaskRecurrenceRule | null | undefined;
  readonly completedAt?: string | null | undefined;
  readonly spawnedNextNodeId?: string | null | undefined;
  readonly ts?: string | undefined;
}

export interface UpdateOutlineNodeDirectPatch {
  readonly contentMarkdown?: string | undefined;
  readonly contentText?: string | undefined;
  readonly noteMarkdown?: string | undefined;
  readonly noteText?: string | undefined;
  readonly checked?: boolean | null | undefined;
  readonly collapsed?: boolean | undefined;
  readonly sourceBindingId?: ThreadBindingId | string | null | undefined;
  readonly mirrorOfNodeId?: string | null | undefined;
  readonly rolledOverToDocId?: string | null | undefined;
  readonly priority?: TaskPriority | null | undefined;
  readonly scheduledDate?: string | null | undefined;
  readonly scheduledSlot?: TaskScheduleSlot | null | undefined;
  readonly scheduledStartMin?: number | null | undefined;
  readonly dueDate?: string | null | undefined;
  readonly durationMin?: number | null | undefined;
  readonly recurrenceRule?: TaskRecurrenceRule | null | undefined;
  readonly completedAt?: string | null | undefined;
  readonly spawnedNextNodeId?: string | null | undefined;
  readonly updatedAt: string;
}

export interface ListDocumentTasksFilter {
  readonly status?: "open" | "completed" | "all" | undefined;
  readonly sourceEngine?: TaskSourceEngine | undefined;
  readonly spaceId?: string | undefined;
  readonly spaceIds?: readonly string[] | undefined;
  readonly allowedKinds?: readonly DocumentKind[] | undefined;
  readonly tag?: string | undefined;
  readonly tagAllowlist?: readonly string[] | undefined;
  readonly priority?: TaskPriority | undefined;
  readonly scheduledDate?: string | undefined;
  readonly dueDate?: string | undefined;
  readonly includeAnytime?: boolean | undefined;
  readonly limit?: number | undefined;
  readonly offset?: number | undefined;
}

export interface IndexedDocumentTaskRow {
  readonly task: DocumentTaskRecord;
  readonly documentTitle: string;
  readonly documentKind: DocumentKind;
  readonly documentDailyDate: string | null;
}

export interface WorkspaceOutlineNodeMatch {
  readonly node: OutlineNode;
  readonly documentId: DocumentId;
  readonly documentTitle: string;
  readonly spaceId: SpaceId;
  readonly documentKind: DocumentKind;
}

export interface SearchOutlineNodesOptions {
  readonly spaceIds?: readonly string[] | undefined;
  readonly allowedKinds?: readonly DocumentKind[] | undefined;
  readonly limit?: number | undefined;
}

export interface OutlineRepo {
  listOutlineNodes(
    documentId: string,
    options?: ListOutlineNodesOptions,
  ): Promise<readonly OutlineNode[]>;
  getOutlineNodeById(documentId: string, nodeId: string): Promise<OutlineNode | null>;
  findDocumentIdByNodeId(workspaceId: string, nodeId: string): Promise<DocumentId | null>;
  createOutlineNode(
    workspaceId: string,
    input: CreateOutlineNodeInput,
    options?: {
      readonly id?: string | undefined;
      readonly batchId?: AuditBatchId | null | undefined;
      readonly executionMode?: ExecutionMode | undefined;
    },
  ): Promise<OutlineNode>;
  updateOutlineNode(
    workspaceId: string,
    documentId: string,
    nodeId: string,
    input: UpdateOutlineNodeInput,
    options?: {
      readonly actorType?: ActorType | undefined;
      readonly actorId?: string | null | undefined;
      readonly batchId?: AuditBatchId | null | undefined;
      readonly executionMode?: ExecutionMode | undefined;
    },
  ): Promise<OutlineNode>;
  moveOutlineNode(
    workspaceId: string,
    documentId: string,
    nodeId: string,
    input: MoveOutlineNodeInput,
    options?: {
      readonly actorType?: ActorType | undefined;
      readonly actorId?: string | null | undefined;
      readonly batchId?: AuditBatchId | null | undefined;
      readonly executionMode?: ExecutionMode | undefined;
    },
  ): Promise<OutlineNode>;
  softDeleteOutlineNode(
    workspaceId: string,
    documentId: string,
    nodeId: string,
    options?: {
      readonly actorType?: ActorType | undefined;
      readonly actorId?: string | null | undefined;
      readonly batchId?: AuditBatchId | null | undefined;
      readonly executionMode?: ExecutionMode | undefined;
    },
  ): Promise<readonly OutlineNode[]>;

  assertNoOutlineNodeCycle(
    documentId: string,
    nodeId: string,
    newParentNodeId: string | null,
  ): Promise<void>;
  resolveOrderKeyForParent(
    documentId: string,
    parentNodeId: string | null,
    options?: ResolveOrderKeyOptions,
  ): Promise<string>;
  insertOutlineNodeDirect(input: InsertOutlineNodeDirectInput): Promise<OutlineNode>;
  updateOutlineNodeDirect(
    documentId: string,
    nodeId: string,
    patch: UpdateOutlineNodeDirectPatch,
  ): Promise<OutlineNode>;
  moveOutlineNodeDirect(
    documentId: string,
    nodeId: string,
    parentNodeId: string | null,
    orderKey: string,
    updatedAt: string,
  ): Promise<OutlineNode>;
  softDeleteOutlineNodesDirect(
    documentId: string,
    nodeIds: readonly string[],
    deletedAt: string,
  ): Promise<void>;
  markNodesRolledOver(
    nodeIds: readonly string[],
    toDocumentId: string,
    updatedAt: string,
  ): Promise<void>;
  upsertOutlineNodeFromSnapshot(
    documentId: string,
    snapshotNode: OutlineNode,
    computed: {
      readonly contentText: string;
      readonly noteMarkdown: string;
      readonly noteText: string;
      readonly updatedAt: string;
    },
  ): Promise<void>;

  syncDocumentTasksForDocument(
    workspaceId: string,
    documentId: string,
  ): Promise<readonly DocumentTaskRecord[]>;
  listDocumentTasks(
    workspaceId: string,
    filter?: ListDocumentTasksFilter,
  ): Promise<readonly IndexedDocumentTaskRow[]>;
  getDocumentTaskById(
    workspaceId: string,
    taskId: string,
  ): Promise<IndexedDocumentTaskRow | null>;

  findOutlineNodeByIdInWorkspace(
    workspaceId: string,
    nodeId: string,
  ): Promise<WorkspaceOutlineNodeMatch | null>;
  listMirrorNodesOf(
    workspaceId: string,
    sourceNodeId: string,
  ): Promise<readonly WorkspaceOutlineNodeMatch[]>;
  searchOutlineNodes(
    workspaceId: string,
    query: string,
    options?: SearchOutlineNodesOptions,
  ): Promise<readonly WorkspaceOutlineNodeMatch[]>;
  listWorkspaceMirrorNodePairs(workspaceId: string): Promise<readonly WorkspaceMirrorNodePair[]>;
}

export interface WorkspaceMirrorNodePair {
  readonly mirrorDocumentId: DocumentId;
  readonly targetDocumentId: DocumentId;
  readonly mirrorOfNodeId: OutlineNode["id"];
}
