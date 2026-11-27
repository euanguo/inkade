import type { DocumentId, WorkspaceId } from "@inkade/core";
import type { InkadeRepositories } from "@inkade/db";
import type { InkadeAuth } from "../auth/better-auth.ts";
import type { TokenScopeCache } from "../cache/token-scope-cache.ts";
import { WorkspaceSpacesCache } from "../cache/workspace-spaces-cache.ts";
import type { ServerLogger } from "../logger.ts";
import type { SseHub } from "../realtime/sse-hub.ts";
import { AiRewriteService, type AiRewriteTestTransport } from "./ai-rewrite-service.ts";
import { AskService, type AskServiceTransport } from "./ask-service.ts";
import { AttachmentService } from "./attachment-service.ts";
import { AuditRollbackService } from "./audit-rollback-service.ts";
import { AuditService } from "./audit-service.ts";
import { BriefingService, type BriefingServiceTransport } from "./briefing-service.ts";
import { BootstrapService } from "./bootstrap-service.ts";
import { CalendarService } from "./calendar-service.ts";
import { ClipperService, type DnsResolver, type FetchFn } from "./clipper-service.ts";
import { ContextPackService } from "./context-pack-service.ts";
import { DocumentService } from "./document-service.ts";
import { ExportService } from "./export-service.ts";
import { HighlightService } from "./highlight-service.ts";
import { ImportService } from "./import-service.ts";
import { IngestService, type IngestServiceTransport } from "./ingest-service.ts";
import { OramaIndexService } from "./orama-index-service.ts";
import { OutlineService } from "./outline-service.ts";
import { PdfService, type PdfServiceTransport } from "./pdf-service.ts";
import { PreferencesService } from "./preferences-service.ts";
import { PublicSiteService } from "./public-site-service.ts";
import { SavedViewService } from "./saved-view-service.ts";
import { ScopeRuleService } from "./scope-rule-service.ts";
import { SearchService } from "./search-service.ts";
import {
  SemanticSearchService,
  type EmbeddingFetchFn,
  type EmbeddingProvider,
} from "./semantic-search-service.ts";
import { ShareService } from "./share-service.ts";
import { SpaceService } from "./space-service.ts";
import { TaskService } from "./task-service.ts";
import { TemplateService } from "./template-service.ts";
import { ThreadBindingService } from "./thread-binding-service.ts";
import { TokenService } from "./token-service.ts";
import { ViewQueryService } from "./view-query-service.ts";
import { ViewerContextStore } from "./viewer-context-store.ts";
import { WakeService } from "./wake-service.ts";
import {
  ArtifactService,
  resolveSandboxRuntimeConfig,
  type SandboxRuntimeConfig,
} from "./artifact-service.ts";
import { WorkspaceService } from "./workspace-service.ts";

export interface InkadeServices {
  readonly artifact: ArtifactService;
  readonly space: SpaceService;
  readonly document: DocumentService;
  readonly outline: OutlineService;
  readonly threadBinding: ThreadBindingService;
  readonly wake: WakeService;
  readonly viewerContext: ViewerContextStore;
  readonly search: SearchService;
  readonly token: TokenService;
  readonly scopeRule: ScopeRuleService;
  readonly attachment: AttachmentService;
  readonly export: ExportService;
  readonly audit: AuditService;
  readonly auditRollback: AuditRollbackService;
  readonly bootstrap: BootstrapService;
  readonly highlight: HighlightService;
  readonly template: TemplateService;
  readonly share: ShareService;
  readonly savedView: SavedViewService;
  readonly workspace: WorkspaceService;
  readonly clipper: ClipperService;
  readonly semanticSearch: SemanticSearchService;
  readonly oramaIndex: OramaIndexService;
  readonly aiRewrite: AiRewriteService;
  readonly ask: AskService;
  readonly contextPack: ContextPackService;
  readonly preferences: PreferencesService;
  readonly task: TaskService;
  readonly calendar: CalendarService;
  readonly viewQuery: ViewQueryService;
  readonly importHub: ImportService;
  readonly pdf: PdfService;
  readonly ingest: IngestService;
  readonly briefing: BriefingService;
  readonly publicSite: PublicSiteService;
}

