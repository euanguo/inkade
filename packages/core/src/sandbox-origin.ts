import { InkadeError } from "./errors.ts";

export const ARTIFACT_HTML_MAX_BYTES = 512 * 1024;

export type SandboxIsolationMode = "dual_origin" | "dev_localhost" | "same_site";

export interface DualOriginConfigInput {
  readonly appOrigin: string;
  readonly sandboxOrigin?: string | undefined;
  readonly sameSiteOptIn?: boolean | undefined;
}

export interface ValidatedDualOriginConfig {
  readonly mode: SandboxIsolationMode;
  readonly appOrigin: string;
  readonly sandboxOriginPattern: string;
  readonly appSite: string;
  readonly sandboxSite: string;
  readonly isCrossOrigin: boolean;
  readonly isCrossSite: boolean;
}

export interface BuildSandboxCspHeaderOptions {
  readonly appOrigin: string;
  readonly allowedHttpsOrigins?: readonly string[] | undefined;
  readonly extraFrameAncestors?: readonly string[] | undefined;
  readonly sameSite?: boolean | undefined;
}

export interface ArtifactHtmlValidationCapabilities {
  readonly theme?: boolean | undefined;
  readonly sources?: boolean | undefined;
  readonly comment?: boolean | undefined;
  readonly network?: "none" | readonly string[] | undefined;
}

export interface ArtifactHtmlValidationResult {
  readonly valid: boolean;
  readonly byteSize: number;
  readonly title: string | null;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

const THREE_LABEL_PUBLIC_SUFFIXES = new Set([
  "nip.io",
  "sslip.io",
  "home.arpa",
  "co.uk",
  "org.uk",
  "ac.uk",
  "gov.uk",
  "com.cn",
  "net.cn",
  "org.cn",
  "co.jp",
  "ne.jp",
  "or.jp",
  "com.au",
  "com.tw",
  "com.hk",
  "com.sg",
  "co.kr",
]);

function stripTrailingDot(hostname: string): string {
  return hostname.endsWith(".") ? hostname.slice(0, -1) : hostname;
}

export function normalizeHostnameInput(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return "";

  if (trimmed.startsWith("[")) {
    const closingIdx = trimmed.indexOf("]");
    if (closingIdx > 1) {
      return stripTrailingDot(trimmed.slice(1, closingIdx));
    }
  }

  const colonCount = (trimmed.match(/:/g) ?? []).length;
  if (colonCount === 1) {
    const idx = trimmed.indexOf(":");
    const maybePort = trimmed.slice(idx + 1);
    if (/^\d+$/.test(maybePort)) {
      return stripTrailingDot(trimmed.slice(0, idx));
    }
  }

  return stripTrailingDot(trimmed);
}

function isIpv4Address(host: string): boolean {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return false;
  return host.split(".").every((part) => {
    const num = Number(part);
    return num >= 0 && num <= 255;
  });
}

function isIpv6Address(host: string): boolean {
  return host.includes(":");
}

/**
 * Extracts the registrable site key used for dual-origin isolation checks:
 * - IPv4 and IPv6 literals are treated as distinct standalone sites
 * - `localhost` and `*.localhost` collapse to `localhost`
 * - `nip.io`, `sslip.io`, and `home.arpa` keep the last 3 DNS labels
 * - Regular domains keep the last 2 DNS labels
 */
export function extractRegistrableSite(hostname: string): string {
  const normalized = normalizeHostnameInput(hostname);
  if (!normalized) return "";

  if (isIpv4Address(normalized) || isIpv6Address(normalized)) {
    return normalized;
  }

  if (normalized === "localhost" || normalized.endsWith(".localhost")) {
    return "localhost";
  }

  const labels = normalized.split(".").filter((label) => label.length > 0);
  if (labels.length <= 2) {
    return labels.join(".");
  }

  const lastTwo = labels.slice(-2).join(".");
  if (THREE_LABEL_PUBLIC_SUFFIXES.has(lastTwo)) {
    return labels.slice(-3).join(".");
  }

  return lastTwo;
}

/**
 * Checks whether a hostname is a zero-config local development sandbox subdomain (`<id>.sandbox.localhost`).
 */
export function isLocalDevSandboxHostname(hostname: string): boolean {
  const normalized = normalizeHostnameInput(hostname);
  if (!normalized) return false;
  if (!normalized.endsWith(".sandbox.localhost")) return false;
  const prefix = normalized.slice(0, -".sandbox.localhost".length);
  return prefix.length > 0 && !prefix.includes(".");
}

export function isLoopbackHostname(hostname: string): boolean {
  const normalized = normalizeHostnameInput(hostname);
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized.endsWith(".localhost")
  );
}

