import { useInkadeTranslation } from "@inkade/i18n";
import { InkadeApiError, inkadeQueryKeys } from "@inkade/sdk";
import { inkadeQueries, useInkadeClient } from "@inkade/sdk/react";
import {
  Badge,
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardPanel,
  CardTitle,
  cn,
  Input,
  Skeleton,
  Tabs,
  TabsList,
  TabsPanel,
  TabsTab,
} from "@inkade/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRoundIcon, LogInIcon, SparklesIcon, UserPlusIcon } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@inkade/ui";
import {
  getInkadeClient,
  getStoredBearerToken,
  setEmbedAccessToken,
  setEmbedSessionId,
  setStoredBearerToken,
  signInWithEmail,
  signUpWithEmail,
} from "../lib/api.ts";
import { consumeEmbedTicketFromUrl, useEmbedConfig } from "../lib/embed-config.ts";
import { isNativeMobileShell, postToNativeShell } from "../lib/mobile-shell.ts";
import { usePreferencesStore } from "@inkade/views/lib/preferences-store";

function readAuthSkeletonChrome(): {
  readonly isInset: boolean;
  readonly sidebarCollapsed: boolean;
  readonly sidebarWidth: number;
} {
  if (typeof window === "undefined") {
    return { isInset: true, sidebarCollapsed: false, sidebarWidth: 276 };
  }
  try {
    const shell = usePreferencesStore.getState().shellStyle;
    const collapsedRaw = window.localStorage.getItem("inkade:sidebar:collapsed");
    const widthRaw = Number(window.localStorage.getItem("inkade:pane:sidebar"));
    return {
      isInset: shell !== "flush",
      sidebarCollapsed: collapsedRaw === "true" || collapsedRaw === "1",
      sidebarWidth:
        Number.isFinite(widthRaw) && widthRaw >= 220 && widthRaw <= 380 ? widthRaw : 276,
    };
  } catch {
    return { isInset: true, sidebarCollapsed: false, sidebarWidth: 276 };
  }
}

