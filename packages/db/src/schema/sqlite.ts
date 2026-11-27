import { sql } from "drizzle-orm";
import {
  blob,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  ownerUserId: text("owner_user_id").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const spaces = sqliteTable(
  "spaces",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    parentId: text("parent_id"),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    icon: text("icon"),
    color: text("color"),
    defaultKind: text("default_kind"),
    sortOrder: integer("sort_order").notNull().default(0),
    archivedAt: text("archived_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_spaces_workspace_slug").on(table.workspaceId, table.slug),
    index("idx_spaces_workspace_parent").on(table.workspaceId, table.parentId),
  ],
);

export const documents = sqliteTable(
  "documents",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    spaceId: text("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    dailyDate: text("daily_date"),
    contentMarkdown: text("content_markdown").notNull().default(""),
    contentJson: text("content_json"),
    contentText: text("content_text").notNull().default(""),
    excerpt: text("excerpt").notNull().default(""),
    sourceUrl: text("source_url"),
    sourceMetaJson: text("source_meta_json"),
    propertiesJson: text("properties_json"),
    version: integer("version").notNull().default(1),
    pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
    unreadAgentUpdate: integer("unread_agent_update", { mode: "boolean" })
      .notNull()
      .default(false),
    lastEditedByType: text("last_edited_by_type").notNull().default("human"),
    trashedAt: text("trashed_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_documents_workspace_space").on(table.workspaceId, table.spaceId, table.trashedAt),
    index("idx_documents_workspace_kind").on(table.workspaceId, table.kind, table.updatedAt),
    index("idx_documents_workspace_slug").on(table.workspaceId, table.slug),
    uniqueIndex("idx_documents_workspace_daily_date")
      .on(table.workspaceId, table.dailyDate)
      .where(sql`daily_date IS NOT NULL AND trashed_at IS NULL`),
  ],
);

export const outlineNodes = sqliteTable(
  "outline_nodes",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    parentNodeId: text("parent_node_id"),
    orderKey: text("order_key").notNull(),
    contentMarkdown: text("content_markdown").notNull().default(""),
    contentText: text("content_text").notNull().default(""),
    noteMarkdown: text("note_markdown").notNull().default(""),
    noteText: text("note_text").notNull().default(""),
    checked: integer("checked", { mode: "boolean" }),
    collapsed: integer("collapsed", { mode: "boolean" }).notNull().default(false),
    authorType: text("author_type").notNull().default("human"),
    authorId: text("author_id"),
    sourceBindingId: text("source_binding_id"),
    mirrorOfNodeId: text("mirror_of_node_id"),
    rolledOverToDocId: text("rolled_over_to_doc_id"),
    taskPriority: text("task_priority"),
    taskScheduledDate: text("task_scheduled_date"),
    taskScheduledSlot: text("task_scheduled_slot"),
    taskScheduledStartMin: integer("task_scheduled_start_min"),
    taskDueDate: text("task_due_date"),
    taskDurationMin: integer("task_duration_min"),
    taskRecurrenceRule: text("task_recurrence_rule"),
    taskCompletedAt: text("task_completed_at"),
    taskSpawnedNextNodeId: text("task_spawned_next_node_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    index("idx_outline_nodes_doc_order").on(table.documentId, table.deletedAt, table.orderKey),
    index("idx_outline_nodes_parent").on(table.documentId, table.parentNodeId),
    index("idx_outline_nodes_mirror").on(table.mirrorOfNodeId),
    index("idx_outline_nodes_rollover").on(table.rolledOverToDocId),
    index("idx_outline_nodes_task_sched").on(table.deletedAt, table.checked, table.taskScheduledDate),
  ],
);

export const documentRevisions = sqliteTable(
  "document_revisions",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    contentMarkdown: text("content_markdown").notNull(),
    outlineSnapshotJson: text("outline_snapshot_json"),
    changeSummary: text("change_summary"),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id"),
    batchId: text("batch_id"),
    executionMode: text("execution_mode").notNull().default("autonomous"),
    reversedByAuditId: text("reversed_by_audit_id"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_document_revisions_doc_ver").on(table.documentId, table.version),
    index("idx_document_revisions_batch").on(table.batchId),
  ],
);

