import { afterEach, describe, expect, it } from "bun:test";
import {
  asDocumentId,
  asOutlineNodeId,
  asSpaceId,
  asWorkspaceId,
  type DocumentSummary,
  type Space,
  type WorkspaceTaskItem,
} from "@inkade/core";
import { InkadeI18nProvider, initInkadeI18n } from "@inkade/i18n";
import { createInkadeClient, inkadeQueryKeys } from "@inkade/sdk";
import { InkadeSdkProvider } from "@inkade/sdk/react";
import { ToastProvider } from "@inkade/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type React from "react";
import { useRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InkadeViewsProvider } from "../context.tsx";
import { DocumentListView } from "../views/DocumentListView.tsx";
import { InboxView } from "../views/InboxView.tsx";
import { TasksView } from "../views/TasksView.tsx";
import { findScrollableAncestor, useListVirtualizer } from "./use-list-virtualizer.ts";

const SAMPLE_SPACE: Space = {
  id: asSpaceId("spc_eng"),
  workspaceId: asWorkspaceId("ws_1"),
  parentId: null,
  name: "Engineering",
  slug: "engineering",
  icon: "code",
  color: "#4f46e5",
  defaultKind: "article",
  sortOrder: 1,
  archivedAt: null,
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-01T00:00:00Z",
};

const INBOX_SPACE: Space = {
  id: asSpaceId("spc_inbox"),
  workspaceId: asWorkspaceId("ws_1"),
  parentId: null,
  name: "Inbox",
  slug: "inbox",
  icon: "inbox",
  color: "#0ea5e9",
  defaultKind: "clip",
  sortOrder: 0,
  archivedAt: null,
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-01T00:00:00Z",
};

function renderWithSeededQueryClient(
  node: React.ReactElement,
  seed: (queryClient: QueryClient) => void,
): string {
  initInkadeI18n("en-US");
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
    },
  });
  seed(queryClient);

  const client = createInkadeClient({
    baseUrl: "http://127.0.0.1:0",
    fetch: () => Promise.resolve(new Response("[]", { status: 200 })),
  });

  return renderToStaticMarkup(
    <InkadeI18nProvider locale="en-US">
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <InkadeSdkProvider client={client}>
            <InkadeViewsProvider
              navigation={{
                openDocument: () => {},
                openDaily: () => {},
                openSpace: () => {},
                openLibrary: () => {},
              }}
            >
              {node}
            </InkadeViewsProvider>
          </InkadeSdkProvider>
        </ToastProvider>
      </QueryClientProvider>
    </InkadeI18nProvider>,
  );
}

function VirtualizerHarness({
  count,
  estimateHeight,
  overscan,
  fallbackHeight,
}: {
  readonly count: number;
  readonly estimateHeight: number;
  readonly overscan?: number | undefined;
  readonly fallbackHeight?: number | undefined;
}): React.ReactElement {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const virtualizer = useListVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimateHeight,
    ...(overscan !== undefined ? { overscan } : {}),
    ...(fallbackHeight ? { fallbackRect: { width: 800, height: fallbackHeight } } : {}),
  });

  return (
    <div ref={scrollRef}>
      <div
        data-total-size={virtualizer.getTotalSize()}
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        {virtualizer.getVirtualItems().map((item) => (
          <div data-index={item.index} key={item.key} ref={virtualizer.measureElement}>
            {`Row ${item.index}`}
          </div>
        ))}
      </div>
    </div>
  );
}

function countRenderedVirtualIndices(html: string): number {
  return html.match(/data-index="\d+"/g)?.length ?? 0;
}

function make150Tasks(): readonly WorkspaceTaskItem[] {
  return Array.from({ length: 150 }, (_, index) => {
    const label = `Virtual Task ${String(index).padStart(3, "0")}`;
    return {
      node: {
        id: asOutlineNodeId(`nod_${index}`),
        documentId: asDocumentId("doc_tasks"),
        parentNodeId: null,
        orderKey: `a${String(index).padStart(4, "0")}`,
        contentMarkdown: label,
        contentText: label,
        checked: false,
        collapsed: false,
        authorType: "human",
        authorId: null,
        sourceBindingId: null,
        createdAt: "2026-11-25T08:00:00Z",
        updatedAt: "2026-11-25T08:00:00Z",
        deletedAt: null,
      },
      document: {
        id: asDocumentId("doc_tasks"),
        title: "Virtual Tasks Container",
        spaceId: SAMPLE_SPACE.id,
        dailyDate: null,
        tags: [],
      },
      bindings: [],
    };
  });
}

function make150Documents(kind: "article" | "clip", prefix: string): readonly DocumentSummary[] {
  const spaceId = kind === "clip" ? INBOX_SPACE.id : SAMPLE_SPACE.id;
  const baseMs = Date.UTC(2026, 10, 25, 12, 0, 0);
  return Array.from({ length: 150 }, (_, index) => {
    const iso = new Date(baseMs - index * 60_000).toISOString();
    return {
      id: asDocumentId(`doc_${kind}_${index}`),
      workspaceId: asWorkspaceId("ws_1"),
      spaceId,
      kind,
      title: `${prefix} ${String(index).padStart(3, "0")}`,
      slug: `${prefix.toLowerCase().replace(/\s+/g, "-")}-${index}`,
      excerpt: `Preview snippet ${index}`,
      dailyDate: null,
      ...(kind === "clip" ? { sourceUrl: `https://example.com/${index}` } : {}),
      sourceMeta: null,
      properties: {},
      tags: [],
      pinned: false,
      unreadAgentUpdate: false,
      lastEditedByType: "human",
      version: 1,
      createdAt: iso,
      updatedAt: iso,
      trashedAt: null,
    };
  });
}