function AuthLoadingSkeleton(): React.ReactElement {
  const { isInset, sidebarCollapsed, sidebarWidth } = readAuthSkeletonChrome();

  return (
    <div
      aria-busy="true"
      className={cn(
        "flex h-svh w-full overflow-hidden text-foreground",
        isInset ? "bg-[var(--studio-ground,var(--sidebar))] lg:p-1.5" : "bg-background",
      )}
    >
      {!sidebarCollapsed && (
        <aside
          className={cn(
            "hidden h-full shrink-0 flex-col lg:flex",
            isInset ? "bg-transparent" : "border-r border-sidebar-border bg-sidebar",
          )}
          style={{ width: `${sidebarWidth}px` }}
        >
          <div className="flex h-11 shrink-0 items-center justify-between gap-2 pl-2.5 pr-3.5">
            <div className="flex items-center gap-2">
              <Skeleton className="size-5.5 rounded-md" />
              <Skeleton className="h-4 w-28" />
            </div>
            <div className="flex items-center gap-1">
              <Skeleton className="size-6 rounded-md" />
              <Skeleton className="size-6 rounded-md" />
            </div>
          </div>

          <div className="px-2.5 pt-1 pb-2">
            <Skeleton className="h-8 w-full rounded-md" />
          </div>

          <div className="flex flex-1 flex-col gap-5 overflow-hidden px-2.5 py-2">
            <div className="flex flex-col gap-1">
              <Skeleton className="h-7 w-full rounded-md" />
              <Skeleton className="h-7 w-full rounded-md" />
              <Skeleton className="h-7 w-5/6 rounded-md" />
              <Skeleton className="h-7 w-4/5 rounded-md" />
            </div>

            <div className="flex flex-col gap-1.5">
              <Skeleton className="h-3 w-16 rounded-sm" />
              <Skeleton className="h-6 w-11/12 rounded-md" />
              <Skeleton className="h-6 w-4/5 rounded-md" />
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-sidebar-border/60 py-2 pl-2.5 pr-3.5">
            <Skeleton className="h-3.5 w-20" />
            <div className="flex items-center gap-1">
              <Skeleton className="size-6 rounded-md" />
              <Skeleton className="size-6 rounded-md" />
            </div>
          </div>
        </aside>
      )}

      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col overflow-hidden",
          isInset && "lg:rounded-xl lg:border lg:border-border lg:bg-background",
        )}
      >
        <div className="flex h-11 shrink-0 items-center justify-between gap-2 px-3 lg:px-5">
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-36" />
          </div>
          <div className="flex items-center gap-1.5">
            <Skeleton className="size-6 rounded-full" />
            <Skeleton className="h-6 w-14 rounded-md" />
            <Skeleton className="h-6 w-20 rounded-md" />
          </div>
        </div>

        <div className="flex-1 overflow-hidden">
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 lg:px-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <Skeleton className="h-7 w-44 rounded-md" />
                <Skeleton className="h-5 w-14 rounded-full" />
              </div>
              <div className="flex items-center gap-1.5">
                <Skeleton className="h-7 w-24 rounded-md" />
                <Skeleton className="size-7 rounded-md" />
              </div>
            </div>

            <div className="flex flex-col gap-3 pt-1">
              <div className="flex items-center gap-2.5">
                <Skeleton className="size-1.5 shrink-0 rounded-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
              <div className="flex items-center gap-2.5 pl-6">
                <Skeleton className="size-1.5 shrink-0 rounded-full" />
                <Skeleton className="h-4 w-3/5" />
              </div>
              <div className="flex items-center gap-2.5 pl-6">
                <Skeleton className="size-1.5 shrink-0 rounded-full" />
                <Skeleton className="h-4 w-4/5" />
              </div>
              <div className="flex items-center gap-2.5">
                <Skeleton className="size-1.5 shrink-0 rounded-full" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AuthEntrySplitLayout({
  statusLabel,
  card,
  compact = false,
}: {
  readonly statusLabel: string;
  readonly card: React.ReactElement;
  readonly compact?: boolean | undefined;
}): React.ReactElement {
  const { t } = useInkadeTranslation();

  if (compact) {
    return (
      <div
        className="flex min-h-svh items-center justify-center bg-background p-4"
        data-testid="embed-compact-auth"
      >
        {card}
      </div>
    );
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-background px-4 py-8 sm:px-6 lg:px-10">
      <div className="mx-auto grid w-full max-w-5xl grid-cols-1 items-center gap-8 lg:grid-cols-12 lg:gap-12">
        <section
          aria-label={t("auth.bentoEyebrow")}
          className="order-2 flex flex-col gap-5 lg:order-1 lg:col-span-6"
          data-slot="auth-bento-overview"
        >
          <div className="inline-flex w-fit items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-emerald-500" />
            <span>{t("auth.bentoEyebrow")}</span>
          </div>

          <div className="space-y-2.5">
            <h1 className="font-heading text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              {t("auth.bentoHeadline")}
            </h1>
            <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
              {t("auth.bentoLead")}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-card p-3.5">
              <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-emerald-500" />
                <span>{t("auth.bentoCardLocalTitle")}</span>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {t("auth.bentoCardLocalDesc")}
              </p>
            </div>

            <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-card p-3.5">
              <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-amber-500" />
                <span>{t("auth.bentoCardScopeTitle")}</span>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {t("auth.bentoCardScopeDesc")}
              </p>
            </div>

            <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-card p-3.5 sm:col-span-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                  <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-primary" />
                  <span>{t("auth.bentoCardDualTitle")}</span>
                </div>
                <span className="font-mono text-[11px] text-muted-foreground">{statusLabel}</span>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {t("auth.bentoCardDualDesc")}
              </p>
            </div>
          </div>
        </section>

        <div className="order-1 flex w-full justify-center lg:order-2 lg:col-span-6 lg:justify-end">
          {card}
        </div>
      </div>
    </div>
  );
}

