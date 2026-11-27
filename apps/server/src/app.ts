import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { isInkadeError } from "@inkade/core";
import {
  createSqliteDatabase,
  createSqliteRepositories,
  DEFAULT_WORKSPACE_ID,
  seedDefaultWorkspace,
  type InkadeRepositories,
} from "@inkade/db";
import {
  createInkadeAuth,
  isPlaceholderAuthSecret,
  type InkadeAuth,
} from "./auth/better-auth.ts";
import { EmbedTicketManager } from "./auth/embed-ticket.ts";
import { createPrincipalMiddleware } from "./auth/principal.ts";
import { TokenScopeCache } from "./cache/token-scope-cache.ts";
import { WorkspaceSpacesCache } from "./cache/workspace-spaces-cache.ts";
import { createRequestLoggerMiddleware, createServerLogger, type ServerLogger } from "./logger.ts";
import {
  MCP_APPS_UI_EXTENSION,
  McpAppsCardStore,
  principalKeyOf,
} from "./mcp/mcp-apps.ts";
import { createInkadeMcpServer } from "./mcp/server.ts";
import { SseHub } from "./realtime/sse-hub.ts";
import {
  parseSyncRouteDocumentId,
  YjsSyncHub,
  type BunWebSocketUpgradeServer,
} from "./realtime/yjs-sync.ts";
import { createApiV1Router } from "./routes/api-v1.ts";
import {
  createSandboxIsolationMiddleware,
  registerSandboxHostRoutes,
} from "./routes/sandbox-host.ts";
import { servePublicSiteFeedResponse } from "./routes/v1/bootstrap.ts";
import { resolveSandboxRuntimeConfig } from "./services/artifact-service.ts";
import { createInkadeServices, type InkadeServices } from "./services/index.ts";
import type { CreateInkadeAppOptions, InkadeAppEnv } from "./types.ts";

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

export interface InkadeAppInstance {
  readonly app: Hono<InkadeAppEnv>;
  readonly repos: InkadeRepositories;
  readonly auth: InkadeAuth;
  readonly sseHub: SseHub;
  readonly yjsHub: YjsSyncHub;
  readonly services: InkadeServices;
  readonly logger: ServerLogger;
  readonly ready: Promise<void>;
  readonly fetch: (req: Request, server?: BunWebSocketUpgradeServer) => Promise<Response> | Response;
  readonly websocket: ReturnType<YjsSyncHub["createBunWebSocketHandlers"]>;
  close(): void;
}

const DEFAULT_LOOPBACK_CORS_ORIGINS: readonly string[] = [
  "http://localhost",
  "http://localhost:*",
  "https://localhost",
  "https://localhost:*",
  "http://127.0.0.1",
  "http://127.0.0.1:*",
  "https://127.0.0.1",
  "https://127.0.0.1:*",
  "http://[::1]",
  "http://[::1]:*",
  "https://[::1]",
  "https://[::1]:*",
];

function parseOriginList(raw?: string): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function canonicalOriginOf(parsed: URL): string | null {
  if (parsed.username || parsed.password) {
    return null;
  }
  if (parsed.protocol === "http:" || parsed.protocol === "https:") {
    return parsed.origin;
  }
  if (parsed.protocol === "chrome-extension:" || parsed.protocol === "moz-extension:") {
    if (
      !parsed.hostname ||
      parsed.port ||
      (parsed.pathname !== "" && parsed.pathname !== "/") ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }
    return `${parsed.protocol}//${parsed.hostname.toLowerCase()}`;
  }
  return null;
}