describe("useListVirtualizer and virtualized views", () => {
  const originalWindow = globalThis.window;

  afterEach(() => {
    Object.defineProperty(globalThis, "window", {
      value: originalWindow,
      configurable: true,
    });
  });

  it("window-slices large lists via fallbackRect instead of mounting all rows", () => {
    const html = renderToStaticMarkup(
      <VirtualizerHarness count={200} estimateHeight={50} fallbackHeight={300} overscan={2} />,
    );

    const renderedCount = countRenderedVirtualIndices(html);
    expect(html).toContain('data-total-size="10000"');
    expect(html).toContain('data-index="0"');
    expect(html).not.toContain('data-index="199"');
    expect(renderedCount).toBeGreaterThan(0);
    expect(renderedCount).toBeLessThan(20);
  });

  it("locates nearest ScrollArea viewport or overflowing ancestor in DOM trees", () => {
    Object.defineProperty(globalThis, "window", {
      value: {
        getComputedStyle: (el: { readonly overflowY?: string }) => ({
          overflowY: el.overflowY ?? "visible",
        }),
      },
      configurable: true,
    });

    const viewport = {
      getAttribute: (name: string) => (name === "data-slot" ? "scroll-area-viewport" : null),
      parentElement: null,
    };
    const middle = {
      overflowY: "hidden",
      getAttribute: () => null,
      parentElement: viewport,
    };
    const leaf = {
      getAttribute: () => null,
      parentElement: middle,
    };

    expect(findScrollableAncestor(leaf as unknown as HTMLElement)).toBe(
      viewport as unknown as HTMLElement,
    );

    const overflowScroller = {
      overflowY: "auto",
      getAttribute: () => null,
      parentElement: null,
    };
    const leaf2 = {
      getAttribute: () => null,
      parentElement: overflowScroller,
    };
    expect(findScrollableAncestor(leaf2 as unknown as HTMLElement)).toBe(
      overflowScroller as unknown as HTMLElement,
    );
  });

  it("virtualizes 150 tasks in TasksView without rendering all rows", () => {
    const tasks = make150Tasks();
    const html = renderWithSeededQueryClient(
      <TasksView urlState={{ view: "list", group: "all", status: "open" }} />,
      (qc) => {
        qc.setQueryData(inkadeQueryKeys.spaces(false), [SAMPLE_SPACE]);
        qc.setQueryData(inkadeQueryKeys.tasks({ status: "all", limit: 500 }), tasks);
      },
    );

    const renderedCount = countRenderedVirtualIndices(html);
    expect(html).toContain('data-testid="tasks-virtual-list"');
    expect(html).toContain("Virtual Task 000");
    expect(html).not.toContain("Virtual Task 149");
    expect(renderedCount).toBeGreaterThan(0);
    expect(renderedCount).toBeLessThan(40);
  });

  it("virtualizes 150 documents in DocumentListView across list, grid, and table modes", () => {
    const docs = make150Documents("article", "Virtual Doc");
    const seed = (qc: QueryClient): void => {
      qc.setQueryData(inkadeQueryKeys.spaces(false), [SAMPLE_SPACE]);
      qc.setQueryData(inkadeQueryKeys.threadBindings({}), []);
      qc.setQueryData([...inkadeQueryKeys.documents(), "infinite"], {
        pages: [docs],
        pageParams: [0],
      });
    };

    const listHtml = renderWithSeededQueryClient(
      <DocumentListView urlState={{ view: "list", sort: "updatedAt", dir: "desc" }} />,
      seed,
    );
    expect(listHtml).toContain('data-testid="library-list-virtual"');
    expect(listHtml).toContain("Virtual Doc 000");
    expect(listHtml).not.toContain("Virtual Doc 149");
    expect(countRenderedVirtualIndices(listHtml)).toBeLessThan(40);

    const gridHtml = renderWithSeededQueryClient(
      <DocumentListView urlState={{ view: "grid", sort: "updatedAt", dir: "desc" }} />,
      seed,
    );
    expect(gridHtml).toContain('data-testid="library-grid-virtual"');
    expect(gridHtml).toContain("Virtual Doc 000");
    expect(gridHtml).not.toContain("Virtual Doc 149");
    expect(countRenderedVirtualIndices(gridHtml)).toBeLessThan(30);

    const tableHtml = renderWithSeededQueryClient(
      <DocumentListView urlState={{ view: "table", sort: "updatedAt", dir: "desc" }} />,
      seed,
    );
    expect(tableHtml).toContain("<table");
    expect(tableHtml).toContain("Virtual Doc 000");
    expect(tableHtml).not.toContain("Virtual Doc 149");
    expect(countRenderedVirtualIndices(tableHtml)).toBeLessThan(45);
  });

  it("virtualizes 150 queue entries in InboxView", () => {
    const clips = make150Documents("clip", "Virtual Clip");
    const html = renderWithSeededQueryClient(<InboxView urlState={{ tab: "clips" }} />, (qc) => {
      qc.setQueryData(inkadeQueryKeys.spaces(false), [INBOX_SPACE, SAMPLE_SPACE]);
      qc.setQueryData(inkadeQueryKeys.documents({ limit: 300 }), clips);
      qc.setQueryData(inkadeQueryKeys.threadBindings({}), []);
    });

    const renderedCount = countRenderedVirtualIndices(html);
    expect(html).toContain(">150<");
    expect(html).toContain("Virtual Clip 000");
    expect(html).not.toContain("Virtual Clip 149");
    expect(renderedCount).toBeGreaterThan(0);
    expect(renderedCount).toBeLessThan(40);
  });
});
