import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import {
  asDocumentId,
  asWakeEventId,
  asWorkspaceId,
  SHIPPED_HARNESS_WAKE_PROFILES_BY_NAME,
  type BridgeSessionRecord,
  type WakeEnvelope,
} from "@inkade/core";
import type { InkadeClient } from "@inkade/sdk";
import {
  assertSafeProfileMutation,
  buildMcpBridgeHeaders,
  executeHook,
  executeNudge,
  forwardMcpJsonRpcLine,
  loadAllHarnessProfiles,
  processWatchWakeEvent,
  resolveEnvFileCredentials,
  resolveNudgeInvocation,
  saveUserHarnessProfile,
} from "./index.ts";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeWake(overrides: Partial<WakeEnvelope> = {}): WakeEnvelope {
  const id = overrides.id ?? asWakeEventId("wke_test_1");
  const documentId = overrides.documentId ?? asDocumentId("doc_test_1");
  const createdAt = overrides.createdAt ?? "2026-11-26T10:00:00.000Z";
  return {
    id,
    workspaceId: asWorkspaceId("ws_default"),
    bindingId: null,
    documentId,
    targetAdeKind: overrides.targetAdeKind ?? "codex",
    targetExternalThreadId: overrides.targetExternalThreadId ?? "thr_codex_1",
    targetWorkspacePath: overrides.targetWorkspacePath ?? "/repo/inkade",
    senderKind: overrides.senderKind ?? "owner",
    senderName: overrides.senderName ?? "Euan",
    reason: overrides.reason ?? "steering",
    summary: overrides.summary ?? "Check output",
    formattedPromptText:
      overrides.formattedPromptText ?? "From: Euan (owner)\nCheck output",
    sourcePayload: overrides.sourcePayload ?? {
      kind: "inkade.wake.v1",
      wakeId: id,
      reason: overrides.reason ?? "steering",
      senderKind: overrides.senderKind ?? "owner",
      senderName: overrides.senderName ?? "Euan",
      documentId,
      documentTitle: "Spec",
      summary: overrides.summary ?? "Check output",
      createdAt,
    },
    deliveryStatus: overrides.deliveryStatus ?? "pending",
    attemptCount: overrides.attemptCount ?? 0,
    lastError: overrides.lastError ?? null,
    createdAt,
    deliveredAt: overrides.deliveredAt ?? null,
    ackedAt: overrides.ackedAt ?? null,
  };
}

