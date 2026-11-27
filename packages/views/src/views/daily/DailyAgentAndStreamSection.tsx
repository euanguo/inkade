import {
  AgentComposerPanel,
  AgentStepsLog,
  Button,
  CitedAnswerCard,
  ThinkingIndicator,
} from "@inkade/ui";
import type React from "react";
import { StreamDayCard } from "./StreamDayCard.tsx";
import type { DailyWorkspaceState } from "./useDailyWorkspace.ts";

export function DailyAgentAndStreamSection({
  state,
}: {
  readonly state: DailyWorkspaceState;
}): React.ReactElement {
  const {
    t,
    navigation,
    isReadOnly,
    todayStr,
    viewMode,
    streamMode,
    dailyDoc,
    spaces,
    workspaceTags,
    rolloverDocDatesById,
    allDocsQuery,
    whoamiQuery,
    initialDailyMentionDocs,
    composerDocuments,
    currentDocActiveStepBindings,
    currentDocCitationCards,
    visibleStreamDates,
    availableStreamDates,
    streamCount,
    setStreamCount,
    streamSentinelRef,
    quickDispatchMutation,
    handleClickTag,
    handleDeferNode,
    openDispatch,
    goDate,
    markBindingReadMutation,
    openBindingTarget,
    handleOpenDocument,
    setPromoteTarget,
    unbindMutation,
  } = state;

  return (
    <>
      {currentDocActiveStepBindings.length > 0 && (
        <section className="flex flex-col gap-2.5 pt-1">
          <h2 className="text-xs font-medium text-muted-foreground">
            {t("agentControl.dailyActiveAgentsTitle")}
          </h2>
          <div className="flex flex-col gap-2.5">
            {currentDocActiveStepBindings.map((binding) => (
              <div className="flex flex-col gap-2" key={binding.id}>
                {binding.status === "running" && (
                  <ThinkingIndicator
                    label={binding.title}
                    showTimer
                    size="sm"
                    startedAt={binding.runningSince ?? binding.lastSyncedAt}
                  />
                )}
                <AgentStepsLog
                  collapseOnComplete
                  defaultExpanded={binding.status === "running"}
                  steps={binding.progressSteps ?? []}
                />
              </div>
            ))}
          </div>
        </section>
      )}

      {currentDocCitationCards.length > 0 && (
        <section className="flex flex-col gap-2.5 pt-1">
          <h2 className="text-xs font-medium text-muted-foreground">
            {t("agentControl.dailyCitationsTitle")}
          </h2>
          <div className="flex flex-col gap-3">
            {currentDocCitationCards.map((entry) => (
              <CitedAnswerCard
                answer={entry.answer}
                citations={entry.citations}
                key={entry.bindingId}
                onOpenSource={(cite) => {
                  if (cite.documentId) {
                    navigation.openDocument(cite.documentId);
                  }
                }}
              />
            ))}
          </div>
        </section>
      )}

      {!isReadOnly && dailyDoc && (
        <AgentComposerPanel
          collapsible
          defaultCollapsed
          documents={composerDocuments}
          initialMentionedDocs={initialDailyMentionDocs}
          key={dailyDoc.id}
          onSubmit={async (payload) => {
            await quickDispatchMutation.mutateAsync(payload);
          }}
          scopeSummary={whoamiQuery.data?.effectiveSummary ?? null}
          spaces={spaces}
          submitting={quickDispatchMutation.isPending}
        />
      )}

      {streamMode && viewMode === "outline" && (
        <div className="mx-auto mt-4 flex w-full max-w-[780px] flex-col gap-4 border-t pt-5">
          {visibleStreamDates.map((dayDate) => (
            <StreamDayCard
              allDocs={allDocsQuery.data ?? []}
              dayDate={dayDate}
              key={dayDate}
              onClickTag={handleClickTag}
              onDeferNode={handleDeferNode}
              onDispatch={openDispatch}
              onFocusDay={goDate}
              onMarkBindingRead={(id) => markBindingReadMutation.mutate(id)}
              onOpenBinding={openBindingTarget}
              onOpenDate={goDate}
              onOpenDocument={handleOpenDocument}
              onPromote={setPromoteTarget}
              onUnbindBinding={(id) => unbindMutation.mutate(id)}
              readOnly={isReadOnly}
              rolloverDocDatesById={rolloverDocDatesById}
              todayStr={todayStr}
              workspaceTags={workspaceTags}
            />
          ))}

          <div className="flex justify-center py-2" ref={streamSentinelRef}>
            {streamCount < availableStreamDates.length ? (
              <Button
                onClick={() => setStreamCount((prev) => prev + 3)}
                size="sm"
                variant="outline"
              >
                {t("daily.loadEarlierDays")}
              </Button>
            ) : (
              <span className="text-xs text-muted-foreground">{t("daily.noEarlierDays")}</span>
            )}
          </div>
        </div>
      )}
    </>
  );
}
