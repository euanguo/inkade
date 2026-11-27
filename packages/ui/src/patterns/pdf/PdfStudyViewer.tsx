"use client";

import type {
  CreatePdfAnnotationInput,
  DocumentAssetId,
  PdfAnnotation,
  PdfRect,
} from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  MinusIcon,
  PlusIcon,
  SparklesIcon,
  Trash2Icon,
} from "lucide-react";
import {
  getDocument,
  GlobalWorkerOptions,
  OutputScale,
  TextLayer,
  type PDFDocumentProxy,
  type RenderTask,
} from "pdfjs-dist";
import "pdfjs-dist/web/pdf_viewer.css";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../../lib/utils.ts";
import { Button } from "../../primitives/button.tsx";
import { Spinner } from "../../primitives/spinner.tsx";

GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

export type PdfHighlightColor = "amber" | "emerald" | "blue" | "rose";

const HIGHLIGHT_FILL_CLASSES: Readonly<Record<PdfHighlightColor, string>> = {
  amber: "bg-amber-400/32 border-amber-500/60",
  emerald: "bg-emerald-400/30 border-emerald-500/60",
  blue: "bg-sky-400/30 border-sky-500/60",
  rose: "bg-rose-400/30 border-rose-500/60",
};

const SWATCH_CLASSES: Readonly<Record<PdfHighlightColor, string>> = {
  amber: "bg-amber-400 hover:bg-amber-500",
  emerald: "bg-emerald-400 hover:bg-emerald-500",
  blue: "bg-sky-400 hover:bg-sky-500",
  rose: "bg-rose-400 hover:bg-rose-500",
};

export interface PdfStudyViewerProps {
  readonly assetId: DocumentAssetId;
  readonly fetchPdfBytes: (assetId: DocumentAssetId) => Promise<Uint8Array>;
  readonly annotations: readonly PdfAnnotation[];
  readonly focusPage?: number | null | undefined;
  readonly focusAnnotationId?: string | null | undefined;
  readonly onCreateAnnotation?:
    | ((input: CreatePdfAnnotationInput) => Promise<void> | void)
    | undefined;
  readonly onDeleteAnnotation?: ((annotationId: string) => Promise<void> | void) | undefined;
  readonly onDistillPage?: ((page: number) => Promise<void> | void) | undefined;
  readonly distillingPage?: number | null | undefined;
  readonly readOnly?: boolean | undefined;
  readonly className?: string | undefined;
}

interface PendingPdfSelection {
  readonly page: number;
  readonly quote: string;
  readonly rects: readonly PdfRect[];
  readonly top: number;
  readonly left: number;
}

function coalesceNormalizedRects(rawRects: DOMRectList, containerRect: DOMRect): PdfRect[] {
  if (containerRect.width <= 0 || containerRect.height <= 0) return [];
  const normalized: PdfRect[] = [];
  for (const r of Array.from(rawRects)) {
    if (r.width < 1 || r.height < 1) continue;
    const x = Math.max(0, Math.min(1, (r.left - containerRect.left) / containerRect.width));
    const y = Math.max(0, Math.min(1, (r.top - containerRect.top) / containerRect.height));
    const width = Math.max(0, Math.min(1 - x, r.width / containerRect.width));
    const height = Math.max(0, Math.min(1 - y, r.height / containerRect.height));
    if (width <= 0.002 || height <= 0.002) continue;

    const prev = normalized[normalized.length - 1];
    if (
      prev &&
      Math.abs(prev.y - y) < 0.008 &&
      Math.abs(prev.height - height) < 0.01 &&
      x <= prev.x + prev.width + 0.015
    ) {
      const mergedRight = Math.max(prev.x + prev.width, x + width);
      const mergedLeft = Math.min(prev.x, x);
      normalized[normalized.length - 1] = {
        x: mergedLeft,
        y: Math.min(prev.y, y),
        width: mergedRight - mergedLeft,
        height: Math.max(prev.height, height),
      };
    } else {
      normalized.push({ x, y, width, height });
    }
  }
  return normalized.slice(0, 64);
}

interface PdfPageCanvasProps {
  readonly pdfDoc: PDFDocumentProxy;
  readonly pageNumber: number;
  readonly scale: number;
  readonly annotations: readonly PdfAnnotation[];
  readonly activeFlashAnnotationId: string | null;
  readonly readOnly: boolean;
  readonly onDeleteAnnotation?: ((annotationId: string) => Promise<void> | void) | undefined;
  readonly onVisiblePage?: ((pageNumber: number, isVisible: boolean) => void) | undefined;
}

