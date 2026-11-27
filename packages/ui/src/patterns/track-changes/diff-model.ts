export interface InlineTokenDiff {
  readonly kind: "equal" | "insert" | "delete";
  readonly text: string;
}

export type SuggestionDecision = "pending" | "accepted" | "rejected";

export interface SuggestionHunk {
  readonly id: string;
  readonly index: number;
  readonly oldStartLine: number;
  readonly newStartLine: number;
  readonly oldText: string;
  readonly newText: string;
  readonly oldLineCount?: number | undefined;
  readonly newLineCount?: number | undefined;
  readonly tokens: readonly InlineTokenDiff[];
}

export type InlineReviewSegment =
  | { readonly type: "unchanged"; readonly text: string }
  | { readonly type: "hunk"; readonly hunk: SuggestionHunk };

/**
 * Computes LCS diff between two sequence arrays of strings (lines or tokens).
 */
function computeSequenceDiff(
  oldItems: readonly string[],
  newItems: readonly string[],
): Array<{ readonly kind: "equal" | "insert" | "delete"; readonly text: string }> {
  const n = oldItems.length;
  const m = newItems.length;

  // Fallback for very large diffs to keep UI responsive
  if (n * m > 250_000) {
    const out: Array<{ readonly kind: "equal" | "insert" | "delete"; readonly text: string }> = [];
    for (const item of oldItems) out.push({ kind: "delete", text: item });
    for (const item of newItems) out.push({ kind: "insert", text: item });
    return out;
  }

  const dp = new Int32Array((n + 1) * (m + 1));
  const stride = m + 1;

  for (let i = n - 1; i >= 0; i--) {
    const a = oldItems[i];
    for (let j = m - 1; j >= 0; j--) {
      if (a === newItems[j]) {
        dp[i * stride + j] = (dp[(i + 1) * stride + (j + 1)] ?? 0) + 1;
      } else {
        const down = dp[(i + 1) * stride + j] ?? 0;
        const right = dp[i * stride + (j + 1)] ?? 0;
        dp[i * stride + j] = down >= right ? down : right;
      }
    }
  }

  const result: Array<{ readonly kind: "equal" | "insert" | "delete"; readonly text: string }> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldItems[i] === newItems[j]) {
      result.push({ kind: "equal", text: oldItems[i] ?? "" });
      i++;
      j++;
    } else if ((dp[(i + 1) * stride + j] ?? 0) >= (dp[i * stride + (j + 1)] ?? 0)) {
      result.push({ kind: "delete", text: oldItems[i] ?? "" });
      i++;
    } else {
      result.push({ kind: "insert", text: newItems[j] ?? "" });
      j++;
    }
  }
  while (i < n) {
    result.push({ kind: "delete", text: oldItems[i++] ?? "" });
  }
  while (j < m) {
    result.push({ kind: "insert", text: newItems[j++] ?? "" });
  }
  return result;
}

function tokenizeWords(text: string): string[] {
  if (!text) return [];
  // Split preserving whitespace and splitting CJK characters individually for crisp inline diffs
  const matches = text.match(/[\u4e00-\u9fff]|[a-zA-Z0-9_]+|\s+|[^\s\w\u4e00-\u9fff]+/g);
  return matches ?? [text];
}

export function computeWordDiffTokens(oldText: string, newText: string): InlineTokenDiff[] {
  if (oldText === newText) {
    return oldText ? [{ kind: "equal", text: oldText }] : [];
  }
  const raw = computeSequenceDiff(tokenizeWords(oldText), tokenizeWords(newText));
  const merged: InlineTokenDiff[] = [];
  for (const item of raw) {
    const prev = merged[merged.length - 1];
    if (prev && prev.kind === item.kind) {
      merged[merged.length - 1] = { kind: item.kind, text: `${prev.text}${item.text}` };
    } else {
      merged.push(item);
    }
  }
  return merged;
}

const CALLOUT_HEADER_LINE_RE = /^>\s*\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/i;

