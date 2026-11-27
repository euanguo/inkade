export const TASK_SCHEDULE_SLOTS = [
  "today",
  "morning",
  "afternoon",
  "evening",
] as const;

export type TaskScheduleSlot = (typeof TASK_SCHEDULE_SLOTS)[number];

export const TASK_DURATION_MINUTES = [15, 30, 45, 60, 90, 120] as const;

export type TaskDurationMinutes = number;

export function slotForScheduledStartMin(startMin: number): TaskScheduleSlot {
  if (startMin < 720) return "morning";
  if (startMin < 1080) return "afternoon";
  return "evening";
}

export function defaultStartMinForSlot(slot: TaskScheduleSlot): number {
  switch (slot) {
    case "morning":
      return 9 * 60;
    case "afternoon":
      return 14 * 60;
    case "evening":
      return 19 * 60 + 30;
    case "today":
    default:
      return 9 * 60;
  }
}

export function formatScheduledStartMin(startMin: number): string {
  const clamped = Math.max(0, Math.min(1440, Math.round(startMin)));
  const hh = Math.floor(clamped / 60)
    .toString()
    .padStart(2, "0");
  const mm = (clamped % 60).toString().padStart(2, "0");
  return `${hh}:${mm}`;
}

export function parseScheduledTimeHm(hm: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hm.trim());
  if (!match) return null;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  return hh * 60 + mm;
}
