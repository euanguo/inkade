const CJK_CHAR_REGEX = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/;
const CJK_RUN_REGEX = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]+/g;
const LATIN_WORD_REGEX = /[a-zA-Z0-9_]+/g;

const zhWordSegmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter("zh-CN", { granularity: "word" })
    : null;

function pushUnique(target: string[], seen: Set<string>, token: string): void {
  if (!token || seen.has(token)) return;
  seen.add(token);
  target.push(token);
}

/**
 * Tokenizes mixed CJK and Latin text for FTS5 indexing using `Intl.Segmenter("zh-CN")`
 * plus CJK unigrams and overlapping bigrams so 1-char, 2-char, and 3+-char CJK queries
 * as well as English prefix queries match reliably.
 */
export function tokenizeForSearch(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";

  const tokens: string[] = [];
  const seenPerRun = new Set<string>();

  // 1. Extract Latin/alphanumeric words lowercased.
  LATIN_WORD_REGEX.lastIndex = 0;
  let latinMatch: RegExpExecArray | null;
  while ((latinMatch = LATIN_WORD_REGEX.exec(trimmed)) !== null) {
    const word = latinMatch[0].toLowerCase();
    if (word) tokens.push(word);
  }

  // 2. Extract contiguous CJK runs, emit Intl.Segmenter words + unigrams + bigrams.
  CJK_RUN_REGEX.lastIndex = 0;
  let cjkMatch: RegExpExecArray | null;
  while ((cjkMatch = CJK_RUN_REGEX.exec(trimmed)) !== null) {
    const run = cjkMatch[0];
    const chars = Array.from(run);
    seenPerRun.clear();

    if (zhWordSegmenter) {
      for (const seg of zhWordSegmenter.segment(run)) {
        if (seg.isWordLike && seg.segment.trim().length > 0) {
          pushUnique(tokens, seenPerRun, seg.segment);
        }
      }
    }

    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      if (ch) {
        pushUnique(tokens, seenPerRun, ch);
      }
      if (i + 1 < chars.length) {
        const nextCh = chars[i + 1];
        if (ch && nextCh) {
          pushUnique(tokens, seenPerRun, `${ch}${nextCh}`);
        }
      }
    }
  }

  return tokens.join(" ");
}

/**
 * Converts a raw user search query into a safe FTS5 MATCH expression supporting
 * 1/2/3+ char CJK substrings (via unigram/bigram intersection) and Latin prefix matching.
 */
export function buildFtsMatchQuery(rawQuery: string): string | null {
  const rawChunks = rawQuery
    .trim()
    .split(/[^\p{L}\p{N}_]+/u)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0);

  if (rawChunks.length === 0) return null;

  const clauses: string[] = [];
  const seen = new Set<string>();

  for (const chunk of rawChunks) {
    // Split mixed CJK + non-CJK chunks (e.g. "RAG检索" -> ["RAG", "检索"])
    let current = "";
    let currentIsCjk: boolean | null = null;
    const subRuns: Array<{ text: string; isCjk: boolean }> = [];

    for (const ch of Array.from(chunk)) {
      const isCjk = CJK_CHAR_REGEX.test(ch);
      if (currentIsCjk === null || currentIsCjk === isCjk) {
        current += ch;
        currentIsCjk = isCjk;
      } else {
        subRuns.push({ text: current, isCjk: currentIsCjk });
        current = ch;
        currentIsCjk = isCjk;
      }
    }
    if (current.length > 0 && currentIsCjk !== null) {
      subRuns.push({ text: current, isCjk: currentIsCjk });
    }

    for (const sub of subRuns) {
      if (!sub.isCjk) {
        const clause = `"${sub.text.toLowerCase()}"*`;
        if (!seen.has(clause)) {
          seen.add(clause);
          clauses.push(clause);
        }
        continue;
      }

      const chars = Array.from(sub.text);
      if (chars.length === 1) {
        const clause = `"${chars[0]}"`;
        if (!seen.has(clause)) {
          seen.add(clause);
          clauses.push(clause);
        }
      } else {
        for (let i = 0; i < chars.length - 1; i++) {
          const bigram = `${chars[i] ?? ""}${chars[i + 1] ?? ""}`;
          const clause = `"${bigram}"`;
          if (!seen.has(clause)) {
            seen.add(clause);
            clauses.push(clause);
          }
        }
      }
    }
  }

  return clauses.length > 0 ? clauses.join(" ") : null;
}
