import type { ListItem, Nodes, Root } from "mdast";
import { toString as mdastToString } from "mdast-util-to-string";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { parseIsoCalendarDate } from "./dates.ts";
import {
  formatScheduledStartMin,
  parseScheduledTimeHm,
  slotForScheduledStartMin,
  type TaskScheduleSlot,
} from "./schedule.ts";
import {
  isValidTaskRecurrenceRule,
  type TaskPriority,
  type TaskRecurrenceRule,
} from "./tasks.ts";

const taskAstParser = unified().use(remarkParse).use(remarkGfm);

export interface ExtractedMarkdownTask {
  readonly lineIndex: number;
  readonly blockKey: string;
  readonly completed: boolean;
  readonly title: string;
  readonly bodyMarkdown: string;
  readonly priority: TaskPriority | null;
  readonly scheduledDate: string | null;
  readonly scheduledStartMin: number | null;
  readonly scheduledSlot: TaskScheduleSlot | null;
  readonly durationMin: number | null;
  readonly dueDate: string | null;
  readonly recurrenceRule: TaskRecurrenceRule | null;
}

export interface MarkdownTaskSelector {
  readonly blockKey?: string | undefined;
  readonly lineIndex?: number | null | undefined;
  readonly title?: string | undefined;
}

export interface MarkdownTaskPatch {
  readonly title?: string | undefined;
  readonly completed?: boolean | undefined;
  readonly priority?: TaskPriority | null | undefined;
  readonly scheduledDate?: string | null | undefined;
  readonly scheduledStartMin?: number | null | undefined;
  readonly durationMin?: number | null | undefined;
  readonly dueDate?: string | null | undefined;
  readonly recurrenceRule?: TaskRecurrenceRule | null | undefined;
}

const TASK_LINE_PREFIX_REGEX = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\]\s*)(.*)$/;

function hashTitleHex(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= code + ((h1 >>> 16) & 0xff);
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  const part1 = (h1 >>> 0).toString(16).padStart(8, "0");
  const part2 = (h2 >>> 0).toString(16).padStart(8, "0");
  return `${part1}${part2}`.slice(0, 12);
}

/**
 * Replaces backtick-delimited inline code spans with equal-length spaces so
 * metadata regexes never parse literal code tokens.
 */
function maskInlineCode(rawRemainder: string): string {
  let out = "";
  let i = 0;
  while (i < rawRemainder.length) {
    if (rawRemainder[i] !== "`") {
      out += rawRemainder[i];
      i++;
      continue;
    }
    let tickCount = 0;
    while (i + tickCount < rawRemainder.length && rawRemainder[i + tickCount] === "`") {
      tickCount++;
    }
    const closer = "`".repeat(tickCount);
    const closeIdx = rawRemainder.indexOf(closer, i + tickCount);
    if (closeIdx === -1) {
      out += rawRemainder[i];
      i++;
      continue;
    }
    const totalLen = closeIdx + tickCount - i;
    out += " ".repeat(totalLen);
    i += totalLen;
  }
  return out;
}

interface RemovalSpan {
  readonly start: number;
  readonly end: number;
}

function removeSpans(raw: string, spans: readonly RemovalSpan[]): string {
  if (spans.length === 0) return raw.trim();
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  let cursor = 0;
  let result = "";
  for (const span of sorted) {
    if (span.start < cursor) continue;
    result += raw.slice(cursor, span.start);
    cursor = span.end;
  }
  result += raw.slice(cursor);
  return result.replace(/\s{2,}/g, " ").trim();
}

function stripInlineMarkdownForTitle(mdFragment: string): string {
  const tree = taskAstParser.parse(mdFragment);
  const plain = mdastToString(tree).replace(/\s+/g, " ").trim();
  return plain || mdFragment.trim();
}