export const documentTags = sqliteTable(
  "document_tags",
  {
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    tag: text("tag").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.documentId, table.tag] }),
    index("idx_document_tags_tag").on(table.tag),
  ],
);

export const documentLinks = sqliteTable(
  "document_links",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    sourceDocumentId: text("source_document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    sourceNodeId: text("source_node_id").references(() => outlineNodes.id, {
      onDelete: "cascade",
    }),
    targetDocumentId: text("target_document_id").references(() => documents.id, {
      onDelete: "set null",
    }),
    targetSlugOrTitle: text("target_slug_or_title").notNull(),
    anchorText: text("anchor_text"),
    contextSnippet: text("context_snippet").notNull().default(""),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_document_links_target_doc").on(table.workspaceId, table.targetDocumentId),
    index("idx_document_links_target_name").on(table.workspaceId, table.targetSlugOrTitle),
    index("idx_document_links_source").on(table.sourceDocumentId, table.sourceNodeId),
  ],
);

export const adeThreadBindings = sqliteTable(
  "ade_thread_bindings",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    nodeId: text("node_id").references(() => outlineNodes.id, { onDelete: "set null" }),
    selectionAnchorJson: text("selection_anchor_json"),
    adeKind: text("ade_kind").notNull(),
    externalWorkspaceId: text("external_workspace_id"),
    externalThreadId: text("external_thread_id").notNull(),
    deepLink: text("deep_link"),
    title: text("title").notNull(),
    status: text("status").notNull().default("queued"),
    lastSummary: text("last_summary"),
    unreadResult: integer("unread_result", { mode: "boolean" }).notNull().default(false),
    lastSyncedAt: text("last_synced_at").notNull(),
    createdAt: text("created_at").notNull(),
    runningSince: text("running_since"),
    parentBindingId: text("parent_binding_id"),
    progressStepsJson: text("progress_steps_json"),
    pendingApprovalJson: text("pending_approval_json"),
    steeringQueueJson: text("steering_queue_json"),
  },
  (table) => [
    index("idx_ade_bindings_doc").on(table.workspaceId, table.documentId),
    index("idx_ade_bindings_status").on(table.workspaceId, table.status),
    uniqueIndex("idx_ade_bindings_external").on(
      table.workspaceId,
      table.adeKind,
      table.externalThreadId,
    ),
  ],
);

export const apiTokens = sqliteTable(
  "api_tokens",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    tokenPrefix: text("token_prefix").notNull(),
    scopeJson: text("scope_json").notNull(),
    expiresAt: text("expires_at"),
    revokedAt: text("revoked_at"),
    lastUsedAt: text("last_used_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("idx_api_tokens_workspace").on(table.workspaceId)],
);

export const projectScopeRules = sqliteTable(
  "project_scope_rules",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    matchType: text("match_type").notNull(),
    pattern: text("pattern").notNull(),
    writableSpaceIdsJson: text("writable_space_ids_json").notNull(),
    readonlySpaceIdsJson: text("readonly_space_ids_json").notNull(),
    defaultInboxSpaceId: text("default_inbox_space_id"),
    defaultResearchSpaceId: text("default_research_space_id"),
    extraInstructions: text("extra_instructions"),
    priority: integer("priority").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("idx_project_scope_rules_workspace").on(table.workspaceId, table.priority)],
);

export const attachments = sqliteTable(
  "attachments",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    documentId: text("document_id").references(() => documents.id, {
      onDelete: "set null",
    }),
    mimeType: text("mime_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    sha256: text("sha256").notNull(),
    storageKey: text("storage_key").notNull(),
    filename: text("filename").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("idx_attachments_workspace_doc").on(table.workspaceId, table.documentId)],
);

export const documentHighlights = sqliteTable(
  "document_highlights",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    quote: text("quote").notNull(),
    prefixContext: text("prefix_context").notNull().default(""),
    suffixContext: text("suffix_context").notNull().default(""),
    color: text("color").notNull().default("amber"),
    noteMarkdown: text("note_markdown").notNull().default(""),
    bindingId: text("binding_id").references(() => adeThreadBindings.id, {
      onDelete: "set null",
    }),
    status: text("status").notNull().default("open"),
    resolvedAt: text("resolved_at"),
    resolvedByType: text("resolved_by_type"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_document_highlights_doc").on(table.workspaceId, table.documentId),
    index("idx_document_highlights_doc_status").on(
      table.workspaceId,
      table.documentId,
      table.status,
    ),
  ],
);

