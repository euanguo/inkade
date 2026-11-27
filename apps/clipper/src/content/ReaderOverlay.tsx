import type { ExtractedArticle } from "@inkade/clipper-core/extractor";
import { useInkadeTranslation } from "@inkade/i18n";
import { BookmarkCheck, Minus, Plus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ClipperReaderTheme } from "../shared/storage.ts";
import { sanitizeReaderHtml } from "./reader-sanitizer.ts";

export interface ReaderOverlayProps {
  readonly open: boolean;
  readonly article: ExtractedArticle | null;
  readonly loading?: boolean | undefined;
  readonly initialTheme?: ClipperReaderTheme | undefined;
  readonly initialFontSize?: number | undefined;
  readonly onPrefsChange?:
    | ((prefs: { readonly readerTheme: ClipperReaderTheme; readonly readerFontSize: number }) => void)
    | undefined;
  readonly onArticleElementChange?: ((el: HTMLElement | null) => void) | undefined;
  readonly onScrollChange?: (() => void) | undefined;
  readonly onClip: (article: ExtractedArticle) => Promise<void>;
  readonly onClose: () => void;
}

export function ReaderOverlay({
  open,
  article,
  loading = false,
  initialTheme = "sepia",
  initialFontSize = 17,
  onPrefsChange,
  onArticleElementChange,
  onScrollChange,
  onClip,
  onClose,
}: ReaderOverlayProps) {
  const { t } = useInkadeTranslation();
  const [theme, setTheme] = useState<ClipperReaderTheme>(initialTheme);
  const [fontSize, setFontSize] = useState(initialFontSize);
  const [saving, setSaving] = useState(false);
  const [progressPercent, setProgressPercent] = useState(0);
  const backdropRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setTheme(initialTheme);
  }, [initialTheme]);

  useEffect(() => {
    setFontSize(initialFontSize);
  }, [initialFontSize]);

  // Lock background page scroll while Reader Mode is open and support Escape to close
  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    const prevOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.documentElement.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !article) {
      onArticleElementChange?.(null);
    }
  }, [open, article, onArticleElementChange]);

  const safeHtml = useMemo(() => {
    if (!article?.cleanHtml) return "";
    return sanitizeReaderHtml(article.cleanHtml);
  }, [article?.cleanHtml]);

  if (!open) return null;

  const updateTheme = (nextTheme: ClipperReaderTheme) => {
    setTheme(nextTheme);
    onPrefsChange?.({ readerTheme: nextTheme, readerFontSize: fontSize });
  };

  const updateFontSize = (nextSize: number) => {
    const clamped = Math.max(13, Math.min(24, nextSize));
    setFontSize(clamped);
    onPrefsChange?.({ readerTheme: theme, readerFontSize: clamped });
  };

  const handleBackdropScroll = () => {
    const el = backdropRef.current;
    if (el) {
      const scrollable = Math.max(1, el.scrollHeight - el.clientHeight);
      const pct = Math.max(0, Math.min(100, Math.round((el.scrollTop / scrollable) * 100)));
      setProgressPercent(pct);
    }
    onScrollChange?.();
  };

  const handleSave = async () => {
    if (!article) return;
    setSaving(true);
    try {
      await onClip(article);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className={`ink-reader-backdrop ${theme === "light" ? "light" : theme}`}
      onScroll={handleBackdropScroll}
      ref={backdropRef}
    >
      <div className="ink-reader-bar" data-inkade-ui-chrome="true">
        <div
          aria-hidden="true"
          className="ink-reader-progress"
          style={{ width: `${progressPercent}%` }}
        />
        <div className="ink-toolbar-row">
          {(["light", "sepia", "dark"] as const).map((mode) => (
            <button
              className={`ink-btn-sm ${theme === mode ? "primary" : ""}`}
              key={mode}
              onClick={() => updateTheme(mode)}
              type="button"
            >
              {mode === "light"
                ? t("clipper.readerThemeLight")
                : mode === "sepia"
                  ? t("clipper.readerThemeSepia")
                  : t("clipper.readerThemeDark")}
            </button>
          ))}
          <button
            aria-label={t("clipper.readerDecreaseFont")}
            className="ink-btn-sm"
            onClick={() => updateFontSize(fontSize - 1)}
            title={t("clipper.readerDecreaseFont")}
            type="button"
          >
            <Minus size={12} />
          </button>
          <span className="ink-reader-fontsize">
            {t("clipper.fontSizePx", { count: fontSize })}
          </span>
          <button
            aria-label={t("clipper.readerIncreaseFont")}
            className="ink-btn-sm"
            onClick={() => updateFontSize(fontSize + 1)}
            title={t("clipper.readerIncreaseFont")}
            type="button"
          >
            <Plus size={12} />
          </button>
        </div>

        <div className="ink-toolbar-row">
          {article ? (
            <button
              className="ink-btn-sm primary"
              disabled={saving}
              onClick={() => void handleSave()}
              type="button"
            >
              <BookmarkCheck size={13} />
              <span>{saving ? t("clipper.clippingPage") : t("clipper.readerClipBtn")}</span>
            </button>
          ) : null}
          <button className="ink-btn-sm" onClick={onClose} type="button">
            <X size={13} />
            <span>{t("clipper.readerCloseBtn")}</span>
          </button>
        </div>
      </div>

      {article ? (
        <article
          className="ink-reader-article"
          ref={(node) => {
            onArticleElementChange?.(node);
          }}
          style={{ maxWidth: "70ch", fontSize: `${fontSize}px` }}
        >
          <h1>{article.title}</h1>
          {article.meta.author || article.meta.domain ? (
            <p style={{ opacity: 0.7, fontSize: "0.88em" }}>
              {[article.meta.author, article.meta.domain].filter(Boolean).join(" · ")}
            </p>
          ) : null}
          {safeHtml ? (
            <div dangerouslySetInnerHTML={{ __html: safeHtml }} />
          ) : (
            <pre style={{ whiteSpace: "pre-wrap" }}>{article.markdown}</pre>
          )}
        </article>
      ) : loading ? (
        <div className="ink-reader-loading">{t("common.loading")}</div>
      ) : null}
    </div>
  );
}