function lineLeadingBlockMarker(line: string): string {
  const trimmed = line.trimStart();
  if (/^#{1,6}\s/.test(trimmed)) return "#";
  if (trimmed.startsWith(">")) return ">";
  if (/^[-*+]\s/.test(trimmed) || /^\d+\.\s/.test(trimmed)) return "-";
  if (trimmed.startsWith("$$") || trimmed.startsWith("```")) return "fence";
  return "text";
}

function areLinesPairable(oldLine: string, newLine: string): boolean {
  if (oldLine === newLine) return true;
  const a = oldLine.trim();
  const b = newLine.trim();
  if (!a || !b) return !a && !b;
  if (lineLeadingBlockMarker(oldLine) !== lineLeadingBlockMarker(newLine)) {
    return false;
  }
  const stripMarker = (tokens: string[]): string[] =>
    tokens.filter(
      (tok) => tok.trim().length > 0 && !/^#{1,6}$/.test(tok) && tok !== ">" && tok !== "-" && tok !== "*",
    );
  const aCore = stripMarker(tokenizeWords(a));
  const bCore = stripMarker(tokenizeWords(b));
  if (aCore.length === 0 || bCore.length === 0) return false;
  const bCounts = new Map<string, number>();
  for (const tok of bCore) {
    bCounts.set(tok, (bCounts.get(tok) ?? 0) + 1);
  }
  let shared = 0;
  for (const tok of aCore) {
    const rem = bCounts.get(tok) ?? 0;
    if (rem > 0) {
      shared += 1;
      bCounts.set(tok, rem - 1);
    }
  }
  return (2 * shared) / (aCore.length + bCore.length) >= 0.35;
}

function computeLineDiffWithBlockPreference(
  oldLines: readonly string[],
  newLines: readonly string[],
): Array<{ readonly kind: "equal" | "insert" | "delete"; readonly text: string }> {
  const n = oldLines.length;
  const m = newLines.length;
  if (n * m > 250_000) {
    return computeSequenceDiff(oldLines, newLines);
  }

  const dp = new Int32Array((n + 1) * (m + 1));
  const choice = new Uint8Array((n + 1) * (m + 1)); // 1=equal, 2=pair(del+ins), 3=delete, 4=insert
  const stride = m + 1;

  for (let i = n - 1; i >= 0; i--) {
    const a = oldLines[i] ?? "";
    const aEmpty = a.trim().length === 0;
    for (let j = m - 1; j >= 0; j--) {
      const b = newLines[j] ?? "";
      const down = dp[(i + 1) * stride + j] ?? 0;
      const right = dp[i * stride + (j + 1)] ?? 0;
      let best = down >= right ? down : right;
      let bestChoice = down >= right ? 3 : 4;

      if (a === b) {
        const score = (dp[(i + 1) * stride + (j + 1)] ?? 0) + (aEmpty ? 1 : 100);
        if (score >= best) {
          best = score;
          bestChoice = 1;
        }
      } else if (!aEmpty && b.trim().length > 0 && areLinesPairable(a, b)) {
        const score = (dp[(i + 1) * stride + (j + 1)] ?? 0) + 50;
        if (score > best) {
          best = score;
          bestChoice = 2;
        }
      }

      dp[i * stride + j] = best;
      choice[i * stride + j] = bestChoice;
    }
  }

  const result: Array<{ readonly kind: "equal" | "insert" | "delete"; readonly text: string }> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    const c = choice[i * stride + j] ?? 3;
    if (c === 1) {
      result.push({ kind: "equal", text: oldLines[i] ?? "" });
      i++;
      j++;
    } else if (c === 2) {
      result.push({ kind: "delete", text: oldLines[i] ?? "" });
      result.push({ kind: "insert", text: newLines[j] ?? "" });
      i++;
      j++;
    } else if (c === 3) {
      result.push({ kind: "delete", text: oldLines[i] ?? "" });
      i++;
    } else {
      result.push({ kind: "insert", text: newLines[j] ?? "" });
      j++;
    }
  }
  while (i < n) {
    result.push({ kind: "delete", text: oldLines[i++] ?? "" });
  }
  while (j < m) {
    result.push({ kind: "insert", text: newLines[j++] ?? "" });
  }
  return result;
}

