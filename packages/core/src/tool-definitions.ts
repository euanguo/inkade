import { z } from "zod";
import {
  apiTokenIdSchema,
  documentArtifactIdSchema,
  documentIdSchema,
  highlightIdSchema,
  outlineNodeIdSchema,
  spaceIdSchema,
  taskTargetIdSchema,
  templateIdSchema,
  threadBindingIdSchema,
} from "./ids.ts";
import { PERMISSION_RANK } from "./scope.ts";
import { TASK_SCHEDULE_SLOTS } from "./schedule.ts";
import { taskBucketSchema, taskPrioritySchema, taskRecurrenceRuleSchema } from "./tasks.ts";
import {
  adeKindSchema,
  adeThreadStatusSchema,
  agentPendingApprovalSchema,
  agentSteeringNoteSchema,
  agentStepItemSchema,
  auditDecisionSchema,
  auditTransportSchema,
  createDocumentArtifactInputSchema,
  dailyDateSchema,
  documentKindSchema,
  highlightColorSchema,
  humanDecisionUrgencySchema,
  outlineBatchOperationSchema,
  scheduledStartMinSchema,
  scaffoldSectionInputSchema,
  sectionPatchModeSchema,
  selectionAnchorSchema,
  semanticSearchModeSchema,
  taskSourceEngineSchema,
  spacePropertySchemaFieldsArraySchema,
  updateDocumentArtifactInputSchema,
  validateDocumentArtifactInputSchema,
  type TokenPermission,
  type TokenScope,
} from "./types/index.ts";

export const INKADE_TOOL_ACTION_CATEGORIES = [
  "read",
  "write",
  "ui",
  "remove",
  "governance",
] as const;
export type InkadeToolActionCategory = (typeof INKADE_TOOL_ACTION_CATEGORIES)[number];

export interface InkadeToolAnnotations {
  readonly readOnlyHint: boolean;
  readonly destructiveHint: boolean;
  readonly idempotentHint: boolean;
  readonly openWorldHint: boolean;
}

export interface InkadeToolDefinition<
  TName extends string = string,
  TShape extends z.ZodRawShape = z.ZodRawShape,
> {
  readonly name: `inkade_${TName}`;
  readonly mcpName: TName;
  readonly description: string;
  readonly whenToUse: string;
  readonly requiredPermission: TokenPermission;
  readonly actionCategory: InkadeToolActionCategory;
  readonly mutating: boolean;
  readonly inputShape: TShape;
  readonly inputSchema: z.ZodObject<TShape>;
  readonly annotations: InkadeToolAnnotations;
}

function defineToolDefinition<const TName extends string, TShape extends z.ZodRawShape>(spec: {
  readonly mcpName: TName;
  readonly description: string;
  readonly whenToUse: string;
  readonly requiredPermission: TokenPermission;
  readonly actionCategory: InkadeToolActionCategory;
  readonly mutating: boolean;
  readonly inputShape: TShape;
  readonly destructiveHint?: boolean | undefined;
  readonly idempotentHint?: boolean | undefined;
  readonly openWorldHint: boolean;
}): InkadeToolDefinition<TName, TShape> {
  return {
    name: `inkade_${spec.mcpName}`,
    mcpName: spec.mcpName,
    description: spec.description,
    whenToUse: spec.whenToUse,
    requiredPermission: spec.requiredPermission,
    actionCategory: spec.actionCategory,
    mutating: spec.mutating,
    inputShape: spec.inputShape,
    inputSchema: z.object(spec.inputShape),
    annotations: {
      readOnlyHint: !spec.mutating,
      destructiveHint: spec.destructiveHint ?? false,
      idempotentHint: spec.idempotentHint ?? !spec.mutating,
      openWorldHint: spec.openWorldHint,
    },
  };
}

