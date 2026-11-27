import {
  analyzeTaskTiming,
  formatScheduledStartMin,
  isValidTaskRecurrenceRule,
  parseScheduledTimeHm,
  slotForScheduledStartMin,
  TASK_DURATION_MINUTES,
  TASK_PRIORITIES,
  TASK_RECURRENCE_RULES,
  type Space,
  type TaskPriority,
  type UpdateTaskInput,
  type WorkspaceTaskItem,
} from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import {
  Badge,
  Button,
  cn,
  formatTaskDurationLabel,
  getTaskPriorityLabelKey,
  getTaskRecurrenceLabelKey,
  Input,
  Sheet,
  SheetFooter,
  SheetHeader,
  SheetPanel,
  SheetPopup,
  SheetTitle,
  SpaceIcon,
  TASK_PRIORITY_STYLES,
} from "@inkade/ui";
import {
  ArrowRightIcon,
  CalendarDaysIcon,
  ClockIcon,
  FileTextIcon,
  FlagIcon,
  RepeatIcon,
  Trash2Icon,
} from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import { resolveItemScheduledDate } from "./TaskItemCard.tsx";

export interface TaskDetailDrawerProps {
  readonly item: WorkspaceTaskItem | null;
  readonly open: boolean;
  readonly todayDate: string;
  readonly readonly?: boolean | undefined;
  readonly pending?: boolean | undefined;
  readonly deleting?: boolean | undefined;
  readonly space?: Space | undefined;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSave: (item: WorkspaceTaskItem, patch: UpdateTaskInput) => void | Promise<void>;
  readonly onDelete?: ((item: WorkspaceTaskItem) => void | Promise<void>) | undefined;
  readonly onJumpToContext?: ((item: WorkspaceTaskItem) => void) | undefined;
}

