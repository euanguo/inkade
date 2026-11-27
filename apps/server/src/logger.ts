import { createMiddleware } from "hono/factory";
import pino, { type Logger } from "pino";
import type { InkadeAppEnv } from "./types.ts";

export type ServerLogger = Logger;

export interface CreateServerLoggerOptions {
  readonly level?: string | undefined;
}

function isTestRuntime(): boolean {
  if (process.env.NODE_ENV === "test" || process.env.BUN_ENV === "test") {
    return true;
  }
  return typeof Bun !== "undefined" && Array.isArray(Bun.argv)
    ? Bun.argv.some((arg) => arg === "test" || arg.endsWith(".test.ts"))
    : false;
}

/**
 * Creates a structured JSON logger powered by `pino`.
 */
export function createServerLogger(options?: CreateServerLoggerOptions): ServerLogger {
  const level =
    options?.level ??
    process.env.INKADE_LOG_LEVEL ??
    process.env.LOG_LEVEL ??
    (isTestRuntime() ? "silent" : "info");
  return pino({
    name: "inkade-server",
    level,
    base: null,
    redact: {
      paths: [
        "req.headers.authorization",
        "headers.authorization",
        "apiKey",
        "*.apiKey",
        "token",
        "*.token",
      ],
      censor: "[REDACTED]",
    },
  });
}

/**
 * Attaches a per-request correlation ID (`X-Request-Id`) and logs structured request metrics.
 */
export function createRequestLoggerMiddleware(logger: ServerLogger) {
  return createMiddleware<InkadeAppEnv>(async (c, next) => {
    const incomingId = c.req.header("x-request-id")?.trim();
    const requestId = incomingId && incomingId.length > 0 ? incomingId : crypto.randomUUID();
    const startMs = performance.now();
    c.header("X-Request-Id", requestId);

    try {
      await next();
    } finally {
      const durationMs = Number((performance.now() - startMs).toFixed(2));
      const principal = c.get("principal");
      logger.info(
        {
          requestId,
          method: c.req.method,
          path: c.req.path,
          status: c.res.status,
          durationMs,
          ...(principal ? { principalKind: principal.kind } : {}),
        },
        "http request",
      );
    }
  });
}
