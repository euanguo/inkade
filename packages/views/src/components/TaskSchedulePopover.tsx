import {
  defaultStartMinForSlot,
  formatScheduledStartMin,
  parseScheduledTimeHm,
  slotForScheduledStartMin,
  TASK_DURATION_MINUTES,
  TASK_PRIORITIES,
  TASK_RECURRENCE_RULES,
  TASK_SCHEDULE_SLOTS,
  type TaskPriority,
  type TaskRecurrenceRule,
  type TaskScheduleSlot,
} from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import {
  Button,
  cn,
  formatTaskDurationLabel,
  getTaskPriorityLabelKey,
  getTaskRecurrenceLabelKey,
  getTaskSlotLabelKey,
  Input,
  Popover,
  PopoverPopup,
  PopoverTrigger,
  TASK_PRIORITY_STYLES,
} from "@inkade/ui";
import {
  ArrowRightIcon,
  CalendarClockIcon,
  CalendarDaysIcon,
  ClockIcon,
  FlagIcon,
  InboxIcon,
  MoonIcon,
  RepeatIcon,
  SunIcon,
} from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import { computeDeferTargetDate } from "../lib/daily-studio.ts";
import { getTodayDailyDate } from "../lib/dates.ts";

export interface TaskScheduleValue {
  readonly scheduledDate: string | null;
  readonly scheduledSlot: TaskScheduleSlot | null;
  readonly scheduledStartMin?: number | null | undefined;
  readonly durationMin: number | null;
  readonly priority: TaskPriority | null;
  readonly recurrenceRule: TaskRecurrenceRule | null;
  readonly dueDate?: string | null | undefined;
}

export interface TaskSchedulePatch {
  readonly scheduledDate?: string | null | undefined;
  readonly scheduledSlot?: TaskScheduleSlot | null | undefined;
  readonly scheduledStartMin?: number | null | undefined;
  readonly durationMin?: number | null | undefined;
  readonly priority?: TaskPriority | null | undefined;
  readonly recurrenceRule?: TaskRecurrenceRule | null | undefined;
  readonly dueDate?: string | null | undefined;
}

export interface TaskSchedulePopoverProps {
  readonly value: TaskScheduleValue;
  readonly onUpdate: (patch: TaskSchedulePatch) => void | Promise<void>;
  readonly todayDate?: string | undefined;
  readonly pending?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  readonly open?: boolean | undefined;
  readonly onOpenChange?: ((open: boolean) => void) | undefined;
  readonly closeOnSelect?: boolean | undefined;
  readonly align?: "start" | "center" | "end" | undefined;
  readonly trigger?: React.ReactElement | undefined;
  readonly triggerAriaLabel?: string | undefined;
  readonly triggerClassName?: string | undefined;
  readonly compact?: boolean | undefined;
}

const START_TIME_PRESETS: readonly number[] = [9 * 60, 14 * 60, 19 * 60 + 30];