/**
 * Line-aligned word diff for multi-line suggestion hunks: matches whole inserted/deleted blocks
 * at line boundaries before running word-level diff on paired lines, avoiding cross-block
 * delimiter stitching (e.g. matching `##` across an inserted `> [!TIP]` block).
 */
export function computeLineAwareDiffTokens(oldText: string, newText: string): InlineTokenDiff[] {
  if (!oldText.includes("\n") && !newText.includes("\n")) {
    if (
      oldText &&
      newText &&
      lineLeadingBlockMarker(oldText) !== lineLeadingBlockMarker(newText)
    ) {
      return [
        { kind: "delete", text: oldText },
        { kind: "insert", text: `\n${newText}` },
      ];
    }
    return computeWordDiffTokens(oldText, newText);
  }
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const ops = computeLineDiffWithBlockPreference(oldLines, newLines);
  const out: InlineTokenDiff[] = [];
  let oldEmitted = false;
  let newEmitted = false;

  const appendToken = (kind: InlineTokenDiff["kind"], text: string): void => {
    if (!text) return;
    const prev = out[out.length - 1];
    if (prev && prev.kind === kind) {
      out[out.length - 1] = { kind, text: `${prev.text}${text}` };
    } else {
      out.push({ kind, text });
    }
  };

  const emitSeparator = (inOld: boolean, inNew: boolean): void => {
    const needOld = inOld && oldEmitted;
    const needNew = inNew && newEmitted;
    if (needOld && needNew) appendToken("equal", "\n");
    else if (needOld) appendToken("delete", "\n");
    else if (needNew) appendToken("insert", "\n");
  };

  const emitLine = (kind: InlineTokenDiff["kind"], line: string): void => {
    emitSeparator(kind !== "insert", kind !== "delete");
    appendToken(kind, line);
    if (kind !== "insert") oldEmitted = true;
    if (kind !== "delete") newEmitted = true;
  };

  let idx = 0;
  while (idx < ops.length) {
    const op = ops[idx];
    if (!op) {
      idx += 1;
      continue;
    }
    if (op.kind === "equal") {
      emitLine("equal", op.text);
      idx += 1;
      continue;
    }

    const dels: string[] = [];
    const adds: string[] = [];
    while (idx < ops.length && ops[idx]?.kind !== "equal") {
      const cur = ops[idx];
      if (cur?.kind === "delete") dels.push(cur.text);
      else if (cur?.kind === "insert") adds.push(cur.text);
      idx += 1;
    }

    let dIdx = 0;
    let aIdx = 0;
    while (dIdx < dels.length && aIdx < adds.length) {
      const delLine = dels[dIdx] ?? "";
      const addLine = adds[aIdx] ?? "";
      if (areLinesPairable(delLine, addLine)) {
        emitSeparator(true, true);
        for (const tok of computeWordDiffTokens(delLine, addLine)) {
          appendToken(tok.kind, tok.text);
        }
        oldEmitted = true;
        newEmitted = true;
        dIdx += 1;
        aIdx += 1;
        continue;
      }
      let matchedAddIdx = -1;
      for (let k = aIdx + 1; k < adds.length; k++) {
        if (areLinesPairable(delLine, adds[k] ?? "")) {
          matchedAddIdx = k;
          break;
        }
      }
      if (matchedAddIdx >= 0) {
        while (aIdx < matchedAddIdx) {
          emitLine("insert", adds[aIdx] ?? "");
          aIdx += 1;
        }
        continue;
      }
      emitLine("delete", delLine);
      dIdx += 1;
    }
    while (dIdx < dels.length) {
      emitLine("delete", dels[dIdx] ?? "");
      dIdx += 1;
    }
    while (aIdx < adds.length) {
      emitLine("insert", adds[aIdx] ?? "");
      aIdx += 1;
    }
  }

  return out;
}

/**
 * Splits `oldMarkdown` vs `newMarkdown` into alternating unchanged Markdown segments
 * and interactive word-level `SuggestionHunk`s for Plate-style inline Track Changes review.
 */
