import type { TaskPriority, TaskScheduleSlot } from "@inkade/core";
import {
  ADE_STATUS_META,
  Badge,
  Button,
  Checkbox,
  cn,
  CopyButton,
  DailyReviewCard,
  DocumentKindIcon,
  formatTaskDurationLabel,
  getTaskRecurrenceLabelKey,
  Input,
  Skeleton,
  TagPill,
  TASK_PRIORITY_STYLES,
  ThinkingIndicator,
} from "@inkade/ui";
import {
  ClockIcon,
  EyeIcon,
  FileTextIcon,
  MoonIcon,
  RepeatIcon,
  SendHorizontalIcon,
  SunIcon,
} from "lucide-react";
import type React from "react";
import { TaskSchedulePopover } from "../../components/TaskSchedulePopover.tsx";
import { getAdeStatusLabel } from "./types.ts";
import type { DailyWorkspaceState } from "./useDailyWorkspace.ts";

export function DailyFocusRail({
  state,
}: {
  readonly state: DailyWorkspaceState;
}): React.ReactElement | null {
  const {
    t,
    navigation,
    hostActions,
    isReadOnly,
    activeDate,
    todayStr,
    focusRailOpen,
    dailyQuery,
    allDocsQuery,
    allBindingsQuery,
    dailyDoc,
    spaces,
    docsById,
    setViewMode,
    setHighlightedNodeId,
    focusRailTasks,
    scheduleBuckets,
    totalPlannedMinutes,
    pendingAdeBindings,
    unreadAgentDocsCount,
    createdTodayDocs,
    serendipityPicks,
    serendipitySectionRef,
    setSerendipitySeedOffset,
    quotingDocId,
    schedulePopoverTaskId,
    setSchedulePopoverTaskId,
    steeringDraftById,
    setSteeringDraftById,
    steeringModeById,
    setSteeringModeById,
    updateNodeMutation,
    updateTaskScheduleMutation,
    steerBindingMutation,
    handleQuoteToToday,
  } = state;

  if (!focusRailOpen) return null;

  const slotLabelByKey: Readonly<Record<TaskScheduleSlot, string>> = {
    morning: t("daily.scheduleSlotMorning"),
    afternoon: t("daily.scheduleSlotAfternoon"),
    evening: t("daily.scheduleSlotEvening"),
    today: t("daily.scheduleSlotToday"),
  };
  const slotOrder: readonly TaskScheduleSlot[] = ["morning", "afternoon", "evening", "today"];
  const hasScheduledBlocks =
    scheduleBuckets.morning.length > 0 ||
    scheduleBuckets.afternoon.length > 0 ||
    scheduleBuckets.evening.length > 0;
  const visibleSlots = hasScheduledBlocks
    ? slotOrder.filter((slot) => scheduleBuckets[slot].length > 0)
    : (["today"] as const);
  let remainingLimit = 10;

  return (
    <aside
      aria-label={t("daily.focusRailTitle")}
      className="flex w-full shrink-0 flex-col gap-4 lg:w-[296px]"
      data-testid="daily-focus-rail"
    >
      {/* Card 1: Today's Focus & Pending ADE */}
      <section className="flex flex-col gap-3 rounded-lg border border-border bg-background p-3.5">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t("daily.focusRailTitle")}
        </h2>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2 text-xs font-medium text-foreground">
            <span>{t("daily.focusOpenTasksLabel")}</span>
            <div className="flex items-center gap-1.5">
              {totalPlannedMinutes > 0 && (
                <Badge className="font-mono tabular-nums" size="sm" variant="secondary">
                  {t("daily.scheduleTotalMinutes", { minutes: totalPlannedMinutes })}
                </Badge>
              )}
              <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                {focusRailTasks.length}
              </span>
            </div>
          </div>

          {dailyQuery.isPending ? (
            <div className="flex flex-col gap-1.5">
              {["w-4/5", "w-2/3", "w-3/4"].map((wClass, idx) => (
                <div className="flex items-start gap-2 px-2 py-1.5" key={idx}>
                  <Skeleton className="mt-0.5 size-3.5 shrink-0 rounded-sm" />
                  <Skeleton className={`h-3.5 ${wClass}`} />
                </div>
              ))}
            </div>
          ) : focusRailTasks.length === 0 ? (
            <p className="text-xs text-muted-foreground/80">
              {t("daily.focusOpenTasksEmpty")}
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {visibleSlots.map((slotKey) => {
                if (remainingLimit <= 0) return null;
                const bucketTasks = scheduleBuckets[slotKey].slice(0, remainingLimit);
                remainingLimit -= bucketTasks.length;
                if (bucketTasks.length === 0) return null;

                return (
                  <div className="flex flex-col gap-1" key={slotKey}>
                    {hasScheduledBlocks && (
                      <div className="flex items-center gap-1 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {slotKey === "morning" && <SunIcon className="size-3 text-amber-500" />}
                        {slotKey === "afternoon" && <ClockIcon className="size-3 text-sky-500" />}
                        {slotKey === "evening" && <MoonIcon className="size-3 text-indigo-500" />}
                        <span>{slotLabelByKey[slotKey]}</span>
                      </div>
                    )}
                    {bucketTasks.map((railEntry) => {
                      const task = railEntry.node;
                      const activeSlot: TaskScheduleSlot | null = task.scheduledSlot ?? null;
                      const activeDuration = task.durationMin ?? null;
                      const priority: TaskPriority = task.priority ?? "none";
                      const priorityStyle = TASK_PRIORITY_STYLES[priority];
                      const hasExplicitSchedule = activeSlot !== null || activeDuration !== null;

                      return (
                        <div
                          className="group relative flex items-start gap-2 rounded-lg py-1.5 pr-1.5 pl-2.5 transition-colors hover:bg-accent/70"
                          key={task.id}
                        >
                          {priority !== "none" && (
                            <span
                              aria-hidden="true"
                              className={cn(
                                "pointer-events-none absolute inset-y-1.5 left-0.5 w-[2.5px] rounded-full",
                                priorityStyle.barClass,
                              )}
                            />
                          )}
                          <div className="mt-0.5 shrink-0">
                            <Checkbox
                              checked={false}
                              onCheckedChange={(checked) =>
                                updateNodeMutation.mutate({
                                  nodeId: task.id,
                                  patch: { checked: Boolean(checked) },
                                })
                              }
                            />
                          </div>
                          <button
                            className="min-w-0 flex-1 cursor-pointer text-left text-xs leading-snug text-foreground/90 hover:text-primary"
                            onClick={() => {
                              if (railEntry.isExternal) {
                                navigation.openDocument(task.documentId);
                              } else {
                                setHighlightedNodeId(task.id);
                                setViewMode("outline");
                              }
                            }}
                            title={t("daily.jumpToNode")}
                            type="button"
                          >
                            <span className="line-clamp-2">
                              {task.contentText || task.contentMarkdown}
                            </span>
                            {(railEntry.isExternal || task.recurrenceRule) && (
                              <span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                                {task.recurrenceRule && (
                                  <span className="inline-flex items-center gap-0.5">
                                    <RepeatIcon className="size-2.5" />
                                    <span>{t(getTaskRecurrenceLabelKey(task.recurrenceRule))}</span>
                                  </span>
                                )}
                                {railEntry.isExternal && (
                                  <span className="truncate">{railEntry.documentTitle}</span>
                                )}
                              </span>
                            )}
                          </button>
                          {!isReadOnly && (
                            <TaskSchedulePopover
                              align="end"
                              onOpenChange={(open) =>
                                setSchedulePopoverTaskId(open ? task.id : null)
                              }
                              onUpdate={(patch) =>
                                updateTaskScheduleMutation.mutate({
                                  nodeId: task.id,
                                  patch,
                                })
                              }
                              open={schedulePopoverTaskId === task.id}
                              pending={
                                updateTaskScheduleMutation.isPending &&
                                updateTaskScheduleMutation.variables?.nodeId === task.id
                              }
                              todayDate={todayStr}
                              trigger={
                                <button
                                  aria-label={t("daily.schedulePickAria")}
                                  className={cn(
                                    "inline-flex shrink-0 cursor-pointer items-center gap-0.5 rounded px-1 py-0.5 font-mono text-[10px] transition-opacity",
                                    hasExplicitSchedule
                                      ? "bg-muted text-foreground"
                                      : "text-muted-foreground opacity-0 group-hover:opacity-100",
                                  )}
                                  title={t("daily.schedulePickAria")}
                                  type="button"
                                >
                                  <ClockIcon className="size-2.5" />
                                  {activeDuration !== null && activeDuration > 0 && (
                                    <span>{formatTaskDurationLabel(activeDuration, t)}</span>
                                  )}
                                </button>
                              }
                              value={{
                                scheduledDate: task.scheduledDate ?? activeDate,
                                scheduledStartMin: task.scheduledStartMin ?? null,
                                scheduledSlot: activeSlot,
                                durationMin: activeDuration,
                                priority: task.priority ?? null,
                                recurrenceRule: task.recurrenceRule ?? null,
                                dueDate: task.dueDate ?? null,
                              }}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Pending / Active ADE Threads */}
        <div className="flex flex-col gap-1.5 border-t pt-3">
          <div className="flex items-center justify-between text-xs font-medium text-foreground">
            <span>{t("daily.focusPendingAdeLabel")}</span>
            <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
              {pendingAdeBindings.length}
            </span>
          </div>
          {allBindingsQuery.isPending ? (
            <div className="flex flex-col divide-y divide-border/60">
              {[0, 1].map((idx) => (
                <div className="flex flex-col gap-1.5 py-2 first:pt-0 last:pb-0" key={idx}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-1 items-center gap-1.5">
                      <Skeleton className="size-1.5 shrink-0 rounded-full" />
                      <Skeleton className="h-3.5 w-32" />
                    </div>
                    <Skeleton className="h-4 w-14 shrink-0 rounded-full" />
                  </div>
                  <Skeleton className="h-3 w-24" />
                </div>
              ))}
            </div>
          ) : allBindingsQuery.isError ? (
            <div className="flex flex-col items-start gap-1.5">
              <p className="text-xs text-destructive-foreground">
                {t("daily.focusRailLoadFailed")}
              </p>
              <Button
                onClick={() => void allBindingsQuery.refetch()}
                size="xs"
                variant="outline"
              >
                {t("common.retry")}
              </Button>
            </div>
          ) : pendingAdeBindings.length === 0 ? (
            <p className="text-xs text-muted-foreground/80">
              {t("daily.focusPendingAdeEmpty")}
            </p>
          ) : (
            <div className="flex flex-col divide-y divide-border/60">
              {pendingAdeBindings.slice(0, 6).map((binding) => {
                const meta = ADE_STATUS_META[binding.status];
                const targetDoc = docsById.get(binding.documentId);
                const isCurrentDaily = binding.documentId === dailyDoc?.id;
                const isRunning = binding.status === "running";
                const steeringDraft = steeringDraftById[binding.id] ?? "";
                const steeringMode = steeringModeById[binding.id] ?? "queued";

                return (
                  <div
                    className="flex flex-col gap-2 py-2 first:pt-0 last:pb-0"
                    key={binding.id}
                  >
                    <button
                      className="flex w-full cursor-pointer flex-col gap-1 text-left transition-colors hover:text-primary"
                      onClick={() => {
                        if (isCurrentDaily && binding.nodeId) {
                          setHighlightedNodeId(binding.nodeId);
                          setViewMode("outline");
                          hostActions.syncInspectorTarget?.({
                            document: dailyDoc,
                            selectedNodeId: binding.nodeId,
                          });
                          hostActions.openInspectorTab?.("threads");
                        } else {
                          navigation.openDocument(binding.documentId);
                          hostActions.openInspectorTab?.("threads");
                        }
                      }}
                      title={t("daily.inspectAde")}
                      type="button"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex min-w-0 items-center gap-1.5 text-xs font-medium text-foreground">
                          <span
                            className={cn("size-1.5 shrink-0 rounded-full", meta.dotClassName)}
                          />
                          <span className="truncate">
                            {binding.title || targetDoc?.title || binding.externalThreadId}
                          </span>
                        </span>
                        <Badge size="sm" variant={meta.badgeVariant}>
                          {getAdeStatusLabel(binding.status, t)}
                        </Badge>
                      </div>
                      {targetDoc && (
                        <span className="truncate text-[11px] text-muted-foreground">
                          {targetDoc.title}
                        </span>
                      )}
                    </button>

                    {isRunning && (
                      <div className="flex flex-col gap-1.5 border-t border-border/60 pt-2">
                        <div className="flex items-center justify-between gap-1.5">
                          <ThinkingIndicator
                            showTimer
                            size="sm"
                            startedAt={binding.runningSince ?? binding.lastSyncedAt}
                          />
                          <Button
                            onClick={() =>
                              setSteeringModeById((prev) => ({
                                ...prev,
                                [binding.id]:
                                  steeringMode === "queued" ? "interrupt" : "queued",
                              }))
                            }
                            size="xs"
                            type="button"
                            variant="outline"
                          >
                            {steeringMode === "interrupt"
                              ? t("agentControl.steeringInterruptMode")
                              : t("agentControl.steeringQueueMode")}
                          </Button>
                        </div>
                        <div className="flex items-center gap-1">
                          <Input
                            className="flex-1 text-xs"
                            onChange={(e) =>
                              setSteeringDraftById((prev) => ({
                                ...prev,
                                [binding.id]: e.target.value,
                              }))
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && !e.shiftKey && steeringDraft.trim()) {
                                e.preventDefault();
                                steerBindingMutation.mutate({
                                  bindingId: binding.id,
                                  text: steeringDraft.trim(),
                                  mode: steeringMode,
                                });
                              }
                            }}
                            placeholder={t("agentControl.steeringPlaceholder")}
                            size="sm"
                            value={steeringDraft}
                          />
                          <Button
                            aria-label={t("agentControl.steeringSend")}
                            disabled={!steeringDraft.trim() || steerBindingMutation.isPending}
                            onClick={() =>
                              steerBindingMutation.mutate({
                                bindingId: binding.id,
                                text: steeringDraft.trim(),
                                mode: steeringMode,
                              })
                            }
                            size="icon-sm"
                            type="button"
                          >
                            <SendHorizontalIcon className="size-3.5" />
                          </Button>
                        </div>
                        {binding.steeringQueue && binding.steeringQueue.length > 0 && (
                          <div className="flex flex-col gap-1">
                            {binding.steeringQueue.slice(-2).map((note) => (
                              <div
                                className="flex items-center justify-between gap-1.5 rounded bg-muted/45 px-2 py-0.5 text-[10px]"
                                key={note.id}
                              >
                                <span className="truncate text-foreground/85">{note.text}</span>
                                <span className="shrink-0 text-muted-foreground">
                                  {note.deliveredAt
                                    ? t("agentControl.steeringDeliveredBadge")
                                    : note.mode === "interrupt"
                                      ? t("agentControl.steeringInterruptBadge")
                                      : t("agentControl.steeringQueuedBadge")}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {unreadAgentDocsCount > 0 && (
        <section className="flex flex-col gap-2 rounded-lg border border-border bg-background p-3.5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xs font-semibold text-foreground">
              {t("agentControl.reviewSummaryCardTitle")}
            </h2>
            <Badge className="tabular-nums" size="sm" variant="outline">
              {unreadAgentDocsCount}
            </Badge>
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {t("agentControl.reviewSummaryCardDesc", { count: unreadAgentDocsCount })}
          </p>
          <Button
            className="self-start"
            onClick={() => navigation.openInbox?.()}
            size="xs"
            type="button"
            variant="outline"
          >
            <EyeIcon className="size-3.5" />
            <span>{t("agentControl.reviewSummaryCardCta")}</span>
          </Button>
        </section>
      )}

      {/* Card 2: Created Today */}
      <section className="flex flex-col gap-2.5 rounded-lg border border-border bg-background p-3.5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t("daily.createdTodayTitle")}
          </h2>
          <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
            {createdTodayDocs.length}
          </span>
        </div>

        {allDocsQuery.isPending ? (
          <div className="flex flex-col gap-1.5">
            {["w-36", "w-28"].map((wClass, idx) => (
              <div className="flex flex-col gap-1 rounded-lg px-2 py-1.5" key={idx}>
                <Skeleton className={`h-3.5 ${wClass}`} />
                <Skeleton className="h-3 w-20" />
              </div>
            ))}
          </div>
        ) : allDocsQuery.isError ? (
          <div className="flex flex-col items-start gap-1.5">
            <p className="text-xs text-destructive-foreground">
              {t("daily.createdTodayLoadFailed")}
            </p>
            <Button
              onClick={() => void allDocsQuery.refetch()}
              size="xs"
              variant="outline"
            >
              {t("common.retry")}
            </Button>
          </div>
        ) : createdTodayDocs.length === 0 ? (
          <div className="flex items-center gap-2 py-1 text-xs text-muted-foreground/80">
            <FileTextIcon className="size-3.5 shrink-0 opacity-70" />
            <span>{t("daily.createdTodayEmpty")}</span>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {createdTodayDocs.map((item) => {
              const space = spaces.find((s) => s.id === item.spaceId);
              return (
                <div
                  className="flex items-start justify-between gap-1.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent/70"
                  key={item.id}
                >
                  <button
                    className="flex min-w-0 flex-1 cursor-pointer flex-col gap-1 text-left"
                    onClick={() => navigation.openDocument(item.id)}
                    type="button"
                  >
                    <div className="flex items-center gap-2">
                      <DocumentKindIcon kind={item.kind} size="xs" />
                      <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                        {item.title}
                      </span>
                    </div>
                    {(space || item.tags.length > 0) && (
                      <div className="flex flex-wrap items-center gap-1 pl-5">
                        {space && (
                          <span className="text-[10px] text-muted-foreground">
                            {space.name}
                          </span>
                        )}
                        {item.tags.slice(0, 2).map((tag) => (
                          <TagPill key={tag} size="sm" tag={tag} />
                        ))}
                      </div>
                    )}
                  </button>
                  <CopyButton
                    copiedLabel={t("common.copied")}
                    label={t("agentControl.dailyCopyWikilink")}
                    size="icon-xs"
                    value={`[[${item.title}]]`}
                  />
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div ref={serendipitySectionRef}>
        <DailyReviewCard
          items={serendipityPicks}
          loading={allDocsQuery.isPending}
          onOpenDoc={(docId) => navigation.openDocument(docId)}
          onQuoteToToday={(doc) => void handleQuoteToToday(doc)}
          onShuffle={() => setSerendipitySeedOffset((prev) => prev + 1)}
          quotingDocId={quotingDocId}
        />
      </div>
    </aside>
  );
}