/**
 * Converts an artifact ID (e.g. `art_01JXYZ`) into an RFC-1123 lowercase DNS label (`art-01jxyz`).
 */
export function normalizeArtifactSubdomainLabel(artifactId: string): string {
  const cleaned = artifactId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (cleaned || "artifact").slice(0, 63);
}

function parseHttpOriginUrl(rawOrigin: string, fieldName: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawOrigin.trim());
  } catch {
    throw new InkadeError("VALIDATION_ERROR", `${fieldName} must be a valid http(s) URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new InkadeError("VALIDATION_ERROR", `${fieldName} must use http or https scheme`);
  }
  if (!parsed.hostname) {
    throw new InkadeError("VALIDATION_ERROR", `${fieldName} must include a hostname`);
  }
  return parsed;
}

function parseSandboxOriginPattern(rawPattern: string): {
  readonly canonicalPattern: string;
  readonly sampleUrl: URL;
  readonly hasWildcard: boolean;
} {
  const trimmed = rawPattern.trim();
  const hasWildcard = trimmed.includes("{id}") || trimmed.includes("*.");
  const materialized = trimmed
    .replace("{id}", "sample-artifact")
    .replace("://*.", "://sample-artifact.");
  const sampleUrl = parseHttpOriginUrl(materialized, "sandboxOrigin");
  return {
    canonicalPattern: trimmed.replace(/\/+$/, ""),
    sampleUrl,
    hasWildcard,
  };
}

/**
 * Validates dual-origin sandbox configuration.
 * Production deployments require two distinct registrable sites unless `sameSiteOptIn: true`
 * is explicitly enabled. Local development supports `*.sandbox.localhost` with zero config.
 */
export function validateDualOriginConfig(
  input: DualOriginConfigInput,
): ValidatedDualOriginConfig {
  const appUrl = parseHttpOriginUrl(input.appOrigin, "appOrigin");
  const appOrigin = appUrl.origin;
  const appHost = normalizeHostnameInput(appUrl.hostname);
  const appSite = extractRegistrableSite(appHost);
  const sameSiteOptIn = input.sameSiteOptIn === true;

  if (!input.sandboxOrigin || !input.sandboxOrigin.trim()) {
    if (sameSiteOptIn) {
      return {
        mode: "same_site",
        appOrigin,
        sandboxOriginPattern: appOrigin,
        appSite,
        sandboxSite: appSite,
        isCrossOrigin: false,
        isCrossSite: false,
      };
    }

    if (isLoopbackHostname(appHost)) {
      const portSuffix = appUrl.port ? `:${appUrl.port}` : "";
      const devPattern = `http://{id}.sandbox.localhost${portSuffix}`;
      return {
        mode: "dev_localhost",
        appOrigin,
        sandboxOriginPattern: devPattern,
        appSite,
        sandboxSite: "localhost",
        isCrossOrigin: true,
        isCrossSite: appSite !== "localhost",
      };
    }

    throw new InkadeError(
      "VALIDATION_ERROR",
      "Dual-origin sandbox isolation requires INKADE_SANDBOX_ORIGIN with a separate registrable domain in production (or explicitly set INKADE_SANDBOX_SAME_SITE=true).",
    );
  }

  const parsedSandbox = parseSandboxOriginPattern(input.sandboxOrigin);
  const sandboxHost = normalizeHostnameInput(parsedSandbox.sampleUrl.hostname);
  const sandboxSite = extractRegistrableSite(sandboxHost);
  const isSameOrigin = parsedSandbox.sampleUrl.origin === appOrigin && !parsedSandbox.hasWildcard;
  const isDevSandbox = isLocalDevSandboxHostname(sandboxHost) && isLoopbackHostname(appHost);

  if (isDevSandbox && !isSameOrigin && appHost !== sandboxHost) {
    return {
      mode: "dev_localhost",
      appOrigin,
      sandboxOriginPattern: parsedSandbox.canonicalPattern,
      appSite,
      sandboxSite,
      isCrossOrigin: true,
      isCrossSite: appSite !== sandboxSite,
    };
  }

  if (appSite === sandboxSite) {
    if (!sameSiteOptIn) {
      throw new InkadeError(
        "VALIDATION_ERROR",
        `Sandbox origin site "${sandboxSite}" matches app origin site "${appSite}". Configure a distinct registrable domain for dual-origin isolation or explicitly opt in with sameSiteOptIn=true.`,
      );
    }
    return {
      mode: "same_site",
      appOrigin,
      sandboxOriginPattern: parsedSandbox.canonicalPattern,
      appSite,
      sandboxSite,
      isCrossOrigin: !isSameOrigin,
      isCrossSite: false,
    };
  }

  return {
    mode: "dual_origin",
    appOrigin,
    sandboxOriginPattern: parsedSandbox.canonicalPattern,
    appSite,
    sandboxSite,
    isCrossOrigin: true,
    isCrossSite: true,
  };
}

