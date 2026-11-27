import { useInkadeTranslation } from "@inkade/i18n";
import { Dialog, DialogDescription, DialogPopup, DialogTitle } from "@inkade/ui";
import { useNavigate } from "@tanstack/react-router";
import type React from "react";
import { lazy, Suspense, useEffect, useState } from "react";
import { DEFAULT_SETTINGS_SECTION, type SettingsSectionId } from "../pages/settings/types.ts";

const LazySettingsModalBody = lazy(() =>
  import("../pages/SettingsPage.tsx").then((mod) => ({
    default: function SettingsModalBody({
      activeSection,
      onClose,
      onOpenFullPage,
      onSelectSection,
    }: {
      readonly activeSection: SettingsSectionId;
      readonly onClose: () => void;
      readonly onOpenFullPage: () => void;
      readonly onSelectSection: (nextSection: SettingsSectionId) => void;
    }) {
      return (
        <mod.SettingsLayoutAdapter
          activeSection={activeSection}
          onClose={onClose}
          onOpenFullPage={onOpenFullPage}
          onSelectSection={onSelectSection}
        />
      );
    },
  })),
);

export interface SettingsModalProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly initialSection?: SettingsSectionId | undefined;
}

export function SettingsModal({
  open,
  onOpenChange,
  initialSection = DEFAULT_SETTINGS_SECTION,
}: SettingsModalProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const navigate = useNavigate();
  const [activeSection, setActiveSection] = useState<SettingsSectionId>(initialSection);

  useEffect(() => {
    if (open) {
      setActiveSection(initialSection);
    }
  }, [initialSection, open]);

  const handleOpenFullPage = (): void => {
    onOpenChange(false);
    void navigate({
      to: "/settings/$section",
      params: { section: activeSection },
    });
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogPopup
        className="h-[min(764px,calc(100vh-48px))] max-w-[1080px] overflow-hidden p-0 sm:max-w-[1080px] max-sm:h-[calc(100dvh-24px)]"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">{t("common.settings")}</DialogTitle>
        <DialogDescription className="sr-only">
          {t("settings.sectionAppearanceDesc")}
        </DialogDescription>
        {open ? (
          <Suspense fallback={null}>
            <LazySettingsModalBody
              activeSection={activeSection}
              onClose={() => onOpenChange(false)}
              onOpenFullPage={handleOpenFullPage}
              onSelectSection={setActiveSection}
            />
          </Suspense>
        ) : null}
      </DialogPopup>
    </Dialog>
  );
}
