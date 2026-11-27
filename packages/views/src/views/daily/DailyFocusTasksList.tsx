import type { TaskPriority } from "@inkade/core";
import {
  AdeThreadChip,
  Badge,
  Button,
  Checkbox,
  cn,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  formatTaskDurationLabel,
  getTaskPriorityLabelKey,
  getTaskRecurrenceLabelKey,
  TASK_PRIORITY_STYLES,
} from "@inkade/ui";
import {
  ArrowRightIcon,
  CalendarDaysIcon,
  CheckSquareIcon,
  FileTextIcon,
  FlagIcon,
  RepeatIcon,
  SendIcon,
} from "lucide-react";
import type React from "react";
import { TaskSchedulePopover } from "../../components/TaskSchedulePopover.tsx";
import type { DailyWorkspaceState } from "./useDailyWorkspace.ts";

export function DailyFocusTasksList({
  state,
}: {
  readonly state: DailyWorkspaceState;
}): React.ReactElement {
  const {
    t,
    navigation,
    isReadOnly,
    activeDate,
    todayStr,
    readerMeasure,
    dailyDoc,
    focusTasks,
    externalScheduledTasks,
    bindingsByNode,
    setFocusRootId,
    setViewMode,
    openDispatch,
    openBindingTarget,
    updateNodeMutation,
    updateTaskScheduleMutation,
    markBindingReadMutation,
  } = state;

  if (!dailyDoc || (focusTasks.length === 0 && externalScheduledTasks.length === 0)) {
    return (
      <Empty className="rounded-lg border border-dashed py-12">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CheckSquareIcon />
          </EmptyMedia>
          <EmptyTitle>{t("daily.viewModeTasks")}</EmptyTitle>
          <EmptyDescription>{t("daily.focusTasksEmpty")}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div
      className={cn(
        "mx-auto flex w-full flex-col divide-y divide-border/70 rounded-lg border border-border bg-background",
        readerMeasure === "full" ? "max-w-none" : "max-w-[740px]",
      )}
    >
      {[
        ...focusTasks.map((taskNode) => ({
          taskNode,
          nodeBindings: bindingsByNode.get(taskNode.id) ?? [],
          isExternal: false as const,
          sourceDocTitle: dailyDoc.title,
        })),
        ...externalScheduledTasks.map((ext) => ({
          taskNode: ext.node,
          nodeBindings: ext.bindings,
          isExternal: true as const,
          sourceDocTitle: ext.document.title,
        })),
      ].map(({ taskNode, nodeBindings, isExternal, sourceDocTitle }) => {
        const priority: TaskPriority = taskNode.priority ?? "none";
        const priorityStyle = TASK_PRIORITY_STYLES[priority];
        const effectiveSlot = taskNode.scheduledSlot ?? null;
        const effectiveDuration = taskNode.durationMin ?? null;
        const effectiveDate = taskNode.scheduledDate ?? activeDate;
        const hasDifferentDate =
          taskNode.scheduledDate !== undefined && taskNode.scheduledDate !== activeDate;

        return (
          <div
            className="relative flex items-start gap-3 px-3.5 py-2.5 pl-4.5 transition-colors hover:bg-muted/35"
            key={taskNode.id}
          >
            <span
              aria-hidden="true"
              className={cn(
                "pointer-events-none absolute inset-y-2 left-1.5 w-[3px] rounded-full",
                priorityStyle.barClass,
              )}
            />
            <div className="mt-0.5 shrink-0">
              <Checkbox
                checked={taskNode.checked === true}
                onCheckedChange={(checked) =>
                  updateNodeMutation.mutate({
                    nodeId: taskNode.id,
                    patch: { checked: Boolean(checked) },
                  })
                }
              />
            </div>
            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  "text-sm leading-snug",
                  taskNode.checked === true
                    ? "text-muted-foreground line-through"
                    : "font-medium text-foreground",
                )}
              >
                {taskNode.contentText || taskNode.contentMarkdown}
              </p>
              {taskNode.noteMarkdown && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {taskNode.noteText || taskNode.noteMarkdown}
                </p>
              )}
              {(priority !== "none" ||
                hasDifferentDate ||
                (effectiveSlot && effectiveSlot !== "today") ||
                effectiveDuration !== null ||
                taskNode.recurrenceRule ||
                isExternal ||
                nodeBindings.length > 0) && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {priority !== "none" && (
                    <span
                      className={cn(
                        "inline-flex h-5 items-center gap-1 rounded-md border px-1.5 text-[11px] font-semibold",
                        priorityStyle.pillClass,
                      )}
                    >
                      <FlagIcon className="size-2.5" />
                      <span>{t(getTaskPriorityLabelKey(priority, true))}</span>
                    </span>
                  )}
                  {hasDifferentDate && taskNode.scheduledDate && (
                    <Badge size="sm" variant="outline">
                      <CalendarDaysIcon className="size-3" />
                      <span className="font-mono">{taskNode.scheduledDate}</span>
                    </Badge>
                  )}
                  {effectiveSlot && effectiveSlot !== "today" && (
                    <Badge size="sm" variant="secondary">
                      {effectiveSlot === "morning"
                        ? t("tasks.slotMorning")
                        : effectiveSlot === "afternoon"
                          ? t("tasks.slotAfternoon")
                          : t("tasks.slotEvening")}
                    </Badge>
                  )}
                  {effectiveDuration !== null && effectiveDuration > 0 && (
                    <Badge className="font-mono tabular-nums" size="sm" variant="outline">
                      {formatTaskDurationLabel(effectiveDuration, t)}
                    </Badge>
                  )}
                  {taskNode.recurrenceRule && (
                    <Badge size="sm" variant="outline">
                      <RepeatIcon className="size-3" />
                      <span>{t(getTaskRecurrenceLabelKey(taskNode.recurrenceRule))}</span>
                    </Badge>
                  )}
                  {isExternal && (
                    <Badge size="sm" variant="outline">
                      <FileTextIcon className="size-3" />
                      <span className="max-w-32 truncate">{sourceDocTitle}</span>
                    </Badge>
                  )}
                  {nodeBindings.map((b) => (
                    <AdeThreadChip
                      binding={b}
                      compact
                      key={b.id}
                      onMarkRead={(binding) => markBindingReadMutation.mutate(binding.id)}
                      onOpenInAde={openBindingTarget}
                    />
                  ))}
                </div>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {!isReadOnly && taskNode.checked !== true && (
                <TaskSchedulePopover
                  compact
                  onUpdate={(patch) =>
                    updateTaskScheduleMutation.mutate({
                      nodeId: taskNode.id,
                      patch,
                    })
                  }
                  pending={
                    updateTaskScheduleMutation.isPending &&
                    updateTaskScheduleMutation.variables?.nodeId === taskNode.id
                  }
                  todayDate={todayStr}
                  value={{
                    scheduledDate: effectiveDate,
                    scheduledStartMin: taskNode.scheduledStartMin ?? null,
                    scheduledSlot: effectiveSlot,
                    durationMin: effectiveDuration,
                    priority: taskNode.priority ?? null,
                    recurrenceRule: taskNode.recurrenceRule ?? null,
                    dueDate: taskNode.dueDate ?? null,
                  }}
                />
              )}
              <Button
                onClick={() =>
                  openDispatch({
                    documentId: taskNode.documentId,
                    documentTitle: sourceDocTitle,
                    nodeId: taskNode.id,
                    excerpt: taskNode.contentText || taskNode.contentMarkdown,
                  })
                }
                size="xs"
                variant="ghost"
              >
                <SendIcon className="size-3.5" />
              </Button>
              <Button
                onClick={() => {
                  if (isExternal) {
                    navigation.openDocument(taskNode.documentId);
                  } else {
                    setFocusRootId(taskNode.id);
                    setViewMode("outline");
                  }
                }}
                size="xs"
                variant="ghost"
              >
                <ArrowRightIcon className="size-3.5" />
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
