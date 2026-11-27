import type {
  CreateDocumentTemplateInput,
  CreateSavedViewInput,
  DocumentKind,
  DocumentTemplate,
  SavedView,
  SavedViewId,
  TemplateId,
  UpdateDocumentTemplateInput,
  UpdateSavedViewInput,
  UserId,
  Workspace,
  WorkspaceId,
} from "@inkade/core";

export interface CreateWorkspaceInput {
  readonly id?: WorkspaceId | undefined;
  readonly slug: string;
  readonly name: string;
  readonly ownerUserId: UserId | string;
}

export interface WorkspaceRepo {
  getWorkspaceById(workspaceId: string): Promise<Workspace | null>;
  getWorkspaceBySlug(slug: string): Promise<Workspace | null>;
  ensureWorkspace(input: CreateWorkspaceInput): Promise<Workspace>;
  hasRegisteredUsers(): Promise<boolean>;
  claimWorkspaceOwnerIfUnset(workspaceId: string, ownerUserId: UserId | string): Promise<Workspace>;

  listDocumentTemplates(
    workspaceId: string,
    kind?: DocumentKind,
  ): Promise<readonly DocumentTemplate[]>;
  getDocumentTemplateById(
    workspaceId: string,
    templateId: TemplateId | string,
  ): Promise<DocumentTemplate | null>;
  getDefaultDailyTemplate(workspaceId: string): Promise<DocumentTemplate | null>;
  createDocumentTemplate(
    workspaceId: string,
    input: CreateDocumentTemplateInput,
    options?: { readonly id?: string | undefined },
  ): Promise<DocumentTemplate>;
  updateDocumentTemplate(
    workspaceId: string,
    templateId: TemplateId | string,
    input: UpdateDocumentTemplateInput,
  ): Promise<DocumentTemplate>;
  deleteDocumentTemplate(workspaceId: string, templateId: TemplateId | string): Promise<void>;

  listSavedViews(workspaceId: string): Promise<readonly SavedView[]>;
  getSavedViewById(
    workspaceId: string,
    viewId: SavedViewId | string,
  ): Promise<SavedView | null>;
  createSavedView(
    workspaceId: string,
    input: CreateSavedViewInput,
    options?: { readonly id?: string | undefined },
  ): Promise<SavedView>;
  updateSavedView(
    workspaceId: string,
    viewId: SavedViewId | string,
    input: UpdateSavedViewInput,
  ): Promise<SavedView>;
  deleteSavedView(workspaceId: string, viewId: SavedViewId | string): Promise<void>;
}
