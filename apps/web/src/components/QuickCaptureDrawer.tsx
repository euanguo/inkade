import { zodResolver } from "@hookform/resolvers/zod";
import { asSpaceId, type DocumentRecord, extractInlineTags, type Space, type SpaceId } from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import { inkadeQueryKeys } from "@inkade/sdk";
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
  Drawer,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerPanel,
  DrawerPopup,
  DrawerTitle,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  INKADE_MEDIA_QUERIES,
  Input,
  Kbd,
  SegmentedControl,
  SegmentedControlItem,
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
  SpaceIcon,
  Spinner,
  Switch,
  Textarea,
} from "@inkade/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowRightIcon,
  CheckCircle2Icon,
  GlobeIcon,
  HashIcon,
  ImagePlusIcon,
  Link2Icon,
  MicIcon,
  SendIcon,
  SparklesIcon,
  ZapIcon,
} from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useMediaQuery } from "usehooks-ts";
import { z } from "zod";
import { getTodayDailyDate } from "@inkade/views/lib/dates";
import { isImeEvent } from "@inkade/views/lib/shortcuts";
import { extractDetectedUrl } from "@inkade/views/lib/super-command-parser";
import { getInkadeClient } from "../lib/api.ts";
import { showErrorToast, showSuccessToast } from "../lib/undo.ts";

export interface QuickCapturePrefill {
  readonly target?: "daily" | "inbox" | undefined;
  readonly title?: string | undefined;
  readonly text?: string | undefined;
  readonly sourceUrl?: string | undefined;
}

export interface QuickCaptureDrawerProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly spaces: readonly Space[];
  readonly prefill?: QuickCapturePrefill | null | undefined;
}

