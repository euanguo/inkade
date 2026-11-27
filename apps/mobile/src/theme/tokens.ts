import type {
  AdeThreadStatus,
  HighlightColor,
  MobileAccentPreset,
  MobileMotionProfile,
  MobilePaperMode,
  MobileReaderFont,
  MobileReaderFontSize,
  MobileSurfaceTheme,
  MobileTypesetPreset,
} from "@inkade/core";

export type SurfacePreference = "system" | MobileSurfaceTheme;

export interface TypesetSpec {
  readonly fontSizePx: number;
  readonly lineHeight: number;
  readonly flowPx: number;
}

export const MOTION_DURATIONS = {
  stagger: 40,
  micro: 80,
  quick: 150,
  fast: 220,
  medium: 320,
  slow: 380,
} as const;

export const TYPESET_SPECS: Readonly<Record<MobileTypesetPreset, TypesetSpec>> = {
  compact: { fontSizePx: 14.5, lineHeight: 1.48, flowPx: 12 },
  standard: { fontSizePx: 15.5, lineHeight: 1.55, flowPx: 15.2 },
  relaxed: { fontSizePx: 16.5, lineHeight: 1.65, flowPx: 18.4 },
};

export interface SurfacePalette {
  readonly surface: MobileSurfaceTheme;
  readonly isDark: boolean;
  readonly ground: string;
  readonly background: string;
  readonly card: string;
  readonly popover: string;
  readonly foreground: string;
  readonly mutedForeground: string;
  readonly border: string;
  readonly input: string;
  readonly muted: string;
  readonly code: string;
  readonly codeForeground: string;
}

export interface AccentPalette {
  readonly primary: string;
  readonly onPrimary: string;
  readonly subtle: string;
  readonly subtleText: string;
}

export interface PaperPalette {
  readonly background: string;
  readonly foreground: string;
  readonly mutedForeground: string;
  readonly border: string;
  readonly code: string;
}

export interface MobileTheme {
  readonly preference: SurfacePreference;
  readonly surface: MobileSurfaceTheme;
  readonly accentPreset: MobileAccentPreset;
  readonly paperMode: MobilePaperMode;
  readonly readerFont: MobileReaderFont;
  readonly fontSize: MobileReaderFontSize;
  readonly typesetPreset: MobileTypesetPreset;
  readonly typeset: TypesetSpec;
  readonly motionProfile: MobileMotionProfile;
  readonly effectiveReducedMotion: boolean;
  readonly motion: typeof MOTION_DURATIONS;
  readonly isDark: boolean;
  readonly colors: SurfacePalette &
    AccentPalette & {
      readonly destructive: string;
      readonly destructiveSubtle: string;
      readonly info: string;
      readonly infoSubtle: string;
      readonly success: string;
      readonly successSubtle: string;
      readonly warning: string;
      readonly warningSubtle: string;
      readonly paper: PaperPalette;
      readonly ade: Readonly<Record<AdeThreadStatus, { readonly dot: string; readonly bg: string; readonly text: string }>>;
      readonly highlights: Readonly<Record<HighlightColor, { readonly bg: string; readonly border: string }>>;
    };
}

export const SURFACE_PALETTES: Readonly<Record<MobileSurfaceTheme, SurfacePalette>> = {
  light: {
    surface: "light",
    isDark: false,
    ground: "#f5f5f5",
    background: "#ffffff",
    card: "#ffffff",
    popover: "#ffffff",
    foreground: "#171717",
    mutedForeground: "#6b6f76",
    border: "rgba(0, 0, 0, 0.068)",
    input: "rgba(0, 0, 0, 0.11)",
    muted: "rgba(0, 0, 0, 0.038)",
    code: "#f8f8f9",
    codeForeground: "#171717",
  },
  "light-dimmed": {
    surface: "light-dimmed",
    isDark: false,
    ground: "#f4f3ef",
    background: "#fbfaf7",
    card: "#fbfaf7",
    popover: "#ffffff",
    foreground: "#1c1b18",
    mutedForeground: "#6b6f76",
    border: "rgba(45, 40, 30, 0.08)",
    input: "rgba(45, 40, 30, 0.12)",
    muted: "rgba(45, 40, 30, 0.04)",
    code: "#f5f3ed",
    codeForeground: "#1c1b18",
  },
  dark: {
    surface: "dark",
    isDark: true,
    ground: "#0a0b0c",
    background: "#141517",
    card: "#18191c",
    popover: "#1e2024",
    foreground: "#eeeeef",
    mutedForeground: "#8a8f98",
    border: "rgba(255, 255, 255, 0.075)",
    input: "rgba(255, 255, 255, 0.11)",
    muted: "rgba(255, 255, 255, 0.045)",
    code: "#111214",
    codeForeground: "#eeeeef",
  },
  "dark-dimmed": {
    surface: "dark-dimmed",
    isDark: true,
    ground: "#141518",
    background: "#191b1f",
    card: "#1f2126",
    popover: "#25282e",
    foreground: "#eeeeef",
    mutedForeground: "#8a8f98",
    border: "rgba(255, 255, 255, 0.085)",
    input: "rgba(255, 255, 255, 0.12)",
    muted: "rgba(255, 255, 255, 0.055)",
    code: "#15171b",
    codeForeground: "#eeeeef",
  },
};

