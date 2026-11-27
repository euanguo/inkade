import {
  asSavedViewId,
  asSpaceId,
  slugifyTitle,
  type PublicSite,
  type PublicSiteSourceType,
} from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import {
  useCreatePublicSiteMutation,
  useInkadeClient,
  useInkadePublicSites,
  useInkadeSavedViews,
  useInkadeSpaces,
  useInkadeSpaceSchemas,
  useUpdatePublicSiteMutation,
} from "@inkade/sdk/react";
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogPanel,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
  Input,
  SegmentedControl,
  SegmentedControlItem,
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
  Switch,
} from "@inkade/ui";
import { DownloadIcon, ExternalLinkIcon, GlobeIcon, Link2Icon, RssIcon } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { getApiBaseUrl } from "../lib/api.ts";
import { showErrorToast, showSuccessToast } from "../lib/undo.ts";

export interface DigitalGardenPresetSource {
  readonly sourceType: PublicSiteSourceType;
  readonly sourceId: string;
  readonly suggestedTitle?: string | undefined;
}

export interface DigitalGardenDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly initialSite?: PublicSite | null | undefined;
  readonly presetSource?: DigitalGardenPresetSource | null | undefined;
}

export function buildGardenPublicUrl(slug: string): string {
  if (typeof window !== "undefined") {
    return `${window.location.origin}/site/${encodeURIComponent(slug)}`;
  }
  return `/site/${encodeURIComponent(slug)}`;
}

export function buildGardenRssUrl(slug: string): string {
  const base = getApiBaseUrl();
  const path = `/api/v1/public/sites/${encodeURIComponent(slug)}/feed.xml`;
  return base ? `${base}${path}` : path;
}

