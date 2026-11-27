import { tokenizeForSearch } from "./cjk.ts";

export const DEFAULT_LOCAL_EMBEDDING_DIMENSIONS = 128;

export interface RrfEntry<T> {
  readonly key: string;
  readonly item: T;
}

export interface RrfFusionOptions {
  readonly k?: number | undefined;
  readonly weights?: readonly number[] | undefined;
}

export interface RrfFusedItem<T> {
  readonly key: string;
  readonly item: T;
  readonly score: number;
  readonly ranks: readonly (number | null)[];
}

export function fnv1a32(input: string, seed = 0x811c9dc5): number {
  let hash = seed >>> 0;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Computes a deterministic 64-bit hex fingerprint for embedding change detection.
 */
export function hashTextForEmbedding(text: string): string {
  const h1 = fnv1a32(text, 0x811c9dc5).toString(16).padStart(8, "0");
  const h2 = fnv1a32(text, 0x9e3779b9).toString(16).padStart(8, "0");
  return `${h1}${h2}`;
}

/**
 * Computes cosine similarity in [-1, 1] between two numeric vectors.
 * Returns 0 if either vector is empty, zero-norm, or lengths differ.
 */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) {
    return 0;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const va = a[i] ?? 0;
    const vb = b[i] ?? 0;
    dot += va * vb;
    normA += va * va;
    normB += vb * vb;
  }

  if (normA === 0 || normB === 0) {
    return 0;
  }

  const sim = dot / (Math.sqrt(normA) * Math.sqrt(normB));
  if (sim > 1) return 1;
  if (sim < -1) return -1;
  return sim;
}

function extractWeightedFeatures(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  const tokenized = tokenizeForSearch(text);
  if (!tokenized) return counts;

  const baseTokens = tokenized.split(/\s+/).filter(Boolean);
  for (const token of baseTokens) {
    const isSingleChar = Array.from(token).length <= 1;
    const baseWeight = isSingleChar ? 0.65 : 1.35;
    counts.set(`t:${token}`, (counts.get(`t:${token}`) ?? 0) + baseWeight);

    // Add Latin character 3-grams for morphological overlap ("semantic" / "semantics").
    if (/^[a-z0-9_]+$/.test(token) && token.length >= 4) {
      for (let i = 0; i <= token.length - 3; i++) {
        const trigram = token.slice(i, i + 3);
        counts.set(`g3:${trigram}`, (counts.get(`g3:${trigram}`) ?? 0) + 0.5);
      }
    }
  }

  return counts;
}

/**
 * Deterministic lightweight local hashed TF/n-gram embedding vectorizer.
 * Works offline with zero external LLM/embedding endpoints for both CJK and Latin text.
 */
export function computeLocalTextEmbedding(
  text: string,
  dimensions = DEFAULT_LOCAL_EMBEDDING_DIMENSIONS,
): number[] {
  const dim = Math.max(1, Math.floor(dimensions));
  const vec = new Array<number>(dim).fill(0);
  const features = extractWeightedFeatures(text);
  if (features.size === 0) {
    return vec;
  }

  for (const [feature, rawWeight] of features) {
    const tfWeight = 1 + Math.log(Math.max(1, rawWeight));
    const h1 = fnv1a32(feature, 0x811c9dc5);
    const h2 = fnv1a32(feature, 0x9e3779b9);
    const bucket = h1 % dim;
    const sign = (h2 & 1) === 0 ? 1 : -1;
    vec[bucket] = (vec[bucket] ?? 0) + sign * tfWeight;
  }

  let normSq = 0;
  for (let i = 0; i < dim; i++) {
    const v = vec[i] ?? 0;
    normSq += v * v;
  }
  if (normSq === 0) {
    return vec;
  }

  const norm = Math.sqrt(normSq);
  for (let i = 0; i < dim; i++) {
    vec[i] = Number(((vec[i] ?? 0) / norm).toFixed(8));
  }
  return vec;
}

/**
 * Pure MIT Reciprocal Rank Fusion (RRF) combining multiple ranked retrieval lists.
 * Score for each document key is `sum_i (weight_i / (k + rank_i))` with 1-based ranks.
 */
export function computeRrfFusion<T>(
  rankedLists: readonly (readonly RrfEntry<T>[])[],
  options?: RrfFusionOptions,
): RrfFusedItem<T>[] {
  const k = options?.k ?? 60;
  const listCount = rankedLists.length;

  interface Acc {
    readonly key: string;
    readonly item: T;
    score: number;
    ranks: Array<number | null>;
    bestRank: number;
  }

  const map = new Map<string, Acc>();

  for (let listIdx = 0; listIdx < listCount; listIdx++) {
    const list = rankedLists[listIdx] ?? [];
    const weight = options?.weights?.[listIdx] ?? 1;
    const seenInList = new Set<string>();

    for (let idx = 0; idx < list.length; idx++) {
      const entry = list[idx];
      if (!entry || seenInList.has(entry.key)) continue;
      seenInList.add(entry.key);

      const rank = idx + 1;
      const contribution = weight / (k + rank);
      let acc = map.get(entry.key);
      if (!acc) {
        acc = {
          key: entry.key,
          item: entry.item,
          score: 0,
          ranks: new Array<number | null>(listCount).fill(null),
          bestRank: rank,
        };
        map.set(entry.key, acc);
      }

      acc.score += contribution;
      acc.ranks[listIdx] = rank;
      if (rank < acc.bestRank) {
        acc.bestRank = rank;
      }
    }
  }

  return [...map.values()]
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.bestRank !== b.bestRank) return a.bestRank - b.bestRank;
      return a.key.localeCompare(b.key);
    })
    .map(({ key, item, score, ranks }) => ({
      key,
      item,
      score,
      ranks,
    }));
}
