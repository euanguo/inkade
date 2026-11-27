import type { DocumentHighlight, HighlightColor, HighlightId } from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import { Badge, Button, Card, Checkbox } from "@inkade/ui/primitives";
import { BookmarkCheck, ExternalLink, Highlighter, Undo2 } from "lucide-react";
import { SpaceSelectField } from "../shared/SpaceSelectField.tsx";
import { useSidePanelStore } from "../stores/sidepanel-store.ts";
import { SidePanelHighlightsCard } from "./SidePanelHighlightsCard.tsx";

export interface SidePanelCaptureTabProps {
  readonly isConfigured: boolean;
  readonly onOpenDoc: (docId: string) => void;
  readonly onQuickClip: () => void;
  readonly onQuickCreateHighlight: () => void;
  readonly onUndoDeleteHighlight: () => void;
  readonly onUpdateHighlightColor: (highlightId: HighlightId, color: HighlightColor) => void;
  readonly onLocateHighlight: (highlightId: HighlightId) => void;
  readonly onDeleteHighlight: (hl: DocumentHighlight) => void;
  readonly onNoteChange: (highlightId: HighlightId, value: string) => void;
  readonly onFlushNoteNow: (highlightId: HighlightId) => void;
}

export function SidePanelCaptureTab({
  isConfigured,
  onOpenDoc,
  onQuickClip,
  onQuickCreateHighlight,
  onUndoDeleteHighlight,
  onUpdateHighlightColor,
  onLocateHighlight,
  onDeleteHighlight,
  onNoteChange,
  onFlushNoteNow,
}: SidePanelCaptureTabProps) {
  const { t } = useInkadeTranslation();
  const {
    lookup,
    extracted,
    activeTab,
    matchedTemplateName,
    spaces,
    spaceId,
    appendToDaily,
    clipping,
    selection,
    creatingHighlight,
    pendingDeleteHl,
    noteDrafts,
    noteSaveStates,
    busyHlId,
    setField,
  } = useSidePanelStore();

  return (
    <>
      <Card className="gap-2.5 rounded-lg px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          <Badge
            className={lookup?.found ? "ink-badge ok tabular-nums" : "ink-badge"}
            size="sm"
            variant="outline"
          >
            <span
              aria-hidden="true"
              className={`size-1.5 shrink-0 rounded-full ${
                lookup?.found ? "bg-success" : "bg-muted-foreground/50"
              }`}
            />
            <span>
              {lookup?.found
                ? t("clipper.sidePanelStatusClipped", { count: lookup.highlights.length })
                : t("clipper.sidePanelStatusUnclipped")}
            </span>
          </Badge>
          {lookup?.document ? (
            <Button
              className="h-auto px-1 py-0 text-xs"
              onClick={() => onOpenDoc(lookup.document!.id)}
              size="xs"
              variant="link"
            >
              <span>{t("clipper.openInInkade")}</span>
              <ExternalLink className="size-3" />
            </Button>
          ) : null}
        </div>

        {extracted || activeTab?.url ? (
          <>
            <strong className="text-[13px] font-semibold text-foreground">
              {extracted?.title || activeTab?.title || activeTab?.url}
            </strong>
            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
              <span>{extracted?.meta.domain ?? activeTab?.url ?? ""}</span>
              {matchedTemplateName ? (
                <Badge size="sm" variant="secondary">
                  {matchedTemplateName}
                </Badge>
              ) : null}
            </div>

            {spaces.length > 0 ? (
              <SpaceSelectField
                id="sp-space"
                label={t("clipper.spaceLabel")}
                onChange={(val) => setField("spaceId", val)}
                showUnspecifiedLabelWhenEmpty
                spaces={spaces}
                value={spaceId}
              />
            ) : null}

            <label className="flex cursor-pointer items-center gap-2 text-xs text-foreground">
              <Checkbox
                checked={appendToDaily}
                onCheckedChange={(checked) => setField("appendToDaily", Boolean(checked))}
              />
              <span>{t("clipper.appendDailyToggle")}</span>
            </label>

            <Button
              disabled={!isConfigured || !extracted || clipping}
              onClick={onQuickClip}
              size="sm"
            >
              <BookmarkCheck className="size-3.5" />
              <span>
                {clipping
                  ? t("clipper.clippingPage")
                  : lookup?.found
                    ? t("clipper.updateExistingClipBtn")
                    : t("clipper.clipPageBtn")}
              </span>
            </Button>
          </>
        ) : (
          <span className="text-xs text-muted-foreground">{t("clipper.noActiveTab")}</span>
        )}
      </Card>

      {selection && selection.quote.trim().length >= 2 ? (
        <Card className="gap-2 rounded-lg px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-foreground">
              <Highlighter className="size-3" />
              <span>{t("clipper.sidePanelQuickHighlightTitle")}</span>
            </span>
            <Button
              disabled={!isConfigured || creatingHighlight}
              onClick={onQuickCreateHighlight}
              size="xs"
            >
              <span>
                {creatingHighlight
                  ? t("clipper.syncingHighlight")
                  : t("clipper.syncHighlightBtn")}
              </span>
            </Button>
          </div>
          <div className="ink-quote-preview">
            <span
              aria-hidden="true"
              className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary"
            />
            <span className="min-w-0 flex-1">{selection.quote}</span>
          </div>
        </Card>
      ) : null}

      {pendingDeleteHl ? (
        <div className="ink-status">
          <span className="truncate text-xs">{t("clipper.sidePanelDeleteUndoPrompt")}</span>
          <Button onClick={onUndoDeleteHighlight} size="xs" variant="outline">
            <Undo2 className="size-3" />
            <span>{t("common.undo")}</span>
          </Button>
        </div>
      ) : null}

      <SidePanelHighlightsCard
        busyHlId={busyHlId}
        highlights={lookup?.highlights ?? []}
        noteDrafts={noteDrafts}
        noteSaveStates={noteSaveStates}
        onDelete={onDeleteHighlight}
        onFlushNoteNow={onFlushNoteNow}
        onLocate={onLocateHighlight}
        onNoteChange={onNoteChange}
        onUpdateColor={onUpdateHighlightColor}
      />
    </>
  );
}