function parseRemainderMetadata(rawRemainder: string): {
  readonly bodyMarkdown: string;
  readonly priority: TaskPriority | null;
  readonly scheduledDate: string | null;
  readonly scheduledStartMin: number | null;
  readonly scheduledSlot: TaskScheduleSlot | null;
  readonly durationMin: number | null;
  readonly dueDate: string | null;
  readonly recurrenceRule: TaskRecurrenceRule | null;
} {
  const masked = maskInlineCode(rawRemainder);
  const spans: RemovalSpan[] = [];

  let priority: TaskPriority | null = null;
  let scheduledDate: string | null = null;
  let scheduledStartMin: number | null = null;
  let durationMin: number | null = null;
  let dueDate: string | null = null;
  let recurrenceRule: TaskRecurrenceRule | null = null;

  const consumeFirst = (regex: RegExp, onMatch: (m: RegExpExecArray) => boolean): void => {
    const match = regex.exec(masked);
    if (!match) return;
    const accepted = onMatch(match);
    if (!accepted) return;
    spans.push({ start: match.index, end: match.index + match[0].length });
  };

  // Scheduled date: 📅YYYY-MM-DD
  consumeFirst(/(?:^|\s)📅(\d{4}-\d{2}-\d{2})(?=\s|$)/u, (m) => {
    if (!m[1] || !parseIsoCalendarDate(m[1])) return false;
    scheduledDate = m[1];
    return true;
  });

  // Time / range: ⏰HH:mm-HH:mm or ⏰HH:mm
  consumeFirst(
    /(?:^|\s)⏰([01]\d|2[0-3]):([0-5]\d)(?:-([01]\d|2[0-4]):([0-5]\d))?(?=\s|$)/u,
    (m) => {
      const startMin = parseScheduledTimeHm(`${m[1]}:${m[2]}`);
      if (startMin === null) return false;
      scheduledStartMin = startMin;
      if (m[3] && m[4]) {
        const endHh = Number(m[3]);
        const endMm = Number(m[4]);
        const endMin = endHh * 60 + endMm;
        if (endMin > startMin && endMin <= 1440) {
          durationMin = Math.min(1440, endMin - startMin);
        }
      }
      return true;
    },
  );

  // Explicit duration token: ~30m or ~1.5h
  if (durationMin === null) {
    consumeFirst(/(?:^|\s)~(\d+(?:\.\d+)?)(h|m)(?=\s|$)/i, (m) => {
      const num = Number(m[1]);
      if (!Number.isFinite(num) || num <= 0) return false;
      const mins = m[2]?.toLowerCase() === "h" ? Math.round(num * 60) : Math.round(num);
      if (mins < 1 || mins > 1440) return false;
      durationMin = mins;
      return true;
    });
  }

  // Deadline date: ⏳YYYY-MM-DD
  consumeFirst(/(?:^|\s)⏳(\d{4}-\d{2}-\d{2})(?=\s|$)/u, (m) => {
    if (!m[1] || !parseIsoCalendarDate(m[1])) return false;
    dueDate = m[1];
    return true;
  });

  // Priority: !p1..!p4 or !1..!4
  consumeFirst(/(?:^|\s)!p?([1-4])(?=\s|$)/i, (m) => {
    if (!m[1]) return false;
    priority = `p${m[1]}` as TaskPriority;
    return true;
  });

  // Recurrence: 🔁daily|weekdays|weekly|monthly|FREQ=...
  consumeFirst(/(?:^|\s)🔁([^\s]+)(?=\s|$)/u, (m) => {
    const rawRule = m[1]?.trim();
    if (!rawRule || !isValidTaskRecurrenceRule(rawRule)) return false;
    recurrenceRule = rawRule;
    return true;
  });

  const bodyMarkdown = removeSpans(rawRemainder, spans);
  const scheduledSlot =
    scheduledStartMin !== null ? slotForScheduledStartMin(scheduledStartMin) : null;

  return {
    bodyMarkdown,
    priority,
    scheduledDate,
    scheduledStartMin,
    scheduledSlot,
    durationMin,
    dueDate,
    recurrenceRule,
  };
}

function collectTaskListItems(tree: Root): ListItem[] {
  const items: ListItem[] = [];
  const visit = (node: Nodes): void => {
    if (node.type === "listItem" && typeof node.checked === "boolean") {
      items.push(node);
    }
    if ("children" in node && Array.isArray(node.children)) {
      for (const child of node.children) {
        visit(child);
      }
    }
  };
  visit(tree);
  return items;
}

function getOwnParagraphText(item: ListItem): string {
  const firstChild = item.children[0];
  if (firstChild && firstChild.type === "paragraph") {
    return mdastToString(firstChild).replace(/\s+/g, " ").trim();
  }
  return "";
}

/**
 * Extracts GFM `- [ ]` / `* [x]` task list items using the remark AST.
 * Code blocks (` ``` `) and inline code spans are safely ignored.
 */
