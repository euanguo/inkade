"use client";

import {
  type AdeKind,
  type DocumentKind,
  type HostBadgeTone,
  formatHostDisplayName,
  getHostBadgeTone,
} from "@inkade/core";
import {
  Book,
  BookOpen,
  Bookmark,
  Bug,
  Calendar,
  CheckSquare,
  Code2,
  FileText,
  Hash,
  Lightbulb,
  ListTree,
  type LucideIcon,
  Microscope,
  Sparkles,
} from "lucide-react";
import type React from "react";
import { cn } from "../lib/utils.ts";
import { SPACE_COLOR_PALETTE, type SpaceColorName } from "./space-icon.tsx";

const TAG_HUE_POOL: readonly SpaceColorName[] = [
  "indigo",
  "blue",
  "teal",
  "emerald",
  "amber",
  "orange",
  "rose",
  "pink",
  "violet",
];

export type TagConName =
  | "BookOpen"
  | "Microscope"
  | "Bug"
  | "Lightbulb"
  | "Calendar"
  | "Code2"
  | "Book"
  | "CheckSquare"
  | "Sparkles"
  | "Hash";

const TAG_ICON_COMPONENTS: Readonly<Record<TagConName, LucideIcon>> = {
  BookOpen,
  Microscope,
  Bug,
  Lightbulb,
  Calendar,
  Code2,
  Book,
  CheckSquare,
  Sparkles,
  Hash,
};

const TAGCON_RULES: ReadonlyArray<{
  readonly keywords: readonly string[];
  readonly icon: TagConName;
  readonly preferredColor: SpaceColorName;
}> = [
  { keywords: ["research", "study", "analysis"], icon: "Microscope", preferredColor: "emerald" },
  { keywords: ["paper", "papers", "literature"], icon: "BookOpen", preferredColor: "teal" },
  { keywords: ["bug", "bugs", "fix", "hotfix", "issue"], icon: "Bug", preferredColor: "rose" },
  { keywords: ["idea", "ideas", "brainstorm"], icon: "Lightbulb", preferredColor: "amber" },
  { keywords: ["meeting", "meetings", "sync", "standup"], icon: "Calendar", preferredColor: "blue" },
  { keywords: ["code", "dev", "arch", "architecture", "eng"], icon: "Code2", preferredColor: "indigo" },
  { keywords: ["book", "books", "read", "reading"], icon: "Book", preferredColor: "orange" },
  { keywords: ["todo", "todos", "task", "tasks"], icon: "CheckSquare", preferredColor: "teal" },
  { keywords: ["ai", "agent", "agents", "mcp", "llm"], icon: "Sparkles", preferredColor: "violet" },
];

