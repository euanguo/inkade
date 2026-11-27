import type {
  ArtifactHtmlValidationResult,
  ArtifactSandboxTicket,
  CreateDocumentArtifactInput,
  DocumentArtifact,
  DocumentArtifactId,
  DocumentArtifactSummary,
  DocumentId,
  DocumentRecord,
  SandboxRuntimeConfigStatus,
  SendHighlightToAgentResult,
  SubmitArtifactCommentInput,
  UpdateDocumentArtifactInput,
  ValidateDocumentArtifactInput,
} from "@inkade/core";
import type { InkadeHttpTransport } from "../http-transport.ts";

export interface CreateDocumentArtifactResponse {
  readonly artifact: DocumentArtifact;
  readonly validation: ArtifactHtmlValidationResult;
  readonly fenceMarkdown: string;
  readonly document?: DocumentRecord | undefined;
}

export interface UpdateDocumentArtifactResponse {
  readonly artifact: DocumentArtifact;
  readonly validation: ArtifactHtmlValidationResult;
}

export interface DeleteDocumentArtifactResponse {
  readonly deleted: boolean;
  readonly id: DocumentArtifactId;
}

export interface ArtifactsResource {
  list(documentId: DocumentId): Promise<readonly DocumentArtifactSummary[]>;
  get(artifactId: DocumentArtifactId): Promise<DocumentArtifact>;
  create(
    documentId: DocumentId,
    input: CreateDocumentArtifactInput,
  ): Promise<CreateDocumentArtifactResponse>;
  update(
    artifactId: DocumentArtifactId,
    input: UpdateDocumentArtifactInput,
  ): Promise<UpdateDocumentArtifactResponse>;
  delete(artifactId: DocumentArtifactId): Promise<DeleteDocumentArtifactResponse>;
  validate(input: ValidateDocumentArtifactInput): Promise<ArtifactHtmlValidationResult>;
  getRuntimeConfig(): Promise<SandboxRuntimeConfigStatus>;
  issueSandboxTicket(artifactId: DocumentArtifactId): Promise<ArtifactSandboxTicket>;
  submitComment(
    artifactId: DocumentArtifactId,
    input: SubmitArtifactCommentInput,
  ): Promise<SendHighlightToAgentResult>;
}

export function createArtifactsResource(transport: InkadeHttpTransport): ArtifactsResource {
  return {
    async list(documentId) {
      const res = await transport.requestJson<{
        readonly artifacts: readonly DocumentArtifactSummary[];
      }>(`/api/v1/documents/${encodeURIComponent(documentId)}/artifacts`);
      return res.artifacts;
    },
    async get(artifactId) {
      const res = await transport.requestJson<{ readonly artifact: DocumentArtifact }>(
        `/api/v1/artifacts/${encodeURIComponent(artifactId)}`,
      );
      return res.artifact;
    },
    create(documentId, input) {
      return transport.requestJson<CreateDocumentArtifactResponse>(
        `/api/v1/documents/${encodeURIComponent(documentId)}/artifacts`,
        {
          method: "POST",
          body: JSON.stringify(input),
        },
      );
    },
    update(artifactId, input) {
      return transport.requestJson<UpdateDocumentArtifactResponse>(
        `/api/v1/artifacts/${encodeURIComponent(artifactId)}`,
        {
          method: "PATCH",
          body: JSON.stringify(input),
        },
      );
    },
    delete(artifactId) {
      return transport.requestJson<DeleteDocumentArtifactResponse>(
        `/api/v1/artifacts/${encodeURIComponent(artifactId)}`,
        {
          method: "DELETE",
        },
      );
    },
    validate(input) {
      return transport.requestJson<ArtifactHtmlValidationResult>("/api/v1/artifacts/validate", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    getRuntimeConfig() {
      return transport.requestJson<SandboxRuntimeConfigStatus>(
        "/api/v1/artifacts/runtime-config",
      );
    },
    issueSandboxTicket(artifactId) {
      return transport.requestJson<ArtifactSandboxTicket>(
        `/api/v1/artifacts/${encodeURIComponent(artifactId)}/sandbox-ticket`,
        {
          method: "POST",
        },
      );
    },
    submitComment(artifactId, input) {
      return transport.requestJson<SendHighlightToAgentResult>(
        `/api/v1/artifacts/${encodeURIComponent(artifactId)}/comments`,
        {
          method: "POST",
          body: JSON.stringify(input),
        },
      );
    },
  };
}
