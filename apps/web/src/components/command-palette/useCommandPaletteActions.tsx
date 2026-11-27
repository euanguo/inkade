import {
  ACCENT_PRESETS,
  type AccentPreset,
  type AdeThreadBinding,
  type DocumentId,
  type DocumentSummary,
  parseQuickTaskSyntax,
  type Space,
} from "@inkade/core";
import type { useInkadeTranslation } from "@inkade/i18n";
import {
  type CommandPaletteAction,
  type CommandPaletteGroup,
  SpaceIcon,
} from "@inkade/ui";
import { getTodayDailyDate, shiftDailyDate } from "@inkade/views/lib/dates";
import { useAccentPreset, useSurfaceTheme } from "@inkade/views/lib/preferences-store";
import type { ParsedSuperCommandQuery } from "@inkade/views/lib/super-command-parser";
import type { useNavigate } from "@tanstack/react-router";
import {
  CalendarDaysIcon,
  CheckSquareIcon,
  DownloadIcon,
  FilePlus2Icon,
  FileTextIcon,
  FolderKanbanIcon,
  HardDriveIcon,
  InboxIcon,
  KeyboardIcon,
  KeyRoundIcon,
  LayoutTemplateIcon,
  LibraryIcon,
  MessageSquareCodeIcon,
  MoonIcon,
  PaletteIcon,
  PanelRightCloseIcon,
  PanelRightIcon,
  PlugZapIcon,
  ScrollTextIcon,
  SettingsIcon,
  Share2Icon,
  ShieldCheckIcon,
  SparklesIcon,
  SunIcon,
  ZapIcon,
} from "lucide-react";
import { useCallback, useMemo } from "react";
import { useInspector } from "../../hooks/use-inspector.tsx";

export interface UseCommandPaletteActionsOptions {
  readonly t: ReturnType<typeof useInkadeTranslation>["t"];
  readonly navigate: ReturnType<typeof useNavigate>;
  readonly pathname: string;
  readonly effectiveTheme: "light" | "dark";
  readonly onToggleTheme: () => void;
  readonly onNewDocument: () => void;
  readonly onQuickCapture: () => void;
  readonly onOpenAskDrawer: () => void;
  readonly todoQuickAddText: string | null;
  readonly detectedClipUrl: string | null;
  readonly parsedLive: ParsedSuperCommandQuery;
  readonly defaultArticleSpace: Space | null;
  readonly activeSpaces: readonly Space[];
  readonly waitingBindings: readonly AdeThreadBinding[];
  readonly docById: ReadonlyMap<DocumentId, DocumentSummary>;
  readonly searchIsFetching: boolean;
  readonly filteredSearchHitsCount: number;
  readonly filteredRecentDocsCount: number;
  readonly onCreateTodo: (text: string) => void;
  readonly onCreateArticle: (title: string) => void;
  readonly onExportZip: () => Promise<void>;
}

