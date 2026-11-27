import { useInkadeLocale, useInkadeTranslation } from "@inkade/i18n";
import { useMediaQuery } from "usehooks-ts";
import {
  extractInlineTags,
  formatScheduledStartMin,
  slotForScheduledStartMin,
  type CalendarEventInstance,
  type CalendarSubId,
  type Space,
  type TaskPriority,
  type TaskScheduleSlot,
  type WorkspaceTaskItem,
} from "@inkade/core";
import {
  useCreateCalendarSubscriptionMutation,
  useDeleteCalendarSubscriptionMutation,
  useInkadeCalendarEvents,
  useInkadeCalendarSubscriptions,
  useRefreshCalendarSubscriptionMutation,
  useUpdateCalendarSubscriptionMutation,
} from "@inkade/sdk/react";
import {
  Badge,
  Button,
  Checkbox,
  cn,
  formatTaskDurationLabel,
  getTaskPriorityLabelKey,
  getTaskSourceEngineBadgeKey,
  INKADE_MEDIA_QUERIES,
  Input,
  Popover,
  PopoverPopup,
  PopoverTrigger,
  SegmentedControl,
  SegmentedControlItem,
  Switch,
  TASK_PRIORITY_STYLES,
} from "@inkade/ui";
import {
  Calendar,
  type CalendarRef,
  type DatesSetInfo,
  type EventClickInfo,
  type EventDisplayInfo,
  type EventDropInfo,
  type EventInput,
  type EventReceiveInfo,
  type EventResizeDoneInfo,
} from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/react/daygrid";
import interactionPlugin, { Draggable } from "@fullcalendar/react/interaction";
import zhCnLocale from "@fullcalendar/react/locales/zh-cn";
import classicTheme from "@fullcalendar/react/themes/classic";
import timeGridPlugin from "@fullcalendar/react/timegrid";
import {
  CalendarDaysIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  GlobeIcon,
  InboxIcon,
  LockIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  resolveItemScheduledDate,
  stripTrailingHashTags,
} from "../components/TaskItemCard.tsx";
import {
  TaskSchedulePopover,
  type TaskSchedulePatch,
} from "../components/TaskSchedulePopover.tsx";
import { useInkadeViewsContext } from "../context.tsx";
import { formatAgendaWeekRange, formatDailyHeading, shiftDailyDate } from "../lib/dates.ts";

const START_HOUR = 6;
const END_HOUR = 22;

type CalendarViewType = "timeGridDay" | "timeGridWeek";

interface TaskCalendarEventExt {
  readonly kind: "task";
  readonly item: WorkspaceTaskItem;
  readonly priority: TaskPriority | null;
}

interface ExternalCalendarEventExt {
  readonly kind: "external";
  readonly instance: CalendarEventInstance;
  readonly subscriptionName: string;
}

type AgendaEventExt = TaskCalendarEventExt | ExternalCalendarEventExt;

export function slotForAgendaHour(hour: number): TaskScheduleSlot {
  return slotForScheduledStartMin(Math.round(hour * 60));
}

export interface PlacedAgendaBlock {
  readonly item: WorkspaceTaskItem;
  readonly startHour: number;
  readonly durationMin: number;
  readonly slot: TaskScheduleSlot;
  readonly laneIndex: number;
  readonly laneCount: number;
}

