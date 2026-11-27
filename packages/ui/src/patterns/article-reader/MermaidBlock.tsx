"use client";

import { useInkadeTranslation } from "@inkade/i18n";
import { DownloadIcon, Maximize2Icon, RotateCcwIcon, ZoomInIcon, ZoomOutIcon } from "lucide-react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  buildMermaidCacheKey,
  getCachedMermaidSvg,
  renderMermaidDiagram,
  sanitizeMermaidSvg,
  setCachedMermaidSvg,
} from "../../editor/mermaid-theme.ts";
import { Badge } from "../../primitives/badge.tsx";
import { Button } from "../../primitives/button.tsx";
import {
  Dialog,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../../primitives/dialog.tsx";

let mermaidCounter = 0;

export interface MermaidBlockProps {
  readonly chart: string;
  readonly theme: "light" | "dark";
}

export const MermaidBlock = React.memo(function MermaidBlock({
  chart,
  theme,
}: MermaidBlockProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const cacheKey = buildMermaidCacheKey(chart, theme);
  const [svg, setSvg] = useState<string | null>(() => {
    const cached = getCachedMermaidSvg(cacheKey);
    return cached ? sanitizeMermaidSvg(cached) : null;
  });
  const [error, setError] = useState<string | null>(null);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragStartRef = useRef<{ x: number; y: number; origX: number; origY: number } | null>(null);
  const renderFailedMsgRef = useRef<string>("");
  renderFailedMsgRef.current = t("reader.mermaidRenderFailed");

  useEffect(() => {
    const cached = getCachedMermaidSvg(cacheKey);
    if (cached !== undefined) {
      setSvg(sanitizeMermaidSvg(cached));
      setError(null);
      return;
    }

    let cancelled = false;
    const renderId = `inkade-mermaid-${++mermaidCounter}`;

    async function renderDiagram(): Promise<void> {
      try {
        const renderedSvg = sanitizeMermaidSvg(await renderMermaidDiagram(renderId, chart, theme));
        if (!renderedSvg) {
          throw new Error(renderFailedMsgRef.current);
        }
        setCachedMermaidSvg(cacheKey, renderedSvg);
        if (!cancelled) {
          setSvg(renderedSvg);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : renderFailedMsgRef.current);
          setSvg(null);
        }
      }
    }

    void renderDiagram();
    return () => {
      cancelled = true;
    };
  }, [cacheKey, chart, theme]);

  const safeSvg = useMemo(() => (svg ? sanitizeMermaidSvg(svg) : null), [svg]);

  const handleExportSvg = (): void => {
    if (!safeSvg) return;
    const blob = new Blob([safeSvg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "diagram.svg";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportPng = (): void => {
    if (!safeSvg || typeof document === "undefined") return;
    const parser = new DOMParser();
    const parsedDoc = parser.parseFromString(safeSvg, "image/svg+xml");
    const svgEl = parsedDoc.documentElement;
    const viewBox = svgEl.getAttribute("viewBox")?.split(/\s+/).map(Number) ?? [];
    const width = Number(svgEl.getAttribute("width")) || viewBox[2] || 960;
    const height = Number(svgEl.getAttribute("height")) || viewBox[3] || 540;

    const svgBlob = new Blob([safeSvg], { type: "image/svg+xml;charset=utf-8" });
    const svgUrl = URL.createObjectURL(svgBlob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width * 2));
      canvas.height = Math.max(1, Math.round(height * 2));
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = theme === "dark" ? "#0e1015" : "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((pngBlob) => {
          if (!pngBlob) return;
          const pngUrl = URL.createObjectURL(pngBlob);
          const a = document.createElement("a");
          a.href = pngUrl;
          a.download = "diagram.png";
          a.click();
          URL.revokeObjectURL(pngUrl);
        }, "image/png");
      }
      URL.revokeObjectURL(svgUrl);
    };
    img.onerror = () => {
      URL.revokeObjectURL(svgUrl);
    };
    img.src = svgUrl;
  };

  if (error || !safeSvg) {
    return (
      <div className="my-4 rounded-xl border bg-code p-3">
        <div className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
          <span className="font-mono">{t("reader.mermaidLabel")}</span>
          {error && <span className="text-destructive-foreground">{error}</span>}
        </div>
        <pre className="m-0 border-0 bg-transparent p-0 text-xs">{chart}</pre>
      </div>
    );
  }

  return (
    <>
      <div className="group relative my-5 overflow-hidden rounded-xl border bg-card p-4">
        <div className="mb-2 flex items-center justify-between">
          <Badge size="sm" variant="outline">
            {t("reader.mermaidLabel")}
          </Badge>
          <div className="flex items-center gap-1">
            <Button onClick={handleExportSvg} size="xs" variant="ghost">
              <DownloadIcon />
              {t("reader.exportSvg")}
            </Button>
            <Button
              aria-label={t("reader.zoomDiagram")}
              onClick={() => {
                setScale(1);
                setPan({ x: 0, y: 0 });
                setZoomOpen(true);
              }}
              size="icon-xs"
              variant="ghost"
            >
              <Maximize2Icon />
            </Button>
          </div>
        </div>
        <div
          className="flex justify-start overflow-x-auto pb-1 sm:justify-center [&_svg]:h-auto [&_svg]:max-h-[480px] [&_svg]:min-w-[520px] sm:[&_svg]:min-w-0 sm:[&_svg]:max-w-full"
          dangerouslySetInnerHTML={{ __html: safeSvg }}
        />
      </div>

      <Dialog onOpenChange={setZoomOpen} open={zoomOpen}>
        <DialogPopup className="max-w-5xl">
          <DialogHeader>
            <div className="flex flex-wrap items-center justify-between gap-2 pr-6">
              <DialogTitle>{t("reader.diagramPreview")}</DialogTitle>
              <div className="flex flex-wrap items-center gap-1.5">
                <Button
                  aria-label={t("reader.zoomOut")}
                  onClick={() => setScale((s) => Math.max(0.5, Number((s - 0.25).toFixed(2))))}
                  size="icon-xs"
                  variant="outline"
                >
                  <ZoomOutIcon />
                </Button>
                <Badge size="sm" variant="secondary">
                  {t("reader.zoomLevel", { percent: Math.round(scale * 100) })}
                </Badge>
                <Button
                  aria-label={t("reader.zoomIn")}
                  onClick={() => setScale((s) => Math.min(3, Number((s + 0.25).toFixed(2))))}
                  size="icon-xs"
                  variant="outline"
                >
                  <ZoomInIcon />
                </Button>
                <Button
                  onClick={() => {
                    setScale(1);
                    setPan({ x: 0, y: 0 });
                  }}
                  size="xs"
                  variant="ghost"
                >
                  <RotateCcwIcon />
                  {t("reader.resetView")}
                </Button>
                <Button onClick={handleExportSvg} size="xs" variant="outline">
                  <DownloadIcon />
                  {t("reader.exportSvg")}
                </Button>
                <Button onClick={handleExportPng} size="xs" variant="outline">
                  <DownloadIcon />
                  {t("reader.exportPng")}
                </Button>
              </div>
            </div>
          </DialogHeader>
          <DialogPanel>
            <div
              className="flex h-[65vh] cursor-grab items-center justify-center overflow-hidden rounded-lg border bg-background p-6 active:cursor-grabbing"
              onPointerDown={(e) => {
                dragStartRef.current = {
                  x: e.clientX,
                  y: e.clientY,
                  origX: pan.x,
                  origY: pan.y,
                };
              }}
              onPointerMove={(e) => {
                const start = dragStartRef.current;
                if (!start) return;
                setPan({
                  x: start.origX + (e.clientX - start.x),
                  y: start.origY + (e.clientY - start.y),
                });
              }}
              onPointerUp={() => {
                dragStartRef.current = null;
              }}
              onWheel={(e) => {
                e.preventDefault();
                const delta = e.deltaY < 0 ? 0.15 : -0.15;
                setScale((s) => Math.min(3, Math.max(0.5, Number((s + delta).toFixed(2)))));
              }}
            >
              <div
                className="select-none transition-transform duration-75 [&_svg]:h-auto [&_svg]:max-w-full"
                dangerouslySetInnerHTML={{ __html: safeSvg }}
                style={{
                  transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
                }}
              />
            </div>
          </DialogPanel>
        </DialogPopup>
      </Dialog>
    </>
  );
});