/**
 * Resolves the concrete sandbox origin URL for a specific artifact ID.
 */
export function buildSandboxArtifactOrigin(
  artifactId: string,
  config: DualOriginConfigInput,
): {
  readonly origin: string;
  readonly mode: SandboxIsolationMode;
} {
  const validated = validateDualOriginConfig(config);
  if (validated.mode === "same_site" && (!config.sandboxOrigin || !config.sandboxOrigin.trim())) {
    return { origin: validated.appOrigin, mode: "same_site" };
  }

  const label = normalizeArtifactSubdomainLabel(artifactId);
  const pattern = validated.sandboxOriginPattern;
  if (pattern.includes("{id}")) {
    const origin = new URL(pattern.replace("{id}", label)).origin;
    return { origin, mode: validated.mode };
  }
  if (pattern.includes("://*.")) {
    const origin = new URL(pattern.replace("://*.", `://${label}.`)).origin;
    return { origin, mode: validated.mode };
  }
  return { origin: new URL(pattern).origin, mode: validated.mode };
}

/**
 * Checks whether an incoming request hostname belongs to the sandbox host namespace.
 */
export function matchesSandboxHostname(
  requestHostname: string,
  configuredSandboxOrigin?: string,
  appOriginHostname?: string,
): boolean {
  const host = normalizeHostnameInput(requestHostname);
  if (!host) return false;

  if (appOriginHostname && host === normalizeHostnameInput(appOriginHostname)) {
    return false;
  }

  const rawPattern = configuredSandboxOrigin?.trim();
  const allowDevLocalhost =
    !rawPattern ||
    !appOriginHostname ||
    isLoopbackHostname(appOriginHostname);
  if (allowDevLocalhost && isLocalDevSandboxHostname(host)) {
    return true;
  }

  if (!rawPattern) {
    return false;
  }

  const parsed = parseSandboxOriginPattern(rawPattern);
  const sampleHost = normalizeHostnameInput(parsed.sampleUrl.hostname);
  if (!parsed.hasWildcard) {
    return host === sampleHost;
  }

  const suffix = sampleHost.slice("sample-artifact".length);
  return host.endsWith(suffix) && host.length > suffix.length;
}

function sanitizeAllowedHttpsOrigins(origins?: readonly string[]): readonly string[] {
  if (!origins || origins.length === 0) return [];
  const valid = new Set<string>();
  for (const raw of origins) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      continue;
    }
    if (parsed.protocol !== "https:") continue;
    if (parsed.username || parsed.password) continue;
    valid.add(parsed.origin);
  }
  return [...valid];
}

/**
 * Parses space/comma-separated CSP `frame-ancestors` entries into sanitized tokens
 * (`'self'`, explicit `http(s)` origins, `https://*.domain`, or `http(s)://loopback:*`).
 */
