import type { Hono, MiddlewareHandler } from "hono";
import {
  INKADE_ARTIFACT_CHANNEL,
  isLoopbackHostname,
  matchesSandboxHostname,
  normalizeHostnameInput,
  type ArtifactSandboxResolvedPayload,
} from "@inkade/core";
import type { SandboxRuntimeConfig } from "../services/artifact-service.ts";
import type { InkadeServices } from "../services/index.ts";
import type { InkadeAppEnv } from "../types.ts";

function extractRequestHostname(req: Request, headerHost?: string): string {
  const raw = headerHost?.trim() || new URL(req.url).host;
  return normalizeHostnameInput(raw);
}

function isSandboxPath(pathname: string): boolean {
  return pathname === "/sandbox" || pathname.startsWith("/sandbox/");
}

function escapeHtmlText(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeJsonForInlineScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function stripRequestCookies(rawReq: Request): void {
  try {
    rawReq.headers.delete("cookie");
  } catch {
    // Ignore immutable request header runtimes
  }
}

function stripResponseCookies(headers: Headers): void {
  headers.delete("set-cookie");
}

function buildSandboxBootstrapScript(
  payload: ArtifactSandboxResolvedPayload,
  ticket: string,
): string {
  const bootstrapData = {
    channel: INKADE_ARTIFACT_CHANNEL,
    artifactId: payload.artifactId,
    documentId: payload.documentId,
    title: payload.title,
    ticket,
    appOrigin: payload.appOrigin,
    sameSite: payload.sameSite,
    capabilities: {
      theme: payload.capabilities.theme === true,
      sources: payload.capabilities.sources === true,
      comment: payload.capabilities.comment === true,
    },
    sources: payload.capabilities.sources === true ? payload.sources : [],
  };

  return `<script data-inkade-sandbox-runtime="1">
(function(){
  var cfg = ${safeJsonForInlineScript(bootstrapData)};
  var targetOrigin = cfg.appOrigin || "*";
  var currentTheme = {
    mode: "light",
    paper: "default",
    tokens: {
      bg: "#ffffff",
      fg: "#171717",
      muted: "#6b6f76",
      border: "rgba(0,0,0,0.08)",
      surface: "#f5f5f5",
      accent: "#171717",
      codeBg: "#f8f8f9"
    }
  };
  var themeListeners = [];
  var pendingComments = Object.create(null);
  var reqSeq = 0;

  function applyThemeTokens(themePayload) {
    if (!themePayload || typeof themePayload !== "object") return;
    currentTheme = {
      mode: themePayload.mode === "dark" ? "dark" : "light",
      paper: themePayload.paper === "sepia" ? "sepia" : "default",
      tokens: themePayload.tokens && typeof themePayload.tokens === "object"
        ? Object.assign({}, currentTheme.tokens, themePayload.tokens)
        : currentTheme.tokens
    };
    var root = document.documentElement;
    if (root) {
      root.dataset.inkadeTheme = currentTheme.mode;
      root.dataset.inkadePaper = currentTheme.paper;
      root.style.colorScheme = currentTheme.mode;
      var t = currentTheme.tokens;
      var cssVars = {
        "--inkade-bg": t.bg,
        "--inkade-fg": t.fg,
        "--inkade-muted": t.muted,
        "--inkade-border": t.border,
        "--inkade-surface": t.surface,
        "--inkade-accent": t.accent,
        "--inkade-code-bg": t.codeBg,
        "--bg": t.bg,
        "--fg": t.fg,
        "--muted": t.muted,
        "--border": t.border,
        "--surface": t.surface,
        "--accent": t.accent,
        "--code-bg": t.codeBg
      };
      if (typeof t.accent === "string") {
        root.style.accentColor = t.accent;
      }
      for (var k in cssVars) {
        if (Object.prototype.hasOwnProperty.call(cssVars, k) && typeof cssVars[k] === "string") {
          root.style.setProperty(k, cssVars[k]);
        }
      }
    }
    for (var i = 0; i < themeListeners.length; i++) {
      try { themeListeners[i](currentTheme); } catch (_e) {}
    }
  }

  window.addEventListener("message", function(event) {
    if (event.origin !== cfg.appOrigin) return;
    var data = event.data;
    if (!data || typeof data !== "object" || data.channel !== cfg.channel) return;
    if (data.artifactId && data.artifactId !== cfg.artifactId) return;
    if (data.type === "theme.sync") {
      applyThemeTokens(data.payload);
    } else if (data.type === "artifact.comment.result" && data.requestId) {
      var pending = pendingComments[data.requestId];
      if (pending) {
        delete pendingComments[data.requestId];
        if (data.ok) {
          pending.resolve(data.payload || { ok: true });
        } else {
          pending.reject(new Error(data.error || "Comment submission failed"));
        }
      }
    }
  });

  function postToHost(type, payload, extra) {
    if (!window.parent || window.parent === window) return;
    var msg = Object.assign(
      {
        channel: cfg.channel,
        artifactId: cfg.artifactId,
        type: type,
        payload: payload
      },
      extra || {}
    );
    window.parent.postMessage(msg, targetOrigin);
  }

  var api = Object.freeze({
    use: function(capability) {
      if (capability === "theme") {
        if (!cfg.capabilities.theme) {
          return Promise.reject(new Error('Capability "theme" is not declared for this artifact.'));
        }
        return Promise.resolve({
          get: function() { return currentTheme; },
          subscribe: function(fn) {
            if (typeof fn === "function") {
              themeListeners.push(fn);
              fn(currentTheme);
            }
            return function() {
              var idx = themeListeners.indexOf(fn);
              if (idx >= 0) themeListeners.splice(idx, 1);
            };
          }
        });
      }
      if (capability === "sources") {
        if (!cfg.capabilities.sources) {
          return Promise.reject(new Error('Capability "sources" is not declared for this artifact.'));
        }
        var snapshot = JSON.parse(JSON.stringify(cfg.sources || []));
        return Promise.resolve({
          sources: snapshot,
          list: function() { return snapshot; }
        });
      }
      if (capability === "comment") {
        if (!cfg.capabilities.comment) {
          return Promise.reject(new Error('Capability "comment" is not declared for this artifact.'));
        }
        if (cfg.sameSite) {
          return Promise.reject(new Error("Comment mutation is disabled in same-site degraded mode."));
        }
        return Promise.resolve({
          submit: function(handoffNoteOrOpts, maybeOpts) {
            var handoffNote = typeof handoffNoteOrOpts === "string"
              ? handoffNoteOrOpts
              : (handoffNoteOrOpts && typeof handoffNoteOrOpts.handoffNote === "string" ? handoffNoteOrOpts.handoffNote : "");
            var authorName = typeof handoffNoteOrOpts === "object" && handoffNoteOrOpts
              ? handoffNoteOrOpts.authorName
              : (maybeOpts && maybeOpts.authorName);
            if (!handoffNote || !handoffNote.trim()) {
              return Promise.reject(new Error("handoffNote is required."));
            }
            var requestId = "req_" + (++reqSeq);
            return new Promise(function(resolve, reject) {
              pendingComments[requestId] = { resolve: resolve, reject: reject };
              postToHost("artifact.comment", {
                handoffNote: handoffNote.trim(),
                authorName: authorName
              }, { requestId: requestId });
            });
          }
        });
      }
      return Promise.reject(new Error("Unknown window.inkade capability: " + String(capability)));
    }
  });

  try {
    Object.defineProperty(window, "inkade", {
      value: api,
      writable: false,
      configurable: false,
      enumerable: true
    });
  } catch (_e) {
    window.inkade = api;
  }

  var resizeTimer = null;
  var lastPostedHeight = 0;
  function measureAndPostHeight() {
    var docEl = document.documentElement;
    var bodyEl = document.body;
    var rawH = Math.max(
      docEl ? docEl.scrollHeight : 0,
      bodyEl ? bodyEl.scrollHeight : 0
    );
    var clamped = Math.max(160, Math.min(1200, Math.ceil(rawH)));
    if (clamped > 0 && Math.abs(clamped - lastPostedHeight) >= 4) {
      lastPostedHeight = clamped;
      postToHost("artifact.height", { heightPx: clamped });
    }
  }

  function scheduleResizeReport() {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(measureAndPostHeight, 120);
  }

  window.addEventListener("DOMContentLoaded", function() {
    postToHost("artifact.ready", {
      artifactId: cfg.artifactId,
      sameSite: cfg.sameSite
    });
    measureAndPostHeight();
    if (typeof ResizeObserver !== "undefined" && document.body) {
      var ro = new ResizeObserver(scheduleResizeReport);
      ro.observe(document.body);
    }
  });

  window.addEventListener("keydown", function(event) {
    if (event.key === "Escape" && !event.defaultPrevented && !event.isComposing) {
      postToHost("artifact.escape", {});
    }
  });
})();
</script>`;
}

export function injectInkadeSandboxRuntime(
  payload: ArtifactSandboxResolvedPayload,
  ticket: string,
): string {
  const runtimeScript = buildSandboxBootstrapScript(payload, ticket);
  const rawHtml = payload.htmlSource;
  const headMatch = /<head\b[^>]*>/i.exec(rawHtml);
  if (headMatch) {
    const insertIdx = headMatch.index + headMatch[0].length;
    return `${rawHtml.slice(0, insertIdx)}\n${runtimeScript}\n${rawHtml.slice(insertIdx)}`;
  }

  const htmlTagMatch = /<html\b[^>]*>/i.exec(rawHtml);
  if (htmlTagMatch) {
    const insertIdx = htmlTagMatch.index + htmlTagMatch[0].length;
    return `${rawHtml.slice(0, insertIdx)}\n<head>${runtimeScript}</head>\n${rawHtml.slice(insertIdx)}`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtmlText(payload.title)}</title>
  ${runtimeScript}
</head>
<body>
${rawHtml}
</body>
</html>`;
}

function applySameSiteSecurityHeaders(c: Parameters<MiddlewareHandler<InkadeAppEnv>>[0]): void {
  c.header("Cross-Origin-Resource-Policy", "same-origin");
  c.header("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  c.header("Origin-Agent-Cluster", "?1");
}

export function createSandboxIsolationMiddleware(
  runtimeConfig: SandboxRuntimeConfig,
): MiddlewareHandler<InkadeAppEnv> {
  return async (c, next) => {
    const reqHostname = extractRequestHostname(
      c.req.raw,
      c.req.header("x-forwarded-host") ?? c.req.header("host"),
    );
    const pathname = c.req.path;
    const onSandboxPath = isSandboxPath(pathname);
    const isSandboxHost = matchesSandboxHostname(
      reqHostname,
      runtimeConfig.configuredSandboxOrigin,
      runtimeConfig.appHostname,
    );

    if (onSandboxPath) {
      stripRequestCookies(c.req.raw);

      if (!runtimeConfig.sameSite && !isSandboxHost) {
        return c.json(
          {
            error: {
              code: "MISDIRECTED_REQUEST",
              message: "Sandbox routes are only served from the isolated sandbox host.",
            },
          },
          421,
        );
      }

      if (
        runtimeConfig.sameSite &&
        !runtimeConfig.configuredSandboxOrigin &&
        runtimeConfig.hasExplicitAppOrigin &&
        reqHostname !== runtimeConfig.appHostname
      ) {
        return c.json(
          {
            error: {
              code: "MISDIRECTED_REQUEST",
              message: "Sandbox host mismatch.",
            },
          },
          421,
        );
      }

      if (
        runtimeConfig.sameSite &&
        !runtimeConfig.configuredSandboxOrigin &&
        !runtimeConfig.hasExplicitAppOrigin &&
        reqHostname &&
        !isLoopbackHostname(reqHostname)
      ) {
        return c.json(
          {
            error: {
              code: "MISDIRECTED_REQUEST",
              message: "Sandbox host mismatch.",
            },
          },
          421,
        );
      }

      await next();
      stripResponseCookies(c.res.headers);
      if (runtimeConfig.sameSite) {
        applySameSiteSecurityHeaders(c);
      }
      return;
    }

    if (isSandboxHost) {
      return c.json(
        {
          error: {
            code: "MISDIRECTED_REQUEST",
            message: "Application and API endpoints are forbidden on the sandbox host.",
          },
        },
        421,
      );
    }

    if (runtimeConfig.sameSite) {
      const method = c.req.method.toUpperCase();
      if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
        const secFetchSite = c.req.header("sec-fetch-site")?.trim().toLowerCase();
        const reqOrigin = c.req.header("origin")?.trim();
        const hasAuthorization = Boolean(c.req.header("authorization")?.trim());
        const hasCookie = Boolean(c.req.header("cookie")?.trim());

        const reqUrl = new URL(c.req.url);
        const forwardedProto = c.req.header("x-forwarded-proto")?.split(",")[0]?.trim();
        const forwardedHost = c.req.header("x-forwarded-host")?.split(",")[0]?.trim();
        const expectedOrigin = runtimeConfig.hasExplicitAppOrigin
          ? runtimeConfig.appOrigin
          : `${forwardedProto || reqUrl.protocol.replace(":", "")}://${forwardedHost || c.req.header("host") || reqUrl.host}`;

        if (hasAuthorization) {
          if (secFetchSite !== undefined && secFetchSite !== "same-origin") {
            return c.json(
              {
                error: {
                  code: "FORBIDDEN",
                  message: "Cross-site browser mutations are blocked in same-site sandbox mode.",
                },
              },
              403,
            );
          }
          if (
            reqOrigin !== undefined &&
            (reqOrigin.toLowerCase() === "null" || reqOrigin !== expectedOrigin)
          ) {
            return c.json(
              {
                error: {
                  code: "FORBIDDEN",
                  message: "Origin mismatch blocked by same-site sandbox policy.",
                },
              },
              403,
            );
          }
        } else {
          if (secFetchSite !== undefined && secFetchSite !== "same-origin") {
            return c.json(
              {
                error: {
                  code: "FORBIDDEN",
                  message: "Mutations require Sec-Fetch-Site: same-origin in same-site sandbox mode.",
                },
              },
              403,
            );
          }
          if (secFetchSite === undefined && hasCookie) {
            return c.json(
              {
                error: {
                  code: "FORBIDDEN",
                  message: "Cookie-authenticated mutations require Sec-Fetch-Site: same-origin.",
                },
              },
              403,
            );
          }
          if (
            reqOrigin !== undefined &&
            (reqOrigin.toLowerCase() === "null" || reqOrigin !== expectedOrigin)
          ) {
            return c.json(
              {
                error: {
                  code: "FORBIDDEN",
                  message: "Cross-origin mutation blocked in same-site sandbox mode.",
                },
              },
              403,
            );
          }
        }
      }
    }

    await next();

    if (runtimeConfig.sameSite) {
      applySameSiteSecurityHeaders(c);
    }
  };
}

