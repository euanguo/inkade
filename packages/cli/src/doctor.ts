import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import {
  harnessWakeProfileSchema,
  normalizeHostKind,
  SHIPPED_HARNESS_WAKE_PROFILES,
  type HarnessWakeProfile,
} from "@inkade/core";
import {
  defaultIsPidAlive,
  resolveEnvFileCredentials,
  type IsPidAliveFn,
} from "./nudge.ts";
import {
  getDefaultHarnessesConfigDir,
  resolveInkadeConnectionOptions,
} from "./profiles.ts";

export type DoctorCheckStatus = "pass" | "warn" | "fail";
export type DoctorCheckId =
  | "server_connectivity"
  | "token_scope"
  | "harness_profile"
  | "nudge_runtime"
  | "sandbox_posture";

export type SandboxPosture = "localhost_isolated" | "dual_origin" | "unknown";

export interface DoctorCheckResult {
  readonly id: DoctorCheckId;
  readonly status: DoctorCheckStatus;
  readonly summary: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export interface DoctorReport {
  readonly ok: boolean;
  readonly readOnly: true;
  readonly checkedAt: string;
  readonly baseUrl: string;
  readonly targetHarness: string | null;
  readonly sandboxPosture: SandboxPosture;
  readonly checks: readonly DoctorCheckResult[];
  readonly summary: {
    readonly pass: number;
    readonly warn: number;
    readonly fail: number;
  };
}

export type DoctorFetchFn = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface RunDoctorOptions {
  readonly harness?: string | undefined;
  readonly url?: string | undefined;
  readonly token?: string | undefined;
  readonly configDir?: string | undefined;
  readonly homeDir?: string | undefined;
  readonly env?: Readonly<Record<string, string | undefined>> | undefined;
  readonly fetchImpl?: DoctorFetchFn | undefined;
  readonly isPidAlive?: IsPidAliveFn | undefined;
  readonly timeoutMs?: number | undefined;
  readonly platform?: string | undefined;
  readonly darwinScutilOutput?: string | undefined;
}

/**
 * Masks a raw API token so full secrets are never emitted in doctor output.
 */
export function maskTokenSecret(rawToken: string): string {
  const trimmed = rawToken.trim();
  if (!trimmed) return "";
  if (trimmed.length <= 8) {
    return `${trimmed.slice(0, 2)}***`;
  }
  const prefixLen = Math.min(10, Math.max(4, trimmed.length - 6));
  return `${trimmed.slice(0, prefixLen)}...(${trimmed.length} chars)`;
}

function isLoopbackHost(hostname: string): boolean {
  const clean = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return (
    clean === "localhost" ||
    clean === "127.0.0.1" ||
    clean === "::1" ||
    clean.endsWith(".localhost")
  );
}

function tryParseOrigin(raw: string | undefined): { readonly origin: string; readonly hostname: string } | null {
  if (!raw?.trim()) return null;
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return { origin: u.origin, hostname: u.hostname };
  } catch {
    return null;
  }
}

export interface LoopbackProxyCheckResult {
  readonly proxyEnabled: boolean;
  readonly missingLocalhostWildcardBypass: boolean;
  readonly proxySummary: string | null;
  readonly bypassEntries: readonly string[];
}

function hasLocalhostWildcardBypass(entries: readonly string[]): boolean {
  return entries.some((entry) => {
    const clean = entry.trim().toLowerCase();
    return (
      clean === "*.localhost" ||
      clean === ".localhost" ||
      clean === "*.sandbox.localhost" ||
      clean === "*"
    );
  });
}

/**
 * Inspects shell proxy environment variables and macOS `scutil --proxy` settings
 * to detect proxies that may intercept `*.sandbox.localhost` sandbox iframes.
 */
