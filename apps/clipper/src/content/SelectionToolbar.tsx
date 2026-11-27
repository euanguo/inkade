import {
  extractSelectionHighlightAnchor,
  extractSelectionMarkdown,
  type ExtractedHighlightAnchor,
} from "@inkade/clipper-core/extractor";
import type { HighlightColor } from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import { Copy, EyeOff, MessageSquarePlus, Scissors, Send, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";

export interface SelectionToolbarProps {
  readonly enabled: boolean;
  readonly defaultHighlightColor?: HighlightColor | undefined;
  readonly readerArticleEl?: HTMLElement | null | undefined;
  readonly shadowRoot?: ShadowRoot | null | undefined;
  readonly onCreateHighlight: (
    anchor: ExtractedHighlightAnchor,
    color: HighlightColor,
    noteMarkdown: string,
  ) => Promise<void>;
  readonly onClipSelection: (
    anchor: ExtractedHighlightAnchor,
    selectionMarkdown: string,
  ) => Promise<void>;
  readonly onAskAde: (anchor: ExtractedHighlightAnchor, prompt?: string) => Promise<void>;
  readonly onCopied: () => void;
  readonly onHiddenForSession?: ((restore: () => void) => void) | undefined;
  readonly onSelectionChange?:
    | ((selection: ExtractedHighlightAnchor | null, selectionMarkdown: string) => void)
    | undefined;
}

interface FloatingSelectionState {
  readonly anchor: ExtractedHighlightAnchor;
  readonly selectionMarkdown: string;
  readonly rectTop: number;
  readonly rectBottom: number;
  readonly rectCenterX: number;
}

function isDisallowedSelectionNode(node: Node | null, readerArticleEl?: HTMLElement | null): boolean {
  const el = node instanceof Element ? node : node?.parentElement ?? null;
  if (!el) return false;
  if (el.closest("[data-inkade-ui-chrome='true'], .ink-float-card, .ink-reader-bar, .ink-toast-stack")) {
    return true;
  }
  const insideHostShadow = Boolean(el.closest("#inkade-clipper-root"));
  if (insideHostShadow) {
    // Only allow selections inside the Shadow DOM Reader article body
    if (!readerArticleEl || !readerArticleEl.contains(el)) {
      return true;
    }
  }
  if (el.closest("input, textarea, select, [contenteditable='true'], [contenteditable='']")) {
    return true;
  }
  return false;
}

export function SelectionToolbar({
  enabled,
  defaultHighlightColor = "amber",
  readerArticleEl,
  shadowRoot,
  onCreateHighlight,
  onClipSelection,
  onAskAde,
  onCopied,
  onHiddenForSession,
  onSelectionChange,
}: SelectionToolbarProps) {
  const { t } = useInkadeTranslation();
  const [hiddenForSession, setHiddenForSession] = useState(false);
  const [state, setState] = useState<FloatingSelectionState | null>(null);
  const [activePopover, setActivePopover] = useState<"none" | "note" | "ade">("none");
  const [noteText, setNoteText] = useState("");
  const [adePrompt, setAdePrompt] = useState("");
  const [noteColor, setNoteColor] = useState<HighlightColor>(defaultHighlightColor);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (activePopover === "none") {
      setNoteColor(defaultHighlightColor);
    }
  }, [defaultHighlightColor, activePopover]);

  useEffect(() => {
    setState(null);
    setActivePopover("none");
    setNoteText("");
    setAdePrompt("");
    onSelectionChange?.(null, "");
  }, [readerArticleEl, onSelectionChange]);

  useEffect(() => {
    if (!enabled || hiddenForSession || typeof document === "undefined") {
      setState(null);
      setActivePopover("none");
      return;
    }

    const resolveSelection = (): Selection | null => {
      const shadowSel = (
        shadowRoot as (ShadowRoot & { getSelection?: () => Selection | null }) | null
      )?.getSelection?.();
      if (shadowSel && !shadowSel.isCollapsed && shadowSel.rangeCount > 0) {
        return shadowSel;
      }
      return window.getSelection();
    };

    const inspectSelection = () => {
      const sel = resolveSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        if (activePopover === "none") {
          setState(null);
          onSelectionChange?.(null, "");
        }
        return;
      }
      if (isDisallowedSelectionNode(sel.anchorNode, readerArticleEl)) {
        return;
      }
      const text = sel.toString().trim();
      if (text.length < 2) {
        if (activePopover === "none") {
          setState(null);
          onSelectionChange?.(null, "");
        }
        return;
      }

      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;

      const anchor = extractSelectionHighlightAnchor(document, {
        pageUrl: window.location.href,
        title: document.title,
        selection: sel,
        rootNode: readerArticleEl && readerArticleEl.contains(sel.anchorNode) ? readerArticleEl : document.body,
      });
      if (!anchor) return;

      const selectionMarkdown = extractSelectionMarkdown(document, window.location.href, sel);
      onSelectionChange?.(anchor, selectionMarkdown);
      setState({
        anchor,
        selectionMarkdown,
        rectTop: rect.top,
        rectBottom: rect.bottom,
        rectCenterX: rect.left + rect.width / 2,
      });
    };

    const onMouseUp = () => {
      window.setTimeout(inspectSelection, 20);
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setActivePopover("none");
        setState(null);
        return;
      }
      if (e.shiftKey) window.setTimeout(inspectSelection, 20);
    };

    const onMouseDown = (e: MouseEvent) => {
      const path = typeof e.composedPath === "function" ? e.composedPath() : [];
      const insideToolbar = path.some(
        (node) => node instanceof Element && node.classList?.contains("ink-toolbar"),
      );
      if (!insideToolbar) {
        setActivePopover("none");
        setNoteText("");
        setAdePrompt("");
      }
    };

    const onScroll = () => {
      if (activePopover === "none") {
        inspectSelection();
      }
    };

    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("keyup", onKeyUp);
    document.addEventListener("mousedown", onMouseDown);
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    readerArticleEl?.addEventListener("mouseup", onMouseUp);
    readerArticleEl?.addEventListener("mousedown", onMouseDown);

    return () => {
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("scroll", onScroll, true);
      readerArticleEl?.removeEventListener("mouseup", onMouseUp);
      readerArticleEl?.removeEventListener("mousedown", onMouseDown);
    };
  }, [enabled, hiddenForSession, activePopover, readerArticleEl, shadowRoot, onSelectionChange]);

  if (!enabled || hiddenForSession || !state) return null;

  const colorLabel = (color: HighlightColor): string => {
    if (color === "amber") return t("clipper.colorAmber");
    if (color === "emerald") return t("clipper.colorEmerald");
    if (color === "blue") return t("clipper.colorBlue");
    return t("clipper.colorRose");
  };

  const handleHighlight = async (color: HighlightColor, note = "") => {
    setBusy(true);
    try {
      await onCreateHighlight(state.anchor, color, note);
      window.getSelection()?.removeAllRanges();
      setState(null);
      setActivePopover("none");
      setNoteText("");
    } finally {
      setBusy(false);
    }
  };

  const handleSubmitAde = async (overridePrompt?: string) => {
    const finalPrompt = (overridePrompt ?? adePrompt).trim() || t("clipper.adePresetSummarize");
    setBusy(true);
    try {
      await onAskAde(state.anchor, finalPrompt);
      setState(null);
      setActivePopover("none");
      setAdePrompt("");
    } finally {
      setBusy(false);
    }
  };

  const handleCopyQuote = async () => {
    const md = `> ${state.anchor.quote.replace(/\n/g, "\n> ")}\n\n— [${state.anchor.title || state.anchor.url}](${state.anchor.url})`;
    try {
      await navigator.clipboard.writeText(md);
      onCopied();
    } catch {
      // ignore clipboard errors
    }
    setState(null);
  };

  const estimatedWidth = activePopover !== "none" ? 300 : 286;
  const estimatedHeight = activePopover !== "none" ? 176 : 44;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;

  const left = Math.min(
    Math.max(12, state.rectCenterX - estimatedWidth / 2),
    Math.max(12, vw - estimatedWidth - 12),
  );
  const preferAbove = state.rectTop > estimatedHeight + 14;
  const fitsBelow = state.rectBottom + 10 + estimatedHeight < vh - 12;
  const top =
    activePopover !== "none" && !fitsBelow && preferAbove
      ? Math.max(12, state.rectTop - estimatedHeight - 10)
      : state.rectTop > 58 && (activePopover === "none" || !fitsBelow)
        ? Math.max(12, state.rectTop - estimatedHeight - 10)
        : Math.min(Math.max(12, vh - estimatedHeight - 12), state.rectBottom + 10);

  const adePresets = [
    t("clipper.adePresetSummarize"),
    t("clipper.adePresetFactCheck"),
    t("clipper.adePresetArchitecture"),
  ];

  return (
    <div
      className="ink-float-card ink-toolbar"
      data-inkade-ui-chrome="true"
      onMouseDown={(e) => e.stopPropagation()}
      onMouseUp={(e) => e.stopPropagation()}
      style={{ left, top }}
    >
      <div className="ink-toolbar-row">
        {(["amber", "emerald", "blue", "rose"] as const).map((color) => (
          <button
            aria-label={colorLabel(color)}
            className={`ink-dot-btn ${color}`}
            disabled={busy}
            key={color}
            onClick={() => void handleHighlight(color)}
            title={colorLabel(color)}
            type="button"
          />
        ))}
        <span className="ink-sep" />
        <button
          aria-label={t("clipper.toolbarAddNote")}
          className="ink-icon-btn"
          disabled={busy}
          onClick={() => {
            setActivePopover((v) => (v === "note" ? "none" : "note"));
          }}
          title={t("clipper.toolbarAddNote")}
          type="button"
        >
          <MessageSquarePlus size={14} />
        </button>
        <button
          aria-label={t("clipper.toolbarClipSelection")}
          className="ink-icon-btn"
          disabled={busy}
          onClick={() =>
            void (async () => {
              setBusy(true);
              try {
                await onClipSelection(state.anchor, state.selectionMarkdown);
                setState(null);
              } finally {
                setBusy(false);
              }
            })()
          }
          title={t("clipper.toolbarClipSelection")}
          type="button"
        >
          <Scissors size={14} />
        </button>
        <button
          aria-label={t("clipper.toolbarAskAde")}
          className="ink-icon-btn"
          disabled={busy}
          onClick={() => {
            setActivePopover((v) => (v === "ade" ? "none" : "ade"));
          }}
          title={t("clipper.toolbarAskAde")}
          type="button"
        >
          <Sparkles size={14} />
        </button>
        <button
          aria-label={t("clipper.toolbarCopyQuote")}
          className="ink-icon-btn"
          onClick={() => void handleCopyQuote()}
          title={t("clipper.toolbarCopyQuote")}
          type="button"
        >
          <Copy size={14} />
        </button>
        <button
          aria-label={t("clipper.toolbarHidePage")}
          className="ink-icon-btn"
          onClick={() => {
            setHiddenForSession(true);
            setState(null);
            setActivePopover("none");
            onHiddenForSession?.(() => setHiddenForSession(false));
          }}
          title={t("clipper.toolbarHidePage")}
          type="button"
        >
          <EyeOff size={13} />
        </button>
      </div>

      {activePopover === "note" ? (
        <div className="ink-popover" style={{ width: 274, padding: "4px 2px 2px" }}>
          <textarea
            autoFocus
            className="ink-popover-textarea"
            onChange={(e) => setNoteText(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                void handleHighlight(noteColor, noteText);
              }
            }}
            placeholder={t("clipper.toolbarNotePlaceholder")}
            value={noteText}
          />
          <div className="ink-popover-actions">
            <div className="ink-toolbar-row">
              {(["amber", "emerald", "blue", "rose"] as const).map((color) => (
                <button
                  aria-label={colorLabel(color)}
                  aria-pressed={noteColor === color}
                  className={`ink-dot-btn ${color}${noteColor === color ? " active" : ""}`}
                  key={color}
                  onClick={() => setNoteColor(color)}
                  title={colorLabel(color)}
                  type="button"
                />
              ))}
            </div>
            <button
              className="ink-btn-sm primary"
              disabled={busy}
              onClick={() => void handleHighlight(noteColor, noteText)}
              type="button"
            >
              {t("clipper.toolbarSaveNoteBtn")}
            </button>
          </div>
        </div>
      ) : null}

      {activePopover === "ade" ? (
        <div className="ink-popover" style={{ width: 282, padding: "4px 2px 2px" }}>
          <div className="ink-popover-actions">
            <div className="ink-toolbar-row" style={{ flexWrap: "wrap" }}>
              {adePresets.map((preset) => (
                <button
                  className="ink-btn-sm"
                  disabled={busy}
                  key={preset}
                  onClick={() => setAdePrompt(preset)}
                  type="button"
                >
                  {preset}
                </button>
              ))}
            </div>
            <button
              aria-label={t("common.close")}
              className="ink-icon-btn"
              onClick={() => setActivePopover("none")}
              type="button"
            >
              <X size={12} />
            </button>
          </div>
          <textarea
            autoFocus
            className="ink-popover-textarea"
            onChange={(e) => setAdePrompt(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                void handleSubmitAde();
              }
            }}
            placeholder={t("clipper.toolbarAdePromptPlaceholder")}
            value={adePrompt}
          />
          <div className="ink-popover-actions">
            <span style={{ fontSize: "11px", opacity: 0.72 }}>{t("clipper.toolbarAdeCmdEnterHint")}</span>
            <button
              className="ink-btn-sm primary"
              disabled={busy}
              onClick={() => void handleSubmitAde()}
              type="button"
            >
              <Send size={11} />
              <span>{t("clipper.toolbarAskAdeSend")}</span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
