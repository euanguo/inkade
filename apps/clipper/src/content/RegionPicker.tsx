import { useInkadeTranslation } from "@inkade/i18n";
import { ArrowDownLeft, ArrowUpRight, Check, RotateCcw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  expandRegionToParent,
  findInitialSelectableElement,
  moveRegionToSibling,
  shrinkRegionToChild,
} from "./region-selector-core.ts";

export interface RegionPickerProps {
  readonly active: boolean;
  readonly onSelectElement: (element: Element) => void;
  readonly onCancel: () => void;
}

interface HighlightBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly tagName: string;
  readonly charCount: number;
  readonly imageCount: number;
}

function getFriendlyRegionRole(
  tagName: string,
  t: ReturnType<typeof useInkadeTranslation>["t"],
): string {
  if (tagName === "article" || tagName === "main") return t("clipper.regionTagArticle");
  if (tagName === "section") return t("clipper.regionTagSection");
  if (tagName === "p" || tagName === "blockquote") return t("clipper.regionTagParagraph");
  if (tagName === "ul" || tagName === "ol") return t("clipper.regionTagList");
  if (tagName === "pre" || tagName === "table") return t("clipper.regionTagCode");
  return t("clipper.regionTagBlock");
}

export function RegionPicker({ active, onSelectElement, onCancel }: RegionPickerProps) {
  const { t } = useInkadeTranslation();
  const [box, setBox] = useState<HighlightBox | null>(null);
  const [locked, setLocked] = useState(false);
  const currentElRef = useRef<Element | null>(null);
  const historyStackRef = useRef<Element[]>([]);
  const lockedRef = useRef(false);

  const syncBoxFromElement = (el: Element | null) => {
    currentElRef.current = el;
    if (!el) {
      setBox(null);
      return;
    }
    const rect = el.getBoundingClientRect();
    setBox({
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      tagName: el.tagName.toLowerCase(),
      charCount: (el.textContent ?? "").trim().length,
      imageCount: el.querySelectorAll?.("img")?.length ?? 0,
    });
  };

  useEffect(() => {
    lockedRef.current = locked;
  }, [locked]);

  useEffect(() => {
    if (!active || typeof document === "undefined") {
      currentElRef.current = null;
      historyStackRef.current = [];
      lockedRef.current = false;
      setLocked(false);
      setBox(null);
      return;
    }

    const onMouseMove = (event: MouseEvent) => {
      if (lockedRef.current) return;
      const target = document.elementFromPoint(event.clientX, event.clientY);
      const selectable = findInitialSelectableElement(target);
      if (selectable && selectable !== currentElRef.current) {
        historyStackRef.current = [];
        syncBoxFromElement(selectable);
      }
    };

    const onClick = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (target?.closest?.("#inkade-clipper-root")) return;
      event.preventDefault();
      event.stopPropagation();
      const chosen = currentElRef.current ?? findInitialSelectableElement(target);
      if (chosen) {
        syncBoxFromElement(chosen);
        lockedRef.current = true;
        setLocked(true);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (lockedRef.current) {
          lockedRef.current = false;
          setLocked(false);
        } else {
          onCancel();
        }
        return;
      }

      const curr = currentElRef.current;
      if (!curr) return;

      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        onSelectElement(curr);
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        const expanded = expandRegionToParent(curr, historyStackRef.current);
        historyStackRef.current = expanded.stack;
        syncBoxFromElement(expanded.next);
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        const shrunk = shrinkRegionToChild(curr, historyStackRef.current);
        historyStackRef.current = shrunk.stack;
        syncBoxFromElement(shrunk.next);
        return;
      }

      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        const sibling = moveRegionToSibling(curr, event.key === "ArrowUp" ? -1 : 1);
        if (sibling) {
          historyStackRef.current = [];
          syncBoxFromElement(sibling);
          sibling.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
        }
      }
    };

    const onScrollOrResize = () => {
      if (currentElRef.current) syncBoxFromElement(currentElRef.current);
    };

    document.addEventListener("mousemove", onMouseMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);

    return () => {
      document.removeEventListener("mousemove", onMouseMove, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [active, onCancel, onSelectElement]);

  if (!active) return null;

  const handleExpandParent = () => {
    const curr = currentElRef.current;
    if (!curr) return;
    const expanded = expandRegionToParent(curr, historyStackRef.current);
    historyStackRef.current = expanded.stack;
    syncBoxFromElement(expanded.next);
  };

  const handleShrinkChild = () => {
    const curr = currentElRef.current;
    if (!curr) return;
    const shrunk = shrinkRegionToChild(curr, historyStackRef.current);
    historyStackRef.current = shrunk.stack;
    syncBoxFromElement(shrunk.next);
  };

  return (
    <>
      {box ? (
        <div
          className={`ink-region-box ${locked ? "locked" : ""}`}
          style={{
            left: box.left,
            top: box.top,
            width: box.width,
            height: box.height,
          }}
        />
      ) : null}
      <div
        className="ink-region-hud"
        data-inkade-ui-chrome="true"
        onClick={(e) => e.stopPropagation()}
      >
        {box ? (
          <span>
            {getFriendlyRegionRole(box.tagName, t)}
            {" · "}
            {t("clipper.regionPickerWords", { count: box.charCount })}
            {box.imageCount > 0 ? ` · ${t("clipper.imageCountMeta", { count: box.imageCount })}` : ""}
          </span>
        ) : (
          <span>{t("clipper.regionPickerHint")}</span>
        )}

        <div className="ink-toolbar-row">
          <button
            className="ink-btn-sm"
            disabled={!box}
            onClick={handleExpandParent}
            title={t("clipper.regionExpandParentBtn")}
            type="button"
          >
            <ArrowUpRight size={12} />
            <span>{t("clipper.regionExpandParentBtn")}</span>
          </button>
          <button
            className="ink-btn-sm"
            disabled={!box}
            onClick={handleShrinkChild}
            title={t("clipper.regionShrinkChildBtn")}
            type="button"
          >
            <ArrowDownLeft size={12} />
            <span>{t("clipper.regionShrinkChildBtn")}</span>
          </button>
          {locked && currentElRef.current ? (
            <>
              <button
                className="ink-btn-sm primary"
                onClick={() => {
                  if (currentElRef.current) onSelectElement(currentElRef.current);
                }}
                type="button"
              >
                <Check size={12} />
                <span>{t("clipper.regionConfirmClipBtn")}</span>
              </button>
              <button
                className="ink-btn-sm"
                onClick={() => {
                  lockedRef.current = false;
                  setLocked(false);
                }}
                title={t("clipper.regionRepickBtn")}
                type="button"
              >
                <RotateCcw size={12} />
              </button>
            </>
          ) : null}
          <button
            aria-label={t("common.cancel")}
            className="ink-icon-btn"
            onClick={onCancel}
            title={t("common.cancel")}
            type="button"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    </>
  );
}
