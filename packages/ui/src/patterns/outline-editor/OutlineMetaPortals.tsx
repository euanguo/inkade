"use client";

import {
  asOutlineNodeId,
  type AdeThreadBinding,
  type DocumentId,
  type OutlineNode,
  type OutlineNodeId,
} from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import { BotIcon, CalendarArrowUpIcon, RepeatIcon } from "lucide-react";
import type React from "react";
import { createPortal } from "react-dom";
import { Badge } from "../../primitives/badge.tsx";
import { AdeThreadChip } from "../AdeThreadChip.tsx";

export interface OutlineMetaPortalsProps {
  readonly metaSlotEntries: ReadonlyArray<{ readonly nodeId: string; readonly el: HTMLElement }>;
  readonly activeById: ReadonlyMap<OutlineNodeId, OutlineNode>;
  readonly bindingsByNode: ReadonlyMap<OutlineNodeId, readonly AdeThreadBinding[]>;
  readonly rolloverDocDatesById?: ReadonlyMap<DocumentId, string> | undefined;
  readonly onFocusNode: (nodeId: OutlineNodeId) => void;
  readonly onOpenDate?: ((date: string) => void) | undefined;
  readonly onOpenDocument?: ((docIdOrSlug: string) => void) | undefined;
  readonly onOpenBinding?: ((binding: AdeThreadBinding) => void) | undefined;
  readonly onMarkBindingRead?: ((binding: AdeThreadBinding) => void) | undefined;
  readonly onUnbindBinding?: ((binding: AdeThreadBinding) => void) | undefined;
  readonly onOpenMirroredSource?: ((mirrorOfNodeId: OutlineNodeId) => void) | undefined;
}

export function OutlineMetaPortals({
  metaSlotEntries,
  activeById,
  bindingsByNode,
  rolloverDocDatesById,
  onFocusNode,
  onOpenDate,
  onOpenDocument,
  onOpenBinding,
  onMarkBindingRead,
  onUnbindBinding,
  onOpenMirroredSource,
}: OutlineMetaPortalsProps): React.ReactElement {
  const { t } = useInkadeTranslation();

  return (
    <>
      {metaSlotEntries.map(({ nodeId, el }) => {
        const persistedNodeId = nodeId ? asOutlineNodeId(nodeId) : null;
        const node = persistedNodeId ? activeById.get(persistedNodeId) : undefined;
        const nodeBindings = persistedNodeId ? (bindingsByNode.get(persistedNodeId) ?? []) : [];
        const mirroredNode = node?.mirrorOfNodeId
          ? activeById.get(node.mirrorOfNodeId) ?? null
          : null;
        const rolloverDate = node?.rolledOverToDocId
          ? rolloverDocDatesById?.get(node.rolledOverToDocId)
          : undefined;

        return createPortal(
          <div
            className="my-0.5 flex flex-wrap items-center gap-1.5 select-none"
            contentEditable={false}
          >
            {node?.authorType === "agent" && (
              <Badge size="sm" variant="info">
                <BotIcon className="size-3" />
                {t("common.actorAgent")}
              </Badge>
            )}
            {node?.mirrorOfNodeId && (
              <Badge
                className="max-w-xs cursor-pointer gap-1 border-dashed border-teal-500/55 text-teal-700 dark:text-teal-300"
                onClick={() => {
                  if (mirroredNode) {
                    onFocusNode(mirroredNode.id);
                  } else if (node.mirrorOfNodeId) {
                    onOpenMirroredSource?.(node.mirrorOfNodeId);
                  }
                }}
                size="sm"
                title={t("mirrorNode.mirrorBadgeTooltip")}
                variant="outline"
              >
                <RepeatIcon className="size-3 text-teal-600 dark:text-teal-400" />
                <span>{t("mirrorNode.mirrorBadgeLabel")}</span>
                <span aria-hidden="true" className="opacity-50">
                  ·
                </span>
                {mirroredNode ? (
                  <span className="truncate opacity-80">
                    {mirroredNode.contentText || mirroredNode.contentMarkdown}
                  </span>
                ) : (
                  <span className="opacity-80">{t("mirrorNode.openSourceDocLabel")}</span>
                )}
              </Badge>
            )}
            {node?.rolledOverToDocId && (
              <button
                className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 transition-colors hover:bg-amber-500/18 dark:text-amber-300"
                onClick={() => {
                  if (rolloverDate && onOpenDate) {
                    onOpenDate(rolloverDate);
                  } else if (node.rolledOverToDocId && onOpenDocument) {
                    onOpenDocument(node.rolledOverToDocId);
                  }
                }}
                type="button"
              >
                <CalendarArrowUpIcon className="size-3" />
                <span>
                  {rolloverDate
                    ? t("outline.deferredToDateBadge", { date: rolloverDate })
                    : t("daily.rolledOverBadge")}
                </span>
              </button>
            )}
            {nodeBindings.map((binding) => (
              <AdeThreadChip
                binding={binding}
                key={binding.id}
                onMarkRead={onMarkBindingRead}
                onOpenInAde={onOpenBinding}
                onUnbind={onUnbindBinding}
              />
            ))}
          </div>,
          el,
          nodeId,
        );
      })}
    </>
  );
}
