import type {
  ApplyDocumentTemplateInput,
  ClipLookupResult,
  CreateDocumentHighlightInput,
  CreateDocumentTemplateInput,
  CreateHighlightCommentInput,
  CreateSavedViewInput,
  CreateShareLinkInput,
  DocumentHighlight,
  DocumentId,
  DocumentKind,
  DocumentRecord,
  DocumentTemplate,
  HighlightComment,
  HighlightCommentThread,
  HighlightId,
  HighlightStatus,
  IngestClipUrlInput,
  OutlineNode,
  PublicSharedDocument,
  SavedView,
  SavedViewId,
  SendHighlightToAgentInput,
  SendHighlightToAgentResult,
  ShareLink,
  ShareLinkId,
  TemplateId,
  UpdateDocumentHighlightInput,
  UpdateDocumentTemplateInput,
  UpdateSavedViewInput,
  ViewQueryRequestInput,
  ViewQueryResponse,
} from "@inkade/core";
import { buildQuery, type InkadeHttpTransport } from "../http-transport.ts";

export interface IngestClipUrlResponse {
  readonly document: DocumentRecord;
  readonly mirroredImages: number;
}

export interface ApplyTemplateResponse {
  readonly document: DocumentRecord;
  readonly nodes?: readonly OutlineNode[] | undefined;
}

export interface ClipsResource {
  lookup(url: string): Promise<ClipLookupResult>;
  ingestUrl(input: IngestClipUrlInput): Promise<IngestClipUrlResponse>;
}

export interface HighlightCommentsResponse {
  readonly highlight: DocumentHighlight;
  readonly comments: readonly HighlightComment[];
}

export interface HighlightsResource {
  list(documentId: DocumentId): Promise<readonly DocumentHighlight[]>;
  create(documentId: DocumentId, input: CreateDocumentHighlightInput): Promise<DocumentHighlight>;
  update(highlightId: HighlightId, input: UpdateDocumentHighlightInput): Promise<DocumentHighlight>;
  delete(highlightId: HighlightId): Promise<void>;
  listCommentThreads(
    documentId: DocumentId,
    status?: HighlightStatus | "all",
  ): Promise<readonly HighlightCommentThread[]>;
  listComments(highlightId: HighlightId): Promise<HighlightCommentsResponse>;
  addComment(
    highlightId: HighlightId,
    input: CreateHighlightCommentInput,
  ): Promise<{ readonly highlight: DocumentHighlight; readonly comment: HighlightComment }>;
  sendToAgent(
    highlightId: HighlightId,
    input?: SendHighlightToAgentInput,
  ): Promise<SendHighlightToAgentResult>;
  resolve(highlightId: HighlightId): Promise<DocumentHighlight>;
  reopen(highlightId: HighlightId): Promise<DocumentHighlight>;
}

export interface TemplatesResource {
  list(kind?: DocumentKind): Promise<readonly DocumentTemplate[]>;
  create(input: CreateDocumentTemplateInput): Promise<DocumentTemplate>;
  update(templateId: TemplateId, input: UpdateDocumentTemplateInput): Promise<DocumentTemplate>;
  delete(templateId: TemplateId): Promise<void>;
  apply(templateId: TemplateId, input?: ApplyDocumentTemplateInput): Promise<ApplyTemplateResponse>;
}

export interface ShareLinksResource {
  list(documentId?: DocumentId): Promise<readonly ShareLink[]>;
  create(input: CreateShareLinkInput): Promise<ShareLink>;
  revoke(shareLinkId: ShareLinkId): Promise<ShareLink>;
  getPublic(token: string): Promise<PublicSharedDocument>;
}

export interface SavedViewsResource {
  list(): Promise<readonly SavedView[]>;
  create(input: CreateSavedViewInput): Promise<SavedView>;
  update(viewId: SavedViewId, input: UpdateSavedViewInput): Promise<SavedView>;
  delete(viewId: SavedViewId): Promise<void>;
}

export function createClipsResource(transport: InkadeHttpTransport): ClipsResource {
  return {
    lookup(url) {
      const query = buildQuery({ url });
      return transport.requestJson<ClipLookupResult>(`/api/v1/clips/lookup${query}`);
    },

    ingestUrl(input) {
      return transport.requestJson<IngestClipUrlResponse>("/api/v1/clips/ingest-url", {
        method: "POST",
        body: JSON.stringify({
          tags: [],
          mirrorImages: true,
          saveHtmlSnapshot: true,
          ...input,
        }),
      });
    },
  };
}

