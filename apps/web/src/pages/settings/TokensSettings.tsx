import {
  type ApiTokenId,
  type ApiTokenRecord,
  type AutonomyLevel,
  autonomyLevelToScopePatch,
  deriveAutonomyPolicy,
  type TokenPermission,
  type TokenScope,
} from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import { inkadeQueryKeys } from "@inkade/sdk";
import {
  useInkadeDocuments,
  useInkadeSpaces,
  useInkadeTokens,
} from "@inkade/sdk/react";
import {
  AutonomyDial,
  Badge,
  Button,
  CopyButton,
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  HoldConfirmButton,
  Input,
  ScopeTreePicker,
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
  Separator,
} from "@inkade/ui";
import { zodResolver } from "@hookform/resolvers/zod";
import { SettingsGroupSkeleton } from "./SettingsSkeletons.tsx";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { KeyRoundIcon, PlusIcon, ScissorsIcon, SlidersHorizontalIcon } from "lucide-react";
import type React from "react";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { getApiBaseUrl, getInkadeClient } from "../../lib/api.ts";
import { buildMcpConfigSnippet } from "@inkade/views/lib/mcp-snippet";
import { showErrorToast, showSuccessToast } from "../../lib/undo.ts";
import {
  DangerZone,
  SettingRow,
  SettingsGroup,
  SettingsSectionHeader,
} from "./SettingRow.tsx";

const DEFAULT_TOKEN_SCOPE: TokenScope = {
  permission: "write",
  spaceIds: "*",
  includeDescendants: true,
  denyHardDelete: true,
};

function toMutableTokenScope(scope: TokenScope) {
  return {
    permission: scope.permission,
    spaceIds: scope.spaceIds === "*" ? ("*" as const) : [...scope.spaceIds],
    includeDescendants: scope.includeDescendants,
    denyHardDelete: scope.denyHardDelete,
    ...(scope.tagAllowlist ? { tagAllowlist: [...scope.tagAllowlist] } : {}),
    ...(scope.allowedKinds ? { allowedKinds: [...scope.allowedKinds] } : {}),
  };
}

