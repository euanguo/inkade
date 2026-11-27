import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_SPACE_IDS } from "@inkade/db";
import { createInkadeClient, InkadeApiError } from "@inkade/sdk";
import { createInkadeApp, type InkadeAppInstance } from "./app.ts";

interface Harness {
  readonly baseUrl: string;
  readonly instance: InkadeAppInstance;
  readonly server: ReturnType<typeof Bun.serve>;
  readonly tempDir: string;
}

const activeHarnesses: Harness[] = [];

async function startTestServer(): Promise<Harness> {
  const tempDir = mkdtempSync(join(tmpdir(), "inkade-phase33-ai-test-"));
  const instance = createInkadeApp({
    dbPath: join(tempDir, "inkade.db"),
    dataDir: tempDir,
    localAutoAuth: true,
    authSecret: "test-secret-key-for-inkade-phase33-suite-32bytes",
  });
  await instance.ready;

  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: instance.app.fetch,
    idleTimeout: 30,
  });

  const h: Harness = {
    baseUrl: `http://127.0.0.1:${server.port}`,
    instance,
    server,
    tempDir,
  };
  activeHarnesses.push(h);
  return h;
}

afterEach(() => {
  while (activeHarnesses.length > 0) {
    const h = activeHarnesses.pop();
    if (!h) continue;
    void h.server.stop(true);
    h.instance.close();
    rmSync(h.tempDir, { recursive: true, force: true });
  }
});

