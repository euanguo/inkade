import type { InkadeEvent } from "@inkade/core";
import { createParser } from "eventsource-parser";
import { InkadeApiError } from "./errors.ts";
import type { FetchCredentials, FetchLike } from "./http-transport.ts";

export interface InkadeSseConfig {
  readonly baseUrl: string;
  readonly token?: string | undefined;
  readonly credentials?: FetchCredentials | undefined;
  readonly fetch?: FetchLike | typeof fetch | undefined;
  readonly lastEventId?: string | number | undefined;
  readonly initialRetryDelayMs?: number | undefined;
  readonly maxRetryDelayMs?: number | undefined;
}

export interface InkadeSseHandlers {
  readonly onEvent: (event: InkadeEvent) => void;
  readonly onOpen?: (() => void) | undefined;
  readonly onError?: ((error: unknown) => void) | undefined;
  readonly onReconnect?: ((attempt: number, delayMs: number) => void) | undefined;
}

export interface InkadeSseSubscription {
  unsubscribe(): void;
  readonly lastEventId: string | null;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function sleepWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function subscribeInkadeEvents(
  config: InkadeSseConfig,
  handlers: InkadeSseHandlers,
): InkadeSseSubscription {
  const fetchFn: FetchLike = config.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const initialDelay = config.initialRetryDelayMs ?? 500;
  const maxDelay = config.maxRetryDelayMs ?? 15_000;

  let closed = false;
  let lastEventId: string | null =
    config.lastEventId !== undefined ? String(config.lastEventId) : null;
  let serverRetryDelayMs: number | null = null;
  let activeController: AbortController | null = null;
  let activeReader: { cancel(): Promise<unknown> } | null = null;
  let attempt = 0;

  const loopController = new AbortController();

  const parser = createParser({
    onId(id) {
      lastEventId = id || null;
    },
    onRetry(retryMs) {
      if (Number.isFinite(retryMs) && retryMs >= 0) {
        serverRetryDelayMs = Math.min(retryMs, maxDelay);
      }
    },
    onEvent(evt) {
      const rawJson = evt.data.trim();
      if (!rawJson) {
        return;
      }
      try {
        const parsed = JSON.parse(rawJson) as InkadeEvent;
        if (evt.id !== undefined) {
          lastEventId = evt.id || null;
        } else if (typeof parsed.seq === "number") {
          lastEventId = String(parsed.seq);
        }
        handlers.onEvent(parsed);
      } catch (error) {
        handlers.onError?.(error);
      }
    },
    onError(error) {
      handlers.onError?.(error);
    },
  });

  const run = async () => {
    while (!closed) {
      parser.reset();
      const requestController = new AbortController();
      activeController = requestController;
      const onLoopAbort = () => requestController.abort();
      loopController.signal.addEventListener("abort", onLoopAbort, { once: true });

      try {
        const headers = new Headers();
        headers.set("accept", "text/event-stream");
        if (config.token) {
          headers.set("authorization", `Bearer ${config.token}`);
        }
        if (lastEventId !== null) {
          headers.set("last-event-id", lastEventId);
        }

        const fetchInit: RequestInit = {
          method: "GET",
          headers,
          signal: requestController.signal,
          ...(config.credentials !== undefined ? { credentials: config.credentials } : {}),
        };
        const response = await fetchFn(`${baseUrl}/api/v1/events`, fetchInit);

        if (!response.ok) {
          let code = "HTTP_ERROR";
          let message = `SSE request failed with status ${response.status}`;
          let details: Record<string, unknown> | undefined;
          try {
            const errJson = (await response.json()) as {
              error?: { code?: string; message?: string; details?: Record<string, unknown> };
            };
            if (errJson.error) {
              code = errJson.error.code ?? code;
              message = errJson.error.message ?? message;
              details = errJson.error.details;
            }
          } catch {
            // ignore non-json error body
          }
          const apiErr = new InkadeApiError(response.status, code, message, details);
          handlers.onError?.(apiErr);
          if (response.status === 401 || response.status === 403) {
            closed = true;
            break;
          }
          throw apiErr;
        }

        if (!response.body) {
          throw new Error("SSE response body is empty");
        }

        attempt = 0;
        handlers.onOpen?.();

        const reader = response.body.getReader();
        activeReader = reader;
        const decoder = new TextDecoder();

        try {
          while (!closed) {
            const { done, value } = await reader.read();
            if (done) break;
            parser.feed(decoder.decode(value, { stream: true }));
          }
          const tail = decoder.decode();
          if (tail) {
            parser.feed(tail);
          }
        } finally {
          if (activeReader === reader) {
            activeReader = null;
          }
          reader.releaseLock();
        }
      } catch (error) {
        if (!closed && !requestController.signal.aborted) {
          handlers.onError?.(error);
        }
      } finally {
        loopController.signal.removeEventListener("abort", onLoopAbort);
        if (activeController === requestController) {
          activeController = null;
        }
      }

      if (closed) break;

      const baseDelay = serverRetryDelayMs ?? initialDelay;
      const delayMs = Math.min(baseDelay * 2 ** attempt, maxDelay);
      attempt++;
      handlers.onReconnect?.(attempt, delayMs);
      await sleepWithAbort(delayMs, loopController.signal);
    }
  };

  const globalEventTarget = globalThis as {
    addEventListener?: (type: string, listener: () => void) => void;
    removeEventListener?: (type: string, listener: () => void) => void;
  };

  let cleaned = false;
  const cleanup = (): void => {
    if (cleaned) return;
    cleaned = true;
    closed = true;
    const readerToCancel = activeReader;
    activeReader = null;
    if (readerToCancel) {
      void readerToCancel.cancel().catch(() => {});
    }
    activeController?.abort("sse_unsubscribed");
    loopController.abort("sse_unsubscribed");
    if (typeof globalEventTarget.removeEventListener === "function") {
      globalEventTarget.removeEventListener("pagehide", cleanup);
      globalEventTarget.removeEventListener("beforeunload", cleanup);
    }
  };

  if (typeof globalEventTarget.addEventListener === "function") {
    globalEventTarget.addEventListener("pagehide", cleanup);
    globalEventTarget.addEventListener("beforeunload", cleanup);
  }

  void run();

  return {
    unsubscribe: cleanup,
    get lastEventId() {
      return lastEventId;
    },
  };
}
