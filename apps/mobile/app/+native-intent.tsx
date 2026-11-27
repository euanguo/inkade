import { mapDeepLinkToShellAction } from "../src/shell/web-shell-bridge.ts";
import { useAppStore } from "../src/store/app-store.ts";

/**
 * Normalizes incoming `inkade://` deep links and Android `ACTION_SEND` share intents at the
 * Expo Router boundary before Expo Router attempts URL-to-route matching.
 */
export function redirectSystemPath({
  path,
}: {
  readonly path: string;
  readonly initial: boolean;
}): string {
  const action = mapDeepLinkToShellAction(path);
  if (!action) {
    if (path.trim().toLowerCase().startsWith("inkade://")) {
      return "/web";
    }
    return path;
  }

  switch (action.kind) {
    case "capture": {
      const sp = new URLSearchParams();
      if (action.params.target) sp.set("target", action.params.target);
      if (action.params.url) sp.set("url", action.params.url);
      if (action.params.text) sp.set("text", action.params.text);
      if (action.params.title) sp.set("title", action.params.title);
      const qs = sp.toString();
      return qs ? `/capture?${qs}` : "/capture";
    }
    case "shell":
      return "/shell";
    case "connect":
      return "/connect";
    case "web_path":
      useAppStore.getState().requestWebNavigation(action.path);
      return "/web";
  }
}
