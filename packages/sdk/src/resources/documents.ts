import type {
  AttachmentId,
  AuditBatchId,
  CreateDocumentInput,
  CreateHighlightCommentInput,
  DocumentGraph,
  DocumentHighlight,
  DocumentId,
  DocumentLink,
  DocumentRecord,
  DocumentRevision,
  DocumentSummary,
  GetViewerContextResult,
  HighlightComment,
  HighlightCommentThread,
  HighlightId,
  HighlightStatus,
  ImportConflictPolicy,
  OutlineNode,
  OutlineNodeId,
  PatchDocumentSectionInput,
  RelatedDocumentHit,
  RevisionDiffResult,
  ScaffoldDocumentInput,
  SendHighlightToAgentInput,
  SendHighlightToAgentResult,
  SpaceId,
  UnlinkedMentionItem,
  UpdateDocumentInput,
  UpdateViewerContextInput,
  ViewerContextSnapshot,
} from "@inkade/core";
import { buildQuery, type InkadeHttpTransport } from "../http-transport.ts";
import type { DocumentListFilter } from "../query-keys.ts";

export type ListDocumentsParams = DocumentListFilter;

export interface DailyOutlineResponse {
  readonly document: DocumentRecord;
  readonly nodes: readonly OutlineNode[];
  readonly created: boolean;
}

export interface RevisionDiffResponse {
  readonly documentId: DocumentId;
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly diff: RevisionDiffResult;
}

export interface LinkDocumentTargetResponse {
  readonly document: DocumentRecord;
  readonly linked: boolean;
  readonly alreadyLinked: boolean;
  readonly createdNodeId: OutlineNodeId | null;
}

export interface UpdateViewerContextResponse {
  readonly cleared: boolean;
  readonly context: ViewerContextSnapshot | null;
}

export interface ImportDocxResponse {
  readonly document: DocumentRecord;
  readonly attachmentIds: readonly AttachmentId[];
  readonly batchId: AuditBatchId;
  readonly warnings: readonly string[];
}

export type ImportDocxInput =
  | {
      readonly file: Blob;
      readonly filename?: string | undefined;
      readonly spaceId?: SpaceId | undefined;
      readonly title?: string | undefined;
      readonly tags?: readonly string[] | undefined;
      readonly conflictPolicy?: ImportConflictPolicy | undefined;
    }
  | {
      readonly contentBase64: string;
      readonly filename?: string | undefined;
      readonly spaceId?: SpaceId | undefined;
      readonly title?: string | undefined;
      readonly tags?: readonly string[] | undefined;
      readonly conflictPolicy?: ImportConflictPolicy | undefined;
    };

export interface DocumentsResource {
  list(params?: ListDocumentsParams): Promise<readonly DocumentSummary[]>;
  get(documentId: DocumentId): Promise<DocumentRecord>;
  getDaily(date: string): Promise<DailyOutlineResponse>;
  create(input: CreateDocumentInput): Promise<DocumentRecord>;
  scaffold(input: ScaffoldDocumentInput): Promise<DocumentRecord>;
  update(documentId: DocumentId, input: UpdateDocumentInput): Promise<DocumentRecord>;
  patchSection(documentId: DocumentId, input: PatchDocumentSectionInput): Promise<DocumentRecord>;
  trash(documentId: DocumentId): Promise<DocumentRecord>;
  restore(documentId: DocumentId): Promise<DocumentRecord>;
  delete(
    documentId: DocumentId,
    options?: { readonly hard?: boolean | undefined },
  ): Promise<
    { readonly deleted: boolean; readonly id: DocumentId } | { readonly document: DocumentRecord }
  >;
  markAgentUpdateRead(documentId: DocumentId): Promise<DocumentRecord>;
  acknowledgeSilent(documentId: DocumentId): Promise<DocumentRecord>;
  listRevisions(documentId: DocumentId): Promise<readonly DocumentRevision[]>;
  getRevisionDiff(
    documentId: DocumentId,
    fromVersion: number,
    toVersion: number,
  ): Promise<RevisionDiffResponse>;
  restoreRevision(documentId: DocumentId, version: number): Promise<DocumentRecord>;
  listBacklinks(documentId: DocumentId): Promise<readonly DocumentLink[]>;
  unlinkedMentions(documentId: DocumentId): Promise<readonly UnlinkedMentionItem[]>;
  graph(documentId: DocumentId, depth?: number): Promise<DocumentGraph>;
  linkTarget(
    documentId: DocumentId,
    targetDocumentId: DocumentId,
  ): Promise<LinkDocumentTargetResponse>;
  related(documentId: DocumentId, limit?: number): Promise<readonly RelatedDocumentHit[]>;
  exportMarkdown(documentId: DocumentId): Promise<string>;
  exportDocx(documentId: DocumentId): Promise<Uint8Array>;
  importDocx(input: ImportDocxInput): Promise<ImportDocxResponse>;
  listCommentThreads(
    documentId: DocumentId,
    status?: HighlightStatus | "all",
  ): Promise<readonly HighlightCommentThread[]>;
  listHighlightComments(
    highlightId: HighlightId,
  ): Promise<{ readonly highlight: DocumentHighlight; readonly comments: readonly HighlightComment[] }>;
  addHighlightComment(
    highlightId: HighlightId,
    input: CreateHighlightCommentInput,
  ): Promise<{ readonly highlight: DocumentHighlight; readonly comment: HighlightComment }>;
  sendHighlightToAgent(
    highlightId: HighlightId,
    input?: SendHighlightToAgentInput,
  ): Promise<SendHighlightToAgentResult>;
  resolveHighlight(highlightId: HighlightId): Promise<DocumentHighlight>;
  reopenHighlight(highlightId: HighlightId): Promise<DocumentHighlight>;
  getViewerContext(): Promise<GetViewerContextResult>;
  updateViewerContext(input: UpdateViewerContextInput): Promise<UpdateViewerContextResponse>;
}

