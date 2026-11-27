import type { HostToInkadeMessage, InkadeToHostMessage } from "./embed-bridge.ts";
import type { AuditRollbackResult, BatchRollbackResult } from "./agent-control.ts";
import type {
  ApiTokenId,
  AuditBatchId,
  BriefingJobId,
  BriefingRunId,
  CalendarSubId,
  ContextPackId,
  DocumentArtifactId,
  DocumentAssetId,
  DocumentId,
  EventId,
  HighlightId,
  IngestWebhookId,
  OutlineNodeId,
  RssFeedId,
  SavedViewId,
  SpaceId,
  TemplateId,
  ThreadBindingId,
  UserId,
  WakeEventId,
  WorkspaceId,
} from "./ids.ts";
import type {
  BridgeSessionRecord,
  WakeDeliveryStatus,
  WakeEnvelope,
} from "./wake.ts";
import type {
  ActorType,
  AdeThreadBinding,
  AgentApprovalDecision,
  AgentBriefingRunRecord,
  AgentSteeringNote,
  ApiTokenRecord,
  BriefingTargetConfig,
  DocumentHighlight,
  DocumentKind,
  DocumentRecord,
  DocumentTemplate,
  HighlightComment,
  OutlineNode,
  SavedView,
  ScopeEffectiveSummary,
  ShareLink,
  Space,
  SpacePropertySchema,
} from "./types/index.ts";

export interface AgentToolActivityPayload {
  readonly invocationId: string;
  readonly transport: "mcp" | "rest";
  readonly toolName: string;
  readonly tokenId: ApiTokenId | null;
  readonly tokenName: string | null;
  readonly mutating: boolean;
  readonly status?: "ok" | "error" | "denied" | undefined;
  readonly durationMs?: number | undefined;
}

