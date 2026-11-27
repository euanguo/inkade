import {
  AI_PROVIDER_DEFAULTS,
  EMBEDDING_PROVIDER_DEFAULTS,
  InkadeError,
  type AiProviderPreset,
  type AiRewriteAction,
  type AiRewriteStreamEvent,
  type AiRewriteStreamInput,
  type AiSettingsRecord,
  type UpdateAiSettingsInput,
} from "@inkade/core";
import type { DocumentRepo, SearchConfigRepo, SpaceRepo } from "@inkade/db";
import { streamText } from "ai";
import type { WorkspaceSpacesCache } from "../cache/workspace-spaces-cache.ts";
import type { Principal } from "../types.ts";
import {
  createChatLanguageModel,
  extractUpstreamErrorMessage,
  isStreamEndedWithoutFinishReason,
  validateAiEndpointUrl,
} from "./ai-provider-factory.ts";
import type { AuditService } from "./audit-service.ts";
import {
  defaultDnsResolver,
  type DnsResolver,
  type FetchFn,
} from "./clipper-service.ts";
import { assertAdminPrincipal, assertScope, getAllWorkspaceSpaces } from "./scope-guard.ts";

export interface AiRewritePreparedContext {
  readonly provider: AiProviderPreset;
  readonly baseUrl: string;
  readonly endpointUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly temperature: number;
  readonly systemPrompt: string;
  readonly userPrompt: string;
}

export interface AiRewriteTestTransport {
  readonly fetchFn?: FetchFn | undefined;
  readonly resolveDns?: DnsResolver | undefined;
  readonly allowLocalForTest?: boolean | undefined;
}

const ACTION_INSTRUCTIONS: Record<AiRewriteAction, string> = {
  polish:
    "Polish and refine the selected text for clarity, grammar, flow, and tone while preserving the original meaning and Markdown structure.",
  concise:
    "Rewrite the selected text to be noticeably more concise and direct while keeping every key fact and Markdown structure intact.",
  expand:
    "Expand and elaborate on the selected text with clearer reasoning, useful supporting detail, and clean Markdown formatting.",
  translate:
    "Translate the selected text accurately and naturally. If the input is primarily Chinese, translate it to fluent English; otherwise translate it to natural Simplified Chinese, preserving Markdown formatting.",
  summarize:
    "Summarize the key points of the selected text crisply using clean Markdown (bullet points or a brief paragraph as appropriate).",
  custom:
    "Follow the user's instruction precisely to rewrite or transform the selected text while maintaining valid Markdown formatting.",
};

function buildRewritePrompts(input: AiRewriteStreamInput): {
  readonly systemPrompt: string;
  readonly userPrompt: string;
} {
  const systemLines = [
    "You are an embedded writing and editing assistant inside Inkade.",
    "Return ONLY the rewritten Markdown text without preambles, wrappers, or meta commentary.",
    ACTION_INSTRUCTIONS[input.action ?? "polish"],
  ];
  if (input.targetLanguage === "zh-CN") {
    systemLines.push("Output language: Simplified Chinese (zh-CN).");
  } else if (input.targetLanguage === "en-US") {
    systemLines.push("Output language: English (en-US).");
  }

  const userParts: string[] = [];
  if (input.docTitle?.trim()) {
    userParts.push(`Document title: ${input.docTitle.trim()}`);
  }
  if (input.prompt?.trim()) {
    userParts.push(`Instruction: ${input.prompt.trim()}`);
  }
  if (input.contextMarkdown?.trim()) {
    const excerpt = input.contextMarkdown.slice(0, 4000);
    userParts.push(`Surrounding document context (for reference only):\n${excerpt}`);
  }
  userParts.push(`Selected text to transform:\n${input.selectedText}`);

  return {
    systemPrompt: systemLines.join("\n"),
    userPrompt: userParts.join("\n\n"),
  };
}

