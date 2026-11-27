import { useInkadeTranslation } from "@inkade/i18n";
import { Badge, Button, Card, Kbd, Separator } from "@inkade/ui/primitives";
import { ExternalLink, Keyboard } from "lucide-react";
import React, { useEffect, useState } from "react";
import { getWebExt } from "../shared/webext.ts";

interface CommandDisplayItem {
  readonly name: string;
  readonly labelKey:
    | "clipper.shortcutOpenPopup"
    | "clipper.shortcutQuickClip"
    | "clipper.shortcutClipSelection"
    | "clipper.shortcutRegionPicker"
    | "clipper.shortcutToggleReader";
  readonly fallbackShortcut: string;
}

const COMMAND_CATALOG: readonly CommandDisplayItem[] = [
  {
    name: "_execute_action",
    labelKey: "clipper.shortcutOpenPopup",
    fallbackShortcut: "⌘⇧K / Ctrl+Shift+K",
  },
  {
    name: "quick-clip",
    labelKey: "clipper.shortcutQuickClip",
    fallbackShortcut: "⌥⇧C / Alt+Shift+C",
  },
  {
    name: "clip-selection",
    labelKey: "clipper.shortcutClipSelection",
    fallbackShortcut: "⌥⇧H / Alt+Shift+H",
  },
  {
    name: "toggle-region-picker",
    labelKey: "clipper.shortcutRegionPicker",
    fallbackShortcut: "⌥⇧S / Alt+Shift+S",
  },
  {
    name: "toggle-reader",
    labelKey: "clipper.shortcutToggleReader",
    fallbackShortcut: "",
  },
];

export function ShortcutsPanel() {
  const { t } = useInkadeTranslation();
  const [liveShortcuts, setLiveShortcuts] = useState<Record<string, string>>({});
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    const ext = getWebExt();
    if (!ext?.commands?.getAll) return;
    void ext.commands
      .getAll()
      .then((list) => {
        const next: Record<string, string> = {};
        for (const cmd of list) {
          if (cmd.name) {
            next[cmd.name] = cmd.shortcut ?? "";
          }
        }
        setLiveShortcuts(next);
      })
      .catch(() => {});
  }, []);

  const handleOpenBrowserShortcuts = async () => {
    setHint(null);
    const ext = getWebExt();
    try {
      if (ext?.tabs?.create) {
        await ext.tabs.create({ url: "chrome://extensions/shortcuts" });
        return;
      }
    } catch {
      // ignore restricted URL scheme error
    }
    try {
      await navigator.clipboard?.writeText("chrome://extensions/shortcuts");
    } catch {
      // ignore clipboard errors
    }
    setHint(t("clipper.shortcutsManualHint"));
  };

  return (
    <Card className="gap-3 rounded-lg px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h2 className="m-0 inline-flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
            <Keyboard className="size-3.5 text-muted-foreground" />
            <span>{t("clipper.shortcutsTitle")}</span>
          </h2>
          <span className="text-xs text-muted-foreground">{t("clipper.shortcutsDesc")}</span>
        </div>
        <Button onClick={() => void handleOpenBrowserShortcuts()} size="xs" variant="outline">
          <ExternalLink className="size-3" />
          <span>{t("clipper.shortcutsCustomizeBtn")}</span>
        </Button>
      </div>

      <div className="flex flex-col gap-1.5">
        {COMMAND_CATALOG.map((item, idx) => {
          const shortcut =
            item.name in liveShortcuts ? liveShortcuts[item.name] : item.fallbackShortcut;
          return (
            <React.Fragment key={item.name}>
              {idx > 0 ? <Separator /> : null}
              <div className="flex items-center justify-between gap-3 py-1">
                <span className="text-xs text-foreground">{t(item.labelKey)}</span>
                {shortcut ? (
                  <Kbd className="px-1.5 font-mono text-[11px]">{shortcut}</Kbd>
                ) : (
                  <Badge size="sm" variant="outline">
                    {t("clipper.shortcutUnassigned")}
                  </Badge>
                )}
              </div>
            </React.Fragment>
          );
        })}
      </div>

      {hint ? <span className="text-[11px] text-muted-foreground">{hint}</span> : null}
    </Card>
  );
}
