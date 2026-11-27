import * as chrono from "chrono-node";
import { RRuleTemporal } from "rrule-temporal";
import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import {
  formatLocalIsoDate,
  parseIsoCalendarDate,
  shiftLocalCalendarDate,
} from "./dates.ts";
import type { OutlineNodeId } from "./ids.ts";
import {
  parseScheduledTimeHm,
  slotForScheduledStartMin,
  TASK_SCHEDULE_SLOTS,
  type TaskScheduleSlot,
} from "./schedule.ts";

export const TASK_PRIORITIES = ["p1", "p2", "p3", "p4", "none"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export const taskPrioritySchema = z.enum(TASK_PRIORITIES);

export const TASK_RECURRENCE_RULES = ["daily", "weekdays", "weekly", "monthly"] as const;
export type TaskRecurrencePreset = (typeof TASK_RECURRENCE_RULES)[number];
export type TaskRecurrenceRule = TaskRecurrencePreset | (string & {});

const RRULE_STRING_REGEX =
  /^(?:RRULE:)?FREQ=(?:DAILY|WEEKLY|MONTHLY|YEARLY)(?:;[A-Z0-9_]+=[A-Z0-9_,+-]+)*$/i;

export function normalizeTaskRecurrenceRruleBody(rule: string): string | null {
  const trimmed = rule.trim();
  if (!trimmed) return null;
  switch (trimmed.toLowerCase()) {
    case "daily":
      return "FREQ=DAILY";
    case "weekdays":
      return "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR";
    case "weekly":
      return "FREQ=WEEKLY";
    case "monthly":
      return "FREQ=MONTHLY";
    default: {
      if (!RRULE_STRING_REGEX.test(trimmed)) return null;
      return trimmed.replace(/^RRULE:/i, "").toUpperCase();
    }
  }
}

export function isValidTaskRecurrenceRule(value: string): boolean {
  const body = normalizeTaskRecurrenceRruleBody(value);
  if (!body) return false;
  try {
    // Validate against rrule-temporal parser using a canonical UTC DTSTART.
    new RRuleTemporal({
      rruleString: `DTSTART;TZID=UTC:20260101T000000\nRRULE:${body}`,
    });
    return true;
  } catch {
    return false;
  }
}

export const taskRecurrenceRuleSchema = z.union([
  z.enum(TASK_RECURRENCE_RULES),
  z.string().trim().regex(RRULE_STRING_REGEX, {
    message: "Invalid RFC 5545 recurrence rule string",
  }),
]) as unknown as z.ZodType<TaskRecurrenceRule, TaskRecurrenceRule>;

export const TASK_BUCKETS = [
  "overdue",
  "today",
  "tomorrow",
  "week",
  "upcoming",
  "anytime",
  "completed",
] as const;
export type TaskBucket = (typeof TASK_BUCKETS)[number];
export const taskBucketSchema = z.enum(TASK_BUCKETS);

export type TaskDeadlineStatus = "overdue" | "due_today" | "due_soon" | "upcoming" | "none";
export type TaskScheduleQuadrant =
  | "scheduled_and_due"
  | "scheduled_only"
  | "due_only"
  | "unscheduled";

export interface WorkspaceTaskSubtask {
  readonly id: OutlineNodeId;
  readonly contentMarkdown: string;
  readonly contentText: string;
  readonly checked: boolean;
}

export interface ParsedQuickTaskSyntax {
  readonly title: string;
  readonly priority?: TaskPriority | undefined;
  /** `null` when explicitly targeted at Anytime; `undefined` when unspecified in text. */
  readonly scheduledDate?: string | null | undefined;
  readonly scheduledStartMin?: number | undefined;
  readonly scheduledSlot?: TaskScheduleSlot | undefined;
  readonly durationMin?: number | undefined;
  readonly dueDate?: string | null | undefined;
  readonly recurrenceRule?: TaskRecurrenceRule | undefined;
}

function resolveRelativeDatePhrase(phrase: string, ref: Date): string | null {
  const trimmed = phrase.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed) && parseIsoCalendarDate(trimmed)) {
    return trimmed;
  }
  if (/^(today|今天|今日)$/i.test(trimmed)) {
    return formatLocalIsoDate(ref);
  }
  if (/^(tomorrow|明天|明日)$/i.test(trimmed)) {
    return formatLocalIsoDate(shiftLocalCalendarDate(ref, 1));
  }
  if (/^(next\s+monday|下周一)$/i.test(trimmed)) {
    const dow = ref.getDay();
    const delta = dow === 0 ? 1 : 8 - dow;
    return formatLocalIsoDate(shiftLocalCalendarDate(ref, delta));
  }
  const zhMatch = chrono.zh.hans.parse(trimmed, ref, { forwardDate: true })[0];
  if (zhMatch && (zhMatch.start.isCertain("day") || zhMatch.start.isCertain("weekday"))) {
    return formatLocalIsoDate(zhMatch.start.date());
  }
  const enMatch = chrono.en.parse(trimmed, ref, { forwardDate: true })[0];
  if (enMatch && (enMatch.start.isCertain("day") || enMatch.start.isCertain("weekday"))) {
    return formatLocalIsoDate(enMatch.start.date());
  }
  return null;
}