export class AiRewriteService {
  private readonly searchConfigRepo: SearchConfigRepo;
  private readonly documentRepo: DocumentRepo;
  private readonly spaceRepo: SpaceRepo;
  private readonly spacesCache?: WorkspaceSpacesCache | undefined;
  private readonly audit?: AuditService | undefined;
  private fetchFn: FetchFn;
  private resolveDns: DnsResolver;
  private allowLocalForTest: boolean;

  constructor(
    deps: {
      readonly searchConfigRepo: SearchConfigRepo;
      readonly documentRepo: DocumentRepo;
      readonly spaceRepo: SpaceRepo;
      readonly spacesCache?: WorkspaceSpacesCache | undefined;
    },
    audit?: AuditService,
    transport?: AiRewriteTestTransport,
  ) {
    this.searchConfigRepo = deps.searchConfigRepo;
    this.documentRepo = deps.documentRepo;
    this.spaceRepo = deps.spaceRepo;
    this.spacesCache = deps.spacesCache;
    this.audit = audit;
    this.fetchFn = transport?.fetchFn ?? ((input, init) => fetch(input, init));
    this.resolveDns = transport?.resolveDns ?? defaultDnsResolver;
    this.allowLocalForTest = transport?.allowLocalForTest ?? false;
  }

  setTestTransport(transport: AiRewriteTestTransport): void {
    if (transport.fetchFn !== undefined) {
      this.fetchFn = transport.fetchFn;
    }
    if (transport.resolveDns !== undefined) {
      this.resolveDns = transport.resolveDns;
    }
    if (transport.allowLocalForTest !== undefined) {
      this.allowLocalForTest = transport.allowLocalForTest;
    }
  }

  private async validateBaseUrl(
    rawUrl: string,
    allowPrivateLoopback = false,
  ): Promise<string> {
    return validateAiEndpointUrl(rawUrl, {
      allowPrivateLoopback,
      resolveDns: this.resolveDns,
      allowLocalForTest: this.allowLocalForTest,
    });
  }

  async getSettings(principal: Principal): Promise<AiSettingsRecord> {
    return this.searchConfigRepo.getAiSettings(principal.workspaceId);
  }

  async updateSettings(
    principal: Principal,
    input: UpdateAiSettingsInput,
  ): Promise<AiSettingsRecord> {
    const allSpaces = await getAllWorkspaceSpaces(
      this.spacesCache ?? this.spaceRepo,
      principal.workspaceId,
    );
    assertAdminPrincipal(principal, allSpaces);

    const existing = await this.searchConfigRepo.getAiSettingsSecret(principal.workspaceId);
    const nextProvider = input.provider ?? existing.provider;
    const providerChanged = input.provider !== undefined && input.provider !== existing.provider;
    const defaults = AI_PROVIDER_DEFAULTS[nextProvider];
    const nextEnabled = input.enabled ?? existing.enabled;
    const candidateBaseUrl =
      input.baseUrl !== undefined
        ? input.baseUrl.trim()
        : providerChanged && defaults.baseUrl
          ? defaults.baseUrl
          : existing.baseUrl;

    if (nextEnabled || input.baseUrl !== undefined || providerChanged) {
      await this.validateBaseUrl(candidateBaseUrl, nextProvider === "ollama");
    }

    const nextEmbProvider = input.embeddingProvider ?? existing.embeddingProvider;
    const embChanged =
      input.embeddingProvider !== undefined &&
      input.embeddingProvider !== existing.embeddingProvider;
    const embDefaults = EMBEDDING_PROVIDER_DEFAULTS[nextEmbProvider];
    const candidateEmbBaseUrl =
      input.embeddingBaseUrl !== undefined
        ? input.embeddingBaseUrl.trim()
        : embChanged
          ? embDefaults.baseUrl
          : existing.embeddingBaseUrl;

    if (nextEmbProvider !== "local" && candidateEmbBaseUrl.length > 0) {
      await this.validateBaseUrl(candidateEmbBaseUrl, nextEmbProvider === "ollama");
    }

    const updated = await this.searchConfigRepo.upsertAiSettings(principal.workspaceId, input);
    await this.audit?.recordCapturedEvent(principal, {
      action: "ai.settings.update",
      resource: `ai_settings:${principal.workspaceId}`,
      spaceId: null,
      documentId: null,
      decision: "allowed",
      summary: `provider=${updated.provider}, model=${updated.model}, emb=${updated.embeddingProvider}:${updated.embeddingModel}, enabled=${updated.enabled}`,
      beforeRevisionId: null,
      afterRevisionId: null,
      diffPreview: null,
      reversible: false,
      irreversibleReason: null,
    });
    return updated;
  }