export function createDocumentsResource(transport: InkadeHttpTransport): DocumentsResource {
  return {
    async list(params = {}) {
      const query = buildQuery({
        spaceId: params.spaceId,
        kind: params.kind,
        tag: params.tag,
        pinnedOnly: params.pinnedOnly,
        includeTrashed: params.includeTrashed,
        limit: params.limit,
        offset: params.offset,
      });
      const res = await transport.requestJson<{ readonly documents: readonly DocumentSummary[] }>(
        `/api/v1/documents${query}`,
      );
      return res.documents;
    },

    async get(documentId) {
      const res = await transport.requestJson<{ readonly document: DocumentRecord }>(
        `/api/v1/documents/${encodeURIComponent(documentId)}`,
      );
      return res.document;
    },

    getDaily(date) {
      return transport.requestJson<DailyOutlineResponse>(
        `/api/v1/documents/daily/${encodeURIComponent(date)}`,
      );
    },

    async create(input) {
      const res = await transport.requestJson<{ readonly document: DocumentRecord }>(
        "/api/v1/documents",
        {
          method: "POST",
          body: JSON.stringify({
            contentMarkdown: "",
            tags: [],
            pinned: false,
            ...input,
          }),
        },
      );
      return res.document;
    },

    async scaffold(input) {
      const res = await transport.requestJson<{ readonly document: DocumentRecord }>(
        "/api/v1/documents/scaffold",
        {
          method: "POST",
          body: JSON.stringify({
            tags: [],
            pinned: false,
            ...input,
          }),
        },
      );
      return res.document;
    },

    async update(documentId, input) {
      const res = await transport.requestJson<{ readonly document: DocumentRecord }>(
        `/api/v1/documents/${encodeURIComponent(documentId)}`,
        {
          method: "PATCH",
          body: JSON.stringify(input),
        },
      );
      return res.document;
    },

    async patchSection(documentId, input) {
      const res = await transport.requestJson<{ readonly document: DocumentRecord }>(
        `/api/v1/documents/${encodeURIComponent(documentId)}/patch-section`,
        {
          method: "POST",
          body: JSON.stringify({ createIfMissing: false, ...input }),
        },
      );
      return res.document;
    },

    async trash(documentId) {
      const res = await transport.requestJson<{ readonly document: DocumentRecord }>(
        `/api/v1/documents/${encodeURIComponent(documentId)}/trash`,
        { method: "POST" },
      );
      return res.document;
    },

    async restore(documentId) {
      const res = await transport.requestJson<{ readonly document: DocumentRecord }>(
        `/api/v1/documents/${encodeURIComponent(documentId)}/restore`,
        { method: "POST" },
      );
      return res.document;
    },

    delete(documentId, options) {
      const query = buildQuery({ hard: options?.hard });
      return transport.requestJson(`/api/v1/documents/${encodeURIComponent(documentId)}${query}`, {
        method: "DELETE",
      });
    },

    async markAgentUpdateRead(documentId) {
      const res = await transport.requestJson<{ readonly document: DocumentRecord }>(
        `/api/v1/documents/${encodeURIComponent(documentId)}/read-agent-update`,
        { method: "POST" },
      );
      return res.document;
    },

    async acknowledgeSilent(documentId) {
      const res = await transport.requestJson<{ readonly document: DocumentRecord }>(
        `/api/v1/documents/${encodeURIComponent(documentId)}/acknowledge-silent`,
        { method: "POST" },
      );
      return res.document;
    },

    async listRevisions(documentId) {
      const res = await transport.requestJson<{ readonly revisions: readonly DocumentRevision[] }>(
        `/api/v1/documents/${encodeURIComponent(documentId)}/revisions`,
      );
      return res.revisions;
    },

    getRevisionDiff(documentId, fromVersion, toVersion) {
      const query = buildQuery({ from: fromVersion, to: toVersion });
      return transport.requestJson<RevisionDiffResponse>(
        `/api/v1/documents/${encodeURIComponent(documentId)}/revisions/diff${query}`,
      );
    },

    async restoreRevision(documentId, version) {
      const res = await transport.requestJson<{ readonly document: DocumentRecord }>(
        `/api/v1/documents/${encodeURIComponent(documentId)}/revisions/${version}/restore`,
        { method: "POST" },
      );
      return res.document;
    },

    async listBacklinks(documentId) {
      const res = await transport.requestJson<{ readonly backlinks: readonly DocumentLink[] }>(
        `/api/v1/documents/${encodeURIComponent(documentId)}/backlinks`,
      );
      return res.backlinks;
    },

    async unlinkedMentions(documentId) {
      const res = await transport.requestJson<{ readonly mentions: readonly UnlinkedMentionItem[] }>(
        `/api/v1/documents/${encodeURIComponent(documentId)}/unlinked-mentions`,
      );
      return res.mentions;
    },

    graph(documentId, depth = 2) {
      const query = buildQuery({ depth });
      return transport.requestJson<DocumentGraph>(
        `/api/v1/documents/${encodeURIComponent(documentId)}/graph${query}`,
      );
    },

    linkTarget(documentId, targetDocumentId) {
      return transport.requestJson<LinkDocumentTargetResponse>(
        `/api/v1/documents/${encodeURIComponent(documentId)}/link-target`,
        {
          method: "POST",
          body: JSON.stringify({ targetDocumentId }),
        },
      );
    },

    async related(documentId, limit) {
      const query = buildQuery({ limit });
      const res = await transport.requestJson<{ readonly related: readonly RelatedDocumentHit[] }>(
        `/api/v1/documents/${encodeURIComponent(documentId)}/related${query}`,
      );
      return res.related;
    },

    async exportMarkdown(documentId) {
      const response = await transport.requestRaw(
        `/api/v1/documents/${encodeURIComponent(documentId)}/export.md`,
      );
      return response.text();
    },

    async exportDocx(documentId) {
      const response = await transport.requestRaw(
        `/api/v1/documents/${encodeURIComponent(documentId)}/export?format=docx`,
      );
      return new Uint8Array(await response.arrayBuffer());
    },

    importDocx(input) {
      if ("file" in input) {
        const fd = new FormData();
        fd.set("file", input.file, input.filename ?? "document.docx");
        if (input.filename) fd.set("filename", input.filename);
        if (input.spaceId) fd.set("spaceId", input.spaceId);
        if (input.title) fd.set("title", input.title);
        if (input.conflictPolicy) fd.set("conflictPolicy", input.conflictPolicy);
        if (input.tags && input.tags.length > 0) {
          fd.set("tags", JSON.stringify(input.tags));
        }
        return transport.requestJson<ImportDocxResponse>("/api/v1/documents/import-docx", {
          method: "POST",
          body: fd,
        });
      }
      return transport.requestJson<ImportDocxResponse>("/api/v1/documents/import-docx", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },

    async listCommentThreads(documentId, status = "all") {
      const query = buildQuery({ status });
      const res = await transport.requestJson<{
        readonly threads: readonly HighlightCommentThread[];
      }>(`/api/v1/documents/${encodeURIComponent(documentId)}/comment-threads${query}`);
      return res.threads;
    },

    listHighlightComments(highlightId) {
      return transport.requestJson<{
        readonly highlight: DocumentHighlight;
        readonly comments: readonly HighlightComment[];
      }>(`/api/v1/highlights/${encodeURIComponent(highlightId)}/comments`);
    },

    addHighlightComment(highlightId, input) {
      return transport.requestJson<{
        readonly highlight: DocumentHighlight;
        readonly comment: HighlightComment;
      }>(`/api/v1/highlights/${encodeURIComponent(highlightId)}/comments`, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },

    sendHighlightToAgent(highlightId, input = {}) {
      return transport.requestJson<SendHighlightToAgentResult>(
        `/api/v1/highlights/${encodeURIComponent(highlightId)}/send-to-agent`,
        {
          method: "POST",
          body: JSON.stringify(input),
        },
      );
    },

    async resolveHighlight(highlightId) {
      const res = await transport.requestJson<{ readonly highlight: DocumentHighlight }>(
        `/api/v1/highlights/${encodeURIComponent(highlightId)}/resolve`,
        { method: "POST", body: JSON.stringify({}) },
      );
      return res.highlight;
    },

    async reopenHighlight(highlightId) {
      const res = await transport.requestJson<{ readonly highlight: DocumentHighlight }>(
        `/api/v1/highlights/${encodeURIComponent(highlightId)}/reopen`,
        { method: "POST", body: JSON.stringify({}) },
      );
      return res.highlight;
    },

    getViewerContext() {
      return transport.requestJson<GetViewerContextResult>("/api/v1/viewer-context");
    },

    updateViewerContext(input) {
      return transport.requestJson<UpdateViewerContextResponse>("/api/v1/viewer-context", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
  };
}
