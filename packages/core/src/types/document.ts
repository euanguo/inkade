import { z } from "zod";
import {
  bridgeSessionIdSchema,
  documentIdSchema,
  highlightIdSchema,
  outlineNodeIdSchema,
  spaceIdSchema,
  threadBindingIdSchema,
  type ApiTokenId,
  type AuditBatchId,
  type AuditLogId,
  type DocumentId,
  type HighlightCommentId,
  type HighlightId,
  type LinkId,
  type OutlineNodeId,
  type RevisionId,
  type ShareLinkId,
  type SpaceId,
  type ThreadBindingId,
  type UserId,
  type WakeEventId,
  type WorkspaceId,
} from "../ids.ts";
import {
  actorTypeSchema,
  dailyDateSchema,
  documentKindSchema,
  highlightColorSchema,
  isoTimestampSchema,
  sectionPatchModeSchema,
  type ActorType,
  type DocumentKind,
  type ExecutionMode,
  type HighlightColor,
} from "./common.ts";
import type { WakeEnvelope } from "../wake.ts";
import type { OutlineNode } from "./outline.ts";
import type { ViewQueryResponse } from "./property-schema.ts";

export interface DocumentSummaryBase {
  readonly id: DocumentId;
  readonly workspaceId: WorkspaceId;
  readonly spaceId: SpaceId;
  readonly title: string;
  readonly slug: string;
  readonly dailyDate: string | null;
  readonly excerpt: string;
  readonly tags: readonly string[];
  readonly sourceUrl?: string | undefined;
  readonly sourceMeta?: Record<string, unknown> | null | undefined;
  readonly properties?: Record<string, unknown> | null | undefined;
  readonly version: number;
  readonly pinned: boolean;
  readonly unreadAgentUpdate: boolean;
  readonly lastEditedByType: ActorType;
  readonly trashedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface OutlineDocumentSummary extends DocumentSummaryBase {
  readonly kind: "outline";
}

export interface ArticleDocumentSummary extends DocumentSummaryBase {
  readonly kind: "article";
}

export interface ClipDocumentSummary extends DocumentSummaryBase {
  readonly kind: "clip";
}

export type DocumentSummary =
  | OutlineDocumentSummary
  | ArticleDocumentSummary
  | ClipDocumentSummary;

export interface DocumentBase extends DocumentSummaryBase {
  readonly contentMarkdown: string;
  readonly contentJson: Record<string, unknown> | null;
  readonly contentText: string;
}

export interface OutlineDocument extends DocumentBase {
  readonly kind: "outline";
}

export interface ArticleDocument extends DocumentBase {
  readonly kind: "article";
}

export interface ClipDocument extends DocumentBase {
  readonly kind: "clip";
}

export type Document = OutlineDocument | ArticleDocument | ClipDocument;
export type DocumentRecord = Document;

export interface DocumentRevision {
  readonly id: RevisionId;
  readonly documentId: DocumentId;
  readonly version: number;
  readonly contentMarkdown: string;
  readonly changeSummary: string | null;
  readonly actorType: ActorType;
  readonly actorId: UserId | ApiTokenId | null;
  readonly createdAt: string;
  readonly batchId?: AuditBatchId | null | undefined;
  readonly executionMode?: ExecutionMode | undefined;
  readonly reversedByAuditId?: AuditLogId | null | undefined;
}

/**
 * Identifies internal system backing documents (such as `systemRole: "tasks_inbox"` or
 * `_system`-prefixed internal stores) that must remain hidden from normal Library, Inbox,
 * Search, and RAG user views unless explicitly requested for diagnostics.
 */
export function isSystemInternalDocument(doc: {
  readonly properties?: Record<string, unknown> | null | undefined;
  readonly spaceId?: SpaceId | string | null | undefined;
}): boolean {
  const props = doc.properties;
  if (props && typeof props === "object" && !Array.isArray(props)) {
    const systemRole = props.systemRole;
    if (typeof systemRole === "string" && systemRole.trim().length > 0) {
      return true;
    }
    if (props.isSystemInternal === true) {
      return true;
    }
  }
  const spaceId = doc.spaceId;
  return (
    typeof spaceId === "string" &&
    (spaceId === "_system" || spaceId.startsWith("spc__system"))
  );
}

export interface DocumentLink {
  readonly id: LinkId;
  readonly workspaceId: WorkspaceId;
  readonly sourceDocumentId: DocumentId;
  readonly sourceNodeId: OutlineNodeId | null;
  readonly targetDocumentId: DocumentId | null;
  readonly targetSlugOrTitle: string;
  readonly anchorText: string | null;
  readonly contextSnippet: string;
  readonly createdAt: string;
}

export const diffPreviewSchema = z.object({
  oldSnippet: z.string(),
  newSnippet: z.string(),
});
export type DiffPreview = z.infer<typeof diffPreviewSchema>;

export interface TocEntry {
  readonly depth: number;
  readonly text: string;
  readonly slug: string;
  readonly path: readonly string[];
  readonly startOffset: number;
  readonly endOffset: number;
}

export interface ExtractedWikilink {
  readonly raw: string;
  readonly targetSlugOrTitle: string;
  readonly anchorText: string | null;
  readonly alias: string | null;
  readonly contextSnippet: string;
}

export interface RevisionDiffHunk {
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
  readonly lines: readonly string[];
}

export interface RevisionDiffResult {
  readonly additions: number;
  readonly deletions: number;
  readonly hunks: readonly RevisionDiffHunk[];
  readonly unifiedPatch: string;
}

export const HIGHLIGHT_STATUSES = ["open", "resolved"] as const;
export type HighlightStatus = (typeof HIGHLIGHT_STATUSES)[number];
export const highlightStatusSchema = z.enum(HIGHLIGHT_STATUSES);

export const HIGHLIGHT_COMMENT_AUTHOR_TYPES = ["human", "agent", "collaborator"] as const;
export type HighlightCommentAuthorType = (typeof HIGHLIGHT_COMMENT_AUTHOR_TYPES)[number];
export const highlightCommentAuthorTypeSchema = z.enum(HIGHLIGHT_COMMENT_AUTHOR_TYPES);

export interface DocumentHighlight {
  readonly id: HighlightId;
  readonly workspaceId: WorkspaceId;
  readonly documentId: DocumentId;
  readonly quote: string;
  readonly prefixContext: string;
  readonly suffixContext: string;
  readonly color: HighlightColor;
  readonly noteMarkdown: string;
  readonly bindingId: ThreadBindingId | null;
  readonly status: HighlightStatus;
  readonly resolvedAt: string | null;
  readonly resolvedByType: ActorType | null;
  readonly commentCount?: number | undefined;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface HighlightComment {
  readonly id: HighlightCommentId;
  readonly workspaceId: WorkspaceId;
  readonly highlightId: HighlightId;
  readonly documentId: DocumentId;
  readonly authorType: HighlightCommentAuthorType;
  readonly authorId: string | null;
  readonly authorName: string;
  readonly bodyMarkdown: string;
  readonly sentToAgentAt: string | null;
  readonly wakeEventId: WakeEventId | null;
  readonly createdAt: string;
}

export interface HighlightCommentThread {
  readonly highlight: DocumentHighlight;
  readonly comments: readonly HighlightComment[];
}

export const VIEWER_CONTEXT_VIEW_MODES = ["reader", "editor", "outline", "diff"] as const;
export type ViewerContextViewMode = (typeof VIEWER_CONTEXT_VIEW_MODES)[number];
export const viewerContextViewModeSchema = z.enum(VIEWER_CONTEXT_VIEW_MODES);

export interface ViewerContextSnapshot {
  readonly workspaceId: WorkspaceId;
  readonly userId: UserId | null;
  readonly documentId: DocumentId;
  readonly documentTitle?: string | undefined;
  readonly viewMode: ViewerContextViewMode;
  readonly headingSlug?: string | null | undefined;
  readonly activeNodeId?: OutlineNodeId | null | undefined;
  readonly selectedQuote?: string | null | undefined;
  readonly selectedHighlightId?: HighlightId | null | undefined;
  readonly updatedAt: string;
}

export type GetViewerContextResult =
  | {
      readonly visible: true;
      readonly context: ViewerContextSnapshot;
    }
  | {
      readonly visible: false;
      readonly reason: "out_of_scope" | "unavailable";
    };

export type HighlightWakeDeliveryTarget = "bound_session" | "bridge_session" | "unowned";

export interface SendHighlightToAgentResult {
  readonly highlight: DocumentHighlight;
  readonly comments: readonly HighlightComment[];
  readonly wakeEvent: WakeEnvelope;
  readonly deliveryTarget: HighlightWakeDeliveryTarget;
}

export interface ShareLink {
  readonly id: ShareLinkId;
  readonly workspaceId: WorkspaceId;
  readonly documentId: DocumentId;
  readonly token: string;
  readonly expiresAt: string | null;
  readonly revokedAt: string | null;
  readonly createdAt: string;
}

export interface PublicSharedDocument {
  readonly document: {
    readonly id: DocumentId;
    readonly kind: DocumentKind;
    readonly title: string;
    readonly slug: string;
    readonly dailyDate: string | null;
    readonly contentMarkdown: string;
    readonly excerpt: string;
    readonly tags: readonly string[];
    readonly sourceUrl?: string | undefined;
    readonly createdAt: string;
    readonly updatedAt: string;
  };
  readonly nodes?: readonly Pick<
    OutlineNode,
    | "id"
    | "parentNodeId"
    | "orderKey"
    | "contentMarkdown"
    | "contentText"
    | "noteMarkdown"
    | "noteText"
    | "checked"
    | "collapsed"
    | "createdAt"
    | "updatedAt"
  >[];
  readonly shareLink: {
    readonly id: ShareLinkId;
    readonly expiresAt: string | null;
    readonly createdAt: string;
  };
  readonly embeddedViews?: Readonly<Record<string, ViewQueryResponse>> | undefined;
}

export interface UnlinkedMentionItem {
  readonly documentId: DocumentId;
  readonly documentTitle: string;
  readonly spaceId: SpaceId;
  readonly kind: DocumentKind;
  readonly nodeId: OutlineNodeId | null;
  readonly snippet: string;
  readonly matchCount: number;
}

export interface DocumentGraphNode {
  readonly id: DocumentId;
  readonly title: string;
  readonly slug: string;
  readonly spaceId: SpaceId;
  readonly kind: DocumentKind;
  readonly tags: readonly string[];
  readonly depth: number;
}

export interface DocumentGraphEdge {
  readonly id: LinkId;
  readonly sourceDocumentId: DocumentId;
  readonly targetDocumentId: DocumentId;
  readonly anchorText: string | null;
}

export interface DocumentGraph {
  readonly centerDocumentId: DocumentId;
  readonly nodes: readonly DocumentGraphNode[];
  readonly edges: readonly DocumentGraphEdge[];
}

export const createDocumentInputSchema = z.object({
  spaceId: spaceIdSchema,
  kind: documentKindSchema,
  title: z.string().trim().min(1).max(300),
  slug: z.string().trim().min(1).max(160).optional(),
  dailyDate: dailyDateSchema.nullable().optional(),
  contentMarkdown: z.string().default(""),
  contentJson: z.record(z.string(), z.unknown()).nullable().optional(),
  tags: z.array(z.string().trim().min(1)).default([]),
  sourceUrl: z.string().url().optional(),
  sourceMeta: z.record(z.string(), z.unknown()).nullable().optional(),
  properties: z.record(z.string(), z.unknown()).nullable().optional(),
  pinned: z.boolean().default(false),
});
export type CreateDocumentInput = z.input<typeof createDocumentInputSchema>;
export type ParsedCreateDocumentInput = z.infer<typeof createDocumentInputSchema>;

export const updateDocumentInputSchema = z.object({
  spaceId: spaceIdSchema.optional(),
  title: z.string().trim().min(1).max(300).optional(),
  slug: z.string().trim().min(1).max(160).optional(),
  contentMarkdown: z.string().optional(),
  contentJson: z.record(z.string(), z.unknown()).nullable().optional(),
  tags: z.array(z.string().trim().min(1)).optional(),
  sourceUrl: z.string().url().nullable().optional(),
  sourceMeta: z.record(z.string(), z.unknown()).nullable().optional(),
  properties: z.record(z.string(), z.unknown()).nullable().optional(),
  pinned: z.boolean().optional(),
  unreadAgentUpdate: z.boolean().optional(),
  expectedVersion: z.number().int().positive().optional(),
  changeSummary: z.string().trim().max(500).nullable().optional(),
  syncBacklinks: z.boolean().optional(),
});
export type UpdateDocumentInput = z.infer<typeof updateDocumentInputSchema>;

export const scaffoldSectionInputSchema = z.object({
  heading: z.string().trim().min(1).max(300),
  level: z.number().int().min(1).max(6).optional(),
  pendingId: z.string().trim().min(1).max(120).optional(),
  pendingLabel: z.string().trim().min(1).max(500).optional(),
  initialMarkdown: z.string().optional(),
});
export type ScaffoldSectionInput = z.input<typeof scaffoldSectionInputSchema>;

export const scaffoldDocumentInputSchema = z.object({
  spaceId: spaceIdSchema,
  title: z.string().trim().min(1).max(300),
  slug: z.string().trim().min(1).max(160).optional(),
  introMarkdown: z.string().optional(),
  tags: z.array(z.string().trim().min(1)).default([]),
  bindingId: threadBindingIdSchema.optional(),
  properties: z.record(z.string(), z.unknown()).nullable().optional(),
  pinned: z.boolean().default(false),
  sections: z.array(scaffoldSectionInputSchema).min(1).max(50),
});
export type ScaffoldDocumentInput = z.input<typeof scaffoldDocumentInputSchema>;
export type ParsedScaffoldDocumentInput = z.infer<typeof scaffoldDocumentInputSchema>;

export const patchDocumentSectionInputSchema = z
  .object({
    headingPath: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]).optional(),
    targetPendingId: z.string().trim().min(1).max(120).optional(),
    mode: sectionPatchModeSchema.default("replace"),
    markdown: z.string(),
    createIfMissing: z.boolean().default(false),
    expectedVersion: z.number().int().positive().optional(),
    changeSummary: z.string().trim().max(500).nullable().optional(),
  })
  .superRefine((val, ctx) => {
    if (!val.targetPendingId && !val.headingPath) {
      ctx.addIssue({
        code: "custom",
        path: ["headingPath"],
        message: "Either targetPendingId or headingPath must be provided",
      });
    }
  });
