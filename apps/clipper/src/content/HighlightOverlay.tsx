import type { DocumentHighlight, DocumentId, HighlightColor, HighlightId } from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import { ExternalLink, MessageSquare, Sparkles, Trash2, X } from "lucide-react";
import React, { useEffect, useState } from "react";
import {
  computeHighlightGeometries,
  type HighlightOverlayGeometry,
} from "./highlight-renderer.ts";

export interface HighlightOverlayProps {
  readonly highlights: readonly DocumentHighlight[];
  readonly documentId?: DocumentId | undefined;
  readonly pulseHighlightId?: HighlightId | null | undefined;
  readonly rootNode?: HTMLElement | null | undefined;
  readonly onUpdateHighlight: (
    highlightId: HighlightId,
    patch: { readonly color?: HighlightColor; readonly noteMarkdown?: string },
  ) => Promise<void>;
  readonly onDeleteHighlight: (highlight: DocumentHighlight) => Promise<void>;
  readonly onAskAde: (highlight: DocumentHighlight, prompt?: string) => Promise<void>;
  readonly onOpenInInkade?: ((documentId: DocumentId) => void) | undefined;
}

export function HighlightOverlay({
  highlights,
  documentId,
  pulseHighlightId,
  rootNode,
  onUpdateHighlight,
  onDeleteHighlight,
  onAskAde,
  onOpenInInkade,
}: HighlightOverlayProps) {
  const { t } = useInkadeTranslation();
  const [geometries, setGeometries] = useState<readonly HighlightOverlayGeometry[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (typeof document === "undefined" || typeof window === "undefined") return;
    let rafId = 0;
    let mutationTimer = 0;
    const recalc = () => {
      rafId = 0;
      setGeometries(computeHighlightGeometries(document, highlights, rootNode ?? document.body));
    };
    const schedule = () => {
      if (rafId !== 0) return;
      rafId = window.requestAnimationFrame(recalc);
    };
    const scheduleDebouncedMutation = () => {
      if (mutationTimer !== 0) window.clearTimeout(mutationTimer);
      mutationTimer = window.setTimeout(() => {
        mutationTimer = 0;
        schedule();
      }, 120);
    };

    recalc();

    window.addEventListener("scroll", schedule, { passive: true, capture: true });
    window.addEventListener("resize", schedule, { passive: true });
    const observerTarget = rootNode ?? document.body;
    const observer = new MutationObserver((mutations) => {
      const onlyOwnShadow = mutations.every((m) =>
        (m.target as Element)?.id === "inkade-clipper-root" ||
        Boolean((m.target as Element)?.closest?.("[data-inkade-ui-chrome='true']")),
      );
      if (!onlyOwnShadow) scheduleDebouncedMutation();
    });
    if (observerTarget) {
      observer.observe(observerTarget, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    }

    return () => {
      if (rafId !== 0) window.cancelAnimationFrame(rafId);
      if (mutationTimer !== 0) window.clearTimeout(mutationTimer);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      observer.disconnect();
    };
  }, [highlights, rootNode]);

  // Also allow clicking directly on highlighted host or reader text (when selection is empty)
  useEffect(() => {
    if (typeof document === "undefined") return;
    const clickRoot: Document | HTMLElement = rootNode ?? document;

    const onDocClick = (event: Event) => {
      const mouseEvent = event as MouseEvent;
      const target = mouseEvent.target as Element | null;
      if (
        target?.closest?.(
          "a, button, input, textarea, [data-inkade-ui-chrome='true'], .ink-float-card, .ink-reader-bar, .ink-hl-pin, .ink-toast-stack",
        )
      ) {
        return;
      }
      const sel = window.getSelection();
      if (sel && sel.toString().trim().length > 0) return;

      const x = mouseEvent.clientX;
      const y = mouseEvent.clientY;
      for (const item of geometries) {
        const hit = item.rects.some(
          (r) => x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height,
        );
        if (hit) {
          setActiveId(item.highlight.id);
          setNoteDraft(item.highlight.noteMarkdown);
          return;
        }
      }
      setActiveId(null);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setActiveId(null);
      }
    };

    clickRoot.addEventListener("click", onDocClick);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      clickRoot.removeEventListener("click", onDocClick);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [geometries, rootNode]);

  const activeGeom = geometries.find((g) => g.highlight.id === activeId) ?? null;

  const handleSaveNote = async () => {
    if (!activeGeom) return;
    setBusy(true);
    try {
      await onUpdateHighlight(activeGeom.highlight.id, { noteMarkdown: noteDraft });
    } finally {
      setBusy(false);
    }
  };

  const handleChangeColor = async (color: HighlightColor) => {
    if (!activeGeom) return;
    setBusy(true);
    try {
      await onUpdateHighlight(activeGeom.highlight.id, { color });
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!activeGeom) return;
    setBusy(true);
    try {
      await onDeleteHighlight(activeGeom.highlight);
      setActiveId(null);
    } finally {
      setBusy(false);
    }
  };

  const vw = typeof window !== "undefined" ? window.innerWidth : 1000;
  const vh = typeof window !== "undefined" ? window.innerHeight : 700;

  const popoverTop = activeGeom
    ? activeGeom.anchorRect.top + activeGeom.anchorRect.height + 240 > vh &&
      activeGeom.anchorRect.top > 250
      ? Math.max(12, activeGeom.anchorRect.top - 236)
      : Math.min(Math.max(12, activeGeom.anchorRect.top + activeGeom.anchorRect.height + 10), vh - 240)
    : 0;
  const popoverLeft = activeGeom
    ? Math.min(Math.max(12, activeGeom.anchorRect.left), Math.max(12, vw - 320))
    : 0;

  const colorLabel = (color: HighlightColor): string => {
    if (color === "amber") return t("clipper.colorAmber");
    if (color === "emerald") return t("clipper.colorEmerald");
    if (color === "blue") return t("clipper.colorBlue");
    return t("clipper.colorRose");
  };

  return (
    <div
      className="ink-overlay-layer"
      data-inkade-highlights={geometries.length}
      style={{ zIndex: rootNode ? 2147483646 : 2147483640 }}
    >
      {geometries.map((item, idx) => {
        const clampedPinLeft = Math.max(8, Math.min(vw - 24, item.anchorRect.left + item.anchorRect.width));
        const clampedPinTop = Math.max(8, Math.min(vh - 24, item.anchorRect.top));
        return (
          <React.Fragment key={item.highlight.id}>
            {item.rects.map((rect, rIdx) => (
              <div
                className={`ink-hl-rect ${item.highlight.color} ${
                  pulseHighlightId === item.highlight.id ? "pulse" : ""
                }`}
                key={`${item.highlight.id}-${rIdx}`}
                style={{
                  left: rect.left,
                  top: rect.top,
                  width: rect.width,
                  height: rect.height,
                }}
              />
            ))}
            <button
              aria-label={item.highlight.noteMarkdown || item.highlight.quote}
              className={`ink-hl-pin ${item.highlight.color}`}
              data-inkade-ui-chrome="true"
              onClick={(e) => {
                e.stopPropagation();
                setActiveId(item.highlight.id);
                setNoteDraft(item.highlight.noteMarkdown);
              }}
              style={{
                left: clampedPinLeft,
                top: clampedPinTop,
              }}
              title={item.highlight.noteMarkdown || item.highlight.quote}
              type="button"
            >
              {item.highlight.noteMarkdown ? <MessageSquare size={9} /> : idx + 1}
            </button>
          </React.Fragment>
        );
      })}

      {activeGeom ? (
        <div
          className="ink-float-card ink-popover"
          data-inkade-ui-chrome="true"
          onClick={(e) => e.stopPropagation()}
          style={{ left: popoverLeft, top: popoverTop }}
        >
          <div className="ink-popover-actions">
            <div className="ink-toolbar-row">
              {(["amber", "emerald", "blue", "rose"] as const).map((color) => (
                <button
                  aria-label={colorLabel(color)}
                  aria-pressed={activeGeom.highlight.color === color}
                  className={`ink-dot-btn ${color}${activeGeom.highlight.color === color ? " active" : ""}`}
                  disabled={busy}
                  key={color}
                  onClick={() => void handleChangeColor(color)}
                  title={colorLabel(color)}
                  type="button"
                />
              ))}
            </div>
            <button
              aria-label={t("common.close")}
              className="ink-icon-btn"
              onClick={() => setActiveId(null)}
              title={t("common.close")}
              type="button"
            >
              <X size={13} />
            </button>
          </div>

          <div className="ink-popover-quote">{activeGeom.highlight.quote}</div>

          <textarea
            className="ink-popover-textarea"
            onChange={(e) => setNoteDraft(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                void handleSaveNote();
              }
            }}
            placeholder={t("clipper.toolbarNotePlaceholder")}
            value={noteDraft}
          />

          <div className="ink-popover-actions">
            <div className="ink-toolbar-row">
              <button
                className="ink-btn-sm primary"
                disabled={busy || noteDraft === activeGeom.highlight.noteMarkdown}
                onClick={() => void handleSaveNote()}
                type="button"
              >
                {t("clipper.toolbarSaveNoteBtn")}
              </button>
              <button
                className="ink-btn-sm"
                disabled={busy}
                onClick={() => void onAskAde(activeGeom.highlight, noteDraft.trim() || undefined)}
                title={t("clipper.toolbarAskAde")}
                type="button"
              >
                <Sparkles size={12} />
                <span>{t("clipper.toolbarAskAde")}</span>
              </button>
            </div>
            <div className="ink-toolbar-row">
              {documentId && onOpenInInkade ? (
                <button
                  aria-label={t("clipper.openInInkade")}
                  className="ink-icon-btn"
                  onClick={() => onOpenInInkade(documentId)}
                  title={t("clipper.openInInkade")}
                  type="button"
                >
                  <ExternalLink size={12} />
                </button>
              ) : null}
              <button
                aria-label={t("clipper.sidePanelDeleteHighlight")}
                className="ink-btn-sm danger"
                disabled={busy}
                onClick={() => void handleDelete()}
                title={t("clipper.sidePanelDeleteHighlight")}
                type="button"
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
