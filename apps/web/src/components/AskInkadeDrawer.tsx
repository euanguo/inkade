import { useInkadeTranslation } from "@inkade/i18n";
import {
  Button,
  Drawer,
  DrawerDescription,
  DrawerHeader,
  DrawerPanel,
  DrawerPopup,
  DrawerTitle,
} from "@inkade/ui";
import { useNavigate } from "@tanstack/react-router";
import { Maximize2Icon, SparklesIcon } from "lucide-react";
import type React from "react";
import { AskInkadePanel } from "./ask/AskInkadePanel.tsx";

export interface AskInkadeDrawerProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

export function AskInkadeDrawer({
  open,
  onOpenChange,
}: AskInkadeDrawerProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const navigate = useNavigate();

  return (
    <Drawer onOpenChange={onOpenChange} open={open} position="right">
      <DrawerPopup
        className="w-[92vw] max-w-2xl overflow-hidden bg-background p-0"
        showCloseButton
        variant="straight"
      >
        <DrawerHeader className="flex flex-row items-center justify-between gap-3 border-b px-4 py-3">
          <div className="min-w-0">
            <DrawerTitle className="flex items-center gap-2 text-sm font-semibold">
              <SparklesIcon className="size-4 text-primary" />
              <span>{t("ask.drawerTitle")}</span>
            </DrawerTitle>
            <DrawerDescription className="text-xs">{t("ask.drawerHint")}</DrawerDescription>
          </div>
          <Button
            className="mr-7 shrink-0"
            onClick={() => {
              onOpenChange(false);
              void navigate({ to: "/ask" });
            }}
            size="xs"
            variant="outline"
          >
            <Maximize2Icon className="size-3" />
            <span>{t("ask.openFullPage")}</span>
          </Button>
        </DrawerHeader>
        <DrawerPanel className="min-h-0 flex-1 p-0" scrollable={false}>
          <AskInkadePanel onClose={() => onOpenChange(false)} variant="drawer" />
        </DrawerPanel>
      </DrawerPopup>
    </Drawer>
  );
}
