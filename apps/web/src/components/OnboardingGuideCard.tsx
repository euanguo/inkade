import { useInkadeTranslation } from "@inkade/i18n";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  cn,
  Popover,
  PopoverPopup,
  PopoverTrigger,
} from "@inkade/ui";
import {
  CalendarDaysIcon,
  ChevronRightIcon,
  CommandIcon,
  LayoutGridIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react";
import type React from "react";
import { useCallback, useMemo, useState } from "react";

export const ONBOARDING_DISMISSED_STORAGE_KEY = "inkade:onboarding:dismissed";
export const ONBOARDING_STEPS_STORAGE_KEY = "inkade:onboarding:completed-steps";

export type OnboardingStepId =
  | "commandHub"
  | "appearance"
  | "dailyFlow"
  | "libraryStudio";

const ALL_STEP_IDS: readonly OnboardingStepId[] = [
  "commandHub",
  "appearance",
  "dailyFlow",
  "libraryStudio",
];

function readDismissedFlag(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(ONBOARDING_DISMISSED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function readCompletedSteps(): Set<OnboardingStepId> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(ONBOARDING_STEPS_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    const valid = parsed.filter(
      (item): item is OnboardingStepId =>
        typeof item === "string" && ALL_STEP_IDS.includes(item as OnboardingStepId),
    );
    return new Set(valid);
  } catch {
    return new Set();
  }
}

function persistCompletedSteps(next: ReadonlySet<OnboardingStepId>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ONBOARDING_STEPS_STORAGE_KEY, JSON.stringify([...next]));
  } catch {
    // ignore storage errors
  }
}

function defaultOpenCommandPalette(): void {
  if (typeof window === "undefined") return;
  try {
    const isMac =
      typeof navigator !== "undefined" && /mac|iphone|ipad/i.test(navigator.platform);
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "k",
        metaKey: isMac,
        ctrlKey: !isMac,
        bubbles: true,
        cancelable: true,
      }),
    );
  } catch {
    // ignore synthetic event errors in restricted environments
  }
}

function defaultOpenSettings(): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(
      new CustomEvent("inkade:open-settings-modal", {
        detail: { section: "appearance" },
      }),
    );
  } catch {
    // ignore event errors
  }
}

function defaultNavigate(to: string): void {
  if (typeof window === "undefined") return;
  try {
    window.history.pushState({}, "", to);
    window.dispatchEvent(new PopStateEvent("popstate"));
  } catch {
    // ignore navigation errors in standalone harnesses
  }
}

export interface OnboardingGuideCardProps {
  readonly variant?: "card" | "sidebar" | undefined;
  readonly onOpenCommandPalette?: (() => void) | undefined;
  readonly onOpenSettings?: (() => void) | undefined;
  readonly onNavigate?: ((to: string) => void) | undefined;
  readonly onDismiss?: (() => void) | undefined;
  readonly className?: string | undefined;
}