describe("Phase 33 — AI Gateway Settings, SSRF Guard & Streaming Rewrite Proxy", () => {
  test("masks API keys, preserves secrets on partial updates, and enforces admin-only PUT", async () => {
    const { baseUrl, instance } = await startTestServer();
    instance.services.aiRewrite.setTestTransport({
      resolveDns: () => Promise.resolve(["93.184.216.34"]),
    });

    const adminSdk = createInkadeClient({ baseUrl });

    const initial = await adminSdk.ai.getSettings();
    expect(initial.enabled).toBe(false);
    expect(initial.hasApiKey).toBe(false);
    expect(initial.apiKeyMasked).toBeNull();
    expect("apiKey" in (initial as unknown as Record<string, unknown>)).toBe(false);

    const updated = await adminSdk.ai.updateSettings({
      enabled: true,
      provider: "deepseek",
      apiKey: "sk-live-secret-abcd",
      temperature: 0.4,
    });
    expect(updated.enabled).toBe(true);
    expect(updated.provider).toBe("deepseek");
    expect(updated.baseUrl).toBe("https://api.deepseek.com/v1");
    expect(updated.model).toBe("deepseek-chat");
    expect(updated.hasApiKey).toBe(true);
    expect(updated.apiKeyMasked).toBe("sk-...abcd");
    expect("apiKey" in (updated as unknown as Record<string, unknown>)).toBe(false);

    // Partial update omitting apiKey retains stored key
    const partial = await adminSdk.ai.updateSettings({
      model: "deepseek-reasoner",
    });
    expect(partial.model).toBe("deepseek-reasoner");
    expect(partial.hasApiKey).toBe(true);
    expect(partial.apiKeyMasked).toBe("sk-...abcd");

    // Non-admin scoped token can read masked settings but cannot PUT
    const issued = await adminSdk.tokens.create({
      name: "Scoped Agent",
      scope: {
        permission: "write",
        spaceIds: [DEFAULT_SPACE_IDS.research],
        includeDescendants: true,
        denyHardDelete: true,
      },
    });
    const scopedSdk = createInkadeClient({ baseUrl, token: issued.rawToken });

    const readByScoped = await scopedSdk.ai.getSettings();
    expect(readByScoped.apiKeyMasked).toBe("sk-...abcd");
    expect("apiKey" in (readByScoped as unknown as Record<string, unknown>)).toBe(false);

    let putError: unknown = null;
    try {
      await scopedSdk.ai.updateSettings({ enabled: false });
    } catch (err) {
      putError = err;
    }
    expect(putError).toBeInstanceOf(InkadeApiError);
    expect((putError as InkadeApiError).status).toBe(403);

    // Clear key explicitly
    const cleared = await adminSdk.ai.updateSettings({ clearApiKey: true });
    expect(cleared.hasApiKey).toBe(false);
    expect(cleared.apiKeyMasked).toBeNull();
  });

  test("blocks SSRF target URLs including loopback, private CIDR, metadata IPs, file:// and DNS rebinding", async () => {
    const { baseUrl, instance } = await startTestServer();
    instance.services.aiRewrite.setTestTransport({
      resolveDns: (hostname) => {
        if (hostname === "rebind.example.com") {
          return Promise.resolve(["10.0.0.42"]);
        }
        return Promise.resolve(["93.184.216.34"]);
      },
    });

    const adminSdk = createInkadeClient({ baseUrl });
    const blockedUrls = [
      "http://127.0.0.1:8080/v1",
      "http://localhost:11434/v1",
      "http://169.254.169.254/latest/meta-data",
      "http://10.0.0.5/v1",
      "http://192.168.1.10/v1",
      "file:///etc/passwd",
      "https://user:pass@api.openai.com/v1",
      "https://rebind.example.com/v1",
    ];

    for (const candidate of blockedUrls) {
      let caught: unknown = null;
      try {
        await adminSdk.ai.updateSettings({
          enabled: true,
          provider: "custom",
          baseUrl: candidate,
          model: "gpt-4o-mini",
          apiKey: "sk-test-1234567890",
        });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(InkadeApiError);
      expect((caught as InkadeApiError).status).toBe(403);
    }
  });

  test("streams OpenAI-compatible SSE deltas via SDK, enforces read scope on documentId, and surfaces upstream errors", async () => {
    const { baseUrl, instance } = await startTestServer();

    const observedUpstreamCalls: Array<{
      url: string;
      authHeader: string | null;
      body: Record<string, unknown>;
    }> = [];
    let simulateUpstreamError = false;

    instance.services.aiRewrite.setTestTransport({
      resolveDns: () => Promise.resolve(["93.184.216.34"]),
      fetchFn: (input, init) => {
        const headers = new Headers(init?.headers);
        const body =
          typeof init?.body === "string"
            ? (JSON.parse(init.body) as Record<string, unknown>)
            : {};
        const url = typeof input === "string" ? input : input.toString();
        observedUpstreamCalls.push({
          url,
          authHeader: headers.get("authorization"),
          body,
        });

        if (simulateUpstreamError) {
          return Promise.resolve(
            new Response(JSON.stringify({ error: { message: "Rate limit exceeded" } }), {
              status: 429,
              headers: { "content-type": "application/json" },
            }),
          );
        }

        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ choices: [{ delta: { content: "Polished " } }] })}\n\n`,
              ),
            );
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ choices: [{ delta: { content: "paragraph." } }] })}\n\n`,
              ),
            );
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          },
        });
        return Promise.resolve(
          new Response(stream, {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          }),
        );
      },
    });

    const adminSdk = createInkadeClient({ baseUrl });
    await adminSdk.ai.updateSettings({
      enabled: true,
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      apiKey: "sk-proj-secret-9999",
      temperature: 0.25,
    });

    const inboxDoc = await adminSdk.documents.create({
      spaceId: DEFAULT_SPACE_IDS.inbox,
      kind: "article",
      title: "Private Draft",
      contentMarkdown: "Private draft text",
    });

    const researchToken = await adminSdk.tokens.create({
      name: "Research Reader",
      scope: {
        permission: "read",
        spaceIds: [DEFAULT_SPACE_IDS.research],
        includeDescendants: true,
        denyHardDelete: true,
      },
    });
    const researchSdk = createInkadeClient({ baseUrl, token: researchToken.rawToken });

    // Unauthorized documentId must fail with 403 before touching upstream OpenAI
    let deniedError: unknown = null;
    try {
      await researchSdk.ai.rewriteStream({
        documentId: inboxDoc.id,
        action: "polish",
        selectedText: "Private draft text",
      });
    } catch (err) {
      deniedError = err;
    }
    expect(deniedError).toBeInstanceOf(InkadeApiError);
    expect((deniedError as InkadeApiError).status).toBe(403);
    expect(observedUpstreamCalls).toHaveLength(0);

    // Authorized stream receives incremental deltas and full result via SDK
    const chunks: string[] = [];
    const finalText = await adminSdk.ai.rewriteStream(
      {
        documentId: inboxDoc.id,
        action: "polish",
        selectedText: "Rough draft text.",
        docTitle: "Private Draft",
      },
      {
        onDelta: (chunk) => chunks.push(chunk),
      },
    );
    expect(chunks).toEqual(["Polished ", "paragraph."]);
    expect(finalText).toBe("Polished paragraph.");

    expect(observedUpstreamCalls).toHaveLength(1);
    expect(observedUpstreamCalls[0]?.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(observedUpstreamCalls[0]?.authHeader).toBe("Bearer sk-proj-secret-9999");
    expect(observedUpstreamCalls[0]?.body.stream).toBe(true);
    expect(observedUpstreamCalls[0]?.body.model).toBe("gpt-4o-mini");

    // Upstream 429 error surfaces cleanly as an InkadeApiError from SSE error event
    simulateUpstreamError = true;
    let upstreamErr: unknown = null;
    try {
      await adminSdk.ai.rewriteStream({
        action: "concise",
        selectedText: "Some verbose text.",
      });
    } catch (err) {
      upstreamErr = err;
    }
    expect(upstreamErr).toBeInstanceOf(InkadeApiError);
    expect((upstreamErr as InkadeApiError).message).toContain("Rate limit exceeded");
  });
});
