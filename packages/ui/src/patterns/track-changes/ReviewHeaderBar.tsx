"use client";

import { useInkadeTranslation } from "@inkade/i18n";
import {
  CheckCheckIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  RotateCcwIcon,
  SparklesIcon,
  Undo2Icon,
  XIcon,
} from "lucide-react";
import type React from "react";
import { Badge } from "../../primitives/badge.tsx";
import { Button } from "../../primitives/button.tsx";
import { Kbd } from "../../primitives/kbd.tsx";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "../../primitives/segmented-control.tsx";

export interface ReviewHeaderBarProps {
  readonly oldLabel?: string | undefined;
  readonly newLabel?: string | undefined;
  readonly hunksCount: number;
  readonly pendingCount: number;
  readonly hasHistory: boolean;
  readonly applying: boolean;
  readonly hasApplyHandler: boolean;
  readonly queuePosition?: number | undefined;
  readonly queueTotal?: number | undefined;
  readonly onPrevDocument?: (() => void) | undefined;
  readonly onNextDocument?: (() => void) | undefined;
  readonly onUndo: () => void;
  readonly onSwitchToCodeDiff?: (() => void) | undefined;
  readonly onAcceptAll: () => void;
  readonly onRejectAll: () => void;
  readonly onApply: () => void;
  readonly onClose?: (() => void) | undefined;
}

export function ReviewHeaderBar({
  oldLabel,
  newLabel,
  hunksCount,
  pendingCount,
  hasHistory,
  applying,
  hasApplyHandler,
  queuePosition,
  queueTotal,
  onPrevDocument,
  onNextDocument,
  onUndo,
  onSwitchToCodeDiff,
  onAcceptAll,
  onRejectAll,
  onApply,
  onClose,
}: ReviewHeaderBarProps): React.ReactElement {
  const { t } = useInkadeTranslation();

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge size="sm" variant="info">
          <SparklesIcon className="size-3" />
          {t("reader.inlineSuggestions")}
        </Badge>
        {oldLabel && newLabel && (
          <span className="font-mono text-muted-foreground">
            {oldLabel} → {newLabel}
          </span>
        )}
        <span className="text-muted-foreground">
          {t("reader.hunkChangesSummary", { count: hunksCount })}
        </span>
        {pendingCount > 0 && (
          <Badge size="sm" variant="warning">
            {t("reader.pendingCount", { count: pendingCount })}
          </Badge>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {queueTotal !== undefined && queueTotal > 1 && queuePosition !== undefined && (
          <div className="flex items-center gap-1">
            <Badge className="tabular-nums" size="sm" variant="outline">
              {t("reviewCenter.docQueueCounter", {
                current: queuePosition,
                total: queueTotal,
              })}
            </Badge>
            {onPrevDocument && (
              <Button
                aria-label={t("reviewCenter.prevDocument")}
                disabled={queuePosition <= 1}
                onClick={onPrevDocument}
                size="icon-xs"
                variant="ghost"
              >
                <ChevronLeftIcon />
              </Button>
            )}
            {onNextDocument && (
              <Button
                aria-label={t("reviewCenter.nextDocument")}
                disabled={queuePosition >= queueTotal}
                onClick={onNextDocument}
                size="icon-xs"
                variant="ghost"
              >
                <ChevronRightIcon />
              </Button>
            )}
          </div>
        )}

        {hasHistory && (
          <Button onClick={onUndo} size="xs" variant="ghost">
            <Undo2Icon />
            {t("reviewCenter.undoHunkAction")}
          </Button>
        )}

        {onSwitchToCodeDiff && (
          <SegmentedControl size="sm">
            <SegmentedControlItem data-pressed="">
              {t("reader.inlineSuggestions")}
            </SegmentedControlItem>
            <SegmentedControlItem onClick={onSwitchToCodeDiff}>
              {t("reader.codeDiffView")}
            </SegmentedControlItem>
          </SegmentedControl>
        )}

        {hunksCount > 0 && (
          <>
            <Button onClick={onAcceptAll} size="xs" variant="outline">
              <CheckCheckIcon />
              {t("reader.acceptAll")}
            </Button>
            <Button onClick={onRejectAll} size="xs" variant="ghost">
              <RotateCcwIcon />
              {t("reader.rejectAll")}
            </Button>
          </>
        )}

        {hasApplyHandler && hunksCount > 0 && (
          <Button
            loading={applying}
            onClick={onApply}
            size="xs"
            variant="default"
          >
            <CheckIcon />
            {t("reader.applyResolved")}
          </Button>
        )}

        {onClose && (
          <Button
            aria-label={t("diff.closeComparison")}
            onClick={onClose}
            size="icon-xs"
            variant="ghost"
          >
            <XIcon />
          </Button>
        )}
      </div>
    </div>
  );
}

export function ReviewKeyboardLegend({
  navigationKeys,
}: {
  readonly navigationKeys: "jk" | "brackets";
}): React.ReactElement {
  const { t } = useInkadeTranslation();

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/35 px-4 py-2 text-[11px] text-muted-foreground"
      data-slot="inline-review-keyboard-legend"
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-1">
          <Kbd>{navigationKeys === "brackets" ? "[" : "J"}</Kbd>
          <Kbd>{navigationKeys === "brackets" ? "]" : "K"}</Kbd>
          <span>{t("reviewCenter.legendNavigate")}</span>
        </span>
        <span className="inline-flex items-center gap-1">
          <Kbd>Y</Kbd>
          <span>{t("reviewCenter.legendAccept")}</span>
        </span>
        <span className="inline-flex items-center gap-1">
          <Kbd>N</Kbd>
          <span>{t("reviewCenter.legendReject")}</span>
        </span>
        <span className="inline-flex items-center gap-1">
          <Kbd>Z</Kbd>
          <span>{t("reviewCenter.legendUndo")}</span>
        </span>
      </div>
    </div>
  );
}
