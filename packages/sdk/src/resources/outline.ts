import type {
  BatchOutlineNodesRequestInput,
  BatchOutlineNodesResult,
  CreateMirrorNodeInput,
  CreateOutlineNodeInput,
  DocumentId,
  DocumentKind,
  DocumentRecord,
  MoveOutlineNodeInput,
  OutlineNode,
  OutlineNodeId,
  SpaceId,
  UpdateOutlineNodeInput,
} from "@inkade/core";
import { buildQuery, type InkadeHttpTransport } from "../http-transport.ts";

export interface PromoteOutlineNodeInput {
  readonly documentId?: DocumentId | undefined;
  readonly targetSpaceId: SpaceId;
  readonly title?: string | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly keepLinkInNode?: boolean | undefined;
}

export interface PromoteOutlineNodeResponse {
  readonly article: DocumentRecord;
  readonly updatedNode: OutlineNode | null;
}

export interface CreateMirrorNodeResponse {
  readonly node: OutlineNode;
  readonly canonicalSourceNodeId: OutlineNodeId;
  readonly sourceDocumentId: DocumentId;
}

export interface WorkspaceOutlineNodeMatchDto {
  readonly node: OutlineNode;
  readonly documentId: DocumentId;
  readonly documentTitle: string;
  readonly spaceId: SpaceId;
  readonly documentKind: DocumentKind;
}

export interface OutlineNodesResource {
  list(documentId: DocumentId): Promise<readonly OutlineNode[]>;
  search(query: string, limit?: number): Promise<readonly WorkspaceOutlineNodeMatchDto[]>;
  batch(input: BatchOutlineNodesRequestInput): Promise<BatchOutlineNodesResult>;
  create(input: CreateOutlineNodeInput): Promise<OutlineNode>;
  update(nodeId: OutlineNodeId, input: UpdateOutlineNodeInput): Promise<OutlineNode>;
  delete(nodeId: OutlineNodeId): Promise<readonly OutlineNode[]>;
  move(nodeId: OutlineNodeId, input: MoveOutlineNodeInput): Promise<OutlineNode>;
  rollover(fromDocumentId: DocumentId, toDocumentId: DocumentId): Promise<readonly OutlineNode[]>;
  promote(nodeId: OutlineNodeId, input: PromoteOutlineNodeInput): Promise<PromoteOutlineNodeResponse>;
  mirror(nodeId: OutlineNodeId, input: CreateMirrorNodeInput): Promise<CreateMirrorNodeResponse>;
}

export function createOutlineNodesResource(transport: InkadeHttpTransport): OutlineNodesResource {
  return {
    async list(documentId) {
      const res = await transport.requestJson<{ readonly nodes: readonly OutlineNode[] }>(
        `/api/v1/documents/${encodeURIComponent(documentId)}/nodes`,
      );
      return res.nodes;
    },

    async search(query, limit) {
      const res = await transport.requestJson<{
        readonly matches: readonly WorkspaceOutlineNodeMatchDto[];
      }>(`/api/v1/outline-nodes/search${buildQuery({ q: query, limit })}`);
      return res.matches;
    },

    batch(input) {
      return transport.requestJson<BatchOutlineNodesResult>("/api/v1/outline-nodes/batch", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },

    async create(input) {
      const res = await transport.requestJson<{ readonly node: OutlineNode }>(
        "/api/v1/outline-nodes",
        {
          method: "POST",
          body: JSON.stringify({
            parentNodeId: null,
            checked: null,
            collapsed: false,
            authorType: "human",
            ...input,
          }),
        },
      );
      return res.node;
    },

    async update(nodeId, input) {
      const res = await transport.requestJson<{ readonly node: OutlineNode }>(
        `/api/v1/outline-nodes/${encodeURIComponent(nodeId)}`,
        {
          method: "PATCH",
          body: JSON.stringify(input),
        },
      );
      return res.node;
    },

    async delete(nodeId) {
      const res = await transport.requestJson<{ readonly deleted: readonly OutlineNode[] }>(
        `/api/v1/outline-nodes/${encodeURIComponent(nodeId)}`,
        { method: "DELETE" },
      );
      return res.deleted;
    },

    async move(nodeId, input) {
      const res = await transport.requestJson<{ readonly node: OutlineNode }>(
        `/api/v1/outline-nodes/${encodeURIComponent(nodeId)}/move`,
        {
          method: "POST",
          body: JSON.stringify(input),
        },
      );
      return res.node;
    },

    async rollover(fromDocumentId, toDocumentId) {
      const res = await transport.requestJson<{ readonly nodes: readonly OutlineNode[] }>(
        "/api/v1/outline-nodes/rollover",
        {
          method: "POST",
          body: JSON.stringify({ fromDocumentId, toDocumentId }),
        },
      );
      return res.nodes;
    },

    promote(nodeId, input) {
      return transport.requestJson<PromoteOutlineNodeResponse>(
        `/api/v1/outline-nodes/${encodeURIComponent(nodeId)}/promote`,
        {
          method: "POST",
          body: JSON.stringify(input),
        },
      );
    },

    mirror(nodeId, input) {
      return transport.requestJson<CreateMirrorNodeResponse>(
        `/api/v1/outline-nodes/${encodeURIComponent(nodeId)}/mirror`,
        {
          method: "POST",
          body: JSON.stringify(input),
        },
      );
    },
  };
}
