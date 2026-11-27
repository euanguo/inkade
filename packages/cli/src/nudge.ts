import { execFile as nodeExecFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { HarnessWakeProfile, NudgeCommandSpec, WakeEnvelope } from "@inkade/core";

export type ExecFileFn = (
  file: string,
  args: readonly string[],
  options: {
    readonly env?: NodeJS.ProcessEnv | undefined;
    readonly timeout?: number | undefined;
    readonly shell?: false | undefined;
  },
) => Promise<{ readonly stdout: string; readonly stderr: string }>;

export type IsPidAliveFn = (pid: number) => boolean;

export function defaultIsPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but belongs to another user; ESRCH means dead.
    const code = (err as { code?: string }).code;
    return code === "EPERM";
  }
}

export function defaultExecFileNoShell(
  file: string,
  args: readonly string[],
  options: {
    readonly env?: NodeJS.ProcessEnv | undefined;
    readonly timeout?: number | undefined;
    readonly shell?: false | undefined;
  },
): Promise<{ readonly stdout: string; readonly stderr: string }> {
  return new Promise((resolve, reject) => {
    nodeExecFile(
      file,
      [...args],
      {
        env: options.env,
        timeout: options.timeout,
        shell: false,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(error instanceof Error ? error : new Error(error.message));
          return;
        }
        resolve({ stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}

export function expandHomeDir(pathStr: string, homeDir: string = homedir()): string {
  if (pathStr === "~") return homeDir;
  if (pathStr.startsWith("~/") || pathStr.startsWith("~\\")) {
    return join(homeDir, pathStr.slice(2));
  }
  return pathStr;
}

function globPatternToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`);
}

export interface ResolvedEnvFileCredentials {
  readonly filePath: string;
  readonly pid: number;
  readonly httpPort?: number | undefined;
  readonly csrfToken?: string | undefined;
  readonly env: Readonly<Record<string, string>>;
}

export function resolveEnvFileCredentials(
  envFile: NonNullable<NudgeCommandSpec["envFile"]>,
  options?: {
    readonly homeDir?: string | undefined;
    readonly isPidAlive?: IsPidAliveFn | undefined;
  },
): ResolvedEnvFileCredentials | null {
  const dir = expandHomeDir(envFile.dir, options?.homeDir);
  if (!existsSync(dir)) return null;

  const matcher = globPatternToRegExp(envFile.pattern);
  const pidField = envFile.pidField ?? "pid";
  const isAlive = options?.isPidAlive ?? defaultIsPidAlive;

  const candidates = readdirSync(dir)
    .filter((name) => matcher.test(name))
    .map((name) => {
      const fullPath = join(dir, name);
      try {
        return { fullPath, mtimeMs: statSync(fullPath).mtimeMs };
      } catch {
        return null;
      }
    })
    .filter((entry): entry is { fullPath: string; mtimeMs: number } => entry !== null)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(readFileSync(candidate.fullPath, "utf8")) as Record<
        string,
        unknown
      >;
      const rawPid = parsed[pidField];
      const pid = typeof rawPid === "number" ? rawPid : Number(rawPid);
      if (!Number.isInteger(pid) || pid <= 0 || !isAlive(pid)) {
        continue;
      }

      const env: Record<string, string> = {};
      const httpPortRaw = parsed.httpPort ?? parsed.port;
      const httpPort =
        typeof httpPortRaw === "number" && Number.isFinite(httpPortRaw)
          ? httpPortRaw
          : typeof httpPortRaw === "string" && /^\d+$/.test(httpPortRaw)
            ? Number(httpPortRaw)
            : undefined;
      if (httpPort !== undefined) {
        const portStr = String(httpPort);
        env.INKADE_HUB_PORT = portStr;
        env.AGENTAPI_PORT = portStr;
        env.ANTIGRAVITY_HTTP_PORT = portStr;
      }

      const csrfToken =
        typeof parsed.csrfToken === "string" && parsed.csrfToken.trim().length > 0
          ? parsed.csrfToken.trim()
          : undefined;
      if (csrfToken) {
        env.INKADE_HUB_CSRF_TOKEN = csrfToken;
        env.AGENTAPI_CSRF_TOKEN = csrfToken;
        env.ANTIGRAVITY_CSRF_TOKEN = csrfToken;
      }

      return {
        filePath: candidate.fullPath,
        pid,
        httpPort,
        csrfToken,
        env,
      };
    } catch {
      continue;
    }
  }

  return null;
}

function resolveExecutableCandidate(
  profileName: string,
  candidates: readonly (string | readonly string[])[],
  env: Readonly<Record<string, string | undefined>>,
): { readonly bin: string; readonly prefixArgs: readonly string[] } {
  if (profileName === "codex") {
    const override = env.INKADE_CODEX_BIN?.trim() || env.OPEN_ARTIFACT_CODEX_BIN?.trim();
    if (override) {
      return { bin: override, prefixArgs: [] };
    }
  }

  for (const candidate of candidates) {
    if (typeof candidate !== "string") {
      const [bin, ...prefixArgs] = candidate;
      if (bin && (!bin.includes("/") || existsSync(bin))) {
        return { bin, prefixArgs };
      }
      continue;
    }
    if (!candidate.includes("/") || existsSync(candidate)) {
      return { bin: candidate, prefixArgs: [] };
    }
  }

  const first = candidates[0];
  if (first !== undefined && typeof first !== "string") {
    return { bin: first[0] ?? "", prefixArgs: first.slice(1) };
  }
  return { bin: typeof first === "string" ? first : "", prefixArgs: [] };
}

export interface NudgeResolution {
  readonly allowed: boolean;
  readonly skippedReason?: string | undefined;
  readonly bin?: string | undefined;
  readonly args?: readonly string[] | undefined;
  readonly env?: NodeJS.ProcessEnv | undefined;
}

export function resolveNudgeInvocation(options: {
  readonly profile: HarnessWakeProfile;
  readonly wake: Pick<WakeEnvelope, "id" | "senderKind" | "formattedPromptText">;
  readonly sessionId: string;
  readonly baseEnv?: NodeJS.ProcessEnv | undefined;
  readonly homeDir?: string | undefined;
  readonly isPidAlive?: IsPidAliveFn | undefined;
}): NudgeResolution {
  if (options.wake.senderKind !== "owner") {
    return {
      allowed: false,
      skippedReason: `non_owner_sender:${options.wake.senderKind}`,
    };
  }
  if (!options.profile.nudge) {
    return { allowed: false, skippedReason: "no_nudge_configured" };
  }
  const sessionId = options.sessionId.trim();
  if (!sessionId) {
    return { allowed: false, skippedReason: "missing_session_id" };
  }

  const baseEnv = options.baseEnv ?? process.env;
  const resolvedCmd = resolveExecutableCandidate(
    options.profile.name,
    options.profile.nudge.command,
    baseEnv,
  );
  if (!resolvedCmd.bin) {
    return { allowed: false, skippedReason: "missing_nudge_executable" };
  }

  const substitutedArgs = options.profile.nudge.args.map((arg) =>
    arg
      .replaceAll("${session}", sessionId)
      .replaceAll("${text}", options.wake.formattedPromptText),
  );
  const argv = [...resolvedCmd.prefixArgs, ...substitutedArgs];

  let mergedEnv: NodeJS.ProcessEnv = {
    ...baseEnv,
    ...(options.profile.nudge.env ?? {}),
  };

  if (options.profile.nudge.envFile) {
    const creds = resolveEnvFileCredentials(options.profile.nudge.envFile, {
      homeDir: options.homeDir,
      isPidAlive: options.isPidAlive,
    });
    if (!creds) {
      return {
        allowed: false,
        skippedReason: "missing_or_stale_env_file",
      };
    }
    mergedEnv = {
      ...mergedEnv,
      ...creds.env,
    };
  }

  return {
    allowed: true,
    bin: resolvedCmd.bin,
    args: argv,
    env: mergedEnv,
  };
}

export interface ExecuteNudgeResult {
  readonly executed: boolean;
  readonly skippedReason?: string | undefined;
  readonly bin?: string | undefined;
  readonly args?: readonly string[] | undefined;
  readonly stdout?: string | undefined;
  readonly stderr?: string | undefined;
}

export async function executeNudge(options: {
  readonly profile: HarnessWakeProfile;
  readonly wake: Pick<WakeEnvelope, "id" | "senderKind" | "formattedPromptText">;
  readonly sessionId: string;
  readonly timeoutMs?: number | undefined;
  readonly baseEnv?: NodeJS.ProcessEnv | undefined;
  readonly homeDir?: string | undefined;
  readonly isPidAlive?: IsPidAliveFn | undefined;
  readonly execFileImpl?: ExecFileFn | undefined;
}): Promise<ExecuteNudgeResult> {
  const resolution = resolveNudgeInvocation({
    profile: options.profile,
    wake: options.wake,
    sessionId: options.sessionId,
    baseEnv: options.baseEnv,
    homeDir: options.homeDir,
    isPidAlive: options.isPidAlive,
  });

  if (!resolution.allowed || !resolution.bin || !resolution.args) {
    return {
      executed: false,
      skippedReason: resolution.skippedReason,
    };
  }

  const execFileFn = options.execFileImpl ?? defaultExecFileNoShell;
  const output = await execFileFn(resolution.bin, resolution.args, {
    env: resolution.env,
    timeout: options.timeoutMs ?? 15_000,
    shell: false,
  });

  return {
    executed: true,
    bin: resolution.bin,
    args: resolution.args,
    stdout: output.stdout,
    stderr: output.stderr,
  };
}
