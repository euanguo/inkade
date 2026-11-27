import { useInkadeTranslation } from "@inkade/i18n";
import { Skeleton } from "@inkade/ui";
import type React from "react";

export function RouteContentFallback(): React.ReactElement {
  const { t } = useInkadeTranslation();

  return (
    <div
      aria-busy="true"
      aria-label={t("common.loading")}
      className="mx-auto flex h-full w-full max-w-5xl flex-col gap-5 px-4 py-5 sm:px-6 sm:py-6"
      role="status"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Skeleton className="h-7 w-40 rounded-md" />
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-20 rounded-md" />
          <Skeleton className="h-8 w-8 rounded-md" />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-8 w-44 rounded-md" />
        <Skeleton className="h-8 w-28 rounded-md" />
        <Skeleton className="h-8 w-24 rounded-md" />
      </div>

      <div className="grid gap-3 pt-1">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-20 w-full rounded-xl" />
      </div>
    </div>
  );
}
