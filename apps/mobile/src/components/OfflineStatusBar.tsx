import { useInkadeTranslation } from "@inkade/i18n";
import { CloudOffIcon, RefreshCwIcon } from "lucide-react-native";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useAppStore } from "../store/app-store.ts";
import { useMobileTheme } from "../theme/ThemeProvider.tsx";

export interface OfflineStatusBarProps {
  readonly onSyncNow?: (() => void) | undefined;
}

export function OfflineStatusBar({ onSyncNow }: OfflineStatusBarProps): React.ReactElement | null {
  const { t } = useInkadeTranslation();
  const { theme } = useMobileTheme();
  const isOnline = useAppStore((s) => s.isOnline);
  const isSyncing = useAppStore((s) => s.isSyncingQueue);
  const pendingCount = useAppStore((s) => s.pendingMutationCount);

  if (isOnline && !isSyncing && pendingCount === 0) {
    return null;
  }

  const message = isSyncing
    ? t("mobile.offline.bannerSyncing")
    : !isOnline
      ? pendingCount > 0
        ? t("mobile.offline.bannerOfflineQueued", { count: pendingCount })
        : t("mobile.offline.bannerOffline")
      : t("mobile.offline.bannerQueued", { count: pendingCount });

  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: theme.colors.warningSubtle,
          borderBottomColor: theme.colors.border,
        },
      ]}
    >
      <View style={styles.left}>
        {isOnline ? (
          <RefreshCwIcon size={14} color={theme.colors.warning} />
        ) : (
          <CloudOffIcon size={14} color={theme.colors.warning} />
        )}
        <Text numberOfLines={1} style={[styles.text, { color: theme.colors.foreground }]}>
          {message}
        </Text>
      </View>
      {isOnline && pendingCount > 0 && !isSyncing && onSyncNow ? (
        <Pressable
          accessibilityRole="button"
          onPress={onSyncNow}
          style={[styles.syncBtn, { backgroundColor: theme.colors.card }]}
        >
          <Text style={[styles.syncText, { color: theme.colors.primary }]}>
            {t("mobile.offline.syncNow")}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  left: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  text: {
    flex: 1,
    fontSize: 12.5,
    fontWeight: "500",
  },
  syncBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  syncText: {
    fontSize: 12,
    fontWeight: "600",
  },
});
