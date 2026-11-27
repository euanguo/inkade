import {
  BRIEFING_PRESET_TEMPLATES,
  type AgentBriefingJobRecord,
  type AgentBriefingRunRecord,
  type ApiTokenId,
  type AuditBatchId,
  type BriefingExecutionPath,
  type BriefingJobId,
  type BriefingPresetId,
  type BriefingTargetMode,
  type ContextPackId,
  type DocumentId,
  type SpaceId,
  type ThreadBindingId,
} from "@inkade/core";
import { formatLocalizedBriefingSummary } from "../lib/briefings-i18n.ts";
import { useInkadeTranslation } from "@inkade/i18n";
import {
  useCreateBriefingJobMutation,
  useDeleteBriefingJobMutation,
  useInkadeBriefingJobs,
  useInkadeBriefingRuns,
  useInkadeContextPacks,
  useInkadeSpaces,
  useInkadeThreadBindings,
  useInkadeTokens,
  useInkadeWhoami,
  useRollbackAuditBatchMutation,
  useRunBriefingJobNowMutation,
  useUpdateBriefingJobMutation,
} from "@inkade/sdk/react";
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  Input,
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
  cn,
} from "@inkade/ui";
import {
  CalendarClockIcon,
  ExternalLinkIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  RotateCcwIcon,
  SparklesIcon,
  Trash2Icon,
} from "lucide-react";
import type React from "react";
import { useMemo, useState } from "react";
import { useInkadeViewsContext } from "../context.tsx";

export interface BriefingsPanelProps {
  readonly className?: string | undefined;
}

interface BriefingDraftState {
  readonly name: string;
  readonly description: string;
  readonly cronExpr: string;
  readonly timezone: string;
  readonly executionPath: BriefingExecutionPath;
  readonly bindingId: ThreadBindingId | null;
  readonly tokenRuleId: ApiTokenId | null;
  readonly promptTemplate: string;
  readonly sourceAllSpaces: boolean;
  readonly sourceSpaceIds: readonly SpaceId[];
  readonly includeClipsLastDays: string;
  readonly includeRssFeeds: boolean;
  readonly includeTasks: boolean;
  readonly contextPackIds: readonly ContextPackId[];
  readonly targetMode: BriefingTargetMode;
  readonly sectionHeading: string;
  readonly targetSpaceId: SpaceId | null;
  readonly titleTemplate: string;
  readonly tagsText: string;
  readonly enabled: boolean;
}

function getDefaultTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function createEmptyDraft(defaultSpaceId: SpaceId | null): BriefingDraftState {
  return {
    name: "",
    description: "",
    cronExpr: "30 7 * * *",
    timezone: getDefaultTimezone(),
    executionPath: "builtin_rag",
    bindingId: null,
    tokenRuleId: null,
    promptTemplate:
      BRIEFING_PRESET_TEMPLATES[0]?.promptTemplate ??
      "Summarize recent notes and open tasks cleanly with citations [1], [2].",
    sourceAllSpaces: true,
    sourceSpaceIds: [],
    includeClipsLastDays: "1",
    includeRssFeeds: true,
    includeTasks: true,
    contextPackIds: [],
    targetMode: "daily_section",
    sectionHeading: "## Agent Briefing",
    targetSpaceId: defaultSpaceId,
    titleTemplate: "Agent Briefing · {{date}}",
    tagsText: "briefing",
    enabled: true,
  };
}

function draftFromJob(job: AgentBriefingJobRecord): BriefingDraftState {
  const sourceAll = job.sources.spaceIds === "*";
  return {
    name: job.name,
    description: job.description,
    cronExpr: job.cronExpr,
    timezone: job.timezone,
    executionPath: job.executionPath,
    bindingId: job.bindingId,
    tokenRuleId: job.tokenRuleId,
    promptTemplate: job.promptTemplate,
    sourceAllSpaces: sourceAll,
    sourceSpaceIds: job.sources.spaceIds === "*" ? [] : [...job.sources.spaceIds],
    includeClipsLastDays: String(job.sources.includeClipsLastDays),
    includeRssFeeds: job.sources.includeRssFeeds,
    includeTasks: job.sources.includeTasks,
    contextPackIds: [...job.sources.contextPackIds],
    targetMode: job.target.mode,
    sectionHeading: job.target.sectionHeading,
    targetSpaceId: job.target.targetSpaceId,
    titleTemplate: job.target.titleTemplate,
    tagsText: job.target.tags.join(", "),
    enabled: job.enabled,
  };
}

