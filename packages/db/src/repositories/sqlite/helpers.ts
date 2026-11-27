import type { Database } from "bun:sqlite";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  createId,
  extractWikilinks,
  ID_PREFIXES,
  slugifyTitle,
  tokenizeForSearch,
} from "@inkade/core";
import type { InkadeSqliteDb } from "../../client.ts";
import { documentLinks, documentTags } from "../../schema/sqlite.ts";
import type { SqliteTransactionRunner } from "./transaction.ts";

export interface SqliteRepoContext {
  readonly sqlite: Database;
  readonly db: InkadeSqliteDb;
  readonly tx: SqliteTransactionRunner;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function syncToPromise<T>(fn: () => T): Promise<T> {
  try {
    return Promise.resolve(fn());
  } catch (err) {
    return Promise.reject(err instanceof Error ? err : new Error(String(err)));
  }
}

export function loadTagsForDocumentsSync(
  db: InkadeSqliteDb,
  docIds: readonly string[],
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  if (docIds.length === 0) return map;

  const rows = db
    .select()
    .from(documentTags)
    .where(inArray(documentTags.documentId, [...docIds]))
    .all();

  for (const row of rows) {
    const list = map.get(row.documentId);
    if (list) list.push(row.tag);
    else map.set(row.documentId, [row.tag]);
  }
  return map;
}

export function replaceDocumentTagsSync(
  db: InkadeSqliteDb,
  documentId: string,
  tags: readonly string[],
): string[] {
  const uniqueTags = [...new Set(tags.map((t) => t.trim()).filter((t) => t.length > 0))];
  db.delete(documentTags).where(eq(documentTags.documentId, documentId)).run();
  if (uniqueTags.length > 0) {
    db.insert(documentTags)
      .values(uniqueTags.map((tag) => ({ documentId, tag })))
      .run();
  }
  return uniqueTags;
}

export function addDocumentTagsSync(
  sqlite: Database,
  db: InkadeSqliteDb,
  documentId: string,
  extraTags: readonly string[],
): string[] {
  const uniqueNew = [...new Set(extraTags.map((t) => t.trim()).filter((t) => t.length > 0))];
  for (const tag of uniqueNew) {
    sqlite
      .query("INSERT OR IGNORE INTO document_tags (document_id, tag) VALUES (?, ?)")
      .run(documentId, tag);
  }
  return loadTagsForDocumentsSync(db, [documentId]).get(documentId) ?? [];
}

export function upsertFtsEntrySync(
  sqlite: Database,
  params: {
    readonly entityKey: string;
    readonly workspaceId: string;
    readonly entityType: "document" | "outline_node";
    readonly documentId: string;
    readonly nodeId: string | null;
    readonly spaceId: string;
    readonly kind: string;
    readonly title: string;
    readonly body: string;
  },
): void {
  const tokens = tokenizeForSearch(`${params.title} ${params.body}`);
  sqlite.query("DELETE FROM search_fts WHERE entity_key = ?").run(params.entityKey);
  sqlite
    .query(
      `INSERT INTO search_fts (
        entity_key, workspace_id, entity_type, document_id, node_id, space_id, kind, title, body, tokens
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      params.entityKey,
      params.workspaceId,
      params.entityType,
      params.documentId,
      params.nodeId,
      params.spaceId,
      params.kind,
      params.title,
      params.body,
      tokens,
    );
}

export function deleteDocumentFtsSync(sqlite: Database, documentId: string): void {
  sqlite.query("DELETE FROM search_fts WHERE document_id = ?").run(documentId);
}

export function resolveTargetDocIdSync(
  sqlite: Database,
  workspaceId: string,
  targetSlugOrTitle: string,
): string | null {
  const normalized = targetSlugOrTitle.trim().toLowerCase();
  if (!normalized) return null;

  const bySlug = sqlite
    .query<{ id: string }, [string, string]>(
      `SELECT id FROM documents
       WHERE workspace_id = ? AND trashed_at IS NULL AND lower(slug) = ?
       ORDER BY updated_at DESC LIMIT 1`,
    )
    .get(workspaceId, normalized);
  if (bySlug) return bySlug.id;

  const byTitle = sqlite
    .query<{ id: string }, [string, string]>(
      `SELECT id FROM documents
       WHERE workspace_id = ? AND trashed_at IS NULL AND lower(title) = ?
       ORDER BY updated_at DESC LIMIT 1`,
    )
    .get(workspaceId, normalized);
  return byTitle?.id ?? null;
}

export function syncOutgoingLinksSync(
  sqlite: Database,
  db: InkadeSqliteDb,
  workspaceId: string,
  sourceDocumentId: string,
  sourceNodeId: string | null,
  markdown: string,
): void {
  if (sourceNodeId === null) {
    db.delete(documentLinks)
      .where(
        and(eq(documentLinks.sourceDocumentId, sourceDocumentId), isNull(documentLinks.sourceNodeId)),
      )
      .run();
  } else {
    db.delete(documentLinks)
      .where(
        and(eq(documentLinks.sourceDocumentId, sourceDocumentId), eq(documentLinks.sourceNodeId, sourceNodeId)),
      )
      .run();
  }

  const extracted = extractWikilinks(markdown);
  if (extracted.length === 0) return;

  const ts = nowIso();
  const values = extracted.map((link) => ({
    id: createId(ID_PREFIXES.link),
    workspaceId,
    sourceDocumentId,
    sourceNodeId,
    targetDocumentId: resolveTargetDocIdSync(sqlite, workspaceId, link.targetSlugOrTitle),
    targetSlugOrTitle: link.targetSlugOrTitle,
    anchorText: link.anchorText,
    contextSnippet: link.contextSnippet,
    createdAt: ts,
  }));
  db.insert(documentLinks).values(values).run();
}

export function resolvePendingIncomingLinksSync(
  sqlite: Database,
  workspaceId: string,
  targetDoc: { readonly id: string; readonly slug: string; readonly title: string },
): void {
  sqlite
    .query(
      `UPDATE document_links
       SET target_document_id = ?
       WHERE workspace_id = ?
         AND target_document_id IS NULL
         AND (lower(target_slug_or_title) = ? OR lower(target_slug_or_title) = ?)`,
    )
    .run(targetDoc.id, workspaceId, targetDoc.slug.toLowerCase(), targetDoc.title.toLowerCase());
}

export function computeUniqueDocumentSlugSync(
  sqlite: Database,
  workspaceId: string,
  requestedSlugOrTitle: string,
  excludeDocumentId?: string,
): string {
  const base = slugifyTitle(requestedSlugOrTitle);
  let candidate = base;
  let suffix = 2;

  while (true) {
    const existing = sqlite
      .query<{ id: string }, [string, string]>(
        "SELECT id FROM documents WHERE workspace_id = ? AND slug = ? LIMIT 1",
      )
      .get(workspaceId, candidate);
    if (!existing || existing.id === excludeDocumentId) return candidate;
    candidate = `${base}-${suffix}`;
    suffix++;
  }
}