function matchesSingleOriginPattern(
  parsedOrigin: URL,
  canonicalOrigin: string,
  rawOrigin: string,
  rawPattern: string,
): boolean {
  const pattern = rawPattern.trim();
  if (!pattern || pattern === "*" || pattern.toLowerCase() === "null") {
    return false;
  }

  // Browser extension origins are only matched when explicitly configured.
  if (pattern === "chrome-extension://*" || pattern === "moz-extension://*") {
    const expectedProtocol = pattern.startsWith("chrome-extension://")
      ? "chrome-extension:"
      : "moz-extension:";
    return parsedOrigin.protocol === expectedProtocol && rawOrigin.toLowerCase() === canonicalOrigin;
  }

  const hasPortWildcard = pattern.endsWith(":*");
  const basePattern = hasPortWildcard ? pattern.slice(0, -2) : pattern;

  // Handle wildcard subdomains such as https://*.inkade.example or https://*.inkade.example:*
  const schemeSepIdx = basePattern.indexOf("://");
  if (schemeSepIdx <= 0) {
    return false;
  }
  const patternScheme = `${basePattern.slice(0, schemeSepIdx).toLowerCase()}:`;
  if (parsedOrigin.protocol !== patternScheme) {
    return false;
  }

  const authority = basePattern.slice(schemeSepIdx + 3);
  if (!authority || authority.includes("/") || authority.includes("?") || authority.includes("#")) {
    return false;
  }

  if (authority.startsWith("*.")) {
    const rest = authority.slice(2);
    const colonIdx = rest.lastIndexOf(":");
    const hasExplicitPort = colonIdx > 0 && /^\d+$/.test(rest.slice(colonIdx + 1));
    const wildcardDomain = (hasExplicitPort ? rest.slice(0, colonIdx) : rest).toLowerCase();
    const expectedPort = hasExplicitPort ? rest.slice(colonIdx + 1) : "";
    if (!wildcardDomain) return false;

    const host = parsedOrigin.hostname.toLowerCase();
    const dotSuffix = `.${wildcardDomain}`;
    if (!host.endsWith(dotSuffix) || host.length <= dotSuffix.length) {
      return false;
    }
    if (!hasPortWildcard && parsedOrigin.port !== expectedPort) {
      return false;
    }
    return rawOrigin.toLowerCase() === canonicalOrigin.toLowerCase();
  }

  try {
    const parsedPattern = new URL(basePattern);
    if (parsedPattern.protocol !== parsedOrigin.protocol) {
      return false;
    }
    if (parsedPattern.hostname.toLowerCase() !== parsedOrigin.hostname.toLowerCase()) {
      return false;
    }
    if (!hasPortWildcard && parsedPattern.port !== parsedOrigin.port) {
      return false;
    }
    return rawOrigin.toLowerCase() === canonicalOrigin.toLowerCase();
  } catch {
    return false;
  }
}

export function buildCorsOriginAllowlist(options: {
  readonly baseURL?: string | undefined;
  readonly appOrigin?: string | undefined;
  readonly trustedOrigins?: readonly string[] | undefined;
  readonly corsOrigins?: readonly string[] | undefined;
  readonly envCorsOrigins?: string | undefined;
}): readonly string[] {
  const result = new Set<string>(DEFAULT_LOOPBACK_CORS_ORIGINS);
  for (const configuredOrigin of [
    options.baseURL,
    options.appOrigin,
    process.env.INKADE_BASE_URL,
    process.env.INKADE_APP_ORIGIN,
  ]) {
    if (!configuredOrigin) continue;
    try {
      const parsed = new URL(configuredOrigin);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        result.add(parsed.origin);
      }
    } catch {
      // Ignore malformed origin config here; auth/sandbox validation handles strict checks.
    }
  }
  for (const origin of options.trustedOrigins ?? []) {
    if (origin.trim()) result.add(origin.trim());
  }
  for (const origin of options.corsOrigins ?? []) {
    if (origin.trim()) result.add(origin.trim());
  }
  for (const origin of parseOriginList(options.envCorsOrigins ?? process.env.INKADE_CORS_ORIGINS)) {
    result.add(origin);
  }
  return [...result];
}

export function isAllowedCorsOrigin(
  rawOrigin: string,
  allowedPatterns: readonly string[],
): boolean {
  const trimmed = rawOrigin.trim();
  if (!trimmed || trimmed.toLowerCase() === "null") {
    return false;
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }
  const canonical = canonicalOriginOf(parsed);
  if (!canonical) {
    return false;
  }
  return allowedPatterns.some((pattern) =>
    matchesSingleOriginPattern(parsed, canonical, trimmed, pattern),
  );
}