export function buildInlineReviewModel(
  oldMarkdown: string,
  newMarkdown: string,
): {
  readonly segments: readonly InlineReviewSegment[];
  readonly hunks: readonly SuggestionHunk[];
} {
  if (oldMarkdown === newMarkdown) {
    return {
      segments: oldMarkdown ? [{ type: "unchanged", text: oldMarkdown }] : [],
      hunks: [],
    };
  }

  const oldLines = oldMarkdown.split("\n");
  const newLines = newMarkdown.split("\n");
  const ops = computeLineDiffWithBlockPreference(oldLines, newLines);

  const segments: InlineReviewSegment[] = [];
  const hunks: SuggestionHunk[] = [];

  let equalBuffer: string[] = [];
  let delBuffer: string[] = [];
  let addBuffer: string[] = [];
  let oldLineNum = 1;
  let newLineNum = 1;
  let hunkOldStart = 1;
  let hunkNewStart = 1;

  const flushEqual = (): void => {
    if (equalBuffer.length > 0) {
      segments.push({ type: "unchanged", text: equalBuffer.join("\n") });
      equalBuffer = [];
    }
  };

  const flushHunk = (): void => {
    if (delBuffer.length === 0 && addBuffer.length === 0) return;
    const oldText = delBuffer.join("\n");
    const newText = addBuffer.join("\n");
    const index = hunks.length;
    const hunk: SuggestionHunk = {
      id: `hunk-${index + 1}`,
      index,
      oldStartLine: hunkOldStart,
      newStartLine: hunkNewStart,
      oldText,
      newText,
      oldLineCount: delBuffer.length,
      newLineCount: addBuffer.length,
      tokens: computeLineAwareDiffTokens(oldText, newText),
    };
    hunks.push(hunk);
    segments.push({ type: "hunk", hunk });
    delBuffer = [];
    addBuffer = [];
  };

  for (const op of ops) {
    if (op.kind === "equal") {
      flushHunk();
      equalBuffer.push(op.text);
      oldLineNum++;
      newLineNum++;
    } else {
      if (delBuffer.length === 0 && addBuffer.length === 0) {
        const lastEq = equalBuffer[equalBuffer.length - 1] ?? "";
        if (CALLOUT_HEADER_LINE_RE.test(lastEq) && op.text.trimStart().startsWith(">")) {
          equalBuffer.pop();
          flushEqual();
          hunkOldStart = Math.max(1, oldLineNum - 1);
          hunkNewStart = Math.max(1, newLineNum - 1);
          delBuffer.push(lastEq);
          addBuffer.push(lastEq);
        } else {
          flushEqual();
          hunkOldStart = oldLineNum;
          hunkNewStart = newLineNum;
        }
      } else {
        flushEqual();
      }
      if (op.kind === "delete") {
        delBuffer.push(op.text);
        oldLineNum++;
      } else {
        addBuffer.push(op.text);
        newLineNum++;
      }
    }
  }

  flushHunk();
  flushEqual();

  return { segments, hunks };
}

/**
 * Reconstructs clean Markdown from review segments and per-hunk decisions.
 * Pending hunks default to `newText` (or `oldText` when `pendingFallback === "old"`).
 */
export function reconstructMarkdownFromSuggestions(
  segments: readonly InlineReviewSegment[],
  decisions: Readonly<Record<string, SuggestionDecision>>,
  pendingFallback: "new" | "old" = "new",
): string {
  const parts: string[] = [];
  for (const seg of segments) {
    if (seg.type === "unchanged") {
      parts.push(seg.text);
      continue;
    }
    const decision = decisions[seg.hunk.id] ?? "pending";
    const useNew =
      decision === "accepted" || (decision === "pending" && pendingFallback === "new");
    const chosen = useNew ? seg.hunk.newText : seg.hunk.oldText;
    const lineCount = useNew
      ? (seg.hunk.newLineCount ?? (chosen.length > 0 ? 1 : 0))
      : (seg.hunk.oldLineCount ?? (chosen.length > 0 ? 1 : 0));
    if (lineCount > 0 || chosen.length > 0) {
      parts.push(chosen);
    }
  }
  return parts.join("\n");
}