export function triggerUint8ArrayDownload(bytes: Uint8Array, filename: string, mimeType: string): void {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export function DigitalGardenDialog({
  open,
  onOpenChange,
  initialSite = null,
  presetSource = null,
}: DigitalGardenDialogProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const client = useInkadeClient();

  const spacesQuery = useInkadeSpaces({ enabled: open });
  const savedViewsQuery = useInkadeSavedViews({ enabled: open });
  const schemasQuery = useInkadeSpaceSchemas({ enabled: open });
  const sitesQuery = useInkadePublicSites({ enabled: open });

  const activeSpaces = useMemo(
    () => (spacesQuery.data ?? []).filter((s) => s.archivedAt === null),
    [spacesQuery.data],
  );
  const savedViews = useMemo(() => savedViewsQuery.data ?? [], [savedViewsQuery.data]);
  const existingSites = useMemo(() => sitesQuery.data ?? [], [sitesQuery.data]);

  const matchedExistingSite = useMemo(() => {
    if (initialSite) return initialSite;
    if (!presetSource) return null;
    return (
      existingSites.find(
        (site) =>
          site.sourceType === presetSource.sourceType &&
          site.sourceId === presetSource.sourceId,
      ) ?? null
    );
  }, [existingSites, initialSite, presetSource]);

  const [sourceType, setSourceType] = useState<PublicSiteSourceType>("space");
  const [sourceId, setSourceId] = useState("");
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [exposedFields, setExposedFields] = useState<string[]>([]);
  const [enableRss, setEnableRss] = useState(true);
  const [enabled, setEnabled] = useState(true);
  const [exportingZip, setExportingZip] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (matchedExistingSite) {
      setSourceType(matchedExistingSite.sourceType);
      setSourceId(matchedExistingSite.sourceId);
      setTitle(matchedExistingSite.title);
      setSubtitle(matchedExistingSite.subtitle);
      setSlug(matchedExistingSite.slug);
      setSlugTouched(true);
      setExposedFields([...matchedExistingSite.exposedFields]);
      setEnableRss(matchedExistingSite.enableRss);
      setEnabled(matchedExistingSite.enabled);
      return;
    }

    const nextSourceType = presetSource?.sourceType ?? "space";
    const defaultSpace = activeSpaces[0]?.id ?? "";
    const defaultView = savedViews[0]?.id ?? "";
    const nextSourceId =
      presetSource?.sourceId ?? (nextSourceType === "space" ? defaultSpace : defaultView);
    const defaultTitle =
      presetSource?.suggestedTitle ??
      (nextSourceType === "space"
        ? activeSpaces.find((s) => s.id === nextSourceId)?.name
        : savedViews.find((v) => v.id === nextSourceId)?.name) ??
      "";

    setSourceType(nextSourceType);
    setSourceId(nextSourceId);
    setTitle(defaultTitle);
    setSubtitle("");
    setSlug(defaultTitle ? slugifyTitle(defaultTitle) : "");
    setSlugTouched(false);
    setExposedFields([]);
    setEnableRss(true);
    setEnabled(true);
  }, [activeSpaces, matchedExistingSite, open, presetSource, savedViews]);

  const availableFields = useMemo(() => {
    const schemas = schemasQuery.data ?? [];
    const seen = new Set<string>();
    const fields: Array<{ readonly key: string; readonly label: string }> = [];
    for (const schema of schemas) {
      if (sourceType === "space" && sourceId && schema.spaceId !== sourceId) continue;
      if (!schema.spaceId) continue;
      for (const field of schema.fields) {
        if (seen.has(field.key)) continue;
        seen.add(field.key);
        fields.push({ key: field.key, label: field.label });
      }
    }
    return fields;
  }, [schemasQuery.data, sourceId, sourceType]);

  const createMutation = useCreatePublicSiteMutation({
    onSuccess: (created) => {
      showSuccessToast(t("garden.savedToast"));
      setSlug(created.slug);
      setSlugTouched(true);
      onOpenChange(false);
    },
    onError: (err) => showErrorToast(t("garden.saveFailedToast"), err),
  });

  const updateMutation = useUpdatePublicSiteMutation({
    onSuccess: () => {
      showSuccessToast(t("garden.savedToast"));
      onOpenChange(false);
    },
    onError: (err) => showErrorToast(t("garden.saveFailedToast"), err),
  });

  const isPending = createMutation.isPending || updateMutation.isPending;

  const handleToggleField = (key: string, checked: boolean) => {
    setExposedFields((prev) =>
      checked ? (prev.includes(key) ? prev : [...prev, key]) : prev.filter((item) => item !== key),
    );
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !sourceId.trim()) return;
    const finalSlug = (slug.trim() || slugifyTitle(title)).toLowerCase();
    if (matchedExistingSite) {
      updateMutation.mutate({
        siteId: matchedExistingSite.id,
        input: {
          title: title.trim(),
          subtitle: subtitle.trim(),
          slug: finalSlug,
          sourceType,
          sourceId: sourceType === "space" ? asSpaceId(sourceId) : asSavedViewId(sourceId),
          exposedFields,
          enableRss,
          enabled,
        },
      });
      return;
    }

    createMutation.mutate({
      title: title.trim(),
      subtitle: subtitle.trim(),
      slug: finalSlug,
      sourceType,
      sourceId: sourceType === "space" ? asSpaceId(sourceId) : asSavedViewId(sourceId),
      exposedFields,
      enableRss,
      enabled,
    });
  };

  const handleCopyText = async (value: string, toastKey: "garden.copiedUrlToast" | "garden.copiedRssToast") => {
    try {
      await navigator.clipboard.writeText(value);
      showSuccessToast(t(toastKey));
    } catch {
      // ignore clipboard errors
    }
  };

  const handleExportZip = async () => {
    if (!matchedExistingSite) return;
    setExportingZip(true);
    try {
      const bytes = await client.publicSites.exportZip(matchedExistingSite.id);
      triggerUint8ArrayDownload(bytes, `${matchedExistingSite.slug}-garden.zip`, "application/zip");
      showSuccessToast(t("garden.exportedToast"));
    } catch (err) {
      showErrorToast(t("garden.exportFailedToast"), err);
    } finally {
      setExportingZip(false);
    }
  };

  const targetChoices =
    sourceType === "space"
      ? activeSpaces.map((s) => ({ id: s.id, name: s.name }))
      : savedViews.map((v) => ({ id: v.id, name: v.name }));

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogPopup className="max-w-lg">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GlobeIcon className="size-4 text-primary" />
              <span>{t("garden.modalTitle")}</span>
            </DialogTitle>
            <DialogDescription>{t("garden.modalSubtitle")}</DialogDescription>
          </DialogHeader>

          <DialogPanel className="flex flex-col gap-4 py-3">
            {matchedExistingSite ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/30 px-3 py-2">
                <div className="flex items-center gap-2 text-xs">
                  <Badge
                    size="sm"
                    variant={matchedExistingSite.enabled ? "default" : "outline"}
                  >
                    {matchedExistingSite.enabled ? t("garden.statusLive") : t("garden.statusPaused")}
                  </Badge>
                  <span className="font-mono text-muted-foreground">
                    {`/site/${matchedExistingSite.slug}`}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Button
                    onClick={() =>
                      void handleCopyText(
                        buildGardenPublicUrl(matchedExistingSite.slug),
                        "garden.copiedUrlToast",
                      )
                    }
                    size="xs"
                    type="button"
                    variant="outline"
                  >
                    <Link2Icon />
                    <span>{t("garden.copyUrlButton")}</span>
                  </Button>
                  {matchedExistingSite.enableRss ? (
                    <Button
                      onClick={() =>
                        void handleCopyText(
                          buildGardenRssUrl(matchedExistingSite.slug),
                          "garden.copiedRssToast",
                        )
                      }
                      size="xs"
                      type="button"
                      variant="outline"
                    >
                      <RssIcon />
                      <span>{t("garden.copyRssButton")}</span>
                    </Button>
                  ) : null}
                  <Button
                    loading={exportingZip}
                    onClick={() => void handleExportZip()}
                    size="xs"
                    type="button"
                    variant="secondary"
                  >
                    <DownloadIcon />
                    <span>{t("garden.exportZipButton")}</span>
                  </Button>
                  <Button
                    onClick={() =>
                      window.open(
                        buildGardenPublicUrl(matchedExistingSite.slug),
                        "_blank",
                        "noopener,noreferrer",
                      )
                    }
                    size="xs"
                    type="button"
                    variant="ghost"
                  >
                    <ExternalLinkIcon />
                    <span>{t("garden.openPublicButton")}</span>
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-foreground">{t("garden.fieldSourceType")}</span>
              <SegmentedControl size="sm">
                <SegmentedControlItem
                  data-pressed={sourceType === "space" ? "" : undefined}
                  onClick={() => {
                    setSourceType("space");
                    const first = activeSpaces[0];
                    if (first) {
                      setSourceId(first.id);
                      if (!matchedExistingSite && !title) setTitle(first.name);
                    }
                  }}
                >
                  {t("garden.sourceSpace")}
                </SegmentedControlItem>
                <SegmentedControlItem
                  data-pressed={sourceType === "saved_view" ? "" : undefined}
                  onClick={() => {
                    setSourceType("saved_view");
                    const first = savedViews[0];
                    if (first) {
                      setSourceId(first.id);
                      if (!matchedExistingSite && !title) setTitle(first.name);
                    } else {
                      setSourceId("");
                    }
                  }}
                >
                  {t("garden.sourceSavedView")}
                </SegmentedControlItem>
              </SegmentedControl>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-foreground">{t("garden.fieldSourceTarget")}</span>
              <Select
                onValueChange={(next) => {
                  if (!next) return;
                  setSourceId(next);
                  const chosen = targetChoices.find((item) => item.id === next);
                  if (chosen && !matchedExistingSite) {
                    setTitle(chosen.name);
                    if (!slugTouched) {
                      setSlug(slugifyTitle(chosen.name));
                    }
                  }
                }}
                value={sourceId}
              >
                <SelectTrigger size="sm">
                  <SelectValue placeholder={t("garden.fieldSourceTarget")}>
                    {targetChoices.find((item) => item.id === sourceId)?.name ??
                      t("garden.fieldSourceTarget")}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {targetChoices.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-foreground" htmlFor="garden-title">{t("garden.fieldTitle")}</label>
                <Input
                  id="garden-title"
                  onChange={(e) => {
                    const nextVal = e.target.value;
                    setTitle(nextVal);
                    if (!slugTouched && !matchedExistingSite) {
                      setSlug(slugifyTitle(nextVal));
                    }
                  }}
                  placeholder={t("garden.fieldTitlePlaceholder")}
                  required
                  value={title}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-foreground" htmlFor="garden-slug">{t("garden.fieldSlug")}</label>
                <Input
                  id="garden-slug"
                  onChange={(e) => {
                    setSlugTouched(true);
                    setSlug(e.target.value.toLowerCase());
                  }}
                  placeholder={t("garden.fieldSlugPlaceholder")}
                  required
                  value={slug}
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-foreground" htmlFor="garden-subtitle">{t("garden.fieldSubtitle")}</label>
              <Input
                id="garden-subtitle"
                onChange={(e) => setSubtitle(e.target.value)}
                placeholder={t("garden.fieldSubtitlePlaceholder")}
                value={subtitle}
              />
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium text-foreground">{t("garden.fieldExposedFields")}</span>
              {availableFields.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {t("garden.fieldExposedFieldsEmpty")}
                </p>
              ) : (
                <div className="flex flex-wrap gap-2 rounded-lg border bg-muted/20 p-2.5">
                  {availableFields.map((field) => {
                    const checked = exposedFields.includes(field.key);
                    return (
                      <label
                        className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-xs"
                        key={field.key}
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(val) => handleToggleField(field.key, Boolean(val))}
                        />
                        <span>{field.label}</span>
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {field.key}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2 rounded-lg border p-3">
              <label className="flex cursor-pointer items-center justify-between gap-3 text-xs">
                <span>{t("garden.fieldEnableRss")}</span>
                <Switch
                  aria-label={t("garden.fieldEnableRss")}
                  checked={enableRss}
                  onCheckedChange={setEnableRss}
                />
              </label>
              <label className="flex cursor-pointer items-center justify-between gap-3 text-xs">
                <span>{t("garden.fieldEnabled")}</span>
                <Switch
                  aria-label={t("garden.fieldEnabled")}
                  checked={enabled}
                  onCheckedChange={setEnabled}
                />
              </label>
            </div>
          </DialogPanel>

          <DialogFooter>
            <Button onClick={() => onOpenChange(false)} type="button" variant="ghost">
              {t("garden.cancel")}
            </Button>
            <Button
              disabled={!title.trim() || !sourceId.trim()}
              loading={isPending}
              type="submit"
            >
              {t("garden.saveSubmit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
