import {
  type FetchCredentials,
  type FetchLike,
  type InkadeClientConfig,
  type InkadeConnectionConfig,
  InkadeHttpTransport,
} from "./http-transport.ts";
import {
  type AuditLogsResource,
  type AttachmentsResource,
  type AwaySummaryParams,
  type CleanupOrphanAttachmentsResponse,
  type CreateTokenResponse,
  type ListAuditLogsParams,
  type ScopeRulesResource,
  type TokensResource,
  type UploadAttachmentInput,
  type UploadAttachmentResponse,
  type WorkspaceResource,
  createAttachmentsResource,
  createAuditLogsResource,
  createScopeRulesResource,
  createTokensResource,
  createWorkspaceResource,
} from "./resources/admin.ts";
import {
  type AiResource,
  type AiRewriteStreamOptions,
  type AskStreamMetaEvent,
  type AskStreamOptions,
  type AskStreamResult,
  createAiResource,
} from "./resources/ai.ts";
import {
  type ArtifactsResource,
  type CreateDocumentArtifactResponse,
  type DeleteDocumentArtifactResponse,
  type UpdateDocumentArtifactResponse,
  createArtifactsResource,
} from "./resources/artifacts.ts";
import {
  type ApplyTemplateResponse,
  type ClipsResource,
  type HighlightCommentsResponse,
  type HighlightsResource,
  type IngestClipUrlResponse,
  type SavedViewsResource,
  type ShareLinksResource,
  type TemplatesResource,
  type ViewsResource,
  createClipsResource,
  createHighlightsResource,
  createSavedViewsResource,
  createShareLinksResource,
  createTemplatesResource,
  createViewsResource,
} from "./resources/clips.ts";
import {
  type AuthResource,
  type BootstrapResource,
  type BootstrapResponse,
  type EmbedChannelAckResponse,
  type HealthResponse,
  type SetupOwnerInput,
  type SetupOwnerResponse,
  type WhoAmIScopeResponse,
  createAuthResource,
  createBootstrapResource,
} from "./resources/bootstrap.ts";
import {
  type ConnectResource,
  type ContextPacksResource,
  type GetContextPackOptions,
  createConnectResource,
  createContextPacksResource,
} from "./resources/context-packs.ts";
import {
  type DailyOutlineResponse,
  type DocumentsResource,
  type LinkDocumentTargetResponse,
  type ListDocumentsParams,
  type RevisionDiffResponse,
  type UpdateViewerContextResponse,
  createDocumentsResource,
} from "./resources/documents.ts";
import {
  type AudioTranscribeMultipartInput,
  type ImportMultipartInput,
  type ImportResource,
  type IngestAudioResource,
  type PdfResource,
  type RssFeedsResource,
  type UploadPdfMultipartInput,
  type WebhooksResource,
  createImportResource,
  createIngestAudioResource,
  createPdfResource,
  createRssFeedsResource,
  createWebhooksResource,
} from "./resources/ingest-pdf.ts";
import {
  type CreateMirrorNodeResponse,
  type OutlineNodesResource,
  type PromoteOutlineNodeInput,
  type PromoteOutlineNodeResponse,
  type WorkspaceOutlineNodeMatchDto,
  createOutlineNodesResource,
} from "./resources/outline.ts";
import { type PreferencesResource, createPreferencesResource } from "./resources/preferences.ts";
import { type PublicSitesResource, createPublicSitesResource } from "./resources/public-sites.ts";
import { type CalendarResource, type SyncCalendarSubscriptionResponse, createCalendarResource } from "./resources/calendar.ts";
import {
  type BriefingsResource,
  type ListBriefingJobsResponse,
  type ListBriefingRunsParams,
  createBriefingsResource,
} from "./resources/briefings.ts";
import { type SearchResource, createSearchResource } from "./resources/search.ts";
import { type SpacesResource, createSpacesResource } from "./resources/spaces.ts";
import {
  type BatchUpdateTasksResponse,
  type CreateTaskResponse,
  type ListTasksParams,
  type TasksResource,
  type UpdateTaskResponse,
  type UpsertTaskInput,
  createTasksResource,
} from "./resources/tasks.ts";
import {
  type ListThreadBindingsParams,
  type ThreadBindingsResource,
  createThreadBindingsResource,
} from "./resources/threads.ts";

