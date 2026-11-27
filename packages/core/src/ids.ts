import { nanoid } from "nanoid";
import { z } from "zod";

export const ID_PREFIXES = {
  workspace: "ws",
  space: "spc",
  document: "doc",
  outlineNode: "nod",
  revision: "rev",
  link: "lnk",
  threadBinding: "bnd",
  apiToken: "tok",
  projectRule: "rul",
  attachment: "att",
  user: "usr",
  event: "evt",
  highlight: "hl",
  auditLog: "aud",
  template: "tpl",
  shareLink: "shr",
  savedView: "view",
  approval: "apr",
  steeringNote: "str",
  agentStep: "stp",
  auditBatch: "bat",
  documentTask: "tsk",
  calendarSub: "csub",
  calendarEvent: "cevt",
  spacePropertySchema: "sps",
  documentChunk: "chk",
  contextPack: "pack",
  documentAsset: "ast",
  rssFeed: "rss",
  ingestWebhook: "whk",
  publicSite: "site",
  briefingJob: "brj",
  briefingRun: "brr",
  wakeEvent: "wke",
  bridgeSession: "bgs",
  highlightComment: "cmt",
  documentArtifact: "art",
} as const;

export type IdPrefix = (typeof ID_PREFIXES)[keyof typeof ID_PREFIXES];

declare const INKADE_ID_BRAND: unique symbol;

export type BrandedId<P extends IdPrefix> = string & {
  readonly [INKADE_ID_BRAND]: P;
};

export type WorkspaceId = BrandedId<typeof ID_PREFIXES.workspace>;
export type SpaceId = BrandedId<typeof ID_PREFIXES.space>;
export type DocumentId = BrandedId<typeof ID_PREFIXES.document>;
export type OutlineNodeId = BrandedId<typeof ID_PREFIXES.outlineNode>;
export type RevisionId = BrandedId<typeof ID_PREFIXES.revision>;
export type LinkId = BrandedId<typeof ID_PREFIXES.link>;
export type ThreadBindingId = BrandedId<typeof ID_PREFIXES.threadBinding>;
export type ApiTokenId = BrandedId<typeof ID_PREFIXES.apiToken>;
export type ProjectRuleId = BrandedId<typeof ID_PREFIXES.projectRule>;
export type AttachmentId = BrandedId<typeof ID_PREFIXES.attachment>;
export type UserId = BrandedId<typeof ID_PREFIXES.user>;
export type EventId = BrandedId<typeof ID_PREFIXES.event>;
export type HighlightId = BrandedId<typeof ID_PREFIXES.highlight>;
export type AuditLogId = BrandedId<typeof ID_PREFIXES.auditLog>;
export type TemplateId = BrandedId<typeof ID_PREFIXES.template>;
export type ShareLinkId = BrandedId<typeof ID_PREFIXES.shareLink>;
export type SavedViewId = BrandedId<typeof ID_PREFIXES.savedView>;
export type ApprovalId = BrandedId<typeof ID_PREFIXES.approval>;
export type SteeringNoteId = BrandedId<typeof ID_PREFIXES.steeringNote>;
export type AgentStepId = BrandedId<typeof ID_PREFIXES.agentStep>;
export type AuditBatchId = BrandedId<typeof ID_PREFIXES.auditBatch>;
export type DocumentTaskId = BrandedId<typeof ID_PREFIXES.documentTask>;
export type CalendarSubId = BrandedId<typeof ID_PREFIXES.calendarSub>;
export type CalendarEventId = BrandedId<typeof ID_PREFIXES.calendarEvent>;
export type TaskTargetId = OutlineNodeId | DocumentTaskId;
export type SpacePropertySchemaId = BrandedId<typeof ID_PREFIXES.spacePropertySchema>;
export type DocumentChunkId = BrandedId<typeof ID_PREFIXES.documentChunk>;
export type ContextPackId = BrandedId<typeof ID_PREFIXES.contextPack>;
export type DocumentAssetId = BrandedId<typeof ID_PREFIXES.documentAsset>;
export type RssFeedId = BrandedId<typeof ID_PREFIXES.rssFeed>;
export type IngestWebhookId = BrandedId<typeof ID_PREFIXES.ingestWebhook>;
export type PublicSiteId = BrandedId<typeof ID_PREFIXES.publicSite>;
export type BriefingJobId = BrandedId<typeof ID_PREFIXES.briefingJob>;
export type BriefingRunId = BrandedId<typeof ID_PREFIXES.briefingRun>;
export type WakeEventId = BrandedId<typeof ID_PREFIXES.wakeEvent>;
export type BridgeSessionId = BrandedId<typeof ID_PREFIXES.bridgeSession>;
export type HighlightCommentId = BrandedId<typeof ID_PREFIXES.highlightComment>;
export type DocumentArtifactId = BrandedId<typeof ID_PREFIXES.documentArtifact>;

