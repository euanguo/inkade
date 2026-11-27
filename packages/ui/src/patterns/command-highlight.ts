export interface HighlightSegment {
  readonly text: string;
  readonly highlighted: boolean;
}

const MARK_TAG_REGEX = /<mark>([\s\S]*?)<\/mark>/gi;
const STRIP_HTML_REGEX = /<\/?[a-zA-Z][^>]*>/g;

/**
 * Safely splits FTS5 `<mark>...</mark>` snippet strings into React-renderable text segments
 * without `dangerouslySetInnerHTML`, neutralizing any unexpected HTML tags.
 */
export function parseHighlightSegments(snippet: string): HighlightSegment[] {
  if (!snippet) return [];

  const segments: HighlightSegment[] = [];
  MARK_TAG_REGEX.lastIndex = 0;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = MARK_TAG_REGEX.exec(snippet)) !== null) {
    if (match.index > lastIndex) {
      const plain = snippet.slice(lastIndex, match.index).replace(STRIP_HTML_REGEX, "");
      if (plain) {
        segments.push({ text: plain, highlighted: false });
      }
    }
    const inner = (match[1] ?? "").replace(STRIP_HTML_REGEX, "");
    if (inner) {
      segments.push({ text: inner, highlighted: true });
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < snippet.length) {
    const tail = snippet.slice(lastIndex).replace(STRIP_HTML_REGEX, "");
    if (tail) {
      segments.push({ text: tail, highlighted: false });
    }
  }

  return segments;
}
