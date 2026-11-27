import { useInkadeTranslation } from "@inkade/i18n";
import { Redirect } from "expo-router";
import React from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useAppStore } from "../src/store/app-store.ts";
import { useMobileTheme } from "../src/theme/ThemeProvider.tsx";

export default function IndexGateScreen(): React.ReactElement {
  const { t } = useInkadeTranslation();
  const { theme } = useMobileTheme();
  const status = useAppStore((s) => s.connectionStatus);

  if (status === "connected") {
    return <Redirect href="/web" />;
  }

  if (status === "unconfigured" || status === "error") {
    return <Redirect href="/connect" />;
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.ground }]}>
      <ActivityIndicator size="large" color={theme.colors.primary} />
      <Text style={[styles.label, { color: theme.colors.mutedForeground }]}>
        {t("mobile.connect.connectingButton")}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  label: {
    fontSize: 14,
  },
});
