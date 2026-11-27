import type { AdeThreadBinding, ThreadBindingId } from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import {
  AdeThreadChip,
  Button,
  CopyButton,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Skeleton,
  TabsPanel,
} from "@inkade/ui";
import { BotIcon, CheckIcon, ExternalLinkIcon } from "lucide-react";
import type React from "react";

export interface InspectorThreadsTabProps {
  readonly isPending: boolean;
  readonly isError: boolean;
  readonly bindings: readonly AdeThreadBinding[];
  readonly onRetry: () => void;
  readonly onMarkRead: (bindingId: ThreadBindingId) => void;
  readonly onOpenInAde: (binding: AdeThreadBinding) => void;
  readonly onUnbind: (bindingId: ThreadBindingId) => void;
}

export function InspectorThreadsTab({
  isPending,
  isError,
  bindings,
  onRetry,
  onMarkRead,
  onOpenInAde,
  onUnbind,
}: InspectorThreadsTabProps): React.ReactElement {
  const { t } = useInkadeTranslation();

  return (
    <TabsPanel value="threads">
      {isPending ? (
        <div aria-busy="true" className="flex flex-col gap-2.5">
          {[0, 1].map((idx) => (
            <div
              className="flex flex-col gap-2 rounded-lg border border-border bg-background p-3"
              key={idx}
            >
              <div className="flex items-center justify-between gap-2">
                <Skeleton className="h-5 w-24 rounded-full" />
                <Skeleton className="size-5 rounded-sm" />
              </div>
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-full" />
            </div>
          ))}
        </div>
      ) : isError ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs">
          <span className="text-destructive-foreground">{t("inspector.loadFailed")}</span>
          <Button onClick={onRetry} size="xs" variant="outline">
            {t("common.retry")}
          </Button>
        </div>
      ) : bindings.length === 0 ? (
        <Empty className="py-10">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BotIcon />
            </EmptyMedia>
            <EmptyTitle>{t("inspector.noThreadsTitle")}</EmptyTitle>
            <EmptyDescription>
              {t("inspector.noThreadsDescPrefix")} <code className="font-mono">/dispatch</code>{" "}
              {t("inspector.noThreadsDescSuffix")}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex flex-col gap-2.5">
          {bindings.map((b) => (
            <div
              className="flex flex-col gap-2 rounded-lg border border-border bg-background p-3 transition-colors hover:border-ring/40"
              key={b.id}
            >
              <div className="flex items-start justify-between gap-1.5">
                <AdeThreadChip
                  binding={b}
                  onMarkRead={(item) => onMarkRead(item.id)}
                  onOpenInAde={onOpenInAde}
                  onUnbind={(item) => onUnbind(item.id)}
                />
                <div className="flex shrink-0 items-center gap-0.5">
                  <CopyButton
                    copiedLabel={t("inspector.copiedThreadId")}
                    label={t("inspector.copyThreadId")}
                    value={b.externalThreadId}
                  />
                  {b.deepLink && (
                    <Button
                      render={<a href={b.deepLink} rel="noreferrer noopener" target="_blank" />}
                      size="icon-xs"
                      variant="ghost"
                    >
                      <ExternalLinkIcon />
                    </Button>
                  )}
                </div>
              </div>
              <p className="text-sm font-medium text-foreground">{b.title}</p>
              {b.selectionAnchor?.quote && (
                <div className="flex items-start justify-between gap-1.5">
                  <blockquote className="line-clamp-2 flex-1 border-l-2 border-primary/40 pl-2 text-xs text-muted-foreground">
                    {b.selectionAnchor.quote}
                  </blockquote>
                  <CopyButton
                    label={t("inspector.copyQuote")}
                    value={b.selectionAnchor.quote}
                  />
                </div>
              )}
              {b.lastSummary && (
                <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">
                  {b.lastSummary}
                </p>
              )}
              {b.unreadResult && (
                <Button
                  className="active:scale-[0.985] transition-[transform,colors]"
                  onClick={() => onMarkRead(b.id)}
                  size="xs"
                  variant="outline"
                >
                  <CheckIcon />
                  {t("inspector.markResultRead")}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </TabsPanel>
  );
}
