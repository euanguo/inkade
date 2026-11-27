import type {
  ActorType,
  ApiTokenId,
  AuditBatchId,
  AuditLogId,
  CreateDocumentHighlightInput,
  DocumentHighlight,
  DocumentId,
  DocumentLink,
  DocumentRevision,
  ExecutionMode,
  HighlightComment,
  HighlightCommentAuthorType,
  HighlightCommentId,
  HighlightId,
  HighlightStatus,
  OutlineNode,
  RevisionId,
  UpdateDocumentHighlightInput,
  UserId,
  WakeEventId,
} from "@inkade/core";

export interface RevisionWithOutlineSnapshot extends DocumentRevision {
  readonly outlineSnapshot: readonly OutlineNode[] | null;
}

export interface WorkspaceDocumentLinkEdge {
  readonly sourceDocumentId: DocumentId;
  readonly targetDocumentId: DocumentId;
}

export interface CreateRevisionRecordInput {
  readonly id?: RevisionId | undefined;
  readonly documentId: string;
  readonly version: number;
  readonly contentMarkdown: string;
  readonly outlineSnapshotJson?: string | null | undefined;
  readonly changeSummary?: string | null | undefined;
  readonly actorType: ActorType;
  readonly actorId?: UserId | ApiTokenId | string | null | undefined;
  readonly batchId?: AuditBatchId | null | undefined;
  readonly executionMode?: ExecutionMode | undefined;
  readonly reversedByAuditId?: AuditLogId | null | undefined;
  readonly createdAt?: string | undefined;
}

export interface RecordOutlinePostMutationRevisionInput {
  readonly documentId: string;
  readonly currentVersion: number;
  readonly actorType: ActorType;
  readonly actorId?: string | null | undefined;
  readonly changeSummary: string;
  readonly batchId?: AuditBatchId | null | undefined;
  readonly executionMode?: ExecutionMode | undefined;
  readonly ts?: string | undefined;
  readonly updateLastEditedBy?: boolean | undefined;
}

export interface CreateHighlightCommentRecordInput {
  readonly id?: HighlightCommentId | undefined;
  readonly highlightId: HighlightId | string;
  readonly documentId: DocumentId | string;
  readonly authorType: HighlightCommentAuthorType;
  readonly authorId?: string | null | undefined;
  readonly authorName: string;
  readonly bodyMarkdown: string;
  readonly sentToAgentAt?: string | null | undefined;
  readonly wakeEventId?: WakeEventId | string | null | undefined;
  readonly createdAt?: string | undefined;
}

export interface RevisionLinkRepo {
  listRevisions(documentId: string): Promise<readonly DocumentRevision[]>;
  getRevision(documentId: string, version: number): Promise<DocumentRevision | null>;
  getRevisionById(revisionId: string): Promise<RevisionWithOutlineSnapshot | null>;
  getLatestRevision(documentId: string): Promise<DocumentRevision | null>;
  createRevision(input: CreateRevisionRecordInput): Promise<DocumentRevision>;
  markRevisionsReversed(
    revisionIds: readonly (RevisionId | string)[],
    reversedByAuditId: AuditLogId | string,
  ): Promise<void>;
  ensureOutlineBaselineRevision(
    doc: { readonly id: string; readonly version: number; readonly createdAt: string },
    ts?: string,
  ): Promise<void>;
  recordOutlinePostMutationRevision(
    input: RecordOutlinePostMutationRevisionInput,
  ): Promise<DocumentRevision>;

  listBacklinks(workspaceId: string, documentId: string): Promise<readonly DocumentLink[]>;
  listOutgoingLinks(workspaceId: string, documentId: string): Promise<readonly DocumentLink[]>;
  listWorkspaceDocumentLinks(workspaceId: string): Promise<readonly WorkspaceDocumentLinkEdge[]>;
  listIncomingLinkSourceDocIds(
    workspaceId: string,
    renamedDocId: string,
    oldTitle: string,
  ): Promise<readonly DocumentId[]>;
  syncOutgoingLinks(
    workspaceId: string,
    sourceDocumentId: string,
    sourceNodeId: string | null,
    markdown: string,
  ): Promise<void>;
  resolvePendingIncomingLinks(
    workspaceId: string,
    targetDoc: { readonly id: string; readonly slug: string; readonly title: string },
  ): Promise<void>;
  deleteLinksForNodes(nodeIds: readonly string[]): Promise<void>;

  listDocumentHighlights(
    workspaceId: string,
    documentId: string,
  ): Promise<readonly DocumentHighlight[]>;
  getDocumentHighlightById(
    workspaceId: string,
    highlightId: HighlightId | string,
  ): Promise<DocumentHighlight | null>;
  createDocumentHighlight(
    workspaceId: string,
    documentId: string,
    input: CreateDocumentHighlightInput,
    options?: { readonly id?: string | undefined },
  ): Promise<DocumentHighlight>;
  updateDocumentHighlight(
    workspaceId: string,
    highlightId: HighlightId | string,
    input: UpdateDocumentHighlightInput,
  ): Promise<DocumentHighlight>;
  deleteDocumentHighlight(workspaceId: string, highlightId: HighlightId | string): Promise<void>;

  listHighlightComments(
    workspaceId: string,
    highlightId: HighlightId | string,
  ): Promise<readonly HighlightComment[]>;
  listDocumentHighlightComments(
    workspaceId: string,
    documentId: string,
  ): Promise<readonly HighlightComment[]>;
  createHighlightComment(
    workspaceId: string,
    input: CreateHighlightCommentRecordInput,
  ): Promise<HighlightComment>;
  markHighlightCommentsSentToAgent(
    workspaceId: string,
    commentIds: readonly (HighlightCommentId | string)[],
    wakeEventId: WakeEventId | string,
    sentAt: string,
  ): Promise<readonly HighlightComment[]>;
  updateHighlightStatus(
    workspaceId: string,
    highlightId: HighlightId | string,
    input: {
      readonly status: HighlightStatus;
      readonly resolvedAt: string | null;
      readonly resolvedByType: ActorType | null;
    },
  ): Promise<DocumentHighlight>;
}
