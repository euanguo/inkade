"use client";

import type { WorkspaceSummary } from "@inkade/core";
import { useInkadeLocale, useInkadeTranslation } from "@inkade/i18n";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { cn } from "../lib/utils.ts";
import { Button } from "../primitives/button.tsx";

export type DailyActivityEntry = WorkspaceSummary["dailyActivity"][number];

export interface MiniCalendarHeatmapProps {
  readonly activeDate: string;
  readonly todayDate: string;
  readonly dailyActivity: readonly DailyActivityEntry[];
  readonly onSelectDate: (date: string) => void;
  readonly className?: string | undefined;
}

function parseYearMonth(dateStr: string): { year: number; month: number } {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(dateStr);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    if (Number.isFinite(year) && Number.isFinite(month) && month >= 0 && month <= 11) {
      return { year, month };
    }
  }
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() };
}

function formatYmd(year: number, month: number, day: number): string {
  const m = String(month + 1).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${year}-${m}-${d}`;
}

function getHeatmapTone(nodeCount: number): string {
  if (nodeCount <= 0) return "";
  if (nodeCount <= 3) return "bg-primary/12 text-foreground";
  if (nodeCount <= 8) return "bg-primary/25 text-foreground font-medium";
  return "bg-primary/42 text-foreground font-semibold";
}

export function MiniCalendarHeatmap({
  activeDate,
  todayDate,
  dailyActivity,
  onSelectDate,
  className,
}: MiniCalendarHeatmapProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const { locale } = useInkadeLocale();

  const initial = parseYearMonth(activeDate);
  const [viewYear, setViewYear] = useState(initial.year);
  const [viewMonth, setViewMonth] = useState(initial.month);

  useEffect(() => {
    const next = parseYearMonth(activeDate);
    setViewYear(next.year);
    setViewMonth(next.month);
  }, [activeDate]);

  const activityByDate = useMemo(() => {
    const map = new Map<string, DailyActivityEntry>();
    for (const entry of dailyActivity) {
      map.set(entry.date, entry);
    }
    return map;
  }, [dailyActivity]);

  const monthLabel = useMemo(() => {
    const dt = new Date(Date.UTC(viewYear, viewMonth, 1));
    return new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "long",
      timeZone: "UTC",
    }).format(dt);
  }, [locale, viewMonth, viewYear]);

  const weekdayLabels = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale, { weekday: "narrow", timeZone: "UTC" });
    // Monday (2024-01-01) through Sunday (2024-01-07)
    return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(Date.UTC(2024, 0, i + 1))));
  }, [locale]);

  const calendarCells = useMemo(() => {
    const firstDayOfMonth = new Date(Date.UTC(viewYear, viewMonth, 1));
    const daysInMonth = new Date(Date.UTC(viewYear, viewMonth + 1, 0)).getUTCDate();
    // Monday = 0 ... Sunday = 6
    const startOffset = (firstDayOfMonth.getUTCDay() + 6) % 7;

    const cells: Array<{
      readonly key: string;
      readonly day: number | null;
      readonly dateStr: string | null;
    }> = [];

    for (let i = 0; i < startOffset; i++) {
      cells.push({ key: `pad-start-${i}`, day: null, dateStr: null });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = formatYmd(viewYear, viewMonth, d);
      cells.push({ key: dateStr, day: d, dateStr });
    }
    while (cells.length % 7 !== 0) {
      cells.push({ key: `pad-end-${cells.length}`, day: null, dateStr: null });
    }
    return cells;
  }, [viewMonth, viewYear]);

  const shiftMonth = (delta: number): void => {
    const next = new Date(Date.UTC(viewYear, viewMonth + delta, 1));
    setViewYear(next.getUTCFullYear());
    setViewMonth(next.getUTCMonth());
  };

  return (
    <div className={cn("flex w-full flex-col gap-2.5", className)}>
      <div className="flex items-center justify-between gap-1">
        <span className="text-xs font-semibold text-foreground">{monthLabel}</span>
        <div className="flex items-center gap-0.5">
          <Button
            aria-label={t("daily.prevMonth")}
            onClick={() => shiftMonth(-1)}
            size="icon-xs"
            variant="ghost"
          >
            <ChevronLeftIcon className="size-3.5" />
          </Button>
          <Button
            onClick={() => onSelectDate(todayDate)}
            size="xs"
            variant="ghost"
          >
            {t("daily.todayButton")}
          </Button>
          <Button
            aria-label={t("daily.nextMonth")}
            onClick={() => shiftMonth(1)}
            size="icon-xs"
            variant="ghost"
          >
            <ChevronRightIcon className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center">
        {weekdayLabels.map((label, idx) => (
          <span
            className="pb-0.5 text-[11px] font-medium text-muted-foreground"
            key={`${label}-${idx}`}
          >
            {label}
          </span>
        ))}

        {calendarCells.map((cell) => {
          if (!cell.day || !cell.dateStr) {
            return <span className="h-7" key={cell.key} />;
          }

          const activity = activityByDate.get(cell.dateStr);
          const nodeCount = activity?.nodeCount ?? 0;
          const openTaskCount = activity?.openTaskCount ?? 0;
          const isSelected = cell.dateStr === activeDate;
          const isToday = cell.dateStr === todayDate;

          return (
            <button
              className={cn(
                "relative inline-flex h-7 w-full cursor-pointer items-center justify-center rounded-md text-xs tabular-nums transition-colors hover:bg-accent",
                getHeatmapTone(nodeCount),
                isToday && !isSelected && "border border-foreground/30 font-medium text-foreground",
                isSelected && "bg-foreground text-background font-medium hover:bg-foreground/90",
              )}
              key={cell.key}
              onClick={() => onSelectDate(cell.dateStr!)}
              title={t("daily.heatmapDayTooltip", {
                date: cell.dateStr,
                nodes: nodeCount,
                open: openTaskCount,
              })}
              type="button"
            >
              <span>{cell.day}</span>
              {openTaskCount > 0 && (
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute right-1 bottom-0.5 size-1.5 rounded-full",
                    isSelected ? "bg-warning" : "bg-warning",
                  )}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Heatmap Legend */}
      <div className="flex items-center justify-between pt-0.5 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-warning" />
          <span>{t("daily.heatmapHasOpenTodos")}</span>
        </span>
        <span className="inline-flex items-center gap-1">
          <span>{t("daily.heatmapLegendLess")}</span>
          <span className="size-2.5 rounded-[2.5px] border border-border bg-background" />
          <span className="size-2.5 rounded-[2.5px] bg-primary/15" />
          <span className="size-2.5 rounded-[2.5px] bg-primary/28" />
          <span className="size-2.5 rounded-[2.5px] bg-primary/42" />
          <span>{t("daily.heatmapLegendMore")}</span>
        </span>
      </div>
    </div>
  );
}
