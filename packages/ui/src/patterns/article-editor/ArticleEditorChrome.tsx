"use client";

import type { AdeThreadBinding, DocumentTemplate } from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import type { Editor } from "@tiptap/react";
import {
  AlertTriangleIcon,
  EyeIcon,
  LayoutTemplateIcon,
  SaveIcon,
  SparklesIcon,
  Wand2Icon,
} from "lucide-react";
import type React from "react";
import { ImageInsertDialog } from "../../editor/menus/ImageInsertDialog.tsx";
import { cn } from "../../lib/utils.ts";
import { Badge } from "../../primitives/badge.tsx";
import { Button } from "../../primitives/button.tsx";
import {
  Dialog,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../../primitives/dialog.tsx";
import { GlideHighlight } from "../../primitives/glide-highlight.tsx";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "../../primitives/segmented-control.tsx";
import { formatAdeKindLabel } from "../AdeThreadChip.tsx";

export interface ArticleEditorTopChromeProps {
  readonly docVersion: number;
  readonly hasVersionConflict: boolean;
  readonly hideTopChrome: boolean;
  readonly borderless: boolean;
  readonly mode: "rich" | "source";
  readonly autosaveStatus: "idle" | "saving" | "saved" | "unsaved";
  readonly uploading: boolean;
  readonly editor: Editor | null;
  readonly readOnly: boolean;
  readonly showToolbar: boolean;
  readonly saving: boolean;
  readonly hasSaveHandler: boolean;
  readonly onResolveConflict?: (() => void) | undefined;
  readonly onSwitchMode: (next: "rich" | "source") => void;
  readonly onToggleToolbar: () => void;
  readonly onOpenAiMenu: () => void;
  readonly onExitEdit?: (() => void) | undefined;
  readonly onSaveClick: () => void;
}

export function ArticleEditorTopChrome({
  docVersion,
  hasVersionConflict,
  hideTopChrome,
  borderless,
  mode,
  autosaveStatus,
  uploading,
  editor,
  readOnly,
  showToolbar,
  saving,
  hasSaveHandler,
  onResolveConflict,
  onSwitchMode,
  onToggleToolbar,
  onOpenAiMenu,
  onExitEdit,
  onSaveClick,
}: ArticleEditorTopChromeProps): React.ReactElement {
  const { t } = useInkadeTranslation();

  return (
    <>
      {hasVersionConflict && (
        <div
          className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning/35 bg-warning/10 px-4 py-2 text-xs"
          role="alert"
        >
          <div className="flex items-center gap-2 text-warning-foreground">
            <AlertTriangleIcon className="size-4 shrink-0" />
            <span>{t("editor.conflictBanner", { version: docVersion })}</span>
          </div>
          {onResolveConflict && (
            <Button onClick={onResolveConflict} size="xs" type="button" variant="outline">
              {t("editor.inspectDiff")}
            </Button>
          )}
        </div>
      )}

      {!hideTopChrome && (
        <div
          className={cn(
            "flex flex-wrap items-center justify-between gap-2 border-b",
            borderless ? "border-border/50 px-0 py-1.5" : "bg-muted/35 px-3 py-2",
          )}
        >
          <div className="flex flex-wrap items-center gap-2">
            <SegmentedControl size="sm">
              <SegmentedControlItem
                data-pressed={mode === "rich" ? "" : undefined}
                onClick={() => onSwitchMode("rich")}
              >
                {t("editor.richText")}
              </SegmentedControlItem>
              <SegmentedControlItem
                data-pressed={mode === "source" ? "" : undefined}
                onClick={() => onSwitchMode("source")}
              >
                {t("editor.markdownSource")}
              </SegmentedControlItem>
            </SegmentedControl>

            <Badge size="sm" variant="outline">
              <span className="font-mono">{t("common.version", { version: docVersion })}</span>
            </Badge>

            {autosaveStatus !== "idle" && (
              <span className="text-[11px] text-muted-foreground">
                {autosaveStatus === "saving"
                  ? t("editor.autosaveSaving")
                  : autosaveStatus === "saved"
                    ? t("editor.autosaveSaved")
                    : t("editor.autosaveUnsaved")}
              </span>
            )}

            {uploading && (
              <Badge size="sm" variant="info">
                {t("editor.uploading")}
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            {editor && mode === "rich" && !readOnly && (
              <>
                <Button
                  aria-label={t("editor.toggleFormatToolbar")}
                  aria-pressed={showToolbar}
                  onClick={onToggleToolbar}
                  size="xs"
                  title={t("editor.toggleFormatToolbar")}
                  type="button"
                  variant={showToolbar ? "secondary" : "ghost"}
                >
                  <span className="font-serif text-xs font-semibold">
                    {t("editor.formatToolbarBadge")}
                  </span>
                </Button>
                <Button onClick={onOpenAiMenu} size="xs" type="button" variant="ghost">
                  <Wand2Icon />
                  <span>{t("editor.bubbleAiRewrite")}</span>
                </Button>
              </>
            )}
            {onExitEdit && (
              <Button onClick={onExitEdit} size="xs" type="button" variant="ghost">
                <EyeIcon />
                {t("editor.readView")}
              </Button>
            )}
            {hasSaveHandler && (
              <Button
                disabled={hasVersionConflict}
                loading={saving}
                onClick={onSaveClick}
                size="xs"
                type="button"
                variant="default"
              >
                <SaveIcon />
                {t("common.save")}
              </Button>
            )}
          </div>
        </div>
      )}

      {hideTopChrome && uploading && (
        <div className="mb-2 flex items-center gap-2">
          <Badge size="sm" variant="info">
            {t("editor.uploading")}
          </Badge>
        </div>
      )}
    </>
  );
}

export interface ArticleEditorDialogsProps {
  readonly editor: Editor | null;
  readonly readOnly: boolean;
  readonly templates: readonly DocumentTemplate[];
  readonly bindings: readonly AdeThreadBinding[];
  readonly templatePickerOpen: boolean;
  readonly onTemplatePickerOpenChange: (open: boolean) => void;
  readonly chipPopoverOpen: boolean;
  readonly onChipPopoverOpenChange: (open: boolean) => void;
  readonly onInsertBindingChip: (binding: AdeThreadBinding) => void;
  readonly imageDialogOpen: boolean;
  readonly onImageDialogOpenChange: (open: boolean) => void;
  readonly canUploadImage: boolean;
  readonly uploading: boolean;
  readonly onUploadFile: (file: File) => Promise<void>;
}

export function ArticleEditorDialogs({
  editor,
  readOnly,
  templates,
  bindings,
  templatePickerOpen,
  onTemplatePickerOpenChange,
  chipPopoverOpen,
  onChipPopoverOpenChange,
  onInsertBindingChip,
  imageDialogOpen,
  onImageDialogOpenChange,
  canUploadImage,
  uploading,
  onUploadFile,
}: ArticleEditorDialogsProps): React.ReactElement {
  const { t } = useInkadeTranslation();

  return (
    <>
      {editor && !readOnly && templates.length > 0 && (
        <Dialog onOpenChange={onTemplatePickerOpenChange} open={templatePickerOpen}>
          <DialogPopup className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="inline-flex items-center gap-2">
                <LayoutTemplateIcon className="size-4 text-muted-foreground" />
                {t("editor.chooseTemplate")}
              </DialogTitle>
            </DialogHeader>
            <DialogPanel className="max-h-72 overflow-y-auto [scrollbar-gutter:stable]">
              <GlideHighlight
                className="flex flex-col gap-0.5"
                highlightClassName="rounded-[var(--radius-menu-item)] bg-accent"
                mode="pointer"
              >
                {templates.map((tpl) => (
                  <button
                    className="relative z-10 flex w-full cursor-pointer flex-col gap-0.5 rounded-[var(--radius-menu-item)] px-2.5 py-2 text-left text-xs transition-colors hover:bg-accent in-data-[glide-visible=true]:hover:bg-transparent"
                    data-glide-item
                    key={tpl.id}
                    onClick={() => {
                      editor
                        .chain()
                        .focus()
                        .insertContent(tpl.contentMarkdown, { contentType: "markdown" })
                        .run();
                      onTemplatePickerOpenChange(false);
                    }}
                    type="button"
                  >
                    <span className="font-medium">{tpl.name}</span>
                    {tpl.description && (
                      <span className="line-clamp-1 text-[11px] text-muted-foreground">
                        {tpl.description}
                      </span>
                    )}
                  </button>
                ))}
              </GlideHighlight>
            </DialogPanel>
          </DialogPopup>
        </Dialog>
      )}

      {editor && !readOnly && bindings.length > 0 && (
        <Dialog onOpenChange={onChipPopoverOpenChange} open={chipPopoverOpen}>
          <DialogPopup className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="inline-flex items-center gap-2">
                <SparklesIcon className="size-4 text-primary" />
                {t("editor.embedThread")}
              </DialogTitle>
            </DialogHeader>
            <DialogPanel className="max-h-72 overflow-y-auto [scrollbar-gutter:stable]">
              <GlideHighlight
                className="flex flex-col gap-0.5"
                highlightClassName="rounded-[var(--radius-menu-item)] bg-accent"
                mode="pointer"
              >
                {bindings.map((binding) => (
                  <button
                    className="relative z-10 flex w-full cursor-pointer items-center justify-between gap-2 rounded-[var(--radius-menu-item)] px-2.5 py-2 text-left text-xs transition-colors hover:bg-accent in-data-[glide-visible=true]:hover:bg-transparent"
                    data-glide-item
                    key={binding.id}
                    onClick={() => onInsertBindingChip(binding)}
                    type="button"
                  >
                    <span className="truncate">{binding.title}</span>
                    <Badge size="sm" variant="secondary">
                      {formatAdeKindLabel(binding.adeKind, t)}
                    </Badge>
                  </button>
                ))}
              </GlideHighlight>
            </DialogPanel>
          </DialogPopup>
        </Dialog>
      )}

      <ImageInsertDialog
        canUpload={canUploadImage}
        onInsertUrl={(src, alt) => {
          editor?.chain().focus().setImage({ src, alt }).run();
        }}
        onOpenChange={onImageDialogOpenChange}
        onUploadFile={onUploadFile}
        open={imageDialogOpen}
        uploading={uploading}
      />
    </>
  );
}
