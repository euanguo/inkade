import { getWebExt } from "../shared/webext.ts";
import { handleClipPageAction } from "./handlers/clip-actions.ts";
import { handleSaveHighlightAction } from "./handlers/highlight-actions.ts";
import { dispatchUiTriggerToTab } from "./handlers/page-and-pairing.ts";
import {
  COMMAND_CLIP_SELECTION,
  COMMAND_QUICK_CLIP,
  COMMAND_REGION_PICKER,
  COMMAND_TOGGLE_READER,
} from "./types.ts";

export function registerCommandListener(): void {
  const ext = getWebExt();
  ext?.commands?.onCommand?.addListener((command) => {
    void (async () => {
      const tabs = (await ext.tabs?.query({ active: true, currentWindow: true })) ?? [];
      const active = tabs[0];
      if (command === COMMAND_QUICK_CLIP) {
        await handleClipPageAction(active, false);
        return;
      }
      if (command === COMMAND_CLIP_SELECTION) {
        await handleSaveHighlightAction(active);
        return;
      }
      if (command === COMMAND_REGION_PICKER) {
        await dispatchUiTriggerToTab(active?.id, "INKADE_START_REGION_PICKER");
        return;
      }
      if (command === COMMAND_TOGGLE_READER) {
        await dispatchUiTriggerToTab(active?.id, "INKADE_TOGGLE_READER");
      }
    })();
  });
}
