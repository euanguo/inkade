import { z } from "zod";
import {
  ACCENT_PRESETS,
  MOTION_PROFILES,
  READER_FONT_FAMILIES,
  READER_FONT_SIZES,
  READER_PAPER_MODES,
  SURFACE_THEMES,
  TYPESET_PRESETS,
  accentPresetSchema,
  motionProfileSchema,
  readerFontFamilySchema,
  readerFontSizeSchema,
  readerPaperModeSchema,
  surfaceThemeSchema,
  typesetPresetSchema,
  type AccentPreset,
  type MotionProfile,
  type ReaderFontFamilyPref,
  type ReaderFontSizePref,
  type ReaderPaperModePref,
  type SurfaceTheme,
  type TypesetPreset,
} from "./preferences.ts";
import {
  adeKindSchema,
  adeThreadStatusSchema,
  documentKindSchema,
  highlightColorSchema,
} from "./types/index.ts";

export const MOBILE_SURFACE_THEMES = SURFACE_THEMES;
export type MobileSurfaceTheme = SurfaceTheme;
export const mobileSurfaceThemeSchema = surfaceThemeSchema;

export const MOBILE_ACCENT_PRESETS = ACCENT_PRESETS;
export type MobileAccentPreset = AccentPreset;
export const mobileAccentPresetSchema = accentPresetSchema;

export const MOBILE_PAPER_MODES = READER_PAPER_MODES;
export type MobilePaperMode = ReaderPaperModePref;
export const mobilePaperModeSchema = readerPaperModeSchema;

export const MOBILE_READER_FONTS = READER_FONT_FAMILIES;
export type MobileReaderFont = ReaderFontFamilyPref;
export const mobileReaderFontSchema = readerFontFamilySchema;

export const MOBILE_READER_FONT_SIZES = READER_FONT_SIZES;
export type MobileReaderFontSize = ReaderFontSizePref;
export const mobileReaderFontSizeSchema = readerFontSizeSchema;

export const MOBILE_TYPESET_PRESETS = TYPESET_PRESETS;
export type MobileTypesetPreset = TypesetPreset;
export const mobileTypesetPresetSchema = typesetPresetSchema;

export const MOBILE_MOTION_PROFILES = MOTION_PROFILES;
export type MobileMotionProfile = MotionProfile;
export const mobileMotionProfileSchema = motionProfileSchema;

export const MOBILE_CANVAS_MODES = ["read", "edit"] as const;
export type MobileCanvasMode = (typeof MOBILE_CANVAS_MODES)[number];
export const mobileCanvasModeSchema = z.enum(MOBILE_CANVAS_MODES);

export const mobileCanvasThemePayloadSchema = z.object({
  surface: mobileSurfaceThemeSchema,
  accent: mobileAccentPresetSchema,
  paperMode: mobilePaperModeSchema,
  readerFont: mobileReaderFontSchema,
  fontSize: mobileReaderFontSizeSchema,
  typeset: mobileTypesetPresetSchema.optional(),
  motionProfile: mobileMotionProfileSchema.optional(),
});
export type MobileCanvasThemePayload = z.infer<typeof mobileCanvasThemePayloadSchema>;

export const mobileCanvasThreadBindingSummarySchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  adeKind: adeKindSchema,
  status: adeThreadStatusSchema,
  deepLink: z.string().nullable().optional(),
  lastSummary: z.string().nullable().optional(),
});
export type MobileCanvasThreadBindingSummary = z.infer<
  typeof mobileCanvasThreadBindingSummarySchema
>;

export const mobileCanvasHighlightSummarySchema = z.object({
  id: z.string().min(1),
  quote: z.string().min(1),
  color: highlightColorSchema,
  noteMarkdown: z.string(),
});
export type MobileCanvasHighlightSummary = z.infer<typeof mobileCanvasHighlightSummarySchema>;

export const mobileHostToCanvasMessageSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("init"),
    documentId: z.string().min(1),
    title: z.string(),
    documentKind: documentKindSchema,
    markdown: z.string(),
    version: z.number().int().positive(),
    sourceUrl: z.string().nullable().optional(),
    theme: mobileCanvasThemePayloadSchema,
    mode: mobileCanvasModeSchema,
    bindings: z.array(mobileCanvasThreadBindingSummarySchema).default([]),
    highlights: z.array(mobileCanvasHighlightSummarySchema).default([]),
  }),
  z.object({
    kind: z.literal("theme_change"),
    theme: mobileCanvasThemePayloadSchema,
  }),
  z.object({
    kind: z.literal("document_update"),
    documentId: z.string().min(1),
    title: z.string(),
    markdown: z.string(),
    version: z.number().int().positive(),
    bindings: z.array(mobileCanvasThreadBindingSummarySchema).optional(),
    highlights: z.array(mobileCanvasHighlightSummarySchema).optional(),
  }),
  z.object({
    kind: z.literal("set_mode"),
    mode: mobileCanvasModeSchema,
  }),
]);
export type MobileHostToCanvasMessage = z.infer<typeof mobileHostToCanvasMessageSchema>;

export const mobileCanvasToHostMessageSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("ready"),
    documentId: z.string().min(1),
  }),
  z.object({
    kind: z.literal("navigate_wikilink"),
    target: z.string().min(1),
  }),
  z.object({
    kind: z.literal("open_ade_binding"),
    bindingId: z.string().min(1),
    deepLink: z.string().nullable().optional(),
  }),
  z.object({
    kind: z.literal("save_markdown"),
    documentId: z.string().min(1),
    markdown: z.string(),
    expectedVersion: z.number().int().positive(),
  }),
  z.object({
    kind: z.literal("copy_text"),
    text: z.string(),
  }),
  z.object({
    kind: z.literal("scroll_progress"),
    progress: z.number().min(0).max(1),
  }),
  z.object({
    kind: z.literal("dispatch_selection"),
    quote: z.string().min(1),
    documentId: z.string().min(1),
  }),
  z.object({
    kind: z.literal("open_external_url"),
    url: z.string().url().refine((val) => /^https?:\/\//i.test(val)),
  }),
]);
export type MobileCanvasToHostMessage = z.infer<typeof mobileCanvasToHostMessageSchema>;

function unwrapBridgePayload(raw: unknown): unknown {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }
  return raw;
}

/**
 * Validates an incoming host-to-WebView canvas message at the bridge boundary.
 */
export function parseMobileHostMessage(raw: unknown): MobileHostToCanvasMessage | null {
  const parsed = mobileHostToCanvasMessageSchema.safeParse(unwrapBridgePayload(raw));
  return parsed.success ? parsed.data : null;
}

/**
 * Validates an incoming WebView-to-host canvas message at the RN bridge boundary.
 */
export function parseMobileCanvasMessage(raw: unknown): MobileCanvasToHostMessage | null {
  const parsed = mobileCanvasToHostMessageSchema.safeParse(unwrapBridgePayload(raw));
  return parsed.success ? parsed.data : null;
}

export const MOBILE_CAPTURE_TARGETS = ["daily", "inbox", "clip"] as const;
export type MobileCaptureTarget = (typeof MOBILE_CAPTURE_TARGETS)[number];

export const MOBILE_SHELL_HAPTIC_STYLES = ["selection", "light", "success", "warning"] as const;
export type MobileShellHapticStyle = (typeof MOBILE_SHELL_HAPTIC_STYLES)[number];

export const mobileShellWebToHostMessageSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("ready"),
    path: z.string(),
  }),
  z.object({
    kind: z.literal("server_unreachable"),
    message: z.string().optional(),
  }),
  z.object({
    kind: z.literal("theme_sync"),
    isDark: z.boolean(),
    backgroundColor: z.string().min(1),
    surface: mobileSurfaceThemeSchema.optional(),
    accent: mobileAccentPresetSchema.optional(),
  }),
  z.object({
    kind: z.literal("open_native_capture"),
    target: z.enum(MOBILE_CAPTURE_TARGETS).optional(),
    text: z.string().optional(),
    url: z.string().optional(),
    title: z.string().optional(),
  }),
  z.object({
    kind: z.literal("open_shell_settings"),
  }),
  z.object({
    kind: z.literal("sign_out"),
  }),
  z.object({
    kind: z.literal("open_external_url"),
    url: z.string().url().refine((val) => /^https?:\/\//i.test(val)),
  }),
  z.object({
    kind: z.literal("haptic"),
    style: z.enum(MOBILE_SHELL_HAPTIC_STYLES),
  }),
]);
export type MobileShellWebToHostMessage = z.infer<typeof mobileShellWebToHostMessageSchema>;

/**
 * Validates an incoming message sent from embedded `@inkade/web` to the thin native shell.
 */
export function parseMobileShellWebMessage(raw: unknown): MobileShellWebToHostMessage | null {
  const parsed = mobileShellWebToHostMessageSchema.safeParse(unwrapBridgePayload(raw));
  return parsed.success ? parsed.data : null;
}
