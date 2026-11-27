import {
  evaluateScopeAccess,
  InkadeError,
  type DocumentRecord,
  type SpaceId,
} from "@inkade/core";
import { DEFAULT_SPACE_IDS, type DocumentRepo, type SpaceRepo } from "@inkade/db";
import type { WorkspaceSpacesCache } from "../cache/workspace-spaces-cache.ts";
import type { SseHub } from "../realtime/sse-hub.ts";
import type { Principal } from "../types.ts";
import { assertScope, getAllWorkspaceSpaces } from "./scope-guard.ts";

export async function getOrCreateTasksInboxDocument(
  documentRepo: DocumentRepo,
  spaceLookup: SpaceRepo | WorkspaceSpacesCache,
  sseHub: SseHub,
  principal: Principal,
  requestedSpaceId?: SpaceId,
): Promise<DocumentRecord> {
  const allSpaces = await getAllWorkspaceSpaces(spaceLookup, principal.workspaceId);
  const activeSpaces = allSpaces.filter((s) => s.archivedAt === null);

  const outlineDocs = await documentRepo.listDocuments(principal.workspaceId, {
    ...(requestedSpaceId ? { spaceId: requestedSpaceId } : {}),
    kind: "outline",
    includeTrashed: false,
    includeSystem: true,
    limit: 500,
    offset: 0,
  });
  const existingInbox = outlineDocs.find(
    (d) =>
      d.properties?.systemRole === "tasks_inbox" &&
      evaluateScopeAccess(
        principal.scope,
        "append",
        { spaceId: d.spaceId, kind: d.kind, tags: d.tags },
        allSpaces,
      ).allowed,
  );
  if (existingInbox) {
    return existingInbox;
  }

  const candidateSpaces = requestedSpaceId
    ? activeSpaces.filter((s) => s.id === requestedSpaceId)
    : [
        ...activeSpaces.filter((s) => s.id === DEFAULT_SPACE_IDS.inbox),
        ...activeSpaces.filter((s) => s.id === DEFAULT_SPACE_IDS.daily),
        ...activeSpaces,
      ];
  const targetSpace = candidateSpaces.find(
    (s) =>
      evaluateScopeAccess(
        principal.scope,
        "append",
        { spaceId: s.id, kind: "outline", tags: [] },
        allSpaces,
      ).allowed,
  );
  if (!targetSpace) {
    throw new InkadeError("FORBIDDEN", "No writable space available for tasks inbox");
  }

  assertScope(
    principal.scope,
    "append",
    { spaceId: targetSpace.id, kind: "outline", tags: [] },
    allSpaces,
  );

  const created = await documentRepo.createDocument(
    principal.workspaceId,
    {
      spaceId: targetSpace.id,
      kind: "outline",
      title: "Tasks Inbox",
      contentMarkdown: "",
      tags: [],
      pinned: false,
      properties: { systemRole: "tasks_inbox" },
    },
    {
      actorType: principal.actorType,
      actorId: principal.actorId,
    },
  );

  sseHub.publish({
    type: "document.created",
    workspaceId: principal.workspaceId,
    spaceId: created.spaceId,
    documentId: created.id,
    documentKind: created.kind,
    tags: created.tags,
    actorType: principal.actorType,
    payload: { document: created },
  });

  return created;
}