export function inspectLoopbackProxyBypass(options?: {
  readonly env?: Readonly<Record<string, string | undefined>> | undefined;
  readonly platform?: string | undefined;
  readonly darwinScutilOutput?: string | undefined;
}): LoopbackProxyCheckResult {
  const env = options?.env ?? process.env;
  const platform = options?.platform ?? process.platform;
  const envProxy =
    env.HTTPS_PROXY?.trim() ||
    env.https_proxy?.trim() ||
    env.HTTP_PROXY?.trim() ||
    env.http_proxy?.trim() ||
    env.ALL_PROXY?.trim() ||
    env.all_proxy?.trim() ||
    null;
  const envBypassEntries = (env.NO_PROXY ?? env.no_proxy ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (envProxy) {
    return {
      proxyEnabled: true,
      missingLocalhostWildcardBypass: !hasLocalhostWildcardBypass(envBypassEntries),
      proxySummary: `env:${envProxy}`,
      bypassEntries: envBypassEntries,
    };
  }

  let scutilText = options?.darwinScutilOutput;
  if (scutilText === undefined && platform === "darwin") {
    try {
      scutilText = execFileSync("scutil", ["--proxy"], {
        encoding: "utf8",
        timeout: 1500,
      });
    } catch {
      scutilText = "";
    }
  }

  if (scutilText && scutilText.trim().length > 0) {
    const httpEnabled = /\bHTTPEnable\s*:\s*1\b/.test(scutilText);
    const httpsEnabled = /\bHTTPSEnable\s*:\s*1\b/.test(scutilText);
    const socksEnabled = /\bSOCKSEnable\s*:\s*1\b/.test(scutilText);
    if (httpEnabled || httpsEnabled || socksEnabled) {
      const hostMatch = /\b(?:HTTPProxy|HTTPSProxy|SOCKSProxy)\s*:\s*([^\s\n]+)/.exec(scutilText);
      const portMatch = /\b(?:HTTPPort|HTTPSPort|SOCKSPort)\s*:\s*(\d+)/.exec(scutilText);
      const exceptionsMatch = /ExceptionsList\s*:\s*<array>\s*\{([\s\S]*?)\}/.exec(scutilText);
      const darwinBypass: string[] = [];
      if (exceptionsMatch?.[1]) {
        for (const line of exceptionsMatch[1].split("\n")) {
          const item = /^\s*\d+\s*:\s*(.+?)\s*$/.exec(line);
          if (item?.[1]) darwinBypass.push(item[1].trim());
        }
      }
      return {
        proxyEnabled: true,
        missingLocalhostWildcardBypass: !hasLocalhostWildcardBypass(darwinBypass),
        proxySummary: hostMatch?.[1]
          ? `darwin:${hostMatch[1]}${portMatch?.[1] ? `:${portMatch[1]}` : ""}`
          : "darwin:system-proxy",
        bypassEntries: darwinBypass,
      };
    }
  }

  return {
    proxyEnabled: false,
    missingLocalhostWildcardBypass: false,
    proxySummary: null,
    bypassEntries: envBypassEntries,
  };
}

export function evaluateSandboxPosture(options: {
  readonly baseUrl: string;
  readonly env?: Readonly<Record<string, string | undefined>> | undefined;
  readonly proxyCheck?: LoopbackProxyCheckResult | undefined;
}): {
  readonly posture: SandboxPosture;
  readonly status: DoctorCheckStatus;
  readonly summary: string;
  readonly details: Readonly<Record<string, unknown>>;
} {
  const env = options.env ?? process.env;
  const appOriginInfo = tryParseOrigin(env.INKADE_APP_ORIGIN) ?? tryParseOrigin(options.baseUrl);
  const sandboxOriginInfo = tryParseOrigin(env.INKADE_SANDBOX_ORIGIN);
  const sameSiteEnabled = env.INKADE_SANDBOX_SAME_SITE === "true";

  if (
    appOriginInfo &&
    sandboxOriginInfo &&
    sandboxOriginInfo.origin !== appOriginInfo.origin &&
    !sameSiteEnabled
  ) {
    return {
      posture: "dual_origin",
      status: "pass",
      summary: `Dual-origin sandbox active (${appOriginInfo.origin} vs ${sandboxOriginInfo.origin})`,
      details: {
        posture: "dual_origin",
        appOrigin: appOriginInfo.origin,
        sandboxOrigin: sandboxOriginInfo.origin,
        sameSiteFallback: false,
      },
    };
  }

  if (appOriginInfo && isLoopbackHost(appOriginInfo.hostname) && !sameSiteEnabled) {
    const proxyIssue = options.proxyCheck?.missingLocalhostWildcardBypass === true;
    return {
      posture: "localhost_isolated",
      status: proxyIssue ? "warn" : "pass",
      summary: proxyIssue
        ? `Loopback host (${appOriginInfo.hostname}) supports *.sandbox.localhost, but active proxy (${options.proxyCheck?.proxySummary ?? "system"}) omits *.localhost from bypass list`
        : `Loopback host (${appOriginInfo.hostname}) supports isolated localhost subdomain origins`,
      details: {
        posture: "localhost_isolated",
        appOrigin: appOriginInfo.origin,
        sandboxOrigin: sandboxOriginInfo?.origin ?? null,
        sameSiteFallback: false,
        proxyBypassWarning: proxyIssue,
        proxySummary: options.proxyCheck?.proxySummary ?? null,
        proxyBypassEntries: options.proxyCheck?.bypassEntries ?? [],
      },
    };
  }

  return {
    posture: "unknown",
    status: "warn",
    summary: sameSiteEnabled
      ? "Same-site sandbox fallback enabled; configure distinct INKADE_SANDBOX_ORIGIN for full origin isolation"
      : "Non-loopback origin without INKADE_SANDBOX_ORIGIN; sandbox isolation posture is unknown",
    details: {
      posture: "unknown",
      appOrigin: appOriginInfo?.origin ?? options.baseUrl,
      sandboxOrigin: sandboxOriginInfo?.origin ?? null,
      sameSiteFallback: sameSiteEnabled,
    },
  };
}

function isRegularFile(filePath: string): boolean {
  try {
    return existsSync(filePath) && statSync(filePath).isFile();
  } catch {
    return false;
  }
}

export function probeExecutableCandidate(
  candidate: string,
  env: Readonly<Record<string, string | undefined>>,
): { readonly found: boolean; readonly resolvedPath: string | null } {
  const trimmed = candidate.trim();
  if (!trimmed) return { found: false, resolvedPath: null };

  if (trimmed.includes("/") || trimmed.includes("\\")) {
    return {
      found: isRegularFile(trimmed),
      resolvedPath: isRegularFile(trimmed) ? trimmed : null,
    };
  }

  const pathEnv = env.PATH ?? "";
  const dirs = pathEnv.split(delimiter).filter((d) => d.trim().length > 0);
  const pathExts =
    process.platform === "win32"
      ? (env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").filter(Boolean)
      : [""];

  for (const dir of dirs) {
    for (const ext of pathExts) {
      const full = join(dir, trimmed.endsWith(ext) ? trimmed : `${trimmed}${ext}`);
      if (isRegularFile(full)) {
        return { found: true, resolvedPath: full };
      }
    }
  }
  return { found: false, resolvedPath: null };
}

function scanUserHarnessProfilesReadOnly(configDir: string): {
  readonly userProfiles: readonly HarnessWakeProfile[];
  readonly invalidFiles: readonly { readonly file: string; readonly error: string }[];
  readonly configDirExists: boolean;
} {
  if (!existsSync(configDir)) {
    return { userProfiles: [], invalidFiles: [], configDirExists: false };
  }

  const userProfiles: HarnessWakeProfile[] = [];
  const invalidFiles: { file: string; error: string }[] = [];
  const entries = readdirSync(configDir).filter((name) => name.endsWith(".json")).sort();

  for (const entry of entries) {
    const fullPath = join(configDir, entry);
    try {
      if (process.platform !== "win32") {
        const st = statSync(fullPath);
        if ((st.mode & 0o077) !== 0) {
          invalidFiles.push({
            file: fullPath,
            error: "Insecure permissions (expected 0600)",
          });
          continue;
        }
      }
      const raw = JSON.parse(readFileSync(fullPath, "utf8")) as Record<string, unknown>;
      if (
        raw.source === "shipped" ||
        "remote" in raw ||
        "remoteUrl" in raw ||
        "serverOverride" in raw ||
        "skillsDir" in raw ||
        "mcp" in raw
      ) {
        invalidFiles.push({
          file: fullPath,
          error: "Disallowed override keys detected",
        });
        continue;
      }
      const parsed = harnessWakeProfileSchema.parse({
        ...raw,
        source: "user",
      });
      userProfiles.push(parsed);
    } catch (err) {
      invalidFiles.push({
        file: fullPath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { userProfiles, invalidFiles, configDirExists: true };
}

async function fetchJsonSafely(
  fetchImpl: DoctorFetchFn,
  url: string,
  options: {
    readonly token?: string | undefined;
    readonly timeoutMs: number;
  },
): Promise<{
  readonly ok: boolean;
  readonly status: number;
  readonly data?: Record<string, unknown> | undefined;
  readonly error?: string | undefined;
}> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  timer.unref?.();

  try {
    const headers: Record<string, string> = { accept: "application/json" };
    if (options.token) {
      headers.authorization = `Bearer ${options.token}`;
    }
    const res = await fetchImpl(url, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    const text = await res.text();
    let parsed: Record<string, unknown> | undefined;
    try {
      const jsonVal = JSON.parse(text) as unknown;
      if (typeof jsonVal === "object" && jsonVal !== null && !Array.isArray(jsonVal)) {
        parsed = jsonVal as Record<string, unknown>;
      }
    } catch {
      parsed = undefined;
    }
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        data: parsed,
        error: `HTTP ${res.status}`,
      };
    }
    return {
      ok: true,
      status: res.status,
      data: parsed,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Executes a strictly read-only environment & connectivity inspection for Inkade and ADE bridges.
 * Never mutates user config files, harness profiles, or third-party ADE files.
 */
export async function runDoctor(options: RunDoctorOptions = {}): Promise<DoctorReport> {
  const env = options.env ?? process.env;
  const conn = resolveInkadeConnectionOptions({
    url: options.url,
    token: options.token,
    env,
  });
  const fetchImpl: DoctorFetchFn =
    options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  const timeoutMs = options.timeoutMs ?? 5_000;
  const homeDir = options.homeDir ?? homedir();
  const configDir = options.configDir ?? getDefaultHarnessesConfigDir(homeDir);
  const isPidAlive = options.isPidAlive ?? defaultIsPidAlive;

  const rawHarness = options.harness?.trim();
  const targetHarness =
    rawHarness && rawHarness.toLowerCase() !== "any" ? normalizeHostKind(rawHarness) : null;

  // 1. server_connectivity
  const [healthRes, bootstrapRes, connectStatusRes] = await Promise.all([
    fetchJsonSafely(fetchImpl, `${conn.baseUrl}/api/v1/health`, { timeoutMs }),
    fetchJsonSafely(fetchImpl, `${conn.baseUrl}/api/v1/bootstrap`, { timeoutMs }),
    fetchJsonSafely(fetchImpl, `${conn.baseUrl}/api/v1/connect/status`, {
      token: conn.token,
      timeoutMs,
    }),
  ]);

  const serverReachable = healthRes.ok && bootstrapRes.ok && healthRes.data?.ok === true;
  const serverVersion =
    typeof connectStatusRes.data?.serverVersion === "string"
      ? connectStatusRes.data.serverVersion
      : null;
  const authMode =
    typeof bootstrapRes.data?.authMode === "string" ? bootstrapRes.data.authMode : null;
  const initialized =
    typeof bootstrapRes.data?.initialized === "boolean" ? bootstrapRes.data.initialized : null;
  const workspaceObj =
    typeof bootstrapRes.data?.workspace === "object" && bootstrapRes.data.workspace !== null
      ? (bootstrapRes.data.workspace as Record<string, unknown>)
      : null;

  const connectivityCheck: DoctorCheckResult = serverReachable
    ? {
        id: "server_connectivity",
        status: "pass",
        summary: `Reachable at ${conn.baseUrl}${serverVersion ? ` (v${serverVersion})` : ""}`,
        details: {
          baseUrl: conn.baseUrl,
          reachable: true,
          service: healthRes.data?.service ?? "inkade-server",
          dialect: healthRes.data?.dialect ?? null,
          serverVersion,
          initialized,
          authMode,
          workspaceId: workspaceObj?.id ?? null,
          workspaceName: workspaceObj?.name ?? null,
        },
      }
    : {
        id: "server_connectivity",
        status: "fail",
        summary: `Failed to reach Inkade server at ${conn.baseUrl}: ${healthRes.error ?? bootstrapRes.error ?? "unreachable"}`,
        details: {
          baseUrl: conn.baseUrl,
          reachable: false,
          healthStatus: healthRes.status,
          healthError: healthRes.error ?? null,
          bootstrapStatus: bootstrapRes.status,
          bootstrapError: bootstrapRes.error ?? null,
        },
      };

  // 2. token_scope
  const maskedTokenPrefix = conn.token ? maskTokenSecret(conn.token) : null;
  let tokenScopeCheck: DoctorCheckResult;

  if (!serverReachable) {
    tokenScopeCheck = {
      id: "token_scope",
      status: "warn",
      summary: conn.token
        ? `Skipped live token verification while server is unreachable (token ${maskedTokenPrefix})`
        : "No token configured and server is unreachable",
      details: {
        tokenConfigured: Boolean(conn.token),
        tokenPrefix: maskedTokenPrefix,
        verified: false,
      },
    };
  } else {
    const whoamiRes = await fetchJsonSafely(fetchImpl, `${conn.baseUrl}/api/v1/whoami`, {
      token: conn.token,
      timeoutMs,
    });

    if (whoamiRes.ok && whoamiRes.data) {
      const scopeObj =
        typeof whoamiRes.data.scope === "object" && whoamiRes.data.scope !== null
          ? (whoamiRes.data.scope as Record<string, unknown>)
          : {};
      const visibleSpaces = Array.isArray(whoamiRes.data.visibleSpaces)
        ? (whoamiRes.data.visibleSpaces as Record<string, unknown>[])
        : [];
      const permission =
        typeof scopeObj.permission === "string" ? scopeObj.permission : "unknown";
      const principalKind =
        typeof whoamiRes.data.principalKind === "string" ? whoamiRes.data.principalKind : "unknown";
      const tokenName =
        typeof whoamiRes.data.tokenName === "string" ? whoamiRes.data.tokenName : null;

      tokenScopeCheck = {
        id: "token_scope",
        status: "pass",
        summary: conn.token
          ? `Token ${maskedTokenPrefix} active (${tokenName ?? principalKind}, permission=${permission}, spaces=${visibleSpaces.length})`
          : `Authenticated via ${authMode ?? principalKind} session (permission=${permission}, spaces=${visibleSpaces.length})`,
        details: {
          tokenConfigured: Boolean(conn.token),
          tokenPrefix: maskedTokenPrefix,
          verified: true,
          principalKind,
          tokenName,
          permission,
          allowedSpaceIds: scopeObj.spaceIds ?? null,
          allowedKinds: scopeObj.allowedKinds ?? null,
          denyHardDelete: scopeObj.denyHardDelete ?? null,
          allowGovernanceMutation: scopeObj.allowGovernanceMutation === true,
          visibleSpaces: visibleSpaces.map((sp) => ({
            id: sp.id ?? null,
            slug: sp.slug ?? null,
            name: sp.name ?? null,
          })),
        },
      };
    } else if (conn.token) {
      tokenScopeCheck = {
        id: "token_scope",
        status: "fail",
        summary: `Configured token ${maskedTokenPrefix} rejected by /api/v1/whoami (${whoamiRes.error ?? `HTTP ${whoamiRes.status}`})`,
        details: {
          tokenConfigured: true,
          tokenPrefix: maskedTokenPrefix,
          verified: false,
          httpStatus: whoamiRes.status,
          error: whoamiRes.error ?? null,
        },
      };
    } else {
      tokenScopeCheck = {
        id: "token_scope",
        status: "warn",
        summary: "No INKADE_TOKEN configured and server requires authentication",
        details: {
          tokenConfigured: false,
          tokenPrefix: null,
          verified: false,
          httpStatus: whoamiRes.status,
        },
      };
    }
  }

  // 3. harness_profile (strictly read-only scan of shipped + ~/.config/inkade/harnesses)
  const scanned = scanUserHarnessProfilesReadOnly(configDir);
  const profilesByName = new Map<string, HarnessWakeProfile>();
  for (const shipped of SHIPPED_HARNESS_WAKE_PROFILES) {
    profilesByName.set(shipped.name, shipped);
  }
  for (const userProfile of scanned.userProfiles) {
    profilesByName.set(userProfile.name, userProfile);
  }

  const allProfiles = [...profilesByName.values()];
  const matchedProfile = targetHarness ? profilesByName.get(targetHarness) : undefined;
  const targetProfiles = targetHarness
    ? matchedProfile
      ? [matchedProfile]
      : []
    : allProfiles;

  let harnessCheck: DoctorCheckResult;
  if (targetHarness && !matchedProfile) {
    harnessCheck = {
      id: "harness_profile",
      status: "fail",
      summary: `Unknown harness profile "${targetHarness}"`,
      details: {
        configDir,
        configDirExists: scanned.configDirExists,
        requestedHarness: targetHarness,
        knownHarnesses: allProfiles.map((p) => p.name),
        invalidProfileFiles: scanned.invalidFiles,
      },
    };
  } else if (scanned.invalidFiles.length > 0) {
    harnessCheck = {
      id: "harness_profile",
      status: "fail",
      summary: `Found ${scanned.invalidFiles.length} invalid or insecure local harness profile file(s)`,
      details: {
        configDir,
        configDirExists: scanned.configDirExists,
        profilesCount: targetProfiles.length,
        invalidProfileFiles: scanned.invalidFiles,
        profiles: targetProfiles.map((p) => ({
          name: p.name,
          title: p.title,
          level: p.level,
          hookDialect: p.hookDialect ?? null,
          wakesIdle: p.wakesIdle,
          hasNudge: Boolean(p.nudge),
          source: p.source,
        })),
      },
    };
  } else {
    harnessCheck = {
      id: "harness_profile",
      status: "pass",
      summary: targetHarness
        ? `Resolved harness profile "${matchedProfile!.name}" (${matchedProfile!.level}, ${matchedProfile!.source})`
        : `Loaded ${allProfiles.length} harness profile(s) (${scanned.userProfiles.length} custom)`,
      details: {
        configDir,
        configDirExists: scanned.configDirExists,
        profilesCount: targetProfiles.length,
        invalidProfileFiles: [],
        profiles: targetProfiles.map((p) => ({
          name: p.name,
          title: p.title,
          level: p.level,
          hookDialect: p.hookDialect ?? null,
          wakesIdle: p.wakesIdle,
          hasNudge: Boolean(p.nudge),
          source: p.source,
        })),
      },
    };
  }

  // 4. nudge_runtime
  const nudgeProfiles = targetProfiles.filter((p) => p.nudge !== undefined);
  const nudgeProbes = nudgeProfiles.map((profile) => {
    const nudgeSpec = profile.nudge!;
    const candidates: string[] = [];
    if (profile.name === "codex") {
      const override = env.INKADE_CODEX_BIN?.trim() || env.OPEN_ARTIFACT_CODEX_BIN?.trim();
      if (override) candidates.push(override);
    }
    for (const c of nudgeSpec.command) {
      if (typeof c === "string") {
        candidates.push(c);
      } else if (c.length > 0 && c[0]) {
        candidates.push(c[0]);
      }
    }

    let resolvedExecutable: string | null = null;
    for (const cand of candidates) {
      const probe = probeExecutableCandidate(cand, env);
      if (probe.found) {
        resolvedExecutable = probe.resolvedPath;
        break;
      }
    }

    const envFileSpec = nudgeSpec.envFile;
    const envFileCreds = envFileSpec
      ? resolveEnvFileCredentials(envFileSpec, { homeDir, isPidAlive })
      : null;

    const binaryFound = resolvedExecutable !== null;
    const pidAlive = envFileSpec ? Boolean(envFileCreds) : null;
    const ready = binaryFound && (!envFileSpec || Boolean(envFileCreds));

    return {
      harness: profile.name,
      binaryFound,
      resolvedExecutable,
      candidatesChecked: candidates,
      requiresEnvFile: Boolean(envFileSpec),
      envFileDir: envFileSpec?.dir ?? null,
      envFileFound: envFileSpec ? Boolean(envFileCreds) : null,
      envFilePath: envFileCreds?.filePath ?? null,
      pid: envFileCreds?.pid ?? null,
      pidAlive,
      httpPort: envFileCreds?.httpPort ?? null,
      hasCsrfToken: envFileCreds ? Boolean(envFileCreds.csrfToken) : null,
      ready,
    };
  });

  let nudgeCheck: DoctorCheckResult;
  if (nudgeProbes.length === 0) {
    nudgeCheck = {
      id: "nudge_runtime",
      status: "pass",
      summary: targetHarness
        ? `Harness "${targetHarness}" uses hooks/MCP without external nudge runtime`
        : "No nudge-configured profiles in current scope",
      details: { runtimes: [] },
    };
  } else {
    const readyCount = nudgeProbes.filter((p) => p.ready).length;
    const allReady = readyCount === nudgeProbes.length;
    const targetMissing = targetHarness !== null && !allReady;
    nudgeCheck = {
      id: "nudge_runtime",
      status: allReady ? "pass" : targetMissing ? "warn" : "warn",
      summary: allReady
        ? `All ${nudgeProbes.length} nudge runtime(s) ready`
        : `${readyCount}/${nudgeProbes.length} nudge runtime(s) active/found locally`,
      details: {
        readyCount,
        totalCount: nudgeProbes.length,
        runtimes: nudgeProbes,
      },
    };
  }

  // 5. sandbox_posture
  const proxyCheck = inspectLoopbackProxyBypass({
    env,
    platform: options.platform,
    darwinScutilOutput: options.darwinScutilOutput,
  });
  const postureEval = evaluateSandboxPosture({ baseUrl: conn.baseUrl, env, proxyCheck });
  const sandboxCheck: DoctorCheckResult = {
    id: "sandbox_posture",
    status: postureEval.status,
    summary: postureEval.summary,
    details: postureEval.details,
  };

  const checks: readonly DoctorCheckResult[] = [
    connectivityCheck,
    tokenScopeCheck,
    harnessCheck,
    nudgeCheck,
    sandboxCheck,
  ];

  const pass = checks.filter((c) => c.status === "pass").length;
  const warn = checks.filter((c) => c.status === "warn").length;
  const fail = checks.filter((c) => c.status === "fail").length;

  return {
    ok: fail === 0,
    readOnly: true,
    checkedAt: new Date().toISOString(),
    baseUrl: conn.baseUrl,
    targetHarness,
    sandboxPosture: postureEval.posture,
    checks,
    summary: { pass, warn, fail },
  };
}

export function formatDoctorHumanReport(report: DoctorReport): string {
  const lines: string[] = [
    `Inkade Doctor (${report.readOnly ? "read-only" : ""}) — ${report.baseUrl}`,
    `Result: ${report.ok ? "OK" : "FAILED"} (pass=${report.summary.pass}, warn=${report.summary.warn}, fail=${report.summary.fail}) | Sandbox: ${report.sandboxPosture}`,
    "",
  ];
  for (const check of report.checks) {
    const tag = check.status.toUpperCase().padEnd(4, " ");
    lines.push(`[${tag}] ${check.id}: ${check.summary}`);
  }
  return `${lines.join("\n")}\n`;
}