function parseTagsInput(raw: string): string[] {
  return raw
    .split(/[,\s]+/)
    .map((tagItem) => tagItem.trim().replace(/^#/, ""))
    .filter(Boolean);
}

interface QuickCaptureFormValues {
  target: "daily" | "inbox";
  text: string;
  sourceUrl: string;
  tagsText: string;
  captureAsTodo: boolean;
  markForAde: boolean;
}

export function QuickCaptureDrawer({
  open,
  onOpenChange,
  spaces,
  prefill = null,
}: QuickCaptureDrawerProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isMobile = useMediaQuery(INKADE_MEDIA_QUERIES.maxSm);
  const [showUrlField, setShowUrlField] = useState(false);
  const [showTagsField, setShowTagsField] = useState(false);
  const [ingestSpaceId, setIngestSpaceId] = useState<SpaceId | "">("");
  const [uploadingImage, setUploadingImage] = useState(false);
  const [transcribingAudio, setTranscribingAudio] = useState(false);
  const [isDraggingImage, setIsDraggingImage] = useState(false);
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const [ingestedResult, setIngestedResult] = useState<{
    readonly document: DocumentRecord;
    readonly mirroredImages: number;
  } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const schema = useMemo(
    () =>
      z.object({
        target: z.enum(["daily", "inbox"]),
        text: z.string().trim().min(1, t("validation.required")),
        sourceUrl: z
          .string()
          .refine((val) => !val.trim() || z.url().safeParse(val.trim()).success, {
            message: t("validation.urlInvalid"),
          }),
        tagsText: z.string(),
        captureAsTodo: z.boolean(),
        markForAde: z.boolean(),
      }),
    [t],
  );

  const form = useForm<QuickCaptureFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      target: "daily",
      text: "",
      sourceUrl: "",
      tagsText: "",
      captureAsTodo: false,
      markForAde: false,
    },
  });
  const { reset: resetCaptureForm, getValues: getCaptureValues, setValue: setCaptureValue } = form;
  const watchedTarget = useWatch({ control: form.control, name: "target" });
  const watchedText = useWatch({ control: form.control, name: "text" });
  const watchedSourceUrl = useWatch({ control: form.control, name: "sourceUrl" });
  const watchedTagsText = useWatch({ control: form.control, name: "tagsText" });
  const watchedCaptureAsTodo = useWatch({ control: form.control, name: "captureAsTodo" });
  const watchedMarkForAde = useWatch({ control: form.control, name: "markForAde" });

  const activeSpaces = useMemo(
    () => spaces.filter((s) => s.archivedAt === null),
    [spaces],
  );

  const defaultInboxSpaceId = useMemo(
    () =>
      activeSpaces.find((s) => s.slug === "inbox")?.id ??
      activeSpaces[0]?.id ??
      asSpaceId("spc_inbox"),
    [activeSpaces],
  );

  useEffect(() => {
    if (!open) return;
    const prefillParts = [prefill?.title?.trim(), prefill?.text?.trim()].filter(Boolean);
    const nextTarget = prefill?.target ?? (prefill?.sourceUrl ? "inbox" : "daily");
    const nextUrl = prefill?.sourceUrl?.trim() ?? "";
    resetCaptureForm({
      target: nextTarget,
      text: prefillParts.join("\n\n"),
      sourceUrl: nextUrl,
      tagsText: "",
      captureAsTodo: false,
      markForAde: false,
    });
    setShowUrlField(Boolean(nextUrl));
    setShowTagsField(false);
    setIngestSpaceId(defaultInboxSpaceId);
    setUploadingImage(false);
    setIsDraggingImage(false);
    setIngestedResult(null);
  }, [open, prefill, defaultInboxSpaceId, resetCaptureForm]);

  const detectedUrl = useMemo(
    () => extractDetectedUrl(watchedSourceUrl, watchedText),
    [watchedSourceUrl, watchedText],
  );

  const detectedDomain = useMemo(() => {
    if (!detectedUrl) return null;
    try {
      return new URL(detectedUrl).hostname.replace(/^www\./i, "");
    } catch {
      return null;
    }
  }, [detectedUrl]);

  const insertMarkdownAtCursor = useCallback(
    (snippet: string) => {
      const textarea = textareaRef.current;
      const prev = getCaptureValues("text");
      if (!textarea) {
        setCaptureValue("text", prev ? `${prev}\n${snippet}` : snippet, {
          shouldDirty: true,
          shouldValidate: true,
        });
        return;
      }
      const start = textarea.selectionStart ?? textarea.value.length;
      const end = textarea.selectionEnd ?? textarea.value.length;
      const before = prev.slice(0, start);
      const after = prev.slice(end);
      const needsLeadingNewline = before.length > 0 && !before.endsWith("\n");
      const prefix = needsLeadingNewline ? "\n" : "";
      setCaptureValue("text", `${before}${prefix}${snippet}${after}`, {
        shouldDirty: true,
        shouldValidate: true,
      });
    },
    [getCaptureValues, setCaptureValue],
  );

  const uploadImageFiles = useCallback(
    async (files: readonly File[]) => {
      const imageFiles = files.filter((f) => f.type.startsWith("image/"));
      if (imageFiles.length === 0) return;

      setUploadingImage(true);
      try {
        const client = getInkadeClient();
        const markdownLinks: string[] = [];
        for (const file of imageFiles) {
          const bytes = new Uint8Array(await file.arrayBuffer());
          const filename = file.name || `capture-${Date.now().toString(36)}.png`;
          const uploaded = await client.attachments.upload({
            filename,
            mimeType: file.type || "image/png",
            data: bytes,
          });
          markdownLinks.push(`![${uploaded.attachment.filename}](${uploaded.downloadUrl})`);
        }
        if (markdownLinks.length > 0) {
          insertMarkdownAtCursor(markdownLinks.join("\n"));
          showSuccessToast(t("dialogs.imageUploaded"));
        }
      } catch (err) {
        showErrorToast(t("dialogs.imageUploadFailed"), err);
      } finally {
        setUploadingImage(false);
      }
    },
    [insertMarkdownAtCursor, t],
  );

  const ingestUrlMutation = useMutation({
    mutationFn: async (urlToIngest: string) => {
      const { text, tagsText } = getCaptureValues();
      const tags = [...new Set([...extractInlineTags(text), ...parseTagsInput(tagsText)])];
      return getInkadeClient().clips.ingestUrl({
        url: urlToIngest,
        spaceId: ingestSpaceId || defaultInboxSpaceId,
        tags,
        mirrorImages: true,
        saveHtmlSnapshot: true,
      });
    },
    onSuccess: (res) => {
      setIngestedResult(res);
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "documents"] });
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.workspaceSummary() });
      showSuccessToast(t("dialogs.ingestSuccessTitle"), res.document.title);
    },
    onError: (err) => {
      showErrorToast(t("dialogs.ingestFailed"), err);
    },
  });

  const mutation = useMutation({
    mutationFn: async (values: QuickCaptureFormValues) => {
      const client = getInkadeClient();
      const trimmed = values.text.trim();
      if (!trimmed) throw new Error(t("dialogs.quickCaptureEmptyError"));

      const inlineTags = extractInlineTags(trimmed);
      const inlineSet = new Set(inlineTags.map((item) => item.toLowerCase()));
      const manualTags = parseTagsInput(values.tagsText);
      const extraTagsForDaily = manualTags.filter(
        (tagItem) => !inlineSet.has(tagItem.toLowerCase()),
      );
      const mergedTags = [...new Set([...inlineTags, ...manualTags])];

      if (values.target === "daily") {
        const today = getTodayDailyDate();
        const daily = await client.documents.getDaily(today);
        const tagSuffix =
          extraTagsForDaily.length > 0
            ? ` ${extraTagsForDaily.map((tagItem) => `#${tagItem}`).join(" ")}`
            : "";
        const urlSuffix = values.sourceUrl.trim() ? ` (${values.sourceUrl.trim()})` : "";
        const isTodo = values.captureAsTodo || values.markForAde;
        const node = await client.outlineNodes.create({
          documentId: daily.document.id,
          parentNodeId: null,
          contentMarkdown: `${trimmed}${urlSuffix}${tagSuffix}`,
          checked: isTodo ? false : null,
        });
        if (values.markForAde) {
          await client.threadBindings.upsert({
            documentId: daily.document.id,
            nodeId: node.id,
            adeKind: "any",
            externalThreadId: `thr_pending_${Date.now().toString(36)}`,
            title: trimmed.slice(0, 80),
            status: "queued",
            lastSummary: trimmed,
            unreadResult: false,
          });
        }
        return { mode: "daily" as const, today, isTodo };
      }

      const inboxSpaceId =
        activeSpaces.find((s) => s.slug === "inbox")?.id ??
        activeSpaces[0]?.id ??
        asSpaceId("spc_inbox");
      const firstLine = trimmed.split("\n")[0]?.trim() || t("dialogs.defaultCaptureTitle");
      const title = firstLine.length > 72 ? `${firstLine.slice(0, 71)}…` : firstLine;
      const doc = await client.documents.create({
        spaceId: inboxSpaceId,
        kind: "clip",
        title,
        contentMarkdown: trimmed,
        tags: mergedTags,
        ...(values.sourceUrl.trim() ? { sourceUrl: values.sourceUrl.trim() } : {}),
      });
      if (values.markForAde) {
        await client.threadBindings.upsert({
          documentId: doc.id,
          nodeId: null,
          adeKind: "any",
          externalThreadId: `thr_pending_${Date.now().toString(36)}`,
          title,
          status: "queued",
          lastSummary: trimmed.slice(0, 240),
          unreadResult: false,
        });
      }
      return { mode: "inbox" as const, isTodo: false };
    },
    onSuccess: (res, values) => {
      if (res.mode === "daily") {
        void queryClient.invalidateQueries({
          queryKey: inkadeQueryKeys.dailyOutline(res.today),
        });
        if (res.isTodo) {
          void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "tasks"] });
        }
        showSuccessToast(
          t("dialogs.appendedToDaily"),
          values.markForAde ? t("dialogs.queuedForAdeHint") : undefined,
        );
      } else {
        void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "documents"] });
        void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.workspaceSummary() });
        showSuccessToast(
          t("dialogs.savedToInbox"),
          values.markForAde ? t("dialogs.queuedForAdeHint") : undefined,
        );
      }
      if (values.markForAde) {
        void queryClient.invalidateQueries({
          queryKey: [...inkadeQueryKeys.all, "thread-bindings"],
        });
      }
      onOpenChange(false);
    },
    onError: (err) => {
      showErrorToast(t("dialogs.quickCaptureFailed"), err);
    },
  });

  const handleCaptureSubmit = form.handleSubmit((values) => {
    if (mutation.isPending || uploadingImage) return;
    mutation.mutate(values);
  });

  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>): void => {
    const items = event.clipboardData?.items;
    const files: File[] = [];
    if (items) {
      for (const item of items) {
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const f = item.getAsFile();
          if (f) files.push(f);
        }
      }
    }
    if (files.length === 0 && event.clipboardData?.files?.length) {
      for (const f of event.clipboardData.files) {
        if (f.type.startsWith("image/")) files.push(f);
      }
    }
    if (files.length > 0) {
      event.preventDefault();
      void uploadImageFiles(files);
    }
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setIsDraggingImage(false);
    const files = [...(event.dataTransfer?.files ?? [])].filter((f) =>
      f.type.startsWith("image/"),
    );
    if (files.length > 0) {
      void uploadImageFiles(files);
    }
  };

  const handleFormKeyDown = (event: React.KeyboardEvent<HTMLFormElement>): void => {
    if (isImeEvent(event.nativeEvent)) return;
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void handleCaptureSubmit();
    }
  };

  const selectedIngestSpace = activeSpaces.find((s) => s.id === ingestSpaceId) ?? null;
  const urlFieldVisible =
    watchedTarget === "inbox" || showUrlField || Boolean(watchedSourceUrl.trim());
  const tagsFieldVisible = showTagsField || Boolean(watchedTagsText.trim());

  const captureFormFields = (
    <>
      <SegmentedControl className="w-full" size="sm">
        <SegmentedControlItem
          className="flex-1"
          data-pressed={watchedTarget === "daily" ? "" : undefined}
          onClick={() => setCaptureValue("target", "daily")}
        >
          {t("dialogs.appendToDaily")}
        </SegmentedControlItem>
        <SegmentedControlItem
          className="flex-1"
          data-pressed={watchedTarget === "inbox" ? "" : undefined}
          onClick={() => setCaptureValue("target", "inbox")}
        >
          {t("dialogs.saveToInbox")}
        </SegmentedControlItem>
      </SegmentedControl>

      <FormField
        control={form.control}
        name="text"
        render={({ field }) => (
          <FormItem className="w-full">
            <div className="flex w-full items-center justify-between gap-2">
              <FormLabel>{t("dialogs.thoughtLabel")}</FormLabel>
              {uploadingImage && (
                <span className="inline-flex items-center gap-1.5 text-xs text-primary">
                  <Spinner className="size-3" />
                  <span>{t("dialogs.uploadingImage")}</span>
                </span>
              )}
            </div>
            <div
              className={`w-full rounded-md transition-colors ${
                isDraggingImage ? "bg-primary/5 [&_[data-slot=textarea-control]]:border-primary" : ""
              }`}
              onDragLeave={() => setIsDraggingImage(false)}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDraggingImage(true);
              }}
              onDrop={handleDrop}
            >
              <FormControl>
                <Textarea
                  {...field}
                  autoFocus
                  className="min-h-30 w-full"
                  onPaste={handlePaste}
                  placeholder={t("dialogs.thoughtPlaceholder")}
                  ref={(node) => {
                    textareaRef.current = node;
                    field.ref(node);
                  }}
                />
              </FormControl>
            </div>
            <div className="flex w-full flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <span className="hidden items-center gap-1.5 sm:inline-flex">
                <ImagePlusIcon className="size-3 shrink-0" />
                <span>{t("dialogs.imageDropHint")}</span>
              </span>
              <div className="flex flex-wrap items-center gap-1">
                {watchedTarget === "daily" && (
                  <Button
                    onClick={() => setShowUrlField((prev) => !prev)}
                    size="xs"
                    type="button"
                    variant={urlFieldVisible ? "secondary" : "ghost"}
                  >
                    <Link2Icon className="size-3" />
                    <span>{t("dialogs.addLinkToggle")}</span>
                  </Button>
                )}
                <Button
                  onClick={() => setShowTagsField((prev) => !prev)}
                  size="xs"
                  type="button"
                  variant={tagsFieldVisible ? "secondary" : "ghost"}
                >
                  <HashIcon className="size-3" />
                  <span>{t("dialogs.addTagsToggle")}</span>
                </Button>
                <input
                  accept="audio/*,.mp3,.wav,.m4a,.webm,.ogg"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    setTranscribingAudio(true);
                    void getInkadeClient()
                      .ingestAudio.transcribe({
                        file,
                        filename: file.name,
                        target: watchedTarget === "daily" ? "daily" : "clip",
                        spaceId: defaultInboxSpaceId,
                      })
                      .then((res) => {
                        insertMarkdownAtCursor(res.text);
                        showSuccessToast(t("ingestHub.audioSuccessToast"));
                        void queryClient.invalidateQueries({
                          queryKey: [...inkadeQueryKeys.all, "documents"],
                        });
                      })
                      .catch((err) => showErrorToast(t("ingestHub.audioFailedToast"), err))
                      .finally(() => setTranscribingAudio(false));
                  }}
                  ref={audioInputRef}
                  type="file"
                />
                <Button
                  disabled={transcribingAudio}
                  loading={transcribingAudio}
                  onClick={() => audioInputRef.current?.click()}
                  size="xs"
                  type="button"
                  variant="ghost"
                >
                  <MicIcon className="size-3" />
                  <span>
                    {transcribingAudio
                      ? t("ingestHub.audioUploadingBtn")
                      : t("ingestHub.audioUploadBtn")}
                  </span>
                </Button>
              </div>
            </div>
            <FormMessage />
          </FormItem>
        )}
      />

      {(urlFieldVisible || tagsFieldVisible) && (
        <div
          className={`grid grid-cols-1 gap-3 ${
            urlFieldVisible && tagsFieldVisible ? "sm:grid-cols-2" : ""
          }`}
        >
          {urlFieldVisible && (
            <FormField
              control={form.control}
              name="sourceUrl"
              render={({ field }) => (
                <FormItem className="w-full">
                  <FormLabel>{t("dialogs.sourceUrlOptional")}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      className="w-full"
                      onChange={(e) => {
                        field.onChange(e);
                        setIngestedResult(null);
                      }}
                      placeholder="https://..."
                      type="url"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
          {tagsFieldVisible && (
            <FormField
              control={form.control}
              name="tagsText"
              render={({ field }) => (
                <FormItem className="w-full">
                  <FormLabel>{t("dialogs.tagsOptionalLabel")}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      className="w-full"
                      placeholder={t("dialogs.quickCaptureTagsPlaceholder")}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
        </div>
      )}

      {detectedUrl && (
        <div className="flex flex-col gap-2.5 rounded-lg border border-primary/25 bg-brand-subtle/35 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2 text-xs">
              <GlobeIcon className="size-3.5 shrink-0 text-teal-600 dark:text-teal-400" />
              <span className="font-medium text-foreground">
                {t("dialogs.detectedUrlLabel")}
              </span>
              {detectedDomain && (
                <Badge size="sm" variant="outline">
                  {detectedDomain}
                </Badge>
              )}
              <span className="max-w-64 truncate font-mono text-[11px] text-muted-foreground">
                {detectedUrl}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <Select<SpaceId>
                onValueChange={(val) =>
                  setIngestSpaceId(val ? asSpaceId(val) : defaultInboxSpaceId)
                }
                value={ingestSpaceId || defaultInboxSpaceId}
              >
                <SelectTrigger aria-label={t("dialogs.ingestTargetSpaceLabel")} size="sm">
                  <SelectValue>
                    {selectedIngestSpace ? (
                      <span className="inline-flex items-center gap-1.5">
                        <SpaceIcon
                          color={selectedIngestSpace.color}
                          icon={selectedIngestSpace.icon}
                          size="xs"
                        />
                        <span>{selectedIngestSpace.name}</span>
                      </span>
                    ) : (
                      t("dialogs.ingestTargetSpaceLabel")
                    )}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {activeSpaces.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      <span className="inline-flex items-center gap-1.5">
                        <SpaceIcon color={s.color} icon={s.icon} size="xs" />
                        <span>{s.name}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>

              <Button
                disabled={ingestUrlMutation.isPending}
                loading={ingestUrlMutation.isPending}
                onClick={() => ingestUrlMutation.mutate(detectedUrl)}
                size="sm"
                type="button"
              >
                <SparklesIcon />
                {ingestUrlMutation.isPending
                  ? t("dialogs.ingestingUrlBtn")
                  : t("dialogs.ingestUrlBtn")}
              </Button>
            </div>
          </div>

          {ingestedResult && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-primary/15 pt-2.5 text-xs">
              <div className="flex min-w-0 flex-1 items-start gap-2">
                <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-success" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-foreground">
                    {ingestedResult.document.title}
                  </p>
                  {ingestedResult.document.excerpt && (
                    <p className="mt-0.5 line-clamp-2 text-muted-foreground">
                      {ingestedResult.document.excerpt}
                    </p>
                  )}
                  <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                    {t("dialogs.ingestSuccessMeta", {
                      images: ingestedResult.mirroredImages,
                      space:
                        activeSpaces.find((s) => s.id === ingestedResult.document.spaceId)
                          ?.name ?? ingestedResult.document.spaceId,
                    })}
                  </p>
                </div>
              </div>
              <Button
                onClick={() => {
                  onOpenChange(false);
                  void navigate({
                    to: "/docs/$docId",
                    params: { docId: ingestedResult.document.id },
                  });
                }}
                size="xs"
                type="button"
                variant="outline"
              >
                {t("dialogs.openIngestedDoc")}
                <ArrowRightIcon />
              </Button>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col divide-y divide-border/60 rounded-lg border border-border/70 bg-muted/35">
        {watchedTarget === "daily" && (
          <label className="flex w-full cursor-pointer items-center gap-2.5 px-3.5 py-2.5 text-xs font-medium text-foreground">
            <Checkbox
              checked={watchedCaptureAsTodo || watchedMarkForAde}
              onCheckedChange={(checked) => setCaptureValue("captureAsTodo", Boolean(checked))}
            />
            <span>{t("dialogs.captureAsTodoLabel")}</span>
          </label>
        )}
        <label className="flex w-full cursor-pointer items-center justify-between gap-3 px-3.5 py-2.5">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-xs font-medium text-foreground">
              {t("dialogs.markForAdeTitle")}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {t("dialogs.markForAdeDesc")}
            </span>
          </div>
          <Switch
            checked={watchedMarkForAde}
            onCheckedChange={(checked) => setCaptureValue("markForAde", checked)}
          />
        </label>
      </div>
    </>
  );

  const footerActions = (
    <>
      <Button onClick={() => onOpenChange(false)} type="button" variant="outline">
        {t("common.cancel")}
      </Button>
      <Button disabled={uploadingImage} loading={mutation.isPending} type="submit">
        <SendIcon />
        <span>
          {watchedTarget === "daily" ? t("dialogs.writeToDaily") : t("dialogs.saveToInboxBtn")}
        </span>
        <Kbd className="hidden sm:inline-flex">⌘⏎</Kbd>
      </Button>
    </>
  );

  if (isMobile) {
    return (
      <Drawer onOpenChange={onOpenChange} open={open} position="bottom">
        <DrawerPopup showBar showCloseButton>
          <DrawerHeader>
            <DrawerTitle className="flex items-center gap-2">
              <ZapIcon className="size-4 text-info-foreground" />
              {t("dialogs.quickCaptureTitle")}
            </DrawerTitle>
            <DrawerDescription>{t("dialogs.quickCaptureDesc")}</DrawerDescription>
          </DrawerHeader>

          <form
            className="flex min-h-0 flex-1 flex-col overflow-hidden"
            noValidate
            onKeyDown={handleFormKeyDown}
            onSubmit={(e) => void handleCaptureSubmit(e)}
          >
            <Form {...form}>
              <DrawerPanel className="flex flex-col gap-4">{captureFormFields}</DrawerPanel>
              <DrawerFooter>{footerActions}</DrawerFooter>
            </Form>
          </form>
        </DrawerPopup>
      </Drawer>
    );
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogPopup className="max-w-xl" data-slot="quick-capture-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ZapIcon className="size-4 text-info-foreground" />
            {t("dialogs.quickCaptureTitle")}
          </DialogTitle>
          <DialogDescription>{t("dialogs.quickCaptureDesc")}</DialogDescription>
        </DialogHeader>

        <form
          className="flex min-h-0 flex-1 flex-col"
          noValidate
          onKeyDown={handleFormKeyDown}
          onSubmit={(e) => void handleCaptureSubmit(e)}
        >
          <Form {...form}>
            <DialogPanel className="flex flex-col gap-4">{captureFormFields}</DialogPanel>
            <DialogFooter>{footerActions}</DialogFooter>
          </Form>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
