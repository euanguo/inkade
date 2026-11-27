import { InkadeI18nProvider, useInkadeTranslation } from "@inkade/i18n";
import { Badge, Button, cn, GlideHighlight } from "@inkade/ui/primitives";
import { Bot, FileCode2, Keyboard, PlugZap, Scissors, SlidersHorizontal } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { createClipperSdkClient } from "../core/sync.ts";
import { normalizeServerUrl } from "../shared/storage.ts";
import { OptionsAiSection } from "./options/OptionsAiSection.tsx";
import { OptionsCaptureSection } from "./options/OptionsCaptureSection.tsx";
import { OptionsConnectionSection } from "./options/OptionsConnectionSection.tsx";
import { OptionsSystemSection } from "./options/OptionsSystemSection.tsx";
import { useOptionsController } from "./options/useOptionsController.ts";
import { ClipperStatusBanner } from "./shared/ClipperStatusBanner.tsx";
import { TemplateManager } from "./templates/TemplateManager.tsx";

type OptionsSectionId = "connection" | "capture" | "ai" | "templates" | "system";

function OptionsView() {
  const { t } = useInkadeTranslation();
  const [activeSection, setActiveSection] = useState<OptionsSectionId>("connection");
  const controller = useOptionsController();

  const navItems: readonly {
    readonly id: OptionsSectionId;
    readonly label: string;
    readonly icon: React.ReactNode;
    readonly badge?: string | undefined;
  }[] = [
    {
      id: "connection",
      label: t("clipper.optionsNavConnection"),
      icon: <PlugZap className="size-3.5" />,
    },
    {
      id: "capture",
      label: t("clipper.optionsNavCapture"),
      icon: <SlidersHorizontal className="size-3.5" />,
    },
    {
      id: "ai",
      label: t("clipper.optionsNavAi"),
      icon: <Bot className="size-3.5" />,
    },
    {
      id: "templates",
      label: t("clipper.optionsNavTemplates"),
      icon: <FileCode2 className="size-3.5" />,
    },
    {
      id: "system",
      label: t("clipper.optionsNavSystem"),
      icon: <Keyboard className="size-3.5" />,
      badge: controller.offlineQueue.length > 0 ? String(controller.offlineQueue.length) : undefined,
    },
  ];

  const templateClient = controller.hasValidCredentials
    ? createClipperSdkClient({
        serverUrl: normalizeServerUrl(controller.watchedServerUrl),
        token: controller.watchedToken.trim(),
      })
    : null;

  return (
    <main className="options-shell">
      <header className="flex flex-wrap items-center justify-between gap-3 pb-1">
        <div className="flex items-center gap-3">
          <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Scissors className="size-4" />
          </span>
          <div className="flex flex-col">
            <div className="text-sm font-semibold text-foreground">
              {t("clipper.optionsPageTitle")}
            </div>
            <div className="text-xs text-muted-foreground">
              {t("clipper.optionsPageSubtitle")}
            </div>
          </div>
        </div>
        {controller.connInfo ? (
          <Badge className="ink-badge ok" size="sm" variant="outline">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-success" />
            <span>{controller.connInfo.tokenName}</span>
          </Badge>
        ) : null}
      </header>

      <div className="flex flex-col gap-5 md:flex-row md:items-start">
        <nav
          aria-label={t("clipper.optionsPageTitle")}
          className="shrink-0 md:sticky md:top-6 md:w-52"
        >
          <GlideHighlight
            className="flex flex-row flex-wrap gap-1 md:flex-col"
            highlightClassName="rounded-md bg-accent/60"
            mode="pointer"
          >
            {navItems.map((item) => {
              const active = activeSection === item.id;
              return (
                <Button
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative z-10 justify-between font-medium md:w-full",
                    active
                      ? "border-transparent bg-accent/85 text-foreground in-data-[glide-visible=true]:hover:bg-transparent"
                      : "border-transparent text-muted-foreground hover:bg-accent in-data-[glide-visible=true]:hover:bg-transparent hover:text-foreground",
                  )}
                  data-glide-item
                  key={item.id}
                  onClick={() => setActiveSection(item.id)}
                  size="sm"
                  variant="ghost"
                >
                  <span className="inline-flex items-center gap-2">
                    {item.icon}
                    <span>{item.label}</span>
                  </span>
                  {item.badge ? (
                    <Badge className="tabular-nums" size="sm" variant="secondary">
                      {item.badge}
                    </Badge>
                  ) : null}
                </Button>
              );
            })}
          </GlideHighlight>
        </nav>

        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {activeSection === "connection" ? (
            <OptionsConnectionSection
              connInfo={controller.connInfo}
              form={controller.connectionForm}
              onProbeLocalServer={() => void controller.handleProbeLocalServer()}
              onSubmit={(e) => void controller.handleConnectionSubmit(e)}
              onTestConnection={() => void controller.handleTestConnection()}
              probing={controller.probing}
              testing={controller.testing}
            />
          ) : null}

          {activeSection === "capture" ? (
            <OptionsCaptureSection
              capture={controller.capture}
              onUpdatePatch={(cp, sp) => void controller.updateCapturePatch(cp, sp)}
              spaces={controller.spaces}
              tagSuggestions={controller.tagSuggestions}
            />
          ) : null}

          {activeSection === "ai" ? (
            <OptionsAiSection
              form={controller.aiForm}
              onProviderChange={controller.handleAiProviderChange}
              onSubmit={(e) => void controller.handleAiSubmit(e)}
              onTestAi={() => void controller.handleTestAi()}
              testingAi={controller.testingAi}
            />
          ) : null}

          {activeSection === "templates" ? <TemplateManager client={templateClient} /> : null}

          {activeSection === "system" ? (
            <OptionsSystemSection
              busyQueueId={controller.busyQueueId}
              flushingQueue={controller.flushingQueue}
              hasValidCredentials={controller.hasValidCredentials}
              offlineQueue={controller.offlineQueue}
              onClearQueue={() => void controller.handleClearQueue()}
              onFlushQueue={() => void controller.handleFlushQueue()}
              onRemoveItem={(id) => void controller.handleRemoveQueueItem(id)}
              onRetryItem={(id) => void controller.handleRetryQueueItem(id)}
            />
          ) : null}

          <ClipperStatusBanner showSuccessIcon status={controller.status} />
        </div>
      </div>
    </main>
  );
}

const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(
    <InkadeI18nProvider>
      <OptionsView />
    </InkadeI18nProvider>,
  );
}
