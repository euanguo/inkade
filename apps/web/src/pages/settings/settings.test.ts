import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  asApiTokenId,
  asAuditLogId,
  asDocumentId,
  asRevisionId,
  asSpaceId,
  asWorkspaceId,
  autonomyLevelToScopePatch,
  computeLedgerCascade,
  deriveAutonomyPolicy,
  isDarkSurfaceTheme,
  isMotionProfile,
  isReaderFontFamily,
  isReaderMeasure,
  isShellStyle,
  isSurfaceTheme,
  isTypesetPreset,
  resolveEffectiveSurfaceTheme,
  resolveToggledSurfaceTheme,
  type AuditLogRecord,
} from "@inkade/core";
import { computeBucketMeterLayout } from "@inkade/ui";
import { usePreferencesStore, USER_PREFERENCES_STORAGE_KEY } from "@inkade/views";
import { runWithThemeRipple } from "../../lib/theme.ts";
import {
  DEFAULT_SETTINGS_SECTION,
  evaluateScopeRuleMatch,
  filterSettingsSections,
  formatByteSize,
  groupSettingsSections,
  isSettingsSection,
  matchScopeRules,
  resolveSettingsSection,
  SETTINGS_SECTIONS,
} from "./types.ts";

describe("settings/types helpers", () => {
  test("isSettingsSection & resolveSettingsSection validate and normalize section slugs", () => {
    for (const section of SETTINGS_SECTIONS) {
      expect(isSettingsSection(section)).toBe(true);
      expect(resolveSettingsSection(section)).toBe(section);
    }

    expect(resolveSettingsSection("  TOKENS  ")).toBe("tokens");
    expect(resolveSettingsSection("scope-rules")).toBe("scope-rules");
    expect(resolveSettingsSection("rag")).toBe("rag");
    expect(resolveSettingsSection("intelligence")).toBe("rag");
    expect(resolveSettingsSection("sync")).toBe("sync");
    expect(resolveSettingsSection("unknown-slug")).toBe(DEFAULT_SETTINGS_SECTION);
    expect(resolveSettingsSection("")).toBe(DEFAULT_SETTINGS_SECTION);
    expect(resolveSettingsSection(null)).toBe(DEFAULT_SETTINGS_SECTION);
    expect(resolveSettingsSection(undefined)).toBe(DEFAULT_SETTINGS_SECTION);
    expect(isSettingsSection("invalid")).toBe(false);
  });

  test("filterSettingsSections matches by id, keywords, and localized text", () => {
    expect(filterSettingsSections("").length).toBe(SETTINGS_SECTIONS.length);
    expect(filterSettingsSections("   ").length).toBe(SETTINGS_SECTIONS.length);

    const mcpHits = filterSettingsSections("mcp");
    expect(mcpHits.some((item) => item.id === "tokens")).toBe(true);
    expect(mcpHits.some((item) => item.id === "audit-logs")).toBe(true);

    const ragHits = filterSettingsSections("bm25");
    expect(ragHits.map((item) => item.id)).toEqual(["rag"]);

    const syncHits = filterSettingsSections("indexeddb");
    expect(syncHits.map((item) => item.id)).toEqual(["sync"]);

    const zhHits = filterSettingsSections("暖纸");
    expect(zhHits.map((item) => item.id)).toEqual(["appearance"]);

    const customTextHits = filterSettingsSections("自定义描述", (meta) =>
      meta.id === "backup" ? "自定义描述 ZIP" : "",
    );
    expect(customTextHits.map((item) => item.id)).toEqual(["backup"]);

    expect(filterSettingsSections("nonexistent_zzz_query")).toEqual([]);
  });

  test("groupSettingsSections preserves group order and omits empty groups", () => {
    const allGrouped = groupSettingsSections(filterSettingsSections(""));
    expect(allGrouped.map((g) => g.group)).toEqual([
      "personal",
      "workspace",
      "intelligence",
      "agentSecurity",
    ]);
    expect(allGrouped[0]?.items.map((i) => i.id)).toEqual([
      "appearance",
      "shortcuts",
      "account",
    ]);
    expect(allGrouped[1]?.items.map((i) => i.id)).toEqual([
      "spaces",
      "templates",
      "storage",
      "backup",
    ]);
    expect(allGrouped[2]?.items.map((i) => i.id)).toEqual(["rag", "sync"]);
    expect(allGrouped[3]?.items.map((i) => i.id)).toEqual([
      "tokens",
      "scope-rules",
      "audit-logs",
      "security",
      "share-links",
    ]);

    const onlyAudit = groupSettingsSections(filterSettingsSections("audit-logs"));
    expect(onlyAudit.length).toBe(1);
    expect(onlyAudit[0]?.group).toBe("agentSecurity");
  });

  test("evaluateScopeRuleMatch & matchScopeRules evaluate all matchTypes and sort by priority", () => {
    const repoRule = { matchType: "repo_name" as const, pattern: "inkade", priority: 5 };
    const remoteRule = {
      matchType: "git_remote" as const,
      pattern: "github.com/acme/inkade",
      priority: 15,
    };
    const globRule = {
      matchType: "path_glob" as const,
      pattern: "**/projects/inkade/**",
      priority: 25,
    };

    expect(evaluateScopeRuleMatch(repoRule, "Inkade")).toBe(true);
    expect(evaluateScopeRuleMatch(repoRule, "other-repo")).toBe(false);
    expect(evaluateScopeRuleMatch(repoRule, "   ")).toBe(false);

    expect(evaluateScopeRuleMatch(remoteRule, "git@github.com:acme/inkade.git")).toBe(false);
    expect(evaluateScopeRuleMatch(remoteRule, "https://github.com/acme/inkade.git")).toBe(true);

    expect(evaluateScopeRuleMatch(globRule, "/Users/alice/projects/inkade/apps/web")).toBe(true);
    expect(evaluateScopeRuleMatch(globRule, "/Users/alice/other/apps/web")).toBe(false);

    const matched = matchScopeRules(
      [
        { id: "r1", ...repoRule },
        { id: "r2", matchType: "git_remote" as const, pattern: "inkade", priority: 20 },
        { id: "r3", matchType: "path_glob" as const, pattern: "**/inkade/**", priority: 30 },
      ],
      "/Users/alice/work/inkade/README.md",
    );
    expect(matched.map((r) => r.id)).toEqual(["r3", "r2"]);
    expect(matchScopeRules([repoRule], "")).toEqual([]);
  });

  test("formatByteSize formats B, KB, MB, and GB cleanly", () => {
    expect(formatByteSize(0)).toBe("0 B");
    expect(formatByteSize(512)).toBe("512 B");
    expect(formatByteSize(2048)).toBe("2.0 KB");
    expect(formatByteSize(1024 * 1024 * 3.5)).toBe("3.50 MB");
  });
});

