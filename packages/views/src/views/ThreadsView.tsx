import {
  ADE_STATUS_META,
  Badge,
  Button,
  cn,
  ConflictRadarBanner,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  formatAdeKindLabel,
  Input,
  SegmentedControl,
  SegmentedControlItem,
  Skeleton,
} from "@inkade/ui";
import {
  Maximize2Icon,
  MessageSquareCodeIcon,
  Minimize2Icon,
  SearchIcon,
} from "lucide-react";
import type React from "react";
import { ThreadBindingCard } from "./threads/ThreadBindingCard.tsx";
import { ThreadsConflictList } from "./threads/ThreadsConflictList.tsx";
import type {
  ThreadsViewMode,
  ThreadsViewProps,
  ThreadsViewUrlState,
} from "./threads/types.ts";
import { useThreadsWorkspace } from "./threads/useThreadsWorkspace.ts";
import { BriefingsPanel } from "../components/BriefingsPanel.tsx";

export type { ThreadsViewMode, ThreadsViewProps, ThreadsViewUrlState };

export function ThreadsView(props: ThreadsViewProps = {}): React.ReactElement {
  const state = useThreadsWorkspace(props);
  const {
    t,
    updatePreferences,
    canvasWidth,
    viewMode,
    setViewMode,
    kindFilter,
    setKindFilter,
    searchText,
    setSearchText,
    setFocusedConflictDocId,
    groupOrder,
    bindingsQuery,
    availableHostKinds,
    docTitlesRecord,
    conflicts,
    filteredBindings,
    grouped,
  } = state;

  return (
    <div className="flex w-full flex-col">
      <header
        className="flex w-full flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-background px-4 py-2.5 lg:px-6"
        data-testid="threads-header"
      >
        <div className="flex items-center gap-2">
          <h1 className="text-base font-semibold tracking-tight">{t("threads.title")}</h1>
          <Badge className="tabular-nums" size="sm" variant="secondary">
            {filteredBindings.length}
          </Badge>
        </div>

        <div className="flex items-center gap-2">
          <SegmentedControl size="sm">
            <SegmentedControlItem
              data-pressed={viewMode === "status" ? "" : undefined}
              onClick={() => {
                setFocusedConflictDocId(null);
                setViewMode("status");
              }}
            >
              {t("agentControl.threadsModeStatus")}
            </SegmentedControlItem>
            <SegmentedControlItem
              data-pressed={viewMode === "conflicts" ? "" : undefined}
              onClick={() => setViewMode("conflicts")}
            >
              <span>{t("agentControl.threadsModeConflicts")}</span>
              {conflicts.length > 0 && (
                <Badge className="ml-1 tabular-nums" size="sm" variant="warning">
                  {conflicts.length}
                </Badge>
              )}
            </SegmentedControlItem>
          </SegmentedControl>

          <Button
            aria-label={t("common.toggleCanvasWidthTitle")}
            aria-pressed={canvasWidth === "centered"}
            className="hidden sm:inline-flex"
            data-testid="workspace-width-toggle"
            onClick={() =>
              updatePreferences({
                layout: {
                  workspaceCanvasWidth: canvasWidth === "fluid" ? "centered" : "fluid",
                },
              })
            }
            size="icon-xs"
            title={
              canvasWidth === "fluid"
                ? `${t("common.toggleCanvasWidthTitle")} (${t("common.canvasWidthFluid")})`
                : `${t("common.toggleCanvasWidthTitle")} (${t("common.canvasWidthCentered")})`
            }
            variant={canvasWidth === "centered" ? "secondary" : "ghost"}
          >
            {canvasWidth === "fluid" ? (
              <Minimize2Icon className="size-3.5" />
            ) : (
              <Maximize2Icon className="size-3.5" />
            )}
          </Button>
        </div>
      </header>

      <div
        className={cn(
          "flex w-full flex-col gap-3 px-4 py-3 lg:px-6",
          canvasWidth === "centered" && "mx-auto max-w-[960px]",
        )}
        data-testid="threads-body-container"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex-1">
            <Input
              onChange={(e) => setSearchText(e.target.value)}
              placeholder={t("threads.searchPlaceholder")}
              size="sm"
              startAddon={<SearchIcon />}
              value={searchText}
            />
          </div>

          <SegmentedControl size="sm">
            <SegmentedControlItem
              data-pressed={kindFilter === "all" ? "" : undefined}
              onClick={() => setKindFilter("all")}
            >
              {t("common.all")}
            </SegmentedControlItem>
            {availableHostKinds.map((kind) => (
              <SegmentedControlItem
                data-pressed={kindFilter === kind ? "" : undefined}
                key={kind}
                onClick={() => setKindFilter(kind)}
              >
                {formatAdeKindLabel(kind, t)}
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
        </div>

        <ConflictRadarBanner
          conflicts={conflicts}
          documentTitlesById={docTitlesRecord}
          onCompare={(conflict) => {
            setFocusedConflictDocId(conflict.documentId);
            setViewMode("conflicts");
          }}
          onSelectBinding={(bindingId) => {
            const target = bindingsQuery.data?.find((b) => b.id === bindingId);
            if (target) {
              setSearchText(target.title);
              setViewMode("status");
            }
          }}
        />

        {bindingsQuery.isPending ? (
          <div aria-busy="true" className="flex flex-col gap-3">
            <div className="flex items-center justify-between border-b border-border/70 pb-2">
              <div className="flex items-center gap-2">
                <Skeleton className="size-2 rounded-full" />
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-6 rounded-full" />
              </div>
              <Skeleton className="h-3.5 w-36" />
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {[0, 1, 2, 3].map((idx) => (
                <div
                  className="flex flex-col justify-between gap-3.5 rounded-xl border border-border bg-card p-4"
                  key={idx}
                >
                  <div className="flex flex-col gap-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <Skeleton className="h-5 w-14 rounded-full" />
                        <Skeleton className="h-5 w-16 rounded-full" />
                      </div>
                      <Skeleton className="h-3 w-14" />
                    </div>
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3.5 w-full" />
                    <Skeleton className="h-3.5 w-5/6" />
                  </div>
                  <div className="flex items-center justify-between border-t border-border/70 pt-3">
                    <Skeleton className="h-3.5 w-32" />
                    <Skeleton className="h-6 w-20 rounded-md" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : viewMode === "conflicts" ? (
          <ThreadsConflictList state={state} />
        ) : filteredBindings.length === 0 ? (
          <Empty className="rounded-lg border border-dashed py-14">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <MessageSquareCodeIcon />
              </EmptyMedia>
              <EmptyTitle>{t("threads.emptyTitle")}</EmptyTitle>
              <EmptyDescription>
                {t("threads.emptyDescPrefix")}{" "}
                <code className="font-mono">/dispatch</code>{" "}
                {t("threads.emptyDescSuffix")}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="flex flex-col gap-6">
            {groupOrder.map((group) => {
              const items = grouped.get(group.status) ?? [];
              if (items.length === 0) return null;
              const meta = ADE_STATUS_META[group.status];
              const isWaiting = group.status === "waiting_input";

              return (
                <section className="flex flex-col gap-3" key={group.status}>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 pb-2">
                    <div className="flex items-center gap-2">
                      <span
                        className={`size-2 rounded-full ${meta.dotClassName} ${
                          isWaiting ? "animate-pulse" : ""
                        }`}
                      />
                      <h2 className="text-sm font-semibold">{group.heading}</h2>
                      <Badge className="tabular-nums" size="sm" variant={meta.badgeVariant}>
                        {items.length}
                      </Badge>
                      {isWaiting && (
                        <Badge size="sm" variant="warning">
                          {t("threads.needsDecisionBadge")}
                        </Badge>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">{group.description}</span>
                  </div>

                  <div
                    className={
                      items.length === 1
                        ? "grid grid-cols-1 gap-3"
                        : "grid grid-cols-1 gap-3 md:grid-cols-2"
                    }
                  >
                    {items.map((binding) => (
                      <ThreadBindingCard binding={binding} key={binding.id} state={state} />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}
        <BriefingsPanel className="mt-4" />
      </div>
    </div>
  );
}
