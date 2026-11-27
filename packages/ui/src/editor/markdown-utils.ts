import type { SlashCommandItem, TriggerMatch } from "./types.ts";

/**
 * Post-processes TipTap Markdown serialization output so stray `&amp;` HTML entities
 * emitted by the Markdown serializer in headings/paragraphs/links do not leak into
 * stored Markdown or revision diffs, while leaving fenced code blocks, display math
 * blocks, and inline code spans untouched.
 */
export function sanitizeSerializedMarkdown(markdown: string): string {
  if (!markdown.includes("&amp;")) return markdown;
  const lines = markdown.split("\n");
  let inFenceChar: "`" | "~" | null = null;
  let inFenceLen = 0;
  let inMathBlock = false;

  const processed = lines.map((line) => {
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fenceMatch && fenceMatch[1]) {
      const marker = fenceMatch[1];
      const ch = marker[0] as "`" | "~";
      if (inFenceChar === null) {
        inFenceChar = ch;
        inFenceLen = marker.length;
      } else if (inFenceChar === ch && marker.length >= inFenceLen && /^\s*(`{3,}|~{3,})\s*$/.test(line)) {
        inFenceChar = null;
        inFenceLen = 0;
      }
      return line;
    }

    if (inFenceChar !== null) {
      return line;
    }

    if (/^\s*\$\$\s*$/.test(line)) {
      inMathBlock = !inMathBlock;
      return line;
    }

    if (inMathBlock || !line.includes("&amp;")) {
      return line;
    }

    // Preserve inline backtick code spans while unescaping &amp; in prose/headings/links
    const parts = line.split(/(`+[^`]*`+)/g);
    return parts
      .map((part, idx) => (idx % 2 === 1 ? part : part.replace(/&amp;/g, "&")))
      .join("");
  });

  return processed.join("\n");
}

/**
 * Ranks a slash command candidate against a query so exact IDs and ID prefixes
 * (e.g. `/col` -> `columns`) consistently outrank coincidental keyword substrings
 * (e.g. `toggle` containing keyword `collapse`). Returns `-1` when excluded.
 */
export function scoreSlashCommand(
  item: Pick<SlashCommandItem, "id" | "label" | "description" | "keywords" | "shortcut">,
  rawQuery: string,
): number {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return 1;

  const idLower = item.id.toLowerCase();
  const labelLower = item.label.toLowerCase();
  const descLower = item.description.toLowerCase();
  const keywordsLower = item.keywords.toLowerCase();
  const keywordTokens = keywordsLower.split(/\s+/).filter(Boolean);
  const shortcutLower = (item.shortcut ?? "").toLowerCase();

  let score = -1;
  if (idLower === q || (shortcutLower && shortcutLower === q)) {
    score = 120;
  } else if (idLower.startsWith(q)) {
    score = 95;
  } else if (labelLower.startsWith(q)) {
    score = 80;
  } else if (keywordTokens.some((tok) => tok === q)) {
    score = 75;
  } else if (keywordTokens.some((tok) => tok.startsWith(q))) {
    score = 55;
  } else if (idLower.includes(q)) {
    score = 45;
  } else if (labelLower.includes(q)) {
    score = 40;
  } else if (keywordsLower.includes(q)) {
    score = 25;
  } else if (descLower.includes(q)) {
    score = 10;
  }

  return score;
}

export interface MentionDateCandidate {
  readonly id: "date-today" | "date-tomorrow" | "date-next-monday";
  readonly isoDate: string;
}

function toLocalIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Generates dynamic Today / Tomorrow / Next Monday ISO dates for `@` mention triggers.
 */
export function computeMentionDateCandidates(
  referenceDate: Date = new Date(),
): readonly MentionDateCandidate[] {
  const today = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate(),
  );
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  const dayOfWeek = today.getDay(); // 0 = Sun, 1 = Mon, ...
  const daysUntilNextMonday = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
  const nextMonday = new Date(today);
  nextMonday.setDate(today.getDate() + daysUntilNextMonday);

  return [
    { id: "date-today", isoDate: toLocalIsoDate(today) },
    { id: "date-tomorrow", isoDate: toLocalIsoDate(tomorrow) },
    { id: "date-next-monday", isoDate: toLocalIsoDate(nextMonday) },
  ];
}

