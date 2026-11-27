import type {
  ArtifactCapabilities,
  ArtifactSourceMeta,
  AssetKind,
  AttachmentId,
  AttachmentRecord,
  DocumentArtifact,
  DocumentArtifactId,
  DocumentArtifactSummary,
  DocumentAsset,
  DocumentAssetId,
  DocumentId,
  PdfAnnotation,
  PdfExtractedPage,
} from "@inkade/core";

export interface ListAttachmentsOptions {
  readonly documentId?: DocumentId | undefined;
  readonly orphanOnly?: boolean | undefined;
}

export interface CreateAttachmentInput {
  readonly id?: AttachmentId | undefined;
  readonly documentId?: DocumentId | null | undefined;
  readonly mimeType: string;
  readonly byteSize: number;
  readonly sha256: string;
  readonly storageKey: string;
  readonly filename: string;
}

export interface CreateDocumentAssetInput {
  readonly id?: DocumentAssetId | undefined;
  readonly attachmentId: AttachmentId;
  readonly companionDocumentId?: DocumentId | null | undefined;
  readonly assetKind: AssetKind;
  readonly pageCount?: number | undefined;
  readonly annotations?: readonly PdfAnnotation[] | undefined;
  readonly extractedPages?: readonly PdfExtractedPage[] | undefined;
}

export interface UpdateDocumentAssetPatch {
  readonly companionDocumentId?: DocumentId | null | undefined;
  readonly pageCount?: number | undefined;
  readonly annotations?: readonly PdfAnnotation[] | undefined;
  readonly extractedPages?: readonly PdfExtractedPage[] | undefined;
}

export interface CreateDocumentArtifactRepoInput {
  readonly id?: DocumentArtifactId | undefined;
  readonly documentId: DocumentId;
  readonly title: string;
  readonly htmlSource: string;
  readonly capabilities: ArtifactCapabilities;
  readonly sources: readonly ArtifactSourceMeta[];
  readonly fallbackMarkdown: string;
  readonly heightPx: number;
  readonly sha256: string;
}

export interface UpdateDocumentArtifactRepoPatch {
  readonly title?: string | undefined;
  readonly htmlSource?: string | undefined;
  readonly capabilities?: ArtifactCapabilities | undefined;
  readonly sources?: readonly ArtifactSourceMeta[] | undefined;
  readonly fallbackMarkdown?: string | undefined;
  readonly heightPx?: number | undefined;
  readonly sha256?: string | undefined;
  readonly version?: number | undefined;
  readonly updatedAt?: string | undefined;
}

export interface AttachmentRepo {
  createAttachment(
    workspaceId: string,
    input: CreateAttachmentInput,
  ): Promise<AttachmentRecord>;
  getAttachmentById(
    workspaceId: string,
    attachmentId: string,
  ): Promise<AttachmentRecord | null>;
  listAttachments(
    workspaceId: string,
    options?: ListAttachmentsOptions,
  ): Promise<readonly AttachmentRecord[]>;
  listAttachmentsByDocument(
    workspaceId: string,
    documentId: string,
  ): Promise<readonly AttachmentRecord[]>;
  deleteAttachment(workspaceId: string, attachmentId: string): Promise<void>;
  findOrphanAttachments(workspaceId: string): Promise<readonly AttachmentRecord[]>;

  createDocumentAsset(
    workspaceId: string,
    input: CreateDocumentAssetInput,
  ): Promise<DocumentAsset>;
  getDocumentAssetById(
    workspaceId: string,
    assetId: DocumentAssetId | string,
  ): Promise<DocumentAsset | null>;
  getDocumentAssetByDocumentId(
    workspaceId: string,
    documentId: DocumentId | string,
  ): Promise<DocumentAsset | null>;
  getDocumentAssetByAttachmentId(
    workspaceId: string,
    attachmentId: AttachmentId | string,
  ): Promise<DocumentAsset | null>;
  listDocumentAssets(
    workspaceId: string,
    options?: { readonly assetKind?: AssetKind | undefined },
  ): Promise<readonly DocumentAsset[]>;
  updateDocumentAsset(
    workspaceId: string,
    assetId: DocumentAssetId | string,
    patch: UpdateDocumentAssetPatch,
  ): Promise<DocumentAsset>;
  deleteDocumentAsset(
    workspaceId: string,
    assetId: DocumentAssetId | string,
  ): Promise<void>;

  createDocumentArtifact(
    workspaceId: string,
    input: CreateDocumentArtifactRepoInput,
  ): Promise<DocumentArtifact>;
  getDocumentArtifactById(
    workspaceId: string,
    artifactId: DocumentArtifactId | string,
    options?: { readonly includeDeleted?: boolean | undefined },
  ): Promise<DocumentArtifact | null>;
  listDocumentArtifactsByDocument(
    workspaceId: string,
    documentId: DocumentId | string,
    options?: { readonly includeDeleted?: boolean | undefined },
  ): Promise<readonly DocumentArtifactSummary[]>;
  updateDocumentArtifact(
    workspaceId: string,
    artifactId: DocumentArtifactId | string,
    patch: UpdateDocumentArtifactRepoPatch,
  ): Promise<DocumentArtifact>;
  softDeleteDocumentArtifact(
    workspaceId: string,
    artifactId: DocumentArtifactId | string,
  ): Promise<DocumentArtifact>;
}
