import { formatPatch, structuredPatch } from "diff";
import type { DiffPreview, RevisionDiffHunk, RevisionDiffResult } from "./types/index.ts";

/**
 * Computes line-level Myers diff, addition/deletion stats, and unified patch between two revisions.
 */
export function computeRevisionDiff(
  oldMarkdown: string,
  newMarkdown: string,
  options?: { readonly filename?: string | undefined; readonly context?: number | undefined },
): RevisionDiffResult {
  const filename = options?.filename ?? "document.md";
  const patch = structuredPatch(
    filename,
    filename,
    oldMarkdown,
    newMarkdown,
    undefined,
    undefined,
    { context: options?.context ?? 3 },
  );

  let additions = 0;
  let deletions = 0;

  const hunks: RevisionDiffHunk[] = patch.hunks.map((hunk) => {
    for (const line of hunk.lines) {
      if (line.startsWith("+")) additions++;
      else if (line.startsWith("-")) deletions++;
    }
    return {
      oldStart: hunk.oldStart,
      oldLines: hunk.oldLines,
      newStart: hunk.newStart,
      newLines: hunk.newLines,
      lines: [...hunk.lines],
    };
  });

  const unifiedPatch = formatPatch(patch);

  return {
    additions,
    deletions,
    hunks,
    unifiedPatch,
  };
}

function truncateSnippet(raw: string, maxLength: number): string {
  const normalized = raw.trim();
  if (normalized.length <= maxLength) return normalized;
  if (maxLength <= 1) return normalized.slice(0, Math.max(0, maxLength));
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

/**
 * Extracts compact old/new changed snippets for ledger diff previews.
 */
export function buildCompactDiffPreview(
  oldMarkdown: string,
  newMarkdown: string,
  maxSnippetLength = 240,
): DiffPreview {
  const diff = computeRevisionDiff(oldMarkdown, newMarkdown, { context: 1 });
  const removed: string[] = [];
  const added: string[] = [];

  for (const hunk of diff.hunks) {
    for (const line of hunk.lines) {
      if (line.startsWith("-") && !line.startsWith("---")) {
        removed.push(line.slice(1));
      } else if (line.startsWith("+") && !line.startsWith("+++")) {
        added.push(line.slice(1));
      }
    }
  }

  const oldRaw = removed.length > 0 ? removed.join("\n") : oldMarkdown;
  const newRaw = added.length > 0 ? added.join("\n") : newMarkdown;

  return {
    oldSnippet: truncateSnippet(oldRaw, maxSnippetLength),
    newSnippet: truncateSnippet(newRaw, maxSnippetLength),
  };
}
