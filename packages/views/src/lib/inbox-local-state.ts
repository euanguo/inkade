import { isSnoozeActive } from "@inkade/core";
import { useEffect, useState } from "react";

const SNOOZE_STORAGE_KEY = "inkade:inbox:binding-snooze:v1";
const UNREAD_STORAGE_KEY = "inkade:inbox:binding-unread:v1";
const INBOX_LOCAL_EVENT = "inkade:inbox-local-state-change";

export interface InboxLocalState {
  readonly snoozeMap: Readonly<Record<string, string>>;
  readonly unreadMap: Readonly<Record<string, boolean>>;
}

function readJsonRecord<T>(key: string): Record<string, T> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, T>;
  } catch {
    return {};
  }
}

export function readInboxLocalState(nowMs: number = Date.now()): InboxLocalState {
  const rawSnooze = readJsonRecord<string>(SNOOZE_STORAGE_KEY);
  const snoozeMap: Record<string, string> = {};
  let pruned = false;
  for (const [id, until] of Object.entries(rawSnooze)) {
    if (isSnoozeActive(until, nowMs)) {
      snoozeMap[id] = until;
    } else {
      pruned = true;
    }
  }
  if (pruned && typeof window !== "undefined") {
    try {
      window.localStorage.setItem(SNOOZE_STORAGE_KEY, JSON.stringify(snoozeMap));
    } catch {
      // ignore storage errors
    }
  }
  const unreadMap = readJsonRecord<boolean>(UNREAD_STORAGE_KEY);
  return { snoozeMap, unreadMap };
}

function notifyInboxLocalStateChange(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(INBOX_LOCAL_EVENT));
}

export function setBindingInboxSnooze(id: string, snoozedUntil: string | null): void {
  if (typeof window === "undefined") return;
  const current = readJsonRecord<string>(SNOOZE_STORAGE_KEY);
  if (snoozedUntil) {
    current[id] = snoozedUntil;
  } else {
    delete current[id];
  }
  try {
    window.localStorage.setItem(SNOOZE_STORAGE_KEY, JSON.stringify(current));
  } catch {
    // ignore storage errors
  }
  notifyInboxLocalStateChange();
}

export function setBindingInboxUnread(id: string, unread: boolean): void {
  if (typeof window === "undefined") return;
  const current = readJsonRecord<boolean>(UNREAD_STORAGE_KEY);
  current[id] = unread;
  try {
    window.localStorage.setItem(UNREAD_STORAGE_KEY, JSON.stringify(current));
  } catch {
    // ignore storage errors
  }
  notifyInboxLocalStateChange();
}

export function useInboxLocalState(): InboxLocalState {
  const [state, setState] = useState<InboxLocalState>(() => readInboxLocalState());

  useEffect(() => {
    const sync = (): void => {
      setState(readInboxLocalState());
    };
    window.addEventListener(INBOX_LOCAL_EVENT, sync);
    window.addEventListener("storage", sync);
    const timer = window.setInterval(sync, 60_000);
    return () => {
      window.removeEventListener(INBOX_LOCAL_EVENT, sync);
      window.removeEventListener("storage", sync);
      window.clearInterval(timer);
    };
  }, []);

  return state;
}
