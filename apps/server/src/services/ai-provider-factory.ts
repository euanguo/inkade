import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  InkadeError,
  type AiProviderPreset,
  type EmbeddingProviderPreset,
} from "@inkade/core";
import type { EmbeddingModel, LanguageModel } from "ai";
import {
  assertSafeExternalUrl,
  type DnsResolver,
  type FetchFn,
} from "./clipper-service.ts";

export interface AiSdkTransportConfig {
  readonly fetchFn: FetchFn;
  readonly resolveDns: DnsResolver;
  readonly allowLocalForTest: boolean;
}

/**
 * Validates an AI / Embedding endpoint URL against SSRF rules.
 * Local Ollama (`provider === "ollama"`) is allowed on loopback/LAN addresses while still
 * blocking non-HTTP schemes, embedded URL credentials, and cloud link-local metadata IPs.
 */
export async function validateAiEndpointUrl(
  rawUrl: string,
  options: {
    readonly allowPrivateLoopback?: boolean | undefined;
    readonly resolveDns: DnsResolver;
    readonly allowLocalForTest: boolean;
  },
): Promise<string> {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new InkadeError("VALIDATION_ERROR", "AI base URL must not be empty");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new InkadeError("VALIDATION_ERROR", "Invalid AI base URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new InkadeError("FORBIDDEN", "Only HTTP and HTTPS AI gateway URLs are permitted");
  }
  if (parsed.username || parsed.password) {
    throw new InkadeError("FORBIDDEN", "AI base URL must not contain embedded credentials");
  }

  if (options.allowLocalForTest) {
    return parsed.toString().replace(/\/+$/, "");
  }

  if (options.allowPrivateLoopback) {
    const host = parsed.hostname.toLowerCase();
    if (host === "metadata" || host === "metadata.google.internal" || host === "0.0.0.0") {
      throw new InkadeError("FORBIDDEN", `Blocked AI host "${host}"`);
    }
    const checkIp = (ip: string) => {
      const clean = ip.trim().replace(/^\[|\]$/g, "");
      if (clean.startsWith("169.254.") || /^fe80:/i.test(clean)) {
        throw new InkadeError("FORBIDDEN", "Link-local metadata addresses are blocked");
      }
    };
    if (host !== "localhost" && host !== "127.0.0.1" && host !== "::1") {
      checkIp(host);
      try {
        const resolved = await options.resolveDns(host);
        for (const addr of resolved) {
          checkIp(addr);
        }
      } catch (err) {
        if (err instanceof InkadeError) throw err;
        // Let non-metadata LAN hostnames fail at connection time if DNS is offline
      }
    }
    return parsed.toString().replace(/\/+$/, "");
  }

  const safeUrl = await assertSafeExternalUrl(trimmed, options.resolveDns);
  return safeUrl.toString().replace(/\/+$/, "");
}

export function normalizeOpenAiV1BaseUrl(baseUrl: string): string {
  const clean = baseUrl.replace(/\/+$/, "");
  return clean.endsWith("/chat/completions")
    ? clean.slice(0, -"/chat/completions".length)
    : clean;
}

export function createChatLanguageModel(options: {
  readonly provider: AiProviderPreset;
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKey: string;
  readonly fetchFn: FetchFn;
}): LanguageModel {
  const cleanBase = normalizeOpenAiV1BaseUrl(options.baseUrl);
  const customFetch = options.fetchFn as unknown as typeof fetch;

  if (options.provider === "anthropic") {
    const anthropic = createAnthropic({
      baseURL: cleanBase || "https://api.anthropic.com/v1",
      apiKey: options.apiKey,
      fetch: customFetch,
    });
    return anthropic(options.model);
  }

  // Use OpenAI-compatible Chat Completions across OpenAI / DeepSeek / Ollama / Custom
  // so every gateway targets `${baseURL}/chat/completions` consistently.
  const compat = createOpenAICompatible({
    name: options.provider,
    baseURL: cleanBase,
    apiKey: options.apiKey || (options.provider === "ollama" ? "ollama" : ""),
    fetch: customFetch,
  });
  return compat.chatModel(options.model);
}

export function createAiSdkEmbeddingModel(options: {
  readonly provider: Exclude<EmbeddingProviderPreset, "local">;
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKey: string;
  readonly fetchFn: FetchFn;
}): EmbeddingModel {
  const cleanBase = options.baseUrl.replace(/\/+$/, "");
  const customFetch = options.fetchFn as unknown as typeof fetch;

  if (options.provider === "openai") {
    const openai = createOpenAI({
      baseURL: cleanBase || "https://api.openai.com/v1",
      apiKey: options.apiKey,
      fetch: customFetch,
    });
    return openai.embeddingModel(options.model);
  }

  const resolvedBase =
    options.provider === "ollama"
      ? cleanBase.endsWith("/v1")
        ? cleanBase
        : `${cleanBase || "http://127.0.0.1:11434"}/v1`
      : cleanBase;

  const compat = createOpenAICompatible({
    name: options.provider,
    baseURL: resolvedBase,
    apiKey: options.apiKey || (options.provider === "ollama" ? "ollama" : ""),
    fetch: customFetch,
  });
  return compat.embeddingModel(options.model);
}

/**
 * Extracts a concise human-readable error message from Vercel AI SDK / upstream provider errors.
 */
export function extractUpstreamErrorMessage(err: unknown, fallback = "Failed to reach AI provider"): string {
  if (err && typeof err === "object") {
    const rec = err as { responseBody?: string; message?: string };
    if (typeof rec.responseBody === "string" && rec.responseBody.trim()) {
      try {
        const parsed = JSON.parse(rec.responseBody) as {
          error?: { message?: string };
          message?: string;
        };
        if (parsed.error?.message) return parsed.error.message;
        if (parsed.message) return parsed.message;
      } catch {
        // ignore JSON parse errors
      }
    }
    if (typeof rec.message === "string" && rec.message.trim()) {
      return rec.message;
    }
  }
  return err instanceof Error ? err.message : fallback;
}

/**
 * OpenAI-compatible gateways occasionally close `[DONE]` cleanly right after deltas without a trailing `finish_reason` frame.
 */
export function isStreamEndedWithoutFinishReason(err: unknown): boolean {
  const msg = extractUpstreamErrorMessage(err, "");
  return msg.includes("ended without a finish reason");
}
