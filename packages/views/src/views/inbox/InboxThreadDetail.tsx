import type {
  AdeThreadBinding,
  AgentApprovalDecision,
  AgentSteeringMode,
  BriefingJobId,
  BriefingRunId,
  DocumentId,
  DocumentSummary,
  ThreadBindingId,
} from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import {
  ADE_STATUS_META,
  AgentStepsLog,
  ApprovalCard,
  Badge,
  Button,
  cn,
  ConflictRadarBanner,
  Input,
  ScrollArea,
  ThinkingIndicator,
} from "@inkade/ui";
import {
  AlertTriangleIcon,
  ArchiveIcon,
  ArrowLeftIcon,
  ExternalLinkIcon,
  GitCompareIcon,
  RotateCcwIcon,
  SendHorizontalIcon,
} from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import { formatRelativeTime, type UnifiedInboxItem } from "./types.ts";

export interface InboxThreadDetailProps {
  readonly item: Extract<
    UnifiedInboxItem,
    { kind: "blocking_question" | "conflict" | "failed" | "briefing_failed" }
  >;
  readonly docsById: ReadonlyMap<DocumentId, DocumentSummary>;
  readonly docTitlesRecord: Readonly<Record<string, string>>;
  readonly metaControls: React.ReactNode;
  readonly onBackToQueue: () => void;
  readonly onOpenDocument: (docId: DocumentId) => void;
  readonly onOpenThreads: (conflictMode?: boolean) => void;
  readonly approvePending: boolean;
  readonly onApprove: (vars: {
    readonly bindingId: ThreadBindingId;
    readonly decision: AgentApprovalDecision;
    readonly note?: string | undefined;
  }) => Promise<unknown>;
  readonly onUndoApproval: (binding: AdeThreadBinding) => Promise<unknown>;
  readonly steeringDraftById: Readonly<Record<ThreadBindingId, string>>;
  readonly steeringModeById: Readonly<Record<ThreadBindingId, AgentSteeringMode>>;
  readonly onChangeSteeringDraft: (bindingId: ThreadBindingId, text: string) => void;
  readonly onToggleSteeringMode: (bindingId: ThreadBindingId, nextMode: AgentSteeringMode) => void;
  readonly steerPending: boolean;
  readonly onSteer: (vars: {
    readonly bindingId: ThreadBindingId;
    readonly text: string;
    readonly mode: AgentSteeringMode;
  }) => void;
  readonly retryPending: boolean;
  readonly archivePending: boolean;
  readonly retryBriefingPending?: boolean | undefined;
  readonly dismissBriefingPending?: boolean | undefined;
  readonly onRetryBinding: (bindingId: ThreadBindingId) => void;
  readonly onArchiveBinding: (bindingId: ThreadBindingId) => void;
  readonly onRetryBriefing?: ((jobId: BriefingJobId, itemId: string) => void) | undefined;
  readonly onDismissBriefing?: ((runId: BriefingRunId) => void) | undefined;
}