export function normalizeTagName(tag: string): string {
  return tag.trim().replace(/^#+/, "").toLowerCase();
}

function hashTagString(normalized: string): number {
  let hash = 2166136261;
  for (let i = 0; i < normalized.length; i += 1) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function extractTagSegments(normalized: string): readonly string[] {
  return normalized.split(/[/\-_:.\s]+/).filter(Boolean);
}

/**
 * Resolves the Bear-style semantic mini TagCon icon name for a given tag string.
 */
export function getTagIconName(tag: string): TagConName {
  const normalized = normalizeTagName(tag);
  if (!normalized) return "Hash";
  const segments = extractTagSegments(normalized);

  for (const rule of TAGCON_RULES) {
    for (const seg of segments) {
      if (rule.keywords.includes(seg)) {
        return rule.icon;
      }
    }
    for (const kw of rule.keywords) {
      if (normalized.startsWith(kw)) {
        return rule.icon;
      }
    }
  }
  return "Hash";
}

/**
 * Deterministically maps a tag string to a low-glare pastel hue from the palette.
 */
export function getTagColor(tag: string): SpaceColorName {
  const normalized = normalizeTagName(tag);
  if (!normalized) return "indigo";
  const segments = extractTagSegments(normalized);

  for (const rule of TAGCON_RULES) {
    for (const seg of segments) {
      if (rule.keywords.includes(seg)) {
        return rule.preferredColor;
      }
    }
  }

  const index = hashTagString(normalized) % TAG_HUE_POOL.length;
  return TAG_HUE_POOL[index] ?? "indigo";
}

export interface TagPillProps {
  readonly tag: string;
  readonly count?: number | undefined;
  readonly active?: boolean | undefined;
  readonly tone?: "neutral" | "tinted" | undefined;
  readonly onClick?: (() => void) | undefined;
  readonly size?: "sm" | "md" | undefined;
  readonly className?: string | undefined;
}

/**
 * Calm monochrome-by-default tag pill with optional Bear-style pastel tinting and semantic TagCon icon.
 */
export function TagPill({
  tag,
  count,
  active = false,
  tone = "neutral",
  onClick,
  size = "sm",
  className,
}: TagPillProps): React.ReactElement {
  const cleanLabel = tag.trim().replace(/^#+/, "");
  const colorName = getTagColor(tag);
  const iconName = getTagIconName(tag);
  const token = SPACE_COLOR_PALETTE[colorName];
  const Icon = TAG_ICON_COMPONENTS[iconName];

  const classes = cn(
    "inline-flex max-w-full shrink-0 items-center gap-1 rounded-md border font-medium transition-[transform,background-color,color,border-color] duration-[var(--duration-micro)] ease-[var(--ease-out-strong)]",
    size === "sm" ? "h-5 px-1.5 text-xs" : "h-6 px-2 text-xs",
    tone === "tinted"
      ? cn(
          "inkade-tinted-tag",
          token.chipBg,
          token.chipBorder,
          token.iconText,
          active && "border-current/45! brightness-95 dark:brightness-115",
          onClick && "cursor-pointer active:scale-[0.96] hover:brightness-95 dark:hover:brightness-115",
        )
      : cn(
          active
            ? "border-border bg-foreground/8 text-foreground"
            : "border-border/75 bg-muted/60 text-muted-foreground",
          onClick && "cursor-pointer active:scale-[0.96] hover:bg-muted hover:text-foreground",
        ),
    onClick &&
      "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--border-focus)]",
    className,
  );

  const style =
    tone === "tinted"
      ? ({ "--tag-base": token.oklchBase } as React.CSSProperties)
      : undefined;

  const inner = (
    <>
      <Icon
        aria-hidden="true"
        className={cn("size-3 shrink-0", tone === "tinted" ? "opacity-85" : "opacity-65")}
      />
      <span className="min-w-0 truncate">{cleanLabel}</span>
      {typeof count === "number" ? (
        <span className="ml-0.5 tabular-nums opacity-70">{count}</span>
      ) : null}
    </>
  );

  if (onClick) {
    return (
      <button
        aria-pressed={active}
        className={classes}
        data-active={active ? "true" : undefined}
        data-slot="tag-pill"
        data-tag-color={colorName}
        data-tag-icon={iconName}
        data-tone={tone}
        onClick={onClick}
        style={style}
        type="button"
      >
        {inner}
      </button>
    );
  }

  return (
    <span
      className={classes}
      data-active={active ? "true" : undefined}
      data-slot="tag-pill"
      data-tag-color={colorName}
      data-tag-icon={iconName}
      data-tone={tone}
      style={style}
    >
      {inner}
    </span>
  );
}

const DOCUMENT_KIND_STYLES: Readonly<
  Record<DocumentKind, { readonly icon: LucideIcon; readonly className: string }>
> = {
  outline: {
    icon: ListTree,
    className: "text-indigo-600 dark:text-indigo-400",
  },
  article: {
    icon: FileText,
    className: "text-amber-600 dark:text-amber-400",
  },
  clip: {
    icon: Bookmark,
    className: "text-teal-600 dark:text-teal-400",
  },
};

export interface DocumentKindIconProps {
  readonly kind: DocumentKind;
  readonly size?: "xs" | "sm" | "md" | undefined;
  readonly className?: string | undefined;
}

export function DocumentKindIcon({
  kind,
  size = "sm",
  className,
}: DocumentKindIconProps): React.ReactElement {
  const entry = DOCUMENT_KIND_STYLES[kind];
  const Icon = entry.icon;
  const sizeClass =
    size === "xs" ? "size-3.5" : size === "md" ? "size-4.5" : "size-4";

  return (
    <Icon
      aria-hidden="true"
      className={cn("shrink-0", sizeClass, entry.className, className)}
      data-kind={kind}
      data-slot="document-kind-icon"
    />
  );
}

export interface HostToneStyle {
  readonly badgeClass: string;
  readonly dotClass: string;
  readonly pillClass: string;
}

export const HOST_TONE_STYLES: Readonly<Record<HostBadgeTone, HostToneStyle>> = {
  blue: {
    badgeClass:
      "border-blue-500/20 bg-blue-500/10 text-blue-700 dark:border-blue-400/25 dark:bg-blue-400/14 dark:text-blue-300",
    dotClass: "bg-blue-500 dark:bg-blue-400",
    pillClass: "bg-blue-500/12 text-blue-700 dark:bg-blue-400/20 dark:text-blue-300",
  },
  emerald: {
    badgeClass:
      "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:border-emerald-400/25 dark:bg-emerald-400/14 dark:text-emerald-300",
    dotClass: "bg-emerald-500 dark:bg-emerald-400",
    pillClass: "bg-emerald-500/12 text-emerald-700 dark:bg-emerald-400/20 dark:text-emerald-300",
  },
  violet: {
    badgeClass:
      "border-violet-500/20 bg-violet-500/10 text-violet-700 dark:border-violet-400/25 dark:bg-violet-400/14 dark:text-violet-300",
    dotClass: "bg-violet-500 dark:bg-violet-400",
    pillClass: "bg-violet-500/12 text-violet-700 dark:bg-violet-400/20 dark:text-violet-300",
  },
  amber: {
    badgeClass:
      "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:border-amber-400/25 dark:bg-amber-400/14 dark:text-amber-300",
    dotClass: "bg-amber-500 dark:bg-amber-400",
    pillClass: "bg-amber-500/12 text-amber-700 dark:bg-amber-400/20 dark:text-amber-300",
  },
  rose: {
    badgeClass:
      "border-rose-500/20 bg-rose-500/10 text-rose-700 dark:border-rose-400/25 dark:bg-rose-400/14 dark:text-rose-300",
    dotClass: "bg-rose-500 dark:bg-rose-400",
    pillClass: "bg-rose-500/12 text-rose-700 dark:bg-rose-400/20 dark:text-rose-300",
  },
  slate: {
    badgeClass:
      "border-slate-500/20 bg-slate-500/10 text-slate-700 dark:border-slate-400/25 dark:bg-slate-400/14 dark:text-slate-300",
    dotClass: "bg-slate-500 dark:bg-slate-400",
    pillClass: "bg-muted text-muted-foreground",
  },
};

export function getHostToneStyle(kind: string | null | undefined): HostToneStyle {
  return HOST_TONE_STYLES[getHostBadgeTone(kind)];
}

export interface AdePlatformBadgeProps {
  readonly kind: AdeKind;
  readonly label?: string | undefined;
  readonly size?: "sm" | "md" | undefined;
  readonly className?: string | undefined;
}

export function AdePlatformBadge({
  kind,
  label,
  size = "sm",
  className,
}: AdePlatformBadgeProps): React.ReactElement {
  const style = getHostToneStyle(kind);
  const resolvedLabel = label ?? formatHostDisplayName(kind);
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border font-medium whitespace-nowrap",
        size === "sm" ? "h-5 px-2 text-xs" : "h-5.5 px-2.5 text-xs",
        style.badgeClass,
        className,
      )}
      data-ade-kind={kind}
      data-slot="ade-platform-badge"
    >
      <span aria-hidden="true" className={cn("size-1.5 rounded-full", style.dotClass)} />
      <span>{resolvedLabel}</span>
    </span>
  );
}
