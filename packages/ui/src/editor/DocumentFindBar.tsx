import { useInkadeTranslation } from "@inkade/i18n";
import type { Editor } from "@tiptap/react";
import {
  CaseSensitiveIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ReplaceAllIcon,
  ReplaceIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "../lib/utils.ts";
import { Button } from "../primitives/button.tsx";
import { Input } from "../primitives/input.tsx";
import {
  dispatchClearSearch,
  dispatchFindNextMatch,
  dispatchFindPreviousMatch,
  dispatchReplaceAllMatches,
  dispatchReplaceCurrentMatch,
  dispatchSetSearchTerm,
  getSearchReplaceState,
} from "./extensions/search-replace.ts";

export interface DocumentFindBarProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** Live TipTap editor instance when editing articles/clips. */
  readonly editor?: Editor | null | undefined;
  /** DOM fallback container when searching Read mode or Outline DOM without TipTap search extension. */
  readonly containerRef?: React.RefObject<HTMLElement | null> | undefined;
  readonly canReplace?: boolean | undefined;
  readonly initialShowReplace?: boolean | undefined;
  readonly className?: string | undefined;
}

const DOM_MARK_ATTR = "data-inkade-dom-search";
const DOM_ACTIVE_ATTR = "data-inkade-dom-search-active";

function clearDomHighlights(root: HTMLElement | null): void {
  if (!root) return;
  const marks = root.querySelectorAll(`mark[${DOM_MARK_ATTR}]`);
  for (const mark of marks) {
    const parent = mark.parentNode;
    if (!parent) continue;
    const text = document.createTextNode(mark.textContent ?? "");
    parent.replaceChild(text, mark);
    parent.normalize();
  }
}

function applyDomHighlights(
  root: HTMLElement | null,
  query: string,
  caseSensitive: boolean,
): HTMLElement[] {
  clearDomHighlights(root);
  if (!root || !query) {
    return [];
  }

  const needle = caseSensitive ? query : query.toLowerCase();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parentEl = node.parentElement;
      if (!parentEl) return NodeFilter.FILTER_REJECT;
      if (parentEl.closest("[data-inkade-ui-overlay]") || parentEl.closest('[data-testid="document-find-bar"]')) {
        return NodeFilter.FILTER_REJECT;
      }
      const tag = parentEl.tagName;
      if (tag === "SCRIPT" || tag === "STYLE" || tag === "TEXTAREA" || tag === "INPUT") {
        return NodeFilter.FILTER_REJECT;
      }
      const value = node.nodeValue ?? "";
      if (!value) return NodeFilter.FILTER_REJECT;
      const hay = caseSensitive ? value : value.toLowerCase();
      return hay.includes(needle) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    },
  });

  const textNodes: Text[] = [];
  let curr = walker.nextNode();
  while (curr) {
    textNodes.push(curr as Text);
    curr = walker.nextNode();
  }

  const createdMarks: HTMLElement[] = [];
  for (const textNode of textNodes) {
    const raw = textNode.nodeValue ?? "";
    const hay = caseSensitive ? raw : raw.toLowerCase();
    let start = 0;
    const frag = document.createDocumentFragment();
    let changed = false;

    while (start <= hay.length - needle.length) {
      const idx = hay.indexOf(needle, start);
      if (idx === -1) break;
      changed = true;
      if (idx > start) {
        frag.appendChild(document.createTextNode(raw.slice(start, idx)));
      }
      const mark = document.createElement("mark");
      mark.setAttribute(DOM_MARK_ATTR, "true");
      mark.className = "inkade-search-match";
      mark.textContent = raw.slice(idx, idx + needle.length);
      frag.appendChild(mark);
      createdMarks.push(mark);
      start = idx + Math.max(1, needle.length);
    }

    if (changed) {
      if (start < raw.length) {
        frag.appendChild(document.createTextNode(raw.slice(start)));
      }
      textNode.parentNode?.replaceChild(frag, textNode);
    }
  }

  return createdMarks;
}

