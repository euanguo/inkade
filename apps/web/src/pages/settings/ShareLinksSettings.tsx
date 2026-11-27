import type { PublicSite, ShareLink } from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import {
  useDeletePublicSiteMutation,
  useInkadeClient,
  useInkadeDocuments,
  useInkadePublicSites,
  useInkadeShareLinks,
  useRevokeShareLinkMutation,
} from "@inkade/sdk/react";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
  Badge,
  Button,
  CopyButton,
} from "@inkade/ui";
import { SettingsGroupSkeleton } from "./SettingsSkeletons.tsx";
import { Link } from "@tanstack/react-router";
import {
  DownloadIcon,
  ExternalLinkIcon,
  GlobeIcon,
  Link2Icon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import type React from "react";
import { useMemo, useState } from "react";
import {
  buildGardenPublicUrl,
  buildGardenRssUrl,
  DigitalGardenDialog,
  triggerUint8ArrayDownload,
} from "../../components/DigitalGardenDialog.tsx";
import { getApiBaseUrl } from "../../lib/api.ts";
import { showErrorToast, showSuccessToast } from "../../lib/undo.ts";
import {
  DangerZone,
  SettingRow,
  SettingsGroup,
  SettingsSectionHeader,
} from "./SettingRow.tsx";

function isLinkExpired(link: ShareLink): boolean {
  if (!link.expiresAt) return false;
  return new Date(link.expiresAt).getTime() <= Date.now();
}

export function ShareLinksSettings(): React.ReactElement {
  const { t } = useInkadeTranslation();
  const client = useInkadeClient();
  const [revokeTarget, setRevokeTarget] = useState<ShareLink | null>(null);
  const [gardenDialogOpen, setGardenDialogOpen] = useState(false);
  const [editingSite, setEditingSite] = useState<PublicSite | null>(null);
  const [exportingSiteId, setExportingSiteId] = useState<string | null>(null);

  const shareLinksQuery = useInkadeShareLinks();
  const publicSitesQuery = useInkadePublicSites();
  const publicSites = useMemo(() => publicSitesQuery.data ?? [], [publicSitesQuery.data]);
  const deleteSiteMutation = useDeletePublicSiteMutation({
    onSuccess: () => showSuccessToast(t("garden.deletedToast")),
    onError: (err) => showErrorToast(t("garden.deleteFailedToast"), err),
  });

  const handleExportSiteZip = async (site: PublicSite) => {
    setExportingSiteId(site.id);
    try {
      const bytes = await client.publicSites.exportZip(site.id);
      triggerUint8ArrayDownload(bytes, `${site.slug}-garden.zip`, "application/zip");
      showSuccessToast(t("garden.exportedToast"));
    } catch (err) {
      showErrorToast(t("garden.exportFailedToast"), err);
    } finally {
      setExportingSiteId(null);
    }
  };

  const docsQuery = useInkadeDocuments({ limit: 300 });

  const docTitleById = useMemo(
    () => new Map((docsQuery.data ?? []).map((doc) => [doc.id, doc.title])),
    [docsQuery.data],
  );

  const links = useMemo(() => shareLinksQuery.data ?? [], [shareLinksQuery.data]);
  const activeLinks = useMemo(
    () => links.filter((link) => link.revokedAt === null && !isLinkExpired(link)),
    [links],
  );

  const revokeMutation = useRevokeShareLinkMutation({
    onSuccess: () => {
      setRevokeTarget(null);
      showSuccessToast(t("settings.shareLinkRevoked"));
    },
    onError: (err) => showErrorToast(t("settings.shareLinkRevokeFailed"), err),
  });

  const baseUrl = getApiBaseUrl();

  const buildPublicShareUrl = (token: string): string => {
    const path = `/api/v1/public/shares/${encodeURIComponent(token)}`;
    return baseUrl ? `${baseUrl}${path}` : path;
  };

  return (
    <div className="flex flex-col gap-6">
      <SettingsSectionHeader
        description={t("settings.shareLinksDesc")}
        title={t("settings.shareLinksTitle")}
      />

      {shareLinksQuery.isPending ? (
        <SettingsGroupSkeleton rows={3} variant="share" />
      ) : links.length === 0 ? (
        <div className="rounded-xl border border-dashed py-10 text-center text-xs text-muted-foreground">
          {t("settings.noShareLinks")}
        </div>
      ) : (
        <SettingsGroup>
          {links.map((link) => {
            const revoked = link.revokedAt !== null;
            const expired = !revoked && isLinkExpired(link);
            const docTitle = docTitleById.get(link.documentId) ?? link.documentId;
            const shareUrl = buildPublicShareUrl(link.token);

            return (
              <div
                className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-5 ${
                  revoked || expired ? "opacity-60" : ""
                }`}
                key={link.id}
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link2Icon className="size-3.5 text-muted-foreground" />
                    <Link
                      className="truncate text-sm font-medium text-foreground hover:underline"
                      params={{ docId: link.documentId }}
                      to="/docs/$docId"
                    >
                      {docTitle}
                    </Link>
                    {revoked ? (
                      <Badge size="sm" variant="error">
                        {t("common.revoked")}
                      </Badge>
                    ) : expired ? (
                      <Badge size="sm" variant="warning">
                        {t("settings.shareLinkExpired")}
                      </Badge>
                    ) : (
                      <Badge size="sm" variant="success">
                        {t("settings.shareLinkActive")}
                      </Badge>
                    )}
                  </div>
                  <p className="font-mono text-[11px] text-muted-foreground">
                    {t("settings.createdAt", { date: link.createdAt.slice(0, 10) })}
                    {" · "}
                    {revoked && link.revokedAt
                      ? t("settings.shareLinkRevokedAt", {
                          time: link.revokedAt.slice(0, 16).replace("T", " "),
                        })
                      : link.expiresAt
                        ? t("settings.shareLinkExpiresAt", {
                            time: link.expiresAt.slice(0, 16).replace("T", " "),
                          })
                        : t("settings.shareLinkNeverExpires")}
                  </p>
                </div>

                {!revoked && !expired ? (
                  <CopyButton
                    label={t("settings.copyShareUrl")}
                    showLabel
                    size="xs"
                    value={shareUrl}
                    variant="outline"
                  />
                ) : null}
              </div>
            );
          })}
        </SettingsGroup>
      )}

      {activeLinks.length > 0 ? (
        <DangerZone
          description={t("settings.revokeShareZoneDesc")}
          title={t("settings.revokeShareZoneTitle")}
        >
          {activeLinks.map((link) => {
            const docTitle = docTitleById.get(link.documentId) ?? link.documentId;
            return (
              <SettingRow
                description={
                  <span className="font-mono">
                    {link.expiresAt
                      ? t("settings.shareLinkExpiresAt", {
                          time: link.expiresAt.slice(0, 16).replace("T", " "),
                        })
                      : t("settings.shareLinkNeverExpires")}
                  </span>
                }
                key={link.id}
                title={docTitle}
              >
                <Button
                  onClick={() => setRevokeTarget(link)}
                  size="xs"
                  variant="destructive-outline"
                >
                  {t("settings.revoke")}
                </Button>
              </SettingRow>
            );
          })}
        </DangerZone>
      ) : null}

      <section className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2 px-0.5">
          <div className="space-y-0.5">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t("garden.sectionTitle")}
            </h2>
            <p className="text-xs text-muted-foreground">{t("garden.sectionDesc")}</p>
          </div>
          <Button
            onClick={() => {
              setEditingSite(null);
              setGardenDialogOpen(true);
            }}
            size="xs"
            variant="outline"
          >
            <PlusIcon />
            <span>{t("garden.createButton")}</span>
          </Button>
        </div>

        <SettingsGroup>
          {publicSitesQuery.isPending ? (
            <SettingsGroupSkeleton rows={2} variant="share" />
        ) : publicSites.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-muted-foreground">
            {t("garden.emptyList")}
          </div>
        ) : (
          publicSites.map((site) => (
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3" key={site.id}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <GlobeIcon className="size-3.5 text-primary" />
                  <span className="truncate text-sm font-medium text-foreground">{site.title}</span>
                  <Badge size="sm" variant={site.enabled ? "default" : "outline"}>
                    {site.enabled ? t("garden.statusLive") : t("garden.statusPaused")}
                  </Badge>
                  <Badge size="sm" variant="secondary">
                    {site.sourceType === "space"
                      ? t("garden.sourceSpace")
                      : t("garden.sourceSavedView")}
                  </Badge>
                </div>
                <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                  {`/site/${site.slug}`}
                  {site.subtitle ? ` · ${site.subtitle}` : ""}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <CopyButton
                  label={t("garden.copyUrlButton")}
                  showLabel
                  size="xs"
                  value={buildGardenPublicUrl(site.slug)}
                  variant="outline"
                />
                {site.enableRss ? (
                  <CopyButton
                    label={t("garden.copyRssButton")}
                    showLabel
                    size="xs"
                    value={buildGardenRssUrl(site.slug)}
                    variant="outline"
                  />
                ) : null}
                <Button
                  onClick={() =>
                    window.open(buildGardenPublicUrl(site.slug), "_blank", "noopener,noreferrer")
                  }
                  size="xs"
                  variant="ghost"
                >
                  <ExternalLinkIcon />
                  <span>{t("garden.openPublicButton")}</span>
                </Button>
                <Button
                  loading={exportingSiteId === site.id}
                  onClick={() => void handleExportSiteZip(site)}
                  size="xs"
                  variant="secondary"
                >
                  <DownloadIcon />
                  <span>{t("garden.exportZipButton")}</span>
                </Button>
                <Button
                  onClick={() => {
                    setEditingSite(site);
                    setGardenDialogOpen(true);
                  }}
                  size="xs"
                  variant="ghost"
                >
                  <PencilIcon />
                  <span>{t("garden.editButton")}</span>
                </Button>
                <Button
                  loading={deleteSiteMutation.isPending}
                  onClick={() => deleteSiteMutation.mutate(site.id)}
                  size="xs"
                  variant="destructive-outline"
                >
                  <Trash2Icon />
                  <span>{t("garden.deleteButton")}</span>
                </Button>
              </div>
            </div>
          ))
        )}
        </SettingsGroup>
      </section>

      <DigitalGardenDialog
        initialSite={editingSite}
        onOpenChange={setGardenDialogOpen}
        open={gardenDialogOpen}
      />

      <AlertDialog
        onOpenChange={(open) => {
          if (!open) setRevokeTarget(null);
        }}
        open={Boolean(revokeTarget)}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("settings.revokeShareConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("settings.revokeShareConfirmDesc", {
                title: revokeTarget
                  ? (docTitleById.get(revokeTarget.documentId) ?? revokeTarget.documentId)
                  : "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>
              {t("common.cancel")}
            </AlertDialogClose>
            <Button
              loading={revokeMutation.isPending}
              onClick={() => {
                if (revokeTarget) revokeMutation.mutate(revokeTarget.id);
              }}
              variant="destructive"
            >
              {t("settings.confirmRevoke")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </div>
  );
}