/**
 * Detects active inline trigger tokens (`/`, `[[`, `((`, `@`) immediately
 * before the cursor inside a textblock.
 */
export function detectEditorTrigger(
  textBefore: string,
  cursorPos: number,
): TriggerMatch | null {
  const wikiMatch = /\[\[([^[\]]*)$/.exec(textBefore);
  if (wikiMatch) {
    return {
      kind: "wikilink",
      query: wikiMatch[1] ?? "",
      rangeFrom: cursorPos - wikiMatch[0].length,
      rangeTo: cursorPos,
    };
  }

  const blockRefMatch = /\(\(([^()]*)$/.exec(textBefore);
  if (blockRefMatch) {
    return {
      kind: "blockref",
      query: blockRefMatch[1] ?? "",
      rangeFrom: cursorPos - blockRefMatch[0].length,
      rangeTo: cursorPos,
    };
  }

  const slashMatch = /(?:^|\s)(\/([^\s]*))$/.exec(textBefore);
  if (slashMatch && slashMatch[1]) {
    return {
      kind: "slash",
      query: slashMatch[2] ?? "",
      rangeFrom: cursorPos - slashMatch[1].length,
      rangeTo: cursorPos,
    };
  }

  const mentionMatch = /(?:^|\s)(@([^\s@]*))$/.exec(textBefore);
  if (mentionMatch && mentionMatch[1]) {
    return {
      kind: "mention",
      query: mentionMatch[2] ?? "",
      rangeFrom: cursorPos - mentionMatch[1].length,
      rangeTo: cursorPos,
    };
  }

  return null;
}

const DANGEROUS_URL_SCHEME_REGEX = /^(?:javascript|vbscript|data|file):/i;
const SAFE_DATA_IMAGE_URL_REGEX =
  /^data:image\/(?:png|jpe?g|gif|webp|avif|bmp|ico|svg\+xml);base64,[a-z0-9+/=]+$/i;
const VALID_DOMAIN_HOSTNAME_REGEX =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,}|xn--[a-z0-9]{2,})$/i;
const IPV4_HOSTNAME_REGEX = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function isAllowedHttpHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  if (!normalized) return false;
  if (normalized === "localhost") return true;
  if (normalized.startsWith("[") && normalized.endsWith("]")) {
    return /^\[[0-9a-f:]+\]$/i.test(normalized);
  }
  const ipv4Match = IPV4_HOSTNAME_REGEX.exec(normalized);
  if (ipv4Match) {
    return ipv4Match
      .slice(1, 5)
      .every((segment) => Number(segment) >= 0 && Number(segment) <= 255);
  }
  return VALID_DOMAIN_HOSTNAME_REGEX.test(normalized);
}

function normalizeHttpOrHttpsUrl(trimmed: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !/^https?:/i.test(trimmed)) {
    return null;
  }
  const candidate = /^https?:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    if (!isAllowedHttpHostname(parsed.hostname)) {
      return null;
    }
    return /^https?:/i.test(trimmed) ? trimmed : candidate;
  } catch {
    return null;
  }
}

export function normalizeExternalUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  if (DANGEROUS_URL_SCHEME_REGEX.test(trimmed)) return null;
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
    return trimmed;
  }
  if (trimmed.startsWith("#")) {
    return trimmed;
  }
  if (/^mailto:/i.test(trimmed)) {
    return /^mailto:[^@\s]+@[^@\s]+\.[^@\s]+$/i.test(trimmed) ? trimmed : null;
  }
  if (/^tel:/i.test(trimmed)) {
    return /^tel:[+\d().-]+$/i.test(trimmed) ? trimmed : null;
  }
  return normalizeHttpOrHttpsUrl(trimmed);
}

export function normalizeImageUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  if (SAFE_DATA_IMAGE_URL_REGEX.test(trimmed)) {
    return trimmed;
  }
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
    return trimmed;
  }
  if (DANGEROUS_URL_SCHEME_REGEX.test(trimmed)) return null;
  return normalizeHttpOrHttpsUrl(trimmed);
}
