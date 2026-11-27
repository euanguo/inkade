import { z } from "zod";
import {
  documentIdSchema,
  savedViewIdSchema,
  spaceIdSchema,
  type DocumentId,
  type OutlineNodeId,
  type SpaceId,
  type WorkspaceId,
} from "./ids.ts";
import { documentKindSchema, semanticSearchModeSchema, type DocumentKind } from "./types/common.ts";

export const AI_PROVIDER_PRESETS = [
  "openai",
  "anthropic",
  "deepseek",
  "ollama",
  "custom",
] as const;
export type AiProviderPreset = (typeof AI_PROVIDER_PRESETS)[number];
export const aiProviderPresetSchema = z.enum(AI_PROVIDER_PRESETS);

export const EMBEDDING_PROVIDER_PRESETS = [
  "local",
  "ollama",
  "openai",
  "openai-compatible",
] as const;
export type EmbeddingProviderPreset = (typeof EMBEDDING_PROVIDER_PRESETS)[number];
export const embeddingProviderPresetSchema = z.enum(EMBEDDING_PROVIDER_PRESETS);

export interface AiProviderDefaultConfig {
  readonly baseUrl: string;
  readonly model: string;
}

export const AI_PROVIDER_DEFAULTS: Record<AiProviderPreset, AiProviderDefaultConfig> = {
  openai: {
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
  },
  anthropic: {
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-sonnet-4-5",
  },
  deepseek: {
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
  },
  ollama: {
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "llama3.2",
  },
  custom: {
    baseUrl: "",
    model: "gpt-4o-mini",
  },
};

export interface EmbeddingProviderDefaultConfig {
  readonly baseUrl: string;
  readonly model: string;
  readonly dimensions: number;
}

export const EMBEDDING_PROVIDER_DEFAULTS: Record<
  EmbeddingProviderPreset,
  EmbeddingProviderDefaultConfig
> = {
  local: {
    baseUrl: "",
    model: "local-ngram-128",
    dimensions: 128,
  },
  ollama: {
    baseUrl: "http://127.0.0.1:11434",
    model: "nomic-embed-text",
    dimensions: 768,
  },
  openai: {
    baseUrl: "https://api.openai.com/v1",
    model: "text-embedding-3-small",
    dimensions: 1536,
  },
  "openai-compatible": {
    baseUrl: "",
    model: "text-embedding-3-small",
    dimensions: 1536,
  },
};

export function buildEmbeddingModelKey(
  provider: EmbeddingProviderPreset | (string & {}),
  model: string,
): string {
  const cleanProvider = provider.trim().toLowerCase() || "local";
  const cleanModel = model.trim() || "local-ngram-128";
  return `${cleanProvider}:${cleanModel}`;
}

export const AI_REWRITE_ACTIONS = [
  "polish",
  "concise",
  "expand",
  "translate",
  "summarize",
  "custom",
] as const;
export type AiRewriteAction = (typeof AI_REWRITE_ACTIONS)[number];
export const aiRewriteActionSchema = z.enum(AI_REWRITE_ACTIONS);

/**
 * Masks an API key so plaintext secrets are never returned over REST or to browser clients.
 */
export function maskApiKey(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) {
    return null;
  }
  if (trimmed.length < 10) {
    return "••••••••";
  }
  return `${trimmed.slice(0, 3)}...${trimmed.slice(-4)}`;
}

export interface AiSettingsRecord {
  readonly workspaceId: WorkspaceId;
  readonly enabled: boolean;
  readonly provider: AiProviderPreset;
  readonly baseUrl: string;
  readonly model: string;
  readonly hasApiKey: boolean;
  readonly apiKeyMasked: string | null;
  readonly temperature: number;
  readonly embeddingProvider: EmbeddingProviderPreset;
  readonly embeddingBaseUrl: string;
  readonly embeddingModel: string;
  readonly hasEmbeddingApiKey: boolean;
  readonly embeddingApiKeyMasked: string | null;
  readonly updatedAt: string;
}

