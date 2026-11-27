"use client";

import {
  DEFAULT_HOST_KIND,
  type AdeKind,
  type DocumentId,
  type DocumentKind,
  type ScopeEffectiveSummary,
  type Space,
  type SpaceId,
  normalizeHostKind,
} from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import {
  AtSignIcon,
  ChevronDownIcon,
  PlusIcon,
  SendIcon,
  ShieldCheckIcon,
  SlashIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react";
import { getHostToneStyle } from "../primitives/tag-pill.tsx";
import { formatAdeKindLabel } from "./AdeThreadChip.tsx";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../lib/utils.ts";
import { Button } from "../primitives/button.tsx";
import { GlideHighlight } from "../primitives/glide-highlight.tsx";
import { Kbd } from "../primitives/kbd.tsx";
import { Popover, PopoverPopup, PopoverTrigger } from "../primitives/popover.tsx";
import { Textarea } from "../primitives/textarea.tsx";

export interface ComposerDocumentOption {
  readonly id: DocumentId;
  readonly title: string;
  readonly kind: DocumentKind;
  readonly spaceId?: SpaceId | undefined;
}

export interface ComposerTemplateOption {
  readonly id: string;
  readonly label: string;
  readonly promptPrefix: string;
}

export interface AgentComposerSubmitPayload {
  readonly prompt: string;
  readonly mentionedDocIds: readonly DocumentId[];
  readonly templateId: string | null;
  readonly suggestionMode: boolean;
  readonly adeKind: AdeKind;
}

export interface ComposerTriggerMatch {
  readonly type: "@" | "/";
  readonly query: string;
  readonly startIndex: number;
}

/**
 * Detects an active `@` mention or `/` template trigger immediately preceding `cursorPos`.
 */
export function detectComposerTrigger(
  text: string,
  cursorPos: number,
): ComposerTriggerMatch | null {
  const safeCursor = Math.max(0, Math.min(text.length, cursorPos));
  const slice = text.slice(0, safeCursor);
  const match = /(?:^|\s)([@/])([^\s@/]*)$/.exec(slice);
  if (!match) return null;
  const trigger = match[1] as "@" | "/";
  const query = match[2] ?? "";
  const startIndex = slice.length - query.length - 1;
  return { type: trigger, query, startIndex };
}

/**
 * Deletes the last atomic `@DocTitle` pill when Backspace is pressed with a collapsed cursor at index 0.
 */
export function removeLastMentionOnBackspace(
  selectionStart: number,
  selectionEnd: number,
  mentionedDocs: readonly ComposerDocumentOption[],
): {
  readonly removed: ComposerDocumentOption | null;
  readonly nextMentionedDocs: readonly ComposerDocumentOption[];
} {
  if (selectionStart !== 0 || selectionEnd !== 0 || mentionedDocs.length === 0) {
    return { removed: null, nextMentionedDocs: mentionedDocs };
  }
  const removed = mentionedDocs[mentionedDocs.length - 1] ?? null;
  return {
    removed,
    nextMentionedDocs: mentionedDocs.slice(0, -1),
  };
}

/**
 * Steps a floating picker index with wrap-around for ArrowUp / ArrowDown navigation.
 */
export function stepMenuIndex(current: number, delta: number, length: number): number {
  if (length <= 0) return 0;
  const safeCurrent = ((current % length) + length) % length;
  return (((safeCurrent + delta) % length) + length) % length;
}

/**
 * Formats a concise human-readable scope summary string from `ScopeEffectiveSummary`.
 */
export function formatScopeBadgeSummary(
  scopeSummary: ScopeEffectiveSummary | null | undefined,
  spaces: readonly Pick<Space, "id" | "name">[],
  labels: {
    readonly allSpaces: string;
    readonly spacesCount: (count: number) => string;
    readonly noHardDelete: string;
    readonly fallback: string;
  },
): string {
  if (!scopeSummary) return labels.fallback;
  const spaceMap = new Map(spaces.map((s) => [s.id, s.name]));
  const spacePart =
    scopeSummary.allowedSpaceIds === "*"
      ? labels.allSpaces
      : scopeSummary.allowedSpaceIds.length === 1
        ? (spaceMap.get(scopeSummary.allowedSpaceIds[0]!) ?? labels.spacesCount(1))
        : labels.spacesCount(scopeSummary.allowedSpaceIds.length);
  const parts = [spacePart];
  if (scopeSummary.denyHardDelete) {
    parts.push(labels.noHardDelete);
  }
  return parts.join(" · ");
}

export interface AgentComposerPanelProps {
  readonly documents: readonly ComposerDocumentOption[];
  readonly selectedAdeKind?: AdeKind | undefined;
  readonly onAdeKindChange?: ((kind: AdeKind) => void) | undefined;
  readonly availableHosts?: readonly AdeKind[] | undefined;
  readonly hideHostPicker?: boolean | undefined;
  readonly scopeSummary?: ScopeEffectiveSummary | null | undefined;
  readonly spaces?: readonly Pick<Space, "id" | "name">[] | undefined;
  readonly initialMentionedDocs?: readonly ComposerDocumentOption[] | undefined;
  readonly initialPrompt?: string | undefined;
  readonly templates?: readonly ComposerTemplateOption[] | undefined;
  readonly defaultSuggestionMode?: boolean | undefined;
  readonly collapsible?: boolean | undefined;
  readonly defaultCollapsed?: boolean | undefined;
  readonly submitting?: boolean | undefined;
  readonly placeholder?: string | undefined;
  readonly onSubmit: (payload: AgentComposerSubmitPayload) => void | Promise<void>;
  readonly className?: string | undefined;
}

/**
 * Reusable scoped composer for dispatching ADE threads with atomic @document pills,
 * / template presets, Track Changes suggestion toggle, and server-enforced scope visibility.
 */
export function AgentComposerPanel({
  documents,
  selectedAdeKind: controlledAdeKind,
  onAdeKindChange,
  availableHosts,
  hideHostPicker = false,
  scopeSummary,
  spaces = [],
  initialMentionedDocs = [],
  initialPrompt = "",
  templates: customTemplates,
  defaultSuggestionMode = true,
  collapsible = false,
  defaultCollapsed = false,
  submitting = false,
  placeholder,
  onSubmit,
  className,
}: AgentComposerPanelProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const [uncontrolledAdeKind, setUncontrolledAdeKind] = useState<AdeKind>(DEFAULT_HOST_KIND);
  const adeKind = controlledAdeKind ?? uncontrolledAdeKind;
  const [customHostOpen, setCustomHostOpen] = useState(false);
  const [customHostDraft, setCustomHostDraft] = useState("");

  const [collapsed, setCollapsed] = useState(collapsible ? defaultCollapsed : false);
  const [prompt, setPrompt] = useState(initialPrompt);
  const [mentionedDocs, setMentionedDocs] = useState<readonly ComposerDocumentOption[]>(
    initialMentionedDocs,
  );
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null);
  const [suggestionMode, setSuggestionMode] = useState(defaultSuggestionMode);
  const [mentionMenuOpen, setMentionMenuOpen] = useState(false);
  const [templateMenuOpen, setTemplateMenuOpen] = useState(false);
  const [activeMenuIndex, setActiveMenuIndex] = useState(0);
  const [triggerMatch, setTriggerMatch] = useState<ComposerTriggerMatch | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setActiveMenuIndex(0);
  }, [mentionMenuOpen, templateMenuOpen, triggerMatch?.query, triggerMatch?.type]);

  const initialMentionKey = initialMentionedDocs.map((doc) => doc.id).join("\u0000");
  const prevInitialMentionKeyRef = useRef(initialMentionKey);

  useEffect(() => {
    if (prevInitialMentionKeyRef.current !== initialMentionKey) {
      prevInitialMentionKeyRef.current = initialMentionKey;
      setMentionedDocs(initialMentionedDocs);
    }
  }, [initialMentionKey, initialMentionedDocs]);

  useEffect(() => {
    setPrompt(initialPrompt);
  }, [initialPrompt]);

  const templates = useMemo<readonly ComposerTemplateOption[]>(
    () =>
      customTemplates ?? [
        {
          id: "review",
          label: t("agentControl.templateReviewLabel"),
          promptPrefix: t("agentControl.templateReviewPrefix"),
        },
        {
          id: "draft_outline",
          label: t("agentControl.templateOutlineLabel"),
          promptPrefix: t("agentControl.templateOutlinePrefix"),
        },
        {
          id: "extract_tasks",
          label: t("agentControl.templateTasksLabel"),
          promptPrefix: t("agentControl.templateTasksPrefix"),
        },
        {
          id: "refactor",
          label: t("agentControl.templateRefactorLabel"),
          promptPrefix: t("agentControl.templateRefactorPrefix"),
        },
      ],
    [customTemplates, t],
  );

  const hostOptions = useMemo(() => {
    const unique = new Set<AdeKind>([DEFAULT_HOST_KIND]);
    for (const host of availableHosts ?? []) {
      const normalized = normalizeHostKind(host);
      if (normalized) unique.add(normalized);
    }
    if (adeKind) {
      unique.add(normalizeHostKind(adeKind));
    }
    return [...unique];
  }, [adeKind, availableHosts]);

  const setAdeKind = (next: AdeKind): void => {
    const normalized = normalizeHostKind(next);
    if (controlledAdeKind === undefined) {
      setUncontrolledAdeKind(normalized);
    }
    onAdeKindChange?.(normalized);
  };

  const applyCustomHost = (): void => {
    const trimmed = customHostDraft.trim();
    if (!trimmed) {
      setCustomHostOpen(false);
      return;
    }
    setAdeKind(normalizeHostKind(trimmed));
    setCustomHostDraft("");
    setCustomHostOpen(false);
  };

  const scopeText = useMemo(
    () =>
      formatScopeBadgeSummary(scopeSummary, spaces, {
        allSpaces: t("agentControl.scopeAllSpaces"),
        spacesCount: (count) => t("agentControl.scopeSpacesCount", { count }),
        noHardDelete: t("agentControl.scopeNoHardDelete"),
        fallback: t("agentControl.scopeUnavailable"),
      }),
    [scopeSummary, spaces, t],
  );

  const filteredDocs = useMemo(() => {
    const q = (triggerMatch?.type === "@" ? triggerMatch.query : "").trim().toLowerCase();
    const mentionedSet = new Set(mentionedDocs.map((d) => d.id));
    return documents
      .filter((doc) => !mentionedSet.has(doc.id))
      .filter((doc) => (!q ? true : doc.title.toLowerCase().includes(q)))
      .slice(0, 8);
  }, [documents, mentionedDocs, triggerMatch]);

  const filteredTemplates = useMemo(() => {
    const q = (triggerMatch?.type === "/" ? triggerMatch.query : "").trim().toLowerCase();
    return templates.filter((tpl) => (!q ? true : tpl.label.toLowerCase().includes(q)));
  }, [templates, triggerMatch]);

  const stripTriggerFromPrompt = (match: ComposerTriggerMatch | null, rawPrompt: string): string => {
    if (!match) return rawPrompt;
    const before = rawPrompt.slice(0, match.startIndex);
    const after = rawPrompt.slice(match.startIndex + 1 + match.query.length);
    return `${before}${after}`.replace(/\s{2,}/g, " ").trimStart();
  };

  const handleSelectMention = (doc: ComposerDocumentOption): void => {
    setMentionedDocs((prev) => (prev.some((d) => d.id === doc.id) ? prev : [...prev, doc]));
    if (triggerMatch?.type === "@") {
      setPrompt((prev) => stripTriggerFromPrompt(triggerMatch, prev));
    }
    setTriggerMatch(null);
    setMentionMenuOpen(false);
    textareaRef.current?.focus();
  };

  const handleSelectTemplate = (tpl: ComposerTemplateOption): void => {
    setActiveTemplateId(tpl.id);
    setPrompt((prev) => {
      const cleaned =
        triggerMatch?.type === "/" ? stripTriggerFromPrompt(triggerMatch, prev) : prev;
      return cleaned.trim() ? `${tpl.promptPrefix} ${cleaned}` : `${tpl.promptPrefix} `;
    });
    setTriggerMatch(null);
    setTemplateMenuOpen(false);
    textareaRef.current?.focus();
  };

  const canSubmit = !submitting && (prompt.trim().length > 0 || mentionedDocs.length > 0);

  const triggerSubmit = (): void => {
    if (!canSubmit) return;
    void Promise.resolve(
      onSubmit({
        prompt: prompt.trim(),
        mentionedDocIds: mentionedDocs.map((d) => d.id),
        templateId: activeTemplateId,
        suggestionMode,
        adeKind,
      }),
    )
      .then(() => {
        setPrompt("");
        setActiveTemplateId(null);
        setTriggerMatch(null);
      })
      .catch(() => {
        // Keep user input intact when submission fails
      });
  };

  if (collapsible && collapsed) {
    return (
      <div
        className={cn(
          "flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2",
          className,
        )}
        data-collapsed="true"
        data-slot="agent-composer-panel"
      >
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden="true"
            className={cn("size-1.5 shrink-0 rounded-full", getHostToneStyle(adeKind).dotClass)}
          />
          <span className="truncate text-xs font-medium text-foreground">
            {t("agentControl.composerCollapseLabel")}
          </span>
          <span className="hidden truncate text-[11px] text-muted-foreground sm:inline">
            · {t("agentControl.scopeBadgePrefix", { summary: scopeText })}
          </span>
        </div>
        <Button
          onClick={() => setCollapsed(false)}
          size="xs"
          type="button"
          variant="outline"
        >
          <ChevronDownIcon className="size-3.5" />
          <span>{t("agentControl.composerExpand")}</span>
        </Button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-lg border border-border bg-card shadow-[var(--shadow-card)] transition-[border-color,box-shadow] duration-[var(--duration-quick)] ease-[var(--ease-out-strong)] focus-within:border-foreground/25",
        className,
      )}
      data-collapsed="false"
      data-slot="agent-composer-panel"
    >
      {/* Recessed 34px Top Attachment & Scope Bar */}
      <div
        className="flex h-[34px] items-center justify-between gap-2 border-b border-border/70 bg-muted/50 px-3"
        data-slot="composer-attachment-bar"
      >
        <div className="flex min-w-0 items-center gap-1.5">
          {!hideHostPicker ? (
            <>
              <span
                aria-hidden="true"
                className={cn("size-1.5 shrink-0 rounded-full", getHostToneStyle(adeKind).dotClass)}
              />
              <div className="flex min-w-0 flex-wrap items-center gap-0.5" role="group">
                {hostOptions.map((kind) => (
                  <button
                    aria-pressed={adeKind === kind}
                    className={cn(
                      "cursor-pointer rounded-md px-1.5 py-0.5 text-[11px] font-medium transition-colors duration-[var(--duration-micro)] ease-[var(--ease-smooth-out)]",
                      adeKind === kind
                        ? "bg-card text-foreground ring-1 ring-border/70"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    data-ade-kind={kind}
                    key={kind}
                    onClick={() => setAdeKind(kind)}
                    type="button"
                  >
                    {formatAdeKindLabel(kind, t)}
                  </button>
                ))}
                {customHostOpen ? (
                  <div className="flex items-center gap-1 pl-1">
                    <input
                      aria-label={t("common.customHostLabel")}
                      className="h-5 w-28 rounded border border-border bg-background px-1.5 text-[11px] text-foreground outline-none focus:border-ring"
                      onChange={(e) => setCustomHostDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          e.stopPropagation();
                          applyCustomHost();
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          e.stopPropagation();
                          setCustomHostOpen(false);
                        }
                      }}
                      placeholder={t("common.customHostPlaceholder")}
                      type="text"
                      value={customHostDraft}
                    />
                    <button
                      className="cursor-pointer rounded border border-border/80 bg-card px-1.5 py-0.5 text-[10px] font-medium text-foreground hover:bg-muted"
                      onClick={applyCustomHost}
                      type="button"
                    >
                      {t("common.useCustomHostBtn")}
                    </button>
                  </div>
                ) : (
                  <button
                    aria-label={t("common.customHostLabel")}
                    className="inline-flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
                    onClick={() => setCustomHostOpen(true)}
                    title={t("common.customHostLabel")}
                    type="button"
                  >
                    <PlusIcon className="size-3" />
                  </button>
                )}
              </div>
            </>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <span
            className="inline-flex max-w-52 items-center gap-1 truncate rounded-md border border-border/80 bg-card px-1.5 py-0.5 text-[11px] text-muted-foreground"
            data-slot="composer-scope-badge"
          >
            <ShieldCheckIcon aria-hidden="true" className="size-3 shrink-0 text-[#16A34A] dark:text-emerald-400" />
            <span className="truncate">
              {t("agentControl.scopeBadgePrefix", { summary: scopeText })}
            </span>
          </span>
          {collapsible ? (
            <Button
              aria-label={t("agentControl.composerCollapse")}
              onClick={() => setCollapsed(true)}
              size="icon-xs"
              type="button"
              variant="ghost"
            >
              <ChevronDownIcon className="size-3.5" />
            </Button>
          ) : null}
        </div>
      </div>

      {/* Atomic @DocTitle Pills */}
      {mentionedDocs.length > 0 ? (
        <div
          className="flex flex-wrap items-center gap-1.5 border-b border-border/60 px-3 py-2"
          data-slot="composer-mention-pills"
        >
          {mentionedDocs.map((doc) => (
            <span
              className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/50 px-2 py-0.5 text-xs font-medium text-foreground"
              data-mention-doc-id={doc.id}
              key={doc.id}
            >
              <AtSignIcon aria-hidden="true" className="size-3 text-muted-foreground" />
              <span className="max-w-44 truncate">{doc.title}</span>
              <button
                aria-label={t("agentControl.removeMentionAria", { title: doc.title })}
                className="ml-0.5 inline-flex size-3.5 cursor-pointer items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={() =>
                  setMentionedDocs((prev) => prev.filter((item) => item.id !== doc.id))
                }
                type="button"
              >
                <XIcon className="size-2.5" />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      {/* Prompt Input Area */}
      <div className="px-2.5 pt-2">
        <Textarea
          className="min-h-14 border-0 bg-transparent shadow-none ring-0 before:hidden"
          onChange={(e) => {
            const val = e.target.value;
            setPrompt(val);
            const cursor = e.target.selectionStart ?? val.length;
            const match = detectComposerTrigger(val, cursor);
            setTriggerMatch(match);
            if (match?.type === "@") {
              setMentionMenuOpen(true);
              setTemplateMenuOpen(false);
            } else if (match?.type === "/") {
              setTemplateMenuOpen(true);
              setMentionMenuOpen(false);
            } else {
              setMentionMenuOpen(false);
              setTemplateMenuOpen(false);
            }
          }}
          onKeyDown={(e) => {
            const activeItemsCount = mentionMenuOpen
              ? filteredDocs.length
              : templateMenuOpen
                ? filteredTemplates.length
                : 0;
            if ((mentionMenuOpen || templateMenuOpen) && activeItemsCount > 0) {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                setActiveMenuIndex((prev) =>
                  stepMenuIndex(prev, e.key === "ArrowDown" ? 1 : -1, activeItemsCount),
                );
                return;
              }
              if (
                ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                const clamped = Math.min(activeMenuIndex, activeItemsCount - 1);
                if (mentionMenuOpen) {
                  const chosenDoc = filteredDocs[clamped];
                  if (chosenDoc) handleSelectMention(chosenDoc);
                } else {
                  const chosenTpl = filteredTemplates[clamped];
                  if (chosenTpl) handleSelectTemplate(chosenTpl);
                }
                return;
              }
            }
            if (e.key === "Escape" && (mentionMenuOpen || templateMenuOpen)) {
              e.preventDefault();
              setMentionMenuOpen(false);
              setTemplateMenuOpen(false);
              setTriggerMatch(null);
              return;
            }
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              triggerSubmit();
              return;
            }
            if (e.key === "Backspace") {
              const target = e.currentTarget;
              const { removed, nextMentionedDocs } = removeLastMentionOnBackspace(
                target.selectionStart ?? 0,
                target.selectionEnd ?? 0,
                mentionedDocs,
              );
              if (removed) {
                e.preventDefault();
                setMentionedDocs(nextMentionedDocs);
              }
            }
          }}
          placeholder={placeholder ?? t("agentControl.composerPlaceholder")}
          ref={textareaRef}
          size="sm"
          unstyled
          value={prompt}
        />
      </div>

      {/* Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 px-3 py-2">
        <div className="flex flex-wrap items-center gap-1">
          <Popover onOpenChange={setTemplateMenuOpen} open={templateMenuOpen}>
            <PopoverTrigger
              render={
                <Button size="xs" type="button" variant="ghost">
                  <SlashIcon className="size-3.5" />
                  <span>{t("agentControl.templatesTrigger")}</span>
                </Button>
              }
            />
            <PopoverPopup align="start" className="w-64" viewportClassName="p-1.5">
              <GlideHighlight className="flex flex-col gap-0.5" highlightClassName="rounded-[var(--radius-menu-item)] bg-accent" mode="highlighted">
                {filteredTemplates.map((tpl, idx) => (
                  <button
                    className="relative z-10 flex cursor-pointer flex-col items-start rounded-[var(--radius-menu-item)] px-2.5 py-1.5 text-left transition-colors data-highlighted:bg-accent in-data-[glide-visible=true]:data-highlighted:bg-transparent"
                    data-highlighted={idx === activeMenuIndex ? "" : undefined}
                    key={tpl.id}
                    onClick={() => handleSelectTemplate(tpl)}
                    onMouseEnter={() => setActiveMenuIndex(idx)}
                    type="button"
                  >
                    <span className="text-xs font-medium text-foreground">{tpl.label}</span>
                    <span className="line-clamp-1 text-[11px] text-muted-foreground">
                      {tpl.promptPrefix}
                    </span>
                  </button>
                ))}
              </GlideHighlight>
            </PopoverPopup>
          </Popover>

          <Popover onOpenChange={setMentionMenuOpen} open={mentionMenuOpen}>
            <PopoverTrigger
              render={
                <Button size="xs" type="button" variant="ghost">
                  <AtSignIcon className="size-3.5" />
                  <span>{t("agentControl.mentionsTrigger")}</span>
                </Button>
              }
            />
            <PopoverPopup align="start" className="w-72" viewportClassName="p-1.5">
              {filteredDocs.length === 0 ? (
                <p className="px-2.5 py-2 text-xs text-muted-foreground">
                  {t("agentControl.noMatchingDocs")}
                </p>
              ) : (
                <div className="max-h-56 overflow-y-auto">
                  <GlideHighlight className="flex flex-col gap-0.5" highlightClassName="rounded-[var(--radius-menu-item)] bg-accent" mode="highlighted">
                    {filteredDocs.map((doc, idx) => (
                      <button
                        className="relative z-10 flex cursor-pointer items-center justify-between gap-2 rounded-[var(--radius-menu-item)] px-2.5 py-1.5 text-left text-xs transition-colors data-highlighted:bg-accent in-data-[glide-visible=true]:data-highlighted:bg-transparent"
                        data-highlighted={idx === activeMenuIndex ? "" : undefined}
                        key={doc.id}
                        onClick={() => handleSelectMention(doc)}
                        onMouseEnter={() => setActiveMenuIndex(idx)}
                        type="button"
                      >
                        <span className="truncate font-medium text-foreground">{doc.title}</span>
                        <span className="shrink-0 font-mono text-[10px] uppercase text-muted-foreground">
                          {doc.kind}
                        </span>
                      </button>
                    ))}
                  </GlideHighlight>
                </div>
              )}
            </PopoverPopup>
          </Popover>

          <Button
            aria-pressed={suggestionMode}
            onClick={() => setSuggestionMode((prev) => !prev)}
            size="xs"
            type="button"
            variant={suggestionMode ? "secondary" : "ghost"}
          >
            <span
              aria-hidden="true"
              className={cn(
                "size-1.5 rounded-full",
                suggestionMode ? "bg-[#16A34A]" : "bg-muted-foreground/50",
              )}
            />
            <SparklesIcon className="size-3" />
            <span>
              {suggestionMode
                ? t("agentControl.suggestionModeActive")
                : t("agentControl.suggestionModeLabel")}
            </span>
          </Button>
        </div>

        <Button
          className="border-foreground bg-foreground text-background hover:bg-foreground/90"
          disabled={!canSubmit}
          loading={submitting}
          onClick={triggerSubmit}
          size="xs"
          type="button"
          variant="default"
        >
          <SendIcon className="size-3.5" />
          <span>{t("agentControl.dispatchThreadCta")}</span>
          <Kbd>⌘⏎</Kbd>
        </Button>
      </div>
    </div>
  );
}