export interface InkadeEventPayloadMap {
  readonly "document.created": { readonly document: DocumentRecord };
  readonly "document.updated": { readonly document: DocumentRecord };
  readonly "document.trashed": { readonly document: DocumentRecord };
  readonly "document.restored": { readonly document: DocumentRecord };
  readonly "document.deleted": { readonly documentId: DocumentId };
  readonly "outline.node.created": { readonly node: OutlineNode };
  readonly "outline.node.updated": { readonly node: OutlineNode };
  readonly "outline.node.moved": { readonly node: OutlineNode };
  readonly "outline.node.deleted": {
    readonly nodeIds: readonly OutlineNodeId[];
    readonly nodes: readonly OutlineNode[];
  };
  readonly "outline.batch_mutated": {
    readonly documentId: DocumentId;
    readonly tempIdMap: Readonly<Record<string, OutlineNodeId>>;
    readonly createdIds: readonly OutlineNodeId[];
    readonly updatedIds: readonly OutlineNodeId[];
    readonly movedIds: readonly OutlineNodeId[];
    readonly deletedIds: readonly OutlineNodeId[];
  };
  readonly "outline.rolled_over": {
    readonly fromDocumentId: DocumentId;
    readonly toDocumentId: DocumentId;
    readonly nodes: readonly OutlineNode[];
  };
  readonly "thread.binding.created": { readonly binding: AdeThreadBinding };
  readonly "thread.binding.updated": { readonly binding: AdeThreadBinding };
  readonly "thread.binding.claimed": { readonly binding: AdeThreadBinding };
  readonly "thread.binding.approved": {
    readonly binding: AdeThreadBinding;
    readonly decision: AgentApprovalDecision;
    readonly alwaysAllow: boolean;
  };
  readonly "thread.binding.steered": {
    readonly binding: AdeThreadBinding;
    readonly note: AgentSteeringNote;
  };
  readonly "thread.binding.deleted": {
    readonly bindingId: ThreadBindingId;
    readonly documentId: DocumentId;
  };
  readonly "audit.rolled_back": AuditRollbackResult;
  readonly "audit.batch_rolled_back": BatchRollbackResult;
  readonly "highlight.created": { readonly highlight: DocumentHighlight };
  readonly "highlight.updated": { readonly highlight: DocumentHighlight };
  readonly "highlight.deleted": {
    readonly highlightId: HighlightId;
    readonly documentId: DocumentId;
  };
  readonly "highlight.comment.created": {
    readonly highlight: DocumentHighlight;
    readonly comment: HighlightComment;
  };
  readonly "highlight.resolved": {
    readonly highlight: DocumentHighlight;
    readonly resolved: boolean;
  };
  readonly "template.created": { readonly template: DocumentTemplate };
  readonly "template.updated": { readonly template: DocumentTemplate };
  readonly "template.deleted": { readonly templateId: TemplateId };
  readonly "share.created": { readonly shareLink: ShareLink };
  readonly "share.revoked": { readonly shareLink: ShareLink };
  readonly "saved_view.created": { readonly savedView: SavedView };
  readonly "saved_view.updated": { readonly savedView: SavedView };
  readonly "saved_view.deleted": { readonly viewId: SavedViewId };
  readonly "space.created": { readonly space: Space };
  readonly "space.updated": { readonly space: Space };
  readonly "space.archived": { readonly space: Space };
  readonly "calendar.subscription.updated": {
    readonly action: "created" | "updated" | "deleted" | "synced";
    readonly subscriptionId: CalendarSubId;
  };
  readonly "space_schema.updated": {
    readonly spaceId: SpaceId | null;
    readonly schema: SpacePropertySchema;
  };
  readonly "token.updated": {
    readonly action: "created" | "updated" | "revoked";
    readonly token: ApiTokenRecord;
  };
  readonly "preferences.updated": {
    readonly principalKey: string;
    readonly updatedAt: string | null;
  };
  readonly "context_pack.updated": {
    readonly action: "created" | "updated" | "deleted";
    readonly packId: ContextPackId;
    readonly slug?: string | undefined;
  };
  readonly "document_asset.updated": {
    readonly action: "created" | "updated" | "deleted";
    readonly assetId: DocumentAssetId;
    readonly companionDocumentId: DocumentId | null;
  };
  readonly "document_artifact.updated": {
    readonly action: "created" | "updated" | "deleted";
    readonly artifactId: DocumentArtifactId;
    readonly documentId: DocumentId;
  };
  readonly "rss_feed.updated": {
    readonly action: "created" | "updated" | "deleted" | "synced";
    readonly feedId: RssFeedId;
  };
  readonly "ingest_webhook.updated": {
    readonly action: "created" | "updated" | "deleted" | "ingested";
    readonly webhookId: IngestWebhookId;
  };
  readonly "import.committed": {
    readonly batchId: AuditBatchId;
    readonly createdCount: number;
    readonly updatedCount: number;
  };
  readonly "agent.tool.started": AgentToolActivityPayload;
  readonly "agent.tool.finished": AgentToolActivityPayload;
  readonly "briefing.job.updated": {
    readonly action: "created" | "updated" | "deleted";
    readonly jobId: BriefingJobId;
  };
  readonly "briefing.succeeded": {
    readonly run: AgentBriefingRunRecord;
  };
  readonly "briefing.failed": {
    readonly run: AgentBriefingRunRecord;
  };
  readonly "briefing.dismissed": {
    readonly runId: BriefingRunId;
    readonly jobId: BriefingJobId;
  };
  readonly "briefing.wakeup": {
    readonly runId: BriefingRunId;
    readonly jobId: BriefingJobId;
    readonly jobName: string;
    readonly batchId: AuditBatchId;
    readonly bindingId: ThreadBindingId | null;
    readonly prompt: string;
    readonly allowedDocumentIds: readonly DocumentId[];
    readonly contextPackSlugs: readonly string[];
    readonly target: BriefingTargetConfig;
    readonly scopeSummary: ScopeEffectiveSummary;
  };
  readonly "wake.enqueued": {
    readonly wake: WakeEnvelope;
  };
  readonly "wake.acked": {
    readonly wakeId: WakeEventId;
    readonly bindingId: ThreadBindingId | null;
    readonly documentId: DocumentId;
    readonly deliveryStatus: WakeDeliveryStatus;
    readonly ackedAt: string | null;
  };
  readonly "bridge.session.updated": {
    readonly action: "heartbeat" | "offline";
    readonly session: BridgeSessionRecord;
  };
  readonly "embed.shell_event":
    | {
        readonly direction: "host_to_inkade";
        readonly embedSessionId: string | null;
        readonly targetTokenId?: ApiTokenId | null | undefined;
        readonly targetUserId?: UserId | null | undefined;
        readonly message: HostToInkadeMessage;
      }
    | {
        readonly direction: "inkade_to_host";
        readonly embedSessionId: string | null;
        readonly targetTokenId?: ApiTokenId | null | undefined;
        readonly targetUserId?: UserId | null | undefined;
        readonly message: InkadeToHostMessage;
      };
}

export type InkadeEventType = keyof InkadeEventPayloadMap;

export interface InkadeEventEnvelopeBase {
  readonly seq: number;
  readonly eventId: EventId;
  readonly workspaceId: WorkspaceId;
  readonly spaceId: SpaceId | null;
  readonly documentId?: DocumentId | undefined;
  readonly documentKind?: DocumentKind | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly actorType: ActorType;
  readonly timestamp: string;
}

export type InkadeEvent<K extends InkadeEventType = InkadeEventType> = {
  [T in K]: InkadeEventEnvelopeBase & {
    readonly type: T;
    readonly payload: InkadeEventPayloadMap[T];
  };
}[K];

export type PublishableInkadeEvent<K extends InkadeEventType = InkadeEventType> = {
  [T in K]: Omit<InkadeEvent<T>, "seq" | "eventId" | "timestamp">;
}[K];

export type InkadeEventEnvelope<K extends InkadeEventType = InkadeEventType> = InkadeEvent<K>;

/**
 * Abstraction boundary reserved for local-first Yjs sync without rewriting UI surfaces.
 */
export interface SyncAdapter {
  readonly kind: "sse-optimistic" | "yjs-indexeddb";
  connect(workspaceId: WorkspaceId): Promise<void>;
  disconnect(): Promise<void>;
}
