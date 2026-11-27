import {
  INKADE_TOOL_DEFINITIONS,
  INKADE_TOOL_DEFINITIONS_BY_NAME,
  filterToolSpecsByScope,
  todayLocalDateString,
  type InkadeMcpToolName,
  type InkadeToolActionCategory,
  type InkadeToolAnnotations,
  type InkadeToolArgsMap,
  type InkadeToolDefinition,
  type TokenPermission,
  type TokenScope,
} from "@inkade/core";
import { z } from "zod";
import type { InkadeClient } from "./client.ts";

export interface InkadeToolSpec<
  TName extends InkadeMcpToolName = InkadeMcpToolName,
  TShape extends z.ZodRawShape = (typeof INKADE_TOOL_DEFINITIONS_BY_NAME)[TName]["inputShape"],
> extends InkadeToolDefinition<TName, TShape> {
  readonly execute: (
    client: InkadeClient,
    args: z.infer<z.ZodObject<TShape>>,
  ) => Promise<unknown>;
}

type ToolExecutorMap = {
  readonly [K in InkadeMcpToolName]: (
    client: InkadeClient,
    args: InkadeToolArgsMap[K],
  ) => Promise<unknown>;
};

const TOOL_EXECUTORS: ToolExecutorMap = {
  whoami_scope: (client) => client.auth.whoami(),
  list_spaces: (client, args) =>
    client.spaces.list({ includeArchived: args.includeArchived }).then((spaces) => ({ spaces })),
  search_documents: (client, args) =>
    client.search
      .query({
        q: args.q,
        spaceId: args.spaceId,
        kind: args.kind,
        tag: args.tag,
        limit: args.limit ?? 25,
      })
      .then((hits) => ({ hits })),
  list_documents: (client, args) =>
    client.documents.list(args).then((documents) => ({ documents })),
  get_document: async (client, args) => {
    const document = await client.documents.get(args.documentId);
    const nodes =
      document.kind === "outline" ? await client.outlineNodes.list(document.id) : undefined;
    return nodes ? { document, nodes } : { document };
  },
  create_document: (client, args) =>
    client.documents.create(args).then((document) => ({ document })),
  scaffold_document: (client, args) =>
    client.documents.scaffold(args).then((document) => ({ document })),
  patch_document_section: (client, args) => {
    const { documentId, ...patchInput } = args;
    return client.documents.patchSection(documentId, patchInput).then((document) => ({ document }));
  },
  update_document: (client, args) => {
    const { documentId, ...updateInput } = args;
    return client.documents.update(documentId, updateInput).then((document) => ({ document }));
  },
  trash_document: (client, args) =>
    client.documents.trash(args.documentId).then((document) => ({ document })),
  list_revisions: (client, args) =>
    client.documents.listRevisions(args.documentId).then((revisions) => ({ revisions })),
  get_revision_diff: (client, args) =>
    client.documents.getRevisionDiff(args.documentId, args.fromVersion, args.toVersion),
  get_daily_outline: (client, args) =>
    client.documents.getDaily(args.date ?? todayLocalDateString()),
  append_outline_node: (client, args) =>
    client.outlineNodes.create({ ...args, authorType: "agent" }).then((node) => ({ node })),
  update_outline_node: (client, args) => {
    const { nodeId, documentId: _docId, ...input } = args;
    return client.outlineNodes.update(nodeId, input).then((node) => ({ node }));
  },
  append_node_reply: (client, args) =>
    client.outlineNodes
      .create({ ...args, collapsed: false, authorType: "agent" })
      .then((node) => ({ node })),
  bind_thread: (client, args) =>
    client.threadBindings.upsert(args).then((binding) => ({ binding })),
  update_thread_binding: (client, args) => {
    const { bindingId, ...input } = args;
    return client.threadBindings.update(bindingId, input).then((binding) => ({ binding }));
  },
  list_bound_threads: (client, args) =>
    client.threadBindings.list(args).then((bindings) => ({ bindings })),
  claim_thread_binding: (client, args) => {
    const { bindingId, ...input } = args;
    return client.threadBindings.claim(bindingId, input).then((binding) => ({ binding }));
  },
  get_thread_binding: (client, args) =>
    client.threadBindings
      .get(args.bindingId, { consumeSteering: args.consumeSteering })
      .then((binding) => ({ binding })),
  create_upload_url: async (client, args) => {
    if (args.documentId) {
      await client.documents.get(args.documentId);
    }
    return {
      uploadUrl: "/api/v1/attachments",
      method: "POST" as const,
      contentTypes: ["multipart/form-data"],
      documentId: args.documentId ?? null,
      filename: args.filename,
      mimeType: args.mimeType ?? "application/octet-stream",
    };
  },
  clip_url: (client, args) => client.clips.ingestUrl(args),
  batch_mutate_outline: (client, args) => client.outlineNodes.batch(args),
  list_tasks: (client, args) => client.tasks.list(args).then((tasks) => ({ tasks })),
  reschedule_task: (client, args) =>
    client.tasks.reschedule(args).then((node) => ({ node })),
  upsert_task: (client, args) => client.tasks.upsert(args),
  list_highlights: (client, args) =>
    client.highlights.list(args.documentId).then((highlights) => ({ highlights })),
  create_highlight: (client, args) => {
    const { documentId, ...input } = args;
    return client.highlights.create(documentId, input).then((highlight) => ({ highlight }));
  },
  list_templates: (client, args) =>
    client.templates.list(args.kind).then((templates) => ({ templates })),
  create_from_template: (client, args) => {
    const { templateId, ...input } = args;
    return client.templates.apply(templateId, input);
  },
  get_audit_logs: (client, args) =>
    client.auditLogs.list(args).then((auditLogs) => ({ auditLogs })),
  semantic_search: (client, args) => client.search.semantic(args),
  request_human_decision: (client, args) => client.threadBindings.requestDecision(args),
  get_space_schema: (client, args) =>
    client.spaces
      .getSchema(args.spaceId, args.templateId ? { templateId: args.templateId } : undefined)
      .then((schema) => ({ schema })),
  upsert_space_schema: (client, args) => {
    const { spaceId, ...input } = args;
    return client.spaces.upsertSchema(spaceId, input).then((schema) => ({ schema }));
  },
  list_context_packs: (client) => client.contextPacks.list().then((packs) => ({ packs })),
  read_context_pack: (client, args) =>
    client.contextPacks.getBySlug(
      args.slug,
      args.maxTokens !== undefined ? { maxTokens: args.maxTokens } : undefined,
    ),
  poll_wake_events: (client, args) =>
    (args.timeoutMs !== undefined && args.timeoutMs > 0
      ? client.threadBindings.waitWakeEvents(args)
      : client.threadBindings.pollWakeEvents(args)
    ).then((wakes) => ({ wakes })),
  list_comment_threads: (client, args) =>
    client.highlights
      .listCommentThreads(args.documentId, args.status)
      .then((threads) => ({ threads })),
  reply_comment_thread: async (client, args) => {
    const result = await client.highlights.addComment(args.highlightId, {
      bodyMarkdown: args.bodyMarkdown,
      authorType: "agent",
      ...(args.resolve !== undefined ? { resolve: args.resolve } : {}),
    });
    return result;
  },
  get_viewer_context: (client) => client.documents.getViewerContext(),
  create_document_artifact: (client, args) => {
    const { documentId, ...input } = args;
    return client.artifacts.create(documentId, input);
  },
  update_document_artifact: (client, args) => {
    const { artifactId, ...input } = args;
    return client.artifacts.update(artifactId, input);
  },
  validate_document_artifact: (client, args) => client.artifacts.validate(args),
};