function parseExplicitClockTime(text: string): number | null {
  const normalized = text.trim().replace(/^(\d):/, "0$1:");
  return parseScheduledTimeHm(normalized);
}

/**
 * Parses enterprise quick-add task syntax in English, Chinese, or mixed input:
 * - Priority: `!1`..`!4`, `p1`..`p4`
 * - Schedule dates & times: `today`/`今天`, `tomorrow`/`明天`, `next monday`/`下周一`, `anytime`/`随时`,
 *   `@YYYY-MM-DD`, `@明天 14:30-16:00`, plus `chrono-node` natural language (`后天下午3点`, `next friday at 3pm`)
 * - Deadline: `@due:YYYY-MM-DD`, `due:tomorrow`, `截止:明天`, `⏳YYYY-MM-DD`
 * - Slot: `morning`/`上午`, `afternoon`/`下午`, `evening`/`晚上`
 * - Duration: `15m`, `30m`, `45m`, `1h`, `1.5h`, `2h`, `30分钟`, `1小时`
 * - Recurrence: `every day`/`daily`/`每天`, `weekdays`/`工作日`, `every week`/`weekly`/`每周`, `every month`/`monthly`/`每月`, `RRULE:FREQ=...`
 */
export function parseQuickTaskSyntax(
  raw: string,
  referenceDate: Date = new Date(),
): ParsedQuickTaskSyntax {
  const ref = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate(),
  );

  let working = raw;
  let priority: TaskPriority | undefined;
  let scheduledDate: string | null | undefined;
  let scheduledStartMin: number | undefined;
  let scheduledSlot: TaskScheduleSlot | undefined;
  let durationMin: number | undefined;
  let dueDate: string | null | undefined;
  let recurrenceRule: TaskRecurrenceRule | undefined;

  const stripMatch = (pattern: RegExp, onMatch: (m: RegExpExecArray) => void): void => {
    const match = pattern.exec(working);
    if (!match) return;
    onMatch(match);
    working = `${working.slice(0, match.index)} ${working.slice(match.index + match[0].length)}`;
  };

  // Explicit Deadline tokens: @due:YYYY-MM-DD / due:tomorrow / 截止:明天 / ⏳YYYY-MM-DD
  stripMatch(/(?:^|\s)(?:@?due[:=]|@?截止[:=]?)([^\s]+)(?=\s|$)/i, (m) => {
    const resolved = m[1] ? resolveRelativeDatePhrase(m[1], ref) : null;
    if (resolved) {
      dueDate = resolved;
    }
  });
  if (dueDate === undefined) {
    stripMatch(/(?:^|\s)⏳([^\s]+)(?=\s|$)/u, (m) => {
      const resolved = m[1] ? resolveRelativeDatePhrase(m[1], ref) : null;
      if (resolved) {
        dueDate = resolved;
      }
    });
  }

  // Priority: !1..!4, !p1..!p4, or standalone p1..p4
  stripMatch(/(?:^|\s)(!p?([1-4])|\bp([1-4])\b)(?=\s|$)/i, (m) => {
    const level = m[2] ?? m[3];
    if (level) {
      priority = `p${level}` as TaskPriority;
    }
  });

  // Explicit RRULE token
  stripMatch(/(?:^|\s)(?:rrule:)?(FREQ=(?:DAILY|WEEKLY|MONTHLY|YEARLY)(?:;[A-Z0-9_]+=[A-Z0-9_,+-]+)*)(?=\s|$)/i, (m) => {
    const rule = m[1]?.toUpperCase();
    if (rule && isValidTaskRecurrenceRule(rule)) {
      recurrenceRule = rule;
    }
  });

  // Recurrence keywords (check multi-word patterns before single-word date keywords)
  if (!recurrenceRule) {
    stripMatch(/(?:^|\s)(every\s+day|daily|每天|每日)(?=\s|$)/i, () => {
      recurrenceRule = "daily";
    });
  }
  if (!recurrenceRule) {
    stripMatch(/(?:^|\s)(every\s+weekdays?|weekdays|工作日)(?=\s|$)/i, () => {
      recurrenceRule = "weekdays";
    });
  }
  if (!recurrenceRule) {
    stripMatch(/(?:^|\s)(every\s+week|weekly|每周)(?=\s|$)/i, () => {
      recurrenceRule = "weekly";
    });
  }
  if (!recurrenceRule) {
    stripMatch(/(?:^|\s)(every\s+month|monthly|每月)(?=\s|$)/i, () => {
      recurrenceRule = "monthly";
    });
  }

  // Explicit time range: 14:30-16:00 or 9:00~10:30
  stripMatch(/(?:^|\s)⏰?(\d{1,2}:[0-5]\d)\s*[-~–]\s*(\d{1,2}:[0-5]\d)(?=\s|$)/u, (m) => {
    const startMin = m[1] ? parseExplicitClockTime(m[1]) : null;
    const endRaw = m[2]?.trim().replace(/^(\d):/, "0$1:");
    const endMin =
      endRaw === "24:00"
        ? 1440
        : endRaw
          ? parseScheduledTimeHm(endRaw)
          : null;
    if (startMin !== null) {
      scheduledStartMin = startMin;
      if (endMin !== null && endMin > startMin) {
        durationMin = Math.min(1440, endMin - startMin);
      }
    }
  });

  // Explicit single clock time: 14:30 or ⏰09:00
  if (scheduledStartMin === undefined) {
    stripMatch(/(?:^|\s)⏰?([01]?\d|2[0-3]):([0-5]\d)(?=\s|$)/u, (m) => {
      const parsed = parseExplicitClockTime(`${m[1]}:${m[2]}`);
      if (parsed !== null) {
        scheduledStartMin = parsed;
      }
    });
  }

  // Duration: ~1.5h, 1小时, 30m, 30分钟
  if (durationMin === undefined) {
    stripMatch(/(?:^|\s)~?(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|小时)(?=\s|$)/i, (m) => {
      const num = Number(m[1]);
      if (Number.isFinite(num) && num > 0 && num <= 24) {
        durationMin = Math.round(num * 60);
      }
    });
  }
  if (durationMin === undefined) {
    stripMatch(/(?:^|\s)~?(\d+)\s*(minutes?|mins?|m|分钟|分)(?=\s|$)/i, (m) => {
      const num = Number(m[1]);
      if (Number.isFinite(num) && num > 0 && num <= 1440) {
        durationMin = Math.round(num);
      }
    });
  }

  // Scheduled date explicit tokens
  stripMatch(/(?:^|\s)@?(anytime|随时|待定)(?=\s|$)/i, () => {
    scheduledDate = null;
  });
  if (scheduledDate === undefined) {
    stripMatch(/(?:^|\s)@?(\d{4}-\d{2}-\d{2})(?=\s|$)/, (m) => {
      const parsed = m[1] ? parseIsoCalendarDate(m[1]) : null;
      if (parsed && m[1]) {
        scheduledDate = m[1];
      }
    });
  }
  if (scheduledDate === undefined) {
    stripMatch(/(?:^|\s)@?(today|今天|今日)(?=\s|$)/i, () => {
      scheduledDate = formatLocalIsoDate(ref);
    });
  }
  if (scheduledDate === undefined) {
    stripMatch(/(?:^|\s)@?(tomorrow|明天|明日)(?=\s|$)/i, () => {
      scheduledDate = formatLocalIsoDate(shiftLocalCalendarDate(ref, 1));
    });
  }
  if (scheduledDate === undefined) {
    stripMatch(/(?:^|\s)@?(next\s+monday|下周一)(?=\s|$)/i, () => {
      const dow = ref.getDay();
      const delta = dow === 0 ? 1 : 8 - dow;
      scheduledDate = formatLocalIsoDate(shiftLocalCalendarDate(ref, delta));
    });
  }

  // Standalone timeblock slots (e.g. "明天 下午" / "morning") before NLP time parsing
  stripMatch(/(?:^|\s)(morning|上午|早上)(?=\s|$)/i, () => {
    scheduledSlot = "morning";
  });
  if (!scheduledSlot) {
    stripMatch(/(?:^|\s)(afternoon|下午)(?=\s|$)/i, () => {
      scheduledSlot = "afternoon";
    });
  }
  if (!scheduledSlot) {
    stripMatch(/(?:^|\s)(evening|tonight|晚上|今晚)(?=\s|$)/i, () => {
      scheduledSlot = "evening";
    });
  }

  // Chrono-node NLP pass for richer EN/ZH relative dates and natural clock times
  const hasNaturalTimeHint = /(?:\d+\s*(?:点|时|am|pm)|\d{1,2}[:：]\d{2}|at\s+\d)/i.test(working);
  if (
    scheduledDate !== null &&
    (scheduledDate === undefined || (scheduledStartMin === undefined && hasNaturalTimeHint))
  ) {
    const chronoAnchor = referenceDate;
    const candidates = [
      ...chrono.zh.hans.parse(working, chronoAnchor, { forwardDate: true }),
      ...chrono.en.strict.parse(working, chronoAnchor, { forwardDate: true }),
    ];
    const match = candidates.find((candidate) => {
      const trimmedText = candidate.text.trim();
      if (!trimmedText || /^\d+$/.test(trimmedText)) return false;
      return (
        candidate.start.isCertain("day") ||
        candidate.start.isCertain("weekday") ||
        (candidate.start.isCertain("hour") && /\d/.test(trimmedText))
      );
    });

    if (match) {
      const startDate = match.start.date();
      if (
        scheduledDate === undefined &&
        (match.start.isCertain("day") ||
          match.start.isCertain("weekday") ||
          match.start.isCertain("month"))
      ) {
        scheduledDate = formatLocalIsoDate(startDate);
      }
      if (scheduledStartMin === undefined && match.start.isCertain("hour")) {
        const hh = match.start.get("hour") ?? startDate.getHours();
        const mm = match.start.get("minute") ?? startDate.getMinutes();
        scheduledStartMin = Math.max(0, Math.min(1439, hh * 60 + mm));
        if (match.end && match.end.isCertain("hour") && durationMin === undefined) {
          const endDate = match.end.date();
          const diffMin = Math.round((endDate.getTime() - startDate.getTime()) / 60000);
          if (diffMin > 0 && diffMin <= 1440) {
            durationMin = diffMin;
          }
        }
      }
      const startIdx =
        match.index > 0 && working[match.index - 1] === "@" ? match.index - 1 : match.index;
      working = `${working.slice(0, startIdx)} ${working.slice(match.index + match.text.length)}`;
    }
  }

  if (scheduledSlot === undefined && scheduledStartMin !== undefined) {
    scheduledSlot = slotForScheduledStartMin(scheduledStartMin);
  }

  // Default to today if a slot, clock time, or recurrence was provided without explicit anytime/date
  if (
    scheduledDate === undefined &&
    (scheduledSlot !== undefined || scheduledStartMin !== undefined || recurrenceRule !== undefined)
  ) {
    scheduledDate = formatLocalIsoDate(ref);
  }

  const title = working.replace(/\s+/g, " ").trim() || raw.trim();

  return {
    title,
    ...(priority !== undefined ? { priority } : {}),
    ...(scheduledDate !== undefined ? { scheduledDate } : {}),
    ...(scheduledStartMin !== undefined ? { scheduledStartMin } : {}),
    ...(scheduledSlot !== undefined ? { scheduledSlot } : {}),
    ...(durationMin !== undefined ? { durationMin } : {}),
    ...(dueDate !== undefined ? { dueDate } : {}),
    ...(recurrenceRule !== undefined ? { recurrenceRule } : {}),
  };
}