function FirstRunSetupView({
  onComplete,
}: {
  readonly onComplete: () => void;
}): React.ReactElement {
  const { t } = useInkadeTranslation();

  const schema = useMemo(
    () =>
      z.object({
        name: z.string().trim().min(1, t("validation.required")),
        email: z.string().trim().email(t("validation.emailInvalid")),
        password: z.string().min(8, t("validation.passwordMinLength", { min: 8 })),
      }),
    [t],
  );

  type SetupFormValues = z.infer<typeof schema>;

  const form = useForm<SetupFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
    },
  });

  const setupMutation = useMutation({
    mutationFn: async (values: SetupFormValues) => {
      return getInkadeClient().bootstrap.setupOwner({
        name: values.name.trim(),
        email: values.email.trim(),
        password: values.password,
      });
    },
    onSuccess: () => {
      setStoredBearerToken(null);
      onComplete();
    },
  });

  const handleSubmit = form.handleSubmit((values) => {
    setupMutation.mutate(values);
  });

  return (
    <AuthEntrySplitLayout
      card={
        <Card className="w-full max-w-md">
          <CardHeader>
            <div className="mb-1 flex items-center gap-2">
              <Badge size="sm" variant="secondary">
                <SparklesIcon className="size-3" />
                {t("auth.firstRunBadge")}
              </Badge>
            </div>
            <CardTitle>{t("auth.setupTitle")}</CardTitle>
            <CardDescription>{t("auth.setupDescription")}</CardDescription>
          </CardHeader>
          <CardPanel>
            <Form {...form}>
              <form className="flex flex-col gap-4" noValidate onSubmit={(e) => void handleSubmit(e)}>
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("auth.name")}</FormLabel>
                      <FormControl>
                        <Input
                          autoFocus
                          placeholder={t("auth.namePlaceholder")}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("auth.email")}</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="you@example.com"
                          type="email"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("auth.passwordMin8")}</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="••••••••"
                          type="password"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {setupMutation.error && (
                  <p className="rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-xs text-destructive-foreground">
                    {setupMutation.error instanceof Error
                      ? setupMutation.error.message
                      : t("auth.setupFailed")}
                  </p>
                )}

                <Button
                  loading={setupMutation.isPending}
                  type="submit"
                >
                  {t("auth.createWorkspaceAndEnter")}
                </Button>
              </form>
            </Form>
          </CardPanel>
        </Card>
      }
      statusLabel={t("auth.setupStatusChip")}
    />
  );
}

