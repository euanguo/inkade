import { useInkadeTranslation } from "@inkade/i18n";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  cn,
  Field,
  FieldLabel,
  GridDisclosure,
  Input,
  Kbd,
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
  Textarea,
  ThinkingIndicator,
} from "@inkade/ui/primitives";
import { BookmarkCheck, BookOpen, ChevronDown, Crop, Eye, Sparkles, X } from "lucide-react";
import { isAiProviderReady } from "../../core/interpreter.ts";
import { TagChipsInput } from "../TagChipsInput.tsx";
import { SpaceSelectField } from "../shared/SpaceSelectField.tsx";
import { usePopupStore } from "../stores/popup-store.ts";
import { useClipperSettingsStore } from "../stores/settings-store.ts";

export interface PopupClipFormProps {
  readonly isConfigured: boolean;
  readonly draftRestored: boolean;
  readonly onMarkEdited: () => void;
  readonly onTriggerTabUi: (
    messageType: "INKADE_START_REGION_PICKER" | "INKADE_TOGGLE_READER",
  ) => void;
  readonly onSelectTemplate: (templateId: string) => void;
  readonly onRunAiEnrich: () => void;
  readonly onClipPage: (action: "create-new" | "update-body" | "update-meta") => void;
}

export function PopupClipForm({
  isConfigured,
  draftRestored,
  onMarkEdited,
  onTriggerTabUi,
  onSelectTemplate,
  onRunAiEnrich,
  onClipPage,
}: PopupClipFormProps) {
  const { t } = useInkadeTranslation();
  const aiProvider = useClipperSettingsStore((s) => s.settings.aiProvider);
  const {
    extracted,
    spaces,
    tagSuggestions,
    existingLookup,
    showMarkdownPreview,
    showAdvanced,
    title,
    spaceId,
    tagsList,
    clipMode,
    mirrorImages,
    saveSnapshot,
    appendToDaily,
    templates,
    selectedTemplateId,
    autoMatchedTemplateId,
    aiEnriching,
    aiSummaryText,
    submittingClip,
    setField,
  } = usePopupStore();

  if (!extracted) return null;

  const clipModeLabel =
    clipMode === "server-ingest"
      ? t("clipper.clipModeServerIngest")
      : t("clipper.clipModeClientDom");
  const selectedTemplate = templates.find((tpl) => tpl.id === selectedTemplateId);
  const selectedTemplateLabel = selectedTemplate
    ? autoMatchedTemplateId === selectedTemplate.id
      ? t("clipper.templateAutoMatched", { name: selectedTemplate.name })
      : selectedTemplate.name
    : "";

  const advancedSummary = [
    clipMode === "server-ingest"
      ? t("clipper.popupAdvancedServerShort")
      : t("clipper.popupAdvancedDomShort"),
    mirrorImages ? t("clipper.popupAdvancedMirrorShort") : null,
    saveSnapshot ? t("clipper.popupAdvancedSnapshotShort") : null,
    appendToDaily ? t("clipper.popupAdvancedDailyShort") : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Card className="gap-2.5 rounded-lg px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[11px] text-muted-foreground tabular-nums">
          {extracted.meta.domain}
          {extracted.meta.wordCount !== undefined
            ? ` · ${t("clipper.wordCountMeta", { count: extracted.meta.wordCount })}`
            : ""}
          {extracted.imageUrls.length > 0
            ? ` · ${t("clipper.imageCountMeta", { count: extracted.imageUrls.length })}`
            : ""}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            aria-label={t("clipper.previewMarkdownBtn")}
            aria-pressed={showMarkdownPreview}
            className={cn(
              showMarkdownPreview
                ? "border-foreground/30 bg-foreground/8 text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setField("showMarkdownPreview", !showMarkdownPreview)}
            size="xs"
            variant="outline"
          >
            <Eye className="size-3" />
            <span>{t("clipper.previewMarkdownBtn")}</span>
          </Button>
          <Button
            aria-label={t("clipper.regionPickerBtn")}
            onClick={() => onTriggerTabUi("INKADE_START_REGION_PICKER")}
            size="icon-xs"
            title={t("clipper.regionPickerBtn")}
            variant="outline"
          >
            <Crop className="size-3" />
          </Button>
          <Button
            aria-label={t("clipper.readerViewBtn")}
            onClick={() => onTriggerTabUi("INKADE_TOGGLE_READER")}
            size="icon-xs"
            title={t("clipper.readerViewBtn")}
            variant="outline"
          >
            <BookOpen className="size-3" />
          </Button>
        </div>
      </div>

      <GridDisclosure open={showMarkdownPreview}>
        <pre className="m-0 max-h-28 overflow-y-auto whitespace-pre-wrap rounded-md border border-border bg-muted/45 p-2 font-mono text-[11px] leading-relaxed text-foreground [scrollbar-gutter:stable]">
          {extracted.markdown.slice(0, 1200)}
        </pre>
      </GridDisclosure>

      <Field className="w-full min-w-0">
        <FieldLabel className="text-[11.5px] text-muted-foreground" htmlFor="clip-title">
          {t("clipper.titleLabel")}
        </FieldLabel>
        <Input
          className="w-full"
          id="clip-title"
          onChange={(e) => {
            onMarkEdited();
            setField("title", e.target.value);
          }}
          placeholder={t("clipper.titlePlaceholder")}
          size="sm"
          type="text"
          value={title}
        />
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <SpaceSelectField
          id="clip-space"
          label={t("clipper.spaceLabel")}
          onChange={(nextSpaceId) => {
            onMarkEdited();
            setField("spaceId", nextSpaceId);
          }}
          spaces={spaces}
          value={spaceId}
        />

        <Field className="w-full min-w-0">
          <FieldLabel className="text-[11.5px] text-muted-foreground" htmlFor="clip-template">
            {t("clipper.templateLabel")}
          </FieldLabel>
          <Select
            onValueChange={(value) => {
              if (value !== null) onSelectTemplate(value);
            }}
            value={selectedTemplateId}
          >
            <SelectTrigger className="w-full min-w-0" id="clip-template" size="sm">
              <SelectValue className="min-w-0 truncate">{selectedTemplateLabel}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {templates.map((tpl) => (
                <SelectItem key={tpl.id} value={tpl.id}>
                  {autoMatchedTemplateId === tpl.id
                    ? t("clipper.templateAutoMatched", { name: tpl.name })
                    : tpl.name}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </Field>
      </div>

      <Field className="w-full min-w-0">
        <div className="flex w-full items-center justify-between gap-2">
          <FieldLabel className="text-[11.5px] text-muted-foreground" htmlFor="clip-tags">
            {t("clipper.tagsLabel")}
          </FieldLabel>
          <Button
            disabled={aiEnriching}
            onClick={onRunAiEnrich}
            size="xs"
            title={
              isAiProviderReady(aiProvider)
                ? t("clipper.aiEnrichBtn")
                : t("clipper.aiNotConfiguredHint")
            }
            variant="outline"
          >
            {aiEnriching ? <ThinkingIndicator size="sm" /> : <Sparkles className="size-3" />}
            <span>{aiEnriching ? t("clipper.aiEnriching") : t("clipper.aiEnrichBtn")}</span>
          </Button>
        </div>
        <TagChipsInput
          id="clip-tags"
          onChange={(next) => {
            onMarkEdited();
            setField("tagsList", next);
          }}
          placeholder={t("clipper.tagsPlaceholder")}
          suggestions={tagSuggestions}
          tags={tagsList}
        />
      </Field>

      {aiSummaryText ? (
        <div className="flex flex-col gap-1 rounded-md border border-border bg-muted/35 p-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium text-muted-foreground">
              {t("clipper.aiSummaryPreviewLabel")}
            </span>
            <button
              aria-label={t("common.remove")}
              className="inline-flex size-5 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => setField("aiSummaryText", "")}
              type="button"
            >
              <X className="size-3" />
            </button>
          </div>
          <Textarea
            className="min-h-14 text-xs"
            onChange={(e) => setField("aiSummaryText", e.target.value)}
            size="sm"
            value={aiSummaryText}
          />
        </div>
      ) : null}

      <button
        aria-expanded={showAdvanced}
        className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-md border border-border/70 bg-muted/30 px-2.5 py-1.5 text-left text-[11px] text-muted-foreground transition-colors hover:bg-muted/55 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--border-focus)]"
        onClick={() => setField("showAdvanced", !showAdvanced)}
        type="button"
      >
        <span className="truncate">{advancedSummary}</span>
        <ChevronDown
          className={cn(
            "size-3.5 shrink-0 transition-transform duration-[var(--duration-quick)] ease-[var(--ease-smooth-out)]",
            showAdvanced && "rotate-180",
          )}
        />
      </button>

      <GridDisclosure open={showAdvanced}>
        <div className="flex flex-col gap-2 rounded-md border border-border/70 bg-muted/25 p-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">
              {t("clipper.extractorBadge", { name: extracted.extractor })}
            </span>
            {draftRestored ? (
              <Badge size="sm" variant="secondary">
                {t("clipper.draftRestoredBadge")}
              </Badge>
            ) : null}
          </div>
          <Field className="w-full min-w-0">
            <FieldLabel className="text-[11.5px] text-muted-foreground" htmlFor="clip-mode">
              {t("clipper.clipModeLabel")}
            </FieldLabel>
            <Select
              onValueChange={(value) => {
                if (value !== null) setField("clipMode", value);
              }}
              value={clipMode}
            >
              <SelectTrigger className="w-full min-w-0" id="clip-mode" size="sm">
                <SelectValue className="min-w-0 truncate">{clipModeLabel}</SelectValue>
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value="client-dom">{t("clipper.clipModeClientDom")}</SelectItem>
                <SelectItem value="server-ingest">{t("clipper.clipModeServerIngest")}</SelectItem>
              </SelectPopup>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
            <label className="flex cursor-pointer items-center gap-2 text-xs text-foreground">
              <Checkbox
                checked={mirrorImages}
                onCheckedChange={(checked) => setField("mirrorImages", Boolean(checked))}
              />
              <span className="truncate">{t("clipper.mirrorImagesToggle")}</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-foreground">
              <Checkbox
                checked={saveSnapshot}
                onCheckedChange={(checked) => setField("saveSnapshot", Boolean(checked))}
              />
              <span className="truncate">{t("clipper.saveSnapshotToggle")}</span>
            </label>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-foreground">
            <Checkbox
              checked={appendToDaily}
              onCheckedChange={(checked) => setField("appendToDaily", Boolean(checked))}
            />
            <span>{t("clipper.appendDailyToggle")}</span>
          </label>
        </div>
      </GridDisclosure>

      {existingLookup?.found ? (
        <div className="flex flex-col gap-1.5 pt-0.5">
          <Button
            className="w-full"
            disabled={!isConfigured || submittingClip}
            onClick={() => onClipPage("update-body")}
            size="sm"
          >
            <BookmarkCheck className="size-3.5" />
            <span>
              {submittingClip ? t("clipper.clippingPage") : t("clipper.updateExistingClipBtn")}
            </span>
            {!submittingClip ? <Kbd aria-hidden="true">⌘⏎</Kbd> : null}
          </Button>
          <div className="grid grid-cols-2 gap-1.5">
            <Button
              disabled={!isConfigured || submittingClip}
              onClick={() => onClipPage("update-meta")}
              size="xs"
              variant="outline"
            >
              <span>{t("clipper.updateMetadataOnlyBtn")}</span>
            </Button>
            <Button
              disabled={!isConfigured || submittingClip}
              onClick={() => onClipPage("create-new")}
              size="xs"
              variant="outline"
            >
              <span>{t("clipper.saveAsNewClipBtn")}</span>
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 pt-0.5">
          <Button
            className="flex-1"
            disabled={!isConfigured || submittingClip}
            onClick={() => onClipPage("create-new")}
            size="sm"
          >
            <BookmarkCheck className="size-3.5" />
            <span>{submittingClip ? t("clipper.clippingPage") : t("clipper.clipPageBtn")}</span>
            {!submittingClip ? <Kbd aria-hidden="true">⌘⏎</Kbd> : null}
          </Button>
        </div>
      )}
    </Card>
  );
}
