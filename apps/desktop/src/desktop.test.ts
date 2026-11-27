import { describe, expect, test } from "bun:test";
import {
  createGlobalQuickCaptureShortcut,
  DEFAULT_QUICK_CAPTURE_SHORTCUT,
  dispatchDesktopNotification,
  formatInkadeDeepLink,
  openDeepLinkInMainWindow,
  parseInkadeDeepLink,
  registerGlobalQuickCaptureShortcut,
  resolveTrayAttentionBadge,
  syncTrayWaitingInputCount,
  toggleQuickCaptureWindow,
  type TauriRuntimeBridge,
} from "./bridge.ts";

describe("@inkade/desktop bridge", () => {
  test("parses inkade:// deep links across daily, doc, thread, capture, tasks, and settings", () => {
    expect(parseInkadeDeepLink("inkade://thread/bb/thr_123")).toEqual({
      kind: "thread",
      adeKind: "bb",
      externalThreadId: "thr_123",
      webPath: "/threads?ade=bb&threadId=thr_123",
    });

    expect(parseInkadeDeepLink("inkade://thread/paseo/ses_abc")).toEqual({
      kind: "thread",
      adeKind: "paseo",
      externalThreadId: "ses_abc",
      webPath: "/threads?ade=paseo&threadId=ses_abc",
    });

    expect(parseInkadeDeepLink("inkade://daily/2026-11-24?nodeId=nod_42")).toEqual({
      kind: "daily",
      date: "2026-11-24",
      nodeId: "nod_42",
      webPath: "/daily/2026-11-24?nodeId=nod_42",
    });

    expect(parseInkadeDeepLink("inkade://daily")).toEqual({
      kind: "daily",
      webPath: "/daily",
    });

    expect(parseInkadeDeepLink("inkade://doc/doc_xyz")).toEqual({
      kind: "document",
      documentId: "doc_xyz",
      webPath: "/docs/doc_xyz",
    });

    expect(
      parseInkadeDeepLink("inkade://capture?title=Hello&url=https%3A%2F%2Fexample.com&spaceId=spc_1"),
    ).toEqual({
      kind: "capture",
      title: "Hello",
      url: "https://example.com",
      spaceId: "spc_1",
      webPath: "/inbox?title=Hello&url=https%3A%2F%2Fexample.com&spaceId=spc_1",
    });

    expect(parseInkadeDeepLink("inkade://tasks")).toEqual({
      kind: "tasks",
      webPath: "/tasks",
    });

    expect(parseInkadeDeepLink("inkade://settings/tokens")).toEqual({
      kind: "settings",
      section: "tokens",
      webPath: "/settings/tokens",
    });
  });

  test("rejects invalid deep links and formats canonical inkade:// URLs", () => {
    expect(parseInkadeDeepLink("")).toBeNull();
    expect(parseInkadeDeepLink("https://inkade.local/docs/1")).toBeNull();
    expect(parseInkadeDeepLink("inkade://daily/2026-02-31")).toBeNull();
    expect(parseInkadeDeepLink("inkade://thread/bad!host/thr_1")).toBeNull();
    expect(parseInkadeDeepLink("inkade://thread//thr_1")).toBeNull();
    expect(parseInkadeDeepLink("inkade://doc")).toBeNull();

    expect(parseInkadeDeepLink("inkade://thread/cursor/cur_1")).toEqual({
      kind: "thread",
      adeKind: "cursor",
      externalThreadId: "cur_1",
      webPath: "/threads?ade=cursor&threadId=cur_1",
    });

    expect(
      formatInkadeDeepLink({
        kind: "thread",
        adeKind: "cursor",
        externalThreadId: "cur_99",
      }),
    ).toBe("inkade://thread/cursor/cur_99");
  });

  test("computes tray attention badge state cleanly", () => {
    expect(resolveTrayAttentionBadge(0)).toEqual({
      waitingCount: 0,
      hasAttention: false,
      badgeText: "",
      status: "idle",
    });

    expect(resolveTrayAttentionBadge(-4)).toEqual({
      waitingCount: 0,
      hasAttention: false,
      badgeText: "",
      status: "idle",
    });

    expect(resolveTrayAttentionBadge(3)).toEqual({
      waitingCount: 3,
      hasAttention: true,
      badgeText: "3",
      status: "attention",
    });

    expect(resolveTrayAttentionBadge(128)).toEqual({
      waitingCount: 128,
      hasAttention: true,
      badgeText: "99+",
      status: "attention",
    });
  });

  test("validates and invokes Tauri v2 shortcut, tray, notification, and deep-link IPC commands", async () => {
    const invoked: Array<{ command: string; args?: Record<string, unknown> | undefined }> = [];
    const mockRuntime: TauriRuntimeBridge = {
      invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
        invoked.push({ command, args });
        if (command === "toggle_quick_capture") {
          return Promise.resolve(true as T);
        }
        return Promise.resolve(undefined as T);
      },
    };

    const shortcut = await registerGlobalQuickCaptureShortcut(
      DEFAULT_QUICK_CAPTURE_SHORTCUT,
      mockRuntime,
    );
    expect(shortcut).toEqual({
      accelerator: "CommandOrControl+Shift+Space",
      action: "toggle-quick-capture",
      webviewWindow: "quick-capture",
    });
    expect(() => createGlobalQuickCaptureShortcut("Space")).toThrow();

    const visible = await toggleQuickCaptureWindow(true, mockRuntime);
    expect(visible).toBe(true);

    const tray = await syncTrayWaitingInputCount(2, mockRuntime);
    expect(tray.hasAttention).toBe(true);

    const notified = await dispatchDesktopNotification(
      {
        title: "ADE Waiting",
        body: "Thread thr_1 needs approval",
        deepLink: "inkade://thread/bb/thr_1",
      },
      mockRuntime,
    );
    expect(notified).toBe(true);

    const route = await openDeepLinkInMainWindow("inkade://thread/bb/thr_1", mockRuntime);
    expect(route?.webPath).toBe("/threads?ade=bb&threadId=thr_1");

    expect(invoked).toEqual([
      {
        command: "register_quick_capture_shortcut",
        args: { accelerator: "CommandOrControl+Shift+Space" },
      },
      {
        command: "toggle_quick_capture",
        args: { visible: true },
      },
      {
        command: "update_tray_attention",
        args: { waitingCount: 2 },
      },
      {
        command: "send_desktop_notification",
        args: {
          title: "ADE Waiting",
          body: "Thread thr_1 needs approval",
          deepLink: "inkade://thread/bb/thr_1",
        },
      },
      {
        command: "navigate_main_window",
        args: { path: "/threads?ade=bb&threadId=thr_1" },
      },
    ]);
  });

  test("falls back safely when running outside Tauri runtime", async () => {
    expect(await toggleQuickCaptureWindow(false, null)).toBe(false);
    expect((await syncTrayWaitingInputCount(5, null)).badgeText).toBe("5");
    expect(await dispatchDesktopNotification({ title: "T", body: "B" }, null)).toBe(false);
    expect((await openDeepLinkInMainWindow("inkade://tasks", null))?.webPath).toBe("/tasks");
  });
});
