import type { DocumentKind, TokenPermission } from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import { inkadeQueryKeys } from "@inkade/sdk";
import { useInkadeWhoami } from "@inkade/sdk/react";
import { Badge, Button, SpaceIcon, TagPill } from "@inkade/ui";
import { SettingsGroupSkeleton } from "./SettingsSkeletons.tsx";
import { useQueryClient } from "@tanstack/react-query";
import { LogOutIcon, ShieldCheckIcon, UserCheckIcon } from "lucide-react";
import type React from "react";
import { signOutSession } from "../../lib/api.ts";
import {
  DangerZone,
  SettingRow,
  SettingsGroup,
  SettingsSectionHeader,
} from "./SettingRow.tsx";

export function AccountSettings(): React.ReactElement {
  const { t } = useInkadeTranslation();
  const queryClient = useQueryClient();

  const whoamiQuery = useInkadeWhoami();

  const permissionLabels: Readonly<Record<TokenPermission, string>> = {
    read: t("common.permissionRead"),
    append: t("common.permissionAppend"),
    write: t("common.permissionWrite"),
    admin: t("common.permissionAdmin"),
  };

  const kindLabels: Readonly<Record<DocumentKind, string>> = {
    outline: t("common.kindOutline"),
    article: t("common.kindArticle"),
    clip: t("common.kindClip"),
  };

  const handleSignOut = async (): Promise<void> => {
    await signOutSession();
    void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.whoami() });
    void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.bootstrap() });
  };

  const data = whoamiQuery.data;

  return (
    <div className="flex flex-col gap-6">
      <SettingsSectionHeader
        description={t("settings.sectionAccountDesc")}
        title={t("settings.sectionAccountLabel")}
      />

      {whoamiQuery.isPending ? (
        <div className="flex flex-col gap-6">
          <SettingsGroupSkeleton rows={1} showGroupHeader variant="account" />
          <SettingsGroupSkeleton rows={3} showGroupHeader variant="account" />
        </div>
      ) : data ? (
        <>
          <SettingsGroup title={t("settings.principalSectionTitle")}>
            <SettingRow
              badge={
                <Badge size="sm" variant="info">
                  {data.principalKind === "user"
                    ? t("settings.principalUser")
                    : t("settings.principalToken")}
                </Badge>
              }
              description={t("settings.principalSectionDesc")}
              title={
                <span className="inline-flex items-center gap-2">
                  <UserCheckIcon className="size-4 text-primary" />
                  <span>{data.tokenName}</span>
                </span>
              }
            >
              <Badge size="sm" variant="outline">
                <span className="font-mono">{data.workspaceId}</span>
              </Badge>
            </SettingRow>
          </SettingsGroup>

          <SettingsGroup
            description={t("settings.effectivePermissionsDesc")}
            title={t("settings.effectivePermissionsTitle")}
          >
            <SettingRow
              title={
                <span className="inline-flex items-center gap-2">
                  <ShieldCheckIcon className="size-4 text-muted-foreground" />
                  <span>{t("scope.permissionLevel")}</span>
                </span>
              }
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge size="sm" variant="default">
                  {permissionLabels[data.scope.permission]}
                </Badge>
                {data.scope.spaceIds === "*" ? (
                  <Badge size="sm" variant="info">
                    {t("settings.allSpacesWildcard")}
                  </Badge>
                ) : (
                  <Badge size="sm" variant="secondary">
                    {t("settings.visibleSpacesCount", {
                      count: data.visibleSpaces.length,
                    })}
                  </Badge>
                )}
              </div>
            </SettingRow>

            <SettingRow title={t("settings.allowedKindsLabel")}>
              <div className="flex flex-wrap items-center gap-1.5">
                {data.effectiveSummary.allowedKinds ? (
                  data.effectiveSummary.allowedKinds.map((kind) => (
                    <Badge key={kind} size="sm" variant="outline">
                      {kindLabels[kind]}
                    </Badge>
                  ))
                ) : (
                  <Badge size="sm" variant="secondary">
                    {t("scope.allKinds")}
                  </Badge>
                )}
              </div>
            </SettingRow>

            <SettingRow title={t("settings.hardDeletePolicyLabel")}>
              <Badge
                size="sm"
                variant={data.effectiveSummary.denyHardDelete ? "warning" : "secondary"}
              >
                {data.effectiveSummary.denyHardDelete
                  ? t("settings.hardDeleteBlocked")
                  : t("settings.hardDeleteAllowed")}
              </Badge>
            </SettingRow>

            {data.effectiveSummary.tagAllowlist && data.effectiveSummary.tagAllowlist.length > 0 ? (
              <SettingRow layout="vertical" title={t("scope.tagAllowlistOptional")}>
                <div className="flex flex-wrap gap-1.5">
                  {data.effectiveSummary.tagAllowlist.map((tag) => (
                    <TagPill key={tag} tag={tag} />
                  ))}
                </div>
              </SettingRow>
            ) : null}

            <SettingRow
              layout="vertical"
              title={t("settings.visibleSpacesListLabel")}
            >
              <div className="flex flex-wrap gap-1.5">
                {data.visibleSpaces.map((space) => (
                  <span
                    className="inline-flex h-6 items-center gap-1.5 rounded-md border border-border bg-muted/45 px-2 text-xs font-medium"
                    key={space.id}
                  >
                    <SpaceIcon color={space.color} icon={space.icon} size="xs" />
                    <span>{space.name}</span>
                  </span>
                ))}
              </div>
            </SettingRow>
          </SettingsGroup>
        </>
      ) : null}

      <DangerZone description={t("settings.sessionDangerDesc")}>
        <SettingRow
          description={t("settings.signOutDesc")}
          title={t("settings.signOut")}
        >
          <Button
            onClick={() => void handleSignOut()}
            size="sm"
            variant="destructive-outline"
          >
            <LogOutIcon />
            {t("settings.signOut")}
          </Button>
        </SettingRow>
      </DangerZone>
    </div>
  );
}
