"use client";

import { useInkadeTranslation } from "@inkade/i18n";
import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import {
  AlertCircleIcon,
  AlertTriangleIcon,
  CheckIcon,
  ChevronDownIcon,
  InfoIcon,
  LightbulbIcon,
  ShieldAlertIcon,
} from "lucide-react";
import type React from "react";
import { useState } from "react";
import { cn } from "../../lib/utils.ts";
import type { GfmCalloutKind } from "../../patterns/remark-inkade-wikilinks.ts";
import { GlideHighlight } from "../../primitives/glide-highlight.tsx";
import { Popover, PopoverPopup, PopoverTrigger } from "../../primitives/popover.tsx";
import { useEditorSurface } from "../context.tsx";
import { CALLOUT_KINDS } from "../extensions/callout.ts";

export function CalloutNodeView({
  node,
  updateAttributes,
}: ReactNodeViewProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const { readOnly } = useEditorSurface();
  const [pickerOpen, setPickerOpen] = useState(false);
  const kind = (node.attrs?.kind as GfmCalloutKind | undefined) ?? "note";
  const customTitle = String(node.attrs?.title ?? "").trim();

  const labelMap: Readonly<Record<GfmCalloutKind, string>> = {
    note: t("reader.calloutNote"),
    tip: t("reader.calloutTip"),
    important: t("reader.calloutImportant"),
    warning: t("reader.calloutWarning"),
    caution: t("reader.calloutCaution"),
  };
  const headingText = customTitle || labelMap[kind];

  const iconMap: Readonly<Record<GfmCalloutKind, React.ReactElement>> = {
    note: <InfoIcon className="size-3.5 text-info-foreground" />,
    tip: <LightbulbIcon className="size-3.5 text-success-foreground" />,
    important: <AlertCircleIcon className="size-3.5 text-violet-600 dark:text-violet-400" />,
    warning: <AlertTriangleIcon className="size-3.5 text-warning-foreground" />,
    caution: <ShieldAlertIcon className="size-3.5 text-destructive-foreground" />,
  };

  const titleClassMap: Readonly<Record<GfmCalloutKind, string>> = {
    note: "text-info-foreground",
    tip: "text-success-foreground",
    important: "text-violet-600 dark:text-violet-400",
    warning: "text-warning-foreground",
    caution: "text-destructive-foreground",
  };

  return (
    <NodeViewWrapper className="inkade-callout my-3" data-callout={kind}>
      <div className="mb-1.5 flex items-center justify-between gap-2" contentEditable={false}>
        {readOnly ? (
          <div className={cn("inline-flex items-center gap-1.5 text-xs font-semibold", titleClassMap[kind])}>
            {iconMap[kind]}
            <span>{headingText}</span>
          </div>
        ) : (
          <Popover onOpenChange={setPickerOpen} open={pickerOpen}>
            <PopoverTrigger
              render={
                <button
                  aria-label={t("editor.calloutSwitchKindAria")}
                  className={cn(
                    "group/callout-kind inline-flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-0.5 -ml-1.5 text-xs font-semibold transition-colors hover:bg-background/70",
                    titleClassMap[kind],
                  )}
                  type="button"
                />
              }
            >
              {iconMap[kind]}
              <span>{headingText}</span>
              <ChevronDownIcon className="size-3 opacity-0 transition-opacity group-hover/callout-kind:opacity-75" />
            </PopoverTrigger>
            <PopoverPopup align="start" className="w-44" viewportClassName="p-1">
              <GlideHighlight
                className="flex flex-col gap-0.5"
                highlightClassName="rounded-[var(--radius-menu-item)] bg-accent"
                mode="pointer"
              >
                {CALLOUT_KINDS.map((k) => (
                  <button
                    className={cn(
                      "relative z-10 flex w-full cursor-pointer items-center justify-between gap-2 rounded-[var(--radius-menu-item)] px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent/60 in-data-[glide-visible=true]:hover:bg-transparent",
                      k === kind
                        ? "bg-accent/70 text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    data-glide-item
                    key={k}
                    onClick={() => {
                      updateAttributes({ kind: k });
                      setPickerOpen(false);
                    }}
                    type="button"
                  >
                    <span className="inline-flex items-center gap-2">
                      {iconMap[k]}
                      <span>{labelMap[k]}</span>
                    </span>
                    {k === kind && <CheckIcon className="size-3 text-primary" />}
                  </button>
                ))}
              </GlideHighlight>
            </PopoverPopup>
          </Popover>
        )}
      </div>
      <NodeViewContent className="[&>p:first-child]:mt-0 [&>p:last-child]:mb-0" />
    </NodeViewWrapper>
  );
}
