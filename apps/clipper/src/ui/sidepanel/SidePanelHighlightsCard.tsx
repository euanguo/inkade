import type { DocumentHighlight, HighlightColor, HighlightId } from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import { Button, Card, Separator, Textarea } from "@inkade/ui/primitives";
import { MapPin, Trash2 } from "lucide-react";
import { HighlightColorSelector } from "../shared/HighlightColorSelector.tsx";
import { HIGHLIGHT_SWATCH_CSS } from "../shared/clipper-ui-helpers.ts";
import type { NoteSaveState } from "../stores/sidepanel-store.ts";

export interface SidePanelHighlightsCardProps {
  readonly highlights: readonly DocumentHighlight[];
  readonly noteDrafts: Readonly<Record<string, string>>;
  readonly noteSaveStates: Readonly<Record<string, NoteSaveState>>;
  readonly busyHlId: HighlightId | null;
  readonly onUpdateColor: (highlightId: HighlightId, color: HighlightColor) => void;
  readonly onLocate: (highlightId: HighlightId) => void;
  readonly onDelete: (hl: DocumentHighlight) => void;
  readonly onNoteChange: (highlightId: HighlightId, value: string) => void;
  readonly onFlushNoteNow: (highlightId: HighlightId) => void;
}

export function SidePanelHighlightsCard({
  highlights,
  noteDrafts,
  noteSaveStates,
  busyHlId,
  onUpdateColor,
  onLocate,
  onDelete,
  onNoteChange,
  onFlushNoteNow,
}: SidePanelHighlightsCardProps) {
  const { t } = useInkadeTranslation();

  return (
    <Card className="gap-2.5 rounded-lg px-3 py-3">
      <h2 className="m-0 text-xs font-semibold text-foreground tabular-nums">
        {t("clipper.sidePanelHighlightsTitle", { count: highlights.length })}
      </h2>
      {highlights.length > 0 ? (
        highlights.map((hl, index) => {
          const saveState = noteSaveStates[hl.id];
          return (
            <div className="flex flex-col gap-2" key={hl.id}>
              {index > 0 ? <Separator /> : null}
              <div className="ink-quote-preview">
                <span
                  aria-hidden="true"
                  className="mt-1.5 size-1.5 shrink-0 rounded-full"
                  style={{ background: HIGHLIGHT_SWATCH_CSS[hl.color] }}
                />
                <span className="min-w-0 flex-1">{hl.quote}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <HighlightColorSelector
                  disabled={busyHlId === hl.id}
                  onChange={(color) => onUpdateColor(hl.id, color)}
                  value={hl.color}
                  variant="compact"
                />
                <div className="flex items-center gap-1.5">
                  {saveState ? (
                    <span className="text-[10.5px] text-muted-foreground">
                      {saveState === "saving"
                        ? t("clipper.noteSaving")
                        : saveState === "saved"
                          ? t("clipper.noteSaved")
                          : t("clipper.noteDirty")}
                    </span>
                  ) : null}
                  <Button
                    aria-label={t("clipper.sidePanelLocateHighlight")}
                    onClick={() => onLocate(hl.id)}
                    size="icon-xs"
                    title={t("clipper.sidePanelLocateHighlight")}
                    variant="outline"
                  >
                    <MapPin className="size-3" />
                  </Button>
                  <Button
                    aria-label={t("clipper.sidePanelDeleteHighlight")}
                    disabled={busyHlId === hl.id}
                    onClick={() => onDelete(hl)}
                    size="icon-xs"
                    title={t("clipper.sidePanelDeleteHighlight")}
                    variant="destructive-outline"
                  >
                    <Trash2 className="size-3" />
                  </Button>
                </div>
              </div>
              <Textarea
                className="min-h-14"
                onChange={(e) => onNoteChange(hl.id, e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                    e.preventDefault();
                    onFlushNoteNow(hl.id);
                  }
                }}
                placeholder={t("clipper.highlightNotePlaceholder")}
                size="sm"
                value={noteDrafts[hl.id] ?? ""}
              />
            </div>
          );
        })
      ) : (
        <span className="text-xs text-muted-foreground">{t("clipper.sidePanelNoHighlights")}</span>
      )}
    </Card>
  );
}
