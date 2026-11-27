import { InkadeI18nProvider, useInkadeTranslation } from "@inkade/i18n";
import { Button, SegmentedControl, SegmentedControlItem } from "@inkade/ui/primitives";
import { BookmarkCheck, Highlighter, Languages, PanelRightOpen, Settings } from "lucide-react";
import { createRoot } from "react-dom/client";
import { getWebExt, openClipperSidePanel } from "../shared/webext.ts";
import { PopupClipForm } from "./popup/PopupClipForm.tsx";
import { PopupHighlightForm } from "./popup/PopupHighlightForm.tsx";
import { PopupNoticeCards } from "./popup/PopupNoticeCards.tsx";
import { usePopupController } from "./popup/usePopupController.ts";
import { ClipperShellHeader } from "./shared/ClipperShellHeader.tsx";
import { ClipperStatusBanner } from "./shared/ClipperStatusBanner.tsx";
import { launchClipperPairingFlow, openDocInInkadeTab } from "./shared/clipper-ui-helpers.ts";
import { usePopupStore } from "./stores/popup-store.ts";
import { useClipperSettingsStore } from "./stores/settings-store.ts";

function PopupView() {
  const { t } = useInkadeTranslation();
  const settings = useClipperSettingsStore((s) => s.settings);
  const settingsLoaded = useClipperSettingsStore((s) => s.settingsLoaded);
  const offlineCount = useClipperSettingsStore((s) => s.offlineCount);

  const store = usePopupStore();
  const controller = usePopupController();

  const openOptionsPage = () => {
    void getWebExt()?.runtime?.openOptionsPage?.();
  };

  return (
    <div className="popup-shell">
      <ClipperShellHeader
        actions={
          <>
            <Button
              aria-label={t("clipper.openSidePanel")}
              onClick={() => void openClipperSidePanel(store.activeTab ?? undefined)}
              size="icon-xs"
              title={t("clipper.openSidePanel")}
              variant="outline"
            >
              <PanelRightOpen className="size-3.5" />
            </Button>
            <Button
              aria-label={t("clipper.toggleLanguage")}
              onClick={() => void controller.handleToggleLocale()}
              size="icon-xs"
              title={t("clipper.toggleLanguage")}
              variant="outline"
            >
              <Languages className="size-3.5" />
            </Button>
            <Button
              aria-label={t("clipper.openOptions")}
              onClick={openOptionsPage}
              size="icon-xs"
              title={t("clipper.openOptions")}
              variant="outline"
            >
              <Settings className="size-3.5" />
            </Button>
          </>
        }
        connectionBadge={{
          connected: store.connected,
          connecting: store.connecting,
        }}
        flushingOffline={store.flushingOffline}
        isConfigured={controller.isConfigured}
        offlineCount={offlineCount}
        onFlushOffline={() => void controller.handleFlushOffline()}
      />

      <PopupNoticeCards
        activeTabUrl={store.activeTab?.url}
        connecting={store.connecting}
        connectionError={store.connectionError}
        existingDocId={store.existingLookup?.found ? store.existingLookup.document?.id : undefined}
        existingHighlightsCount={store.existingLookup?.highlights.length ?? 0}
        extractFailed={store.extractFailed}
        extracting={store.extracting}
        hasActiveTab={Boolean(store.activeTab)}
        hasExtracted={Boolean(store.extracted)}
        isConfigured={controller.isConfigured}
        missingHostPermission={store.missingHostPermission}
        onGrantHostPerm={() => void controller.handleGrantOriginPermission()}
        onOneClickPair={() =>
          void launchClipperPairingFlow({
            serverUrl: settings.serverUrl,
            webAppUrl: settings.webAppUrl,
            probeLocal: true,
          })
        }
        onOpenDoc={(docId) => openDocInInkadeTab(settings, docId)}
        onOpenOptions={openOptionsPage}
        onRetryConnect={() => void controller.connectToServer(settings)}
        onRetryExtract={() => {
          if (store.activeTab) {
            void controller.extractFromTab(store.activeTab, store.templates, settings.defaultTags);
          }
        }}
        settingsLoaded={settingsLoaded}
        tabRestricted={store.tabRestricted}
      />

      {store.extracted ? (
        <>
          {store.selection && store.selection.quote.trim().length >= 2 ? (
            <SegmentedControl className="grid w-full grid-cols-2" size="sm">
              <SegmentedControlItem
                aria-pressed={store.activeMode === "clip"}
                className="w-full justify-center text-xs"
                data-pressed={store.activeMode === "clip" ? "" : undefined}
                onClick={() => store.setField("activeMode", "clip")}
              >
                <BookmarkCheck className="size-3.5" />
                <span>{t("clipper.modeClipPage")}</span>
              </SegmentedControlItem>
              <SegmentedControlItem
                aria-pressed={store.activeMode === "highlight"}
                className="w-full justify-center text-xs"
                data-pressed={store.activeMode === "highlight" ? "" : undefined}
                onClick={() => store.setField("activeMode", "highlight")}
              >
                <Highlighter className="size-3.5" />
                <span>{t("clipper.modeSelectionHighlight")}</span>
              </SegmentedControlItem>
            </SegmentedControl>
          ) : null}

          {store.activeMode === "clip" ? (
            <PopupClipForm
              draftRestored={controller.draftRestored}
              isConfigured={controller.isConfigured}
              onClipPage={(action) => void controller.handleClipPage(action)}
              onMarkEdited={controller.markUserEdited}
              onRunAiEnrich={() => void controller.handleRunAiEnrich()}
              onSelectTemplate={controller.handleSelectTemplate}
              onTriggerTabUi={(msgType) => void controller.handleTriggerTabUi(msgType)}
            />
          ) : (
            <PopupHighlightForm
              isConfigured={controller.isConfigured}
              onClipSelectionOnly={() => void controller.handleClipSelectionOnly()}
              onSyncHighlight={() => void controller.handleSyncHighlight()}
            />
          )}
        </>
      ) : null}

      <ClipperStatusBanner
        onOpenDoc={(docId) => openDocInInkadeTab(settings, docId)}
        status={store.status}
      />
    </div>
  );
}

const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(
    <InkadeI18nProvider>
      <PopupView />
    </InkadeI18nProvider>,
  );
}
