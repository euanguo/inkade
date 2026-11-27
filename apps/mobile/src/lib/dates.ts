import { formatLocalIsoDate } from "@inkade/core";

export function getLocalIsoDate(date = new Date()): string {
  return formatLocalIsoDate(date);
}

export function parseIsoDateLocal(isoDate: string): Date {
  const parts = isoDate.split("-");
  const year = Number(parts[0] ?? 2026);
  const month = Number(parts[1] ?? 1) - 1;
  const day = Number(parts[2] ?? 1);
  return new Date(year, month, day, 12, 0, 0, 0);
}

export function addDaysToIso(isoDate: string, deltaDays: number): string {
  const d = parseIsoDateLocal(isoDate);
  d.setDate(d.getDate() + deltaDays);
  return getLocalIsoDate(d);
}

export interface WeekDaySlot {
  readonly isoDate: string;
  readonly dayOfMonth: number;
  readonly weekdayIndex: number; // 0 = Sun, 1 = Mon, ... 6 = Sat
  readonly isToday: boolean;
}

/**
 * Returns the Monday-through-Sunday 7-day ribbon containing `anchorIsoDate`.
 */
export function getWeekRibbonDays(
  anchorIsoDate: string,
  todayIsoDate = getLocalIsoDate(),
): readonly WeekDaySlot[] {
  const d = parseIsoDateLocal(anchorIsoDate);
  const day = d.getDay(); // 0 (Sun) .. 6 (Sat)
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diffToMonday);

  const slots: WeekDaySlot[] = [];
  for (let i = 0; i < 7; i++) {
    const slotDate = new Date(monday);
    slotDate.setDate(monday.getDate() + i);
    const iso = getLocalIsoDate(slotDate);
    slots.push({
      isoDate: iso,
      dayOfMonth: slotDate.getDate(),
      weekdayIndex: slotDate.getDay(),
      isToday: iso === todayIsoDate,
    });
  }
  return slots;
}

export function formatWeekdayShort(weekdayIndex: number, locale: "zh-CN" | "en-US"): string {
  const zh = ["日", "一", "二", "三", "四", "五", "六"];
  const en = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const list = locale === "zh-CN" ? zh : en;
  return list[weekdayIndex] ?? "";
}

export type RelativeTimeTranslateFn = {
  (key: "common.justNow"): string;
  (
    key: "common.secondsAgo" | "common.minutesAgo" | "common.hoursAgo" | "common.daysAgo",
    opts: { readonly count: number },
  ): string;
};

export function formatRelativeTime(
  isoTimestamp: string,
  t: RelativeTimeTranslateFn,
): string {
  const ts = Date.parse(isoTimestamp);
  if (!Number.isFinite(ts)) return isoTimestamp;
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 15) return t("common.justNow");
  if (diffSec < 60) return t("common.secondsAgo", { count: diffSec });
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return t("common.minutesAgo", { count: diffMin });
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return t("common.hoursAgo", { count: diffHours });
  const diffDays = Math.floor(diffHours / 24);
  return t("common.daysAgo", { count: diffDays });
}
