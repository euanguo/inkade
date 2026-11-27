import { MOTION_PROFILES, type MotionProfile } from "@inkade/core";
import { useInkadeTranslation, type InkadeTranslationSchema } from "@inkade/i18n";
import { Badge, Input, Kbd, SegmentedControl, SegmentedControlItem, Switch } from "@inkade/ui";
import { useHoverPeekPreference, useMotionProfile } from "@inkade/views/lib/preferences-store";
import { SearchIcon } from "lucide-react";
import type React from "react";
import { useMemo, useState } from "react";
import { SettingRow, SettingsGroup, SettingsSectionHeader } from "./SettingRow.tsx";
import type { SettingsTranslationKey } from "./types.ts";

type ShortcutLabelKey =
  | SettingsTranslationKey
  | `tabs.${keyof InkadeTranslationSchema["tabs"]}`
  | `graph.${keyof InkadeTranslationSchema["graph"]}`;

interface ShortcutItem {
  readonly id: string;
  readonly category: "navigation" | "outliner" | "editor" | "review";
  readonly labelKey: ShortcutLabelKey;
  readonly keys: readonly string[];
}

const SHORTCUT_CATALOG: readonly ShortcutItem[] = [
  {
    id: "cmd-k",
    category: "navigation",
    labelKey: "settings.shortcutCmdK",
    keys: ["⌘", "K"],
  },
  {
    id: "cmd-dot",
    category: "navigation",
    labelKey: "settings.shortcutCmdDot",
    keys: ["⌘", "."],
  },
  {
    id: "go-daily",
    category: "navigation",
    labelKey: "settings.shortcutGoDaily",
    keys: ["G", "D"],
  },
  {
    id: "go-inbox",
    category: "navigation",
    labelKey: "settings.shortcutGoInbox",
    keys: ["G", "I"],
  },
  {
    id: "go-library",
    category: "navigation",
    labelKey: "settings.shortcutGoLibrary",
    keys: ["G", "L"],
  },
  {
    id: "go-graph",
    category: "navigation",
    labelKey: "graph.shortcutNav",
    keys: ["G", "G"],
  },
  {
    id: "tab-close",
    category: "navigation",
    labelKey: "tabs.shortcutCloseTab",
    keys: ["⌘", "W"],
  },
  {
    id: "tab-reopen",
    category: "navigation",
    labelKey: "tabs.shortcutReopenTab",
    keys: ["⌘", "⇧", "T"],
  },
  {
    id: "tab-switch",
    category: "navigation",
    labelKey: "tabs.shortcutSwitchTab",
    keys: ["⌘", "1–9"],
  },
  {
    id: "split-open",
    category: "navigation",
    labelKey: "tabs.shortcutSplitOpen",
    keys: ["⇧", "⏎"],
  },
  {
    id: "go-threads",
    category: "navigation",
    labelKey: "settings.shortcutGoThreads",
    keys: ["G", "T"],
  },
  {
    id: "esc-settings",
    category: "navigation",
    labelKey: "settings.shortcutEscSettings",
    keys: ["Esc"],
  },
  {
    id: "outline-enter",
    category: "outliner",
    labelKey: "settings.shortcutOutlineEnter",
    keys: ["Enter"],
  },
  {
    id: "outline-tab",
    category: "outliner",
    labelKey: "settings.shortcutOutlineTab",
    keys: ["Tab"],
  },
  {
    id: "outline-shift-tab",
    category: "outliner",
    labelKey: "settings.shortcutOutlineShiftTab",
    keys: ["Shift", "Tab"],
  },
  {
    id: "outline-slash",
    category: "outliner",
    labelKey: "settings.shortcutOutlineSlash",
    keys: ["/"],
  },
  {
    id: "outline-wikilink",
    category: "outliner",
    labelKey: "settings.shortcutOutlineWikilink",
    keys: ["[["],
  },
  {
    id: "editor-toggle",
    category: "editor",
    labelKey: "settings.shortcutToggleEdit",
    keys: ["E"],
  },
  {
    id: "editor-save",
    category: "editor",
    labelKey: "settings.shortcutSaveDoc",
    keys: ["⌘", "S"],
  },
  {
    id: "review-next",
    category: "review",
    labelKey: "settings.shortcutReviewNext",
    keys: ["J"],
  },
  {
    id: "review-prev",
    category: "review",
    labelKey: "settings.shortcutReviewPrev",
    keys: ["K"],
  },
  {
    id: "review-accept",
    category: "review",
    labelKey: "settings.shortcutReviewAccept",
    keys: ["Y"],
  },
  {
    id: "review-reject",
    category: "review",
    labelKey: "settings.shortcutReviewReject",
    keys: ["N"],
  },
  {
    id: "review-rollback",
    category: "review",
    labelKey: "settings.shortcutReviewRollback",
    keys: ["Z"],
  },
];

