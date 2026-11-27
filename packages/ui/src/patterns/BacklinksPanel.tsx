"use client";

import type {
  DocumentKind,
  DocumentLink,
  DocumentRecord,
  OutlineNode,
  UnlinkedMentionItem,
} from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import { ArrowUpRightIcon, Link2Icon, LinkIcon, ListTreeIcon } from "lucide-react";
import type React from "react";
import { useMemo } from "react";
import { cn } from "../lib/utils.ts";
import { Badge } from "../primitives/badge.tsx";
import { Button } from "../primitives/button.tsx";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../primitives/empty.tsx";
import { DocumentKindIcon } from "../primitives/tag-pill.tsx";

export interface BacklinksPanelProps {
  readonly links: readonly DocumentLink[];
  readonly unlinkedMentions?: readonly UnlinkedMentionItem[] | undefined;
  readonly sourceDocuments?: readonly Pick<DocumentRecord, "id" | "title" | "slug" | "kind">[] | undefined;
  readonly sourceNodes?: readonly Pick<OutlineNode, "id" | "documentId" | "contentText">[] | undefined;
  readonly onNavigate?: ((sourceDocumentId: string, sourceNodeId: string | null) => void) | undefined;
  readonly onLinkMention?: ((mention: UnlinkedMentionItem) => void) | undefined;
  readonly linkingMentionKey?: string | null | undefined;
  readonly className?: string | undefined;
}

export function BacklinksPanel({
  links,
  unlinkedMentions = [],
  sourceDocuments = [],
  sourceNodes = [],
  onNavigate,
  onLinkMention,
  linkingMentionKey,
  className,
}: BacklinksPanelProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const kindLabels: Readonly<Record<DocumentKind, string>> = {
    outline: t("common.kindOutline"),
    article: t("common.kindArticle"),
    clip: t("common.kindClip"),
  };

  const docMap = useMemo(
    () => new Map(sourceDocuments.map((doc) => [doc.id, doc])),
    [sourceDocuments],
  );

  const nodeMap = useMemo(
    () => new Map(sourceNodes.map((node) => [node.id, node])),
    [sourceNodes],
  );

  const grouped = useMemo(() => {
    const groups = new Map<
      string,
      {
        readonly sourceDocumentId: string;
        readonly title: string;
        readonly kind: DocumentKind | null;
        readonly items: DocumentLink[];
      }
    >();

    for (const link of links) {
      const existing = groups.get(link.sourceDocumentId);
      if (existing) {
        existing.items.push(link);
        continue;
      }
      const doc = docMap.get(link.sourceDocumentId);
      groups.set(link.sourceDocumentId, {
        sourceDocumentId: link.sourceDocumentId,
        title: doc?.title ?? link.sourceDocumentId,
        kind: doc?.kind ?? null,
        items: [link],
      });
    }
    return [...groups.values()];
  }, [links, docMap]);

  if (grouped.length === 0 && unlinkedMentions.length === 0) {
    return (
      <Empty className={cn("py-8", className)}>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Link2Icon />
          </EmptyMedia>
          <EmptyTitle>{t("reader.backlinksEmptyTitle")}</EmptyTitle>
          <EmptyDescription>{t("reader.backlinksEmptyDesc")}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {grouped.length === 0 ? (
        <div className="rounded-xl border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
          {t("reader.backlinksEmptyTitle")}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {grouped.map((group) => (
            <div
              className="rounded-lg border border-border bg-card p-3 text-card-foreground"
              key={group.sourceDocumentId}
            >
              <div className="flex items-center justify-between gap-2">
                <button
                  className="flex min-w-0 cursor-pointer items-center gap-2 text-left hover:underline"
                  onClick={() => onNavigate?.(group.sourceDocumentId, null)}
                  type="button"
                >
                  {group.kind && (
                    <Badge size="sm" variant="secondary">
                      {kindLabels[group.kind]}
                    </Badge>
                  )}
                  <span className="truncate text-sm font-semibold">{group.title}</span>
                </button>
                <Badge size="sm" variant="outline">
                  {group.items.length}
                </Badge>
              </div>

              <div className="mt-2.5 flex flex-col gap-1.5">
                {group.items.map((item) => {
                  const sourceNode = item.sourceNodeId ? nodeMap.get(item.sourceNodeId) : undefined;
                  return (
                    <button
                      className="group flex w-full cursor-pointer flex-col gap-1 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted/50"
                      key={item.id}
                      onClick={() => onNavigate?.(item.sourceDocumentId, item.sourceNodeId)}
                      type="button"
                    >
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                          {item.sourceNodeId ? (
                            <ListTreeIcon className="size-3.5 shrink-0" />
                          ) : (
                            <Link2Icon className="size-3.5 shrink-0" />
                          )}
                          <span className="truncate">
                            {sourceNode?.contentText ||
                              (item.anchorText ? `#${item.anchorText}` : t("reader.documentMention"))}
                          </span>
                        </div>
                        <ArrowUpRightIcon className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                      </div>
                      {item.contextSnippet && (
                        <p className="line-clamp-2 text-xs leading-relaxed text-foreground/85">
                          {item.contextSnippet}
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Unlinked Mentions */}
      <div className="flex flex-col gap-2 border-t pt-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t("reader.unlinkedMentionsTitle", { count: unlinkedMentions.length })}
          </span>
        </div>

        {unlinkedMentions.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("reader.unlinkedMentionsEmpty")}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {unlinkedMentions.map((mention) => {
              const mentionKey = `${mention.documentId}:${mention.nodeId ?? "doc"}`;
              const isLinking = linkingMentionKey === mentionKey;
              return (
                <div
                  className="flex flex-col gap-1.5 rounded-lg border border-border bg-card p-3 text-card-foreground"
                  key={mentionKey}
                >
                  <div className="flex items-center justify-between gap-2">
                    <button
                      className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left hover:underline"
                      onClick={() => onNavigate?.(mention.documentId, mention.nodeId)}
                      type="button"
                    >
                      <DocumentKindIcon kind={mention.kind} size="xs" />
                      <span className="truncate text-xs font-semibold">{mention.documentTitle}</span>
                    </button>
                    <Badge size="sm" variant="outline">
                      {t("reader.mentionCount", { count: mention.matchCount })}
                    </Badge>
                  </div>

                  {mention.snippet && (
                    <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                      {mention.snippet}
                    </p>
                  )}

                  {onLinkMention && (
                    <div className="flex justify-end">
                      <Button
                        loading={isLinking}
                        onClick={() => onLinkMention(mention)}
                        size="xs"
                        variant="outline"
                      >
                        <LinkIcon />
                        {t("reader.linkMentionAction")}
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
