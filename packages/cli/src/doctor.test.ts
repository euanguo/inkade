import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import {
  evaluateSandboxPosture,
  inspectLoopbackProxyBypass,
  maskTokenSecret,
  runCli,
  runDoctor,
  type DoctorReport,
} from "./index.ts";

const tempDirs: string[] = [];
const activeServers: ReturnType<typeof Bun.serve>[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (activeServers.length > 0) {
    const srv = activeServers.pop();
    if (srv) await srv.stop(true);
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

function startMockInkadeServer(options?: {
  readonly expectedToken?: string | undefined;
  readonly rejectToken?: boolean | undefined;
}): { readonly baseUrl: string } {
  const expectedToken = options?.expectedToken ?? "ink_secret_test_token_987654321";
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/api/v1/health") {
        return Response.json({
          ok: true,
          service: "inkade-server",
          dialect: "sqlite",
          timestamp: "2026-11-26T12:00:00.000Z",
        });
      }
      if (url.pathname === "/api/v1/bootstrap") {
        return Response.json({
          initialized: true,
          hasUsers: true,
          authMode: "better-auth",
          workspace: {
            id: "ws_default",
            name: "Default Workspace",
          },
        });
      }
      if (url.pathname === "/api/v1/connect/status") {
        if (options?.rejectToken) {
          return Response.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 });
        }
        return Response.json({
          ok: true,
          serverVersion: "0.1.0",
          mcpEndpoint: `${url.origin}/mcp`,
          totalTools: 41,
        });
      }
      if (url.pathname === "/api/v1/whoami") {
        const auth = req.headers.get("authorization");
        if (options?.rejectToken || auth !== `Bearer ${expectedToken}`) {
          return Response.json(
            { error: { code: "UNAUTHORIZED", message: "Invalid API token" } },
            { status: 401 },
          );
        }
        return Response.json({
          workspaceId: "ws_default",
          principalKind: "token",
          tokenId: "tok_doctor_1",
          tokenName: "Doctor Test Token",
          userId: null,
          scope: {
            permission: "write",
            spaceIds: ["spc_research"],
            includeDescendants: true,
            denyHardDelete: true,
            allowGovernanceMutation: false,
          },
          visibleSpaces: [{ id: "spc_research", slug: "research", name: "Research" }],
          effectiveSummary: {
            permission: "write",
            allowedSpaceIds: ["spc_research"],
            includeDescendants: true,
            tagAllowlist: null,
            allowedKinds: null,
            denyHardDelete: true,
            allowGovernanceMutation: false,
          },
        });
      }
      return Response.json({ error: "Not found" }, { status: 404 });
    },
  });
  activeServers.push(server);
  return { baseUrl: `http://127.0.0.1:${server.port}` };
}

