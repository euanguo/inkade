import type { ConfigContext, ExpoConfig } from "expo/config";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "Inkade",
  slug: "inkade",
  version: "0.1.0",
  scheme: "inkade",
  orientation: "default",
  userInterfaceStyle: "automatic",
  icon: "./assets/icon.png",
  ios: {
    bundleIdentifier: "app.inkade.mobile",
    supportsTablet: true,
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: "app.inkade.mobile",
    softwareKeyboardLayoutMode: "resize",
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundImage: "./assets/adaptive-background.png",
      backgroundColor: "#4f46e5",
    },
    intentFilters: [
      {
        action: "VIEW",
        autoVerify: false,
        data: [{ scheme: "inkade" }],
        category: ["BROWSABLE", "DEFAULT"],
      },
      {
        action: "SEND",
        data: [{ mimeType: "text/plain" }],
        category: ["DEFAULT"],
      },
    ],
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    "expo-sqlite",
    "./plugins/with-android-share-intent.js",
    [
      "expo-splash-screen",
      {
        backgroundColor: "#f6f5f1",
        image: "./assets/splash-icon.png",
        imageWidth: 160,
        dark: {
          backgroundColor: "#0e1015",
          image: "./assets/splash-icon.png",
        },
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
});
