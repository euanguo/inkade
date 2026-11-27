import { InkadeApiError } from "@inkade/sdk";

export interface HighlightedSnippetSegment {
  readonly text: string;
  readonly highlighted: boolean;
}

function decodeBasicHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

function sanitizeSnippetText(raw: string): string {
  return decodeBasicHtmlEntities(raw.replace(/<[^>]+>/g, ""));
}

/**
 * Splits server FTS snippet strings containing `<mark>...</mark>` into styled highlight segments
 * while stripping stray HTML tags so raw markup never leaks into native `<Text>` views.
 */
export function parseHighlightedSnippet(raw: string): readonly HighlightedSnippetSegment[] {
  if (!raw) return [];
  const parts = raw.split(/(<mark\b[^>]*>[\s\S]*?<\/mark>)/gi);
  const out: HighlightedSnippetSegment[] = [];

  for (const part of parts) {
    if (!part) continue;
    const markMatch = part.match(/^<mark\b[^>]*>([\s\S]*?)<\/mark>$/i);
    if (markMatch) {
      const clean = sanitizeSnippetText(markMatch[1] ?? "");
      if (clean) out.push({ text: clean, highlighted: true });
    } else {
      const clean = sanitizeSnippetText(part);
      if (clean) out.push({ text: clean, highlighted: false });
    }
  }

  return out;
}

/**
 * Maps `ReanimatedSwipeable` open direction to semantic Inbox triage actions:
 * swiping right (`"right"`) reveals the left Move panel; swiping left (`"left"`) triggers Trash.
 */
export function resolveInboxSwipeAction(direction: string): "move" | "trash" {
  return direction === "right" ? "move" : "trash";
}

export interface CaptureIncomingParams {
  readonly target?: string | undefined;
  readonly url?: string | undefined;
  readonly text?: string | undefined;
  readonly title?: string | undefined;
}

export interface ParsedCaptureParams {
  readonly target: "daily" | "inbox" | "clip";
  readonly content: string;
  readonly url: string;
  readonly title: string;
  readonly detectedUrl: string | null;
}

function extractFirstHttpUrl(raw: string): string | null {
  const match = raw.match(/https?:\/\/[^\s<>"'`]+/i);
  if (!match?.[0]) return null;
  return match[0].replace(/[),.;!?]+$/, "");
}

/**
 * Normalizes deep-link and Android `ACTION_SEND` share params for the Capture modal while
 * keeping both `text` and `url` intact when shared together.
 */
export function parseCaptureIncomingParams(params: CaptureIncomingParams): ParsedCaptureParams {
  const rawUrl = (params.url ?? "").trim();
  const rawText = (params.text ?? "").trim();
  const rawTitle = (params.title ?? "").trim();
  const inlineUrl = rawUrl || extractFirstHttpUrl(rawText) || "";
  const hasEffectiveUrl = /^https?:\/\/\S+$/i.test(inlineUrl);
  const isPureUrlText = Boolean(hasEffectiveUrl && rawText === inlineUrl);

  const explicitTarget =
    params.target === "daily" || params.target === "inbox" || params.target === "clip"
      ? params.target
      : null;

  if (explicitTarget) {
    return {
      target: explicitTarget,
      content: explicitTarget === "clip" && isPureUrlText ? "" : rawText,
      url: hasEffectiveUrl ? inlineUrl : rawUrl,
      title: rawTitle,
      detectedUrl: hasEffectiveUrl ? inlineUrl : null,
    };
  }

  if (hasEffectiveUrl && (!rawText || isPureUrlText)) {
    return {
      target: "clip",
      content: "",
      url: inlineUrl,
      title: rawTitle,
      detectedUrl: inlineUrl,
    };
  }

  if (hasEffectiveUrl && rawText) {
    const combinedContent = rawText.includes(inlineUrl) ? rawText : `${rawText}\n\n${inlineUrl}`;
    return {
      target: "inbox",
      content: combinedContent,
      url: inlineUrl,
      title: rawTitle,
      detectedUrl: inlineUrl,
    };
  }

  return {
    target: "daily",
    content: rawText,
    url: "",
    title: rawTitle,
    detectedUrl: null,
  };
}

/**
 * Returns true when an error indicates transport / server reachability failure rather than an
 * explicit HTTP rejection from the Inkade API server.
 */
export function isLikelyNetworkError(error: unknown): boolean {
  if (error instanceof InkadeApiError) return false;
  if (error instanceof TypeError) return true;
  if (error instanceof Error) {
    return /network|fetch|timed?\s*out|abort|connect|econnrefused|offline|socket|failed to load/i.test(
      error.message,
    );
  }
  return false;
}