export function useCommandPaletteActions({
  t,
  navigate,
  pathname,
  effectiveTheme,
  onToggleTheme,
  onNewDocument,
  onQuickCapture,
  onOpenAskDrawer,
  todoQuickAddText,
  detectedClipUrl,
  parsedLive,
  defaultArticleSpace,
  activeSpaces,
  waitingBindings,
  docById,
  searchIsFetching,
  filteredSearchHitsCount,
  filteredRecentDocsCount,
  onCreateTodo,
  onCreateArticle,
  onExportZip,
}: UseCommandPaletteActionsOptions) {
  const { toggleOpen: toggleInspector } = useInspector();
  const { surfaceTheme, setSurfaceTheme } = useSurfaceTheme();
  const { accent, setAccent } = useAccentPreset();

  const navigateToSettingsSection = useCallback(
    (section: string) => {
      void navigate({ to: "/settings/$section", params: { section } });
    },
    [navigate],
  );

  const todayDate = getTodayDailyDate();
  const yesterdayDate = shiftDailyDate(todayDate, -1);
  const tomorrowDate = shiftDailyDate(todayDate, 1);

  const parsedTodoSyntax = useMemo(
    () =>
      todoQuickAddText
        ? parseQuickTaskSyntax(todoQuickAddText, new Date(`${todayDate}T12:00:00`))
        : null,
    [todoQuickAddText, todayDate],
  );

  const extraGroups = useMemo<CommandPaletteGroup[]>(() => {
    const result: CommandPaletteGroup[] = [];
    if (parsedLive.waitingOnly && waitingBindings.length > 0) {
      const q = parsedLive.textQuery.toLowerCase();
      const matchingBindings = waitingBindings.filter((b) => {
        if (!q) return true;
        return (
          b.title.toLowerCase().includes(q) ||
          (b.lastSummary?.toLowerCase().includes(q) ?? false)
        );
      });
      if (matchingBindings.length > 0) {
        result.push({
          value: t("command.waitingThreadsGroup"),
          items: matchingBindings.slice(0, 6).map((b) => ({
            id: `waiting:${b.id}`,
            entryType: "action",
            label: b.title,
            action: {
              id: `waiting:${b.id}`,
              label: b.title,
              description: b.lastSummary ?? t("command.waitingThreadStatus"),
              shortcut: t("command.waitingThreadStatus"),
              icon: <MessageSquareCodeIcon className="size-4 text-amber-600 dark:text-amber-400" />,
              alwaysShow: true,
              onSelect: () => {
                const doc = docById.get(b.documentId);
                if (doc?.kind === "outline" && doc.dailyDate) {
                  void navigate({
                    to: "/daily/$date",
                    params: { date: doc.dailyDate },
                    search: b.nodeId ? { nodeId: b.nodeId } : {},
                  });
                } else {
                  void navigate({ to: "/docs/$docId", params: { docId: b.documentId } });
                }
              },
            },
          })),
        });
      }
    }
    return result;
  }, [docById, navigate, parsedLive.textQuery, parsedLive.waitingOnly, t, waitingBindings]);

  const actions = useMemo<CommandPaletteAction[]>(() => {
    const contextualActions: CommandPaletteAction[] = [];

    if (todoQuickAddText) {
      const previewParts: string[] = [];
      if (parsedTodoSyntax?.priority && parsedTodoSyntax.priority !== "none") {
        previewParts.push(parsedTodoSyntax.priority.toUpperCase());
      }
      if (parsedTodoSyntax?.scheduledDate) {
        previewParts.push(parsedTodoSyntax.scheduledDate);
      }
      if (parsedTodoSyntax?.durationMin) {
        previewParts.push(`${parsedTodoSyntax.durationMin}m`);
      }
      if (parsedTodoSyntax?.recurrenceRule) {
        previewParts.push(parsedTodoSyntax.recurrenceRule);
      }
      const baseDesc = t("command.todoQuickAddDesc");
      const composedDesc =
        previewParts.length > 0 ? `${baseDesc} · ${previewParts.join(" · ")}` : baseDesc;

      contextualActions.push({
        id: `add-todo:${todoQuickAddText}`,
        label: t("command.todoQuickAddLabel", {
          title: parsedTodoSyntax?.title || todoQuickAddText,
        }),
        description: composedDesc,
        icon: <CheckSquareIcon className="size-4 text-primary" />,
        alwaysShow: true,
        onSelect: () => onCreateTodo(todoQuickAddText),
      });
    }

    if (detectedClipUrl) {
      contextualActions.push({
        id: `clip-url-inbox:${detectedClipUrl}`,
        label: t("command.clipUrlInboxFallbackLabel"),
        description: t("command.clipUrlInboxFallbackDesc", { url: detectedClipUrl }),
        icon: <InboxIcon className="size-4 text-primary" />,
        alwaysShow: true,
        onSelect: () => {
          void navigate({
            to: "/inbox",
            search: { url: detectedClipUrl },
          });
        },
      });
    }

    if (parsedLive.naturalDate) {
      const targetDate = parsedLive.naturalDate.date;
      contextualActions.push({
        id: `jump-date:${targetDate}`,
        label: t("command.jumpDateLabel", { date: targetDate }),
        description: t("command.jumpDateDesc", { date: targetDate }),
        icon: <CalendarDaysIcon className="size-4 text-amber-600 dark:text-amber-400" />,
        alwaysShow: true,
        onSelect: () => void navigate({ to: "/daily/$date", params: { date: targetDate } }),
      });
    }

    const shouldOfferCreateArticle =
      !todoQuickAddText &&
      parsedLive.textQuery.length > 0 &&
      !detectedClipUrl &&
      !parsedLive.naturalDate &&
      !searchIsFetching &&
      filteredSearchHitsCount === 0 &&
      filteredRecentDocsCount === 0;

    if (shouldOfferCreateArticle) {
      const candidateTitle = parsedLive.textQuery;
      contextualActions.push({
        id: `create-article:${candidateTitle}`,
        label: t("command.createArticleFromQueryLabel", { title: candidateTitle }),
        description: t("command.createArticleFromQueryDesc", {
          space: defaultArticleSpace?.name ?? t("nav.library"),
        }),
        icon: <FileTextIcon className="size-4 text-primary" />,
        alwaysShow: true,
        onSelect: () => onCreateArticle(candidateTitle),
      });
    }

    const surfaceActions: CommandPaletteAction[] = [
      {
        id: "surface-light",
        label: t("command.switchToLightLabel"),
        description: t("command.toggleThemeDesc"),
        icon: <SunIcon className="size-4" />,
        keywords: ["theme", "surface", "light", "bright"],
        onSelect: () => setSurfaceTheme("light"),
      },
      {
        id: "surface-light-dimmed",
        label: t("command.switchToLightDimmedLabel"),
        description: t("command.toggleThemeDesc"),
        icon: <SunIcon className="size-4 opacity-75" />,
        keywords: ["theme", "surface", "dimmed", "light", "soft", "warm"],
        onSelect: () => setSurfaceTheme("light-dimmed"),
      },
      {
        id: "surface-dark",
        label: t("command.switchToDarkLabel"),
        description: t("command.toggleThemeDesc"),
        icon: <MoonIcon className="size-4" />,
        keywords: ["theme", "surface", "dark"],
        onSelect: () => setSurfaceTheme("dark"),
      },
      {
        id: "surface-dark-dimmed",
        label: t("command.switchToDarkDimmedLabel"),
        description: t("command.toggleThemeDesc"),
        icon: <MoonIcon className="size-4 opacity-75" />,
        keywords: ["theme", "surface", "dimmed", "dark", "slate"],
        onSelect: () => setSurfaceTheme("dark-dimmed"),
      },
    ];

    const accentLabelByPreset: Record<AccentPreset, string> = {
      indigo: t("command.accentIndigoLabel"),
      sage: t("command.accentSageLabel"),
      terracotta: t("command.accentTerracottaLabel"),
      mono: t("command.accentMonoLabel"),
    };

    const accentActions: CommandPaletteAction[] = ACCENT_PRESETS.filter(
      (preset) => preset !== accent,
    ).map((preset) => ({
      id: `accent:${preset}`,
      label: accentLabelByPreset[preset],
      description: t("command.accentActionDesc"),
      icon: <PaletteIcon className="size-4" />,
      keywords: ["accent", "color", "theme", preset],
      onSelect: () => setAccent(preset),
    }));

    const dailyConditionalActions: CommandPaletteAction[] = pathname.startsWith("/daily")
      ? [
          {
            id: "toggle-focus-rail",
            label: t("command.toggleFocusRailLabel"),
            description: t("command.toggleFocusRailDesc"),
            shortcut: "⌘⇧B",
            icon: <PanelRightCloseIcon className="size-4" />,
            keywords: ["focus", "rail", "kanban", "daily", "schedule"],
            onSelect: () => {
              window.dispatchEvent(new CustomEvent("inkade:toggle-daily-focus-rail"));
            },
          },
        ]
      : [];

    const baseActions: CommandPaletteAction[] = [
      {
        id: "go-daily",
        label: t("command.goDailyLabel"),
        description: t("command.goDailyDesc"),
        shortcut: "G D",
        icon: <CalendarDaysIcon className="size-4" />,
        keywords: ["daily", "today", "outline"],
        onSelect: () => void navigate({ to: "/daily" }),
      },
      {
        id: "jump-yesterday",
        label: t("command.jumpYesterdayLabel"),
        description: t("command.jumpYesterdayDesc"),
        icon: <CalendarDaysIcon className="size-4" />,
        keywords: ["yesterday", "daily", yesterdayDate],
        onSelect: () => void navigate({ to: "/daily/$date", params: { date: yesterdayDate } }),
      },
      {
        id: "jump-tomorrow",
        label: t("command.jumpTomorrowLabel"),
        description: t("command.jumpTomorrowDesc"),
        icon: <CalendarDaysIcon className="size-4" />,
        keywords: ["tomorrow", "daily", tomorrowDate],
        onSelect: () => void navigate({ to: "/daily/$date", params: { date: tomorrowDate } }),
      },
      ...dailyConditionalActions,
      {
        id: "open-daily-serendipity",
        label: t("command.openSerendipityLabel"),
        description: t("command.openSerendipityDesc"),
        icon: <CalendarDaysIcon className="size-4 text-primary" />,
        keywords: ["serendipity", "review", "random", "notes", "daily"],
        onSelect: () => {
          if (!pathname.startsWith("/daily")) {
            void navigate({ to: "/daily" });
            window.setTimeout(() => {
              window.dispatchEvent(new CustomEvent("inkade:open-daily-serendipity"));
            }, 120);
          } else {
            window.dispatchEvent(new CustomEvent("inkade:open-daily-serendipity"));
          }
        },
      },
      {
        id: "go-inbox",
        label: t("command.goInboxLabel"),
        description: t("command.goInboxDesc"),
        shortcut: "G I",
        icon: <InboxIcon className="size-4" />,
        keywords: ["inbox", "clip"],
        onSelect: () => void navigate({ to: "/inbox" }),
      },
      {
        id: "go-tasks",
        label: t("command.goTasksLabel"),
        description: t("command.goTasksDesc"),
        shortcut: "G K",
        icon: <CheckSquareIcon className="size-4" />,
        keywords: ["tasks", "todo", "overdue"],
        onSelect: () => void navigate({ to: "/tasks" }),
      },
      {
        id: "go-library",
        label: t("command.goLibraryLabel"),
        description: t("command.goLibraryDesc"),
        shortcut: "G L",
        icon: <LibraryIcon className="size-4" />,
        keywords: ["library", "article", "spaces"],
        onSelect: () => void navigate({ to: "/library" }),
      },
      {
        id: "go-graph",
        label: t("graph.shortcutNav"),
        description: t("graph.subtitle"),
        shortcut: "G G",
        icon: <SparklesIcon className="size-4" />,
        keywords: ["graph", "webgl", "links", "knowledge", "图谱"],
        onSelect: () => void navigate({ to: "/graph" }),
      },
      {
        id: "go-threads",
        label: t("command.goThreadsLabel"),
        description: t("command.goThreadsDesc"),
        shortcut: "G T",
        icon: <MessageSquareCodeIcon className="size-4" />,
        keywords: ["threads", "ade", "agent", "mcp", "bindings"],
        onSelect: () => void navigate({ to: "/threads" }),
      },
      {
        id: "open-ask-drawer",
        label: t("command.openAskDrawerLabel"),
        description: t("command.openAskDrawerDesc"),
        shortcut: "⌘⇧J",
        icon: <SparklesIcon className="size-4" />,
        keywords: ["ask", "ai", "rag", "search", "drawer", "question"],
        onSelect: onOpenAskDrawer,
      },
      {
        id: "go-ask",
        label: t("command.goAskLabel"),
        description: t("command.goAskDesc"),
        shortcut: "G A",
        icon: <SparklesIcon className="size-4" />,
        keywords: ["ask", "inkade", "rag", "orama", "citations"],
        onSelect: () => void navigate({ to: "/ask" }),
      },
      {
        id: "go-connect",
        label: t("command.goConnectLabel"),
        description: t("command.goConnectDesc"),
        shortcut: "G C",
        icon: <PlugZapIcon className="size-4" />,
        keywords: ["connect", "mcp", "claude", "cursor", "codex", "opencode", "pack"],
        onSelect: () => void navigate({ to: "/connect" }),
      },
      {
        id: "quick-capture",
        label: t("command.quickCaptureLabel"),
        description: t("command.quickCaptureDesc"),
        shortcut: "C",
        icon: <ZapIcon className="size-4" />,
        keywords: ["capture", "note", "quick"],
        onSelect: onQuickCapture,
      },
      {
        id: "new-article",
        label: t("command.newArticleLabel"),
        description: t("command.newArticleDesc"),
        icon: <FilePlus2Icon className="size-4" />,
        keywords: ["new", "create", "article", "document"],
        onSelect: onNewDocument,
      },
      {
        id: "toggle-inspector",
        label: t("command.toggleInspectorLabel"),
        description: t("command.toggleInspectorDesc"),
        shortcut: "⌘ .",
        icon: <PanelRightIcon className="size-4" />,
        keywords: ["inspector", "backlinks", "revisions"],
        onSelect: toggleInspector,
      },
      {
        id: "toggle-theme",
        label:
          effectiveTheme === "dark"
            ? t("command.switchToLightLabel")
            : t("command.switchToDarkLabel"),
        description: t("command.toggleThemeDesc"),
        icon:
          effectiveTheme === "dark" ? (
            <SunIcon className="size-4" />
          ) : (
            <MoonIcon className="size-4" />
          ),
        keywords: ["theme", "dark", "light", surfaceTheme],
        onSelect: onToggleTheme,
      },
      ...surfaceActions.filter((item) => item.id !== `surface-${surfaceTheme}`),
      ...accentActions,
      {
        id: "go-settings",
        label: t("command.goSettingsLabel"),
        description: t("command.goSettingsDesc"),
        shortcut: "⌘ ,",
        icon: <SettingsIcon className="size-4" />,
        keywords: ["settings", "token", "mcp", "scope", "export", "zip"],
        onSelect: () => void navigate({ to: "/settings" }),
      },
      {
        id: "go-settings-appearance",
        label: t("command.goSettingsAppearanceLabel"),
        description: t("command.goSettingsAppearanceDesc"),
        icon: <PaletteIcon className="size-4" />,
        keywords: ["settings", "appearance", "theme", "accent", "indigo", "sage", "sepia"],
        onSelect: () => navigateToSettingsSection("appearance"),
      },
      {
        id: "go-settings-shortcuts",
        label: t("command.goSettingsShortcutsLabel"),
        description: t("command.goSettingsShortcutsDesc"),
        icon: <KeyboardIcon className="size-4" />,
        keywords: ["settings", "shortcuts", "hover", "peek", "behavior"],
        onSelect: () => navigateToSettingsSection("shortcuts"),
      },
      {
        id: "go-settings-spaces",
        label: t("command.goSettingsSpacesLabel"),
        description: t("command.goSettingsSpacesDesc"),
        icon: <FolderKanbanIcon className="size-4" />,
        keywords: ["settings", "spaces", "icons", "colors"],
        onSelect: () => navigateToSettingsSection("spaces"),
      },
      {
        id: "go-settings-templates",
        label: t("command.goSettingsTemplatesLabel"),
        description: t("command.goSettingsTemplatesDesc"),
        icon: <LayoutTemplateIcon className="size-4" />,
        keywords: ["settings", "templates", "daily", "markdown"],
        onSelect: () => navigateToSettingsSection("templates"),
      },
      {
        id: "go-settings-storage",
        label: t("command.goSettingsStorageLabel"),
        description: t("command.goSettingsStorageDesc"),
        icon: <HardDriveIcon className="size-4" />,
        keywords: ["settings", "storage", "attachments", "media", "tags", "orphan"],
        onSelect: () => navigateToSettingsSection("storage"),
      },
      {
        id: "go-settings-tokens",
        label: t("command.goSettingsTokensLabel"),
        description: t("command.goSettingsTokensDesc"),
        icon: <KeyRoundIcon className="size-4" />,
        keywords: ["settings", "token", "api", "mcp", "bearer"],
        onSelect: () => navigateToSettingsSection("tokens"),
      },
      {
        id: "go-settings-rules",
        label: t("command.goSettingsRulesLabel"),
        description: t("command.goSettingsRulesDesc"),
        icon: <ShieldCheckIcon className="size-4" />,
        keywords: ["settings", "scope", "rules", "project", "matcher"],
        onSelect: () => navigateToSettingsSection("scope-rules"),
      },
      {
        id: "go-settings-audit-logs",
        label: t("command.goSettingsAuditLogsLabel"),
        description: t("command.goSettingsAuditLogsDesc"),
        icon: <ScrollTextIcon className="size-4" />,
        keywords: ["settings", "audit", "logs", "security", "mcp", "allowed", "denied"],
        onSelect: () => navigateToSettingsSection("audit-logs"),
      },
      {
        id: "go-settings-security",
        label: t("settings.sectionSecurityLabel"),
        description: t("settings.sectionSecurityDesc"),
        icon: <ShieldCheckIcon className="size-4" />,
        keywords: ["settings", "security", "sandbox", "artifact", "dual-origin", "csp"],
        onSelect: () => navigateToSettingsSection("security"),
      },
      {
        id: "go-settings-share-links",
        label: t("command.goSettingsShareLinksLabel"),
        description: t("command.goSettingsShareLinksDesc"),
        icon: <Share2Icon className="size-4" />,
        keywords: ["settings", "share", "links", "public", "revoke"],
        onSelect: () => navigateToSettingsSection("share-links"),
      },
      {
        id: "export-zip",
        label: t("command.exportZipLabel"),
        description: t("command.exportZipDesc"),
        icon: <DownloadIcon className="size-4" />,
        keywords: ["export", "zip", "backup", "markdown"],
        onSelect: () => void onExportZip(),
      },
    ];

    const spaceActions: CommandPaletteAction[] = activeSpaces.map((space) => ({
      id: `go-space:${space.id}`,
      label: space.name,
      description: t("nav.spaces"),
      icon: <SpaceIcon color={space.color} icon={space.icon} size="sm" />,
      keywords: ["space", space.slug, space.name],
      onSelect: () => void navigate({ to: "/spaces/$spaceId", params: { spaceId: space.id } }),
    }));

    return [...contextualActions, ...baseActions, ...spaceActions];
  }, [
    accent,
    activeSpaces,
    defaultArticleSpace?.name,
    detectedClipUrl,
    effectiveTheme,
    filteredRecentDocsCount,
    filteredSearchHitsCount,
    navigate,
    navigateToSettingsSection,
    onCreateArticle,
    onCreateTodo,
    onExportZip,
    onNewDocument,
    onOpenAskDrawer,
    onQuickCapture,
    onToggleTheme,
    parsedLive.naturalDate,
    parsedLive.textQuery,
    parsedTodoSyntax,
    pathname,
    searchIsFetching,
    setAccent,
    setSurfaceTheme,
    surfaceTheme,
    t,
    todoQuickAddText,
    toggleInspector,
    tomorrowDate,
    yesterdayDate,
  ]);

  return { extraGroups, actions };
}
