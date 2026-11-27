import { describe, expect, test } from "bun:test";
import {
  parseMobileCanvasMessage,
  parseMobileHostMessage,
  parseMobileShellWebMessage,
  type MobileCanvasToHostMessage,
  type MobileHostToCanvasMessage,
  type MobileShellWebToHostMessage,
} from "./mobile-bridge.ts";

describe("packages/core mobile-bridge", () => {
  test("parses valid host-to-canvas init and theme messages", () => {
    const initMsg: MobileHostToCanvasMessage = {
      kind: "init",
      documentId: "doc_123",
      title: "Architecture",
      documentKind: "article",
      markdown: "# Hello [[World]]",
      version: 4,
      sourceUrl: null,
      theme: {
        surface: "dark-dimmed",
        accent: "indigo",
        paperMode: "default",
        readerFont: "sans",
        fontSize: "base",
      },
      mode: "read",
      bindings: [
        {
          id: "bnd_1",
          title: "Investigate RN bridge",
          adeKind: "paseo",
          status: "running",
          deepLink: null,
          lastSummary: "Inspecting specs",
        },
      ],
      highlights: [
        {
          id: "hl_1",
          quote: "Hello",
          color: "amber",
          noteMarkdown: "Important",
        },
      ],
    };

    const parsed = parseMobileHostMessage(JSON.stringify(initMsg));
    expect(parsed).toEqual(initMsg);

    const v35Init: MobileHostToCanvasMessage = {
      ...initMsg,
      theme: {
        ...initMsg.theme,
        typeset: "compact",
        motionProfile: "reduced-pulse",
      },
    };
    expect(parseMobileHostMessage(JSON.stringify(v35Init))).toEqual(v35Init);

    const invalid = parseMobileHostMessage({ kind: "init", version: -1 });
    expect(invalid).toBeNull();
  });

  test("parses valid canvas-to-host messages and rejects malformed payloads", () => {
    const nav: MobileCanvasToHostMessage = {
      kind: "navigate_wikilink",
      target: "Daily/2026-11-24",
    };
    expect(parseMobileCanvasMessage(JSON.stringify(nav))).toEqual(nav);

    const save: MobileCanvasToHostMessage = {
      kind: "save_markdown",
      documentId: "doc_1",
      markdown: "# Updated",
      expectedVersion: 2,
    };
    expect(parseMobileCanvasMessage(save)).toEqual(save);

    expect(parseMobileCanvasMessage("{bad json")).toBeNull();
    expect(parseMobileCanvasMessage({ kind: "navigate_wikilink", target: "" })).toBeNull();
    expect(parseMobileCanvasMessage({ kind: "open_external_url", url: "not-a-url" })).toBeNull();
    expect(parseMobileCanvasMessage({ kind: "scroll_progress", progress: 1.5 })).toBeNull();
  });

  test("parses thin mobile-shell Web-to-Host messages and rejects invalid payloads", () => {
    const ready: MobileShellWebToHostMessage = { kind: "ready", path: "/daily" };
    const themeSync: MobileShellWebToHostMessage = {
      kind: "theme_sync",
      isDark: false,
      backgroundColor: "#ffffff",
      surface: "light",
      accent: "mono",
    };
    const capture: MobileShellWebToHostMessage = {
      kind: "open_native_capture",
      target: "clip",
      url: "https://inkade.app",
      title: "Spec",
    };
    const haptic: MobileShellWebToHostMessage = { kind: "haptic", style: "success" };

    expect(parseMobileShellWebMessage(JSON.stringify(ready))).toEqual(ready);
    expect(
      parseMobileShellWebMessage({ kind: "server_unreachable", message: "Failed to fetch" }),
    ).toEqual({
      kind: "server_unreachable",
      message: "Failed to fetch",
    });
    expect(parseMobileShellWebMessage(themeSync)).toEqual(themeSync);
    expect(parseMobileShellWebMessage(capture)).toEqual(capture);
    expect(parseMobileShellWebMessage({ kind: "open_shell_settings" })).toEqual({
      kind: "open_shell_settings",
    });
    expect(parseMobileShellWebMessage({ kind: "sign_out" })).toEqual({ kind: "sign_out" });
    expect(parseMobileShellWebMessage(haptic)).toEqual(haptic);

    expect(parseMobileShellWebMessage({ kind: "theme_sync", isDark: true })).toBeNull();
    expect(parseMobileShellWebMessage({ kind: "haptic", style: "invalid" })).toBeNull();
    expect(parseMobileShellWebMessage({ kind: "open_external_url", url: "not-a-url" })).toBeNull();
    expect(parseMobileShellWebMessage({ kind: "open_external_url", url: "javascript:alert(1)" })).toBeNull();
    expect(parseMobileShellWebMessage({ kind: "open_external_url", url: "ftp:bad" })).toBeNull();
  });
});
