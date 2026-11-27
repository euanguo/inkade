import { useInkadeTranslation } from "@inkade/i18n";
import { Button, Card, Field, FieldLabel, Kbd, Separator, Textarea } from "@inkade/ui/primitives";
import { Highlighter } from "lucide-react";
import { HighlightColorSelector } from "../shared/HighlightColorSelector.tsx";
import { HIGHLIGHT_SWATCH_CSS } from "../shared/clipper-ui-helpers.ts";
import { usePopupStore } from "../stores/popup-store.ts";

export interface PopupHighlightFormProps {
  readonly isConfigured: boolean;
  readonly onSyncHighlight: () => void;
  readonly onClipSelectionOnly: () => void;
}

export function PopupHighlightForm({
  isConfigured,
  onSyncHighlight,
  onClipSelectionOnly,
}: PopupHighlightFormProps) {
  const { t } = useInkadeTranslation();
  const { selection, highlightColor, highlightNote, submittingHighlight, setField } = usePopupStore();
  if (!selection) return null;

  return (
    <Card className="gap-2.5 rounded-lg px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-muted-foreground">
          <Highlighter className="size-3" />
          <span>{t("clipper.selectionHeading")}</span>
        </span>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {t("clipper.regionPickerWords", { count: selection.quote.length })}
        </span>
      </div>

      <div className="ink-quote-preview" title={t("clipper.selectionQuoteLabel")}>
        <span
          aria-hidden="true"
          className="mt-1.5 size-1.5 shrink-0 rounded-full"
          style={{ background: HIGHLIGHT_SWATCH_CSS[highlightColor] }}
        />
        <span className="min-w-0 flex-1">{selection.quote}</span>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[11.5px] font-medium text-muted-foreground">
          {t("clipper.highlightColorLabel")}
        </span>
        <HighlightColorSelector
          onChange={(color) => setField("highlightColor", color)}
          value={highlightColor}
        />
      </div>

      <Separator />

      <Field className="w-full min-w-0">
        <FieldLabel className="text-[11.5px] text-muted-foreground" htmlFor="highlight-note">
          {t("clipper.highlightNoteLabel")}
        </FieldLabel>
        <Textarea
          autoFocus
          className="min-h-14 w-full"
          id="highlight-note"
          onChange={(e) => setField("highlightNote", e.target.value)}
          placeholder={t("clipper.highlightNotePlaceholder")}
          size="sm"
          value={highlightNote}
        />
      </Field>

      <div className="flex items-center gap-2">
        <Button
          className="flex-1"
          disabled={!isConfigured || submittingHighlight}
          onClick={onSyncHighlight}
          size="sm"
        >
          <Highlighter className="size-3.5" />
          <span>
            {submittingHighlight ? t("clipper.syncingHighlight") : t("clipper.syncHighlightBtn")}
          </span>
          {!submittingHighlight ? <Kbd aria-hidden="true">⌘⏎</Kbd> : null}
        </Button>
        <Button
          disabled={!isConfigured || submittingHighlight}
          onClick={onClipSelectionOnly}
          size="sm"
          variant="outline"
        >
          <span>{t("clipper.clipSelectionOnlyBtn")}</span>
        </Button>
      </div>
    </Card>
  );
}
