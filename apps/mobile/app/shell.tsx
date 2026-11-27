import { useInkadeTranslation } from "@inkade/i18n";
import { router } from "expo-router";
import {
  PlusCircleIcon,
  RefreshCwIcon,
  ServerIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react-native";
import React from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  flushOfflineQueueNow,
  mobileOfflineBackend,
  mobileQueryClient,
} from "../src/api/client.ts";
import { HoldConfirmButton } from "../src/components/HoldConfirmButton.tsx";
import { triggerOutcomeHaptic } from "../src/lib/haptics.ts";
import { clearCredentials } from "../src/storage/credentials.ts";
import { useAppStore } from "../src/store/app-store.ts";
import { useMobileTheme } from "../src/theme/ThemeProvider.tsx";

export default function NativeShellModalScreen(): React.ReactElement {
  const { t } = useInkadeTranslation();
  const { theme } = useMobileTheme();
  const insets = useSafeAreaInsets();

  const baseUrl = useAppStore((s) => s.baseUrl);
  const whoami = useAppStore((s) => s.whoami);
  const isOnline = useAppStore((s) => s.isOnline);
  const pendingMutationCount = useAppStore((s) => s.pendingMutationCount);
  const hapticsEnabled = useAppStore((s) => s.hapticsEnabled);
  const setHapticsEnabled = useAppStore((s) => s.setHapticsEnabled);
  const showToast = useAppStore((s) => s.showToast);

  const handleSwitchServer = async () => {
    await clearCredentials();
    mobileQueryClient.clear();
    useAppStore.getState().clearConnection();
    router.replace("/connect");
  };

  const handleClearCache = async () => {
    await mobileOfflineBackend.clearDocuments();
    await mobileQueryClient.invalidateQueries();
    void triggerOutcomeHaptic(hapticsEnabled, "success");
    showToast({ message: t("mobile.settings.cacheClearedToast"), tone: "success" });
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.ground }]}>
      <View
        style={[
          styles.header,
          {
            paddingTop: Math.max(insets.top, 14),
            backgroundColor: theme.colors.card,
            borderBottomColor: theme.colors.border,
          },
        ]}
      >
        <View style={styles.headerText}>
          <Text style={[styles.headerTitle, { color: theme.colors.foreground }]}>
            {t("mobile.shell.title")}
          </Text>
          <Text style={[styles.headerSubtitle, { color: theme.colors.mutedForeground }]}>
            {t("mobile.shell.subtitle")}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("common.close")}
          onPress={() => router.back()}
          style={styles.closeBtn}
        >
          <XIcon size={20} color={theme.colors.foreground} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: Math.max(insets.bottom, 20) + 24 },
        ]}
      >
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.colors.mutedForeground }]}>
            {t("mobile.settings.connectionSection")}
          </Text>
          <View
            style={[
              styles.card,
              { backgroundColor: theme.colors.card, borderColor: theme.colors.border },
            ]}
          >
            <View style={[styles.row, { borderBottomColor: theme.colors.border }]}>
              <Text style={[styles.rowLabel, { color: theme.colors.mutedForeground }]}>
                {t("mobile.settings.serverUrlLabel")}
              </Text>
              <Text numberOfLines={1} style={[styles.rowValue, { color: theme.colors.foreground }]}>
                {baseUrl ?? t("common.none")}
              </Text>
            </View>
            <View style={[styles.row, { borderBottomColor: theme.colors.border }]}>
              <Text style={[styles.rowLabel, { color: theme.colors.mutedForeground }]}>
                {t("mobile.settings.principalLabel")}
              </Text>
              <Text style={[styles.rowValue, { color: theme.colors.foreground }]}>
                {whoami?.tokenName || whoami?.principalKind || t("common.none")}
              </Text>
            </View>
            <View style={[styles.row, { borderBottomColor: theme.colors.border }]}>
              <Text style={[styles.rowLabel, { color: theme.colors.mutedForeground }]}>
                {t("mobile.settings.permissionLabel")}
              </Text>
              <Text style={[styles.rowValue, { color: theme.colors.foreground }]}>
                {whoami?.scope.permission ?? t("common.none")}
              </Text>
            </View>
            <View style={styles.rowLast}>
              <Text style={[styles.rowLabel, { color: theme.colors.mutedForeground }]}>
                {t("mobile.settings.visibleSpacesLabel")}
              </Text>
              <Text style={[styles.rowValue, { color: theme.colors.foreground }]}>
                {String(whoami?.visibleSpaces.length ?? 0)}
              </Text>
            </View>

            <Pressable
              accessibilityRole="button"
              onPress={() => void handleSwitchServer()}
              style={[
                styles.cardActionBtn,
                {
                  backgroundColor: theme.colors.background,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                },
              ]}
            >
              <ServerIcon size={15} color={theme.colors.foreground} />
              <Text style={[styles.cardActionText, { color: theme.colors.foreground }]}>
                {t("mobile.settings.switchServerBtn")}
              </Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.colors.mutedForeground }]}>
            {t("mobile.settings.syncSection")}
          </Text>
          <View
            style={[
              styles.card,
              { backgroundColor: theme.colors.card, borderColor: theme.colors.border },
            ]}
          >
            <View style={[styles.row, { borderBottomColor: theme.colors.border }]}>
              <Text style={[styles.rowLabel, { color: theme.colors.mutedForeground }]}>
                {t("mobile.settings.networkStatusLabel")}
              </Text>
              <Text
                style={[
                  styles.rowValue,
                  { color: isOnline ? theme.colors.success : theme.colors.warning },
                ]}
              >
                {isOnline
                  ? t("mobile.settings.networkOnline")
                  : t("mobile.settings.networkOffline")}
              </Text>
            </View>
            <View style={styles.rowLast}>
              <Text style={[styles.rowLabel, { color: theme.colors.mutedForeground }]}>
                {t("mobile.settings.pendingMutationsLabel")}
              </Text>
              <Text style={[styles.rowValue, { color: theme.colors.foreground }]}>
                {t("mobile.settings.pendingCount", { count: pendingMutationCount })}
              </Text>
            </View>

            <View style={styles.actionsCol}>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  router.replace({ pathname: "/capture", params: { target: "daily" } });
                }}
                style={[styles.cardActionBtn, { backgroundColor: theme.colors.primary }]}
              >
                <PlusCircleIcon size={15} color={theme.colors.onPrimary} />
                <Text style={[styles.cardActionText, { color: theme.colors.onPrimary }]}>
                  {t("mobile.shell.openQuickCapture")}
                </Text>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                onPress={() => void flushOfflineQueueNow(false)}
                style={[
                  styles.cardActionBtn,
                  {
                    backgroundColor: theme.colors.background,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                  },
                ]}
              >
                <RefreshCwIcon size={15} color={theme.colors.foreground} />
                <Text style={[styles.cardActionText, { color: theme.colors.foreground }]}>
                  {t("mobile.settings.flushQueueBtn")}
                </Text>
              </Pressable>

              <HoldConfirmButton
                label={t("mobile.settings.holdClearCacheBtn")}
                holdingLabel={t("mobile.common.keepHolding")}
                icon={<Trash2Icon size={15} color={theme.colors.destructive} />}
                onConfirm={() => void handleClearCache()}
              />
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.colors.mutedForeground }]}>
            {t("mobile.settings.hapticsSection")}
          </Text>
          <View
            style={[
              styles.card,
              { backgroundColor: theme.colors.card, borderColor: theme.colors.border },
            ]}
          >
            <View style={styles.switchRow}>
              <View style={styles.switchInfo}>
                <Text style={[styles.switchLabel, { color: theme.colors.foreground }]}>
                  {t("mobile.settings.hapticsLabel")}
                </Text>
                <Text style={[styles.switchDesc, { color: theme.colors.mutedForeground }]}>
                  {t("mobile.settings.hapticsDesc")}
                </Text>
              </View>
              <Switch
                value={hapticsEnabled}
                onValueChange={setHapticsEnabled}
                trackColor={{ true: theme.colors.primary, false: theme.colors.input }}
              />
            </View>
            <View style={[styles.archDivider, { borderTopColor: theme.colors.border }]}>
              <Text style={[styles.archTitle, { color: theme.colors.foreground }]}>
                {t("mobile.shell.archTitle")}
              </Text>
              <Text style={[styles.archDesc, { color: theme.colors.mutedForeground }]}>
                {t("mobile.shell.archDesc")}
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerText: { flex: 1, gap: 2 },
  headerTitle: { fontSize: 18.5, fontWeight: "700" },
  headerSubtitle: { fontSize: 12.5 },
  closeBtn: { padding: 8 },
  content: { padding: 16, gap: 20 },
  section: { gap: 8 },
  sectionTitle: { fontSize: 12.5, fontWeight: "600", paddingHorizontal: 4 },
  card: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 14,
    gap: 12,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLast: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  rowLabel: { fontSize: 13.5 },
  rowValue: { fontSize: 13.5, fontWeight: "600", flexShrink: 1, textAlign: "right" },
  actionsCol: { gap: 8 },
  cardActionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    minHeight: 42,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  cardActionText: { fontSize: 13, fontWeight: "600" },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  switchInfo: { flex: 1, gap: 3 },
  switchLabel: { fontSize: 14, fontWeight: "600" },
  switchDesc: { fontSize: 12.5, lineHeight: 17 },
  archDivider: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12, gap: 4 },
  archTitle: { fontSize: 13, fontWeight: "600" },
  archDesc: { fontSize: 12.5, lineHeight: 18 },
});
