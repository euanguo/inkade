import {
  agentStepsListSchema,
  agentSteeringListSchema,
  asActorId,
  asApiTokenId,
  asAttachmentId,
  asAuditBatchId,
  asAuditLogId,
  asCalendarEventId,
  asCalendarSubId,
  asDocumentId,
  asHighlightCommentId,
  asHighlightId,
  asLinkId,
  asOutlineNodeId,
  asProjectRuleId,
  asPublicSiteId,
  asRevisionId,
  asSavedViewId,
  asShareLinkId,
  asSpaceId,
  asTaskTargetId,
  asSpacePropertySchemaId,
  asTemplateId,
  asThreadBindingId,
  asUserId,
  asWakeEventId,
  asWorkspaceId,
  columnWidthsSchema,
  diffPreviewSchema,
  jsonRecordSchema,
  nullablePendingApprovalSchema,
  nullableSelectionAnchorSchema,
  parseJsonWithSchema,
  savedViewDisplayModeSchema,
  savedViewFilterSchema,
  savedViewSortRuleSchema,
  spacePropertySchemaFieldsArraySchema,
  stringArraySchema,
  tokenScopeSchema,
  type ActorType,
  type AdeThreadBinding,
  type AdeThreadStatus,
  type ApiTokenRecord,
  type AttachmentRecord,
  type AuditDecision,
  type AuditLogRecord,
  type AuditPrincipalKind,
  type AuditTransport,
  type CalendarEventCacheRecord,
  type CalendarSubscription,
  type DocumentHighlight,
  type DocumentKind,
  type DocumentLink,
  type DocumentRecord,
  type DocumentRevision,
  type DocumentSummary,
  type DocumentTaskRecord,
  type DocumentTemplate,
  type ExecutionMode,
  type HighlightColor,
  type HighlightComment,
  type HighlightCommentAuthorType,
  type HighlightStatus,
  type OutlineNode,
  type ProjectScopeRule,
  type ProjectScopeRuleMatchType,
  type PublicSite,
  type PublicSiteSourceType,
  type SavedView,
  type ShareLink,
  type Space,
  type SpacePropertySchema,
  type TaskPriority,
  type TaskScheduleSlot,
  type TaskSourceEngine,
  type TokenScope,
  type Workspace,
} from "@inkade/core";
import type {
  adeThreadBindings,
  apiTokens,
  attachments,
  auditLogs,
  calendarEventsCache,
  calendarSubscriptions,
  documentHighlights,
  documentLinks,
  documentRevisions,
  documents,
  documentTasks,
  documentTemplates,
  highlightComments,
  outlineNodes,
  projectScopeRules,
  publicSites,
  savedViews,
  shareLinks,
  spacePropertySchemas,
  spaces,
  workspaces,
} from "../../schema/sqlite.ts";

const EMPTY_TOKEN_SCOPE_FALLBACK: TokenScope = {
  permission: "read",
  spaceIds: [],
  includeDescendants: true,
  denyHardDelete: true,
};

export type DocumentSummaryRow = Omit<
  typeof documents.$inferSelect,
  "contentMarkdown" | "contentJson" | "contentText"
>;