export const highlightComments = sqliteTable(
  "highlight_comments",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    highlightId: text("highlight_id")
      .notNull()
      .references(() => documentHighlights.id, { onDelete: "cascade" }),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    authorType: text("author_type").notNull(),
    authorId: text("author_id"),
    authorName: text("author_name").notNull(),
    bodyMarkdown: text("body_markdown").notNull(),
    sentToAgentAt: text("sent_to_agent_at"),
    wakeEventId: text("wake_event_id").references(() => threadWakeEvents.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_highlight_comments_highlight").on(
      table.workspaceId,
      table.highlightId,
      table.createdAt,
    ),
    index("idx_highlight_comments_doc").on(
      table.workspaceId,
      table.documentId,
      table.createdAt,
    ),
  ],
);

export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    principalKind: text("principal_kind").notNull(),
    tokenId: text("token_id"),
    tokenName: text("token_name"),
    transport: text("transport").notNull(),
    action: text("action").notNull(),
    resource: text("resource").notNull(),
    spaceId: text("space_id"),
    documentId: text("document_id"),
    decision: text("decision").notNull(),
    reason: text("reason"),
    summary: text("summary"),
    createdAt: text("created_at").notNull(),
    beforeRevisionId: text("before_revision_id"),
    afterRevisionId: text("after_revision_id"),
    diffPreviewJson: text("diff_preview_json"),
    reversible: integer("reversible", { mode: "boolean" }).notNull().default(false),
    irreversibleReason: text("irreversible_reason"),
    batchId: text("batch_id"),
    executionMode: text("execution_mode").notNull().default("autonomous"),
    reversedByAuditId: text("reversed_by_audit_id"),
  },
  (table) => [
    index("idx_audit_logs_workspace_created").on(table.workspaceId, table.createdAt),
    index("idx_audit_logs_token").on(table.workspaceId, table.tokenId),
    index("idx_audit_logs_document").on(table.workspaceId, table.documentId, table.createdAt),
    index("idx_audit_logs_workspace_batch").on(table.workspaceId, table.batchId, table.createdAt),
  ],
);

export const documentTemplates = sqliteTable(
  "document_templates",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    description: text("description").notNull().default(""),
    contentMarkdown: text("content_markdown").notNull().default(""),
    isDefaultDaily: integer("is_default_daily", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("idx_document_templates_workspace").on(table.workspaceId, table.kind)],
);

export const shareLinks = sqliteTable(
  "share_links",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: text("expires_at"),
    revokedAt: text("revoked_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_share_links_doc").on(table.workspaceId, table.documentId),
    uniqueIndex("idx_share_links_token").on(table.token),
  ],
);

export const savedViews = sqliteTable(
  "saved_views",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    icon: text("icon"),
    color: text("color"),
    filterJson: text("filter_json").notNull(),
    displayMode: text("display_mode").notNull().default("grid"),
    groupByField: text("group_by_field"),
    visibleColumnsJson: text("visible_columns_json"),
    columnWidthsJson: text("column_widths_json"),
    sortRulesJson: text("sort_rules_json"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("idx_saved_views_workspace").on(table.workspaceId, table.sortOrder)],
);

export const spacePropertySchemas = sqliteTable(
  "space_property_schemas",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    spaceId: text("space_id").references(() => spaces.id, { onDelete: "cascade" }),
    templateId: text("template_id").references(() => documentTemplates.id, {
      onDelete: "cascade",
    }),
    fieldsJson: text("fields_json").notNull().default("[]"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_space_property_schemas_space")
      .on(table.workspaceId, table.spaceId)
      .where(sql`space_id IS NOT NULL`),
    uniqueIndex("idx_space_property_schemas_template")
      .on(table.workspaceId, table.templateId)
      .where(sql`template_id IS NOT NULL`),
  ],
);