const LIGHT_ACCENTS: Readonly<Record<MobileAccentPreset, AccentPalette>> = {
  indigo: {
    primary: "#4f46e5",
    onPrimary: "#ffffff",
    subtle: "rgba(79, 70, 229, 0.1)",
    subtleText: "#4338ca",
  },
  sage: {
    primary: "#15803d",
    onPrimary: "#ffffff",
    subtle: "rgba(21, 128, 61, 0.1)",
    subtleText: "#166534",
  },
  terracotta: {
    primary: "#c2410c",
    onPrimary: "#ffffff",
    subtle: "rgba(194, 65, 12, 0.1)",
    subtleText: "#9a3412",
  },
  mono: {
    primary: "#171717",
    onPrimary: "#ffffff",
    subtle: "rgba(0, 0, 0, 0.055)",
    subtleText: "#171717",
  },
};

const DARK_ACCENTS: Readonly<Record<MobileAccentPreset, AccentPalette>> = {
  indigo: {
    primary: "#818cf8",
    onPrimary: "#0e1015",
    subtle: "rgba(129, 140, 248, 0.14)",
    subtleText: "#a5b4fc",
  },
  sage: {
    primary: "#4ade80",
    onPrimary: "#0e1015",
    subtle: "rgba(74, 222, 128, 0.14)",
    subtleText: "#86efac",
  },
  terracotta: {
    primary: "#fb923c",
    onPrimary: "#0e1015",
    subtle: "rgba(251, 146, 60, 0.14)",
    subtleText: "#fdba74",
  },
  mono: {
    primary: "#ededee",
    onPrimary: "#0f1011",
    subtle: "rgba(255, 255, 255, 0.08)",
    subtleText: "#f4f4f5",
  },
};

const PAPER_SEPIA_LIGHT: PaperPalette = {
  background: "#fbf8f1",
  foreground: "#2b251e",
  mutedForeground: "#6e6254",
  border: "rgba(120, 96, 62, 0.16)",
  code: "#f4efe4",
};

const PAPER_SEPIA_DARK: PaperPalette = {
  background: "#161411",
  foreground: "#e6dec8",
  mutedForeground: "#a99e86",
  border: "rgba(230, 222, 200, 0.12)",
  code: "#1e1b16",
};

export const SPACE_COLOR_HEX: Readonly<Record<string, string>> = {
  indigo: "#4f46e5",
  blue: "#2563eb",
  teal: "#0d9488",
  emerald: "#059669",
  amber: "#d97706",
  orange: "#ea580c",
  rose: "#e11d48",
  pink: "#db2777",
  violet: "#7c3aed",
  slate: "#64748b",
};

