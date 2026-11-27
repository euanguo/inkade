import {
  analyzeTaskTiming,
  extractInlineTags,
  formatScheduledStartMin,
  type AdeThreadBinding,
  type OutlineNodeId,
  type Space,
  type TaskPriority,
  type WorkspaceTaskItem,
} from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import {
  AdeThreadChip,
  Badge,
  Button,
  Checkbox,
  cn,
  formatTaskDurationLabel,
  getTaskPriorityLabelKey,
  getTaskRecurrenceLabelKey,
  getTaskSlotLabelKey,
  getTaskSourceEngineBadgeKey,
  SpaceIcon,
  TagList,
  TASK_PRIORITY_STYLES,
} from "@inkade/ui";
import {
  ArrowRightIcon,
  CalendarDaysIcon,
  CheckIcon,
  ChevronDownIcon,
  ClockIcon,
  FileTextIcon,
  FlagIcon,
  InboxIcon,
  ListChecksIcon,
  MoonIcon,
  PanelRightOpenIcon,
  RepeatIcon,
  SendIcon,
  SunIcon,
} from "lucide-react";
import type React from "react";
import { useState } from "react";
import { computeDeferTargetDate } from "../lib/daily-studio.ts";
import {
  TaskSchedulePopover,
  type TaskSchedulePatch,
} from "./TaskSchedulePopover.tsx";