export interface CreateInkadeServicesDeps {
  readonly repos: InkadeRepositories;
  readonly auth: InkadeAuth;
  readonly sseHub: SseHub;
  readonly dataDir: string;
  readonly defaultWorkspaceId: WorkspaceId;
  readonly localAutoAuth: boolean;
  readonly allowSignup?: boolean | undefined;
  readonly sandboxRuntimeConfig?: SandboxRuntimeConfig | undefined;
  readonly spacesCache?: WorkspaceSpacesCache | undefined;
  readonly tokenScopeCache?: TokenScopeCache | undefined;
  readonly logger?: ServerLogger | undefined;
  readonly clipperResolveDns?: DnsResolver | undefined;
  readonly clipperFetch?: FetchFn | undefined;
  readonly calendarResolveDns?: DnsResolver | undefined;
  readonly calendarFetch?: FetchFn | undefined;
  readonly embeddingProvider?: EmbeddingProvider | undefined;
  readonly embeddingFetch?: EmbeddingFetchFn | undefined;
  readonly aiRewriteTransport?: AiRewriteTestTransport | undefined;
  readonly askTransport?: AskServiceTransport | undefined;
  readonly pdfTransport?: PdfServiceTransport | undefined;
  readonly ingestTransport?: IngestServiceTransport | undefined;
  readonly briefingTransport?: BriefingServiceTransport | undefined;
  readonly onDocumentChanged?: ((workspaceId: WorkspaceId, documentId: DocumentId) => void) | undefined;
}

