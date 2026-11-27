"use client";

import { useInkadeTranslation } from "@inkade/i18n";
import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import {
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  DownloadIcon,
  Maximize2Icon,
  RotateCcwIcon,
  SearchIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useCopyToClipboard, useDebounceCallback } from "usehooks-ts";
import { cn } from "../../lib/utils.ts";
import { Badge } from "../../primitives/badge.tsx";
import { Button } from "../../primitives/button.tsx";
import {
  Dialog,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../../primitives/dialog.tsx";
import { GlideHighlight } from "../../primitives/glide-highlight.tsx";
import { Input } from "../../primitives/input.tsx";
import { Popover, PopoverPopup, PopoverTrigger } from "../../primitives/popover.tsx";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "../../primitives/segmented-control.tsx";
import {
  buildMermaidCacheKey,
  getCachedMermaidSvg,
  renderMermaidDiagram,
  sanitizeMermaidSvg,
  setCachedMermaidSvg,
} from "../mermaid-theme.ts";
import { useEditorSurface } from "../context.tsx";
import { SHIKI_SUPPORTED_LANGUAGES } from "../shiki-highlighter.ts";

let editorMermaidCounter = 0;

type MermaidViewMode = "preview" | "split" | "source";

export function CodeBlockNodeView({
  node,
  updateAttributes,
}: ReactNodeViewProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const { readOnly, theme } = useEditorSurface();
  const rawLang = String(node.attrs?.language ?? "plaintext").toLowerCase() || "plaintext";
  const isMermaid = rawLang === "mermaid";
  const codeText = node.textContent;

  const [copied, setCopied] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const [langQuery, setLangQuery] = useState("");
  const [mermaidMode, setMermaidMode] = useState<MermaidViewMode>(() =>
    !readOnly && rawLang === "mermaid" && node.textContent.trim() === "" ? "split" : "preview",
  );
  const [mermaidSvg, setMermaidSvg] = useState<string | null>(() => {
    if (rawLang !== "mermaid") return null;
    const trimmed = node.textContent.trim();
    if (!trimmed) return null;
    const cached = getCachedMermaidSvg(buildMermaidCacheKey(trimmed, theme));
    return cached ? sanitizeMermaidSvg(cached) : null;
  });
  const [mermaidError, setMermaidError] = useState<string | null>(null);
  const prevRenderedMermaidCodeRef = useRef<string | null>(null);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number; origX: number; origY: number } | null>(null);
  const zoomViewportRef = useRef<HTMLDivElement>(null);

  const filteredLanguages = useMemo(() => {
    const q = langQuery.trim().toLowerCase();
    if (!q) return SHIKI_SUPPORTED_LANGUAGES;
    return SHIKI_SUPPORTED_LANGUAGES.filter((l) => l.includes(q));
  }, [langQuery]);

  useEffect(() => {
    const viewport = zoomViewportRef.current;
    if (!zoomOpen || !viewport) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.15 : -0.15;
      setScale((s) => Math.min(3, Math.max(0.5, Number((s + delta).toFixed(2)))));
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      viewport.removeEventListener("wheel", onWheel);
    };
  }, [zoomOpen]);

  // Render live Mermaid SVG when language === "mermaid"
  useEffect(() => {
    if (!isMermaid) return;
    const trimmed = codeText.trim();
    if (!trimmed) {
      prevRenderedMermaidCodeRef.current = null;
      setMermaidSvg(null);
      setMermaidError(null);
      return;
    }

    const cacheKey = buildMermaidCacheKey(trimmed, theme);
    const cached = getCachedMermaidSvg(cacheKey);
    if (cached !== undefined) {
      prevRenderedMermaidCodeRef.current = trimmed;
      setMermaidSvg(sanitizeMermaidSvg(cached));
      setMermaidError(null);
      return;
    }

    let cancelled = false;
    const runRender = () => {
      const renderId = `inkade-ed-mermaid-${++editorMermaidCounter}`;
      void (async () => {
        try {
          const svg = sanitizeMermaidSvg(await renderMermaidDiagram(renderId, trimmed, theme));
          if (!svg) {
            throw new Error(t("reader.mermaidRenderFailed"));
          }
          setCachedMermaidSvg(cacheKey, svg);
          prevRenderedMermaidCodeRef.current = trimmed;
          if (!cancelled) {
            setMermaidSvg(svg);
            setMermaidError(null);
          }
        } catch (err) {
          if (!cancelled) {
            setMermaidError(err instanceof Error ? err.message : t("reader.mermaidRenderFailed"));
            setMermaidSvg(null);
          }
        }
      })();
    };

    // Debounce live keystroke edits (180ms), but render initial mount or theme switch immediately.
    const isTypingEdit =
      prevRenderedMermaidCodeRef.current !== null && prevRenderedMermaidCodeRef.current !== trimmed;
    if (!isTypingEdit) {
      runRender();
      return () => {
        cancelled = true;
      };
    }

    const timer = setTimeout(runRender, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [codeText, isMermaid, t, theme]);

  const safeMermaidSvg = useMemo(
    () => (mermaidSvg ? sanitizeMermaidSvg(mermaidSvg) : null),
    [mermaidSvg],
  );

  const [, copyToClipboard] = useCopyToClipboard();
  const scheduleResetCopied = useDebounceCallback(() => setCopied(false), 1500);

  const handleCopy = async (): Promise<void> => {
    const ok = await copyToClipboard(codeText);
    if (ok) {
      setCopied(true);
      scheduleResetCopied();
    }
  };

  const handleExportSvg = (): void => {
    if (!safeMermaidSvg) return;
    const blob = new Blob([safeMermaidSvg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "diagram.svg";
    a.click();
    URL.revokeObjectURL(url);
  };

  const displayLangLabel =
    rawLang === "plaintext" || rawLang === "text" ? t("editor.codeLanguagePlain") : rawLang;

  const showSourceEditor = !isMermaid || mermaidMode === "source" || mermaidMode === "split";
  const showMermaidPreview = isMermaid && (mermaidMode === "preview" || mermaidMode === "split");

  return (
    <>
      <NodeViewWrapper
        className="inkade-codeblock my-4 overflow-hidden rounded-lg border border-border/80 bg-code text-code-foreground"
        data-language={rawLang}
        data-slot="code-block-card"
        data-type="inkade-code-block"
      >
        {/* Header Bar */}
        <div
          className="not-typeset flex flex-wrap items-center justify-between gap-2 border-b border-border/70 bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground"
          contentEditable={false}
        >
          <div className="flex items-center gap-2">
            {readOnly ? (
              <span className="font-mono text-[11px] font-medium text-foreground/80">
                {displayLangLabel}
              </span>
            ) : (
              <Popover
                onOpenChange={(next) => {
                  setLangOpen(next);
                  if (!next) setLangQuery("");
                }}
                open={langOpen}
              >
                <PopoverTrigger
                  render={
                    <button
                      aria-label={`${t("editor.codeLanguagePlaceholder")}: ${displayLangLabel}`}
                      className="inline-flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 -ml-1.5 font-mono text-[11px] font-medium text-foreground/80 transition-colors hover:bg-accent hover:text-foreground"
                      type="button"
                    />
                  }
                >
                  <span>{displayLangLabel}</span>
                  <ChevronDownIcon className="size-3 opacity-70" />
                </PopoverTrigger>
                <PopoverPopup align="start" className="w-52" viewportClassName="gap-1.5 p-2">
                  <Input
                    autoFocus
                    onChange={(e) => setLangQuery(e.target.value)}
                    placeholder={t("editor.codeLanguagePlaceholder")}
                    size="xs"
                    startAddon={<SearchIcon className="size-3" />}
                    value={langQuery}
                  />
                  <div className="max-h-48 overflow-y-auto [scrollbar-gutter:stable]">
                    {filteredLanguages.length === 0 ? (
                      <div className="px-2 py-2.5 text-center text-xs text-muted-foreground">
                        {t("editor.codeLanguageEmpty")}
                      </div>
                    ) : (
                      <GlideHighlight
                        className="flex flex-col gap-0.5"
                        highlightClassName="rounded-[var(--radius-menu-item)] bg-accent"
                        mode="pointer"
                      >
                        {filteredLanguages.map((lang) => (
                          <button
                            className={cn(
                              "relative z-10 flex w-full cursor-pointer items-center justify-between rounded-[var(--radius-menu-item)] px-2 py-1 text-left font-mono text-xs transition-colors hover:bg-accent/60 in-data-[glide-visible=true]:hover:bg-transparent",
                              lang === rawLang
                                ? "bg-accent/70 text-foreground"
                                : "text-muted-foreground hover:text-foreground",
                            )}
                            data-glide-item
                            key={lang}
                            onClick={() => {
                              updateAttributes({ language: lang });
                              if (lang === "mermaid" && !readOnly && codeText.trim() === "") {
                                setMermaidMode("split");
                              }
                              setLangOpen(false);
                              setLangQuery("");
                            }}
                            type="button"
                          >
                            <span>{lang === "plaintext" ? t("editor.codeLanguagePlain") : lang}</span>
                            {lang === rawLang && <CheckIcon className="size-3 text-primary" />}
                          </button>
                        ))}
                      </GlideHighlight>
                    )}
                  </div>
                </PopoverPopup>
              </Popover>
            )}

            {isMermaid && (
              <SegmentedControl size="sm">
                <SegmentedControlItem
                  data-pressed={mermaidMode === "preview" ? "" : undefined}
                  onClick={() => setMermaidMode("preview")}
                >
                  {t("editor.codeMermaidPreview")}
                </SegmentedControlItem>
                <SegmentedControlItem
                  data-pressed={mermaidMode === "split" ? "" : undefined}
                  onClick={() => setMermaidMode("split")}
                >
                  {t("editor.codeMermaidSplit")}
                </SegmentedControlItem>
                <SegmentedControlItem
                  data-pressed={mermaidMode === "source" ? "" : undefined}
                  onClick={() => setMermaidMode("source")}
                >
                  {t("editor.codeMermaidSource")}
                </SegmentedControlItem>
              </SegmentedControl>
            )}
          </div>

          <div className="flex items-center gap-1">
            {isMermaid && safeMermaidSvg && (
              <>
                <Button onClick={handleExportSvg} size="xs" type="button" variant="ghost">
                  <DownloadIcon className="size-3.5" />
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
                  type="button"
                  variant="ghost"
                >
                  <Maximize2Icon className="size-3.5" />
                </Button>
              </>
            )}
            <Button onClick={() => void handleCopy()} size="xs" type="button" variant="ghost">
              {copied ? <CheckIcon className="size-3.5 text-success" /> : <CopyIcon className="size-3.5" />}
              {copied ? t("common.copied") : t("common.copy")}
            </Button>
          </div>
        </div>

        {/* Body: Code Editor + optional Live Mermaid Preview */}
        <div
          className={cn(
            isMermaid && mermaidMode === "split" && "grid grid-cols-1 divide-y md:grid-cols-2 md:divide-x md:divide-y-0",
          )}
        >
          {showMermaidPreview && (
            <div
              className={cn(
                "not-typeset flex min-h-[220px] flex-col items-center justify-center bg-card/70 p-4",
                !readOnly && mermaidMode === "preview" && "cursor-pointer",
              )}
              contentEditable={false}
              onDoubleClick={() => {
                if (!readOnly && mermaidMode === "preview") {
                  setMermaidMode("split");
                }
              }}
            >
              {safeMermaidSvg ? (
                <div
                  className="flex w-full justify-start overflow-x-auto pb-1 sm:justify-center [&_svg]:h-auto [&_svg]:max-h-[420px] [&_svg]:min-w-[520px] sm:[&_svg]:min-w-0 sm:[&_svg]:max-w-full"
                  dangerouslySetInnerHTML={{ __html: safeMermaidSvg }}
                />
              ) : mermaidError ? (
                <div className="flex flex-col items-center gap-1.5 text-center text-xs text-destructive-foreground">
                  <span>{mermaidError}</span>
                  {!readOnly && mermaidMode === "preview" && (
                    <Button
                      onClick={() => setMermaidMode("source")}
                      size="xs"
                      type="button"
                      variant="outline"
                    >
                      {t("editor.codeMermaidSource")}
                    </Button>
                  )}
                </div>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {t("editor.codeMermaidPlaceholder")}
                </span>
              )}
            </div>
          )}

          <pre
            className={cn(
              "!m-0 !rounded-none !border-0 !bg-transparent overflow-x-auto whitespace-pre p-3.5 font-mono text-[13px] leading-relaxed",
              !showSourceEditor && "hidden",
            )}
          >
            <NodeViewContent<"code"> as="code" className={`language-${rawLang}`} />
          </pre>
        </div>
      </NodeViewWrapper>

      {isMermaid && safeMermaidSvg && (
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
                </div>
              </div>
            </DialogHeader>
            <DialogPanel>
              <div
                className="flex h-[65vh] cursor-grab items-center justify-center overflow-hidden rounded-lg border bg-background p-6 active:cursor-grabbing"
                onPointerCancel={() => {
                  dragRef.current = null;
                }}
                onPointerDown={(e) => {
                  try {
                    e.currentTarget.setPointerCapture(e.pointerId);
                  } catch {
                    // Ignore in non-supporting environments
                  }
                  dragRef.current = { x: e.clientX, y: e.clientY, origX: pan.x, origY: pan.y };
                }}
                onPointerMove={(e) => {
                  const start = dragRef.current;
                  if (!start) return;
                  setPan({
                    x: start.origX + (e.clientX - start.x),
                    y: start.origY + (e.clientY - start.y),
                  });
                }}
                onPointerUp={(e) => {
                  try {
                    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                      e.currentTarget.releasePointerCapture(e.pointerId);
                    }
                  } catch {
                    // Ignore
                  }
                  dragRef.current = null;
                }}
                ref={zoomViewportRef}
              >
                <div
                  className="select-none transition-transform duration-75 [&_svg]:h-auto [&_svg]:max-w-full"
                  dangerouslySetInnerHTML={{ __html: safeMermaidSvg }}
                  style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})` }}
                />
              </div>
            </DialogPanel>
          </DialogPopup>
        </Dialog>
      )}
    </>
  );
}