export const INKADE_TOOL_DEFINITIONS_BY_NAME = {
  whoami_scope: defineToolDefinition({
    mcpName: "whoami_scope",
    description:
      "Inspect the current token or user scope, visible spaces, and effective permissions.",
    whenToUse: "Check active token permissions and visible Spaces before reading or writing.",
    requiredPermission: "read",
    actionCategory: "read",
    mutating: false,
    openWorldHint: false,
    inputShape: {},
  }),
  list_spaces: defineToolDefinition({
    mcpName: "list_spaces",
    description: "List workspace spaces accessible under the current token scope.",
    whenToUse: "Discover Space IDs and hierarchy when organizing or scoping reads and writes.",
    requiredPermission: "read",
    actionCategory: "read",
    mutating: false,
    openWorldHint: false,
    inputShape: {
      includeArchived: z.boolean().optional(),
    },
  }),
  search_documents: defineToolDefinition({
    mcpName: "search_documents",
    description: "Full-text search across authorized documents and outline nodes.",
    whenToUse: "Find relevant notes by keyword, Space, document kind, or tag.",
    requiredPermission: "read",
    actionCategory: "read",
    mutating: false,
    openWorldHint: false,
    inputShape: {
      q: z.string().trim().min(1).max(300),
      spaceId: spaceIdSchema.optional(),
      kind: documentKindSchema.optional(),
      tag: z.string().min(1).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    },
  }),
  list_documents: defineToolDefinition({
    mcpName: "list_documents",
    description: "List documents filtered by space, kind, or tag within current scope.",
    whenToUse: "Browse recent documents or check documents in a Space or tag.",
    requiredPermission: "read",
    actionCategory: "read",
    mutating: false,
    openWorldHint: false,
    inputShape: {
      spaceId: spaceIdSchema.optional(),
      kind: documentKindSchema.optional(),
      tag: z.string().min(1).optional(),
      pinnedOnly: z.boolean().optional(),
      includeTrashed: z.boolean().optional(),
      limit: z.number().int().min(1).max(500).optional(),
      offset: z.number().int().min(0).optional(),
    },
  }),
  get_document: defineToolDefinition({
    mcpName: "get_document",
    description: "Read a document by ID (includes outline nodes when kind is outline).",
    whenToUse: "Read full Markdown content or outline tree of a document before editing or replying.",
    requiredPermission: "read",
    actionCategory: "read",
    mutating: false,
    openWorldHint: false,
    inputShape: {
      documentId: documentIdSchema,
    },
  }),
  create_document: defineToolDefinition({
    mcpName: "create_document",
    description: "Create a new article, clip, or outline document inside an authorized space.",
    whenToUse: "Create a structured note, research article, or outline inside a permitted Space.",
    requiredPermission: "write",
    actionCategory: "write",
    mutating: true,
    openWorldHint: false,
    inputShape: {
      spaceId: spaceIdSchema,
      kind: documentKindSchema,
      title: z.string().trim().min(1).max(300),
      slug: z.string().trim().min(1).max(160).optional(),
      dailyDate: dailyDateSchema.nullable().optional(),
      contentMarkdown: z.string().default(""),
      tags: z.array(z.string().trim().min(1)).default([]),
      sourceUrl: z.string().url().optional(),
      properties: z.record(z.string(), z.unknown()).nullable().optional(),
      pinned: z.boolean().default(false),
    },
  }),
  scaffold_document: defineToolDefinition({
    mcpName: "scaffold_document",
    description:
      "Create an article document immediately with a structured heading skeleton and inkade-pending placeholder blocks for progressive streaming authoring.",
    whenToUse:
      "Publish a visible outline skeleton with inkade-pending placeholders before writing long sections one by one with patch_document_section(targetPendingId).",
    requiredPermission: "write",
    actionCategory: "write",
    mutating: true,
    openWorldHint: false,
    inputShape: {
      spaceId: spaceIdSchema,
      title: z.string().trim().min(1).max(300),
      slug: z.string().trim().min(1).max(160).optional(),
      introMarkdown: z.string().optional(),
      tags: z.array(z.string().trim().min(1)).default([]),
      bindingId: threadBindingIdSchema.optional(),
      properties: z.record(z.string(), z.unknown()).nullable().optional(),
      pinned: z.boolean().default(false),
      sections: z.array(scaffoldSectionInputSchema).min(1).max(50),
    },
  }),
  patch_document_section: defineToolDefinition({
    mcpName: "patch_document_section",
    description:
      "Surgically replace an inkade-pending placeholder block (by targetPendingId) or patch a target heading section (by headingPath) without altering other sections.",
    whenToUse:
      "Fill a specific inkade-pending placeholder block via targetPendingId, or update a specific heading section cleanly without overwriting other sections.",
    requiredPermission: "write",
    actionCategory: "write",
    mutating: true,
    openWorldHint: false,
    inputShape: {
      documentId: documentIdSchema,
      headingPath: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]).optional(),
      targetPendingId: z.string().trim().min(1).max(120).optional(),
      mode: sectionPatchModeSchema.default("replace"),
      markdown: z.string(),
      createIfMissing: z.boolean().default(false),
      expectedVersion: z.number().int().positive().optional(),
      changeSummary: z.string().trim().max(500).nullable().optional(),
    },
  }),
  update_document: defineToolDefinition({
    mcpName: "update_document",
    description:
      "Update a document's metadata or full Markdown content with optional expectedVersion.",
    whenToUse:
      "Update document title, tags, metadata, or full Markdown body safely with optimistic locking.",
    requiredPermission: "write",
    actionCategory: "write",
    mutating: true,
    idempotentHint: true,
    openWorldHint: false,
    inputShape: {
      documentId: documentIdSchema,
      spaceId: spaceIdSchema.optional(),
      title: z.string().trim().min(1).max(300).optional(),
      slug: z.string().trim().min(1).max(160).optional(),
      contentMarkdown: z.string().optional(),
      tags: z.array(z.string().trim().min(1)).optional(),
      sourceUrl: z.string().url().nullable().optional(),
      properties: z.record(z.string(), z.unknown()).nullable().optional(),
      pinned: z.boolean().optional(),
      expectedVersion: z.number().int().positive().optional(),
      changeSummary: z.string().trim().max(500).nullable().optional(),
      syncBacklinks: z.boolean().optional(),
    },
  }),
  trash_document: defineToolDefinition({
    mcpName: "trash_document",
    description: "Move a document to trash (soft delete).",
    whenToUse: "Soft-delete an obsolete document without permanent destruction.",
    requiredPermission: "write",
    actionCategory: "remove",
    mutating: true,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
    inputShape: {
      documentId: documentIdSchema,
    },
  }),
  list_revisions: defineToolDefinition({
    mcpName: "list_revisions",
    description: "List saved Markdown revisions for a document.",
    whenToUse:
      "Inspect historical revisions of a document before computing diffs or reviewing edits.",
    requiredPermission: "read",
    actionCategory: "read",
    mutating: false,
    openWorldHint: false,
    inputShape: {
      documentId: documentIdSchema,
    },
  }),
  get_revision_diff: defineToolDefinition({
    mcpName: "get_revision_diff",
    description: "Compute line-level unified diff between two versions of a document.",
    whenToUse: "Review exact Markdown changes between two document versions.",
    requiredPermission: "read",
    actionCategory: "read",
    mutating: false,
    openWorldHint: false,
    inputShape: {
      documentId: documentIdSchema,
      fromVersion: z.number().int().positive(),
      toVersion: z.number().int().positive(),
    },
  }),
  get_daily_outline: defineToolDefinition({
    mcpName: "get_daily_outline",
    description:
      "Get or idempotently create a daily outline document and its nodes for YYYY-MM-DD (defaults to today).",
    whenToUse: "Inspect or append to today's or a specific date's Daily outline workspace.",
    requiredPermission: "read",
    actionCategory: "read",
    mutating: false,
    openWorldHint: false,
    inputShape: {
      date: dailyDateSchema.optional(),
    },
  }),
  append_outline_node: defineToolDefinition({
    mcpName: "append_outline_node",
    description: "Append a new node into an outline document without overwriting existing nodes.",
    whenToUse: "Add a bullet, checklist item, or note to an outline using fractional ordering.",
    requiredPermission: "append",
    actionCategory: "write",
    mutating: true,
    openWorldHint: false,
    inputShape: {
      documentId: documentIdSchema,
      parentNodeId: outlineNodeIdSchema.nullable().default(null),
      afterNodeId: outlineNodeIdSchema.nullable().optional(),
      beforeNodeId: outlineNodeIdSchema.nullable().optional(),
      contentMarkdown: z.string(),
      noteMarkdown: z.string().optional(),
      checked: z.boolean().nullable().default(null),
      collapsed: z.boolean().default(false),
      sourceBindingId: threadBindingIdSchema.nullable().optional(),
      priority: taskPrioritySchema.nullable().optional(),
      scheduledDate: dailyDateSchema.nullable().optional(),
      scheduledSlot: z.enum(TASK_SCHEDULE_SLOTS).nullable().optional(),
      scheduledStartMin: scheduledStartMinSchema.nullable().optional(),
      dueDate: dailyDateSchema.nullable().optional(),
      durationMin: z.number().int().min(1).max(1440).nullable().optional(),
      recurrenceRule: taskRecurrenceRuleSchema.nullable().optional(),
    },
  }),
  update_outline_node: defineToolDefinition({
    mcpName: "update_outline_node",
    description: "Update an outline node's content, note, checkbox state, or collapsed flag.",
    whenToUse:
      "Check off an outline task or edit a specific outline node without touching sibling nodes.",
    requiredPermission: "write",
    actionCategory: "write",
    mutating: true,
    idempotentHint: true,
    openWorldHint: false,
    inputShape: {
      nodeId: outlineNodeIdSchema,
      documentId: documentIdSchema.optional(),
      contentMarkdown: z.string().optional(),
      noteMarkdown: z.string().optional(),
      checked: z.boolean().nullable().optional(),
      collapsed: z.boolean().optional(),
      sourceBindingId: threadBindingIdSchema.nullable().optional(),
      priority: taskPrioritySchema.nullable().optional(),
      scheduledDate: dailyDateSchema.nullable().optional(),
      scheduledSlot: z.enum(TASK_SCHEDULE_SLOTS).nullable().optional(),
      scheduledStartMin: scheduledStartMinSchema.nullable().optional(),
      dueDate: dailyDateSchema.nullable().optional(),
      durationMin: z.number().int().min(1).max(1440).nullable().optional(),
      recurrenceRule: taskRecurrenceRuleSchema.nullable().optional(),
    },
  }),
  append_node_reply: defineToolDefinition({
    mcpName: "append_node_reply",
    description: "Append a child reply node under an existing outline node.",
    whenToUse:
      "Reply to a specific outline item or thread binding without modifying existing bullets.",
    requiredPermission: "append",
    actionCategory: "write",
    mutating: true,
    openWorldHint: false,
    inputShape: {
      documentId: documentIdSchema,
      parentNodeId: outlineNodeIdSchema,
      contentMarkdown: z.string(),
      noteMarkdown: z.string().optional(),
      checked: z.boolean().nullable().default(null),
      sourceBindingId: threadBindingIdSchema.nullable().optional(),
    },
  }),
  bind_thread: defineToolDefinition({
    mcpName: "bind_thread",
    description:
      "Bind an external ADE or agent thread to an outline node or document, including optional progress steps and approval requests.",
    whenToUse:
      "Register a thread binding, report progress steps, or request human approval in UI.",
    requiredPermission: "append",
    actionCategory: "write",
    mutating: true,
    idempotentHint: true,
    openWorldHint: false,
    inputShape: {
      documentId: documentIdSchema,
      nodeId: outlineNodeIdSchema.nullable().default(null),
      selectionAnchor: selectionAnchorSchema.nullable().optional(),
      adeKind: adeKindSchema.default("any"),
      externalWorkspaceId: z.string().min(1).nullable().optional(),
      externalThreadId: z.string().min(1),
      deepLink: z.string().min(1).nullable().optional(),
      title: z.string().trim().min(1).max(300),
      status: adeThreadStatusSchema.default("queued"),
      lastSummary: z.string().nullable().optional(),
      unreadResult: z.boolean().default(false),
      parentBindingId: threadBindingIdSchema.nullable().optional(),
      progressSteps: z.array(agentStepItemSchema).max(100).optional(),
      pendingApproval: agentPendingApprovalSchema.nullable().optional(),
      steeringQueue: z.array(agentSteeringNoteSchema).max(100).optional(),
    },
  }),
  update_thread_binding: defineToolDefinition({
    mcpName: "update_thread_binding",
    description:
      "Update the status, summary, unread flag, progress steps, or pending approval request of a bound ADE thread.",
    whenToUse:
      "Sync agent run completion, summary, steps, or approval requests back to Inkade.",
    requiredPermission: "append",
    actionCategory: "write",
    mutating: true,
    idempotentHint: true,
    openWorldHint: false,
    inputShape: {
      bindingId: threadBindingIdSchema,
      title: z.string().trim().min(1).max(300).optional(),
      status: adeThreadStatusSchema.optional(),
      deepLink: z.string().min(1).nullable().optional(),
      lastSummary: z.string().nullable().optional(),
      unreadResult: z.boolean().optional(),
      parentBindingId: threadBindingIdSchema.nullable().optional(),
      progressSteps: z.array(agentStepItemSchema).max(100).optional(),
      pendingApproval: agentPendingApprovalSchema.nullable().optional(),
      steeringQueue: z.array(agentSteeringNoteSchema).max(100).optional(),
    },
  }),
  list_bound_threads: defineToolDefinition({
    mcpName: "list_bound_threads",
    description: "List ADE thread bindings visible under the current token scope.",
    whenToUse:
      "Check queued/pending tasks dispatched from Inkade or existing bindings on a doc.",
    requiredPermission: "read",
    actionCategory: "read",
    mutating: false,
    openWorldHint: false,
    inputShape: {
      documentId: documentIdSchema.optional(),
      nodeId: outlineNodeIdSchema.optional(),
      status: adeThreadStatusSchema.optional(),
    },
  }),
  claim_thread_binding: defineToolDefinition({
    mcpName: "claim_thread_binding",
    description:
      "Atomically claim a queued thread binding (thr_pending_*) for a host slug and external thread ID.",
    whenToUse:
      "Claim a queued Inkade task binding and associate it with the running agent session ID.",
    requiredPermission: "append",
    actionCategory: "write",
    mutating: true,
    idempotentHint: true,
    openWorldHint: false,
    inputShape: {
      bindingId: threadBindingIdSchema,
      adeKind: adeKindSchema.optional(),
      externalThreadId: z.string().min(1),
      externalWorkspaceId: z.string().min(1).nullable().optional(),
      deepLink: z.string().min(1).nullable().optional(),
      status: adeThreadStatusSchema.optional(),
      lastSummary: z.string().nullable().optional(),
    },
  }),
  get_thread_binding: defineToolDefinition({
    mcpName: "get_thread_binding",
    description:
      "Fetch a bound thread's latest approval decision and steering queue notes, optionally marking steering notes delivered.",
    whenToUse:
      "Poll human approval decisions or queued steering messages for an active thread binding.",
    requiredPermission: "read",
    actionCategory: "read",
    mutating: false,
    openWorldHint: false,
    inputShape: {
      bindingId: threadBindingIdSchema,
      consumeSteering: z.boolean().optional(),
    },
  }),
  create_upload_url: defineToolDefinition({
    mcpName: "create_upload_url",
    description: "Validate upload permissions and return attachment upload endpoint metadata.",
    whenToUse:
      "Obtain upload endpoint instructions before attaching a binary or image to a document.",
    requiredPermission: "read",
    actionCategory: "read",
    mutating: false,
    openWorldHint: false,
    inputShape: {
      documentId: documentIdSchema.nullable().optional(),
      filename: z.string().trim().min(1).max(255),
      mimeType: z.string().trim().min(1).max(160).optional(),
    },
  }),
  clip_url: defineToolDefinition({
    mcpName: "clip_url",
    description:
      "Fetch and clean a public web URL into a Markdown clip document with optional image mirroring and HTML snapshot.",
    whenToUse: "Save a web article URL cleanly into Inkade with extracted Markdown.",
    requiredPermission: "write",
    actionCategory: "write",
    mutating: true,
    openWorldHint: true,
    inputShape: {
      url: z.string().url(),
      spaceId: spaceIdSchema.optional(),
      tags: z.array(z.string().trim().min(1)).default([]),
      title: z.string().trim().min(1).max(300).optional(),
      mirrorImages: z.boolean().default(true),
      saveHtmlSnapshot: z.boolean().default(true),
    },
  }),
  batch_mutate_outline: defineToolDefinition({
    mcpName: "batch_mutate_outline",
    description:
      "Atomically apply a batch of create (with tempId resolution), update, move, and delete operations on an outline document.",
    whenToUse: "Create or reorganize multiple outline nodes atomically in one transaction.",
    requiredPermission: "write",
    actionCategory: "write",
    mutating: true,
    openWorldHint: false,
    inputShape: {
      documentId: documentIdSchema.optional(),
      operations: z.array(outlineBatchOperationSchema).min(1).max(500),
    },
  }),
  list_tasks: defineToolDefinition({
    mcpName: "list_tasks",
    description:
      "List scoped checklist tasks across outline nodes and article/clip Markdown documents with parent document and thread binding info.",
    whenToUse: "Review open or completed tasks across authorized documents.",
    requiredPermission: "read",
    actionCategory: "read",
    mutating: false,
    openWorldHint: false,
    inputShape: {
      status: z.enum(["open", "completed", "all"]).default("all"),
      sourceEngine: taskSourceEngineSchema.optional(),
      spaceId: spaceIdSchema.optional(),
      tag: z.string().min(1).optional(),
      priority: taskPrioritySchema.optional(),
      bucket: taskBucketSchema.optional(),
      scheduledDate: dailyDateSchema.optional(),
      dueDate: dailyDateSchema.optional(),
      includeAnytime: z.boolean().default(true),
      limit: z.number().int().min(1).max(500).default(200),
      offset: z.number().int().min(0).default(0),
    },
  }),
  reschedule_task: defineToolDefinition({
    mcpName: "reschedule_task",
    description:
      "Non-destructively reschedule an outline or markdown task to a target YYYY-MM-DD date, time minute, or null (Anytime) while preserving its identity and bindings.",
    whenToUse:
      "Reschedule a task or move it between scheduled time slots and the Anytime pool.",
    requiredPermission: "write",
    actionCategory: "write",
    mutating: true,
    idempotentHint: true,
    openWorldHint: false,
    inputShape: {
      nodeId: taskTargetIdSchema,
      scheduledDate: dailyDateSchema.nullable(),
      scheduledSlot: z.enum(TASK_SCHEDULE_SLOTS).nullable().optional(),
      scheduledStartMin: scheduledStartMinSchema.nullable().optional(),
      durationMin: z.number().int().min(1).max(1440).nullable().optional(),
    },
  }),
  upsert_task: defineToolDefinition({
    mcpName: "upsert_task",
    description:
      "Create a new task or update an existing task across Outline nodes and Markdown article/clip checklists, preserving non-task document lines and supporting Schedule + Deadline fields.",
    whenToUse:
      "Create or modify a workspace task with title, completion status, schedule time, deadline, priority, or recurrence rule.",
    requiredPermission: "write",
    actionCategory: "write",
    mutating: true,
    idempotentHint: true,
    openWorldHint: false,
    inputShape: {
      taskId: taskTargetIdSchema.optional(),
      documentId: documentIdSchema.optional(),
      spaceId: spaceIdSchema.optional(),
      title: z.string().trim().min(1).max(4000).optional(),
      noteMarkdown: z.string().max(20000).optional(),
      checked: z.boolean().optional(),
      priority: taskPrioritySchema.nullable().optional(),
      scheduledDate: dailyDateSchema.nullable().optional(),
      scheduledStartMin: scheduledStartMinSchema.nullable().optional(),
      scheduledSlot: z.enum(TASK_SCHEDULE_SLOTS).nullable().optional(),
      dueDate: dailyDateSchema.nullable().optional(),
      durationMin: z.number().int().min(1).max(1440).nullable().optional(),
      recurrenceRule: taskRecurrenceRuleSchema.nullable().optional(),
    },
  }),
  list_highlights: defineToolDefinition({
    mcpName: "list_highlights",
    description:
      "List persistent W3C-anchored highlights and marginalia for an authorized document.",
    whenToUse:
      "Read user web or document highlights and marginalia before summarizing or cross-checking.",
    requiredPermission: "read",
    actionCategory: "read",
    mutating: false,
    openWorldHint: false,
    inputShape: {
      documentId: documentIdSchema,
    },
  }),
  create_highlight: defineToolDefinition({
    mcpName: "create_highlight",
    description:
      "Create a persistent semantic highlight and optional note on an authorized document.",
    whenToUse:
      "Annotate an important quote inside a clip or article with a persistent highlight and note.",
    requiredPermission: "append",
    actionCategory: "write",
    mutating: true,
    openWorldHint: false,
    inputShape: {
      documentId: documentIdSchema,
      quote: z.string().min(1).max(4000),
      prefixContext: z.string().max(1000).default(""),
      suffixContext: z.string().max(1000).default(""),
      color: highlightColorSchema.default("amber"),
      noteMarkdown: z.string().max(10000).default(""),
      bindingId: threadBindingIdSchema.nullable().optional(),
    },
  }),
  list_templates: defineToolDefinition({
    mcpName: "list_templates",
    description: "List available document templates in the workspace.",
    whenToUse: "Check reusable document or daily outline templates before creating structured docs.",
    requiredPermission: "read",
    actionCategory: "read",
    mutating: false,
    openWorldHint: false,
    inputShape: {
      kind: documentKindSchema.optional(),
    },
  }),
  create_from_template: defineToolDefinition({
    mcpName: "create_from_template",
    description: "Create a new document or populate a daily outline from a saved template.",
    whenToUse: "Instantiate a standardized article or daily template cleanly.",
    requiredPermission: "write",
    actionCategory: "write",
    mutating: true,
    openWorldHint: false,
    inputShape: {
      templateId: templateIdSchema,
      spaceId: spaceIdSchema.optional(),
      title: z.string().trim().min(1).max(300).optional(),
      dailyDate: dailyDateSchema.optional(),
      tags: z.array(z.string().trim().min(1)).optional(),
      variables: z.record(z.string(), z.string()).optional(),
    },
  }),
  get_audit_logs: defineToolDefinition({
    mcpName: "get_audit_logs",
    description: "Inspect token and agent audit log entries (requires admin scope).",
    whenToUse: "Audit token activity, denied accesses, or reversible agent mutation history.",
    requiredPermission: "admin",
    actionCategory: "governance",
    mutating: false,
    openWorldHint: false,
    inputShape: {
      tokenId: apiTokenIdSchema.optional(),
      decision: auditDecisionSchema.optional(),
      transport: auditTransportSchema.optional(),
      action: z.string().min(1).optional(),
      limit: z.number().int().min(1).max(500).default(100),
      offset: z.number().int().min(0).default(0),
    },
  }),
  semantic_search: defineToolDefinition({
    mcpName: "semantic_search",
    description:
      "Hybrid semantic + BM25 RRF search across authorized documents, supporting hybrid, semantic, and keyword modes.",
    whenToUse:
      "Search conceptually across personal notes when exact keywords might miss relevant docs.",
    requiredPermission: "read",
    actionCategory: "read",
    mutating: false,
    openWorldHint: false,
    inputShape: {
      q: z.string().trim().min(1).max(500),
      spaceId: spaceIdSchema.optional(),
      kind: documentKindSchema.optional(),
      tag: z.string().min(1).optional(),
      limit: z.number().int().min(1).max(100).default(20),
      mode: semanticSearchModeSchema.default("hybrid"),
    },
  }),
  request_human_decision: defineToolDefinition({
    mcpName: "request_human_decision",
    description:
      "Raise a structured blocking question for the human in the Inbox Exceptions queue when an irreversible ambiguity cannot be resolved autonomously.",
    whenToUse:
      "Use sparingly only when truly blocked on an ambiguous human decision; normal edits should run quietly under token scope and rely on batch rollback.",
    requiredPermission: "append",
    actionCategory: "write",
    mutating: true,
    openWorldHint: false,
    inputShape: {
      documentId: documentIdSchema.optional(),
      bindingId: threadBindingIdSchema.optional(),
      nodeId: outlineNodeIdSchema.optional(),
      question: z.string().trim().min(1).max(1000),
      context: z.string().trim().max(4000).optional(),
      options: z.array(z.string().trim().min(1).max(200)).min(1).max(8).optional(),
      urgency: humanDecisionUrgencySchema.default("normal"),
    },
  }),
  get_space_schema: defineToolDefinition({
    mcpName: "get_space_schema",
    description:
      "Read the structured property field schema defined for an authorized Space (or Template).",
    whenToUse:
      "Inspect a Space's typed property fields, select options, and requiredByAgent hints before creating or updating structured documents.",
    requiredPermission: "read",
    actionCategory: "read",
    mutating: false,
    openWorldHint: false,
    inputShape: {
      spaceId: spaceIdSchema,
      templateId: templateIdSchema.optional(),
    },
  }),
  upsert_space_schema: defineToolDefinition({
    mcpName: "upsert_space_schema",
    description:
      "Create or replace the structured property field schema for an authorized Space (or Template).",
    whenToUse:
      "Define or update typed properties (text, number, select, multi_select, date, checkbox, url, relation_doc) for a Space.",
    requiredPermission: "write",
    actionCategory: "write",
    mutating: true,
    idempotentHint: true,
    openWorldHint: false,
    inputShape: {
      spaceId: spaceIdSchema,
      templateId: templateIdSchema.nullable().optional(),
      fields: spacePropertySchemaFieldsArraySchema,
    },
  }),
  list_context_packs: defineToolDefinition({
    mcpName: "list_context_packs",
    description:
      "List configured Context Packs (inkade://pack/{slug}) available in the workspace along with their rules and token budgets.",
    whenToUse:
      "Discover curated project context packs before calling read_context_pack or reading inkade://pack/{slug}.",
    requiredPermission: "read",
    actionCategory: "read",
    mutating: false,
    openWorldHint: false,
    inputShape: {},
  }),
  read_context_pack: defineToolDefinition({
    mcpName: "read_context_pack",
    description:
      "Assemble and read a Context Pack by slug, strictly filtered by the caller's TokenScope and bounded to maxTokens using BPE token counting.",
    whenToUse:
      "Pull high-signal workspace context (pinned docs + recent matching docs) in one call within token budget.",
    requiredPermission: "read",
    actionCategory: "read",
    mutating: false,
    openWorldHint: false,
    inputShape: {
      slug: z.string().trim().min(1).max(120),
      maxTokens: z.number().int().min(500).max(200000).optional(),
    },
  }),
  poll_wake_events: defineToolDefinition({
    mcpName: "poll_wake_events",
    description:
      "Poll or long-poll pending wake events targeted at the current agent session, thread binding, or document.",
    whenToUse:
      "Retrieve pending steering notes, approval decisions, comment wakes, or unowned requests when hooks or watch are unavailable.",
    requiredPermission: "read",
    actionCategory: "read",
    mutating: false,
    idempotentHint: false,
    openWorldHint: false,
    inputShape: {
      adeKind: adeKindSchema.optional(),
      externalThreadId: z.string().trim().min(1).max(300).optional(),
      workspacePath: z.string().trim().min(1).max(1000).optional(),
      bindingId: threadBindingIdSchema.optional(),
      documentId: documentIdSchema.optional(),
      limit: z.number().int().min(1).max(50).optional(),
      timeoutMs: z.number().int().min(0).max(30000).optional(),
      markDelivered: z.boolean().optional(),
    },
  }),
  list_comment_threads: defineToolDefinition({
    mcpName: "list_comment_threads",
    description:
      "List interactive highlight comment threads on a document with open/resolved status and chronological replies.",
    whenToUse:
      "Inspect human and agent feedback threads anchored to quotes in a document before replying or resolving.",
    requiredPermission: "read",
    actionCategory: "read",
    mutating: false,
    openWorldHint: false,
    inputShape: {
      documentId: documentIdSchema,
      status: z.enum(["open", "resolved", "all"]).default("all"),
    },
  }),
  reply_comment_thread: defineToolDefinition({
    mcpName: "reply_comment_thread",
    description:
      "Append an agent reply to a highlight comment thread, optionally marking the thread resolved.",
    whenToUse:
      "Respond to a human marginalia comment thread on a document highlight and optionally resolve it once addressed.",
    requiredPermission: "append",
    actionCategory: "write",
    mutating: true,
    openWorldHint: false,
    inputShape: {
      highlightId: highlightIdSchema,
      bodyMarkdown: z.string().trim().min(1).max(10000),
      resolve: z.boolean().optional(),
    },
  }),
  get_viewer_context: defineToolDefinition({
    mcpName: "get_viewer_context",
    description:
      "Read the human's live reading focus (document, heading, node, or selected quote) when view sharing is enabled and within TokenScope.",
    whenToUse:
      "Check what document and section the user is actively viewing right now; returns out_of_scope if outside your TokenScope.",
    requiredPermission: "read",
    actionCategory: "read",
    mutating: false,
    openWorldHint: false,
    inputShape: {},
  }),
  create_document_artifact: defineToolDefinition({
    mcpName: "create_document_artifact",
    description:
      "Create a sandboxed interactive HTML inkade-artifact block attached to a document, with explicit capabilities, data sources, and fallbackMarkdown.",
    whenToUse:
      "Deliver an interactive calculator, chart, or visual widget embedded inside an article after authoring clean single-file HTML and a static fallbackMarkdown representation.",
    requiredPermission: "write",
    actionCategory: "write",
    mutating: true,
    openWorldHint: false,
    inputShape: {
      documentId: documentIdSchema,
      ...createDocumentArtifactInputSchema.shape,
    },
  }),
  update_document_artifact: defineToolDefinition({
    mcpName: "update_document_artifact",
    description:
      "Update an existing interactive document artifact's HTML source, capabilities, sources, height, or fallbackMarkdown using optimistic locking (ifMatchSha256).",
    whenToUse:
      "Modify an existing inkade-artifact block safely; always supply the latest sha256 in ifMatchSha256 to avoid overwriting concurrent edits.",
    requiredPermission: "write",
    actionCategory: "write",
    mutating: true,
    idempotentHint: true,
    openWorldHint: false,
    inputShape: {
      artifactId: documentArtifactIdSchema,
      ifMatchSha256: z.string().trim().min(1),
      title: updateDocumentArtifactInputSchema.shape.title,
      htmlSource: updateDocumentArtifactInputSchema.shape.htmlSource,
      capabilities: updateDocumentArtifactInputSchema.shape.capabilities,
      sources: updateDocumentArtifactInputSchema.shape.sources,
      fallbackMarkdown: updateDocumentArtifactInputSchema.shape.fallbackMarkdown,
      heightPx: updateDocumentArtifactInputSchema.shape.heightPx,
    },
  }),
  validate_document_artifact: defineToolDefinition({
    mcpName: "validate_document_artifact",
    description:
      "Validate single-file artifact HTML against Inkade's 512 KiB size cap, CSP rules, <title> requirement, and declared capabilities.",
    whenToUse:
      "Pre-flight check artifact HTML before calling create_document_artifact or update_document_artifact.",
    requiredPermission: "read",
    actionCategory: "read",
    mutating: false,
    openWorldHint: false,
    inputShape: validateDocumentArtifactInputSchema.shape,
  }),
} as const;