export function createInkadeServices(deps: CreateInkadeServicesDeps): InkadeServices {
  const spacesCache = deps.spacesCache ?? new WorkspaceSpacesCache(deps.repos.space);
  const audit = new AuditService(deps.repos.audit, deps.repos.space, spacesCache);
  const oramaIndex = new OramaIndexService();
  const semanticSearch = new SemanticSearchService(
    {
      searchConfigRepo: deps.repos.searchConfig,
      documentRepo: deps.repos.document,
      outlineRepo: deps.repos.outline,
      spaceRepo: deps.repos.space,
      attachmentRepo: deps.repos.attachment,
    },
    {
      embeddingProvider: deps.embeddingProvider,
      fetchFn: deps.embeddingFetch,
      spacesCache,
      auditService: audit,
      logger: deps.logger,
      oramaIndex,
    },
  );
  const notifyDocumentChanged = (workspaceId: WorkspaceId, documentId: DocumentId) => {
    semanticSearch.scheduleIndexDocument(workspaceId, documentId);
    deps.onDocumentChanged?.(workspaceId, documentId);
  };

  const wake = new WakeService(
    {
      threadBindingRepo: deps.repos.threadBinding,
      documentRepo: deps.repos.document,
      spaceRepo: deps.repos.space,
      spacesCache,
    },
    deps.sseHub,
  );
  const space = new SpaceService(deps.repos.space, deps.sseHub, spacesCache);
  const outline = new OutlineService(
    {
      tx: deps.repos.tx,
      documentRepo: deps.repos.document,
      outlineRepo: deps.repos.outline,
      revisionLinkRepo: deps.repos.revisionLink,
      workspaceRepo: deps.repos.workspace,
      spaceRepo: deps.repos.space,
      searchConfigRepo: deps.repos.searchConfig,
      spacesCache,
    },
    deps.sseHub,
    notifyDocumentChanged,
    audit,
    wake,
  );
  const document = new DocumentService(
    {
      tx: deps.repos.tx,
      documentRepo: deps.repos.document,
      outlineRepo: deps.repos.outline,
      revisionLinkRepo: deps.repos.revisionLink,
      spaceRepo: deps.repos.space,
      searchConfigRepo: deps.repos.searchConfig,
      spacesCache,
    },
    deps.sseHub,
    notifyDocumentChanged,
    audit,
    (principal, documentId, targetRevisionId, changeSummary) =>
      outline.restoreRevisionSnapshot(principal, documentId, targetRevisionId, changeSummary),
    wake,
  );
  const auditRollback = new AuditRollbackService({
    auditRepo: deps.repos.audit,
    documentRepo: deps.repos.document,
    revisionLinkRepo: deps.repos.revisionLink,
    spaceRepo: deps.repos.space,
    attachmentRepo: deps.repos.attachment,
    searchConfigRepo: deps.repos.searchConfig,
    oramaIndex,
    spacesCache,
    auditService: audit,
    documentService: document,
    outlineService: outline,
    sseHub: deps.sseHub,
  });
  const bootstrap = new BootstrapService({
    workspaceRepo: deps.repos.workspace,
    seedRepos: deps.repos,
    auth: deps.auth,
    defaultWorkspaceId: deps.defaultWorkspaceId,
    localAutoAuth: deps.localAutoAuth,
    allowSignup: deps.allowSignup,
    spacesCache,
  });
  const threadBinding = new ThreadBindingService(
    {
      threadBindingRepo: deps.repos.threadBinding,
      documentRepo: deps.repos.document,
      spaceRepo: deps.repos.space,
      spacesCache,
    },
    deps.sseHub,
    audit,
    wake,
  );
  const search = new SearchService(deps.repos.searchConfig, deps.repos.space, spacesCache);
  const token = new TokenService(
    deps.repos.tokenRule,
    deps.repos.space,
    deps.sseHub,
    spacesCache,
    deps.tokenScopeCache,
  );
  const scopeRule = new ScopeRuleService(deps.repos.tokenRule, deps.repos.space, spacesCache);
  const attachment = new AttachmentService(
    deps.repos.attachment,
    deps.repos.document,
    deps.repos.space,
    deps.dataDir,
    spacesCache,
  );
  const exportService = new ExportService(
    deps.repos.document,
    deps.repos.outline,
    deps.repos.space,
    document,
    audit,
    spacesCache,
    attachment,
  );
  const highlight = new HighlightService(
    deps.repos.revisionLink,
    deps.repos.document,
    deps.repos.space,
    deps.sseHub,
    spacesCache,
    wake,
    deps.repos.threadBinding,
  );
  const template = new TemplateService(
    {
      workspaceRepo: deps.repos.workspace,
      documentRepo: deps.repos.document,
      outlineRepo: deps.repos.outline,
      spaceRepo: deps.repos.space,
      spacesCache,
    },
    deps.sseHub,
    document,
    outline,
    audit,
  );
  const share = new ShareService(
    deps.repos.space,
    deps.repos.document,
    deps.repos.outline,
    deps.sseHub,
    spacesCache,
    deps.repos.attachment,
  );
  const savedView = new SavedViewService(
    deps.repos.workspace,
    deps.repos.space,
    deps.sseHub,
    spacesCache,
  );
  const workspace = new WorkspaceService(
    {
      documentRepo: deps.repos.document,
      outlineRepo: deps.repos.outline,
      revisionLinkRepo: deps.repos.revisionLink,
      threadBindingRepo: deps.repos.threadBinding,
      auditRepo: deps.repos.audit,
      spaceRepo: deps.repos.space,
      searchConfigRepo: deps.repos.searchConfig,
      spacesCache,
    },
    document,
  );
  const publicSite = new PublicSiteService(
    {
      spaceRepo: deps.repos.space,
      workspaceRepo: deps.repos.workspace,
      documentRepo: deps.repos.document,
      outlineRepo: deps.repos.outline,
      revisionLinkRepo: deps.repos.revisionLink,
      attachmentRepo: deps.repos.attachment,
      spacesCache,
    },
    deps.sseHub,
  );
  const clipper = new ClipperService({
    spaceRepo: deps.repos.space,
    documentRepo: deps.repos.document,
    revisionLinkRepo: deps.repos.revisionLink,
    threadBindingRepo: deps.repos.threadBinding,
    spacesCache,
    logger: deps.logger,
    documentService: document,
    attachmentService: attachment,
    resolveDns: deps.clipperResolveDns,
    fetchFn: deps.clipperFetch,
  });
  const aiRewrite = new AiRewriteService(
    {
      searchConfigRepo: deps.repos.searchConfig,
      documentRepo: deps.repos.document,
      spaceRepo: deps.repos.space,
      spacesCache,
    },
    audit,
    deps.aiRewriteTransport,
  );
  const preferences = new PreferencesService(deps.repos.searchConfig, deps.sseHub);
  const task = new TaskService(
    {
      outlineRepo: deps.repos.outline,
      documentRepo: deps.repos.document,
      spaceRepo: deps.repos.space,
      spacesCache,
    },
    outline,
    document,
  );
  const calendar = new CalendarService(
    {
      searchConfigRepo: deps.repos.searchConfig,
      spaceRepo: deps.repos.space,
      spacesCache,
    },
    deps.sseHub,
    {
      fetchFn: deps.calendarFetch ?? deps.clipperFetch,
      resolveDns: deps.calendarResolveDns ?? deps.clipperResolveDns,
    },
  );
  const viewQuery = new ViewQueryService(deps.repos.document, deps.repos.space, spacesCache);
  const ask = new AskService(
    {
      searchConfigRepo: deps.repos.searchConfig,
      documentRepo: deps.repos.document,
      spaceRepo: deps.repos.space,
      workspaceRepo: deps.repos.workspace,
      semanticSearch,
      viewQuery,
      spacesCache,
    },
    audit,
    deps.askTransport ?? deps.aiRewriteTransport,
  );
  const contextPack = new ContextPackService(
    {
      searchConfigRepo: deps.repos.searchConfig,
      documentRepo: deps.repos.document,
      outlineRepo: deps.repos.outline,
      spaceRepo: deps.repos.space,
      workspaceRepo: deps.repos.workspace,
      tokenRuleRepo: deps.repos.tokenRule,
      auditRepo: deps.repos.audit,
      viewQuery,
      spacesCache,
    },
    deps.sseHub,
    audit,
  );

  const importHub = new ImportService({
    documentRepo: deps.repos.document,
    revisionLinkRepo: deps.repos.revisionLink,
    spaceRepo: deps.repos.space,
    spacesCache,
    documentService: document,
    attachmentService: attachment,
    auditService: audit,
    sseHub: deps.sseHub,
    onDocumentChanged: notifyDocumentChanged,
  });
  const pdf = new PdfService(
    {
      attachmentRepo: deps.repos.attachment,
      documentRepo: deps.repos.document,
      outlineRepo: deps.repos.outline,
      spaceRepo: deps.repos.space,
      searchConfigRepo: deps.repos.searchConfig,
      attachmentService: attachment,
      documentService: document,
      outlineService: outline,
      sseHub: deps.sseHub,
      spacesCache,
      onDocumentChanged: notifyDocumentChanged,
    },
    deps.pdfTransport,
  );
  const ingest = new IngestService(
    {
      searchConfigRepo: deps.repos.searchConfig,
      attachmentRepo: deps.repos.attachment,
      documentRepo: deps.repos.document,
      spaceRepo: deps.repos.space,
      spacesCache,
      documentService: document,
      outlineService: outline,
      attachmentService: attachment,
      auditService: audit,
      sseHub: deps.sseHub,
      onDocumentChanged: notifyDocumentChanged,
    },
    deps.ingestTransport,
  );
  const briefing = new BriefingService(
    {
      threadBindingRepo: deps.repos.threadBinding,
      documentRepo: deps.repos.document,
      outlineRepo: deps.repos.outline,
      spaceRepo: deps.repos.space,
      tokenRuleRepo: deps.repos.tokenRule,
      searchConfigRepo: deps.repos.searchConfig,
      revisionLinkRepo: deps.repos.revisionLink,
      documentService: document,
      outlineService: outline,
      contextPackService: contextPack,
      semanticSearch,
      threadBindingService: threadBinding,
      auditService: audit,
      sseHub: deps.sseHub,
      spacesCache,
      onDocumentChanged: notifyDocumentChanged,
    },
    deps.briefingTransport,
  );
  const viewerContext = new ViewerContextStore({
    documentRepo: deps.repos.document,
    spaceRepo: deps.repos.space,
    spacesCache,
  });
  const artifact = new ArtifactService(
    {
      attachmentRepo: deps.repos.attachment,
      documentRepo: deps.repos.document,
      spaceRepo: deps.repos.space,
      tokenRuleRepo: deps.repos.tokenRule,
      spacesCache,
      tokenScopeCache: deps.tokenScopeCache,
    },
    {
      sseHub: deps.sseHub,
      runtimeConfig: deps.sandboxRuntimeConfig ?? resolveSandboxRuntimeConfig(),
      viewQueryService: viewQuery,
      attachmentService: attachment,
      highlightService: highlight,
      documentService: document,
      auditService: audit,
    },
  );

  return {
    artifact,
    space,
    document,
    outline,
    threadBinding,
    wake,
    viewerContext,
    search,
    token,
    scopeRule,
    attachment,
    export: exportService,
    audit,
    auditRollback,
    bootstrap,
    highlight,
    template,
    share,
    savedView,
    workspace,
    clipper,
    semanticSearch,
    oramaIndex,
    aiRewrite,
    ask,
    contextPack,
    preferences,
    task,
    calendar,
    viewQuery,
    importHub,
    pdf,
    ingest,
    briefing,
    publicSite,
  };
}

export {
  AiRewriteService,
  ArtifactService,
  AskService,
  AttachmentService,
  AuditRollbackService,
  AuditService,
  BootstrapService,
  BriefingService,
  CalendarService,
  ClipperService,
  ContextPackService,
  DocumentService,
  ExportService,
  HighlightService,
  ImportService,
  IngestService,
  OramaIndexService,
  OutlineService,
  PdfService,
  PreferencesService,
  PublicSiteService,
  resolveSandboxRuntimeConfig,
  SavedViewService,
  ScopeRuleService,
  SearchService,
  SemanticSearchService,
  ShareService,
  SpaceService,
  TaskService,
  TemplateService,
  ThreadBindingService,
  TokenService,
  ViewQueryService,
  ViewerContextStore,
  WakeService,
  WorkspaceService,
};
export type { BriefingServiceTransport } from "./briefing-service.ts";
export type { BridgeRequestContext, EnqueueWakeInput } from "./wake-service.ts";
