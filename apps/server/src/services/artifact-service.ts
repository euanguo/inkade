import {
  buildCompactDiffPreview,
  buildSandboxArtifactOrigin,
  buildSandboxCspHeader,
  evaluateScopeAccess,
  formatInkadeArtifactFence,
  InkadeError,
  isLocalDevSandboxHostname,
  isLoopbackHostname,
  normalizeHostnameInput,
  sanitizeExtraFrameAncestors,
  validateArtifactHtml,
  validateDualOriginConfig,
  viewQueryRequestSchema,
  type ArtifactCapabilities,
  type ArtifactHtmlValidationResult,
  type ArtifactSandboxResolvedPayload,
  type ArtifactSandboxTicket,
  type DocumentArtifact,
  type DocumentArtifactId,
  type DocumentArtifactSummary,
  type DocumentId,
  type DocumentRecord,
  type ParsedCreateDocumentArtifactInput,
  type ParsedUpdateDocumentArtifactInput,
  type ParsedValidateDocumentArtifactInput,
  type ResolvedArtifactSourceSnapshot,
  type SandboxIsolationMode,
  type SandboxRuntimeConfigStatus,
  type SendHighlightToAgentResult,
  type SubmitArtifactCommentInput,
  type ValidatedDualOriginConfig,
  type ViewQueryResponse,
} from "@inkade/core";
import type { AttachmentRepo, DocumentRepo, SpaceRepo, TokenRuleRepo } from "@inkade/db";
import { resolveCurrentPrincipalScope } from "../auth/principal.ts";
import { sha256Hex } from "../auth/tokens.ts";
import type { TokenScopeCache } from "../cache/token-scope-cache.ts";
import type { WorkspaceSpacesCache } from "../cache/workspace-spaces-cache.ts";
import type { SseHub } from "../realtime/sse-hub.ts";
import type { Principal } from "../types.ts";
import type { AttachmentService } from "./attachment-service.ts";
import type { AuditService } from "./audit-service.ts";
import type { DocumentService } from "./document-service.ts";
import type { HighlightService } from "./highlight-service.ts";
import { assertScope, getAllWorkspaceSpaces } from "./scope-guard.ts";
import type { ViewQueryService } from "./view-query-service.ts";

export const DEFAULT_SANDBOX_TICKET_TTL_MS = 120_000;
const DEFAULT_MAX_SANDBOX_TICKETS = 10_000;
const MAX_TEXT_ATTACHMENT_SOURCE_BYTES = 256 * 1024;

export interface SandboxRuntimeConfig {
  readonly mode: SandboxIsolationMode;
  readonly appOrigin: string;
  readonly appHostname: string;
  readonly sandboxOriginPattern: string;
  readonly configuredSandboxOrigin: string | undefined;
  readonly hasExplicitAppOrigin: boolean;
  readonly sameSite: boolean;
  readonly allowedNetworkOrigins: readonly string[];
  readonly extraFrameAncestors: readonly string[];
  readonly hostCookiePrefixEnabled: boolean;
  readonly validated: ValidatedDualOriginConfig;
}

export interface ResolveSandboxRuntimeConfigOptions {
  readonly appOrigin?: string | undefined;
  readonly baseURL?: string | undefined;
  readonly sandboxOrigin?: string | undefined;
  readonly sandboxSameSite?: boolean | undefined;
  readonly sandboxAllowedNetworkOrigins?: readonly string[] | undefined;
  readonly frameAncestors?: string | undefined;
}

function parseAllowedHttpsNetworkOrigins(
  explicit?: readonly string[],
  envRaw?: string,
): readonly string[] {
  const candidates = explicit ?? (envRaw ? envRaw.split(",") : []);
  const out = new Set<string>();
  for (const item of candidates) {
    const trimmed = item.trim();
    if (!trimmed) continue;
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol === "https:" && !parsed.username && !parsed.password) {
        out.add(parsed.origin);
      }
    } catch {
      // Ignore malformed env entries
    }
  }
  return [...out];
}

