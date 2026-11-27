"use client";

import { useInkadeTranslation } from "@inkade/i18n";
import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import {
  AlignCenterIcon,
  AlignLeftIcon,
  AlignRightIcon,
  ImageOffIcon,
  Maximize2Icon,
  Trash2Icon,
} from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import { cn } from "../../lib/utils.ts";
import { Button } from "../../primitives/button.tsx";
import {
  Dialog,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../../primitives/dialog.tsx";
import { Separator } from "../../primitives/separator.tsx";
import { useEditorSurface } from "../context.tsx";
import type { ImageAlignPreset, ImageWidthPreset } from "../types.ts";

const WIDTH_CLASS_MAP: Readonly<Record<ImageWidthPreset, string>> = {
  sm: "max-w-[42%]",
  md: "max-w-[66%]",
  lg: "max-w-[85%]",
  full: "w-full max-w-full",
};

const ALIGN_CLASS_MAP: Readonly<Record<ImageAlignPreset, string>> = {
  left: "items-start",
  center: "items-center",
  right: "items-end",
};

export function ImageNodeView({
  deleteNode,
  node,
  selected,
  updateAttributes,
}: ReactNodeViewProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const { readOnly } = useEditorSurface();
  const [zoomOpen, setZoomOpen] = useState(false);
  const [imgError, setImgError] = useState(false);

  const src = String(node.attrs?.src ?? "");
  const alt = String(node.attrs?.alt ?? "");
  const widthPreset = (node.attrs?.widthPreset as ImageWidthPreset | undefined) ?? "full";
  const align = (node.attrs?.align as ImageAlignPreset | undefined) ?? "center";

  useEffect(() => {
    setImgError(false);
  }, [src]);

  const widthPresets: ReadonlyArray<{ readonly id: ImageWidthPreset; readonly label: string }> = [
    { id: "sm", label: t("editor.imageWidthSm") },
    { id: "md", label: t("editor.imageWidthMd") },
    { id: "lg", label: t("editor.imageWidthLg") },
    { id: "full", label: t("editor.imageWidthFull") },
  ];

  return (
    <>
      <NodeViewWrapper
        className={cn("my-4 flex flex-col gap-1.5", ALIGN_CLASS_MAP[align])}
        contentEditable={false}
        data-type="inkade-image"
      >
        <figure
          className={cn(
            "group/img relative flex flex-col gap-1.5",
            WIDTH_CLASS_MAP[widthPreset],
          )}
        >
          <div
            className={cn(
              "relative overflow-hidden rounded-lg border bg-muted/20 transition-colors",
              selected ? "border-foreground/45" : "border-border",
            )}
            data-slot="editor-image-frame"
          >
            {imgError || !src.trim() ? (
              <div className="flex min-h-32 flex-col items-center justify-center gap-1.5 px-4 py-6 text-center text-xs text-muted-foreground">
                <ImageOffIcon className="size-5 text-muted-foreground/70" />
                <span>{t("editor.imageLoadError")}</span>
                {src && (
                  <span className="max-w-full truncate font-mono text-[11px] opacity-70">
                    {src}
                  </span>
                )}
              </div>
            ) : (
              <img
                alt={alt}
                className="block h-auto max-h-[640px] w-full object-contain"
                draggable={false}
                onError={() => setImgError(true)}
                src={src}
              />
            )}
          </div>

          {/* Floating Hover / Selected Toolbar (outside overflow-hidden frame so narrow images never clip controls) */}
          <div
            className={cn(
              "not-typeset absolute top-2 right-2 z-10 flex max-w-[calc(100vw-24px)] flex-wrap items-center justify-end gap-0.5 rounded-lg border border-[var(--border-overlay)] bg-popover/95 p-1 text-popover-foreground shadow-[var(--shadow-overlay)] backdrop-blur-sm transition-opacity",
              selected
                ? "opacity-100"
                : "pointer-events-none opacity-0 group-hover/img:pointer-events-auto group-hover/img:opacity-100",
            )}
            data-slot="editor-image-toolbar"
          >
              {!readOnly && (
                <>
                  {widthPresets.map((preset) => (
                    <Button
                      className="px-1.5 text-[11px]"
                      key={preset.id}
                      onClick={() => updateAttributes({ widthPreset: preset.id })}
                      size="xs"
                      type="button"
                      variant={widthPreset === preset.id ? "secondary" : "ghost"}
                    >
                      {preset.label}
                    </Button>
                  ))}

                  <Separator className="mx-0.5 h-3.5" orientation="vertical" />

                  <Button
                    aria-label={t("editor.imageAlignLeft")}
                    onClick={() => updateAttributes({ align: "left" })}
                    size="icon-xs"
                    type="button"
                    variant={align === "left" ? "secondary" : "ghost"}
                  >
                    <AlignLeftIcon className="size-3.5" />
                  </Button>
                  <Button
                    aria-label={t("editor.imageAlignCenter")}
                    onClick={() => updateAttributes({ align: "center" })}
                    size="icon-xs"
                    type="button"
                    variant={align === "center" ? "secondary" : "ghost"}
                  >
                    <AlignCenterIcon className="size-3.5" />
                  </Button>
                  <Button
                    aria-label={t("editor.imageAlignRight")}
                    onClick={() => updateAttributes({ align: "right" })}
                    size="icon-xs"
                    type="button"
                    variant={align === "right" ? "secondary" : "ghost"}
                  >
                    <AlignRightIcon className="size-3.5" />
                  </Button>

                  <Separator className="mx-0.5 h-3.5" orientation="vertical" />
                </>
              )}

              <Button
                aria-label={t("editor.imageZoomAria")}
                onClick={() => setZoomOpen(true)}
                size="icon-xs"
                type="button"
                variant="ghost"
              >
                <Maximize2Icon className="size-3.5" />
              </Button>

              {!readOnly && (
                <Button
                  aria-label={t("editor.imageDeleteAria")}
                  onClick={() => deleteNode()}
                  size="icon-xs"
                  type="button"
                  variant="ghost"
                >
                  <Trash2Icon className="size-3.5 text-destructive-foreground" />
                </Button>
              )}
          </div>

          {(!readOnly || alt.length > 0) && (
            <figcaption className="w-full">
              <input
                className={cn(
                  "w-full bg-transparent text-xs text-muted-foreground outline-none placeholder:text-muted-foreground/50",
                  align === "center" && "text-center",
                  align === "right" && "text-right",
                )}
                onChange={(e) => updateAttributes({ alt: e.target.value })}
                placeholder={t("editor.imageCaptionPlaceholder")}
                readOnly={readOnly}
                value={alt}
              />
            </figcaption>
          )}
        </figure>
      </NodeViewWrapper>

      <Dialog onOpenChange={setZoomOpen} open={zoomOpen}>
        <DialogPopup className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>{alt || t("editor.slashImage")}</DialogTitle>
          </DialogHeader>
          <DialogPanel>
            <div className="flex max-h-[75vh] items-center justify-center overflow-auto rounded-lg bg-muted/25 p-4">
              <img
                alt={alt}
                className="max-h-[70vh] max-w-full rounded-md object-contain"
                src={src}
              />
            </div>
          </DialogPanel>
        </DialogPopup>
      </Dialog>
    </>
  );
}