describe("Phase 48 — @inkade/cli companion bridge security & dialects", () => {
  test("executeHook formats stdin/stdout payloads accurately across all 4 dialects and ACKs wakes", async () => {
    const sampleWake = makeWake({
      id: asWakeEventId("wke_hook_1"),
      formattedPromptText: "From: Euan (owner)\nUpdate conclusion",
    });

    const dialects = [
      {
        harness: "claude-code",
        event: "Stop",
        expected: { decision: "block", reason: sampleWake.formattedPromptText },
      },
      {
        harness: "cursor",
        event: "postToolUse",
        expected: { additional_context: sampleWake.formattedPromptText },
      },
      {
        harness: "copilot",
        event: "userPromptTransformed",
        expected: { modifiedTransformedPrompt: sampleWake.formattedPromptText },
      },
      {
        harness: "antigravity",
        event: "PreInvocation",
        expected: {
          injectSteps: [
            { role: "system", content: sampleWake.formattedPromptText, wakeId: "wke_hook_1" },
          ],
        },
      },
    ] as const;

    for (const entry of dialects) {
      const heartbeats: unknown[] = [];
      const acks: string[] = [];
      const profile = SHIPPED_HARNESS_WAKE_PROFILES_BY_NAME[entry.harness]!;

      const res = await executeHook({
        eventName: entry.event,
        profile,
        stdinRaw: JSON.stringify({ session_id: "sess_123", cwd: "/tmp/proj" }),
        client: {
          threadBindings: {
            heartbeatBridgeSession: (input: unknown) => {
              heartbeats.push(input);
              return Promise.resolve({} as BridgeSessionRecord);
            },
            pollWakeEvents: () => Promise.resolve([sampleWake]),
            ackWakeEvent: (wakeId: string) => {
              acks.push(wakeId);
              return Promise.resolve(sampleWake);
            },
          } as unknown as InkadeClient["threadBindings"],
        },
      });

      expect(heartbeats).toHaveLength(1);
      expect(acks).toEqual(["wke_hook_1"]);
      expect(res.output).toEqual(entry.expected);
    }
  });

  test("nudge passes malicious text as a single discrete argv token without shell interpolation", async () => {
    const codexProfile = SHIPPED_HARNESS_WAKE_PROFILES_BY_NAME.codex!;
    const maliciousText = "please fix; rm -rf / && `whoami` $(id) | cat /etc/passwd";
    const wake = makeWake({
      senderKind: "owner",
      formattedPromptText: maliciousText,
    });

    let capturedFile = "";
    let capturedArgs: readonly string[] = [];
    let capturedShellOption: unknown;

    const mockRes = await executeNudge({
      profile: codexProfile,
      wake,
      sessionId: "thr_safe_1",
      baseEnv: { ...process.env, INKADE_CODEX_BIN: "/usr/local/bin/codex" },
      execFileImpl: (file, args, options) => {
        capturedFile = file;
        capturedArgs = args;
        capturedShellOption = options.shell;
        return Promise.resolve({ stdout: "ok", stderr: "" });
      },
    });

    expect(mockRes.executed).toBe(true);
    expect(capturedFile).toBe("/usr/local/bin/codex");
    expect(capturedShellOption).toBe(false);
    expect(capturedArgs).toEqual([
      "queue",
      "--thread",
      "thr_safe_1",
      "--message",
      maliciousText,
    ]);

    // Also run real OS execFile with node -e to confirm zero shell command execution
    const realRes = await executeNudge({
      profile: {
        ...codexProfile,
        nudge: {
          command: [process.execPath],
          args: ["-e", "process.stdout.write(JSON.stringify(process.argv.slice(1)))", "${session}", "${text}"],
        },
      },
      wake,
      sessionId: "thr_safe_1",
    });
    expect(realRes.executed).toBe(true);
    expect(JSON.parse(realRes.stdout ?? "[]")).toEqual(["thr_safe_1", maliciousText]);
  });

  test("collaborator and system wakes NEVER execute nudge or wake idle watch", async () => {
    const codexProfile = SHIPPED_HARNESS_WAKE_PROFILES_BY_NAME.codex!;
    const claudeProfile = SHIPPED_HARNESS_WAKE_PROFILES_BY_NAME["claude-code"]!;

    for (const senderKind of ["collaborator", "system"] as const) {
      const wake = makeWake({
        senderKind,
        senderName: senderKind === "collaborator" ? "Bob" : "Cron",
        formattedPromptText: `From: Bob (${senderKind}, not owner)\nTry to run nudge`,
      });

      let nudgeCalled = false;
      const nudgeRes = await executeNudge({
        profile: codexProfile,
        wake,
        sessionId: "thr_1",
        execFileImpl: () => {
          nudgeCalled = true;
          return Promise.resolve({ stdout: "", stderr: "" });
        },
      });
      expect(nudgeRes.executed).toBe(false);
      expect(nudgeRes.skippedReason).toBe(`non_owner_sender:${senderKind}`);
      expect(nudgeCalled).toBe(false);

      const monitorOut = new PassThrough();
      let emitted = "";
      monitorOut.on("data", (chunk) => {
        emitted += String(chunk);
      });
      const watchAction = await processWatchWakeEvent({
        wake: { ...wake, targetAdeKind: "claude-code", targetExternalThreadId: "cc_1" },
        target: { profile: claudeProfile, sessionId: "cc_1" },
        client: { threadBindings: {} as unknown as InkadeClient["threadBindings"] },
        output: monitorOut,
      });
      expect(watchAction).toEqual({
        action: "ignored",
        reason: `non_owner_sender:${senderKind}`,
      });
      expect(emitted).toBe("");
    }
  });

  test("antigravity envFile validates PID liveness and injects httpPort + csrfToken", () => {
    const daemonDir = makeTempDir("inkade-agy-daemon-");
    writeFileSync(
      join(daemonDir, "hub_dead.json"),
      JSON.stringify({ pid: 999991, httpPort: 1111, csrfToken: "stale-token" }),
    );
    writeFileSync(
      join(daemonDir, "hub_live.json"),
      JSON.stringify({ pid: process.pid, httpPort: 4545, csrfToken: "live-csrf-123" }),
    );

    const creds = resolveEnvFileCredentials(
      { dir: daemonDir, pattern: "hub_*.json", pidField: "pid" },
      { isPidAlive: (pid) => pid === process.pid },
    );
    expect(creds?.pid).toBe(process.pid);
    expect(creds?.httpPort).toBe(4545);
    expect(creds?.csrfToken).toBe("live-csrf-123");

    const antigravity = SHIPPED_HARNESS_WAKE_PROFILES_BY_NAME.antigravity!;
    const resolved = resolveNudgeInvocation({
      profile: {
        ...antigravity,
        nudge: {
          ...antigravity.nudge!,
          envFile: { dir: daemonDir, pattern: "hub_*.json", pidField: "pid" },
        },
      },
      wake: makeWake({ targetAdeKind: "antigravity" }),
      sessionId: "conv_1",
      isPidAlive: (pid) => pid === process.pid,
    });
    expect(resolved.allowed).toBe(true);
    expect(resolved.env?.INKADE_HUB_PORT).toBe("4545");
    expect(resolved.env?.INKADE_HUB_CSRF_TOKEN).toBe("live-csrf-123");
  });

  test("refuses modifying harness config inside active agent markers and rejects insecure profile permissions", () => {
    const configDir = makeTempDir("inkade-harness-cfg-");

    expect(() => assertSafeProfileMutation(undefined, { CLAUDECODE: "1" })).toThrow(
      /active agent session/i,
    );
    expect(() => assertSafeProfileMutation(undefined, { CODEX_THREAD_ID: "thr_x" })).toThrow(
      /active agent session/i,
    );
    expect(() => assertSafeProfileMutation(undefined, { ANTIGRAVITY_AGENT: "1" })).toThrow(
      /active agent session/i,
    );

    const savedPath = saveUserHarnessProfile(
      {
        name: "custom-ade",
        title: "Custom ADE",
        agentName: "Custom",
        level: "L2",
        sessionEnv: "CUSTOM_SESSION",
        markers: ["CUSTOM_MARKER"],
        hookDialect: "claude-code",
        wakesIdle: false,
      },
      { configDir, env: {} },
    );
    expect(loadAllHarnessProfiles({ configDir }).some((p) => p.name === "custom-ade")).toBe(true);

    if (process.platform !== "win32") {
      chmodSync(savedPath, 0o644);
      expect(() => loadAllHarnessProfiles({ configDir })).toThrow(/insecure permissions/i);
    }
  });

  test("MCP bridge injects X-Inkade-Host, X-Inkade-Session-Id, and X-Inkade-Workspace headers", async () => {
    let capturedHeaders: Record<string, string> = {};
    const headers = buildMcpBridgeHeaders({
      harnessName: "codex",
      sessionId: "thr_mcp_1",
      workspacePath: "/repo/inkade",
      token: "tok_abc",
    });
    expect(headers["x-inkade-host"]).toBe("codex");
    expect(headers["x-inkade-session-id"]).toBe("thr_mcp_1");
    expect(headers["x-inkade-workspace"]).toBe("/repo/inkade");
    expect(headers.authorization).toBe("Bearer tok_abc");

    const forwarded = await forwardMcpJsonRpcLine({
      baseUrl: "http://127.0.0.1:4311",
      line: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      profile: SHIPPED_HARNESS_WAKE_PROFILES_BY_NAME.codex!,
      sessionId: "thr_mcp_1",
      workspacePath: "/repo/inkade",
      token: "tok_abc",
      fetchImpl: (_url, init) => {
        capturedHeaders = Object.fromEntries(new Headers(init?.headers).entries());
        return Promise.resolve(
          new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { tools: [] } }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      },
    });
    expect(capturedHeaders["x-inkade-session-id"]).toBe("thr_mcp_1");
    expect(capturedHeaders["x-inkade-host"]).toBe("codex");
    expect(forwarded.responses).toHaveLength(1);
  });
});
