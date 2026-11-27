import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppStore } from "../store/app-store.ts";
import { useMobileTheme } from "../theme/ThemeProvider.tsx";

export function ToastHost(): React.ReactElement | null {
  const { theme } = useMobileTheme();
  const insets = useSafeAreaInsets();
  const toasts = useAppStore((s) => s.toasts);
  const dismissToast = useAppStore((s) => s.dismissToast);

  if (toasts.length === 0) return null;

  const latest = toasts[toasts.length - 1];
  if (!latest) return null;

  const accentColor =
    latest.tone === "success"
      ? theme.colors.success
      : latest.tone === "warning"
        ? theme.colors.warning
        : latest.tone === "error"
          ? theme.colors.destructive
          : theme.colors.primary;

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.wrapper,
        { bottom: Math.max(insets.bottom, 12) + 72 },
      ]}
    >
      <View
        style={[
          styles.toast,
          {
            backgroundColor: theme.colors.popover,
            borderColor: theme.colors.border,
          },
        ]}
      >
        <View style={[styles.statusDot, { backgroundColor: accentColor }]} />
        <Text style={[styles.message, { color: theme.colors.foreground }]}>
          {latest.message}
        </Text>
        {latest.actionLabel && latest.onAction ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              const fn = latest.onAction;
              dismissToast(latest.id);
              void fn?.();
            }}
            style={[styles.actionBtn, { backgroundColor: theme.colors.subtle }]}
          >
            <Text style={[styles.actionText, { color: theme.colors.primary }]}>
              {latest.actionLabel}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: "absolute",
    left: 16,
    right: 16,
    zIndex: 100,
    alignItems: "center",
  },
  toast: {
    width: "100%",
    maxWidth: 460,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 8,
    borderWidth: 1,
    shadowColor: "#000000",
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    flexShrink: 0,
  },
  message: {
    flex: 1,
    fontSize: 13.5,
    fontWeight: "500",
  },
  actionBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  actionText: {
    fontSize: 13,
    fontWeight: "600",
  },
});
