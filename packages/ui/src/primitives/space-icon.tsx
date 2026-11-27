"use client";

import {
  Archive,
  BookOpen,
  Bookmark,
  Briefcase,
  CalendarDays,
  Check,
  Code2,
  Compass,
  Cpu,
  Database,
  FileText,
  FlaskConical,
  Folder,
  FolderKanban,
  Globe,
  Heart,
  Inbox,
  Layers,
  Lightbulb,
  type LucideIcon,
  Rocket,
  Shield,
  Sparkles,
  Star,
  Tag,
  Terminal,
} from "lucide-react";
import type React from "react";
import { cn } from "../lib/utils.ts";

export const SPACE_COLOR_NAMES = [
  "indigo",
  "blue",
  "teal",
  "emerald",
  "amber",
  "orange",
  "rose",
  "pink",
  "violet",
  "slate",
] as const;

export type SpaceColorName = (typeof SPACE_COLOR_NAMES)[number];

export interface SpaceColorToken {
  readonly id: SpaceColorName;
  readonly iconText: string;
  readonly chipBg: string;
  readonly chipBorder: string;
  readonly dotBg: string;
  readonly oklchBase: string;
}

export const SPACE_COLOR_PALETTE: Readonly<Record<SpaceColorName, SpaceColorToken>> = {
  indigo: {
    id: "indigo",
    iconText: "text-indigo-600 dark:text-indigo-400",
    chipBg: "bg-indigo-500/10 dark:bg-indigo-400/14",
    chipBorder: "border-indigo-500/20 dark:border-indigo-400/25",
    dotBg: "bg-indigo-500 dark:bg-indigo-400",
    oklchBase: "oklch(0.60 0.17 272)",
  },
  blue: {
    id: "blue",
    iconText: "text-blue-600 dark:text-blue-400",
    chipBg: "bg-blue-500/10 dark:bg-blue-400/14",
    chipBorder: "border-blue-500/20 dark:border-blue-400/25",
    dotBg: "bg-blue-500 dark:bg-blue-400",
    oklchBase: "oklch(0.62 0.16 250)",
  },
  teal: {
    id: "teal",
    iconText: "text-teal-600 dark:text-teal-400",
    chipBg: "bg-teal-500/10 dark:bg-teal-400/14",
    chipBorder: "border-teal-500/20 dark:border-teal-400/25",
    dotBg: "bg-teal-500 dark:bg-teal-400",
    oklchBase: "oklch(0.66 0.12 185)",
  },
  emerald: {
    id: "emerald",
    iconText: "text-emerald-600 dark:text-emerald-400",
    chipBg: "bg-emerald-500/10 dark:bg-emerald-400/14",
    chipBorder: "border-emerald-500/20 dark:border-emerald-400/25",
    dotBg: "bg-emerald-500 dark:bg-emerald-400",
    oklchBase: "oklch(0.67 0.15 156)",
  },
  amber: {
    id: "amber",
    iconText: "text-amber-600 dark:text-amber-400",
    chipBg: "bg-amber-500/10 dark:bg-amber-400/14",
    chipBorder: "border-amber-500/20 dark:border-amber-400/25",
    dotBg: "bg-amber-500 dark:bg-amber-400",
    oklchBase: "oklch(0.75 0.15 74)",
  },
  orange: {
    id: "orange",
    iconText: "text-orange-600 dark:text-orange-400",
    chipBg: "bg-orange-500/10 dark:bg-orange-400/14",
    chipBorder: "border-orange-500/20 dark:border-orange-400/25",
    dotBg: "bg-orange-500 dark:bg-orange-400",
    oklchBase: "oklch(0.70 0.16 48)",
  },
  rose: {
    id: "rose",
    iconText: "text-rose-600 dark:text-rose-400",
    chipBg: "bg-rose-500/10 dark:bg-rose-400/14",
    chipBorder: "border-rose-500/20 dark:border-rose-400/25",
    dotBg: "bg-rose-500 dark:bg-rose-400",
    oklchBase: "oklch(0.64 0.19 14)",
  },
  pink: {
    id: "pink",
    iconText: "text-pink-600 dark:text-pink-400",
    chipBg: "bg-pink-500/10 dark:bg-pink-400/14",
    chipBorder: "border-pink-500/20 dark:border-pink-400/25",
    dotBg: "bg-pink-500 dark:bg-pink-400",
    oklchBase: "oklch(0.66 0.18 350)",
  },
  violet: {
    id: "violet",
    iconText: "text-violet-600 dark:text-violet-400",
    chipBg: "bg-violet-500/10 dark:bg-violet-400/14",
    chipBorder: "border-violet-500/20 dark:border-violet-400/25",
    dotBg: "bg-violet-500 dark:bg-violet-400",
    oklchBase: "oklch(0.62 0.18 295)",
  },
  slate: {
    id: "slate",
    iconText: "text-slate-600 dark:text-slate-400",
    chipBg: "bg-slate-500/10 dark:bg-slate-400/14",
    chipBorder: "border-slate-500/20 dark:border-slate-400/25",
    dotBg: "bg-slate-500 dark:bg-slate-400",
    oklchBase: "oklch(0.60 0.02 255)",
  },
};

