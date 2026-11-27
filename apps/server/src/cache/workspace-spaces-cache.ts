import type { Space, WorkspaceId } from "@inkade/core";
import type { SpaceRepo } from "@inkade/db";

/**
 * Per-workspace in-memory cache of spaces (including archived) used by scope guards and SSE fan-out.
 * Synchronously invalidated on any space mutation or space.* event.
 */
export class WorkspaceSpacesCache {
  private readonly cache = new Map<WorkspaceId, readonly Space[]>();

  constructor(private readonly spaceRepo: SpaceRepo) {}

  async getAll(workspaceId: WorkspaceId): Promise<readonly Space[]> {
    const hit = this.cache.get(workspaceId);
    if (hit !== undefined) {
      return hit;
    }
    const loaded = await this.spaceRepo.listSpaces(workspaceId, { includeArchived: true });
    this.cache.set(workspaceId, loaded);
    return loaded;
  }

  invalidate(workspaceId: WorkspaceId): void {
    this.cache.delete(workspaceId);
  }

  clear(): void {
    this.cache.clear();
  }
}
