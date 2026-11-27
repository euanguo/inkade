"use client";

import { GlobeIcon } from "lucide-react";
import * as React from "react";
import { cn } from "../lib/utils.ts";

function extractDomainInitial(domain: string | null | undefined): string | null {
  if (!domain) return null;
  const clean = domain.trim().replace(/^www\./i, "");
  const first = clean.charAt(0).toUpperCase();
  return /^[A-Z0-9]$/.test(first) ? first : null;
}

export interface ClipFaviconProps {
  readonly faviconUrl?: string | null | undefined;
  readonly domain?: string | null | undefined;
  readonly className?: string | undefined;
}

/**
 * Renders a clipped webpage's favicon with automatic graceful fallback to a
 * crisp domain-initial monogram or GlobeIcon when blocked, offline, or broken.
 */
export function ClipFavicon({
  faviconUrl,
  domain,
  className,
}: ClipFaviconProps): React.ReactElement {
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    setFailed(false);
  }, [faviconUrl]);

  if (faviconUrl && !failed) {
    return (
      <img
        alt=""
        aria-hidden="true"
        className={cn("size-4 shrink-0 rounded-sm bg-muted/40 object-contain", className)}
        data-slot="clip-favicon"
        loading="lazy"
        onError={() => setFailed(true)}
        referrerPolicy="no-referrer"
        src={faviconUrl}
      />
    );
  }

  const initial = extractDomainInitial(domain);
  if (initial) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          "inline-flex size-4 shrink-0 items-center justify-center rounded-sm border border-border/70 bg-muted/70 text-[10px] font-semibold uppercase leading-none text-foreground/80",
          className,
        )}
        data-slot="clip-favicon-fallback"
      >
        {initial}
      </span>
    );
  }

  return (
    <GlobeIcon
      aria-hidden="true"
      className={cn("size-3.5 shrink-0 text-teal-600 dark:text-teal-400", className)}
      data-slot="clip-favicon-globe"
    />
  );
}

export interface ClipCoverThumbnailProps {
  readonly coverImageUrl?: string | null | undefined;
  readonly className?: string | undefined;
}

/**
 * Renders an optional 16:9 cover image thumbnail for rich web clip cards,
 * unmounting gracefully on network/referrer error so cards stay crisp.
 */
export function ClipCoverThumbnail({
  coverImageUrl,
  className,
}: ClipCoverThumbnailProps): React.ReactElement | null {
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    setFailed(false);
  }, [coverImageUrl]);

  if (!coverImageUrl || failed) {
    return null;
  }

  return (
    <div
      className={cn(
        "relative w-full overflow-hidden rounded-lg border border-border/60 bg-muted/40 aspect-[16/9]",
        className,
      )}
      data-slot="clip-cover-thumbnail"
    >
      <img
        alt=""
        aria-hidden="true"
        className="size-full object-cover"
        loading="lazy"
        onError={() => setFailed(true)}
        referrerPolicy="no-referrer"
        src={coverImageUrl}
      />
    </div>
  );
}
