"use client";

import { asOutlineNodeId, type OutlineNode, type OutlineNodeId } from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import { RepeatIcon } from "lucide-react";
import type React from "react";
import { Badge } from "../../primitives/badge.tsx";
import type {
  HoverPreviewState,
  OutlineKindLabels,
  ProseMirrorWorkspaceDocSummary,
} from "./types.ts";

export interface OutlineHoverPreviewCardProps {
  readonly hoverPreview: HoverPreviewState;
  readonly floatingRef: React.RefObject<HTMLDivElement | null>;
  readonly coords: { readonly x: number; readonly y: number } | null;
  readonly docsByKey: ReadonlyMap<string, ProseMirrorWorkspaceDocSummary>;
  readonly activeById: ReadonlyMap<OutlineNodeId, OutlineNode>;
  readonly kindLabels: OutlineKindLabels;
}

export function OutlineHoverPreviewCard({
  hoverPreview,
  floatingRef,
  coords,
  docsByKey,
  activeById,
  kindLabels,
}: OutlineHoverPreviewCardProps): React.ReactElement {
  const { t } = useInkadeTranslation();

  return (
    <div
      className="pointer-events-none fixed z-50 w-72 rounded-lg border border-[var(--border-overlay)] bg-popover p-3 text-popover-foreground shadow-[var(--shadow-overlay)]"
      data-inkade-ui-overlay="true"
      ref={floatingRef}
      style={
        coords
          ? {
              left: `${coords.x}px`,
              top: `${coords.y}px`,
              visibility: "visible",
            }
          : { left: "-9999px", top: "-9999px", visibility: "hidden" }
      }
    >
      {hoverPreview.kind === "wikilink" ? (
        (() => {
          const doc = docsByKey.get(hoverPreview.target.toLowerCase());
          if (!doc) {
            return (
              <p className="text-xs text-muted-foreground">
                {t("outline.unresolvedLink", { target: hoverPreview.target })}
              </p>
            );
          }
          return (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-semibold">{doc.title}</span>
                <Badge size="sm" variant="secondary">
                  {kindLabels[doc.kind]}
                </Badge>
              </div>
              <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">
                {doc.excerpt || t("outline.noExcerpt")}
              </p>
            </div>
          );
        })()
      ) : (
        (() => {
          const refNode = hoverPreview.target
            ? activeById.get(asOutlineNodeId(hoverPreview.target))
            : undefined;
          if (!refNode) {
            return (
              <p className="text-xs text-muted-foreground">
                {t("outline.mirrorPreviewEmpty")}
              </p>
            );
          }
          return (
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <RepeatIcon className="size-3 text-teal-600 dark:text-teal-400" />
                <span className="font-mono">{refNode.id}</span>
              </div>
              <p className="text-xs leading-relaxed text-foreground">
                {refNode.contentText || refNode.contentMarkdown}
              </p>
              {refNode.noteMarkdown && (
                <p className="text-[11px] text-muted-foreground">{refNode.noteMarkdown}</p>
              )}
            </div>
          );
        })()
      )}
    </div>
  );
}