export function resolveSandboxRuntimeConfig(
  options: ResolveSandboxRuntimeConfigOptions = {},
): SandboxRuntimeConfig {
  const explicitApp =
    options.appOrigin?.trim() ||
    process.env.INKADE_APP_ORIGIN?.trim() ||
    options.baseURL?.trim() ||
    process.env.INKADE_BASE_URL?.trim();
  const appOriginInput = explicitApp || "http://localhost:3456";
  const configuredSandboxOrigin =
    options.sandboxOrigin?.trim() || process.env.INKADE_SANDBOX_ORIGIN?.trim() || undefined;
  const sameSiteOptIn =
    options.sandboxSameSite ?? process.env.INKADE_SANDBOX_SAME_SITE === "true";

  const validated = validateDualOriginConfig({
    appOrigin: appOriginInput,
    sandboxOrigin: configuredSandboxOrigin,
    sameSiteOptIn,
  });

  const allowedNetworkOrigins = parseAllowedHttpsNetworkOrigins(
    options.sandboxAllowedNetworkOrigins,
    process.env.INKADE_SANDBOX_ALLOWED_NETWORK_ORIGINS,
  );
  const extraFrameAncestors = sanitizeExtraFrameAncestors(
    options.frameAncestors ?? process.env.INKADE_FRAME_ANCESTORS,
  );
  const appHostname = normalizeHostnameInput(new URL(validated.appOrigin).hostname);

  return {
    mode: validated.mode,
    appOrigin: validated.appOrigin,
    appHostname,
    sandboxOriginPattern: validated.sandboxOriginPattern,
    configuredSandboxOrigin,
    hasExplicitAppOrigin: Boolean(explicitApp),
    sameSite: validated.mode === "same_site",
    allowedNetworkOrigins,
    extraFrameAncestors,
    hostCookiePrefixEnabled:
      validated.mode === "same_site" && validated.appOrigin.startsWith("https://"),
    validated,
  };
}

