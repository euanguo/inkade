"use client";

import type { TocEntry } from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import type React from "react";
import { cn } from "../../lib/utils.ts";

export interface ReaderTocRailProps {
  readonly toc: readonly TocEntry[];
  readonly activeSlug: string | null;
  readonly onSelectSlug: (slug: string) => void;
}

export function ReaderTocRail({
  toc,
  activeSlug,
  onSelectSlug,
}: ReaderTocRailProps): React.ReactElement {
  const { t } = useInkadeTranslation();

  return (
    <aside
      aria-label={t("reader.tocAriaLabel")}
      className="sticky top-6 hidden w-56 shrink-0 border-l pl-4 lg:block"
    >
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {t("reader.onThisPage")}
      </p>
      <nav className="flex flex-col gap-1">
        {toc.map((entry) => {
          const isActive = activeSlug === entry.slug;
          return (
            <a
              className={cn(
                "block truncate rounded-md py-1 pr-2 text-xs transition-colors",
                isActive
                  ? "bg-accent/70 font-medium text-primary"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
              )}
              href={`#${entry.slug}`}
              key={`${entry.slug}-${entry.startOffset}`}
              onClick={(e) => {
                e.preventDefault();
                onSelectSlug(entry.slug);
              }}
              style={{ paddingLeft: `${Math.max(0, entry.depth - 1) * 12}px` }}
            >
              {entry.text}
            </a>
          );
        })}
      </nav>
    </aside>
  );
}
