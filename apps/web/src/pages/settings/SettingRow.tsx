import { useInkadeTranslation } from "@inkade/i18n";
import { cn } from "@inkade/ui";
import { AlertTriangleIcon } from "lucide-react";
import type React from "react";

export interface SettingsSectionHeaderProps {
  readonly title: string;
  readonly description?: React.ReactNode | undefined;
  readonly actions?: React.ReactNode | undefined;
}

export function SettingsSectionHeader({
  title,
  description,
  actions,
}: SettingsSectionHeaderProps): React.ReactElement {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
      <div className="min-w-0 flex-1 space-y-1">
        <h1 className="font-heading text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
          {title}
        </h1>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export interface SettingsGroupProps {
  readonly title?: string | undefined;
  readonly description?: string | undefined;
  readonly children: React.ReactNode;
  readonly className?: string | undefined;
}

export function SettingsGroup({
  title,
  description,
  children,
  className,
}: SettingsGroupProps): React.ReactElement {
  return (
    <section className="flex flex-col gap-2.5">
      {title || description ? (
        <div className="space-y-0.5 px-0.5">
          {title ? (
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {title}
            </h2>
          ) : null}
          {description ? (
            <p className="text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
      ) : null}
      <div
        className={cn(
          "divide-y divide-border rounded-lg border border-border bg-card text-card-foreground",
          className,
        )}
      >
        {children}
      </div>
    </section>
  );
}

export interface SettingRowProps {
  readonly title: React.ReactNode;
  readonly description?: React.ReactNode | undefined;
  readonly badge?: React.ReactNode | undefined;
  readonly children?: React.ReactNode | undefined;
  readonly layout?: "horizontal" | "vertical" | undefined;
  readonly className?: string | undefined;
}

export function SettingRow({
  title,
  description,
  badge,
  children,
  layout = "horizontal",
  className,
}: SettingRowProps): React.ReactElement {
  if (layout === "vertical") {
    return (
      <div className={cn("flex flex-col gap-3.5 px-4 py-4 sm:px-5", className)}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0 space-y-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-foreground">{title}</span>
              {badge}
            </div>
            {description ? (
              <p className="text-xs text-muted-foreground">{description}</p>
            ) : null}
          </div>
        </div>
        {children}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-5",
        className,
      )}
    >
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-foreground">{title}</span>
          {badge}
        </div>
        {description ? (
          <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {children ? <div className="flex shrink-0 items-center gap-2">{children}</div> : null}
    </div>
  );
}

export interface DangerZoneProps {
  readonly title?: string | undefined;
  readonly description?: string | undefined;
  readonly children: React.ReactNode;
  readonly className?: string | undefined;
}

export function DangerZone({
  title,
  description,
  children,
  className,
}: DangerZoneProps): React.ReactElement {
  const { t } = useInkadeTranslation();

  return (
    <section
      className={cn(
        "overflow-hidden rounded-lg border border-destructive/25 bg-destructive/[0.025] dark:border-destructive/30 dark:bg-destructive/[0.05]",
        className,
      )}
    >
      <div className="flex items-start gap-2.5 border-b border-destructive/20 bg-destructive/[0.04] px-4 py-3 sm:px-5">
        <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-destructive-foreground" />
        <div className="min-w-0 space-y-0.5">
          <h2 className="text-sm font-semibold text-destructive-foreground">
            {title ?? t("settings.dangerZoneTitle")}
          </h2>
          <p className="text-xs text-muted-foreground">
            {description ?? t("settings.dangerZoneDesc")}
          </p>
        </div>
      </div>
      <div className="divide-y divide-destructive/15">{children}</div>
    </section>
  );
}
