import {
  Button,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Kbd,
  ResizeHandle,
  useResizablePane,
} from "@inkade/ui";
import { CalendarDaysIcon, CheckCircle2Icon, PlusIcon } from "lucide-react";
import type React from "react";
import { useRef } from "react";
import { DispatchAdeDialog } from "../components/DispatchAdeDialog.tsx";
import { InboxDetailPane } from "./inbox/InboxDetailPane.tsx";
import { InboxQueuePane } from "./inbox/InboxQueuePane.tsx";
import type { InboxFilterTab, InboxViewProps, InboxViewUrlState, ShareTargetParams } from "./inbox/types.ts";
import { useInboxTriage } from "./inbox/useInboxTriage.ts";

export type { InboxFilterTab, InboxViewProps, InboxViewUrlState, ShareTargetParams };

export function InboxView(props: InboxViewProps = {}): React.ReactElement {
  const scrollToIndexRef = useRef<((index: number) => void) | null>(null);
  const triage = useInboxTriage({ ...props, scrollToIndexRef });
  const { t, navigation, hostActions } = triage;

  const listPane = useResizablePane({
    storageKey: "inkade:pane:inbox-list",
    defaultWidth: 360,
    minWidth: 272,
    maxWidth: 480,
    side: "left",
  });

  if (triage.isEmptyInboxZero) {
    return (
      <div className="mx-auto flex h-full w-full max-w-3xl items-center justify-center px-4 py-10">
        <Empty className="w-full rounded-lg border border-dashed bg-background py-16">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CheckCircle2Icon className="text-emerald-600 dark:text-emerald-400" />
            </EmptyMedia>
            <EmptyTitle>{t("inbox.inboxZeroTitle")}</EmptyTitle>
            <EmptyDescription>{t("inbox.inboxZeroDesc")}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="flex-row flex-wrap justify-center gap-2">
            <Button onClick={() => hostActions.openQuickCapture?.({ target: "inbox" })} size="sm">
              <PlusIcon />
              {t("inbox.recordOne")}
              <Kbd className="ml-1">C</Kbd>
            </Button>
            <Button onClick={() => navigation.openDaily()} size="sm" variant="outline">
              <CalendarDaysIcon />
              {t("nav.dailyToday")}
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      <InboxQueuePane
        activeTab={triage.activeTab}
        clearReadPending={triage.clearReadMutation.isPending}
        exitingItemIds={triage.exitingItemIds}
        filterText={triage.filterText}
        filteredItems={triage.filteredItems}
        isLoading={triage.isLoadingAll}
        onChangeFilterText={triage.setFilterText}
        onChangeTab={triage.setActiveTab}
        onClearRead={() => triage.clearReadMutation.mutate()}
        onOpenQuickCapture={() => hostActions.openQuickCapture?.({ target: "inbox" })}
        onSelectItem={triage.selectItemAndSyncUrl}
        scrollToIndexRef={scrollToIndexRef}
        selectedItemId={triage.selectedItemId}
        snoozedCount={triage.snoozedItems.length}
        tabCounts={triage.tabCounts}
        widthPx={triage.isMdUp ? listPane.width : undefined}
      />

      <ResizeHandle
        ariaLabel={t("inbox.resizeQueueAria")}
        className="hidden md:block"
        onResizeDelta={listPane.resizeByDelta}
        onResizeEnd={() => listPane.setIsResizing(false)}
        onResizeStart={() => listPane.setIsResizing(true)}
        onReset={listPane.resetWidth}
        orientation="vertical"
        valueMax={480}
        valueMin={272}
        valueNow={listPane.width}
      />

      <section
        className={`min-w-0 flex-1 overflow-hidden ${
          triage.selectedItemId ? "flex flex-col" : "hidden md:flex md:flex-col"
        }`}
      >
        <InboxDetailPane triage={triage} />
      </section>

      <DispatchAdeDialog
        onClose={() => triage.setDispatchTarget(null)}
        target={triage.dispatchTarget}
      />
    </div>
  );
}
