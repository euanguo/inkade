import type { ClipperTemplate } from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import { Badge, Button, buttonVariants, cn, HoldConfirmButton } from "@inkade/ui/primitives";
import { CloudDownload, CloudUpload, Download, Plus, RotateCcw, Upload } from "lucide-react";
import type React from "react";

export interface TemplateToolbarProps {
  readonly templates: readonly ClipperTemplate[];
  readonly selectedId: string | undefined;
  readonly isDirty: boolean;
  readonly hasClient: boolean;
  readonly syncing: boolean;
  readonly pendingSwitchId: string | null;
  readonly onCreateTemplate: () => void;
  readonly onExportJson: () => void;
  readonly onImportJson: (event: React.ChangeEvent<HTMLInputElement>) => void;
  readonly onPushCloud: () => void;
  readonly onPullCloud: () => void;
  readonly onResetBuiltins: () => void;
  readonly onSelectTemplate: (templateId: string) => void;
  readonly onConfirmSaveAndSwitch: () => void;
  readonly onDiscardAndSwitch: () => void;
  readonly onCancelSwitch: () => void;
}

export function TemplateToolbar({
  templates,
  selectedId,
  isDirty,
  hasClient,
  syncing,
  pendingSwitchId,
  onCreateTemplate,
  onExportJson,
  onImportJson,
  onPushCloud,
  onPullCloud,
  onResetBuiltins,
  onSelectTemplate,
  onConfirmSaveAndSwitch,
  onDiscardAndSwitch,
  onCancelSwitch,
}: TemplateToolbarProps) {
  const { t } = useInkadeTranslation();

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="m-0 text-[13px] font-semibold text-foreground">
            {t("clipper.templatesHeading")}
          </h2>
          {isDirty ? (
            <Badge size="sm" variant="warning">
              {t("clipper.unsavedChangesBadge")}
            </Badge>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button onClick={onCreateTemplate} size="xs" variant="outline">
            <Plus className="size-3" />
            <span>{t("clipper.templateNewBtn")}</span>
          </Button>
          <Button onClick={onExportJson} size="xs" variant="outline">
            <Download className="size-3" />
            <span>{t("clipper.templateExportBtn")}</span>
          </Button>
          <label className={cn(buttonVariants({ size: "xs", variant: "outline" }), "cursor-pointer")}>
            <Upload className="size-3" />
            <span>{t("clipper.templateImportBtn")}</span>
            <input
              accept="application/json"
              className="hidden"
              onChange={onImportJson}
              type="file"
            />
          </label>
          <Button
            disabled={!hasClient || syncing}
            onClick={onPushCloud}
            size="xs"
            variant="outline"
          >
            <CloudUpload className="size-3" />
            <span>{t("clipper.templatePushCloudBtn")}</span>
          </Button>
          <Button
            disabled={!hasClient || syncing}
            onClick={onPullCloud}
            size="xs"
            variant="outline"
          >
            <CloudDownload className="size-3" />
            <span>{t("clipper.templatePullCloudBtn")}</span>
          </Button>
          <HoldConfirmButton onConfirm={onResetBuiltins} size="sm">
            <RotateCcw className="size-3" />
            <span>{t("clipper.templateResetDefaultsBtn")}</span>
          </HoldConfirmButton>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {templates.map((tpl) => {
          const isSelected = tpl.id === selectedId;
          return (
            <Button
              aria-pressed={isSelected}
              className={cn(
                isSelected
                  ? "border-foreground/30 bg-foreground/8 text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
              key={tpl.id}
              onClick={() => onSelectTemplate(tpl.id)}
              size="xs"
              variant="outline"
            >
              <span>{tpl.name}</span>
            </Button>
          );
        })}
      </div>

      {pendingSwitchId ? (
        <div className="ink-status">
          <span className="text-xs">{t("clipper.templateUnsavedSwitchConfirm")}</span>
          <div className="flex items-center gap-1.5">
            <Button onClick={onConfirmSaveAndSwitch} size="xs">
              <span>{t("clipper.templateSaveAndSwitchBtn")}</span>
            </Button>
            <Button onClick={onDiscardAndSwitch} size="xs" variant="outline">
              <span>{t("clipper.templateDiscardSwitchBtn")}</span>
            </Button>
            <Button onClick={onCancelSwitch} size="xs" variant="ghost">
              <span>{t("common.cancel")}</span>
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );
}
