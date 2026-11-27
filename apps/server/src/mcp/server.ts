import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  asDocumentArtifactId,
  asDocumentId,
  asSpaceId,
  buildUntrustedDataNotice,
  deriveDocumentTrustTier,
  evaluateScopeAccess,
  extractPendingBlocks,
  INKADE_MCP_TOOL_NAMES,
  INKADE_TOOL_DEFINITIONS,
  INKADE_TOOL_DEFINITIONS_BY_NAME,
  isInkadeError,
  summarizeCollectionTrust,
  todayLocalDateString,
  type AgentToolActivityPayload,
  type DocumentArtifactId,
  type DocumentId,
  type DocumentKind,
  type DocumentRecord,
  type InkadeError,
  type InkadeErrorCode,
  type InkadeMcpToolName,
  type InkadeToolAnnotations,
  type InkadeToolArgsMap,
  type SpaceId,
} from "@inkade/core";
import type { DocumentRepo, SpaceRepo } from "@inkade/db";
import type { z } from "zod";
import type { EmbedTicketManager } from "../auth/embed-ticket.ts";
import type { WorkspaceSpacesCache } from "../cache/workspace-spaces-cache.ts";
import type { SseHub } from "../realtime/sse-hub.ts";
import type { BridgeRequestContext, InkadeServices } from "../services/index.ts";
import { getAllWorkspaceSpaces } from "../services/scope-guard.ts";
import type { Principal } from "../types.ts";
import {
  McpAppsCardStore,
  registerMcpAppsExtension,
  supportsMcpAppsUi,
} from "./mcp-apps.ts";

function mcpSuccess(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

export type McpExecutionStatus = "not_executed" | "unknown";

export interface McpFailureExtra {
  readonly executionStatus?: McpExecutionStatus | undefined;
  readonly current?: unknown;
  readonly fix?: string | undefined;
}

export interface McpStructuredErrorPayload {
  readonly error: {
    readonly code: InkadeErrorCode;
    readonly message: string;
    readonly fix: string;
  };
  readonly executionStatus: McpExecutionStatus;
  readonly current?: unknown;
}

function defaultExecutionStatusForCode(code: InkadeErrorCode): McpExecutionStatus {
  switch (code) {
    case "UNAUTHORIZED":
    case "FORBIDDEN":
    case "HARD_DELETE_BLOCKED":
    case "NOT_FOUND":
    case "SECTION_NOT_FOUND":
    case "VALIDATION_ERROR":
    case "CONFLICT":
    case "VERSION_CONFLICT":
    case "INVALID_PARENT_CYCLE":
    case "RATE_LIMITED":
      return "not_executed";
    case "INTERNAL_ERROR":
      return "unknown";
    default: {
      const _exhaustive: never = code;
      return _exhaustive;
    }
  }
}

function defaultMcpFixForCode(code: InkadeErrorCode): string {
  switch (code) {
    case "VERSION_CONFLICT":
      return "请先调用 get_document 读取最新内容与版本号后再重试（Call get_document to read the latest content and version before retrying with updated expectedVersion）。";
    case "CONFLICT":
      return "资源状态冲突，请先调用 get_document 或 list_bound_threads 检查最新状态后再重试（Inspect the latest resource state before retrying）。";
    case "FORBIDDEN":
      return "当前 Token Scope 不允许此操作，请向管理员申请权限或缩小范围（Current token scope denies this action; request wider permissions from owner or narrow target scope）。";
    case "HARD_DELETE_BLOCKED":
      return "当前 Token 策略禁止硬删除，请改用 trash_document 执行可恢复软删（Hard delete is blocked by policy; use trash_document instead）。";
    case "UNAUTHORIZED":
      return "认证失败或 Token 已失效，请检查 Bearer Token 或向管理员重新申请（Authentication failed; verify Bearer token or request a new token）。";
    case "NOT_FOUND":
      return "未找到目标资源，请先调用 list_documents、list_spaces 或 search_documents 核对 ID 后重试（Resource not found; verify ID via list/search tools before retrying）。";
    case "SECTION_NOT_FOUND":
      return "未找到目标标题段落，请先调用 get_document 检查标题层级，或在 patch_document_section 中传入 createIfMissing: true（Heading section not found; inspect headings via get_document or pass createIfMissing: true）。";
    case "VALIDATION_ERROR":
      return "参数校验失败，请核对必填字段、ID 前缀或先调用 get_space_schema 检查属性定义后再重试（Invalid arguments; check input fields or inspect get_space_schema）。";
    case "INVALID_PARENT_CYCLE":
      return "父级关系会造成循环引用，请先检查空间或大纲树结构后再重试（Parent reference creates a cycle; verify hierarchy before retrying）。";
    case "RATE_LIMITED":
      return "唤醒发送频率已达到上限（每分钟最多 20 次），请稍候再重试（Wake dispatch rate limit exceeded; wait briefly before retrying）。";
    case "INTERNAL_ERROR":
      return "服务端内部异常，操作是否已生效未知；重试前请先调用读取类工具核对当前状态（Internal server error; execution outcome is unknown, read current state before retrying）。";
    default: {
      const _exhaustive: never = code;
      return _exhaustive;
    }
  }
}

/**
 * Formats an error into a structured MCP self-recovery payload with machine-readable
 * error code, actionable fix guidance, executionStatus, and optional conflict snapshot.
 */
export function formatMcpErrorPayload(
  error: unknown,
  extra?: McpFailureExtra,
): McpStructuredErrorPayload {
  const code: InkadeErrorCode = isInkadeError(error) ? error.code : "INTERNAL_ERROR";
  const message = isInkadeError(error)
    ? error.message
    : error instanceof Error && error.message
      ? error.message
      : "Unexpected MCP error";
  const executionStatus = extra?.executionStatus ?? defaultExecutionStatusForCode(code);
  const fix = extra?.fix ?? defaultMcpFixForCode(code);

  return {
    error: {
      code,
      message,
      fix,
    },
    executionStatus,
    ...(extra?.current !== undefined ? { current: extra.current } : {}),
  };
}

/**
 * Builds an MCP error tool response carrying structured self-recovery JSON.
 */
export function mcpFailure(error: unknown, extra?: McpFailureExtra) {
  const payload = formatMcpErrorPayload(error, extra);
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  };
}

