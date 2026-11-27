import type { TokenScope } from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import { inkadeQueryKeys } from "@inkade/sdk";
import {
  useInkadeClient,
  useInkadeDocuments,
  useInkadeSpaces,
} from "@inkade/sdk/react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  CopyButton,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  ScopeTreePicker,
  SegmentedControl,
  SegmentedControlItem,
  Separator,
  Switch,
} from "@inkade/ui";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  CheckCircle2Icon,
  KeyRoundIcon,
  PlugZapIcon,
  ScissorsIcon,
  ShieldCheckIcon,
} from "lucide-react";
import type React from "react";
import { useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { getApiBaseUrl } from "../lib/api.ts";
import { showErrorToast, showSuccessToast } from "../lib/undo.ts";

export interface ClipperPairPageProps {
  readonly nonce?: string | undefined;
  readonly initialServerUrl?: string | undefined;
}

const RECOMMENDED_CLIPPER_SCOPE: TokenScope = {
  permission: "write",
  spaceIds: "*",
  includeDescendants: true,
  denyHardDelete: true,
};

function formatTodayIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function ClipperPairPage({
  nonce,
  initialServerUrl,
}: ClipperPairPageProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const client = useInkadeClient();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const spacesQuery = useInkadeSpaces({ includeArchived: true });

  const docsQuery = useInkadeDocuments({ limit: 200 });

  const spaces = spacesQuery.data ?? [];
  const availableTags = useMemo(() => {
    const set = new Set<string>();
    for (const d of docsQuery.data ?? []) {
      for (const tag of d.tags) set.add(tag);
    }
    return [...set].sort();
  }, [docsQuery.data]);

  const schema = useMemo(
    () =>
      z.object({
        tokenName: z.string().trim().min(1, t("validation.required")),
        serverUrl: z
          .string()
          .trim()
          .refine(
            (val) => /^https?:\/\//i.test(val),
            { message: t("validation.urlInvalid") },
          ),
        scopeMode: z.enum(["recommended", "custom"]),
        denyHardDelete: z.boolean(),
      }),
    [t],
  );
  type PairFormValues = z.infer<typeof schema>;

  const form = useForm<PairFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      tokenName: t("clipper.webPairDefaultTokenName", { date: formatTodayIso() }),
      serverUrl: (initialServerUrl || getApiBaseUrl() || "http://127.0.0.1:4100").replace(
        /\/+$/,
        "",
      ),
      scopeMode: "recommended",
      denyHardDelete: true,
    },
  });

  const scopeMode = useWatch({ control: form.control, name: "scopeMode" });
  const denyHardDelete = useWatch({ control: form.control, name: "denyHardDelete" });
  const [customScope, setCustomScope] = useState<TokenScope>(RECOMMENDED_CLIPPER_SCOPE);

  const [pairPhase, setPairPhase] = useState<"form" | "verifying" | "paired" | "manual">("form");
  const [pairedResult, setPairedResult] = useState<{
    readonly rawToken: string;
    readonly tokenName: string;
    readonly serverUrl: string;
    readonly spacesCount?: number | undefined;
    readonly handshakeError?: string | undefined;
  } | null>(null);

  const activeScope: TokenScope = useMemo(() => {
    if (scopeMode === "recommended") {
      return {
        ...RECOMMENDED_CLIPPER_SCOPE,
        denyHardDelete,
      };
    }
    return customScope;
  }, [scopeMode, denyHardDelete, customScope]);

  const waitForExtensionAck = (
    targetNonce: string,
    payload: Record<string, unknown>,
  ): Promise<{
    readonly ok: boolean;
    readonly error?: string | undefined;
    readonly tokenName?: string | undefined;
    readonly spacesCount?: number | undefined;
  }> =>
    new Promise((resolve) => {
      let settled = false;
      const timer = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        window.removeEventListener("message", onMessage);
        resolve({ ok: false, error: t("clipper.webPairAckTimeout") });
      }, 3000);

      const onMessage = (event: MessageEvent) => {
        if (event.source !== window) return;
        const data = event.data as {
          readonly type?: unknown;
          readonly nonce?: unknown;
          readonly ok?: unknown;
          readonly error?: unknown;
          readonly tokenName?: unknown;
          readonly spacesCount?: unknown;
        } | null;
        if (!data || typeof data !== "object") return;
        if (data.type !== "INKADE_CLIPPER_PAIRING_ACK" || data.nonce !== targetNonce) return;
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        window.removeEventListener("message", onMessage);
        resolve({
          ok: Boolean(data.ok),
          error: typeof data.error === "string" ? data.error : undefined,
          tokenName: typeof data.tokenName === "string" ? data.tokenName : undefined,
          spacesCount: typeof data.spacesCount === "number" ? data.spacesCount : undefined,
        });
      };

      window.addEventListener("message", onMessage);
      const targetOrigin =
        window.location.origin && window.location.origin !== "null" ? window.location.origin : "*";
      window.postMessage(payload, targetOrigin);
    });

  const pairMutation = useMutation({
    mutationFn: async (values: PairFormValues) => {
      const cleanName =
        values.tokenName.trim() ||
        t("clipper.webPairDefaultTokenName", { date: formatTodayIso() });
      const cleanServer = values.serverUrl.trim().replace(/\/+$/, "") || getApiBaseUrl();
      const created = await client.tokens.create({
        name: cleanName,
        scope: {
          permission: activeScope.permission,
          spaceIds: activeScope.spaceIds === "*" ? "*" : [...activeScope.spaceIds],
          includeDescendants: activeScope.includeDescendants,
          denyHardDelete: activeScope.denyHardDelete,
          ...(activeScope.tagAllowlist ? { tagAllowlist: [...activeScope.tagAllowlist] } : {}),
          ...(activeScope.allowedKinds ? { allowedKinds: [...activeScope.allowedKinds] } : {}),
        },
      });
      return { created, cleanServer };
    },
    onSuccess: async ({ created, cleanServer }) => {
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.tokens() });

      if (nonce) {
        setPairPhase("verifying");
        const ack = await waitForExtensionAck(nonce, {
          type: "INKADE_CLIPPER_PAIRING_RESPONSE",
          nonce,
          serverUrl: cleanServer,
          webAppUrl: window.location.origin,
          token: created.rawToken,
          tokenName: created.token.name,
        });

        setPairedResult({
          rawToken: created.rawToken,
          tokenName: ack.tokenName || created.token.name,
          serverUrl: cleanServer,
          spacesCount: ack.spacesCount,
          handshakeError: ack.ok ? undefined : ack.error,
        });

        if (ack.ok) {
          setPairPhase("paired");
          showSuccessToast(t("clipper.webPairSuccessToast"), created.token.name);
        } else {
          setPairPhase("manual");
        }
      } else {
        setPairedResult({
          rawToken: created.rawToken,
          tokenName: created.token.name,
          serverUrl: cleanServer,
        });
        setPairPhase("manual");
        showSuccessToast(t("clipper.webPairTokenCreatedToast"), created.token.name);
      }
    },
    onError: (err) => {
      showErrorToast(t("clipper.webPairFailedToast"), err);
    },
  });

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-8 sm:px-6">
      <div className="flex items-center justify-between gap-2">
        <Button
          onClick={() => void navigate({ to: "/settings/$section", params: { section: "tokens" } })}
          size="sm"
          variant="ghost"
        >
          <ArrowLeftIcon className="size-3.5" />
          <span>{t("clipper.webPairBackToSettings")}</span>
        </Button>
        {nonce ? (
          <Badge size="sm" variant="outline">
            <PlugZapIcon className="size-3" />
            <span>{t("clipper.webPairBrowserHandshakeBadge")}</span>
          </Badge>
        ) : null}
      </div>

      <Card>
        <CardHeader className="gap-2">
          <div className="flex items-center gap-3">
            <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <ScissorsIcon className="size-4.5" />
            </span>
            <div className="flex flex-col gap-0.5">
              <CardTitle className="text-base">{t("clipper.webPairTitle")}</CardTitle>
              <CardDescription>{t("clipper.webPairSubtitle")}</CardDescription>
            </div>
          </div>
        </CardHeader>

        {pairPhase === "paired" && pairedResult ? (
          <>
            <CardContent className="flex flex-col gap-4">
              <div className="flex items-start gap-3 rounded-lg border border-emerald-500/25 bg-emerald-500/10 p-4 text-sm text-emerald-700 dark:text-emerald-300">
                <CheckCircle2Icon className="mt-0.5 size-4.5 shrink-0" />
                <div className="flex flex-col gap-1">
                  <strong className="font-semibold">{t("clipper.webPairSuccessHeading")}</strong>
                  <span className="text-xs opacity-90">
                    {t("clipper.webPairSuccessDesc", {
                      tokenName: pairedResult.tokenName,
                      spacesCount: pairedResult.spacesCount ?? spaces.length,
                    })}
                  </span>
                </div>
              </div>
              <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-muted/40 px-3.5 py-2.5 text-xs text-muted-foreground">
                <span>
                  {t("clipper.serverUrlLabel")}
                  {": "}
                  <code className="font-mono text-foreground">{pairedResult.serverUrl}</code>
                </span>
                <span>{t("clipper.webPairCloseWindowHint")}</span>
              </div>
            </CardContent>
            <CardFooter className="justify-end gap-2">
              <Button onClick={() => void navigate({ to: "/daily" })} size="sm">
                <span>{t("common.backToWorkspace")}</span>
              </Button>
            </CardFooter>
          </>
        ) : pairPhase === "manual" && pairedResult ? (
          <>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-col gap-1 rounded-lg border border-border bg-muted/45 p-3.5 text-xs">
                <strong className="text-sm font-semibold text-foreground">
                  {pairedResult.handshakeError
                    ? t("clipper.webPairFallbackTitle")
                    : t("clipper.webPairManualReadyTitle")}
                </strong>
                <span className="text-muted-foreground">
                  {pairedResult.handshakeError
                    ? t("clipper.webPairFallbackDesc", { error: pairedResult.handshakeError })
                    : t("clipper.webPairManualReadyDesc")}
                </span>
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">
                  {t("clipper.serverUrlLabel")}
                </span>
                <div className="flex items-center gap-2">
                  <Input className="font-mono text-xs" readOnly size="sm" value={pairedResult.serverUrl} />
                  <CopyButton showLabel size="sm" value={pairedResult.serverUrl} variant="outline" />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">
                  {t("clipper.tokenLabel")}
                </span>
                <div className="flex items-center gap-2">
                  <Input className="font-mono text-xs" readOnly size="sm" value={pairedResult.rawToken} />
                  <CopyButton showLabel size="sm" value={pairedResult.rawToken} variant="outline" />
                </div>
              </div>
            </CardContent>
            <CardFooter className="justify-between gap-2">
              <Button
                onClick={() => {
                  setPairedResult(null);
                  setPairPhase("form");
                }}
                size="sm"
                variant="outline"
              >
                <span>{t("clipper.webPairRegenerateBtn")}</span>
              </Button>
              <Button onClick={() => void navigate({ to: "/daily" })} size="sm">
                <span>{t("common.backToWorkspace")}</span>
              </Button>
            </CardFooter>
          </>
        ) : (
          <form noValidate onSubmit={(e) => void form.handleSubmit((values) => pairMutation.mutate(values))(e)}>
            <Form {...form}>
              <CardContent className="flex flex-col gap-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="tokenName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("settings.tokenNameLabel")}</FormLabel>
                        <FormControl>
                          <Input size="sm" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="serverUrl"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("clipper.serverUrlLabel")}</FormLabel>
                        <FormControl>
                          <Input size="sm" type="url" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <Separator />

                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground">
                      <ShieldCheckIcon className="size-3.5 text-muted-foreground" />
                      <span>{t("clipper.webPairScopeTitle")}</span>
                    </span>
                    <SegmentedControl size="sm">
                      <SegmentedControlItem
                        aria-pressed={scopeMode === "recommended"}
                        data-pressed={scopeMode === "recommended" ? "" : undefined}
                        onClick={() => form.setValue("scopeMode", "recommended")}
                      >
                        {t("clipper.webPairScopeRecommended")}
                      </SegmentedControlItem>
                      <SegmentedControlItem
                        aria-pressed={scopeMode === "custom"}
                        data-pressed={scopeMode === "custom" ? "" : undefined}
                        onClick={() => form.setValue("scopeMode", "custom")}
                      >
                        {t("clipper.webPairScopeCustom")}
                      </SegmentedControlItem>
                    </SegmentedControl>
                  </div>

                  {scopeMode === "recommended" ? (
                    <div className="flex flex-col gap-2.5 rounded-lg border border-border bg-muted/35 p-3">
                      <span className="text-xs text-muted-foreground">
                        {t("clipper.webPairScopeRecommendedDesc")}
                      </span>
                      <FormField
                        control={form.control}
                        name="denyHardDelete"
                        render={({ field }) => (
                          <div className="flex items-center justify-between gap-3 pt-1">
                            <label
                              className="cursor-pointer text-xs font-medium text-foreground"
                              htmlFor="pair-deny-hard-delete"
                            >
                              {t("scope.noHardDeleteBadge")}
                            </label>
                            <Switch
                              checked={field.value}
                              id="pair-deny-hard-delete"
                              onCheckedChange={(checked) => field.onChange(Boolean(checked))}
                            />
                          </div>
                        )}
                      />
                    </div>
                  ) : (
                    <ScopeTreePicker
                      availableTags={availableTags}
                      onChange={setCustomScope}
                      spaces={spaces}
                      value={customScope}
                      variant="embedded"
                    />
                  )}
                </div>
              </CardContent>

              <CardFooter className="mt-2 justify-end gap-2">
                <Button
                  onClick={() => void navigate({ to: "/daily" })}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {t("common.cancel")}
                </Button>
                <Button
                  loading={pairMutation.isPending || pairPhase === "verifying"}
                  size="sm"
                  type="submit"
                >
                  <KeyRoundIcon className="size-3.5" />
                  <span>
                    {pairPhase === "verifying"
                      ? t("clipper.webPairVerifyingBtn")
                      : nonce
                        ? t("clipper.webPairAuthorizeConnectBtn")
                        : t("clipper.webPairGenerateBtn")}
                  </span>
                </Button>
              </CardFooter>
            </Form>
          </form>
        )}
      </Card>
    </div>
  );
}
