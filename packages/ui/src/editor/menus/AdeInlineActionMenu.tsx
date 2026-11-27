"use client";

import { autoUpdate, computePosition, flip, offset, shift } from "@floating-ui/dom";
import type { SelectionAnchor } from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import { TextSelection } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import {
  CheckIcon,
  RotateCwIcon,
  SendIcon,
  SettingsIcon,
  SparklesIcon,
  SquareIcon,
  Wand2Icon,
  XIcon,
} from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "../../primitives/button.tsx";
import { Input } from "../../primitives/input.tsx";
import { StreamText } from "../../primitives/stream-text.tsx";
import { ThinkingIndicator } from "../../primitives/thinking-indicator.tsx";

export interface AdeInlineActionSelection {
  readonly from: number;
  readonly to: number;
  readonly text: string;
}

export interface AdeInlineActionMenuProps {
  readonly editor: Editor;
  readonly docTitle: string;
  readonly selectionRange: AdeInlineActionSelection;
  readonly onAiRewrite?: ((payload: {
    readonly action: string;
    readonly prompt: string;
    readonly selectedText: string;
    readonly fullMarkdown: string;
  }) => Promise<string>) | undefined;
  readonly onAiRewriteStream?: ((payload: {
    readonly action: IntentId;
    readonly prompt: string;
    readonly selectedText: string;
    readonly fullMarkdown: string;
    readonly onDelta: (chunk: string, accumulated: string) => void;
    readonly signal: AbortSignal;
  }) => Promise<string>) | undefined;
  readonly onOpenAiSettings?: (() => void) | undefined;
  readonly onDispatchAde?: ((payload: {
    readonly anchor: SelectionAnchor;
    readonly instruction?: string | undefined;
  }) => void) | undefined;
  readonly onClose: () => void;
}

type IntentId = "polish" | "concise" | "expand" | "translate" | "summarize" | "custom";

