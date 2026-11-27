import { useInkadeTranslation } from "@inkade/i18n";
import { inkadeQueryKeys } from "@inkade/sdk";
import { useQuery } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { router, useLocalSearchParams } from "expo-router";
import { LinkIcon, XIcon } from "lucide-react-native";
import React, { useEffect, useMemo, useState } from "react";
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
import {
  isLikelyNetworkError,
  mobileQueryClient,
  queueOfflineMutation,
  useInkadeClient,
} from "../src/api/client.ts";
import { asSpaceId, asWorkspaceId, type SpaceId } from "@inkade/core";
import { getLocalIsoDate } from "../src/lib/dates.ts";
import { triggerOutcomeHaptic, triggerSelectionHaptic } from "../src/lib/haptics.ts";
import { parseCaptureIncomingParams } from "../src/lib/text-format.ts";
import { useAppStore } from "../src/store/app-store.ts";
import { useMobileTheme } from "../src/theme/ThemeProvider.tsx";
import { resolveSpaceColor } from "../src/theme/tokens.ts";

type CaptureTarget = "daily" | "inbox" | "clip";

export default function CaptureModalScreen(): React.ReactElement {
  const { t } = useInkadeTranslation();
  const { theme } = useMobileTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ target?: string; url?: string; text?: string; title?: string }>();
  const client = useInkadeClient();
  const isOnline = useAppStore((s) => s.isOnline);
  const hapticsEnabled = useAppStore((s) => s.hapticsEnabled);
  const showToast = useAppStore((s) => s.showToast);
  const whoami = useAppStore((s) => s.whoami);

  const parsedIncoming = useMemo(
    () =>
      parseCaptureIncomingParams({
        target: typeof params.target === "string" ? params.target : undefined,
        url: typeof params.url === "string" ? params.url : undefined,
        text: typeof params.text === "string" ? params.text : undefined,
        title: typeof params.title === "string" ? params.title : undefined,
      }),
    [params.target, params.url, params.text, params.title],
  );

  const [target, setTarget] = useState<CaptureTarget>(parsedIncoming.target);
  const [content, setContent] = useState(parsedIncoming.content);
  const [url, setUrl] = useState(parsedIncoming.url);
  const [title, setTitle] = useState(parsedIncoming.title);
  const [tagsRaw, setTagsRaw] = useState("");
  const [clipboardUrl, setClipboardUrl] = useState<string | null>(parsedIncoming.detectedUrl);
  const [selectedSpaceId, setSelectedSpaceId] = useState<SpaceId | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setTarget(parsedIncoming.target);
    setContent(parsedIncoming.content);
    setUrl(parsedIncoming.url);
    setTitle(parsedIncoming.title);
    if (parsedIncoming.detectedUrl) {
      setClipboardUrl(parsedIncoming.detectedUrl);
    }
  }, [parsedIncoming]);

  const spacesQuery = useQuery({
    queryKey: inkadeQueryKeys.spaces(false),
    queryFn: () => client!.spaces.list({ includeArchived: false }),
    enabled: Boolean(client),
  });

  const visibleSpaces = useMemo(() => {
    const raw = spacesQuery.data ?? whoami?.visibleSpaces ?? [];
    return raw.filter((s) => !s.archivedAt);
  }, [spacesQuery.data, whoami?.visibleSpaces]);

  const defaultInboxSpaceId = useMemo(
    () =>
      selectedSpaceId ??
      visibleSpaces.find((s) => s.slug === "inbox")?.id ??
      visibleSpaces[0]?.id,
    [selectedSpaceId, visibleSpaces],
  );

  useEffect(() => {
    if (parsedIncoming.detectedUrl) return;
    void Clipboard.getStringAsync()
      .then((raw) => {
        const clean = raw.trim();
        if (/^https?:\/\/\S+$/i.test(clean)) {
          setClipboardUrl(clean);
        }
      })
      .catch(() => {});
  }, [parsedIncoming.detectedUrl]);

  const parseTags = (raw: string): string[] =>
    raw
      .split(",")
      .map((s) => s.trim().replace(/^#+/, ""))
      .filter(Boolean);

  const handleSubmit = async () => {
    if (submitting) return;
    const cleanContent = content.trim();
    const cleanUrl = url.trim();
    const tags = parseTags(tagsRaw);

    if (target === "clip") {
      if (!/^https?:\/\/\S+$/i.test(cleanUrl)) {
        showToast({ message: t("mobile.capture.emptyError"), tone: "warning" });
        return;
      }
      if (!client || !isOnline) {
        showToast({ message: t("mobile.offline.bannerOffline"), tone: "warning" });
        return;
      }
      setSubmitting(true);
      try {
        const res = await client.clips.ingestUrl({
          url: cleanUrl,
          ...(defaultInboxSpaceId ? { spaceId: defaultInboxSpaceId } : {}),
          ...(title.trim() ? { title: title.trim() } : {}),
          tags,
          mirrorImages: true,
          saveHtmlSnapshot: true,
        });
        await mobileQueryClient.invalidateQueries({ queryKey: ["inkade", "documents"] });
        await mobileQueryClient.invalidateQueries({ queryKey: inkadeQueryKeys.workspaceSummary() });
        useAppStore.getState().bumpWebRefresh();
        void triggerOutcomeHaptic(hapticsEnabled, "success");
        showToast({
          message: t("mobile.capture.clippedUrlToast", {
            title: res.document.title,
            images: res.mirroredImages,
          }),
          tone: "success",
        });
        router.back();
      } catch (error) {
        showToast({
          message: error instanceof Error ? error.message : t("common.unknownError"),
          tone: "error",
        });
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (!cleanContent) {
      showToast({ message: t("mobile.capture.emptyError"), tone: "warning" });
      return;
    }

    setSubmitting(true);
    try {
      if (target === "daily") {
        const today = getLocalIsoDate();
        const tagSuffix = tags.length > 0 ? ` ${tags.map((tg) => `#${tg}`).join(" ")}` : "";
        const body = `${cleanContent}${tagSuffix}`;
        const enqueueDailyCapture = async () => {
          await queueOfflineMutation({
            kind: "daily_append",
            workspaceId: whoami?.workspaceId ?? asWorkspaceId("ws_default"),
            date: today,
            input: {
              contentMarkdown: body,
              checked: null,
              authorType: "human",
            },
          });
          showToast({ message: t("mobile.offline.queuedWriteToast"), tone: "warning" });
        };

        if (client && isOnline) {
          try {
            const daily = await client.documents.getDaily(today);
            await client.outlineNodes.create({
              documentId: daily.document.id,
              parentNodeId: null,
              contentMarkdown: body,
              checked: null,
              authorType: "human",
            });
            await mobileQueryClient.invalidateQueries({
              queryKey: inkadeQueryKeys.dailyOutline(today),
            });
            useAppStore.getState().bumpWebRefresh();
            showToast({ message: t("mobile.capture.savedDailyToast"), tone: "success" });
          } catch (error) {
            if (isLikelyNetworkError(error)) {
              await enqueueDailyCapture();
            } else {
              throw error;
            }
          }
        } else {
          await enqueueDailyCapture();
        }
      } else {
        let targetSpace = defaultInboxSpaceId;
        if (!targetSpace && client && isOnline) {
          const freshSpaces = await client.spaces
            .list({ includeArchived: false })
            .catch(() => []);
          const activeFresh = freshSpaces.filter((s) => !s.archivedAt);
          targetSpace =
            activeFresh.find((s) => s.slug === "inbox")?.id ?? activeFresh[0]?.id;
        }
        const computedTitle =
          title.trim() ||
          cleanContent.split(/\r?\n/)[0]?.slice(0, 80) ||
          t("dialogs.defaultCaptureTitle");
        const enqueueInboxCapture = async () => {
          await queueOfflineMutation({
            kind: "create_document",
            workspaceId: whoami?.workspaceId ?? asWorkspaceId("ws_default"),
            clientTempId: `tmp_${Date.now()}`,
            input: {
              spaceId: targetSpace ?? asSpaceId("spc_inbox"),
              kind: "clip",
              title: computedTitle,
              contentMarkdown: cleanContent,
              tags,
              ...(cleanUrl ? { sourceUrl: cleanUrl } : {}),
            },
          });
          showToast({ message: t("mobile.offline.queuedWriteToast"), tone: "warning" });
        };

        if (client && isOnline && targetSpace) {
          try {
            await client.documents.create({
              spaceId: targetSpace,
              kind: "clip",
              title: computedTitle,
              contentMarkdown: cleanContent,
              tags,
              ...(cleanUrl ? { sourceUrl: cleanUrl } : {}),
            });
            await mobileQueryClient.invalidateQueries({ queryKey: ["inkade", "documents"] });
            await mobileQueryClient.invalidateQueries({
              queryKey: inkadeQueryKeys.workspaceSummary(),
            });
            useAppStore.getState().bumpWebRefresh();
            showToast({ message: t("mobile.capture.savedInboxToast"), tone: "success" });
          } catch (error) {
            if (isLikelyNetworkError(error)) {
              await enqueueInboxCapture();
            } else {
              throw error;
            }
          }
        } else if (client && isOnline && !targetSpace) {
          showToast({ message: t("scope.noSpaces"), tone: "error" });
          setSubmitting(false);
          return;
        } else {
          await enqueueInboxCapture();
        }
      }
      void triggerOutcomeHaptic(hapticsEnabled, "success");
      router.back();
    } catch (error) {
      showToast({
        message: error instanceof Error ? error.message : t("common.unknownError"),
        tone: "error",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: theme.colors.ground }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
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
          <Text style={[styles.title, { color: theme.colors.foreground }]}>
            {t("mobile.capture.title")}
          </Text>
          <Text style={[styles.subtitle, { color: theme.colors.mutedForeground }]}>
            {t("mobile.capture.subtitle")}
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
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: Math.max(insets.bottom, 20) + 24 },
        ]}
      >
        {clipboardUrl && target !== "clip" ? (
          <Pressable
            onPress={() => {
              setTarget("clip");
              setUrl(clipboardUrl);
            }}
            style={[
              styles.clipDetectCard,
              { backgroundColor: theme.colors.muted, borderColor: theme.colors.border },
            ]}
          >
            <LinkIcon size={16} color={theme.colors.mutedForeground} />
            <View style={styles.clipDetectBody}>
              <Text style={[styles.clipDetectTitle, { color: theme.colors.foreground }]}>
                {t("mobile.capture.clipUrlAction")}
              </Text>
              <Text
                numberOfLines={1}
                style={[styles.clipDetectUrl, { color: theme.colors.mutedForeground }]}
              >
                {clipboardUrl}
              </Text>
            </View>
          </Pressable>
        ) : null}

        <View style={styles.field}>
          <Text style={[styles.label, { color: theme.colors.foreground }]}>
            {t("mobile.capture.targetLabel")}
          </Text>
          <View style={[styles.segmentRow, { backgroundColor: theme.colors.muted }]}>
            {(
              [
                { key: "daily", label: t("mobile.capture.targetDaily") },
                { key: "inbox", label: t("mobile.capture.targetInbox") },
                { key: "clip", label: t("mobile.capture.targetClipUrl") },
              ] as const
            ).map((opt) => {
              const active = target === opt.key;
              return (
                <Pressable
                  key={opt.key}
                  onPress={() => {
                    void triggerSelectionHaptic(hapticsEnabled);
                    setTarget(opt.key);
                  }}
                  style={[
                    styles.targetBtn,
                    active
                      ? {
                          backgroundColor: theme.colors.card,
                          borderColor: theme.colors.border,
                        }
                      : {
                          backgroundColor: "transparent",
                          borderColor: "transparent",
                        },
                  ]}
                >
                  <Text
                    style={[
                      styles.targetText,
                      {
                        color: active ? theme.colors.foreground : theme.colors.mutedForeground,
                      },
                    ]}
                  >
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {target !== "daily" && visibleSpaces.length > 0 ? (
          <View style={styles.field}>
            <Text style={[styles.label, { color: theme.colors.foreground }]}>
              {t("mobile.capture.spaceLabel")}
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.spaceChips}
            >
              {visibleSpaces.map((sp) => {
                const active = sp.id === defaultInboxSpaceId;
                return (
                  <Pressable
                    key={sp.id}
                    onPress={() => setSelectedSpaceId(sp.id)}
                    style={[
                      styles.spaceChip,
                      {
                        backgroundColor: active ? theme.colors.subtle : theme.colors.card,
                        borderColor: active ? theme.colors.input : theme.colors.border,
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.spaceDot,
                        {
                          backgroundColor: resolveSpaceColor(sp.color),
                        },
                      ]}
                    />
                    <Text
                      style={[
                        styles.spaceChipText,
                        { color: theme.colors.foreground },
                      ]}
                    >
                      {sp.name}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        ) : null}

        {target === "clip" ? (
          <View style={styles.field}>
            <Text style={[styles.label, { color: theme.colors.foreground }]}>
              {t("mobile.capture.urlLabel")}
            </Text>
            <TextInput
              value={url}
              onChangeText={setUrl}
              placeholder={t("mobile.capture.urlPlaceholder")}
              placeholderTextColor={theme.colors.mutedForeground}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              style={[
                styles.input,
                {
                  color: theme.colors.foreground,
                  backgroundColor: theme.colors.card,
                  borderColor: theme.colors.input,
                },
              ]}
            />
          </View>
        ) : (
          <View style={styles.field}>
            <Text style={[styles.label, { color: theme.colors.foreground }]}>
              {t("mobile.capture.contentLabel")}
            </Text>
            <TextInput
              value={content}
              onChangeText={setContent}
              placeholder={t("mobile.capture.contentPlaceholder")}
              placeholderTextColor={theme.colors.mutedForeground}
              multiline
              autoFocus={!parsedIncoming.url}
              style={[
                styles.textarea,
                {
                  color: theme.colors.foreground,
                  backgroundColor: theme.colors.card,
                  borderColor: theme.colors.input,
                },
              ]}
            />
          </View>
        )}

        {target !== "daily" ? (
          <View style={styles.field}>
            <Text style={[styles.label, { color: theme.colors.foreground }]}>
              {t("mobile.capture.titleLabel")}
            </Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder={t("mobile.capture.titlePlaceholder")}
              placeholderTextColor={theme.colors.mutedForeground}
              style={[
                styles.input,
                {
                  color: theme.colors.foreground,
                  backgroundColor: theme.colors.card,
                  borderColor: theme.colors.input,
                },
              ]}
            />
          </View>
        ) : null}

        <View style={styles.field}>
          <Text style={[styles.label, { color: theme.colors.foreground }]}>
            {t("mobile.capture.tagsLabel")}
          </Text>
          <TextInput
            value={tagsRaw}
            onChangeText={setTagsRaw}
            placeholder={t("mobile.capture.tagsPlaceholder")}
            placeholderTextColor={theme.colors.mutedForeground}
            autoCapitalize="none"
            style={[
              styles.input,
              {
                color: theme.colors.foreground,
                backgroundColor: theme.colors.card,
                borderColor: theme.colors.input,
              },
            ]}
          />
        </View>

        <Pressable
          disabled={submitting}
          onPress={() => void handleSubmit()}
          style={[
            styles.submitBtn,
            { backgroundColor: theme.colors.primary, opacity: submitting ? 0.8 : 1 },
          ]}
        >
          {submitting ? <ActivityIndicator color={theme.colors.onPrimary} /> : null}
          <Text style={[styles.submitText, { color: theme.colors.onPrimary }]}>
            {submitting ? t("mobile.capture.submittingBtn") : t("mobile.capture.submitBtn")}
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
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
  title: { fontSize: 18, fontWeight: "700" },
  subtitle: { fontSize: 12.5 },
  closeBtn: { padding: 8 },
  scrollContent: { padding: 16, gap: 16 },
  clipDetectCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
  },
  clipDetectBody: { flex: 1, gap: 2 },
  clipDetectTitle: { fontSize: 13.5, fontWeight: "700" },
  clipDetectUrl: { fontSize: 12 },
  field: { gap: 8 },
  label: { fontSize: 13.5, fontWeight: "600" },
  segmentRow: {
    flexDirection: "row",
    borderRadius: 8,
    padding: 3,
    gap: 4,
  },
  targetBtn: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 9,
    paddingHorizontal: 8,
    borderRadius: 6,
    borderWidth: 1,
  },
  targetText: { fontSize: 12.5, fontWeight: "600" },
  spaceChips: { gap: 8 },
  spaceChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
  },
  spaceDot: { width: 6, height: 6, borderRadius: 3 },
  spaceChipText: { fontSize: 13, fontWeight: "500" },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 13,
    paddingVertical: 11,
    fontSize: 15,
  },
  textarea: {
    minHeight: 130,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 13,
    paddingVertical: 12,
    fontSize: 15.5,
    lineHeight: 22,
    textAlignVertical: "top",
  },
  submitBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    minHeight: 48,
    borderRadius: 8,
    marginTop: 4,
  },
  submitText: { fontSize: 15.5, fontWeight: "600" },
});
