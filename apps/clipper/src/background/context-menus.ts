import { initInkadeI18n, t } from "@inkade/i18n";
import { loadClipperSettings } from "../shared/storage.ts";
import { getWebExt } from "../shared/webext.ts";
import {
  handleClipLinkAction,
  handleClipPageAction,
  handleSaveImageAction,
} from "./handlers/clip-actions.ts";
import {
  handleClipSelectionOnlyAction,
  handleSaveHighlightAction,
} from "./handlers/highlight-actions.ts";
import { dispatchUiTriggerToTab } from "./handlers/page-and-pairing.ts";
import {
  MENU_CLIP_LINK,
  MENU_CLIP_PAGE,
  MENU_CLIP_SELECTION,
  MENU_REGION_PICKER,
  MENU_SAVE_HIGHLIGHT,
  MENU_SAVE_IMAGE,
} from "./types.ts";

export async function registerContextMenus(): Promise<void> {
  const ext = getWebExt();
  if (!ext?.contextMenus) return;
  const settings = await loadClipperSettings();
  initInkadeI18n(settings.locale);

  try {
    await ext.contextMenus.removeAll?.();
  } catch {
    // ignore
  }

  ext.contextMenus.create({
    id: MENU_CLIP_PAGE,
    title: t("clipper.contextMenuClipPage"),
    contexts: ["page"],
  });
  ext.contextMenus.create({
    id: MENU_CLIP_LINK,
    title: t("clipper.contextMenuClipLink"),
    contexts: ["link"],
  });
  ext.contextMenus.create({
    id: MENU_SAVE_HIGHLIGHT,
    title: t("clipper.contextMenuSaveHighlight"),
    contexts: ["selection"],
  });
  ext.contextMenus.create({
    id: MENU_CLIP_SELECTION,
    title: t("clipper.contextMenuClipSelection"),
    contexts: ["selection"],
  });
  ext.contextMenus.create({
    id: MENU_SAVE_IMAGE,
    title: t("clipper.contextMenuSaveImage"),
    contexts: ["image"],
  });
  ext.contextMenus.create({
    id: MENU_REGION_PICKER,
    title: t("clipper.contextMenuRegionPicker"),
    contexts: ["page"],
  });
}

export function registerContextMenuClickListener(): void {
  const ext = getWebExt();
  ext?.contextMenus?.onClicked?.addListener((info, tab) => {
    if (info.menuItemId === MENU_CLIP_PAGE) {
      void handleClipPageAction(tab, true);
      return;
    }
    if (info.menuItemId === MENU_CLIP_LINK && info.linkUrl) {
      void handleClipLinkAction(info.linkUrl, tab);
      return;
    }
    if (info.menuItemId === MENU_SAVE_HIGHLIGHT) {
      void handleSaveHighlightAction(tab, info.selectionText);
      return;
    }
    if (info.menuItemId === MENU_CLIP_SELECTION) {
      void handleClipSelectionOnlyAction(tab, info.selectionText);
      return;
    }
    if (info.menuItemId === MENU_SAVE_IMAGE && info.srcUrl) {
      void handleSaveImageAction(info.srcUrl, tab);
      return;
    }
    if (info.menuItemId === MENU_REGION_PICKER) {
      void dispatchUiTriggerToTab(tab?.id, "INKADE_START_REGION_PICKER");
    }
  });
}