export function AdeInlineActionMenu({
  editor,
  docTitle,
  selectionRange,
  onAiRewrite,
  onAiRewriteStream,
  onOpenAiSettings,
  onDispatchAde,
  onClose,
}: AdeInlineActionMenuProps): React.ReactElement | null {
  const { t } = useInkadeTranslation();
  const floatingRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [coords, setCoords] = useState<{ readonly x: number; readonly y: number } | null>(null);
  const [prompt, setPrompt] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [errorNeedsSettings, setErrorNeedsSettings] = useState(false);
  const [running, setRunning] = useState(false);
  const [lastRequest, setLastRequest] = useState<{
    readonly action: IntentId;
    readonly instruction: string;
  } | null>(null);

  const hasAiHandler = Boolean(onAiRewriteStream || onAiRewrite);

  const abortActiveStream = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  const handleClose = useCallback(() => {
    abortActiveStream();
    onClose();
  }, [abortActiveStream, onClose]);

  useEffect(() => {
    return () => {
      abortActiveStream();
    };
  }, [abortActiveStream]);

  useLayoutEffect(() => {
    const floatingEl = floatingRef.current;
    if (!floatingEl) return;

    const getRect = (): DOMRect => {
      try {
        const pos = Math.min(selectionRange.to, editor.state.doc.content.size);
        const c = editor.view.coordsAtPos(pos);
        return new DOMRect(
          c.left,
          c.top,
          Math.max(1, c.right - c.left),
          Math.max(18, c.bottom - c.top),
        );
      } catch {
        return new DOMRect(160, 160, 1, 18);
      }
    };

    const virtualEl = {
      getBoundingClientRect: getRect,
      contextElement: editor.view.dom,
    };

    const update = (): void => {
      void computePosition(virtualEl, floatingEl, {
        strategy: "fixed",
        placement: "bottom-start",
        middleware: [offset(8), flip({ padding: 12 }), shift({ padding: 12 })],
      }).then(({ x, y }) => setCoords({ x, y }));
    };

    update();
    return autoUpdate(virtualEl, floatingEl, update);
  }, [editor, selectionRange.to]);

  // Dismiss cleanly on Escape anywhere or pointerdown outside the floating menu
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleClose();
      }
    };
    const onPointerDown = (e: PointerEvent): void => {
      const el = floatingRef.current;
      if (el && e.target instanceof Node && !el.contains(e.target)) {
        handleClose();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [handleClose]);

  const dispatchToAde = (instruction?: string): void => {
    if (!onDispatchAde) return;
    const quote = selectionRange.text.trim() || docTitle;
    onDispatchAde({
      anchor: { quote },
      instruction: instruction?.trim() || undefined,
    });
    handleClose();
  };

  const handleAction = async (action: IntentId, instructionLabel: string): Promise<void> => {
    if (!hasAiHandler) {
      dispatchToAde(instructionLabel);
      return;
    }

    abortActiveStream();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLastRequest({ action, instruction: instructionLabel });
    setErrorMsg(null);
    setErrorNeedsSettings(false);
    setPreview("");
    setRunning(true);

    try {
      const fullMarkdown = editor.getMarkdown();
      if (onAiRewriteStream) {
        const finalText = await onAiRewriteStream({
          action,
          prompt: instructionLabel,
          selectedText: selectionRange.text,
          fullMarkdown,
          signal: controller.signal,
          onDelta: (_chunk, accumulated) => {
            if (!controller.signal.aborted) {
              setPreview(accumulated);
            }
          },
        });
        if (!controller.signal.aborted) {
          setPreview(finalText);
        }
      } else if (onAiRewrite) {
        const result = await onAiRewrite({
          action,
          prompt: instructionLabel,
          selectedText: selectionRange.text,
          fullMarkdown,
        });
        if (!controller.signal.aborted) {
          setPreview(result);
        }
      }
    } catch (err) {
      if (controller.signal.aborted || (err instanceof Error && err.name === "AbortError")) {
        return;
      }
      const rawMessage = err instanceof Error && err.message ? err.message : "";
      const rawCode =
        typeof err === "object" && err !== null && "code" in err
          ? (err as { code?: unknown }).code
          : undefined;
      const code = typeof rawCode === "string" ? rawCode : "";
      const unconfigured =
        code === "VALIDATION_ERROR" ||
        /disabled|not configured|api key|base url/i.test(rawMessage);
      setErrorNeedsSettings(unconfigured);
      setErrorMsg(
        unconfigured
          ? t("editor.aiUnconfiguredMessage")
          : rawMessage || t("editor.aiRewriteFailed"),
      );
      setPreview(null);
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      setRunning(false);
    }
  };

  const quickIntents: ReadonlyArray<{ readonly id: IntentId; readonly label: string }> = [
    { id: "polish", label: t("editor.aiPolish") },
    { id: "concise", label: t("editor.aiConcise") },
    { id: "expand", label: t("editor.aiExpand") },
    { id: "translate", label: t("editor.aiTranslate") },
    { id: "summarize", label: t("editor.aiSummarize") },
  ];

  const menuTitle = hasAiHandler ? t("editor.aiMenuTitle") : t("editor.adeDispatchTitle");

  const content = (
    <div
      className="not-typeset fixed z-50 flex w-[26rem] max-w-[calc(100vw-24px)] flex-col gap-2.5 rounded-lg border border-[var(--border-overlay)] bg-popover p-3 text-popover-foreground shadow-[var(--shadow-overlay)]"
      data-inkade-ui-overlay="true"
      data-slot="ade-inline-action-menu"
      data-testid="editor-ade-action-menu"
      ref={floatingRef}
      style={
        coords
          ? { top: `${coords.y}px`, left: `${coords.x}px`, visibility: "visible" }
          : { top: "-9999px", left: "-9999px", visibility: "hidden" }
      }
    >
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground">
          <Wand2Icon className="size-3.5 text-primary" />
          {menuTitle}
        </span>
        <Button
          aria-label={t("common.close")}
          onClick={handleClose}
          size="icon-xs"
          type="button"
          variant="ghost"
        >
          <XIcon />
        </Button>
      </div>

      {!hasAiHandler && (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {t("editor.adeDispatchDesc")}
        </p>
      )}

      <form
        className="flex items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          const trimmed = prompt.trim();
          if (hasAiHandler) {
            void handleAction("custom", trimmed);
          } else {
            dispatchToAde(trimmed);
          }
        }}
      >
        <Input
          autoFocus
          className="flex-1"
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              handleClose();
            }
          }}
          placeholder={t("editor.aiMenuPlaceholder")}
          size="sm"
          value={prompt}
        />
        {running ? (
          <Button
            aria-label={t("editor.aiStopStreaming")}
            onClick={() => {
              abortActiveStream();
              setRunning(false);
            }}
            size="icon-sm"
            title={t("editor.aiStopStreaming")}
            type="button"
            variant="outline"
          >
            <SquareIcon className="size-3.5" />
          </Button>
        ) : (
          <Button
            aria-label={hasAiHandler ? t("editor.aiMenuTitle") : t("editor.aiDispatchAde")}
            size="icon-sm"
            type="submit"
          >
            {hasAiHandler ? <SparklesIcon /> : <SendIcon />}
          </Button>
        )}
      </form>

      <div className="flex flex-wrap gap-1">
        {quickIntents.map((act) => (
          <Button
            disabled={running}
            key={act.id}
            onClick={() => void handleAction(act.id, act.label)}
            size="xs"
            type="button"
            variant="outline"
          >
            {act.label}
          </Button>
        ))}
      </div>

      {running && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <ThinkingIndicator size="sm" />
          <span className="inkade-shimmer-text">{t("editor.aiRunning")}</span>
        </div>
      )}

      {errorMsg && (
        <div className="flex flex-col gap-2 rounded-md border border-destructive/35 bg-destructive/10 px-2.5 py-2 text-xs text-destructive-foreground">
          <p>{errorMsg}</p>
          {errorNeedsSettings && onOpenAiSettings && (
            <div className="flex justify-end">
              <Button
                onClick={() => {
                  handleClose();
                  onOpenAiSettings();
                }}
                size="xs"
                type="button"
                variant="outline"
              >
                <SettingsIcon className="size-3" />
                <span>{t("editor.aiOpenSettingsCta")}</span>
              </Button>
            </div>
          )}
        </div>
      )}

      {preview !== null && (preview.length > 0 || running) && (
        <div className="flex flex-col gap-2 rounded-md border border-border/60 bg-muted/40 p-2.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("editor.aiPreviewLabel")}
          </span>
          <div className="max-h-48 overflow-y-auto whitespace-pre-wrap font-sans text-xs leading-relaxed text-foreground [scrollbar-gutter:stable]">
            <StreamText streaming={running} text={preview} />
          </div>
          {!running && preview.length > 0 && (
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              <Button
                onClick={() => {
                  setPreview(null);
                  handleClose();
                }}
                size="xs"
                type="button"
                variant="ghost"
              >
                {t("editor.aiDiscard")}
              </Button>
              {lastRequest && (
                <Button
                  onClick={() => void handleAction(lastRequest.action, lastRequest.instruction)}
                  size="xs"
                  type="button"
                  variant="ghost"
                >
                  <RotateCwIcon className="size-3" />
                  <span>{t("editor.aiRegenerate")}</span>
                </Button>
              )}
              <Button
                onClick={() => {
                  const maxPos = editor.state.doc.content.size;
                  const clampedTo = Math.min(Math.max(0, selectionRange.to), maxPos);
                  let insertPos = clampedTo;
                  try {
                    const $to = editor.state.doc.resolve(clampedTo);
                    insertPos = $to.depth >= 1 ? Math.min($to.after(1), maxPos) : clampedTo;
                  } catch {
                    insertPos = clampedTo;
                  }
                  editor
                    .chain()
                    .focus()
                    .insertContentAt(insertPos, `\n\n${preview}`, {
                      contentType: "markdown",
                    })
                    .run();
                  handleClose();
                }}
                size="xs"
                type="button"
                variant="outline"
              >
                {t("editor.aiInsertBelow")}
              </Button>
              <Button
                onClick={() => {
                  const { state } = editor;
                  const maxPos = state.doc.content.size;
                  const clampedFrom = Math.min(Math.max(0, selectionRange.from), maxPos);
                  const clampedTo = Math.min(Math.max(clampedFrom, selectionRange.to), maxPos);
                  const tr = state.tr.setSelection(
                    TextSelection.create(state.doc, clampedFrom, clampedTo),
                  );
                  editor.view.dispatch(tr);
                  editor.chain().focus().insertContent(preview, { contentType: "markdown" }).run();
                  handleClose();
                }}
                size="xs"
                type="button"
                variant="default"
              >
                <CheckIcon />
                <span>{t("editor.aiAcceptReplace")}</span>
              </Button>
            </div>
          )}
        </div>
      )}

      {onDispatchAde && (
        <div className="border-t border-border/60 pt-2">
          <Button
            className="w-full justify-center"
            onClick={() => dispatchToAde(prompt)}
            size="xs"
            type="button"
            variant={hasAiHandler ? "secondary" : "default"}
          >
            <SendIcon />
            {t("editor.aiDispatchAde")}
          </Button>
        </div>
      )}
    </div>
  );

  if (typeof document === "undefined") return content;
  return createPortal(content, document.body);
}