export function mapWorkspaceRow(row: typeof workspaces.$inferSelect): Workspace {
  return {
    id: asWorkspaceId(row.id),
    slug: row.slug,
    name: row.name,
    ownerUserId: asUserId(row.ownerUserId),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function mapSpaceRow(row: typeof spaces.$inferSelect): Space {
  return {
    id: asSpaceId(row.id),
    workspaceId: asWorkspaceId(row.workspaceId),
    parentId: row.parentId ? asSpaceId(row.parentId) : null,
    slug: row.slug,
    name: row.name,
    icon: row.icon ?? undefined,
    color: row.color ?? undefined,
    defaultKind: (row.defaultKind as DocumentKind | null) ?? undefined,
    sortOrder: row.sortOrder,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function mapDocumentSummaryRow(
  row: DocumentSummaryRow,
  tags: readonly string[],
): DocumentSummary {
  return {
    id: asDocumentId(row.id),
    workspaceId: asWorkspaceId(row.workspaceId),
    spaceId: asSpaceId(row.spaceId),
    kind: row.kind as DocumentKind,
    title: row.title,
    slug: row.slug,
    dailyDate: row.dailyDate,
    excerpt: row.excerpt,
    tags,
    sourceUrl: row.sourceUrl ?? undefined,
    sourceMeta: parseJsonWithSchema(row.sourceMetaJson, jsonRecordSchema.nullable(), null),
    properties: parseJsonWithSchema(row.propertiesJson, jsonRecordSchema.nullable(), null),
    version: row.version,
    pinned: row.pinned,
    unreadAgentUpdate: row.unreadAgentUpdate,
    lastEditedByType: row.lastEditedByType as ActorType,
    trashedAt: row.trashedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function mapDocumentRow(
  row: typeof documents.$inferSelect,
  tags: readonly string[],
): DocumentRecord {
  return {
    ...mapDocumentSummaryRow(row, tags),
    contentMarkdown: row.contentMarkdown,
    contentJson: parseJsonWithSchema(row.contentJson, jsonRecordSchema.nullable(), null),
    contentText: row.contentText,
  };
}

export function mapOutlineNodeRow(row: typeof outlineNodes.$inferSelect): OutlineNode {
  return {
    id: asOutlineNodeId(row.id),
    documentId: asDocumentId(row.documentId),
    parentNodeId: row.parentNodeId ? asOutlineNodeId(row.parentNodeId) : null,
    orderKey: row.orderKey,
    contentMarkdown: row.contentMarkdown,
    contentText: row.contentText,
    noteMarkdown: row.noteMarkdown,
    noteText: row.noteText,
    checked: row.checked,
    collapsed: row.collapsed,
    authorType: row.authorType as "human" | "agent",
    authorId: row.authorId ? asActorId(row.authorId) : null,
    sourceBindingId: row.sourceBindingId ? asThreadBindingId(row.sourceBindingId) : null,
    mirrorOfNodeId: row.mirrorOfNodeId ? asOutlineNodeId(row.mirrorOfNodeId) : null,
    rolledOverToDocId: row.rolledOverToDocId ? asDocumentId(row.rolledOverToDocId) : null,
    ...(row.taskPriority !== null ? { priority: row.taskPriority as TaskPriority } : {}),
    ...(row.taskScheduledDate !== null ? { scheduledDate: row.taskScheduledDate } : {}),
    ...(row.taskScheduledSlot !== null
      ? { scheduledSlot: row.taskScheduledSlot as TaskScheduleSlot }
      : {}),
    ...(row.taskScheduledStartMin !== null ? { scheduledStartMin: row.taskScheduledStartMin } : {}),
    ...(row.taskDueDate !== null ? { dueDate: row.taskDueDate } : {}),
    ...(row.taskDurationMin !== null ? { durationMin: row.taskDurationMin } : {}),
    ...(row.taskRecurrenceRule !== null ? { recurrenceRule: row.taskRecurrenceRule } : {}),
    ...(row.taskCompletedAt !== null ? { completedAt: row.taskCompletedAt } : {}),
    ...(row.taskSpawnedNextNodeId !== null
      ? { spawnedNextNodeId: asOutlineNodeId(row.taskSpawnedNextNodeId) }
      : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

export function mapRevisionRow(row: typeof documentRevisions.$inferSelect): DocumentRevision {
  return {
    id: asRevisionId(row.id),
    documentId: asDocumentId(row.documentId),
    version: row.version,
    contentMarkdown: row.contentMarkdown,
    changeSummary: row.changeSummary,
    actorType: row.actorType as ActorType,
    actorId: row.actorId ? asActorId(row.actorId) : null,
    createdAt: row.createdAt,
    ...(row.batchId !== null ? { batchId: asAuditBatchId(row.batchId) } : {}),
    ...(row.executionMode ? { executionMode: row.executionMode as ExecutionMode } : {}),
    ...(row.reversedByAuditId !== null
      ? { reversedByAuditId: asAuditLogId(row.reversedByAuditId) }
      : {}),
  };
}

export function mapLinkRow(row: typeof documentLinks.$inferSelect): DocumentLink {
  return {
    id: asLinkId(row.id),
    workspaceId: asWorkspaceId(row.workspaceId),
    sourceDocumentId: asDocumentId(row.sourceDocumentId),
    sourceNodeId: row.sourceNodeId ? asOutlineNodeId(row.sourceNodeId) : null,
    targetDocumentId: row.targetDocumentId ? asDocumentId(row.targetDocumentId) : null,
    targetSlugOrTitle: row.targetSlugOrTitle,
    anchorText: row.anchorText,
    contextSnippet: row.contextSnippet,
    createdAt: row.createdAt,
  };
}

export function mapThreadBindingRow(row: typeof adeThreadBindings.$inferSelect): AdeThreadBinding {
  const progressSteps = row.progressStepsJson
    ? parseJsonWithSchema(row.progressStepsJson, agentStepsListSchema, undefined)
    : undefined;
  const pendingApproval = parseJsonWithSchema(
    row.pendingApprovalJson,
    nullablePendingApprovalSchema,
    null,
  );
  const steeringQueue = row.steeringQueueJson
    ? parseJsonWithSchema(row.steeringQueueJson, agentSteeringListSchema, undefined)
    : undefined;

  return {
    id: asThreadBindingId(row.id),
    workspaceId: asWorkspaceId(row.workspaceId),
    documentId: asDocumentId(row.documentId),
    nodeId: row.nodeId ? asOutlineNodeId(row.nodeId) : null,
    selectionAnchor: parseJsonWithSchema(
      row.selectionAnchorJson,
      nullableSelectionAnchorSchema,
      null,
    ),
    adeKind: row.adeKind,
    externalWorkspaceId: row.externalWorkspaceId,
    externalThreadId: row.externalThreadId,
    deepLink: row.deepLink,
    title: row.title,
    status: row.status as AdeThreadStatus,
    lastSummary: row.lastSummary,
    unreadResult: row.unreadResult,
    lastSyncedAt: row.lastSyncedAt,
    createdAt: row.createdAt,
    ...(row.runningSince !== null ? { runningSince: row.runningSince } : {}),
    parentBindingId: row.parentBindingId ? asThreadBindingId(row.parentBindingId) : null,
    ...(progressSteps !== undefined ? { progressSteps } : {}),
    pendingApproval,
    ...(steeringQueue !== undefined ? { steeringQueue } : {}),
  };
}

export function mapApiTokenRow(row: typeof apiTokens.$inferSelect): ApiTokenRecord {
  return {
    id: asApiTokenId(row.id),
    workspaceId: asWorkspaceId(row.workspaceId),
    name: row.name,
    tokenPrefix: row.tokenPrefix,
    scope: parseJsonWithSchema(row.scopeJson, tokenScopeSchema, EMPTY_TOKEN_SCOPE_FALLBACK),
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function mapProjectRuleRow(row: typeof projectScopeRules.$inferSelect): ProjectScopeRule {
  return {
    id: asProjectRuleId(row.id),
    workspaceId: asWorkspaceId(row.workspaceId),
    matchType: row.matchType as ProjectScopeRuleMatchType,
    pattern: row.pattern,
    writableSpaceIds: parseJsonWithSchema(row.writableSpaceIdsJson, stringArraySchema, []).map(
      asSpaceId,
    ),
    readonlySpaceIds: parseJsonWithSchema(row.readonlySpaceIdsJson, stringArraySchema, []).map(
      asSpaceId,
    ),
    defaultInboxSpaceId: row.defaultInboxSpaceId ? asSpaceId(row.defaultInboxSpaceId) : undefined,
    defaultResearchSpaceId: row.defaultResearchSpaceId
      ? asSpaceId(row.defaultResearchSpaceId)
      : undefined,
    extraInstructions: row.extraInstructions ?? undefined,
    priority: row.priority,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function mapAttachmentRow(row: typeof attachments.$inferSelect): AttachmentRecord {
  return {
    id: asAttachmentId(row.id),
    workspaceId: asWorkspaceId(row.workspaceId),
    documentId: row.documentId ? asDocumentId(row.documentId) : null,
    mimeType: row.mimeType,
    byteSize: row.byteSize,
    sha256: row.sha256,
    storageKey: row.storageKey,
    filename: row.filename,
    createdAt: row.createdAt,
  };
}

export function mapHighlightRow(
  row: typeof documentHighlights.$inferSelect,
  commentCount?: number,
): DocumentHighlight {
  return {
    id: asHighlightId(row.id),
    workspaceId: asWorkspaceId(row.workspaceId),
    documentId: asDocumentId(row.documentId),
    quote: row.quote,
    prefixContext: row.prefixContext,
    suffixContext: row.suffixContext,
    color: row.color as HighlightColor,
    noteMarkdown: row.noteMarkdown,
    bindingId: row.bindingId ? asThreadBindingId(row.bindingId) : null,
    status: (row.status as HighlightStatus) || "open",
    resolvedAt: row.resolvedAt ?? null,
    resolvedByType: (row.resolvedByType as ActorType | null) ?? null,
    ...(commentCount !== undefined ? { commentCount } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function mapHighlightCommentRow(
  row: typeof highlightComments.$inferSelect,
): HighlightComment {
  return {
    id: asHighlightCommentId(row.id),
    workspaceId: asWorkspaceId(row.workspaceId),
    highlightId: asHighlightId(row.highlightId),
    documentId: asDocumentId(row.documentId),
    authorType: row.authorType as HighlightCommentAuthorType,
    authorId: row.authorId ?? null,
    authorName: row.authorName,
    bodyMarkdown: row.bodyMarkdown,
    sentToAgentAt: row.sentToAgentAt ?? null,
    wakeEventId: row.wakeEventId ? asWakeEventId(row.wakeEventId) : null,
    createdAt: row.createdAt,
  };
}

export function mapAuditLogRow(row: typeof auditLogs.$inferSelect): AuditLogRecord {
  return {
    id: asAuditLogId(row.id),
    workspaceId: asWorkspaceId(row.workspaceId),
    principalKind: row.principalKind as AuditPrincipalKind,
    tokenId: row.tokenId ? asApiTokenId(row.tokenId) : null,
    tokenName: row.tokenName,
    transport: row.transport as AuditTransport,
    action: row.action,
    resource: row.resource,
    spaceId: row.spaceId ? asSpaceId(row.spaceId) : null,
    documentId: row.documentId ? asDocumentId(row.documentId) : null,
    decision: row.decision as AuditDecision,
    reason: row.reason,
    summary: row.summary,
    createdAt: row.createdAt,
    beforeRevisionId: row.beforeRevisionId ? asRevisionId(row.beforeRevisionId) : null,
    afterRevisionId: row.afterRevisionId ? asRevisionId(row.afterRevisionId) : null,
    diffPreview: parseJsonWithSchema(row.diffPreviewJson, diffPreviewSchema.nullable(), null),
    reversible: Boolean(row.reversible),
    irreversibleReason: row.irreversibleReason ?? null,
    batchId: row.batchId ? asAuditBatchId(row.batchId) : null,
    executionMode: (row.executionMode as ExecutionMode) ?? "autonomous",
    reversedByAuditId: row.reversedByAuditId ? asAuditLogId(row.reversedByAuditId) : null,
  };
}

export function mapTemplateRow(row: typeof documentTemplates.$inferSelect): DocumentTemplate {
  return {
    id: asTemplateId(row.id),
    workspaceId: asWorkspaceId(row.workspaceId),
    name: row.name,
    kind: row.kind as DocumentKind,
    description: row.description,
    contentMarkdown: row.contentMarkdown,
    isDefaultDaily: row.isDefaultDaily,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function mapShareLinkRow(row: typeof shareLinks.$inferSelect): ShareLink {
  return {
    id: asShareLinkId(row.id),
    workspaceId: asWorkspaceId(row.workspaceId),
    documentId: asDocumentId(row.documentId),
    token: row.token,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
  };
}

const savedViewSortRulesArraySchema = savedViewSortRuleSchema.array();

export function mapSavedViewRow(row: typeof savedViews.$inferSelect): SavedView {
  const parsedDisplay = savedViewDisplayModeSchema.safeParse(row.displayMode);
  return {
    id: asSavedViewId(row.id),
    workspaceId: asWorkspaceId(row.workspaceId),
    name: row.name,
    icon: row.icon ?? undefined,
    color: row.color ?? undefined,
    filter: parseJsonWithSchema(row.filterJson, savedViewFilterSchema, {}),
    displayMode: parsedDisplay.success ? parsedDisplay.data : "grid",
    groupByField: row.groupByField ?? null,
    visibleColumns: row.visibleColumnsJson
      ? parseJsonWithSchema(row.visibleColumnsJson, stringArraySchema, [])
      : null,
    columnWidths: row.columnWidthsJson
      ? parseJsonWithSchema(row.columnWidthsJson, columnWidthsSchema, {})
      : null,
    sortRules: row.sortRulesJson
      ? parseJsonWithSchema(row.sortRulesJson, savedViewSortRulesArraySchema, [])
      : null,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function mapDocumentTaskRow(row: typeof documentTasks.$inferSelect): DocumentTaskRecord {
  return {
    id: asTaskTargetId(row.id),
    workspaceId: asWorkspaceId(row.workspaceId),
    sourceEngine: row.sourceEngine as TaskSourceEngine,
    docId: asDocumentId(row.docId),
    blockKey: row.blockKey,
    lineIndex: row.lineIndex,
    title: row.title,
    completed: Boolean(row.completed),
    priority: (row.priority as TaskPriority | null) ?? null,
    scheduledDate: row.scheduledDate,
    scheduledStartMin: row.scheduledStartMin,
    durationMin: row.durationMin,
    dueDate: row.dueDate,
    recurrenceRule: row.recurrenceRule ?? null,
    spaceId: asSpaceId(row.spaceId),
    tags: parseJsonWithSchema(row.tagsJson, stringArraySchema, []),
    updatedAt: row.updatedAt,
  };
}

export function mapCalendarSubscriptionRow(
  row: typeof calendarSubscriptions.$inferSelect,
): CalendarSubscription {
  return {
    id: asCalendarSubId(row.id),
    workspaceId: asWorkspaceId(row.workspaceId),
    name: row.name,
    url: row.url,
    color: row.color,
    enabled: Boolean(row.enabled),
    etag: row.etag,
    lastModified: row.lastModified,
    lastSyncedAt: row.lastSyncedAt,
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function mapCalendarEventCacheRow(
  row: typeof calendarEventsCache.$inferSelect,
): CalendarEventCacheRecord {
  return {
    id: asCalendarEventId(row.id),
    subscriptionId: asCalendarSubId(row.subscriptionId),
    workspaceId: asWorkspaceId(row.workspaceId),
    uid: row.uid,
    title: row.title,
    description: row.description,
    location: row.location,
    startAt: row.startAt,
    endAt: row.endAt,
    allDay: Boolean(row.allDay),
    timezone: row.timezone,
    rrule: row.rrule,
    exdates: parseJsonWithSchema(row.exdatesJson, stringArraySchema, []),
    updatedAt: row.updatedAt,
  };
}

export function mapSpacePropertySchemaRow(
  row: typeof spacePropertySchemas.$inferSelect,
): SpacePropertySchema {
  return {
    id: asSpacePropertySchemaId(row.id),
    workspaceId: asWorkspaceId(row.workspaceId),
    spaceId: row.spaceId ? asSpaceId(row.spaceId) : null,
    templateId: row.templateId ? asTemplateId(row.templateId) : null,
    fields: parseJsonWithSchema(row.fieldsJson, spacePropertySchemaFieldsArraySchema, []),
    updatedAt: row.updatedAt,
  };
}

export function mapPublicSiteRow(row: typeof publicSites.$inferSelect): PublicSite {
  return {
    id: asPublicSiteId(row.id),
    workspaceId: asWorkspaceId(row.workspaceId),
    slug: row.slug,
    title: row.title,
    subtitle: row.subtitle,
    sourceType: row.sourceType as PublicSiteSourceType,
    sourceId: row.sourceId,
    exposedFields: parseJsonWithSchema(row.exposedFieldsJson, stringArraySchema, []),
    enableRss: Boolean(row.enableRss),
    enabled: Boolean(row.enabled),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
