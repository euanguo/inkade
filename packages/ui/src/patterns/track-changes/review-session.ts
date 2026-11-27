import type { SuggestionDecision, SuggestionHunk } from "./diff-model.ts";

export interface ReviewHistoryEntry {
  readonly hunkId: string;
  readonly prevDecision: SuggestionDecision;
  readonly prevIndex: number;
  readonly changes?: ReadonlyArray<{
    readonly hunkId: string;
    readonly prevDecision: SuggestionDecision;
  }> | undefined;
}

export interface ReviewSessionState {
  readonly decisions: Readonly<Record<string, SuggestionDecision>>;
  readonly activeIndex: number;
  readonly history: readonly ReviewHistoryEntry[];
}

/**
 * Checks whether a keyboard event target is an editable field where review shortcuts must be suppressed.
 */
export function isReviewShortcutEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof Element === "undefined" || !(target instanceof Element)) {
    return false;
  }
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  ) {
    return true;
  }
  if (target instanceof HTMLElement && target.isContentEditable) {
    return true;
  }
  return Boolean(target.closest('[contenteditable="true"], .ProseMirror, [role="textbox"]'));
}

/**
 * Finds the next or previous pending hunk index from `currentIndex`, wrapping cleanly;
 * falls back to linear step if all hunks already have a decision.
 */
export function findNextReviewHunkIndex(
  hunks: readonly Pick<SuggestionHunk, "id">[],
  decisions: Readonly<Record<string, SuggestionDecision>>,
  currentIndex: number,
  direction: 1 | -1,
): number {
  const count = hunks.length;
  if (count === 0) return 0;
  const clamped = Math.max(0, Math.min(count - 1, currentIndex));

  for (let offset = 1; offset <= count; offset += 1) {
    const candidateIdx = (clamped + direction * offset + count * 2) % count;
    const candidate = hunks[candidateIdx];
    if (candidate && (decisions[candidate.id] ?? "pending") === "pending") {
      return candidateIdx;
    }
  }

  return (clamped + direction + count) % count;
}

/**
 * Applies a decision to `hunkId`, pushes an undo record onto `history`, and advances `activeIndex`.
 */
export function applyHunkDecisionWithHistory(
  state: ReviewSessionState,
  hunkId: string,
  hunkIndex: number,
  decision: SuggestionDecision,
  hunks: readonly Pick<SuggestionHunk, "id">[],
): ReviewSessionState {
  const prevDecision = state.decisions[hunkId] ?? "pending";
  const nextDecisions: Record<string, SuggestionDecision> = {
    ...state.decisions,
    [hunkId]: decision,
  };
  const nextHistory: ReviewHistoryEntry[] = [
    ...state.history,
    { hunkId, prevDecision, prevIndex: hunkIndex },
  ];
  const nextIndex = findNextReviewHunkIndex(hunks, nextDecisions, hunkIndex, 1);
  return {
    decisions: nextDecisions,
    activeIndex: nextIndex,
    history: nextHistory,
  };
}

/**
 * Undoes the most recent hunk decision and restores focus to that hunk index.
 */
export function undoLastHunkDecision(state: ReviewSessionState): ReviewSessionState {
  if (state.history.length === 0) return state;
  const last = state.history[state.history.length - 1]!;
  const nextDecisions = { ...state.decisions };
  const rollbackItems = last.changes ?? [
    { hunkId: last.hunkId, prevDecision: last.prevDecision },
  ];
  for (const item of rollbackItems) {
    if (item.prevDecision === "pending") {
      delete nextDecisions[item.hunkId];
    } else {
      nextDecisions[item.hunkId] = item.prevDecision;
    }
  }
  return {
    decisions: nextDecisions,
    activeIndex: last.prevIndex,
    history: state.history.slice(0, -1),
  };
}