function SignInView({
  onAuthenticated,
  compact = false,
  initialError = null,
  allowSignup = true,
}: {
  readonly onAuthenticated: () => void;
  readonly compact?: boolean | undefined;
  readonly initialError?: string | null | undefined;
  readonly allowSignup?: boolean | undefined;
}): React.ReactElement {
  const { t } = useInkadeTranslation();

  const schema = useMemo(
    () =>
      z
        .object({
          tab: z.enum(["signin", "signup", "token"]),
          name: z.string(),
          email: z.string(),
          password: z.string(),
          token: z.string(),
        })
        .superRefine((vals, ctx) => {
          if (vals.tab === "signin") {
            if (!z.string().trim().email().safeParse(vals.email).success) {
              ctx.addIssue({
                code: "custom",
                path: ["email"],
                message: t("validation.emailInvalid"),
              });
            }
            if (!vals.password) {
              ctx.addIssue({
                code: "custom",
                path: ["password"],
                message: t("validation.required"),
              });
            }
          } else if (vals.tab === "signup") {
            if (!vals.name.trim()) {
              ctx.addIssue({
                code: "custom",
                path: ["name"],
                message: t("validation.required"),
              });
            }
            if (!z.string().trim().email().safeParse(vals.email).success) {
              ctx.addIssue({
                code: "custom",
                path: ["email"],
                message: t("validation.emailInvalid"),
              });
            }
            if (vals.password.length < 8) {
              ctx.addIssue({
                code: "custom",
                path: ["password"],
                message: t("validation.passwordMinLength", { min: 8 }),
              });
            }
          } else if (!vals.token.trim()) {
            ctx.addIssue({
              code: "custom",
              path: ["token"],
              message: t("auth.enterApiToken"),
            });
          }
        }),
    [t],
  );

  type SignInFormValues = z.infer<typeof schema>;

  const form = useForm<SignInFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      tab: "signin",
      name: "",
      email: "",
      password: "",
      token: getStoredBearerToken() ?? "",
    },
  });

  const tab = useWatch({ control: form.control, name: "tab" });

  const authMutation = useMutation({
    mutationFn: async (values: SignInFormValues) => {
      if (values.tab === "signin") {
        await signInWithEmail(values.email.trim(), values.password);
      } else if (values.tab === "signup") {
        await signUpWithEmail(values.name.trim(), values.email.trim(), values.password);
      } else {
        const clean = values.token.trim();
        if (!clean) throw new Error(t("auth.enterApiToken"));
        setStoredBearerToken(clean);
        await getInkadeClient().auth.whoami();
      }
    },
    onSuccess: () => {
      onAuthenticated();
    },
    onError: (_err, variables) => {
      if (variables.tab === "token") {
        setStoredBearerToken(null);
      }
    },
  });

  const handleSubmit = form.handleSubmit((values) => {
    authMutation.mutate(values);
  });

  return (
    <AuthEntrySplitLayout
      card={
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>{t("auth.signInTitle")}</CardTitle>
            <CardDescription>{t("auth.signInDescription")}</CardDescription>
          </CardHeader>
          <CardPanel>
            <Tabs
              className="gap-4"
              onValueChange={(next) => {
                form.setValue("tab", next as "signin" | "signup" | "token");
                form.clearErrors();
              }}
              value={tab}
            >
              <TabsList className="w-full">
                <TabsTab value="signin">
                  <LogInIcon />
                  {t("auth.tabSignIn")}
                </TabsTab>
                {allowSignup && (
                  <TabsTab value="signup">
                    <UserPlusIcon />
                    {t("auth.tabSignUp")}
                  </TabsTab>
                )}
                <TabsTab value="token">
                  <KeyRoundIcon />
                  {t("auth.tabToken")}
                </TabsTab>
              </TabsList>

              <Form {...form}>
                <form className="flex flex-col gap-4" noValidate onSubmit={(e) => void handleSubmit(e)}>
                  <TabsPanel className="flex flex-col gap-3.5" value="signin">
                    <FormField
                      control={form.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t("auth.email")}</FormLabel>
                          <FormControl>
                            <Input
                              autoFocus
                              placeholder="you@example.com"
                              type="email"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t("auth.password")}</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="••••••••"
                              type="password"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </TabsPanel>

                  {allowSignup && (
                    <TabsPanel className="flex flex-col gap-3.5" value="signup">
                    <FormField
                      control={form.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t("auth.name")}</FormLabel>
                          <FormControl>
                            <Input
                              placeholder={t("auth.namePlaceholder")}
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t("auth.email")}</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="you@example.com"
                              type="email"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t("auth.passwordMin8")}</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="••••••••"
                              type="password"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </TabsPanel>
                  )}

                  <TabsPanel className="flex flex-col gap-3.5" value="token">
                    <FormField
                      control={form.control}
                      name="token"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t("auth.bearerToken")}</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="ink_..."
                              type="password"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </TabsPanel>

                  {(authMutation.error || initialError) && (
                    <p className="rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-xs text-destructive-foreground">
                      {authMutation.error instanceof Error
                        ? authMutation.error.message
                        : initialError ?? t("auth.authFailed")}
                    </p>
                  )}

                  <Button loading={authMutation.isPending} type="submit">
                    {tab === "signin"
                      ? t("auth.signIn")
                      : tab === "signup"
                        ? t("auth.createAccountAndSignIn")
                        : t("auth.enterWithToken")}
                  </Button>
                </form>
              </Form>
            </Tabs>
          </CardPanel>
        </Card>
      }
      compact={compact}
      statusLabel={t("auth.signInStatusChip")}
    />
  );
}

