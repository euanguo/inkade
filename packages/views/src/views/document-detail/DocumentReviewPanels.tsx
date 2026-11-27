import { DiffViewer, InlineTrackChangesViewer, Button } from "@inkade/ui";
import {
  AlertTriangleIcon,
  CheckIcon,
  GitCompareIcon,
  RotateCcwIcon,
  SparklesIcon,
} from "lucide-react";
import type React from "react";
import { stripLeadingDuplicateTitle } from "@inkade/core";
import { inkadeQueryKeys } from "@inkade/sdk";
import { TrackChangesSkeleton } from "../../components/ViewSkeletons.tsx";
import type { DocumentDetailState } from "./useDocumentDetailState.ts";

export function DocumentReviewPanels({
  state,
}: {
  readonly state: DocumentDetailState;
}): React.ReactElement | null {
  const {
    t,
    documentId,
    doc,
    isReadOnly,
    queryClient,
    draftMarkdown,
    latestDraftRef,
    setDraftMarkdown,
    setIsDirty,
    setAutosaveStatus,
    hasConflict,
    setHasConflict,
    conflictServerDoc,
    setConflictServerDoc,
    conflictDiff,
    showAgentDiff,
    setShowAgentDiff,
    reviewMode,
    setReviewMode,
    undoBatchConflict,
    setUndoBatchConflict,
    quietSessionDocKey,
    agentDiffQuery,
    revisionsQuery,
    latestRevision,
    previousRevision,
    saveMutation,
    markAgentReadMutation,
    undoBatchMutation,
    handleImmediateSave,
    openDispatch,
    notifier,
  } = state;

  if (!doc) return null;

  return (
    <>
      {hasConflict && conflictServerDoc && conflictDiff && (
        <div className="overflow-hidden rounded-lg border border-warning/45 bg-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-warning/25 bg-warning/10 px-4 py-3">
            <div className="flex items-center gap-2 text-xs text-warning-foreground">
              <AlertTriangleIcon className="size-4 shrink-0" />
              <div>
                <p className="font-semibold">{t("editor.conflictTitle")}</p>
                <p>
                  {t("editor.conflictDesc", {
                    serverVersion: conflictServerDoc.version,
                  })}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                loading={saveMutation.isPending}
                onClick={() => handleImmediateSave(draftMarkdown, conflictServerDoc.version)}
                size="xs"
                variant="default"
              >
                {t("editor.conflictKeepMine")}
              </Button>
              <Button
                onClick={() => {
                  const nextBody = stripLeadingDuplicateTitle(
                    conflictServerDoc.contentMarkdown,
                    conflictServerDoc.title,
                  );
                  queryClient.setQueryData(inkadeQueryKeys.document(documentId), conflictServerDoc);
                  latestDraftRef.current = nextBody;
                  setDraftMarkdown(nextBody);
                  setIsDirty(false);
                  setHasConflict(false);
                  setConflictServerDoc(null);
                  setAutosaveStatus("saved");
                }}
                size="xs"
                variant="outline"
              >
                {t("editor.conflictAcceptServer")}
              </Button>
            </div>
          </div>

          <DiffViewer
            className="rounded-none border-0"
            diff={conflictDiff}
            newLabel={t("editor.conflictServerLatest", {
              version: conflictServerDoc.version,
            })}
            oldLabel={t("editor.conflictYourDraft")}
          />
        </div>
      )}

      {showAgentDiff && doc.version > 1 && (
        <div className="flex flex-col gap-2">
          {doc.kind === "outline" && (
            <p className="rounded-lg border border-border/70 bg-muted/35 px-3 py-2 text-xs text-muted-foreground">
              {t("diff.outlineSnapshotDiffNote")}
            </p>
          )}
          {agentDiffQuery.isPending || revisionsQuery.isPending ? (
            <TrackChangesSkeleton />
          ) : doc.kind !== "outline" && reviewMode === "inline" && previousRevision ? (
            <InlineTrackChangesViewer
              applying={saveMutation.isPending}
              changeSummary={latestRevision?.changeSummary}
              newLabel={t("document.agentVersionLabel", { version: doc.version })}
              newMarkdown={doc.contentMarkdown}
              oldLabel={t("common.version", { version: previousRevision.version })}
              oldMarkdown={previousRevision.contentMarkdown}
              onApplyResolvedMarkdown={(resolved) => {
                saveMutation.mutate(
                  {
                    targetDocId: doc.id,
                    markdown: resolved,
                    expectedVersion: doc.version,
                  },
                  {
                    onSuccess: () => {
                      setShowAgentDiff(false);
                      notifier.success(t("document.reviewApplySuccess"));
                    },
                  },
                );
              }}
              onClose={() => setShowAgentDiff(false)}
              onCommentRework={(hunk, comment) => {
                const snippet = (hunk.newText || hunk.oldText).slice(0, 220);
                openDispatch({
                  documentId: doc.id,
                  documentTitle: doc.title,
                  selectionAnchor: { quote: snippet || doc.title },
                  excerpt: `${snippet}\n\n[${t("diff.commentRework")}]: ${comment}`,
                  defaultTitle: `${t("diff.commentRework")}: ${comment.slice(0, 60)}`,
                });
              }}
              onSwitchToCodeDiff={() => setReviewMode("diff")}
            />
          ) : agentDiffQuery.data ? (
            <DiffViewer
              changeSummary={latestRevision?.changeSummary}
              diff={agentDiffQuery.data.diff}
              newLabel={t("document.agentVersionLabel", {
                version: agentDiffQuery.data.toVersion,
              })}
              oldLabel={t("common.version", {
                version: agentDiffQuery.data.fromVersion,
              })}
              onClose={() => setShowAgentDiff(false)}
              onCommentReworkHunk={(_idx, hunk, comment) => {
                const snippet = hunk.lines.slice(0, 8).join("\n");
                openDispatch({
                  documentId: doc.id,
                  documentTitle: doc.title,
                  selectionAnchor: { quote: snippet.slice(0, 200) || doc.title },
                  excerpt: `${snippet}\n\n[${t("diff.commentRework")}]: ${comment}`,
                  defaultTitle: `${t("diff.commentRework")}: ${comment.slice(0, 60)}`,
                });
              }}
              onSwitchToInline={
                doc.kind !== "outline" && previousRevision
                  ? () => setReviewMode("inline")
                  : undefined
              }
            />
          ) : null}
        </div>
      )}

      {(doc.unreadAgentUpdate ||
        quietSessionDocKey === `${doc.id}:${doc.version}` ||
        (undoBatchConflict && undoBatchConflict.batchId === latestRevision?.batchId)) && (
        <div
          className="flex flex-col gap-2 rounded-lg border border-border/75 bg-muted/25 px-3.5 py-2 text-xs text-muted-foreground"
          data-slot="document-quiet-update-banner"
          role="status"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2 text-foreground/90">
              <SparklesIcon className="size-3.5 shrink-0 text-primary/75" />
              <span className="font-medium">
                {t("reader.quietUpdateNotice", { version: doc.version })}
              </span>
              {latestRevision?.changeSummary ? (
                <span className="truncate text-muted-foreground">
                  · {latestRevision.changeSummary}
                </span>
              ) : null}
              {!showAgentDiff && doc.unreadAgentUpdate && (
                <span className="text-[11px] text-muted-foreground/80">
                  ({t("reader.quietAutoAckHint")})
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {doc.version > 1 && (
                <Button
                  onClick={() => {
                    setReviewMode("inline");
                    setShowAgentDiff((prev) => !prev);
                  }}
                  size="xs"
                  type="button"
                  variant="ghost"
                >
                  <GitCompareIcon />
                  {t("reader.quietToggleChanges")}
                </Button>
              )}
              {latestRevision?.batchId && !isReadOnly && (
                <Button
                  loading={undoBatchMutation.isPending}
                  onClick={() => {
                    if (latestRevision.batchId) {
                      undoBatchMutation.mutate({ batchId: latestRevision.batchId });
                    }
                  }}
                  size="xs"
                  type="button"
                  variant="outline"
                >
                  <RotateCcwIcon />
                  {t("reader.quietUndoBatch")}
                </Button>
              )}
              {doc.unreadAgentUpdate && (
                <Button
                  onClick={() => markAgentReadMutation.mutate()}
                  size="xs"
                  type="button"
                  variant="ghost"
                >
                  <CheckIcon />
                  {t("reader.markRead")}
                </Button>
              )}
            </div>
          </div>

          {undoBatchConflict &&
            undoBatchConflict.batchId === latestRevision?.batchId &&
            undoBatchConflict.conflicts.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2 text-warning-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <AlertTriangleIcon className="size-3.5 shrink-0" />
                  <span>{t("inbox.undoBatchConflictDesc")}</span>
                </span>
                <div className="flex items-center gap-1.5">
                  <Button
                    onClick={() => setUndoBatchConflict(null)}
                    size="xs"
                    type="button"
                    variant="outline"
                  >
                    {t("common.cancel")}
                  </Button>
                  <Button
                    loading={undoBatchMutation.isPending}
                    onClick={() =>
                      undoBatchMutation.mutate({
                        batchId: undoBatchConflict.batchId,
                        force: true,
                      })
                    }
                    size="xs"
                    type="button"
                    variant="default"
                  >
                    {t("inbox.undoBatchForceConfirm")}
                  </Button>
                </div>
              </div>
            )}
        </div>
      )}
    </>
  );
}