  async prepareRewrite(
    principal: Principal,
    input: AiRewriteStreamInput,
  ): Promise<AiRewritePreparedContext> {
    const allSpaces = await getAllWorkspaceSpaces(
      this.spacesCache ?? this.spaceRepo,
      principal.workspaceId,
    );

    if (input.documentId) {
      const doc = await this.documentRepo.getDocumentById(principal.workspaceId, input.documentId);
      if (!doc || doc.trashedAt !== null) {
        throw new InkadeError("NOT_FOUND", `Document ${input.documentId} not found`);
      }
      const tags = doc.tags ?? [];
      assertScope(
        principal.scope,
        "read",
        {
          spaceId: doc.spaceId,
          kind: doc.kind,
          tags,
        },
        allSpaces,
      );
    }

    const settings = await this.searchConfigRepo.getAiSettingsSecret(principal.workspaceId);
    if (!settings.enabled) {
      throw new InkadeError(
        "VALIDATION_ERROR",
        "AI rewrite gateway is disabled in workspace intelligence settings",
      );
    }
    if (settings.provider !== "ollama" && !settings.apiKey.trim()) {
      throw new InkadeError(
        "VALIDATION_ERROR",
        "AI gateway API key is not configured in workspace intelligence settings",
      );
    }
    if (!settings.model.trim()) {
      throw new InkadeError("VALIDATION_ERROR", "AI gateway model is not configured");
    }

    const base = await this.validateBaseUrl(settings.baseUrl, settings.provider === "ollama");
    const endpointUrl =
      settings.provider === "anthropic"
        ? base.endsWith("/messages")
          ? base
          : `${base}/messages`
        : base.endsWith("/chat/completions")
          ? base
          : `${base}/chat/completions`;
    const prompts = buildRewritePrompts(input);

    return {
      provider: settings.provider,
      baseUrl: base,
      endpointUrl,
      apiKey: settings.apiKey,
      model: settings.model.trim(),
      temperature: settings.temperature,
      systemPrompt: prompts.systemPrompt,
      userPrompt: prompts.userPrompt,
    };
  }

  async *streamPreparedRewrite(
    prepared: AiRewritePreparedContext,
    signal?: AbortSignal,
  ): AsyncGenerator<AiRewriteStreamEvent, void, void> {
    try {
      const model = createChatLanguageModel({
        provider: prepared.provider,
        baseUrl: prepared.baseUrl,
        model: prepared.model,
        apiKey: prepared.apiKey,
        fetchFn: this.fetchFn,
      });

      const result = streamText({
        model,
        system: prepared.systemPrompt,
        prompt: prepared.userPrompt,
        temperature: prepared.temperature,
        maxRetries: 0,
        ...(signal ? { abortSignal: signal } : {}),
      });

      let fullText = "";
      for await (const part of result.stream) {
        if (signal?.aborted) {
          return;
        }
        if (part.type === "text-delta") {
          fullText += part.text;
          yield { type: "delta", text: part.text };
        } else if (part.type === "error") {
          if (fullText.length > 0 && isStreamEndedWithoutFinishReason(part.error)) {
            break;
          }
          const message = extractUpstreamErrorMessage(part.error);
          yield { type: "error", message, code: "UPSTREAM_ERROR" };
          return;
        }
      }

      yield { type: "done", fullText };
    } catch (err) {
      if (signal?.aborted) {
        return;
      }
      const message = extractUpstreamErrorMessage(err);
      yield { type: "error", message, code: "UPSTREAM_FETCH_ERROR" };
    }
  }
}
