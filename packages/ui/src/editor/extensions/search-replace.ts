import type { Node as PmNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { type Editor, Extension } from "@tiptap/react";

export interface SearchMatchRange {
  readonly from: number;
  readonly to: number;
}

export interface SearchReplacePluginState {
  readonly query: string;
  readonly caseSensitive: boolean;
  readonly activeIndex: number;
  readonly matches: readonly SearchMatchRange[];
  readonly decorations: DecorationSet;
}

export const searchReplacePluginKey = new PluginKey<SearchReplacePluginState>(
  "inkadeSearchReplace",
);

interface SearchMetaAction {
  readonly type: "setQuery" | "setActiveIndex" | "clear";
  readonly query?: string | undefined;
  readonly caseSensitive?: boolean | undefined;
  readonly activeIndex?: number | undefined;
}

/**
 * Finds all non-overlapping matches of `query` within each textblock of a ProseMirror document,
 * mapping text offsets accurately across inline marks (bold, links, code) to ProseMirror positions.
 */
export function findSearchMatches(
  doc: PmNode,
  query: string,
  caseSensitive = false,
): readonly SearchMatchRange[] {
  if (!query) {
    return [];
  }

  const needle = caseSensitive ? query : query.toLowerCase();
  if (!needle) {
    return [];
  }

  const results: SearchMatchRange[] = [];

  doc.descendants((node, pos) => {
    if (!node.isTextblock) {
      return true;
    }

    const chars: string[] = [];
    const positions: number[] = [];
    const blockStart = pos + 1;

    node.descendants((child, childOffset) => {
      const absPos = blockStart + childOffset;
      if (child.isText && child.text) {
        for (let i = 0; i < child.text.length; i += 1) {
          chars.push(child.text[i]!);
          positions.push(absPos + i);
        }
      } else if (child.isLeaf) {
        chars.push("\uFFFC");
        positions.push(absPos);
      }
      return false;
    });

    if (chars.length === 0) {
      return false;
    }

    const rawText = chars.join("");
    const haystack = caseSensitive ? rawText : rawText.toLowerCase();

    let offset = 0;
    while (offset <= haystack.length - needle.length) {
      const idx = haystack.indexOf(needle, offset);
      if (idx === -1) {
        break;
      }
      const startPos = positions[idx];
      const endPos = positions[idx + needle.length - 1];
      if (startPos !== undefined && endPos !== undefined) {
        results.push({
          from: startPos,
          to: endPos + 1,
        });
      }
      offset = idx + Math.max(1, needle.length);
    }

    return false;
  });

  return results;
}

function buildSearchDecorations(
  doc: PmNode,
  matches: readonly SearchMatchRange[],
  activeIndex: number,
): DecorationSet {
  if (matches.length === 0) {
    return DecorationSet.empty;
  }
  const decorations = matches.map((match, idx) =>
    Decoration.inline(match.from, match.to, {
      class:
        idx === activeIndex
          ? "inkade-search-match inkade-search-match-active"
          : "inkade-search-match",
      "data-search-match-index": String(idx),
    }),
  );
  return DecorationSet.create(doc, decorations);
}

function normalizeActiveIndex(requested: number, count: number): number {
  if (count <= 0) {
    return -1;
  }
  if (requested < 0) {
    return ((requested % count) + count) % count;
  }
  return requested % count;
}

export function createSearchReplacePlugin(): Plugin<SearchReplacePluginState> {
  return new Plugin<SearchReplacePluginState>({
    key: searchReplacePluginKey,
    state: {
      init(): SearchReplacePluginState {
        return {
          query: "",
          caseSensitive: false,
          activeIndex: -1,
          matches: [],
          decorations: DecorationSet.empty,
        };
      },
      apply(tr, value, _oldState, newState): SearchReplacePluginState {
        const meta = tr.getMeta(searchReplacePluginKey) as SearchMetaAction | undefined;
        let query = value.query;
        let caseSensitive = value.caseSensitive;
        let requestedIndex = value.activeIndex;
        let needsRecompute = tr.docChanged;

        if (meta) {
          if (meta.type === "clear") {
            return {
              query: "",
              caseSensitive: value.caseSensitive,
              activeIndex: -1,
              matches: [],
              decorations: DecorationSet.empty,
            };
          }
          if (meta.type === "setQuery") {
            const nextQuery = meta.query ?? "";
            const nextCase = meta.caseSensitive ?? value.caseSensitive;
            if (nextQuery !== query || nextCase !== caseSensitive) {
              query = nextQuery;
              caseSensitive = nextCase;
              needsRecompute = true;
            }
            if (meta.activeIndex !== undefined) {
              requestedIndex = meta.activeIndex;
              needsRecompute = true;
            } else if (needsRecompute) {
              requestedIndex = nextQuery ? 0 : -1;
            }
          } else if (meta.type === "setActiveIndex") {
            requestedIndex = meta.activeIndex ?? 0;
            const nextActive = normalizeActiveIndex(requestedIndex, value.matches.length);
            return {
              ...value,
              activeIndex: nextActive,
              decorations: buildSearchDecorations(newState.doc, value.matches, nextActive),
            };
          }
        }

        if (!needsRecompute) {
          return value;
        }

        if (!query) {
          return {
            query: "",
            caseSensitive,
            activeIndex: -1,
            matches: [],
            decorations: DecorationSet.empty,
          };
        }

        const matches = findSearchMatches(newState.doc, query, caseSensitive);
        const activeIndex = normalizeActiveIndex(
          requestedIndex < 0 ? 0 : requestedIndex,
          matches.length,
        );
        return {
          query,
          caseSensitive,
          activeIndex,
          matches,
          decorations: buildSearchDecorations(newState.doc, matches, activeIndex),
        };
      },
    },
    props: {
      decorations(state) {
        return searchReplacePluginKey.getState(state)?.decorations ?? null;
      },
    },
  });
}

export function getSearchReplaceState(state: EditorState): SearchReplacePluginState {
  return (
    searchReplacePluginKey.getState(state) ?? {
      query: "",
      caseSensitive: false,
      activeIndex: -1,
      matches: [],
      decorations: DecorationSet.empty,
    }
  );
}

export function setSearchQueryTransaction(
  tr: Transaction,
  query: string,
  caseSensitive = false,
  activeIndex?: number,
): Transaction {
  return tr.setMeta(searchReplacePluginKey, {
    type: "setQuery",
    query,
    caseSensitive,
    activeIndex,
  } satisfies SearchMetaAction);
}

export function stepSearchMatchTransaction(
  state: EditorState,
  delta: 1 | -1,
): Transaction | null {
  const current = getSearchReplaceState(state);
  if (current.matches.length === 0) {
    return null;
  }
  const base = current.activeIndex < 0 ? 0 : current.activeIndex;
  const nextIndex = normalizeActiveIndex(base + delta, current.matches.length);
  const match = current.matches[nextIndex];
  const tr = state.tr.setMeta(searchReplacePluginKey, {
    type: "setActiveIndex",
    activeIndex: nextIndex,
  } satisfies SearchMetaAction);
  if (match) {
    tr.setSelection(TextSelection.create(tr.doc, match.from, match.to)).scrollIntoView();
  }
  return tr;
}

export function replaceActiveMatchTransaction(
  state: EditorState,
  replacement: string,
): Transaction | null {
  const current = getSearchReplaceState(state);
  if (current.matches.length === 0) {
    return null;
  }
  const idx = current.activeIndex >= 0 ? current.activeIndex : 0;
  const match = current.matches[idx];
  if (!match) {
    return null;
  }
  const tr = state.tr;
  if (replacement.length > 0) {
    tr.replaceWith(match.from, match.to, state.schema.text(replacement));
  } else {
    tr.delete(match.from, match.to);
  }
  tr.setMeta(searchReplacePluginKey, {
    type: "setQuery",
    query: current.query,
    caseSensitive: current.caseSensitive,
    activeIndex: idx,
  } satisfies SearchMetaAction);
  return tr;
}

export function replaceAllMatchesTransaction(
  state: EditorState,
  replacement: string,
): Transaction | null {
  const current = getSearchReplaceState(state);
  if (current.matches.length === 0) {
    return null;
  }
  const tr = state.tr;
  // Apply from back to front so earlier document offsets remain valid
  for (let i = current.matches.length - 1; i >= 0; i -= 1) {
    const match = current.matches[i]!;
    if (replacement.length > 0) {
      tr.replaceWith(match.from, match.to, state.schema.text(replacement));
    } else {
      tr.delete(match.from, match.to);
    }
  }
  tr.setMeta(searchReplacePluginKey, {
    type: "setQuery",
    query: current.query,
    caseSensitive: current.caseSensitive,
    activeIndex: 0,
  } satisfies SearchMetaAction);
  return tr;
}

export function scrollActiveSearchMatchIntoView(editor: Editor): void {
  if (typeof window === "undefined") return;
  const runScroll = (): void => {
    try {
      const dom = editor.view?.dom;
      if (!dom) return;
      const activeEl = dom.querySelector<HTMLElement>(".inkade-search-match-active");
      if (activeEl && typeof activeEl.scrollIntoView === "function") {
        activeEl.scrollIntoView({ block: "center", behavior: "auto" });
        return;
      }
      const st = getSearchReplaceState(editor.state);
      const activeMatch = st.matches[st.activeIndex];
      if (!activeMatch) return;
      const resolved = editor.view.domAtPos(activeMatch.from);
      const el =
        resolved.node instanceof HTMLElement ? resolved.node : resolved.node?.parentElement;
      if (el && typeof el.scrollIntoView === "function") {
        el.scrollIntoView({ block: "center", behavior: "auto" });
      }
    } catch {
      // Ignore if editor view is detached or destroyed
    }
  };
  runScroll();
  if (typeof globalThis.requestAnimationFrame === "function") {
    globalThis.requestAnimationFrame(runScroll);
  }
}

export function dispatchSetSearchTerm(
  editor: Editor,
  query: string,
  caseSensitive = false,
): void {
  const { state } = editor;
  const tr = setSearchQueryTransaction(state.tr, query, caseSensitive, query ? 0 : -1);
  const matches = findSearchMatches(state.doc, query, caseSensitive);
  if (matches.length > 0) {
    const first = matches[0]!;
    tr.setSelection(TextSelection.create(tr.doc, first.from, first.to)).scrollIntoView();
  }
  editor.view.dispatch(tr);
  if (matches.length > 0) {
    scrollActiveSearchMatchIntoView(editor);
  }
}

export function dispatchClearSearch(editor: Editor): void {
  editor.view.dispatch(
    editor.state.tr.setMeta(searchReplacePluginKey, {
      type: "clear",
    } satisfies SearchMetaAction),
  );
}

export function dispatchFindNextMatch(editor: Editor): boolean {
  const tr = stepSearchMatchTransaction(editor.state, 1);
  if (!tr) return false;
  editor.view.dispatch(tr);
  scrollActiveSearchMatchIntoView(editor);
  return true;
}

export function dispatchFindPreviousMatch(editor: Editor): boolean {
  const tr = stepSearchMatchTransaction(editor.state, -1);
  if (!tr) return false;
  editor.view.dispatch(tr);
  scrollActiveSearchMatchIntoView(editor);
  return true;
}

export function dispatchReplaceCurrentMatch(editor: Editor, replacement: string): boolean {
  const tr = replaceActiveMatchTransaction(editor.state, replacement);
  if (!tr) return false;
  editor.view.dispatch(tr);
  scrollActiveSearchMatchIntoView(editor);
  return true;
}

export function dispatchReplaceAllMatches(editor: Editor, replacement: string): boolean {
  const tr = replaceAllMatchesTransaction(editor.state, replacement);
  if (!tr) return false;
  editor.view.dispatch(tr);
  return true;
}

export const InkadeSearchReplaceExtension = Extension.create({
  name: "inkadeSearchReplace",

  addProseMirrorPlugins() {
    return [createSearchReplacePlugin()];
  },
});