function randomBase64Url(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function tryParseOrigin(raw?: string | null): URL | null {
  if (!raw) return null;
  try {
    const parsed = new URL(raw.trim());
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

interface SandboxTicketEntry {
  readonly principal: Principal;
  readonly artifactId: DocumentArtifactId;
  readonly documentId: DocumentId;
  readonly appOrigin: string;
  readonly sandboxOrigin: string;
  readonly mode: SandboxIsolationMode;
  readonly sameSite: boolean;
  readonly expiresAtMs: number;
}

export interface ArtifactServiceRepos {
  readonly attachmentRepo: AttachmentRepo;
  readonly documentRepo: DocumentRepo;
  readonly spaceRepo: SpaceRepo;
  readonly tokenRuleRepo?: TokenRuleRepo | undefined;
  readonly spacesCache?: WorkspaceSpacesCache | undefined;
  readonly tokenScopeCache?: TokenScopeCache | undefined;
}

export interface ArtifactServiceDeps {
  readonly sseHub: SseHub;
  readonly runtimeConfig: SandboxRuntimeConfig;
  readonly viewQueryService?: ViewQueryService | undefined;
  readonly attachmentService?: AttachmentService | undefined;
  readonly highlightService?: HighlightService | undefined;
  readonly documentService?: DocumentService | undefined;
  readonly auditService?: AuditService | undefined;
  readonly ticketTtlMs?: number | undefined;
}

export interface ArtifactCreationResult {
  readonly artifact: DocumentArtifact;
  readonly validation: ArtifactHtmlValidationResult;
  readonly fenceMarkdown: string;
  readonly document?: DocumentRecord | undefined;
}

export interface ArtifactUpdateResult {
  readonly artifact: DocumentArtifact;
  readonly validation: ArtifactHtmlValidationResult;
}

export class ArtifactService {
  private readonly tickets = new Map<string, SandboxTicketEntry>();
  private readonly ticketTtlMs: number;

  constructor(
    private readonly repos: ArtifactServiceRepos,
    private readonly deps: ArtifactServiceDeps,
  ) {
    this.ticketTtlMs = deps.ticketTtlMs ?? DEFAULT_SANDBOX_TICKET_TTL_MS;
  }

  getRuntimeConfigStatus(): SandboxRuntimeConfigStatus {
    const cfg = this.deps.runtimeConfig;
    return {
      mode: cfg.mode,
      appOrigin: cfg.appOrigin,
      sandboxOriginPattern: cfg.sandboxOriginPattern,
      sameSite: cfg.sameSite,
      allowedNetworkOrigins: cfg.allowedNetworkOrigins,
      hostCookiePrefixEnabled: cfg.hostCookiePrefixEnabled,
    };
  }

  validateArtifact(input: ParsedValidateDocumentArtifactInput): ArtifactHtmlValidationResult {
    const base = validateArtifactHtml(input.htmlSource, input.capabilities);
    const warnings = [...base.warnings];
    if (Array.isArray(input.capabilities.network) && input.capabilities.network.length > 0) {
      const allowedSet = new Set(this.deps.runtimeConfig.allowedNetworkOrigins);
      for (const raw of input.capabilities.network) {
        const parsed = tryParseOrigin(raw);
        if (parsed && !allowedSet.has(parsed.origin)) {
          warnings.push(
            `Origin "${parsed.origin}" is not in INKADE_SANDBOX_ALLOWED_NETWORK_ORIGINS and will be blocked by CSP connect-src at runtime.`,
          );
        }
      }
    }
    return {
      ...base,
      warnings,
    };
  }

  private async loadAuthorizedDocument(
    principal: Principal,
    documentId: DocumentId,
    action: "read" | "append" | "write" | "soft_delete",
  ): Promise<DocumentRecord> {
    const [doc, allSpaces] = await Promise.all([
      this.repos.documentRepo.getDocumentById(principal.workspaceId, documentId),
      getAllWorkspaceSpaces(
        this.repos.spacesCache ?? this.repos.spaceRepo,
        principal.workspaceId,
      ),
    ]);
    if (!doc || doc.trashedAt !== null) {
      throw new InkadeError("NOT_FOUND", `Document "${documentId}" not found`);
    }
    assertScope(
      principal.scope,
      action,
      { spaceId: doc.spaceId, kind: doc.kind, tags: doc.tags },
      allSpaces,
    );
    return doc;
  }

  private async loadAuthorizedArtifact(
    principal: Principal,
    artifactId: DocumentArtifactId,
    action: "read" | "append" | "write" | "soft_delete",
  ): Promise<{ readonly artifact: DocumentArtifact; readonly doc: DocumentRecord }> {
    const artifact = await this.repos.attachmentRepo.getDocumentArtifactById(
      principal.workspaceId,
      artifactId,
    );
    if (!artifact) {
      throw new InkadeError("NOT_FOUND", `Artifact "${artifactId}" not found`);
    }
    const doc = await this.loadAuthorizedDocument(principal, artifact.documentId, action);
    return { artifact, doc };
  }

  private async assertSourcesAccessible(
    principal: Principal,
    sources: ParsedCreateDocumentArtifactInput["sources"],
  ): Promise<void> {
    if (!sources || sources.length === 0) return;
    const allSpaces = await getAllWorkspaceSpaces(
      this.repos.spacesCache ?? this.repos.spaceRepo,
      principal.workspaceId,
    );
    for (const src of sources) {
      if (src.kind === "document") {
        const doc = await this.repos.documentRepo.getDocumentById(
          principal.workspaceId,
          src.documentId,
        );
        if (!doc || doc.trashedAt !== null) {
          throw new InkadeError("NOT_FOUND", `Source document "${src.documentId}" not found`);
        }
        assertScope(
          principal.scope,
          "read",
          { spaceId: doc.spaceId, kind: doc.kind, tags: doc.tags },
          allSpaces,
        );
      } else if (src.kind === "attachment" && this.deps.attachmentService) {
        await this.deps.attachmentService.getAttachment(principal, src.attachmentId);
      }
    }
  }

  async listArtifacts(
    principal: Principal,
    documentId: DocumentId,
  ): Promise<readonly DocumentArtifactSummary[]> {
    await this.loadAuthorizedDocument(principal, documentId, "read");
    return this.repos.attachmentRepo.listDocumentArtifactsByDocument(
      principal.workspaceId,
      documentId,
    );
  }

  async getArtifact(
    principal: Principal,
    artifactId: DocumentArtifactId,
  ): Promise<DocumentArtifact> {
    const { artifact } = await this.loadAuthorizedArtifact(principal, artifactId, "read");
    return artifact;
  }

  async createArtifact(
    principal: Principal,
    documentId: DocumentId,
    input: ParsedCreateDocumentArtifactInput,
  ): Promise<ArtifactCreationResult> {
    const doc = await this.loadAuthorizedDocument(principal, documentId, "write");
    const validation = this.validateArtifact({
      htmlSource: input.htmlSource,
      capabilities: input.capabilities,
    });
    if (!validation.valid) {
      throw new InkadeError("VALIDATION_ERROR", validation.errors.join("; "), {
        errors: validation.errors,
        warnings: validation.warnings,
      });
    }

    await this.assertSourcesAccessible(principal, input.sources);

    const sha256 = await sha256Hex(input.htmlSource);
    const artifact = await this.repos.attachmentRepo.createDocumentArtifact(
      principal.workspaceId,
      {
        documentId: doc.id,
        title: input.title,
        htmlSource: input.htmlSource,
        capabilities: input.capabilities,
        sources: input.sources,
        fallbackMarkdown: input.fallbackMarkdown,
        heightPx: input.heightPx,
        sha256,
      },
    );

    const fenceMarkdown = formatInkadeArtifactFence({
      id: artifact.id,
      title: artifact.title,
      height: artifact.heightPx,
    });

    let updatedDoc: DocumentRecord | undefined;
    if (input.appendFenceToDocument === true && this.deps.documentService) {
      const base = doc.contentMarkdown.trimEnd();
      const nextMarkdown = base ? `${base}\n\n${fenceMarkdown}\n` : `${fenceMarkdown}\n`;
      updatedDoc = await this.deps.documentService.updateDocument(principal, doc.id, {
        contentMarkdown: nextMarkdown,
        expectedVersion: doc.version,
        changeSummary: `Embedded interactive artifact "${artifact.title}" (${artifact.id})`,
      });
    }

    await this.deps.auditService?.captureOrRecord(principal, {
      spaceId: doc.spaceId,
      documentId: doc.id,
      diffPreview: buildCompactDiffPreview("", artifact.fallbackMarkdown),
      reversible: false,
      irreversibleReason: "Interactive artifact record created",
      summary: `Created artifact "${artifact.title}" (${artifact.id})`,
      fallbackAction: "artifact.create",
      fallbackResource: `artifact:${artifact.id}`,
    });

    this.deps.sseHub.publish({
      type: "document_artifact.updated",
      workspaceId: principal.workspaceId,
      spaceId: doc.spaceId,
      documentId: doc.id,
      documentKind: doc.kind,
      tags: doc.tags,
      actorType: principal.actorType,
      payload: {
        action: "created",
        artifactId: artifact.id,
        documentId: doc.id,
      },
    });

    return {
      artifact,
      validation,
      fenceMarkdown,
      ...(updatedDoc ? { document: updatedDoc } : {}),
    };
  }

  async updateArtifact(
    principal: Principal,
    artifactId: DocumentArtifactId,
    input: ParsedUpdateDocumentArtifactInput,
    options?: { readonly requireIfMatch?: boolean | undefined },
  ): Promise<ArtifactUpdateResult> {
    const { artifact: existing, doc } = await this.loadAuthorizedArtifact(
      principal,
      artifactId,
      "write",
    );

    if (options?.requireIfMatch && !input.ifMatchSha256) {
      throw new InkadeError(
        "VALIDATION_ERROR",
        "ifMatchSha256 is required when updating a document artifact",
      );
    }

    if (input.ifMatchSha256 !== undefined && input.ifMatchSha256 !== existing.sha256) {
      throw new InkadeError(
        "VERSION_CONFLICT",
        `Artifact "${artifactId}" sha256 conflict: expected ${input.ifMatchSha256}, current is ${existing.sha256}`,
        {
          artifactId,
          documentId: existing.documentId,
          expectedSha256: input.ifMatchSha256,
          currentSha256: existing.sha256,
          currentVersion: existing.version,
        },
      );
    }

    const nextHtmlSource = input.htmlSource ?? existing.htmlSource;
    const nextCapabilities: ArtifactCapabilities = input.capabilities ?? existing.capabilities;
    const validation = this.validateArtifact({
      htmlSource: nextHtmlSource,
      capabilities: nextCapabilities,
    });
    if (!validation.valid) {
      throw new InkadeError("VALIDATION_ERROR", validation.errors.join("; "), {
        errors: validation.errors,
        warnings: validation.warnings,
      });
    }

    if (input.sources !== undefined) {
      await this.assertSourcesAccessible(principal, input.sources);
    }

    const nextSha256 =
      input.htmlSource !== undefined ? await sha256Hex(nextHtmlSource) : existing.sha256;

    const updated = await this.repos.attachmentRepo.updateDocumentArtifact(
      principal.workspaceId,
      artifactId,
      {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.htmlSource !== undefined ? { htmlSource: input.htmlSource } : {}),
        ...(input.capabilities !== undefined ? { capabilities: input.capabilities } : {}),
        ...(input.sources !== undefined ? { sources: input.sources } : {}),
        ...(input.fallbackMarkdown !== undefined
          ? { fallbackMarkdown: input.fallbackMarkdown }
          : {}),
        ...(input.heightPx !== undefined ? { heightPx: input.heightPx } : {}),
        sha256: nextSha256,
      },
    );

    await this.deps.auditService?.captureOrRecord(principal, {
      spaceId: doc.spaceId,
      documentId: doc.id,
      diffPreview: buildCompactDiffPreview(existing.fallbackMarkdown, updated.fallbackMarkdown),
      reversible: false,
      irreversibleReason: "Interactive artifact revision updated",
      summary: `Updated artifact "${updated.title}" (${updated.id} v${updated.version})`,
      fallbackAction: "artifact.update",
      fallbackResource: `artifact:${updated.id}`,
    });

    this.deps.sseHub.publish({
      type: "document_artifact.updated",
      workspaceId: principal.workspaceId,
      spaceId: doc.spaceId,
      documentId: doc.id,
      documentKind: doc.kind,
      tags: doc.tags,
      actorType: principal.actorType,
      payload: {
        action: "updated",
        artifactId: updated.id,
        documentId: doc.id,
      },
    });

    return { artifact: updated, validation };
  }

  async deleteArtifact(
    principal: Principal,
    artifactId: DocumentArtifactId,
  ): Promise<{ readonly deleted: boolean; readonly id: DocumentArtifactId }> {
    const { doc } = await this.loadAuthorizedArtifact(principal, artifactId, "soft_delete");
    const deleted = await this.repos.attachmentRepo.softDeleteDocumentArtifact(
      principal.workspaceId,
      artifactId,
    );

    await this.deps.auditService?.captureOrRecord(principal, {
      spaceId: doc.spaceId,
      documentId: doc.id,
      reversible: false,
      irreversibleReason: "Soft-deleted interactive artifact",
      summary: `Deleted artifact "${deleted.title}" (${deleted.id})`,
      fallbackAction: "artifact.delete",
      fallbackResource: `artifact:${deleted.id}`,
    });

    this.deps.sseHub.publish({
      type: "document_artifact.updated",
      workspaceId: principal.workspaceId,
      spaceId: doc.spaceId,
      documentId: doc.id,
      documentKind: doc.kind,
      tags: doc.tags,
      actorType: principal.actorType,
      payload: {
        action: "deleted",
        artifactId: deleted.id,
        documentId: doc.id,
      },
    });

    return { deleted: true, id: artifactId };
  }

  private pruneExpiredTickets(nowMs: number): void {
    for (const [hash, entry] of this.tickets) {
      if (entry.expiresAtMs <= nowMs) {
        this.tickets.delete(hash);
      }
    }
    while (this.tickets.size >= DEFAULT_MAX_SANDBOX_TICKETS) {
      const oldest = this.tickets.keys().next().value;
      if (oldest === undefined) break;
      this.tickets.delete(oldest);
    }
  }

  private resolveTicketOrigins(
    artifactId: DocumentArtifactId,
    requestContext?: {
      readonly serverOrigin?: string | undefined;
      readonly clientOrigin?: string | undefined;
    },
  ): {
    readonly appOrigin: string;
    readonly sandboxOrigin: string;
    readonly mode: SandboxIsolationMode;
    readonly sameSite: boolean;
  } {
    const cfg = this.deps.runtimeConfig;

    if (
      (cfg.mode === "dev_localhost" || (cfg.sameSite && isLoopbackHostname(cfg.appHostname))) &&
      isLoopbackHostname(cfg.appHostname)
    ) {
      const parsedServer = tryParseOrigin(requestContext?.serverOrigin);
      const parsedClient = tryParseOrigin(requestContext?.clientOrigin);
      const isLoopbackNonSandbox = (u: URL | null): u is URL =>
        Boolean(
          u &&
            isLoopbackHostname(u.hostname) &&
            !isLocalDevSandboxHostname(normalizeHostnameInput(u.hostname)),
        );
      const effectiveServerOrigin = isLoopbackNonSandbox(parsedServer)
        ? parsedServer.origin
        : cfg.appOrigin;
      const effectiveAppOrigin = isLoopbackNonSandbox(parsedClient)
        ? parsedClient.origin
        : effectiveServerOrigin;

      const resolved = buildSandboxArtifactOrigin(artifactId, {
        appOrigin: effectiveServerOrigin,
        sandboxOrigin: cfg.configuredSandboxOrigin,
        sameSiteOptIn: cfg.sameSite,
      });

      return {
        appOrigin: effectiveAppOrigin,
        sandboxOrigin: resolved.origin,
        mode: cfg.sameSite ? "same_site" : resolved.mode,
        sameSite: cfg.sameSite,
      };
    }

    const resolved = buildSandboxArtifactOrigin(artifactId, {
      appOrigin: cfg.appOrigin,
      sandboxOrigin: cfg.configuredSandboxOrigin,
      sameSiteOptIn: cfg.sameSite,
    });

    return {
      appOrigin: cfg.appOrigin,
      sandboxOrigin: resolved.origin,
      mode: cfg.sameSite ? "same_site" : resolved.mode,
      sameSite: cfg.sameSite,
    };
  }

  async issueSandboxTicket(
    principal: Principal,
    artifactId: DocumentArtifactId,
    requestContext?: {
      readonly serverOrigin?: string | undefined;
      readonly clientOrigin?: string | undefined;
    },
  ): Promise<ArtifactSandboxTicket> {
    const { artifact } = await this.loadAuthorizedArtifact(principal, artifactId, "read");
    const origins = this.resolveTicketOrigins(artifact.id, requestContext);

    const nowMs = Date.now();
    this.pruneExpiredTickets(nowMs);

    const ticket = `sbx_${randomBase64Url(24)}`;
    const hash = await sha256Hex(ticket);
    const expiresAtMs = nowMs + this.ticketTtlMs;

    this.tickets.set(hash, {
      principal,
      artifactId: artifact.id,
      documentId: artifact.documentId,
      appOrigin: origins.appOrigin,
      sandboxOrigin: origins.sandboxOrigin,
      mode: origins.mode,
      sameSite: origins.sameSite,
      expiresAtMs,
    });

    return {
      ticket,
      sandboxUrl: `${origins.sandboxOrigin}/sandbox/${ticket}`,
      sandboxOrigin: origins.sandboxOrigin,
      appOrigin: origins.appOrigin,
      mode: origins.mode,
      sameSite: origins.sameSite,
      expiresAt: new Date(expiresAtMs).toISOString(),
      ttlSeconds: Math.max(1, Math.round(this.ticketTtlMs / 1000)),
      artifactId: artifact.id,
      documentId: artifact.documentId,
      title: artifact.title,
      heightPx: artifact.heightPx,
      capabilities: artifact.capabilities,
      sources: artifact.sources,
      fallbackMarkdown: artifact.fallbackMarkdown,
      sha256: artifact.sha256,
    };
  }

  private async resolveArtifactSources(
    principal: Principal,
    artifact: DocumentArtifact,
  ): Promise<readonly ResolvedArtifactSourceSnapshot[]> {
    if (artifact.capabilities.sources !== true || artifact.sources.length === 0) {
      return [];
    }

    const allSpaces = await getAllWorkspaceSpaces(
      this.repos.spacesCache ?? this.repos.spaceRepo,
      principal.workspaceId,
    );
    const refreshedAt = new Date().toISOString();
    const resolved: ResolvedArtifactSourceSnapshot[] = [];

    for (const source of artifact.sources) {
      if (source.kind === "inkade_view") {
        const emptyView: ViewQueryResponse = {
          documents: [],
          totalCount: 0,
          limit: 50,
          offset: 0,
          schemaFields: [],
          numericAggregates: [],
        };
        const parsedQuery = viewQueryRequestSchema.safeParse(source.query);
        let data = emptyView;
        if (parsedQuery.success && this.deps.viewQueryService) {
          try {
            data = await this.deps.viewQueryService.queryView(principal, parsedQuery.data);
          } catch {
            data = emptyView;
          }
        }
        resolved.push({
          kind: "inkade_view",
          ...(source.label ? { label: source.label } : {}),
          refreshedAt: source.refreshedAt ?? refreshedAt,
          query: source.query,
          data,
        });
      } else if (source.kind === "attachment") {
        if (!this.deps.attachmentService) {
          resolved.push({
            kind: "attachment",
            ...(source.label ? { label: source.label } : {}),
            refreshedAt: source.refreshedAt ?? refreshedAt,
            attachmentId: source.attachmentId,
            ...(source.filename ? { filename: source.filename } : {}),
            ...(source.mimeType ? { mimeType: source.mimeType } : {}),
            error: "Attachment service unavailable",
          });
          continue;
        }
        try {
          const { attachment, bytes } = await this.deps.attachmentService.downloadAttachment(
            principal,
            source.attachmentId,
          );
          const lowerMime = attachment.mimeType.toLowerCase();
          const lowerName = attachment.filename.toLowerCase();
          const isTextual =
            lowerMime.startsWith("text/") ||
            lowerMime.includes("json") ||
            lowerMime.includes("csv") ||
            lowerName.endsWith(".json") ||
            lowerName.endsWith(".csv") ||
            lowerName.endsWith(".txt") ||
            lowerName.endsWith(".md");
          let textContent: string | undefined;
          let jsonContent: unknown;
          if (isTextual) {
            const slice =
              bytes.byteLength > MAX_TEXT_ATTACHMENT_SOURCE_BYTES
                ? bytes.subarray(0, MAX_TEXT_ATTACHMENT_SOURCE_BYTES)
                : bytes;
            textContent = new TextDecoder().decode(slice);
            if (lowerMime.includes("json") || lowerName.endsWith(".json")) {
              try {
                jsonContent = JSON.parse(textContent) as unknown;
              } catch {
                // Keep textContent when JSON parsing fails
              }
            }
          }
          resolved.push({
            kind: "attachment",
            ...(source.label ? { label: source.label } : {}),
            refreshedAt: source.refreshedAt ?? refreshedAt,
            attachmentId: attachment.id,
            filename: attachment.filename,
            mimeType: attachment.mimeType,
            ...(textContent !== undefined ? { textContent } : {}),
            ...(jsonContent !== undefined ? { jsonContent } : {}),
          });
        } catch (err) {
          resolved.push({
            kind: "attachment",
            ...(source.label ? { label: source.label } : {}),
            refreshedAt: source.refreshedAt ?? refreshedAt,
            attachmentId: source.attachmentId,
            ...(source.filename ? { filename: source.filename } : {}),
            ...(source.mimeType ? { mimeType: source.mimeType } : {}),
            error: err instanceof Error ? err.message : "Attachment source unavailable",
          });
        }
      } else if (source.kind === "document") {
        const doc = await this.repos.documentRepo.getDocumentById(
          principal.workspaceId,
          source.documentId,
        );
        if (
          !doc ||
          doc.trashedAt !== null ||
          !evaluateScopeAccess(
            principal.scope,
            "read",
            { spaceId: doc.spaceId, kind: doc.kind, tags: doc.tags },
            allSpaces,
          ).allowed
        ) {
          resolved.push({
            kind: "document",
            ...(source.label ? { label: source.label } : {}),
            refreshedAt: source.refreshedAt ?? refreshedAt,
            documentId: source.documentId,
            ...(source.title ? { title: source.title } : {}),
            error: "Document source unavailable or outside scope",
          });
        } else {
          resolved.push({
            kind: "document",
            ...(source.label ? { label: source.label } : {}),
            refreshedAt: source.refreshedAt ?? refreshedAt,
            documentId: doc.id,
            title: doc.title,
            excerpt: doc.excerpt,
            tags: doc.tags,
          });
        }
      }
    }

    return resolved;
  }

  async resolveArtifactSandboxRenderData(
    rawTicket: string,
  ): Promise<ArtifactSandboxResolvedPayload | null> {
    const trimmed = rawTicket.trim();
    if (!trimmed.startsWith("sbx_")) {
      return null;
    }

    const nowMs = Date.now();
    this.pruneExpiredTickets(nowMs);
    const hash = await sha256Hex(trimmed);
    const entry = this.tickets.get(hash);
    if (!entry || entry.expiresAtMs <= nowMs) {
      if (entry) {
        this.tickets.delete(hash);
      }
      return null;
    }

    let effectivePrincipal = entry.principal;
    if (effectivePrincipal.kind === "token" && this.repos.tokenRuleRepo) {
      const liveScope = await resolveCurrentPrincipalScope(
        effectivePrincipal,
        this.repos.tokenRuleRepo,
        this.repos.tokenScopeCache,
      );
      if (!liveScope) {
        this.tickets.delete(hash);
        return null;
      }
      effectivePrincipal = { ...effectivePrincipal, scope: liveScope };
    }

    let artifact: DocumentArtifact;
    try {
      const loaded = await this.loadAuthorizedArtifact(
        effectivePrincipal,
        entry.artifactId,
        "read",
      );
      artifact = loaded.artifact;
    } catch {
      return null;
    }

    const allowedConnectSet = new Set(this.deps.runtimeConfig.allowedNetworkOrigins);
    const allowedHttpsOrigins = Array.isArray(artifact.capabilities.network)
      ? artifact.capabilities.network.filter((origin) => {
          const parsed = tryParseOrigin(origin);
          return Boolean(parsed && allowedConnectSet.has(parsed.origin));
        })
      : [];

    const cspHeader = buildSandboxCspHeader({
      appOrigin: entry.appOrigin,
      allowedHttpsOrigins,
      extraFrameAncestors: this.deps.runtimeConfig.extraFrameAncestors,
      sameSite: entry.sameSite,
    });

    const sources = await this.resolveArtifactSources(effectivePrincipal, artifact);

    return {
      artifactId: artifact.id,
      documentId: artifact.documentId,
      title: artifact.title,
      htmlSource: artifact.htmlSource,
      capabilities: artifact.capabilities,
      sources,
      fallbackMarkdown: artifact.fallbackMarkdown,
      heightPx: artifact.heightPx,
      sha256: artifact.sha256,
      appOrigin: entry.appOrigin,
      sandboxOrigin: entry.sandboxOrigin,
      cspHeader,
      mode: entry.mode,
      sameSite: entry.sameSite,
    };
  }

  async submitArtifactComment(
    principal: Principal,
    artifactId: DocumentArtifactId,
    input: SubmitArtifactCommentInput,
  ): Promise<SendHighlightToAgentResult> {
    if (!this.deps.highlightService) {
      throw new InkadeError("INTERNAL_ERROR", "HighlightService is unavailable");
    }

    const { artifact, doc } = await this.loadAuthorizedArtifact(
      principal,
      artifactId,
      "append",
    );
    if (artifact.capabilities.comment !== true) {
      throw new InkadeError(
        "FORBIDDEN",
        `Artifact "${artifact.id}" does not enable comment capability`,
      );
    }

    const anchorPrefix = `inkade-artifact:${artifact.id}`;
    const existingHighlights = await this.deps.highlightService.listHighlights(
      principal,
      doc.id,
    );
    let targetHighlight = existingHighlights.find((hl) => hl.prefixContext === anchorPrefix);

    if (!targetHighlight) {
      targetHighlight = await this.deps.highlightService.createHighlight(principal, doc.id, {
        quote: artifact.title.slice(0, 4000) || artifact.id,
        prefixContext: anchorPrefix,
        suffixContext: `version:${artifact.version}`,
        color: "blue",
        noteMarkdown: "",
      });
    }

    const authorName = input.authorName?.trim() || "Artifact Collaborator";
    const result = await this.deps.highlightService.sendHighlightToAgent(
      principal,
      targetHighlight.id,
      {
        bodyMarkdown: input.handoffNote,
        senderType: "collaborator",
        senderName: authorName,
      },
    );

    await this.deps.auditService?.captureOrRecord(principal, {
      spaceId: doc.spaceId,
      documentId: doc.id,
      reversible: false,
      irreversibleReason: "Collaborator artifact comment routed to wake bus",
      summary: `Submitted collaborator comment from artifact "${artifact.title}" (${artifact.id})`,
      fallbackAction: "artifact.comment",
      fallbackResource: `artifact:${artifact.id}`,
    });

    return result;
  }
}
