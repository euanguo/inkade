import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  documentIdSchema,
  InkadeError,
  INKADE_EMBED_PROTOCOL,
  type DocumentId,
} from "@inkade/core";
import { z } from "zod";
import type { EmbedTicketManager } from "../auth/embed-ticket.ts";
import type { InkadeServices } from "../services/index.ts";
import type { Principal } from "../types.ts";

export const MCP_APPS_UI_EXTENSION = "io.modelcontextprotocol/ui" as const;
export const MCP_APP_RESOURCE_MIME_TYPE = "text/html;profile=mcp-app" as const;
export const SHOW_INKADE_VIEW_TOOL_NAME = "show_inkade_view" as const;
export const MCP_APPS_READY_TIMEOUT_MS = 10_000;

export const SHOW_INKADE_VIEW_TARGETS = [
  "daily",
  "document",
  "tasks",
  "diff",
  "inbox",
] as const;

export type ShowInkadeViewTarget = (typeof SHOW_INKADE_VIEW_TARGETS)[number];

export const showInkadeViewInputShape = {
  target: z.enum(SHOW_INKADE_VIEW_TARGETS),
  documentId: documentIdSchema.optional(),
  headingSlug: z.string().trim().min(1).max(200).optional(),
  fromVersion: z.number().int().positive().optional(),
  toVersion: z.number().int().positive().optional(),
};

export const showInkadeViewInputSchema = z.object(showInkadeViewInputShape);
export type ShowInkadeViewInput = z.infer<typeof showInkadeViewInputSchema>;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCapabilityEntryEnabled(value: unknown): boolean {
  if (value === true) return true;
  if (isPlainRecord(value)) {
    return value.enabled !== false;
  }
  return false;
}

/**
 * Detects whether an MCP client advertised support for `io.modelcontextprotocol/ui`
 * in its initialize capabilities (under `experimental`, `extensions`, or top-level).
 */
export function supportsMcpAppsUi(capabilities: unknown): boolean {
  if (!isPlainRecord(capabilities)) {
    return false;
  }
  if (isCapabilityEntryEnabled(capabilities[MCP_APPS_UI_EXTENSION])) {
    return true;
  }
  if (
    isPlainRecord(capabilities.experimental) &&
    isCapabilityEntryEnabled(capabilities.experimental[MCP_APPS_UI_EXTENSION])
  ) {
    return true;
  }
  if (
    isPlainRecord(capabilities.extensions) &&
    isCapabilityEntryEnabled(capabilities.extensions[MCP_APPS_UI_EXTENSION])
  ) {
    return true;
  }
  return false;
}

/**
 * Builds the CSP `frameDomains` allowlist for MCP Apps hosts, including loopback siblings
 * (`127.0.0.1` <-> `localhost`) when running locally.
 */
export function buildMcpAppsFrameDomains(baseUrl: string): readonly string[] {
  const domains = new Set<string>();
  try {
    const parsed = new URL(baseUrl);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      domains.add(parsed.origin);
      const portSuffix = parsed.port ? `:${parsed.port}` : "";
      if (parsed.hostname === "127.0.0.1") {
        domains.add(`${parsed.protocol}//localhost${portSuffix}`);
      } else if (parsed.hostname === "localhost") {
        domains.add(`${parsed.protocol}//127.0.0.1${portSuffix}`);
      }
    }
  } catch {
    domains.add("http://127.0.0.1:4311");
    domains.add("http://localhost:4311");
  }
  return [...domains];
}

export interface BuildMcpAppsUiMetaOptions {
  readonly baseUrl: string;
  readonly resourceUri?: string | undefined;
  readonly embedUrl?: string | undefined;
  readonly browserUrl?: string | undefined;
  readonly target?: ShowInkadeViewTarget | undefined;
  readonly expiresAt?: string | undefined;
  readonly embedSessionId?: string | undefined;
}

/**
 * Produces `_meta` adhering to both MCP Apps (`_meta.ui.csp.frameDomains`) and OpenAI Apps
 * (`_meta["openai/ui"].permissions.loopbackNetwork`) conventions.
 */