function formatDateTime(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatLocalizedRunSummary(
  run: AgentBriefingRunRecord,
  jobName: string,
  t: ReturnType<typeof useInkadeTranslation>["t"],
): string {
  if (run.status === "failed") {
    return run.errorMessage ?? t("inbox.failedSummaryEmpty");
  }
  return formatLocalizedBriefingSummary(run.summary, jobName, t);
}

export function BriefingsPanel({ className }: BriefingsPanelProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const { navigation, notifier } = useInkadeViewsContext();

  const whoamiQuery = useInkadeWhoami();
  const isAdmin = whoamiQuery.data?.scope.permission === "admin";
  const isReadOnly = whoamiQuery.data?.scope.permission === "read";

  const jobsQuery = useInkadeBriefingJobs();
  const runsQuery = useInkadeBriefingRuns({ limit: 50 });
  const spacesQuery = useInkadeSpaces();
  const packsQuery = useInkadeContextPacks();
  const bindingsQuery = useInkadeThreadBindings({});
  const tokensQuery = useInkadeTokens({ enabled: isAdmin });

  const createJobMutation = useCreateBriefingJobMutation();
  const updateJobMutation = useUpdateBriefingJobMutation();
  const deleteJobMutation = useDeleteBriefingJobMutation();
  const runJobNowMutation = useRunBriefingJobNowMutation();
  const rollbackBatchMutation = useRollbackAuditBatchMutation();

  const activeSpaces = useMemo(
    () => (spacesQuery.data ?? []).filter((s) => s.archivedAt === null),
    [spacesQuery.data],
  );
  const defaultArticleSpaceId = useMemo(
    () =>
      activeSpaces.find((s) => s.slug === "research")?.id ??
      activeSpaces.find((s) => s.slug !== "daily")?.id ??
      activeSpaces[0]?.id ??
      null,
    [activeSpaces],
  );
  const activeTokens = useMemo(
    () => (tokensQuery.data ?? []).filter((tk) => tk.revokedAt === null),
    [tokensQuery.data],
  );
  const activeBindings = useMemo(
    () => (bindingsQuery.data ?? []).filter((b) => b.status !== "archived"),
    [bindingsQuery.data],
  );

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingJobId, setEditingJobId] = useState<BriefingJobId | null>(null);
  const [draft, setDraft] = useState<BriefingDraftState>(() =>
    createEmptyDraft(defaultArticleSpaceId),
  );
  const [runningJobId, setRunningJobId] = useState<BriefingJobId | null>(null);
  const [undoingBatchId, setUndoingBatchId] = useState<AuditBatchId | null>(null);

  const jobs = jobsQuery.data?.jobs ?? [];
  const presets = jobsQuery.data?.presets ?? BRIEFING_PRESET_TEMPLATES;
  const runsByJobId = useMemo(() => {
    const grouped = new Map<BriefingJobId, AgentBriefingRunRecord[]>();
    for (const run of runsQuery.data ?? []) {
      const list = grouped.get(run.jobId) ?? [];
      if (list.length < 5) {
        list.push(run);
      }
      grouped.set(run.jobId, list);
    }
    return grouped;
  }, [runsQuery.data]);

  const getPresetLabel = (presetId: BriefingPresetId) => {
    if (presetId === "morning_clips_rss") {
      return {
        name: t("briefings.presetMorningName"),
        desc: t("briefings.presetMorningDesc"),
      };
    }
    return {
      name: t("briefings.presetWeeklyName"),
      desc: t("briefings.presetWeeklyDesc"),
    };
  };

  const applyPresetToDraft = (presetId: BriefingPresetId) => {
    const template = presets.find((p) => p.id === presetId);
    if (!template) return;
    const labels = getPresetLabel(presetId);
    setDraft({
      name: labels.name,
      description: labels.desc,
      cronExpr: template.cronExpr,
      timezone: getDefaultTimezone(),
      executionPath: template.executionPath,
      bindingId: null,
      tokenRuleId: null,
      promptTemplate: template.promptTemplate,
      sourceAllSpaces: template.sources.spaceIds === "*",
      sourceSpaceIds: template.sources.spaceIds === "*" ? [] : [...template.sources.spaceIds],
      includeClipsLastDays: String(template.sources.includeClipsLastDays),
      includeRssFeeds: template.sources.includeRssFeeds,
      includeTasks: template.sources.includeTasks,
      contextPackIds: [...template.sources.contextPackIds],
      targetMode: template.target.mode,
      sectionHeading: template.target.sectionHeading,
      targetSpaceId: template.target.targetSpaceId ?? defaultArticleSpaceId,
      titleTemplate: template.target.titleTemplate,
      tagsText: template.target.tags.join(", "),
      enabled: true,
    });
  };

  const handleQuickCreatePreset = async (presetId: BriefingPresetId) => {
    const template = presets.find((p) => p.id === presetId);
    if (!template) return;
    const labels = getPresetLabel(presetId);
    try {
      await createJobMutation.mutateAsync({
        name: labels.name,
        description: labels.desc,
        cronExpr: template.cronExpr,
        timezone: getDefaultTimezone(),
        executionPath: template.executionPath,
        promptTemplate: template.promptTemplate,
        sources: { ...template.sources },
        target: {
          ...template.target,
          targetSpaceId:
            template.target.mode === "space_article"
              ? (template.target.targetSpaceId ?? defaultArticleSpaceId)
              : null,
        },
        enabled: true,
      });
      notifier.success(t("briefings.presetCreatedToast"), labels.name);
    } catch (err) {
      notifier.error(t("briefings.saveFailedToast"), err);
    }
  };

  const openCreateDialog = (presetId?: BriefingPresetId) => {
    setEditingJobId(null);
    if (presetId) {
      applyPresetToDraft(presetId);
    } else {
      setDraft(createEmptyDraft(defaultArticleSpaceId));
    }
    setDialogOpen(true);
  };

  const openEditDialog = (job: AgentBriefingJobRecord) => {
    setEditingJobId(job.id);
    setDraft(draftFromJob(job));
    setDialogOpen(true);
  };

  const handleSaveJob = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsedDays = Number.parseInt(draft.includeClipsLastDays, 10);
    const includeClipsLastDays =
      Number.isFinite(parsedDays) && parsedDays >= 0 ? Math.min(365, parsedDays) : 1;
    const tags = draft.tagsText
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const payload = {
      name: draft.name.trim(),
      description: draft.description.trim(),
      cronExpr: draft.cronExpr.trim(),
      timezone: draft.timezone.trim() || "UTC",
      executionPath: draft.executionPath,
      bindingId: draft.executionPath === "external_ade" ? draft.bindingId : null,
      tokenRuleId: draft.tokenRuleId,
      promptTemplate: draft.promptTemplate.trim(),
      sources: {
        spaceIds:
          draft.sourceAllSpaces || draft.sourceSpaceIds.length === 0
            ? ("*" as const)
            : [...draft.sourceSpaceIds],
        includeClipsLastDays,
        includeRssFeeds: draft.includeRssFeeds,
        includeTasks: draft.includeTasks,
        contextPackIds: [...draft.contextPackIds],
        maxItemsPerSource: 10,
      },
      target: {
        mode: draft.targetMode,
        sectionHeading: draft.sectionHeading.trim() || "## Agent Briefing",
        targetSpaceId:
          draft.targetMode === "space_article"
            ? (draft.targetSpaceId ?? defaultArticleSpaceId)
            : null,
        titleTemplate: draft.titleTemplate.trim() || "Agent Briefing · {{date}}",
        tags: tags.length > 0 ? tags : ["briefing"],
      },
      enabled: draft.enabled,
    };

    try {
      if (editingJobId) {
        await updateJobMutation.mutateAsync({ jobId: editingJobId, input: payload });
        notifier.success(t("briefings.updatedToast"), payload.name);
      } else {
        await createJobMutation.mutateAsync(payload);
        notifier.success(t("briefings.createdToast"), payload.name);
      }
      setDialogOpen(false);
    } catch (err) {
      notifier.error(t("briefings.saveFailedToast"), err);
    }
  };

  const handleToggleEnabled = async (job: AgentBriefingJobRecord, enabled: boolean) => {
    try {
      await updateJobMutation.mutateAsync({ jobId: job.id, input: { enabled } });
      notifier.success(t("briefings.updatedToast"), job.name);
    } catch (err) {
      notifier.error(t("briefings.saveFailedToast"), err);
    }
  };

  const handleRunNow = async (job: AgentBriefingJobRecord) => {
    setRunningJobId(job.id);
    try {
      const run = await runJobNowMutation.mutateAsync({ jobId: job.id });
      if (run.status === "failed") {
        notifier.error(
          t("briefings.runFailedToast"),
          run.errorMessage ?? t("inbox.failedSummaryEmpty"),
        );
      } else if (run.status === "dispatched") {
        notifier.success(t("briefings.runDispatchedToast"), job.name);
      } else {
        notifier.success(t("briefings.runSucceededToast"), job.name);
      }
    } catch (err) {
      notifier.error(t("briefings.runFailedToast"), err);
    } finally {
      setRunningJobId(null);
    }
  };

  const handleDeleteJob = async (job: AgentBriefingJobRecord) => {
    try {
      await deleteJobMutation.mutateAsync(job.id);
      notifier.success(t("briefings.deletedToast"), job.name);
    } catch (err) {
      notifier.error(t("briefings.deleteFailedToast"), err);
    }
  };

  const handleUndoBatch = async (batchId: AuditBatchId) => {
    setUndoingBatchId(batchId);
    try {
      const result = await rollbackBatchMutation.mutateAsync({ batchId });
      notifier.success(
        t("briefings.undoSuccessToast", { count: result.rolledBackCount }),
      );
    } catch (err) {
      notifier.error(t("briefings.undoFailedToast"), err);
    } finally {
      setUndoingBatchId(null);
    }
  };

  const renderStatusBadge = (status: AgentBriefingRunRecord["status"]) => {
    if (status === "failed") {
      return (
        <Badge size="sm" variant="destructive">
          {t("briefings.statusFailed")}
        </Badge>
      );
    }
    if (status === "dispatched") {
      return (
        <Badge size="sm" variant="secondary">
          {t("briefings.statusDispatched")}
        </Badge>
      );
    }
    return (
      <Badge size="sm" variant="outline">
        {t("briefings.statusSucceeded")}
      </Badge>
    );
  };

  const handleOpenDoc = (docId: DocumentId) => {
    navigation.openDocument(docId);
  };

  const selectedTokenLabel =
    draft.tokenRuleId === null
      ? t("briefings.fieldTokenPolicyNone")
      : (activeTokens.find((tk) => tk.id === draft.tokenRuleId)?.name ?? draft.tokenRuleId);

  const selectedBindingLabel =
    draft.bindingId === null
      ? t("briefings.fieldBindingNone")
      : (activeBindings.find((b) => b.id === draft.bindingId)?.title ?? draft.bindingId);

  const selectedTargetSpaceLabel =
    draft.targetSpaceId === null
      ? t("briefings.fieldTargetSpace")
      : (activeSpaces.find((s) => s.id === draft.targetSpaceId)?.name ?? draft.targetSpaceId);

  const savingPending = createJobMutation.isPending || updateJobMutation.isPending;

  return (
    <section
      className={cn(
        "flex flex-col gap-4 rounded-xl border border-border/80 bg-card p-5 shadow-xs",
        className,
      )}
      data-testid="briefings-panel"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <CalendarClockIcon className="size-4 text-primary" />
            <h2 className="text-base font-semibold tracking-tight text-foreground">
              {t("briefings.sectionTitle")}
            </h2>
            <Badge size="sm" variant="secondary">
              {jobs.length}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">{t("briefings.sectionDesc")}</p>
        </div>
        {!isReadOnly ? (
          <Button onClick={() => openCreateDialog()} size="sm" variant="default">
            <PlusIcon />
            <span>{t("briefings.newJobBtn")}</span>
          </Button>
        ) : null}
      </div>

      {/* Preset templates quick bar */}
      {!isReadOnly ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
            <SparklesIcon className="size-3.5" />
            <span>{t("briefings.presetsTitle")}</span>
          </div>
          <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
            {presets.map((preset) => {
              const labels = getPresetLabel(preset.id);
              const isConfigured = jobs.some((j) => j.cronExpr === preset.cronExpr);
              return (
                <div
                  className={cn(
                    "flex flex-col justify-between gap-2.5 rounded-lg border px-3.5 py-3",
                    isConfigured
                      ? "border-primary/40 bg-primary/[0.04]"
                      : "border-border/70 bg-muted/25",
                  )}
                  key={preset.id}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs font-medium text-foreground">
                        {labels.name}
                      </span>
                      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                        {preset.cronExpr}
                      </code>
                      {isConfigured ? (
                        <Badge size="sm" variant="secondary">
                          {t("briefings.presetActiveBadge")}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                      {labels.desc}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-1.5 pt-0.5">
                    <Button
                      disabled={createJobMutation.isPending}
                      onClick={() => openCreateDialog(preset.id)}
                      size="xs"
                      variant="ghost"
                    >
                      {t("briefings.customizePresetBtn")}
                    </Button>
                    <Button
                      disabled={createJobMutation.isPending}
                      onClick={() => void handleQuickCreatePreset(preset.id)}
                      size="xs"
                      variant="outline"
                    >
                      {isConfigured ? t("briefings.usePresetAgainBtn") : t("briefings.usePresetBtn")}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Configured jobs list */}
      {jobsQuery.isPending ? (
        <p className="text-xs text-muted-foreground">{t("common.loading")}</p>
      ) : jobs.length === 0 ? (
        <div className="flex flex-col items-start gap-1 rounded-lg border border-dashed border-border/80 bg-muted/15 px-4 py-4">
          <span className="text-xs font-medium text-foreground">{t("briefings.emptyTitle")}</span>
          <p className="text-[11px] text-muted-foreground">{t("briefings.emptyDesc")}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {jobs.map((job) => {
            const jobRuns = runsByJobId.get(job.id) ?? [];
            const nextRunFormatted = formatDateTime(job.nextRunAt);
            const lastRunFormatted = formatDateTime(job.lastRunAt);
            const isRunningThis = runningJobId === job.id;

            return (
              <div
                className="flex flex-col gap-2.5 rounded-lg border border-border/80 bg-background p-3.5"
                data-briefing-job-id={job.id}
                key={job.id}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-medium text-foreground">{job.name}</span>
                      <Badge size="sm" variant="secondary">
                        {job.executionPath === "external_ade"
                          ? t("briefings.pathExternalAde")
                          : t("briefings.pathBuiltinRag")}
                      </Badge>
                      <Badge size="sm" variant="outline">
                        {job.target.mode === "daily_section"
                          ? t("briefings.modeDailySection")
                          : t("briefings.modeSpaceArticle")}
                      </Badge>
                      {job.lastStatus ? renderStatusBadge(job.lastStatus) : null}
                    </div>
                    {job.description ? (
                      <p className="mt-1 text-xs text-muted-foreground">{job.description}</p>
                    ) : null}
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      <span className="font-mono">
                        {t("briefings.cronLabel")}: {job.cronExpr} · {job.timezone}
                      </span>
                      <span>
                        {t("briefings.nextRunLabel")}:{" "}
                        {job.enabled ? (nextRunFormatted ?? t("briefings.neverRunLabel")) : t("briefings.pausedLabel")}
                      </span>
                      <span>
                        {t("briefings.lastRunLabel")}: {lastRunFormatted ?? t("briefings.neverRunLabel")}
                      </span>
                    </div>
                  </div>

                  {!isReadOnly ? (
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <Switch
                        aria-label={t("briefings.fieldEnabled")}
                        checked={job.enabled}
                        onCheckedChange={(checked) => void handleToggleEnabled(job, Boolean(checked))}
                      />
                      <Button
                        loading={isRunningThis}
                        onClick={() => void handleRunNow(job)}
                        size="xs"
                        variant="outline"
                      >
                        <PlayIcon />
                        <span>{isRunningThis ? t("briefings.runningBtn") : t("briefings.runNowBtn")}</span>
                      </Button>
                      <Button onClick={() => openEditDialog(job)} size="xs" variant="ghost">
                        <PencilIcon />
                        <span>{t("briefings.editBtn")}</span>
                      </Button>
                      <Button
                        disabled={deleteJobMutation.isPending}
                        onClick={() => void handleDeleteJob(job)}
                        size="xs"
                        variant="ghost"
                      >
                        <Trash2Icon />
                        <span>{t("briefings.deleteBtn")}</span>
                      </Button>
                    </div>
                  ) : null}
                </div>

                {/* Recent 5 runs */}
                <div className="flex flex-col gap-1.5 border-t border-border/60 pt-2">
                  <span className="text-[11px] font-medium text-muted-foreground">
                    {t("briefings.recentRunsTitle")}
                  </span>
                  {jobRuns.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground/80">
                      {t("briefings.recentRunsEmpty")}
                    </p>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      {jobRuns.map((run) => {
                        const localizedSummary = formatLocalizedRunSummary(run, job.name, t);
                        return (
                          <div
                            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/50 bg-muted/20 px-2.5 py-1.5 text-xs"
                            key={run.id}
                          >
                            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                              {renderStatusBadge(run.status)}
                              <span className="text-[11px] text-muted-foreground">
                                {run.triggerKind === "schedule"
                                  ? t("briefings.triggerSchedule")
                                  : t("briefings.triggerManual")}
                              </span>
                              <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                                {formatDateTime(run.startedAt)}
                              </span>
                              <span className="min-w-0 truncate text-[11px] text-foreground">
                                {localizedSummary}
                              </span>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              {run.status === "failed" && !isReadOnly ? (
                                <Button
                                  disabled={isRunningThis}
                                  loading={isRunningThis}
                                  onClick={() => void handleRunNow(job)}
                                  size="xs"
                                  variant="ghost"
                                >
                                  <RotateCcwIcon />
                                  <span>{t("briefings.retryNowBtn")}</span>
                                </Button>
                              ) : null}
                              {run.documentId ? (
                                <Button
                                  onClick={() => handleOpenDoc(run.documentId!)}
                                  size="xs"
                                  variant="outline"
                                >
                                  <ExternalLinkIcon />
                                  <span>{t("briefings.openTargetDoc")}</span>
                                </Button>
                              ) : null}
                              {!isReadOnly && run.batchId && run.status === "succeeded" ? (
                                <Button
                                  loading={undoingBatchId === run.batchId}
                                  onClick={() => void handleUndoBatch(run.batchId!)}
                                  size="xs"
                                  variant="outline"
                                >
                                  <RotateCcwIcon />
                                  <span>{t("briefings.undoBatchBtn")}</span>
                                </Button>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create / Edit Briefing Job Dialog */}
      <Dialog onOpenChange={setDialogOpen} open={dialogOpen}>
        <DialogPopup className="max-w-2xl">
          <form
            className="flex min-h-0 flex-1 flex-col overflow-hidden"
            onSubmit={(e) => void handleSaveJob(e)}
          >
            <DialogHeader>
              <DialogTitle>
                {editingJobId ? t("briefings.dialogEditTitle") : t("briefings.dialogCreateTitle")}
              </DialogTitle>
              <DialogDescription>{t("briefings.dialogSubtitle")}</DialogDescription>
            </DialogHeader>

            <DialogPanel className="flex flex-col gap-3.5">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-xs">
                  <span className="font-medium text-foreground">{t("briefings.fieldName")}</span>
                  <Input
                    onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder={t("briefings.fieldNamePlaceholder")}
                    required
                    size="sm"
                    value={draft.name}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs">
                  <span className="font-medium text-foreground">{t("briefings.fieldDesc")}</span>
                  <Input
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, description: e.target.value }))
                    }
                    placeholder={t("briefings.fieldDescPlaceholder")}
                    size="sm"
                    value={draft.description}
                  />
                </label>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-xs">
                  <span className="font-medium text-foreground">{t("briefings.fieldCron")}</span>
                  <Input
                    onChange={(e) => setDraft((prev) => ({ ...prev, cronExpr: e.target.value }))}
                    placeholder={t("briefings.fieldCronPlaceholder")}
                    required
                    size="sm"
                    value={draft.cronExpr}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs">
                  <span className="font-medium text-foreground">{t("briefings.fieldTimezone")}</span>
                  <Input
                    onChange={(e) => setDraft((prev) => ({ ...prev, timezone: e.target.value }))}
                    placeholder={t("briefings.fieldTimezonePlaceholder")}
                    required
                    size="sm"
                    value={draft.timezone}
                  />
                </label>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1 text-xs">
                  <span className="font-medium text-foreground">
                    {t("briefings.fieldExecutionPath")}
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    <Button
                      onClick={() =>
                        setDraft((prev) => ({ ...prev, executionPath: "builtin_rag" }))
                      }
                      size="xs"
                      type="button"
                      variant={draft.executionPath === "builtin_rag" ? "default" : "outline"}
                    >
                      {t("briefings.pathBuiltinRag")}
                    </Button>
                    <Button
                      onClick={() =>
                        setDraft((prev) => ({ ...prev, executionPath: "external_ade" }))
                      }
                      size="xs"
                      type="button"
                      variant={draft.executionPath === "external_ade" ? "default" : "outline"}
                    >
                      {t("briefings.pathExternalAde")}
                    </Button>
                  </div>
                </div>

                {isAdmin ? (
                  <div className="flex flex-col gap-1 text-xs">
                    <span className="font-medium text-foreground">
                      {t("briefings.fieldTokenPolicy")}
                    </span>
                    <Select
                      onValueChange={(value) =>
                        setDraft((prev) => ({
                          ...prev,
                          tokenRuleId: value && value !== "__none__" ? (value as ApiTokenId) : null,
                        }))
                      }
                      value={draft.tokenRuleId ?? "__none__"}
                    >
                      <SelectTrigger size="sm">
                        <SelectValue>{selectedTokenLabel}</SelectValue>
                      </SelectTrigger>
                      <SelectPopup>
                        <SelectItem value="__none__">
                          {t("briefings.fieldTokenPolicyNone")}
                        </SelectItem>
                        {activeTokens.map((token) => (
                          <SelectItem key={token.id} value={token.id}>
                            {`${token.name} (${token.tokenPrefix}…)`}
                          </SelectItem>
                        ))}
                      </SelectPopup>
                    </Select>
                    <span className="text-[10px] text-muted-foreground">
                      {t("briefings.tokenPolicyHint")}
                    </span>
                  </div>
                ) : null}
              </div>

              {draft.executionPath === "external_ade" ? (
                <div className="flex flex-col gap-1 text-xs">
                  <span className="font-medium text-foreground">{t("briefings.fieldBinding")}</span>
                  <Select
                    onValueChange={(value) =>
                      setDraft((prev) => ({
                        ...prev,
                        bindingId: value && value !== "__none__" ? (value as ThreadBindingId) : null,
                      }))
                    }
                    value={draft.bindingId ?? "__none__"}
                  >
                    <SelectTrigger size="sm">
                      <SelectValue>{selectedBindingLabel}</SelectValue>
                    </SelectTrigger>
                    <SelectPopup>
                      <SelectItem value="__none__">{t("briefings.fieldBindingNone")}</SelectItem>
                      {activeBindings.map((binding) => (
                        <SelectItem key={binding.id} value={binding.id}>
                          {`${binding.title} (${binding.adeKind})`}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                </div>
              ) : null}

              <label className="flex flex-col gap-1 text-xs">
                <span className="font-medium text-foreground">{t("briefings.fieldPrompt")}</span>
                <Textarea
                  className="min-h-20 text-xs"
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, promptTemplate: e.target.value }))
                  }
                  placeholder={t("briefings.fieldPromptPlaceholder")}
                  required
                  value={draft.promptTemplate}
                />
              </label>

              {/* Sources configuration */}
              <div className="flex flex-col gap-2 rounded-lg border border-border/70 bg-muted/20 p-3 text-xs">
                <span className="font-medium text-foreground">{t("briefings.fieldSourcesTitle")}</span>
                <div className="flex flex-wrap items-center gap-4">
                  <label className="flex items-center gap-2">
                    <Switch
                      checked={draft.includeRssFeeds}
                      onCheckedChange={(checked) =>
                        setDraft((prev) => ({ ...prev, includeRssFeeds: Boolean(checked) }))
                      }
                    />
                    <span>{t("briefings.fieldIncludeRss")}</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <Switch
                      checked={draft.includeTasks}
                      onCheckedChange={(checked) =>
                        setDraft((prev) => ({ ...prev, includeTasks: Boolean(checked) }))
                      }
                    />
                    <span>{t("briefings.fieldIncludeTasks")}</span>
                  </label>
                  <label className="flex items-center gap-1.5">
                    <span className="text-muted-foreground">{t("briefings.fieldIncludeClipsDays")}</span>
                    <Input
                      className="w-16"
                      max={365}
                      min={0}
                      onChange={(e) =>
                        setDraft((prev) => ({ ...prev, includeClipsLastDays: e.target.value }))
                      }
                      size="sm"
                      type="number"
                      value={draft.includeClipsLastDays}
                    />
                  </label>
                </div>

                <label className="flex items-center gap-2 pt-1">
                  <Checkbox
                    checked={draft.sourceAllSpaces}
                    onCheckedChange={(checked) =>
                      setDraft((prev) => ({ ...prev, sourceAllSpaces: Boolean(checked) }))
                    }
                  />
                  <span>{t("briefings.fieldSourceSpacesAll")}</span>
                </label>

                {!draft.sourceAllSpaces ? (
                  <div className="flex flex-wrap gap-2 pl-5">
                    {activeSpaces.map((space) => {
                      const checked = draft.sourceSpaceIds.includes(space.id);
                      return (
                        <label className="flex items-center gap-1.5 text-[11px]" key={space.id}>
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(next) =>
                              setDraft((prev) => ({
                                ...prev,
                                sourceSpaceIds: next
                                  ? [...prev.sourceSpaceIds, space.id]
                                  : prev.sourceSpaceIds.filter((id) => id !== space.id),
                              }))
                            }
                          />
                          <span>{space.name}</span>
                        </label>
                      );
                    })}
                  </div>
                ) : null}

                {(packsQuery.data ?? []).length > 0 ? (
                  <div className="flex flex-col gap-1 pt-1">
                    <span className="text-[11px] text-muted-foreground">
                      {t("briefings.fieldContextPacks")}
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {(packsQuery.data ?? []).map((pack) => {
                        const checked = draft.contextPackIds.includes(pack.id);
                        return (
                          <label className="flex items-center gap-1.5 text-[11px]" key={pack.id}>
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(next) =>
                                setDraft((prev) => ({
                                  ...prev,
                                  contextPackIds: next
                                    ? [...prev.contextPackIds, pack.id]
                                    : prev.contextPackIds.filter((id) => id !== pack.id),
                                }))
                              }
                            />
                            <span>{pack.name}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>

              {/* Target mode */}
              <div className="flex flex-col gap-2 rounded-lg border border-border/70 bg-muted/20 p-3 text-xs">
                <span className="font-medium text-foreground">{t("briefings.fieldTargetMode")}</span>
                <div className="flex flex-wrap gap-1.5">
                  <Button
                    onClick={() => setDraft((prev) => ({ ...prev, targetMode: "daily_section" }))}
                    size="xs"
                    type="button"
                    variant={draft.targetMode === "daily_section" ? "default" : "outline"}
                  >
                    {t("briefings.modeDailySection")}
                  </Button>
                  <Button
                    onClick={() => setDraft((prev) => ({ ...prev, targetMode: "space_article" }))}
                    size="xs"
                    type="button"
                    variant={draft.targetMode === "space_article" ? "default" : "outline"}
                  >
                    {t("briefings.modeSpaceArticle")}
                  </Button>
                </div>

                {draft.targetMode === "daily_section" ? (
                  <label className="flex flex-col gap-1">
                    <span className="text-muted-foreground">{t("briefings.fieldSectionHeading")}</span>
                    <Input
                      onChange={(e) =>
                        setDraft((prev) => ({ ...prev, sectionHeading: e.target.value }))
                      }
                      placeholder={t("briefings.fieldSectionHeadingPlaceholder")}
                      size="sm"
                      value={draft.sectionHeading}
                    />
                  </label>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="flex flex-col gap-1">
                      <span className="text-muted-foreground">{t("briefings.fieldTargetSpace")}</span>
                      <Select
                        onValueChange={(value) =>
                          setDraft((prev) => ({
                            ...prev,
                            targetSpaceId: value ? (value as SpaceId) : null,
                          }))
                        }
                        value={draft.targetSpaceId ?? defaultArticleSpaceId ?? ""}
                      >
                        <SelectTrigger size="sm">
                          <SelectValue>{selectedTargetSpaceLabel}</SelectValue>
                        </SelectTrigger>
                        <SelectPopup>
                          {activeSpaces.map((space) => (
                            <SelectItem key={space.id} value={space.id}>
                              {space.name}
                            </SelectItem>
                          ))}
                        </SelectPopup>
                      </Select>
                    </div>
                    <label className="flex flex-col gap-1">
                      <span className="text-muted-foreground">
                        {t("briefings.fieldTitleTemplate")}
                      </span>
                      <Input
                        onChange={(e) =>
                          setDraft((prev) => ({ ...prev, titleTemplate: e.target.value }))
                        }
                        placeholder={t("briefings.fieldTitleTemplatePlaceholder")}
                        size="sm"
                        value={draft.titleTemplate}
                      />
                    </label>
                    <label className="flex flex-col gap-1 sm:col-span-2">
                      <span className="text-muted-foreground">{t("briefings.fieldTags")}</span>
                      <Input
                        onChange={(e) => setDraft((prev) => ({ ...prev, tagsText: e.target.value }))}
                        placeholder={t("briefings.fieldTagsPlaceholder")}
                        size="sm"
                        value={draft.tagsText}
                      />
                    </label>
                  </div>
                )}

                <label className="flex items-center gap-2 pt-1">
                  <Switch
                    checked={draft.enabled}
                    onCheckedChange={(checked) =>
                      setDraft((prev) => ({ ...prev, enabled: Boolean(checked) }))
                    }
                  />
                  <span>{t("briefings.fieldEnabled")}</span>
                </label>
              </div>
            </DialogPanel>

            <DialogFooter>
              <Button onClick={() => setDialogOpen(false)} size="sm" type="button" variant="ghost">
                {t("briefings.cancelBtn")}
              </Button>
              <Button loading={savingPending} size="sm" type="submit" variant="default">
                {editingJobId ? t("briefings.saveUpdateBtn") : t("briefings.saveCreateBtn")}
              </Button>
            </DialogFooter>
          </form>
        </DialogPopup>
      </Dialog>
    </section>
  );
}
