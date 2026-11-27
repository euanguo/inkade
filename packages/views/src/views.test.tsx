import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { asDocumentId } from "@inkade/core";
import { InkadeI18nProvider, initInkadeI18n } from "@inkade/i18n";
import { createInkadeClient } from "@inkade/sdk";
import { InkadeSdkProvider } from "@inkade/sdk/react";
import { ToastProvider } from "@inkade/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DailyOutlineView,
  DocumentDetailView,
  DocumentListView,
  InboxView,
  type InkadeHostActions,
  type InkadeNavigationAdapter,
  InkadeViewsProvider,
  SpaceTreeView,
  TasksView,
  ThreadsView,
  useViewsNavigationBlocker,
} from "./index.ts";

describe("@inkade/views router-free decoupling", () => {
  it("package.json has zero router or host-specific ADE dependencies", () => {
    const pkgPath = join(import.meta.dir, "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    const depNames = [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.peerDependencies ?? {}),
    ];
    expect(depNames).not.toContain("@tanstack/react-router");
    expect(depNames).not.toContain("react-router");
    expect(depNames).not.toContain("react-router-dom");
    expect(depNames.some((d) => /bb|paseo|cindy/i.test(d))).toBe(false);
  });

  it("renders all 6 exported views with InkadeViewsProvider and no router", () => {
    initInkadeI18n();
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          staleTime: Number.POSITIVE_INFINITY,
        },
      },
    });
    const client = createInkadeClient({
      baseUrl: "http://127.0.0.1:0",
      fetch: () => Promise.resolve(new Response("[]", { status: 200 })),
    });
    const navigation: InkadeNavigationAdapter = {
      openDocument: () => {},
      openDaily: () => {},
      openSpace: () => {},
      openLibrary: () => {},
      openThreads: () => {},
      openTasks: () => {},
      openInbox: () => {},
    };
    const hostActions: InkadeHostActions = {
      copyText: () => Promise.resolve(true),
    };

    const views = [
      <SpaceTreeView key="space-tree" spaces={[]} />,
      <DocumentListView key="doc-list" />,
      <DocumentDetailView documentId={asDocumentId("doc_test")} key="doc-detail" />,
      <DailyOutlineView date="2026-11-25" key="daily" />,
      <InboxView key="inbox" />,
      <TasksView key="tasks" />,
      <ThreadsView key="threads" />,
    ];

    for (const view of views) {
      const html = renderToStaticMarkup(
        <InkadeI18nProvider>
          <QueryClientProvider client={queryClient}>
            <ToastProvider>
              <InkadeSdkProvider client={client}>
                <InkadeViewsProvider hostActions={hostActions} navigation={navigation}>
                  {view}
                </InkadeViewsProvider>
              </InkadeSdkProvider>
            </ToastProvider>
          </QueryClientProvider>
        </InkadeI18nProvider>,
      );
      expect(typeof html).toBe("string");
      expect(html.length).toBeGreaterThan(0);
    }
  });

  it("calls useViewsNavigationBlocker unconditionally even when host omits useNavigationBlocker", () => {
    function BlockerProbe({
      shouldBlock,
      onSaveAndLeave,
    }: {
      readonly shouldBlock: boolean;
      readonly onSaveAndLeave?: (() => Promise<boolean>) | undefined;
    }) {
      useViewsNavigationBlocker(shouldBlock, "unsaved", {
        onSaveAndLeave,
      });
      return <span>ok</span>;
    }

    const navigationWithoutBlocker: InkadeNavigationAdapter = {
      openDocument: () => {},
      openDaily: () => {},
      openSpace: () => {},
      openLibrary: () => {},
    };

    let observedCalls = 0;
    let sawSaveHandler = false;
    const navigationWithBlocker: InkadeNavigationAdapter = {
      ...navigationWithoutBlocker,
      useNavigationBlocker: (shouldBlock, message, options) => {
        if (shouldBlock && message === "unsaved") {
          observedCalls += 1;
          if (typeof options?.onSaveAndLeave === "function") sawSaveHandler = true;
        }
      },
    };

    const saveFn = () => Promise.resolve(true);
    expect(renderToStaticMarkup(<BlockerProbe shouldBlock />)).toContain("ok");
    expect(
      renderToStaticMarkup(
        <InkadeViewsProvider navigation={navigationWithoutBlocker}>
          <BlockerProbe shouldBlock />
        </InkadeViewsProvider>,
      ),
    ).toContain("ok");
    expect(
      renderToStaticMarkup(
        <InkadeViewsProvider navigation={navigationWithBlocker}>
          <BlockerProbe onSaveAndLeave={saveFn} shouldBlock />
        </InkadeViewsProvider>,
      ),
    ).toContain("ok");
    expect(observedCalls).toBe(1);
    expect(sawSaveHandler).toBe(true);
  });
});
