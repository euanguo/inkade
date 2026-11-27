import {
  CONNECT_HOST_KINDS,
  CONNECT_PRESET_TEMPLATES,
  type ConnectHostKind,
  type ConnectPresetId,
  type ContextPack,
  DEFAULT_CONTEXT_PACK_MAX_TOKENS,
  type DocumentId,
  type SpaceId,
  type TokenScope,
  buildHostConnectConfig,
  connectHostToHarnessName,
  formatHostDisplayName,
  slugifyContextPackName,
} from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import { inkadeQueryKeys } from "@inkade/sdk";
import {
  useCreateContextPackMutation,
  useDeleteContextPackMutation,
  useInkadeBridgeSessions,
  useInkadeClient,
  useInkadeConnectStatus,
  useInkadeContextPack,
  useInkadeContextPacks,
  useInkadeDocuments,
  useInkadeSpaces,
  useInkadeWhoami,
  useUpdateContextPackMutation,
} from "@inkade/sdk/react";
import {
  Badge,
  Button,
  CopyButton,
  HoldConfirmButton,
  Input,
  Textarea,
  cn,
} from "@inkade/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ActivityIcon,
  CheckCircle2Icon,
  DownloadIcon,
  LayersIcon,
  PackagePlusIcon,
  PlugZapIcon,
  RadioIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  StethoscopeIcon,
  TerminalSquareIcon,
  WrenchIcon,
} from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { BriefingsPanel } from "@inkade/views";
import { getApiBaseUrl, getStoredBearerToken } from "../lib/api.ts";
import { showErrorToast, showSuccessToast } from "../lib/undo.ts";

/**
 * Renders space-delimited CLI commands so individual flags and filenames never break across lines at hyphens.
 */
function renderCommandTokens(command: string): React.ReactNode {
  return command.split(" ").map((token, idx) => (
    <span className="whitespace-nowrap" key={`${idx}-${token}`}>
      {token}
    </span>
  ));
}