export type PatchDocumentSectionInput = z.input<typeof patchDocumentSectionInputSchema>;
export type ParsedPatchDocumentSectionInput = z.infer<typeof patchDocumentSectionInputSchema>;

export const ingestClipUrlInputSchema = z.object({
  url: z.string().url(),
  spaceId: spaceIdSchema.optional(),
  tags: z.array(z.string().trim().min(1)).default([]),
  title: z.string().trim().min(1).max(300).optional(),
  mirrorImages: z.boolean().default(true),
  saveHtmlSnapshot: z.boolean().default(true),
});
export type IngestClipUrlInput = z.input<typeof ingestClipUrlInputSchema>;
export type ParsedIngestClipUrlInput = z.infer<typeof ingestClipUrlInputSchema>;

export const createDocumentHighlightInputSchema = z.object({
  quote: z.string().min(1).max(4000),
  prefixContext: z.string().max(1000).default(""),
  suffixContext: z.string().max(1000).default(""),
  color: highlightColorSchema.default("amber"),
  noteMarkdown: z.string().max(10000).default(""),
  bindingId: threadBindingIdSchema.nullable().optional(),
});
export type CreateDocumentHighlightInput = z.input<typeof createDocumentHighlightInputSchema>;
export type ParsedCreateDocumentHighlightInput = z.infer<typeof createDocumentHighlightInputSchema>;