export function stripTrailingHashTags(text: string, tags: readonly string[]): string {
  if (!text || tags.length === 0) return text;
  const tagSet = new Set(tags.map((tag) => tag.toLowerCase()));
  let result = text.trimEnd();
  while (result.length > 0) {
    const match = result.match(/(?:\s+|^)#([\p{L}\p{N}_/-]+)$/u);
    if (!match) break;
    const matchedTag = match[1];
    if (!matchedTag || !tagSet.has(matchedTag.toLowerCase())) break;
    result = result.slice(0, result.length - match[0].length).trimEnd();
  }
  return result.length > 0 ? result : text;
}

export function resolveItemScheduledDate(item: WorkspaceTaskItem): string | null {
  if (item.node.scheduledDate !== undefined) {
    return item.node.scheduledDate;
  }
  return item.document.dailyDate ?? null;
}

export interface TaskItemCardProps {
  readonly item: WorkspaceTaskItem;
  readonly todayDate: string;
  readonly space?: Space | undefined;
  readonly readonly?: boolean | undefined;
  readonly selected?: boolean | undefined;
  readonly checkedForBatch?: boolean | undefined;
  readonly selectionActive?: boolean | undefined;
  readonly recentlyCompleted?: boolean | undefined;
  readonly activeTagFilter?: string | undefined;
  readonly schedulePopoverOpen?: boolean | undefined;
  readonly onSchedulePopoverOpenChange?: ((open: boolean) => void) | undefined;
  readonly schedulePending?: boolean | undefined;
  readonly compact?: boolean | undefined;
  readonly draggable?: boolean | undefined;
  readonly isDragging?: boolean | undefined;
  readonly cardRef?: ((el: HTMLDivElement | null) => void) | undefined;
  readonly onSelectCard?: ((e: React.MouseEvent<HTMLDivElement>) => void) | undefined;
  readonly onToggleBatchSelect?: ((nodeId: OutlineNodeId, shiftKey: boolean) => void) | undefined;
  readonly onToggleComplete: (item: WorkspaceTaskItem, nextChecked: boolean) => void;
  readonly onToggleSubtask?: ((subtaskId: OutlineNodeId, nextChecked: boolean) => void) | undefined;
  readonly onUpdateSchedule: (
    item: WorkspaceTaskItem,
    patch: TaskSchedulePatch,
  ) => void | Promise<void>;
  readonly onDispatchAde?: ((item: WorkspaceTaskItem) => void) | undefined;
  readonly onJumpToContext?: ((item: WorkspaceTaskItem) => void) | undefined;
  readonly onOpenDetail?: ((item: WorkspaceTaskItem) => void) | undefined;
  readonly onClickTag?: ((tag: string) => void) | undefined;
  readonly onOpenBinding?: ((binding: AdeThreadBinding) => void) | undefined;
  readonly onMarkBindingRead?: ((binding: AdeThreadBinding) => void) | undefined;
}

export function TaskItemCard({
  item,
  todayDate,
  space,
  readonly = false,
  selected = false,
  checkedForBatch = false,
  selectionActive = false,
  recentlyCompleted = false,
  activeTagFilter,
  schedulePopoverOpen,
  onSchedulePopoverOpenChange,
  schedulePending = false,
  compact = false,
  draggable = false,
  isDragging = false,
  cardRef,
  onSelectCard,
  onToggleBatchSelect,
  onToggleComplete,
  onToggleSubtask,
  onUpdateSchedule,
  onDispatchAde,
  onJumpToContext,
  onOpenDetail,
  onClickTag,
  onOpenBinding,
  onMarkBindingRead,
}: TaskItemCardProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const [subtasksExpanded, setSubtasksExpanded] = useState(false);

  const effectivePriority: TaskPriority = item.node.priority ?? "none";
  const priorityStyle = TASK_PRIORITY_STYLES[effectivePriority];
  const effectiveScheduledDate = resolveItemScheduledDate(item);
  const effectiveStartMin = item.node.scheduledStartMin ?? null;
  const effectiveSlot = item.node.scheduledSlot ?? null;
  const effectiveDuration = item.node.durationMin ?? null;

  const isCompleted = item.node.checked === true;
  const timing = analyzeTaskTiming(
    {
      checked: item.node.checked,
      scheduledDate: effectiveScheduledDate,
      dueDate: item.node.dueDate ?? null,
    },
    todayDate,
  );
  const isOverdue =
    !isCompleted &&
    !item.node.rolledOverToDocId &&
    effectiveScheduledDate !== null &&
    effectiveScheduledDate < todayDate;
  const isToday = effectiveScheduledDate === todayDate;
  const tomorrowDate = computeDeferTargetDate(todayDate, "tomorrow");
  const isTomorrow = effectiveScheduledDate === tomorrowDate;

  const sourceBadgeKey = getTaskSourceEngineBadgeKey(
    item.sourceEngine,
    item.document.kind,
  );

  const inlineTags = extractInlineTags(item.node.contentMarkdown);
  const mergedTags = [...new Set([...inlineTags, ...item.document.tags])].slice(
    0,
    compact ? 2 : 4,
  );
  const rawTitle =
    item.node.contentText || item.node.contentMarkdown || t("common.untitled");
  const cleanTitle = stripTrailingHashTags(rawTitle, mergedTags);

  const subtasks = item.subtasks ?? [];
  const subtasksDone = subtasks.filter((sub) => sub.checked).length;

  const showHoverActions = !compact && !(selected || checkedForBatch || schedulePopoverOpen);

  const metadataRow = (
    <div
      className={cn(
        "flex min-w-0 max-w-full flex-wrap items-center gap-1.5",
        compact ? "mt-0.5" : "mt-1",
      )}
    >
      {effectivePriority !== "none" && (
        <span
          className={cn(
            "inline-flex h-5 items-center gap-1 rounded-md border px-1.5 text-[11px] font-semibold",
            priorityStyle.pillClass,
          )}
        >
          <FlagIcon className="size-2.5" />
          <span>{t(getTaskPriorityLabelKey(effectivePriority, true))}</span>
        </span>
      )}

      {effectiveScheduledDate ? (
        <Badge
          size="sm"
          variant={isOverdue ? "warning" : isToday ? "info" : "outline"}
        >
          <CalendarDaysIcon className="size-3" />
          <span className="font-mono">{effectiveScheduledDate}</span>
          {isToday && <span>· {t("tasks.todayBadge")}</span>}
          {isTomorrow && <span>· {t("tasks.tomorrowBadge")}</span>}
        </Badge>
      ) : (
        <Badge size="sm" variant="outline">
          <InboxIcon className="size-3 text-muted-foreground" />
          <span>{t("tasks.anytimeBadge")}</span>
        </Badge>
      )}

      {effectiveStartMin !== null && (
        <Badge className="font-mono tabular-nums" size="sm" variant="secondary">
          <ClockIcon className="size-3 text-primary" />
          <span>{formatScheduledStartMin(effectiveStartMin)}</span>
        </Badge>
      )}

      {effectiveSlot && effectiveSlot !== "today" && (
        <Badge size="sm" variant="secondary">
          {effectiveSlot === "morning" ? (
            <SunIcon className="size-3 text-amber-500" />
          ) : effectiveSlot === "evening" ? (
            <MoonIcon className="size-3 text-indigo-500" />
          ) : (
            <ClockIcon className="size-3 text-sky-500" />
          )}
          <span>
            {effectiveSlot === "evening" && isToday
              ? t("tasks.eveningBadge")
              : t(getTaskSlotLabelKey(effectiveSlot))}
          </span>
        </Badge>
      )}

      {effectiveDuration !== null && effectiveDuration > 0 && (
        <Badge className="font-mono tabular-nums" size="sm" variant="outline">
          <ClockIcon className="size-3" />
          <span>{formatTaskDurationLabel(effectiveDuration, t)}</span>
        </Badge>
      )}

      {item.node.recurrenceRule && (
        <Badge size="sm" variant="outline">
          <RepeatIcon className="size-3" />
          <span>{t(getTaskRecurrenceLabelKey(item.node.recurrenceRule))}</span>
        </Badge>
      )}

      {item.node.dueDate && (
        <Badge
          size="sm"
          variant={
            timing.deadlineStatus === "overdue"
              ? "destructive"
              : timing.deadlineStatus === "due_today"
                ? "warning"
                : timing.deadlineStatus === "due_soon"
                  ? "info"
                  : "outline"
          }
        >
          <span className="font-mono tabular-nums">
            {timing.deadlineStatus === "overdue" && timing.daysUntilDue !== null
              ? t("tasks.dueOverdueDays", { days: Math.abs(timing.daysUntilDue) })
              : timing.deadlineStatus === "due_today"
                ? t("tasks.dueTodayBadge")
                : timing.deadlineStatus === "due_soon" && timing.daysUntilDue !== null
                  ? t("tasks.dueInDays", { days: timing.daysUntilDue })
                  : t("tasks.dueBadge", { date: item.node.dueDate })}
          </span>
        </Badge>
      )}

      {subtasks.length > 0 && (
        <button
          aria-expanded={subtasksExpanded}
          aria-label={t("tasks.expandSubtasksAria")}
          className="inline-flex h-5 cursor-pointer items-center gap-1 rounded-md border border-border/80 bg-muted/45 px-1.5 font-mono text-[11px] font-medium text-foreground/85 tabular-nums transition-colors hover:bg-muted"
          onClick={(e) => {
            e.stopPropagation();
            setSubtasksExpanded((prev) => !prev);
          }}
          type="button"
        >
          <ListChecksIcon className="size-3" />
          <span>
            {t("tasks.subtasksProgress", {
              done: subtasksDone,
              total: subtasks.length,
            })}
          </span>
          <ChevronDownIcon
            className={cn(
              "size-3 transition-transform duration-[var(--duration-micro)]",
              subtasksExpanded && "rotate-180",
            )}
          />
        </button>
      )}

      {space && !compact && (
        <span className="inline-flex items-center gap-1 rounded-md border bg-muted/40 px-1.5 py-0.5 text-[11px] font-medium text-foreground/85">
          <SpaceIcon color={space.color} icon={space.icon} size="xs" />
          <span className="max-w-28 truncate">{space.name}</span>
        </span>
      )}

      <button
        className={cn(
          "inline-flex min-w-0 max-w-full cursor-pointer items-center gap-1 overflow-hidden rounded-md border border-border/75 bg-background/80 px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground",
          !compact && "sm:max-w-56",
        )}
        onClick={(e) => {
          e.stopPropagation();
          onJumpToContext?.(item);
        }}
        title={t("tasks.jumpToContext")}
        type="button"
      >
        <FileTextIcon className="size-3 shrink-0" />
        <span className="shrink-0 whitespace-nowrap rounded bg-muted px-1 py-px text-[10px] font-medium text-foreground/80">
          {t(sourceBadgeKey)}
        </span>
        <span className="min-w-0 flex-1 truncate">
          {compact && item.document.dailyDate ? item.document.dailyDate : item.document.title}
        </span>
      </button>

      {item.node.rolledOverToDocId && (
        <Badge size="sm" variant="secondary">
          {t("tasks.rescheduledBadge")}
        </Badge>
      )}

      {mergedTags.length > 0 && (
        <span
          className="min-w-16 max-w-full"
          onClick={(e) => e.stopPropagation()}
        >
          <TagList
            activeTag={activeTagFilter || undefined}
            formatOverflow={(count) => t("library.moreTagsCount", { count })}
            maxFallbackVisible={compact ? 2 : 4}
            onTagClick={(tag) => onClickTag?.(tag)}
            size="sm"
            tags={mergedTags}
          />
        </span>
      )}

      {item.bindings.map((binding) => (
        <AdeThreadChip
          binding={binding}
          compact
          key={binding.id}
          onMarkRead={onMarkBindingRead}
          onOpenInAde={onOpenBinding}
        />
      ))}
    </div>
  );

  const subtasksList =
    subtasksExpanded && subtasks.length > 0 ? (
      <div
        className="mt-2 ml-0.5 flex flex-col gap-1 border-l-2 border-border/70 pl-3"
        onClick={(e) => e.stopPropagation()}
      >
        {subtasks.map((sub) => (
          <button
            aria-pressed={sub.checked}
            className="flex cursor-pointer items-start gap-2 rounded-md px-1.5 py-1 text-left text-xs transition-colors hover:bg-muted/50 disabled:cursor-default"
            disabled={readonly || !onToggleSubtask}
            key={sub.id}
            onClick={() => onToggleSubtask?.(sub.id, !sub.checked)}
            type="button"
          >
            <span
              aria-hidden="true"
              className={cn(
                "mt-0.5 inline-flex size-3.5 shrink-0 items-center justify-center rounded-sm border",
                sub.checked
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-input bg-background",
              )}
            >
              {sub.checked && <CheckIcon className="size-2.5 stroke-[3]" />}
            </span>
            <span
              className={cn(
                "min-w-0 flex-1 break-words",
                sub.checked ? "text-muted-foreground line-through" : "text-foreground/90",
              )}
            >
              {sub.contentText || sub.contentMarkdown || t("common.untitled")}
            </span>
          </button>
        ))}
      </div>
    ) : null;

  return (
    <div
      className={cn(
        "group relative flex flex-col gap-1.5 overflow-hidden rounded-xl border transition-[border-color,background-color,opacity] duration-[var(--duration-micro)] focus:outline-none",
        compact
          ? effectivePriority !== "none"
            ? "p-2.5 pl-3"
            : "p-2.5"
          : effectivePriority !== "none"
            ? "px-3 py-2 pl-3"
            : "px-2.5 py-2",
        recentlyCompleted
          ? "border-border/60 bg-card opacity-55"
          : checkedForBatch
            ? "border-primary/65 bg-primary/[0.04]"
            : selected
              ? "border-primary/60 bg-accent/30"
              : "border-border bg-card hover:border-border/90",
        draggable && !readonly && "cursor-grab active:cursor-grabbing",
        isDragging && "border-primary/60 opacity-45",
      )}
      data-batch-selected={checkedForBatch ? "true" : undefined}
      data-selected={selected ? "true" : undefined}
      onClick={onSelectCard}
      onDoubleClick={onOpenDetail ? () => onOpenDetail(item) : undefined}
      ref={cardRef}
      tabIndex={onSelectCard ? -1 : undefined}
    >
      {/* Left semantic priority stripe — flush edge only when priority is explicitly set */}
      {effectivePriority !== "none" && (
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-y-1.5 left-0 w-[3px] rounded-r-full",
            priorityStyle.barClass,
          )}
        />
      )}

      <div className="flex items-start gap-2">
        {/* Batch multi-select toggle (distinct from completion checkbox to keep a11y & checkbox queries clean) */}
        {!readonly && onToggleBatchSelect && !compact && (
          <div
            className={cn(
              "mt-0.5 shrink-0",
              !(checkedForBatch || selectionActive) && "hidden sm:block",
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              aria-label={t("tasks.selectTaskAria", { title: cleanTitle })}
              aria-pressed={checkedForBatch}
              className={cn(
                "inline-flex size-4 cursor-pointer items-center justify-center rounded-full border transition-[opacity,border-color,background-color] duration-[var(--duration-micro)]",
                checkedForBatch
                  ? "border-primary bg-primary text-primary-foreground opacity-100"
                  : selectionActive
                    ? "border-input bg-background opacity-100 hover:border-foreground/40"
                    : "border-input bg-background opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
              )}
              data-slot="task-batch-select"
              onClick={(e) => onToggleBatchSelect(item.node.id, e.shiftKey)}
              type="button"
            >
              {checkedForBatch && <CheckIcon className="size-2.5 stroke-[3]" />}
            </button>
          </div>
        )}

        {/* Completion Checkbox */}
        <div className="mt-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
          <Checkbox
            aria-label={t("tasks.toggleTaskAria", { title: cleanTitle })}
            checked={isCompleted}
            disabled={readonly}
            onCheckedChange={(checked) => onToggleComplete(item, Boolean(checked))}
          />
        </div>

          {/* Main Content + Right Actions */}
        <div
          className={cn(
            "flex min-w-0 flex-1",
            compact
              ? "items-start justify-between gap-1.5"
              : "flex-col gap-2 sm:flex-row sm:items-start sm:justify-between",
          )}
        >
          <div className="min-w-0 flex-1">
          <p
            className={cn(
              "break-words text-sm leading-snug",
              isCompleted
                ? "text-muted-foreground line-through"
                : "font-medium text-foreground",
            )}
          >
            {cleanTitle}
          </p>
          {item.node.noteMarkdown && (
            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
              {item.node.noteText || item.node.noteMarkdown}
            </p>
          )}

          {!compact && metadataRow}
          {!compact && subtasksList}
        </div>

        {/* Right Actions */}
        <div
          className={cn(
            "flex shrink-0 flex-wrap items-center justify-end gap-1 self-end sm:self-start",
            showHoverActions &&
              "sm:opacity-0 sm:transition-opacity sm:duration-[var(--duration-micro)] sm:group-hover:opacity-100 sm:group-focus-within:opacity-100",
          )}
          onClick={(e) => e.stopPropagation()}
        >
          {!readonly && !isCompleted && !item.node.rolledOverToDocId && (
            <TaskSchedulePopover
              compact={compact}
              disabled={readonly}
              onOpenChange={onSchedulePopoverOpenChange}
              onUpdate={(patch) => onUpdateSchedule(item, patch)}
              open={schedulePopoverOpen}
              pending={schedulePending}
              todayDate={todayDate}
              value={{
                scheduledDate: effectiveScheduledDate,
                scheduledSlot: effectiveSlot,
                scheduledStartMin: effectiveStartMin,
                durationMin: effectiveDuration,
                priority: item.node.priority ?? null,
                recurrenceRule: item.node.recurrenceRule ?? null,
                dueDate: item.node.dueDate ?? null,
              }}
            />
          )}

          {onOpenDetail && !compact && (
            <Button
              aria-label={t("tasks.openDetailAria")}
              onClick={() => onOpenDetail(item)}
              size="xs"
              title={t("tasks.openDetailAria")}
              variant="ghost"
            >
              <PanelRightOpenIcon className="size-3.5" />
            </Button>
          )}

          {!readonly && onDispatchAde && !compact && (
            <Button
              aria-label={t("tasks.dispatchAde")}
              onClick={() => onDispatchAde(item)}
              size="xs"
              title={t("tasks.dispatchAde")}
              variant="ghost"
            >
              <SendIcon className="size-3.5" />
              <span className="hidden md:inline">{t("tasks.dispatchAde")}</span>
            </Button>
          )}

          {onJumpToContext && !compact && (
            <Button
              aria-label={t("tasks.jumpToContext")}
              onClick={() => onJumpToContext(item)}
              size="xs"
              title={t("tasks.jumpToContext")}
              variant="ghost"
            >
              <span className="hidden sm:inline">{t("tasks.jumpToContext")}</span>
              <ArrowRightIcon className="size-3.5" />
            </Button>
          )}
        </div>
        </div>
      </div>

      {compact && metadataRow}
      {compact && subtasksList}
    </div>
  );
}
