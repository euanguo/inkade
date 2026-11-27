import type { AttachmentRecord, ShareLink, ShareLinkId } from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import {
  Badge,
  Button,
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
  CopyButton,
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from "@inkade/ui";
import {
  ChevronDownIcon,
  DownloadIcon,
  ExternalLinkIcon,
  PaperclipIcon,
  Share2Icon,
  Trash2Icon,
} from "lucide-react";
import type React from "react";
import {
  buildAttachmentDownloadUrl,
  buildPublicUrl,
  formatAttachmentSize,
  type ShareExpiryPreset,
} from "./helpers.ts";

export interface InspectorDocumentExtrasProps {
  readonly shareOpen: boolean;
  readonly onShareOpenChange: (open: boolean) => void;
  readonly shareExpiry: ShareExpiryPreset;
  readonly onShareExpiryChange: (preset: ShareExpiryPreset) => void;
  readonly creatingShare: boolean;
  readonly onCreateShare: () => void;
  readonly activeShareLinks: readonly ShareLink[];
  readonly onRevokeShare: (shareLinkId: ShareLinkId) => void;
  readonly attachmentsOpen: boolean;
  readonly onAttachmentsOpenChange: (open: boolean) => void;
  readonly attachmentsPending: boolean;
  readonly attachments: readonly AttachmentRecord[];
  readonly onDownloadAttachment: (
    event: React.MouseEvent<HTMLAnchorElement>,
    att: AttachmentRecord,
  ) => void;
}

export function InspectorDocumentExtras({
  shareOpen,
  onShareOpenChange,
  shareExpiry,
  onShareExpiryChange,
  creatingShare,
  onCreateShare,
  activeShareLinks,
  onRevokeShare,
  attachmentsOpen,
  onAttachmentsOpenChange,
  attachmentsPending,
  attachments,
  onDownloadAttachment,
}: InspectorDocumentExtrasProps): React.ReactElement {
  const { t } = useInkadeTranslation();

  return (
    <>
      {/* Read-Only Share Links Management Card */}
      <Collapsible onOpenChange={onShareOpenChange} open={shareOpen}>
        <div className="rounded-lg border border-border bg-card p-3 text-card-foreground">
          <CollapsibleTrigger className="flex w-full cursor-pointer items-center justify-between gap-2 text-left">
            <span className="flex items-center gap-1.5 text-xs font-semibold">
              <Share2Icon className="size-3.5 text-primary" />
              <span>{t("inspector.shareLinksTitle")}</span>
              {activeShareLinks.length > 0 && (
                <Badge size="sm" variant="success">
                  {activeShareLinks.length}
                </Badge>
              )}
            </span>
            <ChevronDownIcon
              className={`size-3.5 text-muted-foreground transition-transform ${
                shareOpen ? "rotate-180" : ""
              }`}
            />
          </CollapsibleTrigger>

          <CollapsiblePanel>
            <div className="mt-3 flex flex-col gap-2.5 border-t pt-3">
              <div className="flex items-center gap-1.5">
                <Select
                  onValueChange={(v) => onShareExpiryChange(v as ShareExpiryPreset)}
                  value={shareExpiry}
                >
                  <SelectTrigger className="flex-1" size="sm">
                    <SelectValue>
                      {shareExpiry === "24h"
                        ? t("inspector.shareExpiry24h")
                        : shareExpiry === "7d"
                          ? t("inspector.shareExpiry7d")
                          : shareExpiry === "30d"
                            ? t("inspector.shareExpiry30d")
                            : t("inspector.shareExpiryNever")}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup>
                    <SelectItem value="never">{t("inspector.shareExpiryNever")}</SelectItem>
                    <SelectItem value="24h">{t("inspector.shareExpiry24h")}</SelectItem>
                    <SelectItem value="7d">{t("inspector.shareExpiry7d")}</SelectItem>
                    <SelectItem value="30d">{t("inspector.shareExpiry30d")}</SelectItem>
                  </SelectPopup>
                </Select>
                <Button
                  loading={creatingShare}
                  onClick={onCreateShare}
                  size="xs"
                  variant="default"
                >
                  {t("inspector.createShareLink")}
                </Button>
              </div>

              {activeShareLinks.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {t("inspector.noShareLinksDoc")}
                </p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {activeShareLinks.map((link) => {
                    const url = buildPublicUrl(link.token);
                    const isExpired = link.expiresAt
                      ? new Date(link.expiresAt).getTime() <= Date.now()
                      : false;
                    return (
                      <div
                        className="flex items-center justify-between gap-2 rounded-md bg-muted/35 px-2.5 py-2 text-xs"
                        key={link.id}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
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
                          <Button
                            aria-label={t("inspector.revokeShareLink")}
                            onClick={() => onRevokeShare(link.id)}
                            size="icon-xs"
                            variant="ghost"
                          >
                            <Trash2Icon className="text-muted-foreground hover:text-destructive-foreground" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </CollapsiblePanel>
        </div>
      </Collapsible>

      {/* Document Attachments Collapsible Card */}
      <Collapsible onOpenChange={onAttachmentsOpenChange} open={attachmentsOpen}>
        <div className="rounded-lg border border-border bg-card p-3 text-card-foreground">
          <CollapsibleTrigger className="flex w-full cursor-pointer items-center justify-between gap-2 text-left">
            <span className="flex items-center gap-1.5 text-xs font-semibold">
              <PaperclipIcon className="size-3.5 text-primary" />
              <span>{t("inspector.attachmentsTitle")}</span>
              {attachments.length > 0 && (
                <Badge size="sm" variant="secondary">
                  {attachments.length}
                </Badge>
              )}
            </span>
            <ChevronDownIcon
              className={`size-3.5 text-muted-foreground transition-transform ${
                attachmentsOpen ? "rotate-180" : ""
              }`}
            />
          </CollapsibleTrigger>

          <CollapsiblePanel>
            <div className="mt-3 flex flex-col gap-2 border-t pt-3">
              {attachmentsPending ? (
                <div aria-busy="true" className="flex flex-col gap-1.5">
                  {[0, 1].map((idx) => (
                    <div
                      className="flex items-center justify-between gap-2 rounded-md bg-muted/35 px-2.5 py-2"
                      key={idx}
                    >
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <Skeleton className="h-3.5 w-32" />
                        <div className="flex items-center gap-1.5">
                          <Skeleton className="h-3 w-12" />
                          <Skeleton className="h-4 w-16 rounded-full" />
                        </div>
                      </div>
                      <Skeleton className="size-6 shrink-0 rounded-md" />
                    </div>
                  ))}
                </div>
              ) : attachments.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {t("inspector.noAttachmentsDoc")}
                </p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {attachments.map((att) => (
                    <div
                      className="flex items-center justify-between gap-2 rounded-md bg-muted/35 px-2.5 py-2 text-xs"
                      key={att.id}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-foreground" title={att.filename}>
                          {att.filename}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                            {formatAttachmentSize(att.byteSize)}
                          </span>
                          <Badge
                            className="max-w-32 truncate font-mono"
                            size="sm"
                            variant="outline"
                          >
                            {att.mimeType}
                          </Badge>
                        </div>
                      </div>
                      <Button
                        aria-label={t("inspector.downloadAttachment", {
                          filename: att.filename,
                        })}
                        render={
                          <a
                            download={att.filename}
                            href={buildAttachmentDownloadUrl(att.id)}
                            onClick={(event) => onDownloadAttachment(event, att)}
                            rel="noreferrer noopener"
                            target="_blank"
                          />
                        }
                        size="icon-xs"
                        title={t("inspector.downloadAttachment", {
                          filename: att.filename,
                        })}
                        variant="ghost"
                      >
                        <DownloadIcon />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CollapsiblePanel>
        </div>
      </Collapsible>
    </>
  );
}