export const documentEmbeddings = sqliteTable(
  "document_embeddings",
  {
    documentId: text("document_id")
      .primaryKey()
      .references(() => documents.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    model: text("model").notNull(),
    dimensions: integer("dimensions").notNull(),
    vectorJson: text("vector_json").notNull(),
    contentHash: text("content_hash").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("idx_document_embeddings_workspace").on(table.workspaceId, table.model)],
);

export const documentYjsStates = sqliteTable(
  "document_yjs_states",
  {
    documentId: text("document_id")
      .primaryKey()
      .references(() => documents.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    stateBase64: text("state_base64").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("idx_document_yjs_states_workspace").on(table.workspaceId)],
);

export const aiSettings = sqliteTable("ai_settings", {
  workspaceId: text("workspace_id")
    .primaryKey()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  provider: text("provider").notNull().default("openai"),
  baseUrl: text("base_url").notNull().default("https://api.openai.com/v1"),
  model: text("model").notNull().default("gpt-4o-mini"),
  apiKey: text("api_key").notNull().default(""),
  temperature: real("temperature").notNull().default(0.3),
  embeddingProvider: text("embedding_provider").notNull().default("local"),
  embeddingBaseUrl: text("embedding_base_url").notNull().default(""),
  embeddingModel: text("embedding_model").notNull().default("local-ngram-128"),
  embeddingApiKey: text("embedding_api_key").notNull().default(""),
  updatedAt: text("updated_at").notNull(),
});

export const userPreferences = sqliteTable(
  "user_preferences",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    principalKey: text("principal_key").notNull(),
    prefsJson: text("prefs_json").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.principalKey] })],
);

export const documentTasks = sqliteTable(
  "document_tasks",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    sourceEngine: text("source_engine").notNull(),
    docId: text("doc_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    blockKey: text("block_key").notNull(),
    lineIndex: integer("line_index"),
    title: text("title").notNull(),
    completed: integer("completed", { mode: "boolean" }).notNull().default(false),
    priority: text("priority"),
    scheduledDate: text("scheduled_date"),
    scheduledStartMin: integer("scheduled_start_min"),
    durationMin: integer("duration_min"),
    dueDate: text("due_date"),
    recurrenceRule: text("recurrence_rule"),
    spaceId: text("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    tagsJson: text("tags_json").notNull().default("[]"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_document_tasks_workspace_scheduled").on(
      table.workspaceId,
      table.scheduledDate,
      table.scheduledStartMin,
    ),
    index("idx_document_tasks_workspace_due").on(table.workspaceId, table.dueDate),
    index("idx_document_tasks_workspace_completed").on(table.workspaceId, table.completed),
    index("idx_document_tasks_doc_block").on(table.docId, table.blockKey),
    index("idx_document_tasks_workspace_space").on(table.workspaceId, table.spaceId),
  ],
);

export const calendarSubscriptions = sqliteTable(
  "calendar_subscriptions",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    url: text("url").notNull(),
    color: text("color").notNull().default("#3b82f6"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    etag: text("etag"),
    lastModified: text("last_modified"),
    lastSyncedAt: text("last_synced_at"),
    lastError: text("last_error"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("idx_calendar_subscriptions_workspace").on(table.workspaceId, table.enabled)],
);

export const calendarEventsCache = sqliteTable(
  "calendar_events_cache",
  {
    id: text("id").primaryKey(),
    subscriptionId: text("subscription_id")
      .notNull()
      .references(() => calendarSubscriptions.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    uid: text("uid").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    location: text("location"),
    startAt: text("start_at").notNull(),
    endAt: text("end_at").notNull(),
    allDay: integer("all_day", { mode: "boolean" }).notNull().default(false),
    timezone: text("timezone"),
    rrule: text("rrule"),
    exdatesJson: text("exdates_json").notNull().default("[]"),
    rawSummaryJson: text("raw_summary_json").notNull().default("{}"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_calendar_events_cache_sub_uid").on(table.subscriptionId, table.uid),
    index("idx_calendar_events_cache_workspace_range").on(
      table.workspaceId,
      table.startAt,
      table.endAt,
    ),
  ],
);

export const documentChunks = sqliteTable(
  "document_chunks",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    docId: text("doc_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    headingPath: text("heading_path"),
    nodeId: text("node_id"),
    tokenCount: integer("token_count").notNull(),
    snippet: text("snippet").notNull().default(""),
    contentText: text("content_text").notNull(),
    contentHash: text("content_hash").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_document_chunks_workspace_doc").on(table.workspaceId, table.docId),
    uniqueIndex("idx_document_chunks_doc_idx").on(table.docId, table.chunkIndex),
  ],
);

export const chunkEmbeddings = sqliteTable(
  "chunk_embeddings",
  {
    chunkId: text("chunk_id")
      .notNull()
      .references(() => documentChunks.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    modelKey: text("model_key").notNull(),
    dimensions: integer("dimensions").notNull(),
    vectorBlob: blob("vector_blob", { mode: "buffer" }).notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.chunkId, table.modelKey] }),
    index("idx_chunk_embeddings_workspace_model").on(table.workspaceId, table.modelKey),
  ],
);

export const contextPacks = sqliteTable(
  "context_packs",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    rulesJson: text("rules_json").notNull().default("{}"),
    maxTokens: integer("max_tokens").notNull().default(12000),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_context_packs_workspace_slug").on(table.workspaceId, table.slug),
    index("idx_context_packs_workspace_updated").on(table.workspaceId, table.updatedAt),
  ],
);