export function extractMarkdownTasks(markdown: string): ExtractedMarkdownTask[] {
  if (!markdown.trim()) return [];
  const normalizedNewlines = markdown.replace(/\r\n/g, "\n");
  const lines = normalizedNewlines.split("\n");
  const tree = taskAstParser.parse(normalizedNewlines);
  const listItems = collectTaskListItems(tree);

  const occurrenceMap = new Map<string, number>();
  const results: ExtractedMarkdownTask[] = [];

  for (const item of listItems) {
    const startLine1Based = item.position?.start.line;
    if (!startLine1Based) continue;
    const lineIndex = startLine1Based - 1;
    const rawLine = lines[lineIndex];
    if (rawLine === undefined) continue;

    const lineMatch = TASK_LINE_PREFIX_REGEX.exec(rawLine);
    if (!lineMatch) continue;
    const rawRemainder = lineMatch[4] ?? "";
    const meta = parseRemainderMetadata(rawRemainder);
    const titleSource = meta.bodyMarkdown || getOwnParagraphText(item);
    const title = stripInlineMarkdownForTitle(titleSource);
    const normalizedKey = title.toLowerCase();
    const occ = occurrenceMap.get(normalizedKey) ?? 0;
    occurrenceMap.set(normalizedKey, occ + 1);
    const blockKey = `md_${hashTitleHex(normalizedKey)}_${occ}`;

    results.push({
      lineIndex,
      blockKey,
      completed: item.checked === true,
      title,
      bodyMarkdown: meta.bodyMarkdown || title,
      priority: meta.priority,
      scheduledDate: meta.scheduledDate,
      scheduledStartMin: meta.scheduledStartMin,
      scheduledSlot: meta.scheduledSlot,
      durationMin: meta.durationMin,
      dueDate: meta.dueDate,
      recurrenceRule: meta.recurrenceRule,
    });
  }

  return results;
}

function buildMetadataSuffix(fields: {
  readonly scheduledDate: string | null;
  readonly scheduledStartMin: number | null;
  readonly durationMin: number | null;
  readonly dueDate: string | null;
  readonly priority: TaskPriority | null;
  readonly recurrenceRule: TaskRecurrenceRule | null;
}): string[] {
  const tokens: string[] = [];
  if (fields.scheduledDate) {
    tokens.push(`📅${fields.scheduledDate}`);
  }
  if (fields.scheduledStartMin !== null) {
    const startHm = formatScheduledStartMin(fields.scheduledStartMin);
    if (
      fields.durationMin !== null &&
      fields.durationMin > 0 &&
      fields.scheduledStartMin + fields.durationMin <= 1440
    ) {
      const endHm = formatScheduledStartMin(fields.scheduledStartMin + fields.durationMin);
      tokens.push(`⏰${startHm}-${endHm}`);
    } else {
      tokens.push(`⏰${startHm}`);
      if (fields.durationMin !== null && fields.durationMin > 0) {
        tokens.push(`~${fields.durationMin}m`);
      }
    }
  } else if (fields.durationMin !== null && fields.durationMin > 0) {
    tokens.push(`~${fields.durationMin}m`);
  }
  if (fields.dueDate) {
    tokens.push(`⏳${fields.dueDate}`);
  }
  if (fields.priority && fields.priority !== "none") {
    tokens.push(`!${fields.priority}`);
  }
  if (fields.recurrenceRule) {
    tokens.push(`🔁${fields.recurrenceRule}`);
  }
  return tokens;
}

/**
 * Updates a single GFM task list item line in-place while leaving every other line byte-identical.
 */
