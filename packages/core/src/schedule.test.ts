import { describe, expect, it } from "bun:test";

import { TASK_DURATION_MINUTES, TASK_SCHEDULE_SLOTS } from "./schedule.ts";

describe("task schedule constants", () => {
  it("exposes supported schedule slots and preset durations", () => {
    expect(TASK_SCHEDULE_SLOTS).toEqual(["today", "morning", "afternoon", "evening"]);
    expect(TASK_DURATION_MINUTES).toEqual([15, 30, 45, 60, 90, 120]);
  });
});