export function buildMcpAppsUiMeta(options: BuildMcpAppsUiMetaOptions): Record<string, unknown> {
  const frameDomains = buildMcpAppsFrameDomains(options.baseUrl);
  return {
    ui: {
      ...(options.resourceUri ? { resourceUri: options.resourceUri } : {}),
      csp: {
        frameDomains,
        connectDomains: frameDomains,
      },
      prefersBorder: true,
    },
    "openai/ui": {
      permissions: {
        loopbackNetwork: true,
      },
      ...(options.resourceUri ? { outputTemplate: options.resourceUri } : {}),
      widgetAccessible: true,
    },
    ...(options.embedUrl ? { embedUrl: options.embedUrl } : {}),
    ...(options.browserUrl ? { browserUrl: options.browserUrl } : {}),
    ...(options.target ? { target: options.target } : {}),
    ...(options.expiresAt ? { expiresAt: options.expiresAt } : {}),
    ...(options.embedSessionId ? { embedSessionId: options.embedSessionId } : {}),
  };
}

export interface ResolvedInkadeViewTarget {
  readonly routePath: string;
  readonly queryParams: Readonly<Record<string, string>>;
  readonly label: string;
}

export function resolveInkadeViewRoute(input: ShowInkadeViewInput): ResolvedInkadeViewTarget {
  switch (input.target) {
    case "daily":
      return { routePath: "/daily", queryParams: {}, label: "Daily Outline" };
    case "tasks":
      return { routePath: "/tasks", queryParams: {}, label: "Tasks" };
    case "inbox":
      return { routePath: "/inbox", queryParams: {}, label: "Inbox" };
    case "document": {
      if (!input.documentId) {
        throw new InkadeError(
          "VALIDATION_ERROR",
          'Target "document" requires a non-empty documentId',
        );
      }
      const queryParams: Record<string, string> = {};
      if (input.headingSlug) {
        queryParams.heading = input.headingSlug;
      }
      return {
        routePath: `/docs/${encodeURIComponent(input.documentId)}`,
        queryParams,
        label: "Document",
      };
    }
    case "diff": {
      if (!input.documentId) {
        throw new InkadeError(
          "VALIDATION_ERROR",
          'Target "diff" requires a non-empty documentId',
        );
      }
      const queryParams: Record<string, string> = { view: "diff" };
      if (input.headingSlug) {
        queryParams.heading = input.headingSlug;
      }
      if (input.fromVersion !== undefined) {
        queryParams.fromVersion = String(input.fromVersion);
      }
      if (input.toVersion !== undefined) {
        queryParams.toVersion = String(input.toVersion);
      }
      return {
        routePath: `/docs/${encodeURIComponent(input.documentId)}`,
        queryParams,
        label: "Revision Diff",
      };
    }
    default: {
      const _exhaustive: never = input.target;
      return _exhaustive;
    }
  }
}

export function buildInkadeViewUrls(options: {
  readonly baseUrl: string;
  readonly routePath: string;
  readonly queryParams?: Readonly<Record<string, string>> | undefined;
  readonly embedTicket: string;
}): {
  readonly embedUrl: string;
  readonly browserUrl: string;
  readonly expectedOrigin: string;
} {
  const cleanBase = options.baseUrl.replace(/\/+$/, "");
  const browserUrlObj = new URL(`${cleanBase}${options.routePath}`);
  for (const [key, val] of Object.entries(options.queryParams ?? {})) {
    browserUrlObj.searchParams.set(key, val);
  }

  const embedUrlObj = new URL(browserUrlObj.toString());
  embedUrlObj.searchParams.set("embed", "1");
  embedUrlObj.searchParams.set("chrome", "minimal");
  embedUrlObj.searchParams.set("embedTicket", options.embedTicket);

  return {
    embedUrl: embedUrlObj.toString(),
    browserUrl: browserUrlObj.toString(),
    expectedOrigin: embedUrlObj.origin,
  };
}

function escapeHtml(raw: string): string {
  return raw
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function serializeInlineScriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026");
}

export interface BuildMcpAppsCardHtmlOptions {
  readonly title: string;
  readonly target: ShowInkadeViewTarget;
  readonly embedUrl: string;
  readonly browserUrl: string;
  readonly expectedOrigin: string;
  readonly expiresAt: string;
  readonly readyTimeoutMs?: number | undefined;
}

/**
 * Generates a self-contained MCP Apps card HTML shell embedding Inkade via `embedTicket`,
 * with `securitypolicyviolation` interception, 10s `inkade.ready` timeout detection,
 * and a graceful fallback panel offering direct browser launch and URL copy.
 */
