import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  harnessWakeProfileSchema,
  normalizeHostKind,
  SHIPPED_HARNESS_WAKE_PROFILES,
  type HarnessWakeProfile,
} from "@inkade/core";

export function getDefaultHarnessesConfigDir(homeDir: string = homedir()): string {
  return join(homeDir, ".config", "inkade", "harnesses");
}

export interface LoadHarnessProfileOptions {
  readonly configDir?: string | undefined;
}

function assertSecureLocalProfilePermissions(filePath: string): void {
  if (process.platform === "win32") return;
  const st = statSync(filePath);
  if ((st.mode & 0o077) !== 0) {
    throw new Error(
      `Refusing to load harness profile "${filePath}" with insecure permissions (expected 0600)`,
    );
  }
}

function assertNoRemoteProfileOverride(raw: Record<string, unknown>, filePath: string): void {
  if (
    raw.source === "shipped" ||
    "remote" in raw ||
    "remoteUrl" in raw ||
    "serverOverride" in raw ||
    "skillsDir" in raw ||
    "mcp" in raw
  ) {
    throw new Error(
      `Refusing harness profile "${filePath}": disallowed override keys detected`,
    );
  }
}

/**
 * Detects whether the current process is executing inside an active ADE agent session
 * by inspecting environment variable markers from shipped and custom harness profiles.
 */
export function detectActiveAgentMarkers(
  env: Readonly<Record<string, string | undefined>> = process.env,
  extraMarkers: readonly string[] = [],
): readonly string[] {
  const allMarkers = new Set<string>(extraMarkers);
  for (const profile of SHIPPED_HARNESS_WAKE_PROFILES) {
    for (const marker of profile.markers) {
      allMarkers.add(marker);
    }
  }
  const active: string[] = [];
  for (const marker of allMarkers) {
    const val = env[marker];
    if (typeof val === "string" && val.trim().length > 0) {
      active.push(marker);
    }
  }
  return active;
}

/**
 * Refuses modifying local harness profile files from inside an active ADE agent session.
 */
export function assertSafeProfileMutation(
  profile?: Pick<HarnessWakeProfile, "markers">,
  env: Readonly<Record<string, string | undefined>> = process.env,
): void {
  const activeMarkers = detectActiveAgentMarkers(env, profile?.markers ?? []);
  if (activeMarkers.length > 0) {
    throw new Error(
      `Refusing to modify harness configuration inside an active agent session (detected markers: ${activeMarkers.join(", ")})`,
    );
  }
}

export function loadAllHarnessProfiles(
  options?: LoadHarnessProfileOptions,
): readonly HarnessWakeProfile[] {
  const byName = new Map<string, HarnessWakeProfile>();
  for (const shipped of SHIPPED_HARNESS_WAKE_PROFILES) {
    byName.set(shipped.name, shipped);
  }

  const configDir = options?.configDir ?? getDefaultHarnessesConfigDir();
  if (!existsSync(configDir)) {
    return [...byName.values()];
  }

  const entries = readdirSync(configDir).filter((name) => name.endsWith(".json")).sort();
  for (const entry of entries) {
    const fullPath = join(configDir, entry);
    assertSecureLocalProfilePermissions(fullPath);
    const parsedJson = JSON.parse(readFileSync(fullPath, "utf8")) as Record<string, unknown>;
    assertNoRemoteProfileOverride(parsedJson, fullPath);
    const parsed = harnessWakeProfileSchema.parse({
      ...parsedJson,
      source: "user",
    });
    byName.set(parsed.name, parsed);
  }

  return [...byName.values()];
}

export function resolveHarnessProfile(
  harnessName: string,
  options?: LoadHarnessProfileOptions,
): HarnessWakeProfile {
  const normalized = normalizeHostKind(harnessName);
  const profiles = loadAllHarnessProfiles(options);
  const found = profiles.find((p) => p.name === normalized);
  if (!found) {
    throw new Error(
      `Unknown harness "${harnessName}". Known harnesses: ${profiles.map((p) => p.name).join(", ")}`,
    );
  }
  return found;
}

export function saveUserHarnessProfile(
  profile: Omit<HarnessWakeProfile, "source">,
  options?: {
    readonly configDir?: string | undefined;
    readonly env?: Readonly<Record<string, string | undefined>> | undefined;
  },
): string {
  const validated = harnessWakeProfileSchema.parse({
    ...profile,
    source: "user",
  });
  assertSafeProfileMutation(validated, options?.env ?? process.env);

  const configDir = resolve(options?.configDir ?? getDefaultHarnessesConfigDir());
  mkdirSync(configDir, { recursive: true, mode: 0o700 });
  const targetPath = join(configDir, `${validated.name}.json`);
  writeFileSync(targetPath, JSON.stringify(validated, null, 2) + "\n", {
    encoding: "utf8",
    mode: 0o600,
  });
  if (process.platform !== "win32") {
    chmodSync(targetPath, 0o600);
  }
  return targetPath;
}

export function resolveSessionIdFromContext(
  profile: Pick<HarnessWakeProfile, "sessionEnv">,
  options?: {
    readonly explicitSessionId?: string | undefined;
    readonly stdinPayload?: Readonly<Record<string, unknown>> | undefined;
    readonly env?: Readonly<Record<string, string | undefined>> | undefined;
  },
): string | undefined {
  if (options?.explicitSessionId?.trim()) {
    return options.explicitSessionId.trim();
  }
  const payload = options?.stdinPayload;
  if (payload) {
    for (const key of [
      "session_id",
      "sessionId",
      "thread_id",
      "threadId",
      "conversation_id",
      "conversationId",
    ]) {
      const value = payload[key];
      if (typeof value === "string" && value.trim().length > 0) {
        return value.trim();
      }
    }
  }
  const env = options?.env ?? process.env;
  if (profile.sessionEnv) {
    const envVal = env[profile.sessionEnv];
    if (typeof envVal === "string" && envVal.trim().length > 0) {
      return envVal.trim();
    }
  }
  return undefined;
}

export function resolveInkadeConnectionOptions(options?: {
  readonly url?: string | undefined;
  readonly token?: string | undefined;
  readonly env?: Readonly<Record<string, string | undefined>> | undefined;
}): { readonly baseUrl: string; readonly token?: string | undefined } {
  const env = options?.env ?? process.env;
  const rawUrl =
    options?.url?.trim() ||
    env.INKADE_URL?.trim() ||
    env.INKADE_BASE_URL?.trim() ||
    "http://127.0.0.1:4311";
  const token = options?.token?.trim() || env.INKADE_TOKEN?.trim() || undefined;
  return {
    baseUrl: rawUrl.replace(/\/+$/, ""),
    ...(token ? { token } : {}),
  };
}
