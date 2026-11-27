import { isValidDailyDate } from "./ids.ts";

/**
 * Formats a JS `Date` into local calendar `YYYY-MM-DD`.
 */
export function formatLocalIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Formats a JS `Date` into UTC calendar `YYYY-MM-DD`.
 */
export function formatUtcIsoDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Returns today's local calendar date as `YYYY-MM-DD`.
 */
export function todayLocalDateString(now: Date = new Date()): string {
  return formatLocalIsoDate(now);
}

/**
 * Shifts a local JS `Date` by `deltaDays` whole calendar days.
 */
export function shiftLocalCalendarDate(base: Date, deltaDays: number): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + deltaDays);
}

/**
 * Parses a strict `YYYY-MM-DD` calendar date into a UTC midnight `Date`, returning `null` if invalid.
 */
export function parseIsoCalendarDate(isoDate: string): Date | null {
  const trimmed = isoDate.trim();
  if (!isValidDailyDate(trimmed)) {
    return null;
  }
  const [year = 1970, month = 1, day = 1] = trimmed.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

/**
 * Parses a strict `YYYY-MM-DD` calendar date into a local midnight `Date` (falling back to `fallback`).
 */
export function parseIsoToLocalCalendarDate(
  isoDate?: string | null,
  fallback: Date = new Date(),
): Date {
  if (!isoDate || !isValidDailyDate(isoDate)) {
    return new Date(fallback.getFullYear(), fallback.getMonth(), fallback.getDate());
  }
  const [year = 1970, month = 1, day = 1] = isoDate.split("-").map(Number);
  return new Date(year, month - 1, day);
}
