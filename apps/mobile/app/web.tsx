import { parseMobileShellWebMessage } from "@inkade/core";
import { useInkadeLocale, useInkadeTranslation } from "@inkade/i18n";
import { router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import {
  PlusCircleIcon,
  RefreshCwIcon,
  SettingsIcon,
  WifiOffIcon,
} from "lucide-react-native";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Keyboard,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import {
  createConfiguredInkadeClient,
  flushOfflineQueueNow,
  mobileQueryClient,
} from "../src/api/client.ts";
import { OfflineStatusBar } from "../src/components/OfflineStatusBar.tsx";
import {
  triggerImpactHaptic,
  triggerOutcomeHaptic,
  triggerSelectionHaptic,
} from "../src/lib/haptics.ts";
import {
  buildWebShellBootstrapScript,
  classifyWebViewNavigation,
  resolveShellRouteUrl,
} from "../src/shell/web-shell-bridge.ts";
import { clearCredentials } from "../src/storage/credentials.ts";
import { useAppStore } from "../src/store/app-store.ts";
import { useMobileTheme } from "../src/theme/ThemeProvider.tsx";

type WebViewInstance = WebView<object>;

interface WebLoadError {
  readonly code?: number | undefined;
  readonly message: string;
}

export default function WebWorkspaceScreen(): React.ReactElement {
  const { t } = useInkadeTranslation();
  const { locale } = useInkadeLocale();
  const { theme, setSurfacePreference, setAccentPreset } = useMobileTheme();
  const insets = useSafeAreaInsets();

  const baseUrl = useAppStore((s) => s.baseUrl);
  const authMode = useAppStore((s) => s.authMode);
  const token = useAppStore((s) => s.token);
  const connectionStatus = useAppStore((s) => s.connectionStatus);
  const isOnline = useAppStore((s) => s.isOnline);
  const hapticsEnabled = useAppStore((s) => s.hapticsEnabled);
  const webSurfaceBg = useAppStore((s) => s.webSurfaceBg);
  const webSurfaceIsDark = useAppStore((s) => s.webSurfaceIsDark);
  const pendingWebPath = useAppStore((s) => s.pendingWebPath);
  const consumePendingWebPath = useAppStore((s) => s.consumePendingWebPath);
  const webRefreshNonce = useAppStore((s) => s.webRefreshNonce);
  const setWebSurfaceTheme = useAppStore((s) => s.setWebSurfaceTheme);

  const webViewRef = useRef<WebViewInstance | null>(null);
  const lastRefreshRef = useRef(webRefreshNonce);

  const [initialPath, setInitialPath] = useState<string>(() => pendingWebPath ?? "/daily");
  const [reloadNonce, setReloadNonce] = useState(0);
  const [webReady, setWebReady] = useState(false);
  const [webError, setWebError] = useState<WebLoadError | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  const effectiveIsDark = webSurfaceIsDark ?? theme.isDark;
  const effectiveBg = webSurfaceBg ?? theme.colors.background;

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(effectiveBg).catch(() => {});
  }, [effectiveBg]);

  useEffect(() => {
    const showSub = Keyboard.addListener("keyboardDidShow", () => setKeyboardVisible(true));
    const hideSub = Keyboard.addListener("keyboardDidHide", () => setKeyboardVisible(false));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (canGoBack && webViewRef.current) {
        webViewRef.current.goBack();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [canGoBack]);

  useEffect(() => {
    if (connectionStatus !== "booting" && !baseUrl) {
      router.replace("/connect");
    }
  }, [baseUrl, connectionStatus]);

  useEffect(() => {
    if (!pendingWebPath) return;
    if (webReady && webViewRef.current) {
      const payload = JSON.stringify({ path: pendingWebPath });
      webViewRef.current.injectJavaScript(
        `window.dispatchEvent(new CustomEvent("inkade:mobile-shell-navigate", { detail: ${payload} })); true;`,
      );
      consumePendingWebPath();
    } else {
      setInitialPath(pendingWebPath);
      consumePendingWebPath();
    }
  }, [pendingWebPath, webReady, consumePendingWebPath]);

  useEffect(() => {
    if (webRefreshNonce === lastRefreshRef.current) return;
    lastRefreshRef.current = webRefreshNonce;
    if (webReady && webViewRef.current) {
      webViewRef.current.injectJavaScript(
        `window.dispatchEvent(new CustomEvent("inkade:mobile-shell-refresh")); true;`,
      );
    }
  }, [webRefreshNonce, webReady]);

  const bootstrapScript = useMemo(
    () =>
      buildWebShellBootstrapScript({
        authMode,
        token,
        platform: Platform.OS,
        locale,
      }),
    [authMode, token, locale],
  );

  const targetUrl = useMemo(
    () => (baseUrl ? resolveShellRouteUrl(baseUrl, initialPath) : null),
    [baseUrl, initialPath],
  );

  const handleWebMessage = async (event: WebViewMessageEvent): Promise<void> => {
    const msg = parseMobileShellWebMessage(event.nativeEvent.data);
    if (!msg) return;

    switch (msg.kind) {
      case "ready":
        setWebError(null);
        setWebReady(true);
        useAppStore.getState().setIsOnline(true);
        return;
      case "server_unreachable":
        setWebReady(false);
        setWebError({ message: msg.message || t("mobile.offline.bannerOffline") });
        useAppStore.getState().setIsOnline(false);
        return;
      case "theme_sync":
        setWebSurfaceTheme(msg.isDark, msg.backgroundColor);
        if (msg.surface) setSurfacePreference(msg.surface);
        if (msg.accent) setAccentPreset(msg.accent);
        return;
      case "open_native_capture":
        void triggerImpactHaptic(hapticsEnabled, "light");
        router.push({
          pathname: "/capture",
          params: {
            ...(msg.target ? { target: msg.target } : {}),
            ...(msg.text ? { text: msg.text } : {}),
            ...(msg.url ? { url: msg.url } : {}),
            ...(msg.title ? { title: msg.title } : {}),
          },
        });
        return;
      case "open_shell_settings":
        void triggerSelectionHaptic(hapticsEnabled);
        router.push("/shell");
        return;
      case "sign_out":
        await clearCredentials();
        mobileQueryClient.clear();
        useAppStore.getState().clearConnection();
        router.replace("/connect");
        return;
      case "open_external_url":
        if (/^https?:\/\//i.test(msg.url)) {
          await Linking.openURL(msg.url).catch(() => {});
        }
        return;
      case "haptic":
        if (msg.style === "selection") {
          void triggerSelectionHaptic(hapticsEnabled);
        } else if (msg.style === "light") {
          void triggerImpactHaptic(hapticsEnabled, "light");
        } else {
          void triggerOutcomeHaptic(hapticsEnabled, msg.style);
        }
        return;
    }
  };

  if (!baseUrl || !targetUrl) {
    return <View style={[styles.container, { backgroundColor: effectiveBg }]} />;
  }

  const handleRetryLoad = async (): Promise<void> => {
    if (retrying || !baseUrl) return;
    setRetrying(true);
    setWebError(null);
    setWebReady(false);
    try {
      const client = createConfiguredInkadeClient(baseUrl, authMode, token);
      const whoami = await client.auth.whoami();
      useAppStore.getState().setConnectionReady({
        baseUrl,
        authMode,
        ...(token ? { token } : {}),
        whoami,
      });
      void flushOfflineQueueNow(true);
      setReloadNonce((n) => n + 1);
    } catch (error) {
      useAppStore.getState().setIsOnline(false);
      setWebError({
        message: error instanceof Error ? error.message : t("mobile.offline.bannerOffline"),
      });
    } finally {
      setRetrying(false);
    }
  };

  const showFallbackOverlay = Boolean(webError) || (!isOnline && !webReady);
  const errorReason = webError
    ? webError.code
      ? String(webError.code)
      : webError.message
    : t("mobile.offline.bannerOffline");

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: effectiveBg,
          paddingTop: insets.top,
          paddingBottom: keyboardVisible && Platform.OS === "android" ? 0 : insets.bottom,
        },
      ]}
    >
      <StatusBar style={effectiveIsDark ? "light" : "dark"} />
      <OfflineStatusBar onSyncNow={() => void flushOfflineQueueNow(false)} />

      <View style={styles.webWrap}>
        <WebView<object>
          key={`${baseUrl}:${reloadNonce}`}
          ref={webViewRef}
          source={{
            uri: targetUrl,
            ...(authMode === "token" && token
              ? { headers: { Authorization: `Bearer ${token}` } }
              : {}),
          }}
          originWhitelist={["*"]}
          style={[styles.webview, { backgroundColor: effectiveBg }]}
          injectedJavaScriptBeforeContentLoaded={bootstrapScript}
          injectedJavaScriptBeforeContentLoadedForMainFrameOnly
          javaScriptEnabled
          domStorageEnabled
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          allowsBackForwardNavigationGestures
          allowsInlineMediaPlayback
          pullToRefreshEnabled
          setSupportMultipleWindows={false}
          startInLoadingState
          onNavigationStateChange={(navState) => {
            setCanGoBack(navState.canGoBack);
          }}
          onShouldStartLoadWithRequest={(req) => {
            const policy = classifyWebViewNavigation(req.url, baseUrl);
            if (policy === "allow_in_webview") return true;
            if (policy === "open_external") {
              void Linking.openURL(req.url).catch(() => {});
            }
            return false;
          }}
          onMessage={(evt) => {
            void handleWebMessage(evt);
          }}
          onError={(evt) => {
            setWebReady(false);
            setWebError({
              message: evt.nativeEvent.description || t("mobile.offline.bannerOffline"),
            });
          }}
          onHttpError={(evt) => {
            if (!webReady && evt.nativeEvent.statusCode >= 400) {
              setWebReady(false);
              setWebError({
                code: evt.nativeEvent.statusCode,
                message: evt.nativeEvent.description || String(evt.nativeEvent.statusCode),
              });
            }
          }}
          renderLoading={() => (
            <View style={[styles.loadingOverlay, { backgroundColor: effectiveBg }]}>
              <ActivityIndicator size="large" color={theme.colors.primary} />
              <Text style={[styles.loadingText, { color: theme.colors.mutedForeground }]}>
                {t("mobile.shell.webLoading")}
              </Text>
            </View>
          )}
        />

        {showFallbackOverlay ? (
          <View style={[styles.fallbackOverlay, { backgroundColor: theme.colors.ground }]}>
            <View
              style={[
                styles.fallbackCard,
                {
                  backgroundColor: theme.colors.card,
                  borderColor: theme.colors.border,
                },
              ]}
            >
              <View style={styles.fallbackHeader}>
                <WifiOffIcon size={20} color={theme.colors.warning} />
                <Text style={[styles.fallbackTitle, { color: theme.colors.foreground }]}>
                  {t("mobile.shell.webUnavailableTitle")}
                </Text>
              </View>

              <Text style={[styles.fallbackDesc, { color: theme.colors.mutedForeground }]}>
                {t("mobile.shell.webUnavailableDesc", { url: baseUrl, reason: errorReason })}
              </Text>

              <Pressable
                accessibilityRole="button"
                onPress={() =>
                  router.push({ pathname: "/capture", params: { target: "daily" } })
                }
                style={[styles.primaryBtn, { backgroundColor: theme.colors.primary }]}
              >
                <PlusCircleIcon size={17} color={theme.colors.onPrimary} />
                <Text style={[styles.primaryBtnText, { color: theme.colors.onPrimary }]}>
                  {t("mobile.shell.openQuickCapture")}
                </Text>
              </Pressable>

              <View style={styles.secondaryRow}>
                <Pressable
                  accessibilityRole="button"
                  disabled={retrying}
                  onPress={() => {
                    void handleRetryLoad();
                  }}
                  style={[
                    styles.secondaryBtn,
                    { backgroundColor: theme.colors.background, borderColor: theme.colors.border },
                  ]}
                >
                  <RefreshCwIcon size={15} color={theme.colors.foreground} />
                  <Text style={[styles.secondaryBtnText, { color: theme.colors.foreground }]}>
                    {t("mobile.shell.retryWeb")}
                  </Text>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push("/shell")}
                  style={[
                    styles.secondaryBtn,
                    { backgroundColor: theme.colors.background, borderColor: theme.colors.border },
                  ]}
                >
                  <SettingsIcon size={15} color={theme.colors.foreground} />
                  <Text style={[styles.secondaryBtnText, { color: theme.colors.foreground }]}>
                    {t("mobile.shell.openShellControls")}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  webWrap: {
    flex: 1,
    position: "relative",
  },
  webview: {
    flex: 1,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  loadingText: {
    fontSize: 13.5,
  },
  fallbackOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  fallbackCard: {
    width: "100%",
    maxWidth: 420,
    borderRadius: 8,
    borderWidth: 1,
    padding: 18,
    gap: 12,
  },
  fallbackHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  fallbackTitle: {
    fontSize: 16.5,
    fontWeight: "700",
    flex: 1,
  },
  fallbackDesc: {
    fontSize: 13.5,
    lineHeight: 20,
  },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    minHeight: 46,
    borderRadius: 8,
    paddingHorizontal: 14,
  },
  primaryBtnText: {
    fontSize: 14.5,
    fontWeight: "600",
  },
  secondaryRow: {
    flexDirection: "row",
    gap: 8,
  },
  secondaryBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    minHeight: 42,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
  },
  secondaryBtnText: {
    fontSize: 13,
    fontWeight: "600",
  },
});