export const REGISTERED_MCP_TOOL_NAMES = INKADE_MCP_TOOL_NAMES;

interface PrebuiltMcpToolEntry {
  readonly mcpName: InkadeMcpToolName;
  readonly description: string;
  readonly inputShape: z.ZodRawShape;
  readonly annotations: InkadeToolAnnotations;
  readonly mutating: boolean;
}

const PREBUILT_MCP_TOOLS: readonly PrebuiltMcpToolEntry[] = INKADE_TOOL_DEFINITIONS.map((def) => ({
  mcpName: def.mcpName,
  description: def.description,
  inputShape: def.inputShape,
  annotations: def.annotations,
  mutating: def.mutating,
}));

type McpToolHandlerMap = {
  readonly [K in InkadeMcpToolName]: (args: InkadeToolArgsMap[K]) => Promise<unknown>;
};

export interface InkadeMcpServerDeps {
  readonly sseHub?: SseHub | undefined;
  readonly spaceRepo?: SpaceRepo | undefined;
  readonly documentRepo?: DocumentRepo | undefined;
  readonly spacesCache?: WorkspaceSpacesCache | undefined;
  readonly bridgeContext?: BridgeRequestContext | undefined;
  readonly embedTickets?: EmbedTicketManager | undefined;
  readonly clientCapabilities?: unknown;
  readonly requestOrigin?: string | undefined;
  readonly mcpAppCardStore?: McpAppsCardStore | undefined;
}