export function OnboardingGuideCard({
  variant = "card",
  onOpenCommandPalette,
  onOpenSettings,
  onNavigate,
  onDismiss,
  className,
}: OnboardingGuideCardProps): React.ReactElement | null {
  const { t } = useInkadeTranslation();
  const [dismissed, setDismissed] = useState<boolean>(readDismissedFlag);
  const [completedSteps, setCompletedSteps] = useState<Set<OnboardingStepId>>(readCompletedSteps);

  const markStepCompleted = useCallback((stepId: OnboardingStepId, done = true) => {
    setCompletedSteps((prev) => {
      const next = new Set(prev);
      if (done) {
        next.add(stepId);
      } else {
        next.delete(stepId);
      }
      persistCompletedSteps(next);
      return next;
    });
  }, []);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(ONBOARDING_DISMISSED_STORAGE_KEY, "true");
      } catch {
        // ignore storage errors
      }
    }
    onDismiss?.();
  }, [onDismiss]);

  const steps = useMemo(
    () =>
      [
        {
          id: "commandHub" as const,
          title: t("library.onboarding.stepCommandTitle"),
          description: t("library.onboarding.stepCommandDesc"),
          actionLabel: t("library.onboarding.stepCommandAction"),
          icon: <CommandIcon className="size-3.5 text-primary" />,
          run: () => {
            markStepCompleted("commandHub", true);
            if (onOpenCommandPalette) {
              onOpenCommandPalette();
            } else {
              defaultOpenCommandPalette();
            }
          },
        },
        {
          id: "appearance" as const,
          title: t("library.onboarding.stepAppearanceTitle"),
          description: t("library.onboarding.stepAppearanceDesc"),
          actionLabel: t("library.onboarding.stepAppearanceAction"),
          icon: <SlidersHorizontalIcon className="size-3.5 text-primary" />,
          run: () => {
            markStepCompleted("appearance", true);
            if (onOpenSettings) {
              onOpenSettings();
            } else {
              defaultOpenSettings();
            }
          },
        },
        {
          id: "dailyFlow" as const,
          title: t("library.onboarding.stepDailyTitle"),
          description: t("library.onboarding.stepDailyDesc"),
          actionLabel: t("library.onboarding.stepDailyAction"),
          icon: <CalendarDaysIcon className="size-3.5 text-primary" />,
          run: () => {
            markStepCompleted("dailyFlow", true);
            if (onNavigate) {
              onNavigate("/daily");
            }
          },
        },
        {
          id: "libraryStudio" as const,
          title: t("library.onboarding.stepLibraryTitle"),
          description: t("library.onboarding.stepLibraryDesc"),
          actionLabel: t("library.onboarding.stepLibraryAction"),
          icon: <LayoutGridIcon className="size-3.5 text-primary" />,
          run: () => {
            markStepCompleted("libraryStudio", true);
            if (onNavigate) {
              onNavigate("/library");
            } else {
              defaultNavigate("/library");
            }
          },
        },
      ] as const,
    [t, markStepCompleted, onOpenCommandPalette, onOpenSettings, onNavigate],
  );

  if (dismissed) {
    return null;
  }

  if (variant === "sidebar") {
    return (
      <div
        className={cn(
          "mx-2.5 mb-2 flex flex-col gap-1.5 rounded-md border border-border/75 bg-background/70 px-2.5 py-2",
          className,
        )}
        data-slot="onboarding-guide-card"
        data-variant="sidebar"
      >
        <div className="flex items-center justify-between gap-1.5">
          <Popover>
            <PopoverTrigger
              render={
                <button
                  aria-label={t("nav.expandOnboardingAria")}
                  className="flex min-w-0 flex-1 cursor-pointer items-center justify-between gap-1.5 rounded text-left text-xs font-medium text-foreground transition-colors hover:text-foreground/80"
                  type="button"
                />
              }
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <SparklesIcon className="size-3 shrink-0 text-muted-foreground" />
                <span className="truncate">{t("library.onboarding.title")}</span>
              </span>
              <span className="flex shrink-0 items-center gap-0.5 font-mono text-[10px] text-muted-foreground tabular-nums">
                <span>
                  {t("library.onboarding.progress", {
                    completed: completedSteps.size,
                    total: steps.length,
                  })}
                </span>
                <ChevronRightIcon className="size-3" />
              </span>
            </PopoverTrigger>

            <PopoverPopup align="start" className="w-80" side="right" viewportClassName="p-3">
              <div className="flex flex-col gap-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-foreground">
                      {t("library.onboarding.title")}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {t("library.onboarding.progress", {
                        completed: completedSteps.size,
                        total: steps.length,
                      })}
                    </div>
                  </div>
                  <Button
                    aria-label={t("library.onboarding.dismissAria")}
                    onClick={handleDismiss}
                    size="xs"
                    variant="ghost"
                  >
                    <XIcon />
                    <span>{t("library.onboarding.dismiss")}</span>
                  </Button>
                </div>

                <div className="flex flex-col gap-1.5">
                  {steps.map((step) => {
                    const isDone = completedSteps.has(step.id);
                    return (
                      <div
                        className={cn(
                          "flex items-start justify-between gap-2 rounded-md border px-2.5 py-2 transition-colors",
                          isDone
                            ? "border-border/50 bg-muted/40 text-muted-foreground"
                            : "border-border bg-background hover:border-foreground/25",
                        )}
                        data-completed={isDone ? "true" : "false"}
                        data-step-id={step.id}
                        key={step.id}
                      >
                        <div className="flex min-w-0 items-start gap-2">
                          <Checkbox
                            aria-label={t("library.onboarding.markStepAria", { title: step.title })}
                            checked={isDone}
                            className="mt-0.5"
                            onCheckedChange={(checked) => markStepCompleted(step.id, Boolean(checked))}
                          />
                          <div className="min-w-0">
                            <span
                              className={cn(
                                "block truncate text-xs font-medium",
                                isDone ? "line-through opacity-75" : "text-foreground",
                              )}
                            >
                              {step.title}
                            </span>
                            <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                              {step.description}
                            </p>
                          </div>
                        </div>
                        <Button
                          className="shrink-0"
                          onClick={step.run}
                          size="xs"
                          variant={isDone ? "ghost" : "outline"}
                        >
                          {step.actionLabel}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </PopoverPopup>
          </Popover>

          <button
            aria-label={t("library.onboarding.dismissAria")}
            className="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            onClick={handleDismiss}
            type="button"
          >
            <XIcon className="size-3" />
          </button>
        </div>

        <div
          aria-hidden="true"
          className="grid grid-cols-4 gap-1"
          data-slot="onboarding-progress-segments"
        >
          {steps.map((step) => {
            const isDone = completedSteps.has(step.id);
            return (
              <span
                className={cn(
                  "h-[3px] rounded-full transition-[background-color,opacity] duration-[var(--duration-fast)] ease-[var(--ease-smooth-out)]",
                  isDone ? "bg-foreground/80 opacity-100" : "bg-border opacity-80",
                )}
                data-completed={isDone ? "true" : "false"}
                key={step.id}
              />
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <Card
      className={cn(
        "border-border bg-card",
        className,
      )}
      data-slot="onboarding-guide-card"
    >
      <CardHeader className="gap-2 pb-3 sm:p-5 sm:pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge size="sm" variant="info">
                <SparklesIcon className="size-3" />
                <span>{t("library.onboarding.badge")}</span>
              </Badge>
              <Badge size="sm" variant="outline">
                {t("library.onboarding.progress", {
                  completed: completedSteps.size,
                  total: steps.length,
                })}
              </Badge>
            </div>
            <CardTitle className="text-base">{t("library.onboarding.title")}</CardTitle>
            <CardDescription className="text-xs">
              {t("library.onboarding.subtitle")}
            </CardDescription>
            <div
              aria-hidden="true"
              className="mt-1.5 grid grid-cols-4 gap-1.5"
              data-slot="onboarding-progress-segments"
            >
              {steps.map((step) => {
                const isDone = completedSteps.has(step.id);
                return (
                  <span
                    className={cn(
                      "h-1 rounded-full transition-[background-color,opacity] duration-[var(--duration-fast)] ease-[var(--ease-smooth-out)]",
                      isDone ? "bg-primary opacity-100" : "bg-border/80 opacity-80",
                    )}
                    data-completed={isDone ? "true" : "false"}
                    key={step.id}
                  />
                );
              })}
            </div>
          </div>
          <Button
            aria-label={t("library.onboarding.dismissAria")}
            className="shrink-0"
            onClick={handleDismiss}
            size="xs"
            variant="ghost"
          >
            <XIcon />
            <span>{t("library.onboarding.dismiss")}</span>
          </Button>
        </div>
      </CardHeader>

      <CardContent className="grid grid-cols-1 gap-2 pb-5 sm:grid-cols-2 sm:px-5">
        {steps.map((step) => {
          const isDone = completedSteps.has(step.id);
          return (
            <div
              className={cn(
                "flex items-start justify-between gap-2.5 rounded-md px-3 py-2.5 transition-colors",
                isDone
                  ? "bg-muted/30 text-muted-foreground"
                  : "bg-muted/45 hover:bg-muted/70",
              )}
              data-completed={isDone ? "true" : "false"}
              data-step-id={step.id}
              key={step.id}
            >
              <div className="flex min-w-0 items-start gap-2.5">
                <Checkbox
                  aria-label={t("library.onboarding.markStepAria", { title: step.title })}
                  checked={isDone}
                  className="mt-0.5"
                  onCheckedChange={(checked) => markStepCompleted(step.id, Boolean(checked))}
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    {step.icon}
                    <span
                      className={cn(
                        "truncate text-xs font-semibold",
                        isDone ? "line-through opacity-75" : "text-foreground",
                      )}
                    >
                      {step.title}
                    </span>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                    {step.description}
                  </p>
                </div>
              </div>
              <Button
                className="shrink-0"
                onClick={step.run}
                size="xs"
                variant={isDone ? "ghost" : "outline"}
              >
                {step.actionLabel}
              </Button>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
