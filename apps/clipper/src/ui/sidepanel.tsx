import { InkadeI18nProvider, useInkadeTranslation } from "@inkade/i18n";
import { Button, Card, Tabs, TabsList, TabsPanel, TabsTab } from "@inkade/ui/primitives";
import { RefreshCw, Settings } from "lucide-react";
import { createRoot } from "react-dom/client";
import { getWebExt } from "../shared/webext.ts";
import { ClipperShellHeader } from "./shared/ClipperShellHeader.tsx";
import { ClipperStatusBanner } from "./shared/ClipperStatusBanner.tsx";
import { openDocInInkadeTab } from "./shared/clipper-ui-helpers.ts";
import { SidePanelAdeTab } from "./sidepanel/SidePanelAdeTab.tsx";
import { SidePanelCaptureTab } from "./sidepanel/SidePanelCaptureTab.tsx";
import { SidePanelRelatedTab } from "./sidepanel/SidePanelRelatedTab.tsx";
import { useSidePanelController } from "./sidepanel/useSidePanelController.ts";
import { useClipperSettingsStore } from "./stores/settings-store.ts";
import { useSidePanelStore } from "./stores/sidepanel-store.ts";

function SidePanelView() {
  const { t } = useInkadeTranslation();
  const settings = useClipperSettingsStore((s) => s.settings);
  const settingsLoaded = useClipperSettingsStore((s) => s.settingsLoaded);
  const offlineCount = useClipperSettingsStore((s) => s.offlineCount);

  const store = useSidePanelStore();
  const controller = useSidePanelController();

  const openOptionsPage = () => {
    void getWebExt()?.runtime?.openOptionsPage?.();
  };

  return (
    <div className="sidepanel-shell">
      <ClipperShellHeader
        actions={
          <>
            <Button
              aria-label={t("common.refresh")}
              disabled={store.refreshing}
              onClick={() => void controller.refreshContext()}
              size="icon-xs"
              title={t("common.refresh")}
              variant="outline"
            >
              <RefreshCw className="size-3.5" />
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
        flushingOffline={store.flushingOffline}
        isConfigured={controller.isConfigured}
        offlineCount={offlineCount}
        onFlushOffline={() => void controller.handleFlushOffline()}
      />

      {settingsLoaded && !controller.isConfigured ? (
        <Card className="gap-2 rounded-lg px-3 py-3">
          <strong className="text-[13px] font-semibold text-foreground">
            {t("clipper.setupPromptTitle")}
          </strong>
          <span className="text-xs text-muted-foreground">{t("clipper.setupPromptDesc")}</span>
          <Button onClick={openOptionsPage} size="sm">
            <Settings className="size-3.5" />
            <span>{t("clipper.openSettingsBtn")}</span>
          </Button>
        </Card>
      ) : null}

      <Tabs
        className="gap-2.5"
        onValueChange={(value: unknown) => {
          if (value === "capture" || value === "related" || value === "ade") {
            store.setField("sectionTab", value);
          }
        }}
        value={store.sectionTab}
      >
        <TabsList className="w-full" variant="default">
          <TabsTab className="flex-1 text-xs" value="capture">
            {t("clipper.sidePanelTabCapture")}
          </TabsTab>
          <TabsTab className="flex-1 text-xs" value="related">
            {t("clipper.sidePanelTabRelated")}
          </TabsTab>
          <TabsTab className="flex-1 text-xs" value="ade">
            {t("clipper.sidePanelTabAde")}
          </TabsTab>
        </TabsList>

        <TabsPanel className="flex flex-col gap-2.5" value="capture">
          <SidePanelCaptureTab
            isConfigured={controller.isConfigured}
            onDeleteHighlight={(hl) => void controller.handleDeleteHighlightWithUndo(hl)}
            onFlushNoteNow={controller.flushHighlightNoteNow}
            onLocateHighlight={(id) => void controller.handleLocateHighlight(id)}
            onNoteChange={controller.handleNoteInputChange}
            onOpenDoc={(docId) => openDocInInkadeTab(settings, docId)}
            onQuickClip={() => void controller.handleQuickClip()}
            onQuickCreateHighlight={() => void controller.handleQuickCreateHighlight()}
            onUndoDeleteHighlight={() => void controller.handleUndoDeleteHighlight()}
            onUpdateHighlightColor={(id, color) => void controller.handleUpdateHighlight(id, { color })}
          />
        </TabsPanel>

        <TabsPanel className="flex flex-col gap-2.5" value="related">
          <SidePanelRelatedTab
            isConfigured={controller.isConfigured}
            onAppendDaily={(hit) => void controller.handleAppendRelatedToDaily(hit)}
            onOpenDoc={(docId) => openDocInInkadeTab(settings, docId)}
            onSearchSubmit={() =>
              void controller.loadRelatedForQuery(
                store.relatedQuery,
                settings,
                store.lookup?.document?.id,
                store.relatedScope,
              )
            }
          />
        </TabsPanel>

        <TabsPanel className="flex flex-col gap-2.5" value="ade">
          <SidePanelAdeTab
            isConfigured={controller.isConfigured}
            onDispatchAde={() => void controller.handleDispatchAde()}
            onOpenDoc={(docId) => openDocInInkadeTab(settings, docId)}
          />
        </TabsPanel>
      </Tabs>

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
      <SidePanelView />
    </InkadeI18nProvider>,
  );
}
