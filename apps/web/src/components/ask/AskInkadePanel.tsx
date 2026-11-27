import {
  type AskCitation,
  type AskContextMode,
  type DocumentId,
  type SavedViewId,
  type SemanticSearchMode,
  type SpaceId,
  todayLocalDateString,
} from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import { inkadeQueryKeys } from "@inkade/sdk";
import {
  useInkadeClient,
  useInkadeDocuments,
  useInkadeSavedViews,
  useInkadeSpaces,
} from "@inkade/sdk/react";
import {
  Badge,
  Button,
  CitedAnswerCard,
  type CitedSourceItem,
  CopyButton,
  Input,
  ScrollArea,
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
  Textarea,
  ThinkingIndicator,
  cn,
} from "@inkade/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  AlertCircleIcon,
  BotMessageSquareIcon,
  FilePlus2Icon,
  SendIcon,
  Settings2Icon,
  SparklesIcon,
  SquareIcon,
  Trash2Icon,
} from "lucide-react";
import type React from "react";
import { useCallback, useMemo, useRef, useState } from "react";
import { showErrorToast, showSuccessToast } from "../../lib/undo.ts";

export interface AskInkadePanelProps {
  readonly variant?: "page" | "drawer" | undefined;
  readonly onClose?: (() => void) | undefined;
}

