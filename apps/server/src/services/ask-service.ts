import {
  cleanDisplaySnippet,
  countBpeTokens,
  evaluateScopeAccess,
  InkadeError,
  isSystemInternalDocument,
  resolveAllowedSpaceIds,
  truncateToTokenBudget,
  type AskCitation,
  type AskRequestInput,
  type AskStreamEvent,
  type DocumentId,
  type DocumentRecord,
  type ParsedAskRequestInput,
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
import { defaultDnsResolver, type DnsResolver, type FetchFn } from "./clipper-service.ts";
import { assertScope, getAllWorkspaceSpaces } from "./scope-guard.ts";
import type { SemanticSearchService } from "./semantic-search-service.ts";
import type { ViewQueryService } from "./view-query-service.ts";

export interface AskServiceTransport {
  readonly fetchFn?: FetchFn | undefined;
  readonly resolveDns?: DnsResolver | undefined;
  readonly allowLocalForTest?: boolean | undefined;
}

export interface PreparedAskContext {
  readonly input: ParsedAskRequestInput;
  readonly citations: readonly AskCitation[];
  readonly evidencePrompt: string;
  readonly settings: {
    readonly enabled: boolean;
    readonly provider: "openai" | "anthropic" | "deepseek" | "ollama" | "custom";
    readonly baseUrl: string;
    readonly model: string;
    readonly apiKey: string;
    readonly temperature: number;
  };
  readonly fallbackMode: boolean;
}

function buildAskSystemPrompt(targetLanguage?: "zh-CN" | "en-US"): string {
  const lines = [
    "You are Ask Inkade, a grounded personal knowledge assistant.",
    "Answer the user's question strictly using the provided numbered context excerpts [1], [2], ... from their authorized Inkade documents.",
    "Cite supporting sources inline immediately using [1], [2], etc. matching the excerpt numbers.",
    "If the provided excerpts do not contain enough evidence, say clearly what is missing without fabricating facts.",
    "Respond in clean, readable Markdown.",
  ];
  if (targetLanguage === "zh-CN") {
    lines.push("Write your answer in Simplified Chinese (zh-CN).");
  } else if (targetLanguage === "en-US") {
    lines.push("Write your answer in English (en-US).");
  }
  return lines.join("\n");
}

function buildOfflineEvidenceAnswer(
  question: string,
  citations: readonly AskCitation[],
  targetLanguage?: "zh-CN" | "en-US",
): string {
  const isZh =
    targetLanguage === "zh-CN" ||
    (targetLanguage !== "en-US" && /[\u4e00-\u9fff]/.test(question));

  if (citations.length === 0) {
    return isZh
      ? "当前授权范围内未检索到与该问题直接相关的笔记分块。请尝试换个关键词或扩大范围。"
      : "No matching knowledge chunks were found within your current scope. Try broadening the query or context scope.";
  }

  const header = isZh
    ? `已在当前授权范围内匹配到 ${citations.length} 条最相关的知识依据：\n\n`
    : `Matched ${citations.length} grounded source ${citations.length === 1 ? "excerpt" : "excerpts"} within your current scope:\n\n`;

  const bullets = citations.map((cite) => {
    const rawHeading = cite.headingPath?.trim() ?? "";
    const sameAsTitle = rawHeading.toLowerCase() === cite.title.trim().toLowerCase();
    const pageMatch = /^Page\s+(\d+)$/i.exec(rawHeading);
    const displayHeading =
      !rawHeading || sameAsTitle
        ? ""
        : pageMatch && isZh
          ? `第 ${pageMatch[1]} 页`
          : rawHeading;
    const loc = displayHeading ? ` · ${displayHeading}` : "";
    const cleanExcerpt =
      cleanDisplaySnippet(cite.excerpt, {
        title: cite.title,
        headingPath: cite.headingPath,
        maxLength: 200,
      }) || cite.title;
    return `- **[${cite.index}] ${cite.title}**${loc}\n  ${cleanExcerpt}`;
  });

  return `${header}${bullets.join("\n\n")}`;
}

export class AskService {
  private fetchFn: FetchFn;
  private resolveDns: DnsResolver;
  private allowLocalForTest: boolean;

  constructor(
    private readonly deps: {
      readonly searchConfigRepo: SearchConfigRepo;
      readonly documentRepo: DocumentRepo;
      readonly spaceRepo: SpaceRepo;
      readonly workspaceRepo: {
        getSavedViewById(workspaceId: string, viewId: string): Promise<{ readonly id: string; readonly filter: unknown } | null>;
      };
      readonly semanticSearch: SemanticSearchService;
      readonly viewQuery: ViewQueryService;
      readonly spacesCache?: WorkspaceSpacesCache | undefined;
    },
    private readonly audit?: AuditService,
    transport?: AskServiceTransport,
  ) {
    this.fetchFn = transport?.fetchFn ?? ((input, init) => fetch(input, init));
    this.resolveDns = transport?.resolveDns ?? defaultDnsResolver;
    this.allowLocalForTest = transport?.allowLocalForTest ?? false;
  }

  setTestTransport(transport: AskServiceTransport): void {
    if (transport.fetchFn !== undefined) this.fetchFn = transport.fetchFn;
    if (transport.resolveDns !== undefined) this.resolveDns = transport.resolveDns;
    if (transport.allowLocalForTest !== undefined) this.allowLocalForTest = transport.allowLocalForTest;
  }

  async prepareAsk(
    principal: Principal,
    rawInput: AskRequestInput,
  ): Promise<PreparedAskContext> {
    const context = rawInput.context;
    const mode = context?.mode ?? "all";
    const allSpaces = await getAllWorkspaceSpaces(
      this.deps.spacesCache ?? this.deps.spaceRepo,
      principal.workspaceId,
    );

    if (mode === "space" && context?.spaceId) {
      assertScope(
        principal.scope,
        "read",
        { spaceId: context.spaceId, resourceType: "space" },
        allSpaces,
      );
    }

    const allowedSpaces = resolveAllowedSpaceIds(principal.scope, allSpaces);
    const spaceFilterIds =
      mode === "space" && context?.spaceId
        ? [context.spaceId]
        : allowedSpaces === "*"
          ? undefined
          : [...allowedSpaces];

    let narrowedDocIds: Set<DocumentId> | undefined;

    if (mode === "documents" && context?.documentIds && context.documentIds.length > 0) {
      narrowedDocIds = new Set<DocumentId>();
      for (const docId of context.documentIds) {
        const doc = await this.deps.documentRepo.getDocumentById(principal.workspaceId, docId);
        if (!doc || doc.trashedAt !== null || isSystemInternalDocument(doc)) {
          throw new InkadeError("NOT_FOUND", `Document "${docId}" not found`);
        }
        assertScope(
          principal.scope,
          "read",
          { spaceId: doc.spaceId, kind: doc.kind, tags: doc.tags },
          allSpaces,
        );
        narrowedDocIds.add(doc.id);
      }
    } else if (mode === "savedView" && context?.savedViewId) {
      const view = await this.deps.workspaceRepo.getSavedViewById(
        principal.workspaceId,
        context.savedViewId,
      );
      if (!view) {
        throw new InkadeError("NOT_FOUND", `Saved view "${context.savedViewId}" not found`);
      }
      const filterObj = (view.filter ?? {}) as {
        spaceId?: string;
        kind?: DocumentRecord["kind"];
        tag?: string;
        pinnedOnly?: boolean;
        unreadOnly?: boolean;
        query?: string;
        propertyFilter?: Record<string, unknown>;
      };
      const queryResult = await this.deps.viewQuery.queryView(principal, {
        ...(filterObj.spaceId ? { spaceId: filterObj.spaceId as never } : {}),
        ...(filterObj.kind ? { kind: filterObj.kind } : {}),
        ...(filterObj.tag ? { tag: filterObj.tag } : {}),
        ...(filterObj.pinnedOnly !== undefined ? { pinnedOnly: filterObj.pinnedOnly } : {}),
        ...(filterObj.unreadOnly !== undefined ? { unreadOnly: filterObj.unreadOnly } : {}),
        ...(filterObj.query ? { query: filterObj.query } : {}),
        ...(filterObj.propertyFilter ? { propertyFilter: filterObj.propertyFilter } : {}),
        limit: 500,
        offset: 0,
      });
      narrowedDocIds = new Set(queryResult.documents.map((d) => d.id));
    }

    // Filter final authorized candidate set for double safety when narrowedDocIds isn't already resolved
    if (!narrowedDocIds && spaceFilterIds !== undefined && spaceFilterIds.length === 0) {
      narrowedDocIds = new Set<DocumentId>();
    } else if (!narrowedDocIds && mode === "tag" && context?.tag) {
      const taggedDocs = await this.deps.documentRepo.listDocuments(principal.workspaceId, {
        spaceIds: spaceFilterIds,
        kind: context.kind,
        allowedKinds: principal.scope.allowedKinds,
        tag: context.tag,
        tagAllowlist: principal.scope.tagAllowlist,
        includeTrashed: false,
        limit: null,
      });
      narrowedDocIds = new Set(
        taggedDocs
          .filter(
            (doc) =>
              !isSystemInternalDocument(doc) &&
              evaluateScopeAccess(
                principal.scope,
                "read",
                { spaceId: doc.spaceId, kind: doc.kind, tags: doc.tags },
                allSpaces,
              ).allowed,
          )
          .map((d) => d.id),
      );
    }

    const limit = Math.min(Math.max(rawInput.limit ?? 8, 1), 20);
    const searchMode = rawInput.mode ?? "hybrid";

    const rawChunkHits = await this.deps.semanticSearch.searchChunks(principal, {
      q: rawInput.question,
      mode: searchMode,
      limit: Math.min(36, limit * 3),
      ...(mode === "space" && context?.spaceId ? { spaceId: context.spaceId } : {}),
      ...(context?.kind ? { kind: context.kind } : {}),
      ...(mode === "tag" && context?.tag ? { tag: context.tag } : {}),
      ...(narrowedDocIds ? { documentIds: [...narrowedDocIds] } : {}),
    });

    // Drop bare PDF attachment-stub bullets (`- *.pdf (2p)`) when substantive hits exist,
    // and diversify citations so one document never monopolizes multiple slots prematurely.
    const substantiveHits = rawChunkHits.filter((hit) => {
      const text = (hit.snippet || hit.contentText).trim();
      return !/^-?\s*\S+\.pdf\s*\(\d+p\)\s*$/i.test(text);
    });
    const candidateHits = substantiveHits.length > 0 ? substantiveHits : rawChunkHits;

    const selectedHits: typeof candidateHits[number][] = [];
    const perDocCount = new Map<string, number>();
    for (const hit of candidateHits) {
      if (selectedHits.length >= limit) break;
      if ((perDocCount.get(hit.docId) ?? 0) === 0) {
        selectedHits.push(hit);
        perDocCount.set(hit.docId, 1);
      }
    }
    if (selectedHits.length < limit) {
      const maxPerDoc = selectedHits.length < Math.min(limit, 4) ? 2 : 1;
      for (const hit of candidateHits) {
        if (selectedHits.length >= limit) break;
        if (selectedHits.some((s) => s.chunkId === hit.chunkId)) continue;
        const count = perDocCount.get(hit.docId) ?? 0;
        if (count < maxPerDoc) {
          selectedHits.push(hit);
          perDocCount.set(hit.docId, count + 1);
        }
      }
    }

    const chunkHits = selectedHits;

    const citations: AskCitation[] = chunkHits.map((hit, idx) => ({
      index: idx + 1,
      docId: hit.docId,
      title: hit.title,
      kind: hit.kind,
      spaceId: hit.spaceId,
      headingPath: hit.headingPath,
      nodeId: hit.nodeId,
      excerpt: hit.snippet || truncateToTokenBudget(hit.contentText, 120),
      score: hit.score,
    }));

    const contextBlocks: string[] = [];
    let runningTokens = 0;
    const maxContextTokens = 6000;
    for (let i = 0; i < chunkHits.length; i++) {
      const hit = chunkHits[i]!;
      const citeNum = i + 1;
      const meta = [
        `[${citeNum}] ${hit.title} (${hit.docId})`,
        hit.headingPath ? `Section: ${hit.headingPath}` : null,
        hit.nodeId ? `Node: ${hit.nodeId}` : null,
      ]
        .filter(Boolean)
        .join(" | ");
      const remaining = maxContextTokens - runningTokens;
      if (remaining <= 64) break;
      const body = truncateToTokenBudget(hit.contentText, Math.min(750, remaining - 32));
      const block = `${meta}\n${body}`;
      runningTokens += countBpeTokens(block);
      contextBlocks.push(block);
    }

    const evidencePrompt = [
      `Question: ${rawInput.question}`,
      "",
      "Authorized Knowledge Excerpts:",
      contextBlocks.length > 0 ? contextBlocks.join("\n\n---\n\n") : "(No relevant excerpts found)",
    ].join("\n");

    const settings = await this.deps.searchConfigRepo.getAiSettingsSecret(principal.workspaceId);
    const hasConfiguredLlm =
      settings.enabled &&
      Boolean(settings.model.trim()) &&
      Boolean(settings.baseUrl.trim()) &&
      (settings.provider === "ollama" || Boolean(settings.apiKey.trim()));

    if (hasConfiguredLlm) {
      await validateAiEndpointUrl(settings.baseUrl, {
        allowPrivateLoopback: settings.provider === "ollama",
        resolveDns: this.resolveDns,
        allowLocalForTest: this.allowLocalForTest,
      });
    }

    if (principal.kind === "token" && this.audit) {
      await this.audit
        .recordPrincipalEvent(principal, {
          transport: "rest",
          action: "ask_inkade",
          resource: `ask:${mode}`,
          spaceId: context?.spaceId ?? null,
          decision: "allowed",
          summary: `Ask Inkade (${citations.length} citations): ${rawInput.question.slice(0, 80)}`,
        })
        .catch(() => {});
    }

    return {
      input: {
        question: rawInput.question,
        limit,
        mode: searchMode,
        ...(rawInput.context ? { context: { ...rawInput.context, mode } } : {}),
        ...(rawInput.targetLanguage ? { targetLanguage: rawInput.targetLanguage } : {}),
      },
      citations,
      evidencePrompt,
      settings: {
        enabled: settings.enabled,
        provider: settings.provider,
        baseUrl: settings.baseUrl,
        model: settings.model,
        apiKey: settings.apiKey,
        temperature: settings.temperature,
      },
      fallbackMode: !hasConfiguredLlm,
    };
  }

  async *streamPreparedAsk(
    prepared: PreparedAskContext,
    signal?: AbortSignal,
  ): AsyncGenerator<AskStreamEvent, void, void> {
    const activeProvider = prepared.fallbackMode ? "local-rag" : prepared.settings.provider;
    const activeModel = prepared.fallbackMode ? "evidence-summary" : prepared.settings.model;

    yield {
      type: "meta",
      retrievalCount: prepared.citations.length,
      provider: activeProvider,
      model: activeModel,
      fallbackMode: prepared.fallbackMode,
      citations: prepared.citations,
    };

    if (prepared.fallbackMode) {
      const answer = buildOfflineEvidenceAnswer(
        prepared.input.question,
        prepared.citations,
        prepared.input.targetLanguage,
      );
      const chunks = answer.match(/.{1,48}/gs) ?? [answer];
      for (const chunk of chunks) {
        if (signal?.aborted) return;
        yield { type: "delta", text: chunk };
      }
      yield {
        type: "done",
        fullText: answer,
        citations: prepared.citations,
        fallbackMode: true,
        provider: activeProvider,
        model: activeModel,
      };
      return;
    }

    try {
      const model = createChatLanguageModel({
        provider: prepared.settings.provider,
        baseUrl: prepared.settings.baseUrl,
        model: prepared.settings.model,
        apiKey: prepared.settings.apiKey,
        fetchFn: this.fetchFn,
      });

      const result = streamText({
        model,
        system: buildAskSystemPrompt(prepared.input.targetLanguage),
        prompt: prepared.evidencePrompt,
        temperature: prepared.settings.temperature,
        maxRetries: 0,
        ...(signal ? { abortSignal: signal } : {}),
      });

      let fullText = "";
      for await (const part of result.stream) {
        if (signal?.aborted) return;
        if (part.type === "text-delta") {
          fullText += part.text;
          yield { type: "delta", text: part.text };
        } else if (part.type === "error") {
          if (fullText.length > 0 && isStreamEndedWithoutFinishReason(part.error)) {
            break;
          }
          const message = extractUpstreamErrorMessage(part.error, "AI provider stream error");
          yield { type: "error", message, code: "UPSTREAM_ERROR" };
          return;
        }
      }

      yield {
        type: "done",
        fullText,
        citations: prepared.citations,
        fallbackMode: false,
        provider: activeProvider,
        model: activeModel,
      };
    } catch (err) {
      if (signal?.aborted) return;
      const msg = extractUpstreamErrorMessage(err, "Failed to stream Ask response");
      yield { type: "error", message: msg, code: "UPSTREAM_FETCH_ERROR" };
    }
  }
}