export function TaskDetailDrawer({
  item,
  open,
  todayDate,
  readonly = false,
  pending = false,
  deleting = false,
  space,
  onOpenChange,
  onSave,
  onDelete,
  onJumpToContext,
}: TaskDetailDrawerProps): React.ReactElement {
  const { t } = useInkadeTranslation();

  const [titleDraft, setTitleDraft] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [priorityDraft, setPriorityDraft] = useState<TaskPriority>("none");
  const [scheduledDateDraft, setScheduledDateDraft] = useState("");
  const [startTimeDraft, setStartTimeDraft] = useState("");
  const [durationDraft, setDurationDraft] = useState<number | null>(null);
  const [dueDateDraft, setDueDateDraft] = useState("");
  const [recurrenceDraft, setRecurrenceDraft] = useState("");
  const [recurrenceError, setRecurrenceError] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    setConfirmingDelete(false);
    if (!item || !open) return;
    setTitleDraft(item.node.contentText || item.node.contentMarkdown || "");
    setNoteDraft(item.node.noteMarkdown ?? "");
    setPriorityDraft(item.node.priority ?? "none");
    setScheduledDateDraft(resolveItemScheduledDate(item) ?? "");
    setStartTimeDraft(
      item.node.scheduledStartMin !== null && item.node.scheduledStartMin !== undefined
        ? formatScheduledStartMin(item.node.scheduledStartMin)
        : "",
    );
    setDurationDraft(item.node.durationMin ?? null);
    setDueDateDraft(item.node.dueDate ?? "");
    setRecurrenceDraft(item.node.recurrenceRule ?? "");
    setRecurrenceError(false);
  }, [item, open]);

  if (!item) {
    return (
      <Sheet onOpenChange={onOpenChange} open={false}>
        <SheetPopup side="right" />
      </Sheet>
    );
  }

  const isMarkdownEngine =
    item.sourceEngine === "markdown" ||
    item.document.kind === "article" ||
    item.document.kind === "clip";
  const sourceKind =
    item.document.kind ?? (isMarkdownEngine ? "article" : "outline");
  const sourceBadgeKey =
    sourceKind === "clip"
      ? "tasks.sourceBadgeClip"
      : sourceKind === "article"
        ? "tasks.sourceBadgeArticle"
        : "tasks.sourceBadgeOutline";

  const timing = analyzeTaskTiming(
    {
      checked: item.node.checked,
      scheduledDate: scheduledDateDraft || null,
      dueDate: dueDateDraft || null,
    },
    todayDate,
  );

  const handleSave = async (): Promise<void> => {
    if (readonly || pending) return;
    const trimmedRule = recurrenceDraft.trim();
    if (trimmedRule && !isValidTaskRecurrenceRule(trimmedRule)) {
      setRecurrenceError(true);
      return;
    }
    setRecurrenceError(false);

    const parsedStartMin = startTimeDraft ? parseScheduledTimeHm(startTimeDraft) : null;
    const nextScheduledDate = scheduledDateDraft || (parsedStartMin !== null ? todayDate : null);

    await onSave(item, {
      ...(titleDraft.trim() ? { title: titleDraft.trim(), contentMarkdown: titleDraft.trim() } : {}),
      ...(!isMarkdownEngine ? { noteMarkdown: noteDraft } : {}),
      priority: priorityDraft,
      scheduledDate: nextScheduledDate,
      scheduledStartMin: nextScheduledDate === null ? null : parsedStartMin,
      scheduledSlot:
        parsedStartMin !== null
          ? slotForScheduledStartMin(parsedStartMin)
          : nextScheduledDate === null
            ? null
            : (item.node.scheduledSlot ?? null),
      durationMin: durationDraft,
      dueDate: dueDateDraft || null,
      recurrenceRule: trimmedRule || null,
    });
    onOpenChange(false);
  };

  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetPopup side="right">
        <SheetHeader>
          <div className="flex flex-wrap items-center gap-2 pr-8">
            <SheetTitle>{t("tasks.detailTitle")}</SheetTitle>
            <Badge size="sm" variant="secondary">
              {t(sourceBadgeKey)}
            </Badge>
            {dueDateDraft && timing.deadlineStatus !== "none" && (
              <Badge
                size="sm"
                variant={
                  timing.deadlineStatus === "overdue"
                    ? "destructive"
                    : timing.deadlineStatus === "due_today"
                      ? "warning"
                      : "outline"
                }
              >
                {timing.deadlineStatus === "overdue" && timing.daysUntilDue !== null
                  ? t("tasks.dueOverdueDays", { days: Math.abs(timing.daysUntilDue) })
                  : timing.deadlineStatus === "due_today"
                    ? t("tasks.dueTodayBadge")
                    : timing.daysUntilDue !== null
                      ? t("tasks.dueInDays", { days: timing.daysUntilDue })
                      : dueDateDraft}
              </Badge>
            )}
          </div>
        </SheetHeader>

        <SheetPanel className="flex flex-col gap-4">
          {/* Title */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              {t("tasks.detailTitleLabel")}
            </label>
            <Input
              disabled={readonly || pending}
              onChange={(e) => setTitleDraft(e.target.value)}
              size="sm"
              value={titleDraft}
            />
          </div>

          {/* Priority */}
          <div className="flex flex-col gap-1.5">
            <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <FlagIcon className="size-3.5" />
              <span>{t("tasks.priorityLabel")}</span>
            </span>
            <div className="grid grid-cols-5 gap-1">
              {TASK_PRIORITIES.map((priority) => {
                const active = priorityDraft === priority;
                const style = TASK_PRIORITY_STYLES[priority];
                return (
                  <Button
                    className="px-1.5 text-xs"
                    disabled={readonly || pending}
                    key={priority}
                    onClick={() => setPriorityDraft(priority)}
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

          {/* Schedule Date & Start Time */}
          <div className="grid grid-cols-1 gap-3 rounded-lg border border-border/70 bg-muted/20 p-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
                <span className="flex items-center gap-1">
                  <CalendarDaysIcon className="size-3.5" />
                  <span>{t("tasks.scheduleSectionTitle")}</span>
                </span>
                {scheduledDateDraft && !readonly && (
                  <button
                    className="cursor-pointer text-[11px] hover:text-foreground"
                    onClick={() => {
                      setScheduledDateDraft("");
                      setStartTimeDraft("");
                    }}
                    type="button"
                  >
                    {t("tasks.whenAnytime")}
                  </button>
                )}
              </div>
              <Input
                aria-label={t("tasks.scheduleSectionTitle")}
                disabled={readonly || pending}
                onChange={(e) => setScheduledDateDraft(e.target.value)}
                size="sm"
                type="date"
                value={scheduledDateDraft}
              />
            </div>

            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
                <span className="flex items-center gap-1">
                  <ClockIcon className="size-3.5" />
                  <span>{t("tasks.startTimeLabel")}</span>
                </span>
                {startTimeDraft && !readonly && (
                  <button
                    className="cursor-pointer text-[11px] hover:text-foreground"
                    onClick={() => setStartTimeDraft("")}
                    type="button"
                  >
                    {t("tasks.startTimeClear")}
                  </button>
                )}
              </div>
              <Input
                aria-label={t("tasks.startTimeLabel")}
                className="font-mono"
                disabled={readonly || pending}
                onChange={(e) => setStartTimeDraft(e.target.value)}
                size="sm"
                type="time"
                value={startTimeDraft}
              />
            </div>

            <div className="flex flex-col gap-1 sm:col-span-2">
              <span className="text-xs font-medium text-muted-foreground">
                {t("tasks.durationLabel")}
              </span>
              <div className="grid grid-cols-6 gap-1">
                {TASK_DURATION_MINUTES.map((mins) => {
                  const active = durationDraft === mins;
                  return (
                    <Button
                      className="font-mono tabular-nums"
                      disabled={readonly || pending}
                      key={mins}
                      onClick={() => setDurationDraft(active ? null : mins)}
                      size="xs"
                      variant={active ? "secondary" : "outline"}
                    >
                      {formatTaskDurationLabel(mins, t)}
                    </Button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Deadline */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
              <span>{t("tasks.deadlineSectionTitle")}</span>
              {dueDateDraft && !readonly && (
                <button
                  className="cursor-pointer text-[11px] hover:text-foreground"
                  onClick={() => setDueDateDraft("")}
                  type="button"
                >
                  {t("tasks.deadlineClear")}
                </button>
              )}
            </div>
            <Input
              aria-label={t("tasks.deadlineSectionTitle")}
              disabled={readonly || pending}
              onChange={(e) => setDueDateDraft(e.target.value)}
              size="sm"
              type="date"
              value={dueDateDraft}
            />
          </div>

          {/* Recurrence & Custom RRULE */}
          <div className="flex flex-col gap-1.5">
            <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <RepeatIcon className="size-3.5" />
              <span>{t("tasks.recurrenceLabel")}</span>
            </span>
            <div className="flex flex-wrap gap-1">
              <Button
                className={!recurrenceDraft ? "border-border/80" : undefined}
                disabled={readonly || pending}
                onClick={() => {
                  setRecurrenceDraft("");
                  setRecurrenceError(false);
                }}
                size="xs"
                variant={!recurrenceDraft ? "secondary" : "outline"}
              >
                {t("tasks.recurrenceNone")}
              </Button>
              {TASK_RECURRENCE_RULES.map((rule) => {
                const active = recurrenceDraft === rule;
                return (
                  <Button
                    className={active ? "border-border/80" : undefined}
                    disabled={readonly || pending}
                    key={rule}
                    onClick={() => {
                      setRecurrenceDraft(active ? "" : rule);
                      setRecurrenceError(false);
                    }}
                    size="xs"
                    variant={active ? "secondary" : "outline"}
                  >
                    {t(getTaskRecurrenceLabelKey(rule))}
                  </Button>
                );
              })}
            </div>
            <Input
              aria-label={t("tasks.detailRecurrenceCustomLabel")}
              className="font-mono text-xs"
              disabled={readonly || pending}
              onChange={(e) => {
                setRecurrenceDraft(e.target.value);
                setRecurrenceError(false);
              }}
              placeholder={t("tasks.detailRecurrencePresetHint")}
              size="sm"
              value={recurrenceDraft}
            />
            {recurrenceError && (
              <span className="text-[11px] text-destructive">
                {t("tasks.detailRecurrencePresetHint")}
              </span>
            )}
          </div>

          {/* Notes */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              {t("tasks.detailNotesLabel")}
            </label>
            {isMarkdownEngine ? (
              <p className="rounded-md border border-border/60 bg-muted/35 p-2.5 text-xs text-muted-foreground">
                {t("tasks.detailMarkdownNoteHint")}
              </p>
            ) : (
              <textarea
                className="min-h-24 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                disabled={readonly || pending}
                onChange={(e) => setNoteDraft(e.target.value)}
                placeholder={t("tasks.detailNotesPlaceholder")}
                value={noteDraft}
              />
            )}
          </div>

          {/* Provenance Card */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 bg-muted/25 p-2.5 text-xs">
            <div className="flex min-w-0 items-center gap-2">
              {space && (
                <span className="inline-flex items-center gap-1 font-medium text-foreground">
                  <SpaceIcon color={space.color} icon={space.icon} size="xs" />
                  <span>{space.name}</span>
                </span>
              )}
              <span className="inline-flex min-w-0 items-center gap-1 text-muted-foreground">
                <FileTextIcon className="size-3.5 shrink-0" />
                <span className="truncate">{item.document.title}</span>
              </span>
            </div>
            {onJumpToContext && (
              <Button
                onClick={() => onJumpToContext(item)}
                size="xs"
                variant="outline"
              >
                <span>{t("tasks.jumpToContext")}</span>
                <ArrowRightIcon className="size-3" />
              </Button>
            )}
          </div>
        </SheetPanel>

        <SheetFooter>
          {!readonly && !isMarkdownEngine && onDelete && (
            <div className="mr-auto flex items-center gap-1.5">
              {confirmingDelete ? (
                <>
                  <Button
                    data-testid="task-detail-delete-confirm-btn"
                    disabled={pending || deleting}
                    loading={deleting}
                    onClick={() => {
                      void (async () => {
                        try {
                          await onDelete(item);
                          setConfirmingDelete(false);
                          onOpenChange(false);
                        } catch {
                          // Caller/mutation handles error toast and keeps drawer open
                        }
                      })();
                    }}
                    size="sm"
                    variant="destructive"
                  >
                    <Trash2Icon className="size-3.5" />
                    <span>{t("tasks.deleteTaskConfirm")}</span>
                  </Button>
                  <Button
                    disabled={pending || deleting}
                    onClick={() => setConfirmingDelete(false)}
                    size="sm"
                    variant="ghost"
                  >
                    {t("common.cancel")}
                  </Button>
                </>
              ) : (
                <Button
                  data-testid="task-detail-delete-btn"
                  disabled={pending || deleting}
                  onClick={() => setConfirmingDelete(true)}
                  size="sm"
                  variant="destructive-outline"
                >
                  <Trash2Icon className="size-3.5" />
                  <span>{t("tasks.deleteTask")}</span>
                </Button>
              )}
            </div>
          )}
          <Button onClick={() => onOpenChange(false)} size="sm" variant="ghost">
            {t("common.cancel")}
          </Button>
          {!readonly && (
            <Button
              disabled={!titleDraft.trim() || pending || deleting}
              onClick={() => void handleSave()}
              size="sm"
            >
              {t("tasks.detailSaveButton")}
            </Button>
          )}
        </SheetFooter>
      </SheetPopup>
    </Sheet>
  );
}
