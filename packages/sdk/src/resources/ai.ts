import type {
  AiRewriteStreamEvent,
  AiRewriteStreamInput,
  AiSettingsRecord,
  AskCitation,
  AskRequestInput,
  AskStreamEvent,
  TestEmbeddingInput,
  TestEmbeddingResult,
  UpdateAiSettingsInput,
} from "@inkade/core";
import { createParser } from "eventsource-parser";
import { InkadeApiError } from "../errors.ts";
import type { InkadeHttpTransport } from "../http-transport.ts";

export interface AiRewriteStreamOptions {
  readonly onDelta?: ((chunk: string, accumulated: string) => void) | undefined;
  readonly signal?: AbortSignal | undefined;
}

export interface AskStreamMetaEvent {
  readonly retrievalCount: number;
  readonly provider: string;
  readonly model: string;
  readonly fallbackMode: boolean;
  readonly citations: readonly AskCitation[];
}

export interface AskStreamOptions {
  readonly onMeta?: ((meta: AskStreamMetaEvent) => void) | undefined;
  readonly onDelta?: ((chunk: string, accumulated: string) => void) | undefined;
  readonly signal?: AbortSignal | undefined;
}

export interface AskStreamResult {
  readonly fullText: string;
  readonly citations: readonly AskCitation[];
  readonly fallbackMode: boolean;
  readonly provider: string;
  readonly model: string;
  readonly retrievalCount: number;
}

export interface AiResource {
  getSettings(): Promise<AiSettingsRecord>;
  updateSettings(input: UpdateAiSettingsInput): Promise<AiSettingsRecord>;
  testEmbedding(input?: TestEmbeddingInput): Promise<TestEmbeddingResult>;
  rewriteStream(input: AiRewriteStreamInput, options?: AiRewriteStreamOptions): Promise<string>;
  askStream(input: AskRequestInput, options?: AskStreamOptions): Promise<AskStreamResult>;
}

async function consumeSseEvents<TEvent>(
  response: Response,
  emptyMessage: string,
  onEvent: (event: TEvent) => void,
): Promise<void> {
  if (!response.body) {
    throw new InkadeApiError(500, "STREAM_EMPTY", emptyMessage);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");

  const parser = createParser({
    onEvent(evt) {
      const payload = evt.data.trim();
      if (!payload || payload === "[DONE]") {
        return;
      }
      let event: TEvent;
      try {
        event = JSON.parse(payload) as TEvent;
      } catch {
        return;
      }
      onEvent(event);
    },
  });

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      parser.feed(decoder.decode(value, { stream: true }));
    }
    const tail = decoder.decode();
    if (tail) {
      parser.feed(tail);
    }
    parser.reset({ consume: true });
  } finally {
    reader.releaseLock();
  }
}

export function createAiResource(transport: InkadeHttpTransport): AiResource {
  return {
    async getSettings() {
      const res = await transport.requestJson<{ settings: AiSettingsRecord }>("/api/v1/ai/settings");
      return res.settings;
    },

    async updateSettings(input) {
      const res = await transport.requestJson<{ settings: AiSettingsRecord }>(
        "/api/v1/ai/settings",
        {
          method: "PUT",
          body: JSON.stringify(input),
        },
      );
      return res.settings;
    },

    testEmbedding(input = {}) {
      return transport.requestJson<TestEmbeddingResult>("/api/v1/ai/test-embedding", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },

    async rewriteStream(input, options) {
      const headers = new Headers({
        "content-type": "application/json",
        accept: "text/event-stream",
      });
      const response = await transport.requestRaw("/api/v1/ai/rewrite/stream", {
        method: "POST",
        headers,
        body: JSON.stringify(input),
        ...(options?.signal ? { signal: options.signal } : {}),
      });

      const streamState: {
        fullText: string;
        finalDoneText: string | null;
      } = {
        fullText: "",
        finalDoneText: null,
      };

      await consumeSseEvents<AiRewriteStreamEvent>(
        response,
        "AI rewrite stream returned no body",
        (event) => {
          if (event.type === "delta") {
            streamState.fullText += event.text;
            options?.onDelta?.(event.text, streamState.fullText);
          } else if (event.type === "done") {
            streamState.finalDoneText = event.fullText;
          } else if (event.type === "error") {
            throw new InkadeApiError(502, event.code ?? "AI_STREAM_ERROR", event.message);
          }
        },
      );

      return streamState.finalDoneText ?? streamState.fullText;
    },

    async askStream(input, options) {
      const headers = new Headers({
        "content-type": "application/json",
        accept: "text/event-stream",
      });
      const response = await transport.requestRaw("/api/v1/ask", {
        method: "POST",
        headers,
        body: JSON.stringify(input),
        ...(options?.signal ? { signal: options.signal } : {}),
      });

      const streamState: {
        fullText: string;
        meta: AskStreamMetaEvent | null;
        done: Extract<AskStreamEvent, { readonly type: "done" }> | null;
      } = {
        fullText: "",
        meta: null,
        done: null,
      };

      await consumeSseEvents<AskStreamEvent>(
        response,
        "Ask stream returned no body",
        (event) => {
          if (event.type === "meta") {
            streamState.meta = {
              retrievalCount: event.retrievalCount,
              provider: event.provider,
              model: event.model,
              fallbackMode: event.fallbackMode,
              citations: event.citations,
            };
            options?.onMeta?.(streamState.meta);
          } else if (event.type === "delta") {
            streamState.fullText += event.text;
            options?.onDelta?.(event.text, streamState.fullText);
          } else if (event.type === "done") {
            streamState.done = event;
          } else if (event.type === "error") {
            throw new InkadeApiError(502, event.code ?? "ASK_STREAM_ERROR", event.message);
          }
        },
      );

      return {
        fullText: streamState.done?.fullText ?? streamState.fullText,
        citations: streamState.done?.citations ?? streamState.meta?.citations ?? [],
        fallbackMode: streamState.done?.fallbackMode ?? streamState.meta?.fallbackMode ?? false,
        provider: streamState.done?.provider ?? streamState.meta?.provider ?? "",
        model: streamState.done?.model ?? streamState.meta?.model ?? "",
        retrievalCount: streamState.meta?.retrievalCount ?? streamState.done?.citations.length ?? 0,
      };
    },
  };
}
