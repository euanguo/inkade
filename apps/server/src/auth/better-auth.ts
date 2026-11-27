import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { accounts, sessions, users, verifications, type InkadeSqliteDb } from "@inkade/db";

export interface BetterAuthConfigOptions {
  readonly db: InkadeSqliteDb;
  readonly secret?: string | undefined;
  readonly baseURL?: string | undefined;
  readonly appOrigin?: string | undefined;
  readonly trustedOrigins?: readonly string[] | undefined;
  readonly useHostCookiePrefix?: boolean | undefined;
}

const DEFAULT_DEV_SECRET = "inkade-local-development-secret-change-me-32bytes";
const KNOWN_PLACEHOLDER_SECRETS = new Set([
  DEFAULT_DEV_SECRET,
  "replace-with-a-random-32-char-secret",
  "change-me-in-production-min-32-chars",
]);

function splitOriginList(raw?: string): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function tryExtractOrigin(raw?: string): string | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = new URL(raw.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.origin : null;
  } catch {
    return null;
  }
}

/**
 * Reports whether an auth signing secret is missing, short (<32 chars), or a shipped placeholder.
 */
export function isPlaceholderAuthSecret(rawSecret?: string | null): boolean {
  const trimmed = rawSecret?.trim() ?? "";
  return trimmed.length < 32 || KNOWN_PLACEHOLDER_SECRETS.has(trimmed);
}

/**
 * Resolves Better Auth trustedOrigins for both local dev loopback and reverse-proxied public domains.
 */
export function buildBetterAuthTrustedOrigins(options: {
  readonly baseURL?: string | undefined;
  readonly appOrigin?: string | undefined;
  readonly trustedOrigins?: readonly string[] | undefined;
  readonly envTrustedOrigins?: string | undefined;
  readonly envCorsOrigins?: string | undefined;
}): string[] {
  const origins = new Set<string>([
    "http://localhost:*",
    "http://127.0.0.1:*",
    "http://[::1]:*",
    "https://localhost:*",
    "https://127.0.0.1:*",
    "https://[::1]:*",
  ]);

  const candidates = [
    tryExtractOrigin(options.baseURL),
    tryExtractOrigin(options.appOrigin),
    tryExtractOrigin(process.env.INKADE_BASE_URL),
    tryExtractOrigin(process.env.INKADE_APP_ORIGIN),
    ...(options.trustedOrigins ?? []),
    ...splitOriginList(options.envTrustedOrigins ?? process.env.INKADE_TRUSTED_ORIGINS),
    ...splitOriginList(options.envCorsOrigins ?? process.env.INKADE_CORS_ORIGINS),
  ];

  for (const item of candidates) {
    if (item?.trim()) {
      origins.add(item.trim());
    }
  }

  return [...origins];
}

export function createInkadeAuth(options: BetterAuthConfigOptions) {
  const baseURL =
    options.baseURL ??
    process.env.INKADE_BASE_URL ??
    process.env.INKADE_APP_ORIGIN ??
    "http://localhost:3456";
  const secret =
    options.secret ??
    process.env.INKADE_AUTH_SECRET ??
    process.env.BETTER_AUTH_SECRET ??
    DEFAULT_DEV_SECRET;

  const trustedOrigins = options.trustedOrigins
    ? [...options.trustedOrigins]
    : buildBetterAuthTrustedOrigins({
        baseURL,
        appOrigin: options.appOrigin,
      });

  const enableHostPrefix = options.useHostCookiePrefix === true && baseURL.startsWith("https://");

  return betterAuth({
    basePath: "/api/auth",
    baseURL,
    secret,
    trustedOrigins,
    ...(enableHostPrefix
      ? {
          advanced: {
            useSecureCookies: false,
            cookiePrefix: "__Host-inkade",
            defaultCookieAttributes: {
              secure: true,
              path: "/",
              httpOnly: true,
              sameSite: "lax" as const,
            },
          },
        }
      : {}),
    database: drizzleAdapter(options.db, {
      provider: "sqlite",
      schema: {
        user: users,
        session: sessions,
        account: accounts,
        verification: verifications,
      },
    }),
    emailAndPassword: {
      enabled: true,
    },
  });
}

export type InkadeAuth = ReturnType<typeof createInkadeAuth>;
