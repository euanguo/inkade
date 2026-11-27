import { installImageRefererRules } from "../core/dnr-rules.ts";
import { getWebExt, isRestrictedTabUrl } from "../shared/webext.ts";
import { registerCommandListener } from "./commands.ts";
import {
  registerContextMenuClickListener,
  registerContextMenus,
} from "./context-menus.ts";
import { handleAdeAndOfflineMessage } from "./handlers/ade-and-offline.ts";
import {
  handleBgClipPageMessage,
  handleUiClipArticleMessage,
} from "./handlers/clip-actions.ts";
import { handleHighlightMessage } from "./handlers/highlight-actions.ts";
import {
  handlePageAndPairingMessage,
  handlePageReady,
} from "./handlers/page-and-pairing.ts";
import type { BackgroundRuntimeMessage } from "./types.ts";
import { tryFlushOfflineQueue } from "./utils.ts";

const spaRouteTimers = new Map<number, ReturnType<typeof setTimeout>>();

function bootstrapBackground(): void {
  const ext = getWebExt();
  if (!ext) return;

  ext.runtime?.onInstalled?.addListener(() => {
    void registerContextMenus();
    void installImageRefererRules();
    void tryFlushOfflineQueue();
  });

  ext.runtime?.onStartup?.addListener(() => {
    void registerContextMenus();
    void installImageRefererRules();
    void tryFlushOfflineQueue();
  });

  ext.storage?.onChanged?.addListener((changes, areaName) => {
    if ((areaName === "sync" || areaName === "local") && "inkade:clipper:settings" in changes) {
      void registerContextMenus();
    }
  });

  // SPA navigation route-change highlight restoration
  ext.tabs?.onUpdated?.addListener((tabId, changeInfo) => {
    if (!changeInfo.url || isRestrictedTabUrl(changeInfo.url)) return;
    const targetUrl = changeInfo.url;
    const prev = spaRouteTimers.get(tabId);
    if (prev) clearTimeout(prev);
    const timer = setTimeout(() => {
      spaRouteTimers.delete(tabId);
      void handlePageReady(tabId, targetUrl);
    }, 350);
    spaRouteTimers.set(tabId, timer);
  });

  registerContextMenuClickListener();
  registerCommandListener();

  ext.runtime?.onMessage?.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== "object") return false;
    const msg = message as BackgroundRuntimeMessage;

    if (handlePageAndPairingMessage(msg, sender.tab?.id, sender.tab?.url, sendResponse)) {
      return true;
    }
    if (handleBgClipPageMessage(msg, sender.tab?.id, sendResponse)) {
      return true;
    }
    if (
      handleHighlightMessage(
        msg,
        sender.tab?.id,
        sender.tab?.url,
        sender.tab?.title,
        sendResponse,
      )
    ) {
      return true;
    }
    if (handleUiClipArticleMessage(msg, sender.tab?.id, sendResponse)) {
      return true;
    }
    if (handleAdeAndOfflineMessage(msg, sender.tab?.id, sendResponse)) {
      return true;
    }

    return false;
  });
}

bootstrapBackground();
