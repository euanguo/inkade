import {
  formatLocalIsoDate,
  formatUtcIsoDate,
  parseIsoCalendarDate,
  type AdeThreadStatus,
  type DocumentRecord,
  type DocumentSummary,
  extractToc,
  type OutlineBatchOperation,
  type OutlineNode,
  type TocEntry,
} from "@inkade/core";
import type { InkadeLocale } from "@inkade/i18n";
import { getTodayDailyDate, shiftDailyDate } from "./dates.ts";

export type OutlineDeferTarget = "tomorrow" | "next_monday";

export interface WeekRibbonDay {
  readonly date: string;
  readonly dayOfMonth: number;
  readonly weekdayShort: string;
  readonly isToday: boolean;
  readonly isSelected: boolean;
}

export interface DocumentReadingStats {
  readonly wordCount: number;
  readonly charCount: number;
  readonly minutes: number;
}

const MS_PER_DAY = 86_400_000;

/**
 * Returns the 7 days (Monday through Sunday) of the ISO week containing `activeDate`.
 */
export function getIsoWeekDays(
  activeDate: string,
  todayDate: string = getTodayDailyDate(),
  locale: InkadeLocale = "zh-CN",
): readonly WeekRibbonDay[] {
  const parsed = parseIsoCalendarDate(activeDate) ?? parseIsoCalendarDate(todayDate) ?? new Date();
  const normalizedActive = parseIsoCalendarDate(activeDate) ? activeDate : formatUtcIsoDate(parsed);
  const utcDay = parsed.getUTCDay();
  const offsetFromMonday = (utcDay + 6) % 7;
  const mondayMs = parsed.getTime() - offsetFromMonday * MS_PER_DAY;
  const weekdayFormatter = new Intl.DateTimeFormat(locale, {
    weekday: "short",
    timeZone: "UTC",
  });

  const days: WeekRibbonDay[] = [];
  for (let i = 0; i < 7; i += 1) {
    const dt = new Date(mondayMs + i * MS_PER_DAY);
    const date = formatUtcIsoDate(dt);
    days.push({
      date,
      dayOfMonth: dt.getUTCDate(),
      weekdayShort: weekdayFormatter.format(dt),
      isToday: date === todayDate,
      isSelected: date === normalizedActive,
    });
  }
  return days;
}

/**
 * Computes the target YYYY-MM-DD date when deferring an outline node to tomorrow or next Monday.
 */
export function computeDeferTargetDate(baseDate: string, target: OutlineDeferTarget): string {
  const parsed = parseIsoCalendarDate(baseDate);
  const validBase = parsed ? baseDate : getTodayDailyDate();
  if (target === "tomorrow") {
    return shiftDailyDate(validBase, 1);
  }
  const effectiveDt = parsed ?? parseIsoCalendarDate(validBase) ?? new Date();
  const dayOfWeek = effectiveDt.getUTCDay();
  const daysUntilNextMonday = (8 - dayOfWeek) % 7 || 7;
  return shiftDailyDate(validBase, daysUntilNextMonday);
}

/**
 * Reads `properties.reviewedAt` from a daily document if set to a non-empty string.
 */
export function getDailyReviewedAt(
  doc: Pick<DocumentRecord, "properties"> | null | undefined,
): string | null {
  const props = doc?.properties;
  const raw = props?.["reviewedAt"];
  return typeof raw === "string" && raw.trim().length > 0 ? raw : null;
}

/**
 * Returns a new properties object updating `reviewedAt` while preserving all existing keys.
 */
export function withDailyReviewedAt(
  properties: Record<string, unknown> | null | undefined,
  reviewedAt: string | null,
): Record<string, unknown> {
  return {
    ...(properties ?? {}),
    reviewedAt,
  };
}

/**
 * Formats an ISO timestamp into the caller's local `YYYY-MM-DD` calendar date.
 */
export function toLocalDailyDate(isoTimestamp: string): string | null {
  const parsed = new Date(isoTimestamp);
  if (Number.isNaN(parsed.getTime())) return null;
  return formatLocalIsoDate(parsed);
}

/**
 * Filters workspace documents created on `targetDate` (local YYYY-MM-DD match),
 * excluding trashed documents and the daily outline document itself.
 */