/**
 * Computes the next scheduled ISO date (`YYYY-MM-DD`) when a recurring task is completed.
 * Uses `rrule-temporal` + `temporal-polyfill` for arbitrary RFC 5545 rules while preserving
 * month-end clamping for the preset `"monthly"` rule (e.g. Jan 31 -> Feb 28/29).
 */
export function computeNextRecurrenceDate(
  baseIsoDate: string,
  rule: TaskRecurrenceRule,
): string {
  const validIso = parseIsoCalendarDate(baseIsoDate)
    ? baseIsoDate
    : Temporal.Now.plainDateISO().toString();
  const basePlain = Temporal.PlainDate.from(validIso);

  if (rule === "monthly") {
    return basePlain.add({ months: 1 }).toString();
  }

  const rruleBody = normalizeTaskRecurrenceRruleBody(rule);
  if (!rruleBody) {
    return basePlain.add({ days: 1 }).toString();
  }

  const dtstartStamp = `${validIso.replace(/-/g, "")}T000000`;
  const rrule = new RRuleTemporal({
    rruleString: `DTSTART;TZID=UTC:${dtstartStamp}\nRRULE:${rruleBody}`,
  });
  const after = basePlain.toPlainDateTime({ hour: 0, minute: 0, second: 1 }).toZonedDateTime("UTC");
  const nextOccurrence = rrule.next(after);
  if (nextOccurrence) {
    return nextOccurrence.toPlainDate().toString();
  }
  return basePlain.add({ days: 1 }).toString();
}

