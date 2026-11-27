import { and, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import {
  createId,
  ID_PREFIXES,
  InkadeError,
  type ActorType,
  type DocumentRecord,
  type ExecutionMode,
} from "@inkade/core";
import { documentRevisions, documents, spaces } from "../../schema/sqlite.ts";
import type { ListDocumentsOptions } from "../ports/document.port.ts";
import {
  resolvePendingIncomingLinksSync,
  syncOutgoingLinksSync,
  upsertFtsEntrySync,
  type SqliteRepoContext,
} from "./helpers.ts";
import { mapDocumentRow } from "./mappers.ts";
import { syncDocumentTasksForDocumentSync } from "./task-sync-helpers.ts";

export const DOCUMENT_SUMMARY_COLUMNS = {
  id: documents.id,
  workspaceId: documents.workspaceId,
  spaceId: documents.spaceId,
  kind: documents.kind,
  title: documents.title,
  slug: documents.slug,
  dailyDate: documents.dailyDate,
  excerpt: documents.excerpt,
  sourceUrl: documents.sourceUrl,
  sourceMetaJson: documents.sourceMetaJson,
  propertiesJson: documents.propertiesJson,
  version: documents.version,
  pinned: documents.pinned,
  unreadAgentUpdate: documents.unreadAgentUpdate,
  lastEditedByType: documents.lastEditedByType,
  trashedAt: documents.trashedAt,
  createdAt: documents.createdAt,
  updatedAt: documents.updatedAt,
} as const;

export function requireDocumentSync(
  ctx: SqliteRepoContext,
  workspaceId: string,
  documentId: string,
): typeof documents.$inferSelect {
  const row = ctx.db
    .select()
    .from(documents)
    .where(and(eq(documents.workspaceId, workspaceId), eq(documents.id, documentId)))
    .get();
  if (!row) {
    throw new InkadeError("NOT_FOUND", `Document "${documentId}" not found`);
  }
  return row;
}

export function requireSpaceSync(
  ctx: SqliteRepoContext,
  workspaceId: string,
  spaceId: string,
): void {
  const space = ctx.db
    .select({ id: spaces.id })
    .from(spaces)
    .where(and(eq(spaces.workspaceId, workspaceId), eq(spaces.id, spaceId)))
    .get();
  if (!space) {
    throw new InkadeError("NOT_FOUND", `Space "${spaceId}" not found`);
  }
}

export function buildDocumentListConditions(
  workspaceId: string,
  options?: ListDocumentsOptions,
): SQL[] | null {
  if (options?.spaceIds !== undefined && options.spaceIds.length === 0) return null;
  if (options?.allowedKinds !== undefined && options.allowedKinds.length === 0) return null;

  const conditions: SQL[] = [eq(documents.workspaceId, workspaceId)];
  if (!options?.includeTrashed) conditions.push(isNull(documents.trashedAt));
  if (!options?.includeSystem) {
    conditions.push(
      sql`(${documents.propertiesJson} IS NULL OR (json_extract(${documents.propertiesJson}, '$.systemRole') IS NULL AND coalesce(json_extract(${documents.propertiesJson}, '$.isSystemInternal'), 0) != 1))`,
    );
    conditions.push(sql`${documents.spaceId} != '_system'`);
    conditions.push(sql`${documents.spaceId} NOT LIKE 'spc\\_\\_system%' ESCAPE '\\'`);
  }
  if (options?.spaceId) conditions.push(eq(documents.spaceId, options.spaceId));
  if (options?.spaceIds && options.spaceIds.length > 0) {
    conditions.push(inArray(documents.spaceId, [...options.spaceIds]));
  }
  if (options?.kind) conditions.push(eq(documents.kind, options.kind));
  if (options?.allowedKinds && options.allowedKinds.length > 0) {
    conditions.push(inArray(documents.kind, [...options.allowedKinds]));
  }
  if (options?.pinnedOnly) conditions.push(eq(documents.pinned, true));
  if (options?.tag) {
    conditions.push(
      sql`EXISTS (SELECT 1 FROM document_tags dt WHERE dt.document_id = ${documents.id} AND dt.tag = ${options.tag})`,
    );
  }
  if (options?.tagAllowlist && options.tagAllowlist.length > 0) {
    const allowedList = sql.join(
      options.tagAllowlist.map((t) => sql`${t}`),
      sql`, `,
    );
    conditions.push(
      sql`EXISTS (SELECT 1 FROM document_tags dt WHERE dt.document_id = ${documents.id} AND dt.tag IN (${allowedList}))`,
    );
  }
  return conditions;
}

export function encodeOptionalJson(
  val: Record<string, unknown> | null | undefined,
  prev: string | null,
): string | null {
  if (val === undefined) return prev;
  return val ? JSON.stringify(val) : null;
}

export function restoreActiveOutlineNodesFtsSync(
  ctx: SqliteRepoContext,
  workspaceId: string,
  doc: typeof documents.$inferSelect,
): void {
  const activeNodes = ctx.sqlite
    .query<{ id: string; content_text: string; note_text: string }, [string]>(
      "SELECT id, content_text, note_text FROM outline_nodes WHERE document_id = ? AND deleted_at IS NULL",
    )
    .all(doc.id);
  for (const node of activeNodes) {
    upsertFtsEntrySync(ctx.sqlite, {
      entityKey: `nod:${node.id}`,
      workspaceId,
      entityType: "outline_node",
      documentId: doc.id,
      nodeId: node.id,
      spaceId: doc.spaceId,
      kind: doc.kind,
      title: doc.title,
      body: [node.content_text, node.note_text].filter((s) => s.length > 0).join(" "),
    });
  }
}

export function finalizeCreatedDocumentSync(
  ctx: SqliteRepoContext,
  params: {
    readonly workspaceId: string;
    readonly row: typeof documents.$inferSelect;
    readonly tags: readonly string[];
    readonly changeSummary: string;
    readonly actorType: ActorType;
    readonly actorId: string | null;
    readonly outlineSnapshotJson: string | null;
    readonly batchId?: string | null | undefined;
    readonly executionMode?: ExecutionMode | undefined;
  },
): DocumentRecord {
  const { workspaceId, row } = params;
  ctx.db
    .insert(documentRevisions)
    .values({
      id: createId(ID_PREFIXES.revision),
      documentId: row.id,
      version: 1,
      contentMarkdown: row.contentMarkdown,
      outlineSnapshotJson: params.outlineSnapshotJson,
      changeSummary: params.changeSummary,
      actorType: params.actorType,
      actorId: params.actorId,
      batchId: params.batchId ?? null,
      executionMode: params.executionMode ?? "autonomous",
      reversedByAuditId: null,
      createdAt: row.createdAt,
    })
    .run();
  syncOutgoingLinksSync(ctx.sqlite, ctx.db, workspaceId, row.id, null, row.contentMarkdown);
  resolvePendingIncomingLinksSync(ctx.sqlite, workspaceId, {
    id: row.id,
    slug: row.slug,
    title: row.title,
  });
  upsertFtsEntrySync(ctx.sqlite, {
    entityKey: `doc:${row.id}`,
    workspaceId,
    entityType: "document",
    documentId: row.id,
    nodeId: null,
    spaceId: row.spaceId,
    kind: row.kind,
    title: row.title,
    body: row.contentText,
  });
  syncDocumentTasksForDocumentSync(ctx, workspaceId, row.id);
  return mapDocumentRow(row, params.tags);
}
