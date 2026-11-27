import { useInkadeTranslation } from "@inkade/i18n";
import {
  AdePlatformBadge,
  Badge,
  Button,
  Card,
  Checkbox,
  cn,
  Field,
  FieldLabel,
  Kbd,
  Separator,
  Textarea,
} from "@inkade/ui/primitives";
import { Send } from "lucide-react";
import { HostKindPicker } from "../HostKindPicker.tsx";
import { getAdeHostLabel, getThreadStatusLabel } from "../shared/clipper-ui-helpers.ts";
import { useSidePanelStore } from "../stores/sidepanel-store.ts";

export interface SidePanelAdeTabProps {
  readonly isConfigured: boolean;
  readonly onDispatchAde: () => void;
  readonly onOpenDoc: (documentId: string) => void;
}

export function SidePanelAdeTab({
  isConfigured,
  onDispatchAde,
  onOpenDoc,
}: SidePanelAdeTabProps) {
  const { t } = useInkadeTranslation();
  const {
    adeKind,
    adePrompt,
    adeIncludeSelection,
    adeAppendDaily,
    adeSubmitting,
    selection,
    extracted,
    activeTab,
    lookup,
    setField,
  } = useSidePanelStore();

  const presetPrompts: readonly string[] = [
    t("clipper.adePresetSummarize"),
    t("clipper.adePresetFactCheck"),
    t("clipper.adePresetArchitecture"),
    t("clipper.adePresetCompare"),
  ];

  const adeKindLabel = getAdeHostLabel(t, adeKind);

  return (
    <>
      <Card className="gap-2.5 rounded-lg px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="m-0 text-xs font-semibold text-foreground">
            {t("clipper.sidePanelAdeTitle")}
          </h2>
          <AdePlatformBadge kind={adeKind} label={adeKindLabel} size="sm" />
        </div>
        <Field className="w-full min-w-0">
          <FieldLabel className="text-[11.5px] text-muted-foreground" htmlFor="sp-ade-host">
            {t("clipper.sidePanelAdeHostLabel")}
          </FieldLabel>
          <HostKindPicker
            customInputId="sp-ade-custom-host"
            id="sp-ade-host"
            onChange={(val) => setField("adeKind", val)}
            value={adeKind}
          />
        </Field>

        <div className="flex flex-wrap items-center gap-1.5">
          {presetPrompts.map((preset) => {
            const isSelected = adePrompt.trim() === preset;
            return (
              <Button
                aria-pressed={isSelected}
                className={cn(
                  isSelected
                    ? "border-foreground/30 bg-foreground/8 text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
                key={preset}
                onClick={() => setField("adePrompt", preset)}
                size="xs"
                variant="outline"
              >
                <span>{preset}</span>
              </Button>
            );
          })}
        </div>

        <Field className="w-full min-w-0">
          <FieldLabel className="text-[11.5px] text-muted-foreground" htmlFor="sp-ade-prompt">
            {t("clipper.sidePanelAdePromptLabel")}
          </FieldLabel>
          <Textarea
            className="min-h-16 w-full"
            id="sp-ade-prompt"
            onChange={(e) => setField("adePrompt", e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                onDispatchAde();
              }
            }}
            placeholder={t("clipper.sidePanelAdePromptPlaceholder")}
            size="sm"
            value={adePrompt}
          />
        </Field>

        {selection ? (
          <label className="flex cursor-pointer items-center gap-2 text-xs text-foreground">
            <Checkbox
              checked={adeIncludeSelection}
              onCheckedChange={(checked) => setField("adeIncludeSelection", Boolean(checked))}
            />
            <span>{t("clipper.sidePanelAdeIncludeSelection")}</span>
          </label>
        ) : null}

        <label className="flex cursor-pointer items-center gap-2 text-xs text-foreground">
          <Checkbox
            checked={adeAppendDaily}
            onCheckedChange={(checked) => setField("adeAppendDaily", Boolean(checked))}
          />
          <span>{t("clipper.appendDailyToggle")}</span>
        </label>

        <Button
          disabled={!isConfigured || adeSubmitting || (!extracted && !activeTab?.url)}
          onClick={onDispatchAde}
          size="sm"
        >
          <Send className="size-3.5" />
          <span>
            {adeSubmitting ? t("clipper.sidePanelAdeDispatching") : t("clipper.sidePanelAdeSubmitBtn")}
          </span>
          {!adeSubmitting ? <Kbd aria-hidden="true">⌘⏎</Kbd> : null}
        </Button>
      </Card>

      <Card className="gap-2.5 rounded-lg px-3 py-3">
        <h2 className="m-0 text-xs font-semibold text-foreground tabular-nums">
          {t("clipper.sidePanelAdeBindingsTitle", {
            count: lookup?.threadBindings.length ?? 0,
          })}
        </h2>
        {lookup && lookup.threadBindings.length > 0 ? (
          lookup.threadBindings.map((binding, index) => (
            <div className="flex flex-col gap-1.5" key={binding.id}>
              {index > 0 ? <Separator /> : null}
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <strong className="truncate text-xs font-medium text-foreground">
                    {binding.title || binding.externalThreadId}
                  </strong>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <AdePlatformBadge
                      kind={binding.adeKind}
                      label={getAdeHostLabel(t, binding.adeKind)}
                      size="sm"
                    />
                    <Badge size="sm" variant="outline">
                      {getThreadStatusLabel(t, binding.status)}
                    </Badge>
                  </div>
                  {binding.lastSummary ? (
                    <p className="m-0 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                      {binding.lastSummary}
                    </p>
                  ) : null}
                </div>
                <Button
                  className="h-auto shrink-0 px-1 py-0 text-xs"
                  onClick={() => onOpenDoc(binding.documentId)}
                  size="xs"
                  variant="link"
                >
                  {t("clipper.openInInkade")}
                </Button>
              </div>
            </div>
          ))
        ) : (
          <span className="text-xs text-muted-foreground">{t("clipper.sidePanelAdeNoBindings")}</span>
        )}
      </Card>
    </>
  );
}
