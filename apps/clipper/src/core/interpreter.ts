import type { ClipperFetchLike, ExtractedArticle } from "@inkade/clipper-core/extractor";
import type { RenderedClipPlan } from "@inkade/clipper-core/templates";
import type { ClipperAiProviderConfig } from "../shared/storage.ts";

const MAX_CONTEXT_CHARS = 14_000;

export const AI_PROVIDER_PRESETS: Readonly<
  Record<ClipperAiProviderConfig["kind"], { readonly baseUrl: string; readonly model: string }>
> = {
  "openai-compatible": {
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
  },
  anthropic: {
    baseUrl: "https://api.anthropic.com",
    model: "claude-3-5-haiku-latest",
  },
  gemini: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    model: "gemini-2.0-flash",
  },
};

export function isAiProviderReady(config: ClipperAiProviderConfig): boolean {
  return Boolean(config.enabled && config.apiKey.trim() && config.model.trim());
}

export async function testAiProviderConnection(
  config: ClipperAiProviderConfig,
  fetchFn?: ClipperFetchLike,
): Promise<{ readonly ok: true; readonly reply: string }> {
  const reply = await runAiPrompt(config, {
    prompt: "Reply with a short confirmation word: OK",
    article: {
      title: "Connection Check",
      url: "https://inkade.local/health",
      markdown: "Connectivity check.",
    },
    fetchFn,
  });
  return { ok: true, reply };
}

function defaultFetch(): ClipperFetchLike {
  return (input, init) => fetch(input, init);
}

function buildArticleContextText(article: Pick<ExtractedArticle, "title" | "url" | "markdown">): string {
  const truncated =
    article.markdown.length > MAX_CONTEXT_CHARS
      ? `${article.markdown.slice(0, MAX_CONTEXT_CHARS)}\n\n...(truncated)`
      : article.markdown;
  return `Title: ${article.title}\nURL: ${article.url}\n\n${truncated}`;
}

export async function runAiPrompt(
  config: ClipperAiProviderConfig,
  input: {
    readonly prompt: string;
    readonly article: Pick<ExtractedArticle, "title" | "url" | "markdown">;
    readonly systemPrompt?: string | undefined;
    readonly fetchFn?: ClipperFetchLike | undefined;
  },
): Promise<string> {
  if (!config.apiKey.trim()) {
    throw new Error("Missing BYOK AI API key");
  }
  const fetchFn = input.fetchFn ?? defaultFetch();
  const baseUrl = config.baseUrl.trim().replace(/\/+$/, "");
  const systemText =
    input.systemPrompt?.trim() ||
    "You are a concise, accurate research assistant embedded in Inkade Web Clipper. Output clean Markdown.";
  const userText = `${buildArticleContextText(input.article)}\n\nTask:\n${input.prompt.trim()}`;

  if (config.kind === "anthropic") {
    const endpoint = baseUrl.endsWith("/v1")
      ? `${baseUrl}/messages`
      : `${baseUrl || "https://api.anthropic.com"}/v1/messages`;
    const res = await fetchFn(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": config.apiKey.trim(),
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: config.model.trim(),
        max_tokens: 1024,
        system: systemText,
        messages: [{ role: "user", content: userText }],
      }),
    });
    if (!res.ok) {
      throw new Error(`Anthropic API HTTP ${res.status}: ${await res.text()}`);
    }
    const data = (await res.json()) as {
      readonly content?: ReadonlyArray<{ readonly type?: string; readonly text?: string }>;
    };
    const text = (data.content ?? [])
      .filter((block) => block.type === "text" && typeof block.text === "string")
      .map((block) => block.text ?? "")
      .join("\n")
      .trim();
    if (!text) throw new Error("Empty response from Anthropic API");
    return text;
  }

  if (config.kind === "gemini") {
    const root = baseUrl || "https://generativelanguage.googleapis.com/v1beta";
    const modelId = encodeURIComponent(config.model.trim());
    const endpoint = `${root}/models/${modelId}:generateContent?key=${encodeURIComponent(config.apiKey.trim())}`;
    const res = await fetchFn(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemText }] },
        contents: [{ role: "user", parts: [{ text: userText }] }],
      }),
    });
    if (!res.ok) {
      throw new Error(`Gemini API HTTP ${res.status}: ${await res.text()}`);
    }
    const data = (await res.json()) as {
      readonly candidates?: ReadonlyArray<{
        readonly content?: {
          readonly parts?: ReadonlyArray<{ readonly text?: string }>;
        };
      }>;
    };
    const text = (data.candidates?.[0]?.content?.parts ?? [])
      .map((part) => part.text ?? "")
      .join("\n")
      .trim();
    if (!text) throw new Error("Empty response from Gemini API");
    return text;
  }

  const endpoint = `${baseUrl || "https://api.openai.com/v1"}/chat/completions`;
  const res = await fetchFn(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.apiKey.trim()}`,
    },
    body: JSON.stringify({
      model: config.model.trim(),
      temperature: 0.2,
      messages: [
        { role: "system", content: systemText },
        { role: "user", content: userText },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`OpenAI-compatible API HTTP ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as {
    readonly choices?: ReadonlyArray<{
      readonly message?: { readonly content?: string | null };
    }>;
  };
  const text = data.choices?.[0]?.message?.content?.trim() ?? "";
  if (!text) throw new Error("Empty response from OpenAI-compatible API");
  return text;
}

