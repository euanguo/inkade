import { and, asc, eq, inArray, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import {
  createId,
  extractMarkdownTasks,
  ID_PREFIXES,
  jsonRecordSchema,
  markdownToPlainText,
  parseJsonWithSchema,
  type DocumentKind,
  type DocumentTaskRecord,
} from "@inkade/core";
import { documents, documentTasks, outlineNodes } from "../../schema/sqlite.ts";
import type {
  IndexedDocumentTaskRow,
  ListDocumentTasksFilter,
} from "../ports/outline.port.ts";
import { loadTagsForDocumentsSync, type SqliteRepoContext } from "./helpers.ts";
import { mapDocumentTaskRow } from "./mappers.ts";

export function isDocRowIndexableForTasks(
  doc: Pick<typeof documents.$inferSelect, "spaceId" | "propertiesJson" | "trashedAt">,
): boolean {
  if (doc.trashedAt !== null) return false;
  const props = doc.propertiesJson
    ? parseJsonWithSchema(doc.propertiesJson, jsonRecordSchema.nullable(), null)
    : null;
  const systemRole = typeof props?.systemRole === "string" ? props.systemRole : null;
  const isSystemInternal = props?.isSystemInternal === true;
  if (systemRole === "tasks_inbox") return true;
  if (systemRole !== null || isSystemInternal) return false;
  if (doc.spaceId === "_system" || doc.spaceId.startsWith("spc__system")) return false;
  return true;
}

export function deleteDocumentTasksSync(ctx: SqliteRepoContext, documentId: string): void {
  ctx.db.delete(documentTasks).where(eq(documentTasks.docId, documentId)).run();
}

export function syncDocumentTasksForDocumentSync(
  ctx: SqliteRepoContext,
  workspaceId: string,
  documentId: string,
): DocumentTaskRecord[] {
  const doc = ctx.db
    .select()
    .from(documents)
    .where(and(eq(documents.workspaceId, workspaceId), eq(documents.id, documentId)))
    .get();

  if (!doc || !isDocRowIndexableForTasks(doc)) {
    deleteDocumentTasksSync(ctx, documentId);
    return [];
  }

  const tags = loadTagsForDocumentsSync(ctx.db, [doc.id]).get(doc.id) ?? [];
  const tagsJson = JSON.stringify(tags);

  if (doc.kind === "outline") {
    const taskNodes = ctx.db
      .select()
      .from(outlineNodes)
      .where(
        and(
          eq(outlineNodes.documentId, doc.id),
          isNull(outlineNodes.deletedAt),
          isNotNull(outlineNodes.checked),
        ),
      )
      .orderBy(asc(outlineNodes.orderKey), asc(outlineNodes.id))
      .all();

    const rows: (typeof documentTasks.$inferInsert)[] = taskNodes.map((node, index) => ({
      id: node.id,
      workspaceId,
      sourceEngine: "outline",
      docId: doc.id,
      blockKey: node.id,
      lineIndex: index,
      title: node.contentText || markdownToPlainText(node.contentMarkdown),
      completed: node.checked === true,
      priority: node.taskPriority,
      scheduledDate: node.taskScheduledDate,
      scheduledStartMin: node.taskScheduledStartMin,
      durationMin: node.taskDurationMin,
      dueDate: node.taskDueDate,
      recurrenceRule: node.taskRecurrenceRule,
      spaceId: doc.spaceId,
      tagsJson,
      updatedAt: node.updatedAt,
    }));

    deleteDocumentTasksSync(ctx, doc.id);
    if (rows.length > 0) {
      ctx.db.insert(documentTasks).values(rows).run();
    }
    return rows.map((r) => mapDocumentTaskRow(r as typeof documentTasks.$inferSelect));
  }

  const existingRows = ctx.db
    .select()
    .from(documentTasks)
    .where(eq(documentTasks.docId, doc.id))
    .all();
  const extracted = extractMarkdownTasks(doc.contentMarkdown);

  const usedExistingIds = new Set<string>();
  const existingByBlockKey = new Map(existingRows.map((r) => [r.blockKey, r]));
  const existingByLineIndex = new Map<number, typeof documentTasks.$inferSelect>();
  for (const r of existingRows) {
    if (r.lineIndex !== null && !existingByLineIndex.has(r.lineIndex)) {
      existingByLineIndex.set(r.lineIndex, r);
    }
  }

  const assignedIds: string[] = Array.from({ length: extracted.length }, () => "");
  for (let i = 0; i < extracted.length; i++) {
    const item = extracted[i]!;
    const exactMatch = existingByBlockKey.get(item.blockKey);
    if (exactMatch && !usedExistingIds.has(exactMatch.id)) {
      assignedIds[i] = exactMatch.id;
      usedExistingIds.add(exactMatch.id);
    }
  }
  for (let i = 0; i < extracted.length; i++) {
    if (assignedIds[i]) continue;
    const item = extracted[i]!;
    const lineMatch = existingByLineIndex.get(item.lineIndex);
    if (lineMatch && !usedExistingIds.has(lineMatch.id)) {
      assignedIds[i] = lineMatch.id;
      usedExistingIds.add(lineMatch.id);
    } else {
      assignedIds[i] = createId(ID_PREFIXES.documentTask);
    }
  }

  const mdRows: (typeof documentTasks.$inferInsert)[] = extracted.map((item, idx) => ({
    id: assignedIds[idx]!,
    workspaceId,
    sourceEngine: "markdown",
    docId: doc.id,
    blockKey: item.blockKey,
    lineIndex: item.lineIndex,
    title: item.title,
    completed: item.completed,
    priority: item.priority,
    scheduledDate: item.scheduledDate,
    scheduledStartMin: item.scheduledStartMin,
    durationMin: item.durationMin,
    dueDate: item.dueDate,
    recurrenceRule: item.recurrenceRule,
    spaceId: doc.spaceId,
    tagsJson,
    updatedAt: doc.updatedAt,
  }));

  deleteDocumentTasksSync(ctx, doc.id);
  if (mdRows.length > 0) {
    ctx.db.insert(documentTasks).values(mdRows).run();
  }
  return mdRows.map((r) => mapDocumentTaskRow(r as typeof documentTasks.$inferSelect));
}

export function listDocumentTasksSync(
  ctx: SqliteRepoContext,
  workspaceId: string,
  filter?: ListDocumentTasksFilter,
): IndexedDocumentTaskRow[] {
  if (filter?.spaceIds !== undefined && filter.spaceIds.length === 0) return [];
  if (filter?.allowedKinds !== undefined && filter.allowedKinds.length === 0) return [];

  const conds: SQL[] = [
    eq(documentTasks.workspaceId, workspaceId),
    isNull(documents.trashedAt),
    sql`(${documents.propertiesJson} IS NULL OR json_extract(${documents.propertiesJson}, '$.systemRole') = 'tasks_inbox' OR (json_extract(${documents.propertiesJson}, '$.systemRole') IS NULL AND coalesce(json_extract(${documents.propertiesJson}, '$.isSystemInternal'), 0) != 1))`,
    sql`(${documentTasks.spaceId} != '_system' OR json_extract(${documents.propertiesJson}, '$.systemRole') = 'tasks_inbox')`,
  ];

  if (filter?.status === "open") {
    conds.push(eq(documentTasks.completed, false));
  } else if (filter?.status === "completed") {
    conds.push(eq(documentTasks.completed, true));
  }
  if (filter?.sourceEngine) {
    conds.push(eq(documentTasks.sourceEngine, filter.sourceEngine));
  }
  if (filter?.spaceId) {
    conds.push(eq(documentTasks.spaceId, filter.spaceId));
  }
  if (filter?.spaceIds && filter.spaceIds.length > 0) {
    conds.push(inArray(documentTasks.spaceId, [...filter.spaceIds]));
  }
  if (filter?.allowedKinds && filter.allowedKinds.length > 0) {
    conds.push(inArray(documents.kind, [...filter.allowedKinds]));
  }
  if (filter?.priority) {
    conds.push(eq(documentTasks.priority, filter.priority));
  }
  if (filter?.scheduledDate) {
    conds.push(eq(documentTasks.scheduledDate, filter.scheduledDate));
  }
  if (filter?.dueDate) {
    conds.push(eq(documentTasks.dueDate, filter.dueDate));
  }
  if (filter?.includeAnytime === false) {
    conds.push(isNotNull(documentTasks.scheduledDate));
  }
  if (filter?.tag) {
    conds.push(
      sql`EXISTS (SELECT 1 FROM document_tags dt WHERE dt.document_id = ${documentTasks.docId} AND dt.tag = ${filter.tag})`,
    );
  }
  if (filter?.tagAllowlist && filter.tagAllowlist.length > 0) {
    const allowedList = sql.join(
      filter.tagAllowlist.map((t) => sql`${t}`),
      sql`, `,
    );
    conds.push(
      sql`EXISTS (SELECT 1 FROM document_tags dt WHERE dt.document_id = ${documentTasks.docId} AND dt.tag IN (${allowedList}))`,
    );
  }

  let query = ctx.db
    .select({
      task: documentTasks,
      documentTitle: documents.title,
      documentKind: documents.kind,
      documentDailyDate: documents.dailyDate,
    })
    .from(documentTasks)
    .innerJoin(documents, eq(documentTasks.docId, documents.id))
    .where(and(...conds))
    .orderBy(
      asc(documentTasks.completed),
      asc(documentTasks.scheduledDate),
      asc(documentTasks.scheduledStartMin),
      asc(documentTasks.lineIndex),
      asc(documentTasks.id),
    )
    .$dynamic();

  if (filter?.limit !== undefined) {
    query = query.limit(filter.limit).offset(filter.offset ?? 0);
  }

  const rows = query.all();
  return rows.map((row) => ({
    task: mapDocumentTaskRow(row.task),
    documentTitle: row.documentTitle,
    documentKind: row.documentKind as DocumentKind,
    documentDailyDate: row.documentDailyDate,
  }));
}

export function getDocumentTaskByIdSync(
  ctx: SqliteRepoContext,
  workspaceId: string,
  taskId: string,
): IndexedDocumentTaskRow | null {
  const row = ctx.db
    .select({
      task: documentTasks,
      documentTitle: documents.title,
      documentKind: documents.kind,
      documentDailyDate: documents.dailyDate,
    })
    .from(documentTasks)
    .innerJoin(documents, eq(documentTasks.docId, documents.id))
    .where(
      and(
        eq(documentTasks.workspaceId, workspaceId),
        eq(documentTasks.id, taskId),
        isNull(documents.trashedAt),
      ),
    )
    .get();
  if (!row) return null;
  return {
    task: mapDocumentTaskRow(row.task),
    documentTitle: row.documentTitle,
    documentKind: row.documentKind as DocumentKind,
    documentDailyDate: row.documentDailyDate,
  };
}