describe("Phase 53 — inkade doctor read-only diagnostics", () => {
  test("masks tokens, performs strictly read-only checks, and passes exit code 0 when healthy", async () => {
    const rawToken = "ink_secret_test_token_987654321";
    const { baseUrl } = startMockInkadeServer({ expectedToken: rawToken });
    const homeDir = makeTempDir("inkade-doctor-home-");
    const binDir = makeTempDir("inkade-doctor-bin-");

    // Non-existent configDir must remain untouched (read-only guarantee)
    const missingConfigDir = join(homeDir, ".config", "inkade", "harnesses");

    // Create dummy executable for agentapi and live daemon hub file
    const agentApiBin = join(binDir, "agentapi");
    writeFileSync(agentApiBin, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    const daemonDir = join(homeDir, ".gemini", "antigravity", "daemon");
    mkdirSync(daemonDir, { recursive: true });
    const rawCsrf = "super_secret_csrf_never_print";
    writeFileSync(
      join(daemonDir, "hub_live.json"),
      JSON.stringify({ pid: process.pid, httpPort: 4999, csrfToken: rawCsrf }),
    );

    const report = await runDoctor({
      harness: "antigravity",
      url: baseUrl,
      token: rawToken,
      homeDir,
      configDir: missingConfigDir,
      env: {
        PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`,
      },
      isPidAlive: (pid) => pid === process.pid,
    });

    expect(report.ok).toBe(true);
    expect(report.readOnly).toBe(true);
    expect(report.sandboxPosture).toBe("localhost_isolated");
    expect(existsSync(missingConfigDir)).toBe(false);

    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain(rawToken);
    expect(serialized).not.toContain(rawCsrf);
    expect(serialized).toContain(maskTokenSecret(rawToken));

    const connectivity = report.checks.find((c) => c.id === "server_connectivity");
    expect(connectivity?.status).toBe("pass");
    expect(connectivity?.details.serverVersion).toBe("0.1.0");

    const tokenScope = report.checks.find((c) => c.id === "token_scope");
    expect(tokenScope?.status).toBe("pass");
    expect(tokenScope?.details.tokenName).toBe("Doctor Test Token");
    expect(tokenScope?.details.permission).toBe("write");

    const harnessCheck = report.checks.find((c) => c.id === "harness_profile");
    expect(harnessCheck?.status).toBe("pass");
    expect(harnessCheck?.details.profilesCount).toBe(1);

    const nudgeCheck = report.checks.find((c) => c.id === "nudge_runtime");
    expect(nudgeCheck?.status).toBe("pass");
    const runtimes = nudgeCheck?.details.runtimes as Array<{
      harness: string;
      binaryFound: boolean;
      pidAlive: boolean;
      pid: number;
      httpPort: number;
    }>;
    expect(runtimes[0]?.harness).toBe("antigravity");
    expect(runtimes[0]?.binaryFound).toBe(true);
    expect(runtimes[0]?.pidAlive).toBe(true);
    expect(runtimes[0]?.pid).toBe(process.pid);
    expect(runtimes[0]?.httpPort).toBe(4999);
  });

  test("detects stale nudge PIDs cleanly and evaluates all sandbox postures", async () => {
    const rawToken = "ink_secret_test_token_987654321";
    const { baseUrl } = startMockInkadeServer({ expectedToken: rawToken });
    const homeDir = makeTempDir("inkade-doctor-stale-");
    const daemonDir = join(homeDir, ".gemini", "antigravity", "daemon");
    mkdirSync(daemonDir, { recursive: true });
    writeFileSync(
      join(daemonDir, "hub_dead.json"),
      JSON.stringify({ pid: 999999, httpPort: 4888, csrfToken: "dead-csrf" }),
    );

    const report = await runDoctor({
      harness: "antigravity",
      url: baseUrl,
      token: rawToken,
      homeDir,
      configDir: join(homeDir, "missing-cfg"),
      env: { PATH: "" },
      isPidAlive: () => false,
    });

    const nudgeCheck = report.checks.find((c) => c.id === "nudge_runtime");
    expect(nudgeCheck?.status).toBe("warn");
    const runtimes = nudgeCheck?.details.runtimes as Array<{ pidAlive: boolean; binaryFound: boolean }>;
    expect(runtimes[0]?.pidAlive).toBe(false);
    expect(runtimes[0]?.binaryFound).toBe(false);

    expect(
      evaluateSandboxPosture({
        baseUrl: "https://notes.example.com",
        env: {
          INKADE_APP_ORIGIN: "https://notes.example.com",
          INKADE_SANDBOX_ORIGIN: "https://sbx.inkade-sandbox.net",
        },
      }).posture,
    ).toBe("dual_origin");

    expect(
      evaluateSandboxPosture({
        baseUrl: "https://notes.example.com",
        env: {},
      }).posture,
    ).toBe("unknown");
  });

  test("runCli doctor --json returns exit code 0 when healthy and exit code 1 on rejected token, unreachable server, unknown harness, or insecure profile", async () => {
    const rawToken = "ink_secret_test_token_987654321";
    const { baseUrl } = startMockInkadeServer({ expectedToken: rawToken });

    // Capture stdout for runCli
    let capturedStdout = "";
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: string | Uint8Array) => {
      capturedStdout += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
      return true;
    };

    try {
      const okCode = await runCli([
        "doctor",
        "--harness",
        "claude-code",
        "--url",
        baseUrl,
        "--token",
        rawToken,
        "--json",
      ]);
      expect(okCode).toBe(0);
      const parsedOk = JSON.parse(capturedStdout) as DoctorReport;
      expect(parsedOk.ok).toBe(true);
      expect(capturedStdout).not.toContain(rawToken);

      capturedStdout = "";
      const badTokenCode = await runCli([
        "doctor",
        "--url",
        baseUrl,
        "--token",
        "ink_wrong_token_999999",
        "--json",
      ]);
      expect(badTokenCode).toBe(1);
      const parsedBadToken = JSON.parse(capturedStdout) as DoctorReport;
      expect(parsedBadToken.ok).toBe(false);
      expect(
        parsedBadToken.checks.find((c) => c.id === "token_scope")?.status,
      ).toBe("fail");

      capturedStdout = "";
      const unknownHarnessCode = await runCli([
        "doctor",
        "--harness",
        "nonexistent_ade",
        "--url",
        baseUrl,
        "--token",
        rawToken,
        "--json",
      ]);
      expect(unknownHarnessCode).toBe(1);

      capturedStdout = "";
      const unreachableCode = await runCli([
        "doctor",
        "--url",
        "http://127.0.0.1:1",
        "--json",
      ]);
      expect(unreachableCode).toBe(1);
    } finally {
      process.stdout.write = originalWrite;
    }

    if (process.platform !== "win32") {
      const cfgDir = makeTempDir("inkade-doctor-insecure-cfg-");
      const badFile = join(cfgDir, "custom.json");
      writeFileSync(
        badFile,
        JSON.stringify({
          name: "custom",
          title: "Custom",
          agentName: "Custom",
          level: "L2",
          markers: ["CUSTOM"],
          wakesIdle: false,
        }),
      );
      chmodSync(badFile, 0o644);
      const insecureReport = await runDoctor({
        url: baseUrl,
        token: rawToken,
        configDir: cfgDir,
      });
      expect(insecureReport.ok).toBe(false);
      expect(insecureReport.checks.find((c) => c.id === "harness_profile")?.status).toBe("fail");
    }

    // Proxy bypass diagnostics for *.sandbox.localhost
    const missingEnvBypass = inspectLoopbackProxyBypass({
      platform: "linux",
      env: {
        HTTPS_PROXY: "http://127.0.0.1:7890",
        NO_PROXY: "localhost,127.0.0.1",
      },
    });
    expect(missingEnvBypass.proxyEnabled).toBe(true);
    expect(missingEnvBypass.missingLocalhostWildcardBypass).toBe(true);

    const darwinMissingBypass = inspectLoopbackProxyBypass({
      platform: "darwin",
      env: {},
      darwinScutilOutput: `
<dictionary> {
  ExceptionsList : <array> {
    0 : 127.0.0.1
    1 : localhost
  }
  HTTPEnable : 1
  HTTPPort : 7890
  HTTPProxy : 127.0.0.1
}
`,
    });
    expect(darwinMissingBypass.proxyEnabled).toBe(true);
    expect(darwinMissingBypass.missingLocalhostWildcardBypass).toBe(true);
    expect(darwinMissingBypass.proxySummary).toBe("darwin:127.0.0.1:7890");

    const postureWithProxyGap = evaluateSandboxPosture({
      baseUrl: "http://localhost:3499",
      env: {},
      proxyCheck: darwinMissingBypass,
    });
    expect(postureWithProxyGap.posture).toBe("localhost_isolated");
    expect(postureWithProxyGap.status).toBe("warn");
    expect(postureWithProxyGap.summary).toContain("*.localhost");

    const wildcardBypassOk = inspectLoopbackProxyBypass({
      platform: "darwin",
      env: {},
      darwinScutilOutput: `
<dictionary> {
  ExceptionsList : <array> {
    0 : localhost
    1 : *.localhost
  }
  HTTPEnable : 1
  HTTPPort : 7890
  HTTPProxy : 127.0.0.1
}
`,
    });
    expect(wildcardBypassOk.proxyEnabled).toBe(true);
    expect(wildcardBypassOk.missingLocalhostWildcardBypass).toBe(false);

    const postureClean = evaluateSandboxPosture({
      baseUrl: "http://localhost:3499",
      env: {},
      proxyCheck: wildcardBypassOk,
    });
    expect(postureClean.status).toBe("pass");
  });
});