function PdfPageCanvas({
  pdfDoc,
  pageNumber,
  scale,
  annotations,
  activeFlashAnnotationId,
  readOnly,
  onDeleteAnnotation,
  onVisiblePage,
}: PdfPageCanvasProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const pageContainerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const [dimensions, setDimensions] = useState<{ width: number; height: number }>({
    width: Math.round(612 * scale),
    height: Math.round(792 * scale),
  });
  const [isNearViewport, setIsNearViewport] = useState(pageNumber <= 3);

  useEffect(() => {
    const el = pageContainerRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setIsNearViewport(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setIsNearViewport(true);
          }
          onVisiblePage?.(pageNumber, entry.intersectionRatio >= 0.35);
        }
      },
      { rootMargin: "360px 0px", threshold: [0, 0.35, 0.7] },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [onVisiblePage, pageNumber]);

  useEffect(() => {
    if (!isNearViewport) return;
    let cancelled = false;
    let renderTask: RenderTask | null = null;
    let textLayerInstance: TextLayer | null = null;

    const renderPage = async (): Promise<void> => {
      const page = await pdfDoc.getPage(pageNumber);
      if (cancelled) return;

      const viewport = page.getViewport({ scale });
      setDimensions({ width: viewport.width, height: viewport.height });

      const canvas = canvasRef.current;
      const textHost = textLayerRef.current;
      if (!canvas || !textHost) return;

      const outputScale = new OutputScale();
      canvas.width = Math.floor(viewport.width * outputScale.sx);
      canvas.height = Math.floor(viewport.height * outputScale.sy);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;

      const transform = outputScale.scaled ? [outputScale.sx, 0, 0, outputScale.sy, 0, 0] : undefined;
      renderTask = page.render({
        canvas,
        viewport,
        ...(transform ? { transform } : {}),
      });
      await renderTask.promise;
      if (cancelled) return;

      textHost.innerHTML = "";
      textHost.style.width = `${viewport.width}px`;
      textHost.style.height = `${viewport.height}px`;

      const textContent = await page.getTextContent();
      if (cancelled) return;

      textLayerInstance = new TextLayer({
        textContentSource: textContent,
        container: textHost,
        viewport,
      });
      await textLayerInstance.render();
    };

    void renderPage().catch(() => {
      // Page render cancellation or unload is expected during rapid zoom/scroll
    });

    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayerInstance?.cancel();
    };
  }, [isNearViewport, pageNumber, pdfDoc, scale]);

  return (
    <div
      className="relative mx-auto overflow-hidden rounded-lg border border-border/80 bg-white shadow-sm select-text dark:border-border dark:brightness-[0.9] dark:contrast-[0.96]"
      data-pdf-page={pageNumber}
      ref={pageContainerRef}
      style={
        {
          width: `${dimensions.width}px`,
          height: `${dimensions.height}px`,
          "--scale-factor": String(scale),
          "--total-scale-factor": String(scale),
        } as React.CSSProperties
      }
    >
      <canvas className="block" ref={canvasRef} />
      <div className="textLayer pointer-events-auto" ref={textLayerRef} />

      <div className="pointer-events-none absolute inset-0 z-10">
        {annotations.map((ann) => {
          const isFlashing = activeFlashAnnotationId === ann.id;
          const colorKey: PdfHighlightColor =
            ann.color === "emerald" || ann.color === "blue" || ann.color === "rose"
              ? ann.color
              : "amber";
          return ann.rects.map((rect, idx) => (
            <div
              className={cn(
                "group/hl pointer-events-auto absolute rounded-[2px] border mix-blend-multiply transition-opacity dark:mix-blend-screen",
                HIGHLIGHT_FILL_CLASSES[colorKey],
                isFlashing && "animate-pulse ring-2 ring-primary ring-offset-1",
              )}
              data-pdf-annotation-id={ann.id}
              key={`${ann.id}-${idx}`}
              style={{
                left: `${rect.x * 100}%`,
                top: `${rect.y * 100}%`,
                width: `${rect.width * 100}%`,
                height: `${rect.height * 100}%`,
              }}
              title={ann.quote}
            >
              {idx === 0 && !readOnly && onDeleteAnnotation && (
                <button
                  aria-label={t("pdfStudy.annotationRemovedToast")}
                  className="pointer-events-auto absolute -top-5 -right-1 hidden size-4 cursor-pointer items-center justify-center rounded bg-popover text-muted-foreground shadow group-hover/hl:inline-flex hover:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    void onDeleteAnnotation(ann.id);
                  }}
                  type="button"
                >
                  <Trash2Icon className="size-2.5" />
                </button>
              )}
            </div>
          ));
        })}
      </div>

      <span className="pointer-events-none absolute right-2 bottom-1.5 z-20 rounded bg-background/85 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground shadow-xs">
        {pageNumber}
      </span>
    </div>
  );
}

