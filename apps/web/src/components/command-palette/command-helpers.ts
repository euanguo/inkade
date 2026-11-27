import type { DocumentSummary } from "@inkade/core";

const COMMAND_RECENT_VISITS_KEY = "inkade:command:recent-visits:v1";

export function readRecentVisitMap(): Readonly<Record<string, number>> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(COMMAND_RECENT_VISITS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, number>;
  } catch {
    return {};
  }
}

export function recordRecentDocVisit(docId: string): void {
  if (typeof window === "undefined" || !docId) return;
  try {
    const prev = readRecentVisitMap();
    const nextEntries = Object.entries({ ...prev, [docId]: Date.now() })
      .sort((a, b) => b[1] - a[1])
      .slice(0, 40);
    window.localStorage.setItem(
      COMMAND_RECENT_VISITS_KEY,
      JSON.stringify(Object.fromEntries(nextEntries)),
    );
  } catch {
    // ignore storage errors
  }
}

export function isBlankDailyDoc(doc: DocumentSummary): boolean {
  if (!doc.dailyDate || doc.pinned || doc.unreadAgentUpdate || doc.tags.length > 0) {
    return false;
  }
  const stripped = doc.excerpt
    .replace(/^#?\s*\d{4}-\d{2}-\d{2}[^\n]*\n*/u, "")
    .trim();
  return stripped.length === 0;
}

export function parseTodoQuickAddQuery(rawQuery: string): string | null {
  const match = rawQuery.trim().match(/^(?:\/todo|todo|待办)\s+(.+)$/iu);
  const title = match?.[1]?.trim() ?? "";
  return title.length > 0 ? title : null;
}
