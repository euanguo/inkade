import { describe, expect, it } from "bun:test";
import { INKADE_EMBED_PROTOCOL, type InkadeToHostMessage } from "@inkade/core";
import {
  createInkadeEmbedHost,
  type EmbedHostWindowLike,
  type EmbedIframeLike,
  type EmbedMessageEventLike,
} from "./embed-host.ts";

function createMockHostHarness(origin = "https://inkade.example") {
  const sentMessages: Array<{ readonly message: unknown; readonly targetOrigin: string }> = [];
  const listeners = new Set<(event: EmbedMessageEventLike) => void>();
  const contentWindow = {
    postMessage(message: unknown, targetOrigin: string) {
      sentMessages.push({ message, targetOrigin });
    },
  };
  const iframe: EmbedIframeLike = {
    contentWindow,
    src: `${origin}/daily?embed=1`,
  };
  const hostWindow: EmbedHostWindowLike = {
    addEventListener: (_type, fn) => {
      listeners.add(fn);
    },
    removeEventListener: (_type, fn) => {
      listeners.delete(fn);
    },
  };
  const emitFromIframe = (data: InkadeToHostMessage, overrideOrigin = origin, source: unknown = contentWindow) => {
    for (const fn of listeners) {
      fn({ data, origin: overrideOrigin, source });
    }
  };
  return { sentMessages, listeners, iframe, hostWindow, emitFromIframe };
}

describe("createInkadeEmbedHost", () => {
  it("sends host.hello on init and again when inkade.ready arrives", () => {
    const harness = createMockHostHarness();
    const readyPaths: string[] = [];
    const controller = createInkadeEmbedHost(harness.iframe, {
      hostId: "acme-ide",
      hostName: "Acme IDE",
      capabilities: ["spawn_thread", "open_thread"],
      theme: "dark",
      hostWindow: harness.hostWindow,
      onReady: (p) => readyPaths.push(p.currentPath),
    });

    expect(harness.sentMessages.length).toBe(1);
    expect(harness.sentMessages[0]?.targetOrigin).toBe("https://inkade.example");
    expect((harness.sentMessages[0]?.message as { type: string }).type).toBe("host.hello");

    harness.emitFromIframe({
      protocol: INKADE_EMBED_PROTOCOL,
      type: "inkade.ready",
      payload: { version: "0.1.0", currentPath: "/daily" },
    });

    expect(readyPaths).toEqual(["/daily"]);
    expect(harness.sentMessages.length).toBe(2);

    controller.navigate("/library");
    controller.setTheme("light");
    expect((harness.sentMessages[2]?.message as { type: string }).type).toBe("host.navigate");
    expect((harness.sentMessages[3]?.message as { type: string }).type).toBe("host.theme_changed");

    controller.destroy();
    expect(harness.listeners.size).toBe(0);
  });

  it("ignores messages from untrusted origin and correlates async spawn_thread response", async () => {
    const harness = createMockHostHarness("https://trusted.inkade.test");
    const routes: string[] = [];

    createInkadeEmbedHost(harness.iframe, {
      hostId: "cursor",
      capabilities: ["spawn_thread"],
      hostWindow: harness.hostWindow,
      onRouteChange: (p) => routes.push(p.path),
      onSpawnThread: (req) =>
        Promise.resolve({
          externalThreadId: `thr_created_${req.documentId}`,
        }),
    });

    // Wrong origin -> ignored
    harness.emitFromIframe(
      {
        protocol: INKADE_EMBED_PROTOCOL,
        type: "inkade.route_changed",
        payload: { path: "/evil" },
      },
      "https://evil.test",
    );
    expect(routes).toEqual([]);

    // Trusted origin request
    harness.emitFromIframe({
      protocol: INKADE_EMBED_PROTOCOL,
      type: "inkade.request.spawn_thread",
      requestId: "req_123",
      payload: {
        documentId: "doc_1",
        documentTitle: "Spec",
        prompt: "Review section 2",
        title: "Review Spec",
      },
    });

    await new Promise((r) => setTimeout(r, 10));
    const responseMsg = harness.sentMessages.find(
      (entry) => (entry.message as { requestId?: string }).requestId === "req_123",
    );
    expect(responseMsg).toBeDefined();
    expect(responseMsg?.message).toEqual({
      protocol: INKADE_EMBED_PROTOCOL,
      type: "host.response",
      requestId: "req_123",
      payload: {
        ok: true,
        result: { externalThreadId: "thr_created_doc_1" },
      },
    });
  });

  it("dispatches host.goto_anchor and receives inkade.save_state_changed & inkade.place_changed", () => {
    const harness = createMockHostHarness();
    const saveStates: Array<{ state: string; leaveLosesWork: boolean }> = [];
    const places: Array<{
      documentId: string;
      headingSlug?: string | undefined;
      nodeId?: string | undefined;
      highlightId?: string | undefined;
    }> = [];

    const controller = createInkadeEmbedHost(harness.iframe, {
      hostId: "acme-ide",
      hostWindow: harness.hostWindow,
      onSaveStateChange: (payload) => saveStates.push(payload),
      onPlaceChange: (payload) => places.push(payload),
    });

    controller.gotoAnchor({
      documentId: "doc_1",
      headingSlug: "overview",
      highlightId: "hlt_1",
    });

    expect(harness.sentMessages.at(-1)?.message).toEqual({
      protocol: INKADE_EMBED_PROTOCOL,
      type: "host.goto_anchor",
      payload: {
        documentId: "doc_1",
        headingSlug: "overview",
        highlightId: "hlt_1",
      },
    });

    harness.emitFromIframe({
      protocol: INKADE_EMBED_PROTOCOL,
      type: "inkade.save_state_changed",
      payload: { state: "unsaved", leaveLosesWork: true },
    });
    harness.emitFromIframe({
      protocol: INKADE_EMBED_PROTOCOL,
      type: "inkade.place_changed",
      payload: { documentId: "doc_1", headingSlug: "overview", highlightId: "hlt_1" },
    });

    expect(saveStates).toEqual([{ state: "unsaved", leaveLosesWork: true }]);
    expect(places).toEqual([{ documentId: "doc_1", headingSlug: "overview", highlightId: "hlt_1" }]);

    controller.destroy();
  });

  it("relays commands via POST /api/v1/embed/command when iframe is null (top-level WebView)", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    const mockFetch = (
      input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const body: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : null;
      requests.push({ url, body });
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    };
    const controller = createInkadeEmbedHost(null, {
      hostId: "native-shell",
      serverBaseUrl: "http://127.0.0.1:4321/",
      embedSessionId: "esid_top_1",
      fetch: mockFetch,
    });

    controller.gotoAnchor({
      documentId: "doc_7",
      nodeId: "nd_2",
    });
    await Promise.resolve();

    expect(requests.at(-1)).toEqual({
      url: "http://127.0.0.1:4321/api/v1/embed/command",
      body: {
        embedSessionId: "esid_top_1",
        message: {
          protocol: INKADE_EMBED_PROTOCOL,
          type: "host.goto_anchor",
          payload: {
            documentId: "doc_7",
            nodeId: "nd_2",
          },
        },
      },
    });

    controller.destroy();
  });
});