export type InkadeMcpToolName = keyof typeof INKADE_TOOL_DEFINITIONS_BY_NAME;

export const INKADE_TOOL_DEFINITIONS = Object.values(INKADE_TOOL_DEFINITIONS_BY_NAME) as readonly (
  typeof INKADE_TOOL_DEFINITIONS_BY_NAME[InkadeMcpToolName]
)[];

export const INKADE_MCP_TOOL_NAMES = Object.keys(
  INKADE_TOOL_DEFINITIONS_BY_NAME,
) as readonly InkadeMcpToolName[];

export type InkadeToolArgsMap = {
  readonly [K in InkadeMcpToolName]: z.infer<
    (typeof INKADE_TOOL_DEFINITIONS_BY_NAME)[K]["inputSchema"]
  >;
};

export interface ScopeFilterableTool {
  readonly requiredPermission: TokenPermission;
}

/**
 * Filters tool definitions or specs permitted for the given token scope's permission level.
 */
export function filterToolSpecsByScope<T extends ScopeFilterableTool>(
  scope: Pick<TokenScope, "permission">,
  tools: readonly T[],
): readonly T[] {
  const rank = PERMISSION_RANK[scope.permission];
  return tools.filter((tool) => PERMISSION_RANK[tool.requiredPermission] <= rank);
}
