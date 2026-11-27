#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { formatDoctorHumanReport, runDoctor } from "./doctor.ts";
import { runHookCommand } from "./hook.ts";
import { runMcpBridge } from "./mcp-bridge.ts";
import {
  loadAllHarnessProfiles,
  resolveHarnessProfile,
  resolveInkadeConnectionOptions,
  resolveSessionIdFromContext,
  saveUserHarnessProfile,
} from "./profiles.ts";
import { startWatchBridge } from "./watch.ts";

export interface ParsedCliArgs {
  readonly command: string | undefined;
  readonly positionals: readonly string[];
  readonly flags: Readonly<Record<string, string | boolean>>;
}

export function parseCliArgs(argv: readonly string[]): ParsedCliArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!;
    if (token.startsWith("--")) {
      const eqIdx = token.indexOf("=");
      if (eqIdx > 2) {
        flags[token.slice(2, eqIdx)] = token.slice(eqIdx + 1);
      } else {
        const key = token.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          flags[key] = next;
          i += 1;
        } else {
          flags[key] = true;
        }
      }
    } else {
      positionals.push(token);
    }
  }

  return {
    command: positionals[0],
    positionals: positionals.slice(1),
    flags,
  };
}

function readStringFlag(
  flags: Readonly<Record<string, string | boolean>>,
  key: string,
): string | undefined {
  const val = flags[key];
  return typeof val === "string" && val.trim().length > 0 ? val.trim() : undefined;
}

export async function runCli(argv: readonly string[]): Promise<number> {
  const parsed = parseCliArgs(argv);
  const harnessName = readStringFlag(parsed.flags, "harness") ?? "any";
  const urlFlag = readStringFlag(parsed.flags, "url");
  const tokenFlag = readStringFlag(parsed.flags, "token");
  const sessionFlag = readStringFlag(parsed.flags, "session");
  const workspaceFlag = readStringFlag(parsed.flags, "workspace");
  const conn = resolveInkadeConnectionOptions({ url: urlFlag, token: tokenFlag });

  switch (parsed.command) {
    case "mcp": {
      const profile = resolveHarnessProfile(harnessName);
      const sessionId = resolveSessionIdFromContext(profile, {
        explicitSessionId: sessionFlag,
      });
      await runMcpBridge({
        baseUrl: conn.baseUrl,
        token: conn.token,
        profile,
        sessionId,
        workspacePath: workspaceFlag ?? process.cwd(),
      });
      return 0;
    }

    case "hook": {
      const eventName = parsed.positionals[0] ?? "SessionStart";
      const profile = resolveHarnessProfile(harnessName);
      await runHookCommand({
        eventName,
        profile,
        baseUrl: conn.baseUrl,
        token: conn.token,
        explicitSessionId: sessionFlag,
        explicitWorkspacePath: workspaceFlag,
      });
      return 0;
    }

    case "watch": {
      const profile = resolveHarnessProfile(harnessName);
      const sessionId = resolveSessionIdFromContext(profile, {
        explicitSessionId: sessionFlag,
      });
      const controller = new AbortController();
      const onSignal = () => controller.abort();
      process.once("SIGINT", onSignal);
      process.once("SIGTERM", onSignal);
      const watcher = startWatchBridge({
        baseUrl: conn.baseUrl,
        token: conn.token,
        profile,
        sessionId,
        workspacePath: workspaceFlag ?? process.cwd(),
        signal: controller.signal,
      });
      await watcher.done;
      return 0;
    }

    case "profile": {
      const sub = parsed.positionals[0] ?? "list";
      if (sub === "list") {
        const profiles = loadAllHarnessProfiles();
        process.stdout.write(`${JSON.stringify({ profiles }, null, 2)}\n`);
        return 0;
      }
      if (sub === "show") {
        const target = parsed.positionals[1] ?? harnessName;
        const profile = resolveHarnessProfile(target);
        process.stdout.write(`${JSON.stringify({ profile }, null, 2)}\n`);
        return 0;
      }
      if (sub === "save") {
        const rawJson = readStringFlag(parsed.flags, "json");
        if (!rawJson) {
          throw new Error("Missing --json payload for `inkade profile save`");
        }
        const parsedProfile = JSON.parse(rawJson) as Parameters<typeof saveUserHarnessProfile>[0];
        const savedPath = saveUserHarnessProfile(parsedProfile);
        process.stdout.write(`${JSON.stringify({ savedPath })}\n`);
        return 0;
      }
      throw new Error(`Unknown profile subcommand "${sub}"`);
    }

    case "doctor": {
      const jsonOutput = parsed.flags.json === true || parsed.flags.json === "true";
      const report = await runDoctor({
        harness: readStringFlag(parsed.flags, "harness"),
        url: urlFlag,
        token: tokenFlag,
      });
      if (jsonOutput) {
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      } else {
        process.stdout.write(formatDoctorHumanReport(report));
      }
      return report.ok ? 0 : 1;
    }

    default: {
      process.stdout.write(
        "Usage: inkade <mcp|hook|watch|profile|doctor> [--harness <name>] [--url <baseUrl>] [--token <token>] [--session <id>] [--workspace <path>] [--json]\n",
      );
      return parsed.command === undefined || parsed.flags.help === true ? 0 : 1;
    }
  }
}

export * from "./doctor.ts";
export * from "./profiles.ts";
export * from "./mcp-bridge.ts";
export * from "./hook.ts";
export * from "./nudge.ts";
export * from "./watch.ts";

function isDirectEntrypoint(): boolean {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirectEntrypoint()) {
  runCli(process.argv.slice(2))
    .then((code) => {
      if (code !== 0) process.exitCode = code;
    })
    .catch((err) => {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.exitCode = 1;
    });
}
