import type { useInkadeTranslation } from "@inkade/i18n";

/**
 * Normalizes backend briefing summary strings (including legacy English audit messages)
 * into clean localized copy across both BriefingsPanel and Inbox Digest cards.
 */
export function formatLocalizedBriefingSummary(
  summary: string | null | undefined,
  fallback: string,
  t: ReturnType<typeof useInkadeTranslation>["t"],
): string {
  const raw = summary?.trim() ?? "";
  if (!raw) return fallback;
  const completedMatch = /^Briefing ".*" completed \((\d+) citations?\)$/i.exec(raw);
  if (completedMatch) {
    return t("briefings.runCompletedSummary", {
      count: Number.parseInt(completedMatch[1] ?? "0", 10),
    });
  }
  return raw;
}
