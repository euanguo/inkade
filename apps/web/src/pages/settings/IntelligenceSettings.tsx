import {
  AI_PROVIDER_DEFAULTS,
  EMBEDDING_PROVIDER_DEFAULTS,
  type AiProviderPreset,
  type EmbeddingProviderPreset,
  type ReindexSearchResult,
  type TestEmbeddingResult,
  type TokenPermission,
} from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import { inkadeQueryKeys } from "@inkade/sdk";
import {
  inkadeQueries,
  useInkadeAiSettings,
  useInkadeClient,
  useInkadeSearchIndexStatus,
  useInkadeWhoami,
  useInkadeWorkspaceSummary,
  useReindexSearchMutation,
  useTestEmbeddingMutation,
  useUpdateAiSettingsMutation,
} from "@inkade/sdk/react";
import {
  Badge,
  BucketMeter,
  type BucketMeterSegment,
  Button,
  CopyButton,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
  Input,
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Switch,
} from "@inkade/ui";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2Icon,
  CpuIcon,
  DatabaseIcon,
  KeyRoundIcon,
  PlugZapIcon,
  RefreshCwIcon,
  SparklesIcon,
  Trash2Icon,
} from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { showErrorToast, showSuccessToast } from "../../lib/undo.ts";
import { SettingRow, SettingsGroup, SettingsSectionHeader } from "./SettingRow.tsx";
import { formatByteSize } from "./types.ts";