export function AuthGate({
  children,
}: {
  readonly children: React.ReactNode;
}): React.ReactElement {
  const { t } = useInkadeTranslation();
  const queryClient = useQueryClient();
  const embedConfig = useEmbedConfig();
  const [exchangingTicket, setExchangingTicket] = useState(() =>
    Boolean(embedConfig.embedTicket),
  );
  const [ticketError, setTicketError] = useState<string | null>(null);
  const consumedTicketRef = useRef<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const ticket = embedConfig.embedTicket;
    if (!ticket || consumedTicketRef.current === ticket) {
      return;
    }
    consumedTicketRef.current = ticket;
    setExchangingTicket(true);
    setTicketError(null);

    void getInkadeClient()
      .auth.exchangeEmbedTicket(ticket)
      .then((res) => {
        if (!mountedRef.current) return;
        setEmbedSessionId(res.embedSessionId ?? null);
        setEmbedAccessToken(res.accessToken);
        // Clear exchanging state before stripping ?embedTicket= so re-renders never orphan loading UI
        setExchangingTicket(false);
        consumeEmbedTicketFromUrl();
        void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.whoami() });
      })
      .catch((err: unknown) => {
        if (!mountedRef.current) return;
        setTicketError(err instanceof Error ? err.message : t("auth.authFailed"));
        setExchangingTicket(false);
        consumeEmbedTicketFromUrl();
      });
  }, [embedConfig.embedTicket, queryClient, t]);

  const client = useInkadeClient();

  const bootstrapQuery = useQuery({
    ...inkadeQueries.bootstrap(client),
    retry: 1,
  });

  const isInitialized = bootstrapQuery.data?.initialized ?? false;

  const whoamiQuery = useQuery({
    ...inkadeQueries.whoami(client),
    enabled: isInitialized && !exchangingTicket,
    retry: false,
  });

  useEffect(() => {
    if (!isNativeMobileShell()) return;
    if (bootstrapQuery.isError) {
      postToNativeShell({
        kind: "server_unreachable",
        message:
          bootstrapQuery.error instanceof Error ? bootstrapQuery.error.message : undefined,
      });
      return;
    }
    if (bootstrapQuery.isSuccess) {
      postToNativeShell({
        kind: "ready",
        path: window.location.pathname || "/daily",
      });
    }
  }, [bootstrapQuery.isError, bootstrapQuery.isSuccess, bootstrapQuery.error]);

  if (bootstrapQuery.isPending || exchangingTicket) {
    return <AuthLoadingSkeleton />;
  }

  if (bootstrapQuery.isError) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>{t("auth.cannotConnectTitle")}</CardTitle>
            <CardDescription>
              {bootstrapQuery.error instanceof Error
                ? bootstrapQuery.error.message
                : t("auth.cannotConnectFallback")}
            </CardDescription>
          </CardHeader>
          <CardPanel>
            <Button onClick={() => void bootstrapQuery.refetch()}>
              {t("auth.retryConnect")}
            </Button>
          </CardPanel>
        </Card>
      </div>
    );
  }

  if (!bootstrapQuery.data.initialized) {
    return (
      <FirstRunSetupView
        onComplete={() => {
          void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.bootstrap() });
          void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.whoami() });
        }}
      />
    );
  }

  if (whoamiQuery.isPending) {
    return <AuthLoadingSkeleton />;
  }

  if (whoamiQuery.isError) {
    const err = whoamiQuery.error;
    const isUnauthorized = err instanceof InkadeApiError && err.status === 401;
    if (isUnauthorized || bootstrapQuery.data.authMode === "better-auth") {
      return (
        <SignInView
          allowSignup={bootstrapQuery.data.allowSignup ?? true}
          compact={embedConfig.embed}
          initialError={ticketError}
          onAuthenticated={() => {
            setTicketError(null);
            void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.whoami() });
          }}
        />
      );
    }

    return (
      <div className="flex min-h-svh items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>{t("auth.sessionVerifyFailed")}</CardTitle>
            <CardDescription>
              {err instanceof Error ? err.message : t("common.unknownError")}
            </CardDescription>
          </CardHeader>
          <CardPanel>
            <Button onClick={() => void whoamiQuery.refetch()}>{t("common.retry")}</Button>
          </CardPanel>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}