export function resolveSpaceColor(color?: string): string {
  if (!color) return SPACE_COLOR_HEX["indigo"]!;
  const mapped = SPACE_COLOR_HEX[color.toLowerCase()];
  if (mapped) return mapped;
  if (/^#[0-9a-f]{3,8}$/i.test(color)) return color;
  return SPACE_COLOR_HEX["indigo"]!;
}

export function isDarkSurface(surface: MobileSurfaceTheme): boolean {
  return surface === "dark" || surface === "dark-dimmed";
}

export function resolveEffectiveSurface(
  preference: SurfacePreference,
  systemScheme: "light" | "dark" | null | undefined,
  options?: {
    readonly preferredLight?: "light" | "light-dimmed" | undefined;
    readonly preferredDark?: "dark" | "dark-dimmed" | undefined;
  },
): MobileSurfaceTheme {
  if (preference !== "system") return preference;
  if (systemScheme === "dark") {
    return options?.preferredDark ?? "dark";
  }
  return options?.preferredLight ?? "light";
}

export function buildMobileTheme(input: {
  readonly preference: SurfacePreference;
  readonly systemScheme?: "light" | "dark" | null | undefined;
  readonly accentPreset?: MobileAccentPreset | undefined;
  readonly paperMode?: MobilePaperMode | undefined;
  readonly readerFont?: MobileReaderFont | undefined;
  readonly fontSize?: MobileReaderFontSize | undefined;
  readonly typesetPreset?: MobileTypesetPreset | undefined;
  readonly motionProfile?: MobileMotionProfile | undefined;
  readonly systemReduceMotion?: boolean | undefined;
  readonly preferredLight?: "light" | "light-dimmed" | undefined;
  readonly preferredDark?: "dark" | "dark-dimmed" | undefined;
}): MobileTheme {
  const surface = resolveEffectiveSurface(input.preference, input.systemScheme, {
    preferredLight: input.preferredLight,
    preferredDark: input.preferredDark,
  });
  const palette = SURFACE_PALETTES[surface];
  const accentPreset = input.accentPreset ?? "mono";
  const accent = palette.isDark ? DARK_ACCENTS[accentPreset] : LIGHT_ACCENTS[accentPreset];
  const paperMode = input.paperMode ?? "default";
  const typesetPreset = input.typesetPreset ?? "standard";
  const motionProfile = input.motionProfile ?? "comfort";
  const effectiveReducedMotion =
    motionProfile === "reduced-pulse" || Boolean(input.systemReduceMotion);
  const paper: PaperPalette =
    paperMode === "sepia"
      ? palette.isDark
        ? PAPER_SEPIA_DARK
        : PAPER_SEPIA_LIGHT
      : {
          background: palette.background,
          foreground: palette.foreground,
          mutedForeground: palette.mutedForeground,
          border: palette.border,
          code: palette.code,
        };

  return {
    preference: input.preference,
    surface,
    accentPreset,
    paperMode,
    readerFont: input.readerFont ?? "sans",
    fontSize: input.fontSize ?? "base",
    typesetPreset,
    typeset: TYPESET_SPECS[typesetPreset],
    motionProfile,
    effectiveReducedMotion,
    motion: MOTION_DURATIONS,
    isDark: palette.isDark,
    colors: {
      ...palette,
      ...accent,
      destructive: palette.isDark ? "#f87171" : "#dc2626",
      destructiveSubtle: palette.isDark ? "rgba(248, 113, 113, 0.16)" : "rgba(220, 38, 38, 0.1)",
      info: palette.isDark ? "#60a5fa" : "#2563eb",
      infoSubtle: palette.isDark ? "rgba(96, 165, 250, 0.16)" : "rgba(37, 99, 235, 0.1)",
      success: palette.isDark ? "#34d399" : "#059669",
      successSubtle: palette.isDark ? "rgba(52, 211, 153, 0.16)" : "rgba(5, 150, 105, 0.1)",
      warning: palette.isDark ? "#fbbf24" : "#d97706",
      warningSubtle: palette.isDark ? "rgba(251, 191, 36, 0.18)" : "rgba(217, 119, 6, 0.12)",
      paper,
      ade: {
        queued: {
          dot: palette.isDark ? "#9ca3af" : "#6b7280",
          bg: palette.isDark ? "rgba(156,163,175,0.14)" : "rgba(107,114,128,0.1)",
          text: palette.isDark ? "#d1d5db" : "#4b5563",
        },
        running: {
          dot: palette.isDark ? "#60a5fa" : "#2563eb",
          bg: palette.isDark ? "rgba(96,165,250,0.16)" : "rgba(37,99,235,0.1)",
          text: palette.isDark ? "#93c5fd" : "#1d4ed8",
        },
        waiting_input: {
          dot: palette.isDark ? "#fbbf24" : "#d97706",
          bg: palette.isDark ? "rgba(251,191,36,0.18)" : "rgba(217,119,6,0.12)",
          text: palette.isDark ? "#fde68a" : "#b45309",
        },
        completed: {
          dot: palette.isDark ? "#34d399" : "#059669",
          bg: palette.isDark ? "rgba(52,211,153,0.16)" : "rgba(5,150,105,0.1)",
          text: palette.isDark ? "#6ee7b7" : "#047857",
        },
        failed: {
          dot: palette.isDark ? "#f87171" : "#dc2626",
          bg: palette.isDark ? "rgba(248,113,113,0.16)" : "rgba(220,38,38,0.1)",
          text: palette.isDark ? "#fca5a5" : "#b91c1c",
        },
        archived: {
          dot: palette.isDark ? "#71717a" : "#9ca3af",
          bg: palette.isDark ? "rgba(113,113,122,0.14)" : "rgba(156,163,175,0.1)",
          text: palette.isDark ? "#a1a1aa" : "#6b7280",
        },
      },
      highlights: {
        amber: {
          bg: palette.isDark ? "rgba(245, 158, 11, 0.24)" : "rgba(254, 240, 138, 0.65)",
          border: "#f59e0b",
        },
        emerald: {
          bg: palette.isDark ? "rgba(16, 185, 129, 0.22)" : "rgba(167, 243, 208, 0.6)",
          border: "#10b981",
        },
        blue: {
          bg: palette.isDark ? "rgba(59, 130, 246, 0.24)" : "rgba(191, 219, 254, 0.65)",
          border: "#3b82f6",
        },
        rose: {
          bg: palette.isDark ? "rgba(244, 63, 94, 0.22)" : "rgba(254, 205, 211, 0.65)",
          border: "#f43f5e",
        },
      },
    },
  };
}

export function getMinTouchTarget(os: string): number {
  return os === "ios" ? 44 : 48;
}

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
} as const;

export const RADII = {
  sm: 6,
  md: 8,
  lg: 10,
  full: 9999,
} as const;
