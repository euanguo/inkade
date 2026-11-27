import type {
  AdeThreadBinding,
  BatchOutlineNodesResult,
  DocumentId,
  OutlineBatchOperation,
  OutlineNode,
  ThreadBindingId,
} from "@inkade/core";
import { useInkadeLocale, useInkadeTranslation } from "@inkade/i18n";
import { type DailyOutlineResponse, inkadeQueryKeys } from "@inkade/sdk";
import {
  useInkadeClient,
  useInkadeDailyOutline,
  useInkadeThreadBindings,
} from "@inkade/sdk/react";
import {
  Badge,
  Button,
  type OutlineDeferTarget,
  ProseMirrorOutlineEditor,
  type ProseMirrorWorkspaceDocSummary,
} from "@inkade/ui";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRightIcon } from "lucide-react";
import type React from "react";
import type { DispatchAdeTarget } from "../../components/DispatchAdeDialog.tsx";
import type { PromoteNodeTarget } from "../../components/PromoteNodeDialog.tsx";
import { OutlineTreeSkeleton } from "../../components/ViewSkeletons.tsx";
import { useInkadeViewsContext } from "../../context.tsx";
import { formatDailyHeading, getRelativeDailyBadge } from "../../lib/dates.ts";

export interface StreamDayCardProps {
  readonly dayDate: string;
  readonly todayStr: string;
  readonly allDocs: readonly ProseMirrorWorkspaceDocSummary[];
  readonly workspaceTags: readonly string[];
  readonly rolloverDocDatesById: ReadonlyMap<DocumentId, string>;
  readonly readOnly?: boolean | undefined;
  readonly onFocusDay: (date: string) => void;
  readonly onOpenDocument: (target: string) => void;
  readonly onOpenDate: (date: string) => void;
  readonly onClickTag: (tag: string) => void;
  readonly onDispatch: (target: DispatchAdeTarget) => void;
  readonly onPromote: (target: PromoteNodeTarget) => void;
  readonly onDeferNode: (
    sourceDocumentId: DocumentId,
    sourceDate: string,
    sourceNodes: readonly OutlineNode[],
    node: OutlineNode,
    target: OutlineDeferTarget,
  ) => Promise<{ readonly targetDocId: DocumentId; readonly targetDate: string } | void>;
  readonly onOpenBinding: (binding: AdeThreadBinding) => void;
  readonly onMarkBindingRead: (bindingId: ThreadBindingId) => void;
  readonly onUnbindBinding: (bindingId: ThreadBindingId) => void;
}

export function StreamDayCard({
  dayDate,
  todayStr,
  allDocs,
  workspaceTags,
  rolloverDocDatesById,
  readOnly = false,
  onFocusDay,
  onOpenDocument,
  onOpenDate,
  onClickTag,
  onDispatch,
  onPromote,
  onDeferNode,
  onOpenBinding,
  onMarkBindingRead,
  onUnbindBinding,
}: StreamDayCardProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const { locale } = useInkadeLocale();
  const client = useInkadeClient();
  const { notifier } = useInkadeViewsContext();
  const queryClient = useQueryClient();

  const dayQueryKey = inkadeQueryKeys.dailyOutline(dayDate);
  const dayQuery = useInkadeDailyOutline(dayDate);

  const doc = dayQuery.data?.document ?? null;
  const nodes = dayQuery.data?.nodes ?? [];

  const bindingsQuery = useInkadeThreadBindings(
    doc?.id ? { documentId: doc.id } : {},
    { enabled: Boolean(doc?.id) },
  );

  const handleBatchMutate = async (
    operations: readonly OutlineBatchOperation[],
  ): Promise<BatchOutlineNodesResult | void> => {
    if (!doc) return;
    try {
      const result = await client.outlineNodes.batch({
        documentId: doc.id,
        operations: [...operations],
      });
      queryClient.setQueryData<DailyOutlineResponse>(dayQueryKey, (prev) =>
        prev ? { ...prev, nodes: result.nodes } : prev,
      );
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.workspaceSummary() });
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "tasks"] });
      return result;
    } catch (err) {
      notifier.error(t("daily.batchSaveFailed"), err);
      void queryClient.invalidateQueries({ queryKey: dayQueryKey });
      return undefined;
    }
  };

  const relBadge = getRelativeDailyBadge(dayDate, todayStr);

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 pb-2.5">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-foreground">
            {formatDailyHeading(dayDate, locale)}
          </h2>
          {relBadge && (
            <Badge size="sm" variant="outline">
              {relBadge}
            </Badge>
          )}
        </div>
        <Button onClick={() => onFocusDay(dayDate)} size="xs" variant="ghost">
          <span>{t("daily.openThisDay")}</span>
          <ArrowRightIcon className="size-3.5" />
        </Button>
      </div>

      {dayQuery.isPending || !doc ? (
        <OutlineTreeSkeleton compact rows={3} />
      ) : (
        <ProseMirrorOutlineEditor
          bindings={bindingsQuery.data ?? []}
          deferBaseDate={dayDate}
          documentId={doc.id}
          nodes={nodes}
          onBatchMutate={handleBatchMutate}
          onClickTag={onClickTag}
          onDeferNode={(node, target) => onDeferNode(doc.id, dayDate, nodes, node, target)}
          onDispatchToAde={(node) =>
            onDispatch({
              documentId: doc.id,
              documentTitle: doc.title,
              nodeId: node.id,
              excerpt: node.contentText || node.contentMarkdown,
            })
          }
          onMarkBindingRead={(b) => onMarkBindingRead(b.id)}
          onOpenBinding={onOpenBinding}
          onOpenDate={onOpenDate}
          onOpenDocument={onOpenDocument}
          onPromoteToArticle={(rootNode, subtree) =>
            onPromote({ documentId: doc.id, rootNode, subtree })
          }
          onUnbindBinding={(b) => onUnbindBinding(b.id)}
          readOnly={readOnly}
          rolloverDocDatesById={rolloverDocDatesById}
          rootTitle={dayDate}
          workspaceDocs={allDocs}
          workspaceTags={workspaceTags}
        />
      )}
    </section>
  );
}
