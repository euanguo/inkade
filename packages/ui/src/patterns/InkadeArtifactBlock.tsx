"use client";

import {
  ARTIFACT_DEFAULT_HEIGHT_PX,
  ARTIFACT_MAX_HEIGHT_PX,
  ARTIFACT_MIN_HEIGHT_PX,
  asDocumentArtifactId,
  documentArtifactIdSchema,
  INKADE_ARTIFACT_CHANNEL,
  type ArtifactSandboxTicket,
  type DocumentArtifactId,
  type ReaderPaperModePref,
  type SendHighlightToAgentResult,
  type SubmitArtifactCommentInput,
} from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import {
  AlertTriangleIcon,
  DatabaseIcon,
  FileTextIcon,
  Maximize2Icon,
  RefreshCwIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  SparklesIcon,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useResolvedTheme } from "../lib/use-resolved-theme.ts";
import { cn } from "../lib/utils.ts";
import { Badge } from "../primitives/badge.tsx";
import { Button } from "../primitives/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "../primitives/dialog.tsx";
import { Skeleton } from "../primitives/skeleton.tsx";
import { toastManager } from "../primitives/toast.tsx";

export interface InkadeArtifactBlockProps {
  readonly artifactId: string;
  readonly title?: string | undefined;
  readonly heightPx?: number | undefined;
  readonly fallbackMarkdown?: string | undefined;
  readonly theme?: "light" | "dark" | undefined;
  readonly paperMode?: ReaderPaperModePref | undefined;
  readonly readOnly?: boolean | undefined;
  readonly headerExtra?: React.ReactNode;
  readonly className?: string | undefined;
  readonly handshakeTimeoutMs?: number | undefined;
  readonly onUpdateHeight?: ((heightPx: number) => void) | undefined;
  readonly onIssueTicket?:
    | ((artifactId: DocumentArtifactId) => Promise<ArtifactSandboxTicket>)
    | undefined;
  readonly onSubmitComment?:
    | ((
        artifactId: DocumentArtifactId,
        input: SubmitArtifactCommentInput,
      ) => Promise<SendHighlightToAgentResult>)
    | undefined;
  readonly onOpenSecuritySettings?: (() => void) | undefined;
}

const FALLBACK_REMARK_PLUGINS = [remarkGfm];

function fallbackUrlTransform(url: string): string {
  return /^(https?:|mailto:|tel:|#|\/)/i.test(url) ? url : "";
}

function clampHeightPx(raw?: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
    return ARTIFACT_DEFAULT_HEIGHT_PX;
  }
  return Math.min(ARTIFACT_MAX_HEIGHT_PX, Math.max(ARTIFACT_MIN_HEIGHT_PX, Math.round(raw)));
}

function buildSandboxThemePayload(theme: "light" | "dark", paper: ReaderPaperModePref) {
  if (theme === "dark") {
    return {
      mode: "dark" as const,
      paper,
      tokens: {
        bg: "#141517",
        fg: "#eeeeef",
        muted: "#9b9ea8",
        border: "rgba(255, 255, 255, 0.1)",
        surface: "#1b1d22",
        accent: "#60a5fa",
        codeBg: "#1e2026",
      },
    };
  }
  if (paper === "sepia") {
    return {
      mode: "light" as const,
      paper,
      tokens: {
        bg: "#fbf8f1",
        fg: "#2b251e",
        muted: "#6e6254",
        border: "rgba(120, 96, 62, 0.16)",
        surface: "#f4efe4",
        accent: "#5c4a32",
        codeBg: "#efe8d8",
      },
    };
  }
  return {
    mode: "light" as const,
    paper,
    tokens: {
      bg: "#ffffff",
      fg: "#171717",
      muted: "#6b6f76",
      border: "rgba(0, 0, 0, 0.08)",
      surface: "#f5f5f5",
      accent: "#171717",
      codeBg: "#f8f8f9",
    },
  };
}