export function sanitizeExtraFrameAncestors(
  raw?: string | readonly string[] | null,
): readonly string[] {
  const parts = Array.isArray(raw)
    ? raw.flatMap((entry) => String(entry).split(/[\s,]+/))
    : typeof raw === "string"
      ? raw.split(/[\s,]+/)
      : [];
  const valid = new Set<string>();
  for (const item of parts) {
    const token = item.trim();
    if (!token || token.includes(";") || token === "*" || token === "'none'") continue;
    if (token === "'self'") {
      valid.add(token);
      continue;
    }
    if (/^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):\*$/i.test(token)) {
      valid.add(token.toLowerCase());
      continue;
    }
    const wildcardHostMatch = /^(https?):\/\/\*\.([a-z0-9.-]+(?::\d+)?)$/i.exec(token);
    if (wildcardHostMatch) {
      const scheme = wildcardHostMatch[1]!.toLowerCase();
      const rest = wildcardHostMatch[2]!.toLowerCase();
      if (scheme === "https" || isLoopbackHostname(normalizeHostnameInput(rest))) {
        valid.add(`${scheme}://*.${rest}`);
      }
      continue;
    }
    try {
      const parsed = new URL(token);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
      if (parsed.username || parsed.password) continue;
      if (parsed.protocol === "https:" || isLoopbackHostname(normalizeHostnameInput(parsed.hostname))) {
        valid.add(parsed.origin);
      }
    } catch {
      // Ignore malformed ancestor tokens
    }
  }
  return [...valid];
}

/**
 * Builds the strict sandbox Content-Security-Policy header.
 */
export function buildSandboxCspHeader(options: BuildSandboxCspHeaderOptions): string {
  const parsedApp = parseHttpOriginUrl(options.appOrigin, "appOrigin");
  const allowedConnect = sanitizeAllowedHttpsOrigins(options.allowedHttpsOrigins);
  const connectSrc = allowedConnect.length > 0 ? allowedConnect.join(" ") : "'none'";
  const ancestorSet = new Set<string>([parsedApp.origin]);
  const appHostname = normalizeHostnameInput(parsedApp.hostname);

  if (!options.sameSite && isLoopbackHostname(appHostname) && !isLocalDevSandboxHostname(appHostname)) {
    const portSuffix = parsedApp.port ? `:${parsedApp.port}` : "";
    ancestorSet.add(`${parsedApp.protocol}//localhost${portSuffix}`);
    ancestorSet.add(`${parsedApp.protocol}//127.0.0.1${portSuffix}`);
    ancestorSet.add(`${parsedApp.protocol}//[::1]${portSuffix}`);
  }

  for (const extra of sanitizeExtraFrameAncestors(options.extraFrameAncestors)) {
    ancestorSet.add(extra);
  }

  const frameAncestors = [...ancestorSet].join(" ");

  return [
    "default-src 'none'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${connectSrc}`,
    "form-action 'none'",
    "base-uri 'none'",
    `frame-ancestors ${frameAncestors}`,
  ].join("; ");
}

function extractHtmlTitle(html: string): string | null {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!match) return null;
  const cleaned = (match[1] ?? "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
  return cleaned.length > 0 ? cleaned : null;
}

function stripJsCommentsPreservingStrings(code: string): string {
  return code.replace(
    /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
    (match) => {
      if (match.startsWith("/*") || match.startsWith("//")) {
        return " ";
      }
      return match;
    },
  );
}

/**
 * Statically validates single-file artifact HTML against size limits, CSP restrictions
 * (no external script src, no forms/formaction, no `<base>`, `<title>` required),
 * and consistency with declared `capabilities`.
 */
