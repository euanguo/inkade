import { useInkadeTranslation } from "@inkade/i18n";
import {
  Badge,
  Button,
  Card,
  cn,
  CopyButton,
  Input,
  Separator,
  ThinkingIndicator,
} from "@inkade/ui/primitives";
import { CalendarPlus, CornerDownLeft, ExternalLink, Search } from "lucide-react";
import React from "react";
import { useSidePanelStore, type RelatedHitItem } from "../stores/sidepanel-store.ts";

function renderHighlightedSnippet(snippet: string): React.ReactNode {
  const parts = snippet.split(/(<mark>[\s\S]*?<\/mark>)/gi);
  return parts.map((part, index) => {
    const matched = part.match(/^<mark>([\s\S]*)<\/mark>$/i);
    if (matched) {
      return <mark key={index}>{matched[1]}</mark>;
    }
    return <React.Fragment key={index}>{part}</React.Fragment>;
  });
}

export interface SidePanelRelatedTabProps {
  readonly isConfigured: boolean;
  readonly onSearchSubmit: () => void;
  readonly onAppendDaily: (hit: RelatedHitItem) => void;
  readonly onOpenDoc: (documentId: string) => void;
}

export function SidePanelRelatedTab({
  isConfigured,
  onSearchSubmit,
  onAppendDaily,
  onOpenDoc,
}: SidePanelRelatedTabProps) {
  const { t } = useInkadeTranslation();
  const {
    relatedQuery,
    relatedScope,
    relatedLoading,
    relatedHits,
    selection,
    patch,
  } = useSidePanelStore();

  return (
    <Card className="gap-2.5 rounded-lg px-3 py-3">
      <h2 className="m-0 text-xs font-semibold text-foreground">
        {t("clipper.sidePanelRelatedTitle")}
      </h2>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSearchSubmit();
        }}
      >
        <Input
          className="w-full"
          endAddon={
            <Button
              aria-label={t("clipper.sidePanelTabRelated")}
              disabled={relatedLoading || !isConfigured}
              size="icon-xs"
              title={t("clipper.sidePanelTabRelated")}
              type="submit"
              variant="ghost"
            >
              <CornerDownLeft className="size-3" />
            </Button>
          }
          id="sp-related-query"
          onChange={(e) => patch({ relatedQueryEdited: true, relatedQuery: e.target.value })}
          placeholder={t("clipper.sidePanelRelatedSearchPlaceholder")}
          size="sm"
          startAddon={<Search className="size-3.5" />}
          type="text"
          value={relatedQuery}
        />
      </form>

      <div className="flex flex-wrap items-center gap-1">
        {(["title", "selection", "clips"] as const).map((scope) => {
          const isSelected = relatedScope === scope;
          return (
            <Button
              aria-pressed={isSelected}
              className={cn(
                "h-6 px-2 text-[11px]",
                isSelected
                  ? "border-foreground/30 bg-foreground/8 text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
              disabled={scope === "selection" && !selection?.quote}
              key={scope}
              onClick={() => patch({ relatedQueryEdited: false, relatedScope: scope })}
              size="xs"
              variant="outline"
            >
              <span>
                {scope === "title"
                  ? t("clipper.relatedScopeTitle")
                  : scope === "selection"
                    ? t("clipper.relatedScopeSelection")
                    : t("clipper.relatedScopeClips")}
              </span>
            </Button>
          );
        })}
      </div>

      {relatedLoading ? (
        <ThinkingIndicator label={t("clipper.sidePanelRelatedLoading")} size="sm" />
      ) : relatedHits.length > 0 ? (
        relatedHits.map((hit, index) => (
          <div className="flex flex-col gap-1.5" key={hit.documentId}>
            {index > 0 ? <Separator /> : null}
            <div className="flex items-center justify-between gap-2">
              <strong className="min-w-0 truncate text-[12.5px] font-semibold text-foreground">
                {hit.title}
              </strong>
              {hit.matchSource ? (
                <Badge size="sm" variant="secondary">
                  {hit.matchSource}
                </Badge>
              ) : null}
            </div>
            {hit.snippet ? (
              <p className="ink-search-snippet m-0 text-xs leading-relaxed text-muted-foreground">
                {renderHighlightedSnippet(hit.snippet)}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              <CopyButton
                copiedLabel={t("clipper.sidePanelCopied")}
                label={t("clipper.sidePanelCopyWikilink")}
                showLabel
                size="xs"
                value={`[[${hit.title}]]`}
                variant="outline"
              />
              <Button
                onClick={() => onAppendDaily(hit)}
                size="xs"
                title={t("clipper.sidePanelAppendDailyBtn")}
                variant="outline"
              >
                <CalendarPlus className="size-3" />
                <span>{t("clipper.sidePanelAppendDailyBtn")}</span>
              </Button>
              <Button onClick={() => onOpenDoc(hit.documentId)} size="xs" variant="outline">
                <ExternalLink className="size-3" />
                <span>{t("clipper.openInInkade")}</span>
              </Button>
            </div>
          </div>
        ))
      ) : (
        <span className="text-xs text-muted-foreground">{t("clipper.sidePanelRelatedEmpty")}</span>
      )}
    </Card>
  );
}