export function PdfStudyViewer({
  assetId,
  fetchPdfBytes,
  annotations,
  focusPage,
  focusAnnotationId,
  onCreateAnnotation,
  onDeleteAnnotation,
  onDistillPage,
  distillingPage,
  readOnly = false,
  className,
}: PdfStudyViewerProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(0.85);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pendingSel, setPendingSel] = useState<PendingPdfSelection | null>(null);
  const [submittingSelection, setSubmittingSelection] = useState(false);
  const [activeFlashAnnotationId, setActiveFlashAnnotationId] = useState<string | null>(null);
  const userScaledRef = useRef(false);
  const basePageWidthRef = useRef<number | null>(null);

  const recomputeFitScale = useCallback(() => {
    if (userScaledRef.current) return;
    const containerWidth = scrollContainerRef.current?.clientWidth ?? 0;
    const baseWidth = basePageWidthRef.current ?? 0;
    if (containerWidth <= 64 || baseWidth <= 0) return;
    const fitted = Math.max(0.5, Math.min(1.15, Number(((containerWidth - 36) / baseWidth).toFixed(2))));
    setScale((prev) => (Math.abs(prev - fitted) < 0.02 ? prev : fitted));
  }, []);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => recomputeFitScale());
    observer.observe(el);
    return () => observer.disconnect();
  }, [recomputeFitScale]);

  const annotationsByPage = useMemo(() => {
    const map = new Map<number, PdfAnnotation[]>();
    for (const ann of annotations) {
      const list = map.get(ann.page);
      if (list) list.push(ann);
      else map.set(ann.page, [ann]);
    }
    return map;
  }, [annotations]);

  useEffect(() => {
    let cancelled = false;
    let currentTask: ReturnType<typeof getDocument> | null = null;
    userScaledRef.current = false;
    basePageWidthRef.current = null;
    setLoading(true);
    setErrorMsg(null);
    setPendingSel(null);

    const load = async (): Promise<void> => {
      try {
        const bytes = await fetchPdfBytes(assetId);
        if (cancelled) return;
        const loadingTask = getDocument({ data: new Uint8Array(bytes) });
        currentTask = loadingTask;
        const loadedDoc = await loadingTask.promise;
        if (cancelled) {
          void loadingTask.destroy();
          return;
        }
        try {
          const firstPage = await loadedDoc.getPage(1);
          const vp = firstPage.getViewport({ scale: 1 });
          if (!cancelled && Number.isFinite(vp.width) && vp.width > 0) {
            basePageWidthRef.current = vp.width;
          }
        } catch {
          // fallback cleanly
        }
        setPdfDoc(loadedDoc);
        setNumPages(loadedDoc.numPages);
        setCurrentPage(1);
        recomputeFitScale();
      } catch {
        if (!cancelled) {
          setErrorMsg(t("pdfStudy.loadPdfError"));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
      void currentTask?.destroy();
    };
  }, [assetId, fetchPdfBytes, recomputeFitScale, t]);

  const scrollToPage = useCallback((pageNum: number) => {
    const clamped = Math.max(1, Math.min(pageNum, Math.max(numPages, pageNum)));
    setCurrentPage(clamped);
    const container = scrollContainerRef.current;
    const el = container?.querySelector<HTMLElement>(
      `[data-pdf-page="${clamped}"]`,
    );
    if (container && el) {
      const containerRect = container.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      const nextTop = container.scrollTop + (elRect.top - containerRect.top) - 12;
      container.scrollTo({ top: Math.max(0, nextTop), behavior: "smooth" });
    }
  }, [numPages]);

  useEffect(() => {
    if (focusPage && focusPage >= 1 && numPages > 0) {
      scrollToPage(Math.min(focusPage, numPages));
    }
  }, [focusPage, numPages, scrollToPage]);

  useEffect(() => {
    if (!focusAnnotationId) return;
    setActiveFlashAnnotationId(focusAnnotationId);
    const timer = setTimeout(() => setActiveFlashAnnotationId(null), 2200);
    return () => clearTimeout(timer);
  }, [focusAnnotationId]);

  const handleMouseUp = useCallback(() => {
    if (readOnly || !onCreateAnnotation) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      setPendingSel(null);
      return;
    }
    const quote = sel.toString().replace(/\s+/g, " ").trim();
    if (!quote) {
      setPendingSel(null);
      return;
    }
    const range = sel.getRangeAt(0);
    const anchorEl =
      range.commonAncestorContainer instanceof Element
        ? range.commonAncestorContainer
        : range.commonAncestorContainer.parentElement;
    const pageEl = anchorEl?.closest<HTMLElement>("[data-pdf-page]");
    if (!pageEl) {
      setPendingSel(null);
      return;
    }
    const pageNum = Number.parseInt(pageEl.getAttribute("data-pdf-page") ?? "0", 10);
    if (!Number.isFinite(pageNum) || pageNum < 1) {
      setPendingSel(null);
      return;
    }
    const pageBounds = pageEl.getBoundingClientRect();
    const rects = coalesceNormalizedRects(range.getClientRects(), pageBounds);
    if (rects.length === 0) {
      setPendingSel(null);
      return;
    }
    const rangeBounds = range.getBoundingClientRect();
    setPendingSel({
      page: pageNum,
      quote: quote.slice(0, 2000),
      rects,
      top: Math.max(52, rangeBounds.top - 42),
      left: Math.max(16, Math.min(window.innerWidth - 220, rangeBounds.left)),
    });
  }, [onCreateAnnotation, readOnly]);

  const handleCommitSelectionColor = async (color: PdfHighlightColor): Promise<void> => {
    if (!pendingSel || !onCreateAnnotation) return;
    setSubmittingSelection(true);
    try {
      await onCreateAnnotation({
        page: pendingSel.page,
        rects: [...pendingSel.rects],
        quote: pendingSel.quote,
        color,
      });
      window.getSelection()?.removeAllRanges();
      setPendingSel(null);
    } finally {
      setSubmittingSelection(false);
    }
  };

  const updateActivePageFromScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const pageEls = container.querySelectorAll<HTMLElement>("[data-pdf-page]");
    if (pageEls.length === 0) return;
    const containerRect = container.getBoundingClientRect();
    const anchorY = containerRect.top + containerRect.height * 0.32;
    let bestPage = 1;
    let bestOverlap = -1;
    let closestDist = Number.POSITIVE_INFINITY;

    for (const el of Array.from(pageEls)) {
      const num = Number.parseInt(el.getAttribute("data-pdf-page") ?? "0", 10);
      if (!Number.isFinite(num) || num < 1) continue;
      const r = el.getBoundingClientRect();
      const overlap = Math.max(
        0,
        Math.min(r.bottom, containerRect.bottom) - Math.max(r.top, containerRect.top),
      );
      const mid = (r.top + r.bottom) / 2;
      const dist = Math.abs(mid - anchorY);
      if (overlap > bestOverlap + 12 || (Math.abs(overlap - bestOverlap) <= 12 && dist < closestDist)) {
        bestOverlap = overlap;
        closestDist = dist;
        bestPage = num;
      }
    }
    setCurrentPage(bestPage);
  }, []);

  const handleVisiblePage = useCallback((_pageNum: number, _isVisible: boolean) => {
    updateActivePageFromScroll();
  }, [updateActivePageFromScroll]);

  const colorOptions: ReadonlyArray<{ readonly color: PdfHighlightColor; readonly label: string }> =
    [
      { color: "amber", label: t("pdfStudy.highlightAmber") },
      { color: "emerald", label: t("pdfStudy.highlightEmerald") },
      { color: "blue", label: t("pdfStudy.highlightBlue") },
      { color: "rose", label: t("pdfStudy.highlightRose") },
    ];

  return (
    <div
      className={cn("relative flex h-full min-h-0 flex-col bg-muted/25", className)}
      data-slot="pdf-study-viewer"
    >
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b bg-background/90 px-3 py-2 backdrop-blur-sm">
        <div className="flex items-center gap-1">
          <Button
            aria-label={t("pdfStudy.prevPageLabel")}
            disabled={currentPage <= 1 || numPages === 0}
            onClick={() => scrollToPage(currentPage - 1)}
            size="icon-xs"
            type="button"
            variant="ghost"
          >
            <ChevronLeftIcon />
          </Button>
          <span className="px-1.5 font-mono text-xs tabular-nums text-muted-foreground">
            {t("pdfStudy.pageIndicator", { page: currentPage, total: Math.max(1, numPages) })}
          </span>
          <Button
            aria-label={t("pdfStudy.nextPageLabel")}
            disabled={numPages === 0 || currentPage >= numPages}
            onClick={() => scrollToPage(currentPage + 1)}
            size="icon-xs"
            type="button"
            variant="ghost"
          >
            <ChevronRightIcon />
          </Button>
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            aria-label={t("pdfStudy.zoomOutLabel")}
            onClick={() => {
              userScaledRef.current = true;
              setScale((s) => Math.max(0.5, Number((s - 0.15).toFixed(2))));
            }}
            size="icon-xs"
            type="button"
            variant="ghost"
          >
            <MinusIcon />
          </Button>
          <span className="w-11 text-center font-mono text-[11px] tabular-nums text-muted-foreground">
            {`${Math.round(scale * 100)}%`}
          </span>
          <Button
            aria-label={t("pdfStudy.zoomInLabel")}
            onClick={() => {
              userScaledRef.current = true;
              setScale((s) => Math.min(2.4, Number((s + 0.15).toFixed(2))));
            }}
            size="icon-xs"
            type="button"
            variant="ghost"
          >
            <PlusIcon />
          </Button>

          {!readOnly && onDistillPage && numPages > 0 && (
            <Button
              disabled={distillingPage === currentPage}
              loading={distillingPage === currentPage}
              onClick={() => void onDistillPage(currentPage)}
              size="xs"
              type="button"
              variant="secondary"
            >
              <SparklesIcon className="size-3.5" />
              <span>
                {distillingPage === currentPage
                  ? t("pdfStudy.distillingPageBtn")
                  : t("pdfStudy.distillPageBtn")}
              </span>
            </Button>
          )}
        </div>
      </div>

      <div
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-x-auto overflow-y-auto px-4 pt-4 pb-8"
        onMouseUp={handleMouseUp}
        onScroll={updateActivePageFromScroll}
        ref={scrollContainerRef}
      >
        {loading ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 py-12 text-xs text-muted-foreground">
            <Spinner className="size-5" />
            <span>{t("pdfStudy.loadingPdf")}</span>
          </div>
        ) : errorMsg ? (
          <div className="m-auto rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-xs text-destructive">
            {errorMsg}
          </div>
        ) : pdfDoc ? (
          <>
            {annotations.length === 0 && (
              <p className="mx-auto max-w-md text-center text-[11px] text-muted-foreground">
                {t("pdfStudy.annotationsEmpty")}
              </p>
            )}
            {Array.from({ length: numPages }, (_, idx) => idx + 1).map((pageNum) => (
              <PdfPageCanvas
                activeFlashAnnotationId={activeFlashAnnotationId}
                annotations={annotationsByPage.get(pageNum) ?? []}
                key={`${assetId}-${pageNum}-${scale}`}
                onDeleteAnnotation={onDeleteAnnotation}
                onVisiblePage={handleVisiblePage}
                pageNumber={pageNum}
                pdfDoc={pdfDoc}
                readOnly={readOnly}
                scale={scale}
              />
            ))}
          </>
        ) : null}
      </div>

      {pendingSel && (
        <div
          className="fixed z-50 flex items-center gap-2 rounded-full border border-[var(--border-overlay)] bg-popover px-3 py-1.5 text-xs shadow-[var(--shadow-overlay)]"
          style={{ top: `${pendingSel.top}px`, left: `${pendingSel.left}px` }}
        >
          <span className="text-[11px] text-muted-foreground">
            {t("pdfStudy.selectionToolbarHint")}
          </span>
          {colorOptions.map((opt) => (
            <button
              aria-label={opt.label}
              className={cn(
                "size-4 cursor-pointer rounded-full border border-black/15 transition-transform hover:scale-110",
                SWATCH_CLASSES[opt.color],
              )}
              disabled={submittingSelection}
              key={opt.color}
              onClick={() => void handleCommitSelectionColor(opt.color)}
              title={opt.label}
              type="button"
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default PdfStudyViewer;
