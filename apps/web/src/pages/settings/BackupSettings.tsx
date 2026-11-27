import {
  asSpaceId,
  IMPORT_CONFLICT_POLICIES,
  IMPORT_FORMATS,
  type AudioTranscribeResult,
  type AudioTranscribeTarget,
  type CreateIngestWebhookResponse,
  type ImportCommitResult,
  type ImportConflictPolicy,
  type ImportFormat,
  type ImportPreviewResult,
  type IngestWebhookId,
  type RssFeedId,
} from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import { inkadeQueryKeys } from "@inkade/sdk";
import { useInkadeClient, useInkadeSpaces } from "@inkade/sdk/react";
import {
  Badge,
  Button,
  Input,
  ScrollArea,
  SegmentedControl,
  SegmentedControlItem,
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@inkade/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  CopyIcon,
  DownloadIcon,
  FileAudioIcon,
  FolderInputIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  RssIcon,
  Trash2Icon,
  UploadCloudIcon,
  WebhookIcon,
  XIcon,
} from "lucide-react";
import type React from "react";
import { useRef, useState } from "react";
import { showErrorToast, showSuccessToast } from "../../lib/undo.ts";
import { SettingRow, SettingsGroup, SettingsSectionHeader } from "./SettingRow.tsx";

function parseCommaTags(raw: string): string[] {
  return raw
    .split(/[,\s]+/)
    .map((item) => item.trim().replace(/^#/, ""))
    .filter(Boolean);
}

export function BackupSettings(): React.ReactElement {
  const { t } = useInkadeTranslation();
  const client = useInkadeClient();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [exportingZip, setExportingZip] = useState(false);

  // Import Hub 3-step Wizard state
  const importFileRef = useRef<HTMLInputElement>(null);
  const [importStep, setImportStep] = useState<"select" | "preview" | "result">("select");
  const [importFormat, setImportFormat] = useState<ImportFormat>("obsidian");
  const [importSpaceId, setImportSpaceId] = useState<string>("");
  const [conflictPolicy, setConflictPolicy] = useState<ImportConflictPolicy>("rename");
  const [importTagsRaw, setImportTagsRaw] = useState("");
  const [selectedImportFile, setSelectedImportFile] = useState<File | null>(null);
  const [textPayload, setTextPayload] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [commitLoading, setCommitLoading] = useState(false);
  const [rollbackLoading, setRollbackLoading] = useState(false);
  const [rolledBack, setRolledBack] = useState(false);
  const [previewResult, setPreviewResult] = useState<ImportPreviewResult | null>(null);
  const [commitResult, setCommitResult] = useState<ImportCommitResult | null>(null);

  // Omnichannel Ingest Hub tabs state
  const [ingestTab, setIngestTab] = useState<"rss" | "webhooks" | "audio">("rss");
  const [rssUrl, setRssUrl] = useState("");
  const [rssTitle, setRssTitle] = useState("");
  const [rssSpaceId, setRssSpaceId] = useState<string>("");
  const [rssBusy, setRssBusy] = useState(false);
  const [syncingFeedId, setSyncingFeedId] = useState<RssFeedId | "all" | null>(null);

  const [webhookName, setWebhookName] = useState("");
  const [webhookTags, setWebhookTags] = useState("");
  const [webhookBusy, setWebhookBusy] = useState(false);
  const [justCreatedWebhook, setJustCreatedWebhook] = useState<CreateIngestWebhookResponse | null>(
    null,
  );

  const audioFileRef = useRef<HTMLInputElement>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioTarget, setAudioTarget] = useState<AudioTranscribeTarget>("clip");
  const [audioLanguage, setAudioLanguage] = useState("");
  const [audioTitle, setAudioTitle] = useState("");
  const [audioBusy, setAudioBusy] = useState(false);
  const [audioResult, setAudioResult] = useState<AudioTranscribeResult | null>(null);

  const spacesQuery = useInkadeSpaces();
  const activeSpaces = (spacesQuery.data ?? []).filter((s) => s.archivedAt === null);

  const rssFeedsQuery = useQuery({
    queryKey: inkadeQueryKeys.rssFeeds(),
    queryFn: () => client.rssFeeds.list(),
    staleTime: 20_000,
  });

  const webhooksQuery = useQuery({
    queryKey: inkadeQueryKeys.ingestWebhooks(),
    queryFn: () => client.webhooks.list(),
    staleTime: 20_000,
  });

  const handleExportZip = async (): Promise<void> => {
    setExportingZip(true);
    try {
      const bytes = await client.workspace.exportZip();
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      const blob = new Blob([copy], { type: "application/zip" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `inkade-workspace-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      showSuccessToast(t("settings.exportZipSuccess"));
    } catch (err) {
      showErrorToast(t("settings.exportZipFailed"), err);
    } finally {
      setExportingZip(false);
    }
  };

  const buildImportPayload = () => {
    const tags = parseCommaTags(importTagsRaw);
    const spaceOpt = importSpaceId ? asSpaceId(importSpaceId) : undefined;
    if (selectedImportFile) {
      return {
        format: importFormat,
        file: selectedImportFile,
        filename: selectedImportFile.name,
        targetSpaceId: spaceOpt,
        conflictPolicy,
        defaultTags: tags,
      };
    }
    return {
      format: importFormat,
      payloadText: textPayload,
      targetSpaceId: spaceOpt,
      conflictPolicy,
      defaultTags: tags,
    };
  };

  const handlePreviewImport = async (): Promise<void> => {
    if (!selectedImportFile && !textPayload.trim()) {
      showErrorToast(t("importHub.fileReadErrorToast"));
      return;
    }
    setPreviewLoading(true);
    try {
      const res = await client.importHub.preview(buildImportPayload());
      setPreviewResult(res);
      setImportStep("preview");
    } catch (err) {
      showErrorToast(t("importHub.previewFailedToast"), err);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleCommitImport = async (): Promise<void> => {
    setCommitLoading(true);
    setRolledBack(false);
    try {
      const res = await client.importHub.commit(buildImportPayload());
      setCommitResult(res);
      setImportStep("result");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "documents"] }),
        queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "spaces"] }),
        queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "audit-batches"] }),
        queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.workspaceSummary() }),
      ]);
    } catch (err) {
      showErrorToast(t("importHub.commitFailedToast"), err);
    } finally {
      setCommitLoading(false);
    }
  };

  const handleRollbackBatch = async (): Promise<void> => {
    if (!commitResult) return;
    setRollbackLoading(true);
    try {
      const rolled = await client.auditLogs.rollbackBatch(commitResult.batchId, { force: true });
      setRolledBack(true);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "documents"] }),
        queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "spaces"] }),
        queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "audit-batches"] }),
        queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.workspaceSummary() }),
      ]);
      showSuccessToast(t("importHub.rollbackSuccessToast", { count: rolled.rolledBackCount }));
    } catch (err) {
      showErrorToast(t("importHub.rollbackFailedToast"), err);
    } finally {
      setRollbackLoading(false);
    }
  };

  const formatLabels: Readonly<Record<ImportFormat, string>> = {
    obsidian: t("importHub.formatObsidian"),
    notion: t("importHub.formatNotion"),
    readwise: t("importHub.formatReadwise"),
    html: t("importHub.formatHtml"),
    docx: t("importHub.formatDocx"),
  };

  const formatHints: Readonly<Record<ImportFormat, string>> = {
    obsidian: t("importHub.formatObsidianHint"),
    notion: t("importHub.formatNotionHint"),
    readwise: t("importHub.formatReadwiseHint"),
    html: t("importHub.formatHtmlHint"),
    docx: t("importHub.formatDocxHint"),
  };

  const policyLabels: Readonly<Record<ImportConflictPolicy, string>> = {
    rename: t("importHub.policyRename"),
    skip: t("importHub.policySkip"),
    overwrite: t("importHub.policyOverwrite"),
  };

  const actionLabels: Readonly<Record<string, string>> = {
    create: t("importHub.actionCreate"),
    overwrite: t("importHub.actionOverwrite"),
    skip: t("importHub.actionSkip"),
    rename: t("importHub.actionRename"),
  };

  const kindLabels: Readonly<Record<string, string>> = {
    article: t("common.kindArticle"),
    outline: t("common.kindOutline"),
    clip: t("common.kindClip"),
  };

  const handleAddRss = async (): Promise<void> => {
    if (!rssUrl.trim()) return;
    setRssBusy(true);
    try {
      await client.rssFeeds.create({
        url: rssUrl.trim(),
        ...(rssTitle.trim() ? { title: rssTitle.trim() } : {}),
        ...(rssSpaceId ? { targetSpaceId: asSpaceId(rssSpaceId) } : {}),
      });
      setRssUrl("");
      setRssTitle("");
      await queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.rssFeeds() });
      showSuccessToast(t("ingestHub.rssAddedToast"));
    } catch (err) {
      showErrorToast(t("ingestHub.rssErrorToast"), err);
    } finally {
      setRssBusy(false);
    }
  };

  const handleSyncRss = async (feedId: RssFeedId | "all"): Promise<void> => {
    setSyncingFeedId(feedId);
    try {
      if (feedId === "all") {
        const list = await client.rssFeeds.syncAll();
        const created = list.reduce((sum, item) => sum + item.createdCount, 0);
        const skipped = list.reduce((sum, item) => sum + item.skippedCount, 0);
        showSuccessToast(t("ingestHub.rssSyncedToast", { created, skipped }));
      } else {
        const res = await client.rssFeeds.sync(feedId);
        showSuccessToast(
          t("ingestHub.rssSyncedToast", {
            created: res.createdCount,
            skipped: res.skippedCount,
          }),
        );
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.rssFeeds() }),
        queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "documents"] }),
      ]);
    } catch (err) {
      showErrorToast(t("ingestHub.rssErrorToast"), err);
    } finally {
      setSyncingFeedId(null);
    }
  };

  const handleDeleteRss = async (feedId: RssFeedId): Promise<void> => {
    try {
      await client.rssFeeds.delete(feedId);
      await queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.rssFeeds() });
      showSuccessToast(t("ingestHub.rssDeletedToast"));
    } catch (err) {
      showErrorToast(t("ingestHub.rssErrorToast"), err);
    }
  };

  const handleCreateWebhook = async (): Promise<void> => {
    if (!webhookName.trim()) return;
    setWebhookBusy(true);
    try {
      const res = await client.webhooks.create({
        name: webhookName.trim(),
        tags: parseCommaTags(webhookTags),
      });
      setJustCreatedWebhook(res);
      setWebhookName("");
      setWebhookTags("");
      await queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.ingestWebhooks() });
      showSuccessToast(t("ingestHub.webhookCreatedToast"));
    } catch (err) {
      showErrorToast(t("ingestHub.webhookErrorToast"), err);
    } finally {
      setWebhookBusy(false);
    }
  };

  const handleDeleteWebhook = async (id: IngestWebhookId): Promise<void> => {
    try {
      await client.webhooks.delete(id);
      await queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.ingestWebhooks() });
      showSuccessToast(t("ingestHub.webhookDeletedToast"));
    } catch (err) {
      showErrorToast(t("ingestHub.webhookErrorToast"), err);
    }
  };

  const handleTranscribeAudio = async (): Promise<void> => {
    if (!audioFile) return;
    setAudioBusy(true);
    try {
      const res = await client.ingestAudio.transcribe({
        file: audioFile,
        filename: audioFile.name,
        target: audioTarget,
        ...(audioLanguage.trim() ? { language: audioLanguage.trim() } : {}),
        ...(audioTitle.trim() ? { title: audioTitle.trim() } : {}),
      });
      setAudioResult(res);
      setAudioFile(null);
      await queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "documents"] });
      showSuccessToast(t("ingestHub.audioSuccessToast"));
    } catch (err) {
      showErrorToast(t("ingestHub.audioFailedToast"), err);
    } finally {
      setAudioBusy(false);
    }
  };

  const webhookFullUrl = justCreatedWebhook
    ? `${client.getConnectionConfig().baseUrl}${justCreatedWebhook.ingestPath}`
    : "";

  return (
    <div className="flex flex-col gap-6">
      <SettingsSectionHeader
        description={t("settings.backupDesc")}
        title={t("settings.backupTitle")}
      />

      <SettingsGroup>
        <SettingRow
          description={t("settings.exportZipRowDesc")}
          title={t("settings.exportZipRowTitle")}
        >
          <Button
            loading={exportingZip}
            onClick={() => void handleExportZip()}
            size="sm"
          >
            <DownloadIcon />
            {t("settings.exportZip")}
          </Button>
        </SettingRow>
      </SettingsGroup>

      {/* Import Hub 3-Step Wizard */}
      <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-col gap-0.5">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <FolderInputIcon className="size-4 text-primary" />
              <span>{t("importHub.sectionTitle")}</span>
            </h3>
            <p className="text-xs text-muted-foreground">{t("importHub.sectionDesc")}</p>
          </div>
          <div className="flex items-center gap-1.5 text-[11px]">
            <Badge
              className={importStep === "select" ? "border-primary/40 bg-primary/10 font-semibold text-foreground" : "text-muted-foreground"}
              variant="outline"
            >
              {t("importHub.stepSelect")}
            </Badge>
            <Badge
              className={importStep === "preview" ? "border-primary/40 bg-primary/10 font-semibold text-foreground" : "text-muted-foreground"}
              variant="outline"
            >
              {t("importHub.stepPreview")}
            </Badge>
            <Badge
              className={importStep === "result" ? "border-primary/40 bg-primary/10 font-semibold text-foreground" : "text-muted-foreground"}
              variant="outline"
            >
              {t("importHub.stepResult")}
            </Badge>
          </div>
        </div>

        {importStep === "select" && (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-foreground">
                  {t("importHub.formatLabel")}
                </label>
                <Select<ImportFormat>
                  onValueChange={(val) => val && setImportFormat(val)}
                  value={importFormat}
                >
                  <SelectTrigger size="sm">
                    <SelectValue>{formatLabels[importFormat]}</SelectValue>
                  </SelectTrigger>
                  <SelectPopup>
                    {IMPORT_FORMATS.map((fmt) => (
                      <SelectItem key={fmt} value={fmt}>
                        {formatLabels[fmt]}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
                <p className="text-[11px] text-muted-foreground">{formatHints[importFormat]}</p>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-foreground">
                  {t("importHub.conflictPolicyLabel")}
                </label>
                <Select<ImportConflictPolicy>
                  onValueChange={(val) => val && setConflictPolicy(val)}
                  value={conflictPolicy}
                >
                  <SelectTrigger size="sm">
                    <SelectValue>{policyLabels[conflictPolicy]}</SelectValue>
                  </SelectTrigger>
                  <SelectPopup>
                    {IMPORT_CONFLICT_POLICIES.map((pol) => (
                      <SelectItem key={pol} value={pol}>
                        {policyLabels[pol]}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-foreground">
                  {t("importHub.targetSpaceLabel")}
                </label>
                <Select<string>
                  onValueChange={(val) => setImportSpaceId(val ?? "")}
                  value={importSpaceId}
                >
                  <SelectTrigger size="sm">
                    <SelectValue>
                      {activeSpaces.find((s) => s.id === importSpaceId)?.name ??
                        t("importHub.defaultSpaceAuto")}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup>
                    <SelectItem value="">{t("importHub.defaultSpaceAuto")}</SelectItem>
                    {activeSpaces.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-foreground">
                  {t("importHub.tagsLabel")}
                </label>
                <Input
                  onChange={(e) => setImportTagsRaw(e.target.value)}
                  placeholder={t("importHub.tagsPlaceholder")}
                  size="sm"
                  value={importTagsRaw}
                />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-xs font-medium text-foreground">
                {t("importHub.fileLabel")}
              </label>
              <input
                accept=".zip,.md,.markdown,.csv,.html,.htm,.docx"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;
                  setSelectedImportFile(file);
                  if (file && file.name.toLowerCase().endsWith(".docx")) {
                    setImportFormat("docx");
                  }
                }}
                ref={importFileRef}
                type="file"
              />
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 p-3">
                <Button
                  onClick={() => importFileRef.current?.click()}
                  size="xs"
                  type="button"
                  variant="outline"
                >
                  <UploadCloudIcon />
                  <span>{t("importHub.chooseFileBtn")}</span>
                </Button>
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {selectedImportFile
                    ? t("importHub.selectedFile", { name: selectedImportFile.name })
                    : t("importHub.fileDropHint")}
                </span>
                {selectedImportFile && (
                  <Button
                    aria-label={t("importHub.clearFileAria")}
                    onClick={() => {
                      setSelectedImportFile(null);
                      if (importFileRef.current) {
                        importFileRef.current.value = "";
                      }
                    }}
                    size="icon-xs"
                    type="button"
                    variant="ghost"
                  >
                    <XIcon className="size-3.5" />
                  </Button>
                )}
              </div>
            </div>

            {importFormat !== "docx" && (
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-foreground">
                  {t("importHub.textPayloadLabel")}
                </label>
                <Textarea
                  className="min-h-24 font-mono text-xs"
                  onChange={(e) => setTextPayload(e.target.value)}
                  placeholder={t("importHub.textPayloadPlaceholder")}
                  value={textPayload}
                />
              </div>
            )}

            <div className="flex justify-end">
              <Button
                disabled={
                  previewLoading ||
                  (!selectedImportFile && (importFormat === "docx" || !textPayload.trim()))
                }
                loading={previewLoading}
                onClick={() => void handlePreviewImport()}
                size="sm"
                type="button"
              >
                {previewLoading ? t("importHub.previewingBtn") : t("importHub.previewBtn")}
              </Button>
            </div>
          </div>
        )}

        {importStep === "preview" && previewResult && (
          <div className="flex flex-col gap-4">
            <p className="text-xs font-medium text-foreground">
              {t("importHub.previewSummary", {
                docs: previewResult.items.length,
                spaces: previewResult.spacesToCreate,
              })}
            </p>

            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">
                {t("importHub.statDocs")}: {previewResult.items.length}
              </Badge>
              <Badge variant="outline">
                {t("importHub.statNewSpaces")}: {previewResult.spacesToCreate}
              </Badge>
              <Badge variant="outline">
                {t("importHub.statAttachments")}: {previewResult.attachmentsToImport}
              </Badge>
              <Badge variant="outline">
                {t("importHub.statWikilinks")}: {previewResult.wikilinksToRebind}
              </Badge>
              <Badge variant="outline">
                {t("importHub.statSchemaFields")}: {previewResult.schemaFieldsToAdd}
              </Badge>
              <Badge variant="outline">
                {t("importHub.statDuplicates")}: {previewResult.documentsSkipped}
              </Badge>
            </div>

            {previewResult.warnings.length > 0 && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
                <div className="mb-1 flex items-center gap-1.5 font-semibold">
                  <AlertTriangleIcon className="size-3.5" />
                  <span>
                    {t("importHub.warningsHeading", { count: previewResult.warnings.length })}
                  </span>
                </div>
                <ul className="list-disc space-y-0.5 pl-4">
                  {previewResult.warnings.slice(0, 6).map((w, idx) => (
                    <li key={idx}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-foreground">
                {t("importHub.previewTableTitle")}
              </span>
              <ScrollArea className="max-h-56 rounded-lg border border-border">
                <table className="w-full table-fixed text-left text-xs">
                  <thead className="border-b bg-muted/50 text-muted-foreground">
                    <tr>
                      <th className="w-[38%] px-3 py-1.5 font-medium">{t("importHub.colTitle")}</th>
                      <th className="w-[14%] px-3 py-1.5 font-medium">{t("importHub.colAction")}</th>
                      <th className="w-[24%] px-3 py-1.5 font-medium">{t("importHub.colTargetSpace")}</th>
                      <th className="w-[14%] px-3 py-1.5 font-medium">{t("importHub.colKind")}</th>
                      <th className="w-[10%] px-3 py-1.5 text-right font-medium">{t("importHub.colLinks")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {previewResult.items.slice(0, 80).map((item, idx) => (
                      <tr key={idx}>
                        <td className="truncate px-3 py-1.5 font-medium text-foreground">{item.title}</td>
                        <td className="px-3 py-1.5">
                          <Badge size="sm" variant="outline">
                            {actionLabels[item.action] ?? item.action}
                          </Badge>
                        </td>
                        <td className="truncate px-3 py-1.5 font-mono text-[11px] text-muted-foreground">
                          {item.targetSpaceName || "/"}
                        </td>
                        <td className="px-3 py-1.5 text-muted-foreground">
                          {kindLabels[item.kind] ?? item.kind}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono tabular-nums text-muted-foreground">
                          {item.wikilinksCount}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollArea>
            </div>

            <div className="flex items-center justify-between gap-2">
              <Button
                onClick={() => setImportStep("select")}
                size="sm"
                type="button"
                variant="outline"
              >
                {t("importHub.backBtn")}
              </Button>
              <Button
                disabled={commitLoading}
                loading={commitLoading}
                onClick={() => void handleCommitImport()}
                size="sm"
                type="button"
              >
                {commitLoading ? t("importHub.committingBtn") : t("importHub.commitBtn")}
              </Button>
            </div>
          </div>
        )}

        {importStep === "result" && commitResult && (
          <div className="flex flex-col gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/8 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
              <CheckCircle2Icon className="size-4" />
              <span>{t("importHub.commitSuccessTitle")}</span>
            </div>
            <p className="text-xs text-foreground">
              {t("importHub.commitResultSummary", {
                created: commitResult.createdDocumentIds.length,
                updated: commitResult.updatedDocumentIds.length,
                skipped: commitResult.skippedCount,
                attachments: commitResult.attachmentIds.length,
                wikilinks: commitResult.wikilinksReboundCount,
              })}
            </p>
            <p className="font-mono text-[11px] text-muted-foreground">
              {t("importHub.batchIdLabel", { batchId: commitResult.batchId })}
            </p>
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <Button
                disabled={rollbackLoading || rolledBack}
                loading={rollbackLoading}
                onClick={() => void handleRollbackBatch()}
                size="sm"
                type="button"
                variant="outline"
              >
                <RotateCcwIcon />
                <span>
                  {rollbackLoading
                    ? t("importHub.rollingBackBtn")
                    : t("importHub.rollbackBatchBtn")}
                </span>
              </Button>

              <Button
                onClick={() => {
                  setImportStep("select");
                  setPreviewResult(null);
                  setCommitResult(null);
                  setSelectedImportFile(null);
                  setTextPayload("");
                  setRolledBack(false);
                }}
                size="sm"
                type="button"
                variant="ghost"
              >
                {t("importHub.resetBtn")}
              </Button>
            </div>
          </div>
        )}
      </section>

      {/* Omnichannel Ingest Hub: RSS Feeds / Private Webhooks / Voice Memo Whisper */}
      <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-col gap-0.5">
            <h3 className="text-sm font-semibold text-foreground">
              {t("ingestHub.sectionTitle")}
            </h3>
            <p className="text-xs text-muted-foreground">{t("ingestHub.sectionDesc")}</p>
          </div>
          <SegmentedControl size="sm">
            <SegmentedControlItem
              data-pressed={ingestTab === "rss" ? "" : undefined}
              onClick={() => setIngestTab("rss")}
            >
              {t("ingestHub.tabRss")}
            </SegmentedControlItem>
            <SegmentedControlItem
              data-pressed={ingestTab === "webhooks" ? "" : undefined}
              onClick={() => setIngestTab("webhooks")}
            >
              {t("ingestHub.tabWebhooks")}
            </SegmentedControlItem>
            <SegmentedControlItem
              data-pressed={ingestTab === "audio" ? "" : undefined}
              onClick={() => setIngestTab("audio")}
            >
              {t("ingestHub.tabAudio")}
            </SegmentedControlItem>
          </SegmentedControl>
        </div>

        {ingestTab === "rss" && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">{t("ingestHub.rssDesc")}</p>
              <Button
                disabled={syncingFeedId === "all"}
                loading={syncingFeedId === "all"}
                onClick={() => void handleSyncRss("all")}
                size="xs"
                type="button"
                variant="outline"
              >
                <RefreshCwIcon />
                <span>{t("ingestHub.rssSyncAllBtn")}</span>
              </Button>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1.5fr_1fr_1fr_auto]">
              <Input
                onChange={(e) => setRssUrl(e.target.value)}
                placeholder={t("ingestHub.rssUrlPlaceholder")}
                size="sm"
                type="url"
                value={rssUrl}
              />
              <Input
                onChange={(e) => setRssTitle(e.target.value)}
                placeholder={t("ingestHub.rssTitlePlaceholder")}
                size="sm"
                value={rssTitle}
              />
              <Select<string>
                onValueChange={(val) => setRssSpaceId(val ?? "")}
                value={rssSpaceId}
              >
                <SelectTrigger aria-label={t("importHub.targetSpaceLabel")} size="sm">
                  <SelectValue>
                    {activeSpaces.find((s) => s.id === rssSpaceId)?.name ??
                      t("importHub.defaultSpaceAuto")}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value="">{t("importHub.defaultSpaceAuto")}</SelectItem>
                  {activeSpaces.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
              <Button
                disabled={rssBusy || !rssUrl.trim()}
                loading={rssBusy}
                onClick={() => void handleAddRss()}
                size="sm"
                type="button"
                variant={rssUrl.trim() ? "default" : "outline"}
              >
                <RssIcon />
                <span>{rssBusy ? t("ingestHub.rssAddingBtn") : t("ingestHub.rssAddBtn")}</span>
              </Button>
            </div>

            {(rssFeedsQuery.data ?? []).length === 0 ? (
              <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                {t("ingestHub.rssEmpty")}
              </p>
            ) : (
              <div className="divide-y divide-border/70 rounded-lg border border-border">
                {(rssFeedsQuery.data ?? []).map((feed) => (
                  <div
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-xs"
                    key={feed.id}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-foreground">{feed.title}</p>
                      <p className="truncate font-mono text-[11px] text-muted-foreground">
                        {feed.url}
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {feed.lastFetchedAt
                          ? t("ingestHub.rssLastSynced", {
                              time: feed.lastFetchedAt.slice(0, 16).replace("T", " "),
                            })
                          : t("ingestHub.rssNeverSynced")}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Button
                        disabled={syncingFeedId === feed.id}
                        loading={syncingFeedId === feed.id}
                        onClick={() => void handleSyncRss(feed.id)}
                        size="xs"
                        type="button"
                        variant="outline"
                      >
                        <RefreshCwIcon />
                        <span>
                          {syncingFeedId === feed.id
                            ? t("ingestHub.rssSyncingBtn")
                            : t("ingestHub.rssSyncNowBtn")}
                        </span>
                      </Button>
                      <Button
                        aria-label={t("ingestHub.rssDeleteBtn")}
                        onClick={() => void handleDeleteRss(feed.id)}
                        size="icon-xs"
                        type="button"
                        variant="ghost"
                      >
                        <Trash2Icon className="text-destructive" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {ingestTab === "webhooks" && (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-muted-foreground">{t("ingestHub.webhookDesc")}</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <Input
                onChange={(e) => setWebhookName(e.target.value)}
                placeholder={t("ingestHub.webhookNamePlaceholder")}
                size="sm"
                value={webhookName}
              />
              <Input
                onChange={(e) => setWebhookTags(e.target.value)}
                placeholder={t("ingestHub.webhookTagsPlaceholder")}
                size="sm"
                value={webhookTags}
              />
              <Button
                disabled={webhookBusy || !webhookName.trim()}
                loading={webhookBusy}
                onClick={() => void handleCreateWebhook()}
                size="sm"
                type="button"
              >
                <WebhookIcon />
                <span>
                  {webhookBusy
                    ? t("ingestHub.webhookCreatingBtn")
                    : t("ingestHub.webhookCreateBtn")}
                </span>
              </Button>
            </div>

            {justCreatedWebhook && (
              <div className="flex flex-col gap-2 rounded-lg border border-amber-500/35 bg-amber-500/10 p-3 text-xs">
                <p className="font-medium text-amber-800 dark:text-amber-300">
                  {t("ingestHub.webhookTokenWarning")}
                </p>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded bg-background/85 px-2 py-1 font-mono text-[11px] text-foreground">
                    {webhookFullUrl}
                  </code>
                  <Button
                    onClick={() => {
                      void navigator.clipboard?.writeText?.(webhookFullUrl);
                      showSuccessToast(t("ingestHub.webhookCopiedToast"));
                    }}
                    size="xs"
                    type="button"
                    variant="outline"
                  >
                    <CopyIcon />
                    <span>{t("ingestHub.webhookCopyUrlBtn")}</span>
                  </Button>
                </div>
              </div>
            )}

            {(webhooksQuery.data ?? []).length === 0 ? (
              <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                {t("ingestHub.webhookEmpty")}
              </p>
            ) : (
              <div className="divide-y divide-border/70 rounded-lg border border-border">
                {(webhooksQuery.data ?? []).map((wh) => (
                  <div
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-xs"
                    key={wh.id}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-foreground">{wh.name}</span>
                        <Badge size="sm" variant="outline">
                          {t("ingestHub.webhookEndpointLabel", { prefix: wh.tokenPrefix })}
                        </Badge>
                      </div>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {wh.lastUsedAt
                          ? t("ingestHub.webhookLastUsed", {
                              time: wh.lastUsedAt.slice(0, 16).replace("T", " "),
                            })
                          : t("ingestHub.webhookNeverUsed")}
                      </p>
                    </div>
                    <Button
                      aria-label={t("ingestHub.webhookDeleteBtn")}
                      onClick={() => void handleDeleteWebhook(wh.id)}
                      size="icon-xs"
                      type="button"
                      variant="ghost"
                    >
                      <Trash2Icon className="text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {ingestTab === "audio" && (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-muted-foreground">{t("ingestHub.audioDesc")}</p>

            <input
              accept="audio/*,.mp3,.wav,.m4a,.webm,.ogg"
              className="hidden"
              onChange={(e) => setAudioFile(e.target.files?.[0] ?? null)}
              ref={audioFileRef}
              type="file"
            />
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 p-3">
              <Button
                onClick={() => audioFileRef.current?.click()}
                size="xs"
                type="button"
                variant="outline"
              >
                <FileAudioIcon />
                <span>{t("ingestHub.audioFileLabel")}</span>
              </Button>
              <span className="text-xs text-muted-foreground">
                {audioFile ? audioFile.name : t("ingestHub.audioSelectHint")}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-foreground">
                  {t("ingestHub.audioTargetLabel")}
                </label>
                <Select<AudioTranscribeTarget>
                  onValueChange={(val) => val && setAudioTarget(val)}
                  value={audioTarget}
                >
                  <SelectTrigger size="sm">
                    <SelectValue>
                      {audioTarget === "daily"
                        ? t("ingestHub.audioTargetDaily")
                        : audioTarget === "document"
                          ? t("ingestHub.audioTargetDocument")
                          : t("ingestHub.audioTargetClip")}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup>
                    <SelectItem value="clip">{t("ingestHub.audioTargetClip")}</SelectItem>
                    <SelectItem value="daily">{t("ingestHub.audioTargetDaily")}</SelectItem>
                  </SelectPopup>
                </Select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-foreground">
                  {t("ingestHub.audioLanguageLabel")}
                </label>
                <Input
                  onChange={(e) => setAudioLanguage(e.target.value)}
                  placeholder={t("ingestHub.audioLanguagePlaceholder")}
                  size="sm"
                  value={audioLanguage}
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-foreground">
                  {t("ingestHub.audioTitleLabel")}
                </label>
                <Input
                  onChange={(e) => setAudioTitle(e.target.value)}
                  placeholder={t("ingestHub.audioTitlePlaceholder")}
                  size="sm"
                  value={audioTitle}
                />
              </div>
            </div>

            <div className="flex justify-end">
              <Button
                disabled={audioBusy || !audioFile}
                loading={audioBusy}
                onClick={() => void handleTranscribeAudio()}
                size="sm"
                type="button"
              >
                <FileAudioIcon />
                <span>
                  {audioBusy ? t("ingestHub.audioUploadingBtn") : t("ingestHub.audioUploadBtn")}
                </span>
              </Button>
            </div>

            {audioResult && (
              <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-foreground">
                    {t("ingestHub.audioResultPreview")}
                  </span>
                  {audioResult.document && (
                    <Button
                      onClick={() =>
                        void navigate({
                          to: "/docs/$docId",
                          params: { docId: audioResult.document!.id },
                        })
                      }
                      size="xs"
                      type="button"
                      variant="outline"
                    >
                      {t("dialogs.openIngestedDoc")}
                    </Button>
                  )}
                </div>
                <p className="whitespace-pre-wrap text-muted-foreground">{audioResult.text}</p>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
