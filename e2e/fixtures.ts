import { type APIRequestContext, test as base, expect, type Page } from "@playwright/test";

const E2E_DEFAULT_PREFERENCES = {
  tasks: {
    viewMode: "list",
    boardGroupBy: "schedule",
    groupFilter: "all",
    statusFilter: "open",
    quickAddPreset: "today",
    showCompletedInAll: false,
  },
  daily: {
    viewMode: "outline",
    kanbanGroupBy: "status",
    focusRailOpen: false,
    streamMode: false,
    todosExpanded: false,
  },
  library: {
    viewMode: "list",
    sortBy: "updatedAt",
    sortDir: "desc",
    displayOptions: {
      showExcerpt: true,
      showTags: true,
      showAdeBadge: true,
      showProperties: true,
      showEmptyDailies: false,
      density: "comfortable",
    },
  },
  threads: {
    viewMode: "status",
    hostFilter: "all",
  },
  inbox: {
    defaultTab: "exceptions",
  },
  layout: {
    workspaceCanvasWidth: "fluid",
    sidebarMode: "tree",
    showFormatBar: false,
  },
  reader: {
    fontFamily: "sans",
    fontSize: "base",
    measure: "72ch",
    paper: "default",
  },
} as const;

export { expect };

export const MOD_KEY = process.platform === "darwin" ? "Meta" : "Control";
export const E2E_FIXTURE_URL = "https://e2e-fixture.inkade.test/article";

let counter = 0;
export function uniqueSuffix(prefix = "e2e"): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

export function getTodayLocalDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function shiftDateString(dateStr: string, deltaDays: number): string {
  const [y, m, d] = dateStr.split("-").map((n) => Number.parseInt(n, 10));
  const dt = new Date(y ?? 2026, (m ?? 1) - 1, (d ?? 1) + deltaDays);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export async function apiJson<T>(
  request: APIRequestContext,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  options?: {
    readonly data?: unknown;
    readonly token?: string | undefined;
  },
): Promise<{ readonly status: number; readonly body: T }> {
  const headers: Record<string, string> = {};
  if (options?.token) {
    headers["authorization"] = `Bearer ${options.token}`;
  }
  const res = await request.fetch(path, {
    method,
    headers,
    ...(options?.data !== undefined ? { data: options.data } : {}),
  });
  const text = await res.text();
  let parsed: T;
  try {
    parsed = JSON.parse(text) as T;
  } catch {
    parsed = text as unknown as T;
  }
  return { status: res.status(), body: parsed };
}

export async function resetClientAppearanceAndLocale(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("inkade:locale", "zh-CN");
    } catch {
      // ignore
    }
  });
}

export const test = base.extend<{
  readonly seedTest: void;
}>({
  seedTest: [
    async ({ page, request }, use) => {
      await apiJson(request, "PATCH", "/api/v1/preferences", {
        data: E2E_DEFAULT_PREFERENCES,
      });
      await resetClientAppearanceAndLocale(page);
      await use();
    },
    { auto: true },
  ],
});