const CATEGORY_ORDER = ["navigation", "outliner", "editor", "review"] as const;

const CATEGORY_TITLE_KEYS: Readonly<
  Record<(typeof CATEGORY_ORDER)[number], SettingsTranslationKey>
> = {
  navigation: "settings.shortcutCatNavigation",
  outliner: "settings.shortcutCatOutliner",
  editor: "settings.shortcutCatEditor",
  review: "settings.shortcutCatReviewCenter",
};

export function ShortcutsSettings(): React.ReactElement {
  const { t } = useInkadeTranslation();
  const { hoverPeek, setHoverPeek } = useHoverPeekPreference();
  const { motionProfile, setMotionProfile } = useMotionProfile();
  const [search, setSearch] = useState("");

  const motionLabels: Readonly<Record<MotionProfile, string>> = {
    comfort: t("settings.motionComfort"),
    "reduced-pulse": t("settings.motionReducedPulse"),
  };

  const filteredByCategory = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matched = SHORTCUT_CATALOG.filter((item) => {
      if (!q) return true;
      const label = t(item.labelKey).toLowerCase();
      const keyStr = item.keys.join(" ").toLowerCase();
      return label.includes(q) || keyStr.includes(q);
    });

    return CATEGORY_ORDER.map((category) => ({
      category,
      items: matched.filter((item) => item.category === category),
    })).filter((group) => group.items.length > 0);
  }, [search, t]);

  return (
    <div className="flex flex-col gap-6">
      <SettingsSectionHeader
        description={t("settings.sectionShortcutsDesc")}
        title={t("settings.sectionShortcutsLabel")}
      />

      <SettingsGroup title={t("settings.motionGroupTitle")}>
        <SettingRow
          badge={
            <Badge size="sm" variant="secondary">
              <span
                aria-hidden="true"
                className="size-1.5 rounded-full bg-emerald-500"
              />
              {motionProfile === "reduced-pulse"
                ? t("settings.motionReducedExplain")
                : t("settings.appearanceSmoothStreamBadge")}
            </Badge>
          }
          description={t("settings.motionProfileSettingDesc")}
          title={t("settings.motionProfileSettingTitle")}
        >
          <SegmentedControl size="sm">
            {MOTION_PROFILES.map((profile) => (
              <SegmentedControlItem
                data-motion-profile-option={profile}
                data-pressed={motionProfile === profile ? "" : undefined}
                key={profile}
                onClick={() => setMotionProfile(profile)}
              >
                {motionLabels[profile]}
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
        </SettingRow>

        <SettingRow
          description={t("settings.hoverPeekDesc")}
          title={t("settings.hoverPeekTitle")}
        >
          <Switch
            aria-label={t("settings.hoverPeekTitle")}
            checked={hoverPeek}
            onCheckedChange={setHoverPeek}
          />
        </SettingRow>
      </SettingsGroup>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-0.5">
            <h2 className="text-sm font-semibold text-foreground">
              {t("settings.shortcutsSheetTitle")}
            </h2>
            <p className="text-xs text-muted-foreground">
              {t("settings.shortcutsSheetDesc")}
            </p>
          </div>
          <div className="w-full sm:w-56">
            <Input
              aria-label={t("settings.shortcutsSearchPlaceholder")}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("settings.shortcutsSearchPlaceholder")}
              size="sm"
              startAddon={<SearchIcon />}
              value={search}
            />
          </div>
        </div>

        {filteredByCategory.length === 0 ? (
          <div className="rounded-xl border border-dashed py-8 text-center text-xs text-muted-foreground">
            {t("settings.shortcutsNoResults")}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {filteredByCategory.map(({ category, items }) => (
              <SettingsGroup key={category} title={t(CATEGORY_TITLE_KEYS[category])}>
                {items.map((item) => (
                  <div
                    className="flex items-center justify-between gap-4 px-4 py-2.5 sm:px-5"
                    key={item.id}
                  >
                    <span className="text-sm text-foreground">{t(item.labelKey)}</span>
                    <div className="flex shrink-0 items-center gap-1">
                      {item.keys.map((keycap, index) => (
                        <Kbd key={`${item.id}-${keycap}-${index}`}>{keycap}</Kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </SettingsGroup>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
