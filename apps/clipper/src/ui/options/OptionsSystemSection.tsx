import { useInkadeTranslation } from "@inkade/i18n";
import { Badge, Button, Card, HoldConfirmButton, Separator } from "@inkade/ui/primitives";
import { RefreshCw, Trash2 } from "lucide-react";
import type { ClipperOfflineQueueItem } from "../../shared/storage.ts";
import { ShortcutsPanel } from "../ShortcutsPanel.tsx";

export interface OptionsSystemSectionProps {
  readonly offlineQueue: readonly ClipperOfflineQueueItem[];
  readonly flushingQueue: boolean;
  readonly busyQueueId: string | null;
  readonly hasValidCredentials: boolean;
  readonly onFlushQueue: () => void;
  readonly onClearQueue: () => void;
  readonly onRetryItem: (id: string) => void;
  readonly onRemoveItem: (id: string) => void;
}

export function OptionsSystemSection({
  offlineQueue,
  flushingQueue,
  busyQueueId,
  hasValidCredentials,
  onFlushQueue,
  onClearQueue,
  onRetryItem,
  onRemoveItem,
}: OptionsSystemSectionProps) {
  const { t } = useInkadeTranslation();

  return (
    <>
      <Card className="gap-3 rounded-lg px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="m-0 text-[13px] font-semibold text-foreground tabular-nums">
            {t("clipper.offlineQueueTitle", { count: offlineQueue.length })}
          </h2>
          <div className="flex items-center gap-2">
            <Button
              disabled={flushingQueue || offlineQueue.length === 0 || !hasValidCredentials}
              onClick={onFlushQueue}
              size="xs"
              variant="outline"
            >
              <RefreshCw className="size-3" />
              <span>{t("clipper.offlineQueueFlushBtn")}</span>
            </Button>
            <HoldConfirmButton disabled={offlineQueue.length === 0} onConfirm={onClearQueue} size="sm">
              <Trash2 className="size-3" />
              <span>{t("clipper.offlineQueueClearBtn")}</span>
            </HoldConfirmButton>
          </div>
        </div>
        {offlineQueue.length > 0 ? (
          offlineQueue.map((item, index) => (
            <div className="flex flex-col gap-1.5" key={item.id}>
              {index > 0 ? <Separator /> : null}
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <strong className="truncate text-xs font-medium text-foreground">
                    {item.label}
                  </strong>
                  {item.lastError ? (
                    <span className="text-[11px] text-muted-foreground">{item.lastError}</span>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Badge size="sm" variant="secondary">
                    {item.kind}
                  </Badge>
                  <Button
                    aria-label={t("common.retry")}
                    disabled={busyQueueId === item.id || !hasValidCredentials}
                    onClick={() => onRetryItem(item.id)}
                    size="icon-xs"
                    title={t("common.retry")}
                    variant="outline"
                  >
                    <RefreshCw className="size-3" />
                  </Button>
                  <Button
                    aria-label={t("common.remove")}
                    disabled={busyQueueId === item.id}
                    onClick={() => onRemoveItem(item.id)}
                    size="icon-xs"
                    title={t("common.remove")}
                    variant="outline"
                  >
                    <Trash2 className="size-3" />
                  </Button>
                </div>
              </div>
            </div>
          ))
        ) : (
          <span className="text-xs text-muted-foreground">{t("clipper.offlineQueueEmpty")}</span>
        )}
      </Card>

      <ShortcutsPanel />
    </>
  );
}