export function validateArtifactHtml(
  html: string,
  capabilities: ArtifactHtmlValidationCapabilities = {},
): ArtifactHtmlValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (typeof html !== "string" || html.trim().length === 0) {
    return {
      valid: false,
      byteSize: 0,
      title: null,
      errors: ["Artifact htmlSource must be a non-empty HTML string."],
      warnings: [],
    };
  }

  const byteSize = new TextEncoder().encode(html).byteLength;
  if (byteSize > ARTIFACT_HTML_MAX_BYTES) {
    errors.push(
      `Artifact HTML size (${byteSize} bytes) exceeds the ${ARTIFACT_HTML_MAX_BYTES} byte (512 KiB) limit.`,
    );
  }

  const title = extractHtmlTitle(html);
  if (!title) {
    errors.push("Artifact HTML must contain a non-empty <title> element.");
  }

  if (/<script\b[^>]*\bsrc\s*=/i.test(html)) {
    errors.push("External <script src=...> tags are forbidden inside sandboxed artifacts; inline all scripts.");
  }

  if (/<form\b/i.test(html) || /\bformaction\s*=/i.test(html)) {
    errors.push("<form> elements and formaction attributes are forbidden inside sandboxed artifacts.");
  }

  if (/<base\b/i.test(html)) {
    errors.push("<base> elements are forbidden inside sandboxed artifacts.");
  }

  if (/<meta\b[^>]*http-equiv\s*=\s*["']?(?:content-security-policy|refresh)\b/i.test(html)) {
    errors.push("Meta Content-Security-Policy and refresh directives are forbidden inside sandboxed artifacts.");
  }

  // Validate declared network capability entries.
  const declaredNetwork = capabilities.network;
  const allowedNetworkOrigins = new Set<string>();
  if (Array.isArray(declaredNetwork)) {
    const networkEntries: readonly string[] = declaredNetwork.filter(
      (item): item is string => typeof item === "string",
    );
    for (const entry of networkEntries) {
      let parsed: URL;
      try {
        parsed = new URL(entry);
      } catch {
        errors.push(`Declared capabilities.network origin "${entry}" is not a valid URL.`);
        continue;
      }
      if (parsed.protocol !== "https:") {
        errors.push(`Declared capabilities.network origin "${entry}" must use https://.`);
        continue;
      }
      allowedNetworkOrigins.add(parsed.origin);
    }
  }

  // Check consistency between `window.inkade.use(...)` calls and `capabilities`.
  const scriptBlocks: string[] = [];
  const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let scriptMatch: RegExpExecArray | null;
  while ((scriptMatch = scriptRegex.exec(html)) !== null) {
    if (scriptMatch[1]) {
      scriptBlocks.push(stripJsCommentsPreservingStrings(scriptMatch[1]));
    }
  }
  const combinedScripts = scriptBlocks.join("\n");

  const capCalls = new Set<string>();
  const useRegex = /\binkade\s*(?:\?\.)?\.\s*use\s*\(\s*["']([a-zA-Z0-9_-]+)["']\s*\)/g;
  let useMatch: RegExpExecArray | null;
  while ((useMatch = useRegex.exec(combinedScripts)) !== null) {
    if (useMatch[1]) {
      capCalls.add(useMatch[1]);
    }
  }

  for (const cap of capCalls) {
    if (cap === "theme" && capabilities.theme !== true) {
      errors.push('Artifact calls inkade.use("theme") without declaring capabilities.theme: true.');
    } else if (cap === "sources" && capabilities.sources !== true) {
      errors.push('Artifact calls inkade.use("sources") without declaring capabilities.sources: true.');
    } else if (cap === "comment" && capabilities.comment !== true) {
      errors.push('Artifact calls inkade.use("comment") without declaring capabilities.comment: true.');
    } else if (cap !== "theme" && cap !== "sources" && cap !== "comment") {
      errors.push(`Artifact requests unknown window.inkade capability "${cap}".`);
    }
  }

  // Check obvious outbound network API calls against declared capabilities.network.
  const networkCallRegex =
    /(?:\bfetch\s*\(|\bnew\s+(?:WebSocket|EventSource)\s*\(|\bXMLHttpRequest\b[\s\S]{0,120}\.open\s*\([^,]+,)\s*["'](https?:\/\/[^"']+|wss?:\/\/[^"']+)["']/gi;
  let netMatch: RegExpExecArray | null;
  while ((netMatch = networkCallRegex.exec(combinedScripts)) !== null) {
    const rawTarget = netMatch[1];
    if (!rawTarget) continue;
    let parsedTarget: URL;
    try {
      parsedTarget = new URL(rawTarget);
    } catch {
      continue;
    }
    if (parsedTarget.protocol !== "https:") {
      errors.push(`Non-HTTPS outbound request to "${parsedTarget.origin}" is forbidden in sandboxed artifacts.`);
      continue;
    }
    if (!Array.isArray(declaredNetwork) || !allowedNetworkOrigins.has(parsedTarget.origin)) {
      errors.push(
        `Artifact calls network endpoint "${parsedTarget.origin}" without declaring it in capabilities.network.`,
      );
    }
  }

  if (capabilities.sources === true && !capCalls.has("sources")) {
    warnings.push('capabilities.sources is true, but script does not reference inkade.use("sources").');
  }

  return {
    valid: errors.length === 0,
    byteSize,
    title,
    errors,
    warnings,
  };
}