export const updateDocumentHighlightInputSchema = z.object({
  color: highlightColorSchema.optional(),
  noteMarkdown: z.string().max(10000).optional(),
  bindingId: threadBindingIdSchema.nullable().optional(),
  status: highlightStatusSchema.optional(),
  resolvedAt: isoTimestampSchema.nullable().optional(),
  resolvedByType: actorTypeSchema.nullable().optional(),
});
export type UpdateDocumentHighlightInput = z.infer<typeof updateDocumentHighlightInputSchema>;

export const createHighlightCommentInputSchema = z.object({
  bodyMarkdown: z.string().trim().min(1).max(10000),
  authorType: highlightCommentAuthorTypeSchema.optional(),
  authorName: z.string().trim().min(1).max(120).optional(),
  resolve: z.boolean().optional(),
});
export type CreateHighlightCommentInput = z.input<typeof createHighlightCommentInputSchema>;
export type ParsedCreateHighlightCommentInput = z.infer<typeof createHighlightCommentInputSchema>;

export const sendHighlightToAgentInputSchema = z.object({
  bindingId: threadBindingIdSchema.nullable().optional(),
  bridgeSessionId: bridgeSessionIdSchema.nullable().optional(),
  promptOverride: z.string().trim().min(1).max(10000).optional(),
  bodyMarkdown: z.string().trim().min(1).max(10000).optional(),
  senderType: z.enum(["owner", "collaborator"]).optional(),
  senderName: z.string().trim().min(1).max(120).optional(),
});
export type SendHighlightToAgentInput = z.input<typeof sendHighlightToAgentInputSchema>;
export type ParsedSendHighlightToAgentInput = z.infer<typeof sendHighlightToAgentInputSchema>;

export const updateViewerContextInputSchema = z.object({
  documentId: documentIdSchema.nullable(),
  viewMode: viewerContextViewModeSchema.default("reader"),
  headingSlug: z.string().trim().min(1).max(300).nullable().optional(),
  activeNodeId: outlineNodeIdSchema.nullable().optional(),
  selectedQuote: z.string().trim().min(1).max(2000).nullable().optional(),
  selectedHighlightId: highlightIdSchema.nullable().optional(),
});
export type UpdateViewerContextInput = z.input<typeof updateViewerContextInputSchema>;
export type ParsedUpdateViewerContextInput = z.infer<typeof updateViewerContextInputSchema>;

export const createShareLinkInputSchema = z.object({
  documentId: documentIdSchema,
  expiresAt: isoTimestampSchema.nullable().optional(),
});
export type CreateShareLinkInput = z.infer<typeof createShareLinkInputSchema>;