export function updateMarkdownTaskLine(
  markdown: string,
  selector: MarkdownTaskSelector,
  patch: MarkdownTaskPatch,
): { readonly markdown: string; readonly updatedTask: ExtractedMarkdownTask } | null {
  const tasks = extractMarkdownTasks(markdown);
  const target =
    (selector.blockKey
      ? tasks.find((task) => task.blockKey === selector.blockKey)
      : undefined) ??
    (selector.lineIndex !== undefined && selector.lineIndex !== null
      ? tasks.find((task) => task.lineIndex === selector.lineIndex)
      : undefined) ??
    (selector.title
      ? tasks.find((task) => task.title.toLowerCase() === selector.title?.trim().toLowerCase())
      : undefined);

  if (!target) return null;

  const usesCrlf = markdown.includes("\r\n");
  const eol = usesCrlf ? "\r\n" : "\n";
  const normalized = markdown.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const rawLine = lines[target.lineIndex];
  if (rawLine === undefined) return null;

  const lineMatch = TASK_LINE_PREFIX_REGEX.exec(rawLine);
  if (!lineMatch) return null;

  const prefixStart = lineMatch[1] ?? "- [";
  const prefixEnd = lineMatch[3] ?? "] ";
  const nextCompleted = patch.completed ?? target.completed;
  const nextBody =
    patch.title !== undefined ? patch.title.trim() || target.bodyMarkdown : target.bodyMarkdown;
  const nextScheduledDate =
    patch.scheduledDate !== undefined ? patch.scheduledDate : target.scheduledDate;
  const nextScheduledStartMin =
    patch.scheduledStartMin !== undefined ? patch.scheduledStartMin : target.scheduledStartMin;
  const nextDurationMin = patch.durationMin !== undefined ? patch.durationMin : target.durationMin;
  const nextDueDate = patch.dueDate !== undefined ? patch.dueDate : target.dueDate;
  const nextPriority = patch.priority !== undefined ? patch.priority : target.priority;
  const nextRecurrenceRule =
    patch.recurrenceRule !== undefined ? patch.recurrenceRule : target.recurrenceRule;

  const metaTokens = buildMetadataSuffix({
    scheduledDate: nextScheduledDate,
    scheduledStartMin: nextScheduledStartMin,
    durationMin: nextDurationMin,
    dueDate: nextDueDate,
    priority: nextPriority,
    recurrenceRule: nextRecurrenceRule,
  });

  const bodyParts = [nextBody, ...metaTokens].filter((part) => part.length > 0);
  lines[target.lineIndex] = `${prefixStart}${nextCompleted ? "x" : " "}${prefixEnd}${bodyParts.join(" ")}`;
  const nextMarkdown = lines.join(eol);
  const reExtracted = extractMarkdownTasks(nextMarkdown);
  const updatedTask =
    reExtracted.find((task) => task.lineIndex === target.lineIndex) ?? {
      ...target,
      completed: nextCompleted,
      title: stripInlineMarkdownForTitle(nextBody),
      bodyMarkdown: nextBody,
      priority: nextPriority,
      scheduledDate: nextScheduledDate,
      scheduledStartMin: nextScheduledStartMin,
      scheduledSlot:
        nextScheduledStartMin !== null ? slotForScheduledStartMin(nextScheduledStartMin) : null,
      durationMin: nextDurationMin,
      dueDate: nextDueDate,
      recurrenceRule: nextRecurrenceRule,
    };

  return {
    markdown: nextMarkdown,
    updatedTask,
  };
}

/**
 * Appends a clean GFM task item line to an existing Markdown document.
 */
export function appendMarkdownTaskLine(
  markdown: string,
  input: {
    readonly title: string;
    readonly completed?: boolean | undefined;
    readonly priority?: TaskPriority | null | undefined;
    readonly scheduledDate?: string | null | undefined;
    readonly scheduledStartMin?: number | null | undefined;
    readonly durationMin?: number | null | undefined;
    readonly dueDate?: string | null | undefined;
    readonly recurrenceRule?: TaskRecurrenceRule | null | undefined;
  },
): { readonly markdown: string; readonly createdTask: ExtractedMarkdownTask } {
  const usesCrlf = markdown.includes("\r\n");
  const eol = usesCrlf ? "\r\n" : "\n";
  const tokens = buildMetadataSuffix({
    scheduledDate: input.scheduledDate ?? null,
    scheduledStartMin: input.scheduledStartMin ?? null,
    durationMin: input.durationMin ?? null,
    dueDate: input.dueDate ?? null,
    priority: input.priority ?? null,
    recurrenceRule: input.recurrenceRule ?? null,
  });
  const line = `- [${input.completed ? "x" : " "}] ${[input.title.trim(), ...tokens].join(" ")}`;
  const trimmedTail = markdown.replace(/\s+$/, "");
  const nextMarkdown = trimmedTail ? `${trimmedTail}${eol}${line}${eol}` : `${line}${eol}`;
  const tasks = extractMarkdownTasks(nextMarkdown);
  const createdTask = tasks[tasks.length - 1]!;
  return { markdown: nextMarkdown, createdTask };
}
