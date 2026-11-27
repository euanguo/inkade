import { describe, expect, test } from "bun:test";
import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import {
  createSearchReplacePlugin,
  dispatchFindNextMatch,
  dispatchFindPreviousMatch,
  dispatchSetSearchTerm,
  findSearchMatches,
  getSearchReplaceState,
  replaceActiveMatchTransaction,
  replaceAllMatchesTransaction,
  setSearchQueryTransaction,
  stepSearchMatchTransaction,
} from "./search-replace.ts";

const testSchema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      group: "block",
      content: "inline*",
    },
    text: { group: "inline" },
  },
  marks: {
    strong: {},
  },
});

function createSampleState(): EditorState {
  const doc = testSchema.node("doc", null, [
    testSchema.node("paragraph", null, [
      testSchema.text("Inkade notes with "),
      testSchema.text("inkade", [testSchema.marks.strong.create()]),
      testSchema.text(" search."),
    ]),
    testSchema.node("paragraph", null, [
      testSchema.text("Another INKADE match inside paragraph two."),
    ]),
  ]);

  return EditorState.create({
    schema: testSchema,
    doc,
    plugins: [createSearchReplacePlugin()],
  });
}

describe("Phase 33 — Inkade Search & Replace ProseMirror Plugin", () => {
  test("finds case-insensitive and case-sensitive matches across marks", () => {
    const state = createSampleState();

    const insensitive = findSearchMatches(state.doc, "inkade", false);
    expect(insensitive).toHaveLength(3);

    const sensitive = findSearchMatches(state.doc, "Inkade", true);
    expect(sensitive).toHaveLength(1);
    expect(state.doc.textBetween(sensitive[0]!.from, sensitive[0]!.to)).toBe("Inkade");
  });

  test("navigates next/prev cyclically and updates active decorations", () => {
    let state = createSampleState();
    state = state.apply(setSearchQueryTransaction(state.tr, "inkade", false, 0));

    expect(getSearchReplaceState(state).matches).toHaveLength(3);
    expect(getSearchReplaceState(state).activeIndex).toBe(0);

    const next1 = stepSearchMatchTransaction(state, 1);
    expect(next1).not.toBeNull();
    state = state.apply(next1!);
    expect(getSearchReplaceState(state).activeIndex).toBe(1);

    const next2 = stepSearchMatchTransaction(state, 1);
    state = state.apply(next2!);
    expect(getSearchReplaceState(state).activeIndex).toBe(2);

    // Wraps to 0
    const nextWrap = stepSearchMatchTransaction(state, 1);
    state = state.apply(nextWrap!);
    expect(getSearchReplaceState(state).activeIndex).toBe(0);

    // Backward wraps to 2
    const prevWrap = stepSearchMatchTransaction(state, -1);
    state = state.apply(prevWrap!);
    expect(getSearchReplaceState(state).activeIndex).toBe(2);
  });

  test("replaces current match and replaces all atomically", () => {
    let state = createSampleState();
    state = state.apply(setSearchQueryTransaction(state.tr, "inkade", false, 0));

    // Replace single match (#1 -> Craft)
    const stepNext = stepSearchMatchTransaction(state, 1);
    state = state.apply(stepNext!);
    expect(getSearchReplaceState(state).activeIndex).toBe(1);

    const singleTr = replaceActiveMatchTransaction(state, "Vault");
    expect(singleTr).not.toBeNull();
    state = state.apply(singleTr!);

    expect(state.doc.child(0).textContent).toBe("Inkade notes with Vault search.");
    expect(getSearchReplaceState(state).matches).toHaveLength(2);

    // Replace all remaining matches with Notebook
    const allTr = replaceAllMatchesTransaction(state, "Notebook");
    expect(allTr).not.toBeNull();
    state = state.apply(allTr!);

    expect(state.doc.child(0).textContent).toBe("Notebook notes with Vault search.");
    expect(state.doc.child(1).textContent).toBe("Another Notebook match inside paragraph two.");
    expect(getSearchReplaceState(state).matches).toHaveLength(0);
  });

  test("scrolls active .inkade-search-match-active element into center view when dispatching find queries or stepping", () => {
    const scrollCalls: ScrollIntoViewOptions[] = [];
    const activeMatchEl = {
      scrollIntoView: (opts: ScrollIntoViewOptions) => {
        scrollCalls.push(opts);
      },
    } as unknown as HTMLElement;

    let state = createSampleState();
    const mockEditor = {
      get state() {
        return state;
      },
      view: {
        dispatch(tr: Parameters<EditorState["apply"]>[0]) {
          state = state.apply(tr);
        },
        dom: {
          querySelector: (selector: string) =>
            selector === ".inkade-search-match-active" ? activeMatchEl : null,
        },
      },
    } as unknown as Editor;

    const prevWindow = (globalThis as { window?: unknown }).window;
    Object.assign(globalThis, {
      window: {
        requestAnimationFrame: () => 1,
      },
    });
    try {
      dispatchSetSearchTerm(mockEditor, "inkade", false);
      expect(scrollCalls).toHaveLength(1);
      expect(scrollCalls[0]).toEqual({ block: "center", behavior: "auto" });

      expect(dispatchFindNextMatch(mockEditor)).toBe(true);
      expect(scrollCalls).toHaveLength(2);

      expect(dispatchFindPreviousMatch(mockEditor)).toBe(true);
      expect(scrollCalls).toHaveLength(3);
    } finally {
      if (prevWindow === undefined) {
        delete (globalThis as { window?: unknown }).window;
      } else {
        Object.assign(globalThis, { window: prevWindow });
      }
    }
  });
});