export function TaskSchedulePopover({
  value,
  onUpdate,
  todayDate,
  pending = false,
  disabled = false,
  open: controlledOpen,
  onOpenChange,
  closeOnSelect = true,
  align = "end",
  trigger,
  triggerAriaLabel,
  triggerClassName,
  compact = false,
}: TaskSchedulePopoverProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const todayStr = todayDate ?? getTodayDailyDate();
  const tomorrowDate = computeDeferTargetDate(todayStr, "tomorrow");
  const nextWeekDate = computeDeferTargetDate(todayStr, "next_monday");

  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;

  const setOpen = (next: boolean): void => {
    if (!isControlled) {
      setInternalOpen(next);
    }
    onOpenChange?.(next);
  };

  const [customDate, setCustomDate] = useState(value.scheduledDate ?? todayStr);
  const [customDueDate, setCustomDueDate] = useState(value.dueDate ?? "");
  const [customTime, setCustomTime] = useState(
    value.scheduledStartMin !== null && value.scheduledStartMin !== undefined
      ? formatScheduledStartMin(value.scheduledStartMin)
      : "",
  );

  useEffect(() => {
    if (open) {
      setCustomDate(value.scheduledDate ?? todayStr);
      setCustomDueDate(value.dueDate ?? "");
      setCustomTime(
        value.scheduledStartMin !== null && value.scheduledStartMin !== undefined
          ? formatScheduledStartMin(value.scheduledStartMin)
          : "",
      );
    }
  }, [open, todayStr, value.dueDate, value.scheduledDate, value.scheduledStartMin]);

  const applyPatch = (patch: TaskSchedulePatch, forceClose = closeOnSelect): void => {
    void onUpdate(patch);
    if (forceClose) {
      setOpen(false);
    }
  };

  const resolvedPriority: TaskPriority = value.priority ?? "none";
  const resolvedStartMin = value.scheduledStartMin ?? null;

  const defaultTrigger = (
    <Button
      aria-label={triggerAriaLabel ?? t("tasks.whenLabel")}
      className={cn(triggerClassName)}
      disabled={disabled || pending}
      size="xs"
      title={triggerAriaLabel ?? t("tasks.whenLabel")}
      variant="outline"
    >
      <CalendarClockIcon className="size-3.5" />
      {!compact && <span className="hidden sm:inline">{t("tasks.whenLabel")}</span>}
    </Button>
  );

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger render={trigger ?? defaultTrigger} />
      <PopoverPopup
        align={align}
        className="w-80"
        onClick={(e) => e.stopPropagation()}
        viewportClassName="gap-2.5 p-3"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-foreground">
            {t("tasks.scheduleSectionTitle")}
          </span>
          {value.scheduledDate !== null && (
            <button
              className="cursor-pointer text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
              disabled={disabled || pending}
              onClick={() =>
                applyPatch({ scheduledDate: null, scheduledSlot: null, scheduledStartMin: null })
              }
              type="button"
            >
              {t("tasks.whenClearToAnytime")}
            </button>
          )}
        </div>

        {/* Quick Schedule Presets */}
        <div className="grid grid-cols-2 gap-1">
          <Button
            className="justify-start"
            disabled={disabled || pending}
            onClick={() =>
              applyPatch({
                scheduledDate: todayStr,
                ...(value.scheduledSlot === null ? { scheduledSlot: "today" } : {}),
              })
            }
            size="xs"
            variant={value.scheduledDate === todayStr ? "secondary" : "ghost"}
          >
            <SunIcon className="size-3.5 text-amber-500" />
            <span className="flex-1 truncate text-left">{t("tasks.whenToday")}</span>
            <span className="font-mono text-[10px] text-muted-foreground">
              {todayStr.slice(5)}
            </span>
          </Button>
          <Button
            className="justify-start"
            disabled={disabled || pending}
            onClick={() =>
              applyPatch({
                scheduledDate: tomorrowDate,
              })
            }
            size="xs"
            variant={value.scheduledDate === tomorrowDate ? "secondary" : "ghost"}
          >
            <CalendarDaysIcon className="size-3.5 text-sky-500" />
            <span className="flex-1 truncate text-left">{t("tasks.whenTomorrow")}</span>
            <span className="font-mono text-[10px] text-muted-foreground">
              {tomorrowDate.slice(5)}
            </span>
          </Button>
          <Button
            className="justify-start"
            disabled={disabled || pending}
            onClick={() =>
              applyPatch({
                scheduledDate: nextWeekDate,
              })
            }
            size="xs"
            variant={value.scheduledDate === nextWeekDate ? "secondary" : "ghost"}
          >
            <ArrowRightIcon className="size-3.5 text-muted-foreground" />
            <span className="flex-1 truncate text-left">{t("tasks.whenNextWeek")}</span>
            <span className="font-mono text-[10px] text-muted-foreground">
              {nextWeekDate.slice(5)}
            </span>
          </Button>
          <Button
            className="justify-start"
            disabled={disabled || pending}
            onClick={() =>
              applyPatch({
                scheduledDate: null,
                scheduledSlot: null,
                scheduledStartMin: null,
              })
            }
            size="xs"
            variant={value.scheduledDate === null ? "secondary" : "ghost"}
          >
            <InboxIcon className="size-3.5 text-muted-foreground" />
            <span className="flex-1 truncate text-left">{t("tasks.whenAnytime")}</span>
          </Button>
        </div>

        {/* Custom Schedule Date */}
        <div className="flex items-center gap-1.5 border-t border-border/60 pt-2">
          <Input
            aria-label={t("tasks.whenCustomDate")}
            className="flex-1 text-xs"
            disabled={disabled || pending}
            onChange={(e) => setCustomDate(e.target.value)}
            size="xs"
            type="date"
            value={customDate}
          />
          <Button
            disabled={!customDate || disabled || pending}
            onClick={() =>
              applyPatch(
                {
                  scheduledDate: customDate,
                },
                true,
              )
            }
            size="xs"
            variant="secondary"
          >
            {t("common.confirm")}
          </Button>
        </div>

        {/* Start Time Presets & Picker */}
        <div className="flex flex-col gap-1 border-t border-border/60 pt-2">
          <div className="flex items-center justify-between text-[11px] font-medium text-muted-foreground">
            <span className="flex items-center gap-1">
              <ClockIcon className="size-3" />
              <span>{t("tasks.startTimeLabel")}</span>
            </span>
            {resolvedStartMin !== null && (
              <button
                className="cursor-pointer text-[10px] hover:text-foreground"
                disabled={disabled || pending}
                onClick={() => applyPatch({ scheduledStartMin: null }, false)}
                type="button"
              >
                {t("tasks.startTimeClear")}
              </button>
            )}
          </div>
          <div className="flex items-center gap-1">
            {START_TIME_PRESETS.map((mins) => {
              const label = formatScheduledStartMin(mins);
              const active = resolvedStartMin === mins;
              return (
                <Button
                  className="font-mono text-[11px] tabular-nums"
                  disabled={disabled || pending}
                  key={mins}
                  onClick={() =>
                    applyPatch(
                      {
                        ...(value.scheduledDate === null ? { scheduledDate: todayStr } : {}),
                        scheduledStartMin: active ? null : mins,
                        scheduledSlot: active ? value.scheduledSlot : slotForScheduledStartMin(mins),
                      },
                      false,
                    )
                  }
                  size="xs"
                  variant={active ? "secondary" : "outline"}
                >
                  {label}
                </Button>
              );
            })}
            <Input
              aria-label={t("tasks.startTimeLabel")}
              className="ml-auto w-24 font-mono text-xs"
              disabled={disabled || pending}
              onChange={(e) => {
                const next = e.target.value;
                setCustomTime(next);
                const mins = parseScheduledTimeHm(next);
                if (mins !== null) {
                  applyPatch(
                    {
                      ...(value.scheduledDate === null ? { scheduledDate: todayStr } : {}),
                      scheduledStartMin: mins,
                      scheduledSlot: slotForScheduledStartMin(mins),
                    },
                    false,
                  );
                }
              }}
              size="xs"
              type="time"
              value={customTime}
            />
          </div>
        </div>

        {/* Timeblock Slot Selector */}
        <div className="flex flex-col gap-1 border-t border-border/60 pt-2">
          <span className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
            <ClockIcon className="size-3" />
            <span>{t("tasks.slotLabel")}</span>
          </span>
          <div className="grid grid-cols-2 gap-1">
            {TASK_SCHEDULE_SLOTS.map((slot) => {
              const active = value.scheduledSlot === slot;
              return (
                <Button
                  className="justify-start"
                  disabled={disabled || pending}
                  key={slot}
                  onClick={() => {
                    const nextSlot = active ? null : slot;
                    applyPatch({
                      ...(value.scheduledDate === null && nextSlot !== null
                        ? { scheduledDate: todayStr }
                        : {}),
                      scheduledSlot: nextSlot,
                      ...(nextSlot !== null && resolvedStartMin === null && slot !== "today"
                        ? { scheduledStartMin: defaultStartMinForSlot(nextSlot) }
                        : {}),
                    });
                  }}
                  size="xs"
                  variant={active ? "secondary" : "ghost"}
                >
                  {slot === "morning" ? (
                    <SunIcon className="size-3 text-amber-500" />
                  ) : slot === "evening" ? (
                    <MoonIcon className="size-3 text-indigo-500" />
                  ) : (
                    <ClockIcon className="size-3 text-sky-500" />
                  )}
                  <span className="truncate">{t(getTaskSlotLabelKey(slot))}</span>
                </Button>
              );
            })}
          </div>
        </div>

        {/* Duration Presets */}
        <div className="flex flex-col gap-1 border-t border-border/60 pt-2">
          <div className="flex items-center justify-between text-[11px] font-medium text-muted-foreground">
            <span>{t("tasks.durationLabel")}</span>
            {value.durationMin !== null && (
              <button
                className="cursor-pointer text-[10px] hover:text-foreground"
                disabled={disabled || pending}
                onClick={() => applyPatch({ durationMin: null })}
                type="button"
              >
                {t("tasks.durationClear")}
              </button>
            )}
          </div>
          <div className="grid grid-cols-3 gap-1">
            {TASK_DURATION_MINUTES.map((mins) => {
              const active = value.durationMin === mins;
              return (
                <Button
                  className="font-mono tabular-nums"
                  disabled={disabled || pending}
                  key={mins}
                  onClick={() =>
                    applyPatch({
                      durationMin: active ? null : mins,
                    })
                  }
                  size="xs"
                  variant={active ? "secondary" : "outline"}
                >
                  {formatTaskDurationLabel(mins, t)}
                </Button>
              );
            })}
          </div>
        </div>

        {/* Deadline (Due Date) Section */}
        <div className="flex flex-col gap-1 border-t border-border/60 pt-2">
          <div className="flex items-center justify-between text-[11px] font-medium text-muted-foreground">
            <span>{t("tasks.deadlineSectionTitle")}</span>
            {(value.dueDate ?? null) !== null && (
              <button
                className="cursor-pointer text-[10px] hover:text-foreground"
                disabled={disabled || pending}
                onClick={() => {
                  setCustomDueDate("");
                  applyPatch({ dueDate: null }, false);
                }}
                type="button"
              >
                {t("tasks.deadlineClear")}
              </button>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <Input
              aria-label={t("tasks.deadlineSectionTitle")}
              className="flex-1 text-xs"
              disabled={disabled || pending}
              onChange={(e) => setCustomDueDate(e.target.value)}
              size="xs"
              type="date"
              value={customDueDate}
            />
            <Button
              disabled={!customDueDate || disabled || pending}
              onClick={() => applyPatch({ dueDate: customDueDate }, false)}
              size="xs"
              variant="outline"
            >
              {t("common.confirm")}
            </Button>
          </div>
        </div>

        {/* Priority Selector */}
        <div className="flex flex-col gap-1 border-t border-border/60 pt-2">
          <span className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
            <FlagIcon className="size-3" />
            <span>{t("tasks.priorityLabel")}</span>
          </span>
          <div className="grid grid-cols-5 gap-1">
            {TASK_PRIORITIES.map((priority) => {
              const active = resolvedPriority === priority;
              const style = TASK_PRIORITY_STYLES[priority];
              return (
                <Button
                  className="px-1.5 text-[11px]"
                  disabled={disabled || pending}
                  key={priority}
                  onClick={() => applyPatch({ priority })}
                  size="xs"
                  variant={active ? "secondary" : "ghost"}
                >
                  <span className={cn("size-2 shrink-0 rounded-full", style.dotClass)} />
                  <span className="truncate">
                    {priority === "none"
                      ? t("tasks.priorityNone").slice(0, 1)
                      : t(getTaskPriorityLabelKey(priority, true))}
                  </span>
                </Button>
              );
            })}
          </div>
        </div>

        {/* Recurrence Selector */}
        <div className="flex flex-col gap-1 border-t border-border/60 pt-2">
          <span className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
            <RepeatIcon className="size-3" />
            <span>{t("tasks.recurrenceLabel")}</span>
          </span>
          <div className="flex flex-wrap gap-1">
            <Button
              disabled={disabled || pending}
              onClick={() => applyPatch({ recurrenceRule: null })}
              size="xs"
              variant={value.recurrenceRule === null ? "secondary" : "ghost"}
            >
              {t("tasks.recurrenceNone")}
            </Button>
            {TASK_RECURRENCE_RULES.map((rule) => {
              const active = value.recurrenceRule === rule;
              return (
                <Button
                  disabled={disabled || pending}
                  key={rule}
                  onClick={() =>
                    applyPatch({
                      recurrenceRule: active ? null : rule,
                      ...(value.scheduledDate === null && !active
                        ? { scheduledDate: todayStr }
                        : {}),
                    })
                  }
                  size="xs"
                  variant={active ? "secondary" : "ghost"}
                >
                  {t(getTaskRecurrenceLabelKey(rule))}
                </Button>
              );
            })}
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
}
