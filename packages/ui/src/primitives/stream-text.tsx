"use client";

import * as React from "react";
import { cn, prefersReducedMotion } from "../lib/utils.ts";

/**
 * Splits text into the crisp settled prefix and the trailing characters for soft-blur progressive reveal.
 */
export function splitStreamTail(
  text: string,
  tailLength = 6,
): { readonly solid: string; readonly tail: string } {
  if (!text) return { solid: "", tail: "" };
  const safeTail = Math.max(0, Math.trunc(tailLength));
  if (safeTail === 0) return { solid: text, tail: "" };
  const cut = Math.max(0, text.length - safeTail);
  return {
    solid: text.slice(0, cut),
    tail: text.slice(cut),
  };
}

export interface StreamTextProps {
  readonly text: string;
  /**
   * When explicitly provided, treats `text` as a live external stream (`true` shows soft tail + caret).
   * When omitted, animates progressive reveal of `text` locally when `animate` is true.
   */
  readonly streaming?: boolean | undefined;
  readonly animate?: boolean | undefined;
  readonly charsPerTick?: number | undefined;
  readonly intervalMs?: number | undefined;
  readonly blurTail?: number | undefined;
  readonly showCaret?: boolean | undefined;
  readonly onProgress?: (() => void) | undefined;
  readonly onDone?: (() => void) | undefined;
  readonly className?: string | undefined;
}

/**
 * Streaming text primitive with optional soft-blur tail reveal and blinking caret.
 * Respects prefers-reduced-motion and Inkade's reduced-pulse motion profile.
 */
export function StreamText({
  text,
  streaming,
  animate = true,
  charsPerTick = 2,
  intervalMs = 10,
  blurTail = 6,
  showCaret = true,
  onProgress,
  onDone,
  className,
}: StreamTextProps): React.ReactElement {
  const controlledMode = streaming !== undefined;
  const reduced = prefersReducedMotion();
  const shouldAnimateLocally = !controlledMode && animate && !reduced;

  const [shownCount, setShownCount] = React.useState<number>(() =>
    shouldAnimateLocally ? 0 : text.length,
  );
  const doneCalledRef = React.useRef(false);

  React.useEffect(() => {
    if (!shouldAnimateLocally) {
      setShownCount(text.length);
      if (!doneCalledRef.current && text.length > 0 && !streaming) {
        doneCalledRef.current = true;
        onDone?.();
      }
      return;
    }

    doneCalledRef.current = false;
    setShownCount(0);
    const step = Math.max(1, Math.trunc(charsPerTick));
    const timer = setInterval(() => {
      setShownCount((prev) => {
        const next = Math.min(text.length, prev + step);
        if (next >= text.length) {
          clearInterval(timer);
        }
        return next;
      });
    }, Math.max(8, intervalMs));

    return () => clearInterval(timer);
  }, [charsPerTick, intervalMs, onDone, shouldAnimateLocally, streaming, text]);

  React.useEffect(() => {
    if (!shouldAnimateLocally) return;
    if (shownCount > 0) {
      onProgress?.();
    }
    if (shownCount >= text.length && !doneCalledRef.current) {
      doneCalledRef.current = true;
      onDone?.();
    }
  }, [onDone, onProgress, shouldAnimateLocally, shownCount, text.length]);

  const activeText = shouldAnimateLocally ? text.slice(0, shownCount) : text;
  const isActivelyStreaming = controlledMode
    ? Boolean(streaming) && !reduced
    : shouldAnimateLocally && shownCount < text.length;

  const { solid, tail } = isActivelyStreaming
    ? splitStreamTail(activeText, blurTail)
    : { solid: activeText, tail: "" };

  return (
    <span
      className={cn("inline", className)}
      data-slot="stream-text"
      data-streaming={isActivelyStreaming ? "true" : "false"}
    >
      <span>{solid}</span>
      {tail ? <span className="inkade-stream-tail">{tail}</span> : null}
      {isActivelyStreaming && showCaret ? (
        <span
          aria-hidden="true"
          className="inkade-caret-blink ml-0.5 inline-block h-[1em] w-[1.5px] translate-y-[0.14em] rounded-full bg-current align-baseline"
        />
      ) : null}
    </span>
  );
}