export function registerSandboxHostRoutes(
  app: Hono<InkadeAppEnv>,
  services: InkadeServices,
  runtimeConfig: SandboxRuntimeConfig,
): void {
  app.get("/sandbox/:ticket", async (c) => {
    stripRequestCookies(c.req.raw);
    const ticket = c.req.param("ticket");
    const payload = await services.artifact.resolveArtifactSandboxRenderData(ticket);
    if (!payload) {
      return new Response(
        `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Sandbox Expired</title></head><body><p>Sandbox ticket is invalid or expired.</p></body></html>`,
        {
          status: 401,
          headers: {
            "content-type": "text/html; charset=utf-8",
            "content-security-policy": "default-src 'none'; sandbox",
            "cache-control": "no-store, max-age=0",
            "referrer-policy": "no-referrer",
            "x-content-type-options": "nosniff",
          },
        },
      );
    }

    const reqHostname = extractRequestHostname(
      c.req.raw,
      c.req.header("x-forwarded-host") ?? c.req.header("host"),
    );
    const expectedSandboxHostname = normalizeHostnameInput(new URL(payload.sandboxOrigin).hostname);
    const hasPerArtifactHost =
      !payload.sameSite ||
      Boolean(
        runtimeConfig.configuredSandboxOrigin &&
          (runtimeConfig.configuredSandboxOrigin.includes("{id}") ||
            runtimeConfig.configuredSandboxOrigin.includes("*.")),
      );

    if (hasPerArtifactHost && reqHostname !== expectedSandboxHostname) {
      return c.json(
        {
          error: {
            code: "MISDIRECTED_REQUEST",
            message: "Sandbox ticket does not match the requested artifact subdomain.",
          },
        },
        421,
      );
    }

    const html = injectInkadeSandboxRuntime(payload, ticket);
    return new Response(html, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-security-policy": payload.cspHeader,
        "cache-control": "no-store, max-age=0",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
      },
    });
  });

  app.all("/sandbox/*", (_c) => {
    return new Response("Not Found", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "content-security-policy": "default-src 'none'",
        "cache-control": "no-store, max-age=0",
        "x-content-type-options": "nosniff",
      },
    });
  });
}
