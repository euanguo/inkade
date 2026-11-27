import { describe, expect, test } from "bun:test";
import {
  analyzeTaskTiming,
  computeNextRecurrenceDate,
  isValidTaskRecurrenceRule,
  parseQuickTaskSyntax,
} from "./tasks.ts";

describe("Phase 41 NLP tasks, RRULE recurrence, and Schedule × Deadline", () => {
  test("parses Chinese and English dates, time ranges, and due dates via chrono-node", () => {
    const ref = new Date(2026, 10, 25, 9, 0, 0); // Wed 2026-11-25

    const zh = parseQuickTaskSyntax("审阅架构文档 @明天 14:30-16:00 @due:2026-12-01 !p1", ref);
    expect(zh.title).toBe("审阅架构文档");
    expect(zh.scheduledDate).toBe("2026-11-26");
    expect(zh.scheduledStartMin).toBe(14 * 60 + 30);
    expect(zh.durationMin).toBe(90);
    expect(zh.scheduledSlot).toBe("afternoon");
    expect(zh.dueDate).toBe("2026-12-01");
    expect(zh.priority).toBe("p1");

    const en = parseQuickTaskSyntax("Deploy build tomorrow at 3pm 45m due:2026-11-28", ref);
    expect(en.scheduledDate).toBe("2026-11-26");
    expect(en.scheduledStartMin).toBe(15 * 60);
    expect(en.durationMin).toBe(45);
    expect(en.dueDate).toBe("2026-11-28");
    expect(en.title).toBe("Deploy build");
  });

  test("does not mistake ordinary numeric titles for dates", () => {
    const ref = new Date(2026, 10, 25, 9, 0, 0);
    const parsed = parseQuickTaskSyntax("Fix PR 42 issue 2", ref);
    expect(parsed.title).toBe("Fix PR 42 issue 2");
    expect(parsed.scheduledDate).toBeUndefined();
    expect(parsed.scheduledStartMin).toBeUndefined();
  });

  test("computes next recurrence date with rrule-temporal for simple and complex RRULEs", () => {
    expect(isValidTaskRecurrenceRule("daily")).toBe(true);
    expect(isValidTaskRecurrenceRule("FREQ=MONTHLY;BYDAY=-1FR")).toBe(true);
    expect(isValidTaskRecurrenceRule("invalid-rule")).toBe(false);

    // Monthly last Friday: Nov 2026 last Friday is Nov 27; Dec 2026 last Friday is Dec 25
    expect(computeNextRecurrenceDate("2026-11-01", "FREQ=MONTHLY;BYDAY=-1FR")).toBe("2026-11-27");
    expect(computeNextRecurrenceDate("2026-11-27", "FREQ=MONTHLY;BYDAY=-1FR")).toBe("2026-12-25");

    // Every 2 weeks on Wednesday
    expect(computeNextRecurrenceDate("2026-11-04", "FREQ=WEEKLY;INTERVAL=2;BYDAY=WE")).toBe(
      "2026-11-18",
    );
  });

  test("analyzes Schedule × Deadline quadrants and countdown days", () => {
    const res = analyzeTaskTiming(
      { checked: false, scheduledDate: null, dueDate: "2026-11-27" },
      "2026-11-25",
    );
    expect(res.quadrant).toBe("due_only");
    expect(res.deadlineStatus).toBe("due_soon");
    expect(res.daysUntilDue).toBe(2);
    expect(res.bucket).toBe("week");

    const overdueUnscheduled = analyzeTaskTiming(
      { checked: false, scheduledDate: null, dueDate: "2026-11-24" },
      "2026-11-25",
    );
    expect(overdueUnscheduled.deadlineStatus).toBe("overdue");
    expect(overdueUnscheduled.daysUntilDue).toBe(-1);
    expect(overdueUnscheduled.bucket).toBe("overdue");
  });
});