export function createInkadeMcpServer(
  principal: Principal,
  services: InkadeServices,
  deps?: InkadeMcpServerDeps,
): McpServer {
  const server = new McpServer({
    name: "inkade",
    version: "0.1.0",
  });

  async function resolveToolScopeTarget(
    documentId: DocumentId | null,
    spaceId: SpaceId | null,
  ): Promise<{
    readonly spaceId: SpaceId | null;
    readonly documentId?: DocumentId | undefined;
    readonly documentKind?: DocumentKind | undefined;
    readonly tags?: readonly string[] | undefined;
  }> {
    const spacesSource = deps?.spacesCache ?? deps?.spaceRepo;
    if (!spacesSource || !deps?.documentRepo || (!documentId && !spaceId)) {
      return { spaceId: null };
    }
    try {
      const allSpaces = await getAllWorkspaceSpaces(spacesSource, principal.workspaceId);
      if (documentId) {
        const doc = await deps.documentRepo.getDocumentById(principal.workspaceId, documentId);
        if (
          doc &&
          doc.trashedAt === null &&
          evaluateScopeAccess(
            principal.scope,
            "read",
            { spaceId: doc.spaceId, kind: doc.kind, tags: doc.tags },
            allSpaces,
          ).allowed
        ) {
          return {
            spaceId: doc.spaceId,
            documentId: doc.id,
            documentKind: doc.kind,
            tags: doc.tags,
          };
        }
        return { spaceId: null };
      }
      if (
        spaceId &&
        evaluateScopeAccess(
          principal.scope,
          "read",
          { spaceId, resourceType: "space" },
          allSpaces,
        ).allowed
      ) {
        return { spaceId };
      }
    } catch {
      // Never fail tool execution on metadata lookup
    }
    return { spaceId: null };
  }

  async function resolveConflictCurrentSnapshot(
    error: InkadeError,
    argDocumentId: DocumentId | null,
    argArtifactId: DocumentArtifactId | null,
  ): Promise<unknown> {
    if (error.code !== "VERSION_CONFLICT" && error.code !== "CONFLICT") {
      return undefined;
    }
    if (argArtifactId) {
      const latestArtifact = await services.artifact
        .getArtifact(principal, argArtifactId)
        .catch(() => null);
      if (latestArtifact) {
        return {
          artifactId: latestArtifact.id,
          documentId: latestArtifact.documentId,
          title: latestArtifact.title,
          sha256: latestArtifact.sha256,
          version: latestArtifact.version,
          heightPx: latestArtifact.heightPx,
          updatedAt: latestArtifact.updatedAt,
          ...(error.details ? { details: error.details } : {}),
        };
      }
    }
    if (argDocumentId) {
      const latestDoc = await services.document
        .getDocument(principal, argDocumentId)
        .catch(() => null);
      if (latestDoc) {
        const isPendingConflict = error.details?.reason === "PENDING_BLOCK_NOT_FOUND";
        return {
          documentId: latestDoc.id,
          title: latestDoc.title,
          kind: latestDoc.kind,
          version: latestDoc.version,
          updatedAt: latestDoc.updatedAt,
          lastEditedByType: latestDoc.lastEditedByType,
          trashedAt: latestDoc.trashedAt,
          ...(isPendingConflict
            ? {
                contentMarkdown: latestDoc.contentMarkdown,
                pendingBlocks: extractPendingBlocks(latestDoc.contentMarkdown).map((block) => ({
                  id: block.id,
                  label: block.label,
                  status: block.status,
                })),
              }
            : {}),
          ...(error.details ? { details: error.details } : {}),
        };
      }
    }
    return error.details;
  }

  async function annotateSearchHitsWithTrust<
    THit extends { readonly documentId: DocumentId; readonly kind: DocumentKind },
  >(hits: readonly THit[]) {
    const docById = new Map<DocumentId, DocumentRecord>();
    if (deps?.documentRepo && hits.length > 0) {
      const uniqueIds = [...new Set(hits.map((hit) => hit.documentId))];
      const loaded = await Promise.all(
        uniqueIds.map((docId) =>
          deps.documentRepo!.getDocumentById(principal.workspaceId, docId).catch(() => null),
        ),
      );
      for (const doc of loaded) {
        if (doc) {
          docById.set(doc.id, doc);
        }
      }
    }

    const enrichedHits = hits.map((hit) => {
      const doc = docById.get(hit.documentId);
      const trustTier = deriveDocumentTrustTier(doc ?? { kind: hit.kind });
      const untrustedDataNotice = buildUntrustedDataNotice(trustTier, doc?.sourceMeta);
      return {
        ...hit,
        trustTier,
        ...(untrustedDataNotice ? { untrustedDataNotice } : {}),
      };
    });

    const summary = summarizeCollectionTrust(
      enrichedHits.map((hit) => ({
        trustTier: hit.trustTier,
        sourceMeta: docById.get(hit.documentId)?.sourceMeta,
      })),
    );

    return {
      hits: enrichedHits,
      trustTier: summary.trustTier,
      ...(summary.untrustedDataNotice ? { untrustedDataNotice: summary.untrustedDataNotice } : {}),
    };
  }

  async function runTool(
    toolName: InkadeMcpToolName,
    args: Record<string, unknown>,
    fn: () => Promise<unknown>,
    options?: { readonly mutating?: boolean | undefined },
  ) {
    const argSpaceId =
      typeof args.spaceId === "string" && args.spaceId.length > 0 ? asSpaceId(args.spaceId) : null;
    const argDocumentId =
      typeof args.documentId === "string" && args.documentId.length > 0
        ? asDocumentId(args.documentId)
        : null;
    const argArtifactId =
      typeof args.artifactId === "string" && args.artifactId.length > 0
        ? asDocumentArtifactId(args.artifactId)
        : null;
    const mutating = options?.mutating ?? INKADE_TOOL_DEFINITIONS_BY_NAME[toolName].mutating;
    const invocationId = `inv_${crypto.randomUUID().slice(0, 12)}`;
    const tokenId = principal.kind === "token" ? principal.tokenId : null;
    const tokenName = principal.kind === "token" ? principal.tokenName : null;
    const startedAt = performance.now();

    const startMeta = await resolveToolScopeTarget(argDocumentId, argSpaceId);
    if (deps?.sseHub) {
      const startPayload: AgentToolActivityPayload = {
        invocationId,
        transport: "mcp",
        toolName,
        tokenId,
        tokenName,
        mutating,
      };
      deps.sseHub.publish(
        {
          type: "agent.tool.started",
          workspaceId: principal.workspaceId,
          spaceId: startMeta.spaceId,
          documentId: startMeta.documentId,
          documentKind: startMeta.documentKind,
          tags: startMeta.tags,
          actorType: principal.actorType,
          payload: startPayload,
        },
        { transient: true },
      );
    }

    return services.audit.runWithAuditCapture(
      "mcp",
      async (capture) => {
        const batchMeta = services.audit.ensureActiveBatchContext(principal);
        try {
          const result = await fn();
          if (mutating && !capture.recorded) {
            await services.audit
              .recordPrincipalEvent(principal, {
                transport: "mcp",
                action: toolName,
                resource: `mcp:${toolName}`,
                spaceId: capture.spaceId ?? argSpaceId,
                documentId: capture.documentId ?? argDocumentId,
                decision: "allowed",
                summary: capture.summary ?? `MCP ${toolName} succeeded`,
                beforeRevisionId: capture.beforeRevisionId ?? null,
                afterRevisionId: capture.afterRevisionId ?? null,
                diffPreview: capture.diffPreview ?? null,
                reversible: capture.reversible ?? false,
                irreversibleReason: capture.irreversibleReason ?? null,
                batchId: capture.batchId ?? batchMeta.batchId,
                executionMode: capture.executionMode ?? batchMeta.executionMode,
              })
              .catch(() => {});
          }
          if (deps?.sseHub) {
            const finalMeta = await resolveToolScopeTarget(
              capture.documentId ?? argDocumentId,
              capture.spaceId ?? argSpaceId,
            );
            const finishPayload: AgentToolActivityPayload = {
              invocationId,
              transport: "mcp",
              toolName,
              tokenId,
              tokenName,
              mutating,
              status: "ok",
              durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
            };
            deps.sseHub.publish(
              {
                type: "agent.tool.finished",
                workspaceId: principal.workspaceId,
                spaceId: finalMeta.spaceId,
                documentId: finalMeta.documentId,
                documentKind: finalMeta.documentKind,
                tags: finalMeta.tags,
                actorType: principal.actorType,
                payload: finishPayload,
              },
              { transient: true },
            );
          }
          if (
            deps?.bridgeContext?.sessionId &&
            toolName !== "poll_wake_events" &&
            typeof result === "object" &&
            result !== null &&
            !Array.isArray(result)
          ) {
            const piggybackWakes = await services.wake
              .pollWakeEvents(principal, {
                adeKind: deps.bridgeContext.host,
                externalThreadId: deps.bridgeContext.sessionId,
                workspacePath: deps.bridgeContext.workspacePath,
                markDelivered: true,
              })
              .catch(() => []);
            if (piggybackWakes.length > 0) {
              return mcpSuccess({
                ...(result as Record<string, unknown>),
                _inkadeWakeMessages: piggybackWakes,
              });
            }
          }
          return mcpSuccess(result);
        } catch (error) {
          const denied =
            isInkadeError(error) &&
            (error.code === "FORBIDDEN" || error.code === "HARD_DELETE_BLOCKED");
          if (denied || mutating) {
            await services.audit
              .recordPrincipalEvent(principal, {
                transport: "mcp",
                action: toolName,
                resource: `mcp:${toolName}`,
                spaceId: capture.spaceId ?? argSpaceId,
                documentId: capture.documentId ?? argDocumentId,
                decision: denied ? "denied" : "allowed",
                reason: error instanceof Error ? error.message : String(error),
                summary: `MCP ${toolName} failed`,
                reversible: false,
                irreversibleReason: denied ? "Access denied" : "Tool invocation failed",
                batchId: capture.batchId ?? batchMeta.batchId,
                executionMode: capture.executionMode ?? batchMeta.executionMode,
              })
              .catch(() => {});
          }
          if (deps?.sseHub) {
            const finishPayload: AgentToolActivityPayload = {
              invocationId,
              transport: "mcp",
              toolName,
              tokenId,
              tokenName,
              mutating,
              status: denied ? "denied" : "error",
              durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
            };
            deps.sseHub.publish(
              {
                type: "agent.tool.finished",
                workspaceId: principal.workspaceId,
                spaceId: startMeta.spaceId,
                documentId: startMeta.documentId,
                documentKind: startMeta.documentKind,
                tags: startMeta.tags,
                actorType: principal.actorType,
                payload: finishPayload,
              },
              { transient: true },
            );
          }
          const conflictCurrent = isInkadeError(error)
            ? await resolveConflictCurrentSnapshot(error, argDocumentId, argArtifactId)
            : undefined;
          const pendingFix =
            isInkadeError(error) && error.details?.reason === "PENDING_BLOCK_NOT_FOUND"
              ? "目标占位块已不存在（可能已被人类删除或转为手写段落）。请先调用 get_document 检查最新文档与剩余占位块，切勿盲目追加重复段落（Target pending block not found; it may have been removed or converted by a human. Call get_document to inspect current content before proceeding）。"
              : isInkadeError(error) && error.code === "VERSION_CONFLICT" && argArtifactId
                ? "Artifact sha256 冲突（可能已被并发修改）。请使用 current.sha256 作为 ifMatchSha256 重新调用 update_document_artifact（Artifact sha256 conflict. Re-read current.sha256 and retry update_document_artifact with ifMatchSha256 set to current.sha256）。"
                : undefined;
          return mcpFailure(error, {
            ...(conflictCurrent !== undefined ? { current: conflictCurrent } : {}),
            ...(pendingFix ? { fix: pendingFix } : {}),
          });
        }
      },
      { principal },
    );
  }

  const handlers: McpToolHandlerMap = {
    whoami_scope: () => services.token.whoamiScope(principal),
    list_spaces: async (args) => ({
      spaces: await services.space.listSpaces(principal, {
        includeArchived: args.includeArchived,
      }),
    }),
    search_documents: async (args) => {
      const hits = await services.search.search(principal, {
        q: args.q,
        spaceId: args.spaceId,
        kind: args.kind,
        tag: args.tag,
        limit: args.limit ?? 25,
      });
      return annotateSearchHitsWithTrust(hits);
    },
    list_documents: async (args) => ({
      documents: await services.document.listDocuments(principal, args),
    }),
    get_document: async (args) => {
      const document = await services.document.getDocument(principal, args.documentId);
      const nodes =
        document.kind === "outline"
          ? await services.outline.listNodes(principal, document.id)
          : undefined;
      const trustTier = deriveDocumentTrustTier(document);
      const untrustedDataNotice = buildUntrustedDataNotice(trustTier, document.sourceMeta);
      return {
        ...(nodes ? { document, nodes } : { document }),
        trustTier,
        ...(untrustedDataNotice ? { untrustedDataNotice } : {}),
      };
    },
    create_document: async (args) => {
      const document = await services.document.createDocument(principal, args);
      const schemaValidation = await services.document.getSchemaValidationHints(
        principal,
        document.spaceId,
        document.properties,
      );
      return schemaValidation ? { document, schemaValidation } : { document };
    },
    scaffold_document: async (args) => {
      const document = await services.document.scaffoldDocument(principal, args);
      const schemaValidation = await services.document.getSchemaValidationHints(
        principal,
        document.spaceId,
        document.properties,
      );
      return schemaValidation ? { document, schemaValidation } : { document };
    },
    patch_document_section: async (args) => {
      const { documentId, ...patchInput } = args;
      return {
        document: await services.document.patchDocumentSection(
          principal,
          documentId,
          patchInput,
        ),
      };
    },
    update_document: async (args) => {
      const { documentId, ...updateInput } = args;
      const document = await services.document.updateDocument(principal, documentId, updateInput);
      const schemaValidation = await services.document.getSchemaValidationHints(
        principal,
        document.spaceId,
        document.properties,
      );
      return schemaValidation ? { document, schemaValidation } : { document };
    },
    trash_document: async (args) => ({
      document: await services.document.trashDocument(principal, args.documentId),
    }),
    list_revisions: async (args) => ({
      revisions: await services.document.listRevisions(principal, args.documentId),
    }),
    get_revision_diff: (args) =>
      services.document.getRevisionDiff(
        principal,
        args.documentId,
        args.fromVersion,
        args.toVersion,
      ),
    get_daily_outline: (args) =>
      services.outline.getOrCreateDailyOutline(principal, args.date ?? todayLocalDateString()),
    append_outline_node: async (args) => ({
      node: await services.outline.createNode(principal, {
        ...args,
        authorType: "agent",
      }),
    }),
    update_outline_node: async (args) => {
      const { nodeId, documentId, ...input } = args;
      return {
        node: await services.outline.updateNode(principal, nodeId, input, documentId),
      };
    },
    append_node_reply: async (args) => ({
      node: await services.outline.createNode(principal, {
        documentId: args.documentId,
        parentNodeId: args.parentNodeId,
        contentMarkdown: args.contentMarkdown,
        noteMarkdown: args.noteMarkdown,
        checked: args.checked,
        collapsed: false,
        authorType: "agent",
        sourceBindingId: args.sourceBindingId,
      }),
    }),
    bind_thread: async (args) => ({
      binding: await services.threadBinding.upsertBinding(principal, args),
    }),
    update_thread_binding: async (args) => {
      const { bindingId, ...input } = args;
      return {
        binding: await services.threadBinding.updateBinding(principal, bindingId, input),
      };
    },
    list_bound_threads: async (args) => ({
      bindings: await services.threadBinding.listBindings(principal, args),
    }),
    claim_thread_binding: async (args) => {
      const { bindingId, ...claimInput } = args;
      return {
        binding: await services.threadBinding.claimBinding(principal, bindingId, claimInput),
      };
    },
    get_thread_binding: async (args) => ({
      binding: await services.threadBinding.getBinding(principal, args.bindingId, {
        consumeSteering: args.consumeSteering,
      }),
    }),
    create_upload_url: (args) => services.attachment.createUploadSpec(principal, args),
    clip_url: (args) => services.clipper.ingestUrl(principal, args),
    batch_mutate_outline: (args) => services.outline.batchMutate(principal, args),
    list_tasks: async (args) => ({
      tasks: await services.workspace.listTasks(principal, args),
    }),
    reschedule_task: async (args) => {
      const result = await services.task.rescheduleTask(principal, args);
      return {
        node: result.node,
        ...(result.task ? { task: result.task } : {}),
      };
    },
    upsert_task: (args) => services.task.upsertTask(principal, args),
    list_highlights: async (args) => ({
      highlights: await services.highlight.listHighlights(principal, args.documentId),
    }),
    create_highlight: async (args) => {
      const { documentId, ...input } = args;
      return {
        highlight: await services.highlight.createHighlight(principal, documentId, input),
      };
    },
    list_templates: async (args) => ({
      templates: await services.template.listTemplates(principal, args.kind),
    }),
    create_from_template: (args) => {
      const { templateId, ...input } = args;
      return services.template.applyTemplate(principal, templateId, input);
    },
    get_audit_logs: async (args) => ({
      auditLogs: await services.audit.listLogs(principal, args),
    }),
    semantic_search: async (args) => {
      const result = await services.semanticSearch.hybridSearch(principal, {
        q: args.q,
        spaceId: args.spaceId,
        kind: args.kind,
        tag: args.tag,
        limit: args.limit ?? 20,
        mode: args.mode ?? "hybrid",
      });
      const annotated = await annotateSearchHitsWithTrust(result.hits);
      return {
        ...result,
        ...annotated,
      };
    },
    request_human_decision: (args) =>
      services.threadBinding.requestHumanDecision(principal, args),
    get_space_schema: async (args) => ({
      schema: await services.space.getSpaceSchema(principal, args.spaceId, {
        templateId: args.templateId,
      }),
    }),
    upsert_space_schema: async (args) => {
      const { spaceId, ...input } = args;
      return {
        schema: await services.space.upsertSpaceSchema(principal, spaceId, input),
      };
    },
    list_context_packs: async () => ({
      packs: await services.contextPack.listPacks(principal),
    }),
    read_context_pack: async (args) =>
      services.contextPack.renderPackBySlug(principal, args.slug, args.maxTokens),
    poll_wake_events: async (args) => {
      const effectiveArgs = {
        ...args,
        adeKind: args.adeKind ?? deps?.bridgeContext?.host,
        externalThreadId: args.externalThreadId ?? deps?.bridgeContext?.sessionId,
        workspacePath: args.workspacePath ?? deps?.bridgeContext?.workspacePath,
      };
      const wakes =
        effectiveArgs.timeoutMs !== undefined && effectiveArgs.timeoutMs > 0
          ? await services.wake.waitWakeEvents(principal, effectiveArgs)
          : await services.wake.pollWakeEvents(principal, effectiveArgs);
      return { wakes };
    },
    list_comment_threads: async (args) => ({
      threads: await services.highlight.listCommentThreads(
        principal,
        args.documentId,
        args.status,
      ),
    }),
    reply_comment_thread: (args) => services.highlight.replyFromAgent(principal, args),
    get_viewer_context: () => services.viewerContext.getContext(principal),
    create_document_artifact: (args) => {
      const { documentId, ...input } = args;
      return services.artifact.createArtifact(principal, documentId, input);
    },
    update_document_artifact: (args) => {
      const { artifactId, ...input } = args;
      return services.artifact.updateArtifact(principal, artifactId, input, {
        requireIfMatch: true,
      });
    },
    validate_document_artifact: (args) =>
      Promise.resolve(services.artifact.validateArtifact(args)),
  };

  for (const tool of PREBUILT_MCP_TOOLS) {
    const handler = handlers[tool.mcpName] as (args: unknown) => Promise<unknown>;
    server.registerTool(
      tool.mcpName,
      {
        description: tool.description,
        inputSchema: tool.inputShape,
        annotations: tool.annotations,
      },
      async (rawArgs: Record<string, unknown>) => {
        const mutating =
          tool.mcpName === "get_thread_binding"
            ? Boolean((rawArgs as InkadeToolArgsMap["get_thread_binding"]).consumeSteering)
            : tool.mcpName === "poll_wake_events"
              ? (rawArgs as InkadeToolArgsMap["poll_wake_events"]).markDelivered !== false
              : tool.mutating;
        return runTool(tool.mcpName, rawArgs, () => handler(rawArgs), { mutating });
      },
    );
  }

  // --- Resources (3) ---

  server.registerResource(
    "scope",
    "inkade://scope",
    {
      title: "Current Scope",
      description: "Effective workspace scope and visible spaces for the authenticated caller.",
      mimeType: "application/json",
    },
    async (uri) => {
      const scopeInfo = await services.token.whoamiScope(principal);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(scopeInfo, null, 2),
          },
        ],
      };
    },
  );

  server.registerResource(
    "daily-today",
    "inkade://daily/today",
    {
      title: "Today's Daily Outline",
      description: "Today's daily outline document and all active outline nodes.",
      mimeType: "application/json",
    },
    async (uri) => {
      const daily = await services.outline.getOrCreateDailyOutline(
        principal,
        todayLocalDateString(),
      );
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(daily, null, 2),
          },
        ],
      };
    },
  );

  server.registerResource(
    "document-by-id",
    new ResourceTemplate("inkade://doc/{id}", {
      list: async () => {
        const docs = await services.document.listDocuments(principal, { limit: 100 });
        return {
          resources: docs.map((doc) => ({
            uri: `inkade://doc/${doc.id}`,
            name: doc.title,
            description: `${doc.kind} in ${doc.spaceId}`,
            mimeType: "application/json",
          })),
        };
      },
    }),
    {
      title: "Inkade Document",
      description: "Read any authorized Inkade document by ID.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const rawId = variables.id;
      const docId = Array.isArray(rawId) ? rawId[0] : rawId;
      if (!docId) {
        throw new Error("Missing document id");
      }
      const document = await services.document.getDocument(principal, asDocumentId(docId));
      const nodes =
        document.kind === "outline"
          ? await services.outline.listNodes(principal, document.id)
          : undefined;
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(nodes ? { document, nodes } : { document }, null, 2),
          },
        ],
      };
    },
  );

  server.registerResource(
    "context-pack-by-slug",
    new ResourceTemplate("inkade://pack/{slug}", {
      list: async () => {
        const packs = await services.contextPack.listPacks(principal);
        return {
          resources: packs.map((pack) => ({
            uri: `inkade://pack/${pack.slug}`,
            name: pack.name,
            description: pack.description || `Max ${pack.maxTokens} tokens`,
            mimeType: "text/markdown",
          })),
        };
      },
    }),
    {
      title: "Inkade Context Pack",
      description: "Scope-enforced, BPE-budgeted workspace Context Pack.",
      mimeType: "text/markdown",
    },
    async (uri, variables) => {
      const rawSlug = variables.slug;
      const slug = Array.isArray(rawSlug) ? rawSlug[0] : rawSlug;
      if (!slug) {
        throw new Error("Missing context pack slug");
      }
      const rendered = await services.contextPack.renderPackBySlug(principal, slug);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/markdown",
            text: rendered.renderedMarkdown,
          },
        ],
      };
    },
  );

  // Conditionally expose `show_inkade_view` and `ui://inkade/view/{cardId}` strictly to
  // MCP Apps-capable clients advertising `io.modelcontextprotocol/ui`.
  if (deps?.embedTickets) {
    const embedTickets = deps.embedTickets;
    const baseUrl = (deps.requestOrigin ?? "http://127.0.0.1:4311").replace(/\/+$/, "");
    const cardStore = deps.mcpAppCardStore ?? new McpAppsCardStore();
    let mcpAppsRegistered = false;

    const enableMcpApps = () => {
      if (mcpAppsRegistered) return;
      mcpAppsRegistered = true;
      registerMcpAppsExtension({
        server,
        principal,
        services,
        embedTickets,
        baseUrl,
        cardStore,
        wrapToolError: (error) => mcpFailure(error),
      });
    };

    if (supportsMcpAppsUi(deps.clientCapabilities)) {
      enableMcpApps();
    } else if (deps.clientCapabilities === undefined) {
      const prevOnInitialized = server.server.oninitialized;
      server.server.oninitialized = () => {
        prevOnInitialized?.();
        if (supportsMcpAppsUi(server.server.getClientCapabilities())) {
          enableMcpApps();
        }
      };
    }
  }

  return server;
}
