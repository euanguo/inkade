import {
  extractArticleFromDocumentAsync,
  extractRegionFromElement,
  type ExtractedArticle,
  type ExtractedHighlightAnchor,
} from "@inkade/clipper-core/extractor";
import {
  asDocumentId,
  asHighlightId,
  type DocumentHighlight,
  type DocumentId,
  type HighlightColor,
  type HighlightId,
} from "@inkade/core";
import { InkadeI18nProvider, initInkadeI18n, useInkadeTranslation } from "@inkade/i18n";
import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  loadClipperSettings,
  saveClipperSettings,
  type ClipperReaderTheme,
} from "../shared/storage.ts";
import { getWebExt } from "../shared/webext.ts";
import { HighlightOverlay } from "./HighlightOverlay.tsx";
import { locateHighlightRange } from "./highlight-renderer.ts";
import { PAGE_UI_SHADOW_CSS } from "./page-ui-styles.ts";
import { ReaderOverlay } from "./ReaderOverlay.tsx";
import { RegionPicker } from "./RegionPicker.tsx";
import { SelectionToolbar } from "./SelectionToolbar.tsx";

declare global {
  interface Window {
    __inkadePageUiAttached?: boolean;
  }
}

export const CLIPPER_PAGE_UI_MESSAGES = {
  showToast: "INKADE_SHOW_TOAST",
  renderHighlights: "INKADE_RENDER_HIGHLIGHTS",
  scrollToHighlight: "INKADE_SCROLL_TO_HIGHLIGHT",
  startRegionPicker: "INKADE_START_REGION_PICKER",
  toggleReader: "INKADE_TOGGLE_READER",
} as const;

interface ToastItem {
  readonly id: number;
  readonly kind: "info" | "success" | "error";
  readonly text: string;
  readonly openUrl?: string | undefined;
  readonly actionLabel?: string | undefined;
  readonly onAction?: (() => void) | undefined;
  readonly durationMs: number;
}

interface PageUiControllerHandles {
  pushToast: (item: Omit<ToastItem, "id" | "durationMs"> & { readonly durationMs?: number }) => void;
  setHighlightsState: (docId: DocumentId | undefined, items: readonly DocumentHighlight[]) => void;
  scrollToHighlight: (highlightId: HighlightId) => void;
  startRegionPicker: () => void;
  toggleReader: () => void;
}

async function sendBgMessage<T = unknown>(payload: Record<string, unknown>): Promise<T> {
  const ext = getWebExt();
  if (!ext?.runtime?.sendMessage) {
    throw new Error("Extension runtime unavailable");
  }
  return ext.runtime.sendMessage<T>(payload);
}

