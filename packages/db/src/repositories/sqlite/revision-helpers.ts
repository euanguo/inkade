import { and, asc, eq, isNull } from "drizzle-orm";
import {
  createId,
  ID_PREFIXES,
  InkadeError,
  renderOutlineNodesToMarkdown,
  type ActorType,
  type AuditBatchId,
  type ExecutionMode,
  type OutlineNode,
} from "@inkade/core";
import type { InkadeSqliteDb } from "../../client.ts";
import { documentRevisions, documents, outlineNodes } from "../../schema/sqlite.ts";
import { mapOutlineNodeRow } from "./mappers.ts";

export function loadActiveOutlineNodesSync(
  db: InkadeSqliteDb,
  documentId: string,
): OutlineNode[] {
  return db
    .select()
    .from(outlineNodes)
    .where(and(eq(outlineNodes.documentId, documentId), isNull(outlineNodes.deletedAt)))
    .orderBy(asc(outlineNodes.orderKey), asc(outlineNodes.id))
    .all()
    .map(mapOutlineNodeRow);
}

export function ensureOutlineBaselineRevisionSync(
  db: InkadeSqliteDb,
  doc: { readonly id: string; readonly version: number; readonly createdAt: string },
  ts: string,
): void {
  const existing = db
    .select()
    .from(documentRevisions)
    .where(
      and(eq(documentRevisions.documentId, doc.id), eq(documentRevisions.version, doc.version)),
    )
    .get();

  const activeNodes = loadActiveOutlineNodesSync(db, doc.id);
  const md = renderOutlineNodesToMarkdown(activeNodes);
  const snapshotJson = JSON.stringify(activeNodes);

  if (!existing) {
    db.insert(documentRevisions)
      .values({
        id: createId(ID_PREFIXES.revision),
        documentId: doc.id,
        version: doc.version,
        contentMarkdown: md,
        outlineSnapshotJson: snapshotJson,
        changeSummary: "Baseline outline snapshot",
        actorType: "system",
        actorId: null,
        batchId: null,
        executionMode: "autonomous",
        reversedByAuditId: null,
        createdAt: doc.createdAt || ts,
      })
      .run();
    return;
  }

  if (existing.outlineSnapshotJson === null) {
    db.update(documentRevisions)
      .set({ contentMarkdown: md, outlineSnapshotJson: snapshotJson })
      .where(eq(documentRevisions.id, existing.id))
      .run();
  }
}

export function recordOutlinePostMutationRevisionSync(
  db: InkadeSqliteDb,
  params: {
    readonly documentId: string;
    readonly currentVersion: number;
    readonly actorType: ActorType;
    readonly actorId: string | null;
    readonly changeSummary: string;
    readonly batchId?: AuditBatchId | null | undefined;
    readonly executionMode?: ExecutionMode | undefined;
    readonly ts: string;
    readonly updateLastEditedBy?: boolean | undefined;
  },
): typeof documentRevisions.$inferSelect {
  const activeNodes = loadActiveOutlineNodesSync(db, params.documentId);
  const md = renderOutlineNodesToMarkdown(activeNodes);
  const snapshotJson = JSON.stringify(activeNodes);
  const nextVersion = params.currentVersion + 1;

  db.update(documents)
    .set({
      version: nextVersion,
      updatedAt: params.ts,
      ...(params.updateLastEditedBy !== false ? { lastEditedByType: params.actorType } : {}),
    })
    .where(eq(documents.id, params.documentId))
    .run();

  const revId = createId(ID_PREFIXES.revision);
  const row: typeof documentRevisions.$inferInsert = {
    id: revId,
    documentId: params.documentId,
    version: nextVersion,
    contentMarkdown: md,
    outlineSnapshotJson: snapshotJson,
    changeSummary: params.changeSummary,
    actorType: params.actorType,
    actorId: params.actorId,
    batchId: params.batchId ?? null,
    executionMode: params.executionMode ?? "autonomous",
    reversedByAuditId: null,
    createdAt: params.ts,
  };
  db.insert(documentRevisions).values(row).run();

  const inserted = db
    .select()
    .from(documentRevisions)
    .where(eq(documentRevisions.id, revId))
    .get();
  if (!inserted) {
    throw new InkadeError("INTERNAL_ERROR", "Failed to read newly created outline revision");
  }
  return inserted;
}