/**
 * Resolves any deferred `{{"..."}}` prompt placeholders produced by `renderClipTemplate`.
 * When BYOK AI is disabled or unconfigured, strips unresolved placeholders cleanly.
 */
export async function resolveTemplateAiPrompts(
  config: ClipperAiProviderConfig,
  article: Pick<ExtractedArticle, "title" | "url" | "markdown">,
  plan: RenderedClipPlan,
  fetchFn?: ClipperFetchLike,
): Promise<RenderedClipPlan> {
  if (plan.pendingPrompts.length === 0) {
    return plan;
  }

  let updatedContent = plan.contentMarkdown;
  if (!isAiProviderReady(config)) {
    for (const item of plan.pendingPrompts) {
      updatedContent = updatedContent.split(item.placeholder).join("");
    }
    return {
      ...plan,
      contentMarkdown: updatedContent.replace(/\n{3,}/g, "\n\n").trim(),
      pendingPrompts: [],
    };
  }

  for (const item of plan.pendingPrompts) {
    try {
      const answer = await runAiPrompt(config, {
        prompt: item.prompt,
        article,
        fetchFn,
      });
      updatedContent = updatedContent.split(item.placeholder).join(answer.trim());
    } catch {
      updatedContent = updatedContent.split(item.placeholder).join("");
    }
  }

  return {
    ...plan,
    contentMarkdown: updatedContent.replace(/\n{3,}/g, "\n\n").trim(),
    pendingPrompts: [],
  };
}

function parseJsonSummaryPayload(raw: string): { summary: string; tags: string[] } | null {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as {
      readonly summary?: unknown;
      readonly tags?: unknown;
    };
    const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
    const tags = Array.isArray(parsed.tags)
      ? parsed.tags
          .filter((t): t is string => typeof t === "string")
          .map((t) => t.trim().replace(/^#+/, ""))
          .filter(Boolean)
          .slice(0, 6)
      : [];
    if (!summary && tags.length === 0) return null;
    return { summary, tags };
  } catch {
    return null;
  }
}

export async function generateAiSummaryAndTags(
  config: ClipperAiProviderConfig,
  article: Pick<ExtractedArticle, "title" | "url" | "markdown">,
  fetchFn?: ClipperFetchLike,
): Promise<{ readonly summary: string; readonly tags: string[] }> {
  if (!isAiProviderReady(config)) {
    throw new Error("AI Interpreter is not enabled or configured");
  }

  const raw = await runAiPrompt(config, {
    prompt:
      'Summarize the article into 3 concise bullet points in the article language and suggest 3-5 lowercase topic tags without # prefix. Respond strictly in JSON: {"summary":"- ...\\n- ...\\n- ...","tags":["tag1","tag2"]}.',
    article,
    fetchFn,
  });

  const parsed = parseJsonSummaryPayload(raw);
  if (parsed) return parsed;
  return {
    summary: raw.trim(),
    tags: [],
  };
}