export function getSpaceColorToken(color?: string | null): SpaceColorToken {
  if (color && color in SPACE_COLOR_PALETTE) {
    return SPACE_COLOR_PALETTE[color as SpaceColorName];
  }
  return SPACE_COLOR_PALETTE.slate;
}

export const SPACE_ICON_REGISTRY = {
  CalendarDays,
  Inbox,
  BookOpen,
  FolderKanban,
  Folder,
  Rocket,
  Cpu,
  Sparkles,
  FlaskConical,
  Code2,
  FileText,
  Compass,
  Layers,
  Lightbulb,
  Shield,
  Bookmark,
  Briefcase,
  Globe,
  Archive,
  Heart,
  Star,
  Terminal,
  Database,
  Tag,
} as const satisfies Readonly<Record<string, LucideIcon>>;

export type SpaceIconName = keyof typeof SPACE_ICON_REGISTRY;

export const SPACE_ICON_NAMES = Object.keys(SPACE_ICON_REGISTRY) as readonly SpaceIconName[];

const EMOJI_LEADING_REGEX = /^[\p{Extended_Pictographic}\p{Emoji_Presentation}]/u;

export function isEmojiIcon(icon?: string | null): boolean {
  if (!icon) return false;
  const trimmed = icon.trim();
  if (!trimmed || trimmed in SPACE_ICON_REGISTRY) return false;
  return EMOJI_LEADING_REGEX.test(trimmed);
}

export function resolveSpaceIconComponent(icon?: string | null): LucideIcon {
  if (icon && icon in SPACE_ICON_REGISTRY) {
    return SPACE_ICON_REGISTRY[icon as SpaceIconName];
  }
  return Folder;
}

const SIZE_CLASS_MAP = {
  xs: "size-3.5",
  sm: "size-4",
  md: "size-4.5",
  lg: "size-5",
} as const;

const EMOJI_SIZE_CLASS_MAP = {
  xs: "text-xs leading-none",
  sm: "text-sm leading-none",
  md: "text-base leading-none",
  lg: "text-lg leading-none",
} as const;

export type SpaceIconSize = keyof typeof SIZE_CLASS_MAP | number;

export type SpaceIconTone = "tinted" | "mono" | "dot";

export interface SpaceIconProps {
  readonly icon?: string | null | undefined;
  readonly color?: string | null | undefined;
  readonly size?: SpaceIconSize | undefined;
  readonly tone?: SpaceIconTone | undefined;
  readonly withChip?: boolean | undefined;
  readonly className?: string | undefined;
}

/**
 * Renders a Space's curated Lucide icon or leading emoji with tinted, monochrome, or semantic dot styling.
 */
export function SpaceIcon({
  icon,
  color,
  size = "sm",
  tone = "tinted",
  withChip = false,
  className,
}: SpaceIconProps): React.ReactElement {
  const token = getSpaceColorToken(color);
  const emoji = isEmojiIcon(icon) ? icon!.trim() : null;
  const IconComponent = resolveSpaceIconComponent(icon);

  const isNumericSize = typeof size === "number";
  const iconStyle: React.CSSProperties | undefined = isNumericSize
    ? { width: size, height: size }
    : undefined;
  const iconSizeClass = isNumericSize ? undefined : SIZE_CLASS_MAP[size];

  const glyph = emoji ? (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center",
        isNumericSize ? undefined : EMOJI_SIZE_CLASS_MAP[size],
        !withChip && className,
      )}
      data-slot="space-icon-emoji"
      style={isNumericSize ? { fontSize: Math.max(12, Math.round(size * 0.85)), lineHeight: 1 } : undefined}
    >
      {emoji}
    </span>
  ) : tone === "dot" && !withChip ? (
    <span
      aria-hidden="true"
      className={cn("inline-block size-1.5 shrink-0 rounded-full", token.dotBg, className)}
      data-color={token.id}
      data-slot="space-icon-dot"
    />
  ) : (
    <IconComponent
      aria-hidden="true"
      className={cn(
        "shrink-0",
        iconSizeClass,
        tone === "mono" ? "text-muted-foreground" : token.iconText,
        !withChip && className,
      )}
      data-slot="space-icon-svg"
      style={iconStyle}
    />
  );

  if (!withChip) {
    return glyph;
  }

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md border p-1",
        token.chipBg,
        token.chipBorder,
        className,
      )}
      data-slot="space-icon-chip"
    >
      {glyph}
    </span>
  );
}