export function TokensSettings(): React.ReactElement {
  const { t } = useInkadeTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const spacesQuery = useInkadeSpaces({ includeArchived: true });

  const tokensQuery = useInkadeTokens();

  const docsQuery = useInkadeDocuments({ limit: 300 });

  const spaces = spacesQuery.data ?? [];
  const tokens = useMemo(() => tokensQuery.data ?? [], [tokensQuery.data]);
  const activeTokens = useMemo(
    () => tokens.filter((tok) => tok.revokedAt === null),
    [tokens],
  );

  const availableTags = useMemo(() => {
    const set = new Set<string>();
    for (const d of docsQuery.data ?? []) {
      for (const tag of d.tags) set.add(tag);
    }
    return [...set].sort();
  }, [docsQuery.data]);

  const permissionLabels: Readonly<Record<TokenPermission, string>> = {
    read: t("common.permissionRead"),
    append: t("common.permissionAppend"),
    write: t("common.permissionWrite"),
    admin: t("common.permissionAdmin"),
  };

  const [createTokenOpen, setCreateTokenOpen] = useState(false);
  const [tokenScope, setTokenScope] = useState<TokenScope>(DEFAULT_TOKEN_SCOPE);
  const createTokenSchema = useMemo(
    () =>
      z.object({
        tokenName: z.string().trim().min(1, t("validation.required")),
      }),
    [t],
  );
  type CreateTokenFormValues = z.infer<typeof createTokenSchema>;
  const createTokenForm = useForm<CreateTokenFormValues>({
    resolver: zodResolver(createTokenSchema),
    defaultValues: { tokenName: "" },
  });
  const [revealedToken, setRevealedToken] = useState<{
    readonly rawToken: string;
    readonly name: string;
  } | null>(null);

  const [editingToken, setEditingToken] = useState<ApiTokenRecord | null>(null);
  const [editingTokenScope, setEditingTokenScope] = useState<TokenScope>(DEFAULT_TOKEN_SCOPE);
  const [quickTokenId, setQuickTokenId] = useState<string>("");

  const quickTargetToken = useMemo(
    () => activeTokens.find((tok) => tok.id === quickTokenId) ?? activeTokens[0] ?? null,
    [activeTokens, quickTokenId],
  );
  const createPolicy = useMemo(() => deriveAutonomyPolicy(tokenScope), [tokenScope]);
  const editPolicy = useMemo(
    () => deriveAutonomyPolicy(editingTokenScope),
    [editingTokenScope],
  );
  const quickTargetPolicy = useMemo(
    () => (quickTargetToken ? deriveAutonomyPolicy(quickTargetToken.scope) : null),
    [quickTargetToken],
  );

  const mcpSnippet = useMemo(
    () =>
      revealedToken
        ? buildMcpConfigSnippet({
            baseUrl: getApiBaseUrl() || "http://localhost:3456",
            token: revealedToken.rawToken,
          })
        : "",
    [revealedToken],
  );

  const createTokenMutation = useMutation({
    mutationFn: (values: CreateTokenFormValues) =>
      getInkadeClient().tokens.create({
        name: values.tokenName.trim(),
        scope: toMutableTokenScope(tokenScope),
      }),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.tokens() });
      setCreateTokenOpen(false);
      createTokenForm.reset({ tokenName: "" });
      setTokenScope(DEFAULT_TOKEN_SCOPE);
      setRevealedToken({ rawToken: created.rawToken, name: created.token.name });
    },
    onError: (err) => showErrorToast(t("settings.tokenCreateFailed"), err),
  });

  const handleCreateTokenSubmit = createTokenForm.handleSubmit((values) => {
    createTokenMutation.mutate(values);
  });

  const updateTokenMutation = useMutation({
    mutationFn: (vars: { readonly id: ApiTokenId; readonly scope: TokenScope }) =>
      getInkadeClient().tokens.update(vars.id, { scope: toMutableTokenScope(vars.scope) }),
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.tokens() });
      setEditingToken(null);
      showSuccessToast(t("settings.tokenUpdated"), updated.name);
    },
    onError: (err) => showErrorToast(t("settings.tokenUpdateFailed"), err),
  });

  const revokeTokenMutation = useMutation({
    mutationFn: (id: ApiTokenId) => getInkadeClient().tokens.revoke(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.tokens() });
      showSuccessToast(t("settings.tokenRevoked"));
    },
    onError: (err) => showErrorToast(t("settings.tokenRevokeFailed"), err),
  });

  return (
    <div className="flex flex-col gap-6">
      <SettingsSectionHeader
        actions={
          <Button
            onClick={() => {
              createTokenForm.reset({ tokenName: "" });
              setTokenScope(DEFAULT_TOKEN_SCOPE);
              setCreateTokenOpen(true);
            }}
            size="sm"
          >
            <PlusIcon />
            {t("settings.createToken")}
          </Button>
        }
        description={
          <>
            {t("settings.tokensDescPrefix")}{" "}
            <code className="font-mono">/mcp</code>{" "}
            {t("settings.tokensDescSuffix")}
          </>
        }
        title={t("settings.tokensTitle")}
      />

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
            <ScissorsIcon className="size-4" />
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-sm font-medium text-foreground">
              {t("clipper.extensionTitle")}
            </span>
            <span className="text-xs text-muted-foreground">
              {t("clipper.webPairSettingsHint")}
            </span>
          </div>
        </div>
        <Button
          onClick={() => void navigate({ to: "/clipper/pair" })}
          size="sm"
          variant="outline"
        >
          <ScissorsIcon className="size-3.5" />
          <span>{t("clipper.webPairSettingsCta")}</span>
        </Button>
      </div>

      {quickTargetToken && quickTargetPolicy ? (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="space-y-0.5">
              <h2 className="text-sm font-semibold text-foreground">
                {t("settings.tokensAutonomySectionTitle")}
              </h2>
              <p className="text-xs text-muted-foreground">
                {t("settings.tokensAutonomySectionDesc")}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
                {t("settings.tokensAutonomyTargetLabel")}
              </span>
              <Select
                onValueChange={(val) => setQuickTokenId(val ?? "")}
                value={quickTargetToken.id}
              >
                <SelectTrigger className="min-w-44" size="sm">
                  <SelectValue>{quickTargetToken.name}</SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {activeTokens.map((tok) => (
                    <SelectItem key={tok.id} value={tok.id}>
                      {tok.name}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
          </div>

          <AutonomyDial
            disabled={updateTokenMutation.isPending}
            onChange={(level: AutonomyLevel) => {
              const patch = autonomyLevelToScopePatch(level);
              updateTokenMutation.mutate({
                id: quickTargetToken.id,
                scope: {
                  ...quickTargetToken.scope,
                  ...patch,
                },
              });
            }}
            policy={quickTargetPolicy}
            value={quickTargetPolicy.level}
            variant="embedded"
          />
        </div>
      ) : null}

      {tokensQuery.isPending ? (
        <SettingsGroupSkeleton rows={3} variant="token" />
      ) : tokens.length === 0 ? (
        <div className="rounded-xl border border-dashed py-10 text-center text-xs text-muted-foreground">
          {t("settings.noTokens")}
        </div>
      ) : (
        <SettingsGroup>
          {tokens.map((tok) => {
            const isRevoked = tok.revokedAt !== null;
            return (
              <div
                className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-5 ${
                  isRevoked ? "opacity-60" : ""
                }`}
                key={tok.id}
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <KeyRoundIcon className="size-3.5 text-muted-foreground" />
                    <span className="text-sm font-semibold">{tok.name}</span>
                    <Badge size="sm" variant="outline">
                      <span className="font-mono">{tok.tokenPrefix}…</span>
                    </Badge>
                    <Badge size="sm" variant="default">
                      {permissionLabels[tok.scope.permission]}
                    </Badge>
                    {tok.scope.spaceIds === "*" ? (
                      <Badge size="sm" variant="info">
                        {t("settings.allSpacesWildcard")}
                      </Badge>
                    ) : (
                      <Badge size="sm" variant="secondary">
                        {tok.scope.includeDescendants
                          ? t("settings.spacesCountWithChildren", {
                              count: tok.scope.spaceIds.length,
                            })
                          : t("settings.spacesCountOnly", {
                              count: tok.scope.spaceIds.length,
                            })}
                      </Badge>
                    )}
                    {tok.scope.denyHardDelete ? (
                      <Badge size="sm" variant="warning">
                        {t("scope.noHardDeleteBadge")}
                      </Badge>
                    ) : null}
                    {isRevoked ? (
                      <Badge size="sm" variant="error">
                        {t("common.revoked")}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="font-mono text-[11px] text-muted-foreground">
                    {t("settings.createdAt", { date: tok.createdAt.slice(0, 10) })}
                    {" · "}
                    {tok.lastUsedAt
                      ? t("settings.lastUsedAt", {
                          time: tok.lastUsedAt.slice(0, 16).replace("T", " "),
                        })
                      : t("settings.neverUsed")}
                  </p>
                </div>

                {!isRevoked ? (
                  <Button
                    onClick={() => {
                      setEditingToken(tok);
                      setEditingTokenScope(tok.scope);
                    }}
                    size="xs"
                    variant="outline"
                  >
                    <SlidersHorizontalIcon />
                    {t("settings.hotEditScope")}
                  </Button>
                ) : null}
              </div>
            );
          })}
        </SettingsGroup>
      )}

      {tokens.length > 0 ? (
        <DangerZone description={t("settings.revokeTokenZoneDesc")}>
          {activeTokens.length === 0 ? (
            <div className="px-4 py-3 text-xs text-muted-foreground sm:px-5">
              {t("settings.noActiveTokensToRevoke")}
            </div>
          ) : (
            activeTokens.map((tok) => (
              <SettingRow
                description={
                  <span className="font-mono">
                    {tok.tokenPrefix}
                    {"… · "}
                    {permissionLabels[tok.scope.permission]}
                  </span>
                }
                key={tok.id}
                title={tok.name}
              >
                <HoldConfirmButton
                  disabled={revokeTokenMutation.isPending}
                  holdingLabel={t("settings.holdingToRevoke")}
                  onConfirm={() => revokeTokenMutation.mutate(tok.id)}
                  size="sm"
                >
                  {t("settings.holdToRevokeToken")}
                </HoldConfirmButton>
              </SettingRow>
            ))
          )}
        </DangerZone>
      ) : null}

      {/* Create Scoped Token Dialog */}
      <Dialog onOpenChange={setCreateTokenOpen} open={createTokenOpen}>
        <DialogPopup className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("settings.createTokenDialogTitle")}</DialogTitle>
            <DialogDescription>{t("settings.createTokenDialogDesc")}</DialogDescription>
          </DialogHeader>
          <form noValidate onSubmit={(e) => void handleCreateTokenSubmit(e)}>
            <Form {...createTokenForm}>
              <DialogPanel className="flex flex-col gap-4">
                <FormField
                  control={createTokenForm.control}
                  name="tokenName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("settings.tokenNameLabel")}</FormLabel>
                      <FormControl>
                        <Input
                          autoFocus
                          placeholder={t("settings.tokenNamePlaceholder")}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <AutonomyDial
                  onChange={(level: AutonomyLevel) =>
                    setTokenScope((prev) => ({
                      ...prev,
                      ...autonomyLevelToScopePatch(level),
                    }))
                  }
                  policy={createPolicy}
                  value={createPolicy.level}
                  variant="embedded"
                />
                <Separator />
                <ScopeTreePicker
                  availableTags={availableTags}
                  onChange={setTokenScope}
                  spaces={spaces}
                  value={tokenScope}
                  variant="embedded"
                />
              </DialogPanel>
              <DialogFooter>
                <Button onClick={() => setCreateTokenOpen(false)} type="button" variant="outline">
                  {t("common.cancel")}
                </Button>
                <Button loading={createTokenMutation.isPending} type="submit">
                  {t("settings.generateToken")}
                </Button>
              </DialogFooter>
            </Form>
          </form>
        </DialogPopup>
      </Dialog>

      {/* One-time Plaintext Token + Streamable HTTP /mcp Config Reveal */}
      <Dialog
        onOpenChange={(open) => {
          if (!open) setRevealedToken(null);
        }}
        open={Boolean(revealedToken)}
      >
        <DialogPopup className="max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {t("settings.tokenCreatedTitle", { name: revealedToken?.name ?? "" })}
            </DialogTitle>
            <DialogDescription>{t("settings.tokenCreatedDesc")}</DialogDescription>
          </DialogHeader>
          <DialogPanel className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t("settings.plaintextTokenLabel")}
              </span>
              <div className="flex items-center gap-2">
                <Input className="font-mono text-xs" readOnly value={revealedToken?.rawToken ?? ""} />
                <CopyButton
                  showLabel
                  size="sm"
                  value={revealedToken?.rawToken ?? ""}
                  variant="outline"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t("settings.mcpConfigJsonLabel")}
                </span>
                <CopyButton
                  copiedLabel={t("settings.copiedJson")}
                  label={t("settings.copyMcpJson")}
                  showLabel
                  size="xs"
                  value={mcpSnippet}
                  variant="default"
                />
              </div>
              <pre className="max-h-56 overflow-auto rounded-xl border bg-muted/40 p-3 font-mono text-xs leading-relaxed">
                {mcpSnippet}
              </pre>
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button onClick={() => setRevealedToken(null)}>
              {t("settings.savedTokenConfirm")}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      {/* Hot-Edit Existing Token Scope */}
      <Dialog
        onOpenChange={(open) => {
          if (!open) setEditingToken(null);
        }}
        open={Boolean(editingToken)}
      >
        <DialogPopup className="max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {t("settings.hotEditDialogTitle", { name: editingToken?.name ?? "" })}
            </DialogTitle>
            <DialogDescription>{t("settings.hotEditDialogDesc")}</DialogDescription>
          </DialogHeader>
          <DialogPanel className="flex flex-col gap-4">
            <AutonomyDial
              onChange={(level: AutonomyLevel) =>
                setEditingTokenScope((prev) => ({
                  ...prev,
                  ...autonomyLevelToScopePatch(level),
                }))
              }
              policy={editPolicy}
              value={editPolicy.level}
              variant="embedded"
            />
            <Separator />
            <ScopeTreePicker
              availableTags={availableTags}
              onChange={setEditingTokenScope}
              spaces={spaces}
              value={editingTokenScope}
              variant="embedded"
            />
          </DialogPanel>
          <DialogFooter>
            <Button onClick={() => setEditingToken(null)} variant="outline">
              {t("common.cancel")}
            </Button>
            <Button
              loading={updateTokenMutation.isPending}
              onClick={() => {
                if (editingToken) {
                  updateTokenMutation.mutate({
                    id: editingToken.id,
                    scope: editingTokenScope,
                  });
                }
              }}
            >
              {t("settings.saveImmediately")}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </div>
  );
}