export type {
  AiResource,
  AiRewriteStreamOptions,
  ApplyTemplateResponse,
  ArtifactsResource,
  AskStreamMetaEvent,
  AskStreamOptions,
  AskStreamResult,
  AttachmentsResource,
  AudioTranscribeMultipartInput,
  AuditLogsResource,
  AuthResource,
  AwaySummaryParams,
  BatchUpdateTasksResponse,
  BootstrapResource,
  BootstrapResponse,
  CalendarResource,
  CleanupOrphanAttachmentsResponse,
  ClipsResource,
  ConnectResource,
  ContextPacksResource,
  CreateDocumentArtifactResponse,
  CreateMirrorNodeResponse,
  CreateTaskResponse,
  CreateTokenResponse,
  DailyOutlineResponse,
  DeleteDocumentArtifactResponse,
  DocumentsResource,
  EmbedChannelAckResponse,
  FetchCredentials,
  FetchLike,
  GetContextPackOptions,
  HealthResponse,
  HighlightCommentsResponse,
  HighlightsResource,
  ImportMultipartInput,
  ImportResource,
  IngestAudioResource,
  IngestClipUrlResponse,
  InkadeClientConfig,
  InkadeConnectionConfig,
  LinkDocumentTargetResponse,
  ListAuditLogsParams,
  ListDocumentsParams,
  ListTasksParams,
  ListThreadBindingsParams,
  OutlineNodesResource,
  PdfResource,
  PreferencesResource,
  BriefingsResource,
  ListBriefingJobsResponse,
  ListBriefingRunsParams,
  PromoteOutlineNodeInput,
  PromoteOutlineNodeResponse,
  PublicSitesResource,
  RevisionDiffResponse,
  RssFeedsResource,
  SavedViewsResource,
  ScopeRulesResource,
  SearchResource,
  SetupOwnerInput,
  SetupOwnerResponse,
  ShareLinksResource,
  SpacesResource,
  SyncCalendarSubscriptionResponse,
  TasksResource,
  TemplatesResource,
  ThreadBindingsResource,
  TokensResource,
  UpdateDocumentArtifactResponse,
  UpdateTaskResponse,
  UpdateViewerContextResponse,
  UploadAttachmentInput,
  UploadAttachmentResponse,
  UploadPdfMultipartInput,
  UpsertTaskInput,
  ViewsResource,
  WebhooksResource,
  WhoAmIScopeResponse,
  WorkspaceOutlineNodeMatchDto,
  WorkspaceResource,
};

/**
 * Typed HTTP API client composed from domain resource clients over `InkadeHttpTransport`.
 */
export class InkadeClient {
  private readonly transport: InkadeHttpTransport;

  readonly artifacts: ArtifactsResource;
  readonly bootstrap: BootstrapResource;
  readonly auth: AuthResource;
  readonly spaces: SpacesResource;
  readonly documents: DocumentsResource;
  readonly outlineNodes: OutlineNodesResource;
  readonly tasks: TasksResource;
  readonly threadBindings: ThreadBindingsResource;
  readonly search: SearchResource;
  readonly tokens: TokensResource;
  readonly scopeRules: ScopeRulesResource;
  readonly attachments: AttachmentsResource;
  readonly workspace: WorkspaceResource;
  readonly clips: ClipsResource;
  readonly highlights: HighlightsResource;
  readonly templates: TemplatesResource;
  readonly shareLinks: ShareLinksResource;
  readonly savedViews: SavedViewsResource;
  readonly views: ViewsResource;
  readonly auditLogs: AuditLogsResource;
  readonly ai: AiResource;
  readonly contextPacks: ContextPacksResource;
  readonly connect: ConnectResource;
  readonly preferences: PreferencesResource;
  readonly calendar: CalendarResource;
  readonly importHub: ImportResource;
  readonly pdf: PdfResource;
  readonly rssFeeds: RssFeedsResource;
  readonly webhooks: WebhooksResource;
  readonly ingestAudio: IngestAudioResource;
  readonly publicSites: PublicSitesResource;
  readonly briefings: BriefingsResource;

  constructor(config: InkadeClientConfig) {
    this.transport = new InkadeHttpTransport(config);
    this.artifacts = createArtifactsResource(this.transport);
    this.bootstrap = createBootstrapResource(this.transport);
    this.auth = createAuthResource(this.transport);
    this.spaces = createSpacesResource(this.transport);
    this.documents = createDocumentsResource(this.transport);
    this.outlineNodes = createOutlineNodesResource(this.transport);
    this.tasks = createTasksResource(this.transport);
    this.threadBindings = createThreadBindingsResource(this.transport);
    this.search = createSearchResource(this.transport);
    this.tokens = createTokensResource(this.transport);
    this.scopeRules = createScopeRulesResource(this.transport);
    this.attachments = createAttachmentsResource(this.transport);
    this.workspace = createWorkspaceResource(this.transport);
    this.clips = createClipsResource(this.transport);
    this.highlights = createHighlightsResource(this.transport);
    this.templates = createTemplatesResource(this.transport);
    this.shareLinks = createShareLinksResource(this.transport);
    this.savedViews = createSavedViewsResource(this.transport);
    this.views = createViewsResource(this.transport);
    this.auditLogs = createAuditLogsResource(this.transport);
    this.ai = createAiResource(this.transport);
    this.contextPacks = createContextPacksResource(this.transport);
    this.connect = createConnectResource(this.transport);
    this.preferences = createPreferencesResource(this.transport);
    this.calendar = createCalendarResource(this.transport);
    this.importHub = createImportResource(this.transport);
    this.pdf = createPdfResource(this.transport);
    this.rssFeeds = createRssFeedsResource(this.transport);
    this.webhooks = createWebhooksResource(this.transport);
    this.ingestAudio = createIngestAudioResource(this.transport);
    this.publicSites = createPublicSitesResource(this.transport);
    this.briefings = createBriefingsResource(this.transport);
  }

  /**
   * Returns a read-only view of the client's transport configuration for downstream SSE/React bindings.
   */
  getConnectionConfig(): InkadeConnectionConfig {
    return this.transport.getConnectionConfig();
  }
}

export function createInkadeClient(config: InkadeClientConfig): InkadeClient {
  return new InkadeClient(config);
}
