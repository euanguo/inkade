import {
  formatHookDialectResponse,
  normalizeHostKind,
  type BuiltinHookDialect,
  type HarnessWakeProfile,
  type HookDialectResponse,
  type WakeEnvelope,
} from "@inkade/core";
import { createInkadeClient, type InkadeClient } from "@inkade/sdk";
import { resolveSessionIdFromContext } from "./profiles.ts";

export function parseHookStdinJson(rawStdin: string): Record<string, unknown> {
  const trimmed = rawStdin.trim();
  if (!trimmed) return {};
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Ignore invalid JSON stdin so hooks never crash the ADE host
  }
  return {};
}

export interface ExecuteHookOptions {
  readonly eventName: string;
  readonly profile: HarnessWakeProfile;
  readonly stdinRaw: string;
  readonly client: Pick<InkadeClient, "threadBindings">;
  readonly explicitSessionId?: string | undefined;
  readonly explicitWorkspacePath?: string | undefined;
  readonly env?: Readonly<Record<string, string | undefined>> | undefined;
  readonly cwd?: string | undefined;
  readonly pid?: number | undefined;
}

export interface ExecuteHookResult {
  readonly wakes: readonly WakeEnvelope[];
  readonly output: HookDialectResponse;
  readonly sessionId?: string | undefined;
  readonly workspacePath?: string | undefined;
}

export async function executeHook(options: ExecuteHookOptions): Promise<ExecuteHookResult> {
  const stdinPayload = parseHookStdinJson(options.stdinRaw);
  const sessionId = resolveSessionIdFromContext(options.profile, {
    explicitSessionId: options.explicitSessionId,
    stdinPayload,
    env: options.env,
  });

  const stdinCwd =
    typeof stdinPayload.cwd === "string" && stdinPayload.cwd.trim().length > 0
      ? stdinPayload.cwd.trim()
      : undefined;
  const workspacePath = options.explicitWorkspacePath?.trim() || stdinCwd || options.cwd;
  const adeKind = normalizeHostKind(options.profile.name);

  if (sessionId) {
    await options.client.threadBindings
      .heartbeatBridgeSession({
        harnessName: options.profile.name,
        adeKind,
        externalThreadId: sessionId,
        workspacePath: workspacePath ?? null,
        pid: options.pid ?? process.ppid ?? process.pid,
        capabilities: {
          hookDialect: options.profile.hookDialect ?? null,
          wakesIdle: options.profile.wakesIdle,
        },
        status: "online",
      })
      .catch(() => {});
  }

  const wakes = await options.client.threadBindings.pollWakeEvents({
    adeKind,
    ...(sessionId ? { externalThreadId: sessionId } : {}),
    ...(workspacePath ? { workspacePath } : {}),
    markDelivered: true,
  });

  const dialect: BuiltinHookDialect = options.profile.hookDialect ?? "claude-code";
  const output = formatHookDialectResponse(dialect, options.eventName, wakes);

  if (wakes.length > 0) {
    await Promise.allSettled(
      wakes.map((wake) =>
        options.client.threadBindings.ackWakeEvent(wake.id, { status: "acked" }),
      ),
    );
  }

  return {
    wakes,
    output,
    ...(sessionId ? { sessionId } : {}),
    ...(workspacePath ? { workspacePath } : {}),
  };
}

async function readAllStreamText(stream: NodeJS.ReadableStream): Promise<string> {
  if ("isTTY" in stream && (stream as { isTTY?: boolean }).isTTY) {
    return "";
  }
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8");
}

export interface RunHookCommandOptions {
  readonly eventName: string;
  readonly profile: HarnessWakeProfile;
  readonly baseUrl: string;
  readonly token?: string | undefined;
  readonly explicitSessionId?: string | undefined;
  readonly explicitWorkspacePath?: string | undefined;
  readonly input?: NodeJS.ReadableStream | undefined;
  readonly output?: NodeJS.WritableStream | undefined;
}

export async function runHookCommand(options: RunHookCommandOptions): Promise<ExecuteHookResult> {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const stdinRaw = await readAllStreamText(input);
  const client = createInkadeClient({
    baseUrl: options.baseUrl,
    ...(options.token ? { token: options.token } : {}),
  });

  const result = await executeHook({
    eventName: options.eventName,
    profile: options.profile,
    stdinRaw,
    client,
    explicitSessionId: options.explicitSessionId,
    explicitWorkspacePath: options.explicitWorkspacePath,
    cwd: process.cwd(),
  });

  output.write(`${JSON.stringify(result.output)}\n`);
  return result;
}
