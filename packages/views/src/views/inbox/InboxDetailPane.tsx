import { useInkadeTranslation } from "@inkade/i18n";
import { useInkadeClient } from "@inkade/sdk/react";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle, Skeleton } from "@inkade/ui";
import { InboxIcon } from "lucide-react";
import React, { useCallback } from "react";
import { TrackChangesSkeleton } from "../../components/ViewSkeletons.tsx";
import { InboxDocumentDetail } from "./InboxDocumentDetail.tsx";
import { InboxThreadDetail } from "./InboxThreadDetail.tsx";
import { InboxTriageMetaControls } from "./InboxTriageMetaControls.tsx";
import type { useInboxTriage } from "./useInboxTriage.ts";

export interface InboxDetailPaneProps {
  readonly triage: ReturnType<typeof useInboxTriage>;
}

export function InboxDetailPane({ triage }: InboxDetailPaneProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const client = useInkadeClient();
  const { selectedItem } = triage;

  const handleIssueArtifactTicket = useCallback(
    (artifactId: Parameters<typeof client.artifacts.issueSandboxTicket>[0]) =>
      client.artifacts.issueSandboxTicket(artifactId),
    [client],
  );

  const handleSubmitArtifactComment = useCallback(
    (
      artifactId: Parameters<typeof client.artifacts.submitComment>[0],
      input: Parameters<typeof client.artifacts.submitComment>[1],
    ) => client.artifacts.submitComment(artifactId, input),
    [client],
  );

  const handleOpenSecuritySettings = useCallback(() => {
    triage.navigation.openSettings?.("security");
  }, [triage.navigation]);

  if (!selectedItem) {
    if (triage.isLoadingAll) {
      return (
        <div aria-busy="true" className="flex h-full min-h-0 flex-col">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 bg-background px-4 py-2.5">
            <div className="flex items-center gap-2">
              <Skeleton className="h-5 w-14 rounded-full" />
              <Skeleton className="h-4 w-48" />
            </div>
            <div className="flex items-center gap-1.5">
              <Skeleton className="h-6 w-16 rounded-md" />
              <Skeleton className="h-6 w-20 rounded-md" />
            </div>
          </div>
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 py-5 lg:px-8">
            <TrackChangesSkeleton />
            <div className="flex max-w-[72ch] flex-col gap-3">
              <Skeleton className="h-7 w-2/5 rounded-md" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-11/12" />
              <Skeleton className="h-4 w-4/5" />
            </div>
          </div>
        </div>
      );
    }
    return (
      <Empty className="h-full py-20">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <InboxIcon />
          </EmptyMedia>
          <EmptyTitle>{t("inbox.selectItemTitle")}</EmptyTitle>
          <EmptyDescription>{t("inbox.selectItemDesc")}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const metaControls = (
    <InboxTriageMetaControls
      customSnoozeDate={triage.customSnoozeDate}
      item={selectedItem}
      onCustomSnoozeDateChange={triage.setCustomSnoozeDate}
      onResetCustomSnoozeDate={() => triage.setCustomSnoozeDate(triage.todayStr)}
      onSnooze={(untilIso) => triage.snoozeItemMutation.mutate({ item: selectedItem, untilIso })}
      onSnoozePopoverOpenChange={triage.setSnoozePopoverOpen}
      onToggleUnread={() => triage.toggleUnreadMutation.mutate(selectedItem)}
      snoozePending={triage.snoozeItemMutation.isPending}
      snoozePopoverOpen={triage.snoozePopoverOpen}
      todayStr={triage.todayStr}
      unreadPending={triage.toggleUnreadMutation.isPending}
    />
  );

  if (
    selectedItem.kind === "blocking_question" ||
    selectedItem.kind === "conflict" ||
    selectedItem.kind === "failed" ||
    selectedItem.kind === "briefing_failed"
  ) {
    return (
      <InboxThreadDetail
        approvePending={triage.approveBindingMutation.isPending}
        archivePending={triage.archiveBindingMutation.isPending}
        dismissBriefingPending={triage.dismissBriefingMutation.isPending}
        docTitlesRecord={triage.docTitlesRecord}
        docsById={triage.docsById}
        item={selectedItem}
        metaControls={metaControls}
        onApprove={(vars) => triage.approveBindingMutation.mutateAsync(vars)}
        onArchiveBinding={(bindingId) => triage.archiveBindingMutation.mutate(bindingId)}
        onBackToQueue={() => triage.setSelectedItemId(null)}
        onChangeSteeringDraft={(bindingId, text) =>
          triage.setSteeringDraftById((prev) => ({ ...prev, [bindingId]: text }))
        }
        onDismissBriefing={(runId) => triage.dismissBriefingMutation.mutate(runId)}
        onOpenDocument={(docId) => triage.navigation.openDocument(docId)}
        onOpenThreads={(conflictMode) =>
          triage.navigation.openThreads?.(conflictMode ? { conflictMode: true } : undefined)
        }
        onRetryBinding={(bindingId) => triage.retryBindingMutation.mutate(bindingId)}
        onRetryBriefing={(jobId, itemId) =>
          triage.retryBriefingMutation.mutate({ jobId, itemId })
        }
        onSteer={(vars) => triage.steerBindingMutation.mutate(vars)}
        onToggleSteeringMode={(bindingId, nextMode) =>
          triage.setSteeringModeById((prev) => ({ ...prev, [bindingId]: nextMode }))
        }
        onUndoApproval={(binding) => triage.undoApprovalMutation.mutateAsync(binding)}
        retryBriefingPending={triage.retryBriefingMutation.isPending}
        retryPending={triage.retryBindingMutation.isPending}
        steerPending={triage.steerBindingMutation.isPending}
        steeringDraftById={triage.steeringDraftById}
        steeringModeById={triage.steeringModeById}
      />
    );
  }

  return (
    <InboxDocumentDetail
      allDocs={triage.allDocs}
      applyReviewPending={triage.applyReviewMutation.isPending}
      archiveOutPending={triage.archiveOutMutation.isPending}
      convertPending={triage.convertToArticleMutation.isPending}
      detailPending={triage.selectedDocDetailQuery.isPending}
      effectiveTheme={triage.effectiveTheme}
      fullDoc={triage.selectedFullDoc}
      hasReviewDiff={triage.hasReviewDiff}
      inboxSpaceId={triage.inboxSpaceId}
      item={selectedItem}
      latestReviewRevision={triage.latestReviewRevision}
      markReadPending={triage.markReadMutation.isPending}
      metaControls={metaControls}
      moveMenuOpen={triage.moveMenuOpen}
      onApplyReview={(doc, resolvedMarkdown) =>
        triage.applyReviewMutation.mutate({ doc, resolvedMarkdown })
      }
      onArchiveOut={(doc) => triage.archiveOutMutation.mutate(doc)}
      onBackToQueue={() => triage.setSelectedItemId(null)}
      onConvertToArticle={(doc) => triage.convertToArticleMutation.mutate(doc)}
      onDispatchTarget={triage.setDispatchTarget}
      onDismissRollbackConflict={() => triage.setRollbackConflictPrompt(null)}
      onIssueArtifactTicket={handleIssueArtifactTicket}
      onMarkRead={(docId) => triage.markReadMutation.mutate(docId)}
      onMoveMenuOpenChange={triage.setMoveMenuOpen}
      onMoveToSpace={(doc, spaceId) => triage.moveToSpaceMutation.mutate({ doc, spaceId })}
      onOpenDocument={(docId) => triage.navigation.openDocument(docId)}
      onOpenSecuritySettings={handleOpenSecuritySettings}
      onOpenWikilink={triage.handleOpenWikilink}
      onSubmitArtifactComment={handleSubmitArtifactComment}
      onTrash={(docId) => triage.trashMutation.mutate(docId)}
      onUndoBatch={(batchId, force) => triage.undoBatchMutation.mutate({ batchId, force })}
      previousReviewRevision={triage.previousReviewRevision}
      reviewRevisionsPending={triage.reviewRevisionsQuery.isPending}
      rollbackConflictPrompt={triage.rollbackConflictPrompt}
      shortcutsAllowed={
        !triage.dispatchTarget && !triage.moveMenuOpen && !triage.snoozePopoverOpen
      }
      spaces={triage.spaces}
      targetSpaces={triage.targetSpaces}
      trashPending={triage.trashMutation.isPending}
      undoBatchPending={triage.undoBatchMutation.isPending}
    />
  );
}
