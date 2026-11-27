import { formatLocalIsoDate, todayLocalDateString } from "@inkade/core";
import { getInkadeLocale, type InkadeLocale, t } from "@inkade/i18n";
import { addDays, format, parseISO } from "date-fns";
import { enUS, zhCN } from "date-fns/locale";

export function formatDailyDate(date: Date): string {
  return formatLocalIsoDate(date);
}

export function getTodayDailyDate(): string {
  return todayLocalDateString();
}

export function shiftDailyDate(dateStr: string, deltaDays: number): string {
  const parsed = parseISO(dateStr);
  if (Number.isNaN(parsed.getTime())) {
    return getTodayDailyDate();
  }
  return format(addDays(parsed, deltaDays), "yyyy-MM-dd");
}

export function formatDailyHeading(
  dateStr: string,
  locale: InkadeLocale = getInkadeLocale(),
): string {
  const parsed = parseISO(dateStr);
  if (Number.isNaN(parsed.getTime())) {
    return dateStr;
  }
  if (locale === "en-US") {
    return format(parsed, "EEEE, MMM d, yyyy", { locale: enUS });
  }
  return format(parsed, "yyyy 年 M 月 d 日 · EEEE", { locale: zhCN });
}

export function formatAgendaWeekRange(
  startStr: string,
  endStr: string,
  locale: InkadeLocale = getInkadeLocale(),
): string {
  const startDate = parseISO(startStr.slice(0, 10));
  const rawEnd = parseISO(endStr.slice(0, 10));
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(rawEnd.getTime())) {
    return formatDailyHeading(startStr.slice(0, 10), locale);
  }
  const endDate = addDays(rawEnd, -1);
  const sameYear = startDate.getFullYear() === endDate.getFullYear();
  const sameMonth = sameYear && startDate.getMonth() === endDate.getMonth();
  if (locale === "en-US") {
    if (sameMonth) {
      return `${format(startDate, "MMM d", { locale: enUS })} – ${format(endDate, "d, yyyy", { locale: enUS })}`;
    }
    if (sameYear) {
      return `${format(startDate, "MMM d", { locale: enUS })} – ${format(endDate, "MMM d, yyyy", { locale: enUS })}`;
    }
    return `${format(startDate, "MMM d, yyyy", { locale: enUS })} – ${format(endDate, "MMM d, yyyy", { locale: enUS })}`;
  }
  if (sameMonth) {
    return `${format(startDate, "yyyy 年 M 月 d 日", { locale: zhCN })} – ${format(endDate, "d 日", { locale: zhCN })}`;
  }
  if (sameYear) {
    return `${format(startDate, "yyyy 年 M 月 d 日", { locale: zhCN })} – ${format(endDate, "M 月 d 日", { locale: zhCN })}`;
  }
  return `${format(startDate, "yyyy 年 M 月 d 日", { locale: zhCN })} – ${format(endDate, "yyyy 年 M 月 d 日", { locale: zhCN })}`;
}

export function getRelativeDailyBadge(dateStr: string, todayStr: string = getTodayDailyDate()): string | null {
  if (dateStr === todayStr) return t("common.today");
  if (dateStr === shiftDailyDate(todayStr, -1)) return t("common.yesterday");
  if (dateStr === shiftDailyDate(todayStr, 1)) return t("common.tomorrow");
  return null;
}