export function buildMcpAppsCardHtml(options: BuildMcpAppsCardHtmlOptions): string {
  const readyTimeoutMs = options.readyTimeoutMs ?? MCP_APPS_READY_TIMEOUT_MS;
  const safeTitle = escapeHtml(options.title);
  const safeEmbedUrl = escapeHtml(options.embedUrl);
  const safeBrowserUrl = escapeHtml(options.browserUrl);
  const runtimeConfig = serializeInlineScriptJson({
    protocol: INKADE_EMBED_PROTOCOL,
    expectedOrigin: options.expectedOrigin,
    browserUrl: options.browserUrl,
    readyTimeoutMs,
    expiresAt: options.expiresAt,
    target: options.target,
  });

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeTitle} — Inkade</title>
  <style>
    :root {
      color-scheme: light dark;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      min-height: 460px;
      background: #f8fafc;
      color: #0f172a;
    }
    @media (prefers-color-scheme: dark) {
      html, body {
        background: #0b1120;
        color: #e2e8f0;
      }
    }
    .inkade-shell {
      position: relative;
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      min-height: 460px;
      box-sizing: border-box;
    }
    .inkade-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 8px 12px;
      border-bottom: 1px solid rgba(148, 163, 184, 0.28);
      font-size: 12px;
    }
    .inkade-title {
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .inkade-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }
    .inkade-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 10px;
      border-radius: 6px;
      border: 1px solid rgba(148, 163, 184, 0.45);
      background: transparent;
      color: inherit;
      font-size: 12px;
      font-weight: 500;
      text-decoration: none;
      cursor: pointer;
    }
    .inkade-btn-primary {
      background: #2563eb;
      border-color: #2563eb;
      color: #ffffff;
    }
    .inkade-frame {
      flex: 1;
      width: 100%;
      min-height: 410px;
      border: 0;
      display: block;
    }
    .inkade-fallback {
      flex: 1;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      text-align: center;
      padding: 24px;
      gap: 12px;
    }
    .inkade-fallback[hidden] {
      display: none;
    }
    .inkade-fallback p {
      margin: 0;
      max-width: 460px;
      font-size: 13px;
      line-height: 1.5;
      opacity: 0.85;
    }
    .inkade-url-box {
      max-width: 100%;
      padding: 8px 10px;
      border-radius: 6px;
      border: 1px solid rgba(148, 163, 184, 0.35);
      background: rgba(148, 163, 184, 0.12);
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 11px;
      word-break: break-all;
    }
  </style>