export const updateAiSettingsInputSchema = z.object({
  enabled: z.boolean().optional(),
  provider: aiProviderPresetSchema.optional(),
  baseUrl: z.string().trim().max(500).optional(),
  model: z.string().trim().max(200).optional(),
  apiKey: z.string().trim().max(500).optional(),
  clearApiKey: z.boolean().optional(),
  temperature: z.number().min(0).max(2).optional(),
  embeddingProvider: embeddingProviderPresetSchema.optional(),
  embeddingBaseUrl: z.string().trim().max(500).optional(),
  embeddingModel: z.string().trim().max(200).optional(),
  embeddingApiKey: z.string().trim().max(500).optional(),
  clearEmbeddingApiKey: z.boolean().optional(),
});
export type UpdateAiSettingsInput = z.infer<typeof updateAiSettingsInputSchema>;

export const testEmbeddingInputSchema = z.object({
  embeddingProvider: embeddingProviderPresetSchema.optional(),
  embeddingBaseUrl: z.string().trim().max(500).optional(),
  embeddingModel: z.string().trim().max(200).optional(),
  embeddingApiKey: z.string().trim().max(500).optional(),
});
export type TestEmbeddingInput = z.infer<typeof testEmbeddingInputSchema>;

export interface TestEmbeddingResult {
  readonly ok: boolean;
  readonly provider: EmbeddingProviderPreset;
  readonly model: string;
  readonly modelKey: string;
  readonly dimensions: number;
  readonly latencyMs: number;
  readonly message?: string | undefined;
}

export const aiRewriteStreamInputSchema = z.object({
  documentId: documentIdSchema.optional(),
  action: aiRewriteActionSchema.default("polish"),
  prompt: z.string().trim().max(4000).optional(),
  selectedText: z.string().min(1).max(40000),
  contextMarkdown: z.string().max(120000).optional(),
  docTitle: z.string().max(500).optional(),
  targetLanguage: z.enum(["zh-CN", "en-US"]).optional(),
});
export type AiRewriteStreamInput = z.input<typeof aiRewriteStreamInputSchema>;
export type ParsedAiRewriteStreamInput = z.infer<typeof aiRewriteStreamInputSchema>;

export type AiRewriteStreamEvent =
  | { readonly type: "delta"; readonly text: string }
  | { readonly type: "done"; readonly fullText: string }
  | {
      readonly type: "error";
      readonly message: string;
      readonly code?: string | undefined;
    };

export const ASK_CONTEXT_MODES = [
  "all",
  "space",
  "documents",
  "savedView",
  "tag",
] as const;
export type AskContextMode = (typeof ASK_CONTEXT_MODES)[number];

export const askContextScopeSchema = z.object({
  mode: z.enum(ASK_CONTEXT_MODES).default("all"),
  spaceId: spaceIdSchema.optional(),
  documentIds: z.array(documentIdSchema).max(50).optional(),
  savedViewId: savedViewIdSchema.optional(),
  tag: z.string().trim().min(1).max(120).optional(),
  kind: documentKindSchema.optional(),
});
export type AskContextScope = z.input<typeof askContextScopeSchema>;
export type ParsedAskContextScope = z.infer<typeof askContextScopeSchema>;

export const askRequestInputSchema = z.object({
  question: z.string().trim().min(1).max(4000),
  context: askContextScopeSchema.optional(),
  limit: z.number().int().min(1).max(20).default(8),
  mode: semanticSearchModeSchema.default("hybrid"),
  targetLanguage: z.enum(["zh-CN", "en-US"]).optional(),
});
export type AskRequestInput = z.input<typeof askRequestInputSchema>;
export type ParsedAskRequestInput = z.infer<typeof askRequestInputSchema>;

export interface AskCitation {
  readonly index: number;
  readonly docId: DocumentId;
  readonly title: string;
  readonly kind: DocumentKind;
  readonly spaceId: SpaceId;
  readonly headingPath: string | null;
  readonly nodeId: OutlineNodeId | null;
  readonly excerpt: string;
  readonly score: number;
}

export type AskStreamEvent =
  | {
      readonly type: "meta";
      readonly retrievalCount: number;
      readonly provider: string;
      readonly model: string;
      readonly fallbackMode: boolean;
      readonly citations: readonly AskCitation[];
    }
  | { readonly type: "delta"; readonly text: string }
  | {
      readonly type: "done";
      readonly fullText: string;
      readonly citations: readonly AskCitation[];
      readonly fallbackMode: boolean;
      readonly provider: string;
      readonly model: string;
    }
  | {
      readonly type: "error";
      readonly message: string;
      readonly code?: string | undefined;
    };
