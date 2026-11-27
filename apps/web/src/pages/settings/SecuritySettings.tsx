import { useInkadeTranslation } from "@inkade/i18n";
import { useInkadeArtifactRuntimeConfig } from "@inkade/sdk/react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
} from "@inkade/ui";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  LockIcon,
  RefreshCwIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
} from "lucide-react";
import type React from "react";

export function SecuritySettings(): React.ReactElement {
  const { t } = useInkadeTranslation();
  const runtimeQuery = useInkadeArtifactRuntimeConfig();
  const status = runtimeQuery.data;

  const isSameSite = status?.sameSite === true || status?.mode === "same_site";

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            {t("settings.securityPageTitle")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("settings.securityPageSubtitle")}</p>
        </div>

        <Button
          disabled={runtimeQuery.isFetching}
          onClick={() => void runtimeQuery.refetch()}
          size="xs"
          type="button"
          variant="outline"
        >
          <RefreshCwIcon className={runtimeQuery.isFetching ? "animate-spin" : undefined} />
          {t("inkadeArtifact.refreshAction")}
        </Button>
      </div>

      {runtimeQuery.isPending ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-28 w-full rounded-[var(--radius-card)]" />
          <Skeleton className="h-36 w-full rounded-[var(--radius-card)]" />
        </div>
      ) : runtimeQuery.isError || !status ? (
        <Card>
          <CardContent className="flex items-center gap-2 py-6 text-sm text-destructive-foreground">
            <AlertTriangleIcon className="size-4 shrink-0" />
            <span>{t("settings.securityLoadFailed")}</span>
          </CardContent>
        </Card>
      ) : (
        <>
          {isSameSite ? (
            <div
              className="flex items-start gap-3 rounded-[var(--radius-card)] border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-950 dark:text-amber-100"
              data-testid="same-site-security-warning"
              role="alert"
            >
              <ShieldAlertIcon className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" />
              <div className="flex flex-col gap-1">
                <p className="font-semibold">{t("settings.securitySameSiteWarningTitle")}</p>
                <p className="text-xs leading-relaxed opacity-90">
                  {t("settings.securitySameSiteWarningBody")}
                </p>
              </div>
            </div>
          ) : null}

          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  {isSameSite ? (
                    <ShieldAlertIcon className="size-4 text-amber-500" />
                  ) : (
                    <ShieldCheckIcon className="size-4 text-emerald-500" />
                  )}
                  {t("settings.securityStatusHeading")}
                </CardTitle>
                <Badge variant={isSameSite ? "warning" : "success"}>
                  {isSameSite
                    ? t("settings.securityModeSameSiteLabel")
                    : t("settings.securityModeIsolatedLabel")}
                </Badge>
              </div>
              <CardDescription>{t("settings.securityModeIsolatedSummary")}</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                <div className="rounded-lg border border-border/70 bg-muted/25 p-3">
                  <dt className="text-xs font-medium text-muted-foreground">
                    {t("settings.securityAppOriginLabel")}
                  </dt>
                  <dd className="mt-1 font-mono text-xs break-all text-foreground">
                    {status.appOrigin}
                  </dd>
                </div>

                <div className="rounded-lg border border-border/70 bg-muted/25 p-3">
                  <dt className="text-xs font-medium text-muted-foreground">
                    {t("settings.securitySandboxPatternLabel")}
                  </dt>
                  <dd className="mt-1 font-mono text-xs break-all text-foreground">
                    {status.sandboxOriginPattern}
                  </dd>
                </div>

                <div className="rounded-lg border border-border/70 bg-muted/25 p-3">
                  <dt className="text-xs font-medium text-muted-foreground">
                    {t("settings.securityHostCookieLabel")}
                  </dt>
                  <dd className="mt-1 text-xs font-medium text-foreground">
                    {status.hostCookiePrefixEnabled
                      ? t("settings.securityEnabledValue")
                      : t("settings.securityDisabledValue")}
                  </dd>
                </div>

                <div className="rounded-lg border border-border/70 bg-muted/25 p-3">
                  <dt className="text-xs font-medium text-muted-foreground">
                    {t("settings.securityNetworkAllowlistLabel")}
                  </dt>
                  <dd className="mt-1 font-mono text-xs break-all text-foreground">
                    {status.allowedNetworkOrigins.length > 0
                      ? status.allowedNetworkOrigins.join(", ")
                      : t("settings.securityNetworkNoneValue")}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <LockIcon className="size-4 text-primary" />
                {t("settings.securityChecklistHeading")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-2.5 text-sm text-foreground">
                <li className="flex items-start gap-2">
                  <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-emerald-500" />
                  <span>{t("settings.securityCheckCookieStrip")}</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-emerald-500" />
                  <span>{t("settings.securityCheckHostMatch")}</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-emerald-500" />
                  <span>{t("settings.securityCheckCsp")}</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-emerald-500" />
                  <span>{t("settings.securityCheckCapabilities")}</span>
                </li>
              </ul>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