export function sanitizeForwardedPrefix(raw?: string | null): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "/") return "";
  const normalized = trimmed.replace(/\/+$/, "");
  if (!normalized || normalized.includes("//") || !/^\/[a-zA-Z0-9/_-]+$/.test(normalized)) {
    return "";
  }
  return normalized;
}

function injectHtmlBaseAndPrefix(html: string, prefix: string): string {
  const baseHref = prefix ? `${prefix}/` : "/";
  const injection = `<base href="${baseHref}" /><script>window.__INKADE_BASE_PATH__=${JSON.stringify(prefix)};</script>`;
  const headMatch = /<head[^>]*>/i.exec(html);
  if (!headMatch) {
    return `${injection}${html}`;
  }
  const insertAt = headMatch.index + headMatch[0].length;
  return `${html.slice(0, insertAt)}${injection}${html.slice(insertAt)}`;
}

export function createInkadeApp(options: CreateInkadeAppOptions = {}): InkadeAppInstance {
  const dbPath = options.dbPath ?? process.env.INKADE_DB_PATH ?? "./data/inkade.db";
  const dataDir = resolve(options.dataDir ?? process.env.INKADE_DATA_DIR ?? "./data");
  const defaultWorkspaceId = options.defaultWorkspaceId ?? DEFAULT_WORKSPACE_ID;
  const localAutoAuth =
    options.localAutoAuth ?? process.env.INKADE_LOCAL_AUTO_AUTH === "true";
  const allowSignup =
    options.allowSignup ?? process.env.INKADE_ALLOW_SIGNUP === "true";
  const configuredBasePath = sanitizeForwardedPrefix(
    options.basePath ?? process.env.INKADE_BASE_PATH,
  );
  const frameAncestorsRaw = (
    options.frameAncestors ??
    process.env.INKADE_FRAME_ANCESTORS ??
    ""
  )
    .replace(/[\r\n]/g, "")
    .trim();

  const runtimeConfig = resolveSandboxRuntimeConfig({
    appOrigin: options.appOrigin,
    baseURL: options.baseURL,
    sandboxOrigin: options.sandboxOrigin,
    sandboxSameSite: options.sandboxSameSite,
    sandboxAllowedNetworkOrigins: options.sandboxAllowedNetworkOrigins,
    frameAncestors: frameAncestorsRaw || undefined,
  });

  const ownsSqlite = options.dbBundle === undefined;
  const bundle = options.dbBundle ?? createSqliteDatabase(dbPath);
  const repos = createSqliteRepositories(bundle.sqlite, bundle.db);
  const logger = createServerLogger();
  const spacesCache = new WorkspaceSpacesCache(repos.space);
  const tokenScopeCache = new TokenScopeCache(repos.tokenRule);
  const effectiveAuthSecret =
    options.authSecret ??
    process.env.INKADE_AUTH_SECRET ??
    process.env.BETTER_AUTH_SECRET;
  if (
    process.env.NODE_ENV === "production" &&
    !localAutoAuth &&
    isPlaceholderAuthSecret(effectiveAuthSecret)
  ) {
    logger.warn(
      "INKADE_AUTH_SECRET is using a default/short secret in production; generate a 32+ char random secret immediately",
    );
  }

  const auth = createInkadeAuth({
    db: bundle.db,
    secret: options.authSecret,
    baseURL: options.baseURL ?? (runtimeConfig.hasExplicitAppOrigin ? runtimeConfig.appOrigin : undefined),
    appOrigin: runtimeConfig.appOrigin,
    trustedOrigins: options.trustedOrigins,
    useHostCookiePrefix: runtimeConfig.hostCookiePrefixEnabled,
  });

  const sseHub = new SseHub({
    spaceRepo: repos.space,
    spacesCache,
    tokenScopeCache,
  });
  const services = createInkadeServices({
    repos,
    auth,
    sseHub,
    dataDir,
    defaultWorkspaceId,
    localAutoAuth,
    allowSignup,
    sandboxRuntimeConfig: runtimeConfig,
    spacesCache,
    tokenScopeCache,
    logger,
    clipperResolveDns: options.clipperResolveDns,
    clipperFetch: options.clipperFetch,
    calendarResolveDns: options.calendarResolveDns,
    calendarFetch: options.calendarFetch,
    embeddingProvider: options.embeddingProvider,
    embeddingFetch: options.embeddingFetch,
    briefingTransport: options.briefingTransport,
  });

  let closed = false;

  const ready = (options.skipSeed
    ? Promise.resolve()
    : seedDefaultWorkspace(repos).then(() => {
        spacesCache.invalidate(defaultWorkspaceId);
      })
  ).then(async () => {
    if (!closed && options.enableBriefingScheduler) {
      await services.briefing.startScheduler();
    }
  });

  const embedTickets = new EmbedTicketManager();

  const principalDeps = {
    tokenRuleRepo: repos.tokenRule,
    tokenScopeCache,
    auth,
    embedTickets,
    defaultWorkspaceId,
    localAutoAuth,
  };
  const principalMiddleware = createPrincipalMiddleware(principalDeps);
  const yjsHub = new YjsSyncHub({
    documentRepo: repos.document,
    searchConfigRepo: repos.searchConfig,
    spaceRepo: repos.space,
    tokenRuleRepo: repos.tokenRule,
    spacesCache,
    tokenScopeCache,
    principalDeps,
    logger,
  });
  const websocket = yjsHub.createBunWebSocketHandlers();

  const app = new Hono<InkadeAppEnv>();
  app.use("*", createRequestLoggerMiddleware(logger));
  app.use("*", createSandboxIsolationMiddleware(runtimeConfig));
  app.use("*", async (c, next) => {
    await next();
    if (c.req.path !== "/sandbox" && !c.req.path.startsWith("/sandbox/")) {
      if (!c.res.headers.has("x-content-type-options")) {
        c.header("X-Content-Type-Options", "nosniff");
      }
      if (!c.res.headers.has("referrer-policy")) {
        c.header("Referrer-Policy", "strict-origin-when-cross-origin");
      }
    }
  });

  if (frameAncestorsRaw) {
    app.use("*", async (c, next) => {
      await next();
      if (c.req.path !== "/sandbox" && !c.req.path.startsWith("/sandbox/")) {
        c.header("Content-Security-Policy", `frame-ancestors ${frameAncestorsRaw}`);
      }
    });
  }

  const corsAllowlist = buildCorsOriginAllowlist({
    baseURL: options.baseURL,
    appOrigin: runtimeConfig.appOrigin,
    trustedOrigins: options.trustedOrigins,
    corsOrigins: options.corsOrigins,
  });

  const allowedMethods = "GET,POST,PUT,PATCH,DELETE,OPTIONS";
  const allowedHeaders = [
    "Content-Type",
    "Authorization",
    "Last-Event-ID",
    "Mcp-Session-Id",
    "Mcp-Protocol-Version",
    "X-Forwarded-Prefix",
    "X-Inkade-Host",
    "X-Inkade-Mcp-Ui",
    "X-Inkade-Session-Id",
    "X-Inkade-Workspace",
  ].join(",");

  app.use("*", async (c, next) => {
    if (c.req.path === "/sandbox" || c.req.path.startsWith("/sandbox/")) {
      await next();
      return;
    }
    const origin = c.req.header("origin");
    if (!origin) {
      await next();
      return;
    }
    if (!isAllowedCorsOrigin(origin, corsAllowlist)) {
      c.header("Vary", "Origin", { append: true });
      if (c.req.method === "OPTIONS") {
        return c.body(null, 403);
      }
      await next();
      return;
    }

    c.header("Access-Control-Allow-Origin", origin);
    c.header("Access-Control-Allow-Credentials", "true");
    c.header("Access-Control-Expose-Headers", "Mcp-Session-Id");
    c.header("Vary", "Origin", { append: true });

    if (c.req.method === "OPTIONS") {
      c.header("Access-Control-Allow-Methods", allowedMethods);
      c.header("Access-Control-Allow-Headers", allowedHeaders);
      return c.body(null, 204);
    }

    await next();
  });

  app.onError((err, c) => {
    if (isInkadeError(err)) {
      return c.json(
        {
          error: {
            code: err.code,
            message: err.message,
            ...(err.details ? { details: err.details } : {}),
          },
        },
        err.httpStatus as ContentfulStatusCode,
      );
    }

    if (err instanceof HTTPException) {
      return c.json(
        {
          error: {
            code: err.status === 401 ? "UNAUTHORIZED" : "INTERNAL_ERROR",
            message: err.message,
          },
        },
        err.status,
      );
    }

    logger.error({ err }, "Unhandled server error");
    return c.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: err instanceof Error ? err.message : "Internal server error",
        },
      },
      500,
    );
  });

  // Ensure initial seed completes before serving requests.
  app.use("*", async (_c, next) => {
    await ready;
    await next();
  });

  // Guard public sign-up once an owner exists unless INKADE_ALLOW_SIGNUP=true.
  app.post("/api/auth/sign-up/*", async (c, next) => {
    if (!allowSignup && (await repos.workspace.hasRegisteredUsers())) {
      return c.json(
        {
          error: {
            code: "SIGNUP_DISABLED",
            message: "Public registration is disabled after workspace initialization",
          },
        },
        403,
      );
    }
    await next();
  });

  // Mount Better Auth handler.
  app.on(["GET", "POST"], "/api/auth/*", (c) => {
    return auth.handler(c.req.raw);
  });

  // Mount REST + SSE routes.
  const apiV1 = createApiV1Router({
    dialect: repos.dialect,
    tokenRuleRepo: repos.tokenRule,
    tokenScopeCache,
    embedTickets,
    sseHub,
    services,
    principalMiddleware,
    principalDeps,
  });
  app.route("/api/v1", apiV1);

  const mcpAppCardStore = new McpAppsCardStore();
  const mcpClientSessions = new Map<
    string,
    {
      readonly principalKey: string;
      readonly clientCapabilities: unknown;
      readonly expiresAtMs: number;
    }
  >();
  const MCP_SESSION_TTL_MS = 2 * 60 * 60 * 1000;
  const MAX_MCP_SESSIONS = 2000;

  function pruneMcpSessions(nowMs: number): void {
    for (const [sid, entry] of mcpClientSessions) {
      if (entry.expiresAtMs <= nowMs) {
        mcpClientSessions.delete(sid);
      }
    }
    while (mcpClientSessions.size >= MAX_MCP_SESSIONS) {
      const oldest = mcpClientSessions.keys().next().value;
      if (oldest === undefined) break;
      mcpClientSessions.delete(oldest);
    }
  }

  function extractInitializeCapabilities(
    body: unknown,
  ): { readonly isInitialize: boolean; readonly capabilities: unknown } {
    const messages = Array.isArray(body) ? body : [body];
    for (const msg of messages) {
      if (
        typeof msg === "object" &&
        msg !== null &&
        (msg as Record<string, unknown>).method === "initialize"
      ) {
        const params = (msg as Record<string, unknown>).params;
        const capabilities =
          typeof params === "object" && params !== null
            ? (params as Record<string, unknown>).capabilities ?? {}
            : {};
        return { isInitialize: true, capabilities };
      }
    }
    return { isInitialize: false, capabilities: undefined };
  }

  // Mount native Streamable HTTP MCP server sharing the exact same principal & domain services.
  app.all("/mcp", principalMiddleware, async (c) => {
    const principal = c.get("principal");
    const principalKey = principalKeyOf(principal);
    const reqMcpSessionId = c.req.header("mcp-session-id")?.trim();

    if (c.req.method === "DELETE" && reqMcpSessionId) {
      const existing = mcpClientSessions.get(reqMcpSessionId);
      if (existing && existing.principalKey === principalKey) {
        mcpClientSessions.delete(reqMcpSessionId);
      }
    }

    let parsedBody: unknown;
    let hasParsedBody = false;
    if (c.req.method === "POST") {
      try {
        const rawText = await c.req.raw.clone().text();
        if (rawText.trim().length > 0) {
          parsedBody = JSON.parse(rawText) as unknown;
          hasParsedBody = true;
        }
      } catch {
        hasParsedBody = false;
      }
    }

    const nowMs = Date.now();
    const uiHeader = c.req.header("x-inkade-mcp-ui")?.trim().toLowerCase();
    const headerCapabilities =
      uiHeader === "1" || uiHeader === "true"
        ? { experimental: { [MCP_APPS_UI_EXTENSION]: {} } }
        : undefined;

    let clientCapabilities: unknown = headerCapabilities ?? {};
    let issuedMcpSessionId: string | undefined;

    if (hasParsedBody) {
      const init = extractInitializeCapabilities(parsedBody);
      if (init.isInitialize) {
        clientCapabilities = headerCapabilities ?? init.capabilities;
        pruneMcpSessions(nowMs);
        issuedMcpSessionId = `ink_mcp_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
        mcpClientSessions.set(issuedMcpSessionId, {
          principalKey,
          clientCapabilities,
          expiresAtMs: nowMs + MCP_SESSION_TTL_MS,
        });
      } else if (reqMcpSessionId && !headerCapabilities) {
        const existing = mcpClientSessions.get(reqMcpSessionId);
        if (existing && existing.expiresAtMs > nowMs && existing.principalKey === principalKey) {
          clientCapabilities = existing.clientCapabilities;
          mcpClientSessions.set(reqMcpSessionId, {
            ...existing,
            expiresAtMs: nowMs + MCP_SESSION_TTL_MS,
          });
        }
      }
    } else if (reqMcpSessionId && !headerCapabilities) {
      const existing = mcpClientSessions.get(reqMcpSessionId);
      if (existing && existing.expiresAtMs > nowMs && existing.principalKey === principalKey) {
        clientCapabilities = existing.clientCapabilities;
      }
    }

    const reqUrl = new URL(c.req.url);
    const forwardedProto = c.req.header("x-forwarded-proto");
    const forwardedHost = c.req.header("x-forwarded-host") ?? c.req.header("host");
    const origin = forwardedHost
      ? `${forwardedProto || reqUrl.protocol.replace(":", "")}://${forwardedHost}`
      : reqUrl.origin;
    const reqPrefix = sanitizeForwardedPrefix(
      c.req.header("x-forwarded-prefix") ?? configuredBasePath,
    );
    const requestOrigin = `${origin.replace(/\/+$/, "")}${reqPrefix}`;

    const explicitBatchId =
      services.audit.resolveRequestBatchHeader(c.req.header("x-inkade-batch-id")) ??
      services.audit.resolveRequestBatchHeader(reqMcpSessionId);
    const bridgeContext = services.wake.parseBridgeHeaders(c.req.raw.headers);
    return services.audit.runWithBatchContext({ batchId: explicitBatchId }, () =>
      services.wake.runWithBridgeContext(bridgeContext, async () => {
        const mcpServer = createInkadeMcpServer(principal, services, {
          sseHub,
          spaceRepo: repos.space,
          documentRepo: repos.document,
          spacesCache,
          bridgeContext,
          embedTickets,
          clientCapabilities,
          requestOrigin,
          mcpAppCardStore,
        });
        const transport = new WebStandardStreamableHTTPServerTransport({
          enableJsonResponse: true,
        });
        await mcpServer.connect(transport);
        const response = await transport.handleRequest(
          c.req.raw,
          hasParsedBody ? { parsedBody } : undefined,
        );
        if (issuedMcpSessionId && !response.headers.has("mcp-session-id")) {
          const headers = new Headers(response.headers);
          headers.set("mcp-session-id", issuedMcpSessionId);
          return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers,
          });
        }
        return response;
      }),
    );
  });

  // Public Digital Garden RSS/Atom feed at canonical /site/:slug/feed.xml alongside /api/v1/public/sites/:slug/feed.xml.
  app.get("/site/:slug/feed.xml", async (c) => {
    return servePublicSiteFeedResponse(services, c.req.param("slug"), c.req.url);
  });

  registerSandboxHostRoutes(app, services, runtimeConfig);

  // Optional static SPA serving for production / single-container deployments.
  const defaultWebDist = resolve(import.meta.dir, "../../web/dist");
  const configuredWebDist = options.webDistDir ?? process.env.INKADE_WEB_DIST_DIR;
  const disableStatic = process.env.INKADE_DISABLE_STATIC === "true";
  const webDistRaw =
    configuredWebDist ??
    (!disableStatic && existsSync(join(defaultWebDist, "index.html"))
      ? defaultWebDist
      : undefined);

  if (webDistRaw && existsSync(webDistRaw)) {
    const webRoot = resolve(webDistRaw);
    app.get("*", async (c) => {
      const reqPrefix = sanitizeForwardedPrefix(
        c.req.header("x-forwarded-prefix") ?? configuredBasePath,
      );
      const rawPath = c.req.path;
      const reqPath =
        reqPrefix && (rawPath === reqPrefix || rawPath.startsWith(`${reqPrefix}/`))
          ? rawPath.slice(reqPrefix.length) || "/"
          : rawPath;
      if (
        reqPath.startsWith("/api/") ||
        reqPath === "/mcp" ||
        reqPath === "/sandbox" ||
        reqPath.startsWith("/sandbox/")
      ) {
        return c.notFound();
      }
      const relative = reqPath === "/" ? "index.html" : reqPath.replace(/^\/+/, "");
      const candidate = resolve(webRoot, relative);
      const isInsideRoot = candidate === webRoot || candidate.startsWith(webRoot + sep);
      if (!isInsideRoot) {
        return c.notFound();
      }

      let targetFile: string | null = null;
      if (existsSync(candidate)) {
        const info = await stat(candidate);
        if (info.isFile()) {
          targetFile = candidate;
        }
      }
      if (!targetFile && !extname(reqPath)) {
        targetFile = join(webRoot, "index.html");
      }
      if (!targetFile) {
        return c.notFound();
      }

      try {
        const bytes = await readFile(targetFile);
        const lowerTarget = targetFile.toLowerCase();
        const contentType =
          CONTENT_TYPES[extname(targetFile).toLowerCase()] ?? "application/octet-stream";
        const isHtml = lowerTarget.endsWith(".html");
        const isMutableShellFile =
          isHtml ||
          lowerTarget.endsWith("/sw.js") ||
          lowerTarget.endsWith("/registersw.js") ||
          lowerTarget.endsWith("/manifest.webmanifest");
        const cacheControl = reqPath.startsWith("/assets/")
          ? "public, max-age=31536000, immutable"
          : isMutableShellFile
            ? "no-cache"
            : "public, max-age=3600";
        const body = isHtml
          ? injectHtmlBaseAndPrefix(bytes.toString("utf8"), reqPrefix)
          : new Uint8Array(bytes);
        return new Response(body, {
          status: 200,
          headers: {
            "content-type": contentType,
            "cache-control": cacheControl,
          },
        });
      } catch {
        return c.notFound();
      }
    });
  }

  const fetchHandler = async (
    req: Request,
    server?: BunWebSocketUpgradeServer,
  ): Promise<Response> => {
    await ready;
    const upgradeResponse = await yjsHub.handleHttpUpgrade(req, server);
    if (upgradeResponse) {
      return upgradeResponse;
    }
    if (parseSyncRouteDocumentId(new URL(req.url).pathname) && server) {
      // Upgraded successfully by Bun; return undefined so Bun completes the 101 handshake.
      return undefined as unknown as Response;
    }
    return app.fetch(req);
  };

  return {
    app,
    repos,
    auth,
    sseHub,
    yjsHub,
    services,
    logger,
    ready,
    fetch: fetchHandler,
    websocket,
    close: () => {
      closed = true;
      services.briefing.stopScheduler();
      yjsHub.close();
      if (ownsSqlite) {
        try {
          bundle.sqlite.exec("PRAGMA wal_checkpoint(TRUNCATE);");
        } catch {
          // Best-effort WAL flush on shutdown
        }
        bundle.sqlite.close();
      }
    },
  };
}
