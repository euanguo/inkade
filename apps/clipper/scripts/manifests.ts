export type ClipperBrowserTarget = "chrome" | "firefox";

const ANTI_HOTLINK_HOST_PERMISSIONS = [
  "http://127.0.0.1/*",
  "http://localhost/*",
  "https://mmbiz.qpic.cn/*",
  "https://*.doubanio.com/*",
  "https://cdnfile.sspai.com/*",
  "https://*.zhimg.com/*",
  "https://*.xhscdn.com/*",
  "https://*.hdslb.com/*",
  "https://pbs.twimg.com/*",
] as const;

const COMMON_COMMANDS = {
  _execute_action: {
    suggested_key: {
      default: "Ctrl+Shift+K",
      mac: "Command+Shift+K",
    },
    description: "Open Inkade Web Clipper",
  },
  "quick-clip": {
    suggested_key: {
      default: "Alt+Shift+C",
      mac: "Alt+Shift+C",
    },
    description: "Quick clip active page to Inkade",
  },
  "clip-selection": {
    suggested_key: {
      default: "Alt+Shift+H",
      mac: "Alt+Shift+H",
    },
    description: "Save highlighted text to Inkade",
  },
  "toggle-region-picker": {
    suggested_key: {
      default: "Alt+Shift+S",
      mac: "Alt+Shift+S",
    },
    description: "Select a webpage region to clip",
  },
  "toggle-reader": {
    description: "Toggle Inkade Reader View",
  },
} as const;

const SHARED_ICONS = {
  "16": "icons/icon-16.png",
  "32": "icons/icon-32.png",
  "48": "icons/icon-48.png",
  "128": "icons/icon-128.png",
} as const;

export function buildManifestForTarget(
  target: ClipperBrowserTarget,
  version: string,
): Record<string, unknown> {
  const base = {
    manifest_version: 3,
    name: "Inkade Web Clipper",
    version,
    description:
      "Flagship web clipper with site adapters, declarative templates, W3C highlight sync, and Inkade ADE workflows.",
    icons: SHARED_ICONS,
    host_permissions: [...ANTI_HOTLINK_HOST_PERMISSIONS],
    optional_host_permissions: ["http://*/*", "https://*/*"],
    action: {
      default_popup: "popup.html",
      default_title: "Inkade Web Clipper",
      default_icon: {
        "16": "icons/icon-16.png",
        "32": "icons/icon-32.png",
      },
    },
    options_ui: {
      page: "options.html",
      open_in_tab: true,
    },
    content_scripts: [
      {
        matches: ["http://*/*", "https://*/*"],
        js: ["content-loader.js"],
        run_at: "document_idle",
      },
    ],
    commands: COMMON_COMMANDS,
  };

  if (target === "chrome") {
    return {
      ...base,
      permissions: [
        "activeTab",
        "storage",
        "contextMenus",
        "scripting",
        "sidePanel",
        "declarativeNetRequestWithHostAccess",
      ],
      side_panel: {
        default_path: "sidepanel.html",
      },
      background: {
        service_worker: "background.js",
        type: "module",
      },
    };
  }

  return {
    ...base,
    permissions: [
      "activeTab",
      "storage",
      "contextMenus",
      "scripting",
      "declarativeNetRequestWithHostAccess",
    ],
    sidebar_action: {
      default_panel: "sidepanel.html",
      default_title: "Inkade Web Clipper",
      default_icon: {
        "16": "icons/icon-16.png",
        "32": "icons/icon-32.png",
      },
    },
    background: {
      scripts: ["background.js"],
      type: "module",
    },
    browser_specific_settings: {
      gecko: {
        id: "clipper@inkade.local",
        strict_min_version: "128.0",
      },
    },
  };
}