export interface SpaceColorBadgeProps {
  readonly color?: string | null | undefined;
  readonly size?: "sm" | "md" | undefined;
  readonly className?: string | undefined;
}

export function SpaceColorBadge({
  color,
  size = "sm",
  className,
}: SpaceColorBadgeProps): React.ReactElement {
  const token = getSpaceColorToken(color);
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block shrink-0 rounded-full",
        size === "sm" ? "size-2" : "size-2.5",
        token.dotBg,
        className,
      )}
      data-color={token.id}
      data-slot="space-color-badge"
    />
  );
}

export interface SpaceIconPickerProps {
  readonly icon?: string | null | undefined;
  readonly color?: string | null | undefined;
  readonly onIconChange: (icon: SpaceIconName) => void;
  readonly onColorChange: (color: SpaceColorName) => void;
  readonly iconLabel?: React.ReactNode | undefined;
  readonly colorLabel?: React.ReactNode | undefined;
  readonly colorLabels?: Partial<Record<SpaceColorName, string>> | undefined;
  readonly className?: string | undefined;
}

/**
 * Interactive Space color swatch row + 24-icon grid selector.
 * All human-facing labels are supplied via props to satisfy @inkade/i18n enforcement.
 */
export function SpaceIconPicker({
  icon,
  color,
  onIconChange,
  onColorChange,
  iconLabel,
  colorLabel,
  colorLabels,
  className,
}: SpaceIconPickerProps): React.ReactElement {
  const activeColor = getSpaceColorToken(color);
  const activeIconName: string = icon && icon in SPACE_ICON_REGISTRY ? icon : "Folder";

  return (
    <div className={cn("flex flex-col gap-3", className)} data-slot="space-icon-picker">
      <div className="flex flex-col gap-1.5">
        {colorLabel ? (
          <div className="text-xs font-medium text-muted-foreground">{colorLabel}</div>
        ) : null}
        <div className="flex flex-wrap items-center gap-1.5" role="group">
          {SPACE_COLOR_NAMES.map((colorName) => {
            const swatch = SPACE_COLOR_PALETTE[colorName];
            const selected = activeColor.id === colorName;
            const accessibleName = colorLabels?.[colorName] ?? colorName;
            return (
              <button
                aria-label={accessibleName}
                aria-pressed={selected}
                className={cn(
                  "relative inline-flex size-6 cursor-pointer items-center justify-center rounded-full border border-transparent transition-transform duration-120 hover:scale-108 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                  swatch.dotBg,
                  selected && "ring-2 ring-foreground/70 ring-offset-2 ring-offset-background",
                )}
                data-color={colorName}
                key={colorName}
                onClick={() => onColorChange(colorName)}
                title={accessibleName}
                type="button"
              >
                {selected ? <Check className="size-3 text-white drop-shadow-xs" /> : null}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        {iconLabel ? (
          <div className="text-xs font-medium text-muted-foreground">{iconLabel}</div>
        ) : null}
        <div className="grid grid-cols-8 gap-1" role="group">
          {SPACE_ICON_NAMES.map((iconName) => {
            const IconItem = SPACE_ICON_REGISTRY[iconName];
            const selected = activeIconName === iconName;
            return (
              <button
                aria-label={iconName}
                aria-pressed={selected}
                className={cn(
                  "inline-flex size-8 cursor-pointer items-center justify-center rounded-md border transition-colors duration-120 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  selected
                    ? cn(activeColor.chipBg, activeColor.chipBorder, activeColor.iconText)
                    : "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
                data-icon={iconName}
                key={iconName}
                onClick={() => onIconChange(iconName)}
                title={iconName}
                type="button"
              >
                <IconItem className="size-4" />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