describe("theme & V3 appearance helpers", () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;

  function installMockDom(systemIsDark = false) {
    const store = new Map<string, string>();
    const classes = new Set<string>();
    const dataset: Record<string, string | undefined> = {};

    const mockWindow = {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, val: string) => {
          store.set(key, val);
        },
        removeItem: (key: string) => {
          store.delete(key);
        },
      },
      matchMedia: () => ({
        matches: systemIsDark,
        addEventListener: () => {},
        removeEventListener: () => {},
      }),
      dispatchEvent: () => true,
      addEventListener: () => {},
      removeEventListener: () => {},
    };

    const mockDocument = {
      documentElement: {
        dataset,
        classList: {
          add: (cls: string) => {
            classes.add(cls);
          },
          remove: (cls: string) => {
            classes.delete(cls);
          },
          toggle: (cls: string, force?: boolean) => {
            if (force === undefined) {
              if (classes.has(cls)) classes.delete(cls);
              else classes.add(cls);
            } else if (force) {
              classes.add(cls);
            } else {
              classes.delete(cls);
            }
            return classes.has(cls);
          },
          contains: (cls: string) => classes.has(cls),
        },
      },
    };

    Object.defineProperty(globalThis, "window", { value: mockWindow, configurable: true });
    Object.defineProperty(globalThis, "document", { value: mockDocument, configurable: true });

    return { store, classes, dataset };
  }

  beforeEach(() => {
    installMockDom(false);
    usePreferencesStore.getState().resetAllPreferences();
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "window", { value: originalWindow, configurable: true });
    Object.defineProperty(globalThis, "document", { value: originalDocument, configurable: true });
  });

  test("type guards validate ShellStyle, SurfaceTheme, ReaderFont, and ReaderMeasure", () => {
    expect(isShellStyle("inset")).toBe(true);
    expect(isShellStyle("flush")).toBe(true);
    expect(isShellStyle("invalid")).toBe(false);

    expect(isSurfaceTheme("light")).toBe(true);
    expect(isSurfaceTheme("light-dimmed")).toBe(true);
    expect(isSurfaceTheme("dark")).toBe(true);
    expect(isSurfaceTheme("dark-dimmed")).toBe(true);
    expect(isSurfaceTheme("sepia")).toBe(false);

    expect(isDarkSurfaceTheme("light")).toBe(false);
    expect(isDarkSurfaceTheme("light-dimmed")).toBe(false);
    expect(isDarkSurfaceTheme("dark")).toBe(true);
    expect(isDarkSurfaceTheme("dark-dimmed")).toBe(true);

    expect(isReaderFontFamily("sans")).toBe(true);
    expect(isReaderFontFamily("serif")).toBe(true);
    expect(isReaderFontFamily("mono")).toBe(true);

    expect(isReaderMeasure("65ch")).toBe(true);
    expect(isReaderMeasure("72ch")).toBe(true);
    expect(isReaderMeasure("88ch")).toBe(true);
    expect(isReaderMeasure("full")).toBe(true);
    expect(isReaderMeasure("100ch")).toBe(false);
  });

  test("defaults return inset, light, mono, sans, 72ch, and yjs-offline true", () => {
    const state = usePreferencesStore.getState();
    expect(state.shellStyle).toBe("inset");
    expect(state.surfaceTheme).toBe("light");
    expect(state.accentPreset).toBe("mono");
    expect(state.preferences.reader.fontFamily).toBe("sans");
    expect(state.preferences.reader.measure).toBe("72ch");
    expect(state.yjsOfflineEnabled).toBe(true);
  });

  test("setSurfaceTheme synchronizes dark class, themePreference, and dataset.surface under single key", () => {
    const { store, classes, dataset } = installMockDom(false);
    usePreferencesStore.getState().resetAllPreferences();

    usePreferencesStore.getState().setSurfaceTheme("dark-dimmed", { freezeTransitions: false });
    expect(classes.has("dark")).toBe(true);
    expect(dataset["surface"]).toBe("dark-dimmed");
    expect(usePreferencesStore.getState().themePreference).toBe("dark");
    expect(Array.from(store.keys())).toEqual([USER_PREFERENCES_STORAGE_KEY]);

    usePreferencesStore.getState().setSurfaceTheme("light", { freezeTransitions: false });
    expect(classes.has("dark")).toBe(false);
    expect(dataset["surface"]).toBe("light");
    expect(usePreferencesStore.getState().themePreference).toBe("light");
  });

  test("setThemePreference preserves remembered dimmed vs crisp surface variants", () => {
    const { classes, dataset } = installMockDom(false);

    usePreferencesStore.getState().setSurfaceTheme("dark", { freezeTransitions: false });
    usePreferencesStore.getState().setThemePreference("light", { freezeTransitions: false });
    expect(classes.has("dark")).toBe(false);
    expect(dataset["surface"]).toBe("light");

    usePreferencesStore.getState().setThemePreference("dark", { freezeTransitions: false });
    expect(classes.has("dark")).toBe(true);
    expect(dataset["surface"]).toBe("dark");

    expect(
      resolveEffectiveSurfaceTheme("system", "light", {
        preferredDark: "dark-dimmed",
        systemIsDark: true,
      }),
    ).toBe("dark-dimmed");
  });

  test("shell, reader typography, and yjs offline helpers persist under unified store and apply attributes", () => {
    const { store, dataset } = installMockDom(false);
    usePreferencesStore.getState().resetAllPreferences();

    usePreferencesStore.getState().setShellStyle("flush");
    expect(dataset["shell"]).toBe("flush");

    usePreferencesStore.getState().setReaderFont("serif");
    expect(dataset["readerFont"]).toBe("serif");

    usePreferencesStore.getState().setReaderMeasure("88ch");
    expect(dataset["readerMeasure"]).toBe("88ch");

    usePreferencesStore.getState().setYjsOfflineEnabled(false);
    expect(usePreferencesStore.getState().yjsOfflineEnabled).toBe(false);
    expect(Array.from(store.keys())).toEqual([USER_PREFERENCES_STORAGE_KEY]);
  });

  test("typeset preset, motion profile, and ripple theme fallback work cleanly", () => {
    const { classes, dataset } = installMockDom(false);
    usePreferencesStore.getState().resetAllPreferences();

    expect(isTypesetPreset("compact")).toBe(true);
    expect(isTypesetPreset("standard")).toBe(true);
    expect(isTypesetPreset("relaxed")).toBe(true);
    expect(isTypesetPreset("huge")).toBe(false);

    expect(isMotionProfile("comfort")).toBe(true);
    expect(isMotionProfile("reduced-pulse")).toBe(true);
    expect(isMotionProfile("none")).toBe(false);

    expect(usePreferencesStore.getState().typesetPreset).toBe("standard");
    expect(usePreferencesStore.getState().motionProfile).toBe("comfort");

    usePreferencesStore.getState().setTypesetPreset("relaxed");
    expect(dataset["typeset"]).toBe("relaxed");

    usePreferencesStore.getState().setMotionProfile("reduced-pulse");
    expect(dataset["motion"]).toBe("reduced-pulse");

    expect(resolveToggledSurfaceTheme("light")).toBe("dark");
    runWithThemeRipple(
      () => usePreferencesStore.getState().setSurfaceTheme("dark", { freezeTransitions: false }),
      { clientX: 240, clientY: 20 },
    );
    expect(classes.has("dark")).toBe(true);
    expect(dataset["surface"]).toBe("dark");
    expect(resolveToggledSurfaceTheme("dark")).toBe("light");
  });

  test("autonomy policy mapping keeps denyHardDelete locked across all stops", () => {
    const autoPatch = autonomyLevelToScopePatch("auto");
    expect(autoPatch.permission).toBe("write");
    expect(autoPatch.denyHardDelete).toBe(true);

    const draftPatch = autonomyLevelToScopePatch("draft");
    expect(draftPatch.permission).toBe("append");
    expect(draftPatch.denyHardDelete).toBe(true);

    const askPatch = autonomyLevelToScopePatch("ask");
    expect(askPatch.permission).toBe("read");
    expect(askPatch.denyHardDelete).toBe(true);

    const draftPolicy = deriveAutonomyPolicy({
      ...draftPatch,
      spaceIds: [asSpaceId("spc_1")],
      includeDescendants: true,
    });
    expect(draftPolicy.level).toBe("draft");
    expect(draftPolicy.approvalRequiredActions).toEqual([]);
    expect(draftPolicy.lockedActions).toContain("hard_delete");
  });

  test("audit ledger cascade highlights downstream document edits and bucket meter detects high watermark", () => {
    const wsId = asWorkspaceId("ws_1");
    const spcId = asSpaceId("spc_1");
    const docId = asDocumentId("doc_1");
    const aud1 = asAuditLogId("aud_1");
    const aud2 = asAuditLogId("aud_2");
    const entries: AuditLogRecord[] = [
      {
        id: aud1,
        workspaceId: wsId,
        principalKind: "token",
        tokenId: asApiTokenId("tok_bb"),
        tokenName: "BB Agent",
        transport: "mcp",
        action: "outline.batch_mutate",
        resource: "document:doc_1",
        spaceId: spcId,
        documentId: docId,
        decision: "allowed",
        reason: null,
        summary: "First agent edit",
        createdAt: "2026-11-24T10:00:00.000Z",
        beforeRevisionId: asRevisionId("rev_1"),
        afterRevisionId: asRevisionId("rev_2"),
        reversible: true,
      },
      {
        id: aud2,
        workspaceId: wsId,
        principalKind: "token",
        tokenId: asApiTokenId("tok_paseo"),
        tokenName: "Paseo",
        transport: "rest",
        action: "document.update",
        resource: "document:doc_1",
        spaceId: spcId,
        documentId: docId,
        decision: "allowed",
        reason: null,
        summary: "Follow-up edit",
        createdAt: "2026-11-24T10:05:00.000Z",
        beforeRevisionId: asRevisionId("rev_2"),
        afterRevisionId: asRevisionId("rev_3"),
        reversible: true,
      },
    ];

    const cascade = computeLedgerCascade(entries, aud1);
    expect(cascade.reversible).toBe(true);
    expect(cascade.affectedAuditIds).toEqual([aud2]);

    const meter = computeBucketMeterLayout(
      [
        { id: "articles", label: "Articles", value: 600 },
        { id: "outlines", label: "Outlines", value: 280 },
      ],
      { capacity: 1000, highWatermarkRatio: 0.85 },
    );
    expect(meter.usagePercent).toBe(88);
    expect(meter.warningLevel).toBe("warning");
  });
});
