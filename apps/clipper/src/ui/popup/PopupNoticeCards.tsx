import { useInkadeTranslation } from "@inkade/i18n";
import { Badge, Button, Card, Skeleton } from "@inkade/ui/primitives";
import { ExternalLink, PlugZap, RefreshCw, Settings, ShieldCheck } from "lucide-react";

export interface PopupNoticeCardsProps {
  readonly settingsLoaded: boolean;
  readonly isConfigured: boolean;
  readonly connecting: boolean;
  readonly connectionError: string | null;
  readonly tabRestricted: boolean;
  readonly extractFailed: boolean;
  readonly extracting: boolean;
  readonly hasExtracted: boolean;
  readonly hasActiveTab: boolean;
  readonly activeTabUrl?: string | undefined;
  readonly missingHostPermission: boolean;
  readonly existingDocId?: string | undefined;
  readonly existingHighlightsCount: number;
  readonly onOneClickPair: () => void;
  readonly onOpenOptions: () => void;
  readonly onRetryConnect: () => void;
  readonly onRetryExtract: () => void;
  readonly onGrantHostPerm: () => void;
  readonly onOpenDoc: (docId: string) => void;
}

export function PopupNoticeCards({
  settingsLoaded,
  isConfigured,
  connecting,
  connectionError,
  tabRestricted,
  extractFailed,
  extracting,
  hasExtracted,
  hasActiveTab,
  activeTabUrl,
  missingHostPermission,
  existingDocId,
  existingHighlightsCount,
  onOneClickPair,
  onOpenOptions,
  onRetryConnect,
  onRetryExtract,
  onGrantHostPerm,
  onOpenDoc,
}: PopupNoticeCardsProps) {
  const { t } = useInkadeTranslation();

  return (
    <>
      {settingsLoaded && !isConfigured ? (
        <Card className="gap-2 rounded-lg px-3 py-3">
          <strong className="text-[13px] font-semibold text-foreground">
            {t("clipper.setupPromptTitle")}
          </strong>
          <span className="text-xs text-muted-foreground">{t("clipper.setupPromptDesc")}</span>
          <div className="flex items-center gap-2">
            <Button className="flex-1" onClick={onOneClickPair} size="sm">
              <PlugZap className="size-3.5" />
              <span>{t("clipper.oneClickPairBtn")}</span>
            </Button>
            <Button onClick={onOpenOptions} size="sm" variant="outline">
              <Settings className="size-3.5" />
              <span>{t("clipper.openSettingsBtn")}</span>
            </Button>
          </div>
        </Card>
      ) : null}

      {isConfigured && connectionError && !connecting ? (
        <Card className="gap-2 rounded-lg px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-xs text-destructive-foreground">
              {t("clipper.connectionFailed", { error: connectionError })}
            </span>
            <Button onClick={onRetryConnect} size="xs" variant="outline">
              <RefreshCw className="size-3" />
              <span>{t("common.retry")}</span>
            </Button>
          </div>
        </Card>
      ) : null}

      {tabRestricted ? (
        <Card className="gap-1.5 rounded-lg px-3 py-2.5">
          <span className="text-xs text-muted-foreground">{t("clipper.noActiveTab")}</span>
        </Card>
      ) : null}

      {extractFailed && !tabRestricted && hasActiveTab ? (
        <Card className="gap-2 rounded-lg px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">{t("clipper.extractFailedRetryHint")}</span>
            <Button onClick={onRetryExtract} size="xs" variant="outline">
              <RefreshCw className="size-3" />
              <span>{t("common.retry")}</span>
            </Button>
          </div>
        </Card>
      ) : null}

      {missingHostPermission && activeTabUrl ? (
        <Button onClick={onGrantHostPerm} size="sm" variant="outline">
          <ShieldCheck className="size-3.5" />
          <span>{t("clipper.requestHostPermBtn")}</span>
        </Button>
      ) : null}

      {existingDocId ? (
        <Card className="gap-1.5 rounded-lg px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <Badge className="ink-badge ok tabular-nums" size="sm" variant="outline">
              <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-success" />
              <span>
                {t("clipper.sidePanelStatusClipped", { count: existingHighlightsCount })}
              </span>
            </Badge>
            <Button
              className="h-auto px-1 py-0 text-xs"
              onClick={() => onOpenDoc(existingDocId)}
              size="xs"
              variant="link"
            >
              <span>{t("clipper.openInInkade")}</span>
              <ExternalLink className="size-3" />
            </Button>
          </div>
        </Card>
      ) : null}

      {extracting && !hasExtracted && !tabRestricted && !extractFailed ? (
        <Card className="gap-2.5 rounded-lg px-3 py-3">
          <Skeleton className="h-4 w-3/4 rounded-md" />
          <Skeleton className="h-7 w-full rounded-md" />
          <div className="grid grid-cols-2 gap-2">
            <Skeleton className="h-7 rounded-md" />
            <Skeleton className="h-7 rounded-md" />
          </div>
          <Skeleton className="h-8 w-full rounded-md" />
        </Card>
      ) : null}
    </>
  );
}
