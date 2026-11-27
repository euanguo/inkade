import type { DocumentId } from "./ids.ts";
import { fnv1a32 } from "./rag.ts";
import type { DocumentSummary } from "./types/index.ts";

export type SerendipityDocCandidate = Pick<
  DocumentSummary,
  | "id"
  | "title"
  | "kind"
  | "tags"
  | "excerpt"
  | "pinned"
  | "trashedAt"
  | "createdAt"
  | "updatedAt"
  | "dailyDate"
> & {
  readonly contentText?: string | undefined;
};

export type SerendipityReason = "aged" | "pinned" | "tagged" | "random";

export interface SerendipityPick<
  TDoc extends SerendipityDocCandidate = SerendipityDocCandidate,
> {
  readonly doc: TDoc;
  readonly ageDays: number;
  readonly reason: SerendipityReason;
}

export interface PickDailySerendipityOptions {
  readonly dateKey: string;
  readonly seedOffset?: number | undefined;
  readonly limit?: number | undefined;
  readonly excludeIds?: ReadonlySet<DocumentId | string> | undefined;
  readonly nowMs?: number | undefined;
}

const MS_PER_DAY = 86_400_000;

function resolveReferenceMs(dateKey: string, nowMs?: number): number {
  if (typeof nowMs === "number" && Number.isFinite(nowMs)) {
    return nowMs;
  }
  const parsed = Date.parse(`${dateKey}T12:00:00Z`);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function hasMeaningfulBody(doc: SerendipityDocCandidate): boolean {
  return (doc.contentText ?? "").trim().length >= 24 || doc.excerpt.trim().length >= 24;
}

/**
 * Deterministically selects a small batch of existing non-empty workspace notes
 * for daily serendipity review (Readwise/Reflect style), favoring aged, pinned,
 * and tagged documents while rotating smoothly when `seedOffset` increments.
 */
export function pickDailySerendipityDocs<TDoc extends SerendipityDocCandidate>(
  docs: readonly TDoc[],
  options: PickDailySerendipityOptions,
): readonly SerendipityPick<TDoc>[] {
  const limit = Math.max(0, options.limit ?? 3);
  if (limit === 0 || docs.length === 0) {
    return [];
  }

  const refMs = resolveReferenceMs(options.dateKey, options.nowMs);
  const seedOffset = options.seedOffset ?? 0;

  const scored = docs
    .filter((doc) => {
      if (doc.trashedAt !== null) return false;
      if (options.excludeIds?.has(doc.id)) return false;
      if (doc.dailyDate === options.dateKey) return false;
      return hasMeaningfulBody(doc);
    })
    .map((doc) => {
      const updatedMs = Date.parse(doc.updatedAt);
      const ageDays = Number.isFinite(updatedMs)
        ? Math.max(0, Math.floor((refMs - updatedMs) / MS_PER_DAY))
        : 0;

      const reason: SerendipityReason = doc.pinned
        ? "pinned"
        : ageDays >= 3
          ? "aged"
          : doc.tags.length > 0
            ? "tagged"
            : "random";

      const affinityBoost =
        (ageDays >= 3 ? 0.25 : 0) +
        (doc.pinned ? 0.15 : 0) +
        (doc.tags.length > 0 ? 0.1 : 0);
      const jitter = (fnv1a32(`${options.dateKey}:${seedOffset}:${doc.id}`) % 1000) / 1000;

      return {
        doc,
        ageDays,
        reason,
        score: affinityBoost + jitter,
      };
    })
    .sort((a, b) => b.score - a.score || a.doc.id.localeCompare(b.doc.id));

  return scored.slice(0, limit).map(({ doc, ageDays, reason }) => ({
    doc,
    ageDays,
    reason,
  }));
}