function formatArtifactSourceTime(iso: string): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return iso;
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(parsed));
  } catch {
    return iso;
  }
}

export function InkadeArtifactBlock({
  artifactId,
  title: initialTitle,
  heightPx: initialHeightPx,
  fallbackMarkdown: initialFallbackMarkdown,
  theme: explicitTheme,
  paperMode: explicitPaperMode,
  readOnly = false,
  headerExtra,
  className,
  handshakeTimeoutMs = 3000,
  onUpdateHeight,
  onIssueTicket,
  onSubmitComment,
  onOpenSecuritySettings,
}: InkadeArtifactBlockProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const resolvedTheme = useResolvedTheme(explicitTheme);
  const [domPaperMode, setDomPaperMode] = useState<ReaderPaperModePref>(() => {
    if (typeof document !== "undefined" && document.documentElement.dataset.paper === "sepia") {
      return "sepia";
    }
    return "default";
  });

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const sync = () => {
      setDomPaperMode(root.dataset.paper === "sepia" ? "sepia" : "default");
    };
    sync();
    if (typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["data-paper"] });
    return () => observer.disconnect();
  }, []);

  const paperMode: ReaderPaperModePref =
    explicitPaperMode === "sepia" || domPaperMode === "sepia" ? "sepia" : "default";

  const parsedArtifactId = useMemo(() => {
    const trimmed = artifactId.trim();
    if (!trimmed) return null;
    const res = documentArtifactIdSchema.safeParse(trimmed);
    return res.success ? asDocumentArtifactId(res.data) : null;
  }, [artifactId]);

  const [ticket, setTicket] = useState<ArtifactSandboxTicket | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(parsedArtifactId && onIssueTicket));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [showFallback, setShowFallback] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  const [heightPx, setHeightPx] = useState<number>(() => clampHeightPx(initialHeightPx));
  const [handshakeTimedOut, setHandshakeTimedOut] = useState(false);
  const [handshakeReady, setHandshakeReady] = useState(false);

  const inlineIframeRef = useRef<HTMLIFrameElement | null>(null);
  const fullscreenIframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    setHeightPx(clampHeightPx(initialHeightPx));
  }, [initialHeightPx]);

  useEffect(() => {
    setHandshakeTimedOut(false);
    setHandshakeReady(false);
    if (!ticket || loading || showFallback || loadError) return;
    const delayMs = Math.max(10, handshakeTimeoutMs);
    const timer = setTimeout(() => {
      setHandshakeTimedOut(true);
    }, delayMs);
    return () => clearTimeout(timer);
  }, [ticket, loading, showFallback, loadError, handshakeTimeoutMs]);

  useEffect(() => {
    if (!parsedArtifactId || !onIssueTicket) {
      setTicket(null);
      setLoading(false);
      setLoadError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    void onIssueTicket(parsedArtifactId)
      .then((nextTicket) => {
        if (cancelled) return;
        setTicket(nextTicket);
        setLoading(false);
        if (initialHeightPx === undefined && nextTicket.heightPx) {
          setHeightPx(clampHeightPx(nextTicket.heightPx));
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoading(false);
        setTicket(null);
        setLoadError(err instanceof Error ? err.message : t("inkadeArtifact.loadFailed"));
      });

    return () => {
      cancelled = true;
    };
  }, [parsedArtifactId, onIssueTicket, refreshNonce, initialHeightPx, t]);

  const syncThemeToFrame = useCallback(
    (win: Window | null | undefined, activeTicket: ArtifactSandboxTicket | null) => {
      if (!win || !activeTicket) return;
      if (activeTicket.capabilities.theme !== true) return;
      const targetOrigin = activeTicket.sameSite ? "*" : activeTicket.sandboxOrigin;
      win.postMessage(
        {
          channel: INKADE_ARTIFACT_CHANNEL,
          artifactId: activeTicket.artifactId,
          type: "theme.sync",
          payload: buildSandboxThemePayload(resolvedTheme, paperMode),
        },
        targetOrigin,
      );
    },
    [paperMode, resolvedTheme],
  );

  useEffect(() => {
    syncThemeToFrame(inlineIframeRef.current?.contentWindow, ticket);
    if (fullscreenOpen) {
      syncThemeToFrame(fullscreenIframeRef.current?.contentWindow, ticket);
    }
  }, [fullscreenOpen, syncThemeToFrame, ticket]);

  useEffect(() => {
    if (!ticket || !parsedArtifactId) return;

    const handleMessage = (event: MessageEvent<unknown>): void => {
      const inlineWin = inlineIframeRef.current?.contentWindow;
      const fullWin = fullscreenIframeRef.current?.contentWindow;
      const isKnownSource =
        (inlineWin && event.source === inlineWin) || (fullWin && event.source === fullWin);
      if (!isKnownSource) return;

      const expectedOrigin = ticket.sameSite ? "null" : ticket.sandboxOrigin;
      if (event.origin !== expectedOrigin) return;

      const data = event.data;
      if (!data || typeof data !== "object") return;
      const record = data as Record<string, unknown>;
      if (record.channel !== INKADE_ARTIFACT_CHANNEL) return;
      if (record.artifactId !== parsedArtifactId) return;

      const msgType = record.type;
      const targetWin = event.source as Window | null;
      const replyTargetOrigin = ticket.sameSite ? "*" : ticket.sandboxOrigin;

      if (msgType === "artifact.ready") {
        setHandshakeReady(true);
        setHandshakeTimedOut(false);
        syncThemeToFrame(targetWin, ticket);
        return;
      }

      if (msgType === "artifact.escape") {
        setFullscreenOpen(false);
        setSourcesOpen(false);
        return;
      }

      if (msgType === "artifact.height") {
        const payload =
          record.payload && typeof record.payload === "object"
            ? (record.payload as Record<string, unknown>)
            : null;
        if (payload && typeof payload.heightPx === "number") {
          setHeightPx(clampHeightPx(payload.heightPx));
        }
        return;
      }

      if (msgType === "artifact.comment") {
        const requestId = typeof record.requestId === "string" ? record.requestId : "";
        const sendReply = (ok: boolean, resultOrError: { readonly payload?: unknown; readonly error?: string }) => {
          targetWin?.postMessage(
            {
              channel: INKADE_ARTIFACT_CHANNEL,
              artifactId: parsedArtifactId,
              type: "artifact.comment.result",
              requestId,
              ok,
              ...resultOrError,
            },
            replyTargetOrigin,
          );
        };

        if (ticket.sameSite) {
          const message = t("inkadeArtifact.commentDisabledSameSite");
          toastManager.add({ title: message, type: "error" });
          sendReply(false, { error: message });
          return;
        }

        if (!onSubmitComment) {
          const message = t("inkadeArtifact.commentFailedToast");
          sendReply(false, { error: message });
          return;
        }

        const payload =
          record.payload && typeof record.payload === "object"
            ? (record.payload as Record<string, unknown>)
            : {};
        const handoffNote =
          typeof payload.handoffNote === "string" ? payload.handoffNote.trim() : "";
        const authorName =
          typeof payload.authorName === "string" && payload.authorName.trim()
            ? payload.authorName.trim()
            : undefined;

        void onSubmitComment(parsedArtifactId, {
          handoffNote,
          ...(authorName ? { authorName } : {}),
        })
          .then((result) => {
            toastManager.add({
              title: t("inkadeArtifact.commentSubmittedToast"),
              type: "success",
            });
            sendReply(true, { payload: result });
          })
          .catch((err: unknown) => {
            const msg =
              err instanceof Error ? err.message : t("inkadeArtifact.commentFailedToast");
            toastManager.add({ title: msg, type: "error" });
            sendReply(false, { error: msg });
          });
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [onSubmitComment, parsedArtifactId, syncThemeToFrame, t, ticket]);

  useEffect(() => {
    if ((!fullscreenOpen && !sourcesOpen) || typeof window === "undefined") return;
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && !event.isComposing) {
        setFullscreenOpen(false);
        setSourcesOpen(false);
      }
    };
    window.addEventListener("keydown", handleEscape, true);
    return () => window.removeEventListener("keydown", handleEscape, true);
  }, [fullscreenOpen, sourcesOpen]);

  const displayTitle =
    ticket?.title || initialTitle?.trim() || t("inkadeArtifact.titleFallback");
  const effectiveFallback =
    ticket?.fallbackMarkdown ||
    initialFallbackMarkdown?.trim() ||
    `> **${displayTitle}**`;
  const effectiveSources = ticket?.sources ?? [];
  const canRenderIframe = Boolean(ticket && !loading && !loadError && !showFallback);
  const sandboxAttr = ticket?.sameSite
    ? "allow-scripts"
    : "allow-scripts allow-same-origin";

  const applyHeightPreset = (presetPx: number): void => {
    const clamped = clampHeightPx(presetPx);
    setHeightPx(clamped);
    onUpdateHeight?.(clamped);
  };

  if (!parsedArtifactId) {
    return (
      <div
        className={cn(
          "not-typeset my-3 rounded-[var(--radius-card)] border border-dashed border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm",
          className,
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300">
            <AlertTriangleIcon className="size-4 shrink-0" />
            <span>{t("inkadeArtifact.missingIdError")}</span>
          </div>
          {headerExtra}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "not-typeset my-4 overflow-hidden rounded-[var(--radius-card)] border border-border bg-card text-card-foreground shadow-xs transition-[border-color] duration-[var(--duration-fast)] ease-[var(--ease-smooth-out)]",
        className,
      )}
      data-inkade-artifact-block={parsedArtifactId}
    >
      <div data-inkade-artifact-live="1">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/80 bg-muted/35 px-3.5 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <SparklesIcon className="size-4 shrink-0 text-primary" />
            <span className="truncate text-sm font-semibold text-foreground">
              {displayTitle}
            </span>
            <Badge variant="outline">{t("inkadeArtifact.badgeLabel")}</Badge>
            {ticket ? (
              <Badge variant={ticket.sameSite ? "warning" : "success"}>
                {ticket.sameSite ? (
                  <ShieldAlertIcon className="size-3" />
                ) : (
                  <ShieldCheckIcon className="size-3" />
                )}
                <span>
                  {ticket.sameSite
                    ? t("inkadeArtifact.securityModeSameSite")
                    : t("inkadeArtifact.securityModeDualOrigin")}
                </span>
              </Badge>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-1">
            {!readOnly && onUpdateHeight ? (
              <div className="mr-1 hidden items-center rounded-md border border-border/70 bg-background/70 p-0.5 sm:flex">
                <Button
                  onClick={() => applyHeightPreset(260)}
                  size="xs"
                  type="button"
                  variant={heightPx <= 300 ? "secondary" : "ghost"}
                >
                  {t("inkadeArtifact.heightPresetCompact")}
                </Button>
                <Button
                  onClick={() => applyHeightPreset(420)}
                  size="xs"
                  type="button"
                  variant={heightPx > 300 && heightPx <= 540 ? "secondary" : "ghost"}
                >
                  {t("inkadeArtifact.heightPresetDefault")}
                </Button>
                <Button
                  onClick={() => applyHeightPreset(680)}
                  size="xs"
                  type="button"
                  variant={heightPx > 540 ? "secondary" : "ghost"}
                >
                  {t("inkadeArtifact.heightPresetTall")}
                </Button>
              </div>
            ) : null}

            <Button
              onClick={() => setSourcesOpen(true)}
              size="xs"
              type="button"
              variant="ghost"
            >
              <DatabaseIcon className="size-3.5" />
              <span>
                {t("inkadeArtifact.sourcesAction", { count: effectiveSources.length })}
              </span>
            </Button>

            {onIssueTicket ? (
              <Button
                aria-label={t("inkadeArtifact.refreshAction")}
                disabled={loading}
                onClick={() => {
                  setShowFallback(false);
                  setRefreshNonce((n) => n + 1);
                }}
                size="icon-xs"
                title={t("inkadeArtifact.refreshAction")}
                type="button"
                variant="ghost"
              >
                <RefreshCwIcon className={cn("size-3.5", loading && "animate-spin")} />
              </Button>
            ) : null}

            <Button
              onClick={() => setShowFallback((prev) => !prev)}
              size="xs"
              type="button"
              variant={showFallback ? "secondary" : "ghost"}
            >
              <FileTextIcon className="size-3.5" />
              <span>
                {showFallback
                  ? t("inkadeArtifact.toggleLive")
                  : t("inkadeArtifact.toggleFallback")}
              </span>
            </Button>

            {ticket ? (
              <Button
                aria-label={t("inkadeArtifact.fullscreenOpen")}
                onClick={() => setFullscreenOpen(true)}
                size="icon-xs"
                title={t("inkadeArtifact.fullscreenOpen")}
                type="button"
                variant="ghost"
              >
                <Maximize2Icon className="size-3.5" />
              </Button>
            ) : null}

            {headerExtra}
          </div>
        </div>

        {ticket?.sameSite ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-500/30 bg-amber-500/10 px-3.5 py-2 text-xs text-amber-950 dark:text-amber-100">
            <div className="flex items-start gap-2">
              <ShieldAlertIcon className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
              <div className="flex flex-col gap-0.5">
                <span className="font-medium">{t("inkadeArtifact.sameSiteNoticeTitle")}</span>
                <span className="text-[11px] opacity-85">
                  {t("inkadeArtifact.sameSiteNoticeDesc")}
                </span>
              </div>
            </div>
            {onOpenSecuritySettings ? (
              <Button
                onClick={onOpenSecuritySettings}
                size="xs"
                type="button"
                variant="outline"
              >
                {t("inkadeArtifact.openSecuritySettings")}
              </Button>
            ) : null}
          </div>
        ) : null}

        {loading ? (
          <div className="flex flex-col gap-2.5 p-4">
            <div className="text-xs text-muted-foreground">
              {t("inkadeArtifact.loadingSandbox")}
            </div>
            <Skeleton className="h-44 w-full rounded-lg" />
          </div>
        ) : canRenderIframe && ticket ? (
          <>
            {handshakeTimedOut && !handshakeReady ? (
              <div
                className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-500/35 bg-amber-500/12 px-3.5 py-2 text-xs text-amber-950 dark:text-amber-100"
                data-testid="inkade-artifact-handshake-warning"
                role="status"
              >
                <div className="flex items-start gap-2">
                  <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium">
                      {t("inkadeArtifact.handshakeTimeoutTitle")}
                    </span>
                    <span className="text-[11px] opacity-85">
                      {t("inkadeArtifact.handshakeTimeoutDesc")}
                    </span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button
                    onClick={() => setShowFallback(true)}
                    size="xs"
                    type="button"
                    variant="outline"
                  >
                    {t("inkadeArtifact.handshakeTimeoutFallbackBtn")}
                  </Button>
                  {onIssueTicket ? (
                    <Button
                      onClick={() => {
                        setHandshakeTimedOut(false);
                        setRefreshNonce((n) => n + 1);
                      }}
                      size="xs"
                      type="button"
                      variant="outline"
                    >
                      {t("inkadeArtifact.retryLoad")}
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}
            <iframe
              className="block w-full border-0 bg-background"
              data-testid="inkade-artifact-iframe"
              height={heightPx}
              onLoad={() => syncThemeToFrame(inlineIframeRef.current?.contentWindow, ticket)}
              ref={inlineIframeRef}
              referrerPolicy="no-referrer"
              sandbox={sandboxAttr}
              src={ticket.sandboxUrl}
              style={{ height: `${heightPx}px` }}
              title={displayTitle}
            />
          </>
        ) : (
          <div className="flex flex-col gap-3 p-4">
            {loadError ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive-foreground">
                <div className="flex items-center gap-2">
                  <AlertTriangleIcon className="size-4 shrink-0" />
                  <span>{loadError}</span>
                </div>
                {onIssueTicket ? (
                  <Button
                    onClick={() => setRefreshNonce((n) => n + 1)}
                    size="xs"
                    type="button"
                    variant="outline"
                  >
                    {t("inkadeArtifact.retryLoad")}
                  </Button>
                ) : null}
              </div>
            ) : null}

            <div className="flex items-center gap-2">
              <Badge variant="outline">{t("inkadeArtifact.fallbackBadge")}</Badge>
            </div>
            <div className="inkade-prose max-w-none text-sm">
              <Markdown
                remarkPlugins={FALLBACK_REMARK_PLUGINS}
                urlTransform={fallbackUrlTransform}
              >
                {effectiveFallback}
              </Markdown>
            </div>
          </div>
        )}
      </div>

      <div
        aria-hidden="true"
        className="hidden"
        data-inkade-artifact-static-fallback="1"
      >
        <div className="inkade-pending-card" data-artifact-id={parsedArtifactId}>
          <div className="inkade-pending-header">
            <span className="inkade-pending-badge">{displayTitle}</span>
            <span className="inkade-pending-id">{parsedArtifactId}</span>
          </div>
          <Markdown remarkPlugins={FALLBACK_REMARK_PLUGINS} urlTransform={fallbackUrlTransform}>
            {effectiveFallback}
          </Markdown>
        </div>
      </div>

      <Dialog onOpenChange={setSourcesOpen} open={sourcesOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("inkadeArtifact.sourcesDialogTitle")}</DialogTitle>
            <DialogDescription>{displayTitle}</DialogDescription>
          </DialogHeader>
          <DialogPanel>
            {effectiveSources.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">
                {t("inkadeArtifact.sourcesEmpty")}
              </p>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {effectiveSources.map((src, index) => {
                  const kindLabel =
                    src.kind === "inkade_view"
                      ? t("inkadeArtifact.sourceKindView")
                      : src.kind === "attachment"
                        ? t("inkadeArtifact.sourceKindAttachment")
                        : t("inkadeArtifact.sourceKindDocument");
                  const primaryName =
                    src.label ||
                    (src.kind === "attachment"
                      ? src.filename || src.attachmentId
                      : src.kind === "document"
                        ? src.title || src.documentId
                        : src.kind);
                  return (
                    <li
                      className="flex flex-col gap-1 rounded-lg border border-border/75 bg-muted/25 px-3 py-2 text-xs"
                      key={`${src.kind}-${index}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-foreground">{primaryName}</span>
                        <Badge variant="outline">{kindLabel}</Badge>
                      </div>
                      {src.refreshedAt ? (
                        <span
                          className="text-[11px] tabular-nums text-muted-foreground"
                          title={src.refreshedAt}
                        >
                          {t("inkadeArtifact.sourceRefreshedAt", {
                            time: formatArtifactSourceTime(src.refreshedAt),
                          })}
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </DialogPanel>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={setFullscreenOpen} open={fullscreenOpen}>
        <DialogContent className="max-w-6xl">
          <DialogHeader>
            <DialogTitle>{displayTitle}</DialogTitle>
          </DialogHeader>
          <DialogPanel className="p-0" scrollFade={false}>
            {ticket ? (
              <iframe
                className="block h-[76vh] w-full border-0 bg-background"
                onLoad={() =>
                  syncThemeToFrame(fullscreenIframeRef.current?.contentWindow, ticket)
                }
                ref={fullscreenIframeRef}
                referrerPolicy="no-referrer"
                sandbox={sandboxAttr}
                src={ticket.sandboxUrl}
                title={displayTitle}
              />
            ) : null}
          </DialogPanel>
        </DialogContent>
      </Dialog>
    </div>
  );
}
