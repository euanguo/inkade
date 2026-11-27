import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { asDocumentId, asSpaceId, asWorkspaceId, type DocumentRecord } from "@inkade/core";
import {
  InkadeApiError,
  InkadeClient,
} from "@inkade/sdk";
import { flushOfflineMutationQueue } from "@inkade/sdk/offline";
import {
  isLikelyNetworkError,
  parseCaptureIncomingParams,
} from "../lib/text-format.ts";
import {
  advanceMobileHoldProgress,
  ALMOST_READY_THRESHOLD,
  DEFAULT_HOLD_DURATION_MS,
} from "../lib/v35-primitives.ts";
import {
  buildWebShellBootstrapScript,
  classifyWebViewNavigation,
  mapDeepLinkToShellAction,
  resolveShellRouteUrl,
} from "../shell/web-shell-bridge.ts";
import { normalizeServerBaseUrl } from "../storage/credentials.ts";
import {
  SqliteOfflineCacheBackend,
  type SqliteDbDriver,
} from "../storage/sqlite-offline-backend.ts";
import {
  buildMobileTheme,
  getMinTouchTarget,
  MOTION_DURATIONS,
  TYPESET_SPECS,
} from "../theme/tokens.ts";

function makeDoc(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  const now = "2026-11-24T00:00:00.000Z";
  return {
    id: asDocumentId("doc_1"),
    workspaceId: asWorkspaceId("ws_1"),
    spaceId: asSpaceId("spc_1"),
    kind: "article",
    title: "Mobile Research",
    slug: "mobile-research",
    dailyDate: null,
    contentMarkdown: "# Heading",
    contentJson: null,
    contentText: "Heading",
    excerpt: "Heading",
    tags: ["rn"],
    version: 1,
    pinned: false,
    unreadAgentUpdate: false,
    lastEditedByType: "human",
    trashedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function createBunSqliteDriver(): SqliteDbDriver {
  const db = new Database(":memory:");
  return {
    execAsync(source) {
      db.exec(source);
      return Promise.resolve();
    },
    runAsync(source, params) {
      return Promise.resolve(db.query(source).run(...(params as never[])));
    },
    getFirstAsync<T>(source: string, params: unknown[]): Promise<T | null> {
      return Promise.resolve((db.query(source).get(...(params as never[])) as T | undefined) ?? null);
    },
    getAllAsync<T>(source: string, params: unknown[]): Promise<T[]> {
      return Promise.resolve(db.query(source).all(...(params as never[])) as T[]);
    },
  };
}

describe("apps/mobile thin-shell core logic", () => {
  test("builds XSS-safe WebView bootstrap script for token and local-auto modes", () => {
    const tokenScript = buildWebShellBootstrapScript({
      authMode: "token",
      token: "ink_live_123</script>",
      platform: "android",
      locale: "zh-CN",
    });
    expect(tokenScript).toContain("window.__INKADE_MOBILE_SHELL__");
    expect(tokenScript).toContain('localStorage.setItem("inkade:auth-token"');
    expect(tokenScript).toContain('localStorage.setItem("inkade:locale"');
    expect(tokenScript).toContain('dataset.mobileShell = "native"');
    expect(tokenScript).not.toContain("</script>");
    expect(tokenScript).toContain("\\u003c/script\\u003e");
    expect(tokenScript.trim().endsWith("true;")).toBe(true);

    const localAutoScript = buildWebShellBootstrapScript({
      authMode: "local-auto",
      token: "ignored_token",
      platform: "ios",
    });
    expect(localAutoScript).toContain('localStorage.removeItem("inkade:auth-token")');
    expect(localAutoScript).not.toContain("ignored_token");
  });

  test("resolves safe same-origin workspace URLs and rejects open redirects", () => {
    expect(resolveShellRouteUrl("http://127.0.0.1:3488///", "/threads")).toBe(
      "http://127.0.0.1:3488/threads",
    );
    expect(resolveShellRouteUrl("https://notes.example.com", "//evil.com")).toBe(
      "https://notes.example.com/daily",
    );
    expect(resolveShellRouteUrl("https://notes.example.com", "https://evil.com")).toBe(
      "https://notes.example.com/daily",
    );
  });

  test("maps inkade:// deep links and Android share links into shell or web routes", () => {
    expect(
      mapDeepLinkToShellAction("inkade://capture?target=inbox&text=hello&title=Greeting"),
    ).toEqual({
      kind: "capture",
      params: { target: "inbox", text: "hello", title: "Greeting" },
    });
    expect(mapDeepLinkToShellAction("inkade://doc/doc_42")).toEqual({
      kind: "web_path",
      path: "/docs/doc_42",
    });
    expect(mapDeepLinkToShellAction("inkade://daily/2026-11-24")).toEqual({
      kind: "web_path",
      path: "/daily/2026-11-24",
    });
    expect(mapDeepLinkToShellAction("inkade://threads")).toEqual({
      kind: "web_path",
      path: "/threads",
    });
    expect(mapDeepLinkToShellAction("inkade://web?path=%2Flibrary")).toEqual({
      kind: "web_path",
      path: "/library",
    });
    expect(mapDeepLinkToShellAction("/library")).toEqual({
      kind: "web_path",
      path: "/library",
    });
    expect(mapDeepLinkToShellAction("inkade://web?path=%2F%2Fevil.com")).toEqual({
      kind: "web_path",
      path: "/daily",
    });
    expect(mapDeepLinkToShellAction("inkade://shell")).toEqual({ kind: "shell" });
    expect(mapDeepLinkToShellAction("inkade://connect")).toEqual({ kind: "connect" });
    expect(mapDeepLinkToShellAction("https://example.com")).toBeNull();
  });

  test("classifies WebView navigation URLs strictly by origin and scheme safety", () => {
    const base = "http://127.0.0.1:3488";
    expect(classifyWebViewNavigation("http://127.0.0.1:3488/daily", base)).toBe(
      "allow_in_webview",
    );
    expect(classifyWebViewNavigation("about:blank", base)).toBe("allow_in_webview");
    expect(classifyWebViewNavigation("https://inkade.app/docs", base)).toBe("open_external");
    expect(classifyWebViewNavigation("bb://thread/thr_1", base)).toBe("open_external");
    expect(classifyWebViewNavigation("paseo://workspace/main", base)).toBe("open_external");
    expect(classifyWebViewNavigation("cursor://thread/cur_1", base)).toBe("open_external");
    expect(classifyWebViewNavigation("javascript:alert(1)", base)).toBe("block");
    expect(classifyWebViewNavigation("file:///etc/passwd", base)).toBe("block");
  });

  test("persists documents and replays mutations via real SQLite OfflineCacheBackend", async () => {
    const backend = new SqliteOfflineCacheBackend(() => Promise.resolve(createBunSqliteDriver()));
    const doc = makeDoc({ id: asDocumentId("doc_sql_1"), title: "SQLite Cached" });
    await backend.putDocument(doc);
    expect((await backend.getDocument("doc_sql_1"))?.title).toBe("SQLite Cached");
    expect((await backend.listDocuments()).length).toBe(1);

    await backend.putMutation({
      id: "m1",
      kind: "update_document",
      workspaceId: asWorkspaceId("ws_1"),
      documentId: asDocumentId("doc_sql_1"),
      queuedAt: "2026-11-24T01:00:00.000Z",
      attempts: 0,
      input: { title: "Updated Title", expectedVersion: 1 },
    });

    const client = new InkadeClient({
      baseUrl: "http://127.0.0.1:4100",
      fetch: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              document: makeDoc({ id: asDocumentId("doc_sql_1"), title: "Updated Title", version: 2 }),
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        ),
    });

    const result = await flushOfflineMutationQueue(backend, client);
    expect(result.applied).toEqual(["m1"]);
    expect(result.remaining).toBe(0);
    expect((await backend.getDocument("doc_sql_1"))?.version).toBe(2);
    expect(normalizeServerBaseUrl("https://notes.example.com///")).toBe("https://notes.example.com");
    expect(normalizeServerBaseUrl("ftp://bad.host")).toBeNull();
  });

  test("normalizes deep-link and Android share capture params while preserving text and URL", () => {
    expect(
      parseCaptureIncomingParams({
        text: "SharedNoteFromAndroid https://inkade.app/docs",
        title: "ShareTitle",
      }),
    ).toEqual({
      target: "inbox",
      content: "SharedNoteFromAndroid https://inkade.app/docs",
      url: "https://inkade.app/docs",
      title: "ShareTitle",
      detectedUrl: "https://inkade.app/docs",
    });

    expect(parseCaptureIncomingParams({ url: "https://inkade.app" })).toEqual({
      target: "clip",
      content: "",
      url: "https://inkade.app",
      title: "",
      detectedUrl: "https://inkade.app",
    });

    expect(
      parseCaptureIncomingParams({ text: "DeepLinkTest", url: "https://inkade.app" }),
    ).toEqual({
      target: "inbox",
      content: "DeepLinkTest\n\nhttps://inkade.app",
      url: "https://inkade.app",
      title: "",
      detectedUrl: "https://inkade.app",
    });

    expect(
      parseCaptureIncomingParams({ target: "daily", text: "Quick thought" }),
    ).toEqual({
      target: "daily",
      content: "Quick thought",
      url: "",
      title: "",
      detectedUrl: null,
    });

    expect(isLikelyNetworkError(new TypeError("Network request failed"))).toBe(true);
    expect(isLikelyNetworkError(new InkadeApiError(409, "CONFLICT", "Version conflict"))).toBe(false);
  });

  test("resolves shell theme tokens and V3.5 hold-to-confirm math", () => {
    expect(MOTION_DURATIONS.fast).toBe(220);
    expect(TYPESET_SPECS.standard.fontSizePx).toBe(15.5);

    const v4Default = buildMobileTheme({ preference: "system", systemScheme: "light" });
    expect(v4Default.surface).toBe("light");
    expect(v4Default.accentPreset).toBe("mono");
    expect(v4Default.colors.primary).toBe("#171717");
    expect(v4Default.colors.ground).toBe("#f5f5f5");
    expect(getMinTouchTarget("ios")).toBe(44);
    expect(getMinTouchTarget("android")).toBe(48);

    expect(DEFAULT_HOLD_DURATION_MS).toBe(1500);
    expect(ALMOST_READY_THRESHOLD).toBe(0.85);
    expect(advanceMobileHoldProgress(0.5, 750, 1500, "fill")).toBeCloseTo(1, 5);
    expect(advanceMobileHoldProgress(0.5, 150, 1500, "drain")).toBeCloseTo(0.24, 5);
  });
});