export const INKADE_TOOL_CATALOG: readonly InkadeToolSpec[] = INKADE_TOOL_DEFINITIONS.map(
  (def) =>
    ({
      ...def,
      execute: TOOL_EXECUTORS[def.mcpName],
    }) as unknown as InkadeToolSpec,
);

/**
 * Filters Inkade catalog tools permitted for the given token scope's permission level.
 */
export function filterInkadeToolsByScope(
  scope: Pick<TokenScope, "permission">,
  catalog: readonly InkadeToolSpec[] = INKADE_TOOL_CATALOG,
): readonly InkadeToolSpec[] {
  return filterToolSpecsByScope(scope, catalog);
}

export interface JsonSchemaToolManifestEntry {
  readonly name: string;
  readonly mcpName: string;
  readonly description: string;
  readonly whenToUse: string;
  readonly requiredPermission: TokenPermission;
  readonly actionCategory: InkadeToolActionCategory;
  readonly mutating: boolean;
  readonly annotations: InkadeToolAnnotations;
  readonly inputSchema: Record<string, unknown>;
}

/**
 * Converts `InkadeToolSpec` definitions into a JSON Schema manifest suitable for Ghost/plugin hosts.
 */
export function toJsonSchemaToolManifest(
  catalog: readonly InkadeToolSpec[] = INKADE_TOOL_CATALOG,
): readonly JsonSchemaToolManifestEntry[] {
  return catalog.map((tool) => ({
    name: tool.name,
    mcpName: tool.mcpName,
    description: tool.description,
    whenToUse: tool.whenToUse,
    requiredPermission: tool.requiredPermission,
    actionCategory: tool.actionCategory,
    mutating: tool.mutating,
    annotations: tool.annotations,
    inputSchema: z.toJSONSchema(tool.inputSchema),
  }));
}