export function ConnectAiPage(): React.ReactElement {
  const { t } = useInkadeTranslation();
  const client = useInkadeClient();
  const queryClient = useQueryClient();

  const whoamiQuery = useInkadeWhoami();
  const spacesQuery = useInkadeSpaces();
  const docsQuery = useInkadeDocuments({ limit: 300 });
  const packsQuery = useInkadeContextPacks();
  const statusQuery = useInkadeConnectStatus();
  const bridgeSessionsQuery = useInkadeBridgeSessions(
    { includeOffline: true },
    { refetchInterval: 10_000 },
  );
  const [downloadingBundle, setDownloadingBundle] = useState(false);

  const spaces = useMemo(
    () => (spacesQuery.data ?? []).filter((s) => !s.archivedAt),
    [spacesQuery.data],
  );
  const docs = useMemo(
    () => (docsQuery.data ?? []).filter((d) => d.trashedAt === null),
    [docsQuery.data],
  );
  const packs = useMemo(() => packsQuery.data ?? [], [packsQuery.data]);
  const isAdmin = (whoamiQuery.data?.scope.permission ?? "admin") === "admin";

  const [selectedPresetId, setSelectedPresetId] = useState<ConnectPresetId>("daily_partner");
  const [presetSpaceIds, setPresetSpaceIds] = useState<readonly SpaceId[]>([]);
  const [issuedSecret, setIssuedSecret] = useState<string>("");
  const [manualToken, setManualToken] = useState<string>("");
  const [selectedHost, setSelectedHost] = useState<ConnectHostKind>("claude_code");
  const [serverAlias, setServerAlias] = useState("inkade");

  const [selectedPackSlug, setSelectedPackSlug] = useState<string | undefined>(undefined);
  const [packEditorOpen, setPackEditorOpen] = useState(false);
  const [editingPack, setEditingPack] = useState<ContextPack | null>(null);
  const [packName, setPackName] = useState("");
  const [packSlug, setPackSlug] = useState("");
  const [packDesc, setPackDesc] = useState("");
  const [packMaxTokens, setPackMaxTokens] = useState(String(DEFAULT_CONTEXT_PACK_MAX_TOKENS));
  const [packRecentDays, setPackRecentDays] = useState("14");
  const [packTagsText, setPackTagsText] = useState("");
  const [packSpaceIds, setPackSpaceIds] = useState<readonly SpaceId[]>([]);
  const [packPinnedDocIds, setPackPinnedDocIds] = useState<readonly DocumentId[]>([]);

  useEffect(() => {
    if (!selectedPackSlug && packs.length > 0) {
      setSelectedPackSlug(packs[0]?.slug);
    } else if (selectedPackSlug && packs.length > 0 && !packs.some((p) => p.slug === selectedPackSlug)) {
      setSelectedPackSlug(packs[0]?.slug);
    }
  }, [packs, selectedPackSlug]);

  const renderedPackQuery = useInkadeContextPack(selectedPackSlug);

  const hostLabelMap: Readonly<Record<ConnectHostKind, string>> = useMemo(
    () => ({
      claude_code: t("connect.hosts.claude_code"),
      cursor: t("connect.hosts.cursor"),
      codex: t("connect.hosts.codex"),
      antigravity: t("connect.hosts.antigravity"),
      copilot: t("connect.hosts.copilot"),
      opencode: t("connect.hosts.opencode"),
      pi: t("connect.hosts.pi"),
      bb_paseo: t("connect.hosts.bb_paseo"),
      http_url: t("connect.hosts.http_url"),
    }),
    [t],
  );

  const presetCopyMap: Readonly<
    Record<
      ConnectPresetId,
      { readonly title: string; readonly desc: string; readonly badge: string }
    >
  > = useMemo(
    () => ({
      daily_partner: {
        title: t("connect.presets.daily_partner.title"),
        desc: t("connect.presets.daily_partner.desc"),
        badge: t("connect.presets.daily_partner.badge"),
      },
      research_assistant: {
        title: t("connect.presets.research_assistant.title"),
        desc: t("connect.presets.research_assistant.desc"),
        badge: t("connect.presets.research_assistant.badge"),
      },
      silent_triage: {
        title: t("connect.presets.silent_triage.title"),
        desc: t("connect.presets.silent_triage.desc"),
        badge: t("connect.presets.silent_triage.badge"),
      },
      readonly_oracle: {
        title: t("connect.presets.readonly_oracle.title"),
        desc: t("connect.presets.readonly_oracle.desc"),
        badge: t("connect.presets.readonly_oracle.badge"),
      },
    }),
    [t],
  );

  const selectedPreset = useMemo(
    () =>
      CONNECT_PRESET_TEMPLATES.find((p) => p.id === selectedPresetId) ??
      CONNECT_PRESET_TEMPLATES[0]!,
    [selectedPresetId],
  );

  const handleSelectPreset = (presetId: ConnectPresetId) => {
    setSelectedPresetId(presetId);
    const tmpl = CONNECT_PRESET_TEMPLATES.find((p) => p.id === presetId);
    if (!tmpl || tmpl.defaultSpaceSlugs === "*") {
      setPresetSpaceIds([]);
      return;
    }
    const matchedIds = spaces
      .filter((s) => tmpl.defaultSpaceSlugs.includes(s.slug))
      .map((s) => s.id);
    setPresetSpaceIds(matchedIds);
  };

  const togglePresetSpace = (spaceId: SpaceId) => {
    setPresetSpaceIds((prev) =>
      prev.includes(spaceId) ? prev.filter((id) => id !== spaceId) : [...prev, spaceId],
    );
  };

  const generateTokenMutation = useMutation({
    mutationFn: async () => {
      const tmpl = selectedPreset;
      const resolvedSpaceIds: "*" | SpaceId[] =
        presetSpaceIds.length > 0
          ? [...presetSpaceIds]
          : tmpl.scopeTemplate.spaceIds === "*"
            ? "*"
            : [...tmpl.scopeTemplate.spaceIds];
      const scope: TokenScope = {
        ...tmpl.scopeTemplate,
        spaceIds: resolvedSpaceIds,
      };
      return client.tokens.create({
        name: `${tmpl.defaultTokenName} (${new Date().toISOString().slice(5, 10)})`,
        scope,
      });
    },
    onSuccess: (created) => {
      setIssuedSecret(created.rawToken);
      setManualToken(created.rawToken);
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.tokens() }),
        queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.connectStatus() }),
      ]);
      showSuccessToast(
        t("connect.tokenGeneratedToast", { name: created.token.name }),
      );
    },
    onError: (err) => showErrorToast(t("connect.tokenGenerateFailedToast"), err),
  });

  const activeTokenValue = (manualToken || issuedSecret).trim();
  const baseUrl = useMemo(() => getApiBaseUrl(), []);
  const snippetText = useMemo(
    () =>
      buildHostConnectConfig({
        host: selectedHost,
        baseUrl,
        token: activeTokenValue,
        serverName: serverAlias,
      }),
    [activeTokenValue, baseUrl, selectedHost, serverAlias],
  );

  const selectedHarnessName = useMemo(
    () => connectHostToHarnessName(selectedHost),
    [selectedHost],
  );
  const buildPluginsCommand = "bun run build:plugins";
  const companionInstallCommand = useMemo(() => {
    const cleanBase = baseUrl.replace(/\/+$/, "");
    const bundlePath =
      selectedHarnessName === "any"
        ? "packages/cli/dist/inkade-bridge.mjs"
        : `dist/ade-plugins/${selectedHarnessName}/skills/inkade/bin/inkade-bridge.mjs`;
    return `node ${bundlePath} mcp --harness ${selectedHarnessName} --url ${cleanBase}`;
  }, [baseUrl, selectedHarnessName]);
  const doctorCommand = useMemo(() => {
    const cleanBase = baseUrl.replace(/\/+$/, "");
    const harnessFlag =
      selectedHarnessName === "any" ? "" : ` --harness ${selectedHarnessName}`;
    return `node packages/cli/dist/inkade-bridge.mjs doctor${harnessFlag} --url ${cleanBase} --json`;
  }, [baseUrl, selectedHarnessName]);
  const isLoopbackOrigin = useMemo(() => {
    if (typeof window === "undefined") return true;
    const host = window.location.hostname.toLowerCase();
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host.endsWith(".localhost")
    );
  }, []);
  const bridgeSessions = useMemo(
    () => bridgeSessionsQuery.data ?? [],
    [bridgeSessionsQuery.data],
  );
  const onlineBridgeCount = useMemo(
    () => bridgeSessions.filter((s) => s.status === "online").length,
    [bridgeSessions],
  );

  const handleDownloadBundle = async () => {
    setDownloadingBundle(true);
    try {
      const cleanBase = baseUrl.replace(/\/+$/, "");
      const bearer = getStoredBearerToken();
      const res = await fetch(`${cleanBase}/api/v1/connect/plugins/archive`, {
        credentials: "include",
        ...(bearer ? { headers: { authorization: `Bearer ${bearer}` } } : {}),
      });
      if (!res.ok) {
        showErrorToast(t("connect.bundleNotBuiltToast"));
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "inkade-ade-plugins.zip";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      showSuccessToast(t("connect.bundleDownloadedToast"));
    } catch (err) {
      showErrorToast(t("connect.bundleNotBuiltToast"), err);
    } finally {
      setDownloadingBundle(false);
    }
  };

  const pingEndpoint = async () => {
    const res = await statusQuery.refetch();
    if (res.data) {
      showSuccessToast(
        t("connect.pingSuccessToast", { tools: res.data.totalTools }),
      );
    } else if (res.error) {
      showErrorToast(t("connect.pingFailedToast"), res.error);
    }
  };

  const openCreatePack = () => {
    setEditingPack(null);
    setPackName("");
    setPackSlug("");
    setPackDesc("");
    setPackMaxTokens(String(DEFAULT_CONTEXT_PACK_MAX_TOKENS));
    setPackRecentDays("14");
    setPackTagsText("");
    setPackSpaceIds([]);
    setPackPinnedDocIds([]);
    setPackEditorOpen(true);
  };

  const openEditPack = (pack: ContextPack) => {
    setEditingPack(pack);
    setPackName(pack.name);
    setPackSlug(pack.slug);
    setPackDesc(pack.description);
    setPackMaxTokens(String(pack.maxTokens));
    setPackRecentDays(pack.rules.recentDays ? String(pack.rules.recentDays) : "");
    setPackTagsText((pack.rules.tags ?? []).join(", "));
    setPackSpaceIds(pack.rules.spaceIds ?? []);
    setPackPinnedDocIds(pack.rules.pinnedDocIds ?? []);
    setPackEditorOpen(true);
  };

  const createPackMutation = useCreateContextPackMutation({
    onSuccess: (created) => {
      setPackEditorOpen(false);
      setSelectedPackSlug(created.slug);
      showSuccessToast(t("connect.packSavedToast"));
    },
    onError: (err) => showErrorToast(t("connect.packSaveFailedToast"), err),
  });

  const updatePackMutation = useUpdateContextPackMutation({
    onSuccess: (updated) => {
      setPackEditorOpen(false);
      setSelectedPackSlug(updated.slug);
      showSuccessToast(t("connect.packSavedToast"));
    },
    onError: (err) => showErrorToast(t("connect.packSaveFailedToast"), err),
  });

  const deletePackMutation = useDeleteContextPackMutation({
    onSuccess: () => {
      showSuccessToast(t("connect.packDeletedToast"));
    },
    onError: (err) => showErrorToast(t("connect.packDeleteFailedToast"), err),
  });

  const handleSavePack = (e: React.FormEvent) => {
    e.preventDefault();
    const budget = Number.parseInt(packMaxTokens, 10);
    const safeBudget = Number.isFinite(budget)
      ? Math.max(500, Math.min(200_000, budget))
      : DEFAULT_CONTEXT_PACK_MAX_TOKENS;
    const recentNum = Number.parseInt(packRecentDays, 10);
    const parsedTags = packTagsText
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const slugVal = (packSlug.trim() || slugifyContextPackName(packName)).trim();

    const rules = {
      ...(packSpaceIds.length > 0 ? { spaceIds: [...packSpaceIds] } : {}),
      ...(packPinnedDocIds.length > 0 ? { pinnedDocIds: [...packPinnedDocIds] } : {}),
      ...(parsedTags.length > 0 ? { tags: parsedTags } : {}),
      recentDays: Number.isFinite(recentNum) && recentNum > 0 ? recentNum : null,
      excludeSystem: true,
    };

    if (editingPack) {
      updatePackMutation.mutate({
        packId: editingPack.id,
        input: {
          name: packName.trim(),
          slug: slugVal,
          description: packDesc.trim(),
          maxTokens: safeBudget,
          rules,
        },
      });
    } else {
      createPackMutation.mutate({
        name: packName.trim(),
        slug: slugVal,
        description: packDesc.trim(),
        maxTokens: safeBudget,
        rules,
      });
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-4 py-3.5 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <PlugZapIcon className="size-4.5 text-primary" />
          <h1 className="font-heading text-lg font-semibold tracking-tight text-foreground sm:text-xl">
            {t("connect.pageTitle")}
          </h1>
        </div>
        <p className="text-xs text-muted-foreground">{t("connect.pageSubtitle")}</p>
        <div className="flex items-start gap-2 rounded-lg border border-primary/25 bg-primary/5 px-3 py-1.5 text-xs text-foreground">
          <ShieldCheckIcon className="mt-0.5 size-3.5 shrink-0 text-primary" />
          <span>{t("connect.quietAutonomyBanner")}</span>
        </div>
      </header>

      {/* Step 1: Preset Scoped Tokens */}
      <section className="flex flex-col gap-2 rounded-xl border bg-card p-3 shadow-[var(--shadow-card)]">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-sm font-semibold text-foreground">{t("connect.step1Title")}</h2>
          <p className="text-xs text-muted-foreground">{t("connect.step1Desc")}</p>
        </div>

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {CONNECT_PRESET_TEMPLATES.map((preset) => {
            const active = selectedPresetId === preset.id;
            return (
              <button
                aria-pressed={active}
                className={cn(
                  "flex cursor-pointer flex-col items-start justify-between gap-1 rounded-lg border p-2 text-left transition-[border-color,background-color,box-shadow] duration-[var(--duration-micro)]",
                  active
                    ? "border-primary bg-primary/10 ring-2 ring-primary/25"
                    : "border-border bg-background hover:bg-muted/60",
                )}
                key={preset.id}
                onClick={() => handleSelectPreset(preset.id)}
                type="button"
              >
                <div className="flex w-full flex-col gap-0.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-foreground">
                      {presetCopyMap[preset.id].title}
                    </span>
                    {active && <CheckCircle2Icon className="size-3.5 shrink-0 text-primary" />}
                  </div>
                  <p className="text-[11px] leading-snug text-foreground/75">
                    {presetCopyMap[preset.id].desc}
                  </p>
                </div>
                <Badge size="sm" variant={active ? "default" : "secondary"}>
                  {presetCopyMap[preset.id].badge}
                </Badge>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">
            {t("connect.presetSpaceFilterLabel")}
          </span>
          <button
            className={cn(
              "cursor-pointer rounded-full border px-2 py-px text-xs transition-colors duration-[var(--duration-micro)]",
              presetSpaceIds.length === 0
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-background text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setPresetSpaceIds([])}
            type="button"
          >
            {t("connect.allSpacesPill")}
          </button>
          {spaces.map((space) => {
            const active = presetSpaceIds.includes(space.id);
            return (
              <button
                className={cn(
                  "cursor-pointer rounded-full border px-2 py-px text-xs transition-colors duration-[var(--duration-micro)]",
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-muted-foreground hover:text-foreground",
                )}
                key={space.id}
                onClick={() => togglePresetSpace(space.id)}
                type="button"
              >
                {space.name}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isAdmin ? (
            <Button
              loading={generateTokenMutation.isPending}
              onClick={() => generateTokenMutation.mutate()}
              size="sm"
            >
              <span>
                {generateTokenMutation.isPending
                  ? t("connect.generatingAction")
                  : t("connect.generatePresetAction")}
              </span>
            </Button>
          ) : (
            <p className="text-xs text-warning-foreground">{t("connect.adminRequiredNote")}</p>
          )}
          <Input
            aria-label={t("connect.manualTokenPlaceholder")}
            className="min-w-60 flex-1"
            onChange={(e) => setManualToken(e.target.value)}
            placeholder={t("connect.manualTokenPlaceholder")}
            size="sm"
            type="password"
            value={manualToken}
          />
        </div>

        {issuedSecret ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-success/40 bg-success/10 px-3 py-1.5 text-xs">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="font-medium text-success-foreground">
                {t("connect.newTokenSecretHint")}
              </span>
              <code className="truncate font-mono text-[11px] text-foreground">{issuedSecret}</code>
            </div>
            <CopyButton
              copiedLabel={t("connect.copiedTokenToast")}
              label={t("connect.copyTokenBtn")}
              showLabel
              size="xs"
              value={issuedSecret}
              variant="outline"
            />
          </div>
        ) : null}
      </section>

      {/* Step 2: Multi-Host Config Snippets */}
      <section className="flex flex-col gap-1.5 rounded-xl border bg-card p-2 shadow-[var(--shadow-card)]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-col gap-0.5">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <TerminalSquareIcon className="size-4 text-muted-foreground" />
              <span>{t("connect.step2Title")}</span>
            </h2>
            <p className="text-xs text-muted-foreground">{t("connect.step2Desc")}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{t("connect.serverNameLabel")}</span>
            <Input
              aria-label={t("connect.serverNameLabel")}
              className="w-32"
              onChange={(e) => setServerAlias(e.target.value)}
              size="sm"
              value={serverAlias}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {CONNECT_HOST_KINDS.map((host) => (
            <button
              className={cn(
                "cursor-pointer rounded-md border px-2.5 py-0.5 text-xs font-medium transition-colors duration-[var(--duration-micro)]",
                selectedHost === host
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-background text-muted-foreground hover:text-foreground",
              )}
              key={host}
              onClick={() => setSelectedHost(host)}
              type="button"
            >
              {hostLabelMap[host]}
            </button>
          ))}
        </div>

        <div className="overflow-hidden rounded-lg border bg-muted/40">
          <div className="flex items-center justify-between gap-2 border-b border-border/60 bg-muted/30 px-3 py-1">
            <span className="font-mono text-[11px] font-medium text-muted-foreground">
              {hostLabelMap[selectedHost]}
            </span>
            <CopyButton
              copiedLabel={t("connect.copiedConfigToast", {
                host: hostLabelMap[selectedHost],
              })}
              label={t("connect.copyConfigBtn")}
              showLabel
              size="xs"
              value={snippetText}
              variant="outline"
            />
          </div>
          <pre className="w-full overflow-x-auto whitespace-pre-wrap break-words px-3 py-1.5 font-mono text-[11px] leading-snug text-foreground">
            {snippetText}
          </pre>
        </div>
      </section>

      {/* Companion Plugin Bundles, Doctor & Live Bridge Sessions */}
      <section className="flex flex-col gap-1.5 rounded-xl border bg-card p-2 shadow-[var(--shadow-card)]">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-col gap-0.5">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <WrenchIcon className="size-4 text-primary" />
              <span>{t("connect.companionTitle")}</span>
            </h2>
            <p className="text-xs text-muted-foreground">{t("connect.companionDesc")}</p>
          </div>
          <Badge size="sm" variant={isLoopbackOrigin ? "success" : "warning"}>
            {isLoopbackOrigin
              ? t("connect.sandboxPostureLoopback")
              : t("connect.sandboxPostureRemote")}
          </Badge>
        </div>

        <div className="grid gap-1.5 lg:grid-cols-2">
          {/* Build & Download Plugin Bundle */}
          <div className="flex flex-col justify-between gap-1 rounded-lg border bg-background p-2">
            <div className="flex flex-col gap-0.5">
              <div className="text-xs font-semibold text-foreground">
                {t("connect.buildPluginsLabel")}
              </div>
              <p className="text-[11px] leading-snug text-muted-foreground">
                {t("connect.buildPluginsDesc")}
              </p>
            </div>
            <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-2.5 py-1">
              <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground">
                {buildPluginsCommand}
              </code>
              <CopyButton
                copiedLabel={t("connect.copiedBuildCmdToast")}
                label={t("connect.copyBuildCmdBtn")}
                showLabel
                size="xs"
                value={buildPluginsCommand}
                variant="outline"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                loading={downloadingBundle}
                onClick={() => void handleDownloadBundle()}
                size="xs"
                type="button"
                variant="outline"
              >
                <DownloadIcon className="size-3.5" />
                <span>
                  {downloadingBundle
                    ? t("connect.downloadingBundleBtn")
                    : t("connect.downloadBundleBtn")}
                </span>
              </Button>
            </div>
          </div>

          {/* Read-only inkade doctor command */}
          <div className="flex flex-col justify-between gap-1 rounded-lg border bg-background p-2">
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <StethoscopeIcon className="size-3.5 text-primary" />
                <span>{t("connect.doctorTitle")}</span>
              </div>
              <p className="text-[11px] leading-snug text-muted-foreground">
                {t("connect.doctorDesc")}
              </p>
            </div>
            <div className="flex items-start gap-2 rounded-md border bg-muted/40 px-2.5 py-1">
              <code className="flex min-w-0 flex-1 flex-wrap gap-x-1.5 font-mono text-[11px] leading-snug text-foreground">
                {renderCommandTokens(doctorCommand)}
              </code>
              <CopyButton
                copiedLabel={t("connect.copiedDoctorCmdToast")}
                label={t("connect.copyDoctorCmdBtn")}
                showLabel
                size="xs"
                value={doctorCommand}
                variant="outline"
              />
            </div>
          </div>
        </div>

        {/* Selected Host Companion Install Command */}
        <div className="flex flex-col gap-1 rounded-lg border bg-background p-2">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-xs font-semibold text-foreground">
              {t("connect.bundleInstallTitle", { host: hostLabelMap[selectedHost] })}
            </span>
            <span className="text-[11px] text-muted-foreground">{t("connect.bundleInstallDesc")}</span>
          </div>
          <div className="flex items-start gap-2 rounded-md border bg-muted/40 px-2.5 py-1">
            <code className="flex min-w-0 flex-1 flex-wrap gap-x-1.5 font-mono text-[11px] leading-snug text-foreground">
              {renderCommandTokens(companionInstallCommand)}
            </code>
            <CopyButton
              copiedLabel={t("connect.copiedInstallCmdToast", {
                host: hostLabelMap[selectedHost],
              })}
              label={t("connect.copyInstallCmdBtn")}
              showLabel
              size="xs"
              value={companionInstallCommand}
              variant="outline"
            />
          </div>
        </div>
      </section>

      {/* Live Bridge Sessions */}
      <section className="mt-4 rounded-xl border bg-card p-3 shadow-[var(--shadow-card)]">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <RadioIcon className="size-3.5 text-primary" />
              <h3 className="text-xs font-semibold text-foreground">
                {t("connect.bridgeSessionsTitle")}
              </h3>
              <Badge size="sm" variant={onlineBridgeCount > 0 ? "success" : "secondary"}>
                {t("connect.bridgeSessionsCount", {
                  online: onlineBridgeCount,
                  total: bridgeSessions.length,
                })}
              </Badge>
            </div>
            <Button
              loading={bridgeSessionsQuery.isFetching}
              onClick={() => void bridgeSessionsQuery.refetch()}
              size="xs"
              type="button"
              variant="outline"
            >
              <RefreshCwIcon
                className={bridgeSessionsQuery.isFetching ? "animate-spin" : undefined}
              />
              <span>{t("connect.refreshSessionsBtn")}</span>
            </Button>
          </div>

          {bridgeSessions.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("connect.bridgeSessionsEmpty")}</p>
          ) : (
            <div className="divide-y rounded-lg border bg-background">
              {bridgeSessions.map((session) => {
                const isOnline = session.status === "online";
                const wakesIdle = session.capabilities.wakesIdle === true;
                const hookDialect =
                  typeof session.capabilities.hookDialect === "string"
                    ? session.capabilities.hookDialect
                    : null;
                const hasWatch = session.capabilities.watch === true;
                return (
                  <div
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-xs"
                    key={session.id}
                  >
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          aria-label={
                            isOnline
                              ? t("connect.bridgeStatusOnline")
                              : t("connect.bridgeStatusOffline")
                          }
                          className={cn(
                            "size-2 shrink-0 rounded-full",
                            isOnline ? "bg-emerald-500" : "bg-muted-foreground/40",
                          )}
                        />
                        <span className="font-semibold text-foreground">
                          {formatHostDisplayName(session.harnessName)}
                        </span>
                        <Badge size="sm" variant={isOnline ? "success" : "secondary"}>
                          {isOnline
                            ? t("connect.bridgeStatusOnline")
                            : t("connect.bridgeStatusOffline")}
                        </Badge>
                        <code className="font-mono text-[11px] text-muted-foreground">
                          {session.externalThreadId}
                        </code>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                        <span className="truncate font-mono">
                          {session.workspacePath ?? t("connect.bridgeNoWorkspace")}
                        </span>
                        <span className="tabular-nums">
                          {t("connect.bridgeLastSeen", {
                            time: new Date(session.lastSeenAt).toLocaleString(),
                          })}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge size="sm" variant={wakesIdle ? "success" : "outline"}>
                        {wakesIdle
                          ? t("connect.bridgeCapWakesIdle")
                          : t("connect.bridgeCapHookOnly")}
                      </Badge>
                      {hookDialect ? (
                        <Badge size="sm" variant="secondary">
                          {t("connect.bridgeCapHookDialect", { dialect: hookDialect })}
                        </Badge>
                      ) : null}
                      {hasWatch ? (
                        <Badge size="sm" variant="outline">
                          {t("connect.bridgeCapWatch")}
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* Step 3: Live Ping & Telemetry */}
      <section className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-[var(--shadow-card)]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ActivityIcon className="size-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">{t("connect.step3Title")}</h2>
            {statusQuery.data?.ok ? (
              <Badge size="sm" variant="success">
                <CheckCircle2Icon className="size-3" />
                {t("connect.statusHealthy")}
              </Badge>
            ) : null}
          </div>
          <Button
            loading={statusQuery.isFetching}
            onClick={() => void pingEndpoint()}
            size="sm"
            variant="outline"
          >
            <RefreshCwIcon className={statusQuery.isFetching ? "animate-spin" : undefined} />
            <span>
              {statusQuery.isFetching ? t("connect.pingingAction") : t("connect.pingAction")}
            </span>
          </Button>
        </div>

        {statusQuery.data ? (
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="rounded-lg border bg-background p-2.5">
              <div className="text-[11px] text-muted-foreground">{t("connect.statEndpoint")}</div>
              <div className="truncate font-mono text-xs font-medium text-foreground">
                {statusQuery.data.mcpEndpoint}
              </div>
            </div>
            <div className="rounded-lg border bg-background p-2.5">
              <div className="text-[11px] text-muted-foreground">{t("connect.statTools")}</div>
              <div className="font-heading text-base font-semibold tabular-nums text-foreground">
                {statusQuery.data.totalTools}
              </div>
            </div>
            <div className="rounded-lg border bg-background p-2.5">
              <div className="text-[11px] text-muted-foreground">{t("connect.statTokens")}</div>
              <div className="font-heading text-base font-semibold tabular-nums text-foreground">
                {statusQuery.data.activeTokensCount}
              </div>
            </div>
            <div className="rounded-lg border bg-background p-2.5">
              <div className="text-[11px] text-muted-foreground">{t("connect.statPacks")}</div>
              <div className="font-heading text-base font-semibold tabular-nums text-foreground">
                {statusQuery.data.contextPacksCount}
              </div>
            </div>
          </div>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <h3 className="text-xs font-medium text-muted-foreground">
            {t("connect.recentCallsTitle")}
          </h3>
          {statusQuery.data && statusQuery.data.recentMcpCalls.length > 0 ? (
            <div className="divide-y rounded-lg border bg-background">
              {statusQuery.data.recentMcpCalls.map((call) => (
                <div
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs"
                  key={call.id}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <Badge
                      size="sm"
                      variant={call.decision === "allowed" ? "success" : "destructive"}
                    >
                      {call.decision}
                    </Badge>
                    <span className="font-mono font-medium text-foreground">{call.action}</span>
                    <span className="truncate text-muted-foreground">{call.resource}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground tabular-nums">
                    {call.tokenName ? <span>{call.tokenName}</span> : null}
                    <span>{new Date(call.createdAt).toLocaleString()}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{t("connect.recentCallsEmpty")}</p>
          )}
        </div>
      </section>

      {/* Step 4: Context Packs */}
      <section className="flex flex-col gap-4 rounded-xl border bg-card p-4 shadow-[var(--shadow-card)]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-col gap-0.5">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <LayersIcon className="size-4 text-primary" />
              <span>{t("connect.packsTitle")}</span>
            </h2>
            <p className="text-xs text-muted-foreground">{t("connect.packsDesc")}</p>
          </div>
          {isAdmin ? (
            <Button onClick={openCreatePack} size="sm" variant="outline">
              <PackagePlusIcon className="size-3.5" />
              <span>{t("connect.newPackBtn")}</span>
            </Button>
          ) : null}
        </div>

        {packEditorOpen ? (
          <form
            className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3.5"
            onSubmit={handleSavePack}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-muted-foreground">
                  {t("connect.packNameLabel")}
                </span>
                <Input
                  aria-label={t("connect.packNameLabel")}
                  onChange={(e) => {
                    const val = e.target.value;
                    setPackName(val);
                    if (!editingPack && !packSlug) {
                      setPackSlug(slugifyContextPackName(val));
                    }
                  }}
                  placeholder={t("connect.packNamePlaceholder")}
                  required
                  size="sm"
                  value={packName}
                />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-muted-foreground">
                  {t("connect.packSlugLabel")}
                </span>
                <Input
                  aria-label={t("connect.packSlugLabel")}
                  onChange={(e) => setPackSlug(e.target.value)}
                  placeholder={t("connect.packSlugPlaceholder")}
                  size="sm"
                  value={packSlug}
                />
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-muted-foreground">
                {t("connect.packDescLabel")}
              </span>
              <Input
                aria-label={t("connect.packDescLabel")}
                onChange={(e) => setPackDesc(e.target.value)}
                placeholder={t("connect.packDescPlaceholder")}
                size="sm"
                value={packDesc}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-muted-foreground">
                  {t("connect.packBudgetLabel")}
                </span>
                <Input
                  aria-label={t("connect.packBudgetLabel")}
                  max={200000}
                  min={500}
                  onChange={(e) => setPackMaxTokens(e.target.value)}
                  size="sm"
                  type="number"
                  value={packMaxTokens}
                />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-muted-foreground">
                  {t("connect.packRecentDaysLabel")}
                </span>
                <Input
                  aria-label={t("connect.packRecentDaysLabel")}
                  max={3650}
                  min={1}
                  onChange={(e) => setPackRecentDays(e.target.value)}
                  size="sm"
                  type="number"
                  value={packRecentDays}
                />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-muted-foreground">
                  {t("connect.packTagsLabel")}
                </span>
                <Input
                  aria-label={t("connect.packTagsLabel")}
                  onChange={(e) => setPackTagsText(e.target.value)}
                  size="sm"
                  value={packTagsText}
                />
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-muted-foreground">
                {t("connect.packSpacesLabel")}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {spaces.map((space) => {
                  const picked = packSpaceIds.includes(space.id);
                  return (
                    <button
                      className={cn(
                        "cursor-pointer rounded-full border px-2.5 py-0.5 text-xs transition-colors duration-[var(--duration-micro)]",
                        picked
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-background text-muted-foreground hover:text-foreground",
                      )}
                      key={space.id}
                      onClick={() =>
                        setPackSpaceIds((prev) =>
                          prev.includes(space.id)
                            ? prev.filter((id) => id !== space.id)
                            : [...prev, space.id],
                        )
                      }
                      type="button"
                    >
                      {space.name}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-muted-foreground">
                {t("connect.packPinnedLabel")}
              </span>
              <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
                {docs.slice(0, 30).map((doc) => {
                  const picked = packPinnedDocIds.includes(doc.id);
                  return (
                    <button
                      className={cn(
                        "max-w-44 cursor-pointer truncate rounded-md border px-2 py-0.5 text-xs transition-colors duration-[var(--duration-micro)]",
                        picked
                          ? "border-foreground bg-foreground text-background"
                          : "border-border bg-background text-muted-foreground hover:text-foreground",
                      )}
                      key={doc.id}
                      onClick={() =>
                        setPackPinnedDocIds((prev) =>
                          prev.includes(doc.id)
                            ? prev.filter((id) => id !== doc.id)
                            : [...prev, doc.id],
                        )
                      }
                      type="button"
                    >
                      <span className="truncate">{doc.title}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <Button onClick={() => setPackEditorOpen(false)} size="sm" type="button" variant="ghost">
                {t("connect.cancelPackBtn")}
              </Button>
              <Button
                disabled={!packName.trim()}
                loading={createPackMutation.isPending || updatePackMutation.isPending}
                size="sm"
                type="submit"
              >
                {t("connect.savePackBtn")}
              </Button>
            </div>
          </form>
        ) : null}

        {packs.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("connect.packEmptyList")}</p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-5">
            <div className="flex flex-col gap-2 lg:col-span-2">
              {packs.map((pack) => {
                const active = selectedPackSlug === pack.slug;
                const uri = `inkade://pack/${pack.slug}`;
                return (
                  <div
                    className={cn(
                      "flex flex-col gap-2 rounded-lg border p-3 transition-colors duration-[var(--duration-micro)]",
                      active ? "border-primary bg-primary/5" : "border-border bg-background",
                    )}
                    key={pack.id}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <button
                        className="min-w-0 flex-1 cursor-pointer text-left"
                        onClick={() => setSelectedPackSlug(pack.slug)}
                        type="button"
                      >
                        <div className="truncate text-xs font-semibold text-foreground">
                          {pack.name}
                        </div>
                        <div className="truncate font-mono text-[11px] text-muted-foreground">
                          {uri}
                        </div>
                      </button>
                      <Badge size="sm" variant="secondary">
                        {String(pack.maxTokens)}
                      </Badge>
                    </div>
                    {pack.description ? (
                      <p className="text-[11px] text-muted-foreground">{pack.description}</p>
                    ) : null}
                    <div className="flex flex-wrap items-center gap-1.5">
                      <CopyButton
                        copiedLabel={t("connect.copiedUriToast", { uri })}
                        label={t("connect.copyUriBtn")}
                        showLabel
                        size="xs"
                        value={uri}
                        variant="outline"
                      />
                      {isAdmin ? (
                        <>
                          <Button
                            onClick={() => openEditPack(pack)}
                            size="xs"
                            type="button"
                            variant="ghost"
                          >
                            {t("connect.editPackBtn")}
                          </Button>
                          <HoldConfirmButton
                            holdingLabel={t("connect.deletePackBtn")}
                            onConfirm={() => deletePackMutation.mutate(pack.id)}
                            size="sm"
                          >
                            {t("connect.deletePackBtn")}
                          </HoldConfirmButton>
                        </>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-col gap-2 rounded-lg border bg-background p-3.5 lg:col-span-3">
              {renderedPackQuery.isFetching ? (
                <p className="text-xs text-muted-foreground">{t("connect.previewLoading")}</p>
              ) : renderedPackQuery.data ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs font-semibold text-foreground">
                      {t("connect.previewHeading", {
                        tokens: renderedPackQuery.data.totalTokens,
                        budget: renderedPackQuery.data.budgetTokens,
                      })}
                    </div>
                    {renderedPackQuery.data.truncated ? (
                      <Badge size="sm" variant="secondary">
                        {t("connect.previewTruncated", {
                          omitted: renderedPackQuery.data.omittedCount,
                        })}
                      </Badge>
                    ) : null}
                  </div>
                  {renderedPackQuery.data.items.length === 0 ? (
                    <p className="text-xs text-muted-foreground">{t("connect.previewEmptyDocs")}</p>
                  ) : (
                    <>
                      <div className="flex flex-wrap gap-1.5">
                        {renderedPackQuery.data.items.map((item) => (
                          <span
                            className="inline-flex items-center gap-1 rounded border bg-muted/40 px-2 py-0.5 text-[11px]"
                            key={item.docId}
                          >
                            <span className="max-w-36 truncate font-medium text-foreground">
                              {item.title}
                            </span>
                            <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                              {item.tokens}
                            </span>
                            {item.pinned ? (
                              <Badge size="sm" variant="default">
                                {t("connect.previewPinnedBadge")}
                              </Badge>
                            ) : null}
                            {item.truncated ? (
                              <Badge size="sm" variant="outline">
                                {t("connect.previewTruncatedDocBadge")}
                              </Badge>
                            ) : null}
                          </span>
                        ))}
                      </div>
                      <Textarea
                        aria-label={t("connect.packsTitle")}
                        className="min-h-56 font-mono text-xs"
                        readOnly
                        value={renderedPackQuery.data.renderedMarkdown}
                      />
                    </>
                  )}
                </>
              ) : null}
            </div>
          </div>
        )}
      </section>

      <BriefingsPanel />
    </div>
  );
}