export const documentAssets = sqliteTable(
  "document_assets",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    attachmentId: text("attachment_id")
      .notNull()
      .references(() => attachments.id, { onDelete: "cascade" }),
    companionDocumentId: text("companion_document_id").references(() => documents.id, {
      onDelete: "set null",
    }),
    assetKind: text("asset_kind").notNull(),
    pageCount: integer("page_count").notNull().default(0),
    annotationsJson: text("annotations_json").notNull().default("[]"),
    extractedPagesJson: text("extracted_pages_json").notNull().default("[]"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_document_assets_workspace_doc").on(table.workspaceId, table.companionDocumentId),
    index("idx_document_assets_workspace_att").on(table.workspaceId, table.attachmentId),
  ],
);

export const rssFeeds = sqliteTable(
  "rss_feeds",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    title: text("title").notNull(),
    targetSpaceId: text("target_space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    etag: text("etag"),
    lastModified: text("last_modified"),
    lastFetchedAt: text("last_fetched_at"),
    lastError: text("last_error"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("idx_rss_feeds_workspace_enabled").on(table.workspaceId, table.enabled)],
);

export const ingestWebhooks = sqliteTable(
  "ingest_webhooks",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    tokenPrefix: text("token_prefix").notNull(),
    targetSpaceId: text("target_space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    defaultKind: text("default_kind").notNull().default("clip"),
    tagsJson: text("tags_json").notNull().default("[]"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    lastUsedAt: text("last_used_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("idx_ingest_webhooks_workspace").on(table.workspaceId, table.enabled)],
);

export const publicSites = sqliteTable(
  "public_sites",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    subtitle: text("subtitle").notNull().default(""),
    sourceType: text("source_type").notNull(),
    sourceId: text("source_id").notNull(),
    exposedFieldsJson: text("exposed_fields_json").notNull().default("[]"),
    enableRss: integer("enable_rss", { mode: "boolean" }).notNull().default(true),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_public_sites_slug").on(table.slug),
    index("idx_public_sites_workspace_updated").on(table.workspaceId, table.updatedAt),
  ],
);

export const agentBriefingJobs = sqliteTable(
  "agent_briefing_jobs",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    cronExpr: text("cron_expr").notNull(),
    timezone: text("timezone").notNull().default("UTC"),
    executionPath: text("execution_path").notNull().default("builtin_rag"),
    bindingId: text("binding_id").references(() => adeThreadBindings.id, {
      onDelete: "set null",
    }),
    tokenRuleId: text("token_rule_id").references(() => apiTokens.id, {
      onDelete: "set null",
    }),
    targetSpaceId: text("target_space_id").references(() => spaces.id, {
      onDelete: "set null",
    }),
    promptTemplate: text("prompt_template").notNull(),
    sourcesJson: text("sources_json").notNull().default("{}"),
    targetJson: text("target_json").notNull().default("{}"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    lastRunAt: text("last_run_at"),
    lastStatus: text("last_status"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_agent_briefing_jobs_workspace_enabled").on(table.workspaceId, table.enabled),
  ],
);

export const agentBriefingRuns = sqliteTable(
  "agent_briefing_runs",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => agentBriefingJobs.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    triggerKind: text("trigger_kind").notNull().default("schedule"),
    status: text("status").notNull(),
    batchId: text("batch_id"),
    documentId: text("document_id").references(() => documents.id, { onDelete: "set null" }),
    summary: text("summary"),
    citationsJson: text("citations_json").notNull().default("[]"),
    errorMessage: text("error_message"),
    dismissedAt: text("dismissed_at"),
    durationMs: integer("duration_ms"),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at"),
  },
  (table) => [
    index("idx_agent_briefing_runs_workspace_started").on(table.workspaceId, table.startedAt),
    index("idx_agent_briefing_runs_job_started").on(table.jobId, table.startedAt),
    index("idx_agent_briefing_runs_workspace_status").on(
      table.workspaceId,
      table.status,
      table.dismissedAt,
    ),
  ],
);

export const threadWakeEvents = sqliteTable(
  "thread_wake_events",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    bindingId: text("binding_id").references(() => adeThreadBindings.id, {
      onDelete: "set null",
    }),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    targetAdeKind: text("target_ade_kind"),
    targetExternalThreadId: text("target_external_thread_id"),
    targetWorkspacePath: text("target_workspace_path"),
    senderKind: text("sender_kind").notNull(),
    senderName: text("sender_name").notNull(),
    reason: text("reason").notNull(),
    summary: text("summary").notNull(),
    formattedPromptText: text("formatted_prompt_text").notNull(),
    sourcePayloadJson: text("source_payload_json").notNull(),
    deliveryStatus: text("delivery_status").notNull().default("pending"),
    dedupeKey: text("dedupe_key"),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastError: text("last_error"),
    createdAt: text("created_at").notNull(),
    deliveredAt: text("delivered_at"),
    ackedAt: text("acked_at"),
  },
  (table) => [
    index("idx_thread_wake_events_ws_status").on(
      table.workspaceId,
      table.deliveryStatus,
      table.createdAt,
    ),
    index("idx_thread_wake_events_binding").on(
      table.workspaceId,
      table.bindingId,
      table.deliveryStatus,
    ),
    index("idx_thread_wake_events_target").on(
      table.workspaceId,
      table.targetExternalThreadId,
      table.deliveryStatus,
    ),
    index("idx_thread_wake_events_doc").on(
      table.workspaceId,
      table.documentId,
      table.deliveryStatus,
    ),
    index("idx_thread_wake_events_dedupe").on(
      table.workspaceId,
      table.dedupeKey,
      table.createdAt,
    ),
  ],
);

export const bridgeSessions = sqliteTable(
  "bridge_sessions",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    harnessName: text("harness_name").notNull(),
    adeKind: text("ade_kind").notNull(),
    externalThreadId: text("external_thread_id").notNull(),
    workspacePath: text("workspace_path"),
    pid: integer("pid"),
    capabilitiesJson: text("capabilities_json").notNull().default("{}"),
    status: text("status").notNull().default("online"),
    lastSeenAt: text("last_seen_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_bridge_sessions_unique").on(
      table.workspaceId,
      table.harnessName,
      table.externalThreadId,
    ),
    index("idx_bridge_sessions_ws_status").on(
      table.workspaceId,
      table.status,
      table.lastSeenAt,
    ),
  ],
);

export const documentArtifacts = sqliteTable(
  "document_artifacts",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    htmlSource: text("html_source").notNull(),
    capabilitiesJson: text("capabilities_json").notNull().default("{}"),
    sourcesJson: text("sources_json").notNull().default("[]"),
    fallbackMarkdown: text("fallback_markdown").notNull(),
    heightPx: integer("height_px").notNull().default(420),
    sha256: text("sha256").notNull(),
    version: integer("version").notNull().default(1),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    index("idx_document_artifacts_ws_doc").on(
      table.workspaceId,
      table.documentId,
      table.deletedAt,
      table.updatedAt,
    ),
    index("idx_document_artifacts_ws_updated").on(table.workspaceId, table.updatedAt),
  ],
);