</head>
<body>
  <div class="inkade-shell" data-target="${escapeHtml(options.target)}">
    <header class="inkade-toolbar">
      <span class="inkade-title">${safeTitle}</span>
      <div class="inkade-actions">
        <a class="inkade-btn" href="${safeBrowserUrl}" target="_blank" rel="noopener noreferrer">在浏览器中打开 / Open in Browser</a>
      </div>
    </header>
    <iframe
      id="inkade-app-frame"
      class="inkade-frame"
      src="${safeEmbedUrl}"
      allow="clipboard-write"
      referrerpolicy="no-referrer"
      title="${safeTitle}"
    ></iframe>
    <section id="inkade-fallback" class="inkade-fallback" hidden aria-live="polite">
      <strong>无法在当前内嵌卡片中加载 Inkade（Blocked or Timed Out）</strong>
      <p id="inkade-fallback-reason">宿主安全策略或本地环回限制拦截了内嵌帧，请直接在浏览器中打开或复制页面地址。</p>
      <div class="inkade-url-box">
        <code id="inkade-copy-url">${safeBrowserUrl}</code>
      </div>
      <div class="inkade-actions">
        <a id="inkade-open-browser" class="inkade-btn inkade-btn-primary" href="${safeBrowserUrl}" target="_blank" rel="noopener noreferrer">在浏览器中打开</a>
        <button id="inkade-copy-btn" class="inkade-btn" type="button">复制页面地址</button>
      </div>
      <span id="inkade-copy-feedback" style="font-size:11px;opacity:0.75;"></span>
    </section>
  </div>
  <script>
    (function () {
      const cfg = ${runtimeConfig};
      const frame = document.getElementById("inkade-app-frame");
      const fallback = document.getElementById("inkade-fallback");
      const reasonEl = document.getElementById("inkade-fallback-reason");
      const copyBtn = document.getElementById("inkade-copy-btn");
      const copyFeedback = document.getElementById("inkade-copy-feedback");
      let ready = false;

      function showFallback(kind, detail) {
        if (ready || !fallback || !frame) return;
        frame.hidden = true;
        fallback.hidden = false;
        if (reasonEl) {
          if (kind === "csp_violation") {
            reasonEl.textContent = "检测到宿主内容安全策略拦截（securitypolicyviolation" + (detail ? ": " + detail : "") + "）。请点击下方按钮在浏览器中打开，或复制地址访问。";
          } else if (kind === "ready_timeout") {
            reasonEl.textContent = "等待 Inkade 嵌入握手（inkade.ready）超过 10 秒未响应，可能被宿主禁止访问本地环回网络。";
          } else {
            reasonEl.textContent = "内嵌视图加载受限，请直接在浏览器中打开或复制页面地址。";
          }
        }
      }

      window.addEventListener("securitypolicyviolation", function (event) {
        showFallback("csp_violation", event.violatedDirective || event.effectiveDirective || "");
      });

      window.addEventListener("message", function (event) {
        if (!event || !event.data || typeof event.data !== "object") return;
        if (cfg.expectedOrigin && event.origin && event.origin !== cfg.expectedOrigin) return;
        if (event.data.protocol === cfg.protocol && event.data.type === "inkade.ready") {
          ready = true;
          if (fallback) fallback.hidden = true;
          if (frame) frame.hidden = false;
          clearTimeout(readyTimer);
        }
      });

      if (frame) {
        frame.addEventListener("error", function () {
          showFallback("frame_error");
        });
      }

      const readyTimer = setTimeout(function () {
        if (!ready) {
          showFallback("ready_timeout");
        }
      }, cfg.readyTimeoutMs);

      if (copyBtn) {
        copyBtn.addEventListener("click", function () {
          const onCopied = function () {
            if (copyFeedback) copyFeedback.textContent = "已复制页面地址 / Copied URL";
          };
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(cfg.browserUrl).then(onCopied, function () {
              if (copyFeedback) copyFeedback.textContent = cfg.browserUrl;
            });
          } else {
            if (copyFeedback) copyFeedback.textContent = cfg.browserUrl;
          }
        });
      }
    })();
  </script>
</body>
</html>
`;
}

export interface McpAppCardEntry {
  readonly cardId: string;
  readonly uri: string;
  readonly html: string;
  readonly meta: Record<string, unknown>;
  readonly principalKey: string;
  readonly expiresAtMs: number;
}

const DEFAULT_MAX_CARDS = 500;
const DEFAULT_CARD_TTL_MS = 5 * 60_000;

export class McpAppsCardStore {
  private readonly cards = new Map<string, McpAppCardEntry>();
  private readonly maxCards: number;
  private readonly ttlMs: number;

  constructor(options?: { readonly maxCards?: number; readonly ttlMs?: number }) {
    this.maxCards = Math.max(1, options?.maxCards ?? DEFAULT_MAX_CARDS);
    this.ttlMs = Math.max(1_000, options?.ttlMs ?? DEFAULT_CARD_TTL_MS);
  }

  private prune(nowMs: number): void {
    for (const [id, entry] of this.cards) {
      if (entry.expiresAtMs <= nowMs) {
        this.cards.delete(id);
      }
    }
  }

  save(entry: Omit<McpAppCardEntry, "expiresAtMs">): McpAppCardEntry {
    const nowMs = Date.now();
    this.prune(nowMs);
    while (this.cards.size >= this.maxCards) {
      const oldest = this.cards.keys().next().value;
      if (oldest === undefined) break;
      this.cards.delete(oldest);
    }
    const stored: McpAppCardEntry = {
      ...entry,
      expiresAtMs: nowMs + this.ttlMs,
    };
    this.cards.set(entry.cardId, stored);
    return stored;
  }

  get(cardId: string, principalKey: string): McpAppCardEntry | null {
    const nowMs = Date.now();
    this.prune(nowMs);
    const entry = this.cards.get(cardId);
    if (!entry) return null;
    if (entry.principalKey !== principalKey) {
      return null;
    }
    return entry;
  }
}

export function principalKeyOf(principal: Principal): string {
  return principal.kind === "token"
    ? `tok:${principal.workspaceId}:${principal.tokenId}`
    : `usr:${principal.workspaceId}:${principal.userId}`;
}

export interface RegisterMcpAppsOptions {
  readonly server: McpServer;
  readonly principal: Principal;
  readonly services: InkadeServices;
  readonly embedTickets: EmbedTicketManager;
  readonly baseUrl: string;
  readonly cardStore: McpAppsCardStore;
  readonly wrapToolError: (error: unknown) => {
    readonly isError: true;
    readonly content: { readonly type: "text"; readonly text: string }[];
  };
}

/**
 * Registers `show_inkade_view` tool and `ui://inkade/view/{cardId}` resource template
 * exclusively for MCP clients that advertise `io.modelcontextprotocol/ui`.
 */
