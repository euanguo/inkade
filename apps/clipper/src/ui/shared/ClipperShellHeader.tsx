import { useInkadeTranslation } from "@inkade/i18n";
import { Badge, Button, cn } from "@inkade/ui/primitives";
import { Scissors } from "lucide-react";
import type React from "react";

export interface ClipperShellHeaderProps {
  readonly offlineCount: number;
  readonly flushingOffline: boolean;
  readonly isConfigured: boolean;
  readonly onFlushOffline: () => void;
  readonly connectionBadge?:
    | {
        readonly connected: boolean;
        readonly connecting: boolean;
      }
    | undefined;
  readonly actions?: React.ReactNode | undefined;
}

export function ClipperShellHeader({
  offlineCount,
  flushingOffline,
  isConfigured,
  onFlushOffline,
  connectionBadge,
  actions,
}: ClipperShellHeaderProps) {
  const { t } = useInkadeTranslation();

  return (
    <header className="flex items-center justify-between gap-2 pb-0.5">
      <div className="flex min-w-0 items-center gap-2 font-semibold text-[13.5px] tracking-tight text-foreground">
        <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Scissors className="size-3.5" />
        </span>
        <span className="truncate">{t("clipper.extensionTitle")}</span>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {offlineCount > 0 ? (
          <Button
            className="ink-badge amber h-6 rounded-full px-2 text-[11px] tabular-nums"
            disabled={flushingOffline || !isConfigured}
            onClick={onFlushOffline}
            size="xs"
            title={t("clipper.offlineQueueFlushBtn")}
            variant="outline"
          >
            {t("clipper.offlineQueuedBadge", { count: offlineCount })}
          </Button>
        ) : null}
        {connectionBadge ? (
          <Badge
            className={cn(
              "ink-badge",
              connectionBadge.connected ? "ok" : isConfigured ? "warn" : "amber",
            )}
            size="sm"
            variant="outline"
          >
            <span
              aria-hidden="true"
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                connectionBadge.connecting
                  ? "bg-primary"
                  : connectionBadge.connected
                    ? "bg-success"
                    : isConfigured
                      ? "bg-destructive"
                      : "bg-warning",
              )}
              data-motion-essential={connectionBadge.connecting ? "pulse" : undefined}
            />
            <span>
              {connectionBadge.connecting
                ? t("clipper.connectingBadge")
                : connectionBadge.connected
                  ? t("clipper.connectedBadge")
                  : t("clipper.disconnectedBadge")}
            </span>
          </Badge>
        ) : null}
        {actions}
      </div>
    </header>
  );
}