export function AskInkadePanel({
  variant = "page",
  onClose,
}: AskInkadePanelProps): React.ReactElement {
  const { t, i18n } = useInkadeTranslation();
  const client = useInkadeClient();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const spacesQuery = useInkadeSpaces();
  const savedViewsQuery = useInkadeSavedViews();
  const docsQuery = useInkadeDocuments({ limit: 300 });

  const spaces = useMemo(
    () => (spacesQuery.data ?? []).filter((s) => !s.archivedAt),
    [spacesQuery.data],
  );
  const savedViews = savedViewsQuery.data ?? [];
  const activeDocs = useMemo(
    () => (docsQuery.data ?? []).filter((d) => d.trashedAt === null),
    [docsQuery.data],
  );

  const [question, setQuestion] = useState("");
  const [submittedQuestion, setSubmittedQuestion] = useState("");
  const [contextMode, setContextMode] = useState<AskContextMode>("all");
  const [selectedSpaceId, setSelectedSpaceId] = useState<string>("");
  const [selectedViewId, setSelectedViewId] = useState<string>("");
  const [selectedTag, setSelectedTag] = useState("");
  const [docSearchQuery, setDocSearchQuery] = useState("");
  const [selectedDocIds, setSelectedDocIds] = useState<readonly DocumentId[]>([]);
  const [searchMode, setSearchMode] = useState<SemanticSearchMode>("hybrid");

  const [isStreaming, setIsStreaming] = useState(false);
  const [answerText, setAnswerText] = useState("");
  const [citations, setCitations] = useState<readonly AskCitation[]>([]);
  const [fallbackMode, setFallbackMode] = useState(false);
  const [metaProvider, setMetaProvider] = useState("");
  const [metaModel, setMetaModel] = useState("");
  const [streamError, setStreamError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const filteredPickDocs = useMemo(() => {
    const q = docSearchQuery.trim().toLowerCase();
    const list = q
      ? activeDocs.filter((d) => d.title.toLowerCase().includes(q))
      : activeDocs;
    return list.slice(0, 24);
  }, [activeDocs, docSearchQuery]);

  const targetLanguage: "zh-CN" | "en-US" =
    i18n.language === "en-US" || i18n.language.startsWith("en") ? "en-US" : "zh-CN";

  const handleToggleDoc = useCallback((docId: DocumentId) => {
    setSelectedDocIds((prev) =>
      prev.includes(docId)
        ? prev.filter((id) => id !== docId)
        : prev.length < 10
          ? [...prev, docId]
          : prev,
    );
  }, []);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
  }, []);

  const handleClear = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
    setSubmittedQuestion("");
    setAnswerText("");
    setCitations([]);
    setFallbackMode(false);
    setMetaProvider("");
    setMetaModel("");
    setStreamError(null);
  }, []);

  const runAsk = useCallback(
    async (promptText: string) => {
      const clean = promptText.trim();
      if (!clean) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setSubmittedQuestion(clean);
      setQuestion("");
      setAnswerText("");
      setCitations([]);
      setFallbackMode(false);
      setMetaProvider("");
      setMetaModel("");
      setStreamError(null);
      setIsStreaming(true);

      const resolvedSpaceId =
        contextMode === "space" && selectedSpaceId
          ? (selectedSpaceId as SpaceId)
          : undefined;
      const resolvedViewId =
        contextMode === "savedView" && selectedViewId
          ? (selectedViewId as SavedViewId)
          : undefined;
      const resolvedTag = contextMode === "tag" && selectedTag.trim() ? selectedTag.trim() : undefined;
      const resolvedDocs =
        contextMode === "documents" && selectedDocIds.length > 0 ? [...selectedDocIds] : undefined;

      try {
        const result = await client.ai.askStream(
          {
            question: clean,
            limit: 8,
            mode: searchMode,
            targetLanguage,
            context: {
              mode: contextMode,
              ...(resolvedSpaceId ? { spaceId: resolvedSpaceId } : {}),
              ...(resolvedViewId ? { savedViewId: resolvedViewId } : {}),
              ...(resolvedTag ? { tag: resolvedTag } : {}),
              ...(resolvedDocs ? { documentIds: resolvedDocs } : {}),
            },
          },
          {
            signal: controller.signal,
            onMeta: (meta) => {
              setCitations(meta.citations);
              setFallbackMode(meta.fallbackMode);
              setMetaProvider(meta.provider);
              setMetaModel(meta.model);
            },
            onDelta: (_chunk, accumulated) => {
              setAnswerText(accumulated);
            },
          },
        );
        setAnswerText(result.fullText);
        setCitations(result.citations);
        setFallbackMode(result.fallbackMode);
        setMetaProvider(result.provider);
        setMetaModel(result.model);
      } catch (err) {
        if (!controller.signal.aborted) {
          const msg = err instanceof Error ? err.message : t("common.unknownError");
          setStreamError(msg);
        }
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
        setIsStreaming(false);
      }
    },
    [
      client.ai,
      contextMode,
      searchMode,
      selectedDocIds,
      selectedSpaceId,
      selectedTag,
      selectedViewId,
      t,
      targetLanguage,
    ],
  );

  const citedCardItems: readonly CitedSourceItem[] = useMemo(() => {
    const terms = submittedQuestion
      .split(/\s+/)
      .map((w) => w.trim())
      .filter((w) => w.length >= 2)
      .slice(0, 6);

    return citations.map((cite) => ({
      id: `${cite.docId}:${cite.index}`,
      index: cite.index,
      documentId: cite.docId,
      spaceId: cite.spaceId,
      headingPath: cite.headingPath,
      nodeId: cite.nodeId,
      documentTitle: cite.title,
      excerpt: cite.excerpt,
      highlightTerms: terms,
      kind: cite.kind,
    }));
  }, [citations, submittedQuestion]);

  const handleOpenCitation = useCallback(
    (cite: CitedSourceItem) => {
      if (!cite.documentId) return;
      void navigate({
        to: "/docs/$docId",
        params: { docId: cite.documentId },
        search: {
          ...(cite.nodeId ? { nodeId: cite.nodeId } : {}),
          ...(cite.headingPath ? { heading: cite.headingPath } : {}),
        },
      });
      onClose?.();
    },
    [navigate, onClose],
  );

  const buildMarkdownExport = useCallback((): string => {
    const lines = [
      `## ${t("ask.articleQuestionHeading")}`,
      "",
      submittedQuestion,
      "",
      `## ${t("ask.articleAnswerHeading")}`,
      "",
      answerText.trim(),
    ];
    if (citations.length > 0) {
      lines.push("", `## ${t("ask.articleCitationsHeading")}`, "");
      for (const c of citations) {
        const anchor = c.headingPath ? ` — ${c.headingPath}` : "";
        lines.push(`- [${c.index}] [[${c.title}]]${anchor}`);
      }
    }
    return lines.join("\n");
  }, [answerText, citations, submittedQuestion, t]);

  const saveArticleMutation = useMutation({
    mutationFn: async () => {
      const targetSpaceId =
        (contextMode === "space" && selectedSpaceId
          ? (selectedSpaceId as SpaceId)
          : undefined) ??
        spaces.find((s) => s.slug === "research")?.id ??
        spaces[0]?.id;
      if (!targetSpaceId) {
        throw new Error(t("ask.pickSpacePlaceholder"));
      }
      const rawTitle = submittedQuestion.trim() || t("ask.pageTitle");
      const title = rawTitle.length > 90 ? `${rawTitle.slice(0, 89)}…` : rawTitle;
      return client.documents.create({
        spaceId: targetSpaceId,
        kind: "article",
        title,
        contentMarkdown: buildMarkdownExport(),
        tags: ["ask-inkade"],
      });
    },
    onSuccess: (doc) => {
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "documents"] });
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.workspaceSummary() });
      showSuccessToast(t("ask.savedAsArticleToast"));
      void navigate({ to: "/docs/$docId", params: { docId: doc.id } });
      onClose?.();
    },
    onError: (err) => showErrorToast(t("ask.saveArticleFailedToast"), err),
  });

  const sendAdeMutation = useMutation({
    mutationFn: async () => {
      const today = todayLocalDateString();
      const daily = await client.documents.getDaily(today);
      const summaryLine = submittedQuestion.trim().slice(0, 140);
      const refLine = citations
        .slice(0, 4)
        .map((c) => `[[${c.title}]]`)
        .join(" ");
      const node = await client.outlineNodes.create({
        documentId: daily.document.id,
        parentNodeId: null,
        contentMarkdown: `${summaryLine}${refLine ? ` — ${refLine}` : ""} #ask-inkade`,
        checked: false,
      });
      await client.threadBindings.upsert({
        documentId: daily.document.id,
        nodeId: node.id,
        adeKind: "any",
        externalThreadId: `thr_ask_${Date.now().toString(36)}`,
        title: summaryLine.slice(0, 80),
        status: "queued",
        lastSummary: answerText.trim().slice(0, 500),
        unreadResult: false,
      });
      return today;
    },
    onSuccess: (today) => {
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.dailyOutline(today) });
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "thread-bindings"] });
      showSuccessToast(t("ask.sentToAdeToast"));
    },
    onError: (err) => showErrorToast(t("ask.sendToAdeFailedToast"), err),
  });

  const suggestions = [
    t("ask.suggestion1"),
    t("ask.suggestion2"),
    t("ask.suggestion3"),
  ];

  const hasConversation = Boolean(submittedQuestion || answerText || citations.length > 0 || streamError);

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col gap-3.5",
        variant === "drawer" ? "p-4" : "",
      )}
    >
      {/* Scope & Retrieval Controls */}
      <div className="flex flex-col gap-2.5 rounded-xl border bg-card/60 p-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {t("ask.contextModeLabel")}
            </span>
            <div className="w-40">
              <Select
                onValueChange={(val) => {
                  if (
                    val === "all" ||
                    val === "space" ||
                    val === "tag" ||
                    val === "savedView" ||
                    val === "documents"
                  ) {
                    setContextMode(val);
                  }
                }}
                value={contextMode}
              >
                <SelectTrigger aria-label={t("ask.contextModeLabel")} size="sm">
                  <SelectValue>
                    {contextMode === "space"
                      ? t("ask.modeSpace")
                      : contextMode === "tag"
                        ? t("ask.modeTag")
                        : contextMode === "savedView"
                          ? t("ask.modeSavedView")
                          : contextMode === "documents"
                            ? t("ask.modeDocuments")
                            : t("ask.modeAll")}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value="all">{t("ask.modeAll")}</SelectItem>
                  <SelectItem value="space">{t("ask.modeSpace")}</SelectItem>
                  <SelectItem value="tag">{t("ask.modeTag")}</SelectItem>
                  <SelectItem value="savedView">{t("ask.modeSavedView")}</SelectItem>
                  <SelectItem value="documents">{t("ask.modeDocuments")}</SelectItem>
                </SelectPopup>
              </Select>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="shrink-0 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {t("ask.searchModeLabel")}
            </span>
            <div className="w-36">
              <Select
                onValueChange={(val) => {
                  if (val === "hybrid" || val === "semantic" || val === "keyword") {
                    setSearchMode(val);
                  }
                }}
                value={searchMode}
              >
                <SelectTrigger aria-label={t("ask.searchModeLabel")} size="sm">
                  <SelectValue>
                    {searchMode === "semantic"
                      ? t("ask.searchSemantic")
                      : searchMode === "keyword"
                        ? t("ask.searchKeyword")
                        : t("ask.searchHybrid")}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value="hybrid">{t("ask.searchHybrid")}</SelectItem>
                  <SelectItem value="semantic">{t("ask.searchSemantic")}</SelectItem>
                  <SelectItem value="keyword">{t("ask.searchKeyword")}</SelectItem>
                </SelectPopup>
              </Select>
            </div>
          </div>
        </div>

        {contextMode === "space" ? (
          <Select
            onValueChange={(v) => setSelectedSpaceId(v ?? "")}
            value={selectedSpaceId}
          >
            <SelectTrigger aria-label={t("ask.pickSpacePlaceholder")} size="sm">
              <SelectValue placeholder={t("ask.pickSpacePlaceholder")} />
            </SelectTrigger>
            <SelectPopup>
              {spaces.map((space) => (
                <SelectItem key={space.id} value={space.id}>
                  {space.name}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        ) : null}

        {contextMode === "savedView" ? (
          <Select
            onValueChange={(v) => setSelectedViewId(v ?? "")}
            value={selectedViewId}
          >
            <SelectTrigger aria-label={t("ask.pickSavedViewPlaceholder")} size="sm">
              <SelectValue placeholder={t("ask.pickSavedViewPlaceholder")} />
            </SelectTrigger>
            <SelectPopup>
              {savedViews.map((view) => (
                <SelectItem key={view.id} value={view.id}>
                  {view.name}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        ) : null}

        {contextMode === "tag" ? (
          <Input
            aria-label={t("ask.modeTag")}
            onChange={(e) => setSelectedTag(e.target.value)}
            placeholder={t("ask.tagPlaceholder")}
            size="sm"
            value={selectedTag}
          />
        ) : null}

        {contextMode === "documents" ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Input
                aria-label={t("ask.pickDocsPlaceholder")}
                className="flex-1"
                onChange={(e) => setDocSearchQuery(e.target.value)}
                placeholder={t("ask.pickDocsPlaceholder")}
                size="sm"
                value={docSearchQuery}
              />
              <Badge size="sm" variant="secondary">
                {t("ask.selectedDocsCount", { count: selectedDocIds.length })}
              </Badge>
            </div>
            <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto pt-0.5">
              {filteredPickDocs.map((doc) => {
                const picked = selectedDocIds.includes(doc.id);
                return (
                  <button
                    className={cn(
                      "inline-flex max-w-48 cursor-pointer items-center truncate rounded-md border px-2 py-0.5 text-xs transition-colors duration-[var(--duration-micro)]",
                      picked
                        ? "border-foreground bg-foreground text-background"
                        : "border-border bg-background text-foreground hover:bg-muted",
                    )}
                    key={doc.id}
                    onClick={() => handleToggleDoc(doc.id)}
                    type="button"
                  >
                    <span className="truncate">{doc.title}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>

      {/* Results & Streaming Answer */}
      <ScrollArea className="min-h-0 flex-1 pr-1">
        {!hasConversation ? (
          <div className="flex flex-col items-start justify-center gap-3 rounded-xl border border-dashed bg-muted/20 p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <SparklesIcon className="size-4 text-primary" />
              <span>{t("ask.emptyTitle")}</span>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">{t("ask.emptyDesc")}</p>
            <div className="flex flex-wrap gap-2 pt-1">
              {suggestions.map((item) => (
                <button
                  className="cursor-pointer rounded-full border bg-card px-3 py-1 text-left text-xs text-foreground transition-colors duration-[var(--duration-micro)] hover:bg-muted"
                  key={item}
                  onClick={() => {
                    setQuestion(item);
                    void runAsk(item);
                  }}
                  type="button"
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4 pb-2">
            {submittedQuestion ? (
              <div className="rounded-lg border bg-muted/40 px-3.5 py-2.5 text-sm font-medium text-foreground">
                {submittedQuestion}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                {isStreaming ? (
                  <ThinkingIndicator label={t("ask.streaming")} size="sm" />
                ) : null}
                {metaProvider ? (
                  <Badge size="sm" variant={fallbackMode ? "secondary" : "success"}>
                    {fallbackMode
                      ? t("ask.offlineEvidenceBadge")
                      : t("ask.llmBadge", { provider: metaProvider, model: metaModel })}
                  </Badge>
                ) : null}
                {citations.length > 0 ? (
                  <Badge size="sm" variant="outline">
                    {t("ask.citationsHeading", { count: citations.length })}
                  </Badge>
                ) : null}
              </div>

              {fallbackMode ? (
                <Button
                  onClick={() => {
                    void navigate({ to: "/settings/$section", params: { section: "rag" } });
                    onClose?.();
                  }}
                  size="xs"
                  variant="ghost"
                >
                  <Settings2Icon className="size-3" />
                  <span>{t("ask.configureAiLink")}</span>
                </Button>
              ) : null}
            </div>

            {fallbackMode && !answerText ? (
              <p className="text-xs text-muted-foreground">{t("ask.offlineTip")}</p>
            ) : null}

            {streamError ? (
              <div
                className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
                role="alert"
              >
                <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
                <span>
                  {t("ask.errorPrefix")}
                  {streamError}
                </span>
              </div>
            ) : null}

            {answerText || citedCardItems.length > 0 ? (
              <CitedAnswerCard
                answer={answerText}
                citations={citedCardItems}
                defaultExpandedIndex={citedCardItems.length > 0 ? 0 : null}
                onOpenSource={handleOpenCitation}
                streaming={isStreaming}
              />
            ) : !isStreaming && !streamError ? (
              <p className="text-xs text-muted-foreground">{t("ask.noCitations")}</p>
            ) : null}

            {!isStreaming && answerText.trim().length > 0 ? (
              <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                <CopyButton
                  copiedLabel={t("ask.copiedAnswerToast")}
                  label={t("ask.copyAnswer")}
                  showLabel
                  size="sm"
                  value={buildMarkdownExport()}
                  variant="outline"
                />
                <Button
                  disabled={spaces.length === 0}
                  loading={saveArticleMutation.isPending}
                  onClick={() => saveArticleMutation.mutate()}
                  size="sm"
                  variant="outline"
                >
                  <FilePlus2Icon className="size-3.5" />
                  <span>
                    {saveArticleMutation.isPending
                      ? t("ask.savingArticle")
                      : t("ask.saveAsArticle")}
                  </span>
                </Button>
                <Button
                  loading={sendAdeMutation.isPending}
                  onClick={() => sendAdeMutation.mutate()}
                  size="sm"
                  variant="outline"
                >
                  <BotMessageSquareIcon className="size-3.5" />
                  <span>
                    {sendAdeMutation.isPending ? t("ask.sendingToAde") : t("ask.sendToAde")}
                  </span>
                </Button>
                <Button
                  className="ml-auto"
                  onClick={handleClear}
                  size="sm"
                  variant="ghost"
                >
                  <Trash2Icon className="size-3.5" />
                  <span>{t("ask.clear")}</span>
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </ScrollArea>

      {/* Question Input Bar */}
      <form
        className="flex flex-col gap-2 rounded-xl border border-border bg-card p-2.5 shadow-[var(--shadow-card)] transition-colors focus-within:border-foreground/30"
        onSubmit={(e) => {
          e.preventDefault();
          void runAsk(question);
        }}
      >
        <Textarea
          aria-label={t("ask.pageTitle")}
          className="min-h-[60px] resize-none border-0 bg-transparent px-1 py-1 text-sm shadow-none focus-visible:ring-0"
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void runAsk(question);
            }
          }}
          placeholder={t("ask.placeholder")}
          rows={variant === "drawer" ? 2 : 3}
          value={question}
        />
        <div className="flex items-center justify-end gap-2 border-t border-border/50 pt-2">
          {isStreaming ? (
            <Button onClick={handleStop} size="xs" type="button" variant="outline">
              <SquareIcon className="size-3.5" />
              <span>{t("ask.stop")}</span>
            </Button>
          ) : (
            <Button disabled={!question.trim()} size="xs" type="submit">
              <SendIcon className="size-3.5" />
              <span>{t("ask.submit")}</span>
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
