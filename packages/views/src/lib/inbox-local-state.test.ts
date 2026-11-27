import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  readInboxLocalState,
  setBindingInboxSnooze,
  setBindingInboxUnread,
} from "./inbox-local-state.ts";

interface MockEnv {
  readonly store: Map<string, string>;
  readonly dispatchedEvents: string[];
}

const originalWindow = globalThis.window;

function installMockBrowserEnv(): MockEnv {
  const store = new Map<string, string>();
  const dispatchedEvents: string[] = [];

  const mockWindow = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, String(value));
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => {
        store.clear();
      },
    },
    dispatchEvent: (event: Event) => {
      dispatchedEvents.push(event.type);
      return true;
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  Object.defineProperty(globalThis, "window", {
    value: mockWindow,
    configurable: true,
  });

  return { store, dispatchedEvents };
}

describe("inbox-local-state", () => {
  let env: MockEnv;

  beforeEach(() => {
    env = installMockBrowserEnv();
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "window", {
      value: originalWindow,
      configurable: true,
    });
  });

  it("returns empty maps when storage is empty", () => {
    expect(readInboxLocalState(Date.parse("2026-11-25T10:00:00Z"))).toEqual({
      snoozeMap: {},
      unreadMap: {},
    });
  });

  it("sets and clears snooze timestamps and emits change events", () => {
    const futureIso = "2026-11-26T10:00:00.000Z";
    const nowMs = Date.parse("2026-11-25T10:00:00.000Z");

    setBindingInboxSnooze("bnd_1", futureIso);
    expect(readInboxLocalState(nowMs).snoozeMap).toEqual({ bnd_1: futureIso });
    expect(env.dispatchedEvents).toEqual(["inkade:inbox-local-state-change"]);

    setBindingInboxSnooze("bnd_1", null);
    expect(readInboxLocalState(nowMs).snoozeMap).toEqual({});
    expect(env.dispatchedEvents).toEqual([
      "inkade:inbox-local-state-change",
      "inkade:inbox-local-state-change",
    ]);
  });

  it("prunes expired snoozes on read and persists pruned record", () => {
    const expiredIso = "2026-11-25T09:00:00.000Z";
    const activeIso = "2026-11-25T12:00:00.000Z";
    setBindingInboxSnooze("bnd_old", expiredIso);
    setBindingInboxSnooze("bnd_active", activeIso);

    const state = readInboxLocalState(Date.parse("2026-11-25T10:00:00.000Z"));
    expect(state.snoozeMap).toEqual({ bnd_active: activeIso });
    expect(JSON.parse(env.store.get("inkade:inbox:binding-snooze:v1") ?? "{}")).toEqual({
      bnd_active: activeIso,
    });
  });

  it("tracks unread overrides per thread binding and notifies listeners", () => {
    setBindingInboxUnread("bnd_unread", false);
    setBindingInboxUnread("bnd_flagged", true);

    expect(readInboxLocalState().unreadMap).toEqual({
      bnd_unread: false,
      bnd_flagged: true,
    });
    expect(env.dispatchedEvents).toEqual([
      "inkade:inbox-local-state-change",
      "inkade:inbox-local-state-change",
    ]);
  });
});
