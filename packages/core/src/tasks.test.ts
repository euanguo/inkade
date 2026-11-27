import { describe, expect, it } from "bun:test";
import {
  classifyTaskBucket,
  computeNextRecurrenceDate,
  parseQuickTaskSyntax,
  resolveEffectiveScheduledDate,
} from "./tasks.ts";

describe("Enterprise Todo Core Helpers (Phase 31)", () => {
  const refFriday = new Date(2026, 10, 27); // 2026-11-27 (Friday)

  it("parses mixed EN/ZH quick syntax for priority, date, slot, duration, and recurrence", () => {
    const parsed = parseQuickTaskSyntax("Submit Q4 architecture RFC !1 明天 下午 1.5h weekly", refFriday);
    expect(parsed).toEqual({
      title: "Submit Q4 architecture RFC",
      priority: "p1",
      scheduledDate: "2026-11-28",
      scheduledSlot: "afternoon",
      durationMin: 90,
      recurrenceRule: "weekly",
    });
  });

  it("parses explicit Anytime pool and next-Monday syntax", () => {
    const anytimeTask = parseQuickTaskSyntax("Research WebGPU backends p3 anytime 45分钟", refFriday);
    expect(anytimeTask).toEqual({
      title: "Research WebGPU backends",
      priority: "p3",
      scheduledDate: null,
      durationMin: 45,
    });

    const nextMonTask = parseQuickTaskSyntax("Sync with team 下周一 上午 30m 每天", refFriday);
    expect(nextMonTask).toEqual({
      title: "Sync with team",
      scheduledDate: "2026-11-30",
      scheduledSlot: "morning",
      durationMin: 30,
      recurrenceRule: "daily",
    });

    const prefixedTask = parseQuickTaskSyntax("Ship release !p1 @tomorrow ~30m weekdays", refFriday);
    expect(prefixedTask).toEqual({
      title: "Ship release",
      priority: "p1",
      scheduledDate: "2026-11-28",
      durationMin: 30,
      recurrenceRule: "weekdays",
    });
  });

  it("handles recurrence edge cases (weekends, leap year, month-end clamping)", () => {
    expect(computeNextRecurrenceDate("2026-11-27", "weekdays")).toBe("2026-11-30"); // Fri -> Mon
    expect(computeNextRecurrenceDate("2026-11-28", "weekdays")).toBe("2026-11-30"); // Sat -> Mon
    expect(computeNextRecurrenceDate("2024-01-31", "monthly")).toBe("2024-02-29"); // Leap Feb
    expect(computeNextRecurrenceDate("2026-01-31", "monthly")).toBe("2026-02-28"); // Non-leap Feb
    expect(computeNextRecurrenceDate("2026-11-25", "daily")).toBe("2026-11-26");
    expect(computeNextRecurrenceDate("2026-11-25", "weekly")).toBe("2026-12-02");
  });

  it("resolves Anytime vs scheduled dates and classifies buckets cleanly", () => {
    expect(resolveEffectiveScheduledDate({ scheduledDate: null }, "2026-11-25")).toBeNull();
    expect(resolveEffectiveScheduledDate({ scheduledDate: "2026-11-28" }, "2026-11-25")).toBe("2026-11-28");
    expect(resolveEffectiveScheduledDate({}, "2026-11-25")).toBe("2026-11-25");

    expect(classifyTaskBucket({ checked: true, scheduledDate: "2026-11-25" }, "2026-11-25")).toBe("completed");
    expect(classifyTaskBucket({ checked: false, scheduledDate: null }, "2026-11-25")).toBe("anytime");
    expect(classifyTaskBucket({ checked: false, scheduledDate: "2026-11-24" }, "2026-11-25")).toBe("overdue");
    expect(classifyTaskBucket({ checked: false, scheduledDate: "2026-11-25" }, "2026-11-25")).toBe("today");
    expect(classifyTaskBucket({ checked: false, scheduledDate: "2026-11-26" }, "2026-11-25")).toBe("tomorrow");
    expect(classifyTaskBucket({ checked: false, scheduledDate: "2026-11-30" }, "2026-11-25")).toBe("week");
    expect(classifyTaskBucket({ checked: false, scheduledDate: "2026-12-10" }, "2026-11-25")).toBe("upcoming");
  });
});