export function createId<P extends IdPrefix>(prefix: P): BrandedId<P> {
  return `${prefix}_${nanoid(12)}` as BrandedId<P>;
}

export function isPrefixedId<P extends IdPrefix>(prefix: P, value: unknown): value is BrandedId<P> {
  return (
    typeof value === "string" &&
    value.startsWith(`${prefix}_`) &&
    value.length > prefix.length + 1
  );
}

/**
 * Marks a trusted non-empty identifier string (DB row, seed constant, URL param, or external user ID)
 * as the corresponding nominal Inkade Branded ID.
 */
export function asId<P extends IdPrefix>(prefix: P, value: string): BrandedId<P> {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Invalid ${prefix} id: expected a non-empty string`);
  }
  return trimmed as BrandedId<P>;
}

/**
 * Strictly validates that `value` carries the canonical `${prefix}_...` prefix and returns the Branded ID.
 */
export function parseId<P extends IdPrefix>(prefix: P, value: string): BrandedId<P> {
  const trimmed = value.trim();
  if (!isPrefixedId(prefix, trimmed)) {
    throw new Error(`Invalid ${prefix} id "${value}": expected prefix "${prefix}_"`);
  }
  return trimmed;
}

/**
 * Boundary Zod schema validating prefixed entity IDs (with JSON Schema compatibility) and typing them
 * as nominal Branded IDs on both input and output contracts.
 */
export function idSchema<P extends IdPrefix>(
  prefix: P,
  options?: {
    readonly enforcePrefix?: boolean | undefined;
    readonly maxLength?: number | undefined;
  },
): z.ZodType<BrandedId<P>, BrandedId<P>> {
  const enforcePrefix = options?.enforcePrefix !== false;
  let base = z.string().trim().min(1);
  if (options?.maxLength !== undefined) {
    base = base.max(options.maxLength);
  }
  const schema = enforcePrefix
    ? base.regex(new RegExp(`^${prefix}_.+`), {
        message: `ID must start with "${prefix}_"`,
      })
    : base;
  return schema as unknown as z.ZodType<BrandedId<P>, BrandedId<P>>;
}

function makeAsId<P extends IdPrefix>(prefix: P): (value: string) => BrandedId<P> {
  return (value: string) => asId(prefix, value);
}

export const asWorkspaceId = makeAsId(ID_PREFIXES.workspace);
export const asSpaceId = makeAsId(ID_PREFIXES.space);
export const asDocumentId = makeAsId(ID_PREFIXES.document);
export const asOutlineNodeId = makeAsId(ID_PREFIXES.outlineNode);
export const asRevisionId = makeAsId(ID_PREFIXES.revision);
export const asLinkId = makeAsId(ID_PREFIXES.link);
export const asThreadBindingId = makeAsId(ID_PREFIXES.threadBinding);
export const asApiTokenId = makeAsId(ID_PREFIXES.apiToken);
export const asProjectRuleId = makeAsId(ID_PREFIXES.projectRule);
export const asAttachmentId = makeAsId(ID_PREFIXES.attachment);
export const asUserId = makeAsId(ID_PREFIXES.user);
export const asEventId = makeAsId(ID_PREFIXES.event);
export const asHighlightId = makeAsId(ID_PREFIXES.highlight);
export const asAuditLogId = makeAsId(ID_PREFIXES.auditLog);
export const asTemplateId = makeAsId(ID_PREFIXES.template);
export const asShareLinkId = makeAsId(ID_PREFIXES.shareLink);
export const asSavedViewId = makeAsId(ID_PREFIXES.savedView);
export const asApprovalId = makeAsId(ID_PREFIXES.approval);
export const asSteeringNoteId = makeAsId(ID_PREFIXES.steeringNote);
export const asAgentStepId = makeAsId(ID_PREFIXES.agentStep);
export const asAuditBatchId = makeAsId(ID_PREFIXES.auditBatch);
export const asDocumentTaskId = makeAsId(ID_PREFIXES.documentTask);
export const asCalendarSubId = makeAsId(ID_PREFIXES.calendarSub);
export const asCalendarEventId = makeAsId(ID_PREFIXES.calendarEvent);
export function asTaskTargetId(value: string): TaskTargetId {
  return isPrefixedId(ID_PREFIXES.documentTask, value)
    ? value
    : asOutlineNodeId(value);
}
export const asSpacePropertySchemaId = makeAsId(ID_PREFIXES.spacePropertySchema);

export const workspaceIdSchema = idSchema(ID_PREFIXES.workspace);
export const spaceIdSchema = idSchema(ID_PREFIXES.space);
export const documentIdSchema = idSchema(ID_PREFIXES.document);
export const outlineNodeIdSchema = idSchema(ID_PREFIXES.outlineNode);
export const revisionIdSchema = idSchema(ID_PREFIXES.revision);
export const linkIdSchema = idSchema(ID_PREFIXES.link);
export const threadBindingIdSchema = idSchema(ID_PREFIXES.threadBinding);
export const apiTokenIdSchema = idSchema(ID_PREFIXES.apiToken);
export const projectRuleIdSchema = idSchema(ID_PREFIXES.projectRule);
export const attachmentIdSchema = idSchema(ID_PREFIXES.attachment);
export const highlightIdSchema = idSchema(ID_PREFIXES.highlight);
export const auditLogIdSchema = idSchema(ID_PREFIXES.auditLog);
export const templateIdSchema = idSchema(ID_PREFIXES.template);
export const shareLinkIdSchema = idSchema(ID_PREFIXES.shareLink);
export const savedViewIdSchema = idSchema(ID_PREFIXES.savedView);
export const auditBatchIdSchema = idSchema(ID_PREFIXES.auditBatch);
export const documentTaskIdSchema = idSchema(ID_PREFIXES.documentTask);
export const calendarSubIdSchema = idSchema(ID_PREFIXES.calendarSub);
export const calendarEventIdSchema = idSchema(ID_PREFIXES.calendarEvent);
export const taskTargetIdSchema = z.union([
  outlineNodeIdSchema,
  documentTaskIdSchema,
]) as unknown as z.ZodType<TaskTargetId, TaskTargetId>;
export const spacePropertySchemaIdSchema = idSchema(ID_PREFIXES.spacePropertySchema);
export const documentChunkIdSchema = idSchema(ID_PREFIXES.documentChunk);
export const contextPackIdSchema = idSchema(ID_PREFIXES.contextPack);
export const documentAssetIdSchema = idSchema(ID_PREFIXES.documentAsset);
export const rssFeedIdSchema = idSchema(ID_PREFIXES.rssFeed);
export const ingestWebhookIdSchema = idSchema(ID_PREFIXES.ingestWebhook);
export const publicSiteIdSchema = idSchema(ID_PREFIXES.publicSite);
export const briefingJobIdSchema = idSchema(ID_PREFIXES.briefingJob);
export const briefingRunIdSchema = idSchema(ID_PREFIXES.briefingRun);
export const wakeEventIdSchema = idSchema(ID_PREFIXES.wakeEvent);
export const bridgeSessionIdSchema = idSchema(ID_PREFIXES.bridgeSession);
export const highlightCommentIdSchema = idSchema(ID_PREFIXES.highlightComment);
export const documentArtifactIdSchema = idSchema(ID_PREFIXES.documentArtifact);
export const asDocumentChunkId = makeAsId(ID_PREFIXES.documentChunk);
export const asContextPackId = makeAsId(ID_PREFIXES.contextPack);
export const asDocumentAssetId = makeAsId(ID_PREFIXES.documentAsset);
export const asRssFeedId = makeAsId(ID_PREFIXES.rssFeed);
export const asIngestWebhookId = makeAsId(ID_PREFIXES.ingestWebhook);
export const asPublicSiteId = makeAsId(ID_PREFIXES.publicSite);
export const asBriefingJobId = makeAsId(ID_PREFIXES.briefingJob);
export const asBriefingRunId = makeAsId(ID_PREFIXES.briefingRun);
export const asWakeEventId = makeAsId(ID_PREFIXES.wakeEvent);
export const asBridgeSessionId = makeAsId(ID_PREFIXES.bridgeSession);
export const asHighlightCommentId = makeAsId(ID_PREFIXES.highlightComment);
export const asDocumentArtifactId = makeAsId(ID_PREFIXES.documentArtifact);

/**
 * Classifies an actor identifier coming from human users (which may originate from external auth
 * providers) or agent API tokens.
 */
export function asActorId(value: string): UserId | ApiTokenId {
  return isPrefixedId(ID_PREFIXES.apiToken, value) ? value : asUserId(value);
}

const DAILY_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Validates that `value` is a real YYYY-MM-DD calendar date.
 */
export function isValidDailyDate(value: string): boolean {
  const match = DAILY_DATE_PATTERN.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }

  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}