function ToastCard({
  item,
  onDismiss,
  openLabel,
  closeLabel,
}: {
  readonly item: ToastItem;
  readonly onDismiss: (id: number) => void;
  readonly openLabel: string;
  readonly closeLabel: string;
}) {
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    if (hovered) return;
    const timer = window.setTimeout(() => {
      onDismiss(item.id);
    }, item.durationMs);
    return () => window.clearTimeout(timer);
  }, [item.id, item.durationMs, hovered, onDismiss]);

  return (
    <div
      className={`ink-toast ${item.kind}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span style={{ flex: 1 }}>{item.text}</span>
      {item.actionLabel && item.onAction ? (
        <button
          className="ink-toast-link"
          onClick={() => {
            item.onAction?.();
            onDismiss(item.id);
          }}
          type="button"
        >
          {item.actionLabel}
        </button>
      ) : null}
      {item.openUrl ? (
        <button
          className="ink-toast-link"
          onClick={() => window.open(item.openUrl, "_blank", "noopener,noreferrer")}
          type="button"
        >
          {openLabel}
        </button>
      ) : null}
      <button
        aria-label={closeLabel}
        className="ink-toast-close"
        onClick={() => onDismiss(item.id)}
        type="button"
      >
        <X size={13} />
      </button>
    </div>
  );
}

function PageUiRoot({
  shadowRoot,
  initialFloatingToolbar,
  initialHighlightColor,
  initialReaderTheme,
  initialReaderFontSize,
  onBindHandles,
}: {
  readonly shadowRoot: ShadowRoot;
  readonly initialFloatingToolbar: boolean;
  readonly initialHighlightColor: HighlightColor;
  readonly initialReaderTheme: ClipperReaderTheme;
  readonly initialReaderFontSize: number;
  readonly onBindHandles: (handles: PageUiControllerHandles) => void;
}) {
  const { t } = useInkadeTranslation();
  const [toasts, setToasts] = useState<readonly ToastItem[]>([]);
  const [floatingToolbarEnabled, setFloatingToolbarEnabled] = useState(initialFloatingToolbar);
  const [defaultHighlightColor, setDefaultHighlightColor] =
    useState<HighlightColor>(initialHighlightColor);
  const [readerTheme, setReaderTheme] = useState<ClipperReaderTheme>(initialReaderTheme);
  const [readerFontSize, setReaderFontSize] = useState<number>(initialReaderFontSize);

  const [documentId, setDocumentId] = useState<DocumentId | undefined>(undefined);
  const [highlights, setHighlights] = useState<readonly DocumentHighlight[]>([]);
  const [pulseId, setPulseId] = useState<HighlightId | null>(null);
  const [regionPickerActive, setRegionPickerActive] = useState(false);
  const [readerOpen, setReaderOpen] = useState(false);
  const [readerLoading, setReaderLoading] = useState(false);
  const [readerArticle, setReaderArticle] = useState<ExtractedArticle | null>(null);
  const [readerArticleEl, setReaderArticleEl] = useState<HTMLElement | null>(null);
  const pendingDeleteTimersRef = useRef<Map<HighlightId, number>>(new Map());

  // Live sync settings & locale across open tabs
  useEffect(() => {
    const ext = getWebExt();
    if (!ext?.storage?.onChanged) return;
    const onChanged = (changes: Record<string, unknown>, areaName: string) => {
      if ((areaName === "sync" || areaName === "local") && "inkade:clipper:settings" in changes) {
        void loadClipperSettings().then((next) => {
          initInkadeI18n(next.locale);
          setFloatingToolbarEnabled(next.showFloatingToolbar);
          setDefaultHighlightColor(next.highlightColor);
          setReaderTheme(next.readerTheme);
          setReaderFontSize(next.readerFontSize);
        });
      }
    };
    ext.storage.onChanged.addListener(onChanged);
    return () => ext.storage?.onChanged?.removeListener?.(onChanged);
  }, []);

  useEffect(() => {
    const timers = pendingDeleteTimersRef.current;
    return () => {
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
    };
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const nextToastSeq = useRef(0);
  const pushToast = useCallback(
    (item: Omit<ToastItem, "id" | "durationMs"> & { readonly durationMs?: number }) => {
      nextToastSeq.current += 1;
      const id = Date.now() * 1000 + nextToastSeq.current;
      const durationMs =
        item.durationMs ??
        (item.kind === "error" || item.onAction || item.openUrl ? 6000 : 3600);
      setToasts((prev) => [...prev.slice(-3), { ...item, id, durationMs }]);
    },
    [],
  );

  const toggleReader = useCallback(() => {
    setReaderOpen((wasOpen) => {
      if (!wasOpen) {
        window.getSelection()?.removeAllRanges();
        setReaderLoading(true);
        void extractArticleFromDocumentAsync(document, window.location.href)
          .then((article) => {
            setReaderArticle(article);
          })
          .catch((err) => {
            setReaderOpen(false);
            pushToast({
              kind: "error",
              text: t("clipper.clipFailed", {
                error: err instanceof Error ? err.message : String(err),
              }),
            });
          })
          .finally(() => {
            setReaderLoading(false);
          });
      }
      return !wasOpen;
    });
  }, [pushToast, t]);

  const scrollToHighlight = useCallback(
    (highlightId: HighlightId) => {
      const target = highlights.find((h) => h.id === highlightId);
      if (!target) return;
      const scopeRoot = readerOpen && readerArticleEl ? readerArticleEl : document.body;
      const located = locateHighlightRange(
        document,
        {
          quote: target.quote,
          prefixContext: target.prefixContext,
          suffixContext: target.suffixContext,
        },
        undefined,
        scopeRoot,
      );
      if (located) {
        const rect = located.range.getBoundingClientRect();
        if (readerOpen && readerArticleEl?.parentElement) {
          readerArticleEl.parentElement.scrollBy({
            top: rect.top - window.innerHeight * 0.3,
            behavior: "smooth",
          });
        } else {
          window.scrollBy({
            top: rect.top - window.innerHeight * 0.3,
            behavior: "smooth",
          });
        }
        setPulseId(highlightId);
        setTimeout(() => setPulseId((curr) => (curr === highlightId ? null : curr)), 2000);
      }
    },
    [highlights, readerOpen, readerArticleEl],
  );

  useEffect(() => {
    onBindHandles({
      pushToast,
      setHighlightsState: (docId, items) => {
        setDocumentId(docId);
        setHighlights(items);
      },
      scrollToHighlight,
      startRegionPicker: () => setRegionPickerActive(true),
      toggleReader,
    });
  }, [onBindHandles, pushToast, scrollToHighlight, toggleReader]);

  const handleCreateHighlight = async (
    anchor: ExtractedHighlightAnchor,
    color: HighlightColor,
    noteMarkdown: string,
  ) => {
    try {
      const res = await sendBgMessage<{
        readonly ok: boolean;
        readonly documentId?: string;
        readonly highlights?: readonly DocumentHighlight[];
        readonly message?: string;
        readonly openUrl?: string;
        readonly error?: string;
      }>({
        type: "INKADE_UI_CREATE_HIGHLIGHT",
        anchor,
        color,
        noteMarkdown,
      });
      if (!res?.ok) throw new Error(res?.error || "Failed");
      setDocumentId(res.documentId ? asDocumentId(res.documentId) : undefined);
      if (res.highlights) setHighlights(res.highlights);
      if (res.message) {
        pushToast({ kind: "success", text: res.message, openUrl: res.openUrl });
      }
    } catch (err) {
      pushToast({
        kind: "error",
        text: t("clipper.highlightFailed", {
          error: err instanceof Error ? err.message : String(err),
        }),
      });
    }
  };

  const handleUpdateHighlight = async (
    highlightId: HighlightId,
    patch: { readonly color?: HighlightColor; readonly noteMarkdown?: string },
  ) => {
    try {
      const res = await sendBgMessage<{
        readonly ok: boolean;
        readonly highlight?: DocumentHighlight;
        readonly error?: string;
      }>({
        type: "INKADE_UI_UPDATE_HIGHLIGHT",
        highlightId,
        patch,
      });
      if (!res?.ok || !res.highlight) throw new Error(res?.error || "Failed");
      setHighlights((prev) => prev.map((h) => (h.id === highlightId ? res.highlight! : h)));
      pushToast({ kind: "success", text: t("clipper.highlightUpdated") });
    } catch (err) {
      pushToast({
        kind: "error",
        text: t("clipper.highlightFailed", {
          error: err instanceof Error ? err.message : String(err),
        }),
      });
    }
  };

  const handleDeleteHighlight = (highlight: DocumentHighlight) => {
    // Optimistically remove highlight; delay backend deletion 5s so Undo cancels cleanly
    setHighlights((prev) => prev.filter((h) => h.id !== highlight.id));
    const timer = window.setTimeout(() => {
      pendingDeleteTimersRef.current.delete(highlight.id);
      void sendBgMessage<{ readonly ok: boolean; readonly error?: string }>({
        type: "INKADE_UI_DELETE_HIGHLIGHT",
        highlightId: highlight.id,
        documentId,
      }).catch((err) => {
        setHighlights((prev) => [highlight, ...prev]);
        pushToast({
          kind: "error",
          text: t("clipper.highlightFailed", {
            error: err instanceof Error ? err.message : String(err),
          }),
        });
      });
    }, 5000);
    pendingDeleteTimersRef.current.set(highlight.id, timer);

    pushToast({
      kind: "info",
      text: t("clipper.highlightDeleted"),
      actionLabel: t("common.undo"),
      durationMs: 5200,
      onAction: () => {
        const pending = pendingDeleteTimersRef.current.get(highlight.id);
        if (pending !== undefined) {
          window.clearTimeout(pending);
          pendingDeleteTimersRef.current.delete(highlight.id);
          setHighlights((prev) => [highlight, ...prev]);
        } else if (documentId) {
          void sendBgMessage({
            type: "INKADE_UI_RESTORE_HIGHLIGHT",
            documentId,
            anchor: {
              quote: highlight.quote,
              prefixContext: highlight.prefixContext,
              suffixContext: highlight.suffixContext,
            },
            color: highlight.color,
            noteMarkdown: highlight.noteMarkdown,
          });
        }
      },
    });
    return Promise.resolve();
  };

  const handleClipSelection = async (
    anchor: ExtractedHighlightAnchor,
    selectionMarkdown: string,
  ) => {
    try {
      const res = await sendBgMessage<{
        readonly ok: boolean;
        readonly message?: string;
        readonly openUrl?: string;
        readonly error?: string;
      }>({
        type: "INKADE_UI_CLIP_SELECTION",
        url: anchor.url,
        title: anchor.title,
        selectionMarkdown: selectionMarkdown || anchor.quote,
      });
      if (!res?.ok) throw new Error(res?.error || "Failed");
      if (res.message) pushToast({ kind: "success", text: res.message, openUrl: res.openUrl });
    } catch (err) {
      pushToast({
        kind: "error",
        text: t("clipper.clipFailed", {
          error: err instanceof Error ? err.message : String(err),
        }),
      });
    }
  };

  const handleAskAde = async (
    anchor: {
      readonly url?: string;
      readonly title?: string;
      readonly quote: string;
      readonly prefixContext?: string;
      readonly suffixContext?: string;
    },
    prompt?: string,
  ) => {
    try {
      const res = await sendBgMessage<{
        readonly ok: boolean;
        readonly message?: string;
        readonly openUrl?: string;
        readonly error?: string;
      }>({
        type: "INKADE_UI_DISPATCH_ADE",
        url: anchor.url ?? window.location.href,
        title: anchor.title ?? document.title,
        documentId,
        prompt,
        anchor: {
          quote: anchor.quote,
          prefixContext: anchor.prefixContext ?? "",
          suffixContext: anchor.suffixContext ?? "",
        },
      });
      if (!res?.ok) throw new Error(res?.error || "Failed");
      if (res.message) pushToast({ kind: "success", text: res.message, openUrl: res.openUrl });
    } catch (err) {
      pushToast({
        kind: "error",
        text: t("clipper.clipFailed", {
          error: err instanceof Error ? err.message : String(err),
        }),
      });
    }
  };

  const handleRegionSelected = useCallback(
    (element: Element) => {
      setRegionPickerActive(false);
      const regionArticle = extractRegionFromElement(element, window.location.href);
      void sendBgMessage<{
        readonly ok: boolean;
        readonly message?: string;
        readonly openUrl?: string;
        readonly error?: string;
      }>({
        type: "INKADE_UI_CLIP_ARTICLE",
        article: regionArticle,
      })
        .then((res) => {
          if (!res?.ok) throw new Error(res?.error || "Failed");
          if (res.message) pushToast({ kind: "success", text: res.message, openUrl: res.openUrl });
        })
        .catch((err) => {
          pushToast({
            kind: "error",
            text: t("clipper.clipFailed", {
              error: err instanceof Error ? err.message : String(err),
            }),
          });
        });
    },
    [pushToast, t],
  );

  const handleReaderClip = async (article: ExtractedArticle) => {
    try {
      const res = await sendBgMessage<{
        readonly ok: boolean;
        readonly message?: string;
        readonly openUrl?: string;
        readonly error?: string;
      }>({
        type: "INKADE_UI_CLIP_ARTICLE",
        article,
      });
      if (!res?.ok) throw new Error(res?.error || "Failed");
      if (res.message) pushToast({ kind: "success", text: res.message, openUrl: res.openUrl });
    } catch (err) {
      pushToast({
        kind: "error",
        text: t("clipper.clipFailed", {
          error: err instanceof Error ? err.message : String(err),
        }),
      });
    }
  };

  const selectionBroadcastRef = useRef<number | null>(null);
  const handleSelectionChange = useCallback(
    (sel: ExtractedHighlightAnchor | null, md: string) => {
      if (selectionBroadcastRef.current !== null) {
        window.clearTimeout(selectionBroadcastRef.current);
      }
      selectionBroadcastRef.current = window.setTimeout(() => {
        selectionBroadcastRef.current = null;
        void sendBgMessage({
          type: "INKADE_SELECTION_CHANGED",
          selection: sel,
          selectionMarkdown: md,
        }).catch(() => {});
      }, 160);
    },
    [],
  );

  return (
    <>
      <ReaderOverlay
        article={readerArticle}
        initialFontSize={readerFontSize}
        initialTheme={readerTheme}
        loading={readerLoading}
        onArticleElementChange={setReaderArticleEl}
        onClip={handleReaderClip}
        onClose={() => {
          window.getSelection()?.removeAllRanges();
          setReaderOpen(false);
        }}
        onPrefsChange={(prefs) => {
          setReaderTheme(prefs.readerTheme);
          setReaderFontSize(prefs.readerFontSize);
          void saveClipperSettings(prefs);
        }}
        open={readerOpen}
      />

      <HighlightOverlay
        documentId={documentId}
        highlights={highlights}
        onAskAde={(hl, prompt) => handleAskAde(hl, prompt)}
        onDeleteHighlight={handleDeleteHighlight}
        onOpenInInkade={(docId) =>
          void sendBgMessage({ type: "INKADE_UI_OPEN_DOC", documentId: docId })
        }
        onUpdateHighlight={handleUpdateHighlight}
        pulseHighlightId={pulseId}
        rootNode={readerOpen && readerArticleEl ? readerArticleEl : undefined}
      />

      <SelectionToolbar
        defaultHighlightColor={defaultHighlightColor}
        enabled={floatingToolbarEnabled && !regionPickerActive && !readerLoading}
        onAskAde={(anchor, prompt) => handleAskAde(anchor, prompt)}
        onClipSelection={handleClipSelection}
        onCopied={() => pushToast({ kind: "success", text: t("clipper.sidePanelCopied") })}
        onCreateHighlight={handleCreateHighlight}
        onHiddenForSession={(restore) => {
          pushToast({
            kind: "info",
            text: t("clipper.toolbarHiddenNotice"),
            actionLabel: t("common.undo"),
            onAction: restore,
          });
        }}
        onSelectionChange={handleSelectionChange}
        readerArticleEl={readerOpen ? readerArticleEl : null}
        shadowRoot={shadowRoot}
      />

      <RegionPicker
        active={regionPickerActive}
        onCancel={() => setRegionPickerActive(false)}
        onSelectElement={handleRegionSelected}
      />

      {toasts.length > 0 ? (
        <div className="ink-toast-stack" data-inkade-ui-chrome="true" role="status">
          {toasts.map((item) => (
            <ToastCard
              closeLabel={t("common.close")}
              item={item}
              key={item.id}
              onDismiss={dismissToast}
              openLabel={t("clipper.openInInkade")}
            />
          ))}
        </div>
      ) : null}
    </>
  );
}

function mountPageUi(): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (window.__inkadePageUiAttached) return;
  window.__inkadePageUiAttached = true;

  let host = document.getElementById("inkade-clipper-root");
  if (!host) {
    host = document.createElement("div");
    host.id = "inkade-clipper-root";
    document.documentElement.appendChild(host);
  }

  const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = PAGE_UI_SHADOW_CSS;
  shadow.appendChild(style);

  const container = document.createElement("div");
  shadow.appendChild(container);

  let handles: PageUiControllerHandles | null = null;
  const queuedActions: Array<(h: PageUiControllerHandles) => void> = [];

  const dispatchOrQueue = (fn: (h: PageUiControllerHandles) => void) => {
    if (handles) fn(handles);
    else queuedActions.push(fn);
  };

  void loadClipperSettings().then((settings) => {
    initInkadeI18n(settings.locale);
    createRoot(container).render(
      <InkadeI18nProvider>
        <PageUiRoot
          initialFloatingToolbar={settings.showFloatingToolbar}
          initialHighlightColor={settings.highlightColor}
          initialReaderFontSize={settings.readerFontSize}
          initialReaderTheme={settings.readerTheme}
          onBindHandles={(bound) => {
            handles = bound;
            while (queuedActions.length > 0) {
              const fn = queuedActions.shift();
              fn?.(bound);
            }
          }}
          shadowRoot={shadow}
        />
      </InkadeI18nProvider>,
    );
  });

  const ext = getWebExt();
  ext?.runtime?.onMessage?.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message !== "object") return false;
    const msg = message as {
      readonly type?: string;
      readonly kind?: "info" | "success" | "error";
      readonly text?: string;
      readonly openUrl?: string;
      readonly documentId?: string;
      readonly highlights?: readonly DocumentHighlight[];
      readonly highlightId?: string;
    };

    if (msg.type === CLIPPER_PAGE_UI_MESSAGES.showToast && msg.text) {
      const text = msg.text;
      dispatchOrQueue((h) => h.pushToast({ kind: msg.kind ?? "info", text, openUrl: msg.openUrl }));
      sendResponse({ ok: true });
      return true;
    }

    if (msg.type === CLIPPER_PAGE_UI_MESSAGES.renderHighlights) {
      const docId = msg.documentId ? asDocumentId(msg.documentId) : undefined;
      const items = msg.highlights ?? [];
      dispatchOrQueue((h) => h.setHighlightsState(docId, items));
      sendResponse({ ok: true });
      return true;
    }

    if (msg.type === CLIPPER_PAGE_UI_MESSAGES.scrollToHighlight && msg.highlightId) {
      const hlId = asHighlightId(msg.highlightId);
      dispatchOrQueue((h) => h.scrollToHighlight(hlId));
      sendResponse({ ok: true });
      return true;
    }

    if (msg.type === CLIPPER_PAGE_UI_MESSAGES.startRegionPicker) {
      dispatchOrQueue((h) => h.startRegionPicker());
      sendResponse({ ok: true });
      return true;
    }

    if (msg.type === CLIPPER_PAGE_UI_MESSAGES.toggleReader) {
      dispatchOrQueue((h) => h.toggleReader());
      sendResponse({ ok: true });
      return true;
    }

    return false;
  });
}

mountPageUi();
