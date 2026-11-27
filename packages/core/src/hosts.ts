import { z } from "zod";

/**
 * Valid host identifier slug: lowercase alphanumeric with `.`, `_`, or `-` separators.
 * Examples: `"any"`, `"bb"`, `"paseo"`, `"cindy"`, `"cursor"`, `"claude-code"`, `"custom.ade-1"`.
 */
export const HOST_KIND_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

/**
 * Default neutral host identifier when a thread binding is unclaimed or host-agnostic.
 */
export const DEFAULT_HOST_KIND = "any" as const;

export const adeKindSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .transform((value) => value.toLowerCase())
  .pipe(
    z
      .string()
      .regex(
        HOST_KIND_PATTERN,
        "Host identifier must start with [a-z0-9] and contain only [a-z0-9._-]",
      ),
  );

export type AdeKind = z.infer<typeof adeKindSchema>;

export const HOST_BADGE_TONES = [
  "amber",
  "blue",
  "emerald",
  "violet",
  "rose",
] as const;

export type HostBadgeTone = (typeof HOST_BADGE_TONES)[number] | "slate";

/**
 * Normalize an arbitrary host input into a valid lowercase slug,
 * falling back to `DEFAULT_HOST_KIND` (`"any"`) when invalid or empty.
 */
export function normalizeHostKind(raw: unknown): AdeKind {
  if (typeof raw !== "string") {
    return DEFAULT_HOST_KIND;
  }
  const parsed = adeKindSchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_HOST_KIND;
}

/**
 * Whether a host identifier represents an unclaimed / host-agnostic binding.
 */
export function isNeutralHostKind(kind: string | null | undefined): boolean {
  const normalized = (kind ?? "").trim().toLowerCase();
  return normalized === "" || normalized === "any" || normalized === "generic";
}

/**
 * Format a host slug for UI display (e.g. `"claude-code"` -> `"Claude Code"`, `"bb"` -> `"BB"`).
 */
export function formatHostDisplayName(
  kind: string | null | undefined,
  neutralLabel?: string,
): string {
  const normalized = (kind ?? "").trim().toLowerCase();
  if (!normalized || normalized === "any") {
    return neutralLabel ?? "Any";
  }
  if (normalized === "generic") {
    return neutralLabel ?? "Generic";
  }
  const parts = normalized.split(/[._-]+/).filter(Boolean);
  if (parts.length === 0) {
    return neutralLabel ?? "Any";
  }
  return parts
    .map((part) => {
      if (part.length <= 2 && /^[a-z]+$/.test(part)) {
        return part.toUpperCase();
      }
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}

/**
 * Derive a deterministic 1-2 character badge monogram from a host slug.
 */
export function getHostInitials(kind: string | null | undefined): string {
  if (isNeutralHostKind(kind)) {
    return "AG";
  }
  const normalized = (kind ?? "").trim().toLowerCase();
  const parts = normalized.split(/[._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]!.charAt(0)}${parts[1]!.charAt(0)}`.toUpperCase();
  }
  const single = parts[0] ?? normalized;
  if (single.length >= 2) {
    return single.slice(0, 2).toUpperCase();
  }
  return single.toUpperCase() || "AG";
}

/**
 * Deterministically assign a visual badge tone for any host identifier.
 * Neutral (`"any"` / `"generic"`) always uses `"slate"`.
 */
export function getHostBadgeTone(kind: string | null | undefined): HostBadgeTone {
  if (isNeutralHostKind(kind)) {
    return "slate";
  }
  const normalized = (kind ?? "").trim().toLowerCase();
  let hash = 0;
  for (let i = 0; i < normalized.length; i += 1) {
    hash = (hash * 31 + normalized.charCodeAt(i)) >>> 0;
  }
  return HOST_BADGE_TONES[hash % HOST_BADGE_TONES.length]!;
}