export function filterDocumentsCreatedOnDate(
  docs: readonly DocumentSummary[],
  targetDate: string,
  excludeDocumentId?: string | null,
): readonly DocumentSummary[] {
  return docs
    .filter((doc) => {
      if (doc.trashedAt !== null) return false;
      if (excludeDocumentId && doc.id === excludeDocumentId) return false;
      if (doc.kind === "outline" && doc.dailyDate === targetDate) return false;
      return toLocalDailyDate(doc.createdAt) === targetDate;
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Extracts H1..maxDepth headings with duplicate leading title heading stripped.
 */
export function extractDocumentHeadings(
  markdown: string,
  docTitle?: string,
  maxDepth = 3,
): readonly TocEntry[] {
  const safeMarkdown = typeof markdown === "string" ? markdown : "";
  const entries = extractToc(safeMarkdown);
  const normalizedTitle = docTitle?.trim().toLowerCase() ?? "";
  const deduped =
    normalizedTitle &&
    entries.length > 0 &&
    entries[0]?.depth === 1 &&
    entries[0].text.trim().toLowerCase() === normalizedTitle
      ? entries.slice(1)
      : entries;
  return deduped.filter((entry) => entry.depth >= 1 && entry.depth <= maxDepth);
}

/**
 * Computes CJK-aware word count, non-whitespace character count, and estimated reading minutes.
 */
export function computeDocumentReadingStats(markdown: string): DocumentReadingStats {
  const safeMarkdown = typeof markdown === "string" ? markdown : "";
  const plain = safeMarkdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/[#>*_\-[\]()!|]/g, " ")
    .trim();
  if (!plain) {
    return { wordCount: 0, charCount: 0, minutes: 0 };
  }
  const cjkChars = (plain.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) ?? []).length;
  const nonCjk = plain.replace(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g, " ").trim();
  const latinWords = nonCjk ? nonCjk.split(/\s+/).filter(Boolean).length : 0;
  const wordCount = cjkChars + latinWords;
  const charCount = plain.replace(/\s+/g, "").length;
  return {
    wordCount,
    charCount,
    minutes: wordCount === 0 ? 0 : Math.max(1, Math.ceil(wordCount / 260)),
  };
}

/**
 * Returns true if an ADE thread binding is queued, running, waiting for input, or failed.
 */
export function isPendingAdeStatus(status: AdeThreadStatus): boolean {
  return (
    status === "queued" ||
    status === "running" ||
    status === "waiting_input" ||
    status === "failed"
  );
}

/**
 * Builds atomic `create` batch operations to clone an outline node and its active descendants
 * into another daily outline document while preserving text, notes, and task state.
 */
export function buildClonedSubtreeBatchOps(
  nodes: readonly OutlineNode[],
  rootNode: OutlineNode,
): readonly OutlineBatchOperation[] {
  const active = nodes.filter((n) => n.deletedAt === null);
  const childrenByParent = new Map<string | null, OutlineNode[]>();
  for (const node of active) {
    const list = childrenByParent.get(node.parentNodeId);
    if (list) list.push(node);
    else childrenByParent.set(node.parentNodeId, [node]);
  }
  for (const siblings of childrenByParent.values()) {
    siblings.sort((a, b) =>
      a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : a.id.localeCompare(b.id),
    );
  }

  const ops: OutlineBatchOperation[] = [];
  const visited = new Set<string>();
  let seq = 0;

  function visit(node: OutlineNode, parentTempId: string | null): void {
    if (visited.has(node.id)) return;
    visited.add(node.id);
    seq += 1;
    const tempId = `defer_${seq}`;
    ops.push({
      op: "create",
      tempId,
      parentNodeId: parentTempId,
      contentMarkdown: node.contentMarkdown,
      ...(node.noteMarkdown ? { noteMarkdown: node.noteMarkdown } : {}),
      checked: node.checked,
      collapsed: node.collapsed,
      authorType: node.authorType,
      ...(node.mirrorOfNodeId ? { mirrorOfNodeId: node.mirrorOfNodeId } : {}),
    });
    for (const child of childrenByParent.get(node.id) ?? []) {
      visit(child, tempId);
    }
  }

  visit(rootNode, null);
  return ops;
}
