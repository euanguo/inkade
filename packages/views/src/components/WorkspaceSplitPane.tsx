import {
  asDocumentId,
  type BatchOutlineNodesResult,
  type CreateOutlineNodeInput,
  type DocumentId,
  type MoveOutlineNodeInput,
  type OutlineBatchOperation,
  type OutlineNodeId,
  type Space,
  type UpdateOutlineNodeInput,
} from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import { inkadeQueryKeys } from "@inkade/sdk";
import {
  useInkadeClient,
  useInkadeDailyOutline,
  useInkadeDocument,
  useInkadeDocuments,
  useInkadeOutlineNodes,
  useInkadeSpaces,
} from "@inkade/sdk/react";
import {
  ArticleReader,
  Button,
  ProseMirrorOutlineEditor,
  ScrollArea,
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from "@inkade/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRightIcon, CalendarDaysIcon, Columns2Icon, XIcon } from "lucide-react";
import type React from "react";
import { useCallback, useMemo } from "react";
import { useInkadeViewsContext } from "../context.tsx";
import { getTodayDailyDate } from "../lib/dates.ts";
import { useReaderTypography, useThemePreference } from "../lib/preferences-store.ts";
import {
  DocumentDetailSkeleton,
  OutlineTreeSkeleton,
} from "./ViewSkeletons.tsx";

const EMPTY_DOCS: readonly never[] = [];
const EMPTY_SPACES: readonly Space[] = [];

export interface WorkspaceSplitPaneProps {
  readonly primaryDocumentId?: DocumentId | null | undefined;
  readonly isPrimaryDailyToday?: boolean | undefined;
  readonly splitMode: "doc" | "daily";
  readonly splitDocId: DocumentId | null;
  readonly onChangeSplitMode: (mode: "doc" | "daily") => void;
  readonly onChangeSplitDocId: (docId: DocumentId | null) => void;
  readonly onClose: () => void;
  readonly onSwapPrimary?: ((targetDocId: DocumentId) => void) | undefined;
}

export function WorkspaceSplitPane({
  primaryDocumentId = null,
  isPrimaryDailyToday = false,
  splitMode,
  splitDocId,
  onChangeSplitMode,
  onChangeSplitDocId,
  onClose,
  onSwapPrimary,
}: WorkspaceSplitPaneProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const client = useInkadeClient();
  const queryClient = useQueryClient();
  const { navigation, hostActions, notifier } = useInkadeViewsContext();
  const { effectiveTheme } = useThemePreference();
  const { typography } = useReaderTypography();
  const today = useMemo(() => getTodayDailyDate(), []);

  const handleIssueArtifactTicket = useCallback(
    (artifactId: Parameters<typeof client.artifacts.issueSandboxTicket>[0]) =>
      client.artifacts.issueSandboxTicket(artifactId),
    [client],
  );

  const handleSubmitArtifactComment = useCallback(
    (
      artifactId: Parameters<typeof client.artifacts.submitComment>[0],
      input: Parameters<typeof client.artifacts.submitComment>[1],
    ) => client.artifacts.submitComment(artifactId, input),
    [client],
  );

  const handleOpenSecuritySettings = useCallback(() => {
    navigation.openSettings?.("security");
  }, [navigation]);

  const spacesQuery = useInkadeSpaces();
  const allDocsQuery = useInkadeDocuments({ limit: 300 });
  const spaces = spacesQuery.data ?? EMPTY_SPACES;
  const workspaceDocs = allDocsQuery.data ?? EMPTY_DOCS;

  const secondaryDocs = useMemo(
    () =>
      workspaceDocs.filter(
        (d) =>
          d.id !== primaryDocumentId &&
          d.trashedAt === null &&
          !(splitMode === "daily" && d.dailyDate === today),
      ),
    [primaryDocumentId, splitMode, today, workspaceDocs],
  );

  const splitDocQuery = useInkadeDocument(
    splitMode === "doc" ? (splitDocId ?? undefined) : undefined,
  );
  const splitDocNodesQuery = useInkadeOutlineNodes(
    splitMode === "doc" && splitDocId && splitDocQuery.data?.kind === "outline"
      ? splitDocId
      : undefined,
  );
  const splitDailyQuery = useInkadeDailyOutline(today, {
    enabled: splitMode === "daily",
  });

  const handleSplitOutlineBatch = useCallback(
    async (
      operations: readonly OutlineBatchOperation[],
    ): Promise<BatchOutlineNodesResult | void> => {
      if (!splitDocId) return;
      try {
        const result = await client.outlineNodes.batch({
          documentId: splitDocId,
          operations: [...operations],
        });
        queryClient.setQueryData(inkadeQueryKeys.outlineNodes(splitDocId), result.nodes);
        return result;
      } catch (err) {
        notifier.error(t("daily.batchSaveFailed"), err);
        void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.outlineNodes(splitDocId) });
        return undefined;
      }
    },
    [client.outlineNodes, notifier, queryClient, splitDocId, t],
  );

  const invalidateDaily = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.dailyOutline(today) });
  }, [queryClient, today]);

  const splitCreateNodeMutation = useMutation({
    mutationFn: (input: CreateOutlineNodeInput) => client.outlineNodes.create(input),
    onSuccess: invalidateDaily,
    onError: (err) => notifier.error(t("daily.batchSaveFailed"), err),
  });

  const splitUpdateNodeMutation = useMutation({
    mutationFn: ({ nodeId, patch }: { readonly nodeId: OutlineNodeId; readonly patch: UpdateOutlineNodeInput }) =>
      client.outlineNodes.update(nodeId, patch),
    onSuccess: invalidateDaily,
    onError: (err) => notifier.error(t("daily.batchSaveFailed"), err),
  });

  const splitMoveNodeMutation = useMutation({
    mutationFn: ({ nodeId, move }: { readonly nodeId: OutlineNodeId; readonly move: MoveOutlineNodeInput }) =>
      client.outlineNodes.move(nodeId, move),
    onSuccess: invalidateDaily,
    onError: (err) => notifier.error(t("daily.batchSaveFailed"), err),
  });

  const splitDeleteNodeMutation = useMutation({
    mutationFn: (nodeId: OutlineNodeId) => client.outlineNodes.delete(nodeId),
    onSuccess: invalidateDaily,
    onError: (err) => notifier.error(t("daily.batchSaveFailed"), err),
  });

  const handleOpenWikilink = useCallback(
    (targetSlugOrTitle: string) => {
      const clean = targetSlugOrTitle.trim().toLowerCase();
      if (!clean) return;
      const matched = workspaceDocs.find(
        (d) =>
          d.id.toLowerCase() === clean ||
          d.slug.toLowerCase() === clean ||
          d.title.toLowerCase() === clean,
      );
      if (matched) {
        onChangeSplitDocId(matched.id);
        onChangeSplitMode("doc");
      } else {
        notifier.error(t("document.referencedDocNotFound", { target: targetSlugOrTitle }));
      }
    },
    [notifier, onChangeSplitDocId, onChangeSplitMode, t, workspaceDocs],
  );

  const readerFont =
    typography.fontFamily === "serif"
      ? "serif"
      : typography.fontFamily === "mono"
        ? "mono"
        : "sans";
  const readerMeasure = typography.measure;
  const activeSwapTargetDocId =
    splitMode === "doc" ? splitDocQuery.data?.id : splitDailyQuery.data?.document.id;

  return (
    <aside
      aria-label={t("document.splitPaneHeader")}
      className="flex h-full min-h-0 w-full flex-col bg-background print:hidden"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/30 px-3 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <Button
            disabled={isPrimaryDailyToday}
            onClick={() => onChangeSplitMode("daily")}
            size="xs"
            variant={splitMode === "daily" ? "secondary" : "ghost"}
          >
            <CalendarDaysIcon />
            {t("document.splitPaneTodayDaily")}
          </Button>

          <Select
            onValueChange={(val) => {
              if (val && val !== primaryDocumentId) {
                onChangeSplitDocId(asDocumentId(val));
                onChangeSplitMode("doc");
              }
            }}
            value={splitMode === "doc" ? (splitDocId ?? "") : ""}
          >
            <SelectTrigger className="min-w-0 flex-1" size="sm">
              <SelectValue placeholder={t("splitView.switchTargetPlaceholder")}>
                {splitMode === "daily"
                  ? (splitDailyQuery.data?.document.title ?? t("document.splitPaneTodayDaily"))
                  : splitDocId
                    ? (secondaryDocs.find((d) => d.id === splitDocId)?.title ??
                      (splitDocQuery.data?.id === splitDocId
                        ? splitDocQuery.data.title
                        : splitDocId))
                    : t("splitView.switchTargetPlaceholder")}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {(splitDocQuery.data &&
              splitDocQuery.data.id !== primaryDocumentId &&
              !secondaryDocs.slice(0, 60).some((d) => d.id === splitDocQuery.data?.id)
                ? [splitDocQuery.data, ...secondaryDocs.slice(0, 59)]
                : secondaryDocs.slice(0, 60)
              ).map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.title}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          {activeSwapTargetDocId ? (
            <Button
              aria-label={t("splitView.swapPanes")}
              onClick={() => {
                if (onSwapPrimary) {
                  onSwapPrimary(activeSwapTargetDocId);
                  return;
                }
                if (primaryDocumentId && primaryDocumentId !== activeSwapTargetDocId) {
                  hostActions.requestOpenSplitDoc?.(primaryDocumentId);
                }
                navigation.openDocument(activeSwapTargetDocId);
              }}
              size="icon-xs"
              title={t("splitView.swapPanes")}
              variant="ghost"
            >
              <ArrowLeftRightIcon />
            </Button>
          ) : null}

          <Button
            aria-label={t("splitView.closeSplit")}
            onClick={onClose}
            size="icon-xs"
            title={t("splitView.closeSplit")}
            variant="ghost"
          >
            <XIcon />
          </Button>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1" overscrollContain>
        <div className="p-4">
          {splitMode === "daily" ? (
            isPrimaryDailyToday ||
            (primaryDocumentId && splitDailyQuery.data?.document.id === primaryDocumentId) ? (
              <p className="p-6 text-center text-xs text-muted-foreground">
                {t("editor.splitPaneDuplicateDailyHint")}
              </p>
            ) : splitDailyQuery.isPending ? (
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between border-b pb-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-5 w-20 rounded-full" />
                </div>
                <OutlineTreeSkeleton compact rows={5} />
              </div>
            ) : splitDailyQuery.data ? (
              <div className="flex flex-col gap-3">
                <ProseMirrorOutlineEditor
                  documentId={splitDailyQuery.data.document.id}
                  nodes={splitDailyQuery.data.nodes}
                  onCreateNode={(input) => splitCreateNodeMutation.mutate(input)}
                  onDeleteNode={(nodeId) => splitDeleteNodeMutation.mutate(nodeId)}
                  onMoveNode={(nodeId, move) => splitMoveNodeMutation.mutate({ nodeId, move })}
                  onOpenDocument={handleOpenWikilink}
                  onUpdateNode={(nodeId, patch) =>
                    splitUpdateNodeMutation.mutate({ nodeId, patch })
                  }
                  rootTitle={splitDailyQuery.data.document.title}
                  workspaceDocs={workspaceDocs}
                />
              </div>
            ) : null
          ) : splitDocId ? (
            splitDocQuery.isPending ? (
              <DocumentDetailSkeleton compact />
            ) : splitDocQuery.data ? (
              splitDocQuery.data.kind === "outline" ? (
                splitDocNodesQuery.isPending ? (
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between border-b pb-2">
                      <Skeleton className="h-4 w-36" />
                    </div>
                    <OutlineTreeSkeleton compact rows={5} />
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    <ProseMirrorOutlineEditor
                      documentId={splitDocQuery.data.id}
                      nodes={splitDocNodesQuery.data ?? []}
                      onBatchMutate={handleSplitOutlineBatch}
                      onOpenDocument={handleOpenWikilink}
                      rootTitle={splitDocQuery.data.title}
                      workspaceDocs={workspaceDocs}
                    />
                  </div>
                )
              ) : (
                <ArticleReader
                  document={splitDocQuery.data}
                  enableKeyboardNav={false}
                  onIssueArtifactTicket={handleIssueArtifactTicket}
                  onOpenSecuritySettings={handleOpenSecuritySettings}
                  onOpenWikilink={handleOpenWikilink}
                  onSubmitArtifactComment={handleSubmitArtifactComment}
                  readerFont={readerFont}
                  readerMeasure={readerMeasure}
                  showToc={false}
                  spaces={spaces}
                  theme={effectiveTheme}
                  workspaceDocs={workspaceDocs}
                />
              )
            ) : null
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
              <Columns2Icon className="size-6 text-muted-foreground/60" />
              <div className="text-sm font-medium text-foreground">{t("splitView.emptyTitle")}</div>
              <p className="max-w-xs text-xs text-muted-foreground">{t("splitView.emptyDesc")}</p>
              <p className="text-[11px] text-muted-foreground/80">
                {t("splitView.openCommandPaletteHint")}
              </p>
            </div>
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}
