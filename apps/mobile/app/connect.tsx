import { useInkadeTranslation } from "@inkade/i18n";
import { router } from "expo-router";
import { KeyRoundIcon, ServerIcon } from "lucide-react-native";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { createConfiguredInkadeClient, mobileQueryClient } from "../src/api/client.ts";
import { triggerOutcomeHaptic } from "../src/lib/haptics.ts";
import {
  loadCredentials,
  normalizeServerBaseUrl,
  saveCredentials,
  type MobileAuthMode,
} from "../src/storage/credentials.ts";
import { useAppStore } from "../src/store/app-store.ts";
import { useMobileTheme } from "../src/theme/ThemeProvider.tsx";

export default function ConnectScreen(): React.ReactElement {
  const { t } = useInkadeTranslation();
  const { theme } = useMobileTheme();
  const insets = useSafeAreaInsets();
  const connectionError = useAppStore((s) => s.connectionError);
  const hapticsEnabled = useAppStore((s) => s.hapticsEnabled);

  const [serverUrl, setServerUrl] = useState("http://127.0.0.1:3456");
  const [authMode, setAuthMode] = useState<MobileAuthMode>("token");
  const [token, setToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(connectionError);

  useEffect(() => {
    void loadCredentials().then((creds) => {
      if (!creds) return;
      setServerUrl(creds.baseUrl);
      setAuthMode(creds.authMode);
      if (creds.token) setToken(creds.token);
    });
  }, []);

  const handleConnect = async () => {
    const normalized = normalizeServerBaseUrl(serverUrl);
    if (!normalized) {
      setErrorText(t("mobile.connect.invalidUrl"));
      return;
    }
    const cleanToken = token.trim();
    if (authMode === "token" && !cleanToken) {
      setErrorText(t("mobile.connect.missingToken"));
      return;
    }

    setSubmitting(true);
    setErrorText(null);
    try {
      const client = createConfiguredInkadeClient(
        normalized,
        authMode,
        authMode === "token" ? cleanToken : undefined,
      );
      await client.bootstrap.health();
      const whoami = await client.auth.whoami();

      await saveCredentials({
        baseUrl: normalized,
        authMode,
        ...(authMode === "token" ? { token: cleanToken } : {}),
      });
      mobileQueryClient.clear();
      useAppStore.getState().setConnectionReady({
        baseUrl: normalized,
        authMode,
        ...(authMode === "token" ? { token: cleanToken } : {}),
        whoami,
      });
      void triggerOutcomeHaptic(hapticsEnabled, "success");
      useAppStore.getState().showToast({
        message: t("mobile.connect.connectionSuccess", {
          principal: whoami.tokenName || whoami.principalKind,
          spaces: whoami.visibleSpaces.length,
        }),
        tone: "success",
      });
      router.replace("/web");
    } catch (error) {
      void triggerOutcomeHaptic(hapticsEnabled, "error");
      const msg = error instanceof Error ? error.message : t("common.unknownError");
      setErrorText(t("mobile.connect.connectionFailed", { error: msg }));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: theme.colors.ground }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: Math.max(insets.top, 24) + 20,
            paddingBottom: Math.max(insets.bottom, 24) + 24,
          },
        ]}
      >
        <View style={styles.hero}>
          <View style={[styles.brandBadge, { backgroundColor: theme.colors.primary }]}>
            <Text style={[styles.brandBadgeText, { color: theme.colors.onPrimary }]}>
              {t("common.appName")}
            </Text>
          </View>
          <Text style={[styles.title, { color: theme.colors.foreground }]}>
            {t("mobile.connect.title")}
          </Text>
          <Text style={[styles.subtitle, { color: theme.colors.mutedForeground }]}>
            {t("mobile.connect.subtitle")}
          </Text>
        </View>

        <View
          style={[
            styles.card,
            {
              backgroundColor: theme.colors.card,
              borderColor: theme.colors.border,
            },
          ]}
        >
          <View style={styles.field}>
            <View style={styles.labelRow}>
              <ServerIcon size={15} color={theme.colors.mutedForeground} />
              <Text style={[styles.label, { color: theme.colors.foreground }]}>
                {t("mobile.connect.serverUrlLabel")}
              </Text>
            </View>
            <TextInput
              value={serverUrl}
              onChangeText={setServerUrl}
              placeholder={t("mobile.connect.serverUrlPlaceholder")}
              placeholderTextColor={theme.colors.mutedForeground}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              importantForAutofill="noExcludeDescendants"
              textContentType="none"
              keyboardType="url"
              style={[
                styles.input,
                {
                  color: theme.colors.foreground,
                  borderColor: theme.colors.input,
                  backgroundColor: theme.colors.background,
                },
              ]}
            />
            <Text style={[styles.hint, { color: theme.colors.mutedForeground }]}>
              {t("mobile.connect.serverUrlHint")}
            </Text>
          </View>

          <View style={styles.field}>
            <Text style={[styles.label, { color: theme.colors.foreground }]}>
              {t("mobile.connect.authModeLabel")}
            </Text>
            <View style={[styles.segmentWrap, { backgroundColor: theme.colors.muted }]}>
              <Pressable
                accessibilityRole="button"
                onPress={() => setAuthMode("token")}
                style={[
                  styles.segmentBtn,
                  authMode === "token"
                    ? {
                        backgroundColor: theme.colors.card,
                        borderColor: theme.colors.border,
                      }
                    : { borderColor: "transparent" },
                ]}
              >
                <Text
                  style={[
                    styles.segmentText,
                    {
                      color:
                        authMode === "token"
                          ? theme.colors.foreground
                          : theme.colors.mutedForeground,
                    },
                  ]}
                >
                  {t("mobile.connect.modeScopedToken")}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => setAuthMode("local-auto")}
                style={[
                  styles.segmentBtn,
                  authMode === "local-auto"
                    ? {
                        backgroundColor: theme.colors.card,
                        borderColor: theme.colors.border,
                      }
                    : { borderColor: "transparent" },
                ]}
              >
                <Text
                  style={[
                    styles.segmentText,
                    {
                      color:
                        authMode === "local-auto"
                          ? theme.colors.foreground
                          : theme.colors.mutedForeground,
                    },
                  ]}
                >
                  {t("mobile.connect.modeLocalAuto")}
                </Text>
              </Pressable>
            </View>
          </View>

          {authMode === "token" ? (
            <View style={styles.field}>
              <View style={styles.labelRow}>
                <KeyRoundIcon size={15} color={theme.colors.mutedForeground} />
                <Text style={[styles.label, { color: theme.colors.foreground }]}>
                  {t("mobile.connect.tokenLabel")}
                </Text>
              </View>
              <TextInput
                value={token}
                onChangeText={setToken}
                placeholder={t("mobile.connect.tokenPlaceholder")}
                placeholderTextColor={theme.colors.mutedForeground}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="off"
                importantForAutofill="noExcludeDescendants"
                textContentType="none"
                secureTextEntry={Platform.OS === "ios"}
                style={[
                  styles.input,
                  {
                    color: theme.colors.foreground,
                    borderColor: theme.colors.input,
                    backgroundColor: theme.colors.background,
                  },
                ]}
              />
              <Text style={[styles.hint, { color: theme.colors.mutedForeground }]}>
                {t("mobile.connect.tokenHint")}
              </Text>
            </View>
          ) : null}

          {errorText ? (
            <View
              style={[
                styles.errorBox,
                { backgroundColor: theme.colors.destructiveSubtle },
              ]}
            >
              <Text style={[styles.errorText, { color: theme.colors.destructive }]}>
                {errorText}
              </Text>
            </View>
          ) : null}

          <Pressable
            accessibilityRole="button"
            disabled={submitting}
            onPress={() => {
              void handleConnect();
            }}
            style={({ pressed }) => [
              styles.submitBtn,
              {
                backgroundColor: theme.colors.primary,
                opacity: submitting || pressed ? 0.85 : 1,
              },
            ]}
          >
            {submitting ? (
              <ActivityIndicator color={theme.colors.onPrimary} />
            ) : null}
            <Text style={[styles.submitText, { color: theme.colors.onPrimary }]}>
              {submitting
                ? t("mobile.connect.connectingButton")
                : t("mobile.connect.connectButton")}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: {
    paddingHorizontal: 20,
    gap: 20,
    maxWidth: 520,
    width: "100%",
    alignSelf: "center",
  },
  hero: {
    gap: 8,
  },
  brandBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  brandBadgeText: {
    fontSize: 12.5,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  title: {
    fontSize: 25,
    fontWeight: "700",
    letterSpacing: -0.4,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
  },
  card: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 18,
    gap: 18,
  },
  field: {
    gap: 8,
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  hint: {
    fontSize: 12.5,
    lineHeight: 18,
  },
  segmentWrap: {
    flexDirection: "row",
    borderRadius: 8,
    padding: 3,
    gap: 4,
  },
  segmentBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 9,
    borderRadius: 6,
    borderWidth: 1,
  },
  segmentText: {
    fontSize: 13,
    fontWeight: "600",
  },
  errorBox: {
    borderRadius: 6,
    padding: 12,
  },
  errorText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "500",
  },
  submitBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    minHeight: 48,
    borderRadius: 8,
    paddingHorizontal: 16,
  },
  submitText: {
    fontSize: 15.5,
    fontWeight: "600",
  },
});