export function createHighlightsResource(transport: InkadeHttpTransport): HighlightsResource {
  return {
    async list(documentId) {
      const res = await transport.requestJson<{ readonly highlights: readonly DocumentHighlight[] }>(
        `/api/v1/documents/${encodeURIComponent(documentId)}/highlights`,
      );
      return res.highlights;
    },

    async create(documentId, input) {
      const res = await transport.requestJson<{ readonly highlight: DocumentHighlight }>(
        `/api/v1/documents/${encodeURIComponent(documentId)}/highlights`,
        {
          method: "POST",
          body: JSON.stringify({
            prefixContext: "",
            suffixContext: "",
            color: "amber",
            noteMarkdown: "",
            ...input,
          }),
        },
      );
      return res.highlight;
    },

    async update(highlightId, input) {
      const res = await transport.requestJson<{ readonly highlight: DocumentHighlight }>(
        `/api/v1/highlights/${encodeURIComponent(highlightId)}`,
        {
          method: "PATCH",
          body: JSON.stringify(input),
        },
      );
      return res.highlight;
    },

    async delete(highlightId) {
      await transport.requestJson<{ readonly deleted: boolean }>(
        `/api/v1/highlights/${encodeURIComponent(highlightId)}`,
        { method: "DELETE" },
      );
    },

    async listCommentThreads(documentId, status = "all") {
      const query = buildQuery({ status });
      const res = await transport.requestJson<{
        readonly threads: readonly HighlightCommentThread[];
      }>(`/api/v1/documents/${encodeURIComponent(documentId)}/comment-threads${query}`);
      return res.threads;
    },

    listComments(highlightId) {
      return transport.requestJson<HighlightCommentsResponse>(
        `/api/v1/highlights/${encodeURIComponent(highlightId)}/comments`,
      );
    },

    addComment(highlightId, input) {
      return transport.requestJson<{
        readonly highlight: DocumentHighlight;
        readonly comment: HighlightComment;
      }>(`/api/v1/highlights/${encodeURIComponent(highlightId)}/comments`, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },

    sendToAgent(highlightId, input = {}) {
      return transport.requestJson<SendHighlightToAgentResult>(
        `/api/v1/highlights/${encodeURIComponent(highlightId)}/send-to-agent`,
        {
          method: "POST",
          body: JSON.stringify(input),
        },
      );
    },

    async resolve(highlightId) {
      const res = await transport.requestJson<{ readonly highlight: DocumentHighlight }>(
        `/api/v1/highlights/${encodeURIComponent(highlightId)}/resolve`,
        { method: "POST", body: JSON.stringify({}) },
      );
      return res.highlight;
    },

    async reopen(highlightId) {
      const res = await transport.requestJson<{ readonly highlight: DocumentHighlight }>(
        `/api/v1/highlights/${encodeURIComponent(highlightId)}/reopen`,
        { method: "POST", body: JSON.stringify({}) },
      );
      return res.highlight;
    },
  };
}

export function createTemplatesResource(transport: InkadeHttpTransport): TemplatesResource {
  return {
    async list(kind) {
      const query = buildQuery({ kind });
      const res = await transport.requestJson<{ readonly templates: readonly DocumentTemplate[] }>(
        `/api/v1/templates${query}`,
      );
      return res.templates;
    },

    async create(input) {
      const res = await transport.requestJson<{ readonly template: DocumentTemplate }>(
        "/api/v1/templates",
        {
          method: "POST",
          body: JSON.stringify({
            description: "",
            contentMarkdown: "",
            isDefaultDaily: false,
            ...input,
          }),
        },
      );
      return res.template;
    },

    async update(templateId, input) {
      const res = await transport.requestJson<{ readonly template: DocumentTemplate }>(
        `/api/v1/templates/${encodeURIComponent(templateId)}`,
        {
          method: "PATCH",
          body: JSON.stringify(input),
        },
      );
      return res.template;
    },

    async delete(templateId) {
      await transport.requestJson<{ readonly deleted: boolean }>(
        `/api/v1/templates/${encodeURIComponent(templateId)}`,
        { method: "DELETE" },
      );
    },

    apply(templateId, input = {}) {
      return transport.requestJson<ApplyTemplateResponse>(
        `/api/v1/templates/${encodeURIComponent(templateId)}/apply`,
        {
          method: "POST",
          body: JSON.stringify(input),
        },
      );
    },
  };
}

export function createShareLinksResource(transport: InkadeHttpTransport): ShareLinksResource {
  return {
    async list(documentId) {
      const query = buildQuery({ documentId });
      const res = await transport.requestJson<{ readonly shareLinks: readonly ShareLink[] }>(
        `/api/v1/share-links${query}`,
      );
      return res.shareLinks;
    },

    async create(input) {
      const res = await transport.requestJson<{ readonly shareLink: ShareLink }>(
        "/api/v1/share-links",
        {
          method: "POST",
          body: JSON.stringify(input),
        },
      );
      return res.shareLink;
    },

    async revoke(shareLinkId) {
      const res = await transport.requestJson<{ readonly shareLink: ShareLink }>(
        `/api/v1/share-links/${encodeURIComponent(shareLinkId)}`,
        { method: "DELETE" },
      );
      return res.shareLink;
    },

    getPublic(token) {
      return transport.requestJson<PublicSharedDocument>(
        `/api/v1/public/shares/${encodeURIComponent(token)}`,
      );
    },
  };
}

export interface ViewsResource {
  query(input: ViewQueryRequestInput): Promise<ViewQueryResponse>;
}

export function createViewsResource(transport: InkadeHttpTransport): ViewsResource {
  return {
    query(input) {
      return transport.requestJson<ViewQueryResponse>("/api/v1/views/query", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
  };
}

export function createSavedViewsResource(transport: InkadeHttpTransport): SavedViewsResource {
  return {
    async list() {
      const res = await transport.requestJson<{ readonly savedViews: readonly SavedView[] }>(
        "/api/v1/saved-views",
      );
      return res.savedViews;
    },

    async create(input) {
      const res = await transport.requestJson<{ readonly savedView: SavedView }>(
        "/api/v1/saved-views",
        {
          method: "POST",
          body: JSON.stringify({
            filter: {},
            sortOrder: 0,
            ...input,
          }),
        },
      );
      return res.savedView;
    },

    async update(viewId, input) {
      const res = await transport.requestJson<{ readonly savedView: SavedView }>(
        `/api/v1/saved-views/${encodeURIComponent(viewId)}`,
        {
          method: "PATCH",
          body: JSON.stringify(input),
        },
      );
      return res.savedView;
    },

    async delete(viewId) {
      await transport.requestJson<{ readonly deleted: boolean }>(
        `/api/v1/saved-views/${encodeURIComponent(viewId)}`,
        { method: "DELETE" },
      );
    },
  };
}