/**
 * Returns the canonical scheduled ISO date (`YYYY-MM-DD`) or `null` for Anytime inbox items.
 */
export function resolveEffectiveScheduledDate(
  node: { readonly scheduledDate?: string | null | undefined },
  docDailyDate?: string | null,
): string | null {
  if (node.scheduledDate !== undefined) {
    return node.scheduledDate;
  }
  return docDailyDate ?? null;
}

/**
 * Evaluates Schedule × Deadline quadrant state, bucket, and deadline countdown days relative to `todayIso`.
 */
export function analyzeTaskTiming(
  task: {
    readonly checked: boolean | null;
    readonly scheduledDate?: string | null | undefined;
    readonly dueDate?: string | null | undefined;
  },
  todayIso: string,
): {
  readonly bucket: TaskBucket;
  readonly deadlineStatus: TaskDeadlineStatus;
  readonly daysUntilDue: number | null;
  readonly quadrant: TaskScheduleQuadrant;
} {
  const sched = task.scheduledDate ?? null;
  const due = task.dueDate ?? null;
  const quadrant: TaskScheduleQuadrant =
    sched && due
      ? "scheduled_and_due"
      : sched
        ? "scheduled_only"
        : due
          ? "due_only"
          : "unscheduled";

  let deadlineStatus: TaskDeadlineStatus = "none";
  let daysUntilDue: number | null = null;
  if (due && parseIsoCalendarDate(due) && parseIsoCalendarDate(todayIso)) {
    const duePlain = Temporal.PlainDate.from(due);
    const todayPlain = Temporal.PlainDate.from(todayIso);
    daysUntilDue = todayPlain.until(duePlain, { largestUnit: "days" }).days;
    if (task.checked !== true) {
      if (daysUntilDue < 0) deadlineStatus = "overdue";
      else if (daysUntilDue === 0) deadlineStatus = "due_today";
      else if (daysUntilDue <= 3) deadlineStatus = "due_soon";
      else deadlineStatus = "upcoming";
    }
  }

  return {
    bucket: classifyTaskBucket(task, todayIso),
    deadlineStatus,
    daysUntilDue,
    quadrant,
  };
}

