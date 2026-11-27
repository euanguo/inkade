import { createInterface } from "node:readline";
import { normalizeHostKind, type HarnessWakeProfile } from "@inkade/core";

export interface McpBridgeHeaderOptions {
  readonly harnessName: string;
  readonly sessionId?: string | undefined;
  readonly workspacePath?: string | undefined;
  readonly token?: string | undefined;
  readonly mcpSessionId?: string | undefined;
}

export function buildMcpBridgeHeaders(options: McpBridgeHeaderOptions): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "x-inkade-host": normalizeHostKind(options.harnessName),
  };
  if (options.token) {
    headers.authorization = `Bearer ${options.token}`;
  }
  if (options.sessionId) {
    headers["x-inkade-session-id"] = options.sessionId;
  }
  if (options.workspacePath) {
    headers["x-inkade-workspace"] = options.workspacePath;
  }
  if (options.mcpSessionId) {
    headers["mcp-session-id"] = options.mcpSessionId;
  }
  return headers;
}

function extractSseDataLines(rawSse: string): string[] {
  const payloads: string[] = [];
  let currentData: string[] = [];
  for (const line of rawSse.split(/\r?\n/)) {
    if (line === "") {
      if (currentData.length > 0) {
        payloads.push(currentData.join("\n"));
        currentData = [];
      }
      continue;
    }
    if (line.startsWith("data:")) {
      currentData.push(line.slice(5).trimStart());
    }
  }
  if (currentData.length > 0) {
    payloads.push(currentData.join("\n"));
  }
  return payloads;
}

function buildJsonRpcErrorResponse(rawLine: string, message: string): string | null {
  try {
    const parsed = JSON.parse(rawLine) as { id?: unknown };
    if (parsed && typeof parsed === "object" && "id" in parsed && parsed.id !== undefined) {
      return JSON.stringify({
        jsonrpc: "2.0",
        id: parsed.id,
        error: { code: -32603, message },
      });
    }
  } catch {
    // Ignore malformed JSON line
  }
  return null;
}

export type BridgeFetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface ForwardMcpLineOptions {
  readonly baseUrl: string;
  readonly line: string;
  readonly profile: Pick<HarnessWakeProfile, "name">;
  readonly sessionId?: string | undefined;
  readonly workspacePath?: string | undefined;
  readonly token?: string | undefined;
  readonly mcpSessionId?: string | undefined;
  readonly fetchImpl?: BridgeFetchLike | undefined;
}

export async function forwardMcpJsonRpcLine(
  options: ForwardMcpLineOptions,
): Promise<{ readonly responses: readonly string[]; readonly mcpSessionId?: string | undefined }> {
  const trimmed = options.line.trim();
  if (!trimmed) {
    return { responses: [], mcpSessionId: options.mcpSessionId };
  }

  const fetchFn: BridgeFetchLike =
    options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  const headers = buildMcpBridgeHeaders({
    harnessName: options.profile.name,
    sessionId: options.sessionId,
    workspacePath: options.workspacePath,
    token: options.token,
    mcpSessionId: options.mcpSessionId,
  });

  try {
    const res = await fetchFn(`${options.baseUrl.replace(/\/+$/, "")}/mcp`, {
      method: "POST",
      headers,
      body: trimmed,
    });
    const nextSessionId = res.headers.get("mcp-session-id") ?? options.mcpSessionId;
    const rawBody = await res.text();

    if (!res.ok) {
      if (rawBody.trim().startsWith("{")) {
        return { responses: [rawBody.trim()], mcpSessionId: nextSessionId };
      }
      const errResp = buildJsonRpcErrorResponse(
        trimmed,
        `Inkade MCP HTTP ${res.status}: ${rawBody.slice(0, 300)}`,
      );
      return {
        responses: errResp ? [errResp] : [],
        mcpSessionId: nextSessionId,
      };
    }

    if (!rawBody.trim()) {
      return { responses: [], mcpSessionId: nextSessionId };
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("text/event-stream")) {
      const payloads = extractSseDataLines(rawBody).filter((chunk) => chunk.trim().length > 0);
      return { responses: payloads, mcpSessionId: nextSessionId };
    }

    return { responses: [rawBody.trim()], mcpSessionId: nextSessionId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const errResp = buildJsonRpcErrorResponse(trimmed, `Inkade MCP bridge error: ${message}`);
    return {
      responses: errResp ? [errResp] : [],
      mcpSessionId: options.mcpSessionId,
    };
  }
}

export interface RunMcpBridgeOptions {
  readonly baseUrl: string;
  readonly profile: Pick<HarnessWakeProfile, "name">;
  readonly sessionId?: string | undefined;
  readonly workspacePath?: string | undefined;
  readonly token?: string | undefined;
  readonly input?: NodeJS.ReadableStream | undefined;
  readonly output?: NodeJS.WritableStream | undefined;
  readonly fetchImpl?: BridgeFetchLike | undefined;
}

export async function runMcpBridge(options: RunMcpBridgeOptions): Promise<void> {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const rl = createInterface({ input, crlfDelay: Infinity });
  let mcpSessionId: string | undefined;

  for await (const line of rl) {
    const res = await forwardMcpJsonRpcLine({
      baseUrl: options.baseUrl,
      line,
      profile: options.profile,
      sessionId: options.sessionId,
      workspacePath: options.workspacePath,
      token: options.token,
      mcpSessionId,
      fetchImpl: options.fetchImpl,
    });
    mcpSessionId = res.mcpSessionId;
    for (const payload of res.responses) {
      output.write(`${payload}\n`);
    }
  }
}