export function DocumentFindBar({
  open,
  onClose,
  editor,
  containerRef,
  canReplace = false,
  initialShowReplace = false,
  className,
}: DocumentFindBarProps): React.ReactElement | null {
  const { t } = useInkadeTranslation();
  const [query, setQuery] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [showReplace, setShowReplace] = useState(initialShowReplace);
  const [matchCount, setMatchCount] = useState(0);
  const [activeIndex, setActiveIndex] = useState(-1);
  const queryInputRef = useRef<HTMLInputElement | null>(null);
  const domMarksRef = useRef<HTMLElement[]>([]);

  const usesEditorEngine = Boolean(editor);

  useLayoutEffect(() => {
    if (!open) return undefined;
    setShowReplace((prev) => prev || initialShowReplace);
    const input = queryInputRef.current;
    input?.focus();
    input?.select();
    if (
      typeof window === "undefined" ||
      (typeof document !== "undefined" && document.activeElement === input)
    ) {
      return undefined;
    }
    const id = window.requestAnimationFrame(() => {
      queryInputRef.current?.focus();
      queryInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(id);
  }, [open, initialShowReplace]);

  // Sync query & case sensitivity to TipTap SearchReplace extension
  useEffect(() => {
    if (!open) {
      if (editor) {
        dispatchClearSearch(editor);
      }
      clearDomHighlights(containerRef?.current ?? null);
      domMarksRef.current = [];
      setMatchCount(0);
      setActiveIndex(-1);
      return;
    }

    if (editor) {
      dispatchSetSearchTerm(editor, query, caseSensitive);
      const state = getSearchReplaceState(editor.state);
      setMatchCount(state.matches.length);
      setActiveIndex(state.activeIndex);
      return;
    }

    // DOM fallback search (read-only / outliner)
    const container = containerRef?.current ?? null;
    const marks = applyDomHighlights(container, query, caseSensitive);
    domMarksRef.current = marks;
    setMatchCount(marks.length);
    if (marks.length > 0) {
      setActiveIndex(0);
      marks[0]!.classList.add("inkade-search-match-active");
      marks[0]!.setAttribute(DOM_ACTIVE_ATTR, "true");
      marks[0]!.scrollIntoView({ block: "center", behavior: "smooth" });
    } else {
      setActiveIndex(-1);
    }

    return () => {
      clearDomHighlights(container);
      domMarksRef.current = [];
    };
  }, [open, query, caseSensitive, editor, containerRef]);

  // Subscribe to TipTap transactions so match counter stays exact after edits or replacements
  useEffect(() => {
    if (!open || !editor) return;
    const syncState = (): void => {
      const st = getSearchReplaceState(editor.state);
      setMatchCount(st.matches.length);
      setActiveIndex(st.activeIndex);
    };
    editor.on("transaction", syncState);
    return () => {
      editor.off("transaction", syncState);
    };
  }, [open, editor]);

  const highlightDomIndex = useCallback((nextIdx: number) => {
    const marks = domMarksRef.current;
    if (marks.length === 0) return;
    const normalized = ((nextIdx % marks.length) + marks.length) % marks.length;
    for (let i = 0; i < marks.length; i += 1) {
      const m = marks[i]!;
      if (i === normalized) {
        m.classList.add("inkade-search-match-active");
        m.setAttribute(DOM_ACTIVE_ATTR, "true");
        m.scrollIntoView({ block: "center", behavior: "smooth" });
      } else {
        m.classList.remove("inkade-search-match-active");
        m.removeAttribute(DOM_ACTIVE_ATTR);
      }
    }
    setActiveIndex(normalized);
  }, []);

  const handleNext = useCallback(() => {
    if (editor) {
      dispatchFindNextMatch(editor);
      return;
    }
    if (domMarksRef.current.length > 0) {
      highlightDomIndex((activeIndex < 0 ? 0 : activeIndex) + 1);
    }
  }, [editor, activeIndex, highlightDomIndex]);

  const handlePrevious = useCallback(() => {
    if (editor) {
      dispatchFindPreviousMatch(editor);
      return;
    }
    if (domMarksRef.current.length > 0) {
      highlightDomIndex((activeIndex <= 0 ? 0 : activeIndex) - 1);
    }
  }, [editor, activeIndex, highlightDomIndex]);

  const handleClose = useCallback(() => {
    if (editor) {
      dispatchClearSearch(editor);
    }
    clearDomHighlights(containerRef?.current ?? null);
    domMarksRef.current = [];
    onClose();
  }, [editor, containerRef, onClose]);

  if (!open) {
    return null;
  }

  const countLabel =
    query.length === 0
      ? ""
      : matchCount > 0 && activeIndex >= 0
        ? t("editor.findMatchCounter", { current: activeIndex + 1, total: matchCount })
        : t("editor.findNoMatches");

  return (
    <div
      className={cn(
        "not-typeset sticky top-2 z-30 ms-auto flex w-fit max-w-full flex-col gap-1.5 rounded-lg border border-[var(--border-overlay)] bg-popover p-2 text-popover-foreground shadow-[var(--shadow-overlay)]",
        className,
      )}
      data-inkade-ui-overlay="true"
      data-testid="document-find-bar"
      role="search"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="relative flex min-w-44 items-center sm:min-w-56">
          <Input
            aria-label={t("editor.findInputAria")}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                handleClose();
              } else if (e.key === "Enter") {
                e.preventDefault();
                if (e.shiftKey) {
                  handlePrevious();
                } else {
                  handleNext();
                }
              }
            }}
            placeholder={t("editor.findPlaceholder")}
            ref={queryInputRef}
            size="xs"
            startAddon={<SearchIcon className="size-3.5 text-muted-foreground" />}
            value={query}
          />
        </div>

        <Button
          aria-label={t("editor.findCaseSensitiveAria")}
          aria-pressed={caseSensitive}
          onClick={() => setCaseSensitive((prev) => !prev)}
          size="icon-xs"
          title={t("editor.findCaseSensitiveAria")}
          type="button"
          variant={caseSensitive ? "secondary" : "ghost"}
        >
          <CaseSensitiveIcon className="size-3.5" />
        </Button>

        {countLabel ? (
          <span
            className="min-w-12 px-1 text-center font-mono text-[11px] tabular-nums text-muted-foreground"
            data-testid="document-find-counter"
          >
            {countLabel}
          </span>
        ) : null}

        <Button
          aria-label={t("editor.findPreviousAria")}
          disabled={matchCount === 0}
          onClick={handlePrevious}
          size="icon-xs"
          title={t("editor.findPreviousAria")}
          type="button"
          variant="ghost"
        >
          <ChevronUpIcon className="size-3.5" />
        </Button>

        <Button
          aria-label={t("editor.findNextAria")}
          disabled={matchCount === 0}
          onClick={handleNext}
          size="icon-xs"
          title={t("editor.findNextAria")}
          type="button"
          variant="ghost"
        >
          <ChevronDownIcon className="size-3.5" />
        </Button>

        {canReplace && usesEditorEngine && (
          <Button
            aria-label={t("editor.findToggleReplaceAria")}
            aria-pressed={showReplace}
            onClick={() => setShowReplace((prev) => !prev)}
            size="icon-xs"
            title={t("editor.findToggleReplaceAria")}
            type="button"
            variant={showReplace ? "secondary" : "ghost"}
          >
            <ReplaceIcon className="size-3.5" />
          </Button>
        )}

        <Button
          aria-label={t("common.close")}
          onClick={handleClose}
          size="icon-xs"
          type="button"
          variant="ghost"
        >
          <XIcon className="size-3.5" />
        </Button>
      </div>

      {canReplace && usesEditorEngine && showReplace && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-1.5">
          <div className="flex min-w-44 flex-1 items-center sm:min-w-56">
            <Input
              aria-label={t("editor.replaceInputAria")}
              onChange={(e) => setReplaceText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  handleClose();
                } else if (e.key === "Enter" && editor) {
                  e.preventDefault();
                  dispatchReplaceCurrentMatch(editor, replaceText);
                }
              }}
              placeholder={t("editor.replacePlaceholder")}
              size="xs"
              value={replaceText}
            />
          </div>
          <Button
            disabled={matchCount === 0}
            onClick={() => editor && dispatchReplaceCurrentMatch(editor, replaceText)}
            size="xs"
            type="button"
            variant="outline"
          >
            <ReplaceIcon className="size-3" />
            <span>{t("editor.replaceOne")}</span>
          </Button>
          <Button
            disabled={matchCount === 0}
            onClick={() => editor && dispatchReplaceAllMatches(editor, replaceText)}
            size="xs"
            type="button"
            variant="outline"
          >
            <ReplaceAllIcon className="size-3" />
            <span>{t("editor.replaceAll")}</span>
          </Button>
        </div>
      )}
    </div>
  );
}