export function layoutAgendaBlocks(
  items: readonly WorkspaceTaskItem[],
  _activeDate: string,
  _anchors?: Readonly<Record<string, number>>,
): readonly PlacedAgendaBlock[] {
  const cursorBySlot: Record<"morning" | "afternoon" | "evening", number> = {
    morning: 9,
    afternoon: 13,
    evening: 19,
  };

  const preliminary: Array<{
    readonly item: WorkspaceTaskItem;
    readonly startHour: number;
    readonly endHour: number;
    readonly durationMin: number;
    readonly slot: TaskScheduleSlot;
  }> = [];

  for (const item of items) {
    const durationMin = item.node.durationMin ?? 30;
    const durationHours = Math.max(0.25, Math.min(8, durationMin / 60));
    const maxStart = END_HOUR + 0.5 - durationHours;

    if (item.node.scheduledStartMin !== undefined && item.node.scheduledStartMin !== null) {
      const clampedStart = Math.max(
        START_HOUR,
        Math.min(maxStart, item.node.scheduledStartMin / 60),
      );
      preliminary.push({
        item,
        startHour: clampedStart,
        endHour: clampedStart + durationHours,
        durationMin,
        slot: slotForScheduledStartMin(item.node.scheduledStartMin),
      });
      continue;
    }

    const slot = item.node.scheduledSlot ?? null;
    if (!slot || slot === "today") continue;

    const startHour = Math.max(START_HOUR, Math.min(maxStart, cursorBySlot[slot]));
    const slotLimit = slot === "morning" ? 12 : slot === "afternoon" ? 18 : 22.5;
    cursorBySlot[slot] = Math.min(slotLimit - 0.5, startHour + durationHours);

    preliminary.push({
      item,
      startHour,
      endHour: startHour + durationHours,
      durationMin,
      slot,
    });
  }

  preliminary.sort(
    (a, b) =>
      a.startHour - b.startHour || a.item.node.orderKey.localeCompare(b.item.node.orderKey),
  );

  const laneEnds: number[] = [];
  const laneAssignments: number[] = [];
  for (const block of preliminary) {
    let lane = laneEnds.findIndex((endTime) => endTime <= block.startHour + 0.01);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(block.endHour);
    } else {
      laneEnds[lane] = block.endHour;
    }
    laneAssignments.push(lane);
  }

  const totalLanes = Math.max(1, laneEnds.length);
  return preliminary.map((block, index) => ({
    item: block.item,
    startHour: block.startHour,
    durationMin: block.durationMin,
    slot: block.slot,
    laneIndex: laneAssignments[index] ?? 0,
    laneCount: totalLanes,
  }));
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function toLocalYmd(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function minutesToLocalIso(ymd: string, startMin: number, durationMin: number): {
  readonly start: string;
  readonly end: string;
} {
  const safeStart = Math.max(0, Math.min(23 * 60 + 45, Math.round(startMin)));
  const endTotal = Math.min(24 * 60, safeStart + Math.max(15, durationMin));
  const sHour = Math.floor(safeStart / 60);
  const sMin = safeStart % 60;
  const start = `${ymd}T${pad2(sHour)}:${pad2(sMin)}:00`;

  if (endTotal >= 24 * 60) {
    const nextDay = shiftDailyDate(ymd, 1);
    return { start, end: `${nextDay}T00:00:00` };
  }
  const eHour = Math.floor(endTotal / 60);
  const eMin = endTotal % 60;
  return { start, end: `${ymd}T${pad2(eHour)}:${pad2(eMin)}:00` };
}

function extractPatchFromEvent(
  eventStart: Date | null,
  eventEnd: Date | null,
  allDay: boolean,
  fallbackDurationMin: number | null,
): TaskSchedulePatch | null {
  if (!eventStart) return null;
  const scheduledDate = toLocalYmd(eventStart);
  if (allDay) {
    return {
      scheduledDate,
      scheduledStartMin: null,
      scheduledSlot: "today",
    };
  }
  const startMin = Math.max(
    0,
    Math.min(23 * 60 + 45, eventStart.getHours() * 60 + eventStart.getMinutes()),
  );
  const durationMin = eventEnd
    ? Math.max(15, Math.min(480, Math.round((eventEnd.getTime() - eventStart.getTime()) / 60000)))
    : (fallbackDurationMin ?? 30);
  return {
    scheduledDate,
    scheduledStartMin: startMin,
    scheduledSlot: slotForScheduledStartMin(startMin),
    durationMin,
  };
}

function priorityBorderClass(priority: TaskPriority | null): string {
  if (priority === "p1") return "border-l-[3px] border-l-red-500";
  if (priority === "p2") return "border-l-[3px] border-l-amber-500";
  if (priority === "p3") return "border-l-[3px] border-l-blue-500";
  return "";
}

function sourceBadgeVariant(engine: WorkspaceTaskItem["sourceEngine"], docKind: WorkspaceTaskItem["document"]["kind"]): "outline" | "secondary" {
  return engine === "markdown" || docKind === "clip" ? "secondary" : "outline";
}

function AnytimeTaskRow({
  item,
  todayDate,
  readonly,
  schedulePending,
  onToggleComplete,
  onUpdateSchedule,
  onOpenDetail,
}: {
  readonly item: WorkspaceTaskItem;
  readonly todayDate: string;
  readonly readonly: boolean;
  readonly schedulePending: boolean;
  readonly onToggleComplete: (item: WorkspaceTaskItem, nextChecked: boolean) => void;
  readonly onUpdateSchedule: (item: WorkspaceTaskItem, patch: TaskSchedulePatch) => void | Promise<void>;
  readonly onOpenDetail?: ((item: WorkspaceTaskItem) => void) | undefined;
}): React.ReactElement {
  const { t } = useInkadeTranslation();
  const priority = item.node.priority ?? null;
  const priorityStyle = priority ? TASK_PRIORITY_STYLES[priority] : null;
  const displayTitle = stripTrailingHashTags(
    item.node.contentText,
    extractInlineTags(item.node.contentMarkdown),
  );
  const taskTargetId = item.taskId ?? item.node.id;
  const isCompleted = item.node.checked === true;
  const engineKey = getTaskSourceEngineBadgeKey(item.sourceEngine, item.document.kind);

  return (
    <div
      className={cn(
        "group flex items-start gap-2 rounded-lg border border-border/75 bg-background px-2.5 py-2 text-xs shadow-2xs transition-colors duration-[var(--duration-micro)] hover:border-border",
        !readonly && "cursor-grab active:cursor-grabbing",
        priority && priorityBorderClass(priority),
      )}
      data-fc-duration-min={String(item.node.durationMin ?? 30)}
      data-fc-task-id={taskTargetId}
      data-fc-title={displayTitle}
    >
      <Checkbox
        aria-label={t("tasks.toggleTaskAria", { title: displayTitle })}
        checked={isCompleted}
        className="mt-0.5 shrink-0"
        disabled={readonly}
        onCheckedChange={(val) => onToggleComplete(item, val === true)}
      />
      <div className="min-w-0 flex-1">
        <button
          className="line-clamp-2 w-full cursor-pointer text-left text-xs font-medium text-foreground hover:text-primary"
          onClick={() => onOpenDetail?.(item)}
          type="button"
        >
          {displayTitle}
        </button>
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {priorityStyle && priority && (
            <Badge className={cn("h-4 px-1 text-[10px]", priorityStyle.pillClass)} size="sm" variant="outline">
              {t(getTaskPriorityLabelKey(priority))}
            </Badge>
          )}
          {item.sourceEngine === "markdown" && (
            <Badge
              className="h-4 px-1 text-[10px]"
              size="sm"
              variant={sourceBadgeVariant(item.sourceEngine, item.document.kind)}
            >
              {t(engineKey)}
            </Badge>
          )}
          {item.node.durationMin && (
            <Badge className="h-4 px-1 font-mono text-[10px]" size="sm" variant="secondary">
              {formatTaskDurationLabel(item.node.durationMin, t)}
            </Badge>
          )}
        </div>
      </div>
      {!readonly && (
        <div className="shrink-0 opacity-75 group-hover:opacity-100">
          <TaskSchedulePopover
            compact
            onUpdate={(patch) => onUpdateSchedule(item, patch)}
            pending={schedulePending}
            todayDate={todayDate}
            value={{
              scheduledDate: resolveItemScheduledDate(item),
              scheduledSlot: item.node.scheduledSlot ?? null,
              scheduledStartMin: item.node.scheduledStartMin ?? null,
              durationMin: item.node.durationMin ?? null,
              priority,
              recurrenceRule: item.node.recurrenceRule ?? null,
              dueDate: item.node.dueDate ?? null,
            }}
          />
        </div>
      )}
    </div>
  );
}

function CalendarSubscriptionsPopover({
  readonly,
}: {
  readonly readonly: boolean;
}): React.ReactElement {
  const { t } = useInkadeTranslation();
  const { notifier } = useInkadeViewsContext();
  const subscriptionsQuery = useInkadeCalendarSubscriptions();
  const createMutation = useCreateCalendarSubscriptionMutation();
  const updateMutation = useUpdateCalendarSubscriptionMutation();
  const deleteMutation = useDeleteCalendarSubscriptionMutation();
  const refreshMutation = useRefreshCalendarSubscriptionMutation();

  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [refreshingId, setRefreshingId] = useState<CalendarSubId | null>(null);

  const subscriptions = subscriptionsQuery.data ?? [];
  const enabledCount = subscriptions.filter((sub) => sub.enabled).length;

  const handleAdd = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    const trimmedName = name.trim();
    const trimmedUrl = url.trim();
    if (!trimmedName || !trimmedUrl || readonly) return;
    setInlineError(null);
    try {
      const res = await createMutation.mutateAsync({
        name: trimmedName,
        url: trimmedUrl,
      });
      notifier.success(
        t("tasks.agendaCalendarAddedToast", { count: res.syncedCount }),
      );
      setName("");
      setUrl("");
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : typeof err === "string"
            ? err
            : "";
      if (/private or reserved|loopback|local network|ssrf/i.test(msg)) {
        setInlineError(t("tasks.agendaSsrfHint"));
      } else {
        notifier.error(t("tasks.agendaCalendarActionFailed"), err);
      }
    }
  };

  const handleRefresh = async (id: CalendarSubId): Promise<void> => {
    setRefreshingId(id);
    try {
      const res = await refreshMutation.mutateAsync(id);
      notifier.success(
        t("tasks.agendaCalendarRefreshedToast", { count: res.syncedCount }),
      );
    } catch (err) {
      notifier.error(t("tasks.agendaCalendarActionFailed"), err);
    } finally {
      setRefreshingId(null);
    }
  };

  const handleDelete = async (id: CalendarSubId): Promise<void> => {
    try {
      await deleteMutation.mutateAsync(id);
      notifier.success(t("tasks.agendaCalendarRemovedToast"));
    } catch (err) {
      notifier.error(t("tasks.agendaCalendarActionFailed"), err);
    }
  };

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            className="gap-1.5"
            data-testid="agenda-calendars-trigger"
            size="xs"
            variant="outline"
          />
        }
      >
        <GlobeIcon className="size-3.5 text-muted-foreground" />
        <span>{t("tasks.agendaCalendarsButton")}</span>
        {enabledCount > 0 && (
          <Badge className="h-4 px-1 font-mono text-[10px] tabular-nums" size="sm" variant="secondary">
            {enabledCount}
          </Badge>
        )}
      </PopoverTrigger>
      <PopoverPopup align="end" className="w-80 p-3">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-foreground">
              {t("tasks.agendaCalendarsTitle")}
            </span>
            <Badge className="h-4 gap-1 px-1.5 text-[10px]" size="sm" variant="secondary">
              <LockIcon className="size-2.5" />
              <span>{t("tasks.agendaCalendarReadOnlyBadge")}</span>
            </Badge>
          </div>

          {subscriptions.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border/70 px-3 py-3 text-center text-xs text-muted-foreground">
              {t("tasks.agendaCalendarsEmpty")}
            </p>
          ) : (
            <div className="flex max-h-48 flex-col gap-1.5 overflow-y-auto">
              {subscriptions.map((sub) => (
                <div
                  className="flex flex-col gap-1 rounded-lg border border-border/70 bg-muted/20 px-2.5 py-2"
                  key={sub.id}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        aria-hidden="true"
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: sub.color }}
                      />
                      <span className="truncate text-xs font-medium text-foreground">
                        {sub.name}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Switch
                        aria-label={sub.name}
                        checked={sub.enabled}
                        disabled={readonly || updateMutation.isPending}
                        onCheckedChange={(checked) =>
                          void updateMutation.mutateAsync({
                            subscriptionId: sub.id,
                            input: { enabled: checked },
                          }).catch((err: unknown) =>
                            notifier.error(t("tasks.agendaCalendarActionFailed"), err),
                          )
                        }
                      />
                      <Button
                        aria-label={t("tasks.agendaCalendarSyncTooltip")}
                        disabled={refreshingId === sub.id}
                        onClick={() => void handleRefresh(sub.id)}
                        size="icon-xs"
                        title={t("tasks.agendaCalendarSyncTooltip")}
                        variant="ghost"
                      >
                        <RefreshCwIcon
                          className={cn(
                            "size-3",
                            refreshingId === sub.id && "animate-spin",
                          )}
                        />
                      </Button>
                      {!readonly && (
                        <Button
                          aria-label={t("tasks.agendaCalendarRemovedToast")}
                          disabled={deleteMutation.isPending}
                          onClick={() => void handleDelete(sub.id)}
                          size="icon-xs"
                          variant="ghost"
                        >
                          <Trash2Icon className="size-3 text-muted-foreground hover:text-destructive" />
                        </Button>
                      )}
                    </div>
                  </div>
                  {sub.lastError && (
                    <p className="truncate text-[10px] text-destructive" title={sub.lastError}>
                      {sub.lastError}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          {!readonly && (
            <form className="flex flex-col gap-1.5 border-t border-border/60 pt-2.5" onSubmit={(e) => void handleAdd(e)}>
              <Input
                onChange={(e) => setName(e.target.value)}
                placeholder={t("tasks.agendaCalendarNamePlaceholder")}
                size="sm"
                value={name}
              />
              <div className="flex items-center gap-1.5">
                <Input
                  className="min-w-0 flex-1"
                  onChange={(e) => {
                    setUrl(e.target.value);
                    if (inlineError) setInlineError(null);
                  }}
                  placeholder={t("tasks.agendaCalendarUrlPlaceholder")}
                  size="sm"
                  type="url"
                  value={url}
                />
                <Button
                  disabled={!name.trim() || !url.trim() || createMutation.isPending}
                  size="xs"
                  type="submit"
                >
                  {t("tasks.agendaCalendarAdd")}
                </Button>
              </div>
              {inlineError && (
                <p
                  className="rounded-md border border-amber-500/35 bg-amber-500/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-800 dark:text-amber-300"
                  role="alert"
                >
                  {inlineError}
                </p>
              )}
            </form>
          )}
        </div>
      </PopoverPopup>
    </Popover>
  );
}

export interface TasksAgendaViewProps {
  readonly tasks: readonly WorkspaceTaskItem[];
  readonly todayDate: string;
  readonly spacesById: ReadonlyMap<Space["id"], Space>;
  readonly readonly?: boolean | undefined;
  readonly schedulePendingNodeId?: WorkspaceTaskItem["node"]["id"] | null | undefined;
  readonly onToggleComplete: (item: WorkspaceTaskItem, nextChecked: boolean) => void;
  readonly onUpdateSchedule: (
    item: WorkspaceTaskItem,
    patch: TaskSchedulePatch,
  ) => void | Promise<void>;
  readonly onQuickAddToSlot?:
    | ((options: {
        readonly rawText: string;
        readonly scheduledDate?: string | null;
        readonly scheduledSlot?: TaskScheduleSlot | null;
        readonly scheduledStartMin?: number | null;
      }) => void)
    | undefined;
  readonly onJumpToContext?: ((item: WorkspaceTaskItem) => void) | undefined;
  readonly onOpenDetail?: ((item: WorkspaceTaskItem) => void) | undefined;
}

export function TasksAgendaView({
  tasks,
  todayDate,
  readonly = false,
  schedulePendingNodeId = null,
  onToggleComplete,
  onUpdateSchedule,
  onQuickAddToSlot,
  onOpenDetail,
}: TasksAgendaViewProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const { locale } = useInkadeLocale();
  const isMdUp = useMediaQuery(INKADE_MEDIA_QUERIES.md);

  const calendarRef = useRef<CalendarRef | null>(null);
  const anytimeRef = useRef<HTMLDivElement | null>(null);

  const [activeDate, setActiveDate] = useState(todayDate);
  const [calendarView, setCalendarView] = useState<CalendarViewType>("timeGridDay");
  const [visibleRange, setVisibleRange] = useState<{
    readonly start: string;
    readonly end: string;
  }>(() => ({
    start: `${shiftDailyDate(todayDate, -1)}T00:00:00Z`,
    end: `${shiftDailyDate(todayDate, 7)}T23:59:59Z`,
  }));
  const [quickDraft, setQuickDraft] = useState("");
  const [selectedExternal, setSelectedExternal] = useState<{
    readonly title: string;
    readonly calendarName: string;
    readonly location: string | null;
    readonly timeText: string;
  } | null>(null);

  const subscriptionsQuery = useInkadeCalendarSubscriptions();
  const eventsQuery = useInkadeCalendarEvents({
    start: visibleRange.start,
    end: visibleRange.end,
  });

  const subscriptionNamesById = useMemo(() => {
    const map = new Map<string, { readonly name: string; readonly color: string }>();
    for (const sub of subscriptionsQuery.data ?? []) {
      map.set(sub.id, { name: sub.name, color: sub.color });
    }
    return map;
  }, [subscriptionsQuery.data]);

  const tasksByTargetId = useMemo(() => {
    const map = new Map<string, WorkspaceTaskItem>();
    for (const item of tasks) {
      map.set(item.taskId ?? item.node.id, item);
      map.set(item.node.id, item);
    }
    return map;
  }, [tasks]);

  const anytimeTasks = useMemo(
    () =>
      tasks.filter(
        (item) => resolveItemScheduledDate(item) === null && item.node.checked !== true,
      ),
    [tasks],
  );

  const activeDayTasks = useMemo(() => {
    if (calendarView === "timeGridWeek") {
      const startYmd = visibleRange.start.slice(0, 10);
      const endYmd = visibleRange.end.slice(0, 10);
      return tasks.filter((item) => {
        const scheduledDate = resolveItemScheduledDate(item);
        return scheduledDate !== null && scheduledDate >= startYmd && scheduledDate < endYmd;
      });
    }
    return tasks.filter((item) => resolveItemScheduledDate(item) === activeDate);
  }, [activeDate, calendarView, tasks, visibleRange.end, visibleRange.start]);

  const totalPlannedMin = useMemo(
    () =>
      activeDayTasks.reduce(
        (acc, item) => acc + (item.node.checked ? 0 : (item.node.durationMin ?? 30)),
        0,
      ),
    [activeDayTasks],
  );

  const externalEvents = useMemo(
    () => eventsQuery.data ?? [],
    [eventsQuery.data],
  );

  const calendarEvents: EventInput[] = useMemo(() => {
    const result: EventInput[] = [];
    const scheduledByDate = new Map<string, WorkspaceTaskItem[]>();

    for (const item of tasks) {
      const scheduledDate = resolveItemScheduledDate(item);
      if (!scheduledDate) continue;
      const list = scheduledByDate.get(scheduledDate) ?? [];
      list.push(item);
      scheduledByDate.set(scheduledDate, list);
    }

    for (const [dateStr, dateItems] of scheduledByDate.entries()) {
      const slottedOrTimed = dateItems.filter(
        (item) =>
          (item.node.scheduledStartMin !== undefined && item.node.scheduledStartMin !== null) ||
          (item.node.scheduledSlot !== null &&
            item.node.scheduledSlot !== undefined &&
            item.node.scheduledSlot !== "today"),
      );
      const placedBlocks = layoutAgendaBlocks(slottedOrTimed, dateStr);
      const placedIds = new Set(placedBlocks.map((b) => b.item.taskId ?? b.item.node.id));

      for (const block of placedBlocks) {
        const item = block.item;
        const targetId = item.taskId ?? item.node.id;
        const priority = item.node.priority ?? null;
        const { start, end } = minutesToLocalIso(
          dateStr,
          Math.round(block.startHour * 60),
          block.durationMin,
        );
        result.push({
          id: `task:${targetId}`,
          title: stripTrailingHashTags(
            item.node.contentText,
            extractInlineTags(item.node.contentMarkdown),
          ),
          start,
          end,
          allDay: false,
          editable: !readonly,
          startEditable: !readonly,
          durationEditable: !readonly,
          className: [
            "inkade-fc-task-event",
            priorityBorderClass(priority),
            item.node.checked === true ? "opacity-55 line-through" : "",
          ]
            .filter(Boolean)
            .join(" "),
          extendedProps: {
            kind: "task",
            item,
            priority,
          } satisfies TaskCalendarEventExt,
        });
      }

      for (const item of dateItems) {
        const targetId = item.taskId ?? item.node.id;
        if (placedIds.has(targetId)) continue;
        const priority = item.node.priority ?? null;
        result.push({
          id: `task:${targetId}`,
          title: stripTrailingHashTags(
            item.node.contentText,
            extractInlineTags(item.node.contentMarkdown),
          ),
          start: dateStr,
          allDay: true,
          editable: !readonly,
          startEditable: !readonly,
          durationEditable: false,
          className: [
            "inkade-fc-task-event",
            priorityBorderClass(priority),
            item.node.checked === true ? "opacity-55 line-through" : "",
          ]
            .filter(Boolean)
            .join(" "),
          extendedProps: {
            kind: "task",
            item,
            priority,
          } satisfies TaskCalendarEventExt,
        });
      }
    }

    for (const ext of externalEvents) {
      const subMeta = subscriptionNamesById.get(ext.subscriptionId);
      const color = ext.color ?? subMeta?.color ?? "#64748b";
      result.push({
        id: `ext:${ext.id}`,
        title: ext.title,
        start: ext.startAt,
        end: ext.endAt,
        allDay: ext.allDay,
        editable: false,
        startEditable: false,
        durationEditable: false,
        backgroundColor: `${color}1f`,
        borderColor: `${color}80`,
        textColor: color,
        className: "inkade-fc-external-event",
        extendedProps: {
          kind: "external",
          instance: ext,
          subscriptionName: subMeta?.name ?? "",
        } satisfies ExternalCalendarEventExt,
      });
    }

    return result;
  }, [externalEvents, readonly, subscriptionNamesById, tasks]);

  useEffect(() => {
    const el = anytimeRef.current;
    if (!el || readonly || typeof window === "undefined") return;
    const draggable = new Draggable(el, {
      itemSelector: "[data-fc-task-id]",
      eventData: (draggedEl) => {
        const taskId = draggedEl.getAttribute("data-fc-task-id") ?? undefined;
        const title = draggedEl.getAttribute("data-fc-title") ?? "";
        const durationMin = Number(draggedEl.getAttribute("data-fc-duration-min")) || 30;
        return {
          ...(taskId ? { id: taskId } : {}),
          title,
          duration: { minutes: durationMin },
          create: true,
        };
      },
    });
    return () => {
      draggable.destroy();
    };
  }, [readonly]);

  const handleDatesSet = (info: DatesSetInfo): void => {
    const nextStart = info.startStr;
    const nextEnd = info.endStr;
    const nextCurrentDate = toLocalYmd(info.view.currentStart);
    setActiveDate((prev) => (prev === nextCurrentDate ? prev : nextCurrentDate));
    setVisibleRange((prev) =>
      prev.start === nextStart && prev.end === nextEnd
        ? prev
        : { start: nextStart, end: nextEnd },
    );
  };

  const handleSwitchView = (nextView: CalendarViewType): void => {
    setCalendarView(nextView);
    calendarRef.current?.getApi().changeView(nextView);
  };

  const handleEventReceive = (info: EventReceiveInfo): void => {
    const taskId =
      info.draggedEl.getAttribute("data-fc-task-id") ?? info.event.id;
    const item = tasksByTargetId.get(taskId);
    const patch = item
      ? extractPatchFromEvent(
          info.event.start,
          info.event.end,
          info.event.allDay,
          item.node.durationMin ?? 30,
        )
      : null;
    info.event.remove();
    if (!item || !patch) return;
    void onUpdateSchedule(item, patch);
  };

  const handleEventDrop = (info: EventDropInfo): void => {
    const ext = info.event.extendedProps as Partial<AgendaEventExt>;
    if (ext.kind !== "task" || !ext.item) {
      info.revert();
      return;
    }
    const patch = extractPatchFromEvent(
      info.event.start,
      info.event.end,
      info.event.allDay,
      ext.item.node.durationMin ?? 30,
    );
    if (!patch) {
      info.revert();
      return;
    }
    void Promise.resolve(onUpdateSchedule(ext.item, patch)).catch(() => {
      info.revert();
    });
  };

  const handleEventResize = (info: EventResizeDoneInfo): void => {
    const ext = info.event.extendedProps as Partial<AgendaEventExt>;
    if (ext.kind !== "task" || !ext.item || !info.event.start || !info.event.end) {
      info.revert();
      return;
    }
    const durationMin = Math.max(
      15,
      Math.min(
        480,
        Math.round((info.event.end.getTime() - info.event.start.getTime()) / 60000),
      ),
    );
    const patch: TaskSchedulePatch = {
      durationMin,
      scheduledDate: toLocalYmd(info.event.start),
      scheduledStartMin:
        info.event.start.getHours() * 60 + info.event.start.getMinutes(),
      scheduledSlot: slotForScheduledStartMin(
        info.event.start.getHours() * 60 + info.event.start.getMinutes(),
      ),
    };
    void Promise.resolve(onUpdateSchedule(ext.item, patch)).catch(() => {
      info.revert();
    });
  };

  const handleEventClick = (info: EventClickInfo): void => {
    const ext = info.event.extendedProps as Partial<AgendaEventExt>;
    if (ext.kind === "task" && ext.item) {
      onOpenDetail?.(ext.item);
      return;
    }
    if (ext.kind === "external" && ext.instance) {
      setSelectedExternal({
        title: ext.instance.title,
        calendarName: ext.subscriptionName ?? "",
        location: ext.instance.location ?? null,
        timeText: info.event.start
          ? formatScheduledStartMin(
              info.event.start.getHours() * 60 + info.event.start.getMinutes(),
            )
          : t("tasks.agendaUnscheduledForDay"),
      });
    }
  };

  const handleQuickSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    const trimmed = quickDraft.trim();
    if (!trimmed || !onQuickAddToSlot) return;
    onQuickAddToSlot({ rawText: trimmed, scheduledDate: null, scheduledSlot: null });
    setQuickDraft("");
  };

  const renderEventContent = (info: EventDisplayInfo): React.ReactElement => {
    const ext = info.event.extendedProps as Partial<AgendaEventExt>;
    if (ext.kind === "external") {
      return (
        <div className="flex min-w-0 items-center gap-1 px-1 py-0.5 text-[11px]">
          <LockIcon className="size-2.5 shrink-0 opacity-70" />
          <span className="min-w-0 flex-1 truncate font-medium">{info.event.title}</span>
        </div>
      );
    }
    const item = "item" in ext ? ext.item : undefined;
    const isCompleted = item?.node.checked === true;
    const isWeekView = info.view.type === "timeGridWeek";
    return (
      <div
        className={cn(
          "flex min-w-0 gap-1 px-1 py-0.5 text-[11px]",
          isWeekView ? "flex-col items-start justify-start" : "items-center justify-between",
        )}
      >
        <span
          className={cn(
            "min-w-0 truncate font-medium",
            isWeekView ? "w-full" : "flex-1",
            isCompleted && "line-through opacity-65",
          )}
        >
          {info.event.title}
        </span>
        {info.timeText && (
          <span
            className={cn(
              "font-mono text-[10px] opacity-75",
              isWeekView ? "w-full truncate" : "hidden shrink-0 sm:inline",
            )}
          >
            {info.timeText}
          </span>
        )}
      </div>
    );
  };

  return (
    <div
      className="flex min-w-0 flex-col gap-3 lg:flex-row"
      data-testid="tasks-agenda-view"
    >
      {/* Left Anytime Pool (below calendar on mobile so calendar renders above the fold) */}
      <aside
        className="order-2 flex min-w-0 flex-col gap-2 rounded-xl border border-border/75 bg-muted/25 p-3 lg:order-1 lg:w-72 lg:shrink-0"
        data-testid="agenda-anytime-rail"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <InboxIcon className="size-3.5 text-muted-foreground" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t("tasks.agendaAnytimeRail")}
            </h3>
          </div>
          <Badge className="tabular-nums" size="sm" variant="secondary">
            {anytimeTasks.length}
          </Badge>
        </div>

        <p className="hidden text-[11px] text-muted-foreground lg:block">
          {isMdUp ? t("tasks.agendaDropHint") : t("tasks.agendaTapHint")}
        </p>

        <div
          className="flex max-h-[420px] flex-1 flex-col gap-1.5 overflow-y-auto pr-0.5 lg:max-h-[580px]"
          ref={anytimeRef}
        >
          {anytimeTasks.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border/70 px-3 py-5 text-center text-xs text-muted-foreground">
              {t("tasks.agendaAnytimeEmpty")}
            </p>
          ) : (
            anytimeTasks.map((item) => (
              <AnytimeTaskRow
                item={item}
                key={item.node.id}
                onOpenDetail={onOpenDetail}
                onToggleComplete={onToggleComplete}
                onUpdateSchedule={onUpdateSchedule}
                readonly={readonly}
                schedulePending={schedulePendingNodeId === item.node.id}
                todayDate={todayDate}
              />
            ))
          )}
        </div>

        {!readonly && onQuickAddToSlot && (
          <form className="flex items-center gap-1.5 pt-1" onSubmit={handleQuickSubmit}>
            <Input
              className="flex-1"
              onChange={(e) => setQuickDraft(e.target.value)}
              placeholder={t("tasks.agendaQuickAddPlaceholder")}
              size="sm"
              value={quickDraft}
            />
            <Button
              aria-label={t("tasks.boardAddButton")}
              disabled={!quickDraft.trim()}
              size="icon-sm"
              type="submit"
            >
              <PlusIcon className="size-3.5" />
            </Button>
          </form>
        )}
      </aside>

      {/* Right FullCalendar v7 Day / Week + External ICS Overlay */}
      <div className="order-1 flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card lg:order-2">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-3.5 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <CalendarDaysIcon className="size-4 shrink-0 text-muted-foreground" />
            <h3 className="truncate text-sm font-semibold text-foreground">
              {calendarView === "timeGridWeek"
                ? formatAgendaWeekRange(visibleRange.start, visibleRange.end, locale)
                : formatDailyHeading(activeDate, locale)}
            </h3>
            <Badge className="hidden font-mono tabular-nums sm:inline-flex" size="sm" variant="secondary">
              {t("tasks.agendaPlannedSummary", {
                count: activeDayTasks.filter((item) => item.node.checked === false).length,
                minutes: totalPlannedMin,
              })}
            </Badge>
            {externalEvents.length > 0 && (
              <Badge className="hidden font-mono tabular-nums md:inline-flex" size="sm" variant="outline">
                {t("tasks.agendaExternalCount", { count: externalEvents.length })}
              </Badge>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <SegmentedControl size="sm">
              <SegmentedControlItem
                data-checked={calendarView === "timeGridDay" ? "" : undefined}
                onClick={() => handleSwitchView("timeGridDay")}
              >
                {t("tasks.agendaDayView")}
              </SegmentedControlItem>
              <SegmentedControlItem
                data-checked={calendarView === "timeGridWeek" ? "" : undefined}
                onClick={() => handleSwitchView("timeGridWeek")}
              >
                {t("tasks.agendaWeekView")}
              </SegmentedControlItem>
            </SegmentedControl>

            <CalendarSubscriptionsPopover readonly={readonly} />

            <div className="flex items-center gap-0.5">
              <Button
                aria-label={t("tasks.agendaPrevDay")}
                onClick={() => {
                  const api = calendarRef.current?.getApi();
                  if (api) {
                    api.prev();
                  } else {
                    setActiveDate((d) => shiftDailyDate(d, -1));
                  }
                }}
                size="icon-xs"
                variant="ghost"
              >
                <ChevronLeftIcon />
              </Button>
              <Button
                onClick={() => {
                  const api = calendarRef.current?.getApi();
                  if (api) {
                    api.today();
                  } else {
                    setActiveDate(todayDate);
                  }
                }}
                size="xs"
                variant={activeDate === todayDate ? "secondary" : "ghost"}
              >
                {t("tasks.agendaToday")}
              </Button>
              <Button
                aria-label={t("tasks.agendaNextDay")}
                onClick={() => {
                  const api = calendarRef.current?.getApi();
                  if (api) {
                    api.next();
                  } else {
                    setActiveDate((d) => shiftDailyDate(d, 1));
                  }
                }}
                size="icon-xs"
                variant="ghost"
              >
                <ChevronRightIcon />
              </Button>
            </div>
          </div>
        </header>
        {!isMdUp && (
          <p className="border-b border-border/60 bg-muted/20 px-3.5 py-1.5 text-[11px] text-muted-foreground">
            {t("tasks.agendaTapHint")}
          </p>
        )}

        {selectedExternal && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-muted/30 px-3.5 py-2 text-xs">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <LockIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate font-semibold text-foreground">
                {selectedExternal.title}
              </span>
              <Badge size="sm" variant="secondary">
                {t("tasks.agendaExternalEventMeta", {
                  calendar: selectedExternal.calendarName || t("tasks.agendaCalendarsButton"),
                })}
              </Badge>
              <span className="font-mono text-[11px] text-muted-foreground">
                {selectedExternal.timeText}
              </span>
              {selectedExternal.location && (
                <span className="truncate text-muted-foreground">
                  · {selectedExternal.location}
                </span>
              )}
            </div>
            <Button
              aria-label={t("common.close")}
              onClick={() => setSelectedExternal(null)}
              size="icon-xs"
              variant="ghost"
            >
              <XIcon className="size-3.5" />
            </Button>
          </div>
        )}

        <div className="inkade-fc-container min-w-0 p-2 sm:p-3">
          <Calendar
            allDaySlot
            allDayText={t("tasks.agendaAllDayShort")}
            datesSet={handleDatesSet}
            dayHeaderContent={(info) => {
              const datePart =
                info.monthText && info.dayNumberText
                  ? `${info.monthText}${info.dayNumberText}`
                  : info.dayNumberText;
              return info.weekdayText ? (
                <span className="inline-flex items-center gap-1.5 font-medium tabular-nums">
                  <span>{info.weekdayText}</span>
                  {datePart ? <span className="text-muted-foreground">{datePart}</span> : null}
                </span>
              ) : (
                <span>{info.text}</span>
              );
            }}
            droppable={!readonly}
            editable={!readonly}
            eventClick={handleEventClick}
            eventContent={renderEventContent}
            eventDrop={handleEventDrop}
            eventReceive={handleEventReceive}
            eventResize={handleEventResize}
            events={calendarEvents}
            headerToolbar={false}
            height={isMdUp ? 620 : "auto"}
            initialDate={todayDate}
            initialView={calendarView}
            locale={
              locale === "zh-CN"
                ? { ...zhCnLocale, timedText: t("tasks.agendaTimedSlot") }
                : { code: "en", timedText: t("tasks.agendaTimedSlot") }
            }
            nowIndicator
            plugins={[timeGridPlugin, dayGridPlugin, interactionPlugin, classicTheme]}
            ref={calendarRef}
            scrollTime="08:00:00"
            slotDuration="00:15:00"
            slotHeaderFormat={{ hour: "2-digit", minute: "2-digit", hour12: false }}
            slotMaxTime="22:30:00"
            slotMinTime="06:00:00"
            snapDuration="00:15:00"
          />
        </div>
      </div>
    </div>
  );
}