export function InboxThreadDetail({
  item,
  docsById,
  docTitlesRecord,
  metaControls,
  onBackToQueue,
  onOpenDocument,
  onOpenThreads,
  approvePending,
  onApprove,
  onUndoApproval,
  steeringDraftById,
  steeringModeById,
  onChangeSteeringDraft,
  onToggleSteeringMode,
  steerPending,
  onSteer,
  retryPending,
  archivePending,
  retryBriefingPending = false,
  dismissBriefingPending = false,
  onRetryBinding,
  onArchiveBinding,
  onRetryBriefing,
  onDismissBriefing,
}: InboxThreadDetailProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const [questionResponse, setQuestionResponse] = useState("");

  useEffect(() => {
    setQuestionResponse("");
  }, [item.id]);

  if (item.kind === "blocking_question") {
    const binding = item.binding;
    const targetDoc = docsById.get(binding.documentId);
    const approval = binding.pendingApproval;
    const isStructuredQuestion = Boolean(
      approval && !approval.decision && (approval.requestKind === "blocking_question" || approval.question),
    );
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 bg-background px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <Button className="md:hidden" onClick={onBackToQueue} size="xs" variant="ghost">
              <ArrowLeftIcon />
              {t("inbox.backToQueue")}
            </Button>
            <Badge size="sm" variant={approval?.urgency === "high" ? "error" : "warning"}>
              {t("inbox.kindBlockingQuestion")}
            </Badge>
            <span className="truncate text-sm font-medium text-foreground">{binding.title}</span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {metaControls}
            {targetDoc && (
              <Button onClick={() => onOpenDocument(targetDoc.id)} size="xs" variant="outline">
                <ExternalLinkIcon />
                <span>{t("inbox.openDocForConflict")}</span>
              </Button>
            )}
            <Button onClick={() => onOpenThreads(false)} size="xs" variant="ghost">
              <span>{t("inbox.openThreadsConsole")}</span>
            </Button>
          </div>
        </div>

        <ScrollArea className="min-h-0 flex-1" scrollFade>
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6 lg:px-8">
            {isStructuredQuestion && approval ? (
              <div
                className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
                data-slot="inbox-blocking-question-card"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {binding.adeKind}
                  </span>
                  {approval.urgency === "high" && (
                    <Badge size="sm" variant="error">
                      {t("agentControl.riskHigh")}
                    </Badge>
                  )}
                </div>

                <p className="text-sm font-semibold leading-snug text-foreground">
                  {approval.question || approval.action}
                </p>

                {approval.context && (
                  <p className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap">
                    {approval.context}
                  </p>
                )}

                {approval.options && approval.options.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {approval.options.map((opt) => (
                      <Button
                        key={opt}
                        onClick={() => setQuestionResponse(opt)}
                        size="xs"
                        type="button"
                        variant={questionResponse === opt ? "default" : "outline"}
                      >
                        {opt}
                      </Button>
                    ))}
                  </div>
                )}

                <form
                  className="flex flex-wrap items-center gap-2 pt-1"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const trimmed = questionResponse.trim();
                    if (!trimmed || approvePending) return;
                    void onApprove({
                      bindingId: binding.id,
                      decision: "approved",
                      note: trimmed,
                    });
                  }}
                >
                  <Input
                    className="min-w-48 flex-1 text-xs"
                    onChange={(e) => setQuestionResponse(e.target.value)}
                    placeholder={t("inbox.questionResponsePlaceholder")}
                    size="sm"
                    value={questionResponse}
                  />
                  <Button
                    disabled={!questionResponse.trim()}
                    loading={approvePending}
                    size="sm"
                    type="submit"
                    variant="default"
                  >
                    <SendHorizontalIcon />
                    <span>{t("inbox.questionSubmit")}</span>
                  </Button>
                  <Button
                    disabled={approvePending}
                    onClick={() =>
                      void onApprove({
                        bindingId: binding.id,
                        decision: "denied",
                      })
                    }
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {t("agentControl.denyAction")}
                  </Button>
                </form>
              </div>
            ) : approval ? (
              <ApprovalCard
                adeKind={binding.adeKind}
                approval={approval}
                createdAt={binding.createdAt}
                onDecision={(decision, note) =>
                  onApprove({ bindingId: binding.id, decision, note })
                }
                onUndo={() => onUndoApproval(binding)}
                pending={approvePending}
                title={binding.title}
              />
            ) : null}
            {binding.lastSummary && (
              <div className="rounded-lg border border-border bg-muted/25 p-3.5 text-xs leading-relaxed text-muted-foreground">
                {binding.lastSummary}
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    );
  }

  if (item.kind === "conflict") {
    const conflict = item.conflict;
    const targetDoc = docsById.get(conflict.documentId);
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 bg-background px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <Button className="md:hidden" onClick={onBackToQueue} size="xs" variant="ghost">
              <ArrowLeftIcon />
              {t("inbox.backToQueue")}
            </Button>
            <Badge size="sm" variant="outline">
              {t("inbox.kindConflict")}
            </Badge>
            <span className="truncate text-sm font-medium text-foreground">
              {targetDoc?.title ?? conflict.documentId}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {metaControls}
            <Button onClick={() => onOpenDocument(conflict.documentId)} size="xs" variant="outline">
              <GitCompareIcon />
              <span>{t("inbox.openDocForConflict")}</span>
            </Button>
            <Button onClick={() => onOpenThreads(true)} size="xs" variant="ghost">
              <span>{t("inbox.openThreadsConsole")}</span>
            </Button>
          </div>
        </div>

        <ScrollArea className="min-h-0 flex-1" scrollFade>
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6 lg:px-8">
            <ConflictRadarBanner
              conflicts={[conflict]}
              documentTitlesById={docTitlesRecord}
              onCompare={() => onOpenThreads(true)}
              onSelectBinding={() => onOpenDocument(conflict.documentId)}
            />

            <div className="flex flex-col gap-2">
              <h2 className="text-xs font-medium text-muted-foreground">
                {t("inbox.conflictThreadsHeading")}
              </h2>
              <div className="divide-y divide-border/70 rounded-lg border border-border bg-background">
                {conflict.bindings.map((binding) => {
                  const meta = ADE_STATUS_META[binding.status];
                  const isRunning = binding.status === "running";
                  const steeringDraft = steeringDraftById[binding.id] ?? "";
                  const steeringMode = steeringModeById[binding.id] ?? "queued";
                  return (
                    <div className="flex flex-col gap-2 p-3" key={binding.id}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <span
                            aria-hidden="true"
                            className={cn("size-1.5 shrink-0 rounded-full", meta.dotClassName)}
                          />
                          <span className="truncate text-xs font-medium text-foreground">
                            {binding.title || binding.externalThreadId}
                          </span>
                          <Badge className="uppercase" size="sm" variant="outline">
                            {binding.adeKind}
                          </Badge>
                        </div>
                        {isRunning && (
                          <ThinkingIndicator
                            showTimer
                            size="sm"
                            startedAt={binding.runningSince ?? binding.lastSyncedAt}
                          />
                        )}
                      </div>

                      {isRunning && (
                        <div className="flex items-center gap-1.5 pt-1">
                          <Button
                            onClick={() =>
                              onToggleSteeringMode(
                                binding.id,
                                steeringMode === "queued" ? "interrupt" : "queued",
                              )
                            }
                            size="sm"
                            type="button"
                            variant="outline"
                          >
                            {steeringMode === "interrupt"
                              ? t("agentControl.steeringInterruptMode")
                              : t("agentControl.steeringQueueMode")}
                          </Button>
                          <Input
                            className="flex-1 text-xs"
                            onChange={(e) => onChangeSteeringDraft(binding.id, e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && !e.shiftKey && steeringDraft.trim()) {
                                e.preventDefault();
                                onSteer({
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
                            disabled={!steeringDraft.trim() || steerPending}
                            onClick={() =>
                              onSteer({
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
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </ScrollArea>
      </div>
    );
  }

  if (item.kind === "briefing_failed") {
    const run = item.briefingRun;
    const targetDoc = run.documentId ? docsById.get(run.documentId) : undefined;
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 bg-background px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <Button
              aria-label={t("inbox.backToQueue")}
              className="md:hidden"
              onClick={onBackToQueue}
              size="icon-xs"
              variant="ghost"
            >
              <ArrowLeftIcon />
            </Button>
            <AlertTriangleIcon className="size-4 shrink-0 text-destructive" />
            <Badge size="sm" variant="destructive">
              {t("inbox.kindBriefingFailed")}
            </Badge>
            <span className="truncate text-sm font-medium text-foreground">{item.title}</span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {metaControls}
            {onRetryBriefing ? (
              <Button
                loading={retryBriefingPending}
                onClick={() => onRetryBriefing(run.jobId, item.id)}
                size="xs"
                variant="outline"
              >
                <RotateCcwIcon />
                <span>{t("inbox.retryBriefing")}</span>
              </Button>
            ) : null}
            {onDismissBriefing ? (
              <Button
                loading={dismissBriefingPending}
                onClick={() => onDismissBriefing(run.id)}
                size="xs"
                variant="ghost"
              >
                <ArchiveIcon />
                <span>{t("inbox.dismissBriefing")}</span>
              </Button>
            ) : null}
            {targetDoc ? (
              <Button onClick={() => onOpenDocument(targetDoc.id)} size="xs" variant="secondary">
                <span>{t("inbox.openDocForConflict")}</span>
              </Button>
            ) : null}
            <Button onClick={() => onOpenThreads(false)} size="xs" variant="ghost">
              <span>{t("inbox.openThreadsConsole")}</span>
            </Button>
          </div>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="mx-auto flex w-full max-w-[740px] flex-col gap-4 px-5 py-6">
            <div className="flex flex-col gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">
                  {t("inbox.briefingSourceSummary", { jobName: run.jobName })}
                </span>
                <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
                  <span>
                    {t("inbox.briefingTriggerLabel", {
                      trigger:
                        run.triggerKind === "schedule"
                          ? t("briefings.triggerSchedule")
                          : t("briefings.triggerManual"),
                    })}
                  </span>
                  {run.durationMs !== null ? (
                    <>
                      <span aria-hidden="true" className="text-muted-foreground/60">
                        ·
                      </span>
                      <span>{t("inbox.briefingDurationLabel", { ms: run.durationMs })}</span>
                    </>
                  ) : null}
                  <span aria-hidden="true" className="text-muted-foreground/60">
                    ·
                  </span>
                  <span>{formatRelativeTime(run.startedAt, t)}</span>
                </div>
              </div>
              <p className="text-sm font-medium text-destructive">
                {t("inbox.briefingFailedTitle")}
              </p>
              <p className="whitespace-pre-wrap rounded-md border border-destructive/20 bg-background/70 px-3 py-2 font-mono text-xs text-foreground">
                {run.errorMessage || t("inbox.failedSummaryEmpty")}
              </p>
            </div>

            <div className="flex flex-col gap-3 rounded-lg border border-border bg-card/60 p-4">
              <div className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-foreground">
                  {t("inbox.briefingFailureGuidanceTitle")}
                </span>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {t("inbox.briefingFailureGuidanceDesc")}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {onRetryBriefing ? (
                  <Button
                    loading={retryBriefingPending}
                    onClick={() => onRetryBriefing(run.jobId, item.id)}
                    size="xs"
                    variant="default"
                  >
                    <RotateCcwIcon />
                    <span>{t("inbox.retryBriefing")}</span>
                  </Button>
                ) : null}
                {onDismissBriefing ? (
                  <Button
                    loading={dismissBriefingPending}
                    onClick={() => onDismissBriefing(run.id)}
                    size="xs"
                    variant="outline"
                  >
                    <ArchiveIcon />
                    <span>{t("inbox.dismissBriefing")}</span>
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        </ScrollArea>
      </div>
    );
  }

  const binding = item.binding;
  const targetDoc = docsById.get(binding.documentId);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 bg-background px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Button className="md:hidden" onClick={onBackToQueue} size="xs" variant="ghost">
            <ArrowLeftIcon />
            {t("inbox.backToQueue")}
          </Button>
          <Badge size="sm" variant="outline">
            {t("inbox.kindFailed")}
          </Badge>
          <span className="truncate text-sm font-medium text-foreground">
            {binding.title || binding.externalThreadId}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {metaControls}
          <Button
            loading={retryPending}
            onClick={() => onRetryBinding(binding.id)}
            size="xs"
            variant="outline"
          >
            <RotateCcwIcon />
            <span>{t("inbox.retryRun")}</span>
          </Button>
          <Button
            loading={archivePending}
            onClick={() => onArchiveBinding(binding.id)}
            size="xs"
            variant="ghost"
          >
            <ArchiveIcon />
            <span>{t("inbox.dismissAlert")}</span>
          </Button>
          {targetDoc && (
            <Button onClick={() => onOpenDocument(targetDoc.id)} size="xs" variant="secondary">
              <span>{t("inbox.openDocForConflict")}</span>
            </Button>
          )}
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1" scrollFade>
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6 lg:px-8">
          <div className="flex flex-col gap-2 rounded-lg border border-border bg-background p-4">
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span className="uppercase">{binding.adeKind}</span>
              {targetDoc && <span>{targetDoc.title}</span>}
            </div>
            <p className="text-sm text-foreground">
              {binding.lastSummary || t("inbox.failedSummaryEmpty")}
            </p>
          </div>
          {binding.progressSteps && binding.progressSteps.length > 0 && (
            <AgentStepsLog defaultExpanded steps={binding.progressSteps} />
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