/**
 * Classifies a task item into Things/Amie-style enterprise buckets relative to `todayIso`,
 * factoring both `scheduledDate` and unscheduled urgent `dueDate` deadlines.
 */
export function classifyTaskBucket(
  task: {
    readonly checked: boolean | null;
    readonly scheduledDate?: string | null | undefined;
    readonly dueDate?: string | null | undefined;
  },
  todayIso: string,
): TaskBucket {
  if (task.checked === true) {
    return "completed";
  }
  const effectiveTarget = task.scheduledDate ?? task.dueDate ?? null;
  if (!effectiveTarget) {
    return "anytime";
  }
  if (effectiveTarget < todayIso) {
    return "overdue";
  }
  if (effectiveTarget === todayIso) {
    return "today";
  }
  const todayDate = parseIsoCalendarDate(todayIso);
  if (todayDate) {
    const todayPlain = Temporal.PlainDate.from(todayIso);
    const tomorrowIso = todayPlain.add({ days: 1 }).toString();
    if (effectiveTarget === tomorrowIso) {
      return "tomorrow";
    }
    const endOfWeekIso = todayPlain.add({ days: 7 }).toString();
    if (effectiveTarget <= endOfWeekIso) {
      return "week";
    }
  }
  return "upcoming";
}

export const TASK_SLOT_SET = new Set<string>(TASK_SCHEDULE_SLOTS);
export type { TaskScheduleSlot };
