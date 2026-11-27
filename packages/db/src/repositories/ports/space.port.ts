import type {
  CreatePublicSiteInput,
  CreateSpaceInput,
  DocumentId,
  PropertyFieldDefinition,
  PublicSite,
  PublicSiteId,
  ShareLink,
  ShareLinkId,
  Space,
  SpacePropertySchema,
  TemplateId,
  UpdatePublicSiteInput,
  UpdateSpaceInput,
} from "@inkade/core";

export interface ListSpacesOptions {
  readonly includeArchived?: boolean | undefined;
}

export interface CreateShareLinkRecordInput {
  readonly documentId: DocumentId;
  readonly token: string;
  readonly expiresAt?: string | null | undefined;
}

export interface UpsertSpacePropertySchemaRecordInput {
  readonly spaceId?: string | null | undefined;
  readonly templateId?: TemplateId | string | null | undefined;
  readonly fields: readonly PropertyFieldDefinition[];
}

export interface CreatePublicSiteRecordInput extends CreatePublicSiteInput {
  readonly slug: string;
}

export interface SpaceRepo {
  listSpaces(workspaceId: string, options?: ListSpacesOptions): Promise<readonly Space[]>;
  getSpaceById(workspaceId: string, spaceId: string): Promise<Space | null>;
  getSpaceBySlug(workspaceId: string, slug: string): Promise<Space | null>;
  createSpace(
    workspaceId: string,
    input: CreateSpaceInput,
    options?: { readonly id?: string | undefined },
  ): Promise<Space>;
  updateSpace(workspaceId: string, spaceId: string, input: UpdateSpaceInput): Promise<Space>;
  archiveSpace(workspaceId: string, spaceId: string): Promise<Space>;
  deleteSpaceIfEmpty(workspaceId: string, spaceId: string): Promise<boolean>;

  listShareLinks(workspaceId: string, documentId?: string): Promise<readonly ShareLink[]>;
  listActiveShareLinksByWorkspace(workspaceId: string): Promise<readonly ShareLink[]>;
  getShareLinkById(
    workspaceId: string,
    shareLinkId: ShareLinkId | string,
  ): Promise<ShareLink | null>;
  getShareLinkByToken(token: string): Promise<ShareLink | null>;
  createShareLink(
    workspaceId: string,
    input: CreateShareLinkRecordInput,
    options?: { readonly id?: string | undefined },
  ): Promise<ShareLink>;
  revokeShareLink(
    workspaceId: string,
    shareLinkId: ShareLinkId | string,
  ): Promise<ShareLink>;

  listSpacePropertySchemas(workspaceId: string): Promise<readonly SpacePropertySchema[]>;
  getSpacePropertySchema(
    workspaceId: string,
    target: {
      readonly spaceId?: string | null | undefined;
      readonly templateId?: TemplateId | string | null | undefined;
    },
  ): Promise<SpacePropertySchema | null>;
  upsertSpacePropertySchema(
    workspaceId: string,
    input: UpsertSpacePropertySchemaRecordInput,
    options?: { readonly id?: string | undefined },
  ): Promise<SpacePropertySchema>;

  listPublicSites(workspaceId: string): Promise<readonly PublicSite[]>;
  getPublicSiteById(
    workspaceId: string,
    siteId: PublicSiteId | string,
  ): Promise<PublicSite | null>;
  getPublicSiteBySlug(slug: string): Promise<PublicSite | null>;
  createPublicSite(
    workspaceId: string,
    input: CreatePublicSiteRecordInput,
    options?: { readonly id?: string | undefined },
  ): Promise<PublicSite>;
  updatePublicSite(
    workspaceId: string,
    siteId: PublicSiteId | string,
    input: UpdatePublicSiteInput,
  ): Promise<PublicSite>;
  deletePublicSite(workspaceId: string, siteId: PublicSiteId | string): Promise<void>;
}