export function registerMcpAppsExtension(options: RegisterMcpAppsOptions): void {
  const { server, principal, services, embedTickets, baseUrl, cardStore, wrapToolError } = options;
  const principalKey = principalKeyOf(principal);

  server.registerResource(
    "inkade-view-card",
    new ResourceTemplate("ui://inkade/view/{cardId}", {
      list: undefined,
    }),
    {
      title: "Inkade Interactive View Card",
      description: "MCP Apps inline HTML card embedding a scoped Inkade view.",
      mimeType: MCP_APP_RESOURCE_MIME_TYPE,
      _meta: buildMcpAppsUiMeta({ baseUrl }),
    },
    (uri, variables) => {
      const rawCardId = variables.cardId;
      const cardId = Array.isArray(rawCardId) ? rawCardId[0] : rawCardId;
      if (!cardId) {
        throw new InkadeError("NOT_FOUND", "Missing MCP App card id");
      }
      const card = cardStore.get(cardId, principalKey);
      if (!card) {
        throw new InkadeError("NOT_FOUND", `MCP App card "${cardId}" not found or expired`);
      }
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: MCP_APP_RESOURCE_MIME_TYPE,
            text: card.html,
            _meta: card.meta,
          },
        ],
      };
    },
  );

  server.registerTool(
    SHOW_INKADE_VIEW_TOOL_NAME,
    {
      description:
        "Render an inline interactive Inkade view card (Daily, Document, Tasks, Diff, or Inbox) with a single-use 60s embedTicket for MCP Apps UI hosts.",
      inputSchema: showInkadeViewInputShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      _meta: buildMcpAppsUiMeta({ baseUrl }),
    },
    async (args) => {
      try {
        const parsed = showInkadeViewInputSchema.parse(args);
        const resolved = resolveInkadeViewRoute(parsed);

        let cardTitle = resolved.label;
        if (parsed.target === "document" || parsed.target === "diff") {
          const doc = await services.document.getDocument(
            principal,
            parsed.documentId as DocumentId,
          );
          cardTitle =
            parsed.target === "diff" ? `${doc.title} — Revision Diff` : doc.title;
        }

        const issued = await embedTickets.issueTicket(principal);
        const urls = buildInkadeViewUrls({
          baseUrl,
          routePath: resolved.routePath,
          queryParams: resolved.queryParams,
          embedTicket: issued.ticket,
        });

        const cardId = crypto.randomUUID().replaceAll("-", "").slice(0, 16);
        const resourceUri = `ui://inkade/view/${cardId}`;
        const meta = buildMcpAppsUiMeta({
          baseUrl,
          resourceUri,
          embedUrl: urls.embedUrl,
          browserUrl: urls.browserUrl,
          target: parsed.target,
          expiresAt: issued.expiresAt,
          embedSessionId: issued.embedSessionId,
        });

        const html = buildMcpAppsCardHtml({
          title: cardTitle,
          target: parsed.target,
          embedUrl: urls.embedUrl,
          browserUrl: urls.browserUrl,
          expectedOrigin: urls.expectedOrigin,
          expiresAt: issued.expiresAt,
        });

        cardStore.save({
          cardId,
          uri: resourceUri,
          html,
          meta,
          principalKey,
        });

        return {
          _meta: meta,
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  ok: true,
                  target: parsed.target,
                  title: cardTitle,
                  routePath: resolved.routePath,
                  resourceUri,
                  embedUrl: urls.embedUrl,
                  browserUrl: urls.browserUrl,
                  ttlSeconds: issued.ttlSeconds,
                  expiresAt: issued.expiresAt,
                  embedSessionId: issued.embedSessionId,
                },
                null,
                2,
              ),
            },
            {
              type: "resource" as const,
              resource: {
                uri: resourceUri,
                mimeType: MCP_APP_RESOURCE_MIME_TYPE,
                text: html,
                _meta: meta,
              },
            },
          ],
        };
      } catch (error) {
        return wrapToolError(error);
      }
    },
  );
}
