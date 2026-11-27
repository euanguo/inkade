import { Button, Checkbox, cn } from "@inkade/ui";
import { ArrowRightIcon, CheckSquareIcon, ChevronDownIcon, SparklesIcon } from "lucide-react";
import type React from "react";
import type { DailyWorkspaceState } from "./useDailyWorkspace.ts";

export function DailyTemplateOfferBanner({
  state,
}: {
  readonly state: DailyWorkspaceState;
}): React.ReactElement | null {
  const {
    t,
    showManualTemplateOffer,
    defaultDailyTemplate,
    dailyDoc,
    applyTemplateMutation,
    setDismissedTemplateDocIds,
  } = state;

  if (!showManualTemplateOffer || !defaultDailyTemplate || !dailyDoc) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/70 bg-muted/25 px-2.5 py-1 text-xs">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <SparklesIcon className="size-3.5 shrink-0" />
        <span>
          {t("daily.templateBannerTitle", { name: defaultDailyTemplate.name })}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <Button
          disabled={applyTemplateMutation.isPending}
          onClick={() => applyTemplateMutation.mutate(defaultDailyTemplate.id)}
          size="xs"
        >
          {t("daily.applyDefaultTemplate")}
        </Button>
        <Button
          onClick={() =>
            setDismissedTemplateDocIds((prev) => new Set(prev).add(dailyDoc.id))
          }
          size="xs"
          variant="ghost"
        >
          {t("outline.rolloverDismiss")}
        </Button>
      </div>
    </div>
  );
}

export function DailyQuietTriageStrip({
  state,
}: {
  readonly state: DailyWorkspaceState;
}): React.ReactElement | null {
  const {
    t,
    navigation,
    quietTriageTotal,
    pendingApprovalBindings,
    unreadAgentDocsCount,
    allConflicts,
    failedBindingsCount,
  } = state;

  if (quietTriageTotal <= 0) return null;

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/65 bg-muted/25 px-2.5 py-1 text-xs text-muted-foreground"
      data-testid="daily-quiet-triage-strip"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-foreground/60" />
        {pendingApprovalBindings.length > 0 && (
          <span className="font-medium text-foreground tabular-nums">
            {t("daily.quietTriageApprovals", {
              count: pendingApprovalBindings.length,
            })}
          </span>
        )}
        {unreadAgentDocsCount > 0 && (
          <span className="tabular-nums">
            {t("daily.quietTriageReviews", { count: unreadAgentDocsCount })}
          </span>
        )}
        {allConflicts.length > 0 && (
          <span className="tabular-nums">
            {t("daily.quietTriageConflicts", { count: allConflicts.length })}
          </span>
        )}
        {failedBindingsCount > 0 && (
          <span className="tabular-nums">
            {t("daily.quietTriageFailed", { count: failedBindingsCount })}
          </span>
        )}
      </div>
      <button
        className="inline-flex cursor-pointer items-center gap-1 font-medium text-foreground transition-colors hover:text-primary"
        onClick={() => navigation.openInbox?.()}
        type="button"
      >
        <span>{t("daily.quietTriageGoInbox")}</span>
        <ArrowRightIcon className="size-3" />
      </button>
    </div>
  );
}

export function DailyTodayTodosStrip({
  state,
}: {
  readonly state: DailyWorkspaceState;
}): React.ReactElement | null {
  const {
    t,
    dailyQuery,
    viewMode,
    focusTasks,
    openFocusTasks,
    todosExpanded,
    setTodosExpanded,
    dayDoneTasks,
    dayTotalTasks,
    updateNodeMutation,
    setHighlightedNodeId,
  } = state;

  if (dailyQuery.isPending || viewMode !== "outline" || focusTasks.length === 0) {
    return null;
  }

  return (
    <section
      className="border-b border-border/60 pb-2.5"
      data-testid="daily-today-todos"
    >
      <button
        aria-expanded={todosExpanded}
        aria-label={t("daily.toggleTodosAria")}
        className="flex w-full cursor-pointer items-center justify-between gap-3 py-1 text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
        onClick={() => setTodosExpanded((prev) => !prev)}
        type="button"
      >
        <span className="inline-flex min-w-0 items-center gap-2 font-medium text-foreground/90">
          <CheckSquareIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="shrink-0">{t("daily.todayTodosStripTitle")}</span>
          <span className="shrink-0 font-normal text-muted-foreground tabular-nums">
            · {t("daily.completedShort", { done: dayDoneTasks, total: dayTotalTasks })}
          </span>
          {dayTotalTasks > 0 && (
            <span
              aria-hidden="true"
              className="hidden h-1 w-16 overflow-hidden rounded-full bg-muted sm:inline-flex"
            >
              <span
                className="h-full rounded-full bg-primary transition-[width] duration-[var(--duration-micro)]"
                style={{
                  width: `${Math.min(100, Math.round((dayDoneTasks / dayTotalTasks) * 100))}%`,
                }}
              />
            </span>
          )}
        </span>
        <ChevronDownIcon
          className={cn(
            "size-3.5 shrink-0 transition-transform duration-[var(--duration-micro)]",
            todosExpanded && "rotate-180",
          )}
        />
      </button>
      {todosExpanded && openFocusTasks.length > 0 && (
        <div className="mt-1 flex flex-col gap-0.5 pl-0.5">
          {openFocusTasks.slice(0, 4).map((task) => (
            <div
              className="group flex items-center gap-2 rounded-md px-1.5 py-1 text-xs transition-colors hover:bg-muted/50"
              key={task.id}
            >
              <div className="shrink-0">
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
                className="min-w-0 flex-1 cursor-pointer truncate text-left text-foreground/90 hover:text-foreground"
                onClick={() => setHighlightedNodeId(task.id)}
                title={t("daily.jumpToNode")}
                type="button"
              >
                {task.contentText || task.contentMarkdown}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
