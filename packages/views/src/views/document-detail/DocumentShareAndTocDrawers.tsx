import type { ShareLink, ShareLinkId, TocEntry } from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import {
  Badge,
  Button,
  CopyButton,
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  Drawer,
  DrawerHeader,
  DrawerPanel,
  DrawerPopup,
  DrawerTitle,
  Skeleton,
} from "@inkade/ui";
import { ExternalLinkIcon, Trash2Icon } from "lucide-react";
import type React from "react";

export function MobileTocDrawer({
  visible,
  open,
  toc,
  onOpenChange,
  onScrollToHeading,
}: {
  readonly visible: boolean;
  readonly open: boolean;
  readonly toc: readonly TocEntry[];
  readonly onOpenChange: (open: boolean) => void;
  readonly onScrollToHeading: (entry: TocEntry) => void;
}): React.ReactElement | null {
  const { t } = useInkadeTranslation();
  if (!visible || toc.length === 0) return null;

  return (
    <div className="lg:hidden">
      <Drawer onOpenChange={onOpenChange} open={open} position="bottom">
        <DrawerPopup showBar showCloseButton>
          <DrawerHeader>
            <DrawerTitle>{t("document.tocDrawerTitle")}</DrawerTitle>
          </DrawerHeader>
          <DrawerPanel>
            <nav className="flex flex-col gap-1">
              {toc.map((entry) => (
                <button
                  className="cursor-pointer rounded-lg px-2 py-1.5 text-left text-sm hover:bg-accent"
                  key={`${entry.slug}-${entry.startOffset}`}
                  onClick={() => {
                    onOpenChange(false);
                    requestAnimationFrame(() => onScrollToHeading(entry));
                  }}
                  style={{ paddingLeft: `${Math.max(0, entry.depth - 1) * 14 + 8}px` }}
                  type="button"
                >
                  {entry.text}
                </button>
              ))}
            </nav>
          </DrawerPanel>
        </DrawerPopup>
      </Drawer>
    </div>
  );
}

export function DocumentShareDialog({
  open,
  docTitle,
  isPendingLinks,
  creatingLink,
  activeShareLinks,
  buildPublicShareUrl,
  onOpenChange,
  onCreateShareLink,
  onRevokeShareLink,
  revokingShareLinkId,
  onOpenInspector,
}: {
  readonly open: boolean;
  readonly docTitle: string;
  readonly isPendingLinks: boolean;
  readonly creatingLink: boolean;
  readonly activeShareLinks: readonly ShareLink[];
  readonly buildPublicShareUrl: (token: string) => string;
  readonly onOpenChange: (open: boolean) => void;
  readonly onCreateShareLink: () => void;
  readonly onRevokeShareLink?: ((shareLinkId: ShareLinkId) => void) | undefined;
  readonly revokingShareLinkId?: ShareLinkId | null | undefined;
  readonly onOpenInspector: () => void;
}): React.ReactElement {
  const { t } = useInkadeTranslation();

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("document.sharePopoverTitle")}</DialogTitle>
          <DialogDescription>{docTitle}</DialogDescription>
        </DialogHeader>
        <DialogPanel className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <Button
              loading={creatingLink}
              onClick={onCreateShareLink}
              size="xs"
              variant="default"
            >
              {t("document.shareCreateQuick")}
            </Button>
            <Button onClick={onOpenInspector} size="xs" variant="ghost">
              {t("document.shareOpenInspector")}
            </Button>
          </div>
          {isPendingLinks ? (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between rounded-lg border bg-muted/35 px-2.5 py-2">
                <Skeleton className="h-4 w-24 rounded-full" />
                <Skeleton className="size-4 rounded-sm" />
              </div>
              <div className="flex items-center justify-between rounded-lg border bg-muted/35 px-2.5 py-2">
                <Skeleton className="h-4 w-20 rounded-full" />
                <Skeleton className="size-4 rounded-sm" />
              </div>
            </div>
          ) : activeShareLinks.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t("inspector.noShareLinksDoc")}
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {activeShareLinks.slice(0, 5).map((link) => {
                const url = buildPublicShareUrl(link.token);
                const isExpired =
                  Boolean(link.expiresAt) && new Date(link.expiresAt!).getTime() <= Date.now();
                return (
                  <div
                    className="flex flex-col gap-1.5 rounded-lg border bg-muted/35 px-2.5 py-2 text-xs"
                    key={link.id}
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <Badge size="sm" variant={isExpired ? "secondary" : "success"}>
                          {isExpired
                            ? t("inspector.shareExpiredBadge")
                            : t("inspector.shareActiveBadge")}
                        </Badge>
                        <span className="truncate font-mono text-[11px] text-muted-foreground">
                          {link.expiresAt
                            ? link.expiresAt.slice(0, 10)
                            : t("inspector.shareExpiryNever")}
                        </span>
                      </div>
                      <div className="flex shrink-0 items-center gap-0.5">
                        <CopyButton label={t("inspector.copyShareUrl")} value={url} />
                        <Button
                          aria-label={t("inspector.openSharePage")}
                          render={<a href={url} rel="noreferrer noopener" target="_blank" />}
                          size="icon-xs"
                          variant="ghost"
                        >
                          <ExternalLinkIcon />
                        </Button>
                        {onRevokeShareLink && (
                          <Button
                            aria-label={t("inspector.revokeShareLink")}
                            data-testid="revoke-share-link-button"
                            disabled={revokingShareLinkId === link.id}
                            onClick={() => onRevokeShareLink(link.id)}
                            size="icon-xs"
                            title={t("inspector.revokeShareLink")}
                            type="button"
                            variant="ghost"
                          >
                            <Trash2Icon className="text-destructive-foreground" />
                          </Button>
                        )}
                      </div>
                    </div>
                    <code
                      className="block truncate rounded border border-border/50 bg-background/80 px-1.5 py-1 font-mono text-[11px] text-foreground/90 select-all"
                      data-testid="share-link-url"
                      title={url}
                    >
                      {url}
                    </code>
                  </div>
                );
              })}
            </div>
          )}
        </DialogPanel>
        <DialogFooter variant="bare">
          <Button onClick={() => onOpenChange(false)} size="xs" variant="outline">
            {t("common.cancel")}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
