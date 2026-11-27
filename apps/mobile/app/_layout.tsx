import { InkadeI18nProvider, setInkadeLocale, type InkadeLocale, useInkadeTranslation } from "@inkade/i18n";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { StyleSheet } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import {
  createConfiguredInkadeClient,
  mobileQueryClient,
  useOfflineSyncController,
} from "../src/api/client.ts";
import { ToastHost } from "../src/components/ToastHost.tsx";
import { loadCredentials } from "../src/storage/credentials.ts";
import { readKvString } from "../src/storage/kv.ts";
import { loadCachedWhoami, useAppStore } from "../src/store/app-store.ts";
import { InkadeMobileThemeProvider, useMobileTheme } from "../src/theme/ThemeProvider.tsx";

void SplashScreen.preventAutoHideAsync().catch(() => {});

const LOCALE_KV_KEY = "inkade:mobile:locale";

function readStoredLocale(): InkadeLocale | undefined {
  const raw = readKvString(LOCALE_KV_KEY);
  if (raw === "zh-CN" || raw === "en-US") return raw;
  return undefined;
}

function AppRuntimeBootstrap(): React.ReactElement {
  const { t } = useInkadeTranslation();
  const { theme } = useMobileTheme();

  useOfflineSyncController();

  useEffect(() => {
    const savedLocale = readStoredLocale();
    if (savedLocale) {
      setInkadeLocale(savedLocale);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const bootstrap = async () => {
      try {
        const creds = await loadCredentials();
        if (!active) return;
        if (!creds) {
          useAppStore.getState().setConnectionUnconfigured();
          return;
        }
        useAppStore
          .getState()
          .setConnectionConnecting(creds.baseUrl, creds.authMode, creds.token);
        const client = createConfiguredInkadeClient(
          creds.baseUrl,
          creds.authMode,
          creds.token,
        );
        try {
          const whoami = await client.auth.whoami();
          if (!active) return;
          useAppStore.getState().setConnectionReady({
            baseUrl: creds.baseUrl,
            authMode: creds.authMode,
            token: creds.token,
            whoami,
          });
        } catch (error) {
          if (!active) return;
          // Allow entering the thin shell with offline fallback when credentials exist locally.
          const isAuthReject =
            typeof error === "object" &&
            error !== null &&
            "status" in error &&
            ((error as { status: number }).status === 401 ||
              (error as { status: number }).status === 403);
          if (isAuthReject) {
            useAppStore
              .getState()
              .setConnectionError(
                error instanceof Error ? error.message : t("common.unknownError"),
              );
          } else {
            const cachedWhoami = loadCachedWhoami();
            useAppStore.setState({
              connectionStatus: "connected",
              connectionError: null,
              isOnline: false,
              ...(cachedWhoami ? { whoami: cachedWhoami } : {}),
            });
          }
        }
      } finally {
        void SplashScreen.hideAsync().catch(() => {});
      }
    };

    void bootstrap();
    return () => {
      active = false;
    };
  }, [t]);

  return (
    <>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.colors.ground },
          animation: "default",
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="connect" />
        <Stack.Screen name="web" />
        <Stack.Screen name="capture" options={{ presentation: "modal" }} />
        <Stack.Screen name="shell" options={{ presentation: "modal" }} />
      </Stack>
      <ToastHost />
    </>
  );
}

export default function RootLayout(): React.ReactElement {
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <InkadeI18nProvider>
          <InkadeMobileThemeProvider>
            <QueryClientProvider client={mobileQueryClient}>
              <AppRuntimeBootstrap />
            </QueryClientProvider>
          </InkadeMobileThemeProvider>
        </InkadeI18nProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
