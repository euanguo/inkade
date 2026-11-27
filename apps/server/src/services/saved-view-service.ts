import type {
  CreateSavedViewInput,
  SavedView,
  SavedViewId,
  UpdateSavedViewInput,
} from "@inkade/core";
import type { SpaceRepo, WorkspaceRepo } from "@inkade/db";
import type { WorkspaceSpacesCache } from "../cache/workspace-spaces-cache.ts";
import type { SseHub } from "../realtime/sse-hub.ts";
import type { Principal } from "../types.ts";
import { assertAdminPrincipal, getAllWorkspaceSpaces } from "./scope-guard.ts";

export class SavedViewService {
  constructor(
    private readonly workspaceRepo: WorkspaceRepo,
    private readonly spaceRepo: SpaceRepo,
    private readonly sseHub: SseHub,
    private readonly spacesCache?: WorkspaceSpacesCache,
  ) {}

  async listViews(principal: Principal): Promise<readonly SavedView[]> {
    return this.workspaceRepo.listSavedViews(principal.workspaceId);
  }

  async createView(principal: Principal, input: CreateSavedViewInput): Promise<SavedView> {
    const allSpaces = await getAllWorkspaceSpaces(
      this.spacesCache ?? this.spaceRepo,
      principal.workspaceId,
    );
    assertAdminPrincipal(principal, allSpaces);
    const view = await this.workspaceRepo.createSavedView(principal.workspaceId, input);
    this.sseHub.publish({
      type: "saved_view.created",
      workspaceId: principal.workspaceId,
      spaceId: null,
      actorType: principal.actorType,
      payload: { savedView: view },
    });
    return view;
  }

  async updateView(
    principal: Principal,
    viewId: SavedViewId,
    input: UpdateSavedViewInput,
  ): Promise<SavedView> {
    const allSpaces = await getAllWorkspaceSpaces(
      this.spacesCache ?? this.spaceRepo,
      principal.workspaceId,
    );
    assertAdminPrincipal(principal, allSpaces);
    const view = await this.workspaceRepo.updateSavedView(principal.workspaceId, viewId, input);
    this.sseHub.publish({
      type: "saved_view.updated",
      workspaceId: principal.workspaceId,
      spaceId: null,
      actorType: principal.actorType,
      payload: { savedView: view },
    });
    return view;
  }

  async deleteView(principal: Principal, viewId: SavedViewId): Promise<void> {
    const allSpaces = await getAllWorkspaceSpaces(
      this.spacesCache ?? this.spaceRepo,
      principal.workspaceId,
    );
    assertAdminPrincipal(principal, allSpaces);
    await this.workspaceRepo.deleteSavedView(principal.workspaceId, viewId);
    this.sseHub.publish({
      type: "saved_view.deleted",
      workspaceId: principal.workspaceId,
      spaceId: null,
      actorType: principal.actorType,
      payload: { viewId },
    });
  }
}