export function IntelligenceSettings(): React.ReactElement {
  const { t } = useInkadeTranslation();
  const client = useInkadeClient();
  const queryClient = useQueryClient();
  const [lastResult, setLastResult] = useState<ReindexSearchResult | null>(null);
  const [lastEmbTest, setLastEmbTest] = useState<TestEmbeddingResult | null>(null);
  const [pollIndexActive, setPollIndexActive] = useState(false);

  const aiSchema = useMemo(
    () =>
      z
        .object({
          enabled: z.boolean(),
          provider: z.enum(["openai", "anthropic", "deepseek", "ollama", "custom"]),
          baseUrl: z.string(),
          model: z.string(),
          temperature: z.string().refine(
            (val) => {
              const n = Number.parseFloat(val);
              return Number.isFinite(n) && n >= 0 && n <= 2;
            },
            { message: t("validation.numberRange", { min: 0, max: 2 }) },
          ),
          apiKeyDraft: z.string(),
          clearApiKey: z.boolean(),
          embeddingProvider: z.enum(["local", "ollama", "openai", "openai-compatible"]),
          embeddingBaseUrl: z.string(),
          embeddingModel: z.string(),
          embeddingApiKeyDraft: z.string(),
          clearEmbeddingApiKey: z.boolean(),
        })
        .superRefine((vals, ctx) => {
          if (vals.enabled) {
            if (!vals.baseUrl.trim()) {
              ctx.addIssue({
                code: "custom",
                path: ["baseUrl"],
                message: t("validation.required"),
              });
            }
            if (!vals.model.trim()) {
              ctx.addIssue({
                code: "custom",
                path: ["model"],
                message: t("validation.required"),
              });
            }
          }
          if (vals.embeddingProvider !== "local") {
            if (!vals.embeddingBaseUrl.trim()) {
              ctx.addIssue({
                code: "custom",
                path: ["embeddingBaseUrl"],
                message: t("validation.required"),
              });
            }
            if (!vals.embeddingModel.trim()) {
              ctx.addIssue({
                code: "custom",
                path: ["embeddingModel"],
                message: t("validation.required"),
              });
            }
          }
        }),
    [t],
  );
  type AiFormValues = z.infer<typeof aiSchema>;

  const aiForm = useForm<AiFormValues>({
    resolver: zodResolver(aiSchema),
    defaultValues: {
      enabled: false,
      provider: "openai",
      baseUrl: AI_PROVIDER_DEFAULTS.openai.baseUrl,
      model: AI_PROVIDER_DEFAULTS.openai.model,
      temperature: "0.3",
      apiKeyDraft: "",
      clearApiKey: false,
      embeddingProvider: "local",
      embeddingBaseUrl: EMBEDDING_PROVIDER_DEFAULTS.local.baseUrl,
      embeddingModel: EMBEDDING_PROVIDER_DEFAULTS.local.model,
      embeddingApiKeyDraft: "",
      clearEmbeddingApiKey: false,
    },
  });

  const aiProvider = useWatch({ control: aiForm.control, name: "provider" });
  const aiClearKey = useWatch({ control: aiForm.control, name: "clearApiKey" });
  const embProvider = useWatch({ control: aiForm.control, name: "embeddingProvider" });
  const embClearKey = useWatch({ control: aiForm.control, name: "clearEmbeddingApiKey" });
  const embBaseUrlVal = useWatch({ control: aiForm.control, name: "embeddingBaseUrl" });
  const embModelVal = useWatch({ control: aiForm.control, name: "embeddingModel" });
  const embKeyDraftVal = useWatch({ control: aiForm.control, name: "embeddingApiKeyDraft" });

  const summaryQuery = useInkadeWorkspaceSummary();
  const whoamiQuery = useInkadeWhoami();
  const bucketsQuery = useQuery({
    ...inkadeQueries.storageBuckets(client),
    retry: false,
  });
  const aiSettingsQuery = useInkadeAiSettings();
  const indexStatusQuery = useInkadeSearchIndexStatus({
    refetchInterval: pollIndexActive ? 800 : false,
  });

  useEffect(() => {
    setPollIndexActive(Boolean(indexStatusQuery.data?.reindexing.active));
  }, [indexStatusQuery.data?.reindexing.active]);

  useEffect(() => {
    const data = aiSettingsQuery.data;
    if (!data || aiForm.formState.isDirty) return;
    aiForm.reset({
      enabled: data.enabled,
      provider: data.provider,
      baseUrl: data.baseUrl,
      model: data.model,
      temperature: String(data.temperature),
      apiKeyDraft: "",
      clearApiKey: false,
      embeddingProvider: data.embeddingProvider,
      embeddingBaseUrl: data.embeddingBaseUrl,
      embeddingModel: data.embeddingModel,
      embeddingApiKeyDraft: "",
      clearEmbeddingApiKey: false,
    });
  }, [aiForm, aiSettingsQuery.data]);

  const updateAiMutation = useUpdateAiSettingsMutation({
    onSuccess: (saved) => {
      aiForm.reset({
        enabled: saved.enabled,
        provider: saved.provider,
        baseUrl: saved.baseUrl,
        model: saved.model,
        temperature: String(saved.temperature),
        apiKeyDraft: "",
        clearApiKey: false,
        embeddingProvider: saved.embeddingProvider,
        embeddingBaseUrl: saved.embeddingBaseUrl,
        embeddingModel: saved.embeddingModel,
        embeddingApiKeyDraft: "",
        clearEmbeddingApiKey: false,
      });
      showSuccessToast(t("settings.aiSaveSuccessToast"));
    },
    onError: (err) => showErrorToast(t("settings.aiSaveFailedToast"), err),
  });

  const testEmbMutation = useTestEmbeddingMutation({
    onSuccess: (res) => {
      setLastEmbTest(res);
      showSuccessToast(
        t("settings.embTestSuccess", {
          dimensions: res.dimensions,
          latencyMs: res.latencyMs,
          model: res.model,
        }),
      );
    },
    onError: (err) => showErrorToast(t("settings.embTestFailedToast"), err),
  });

  const reindexMutation = useReindexSearchMutation({
    onMutate: () => {
      setPollIndexActive(true);
    },
    onSuccess: (result) => {
      setLastResult(result);
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.searchIndexStatus() }),
        queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.storageBuckets() }),
      ]);
      showSuccessToast(
        t("settings.ragReindexSuccessToast"),
        t("settings.ragReindexResultBanner", {
          indexed: result.indexedCount,
          skipped: result.skippedCount,
          provider: result.provider,
          model: result.model,
        }),
      );
    },
    onError: (err) => showErrorToast(t("settings.ragReindexFailedToast"), err),
    onSettled: () => {
      setPollIndexActive(false);
    },
  });

  const handleProviderChange = (next: AiProviderPreset): void => {
    aiForm.setValue("provider", next, { shouldDirty: true });
    const defaults = AI_PROVIDER_DEFAULTS[next];
    if (defaults.baseUrl) {
      aiForm.setValue("baseUrl", defaults.baseUrl, { shouldDirty: true });
    }
    aiForm.setValue("model", defaults.model, { shouldDirty: true });
  };

  const handleEmbeddingProviderChange = (next: EmbeddingProviderPreset): void => {
    aiForm.setValue("embeddingProvider", next, { shouldDirty: true });
    const defaults = EMBEDDING_PROVIDER_DEFAULTS[next];
    aiForm.setValue("embeddingBaseUrl", defaults.baseUrl, { shouldDirty: true });
    aiForm.setValue("embeddingModel", defaults.model, { shouldDirty: true });
    setLastEmbTest(null);
  };

  const handleAiSubmit = aiForm.handleSubmit((values) => {
    const parsedTemp = Number.parseFloat(values.temperature);
    const safeTemp = Number.isFinite(parsedTemp) ? Math.min(2, Math.max(0, parsedTemp)) : 0.3;
    updateAiMutation.mutate({
      enabled: values.enabled,
      provider: values.provider,
      baseUrl: values.baseUrl.trim(),
      model: values.model.trim(),
      temperature: safeTemp,
      ...(values.clearApiKey
        ? { clearApiKey: true }
        : values.apiKeyDraft.trim().length > 0
          ? { apiKey: values.apiKeyDraft.trim() }
          : {}),
      embeddingProvider: values.embeddingProvider,
      embeddingBaseUrl: values.embeddingBaseUrl.trim(),
      embeddingModel: values.embeddingModel.trim(),
      ...(values.clearEmbeddingApiKey
        ? { clearEmbeddingApiKey: true }
        : values.embeddingApiKeyDraft.trim().length > 0
          ? { embeddingApiKey: values.embeddingApiKeyDraft.trim() }
          : {}),
    });
  });

  const handleTestEmbedding = (): void => {
    testEmbMutation.mutate({
      embeddingProvider: embProvider,
      ...(embBaseUrlVal.trim() ? { embeddingBaseUrl: embBaseUrlVal.trim() } : {}),
      ...(embModelVal.trim() ? { embeddingModel: embModelVal.trim() } : {}),
      ...(embKeyDraftVal.trim() ? { embeddingApiKey: embKeyDraftVal.trim() } : {}),
    });
  };

  const totalDocs = (summaryQuery.data?.spaces ?? []).reduce(
    (sum, entry) => sum + entry.activeCount,
    0,
  );
  const spaceCount = summaryQuery.data?.spaces.length ?? 0;
  const tagCount = summaryQuery.data?.tags.length ?? 0;

  const permission = whoamiQuery.data?.scope.permission ?? "admin";
  const canReindex = permission === "admin";
  const permissionLabels: Readonly<Record<TokenPermission, string>> = {
    read: t("common.permissionRead"),
    append: t("common.permissionAppend"),
    write: t("common.permissionWrite"),
    admin: t("common.permissionAdmin"),
  };

  const indexStatus = indexStatusQuery.data;
  const providerName =
    lastResult?.provider ??
    indexStatus?.provider ??
    aiSettingsQuery.data?.embeddingProvider ??
    "local";
  const modelName =
    lastResult?.model ??
    indexStatus?.model ??
    aiSettingsQuery.data?.embeddingModel ??
    EMBEDDING_PROVIDER_DEFAULTS.local.model;

  const indexedDocs = indexStatus?.indexedDocuments ?? bucketsQuery.data?.indexedCount ?? totalDocs;
  const bucketTotalDocs =
    indexStatus?.totalDocuments ?? bucketsQuery.data?.totalDocumentCount ?? totalDocs;
  const indexedChunks = indexStatus?.indexedChunks ?? 0;
  const indexedDimensions =
    indexStatus?.dimensions ?? EMBEDDING_PROVIDER_DEFAULTS.local.dimensions;
  const reindexProgress = indexStatus?.reindexing;
  const progressPct =
    reindexProgress && reindexProgress.totalDocs > 0
      ? Math.min(100, Math.round((reindexProgress.processedDocs / reindexProgress.totalDocs) * 100))
      : 0;

  const bucketSegments: readonly BucketMeterSegment[] = useMemo(() => {
    const data = bucketsQuery.data;
    if (!data) return [];
    const byKey = new Map(data.buckets.map((bucket) => [bucket.key, bucket]));
    return [
      {
        id: "articles",
        label: t("settings.bucketArticles"),
        value: byKey.get("articles")?.bytes ?? 0,
        tone: "primary",
      },
      {
        id: "outlines",
        label: t("settings.bucketOutlines"),
        value: byKey.get("outlines")?.bytes ?? 0,
        tone: "info",
      },
      {
        id: "clips",
        label: t("settings.bucketClips"),
        value: byKey.get("clips")?.bytes ?? 0,
        tone: "teal",
      },
      {
        id: "attachments",
        label: t("settings.bucketAttachments"),
        value: byKey.get("attachments")?.bytes ?? 0,
        tone: "warning",
      },
    ];
  }, [bucketsQuery.data, t]);

  const ragDiagnostics = useMemo(
    () =>
      JSON.stringify(
        {
          engine: "orama-hybrid",
          provider: providerName,
          model: modelName,
          dimensions: indexedDimensions,
          indexedDocs,
          indexedChunks,
          totalDocs: bucketTotalDocs,
          pendingJobs: indexStatus?.pendingJobs ?? 0,
          lastIndexedAt: indexStatus?.lastIndexedAt ?? null,
          spaces: spaceCount,
          tags: tagCount,
          usedBytes: bucketsQuery.data?.totalUsedBytes ?? 0,
          quotaBytes: bucketsQuery.data?.quotaLimitBytes ?? 0,
        },
        null,
        2,
      ),
    [
      bucketTotalDocs,
      bucketsQuery.data?.quotaLimitBytes,
      bucketsQuery.data?.totalUsedBytes,
      indexStatus?.lastIndexedAt,
      indexStatus?.pendingJobs,
      indexedChunks,
      indexedDimensions,
      indexedDocs,
      modelName,
      providerName,
      spaceCount,
      tagCount,
    ],
  );

  const isLlmConfigured =
    Boolean(aiSettingsQuery.data?.enabled) &&
    (aiSettingsQuery.data?.provider === "ollama" || Boolean(aiSettingsQuery.data?.hasApiKey));

  return (
    <div className="flex flex-col gap-6">
      <SettingsSectionHeader
        actions={
          <CopyButton
            copiedLabel={t("settings.diagnosticsCopied")}
            label={t("settings.copyDiagnostics")}
            showLabel
            size="sm"
            value={ragDiagnostics}
            variant="outline"
          />
        }
        description={t("settings.sectionRagDesc")}
        title={t("settings.sectionRagLabel")}
      />

      {bucketsQuery.data ? (
        <SettingsGroup title={t("settings.ragBucketsSummaryTitle")}>
          <SettingRow
            badge={
              <Badge size="sm" variant="secondary">
                {t("settings.ragIndexedCoverage", {
                  indexed: indexedDocs,
                  total: bucketTotalDocs,
                })}
              </Badge>
            }
            description={t("settings.storageQuotaCardDesc")}
            layout="vertical"
            title={t("settings.storageQuotaCardTitle")}
          >
            <BucketMeter
              ariaLabel={t("settings.bucketMeterAria")}
              capacity={bucketsQuery.data.quotaLimitBytes}
              formatValue={(bytes) => formatByteSize(bytes)}
              highWatermarkRatio={0.85}
              scaleMode="auto"
              segments={bucketSegments}
            />
          </SettingRow>
        </SettingsGroup>
      ) : null}

      <SettingsGroup>
        <SettingRow
          badge={
            <Badge size="sm" variant="secondary">
              <SparklesIcon className="size-3 text-primary" />
              {t("settings.ragStatusReady")}
            </Badge>
          }
          description={t("settings.ragEngineDesc")}
          title={t("settings.ragModeEngineLabel")}
        >
          <span className="font-mono text-xs text-muted-foreground">
            {t("settings.ragChunksStat", {
              docs: indexedDocs,
              chunks: indexedChunks,
              dimensions: indexedDimensions,
            })}
          </span>
        </SettingRow>

        <SettingRow
          description={t("settings.ragDocCountDesc")}
          title={t("settings.ragDocCountTitle")}
        >
          {summaryQuery.isPending ? (
            <Skeleton className="h-5 w-40" />
          ) : (
            <div className="flex flex-col items-end gap-0.5 text-right">
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground tabular-nums">
                <DatabaseIcon className="size-3.5 text-muted-foreground" />
                {t("settings.ragDocCountStat", {
                  docs: totalDocs,
                  spaces: spaceCount,
                  tags: tagCount,
                })}
              </span>
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {indexStatus?.lastIndexedAt
                  ? t("settings.ragLastIndexedAt", {
                      time: new Date(indexStatus.lastIndexedAt).toLocaleString(),
                    })
                  : t("settings.ragNotIndexedYet")}
              </span>
            </div>
          )}
        </SettingRow>

        <SettingRow
          description={t("settings.ragModelDesc")}
          title={t("settings.ragModelTitle")}
        >
          <span className="inline-flex items-center gap-1.5 rounded-md border bg-muted/50 px-2 py-1 font-mono text-xs text-foreground">
            <CpuIcon className="size-3.5 text-muted-foreground" />
            <span>{`${providerName} / ${modelName}`}</span>
          </span>
        </SettingRow>

        <SettingRow
          description={t("settings.ragReindexDesc")}
          layout="vertical"
          title={t("settings.ragReindexTitle")}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            {!canReindex ? (
              <p className="text-xs text-warning-foreground">
                {t("settings.ragAdminRequiredHint", {
                  permission: permissionLabels[permission],
                })}
              </p>
            ) : (
              <div />
            )}
            <Button
              disabled={!canReindex}
              loading={reindexMutation.isPending}
              onClick={() => reindexMutation.mutate()}
              size="sm"
              variant="outline"
            >
              <RefreshCwIcon className={reindexMutation.isPending ? "animate-spin" : undefined} />
              <span>
                {reindexMutation.isPending
                  ? t("settings.ragReindexingAction")
                  : t("settings.ragReindexAction")}
              </span>
            </Button>
          </div>

          {reindexMutation.isPending || reindexProgress?.active ? (
            <div className="flex flex-col gap-1.5 pt-1" role="status">
              <div className="flex items-center justify-between text-xs text-muted-foreground tabular-nums">
                <span>
                  {t("settings.ragProgressLabel", {
                    processed: reindexProgress?.processedDocs ?? 0,
                    total: reindexProgress?.totalDocs ?? bucketTotalDocs,
                    chunks: reindexProgress?.processedChunks ?? indexedChunks,
                  })}
                </span>
                <span>{`${progressPct}%`}</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-[var(--duration-fast)]"
                  style={{ width: `${Math.max(8, progressPct)}%` }}
                />
              </div>
            </div>
          ) : null}

          {lastResult ? (
            <div
              className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-xs text-success-foreground"
              role="status"
            >
              <CheckCircle2Icon className="size-4 shrink-0" />
              <span>
                {t("settings.ragReindexResultBanner", {
                  indexed: lastResult.indexedCount,
                  skipped: lastResult.skippedCount,
                  provider: lastResult.provider,
                  model: lastResult.model,
                })}
              </span>
            </div>
          ) : null}
        </SettingRow>
      </SettingsGroup>

      <Form {...aiForm}>
        <form className="flex flex-col gap-6" noValidate onSubmit={(e) => void handleAiSubmit(e)}>
          <SettingsGroup
            description={t("settings.embConfigDesc")}
            title={t("settings.embConfigTitle")}
          >
            <SettingRow
              description={t("settings.embProviderLabel")}
              title={t("settings.embProviderLabel")}
            >
              <div className="w-52">
                <FormField
                  control={aiForm.control}
                  name="embeddingProvider"
                  render={({ field }) => (
                    <Select
                      disabled={!canReindex}
                      onValueChange={(value) => {
                        if (
                          value === "local" ||
                          value === "ollama" ||
                          value === "openai" ||
                          value === "openai-compatible"
                        ) {
                          handleEmbeddingProviderChange(value);
                        }
                      }}
                      value={field.value}
                    >
                      <SelectTrigger aria-label={t("settings.embProviderLabel")} size="sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectPopup>
                        <SelectItem value="local">{t("settings.embProviderLocal")}</SelectItem>
                        <SelectItem value="ollama">{t("settings.embProviderOllama")}</SelectItem>
                        <SelectItem value="openai">{t("settings.embProviderOpenAI")}</SelectItem>
                        <SelectItem value="openai-compatible">
                          {t("settings.embProviderCustom")}
                        </SelectItem>
                      </SelectPopup>
                    </Select>
                  )}
                />
              </div>
            </SettingRow>

            <SettingRow
              description={
                embProvider === "ollama"
                  ? t("settings.aiEndpointOllamaNote")
                  : t("settings.aiEndpointDesc")
              }
              layout="vertical"
              title={t("settings.embModelLabel")}
            >
              <div className="grid gap-3 sm:grid-cols-3">
                <FormField
                  control={aiForm.control}
                  name="embeddingBaseUrl"
                  render={({ field }) => (
                    <FormItem className="gap-1 sm:col-span-2">
                      <span className="text-[11px] font-medium text-muted-foreground">
                        {t("settings.embBaseUrlLabel")}
                      </span>
                      <FormControl>
                        <Input
                          aria-label={t("settings.embBaseUrlLabel")}
                          disabled={!canReindex || embProvider === "local"}
                          placeholder={
                            EMBEDDING_PROVIDER_DEFAULTS[embProvider].baseUrl ||
                            AI_PROVIDER_DEFAULTS.openai.baseUrl
                          }
                          size="sm"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={aiForm.control}
                  name="embeddingModel"
                  render={({ field }) => (
                    <FormItem className="gap-1">
                      <span className="text-[11px] font-medium text-muted-foreground">
                        {t("settings.embModelLabel")}
                      </span>
                      <FormControl>
                        <Input
                          aria-label={t("settings.embModelLabel")}
                          disabled={!canReindex || embProvider === "local"}
                          placeholder={EMBEDDING_PROVIDER_DEFAULTS[embProvider].model}
                          size="sm"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {embProvider !== "local" ? (
                <FormField
                  control={aiForm.control}
                  name="embeddingApiKeyDraft"
                  render={({ field }) => (
                    <FormItem className="gap-1 pt-2">
                      <span className="text-[11px] font-medium text-muted-foreground">
                        {t("settings.embApiKeyLabel")}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <FormControl>
                          <Input
                            aria-label={t("settings.embApiKeyLabel")}
                            autoComplete="new-password"
                            className="flex-1"
                            disabled={!canReindex}
                            placeholder={
                              aiSettingsQuery.data?.hasEmbeddingApiKey &&
                              aiSettingsQuery.data.embeddingApiKeyMasked &&
                              !embClearKey
                                ? t("settings.aiApiKeyMaskedPlaceholder", {
                                    masked: aiSettingsQuery.data.embeddingApiKeyMasked,
                                  })
                                : t("settings.aiApiKeyEmptyPlaceholder")
                            }
                            size="sm"
                            startAddon={<KeyRoundIcon className="size-3.5 text-muted-foreground" />}
                            type="password"
                            value={field.value}
                            onBlur={field.onBlur}
                            onChange={(e) => {
                              aiForm.setValue("clearEmbeddingApiKey", false, {
                                shouldDirty: true,
                              });
                              field.onChange(e);
                            }}
                          />
                        </FormControl>
                        {aiSettingsQuery.data?.hasEmbeddingApiKey && !embClearKey ? (
                          <Button
                            aria-label={t("settings.embClearKeyAction")}
                            disabled={!canReindex}
                            onClick={() => {
                              aiForm.setValue("embeddingApiKeyDraft", "", { shouldDirty: true });
                              aiForm.setValue("clearEmbeddingApiKey", true, { shouldDirty: true });
                            }}
                            size="sm"
                            type="button"
                            variant="outline"
                          >
                            <Trash2Icon className="size-3.5" />
                            <span>{t("settings.embClearKeyAction")}</span>
                          </Button>
                        ) : null}
                      </div>
                      {embClearKey ? (
                        <p className="text-[11px] text-warning-foreground">
                          {t("settings.embKeyWillBeCleared")}
                        </p>
                      ) : null}
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ) : null}

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                <Button
                  disabled={!canReindex}
                  loading={testEmbMutation.isPending}
                  onClick={handleTestEmbedding}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <PlugZapIcon className="size-3.5" />
                  <span>
                    {testEmbMutation.isPending
                      ? t("settings.embTestingAction")
                      : t("settings.embTestAction")}
                  </span>
                </Button>
                {lastEmbTest ? (
                  <span className="inline-flex items-center gap-1.5 text-xs text-success-foreground tabular-nums">
                    <CheckCircle2Icon className="size-3.5" />
                    {t("settings.embTestSuccess", {
                      dimensions: lastEmbTest.dimensions,
                      latencyMs: lastEmbTest.latencyMs,
                      model: lastEmbTest.model,
                    })}
                  </span>
                ) : null}
              </div>
            </SettingRow>
          </SettingsGroup>

          <SettingsGroup
            description={t("settings.aiGroupDesc")}
            title={t("settings.aiGroupTitle")}
          >
            <SettingRow
              badge={
                isLlmConfigured ? (
                  <Badge size="sm" variant="success">
                    {t("settings.aiStatusConfigured")}
                  </Badge>
                ) : (
                  <Badge size="sm" variant="secondary">
                    {t("settings.aiStatusDisabled")}
                  </Badge>
                )
              }
              description={t("settings.aiEnableDesc")}
              title={t("settings.aiEnableTitle")}
            >
              <FormField
                control={aiForm.control}
                name="enabled"
                render={({ field }) => (
                  <Switch
                    aria-label={t("settings.aiEnableTitle")}
                    checked={field.value}
                    disabled={!canReindex}
                    onCheckedChange={(checked) => field.onChange(Boolean(checked))}
                  />
                )}
              />
            </SettingRow>

            <SettingRow
              description={t("settings.aiProviderDesc")}
              title={t("settings.aiProviderTitle")}
            >
              <div className="w-52">
                <FormField
                  control={aiForm.control}
                  name="provider"
                  render={({ field }) => (
                    <Select
                      disabled={!canReindex}
                      onValueChange={(value) => {
                        if (
                          value === "openai" ||
                          value === "anthropic" ||
                          value === "deepseek" ||
                          value === "ollama" ||
                          value === "custom"
                        ) {
                          handleProviderChange(value);
                        }
                      }}
                      value={field.value}
                    >
                      <SelectTrigger aria-label={t("settings.aiProviderTitle")} size="sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectPopup>
                        <SelectItem value="openai">{t("settings.aiProviderOpenAI")}</SelectItem>
                        <SelectItem value="anthropic">
                          {t("settings.aiProviderAnthropic")}
                        </SelectItem>
                        <SelectItem value="deepseek">
                          {t("settings.aiProviderDeepSeek")}
                        </SelectItem>
                        <SelectItem value="ollama">{t("settings.aiProviderOllama")}</SelectItem>
                        <SelectItem value="custom">{t("settings.aiProviderCustom")}</SelectItem>
                      </SelectPopup>
                    </Select>
                  )}
                />
              </div>
            </SettingRow>

            <SettingRow
              description={
                aiProvider === "ollama"
                  ? t("settings.aiEndpointOllamaNote")
                  : t("settings.aiEndpointDesc")
              }
              layout="vertical"
              title={t("settings.aiEndpointTitle")}
            >
              <div className="grid gap-3 sm:grid-cols-3">
                <FormField
                  control={aiForm.control}
                  name="baseUrl"
                  render={({ field }) => (
                    <FormItem className="gap-1 sm:col-span-2">
                      <span className="text-[11px] font-medium text-muted-foreground">
                        {t("settings.aiBaseUrlLabel")}
                      </span>
                      <FormControl>
                        <Input
                          aria-label={t("settings.aiBaseUrlLabel")}
                          disabled={!canReindex}
                          placeholder={AI_PROVIDER_DEFAULTS.openai.baseUrl}
                          size="sm"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={aiForm.control}
                  name="model"
                  render={({ field }) => (
                    <FormItem className="gap-1">
                      <span className="text-[11px] font-medium text-muted-foreground">
                        {t("settings.aiModelLabel")}
                      </span>
                      <FormControl>
                        <Input
                          aria-label={t("settings.aiModelLabel")}
                          disabled={!canReindex}
                          placeholder={AI_PROVIDER_DEFAULTS.openai.model}
                          size="sm"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </SettingRow>

            <SettingRow
              description={t("settings.aiApiKeyDesc")}
              layout="vertical"
              title={t("settings.aiApiKeyTitle")}
            >
              <div className="grid gap-3 sm:grid-cols-3">
                <FormField
                  control={aiForm.control}
                  name="apiKeyDraft"
                  render={({ field }) => (
                    <FormItem className="gap-1 sm:col-span-2">
                      <div className="flex items-center gap-1.5">
                        <FormControl>
                          <Input
                            aria-label={t("settings.aiApiKeyTitle")}
                            autoComplete="new-password"
                            className="flex-1"
                            disabled={!canReindex}
                            placeholder={
                              aiSettingsQuery.data?.hasApiKey &&
                              aiSettingsQuery.data.apiKeyMasked &&
                              !aiClearKey
                                ? t("settings.aiApiKeyMaskedPlaceholder", {
                                    masked: aiSettingsQuery.data.apiKeyMasked,
                                  })
                                : t("settings.aiApiKeyEmptyPlaceholder")
                            }
                            size="sm"
                            startAddon={<KeyRoundIcon className="size-3.5 text-muted-foreground" />}
                            type="password"
                            value={field.value}
                            onBlur={field.onBlur}
                            onChange={(e) => {
                              aiForm.setValue("clearApiKey", false, { shouldDirty: true });
                              field.onChange(e);
                            }}
                          />
                        </FormControl>
                        {aiSettingsQuery.data?.hasApiKey && !aiClearKey && (
                          <Button
                            aria-label={t("settings.aiClearKeyAction")}
                            disabled={!canReindex}
                            onClick={() => {
                              aiForm.setValue("apiKeyDraft", "", { shouldDirty: true });
                              aiForm.setValue("clearApiKey", true, { shouldDirty: true });
                            }}
                            size="sm"
                            title={t("settings.aiClearKeyAction")}
                            type="button"
                            variant="outline"
                          >
                            <Trash2Icon className="size-3.5" />
                            <span>{t("settings.aiClearKeyAction")}</span>
                          </Button>
                        )}
                      </div>
                      {aiClearKey && (
                        <p className="text-[11px] text-warning-foreground">
                          {t("settings.aiKeyWillBeCleared")}
                        </p>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={aiForm.control}
                  name="temperature"
                  render={({ field }) => (
                    <FormItem className="gap-1">
                      <span className="text-[11px] font-medium text-muted-foreground">
                        {t("settings.aiTemperatureLabel")}
                      </span>
                      <FormControl>
                        <Input
                          aria-label={t("settings.aiTemperatureLabel")}
                          disabled={!canReindex}
                          max="2"
                          min="0"
                          size="sm"
                          step="0.1"
                          type="number"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                {!canReindex ? (
                  <p className="text-xs text-warning-foreground">
                    {t("settings.aiAdminOnlyHint", {
                      permission: permissionLabels[permission],
                    })}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {t("settings.aiSecurityProxyNote")}
                  </p>
                )}
                <Button
                  disabled={!canReindex}
                  loading={updateAiMutation.isPending}
                  size="sm"
                  type="submit"
                >
                  <span>
                    {updateAiMutation.isPending
                      ? t("settings.aiSavingAction")
                      : t("settings.aiSaveAction")}
                  </span>
                </Button>
              </div>
            </SettingRow>
          </SettingsGroup>
        </form>
      </Form>
    </div>
  );
}
