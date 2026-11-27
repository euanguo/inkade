import type {
  ActorType,
  AdeThreadBinding,
  AttachmentRecord,
  DocumentRevision,
  RelatedDocumentHit,
  ShareLink,
  ShareLinkId,
  ThreadBindingId,
  UnlinkedMentionItem,
} from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import { inkadeQueryKeys } from "@inkade/sdk";
import {
  useInkadeAttachments,
  useInkadeBacklinks,
  useInkadeDocumentGraph,
  useInkadeDocuments,
  useInkadeRelatedDocuments,
  useInkadeRevisionDiff,
  useInkadeRevisions,
  useInkadeShareLinks,
  useInkadeSpaces,
  useInkadeThreadBindings,
  useInkadeUnlinkedMentions,
} from "@inkade/sdk/react";
import {
  Badge,
  Button,
  DocumentKindIcon,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  ScrollArea,
  SpaceIcon,
  Tabs,
  TabsList,
  TabsTab,
  TagList,
} from "@inkade/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { BotIcon, HistoryIcon, Link2Icon, PanelRightCloseIcon, XIcon } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { type InspectorTab, useInspector } from "../hooks/use-inspector.tsx";
import { getInkadeClient, getStoredBearerToken } from "../lib/api.ts";
import { showErrorToast, showSuccessToast } from "../lib/undo.ts";
import { computeExpiryIso, insertWikilinkOnce, type ShareExpiryPreset } from "./inspector/helpers.ts";
import { InspectorBacklinksTab } from "./inspector/InspectorBacklinksTab.tsx";
import { InspectorDocumentExtras } from "./inspector/InspectorDocumentExtras.tsx";
import { InspectorRevisionsTab } from "./inspector/InspectorRevisionsTab.tsx";
import { InspectorThreadsTab } from "./inspector/InspectorThreadsTab.tsx";

export interface InspectorPanelProps {
  readonly isDrawer?: boolean | undefined;
}

export function InspectorPanel({
  isDrawer = false,
}: InspectorPanelProps = {}): React.ReactElement {
  const { t } = useInkadeTranslation();
  const { open, setOpen, activeTab, setActiveTab, target } = useInspector();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const doc = target.document;
  const docId = doc?.id ?? null;
  const [selectedRevision, setSelectedRevision] = useState<DocumentRevision | null>(null);
  const [backlinksView, setBacklinksView] = useState<"links" | "graph">("links");
  const [graphDepth, setGraphDepth] = useState<1 | 2>(2);
  const [linkingMentionKey, setLinkingMentionKey] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareExpiry, setShareExpiry] = useState<ShareExpiryPreset>("7d");
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);

  const actorLabels: Readonly<Record<ActorType, string>> = {
    human: t("common.actorHuman"),
    agent: t("common.actorAgent"),
    system: t("common.actorSystem"),
  };

  useEffect(() => {
    setSelectedRevision(null);
  }, [docId]);

  const spacesQuery = useInkadeSpaces({ enabled: Boolean(open && doc) });
  const docSpace = useMemo(
    () => (doc ? (spacesQuery.data ?? []).find((s) => s.id === doc.spaceId) ?? null : null),
    [doc, spacesQuery.data],
  );

  const bindingsQuery = useInkadeThreadBindings(
    docId ? { documentId: docId } : {},
    { enabled: Boolean(open && docId) },
  );
  const backlinksQuery = useInkadeBacklinks(open ? (docId ?? undefined) : undefined);
  const unlinkedMentionsQuery = useInkadeUnlinkedMentions(
    open && activeTab === "backlinks" && backlinksView === "links" ? (docId ?? undefined) : undefined,
  );
  const graphQuery = useInkadeDocumentGraph(
    open && activeTab === "backlinks" && backlinksView === "graph" ? (docId ?? undefined) : undefined,
    graphDepth,
  );
  const allDocsQuery = useInkadeDocuments(
    { limit: 300 },
    { enabled: Boolean(open && docId && activeTab === "backlinks") },
  );
  const relatedQuery = useInkadeRelatedDocuments(
    open && activeTab === "backlinks" ? (docId ?? undefined) : undefined,
    8,
  );
  const attachmentsQuery = useInkadeAttachments(
    docId ? { documentId: docId } : {},
    { enabled: Boolean(open && docId) },
  );
  const revisionsQuery = useInkadeRevisions(
    open && activeTab === "revisions" ? (docId ?? undefined) : undefined,
  );
  const shareLinksQuery = useInkadeShareLinks(docId ?? undefined, {
    enabled: Boolean(open && docId),
  });
  const diffQuery = useInkadeRevisionDiff(
    docId ?? undefined,
    selectedRevision?.version,
    doc?.version,
    {
      enabled: Boolean(
        open &&
          docId &&
          doc &&
          selectedRevision &&
          selectedRevision.version !== doc.version,
      ),
    },
  );

  const markReadMutation = useMutation({
    mutationFn: (bindingId: ThreadBindingId) =>
      getInkadeClient().threadBindings.update(bindingId, { unreadResult: false }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: [...inkadeQueryKeys.all, "thread-bindings"],
      });
    },
    onError: (err) => showErrorToast(t("inspector.markReadFailed"), err),
  });

  const unbindMutation = useMutation({
    mutationFn: (bindingId: ThreadBindingId) => getInkadeClient().threadBindings.delete(bindingId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: [...inkadeQueryKeys.all, "thread-bindings"],
      });
      showSuccessToast(t("inspector.unboundThread"));
    },
    onError: (err) => showErrorToast(t("inspector.unbindFailed"), err),
  });

  const restoreMutation = useMutation({
    mutationFn: (version: number) => {
      if (!docId) throw new Error("Missing docId");
      return getInkadeClient().documents.restoreRevision(docId, version);
    },
    onSuccess: (restored) => {
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.document(restored.id) });
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.revisions(restored.id) });
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.outlineNodes(restored.id) });
      if (doc?.dailyDate) {
        void queryClient.invalidateQueries({
          queryKey: inkadeQueryKeys.dailyOutline(doc.dailyDate),
        });
      }
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "documents"] });
      setSelectedRevision(null);
      showSuccessToast(
        t("inspector.restoredToVersion", { version: restored.version }),
        t("inspector.restoredSnapshotDesc"),
      );
    },
    onError: (err) => showErrorToast(t("inspector.restoreRevisionFailed"), err),
  });

  const linkMentionMutation = useMutation({
    mutationFn: async (mention: UnlinkedMentionItem) => {
      if (!doc) return;
      const client = getInkadeClient();
      if (mention.nodeId) {
        const nodes = await client.outlineNodes.list(mention.documentId);
        const targetNode = nodes.find((n) => n.id === mention.nodeId);
        if (!targetNode) throw new Error(t("inspector.mentionSourceMissing"));
        const updatedText = insertWikilinkOnce(targetNode.contentMarkdown, doc.title);
        if (!updatedText) throw new Error(t("inspector.mentionTextMissing"));
        await client.outlineNodes.update(targetNode.id, { contentMarkdown: updatedText });
      } else {
        const sourceDoc = await client.documents.get(mention.documentId);
        const updatedMd = insertWikilinkOnce(sourceDoc.contentMarkdown, doc.title);
        if (!updatedMd) throw new Error(t("inspector.mentionTextMissing"));
        await client.documents.update(sourceDoc.id, {
          contentMarkdown: updatedMd,
          expectedVersion: sourceDoc.version,
        });
      }
    },
    onSuccess: () => {
      setLinkingMentionKey(null);
      if (docId) {
        void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.backlinks(docId) });
        void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.unlinkedMentions(docId) });
        void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.documentGraph(docId, graphDepth) });
      }
      showSuccessToast(t("reader.linkedMentionToast"));
    },
    onError: (err) => {
      setLinkingMentionKey(null);
      showErrorToast(t("reader.linkMentionFailed"), err);
    },
  });

  const createShareMutation = useMutation({
    mutationFn: () => {
      if (!docId) throw new Error("Missing docId");
      return getInkadeClient().shareLinks.create({
        documentId: docId,
        expiresAt: computeExpiryIso(shareExpiry),
      });
    },
    onSuccess: () => {
      if (docId) {
        void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.shareLinks(docId) });
      }
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "share-links"] });
      showSuccessToast(t("inspector.shareLinkCreated"));
    },
    onError: (err) => showErrorToast(t("inspector.shareLinkCreateFailed"), err),
  });

  const revokeShareMutation = useMutation({
    mutationFn: (shareLinkId: ShareLinkId) => getInkadeClient().shareLinks.revoke(shareLinkId),
    onSuccess: () => {
      if (docId) {
        void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.shareLinks(docId) });
      }
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "share-links"] });
      showSuccessToast(t("inspector.shareLinkRevoked"));
    },
    onError: (err) => showErrorToast(t("inspector.shareLinkRevokeFailed"), err),
  });

  const handleOpenBinding = (binding: AdeThreadBinding): void => {
    if (binding.deepLink) {
      window.open(binding.deepLink, "_blank", "noopener,noreferrer");
      return;
    }
    void navigate({ to: "/threads" });
  };

  const bindings = bindingsQuery.data ?? [];
  const filteredBindings = target.selectedNodeId
    ? bindings.filter((b) => b.nodeId === target.selectedNodeId)
    : bindings;

  const activeShareLinks = useMemo<readonly ShareLink[]>(() => {
    const all = shareLinksQuery.data ?? [];
    const now = Date.now();
    return all.filter(
      (link) =>
        link.revokedAt === null &&
        (!link.expiresAt || new Date(link.expiresAt).getTime() > now),
    );
  }, [shareLinksQuery.data]);

  const handleOpenRelatedDoc = (hit: RelatedDocumentHit): void => {
    const matched = (allDocsQuery.data ?? []).find((item) => item.id === hit.documentId);
    if (matched?.kind === "outline" && matched.dailyDate) {
      void navigate({ to: "/daily/$date", params: { date: matched.dailyDate }, search: {} });
      return;
    }
    void navigate({ to: "/docs/$docId", params: { docId: hit.documentId } });
  };

  const handleDownloadAttachment = async (
    event: React.MouseEvent<HTMLAnchorElement>,
    att: AttachmentRecord,
  ): Promise<void> => {
    if (!getStoredBearerToken()) {
      return;
    }
    event.preventDefault();
    try {
      const bytes = await getInkadeClient().attachments.download(att.id);
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      const blob = new Blob([copy], { type: att.mimeType || "application/octet-stream" });
      const blobUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = blobUrl;
      anchor.download = att.filename;
      anchor.click();
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      showErrorToast(t("inspector.downloadAttachmentFailed"), err);
    }
  };

  const relatedDocs = relatedQuery.data ?? [];
  const docAttachments = attachmentsQuery.data ?? [];

  return (
    <div className="flex h-full flex-col bg-sidebar text-foreground">
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 px-3.5">
        <p className="truncate text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t("inspector.title")}
        </p>
        <Button
          aria-label={t("inspector.closeAria")}
          onClick={() => setOpen(false)}
          size="icon-xs"
          variant="ghost"
        >
          {isDrawer ? <XIcon /> : <PanelRightCloseIcon />}
        </Button>
      </div>

      {doc && (
        <div className="shrink-0 border-b border-border/60 px-3.5 py-2.5">
          <div className="flex items-center gap-1.5">
            <DocumentKindIcon kind={doc.kind} size="xs" />
            <p className="truncate text-sm font-medium">{doc.title}</p>
          </div>
          {(docSpace || doc.tags.length > 0) && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {docSpace && (
                <span className="inline-flex items-center gap-1 rounded-md border bg-background/70 px-1.5 py-0.5 text-[11px] text-muted-foreground">
                  <SpaceIcon color={docSpace.color} icon={docSpace.icon} size="xs" />
                  <span className="truncate">{docSpace.name}</span>
                </span>
              )}
              <TagList
                className="min-w-20 flex-1"
                formatOverflow={(count) => t("library.moreTagsCount", { count })}
                maxFallbackVisible={3}
                size="sm"
                tags={doc.tags}
              />
            </div>
          )}
        </div>
      )}

      {!doc ? (
        <Empty className="py-12">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BotIcon />
            </EmptyMedia>
            <EmptyTitle>{t("inspector.emptyTitle")}</EmptyTitle>
            <EmptyDescription>{t("inspector.emptyDesc")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Tabs
          className="flex min-h-0 flex-1 flex-col gap-0"
          onValueChange={(val) => setActiveTab(val as InspectorTab)}
          value={activeTab}
        >
          <div className="border-b border-border/60 px-3 py-2">
            <TabsList className="w-full" size="sm">
              <TabsTab value="threads">
                <BotIcon />
                {t("inspector.tabThreads")}
                {filteredBindings.length > 0 && (
                  <Badge className="ms-1" size="sm" variant="secondary">
                    {filteredBindings.length}
                  </Badge>
                )}
              </TabsTab>
              <TabsTab value="backlinks">
                <Link2Icon />
                {t("inspector.tabBacklinks")}
              </TabsTab>
              <TabsTab value="revisions">
                <HistoryIcon />
                {t("inspector.tabRevisions")}
              </TabsTab>
            </TabsList>
          </div>

          <ScrollArea className="min-h-0 flex-1" scrollFade>
            <div className="flex flex-col gap-4 p-3.5">
              <InspectorThreadsTab
                bindings={filteredBindings}
                isError={bindingsQuery.isError}
                isPending={bindingsQuery.isPending}
                onMarkRead={(bindingId) => markReadMutation.mutate(bindingId)}
                onOpenInAde={handleOpenBinding}
                onRetry={() => void bindingsQuery.refetch()}
                onUnbind={(bindingId) => unbindMutation.mutate(bindingId)}
              />

              <InspectorBacklinksTab
                allDocs={allDocsQuery.data ?? []}
                backlinks={backlinksQuery.data ?? []}
                backlinksError={backlinksQuery.isError}
                backlinksPending={backlinksQuery.isPending}
                backlinksView={backlinksView}
                graphData={graphQuery.data}
                graphDepth={graphDepth}
                graphPending={graphQuery.isPending}
                linkingMentionKey={linkingMentionKey}
                onChangeBacklinksView={setBacklinksView}
                onChangeGraphDepth={setGraphDepth}
                onLinkMention={(mention) => {
                  setLinkingMentionKey(`${mention.documentId}:${mention.nodeId ?? "doc"}`);
                  linkMentionMutation.mutate(mention);
                }}
                onNavigateBacklink={(sourceDocumentId, sourceNodeId) => {
                  void navigate({
                    to: "/docs/$docId",
                    params: { docId: sourceDocumentId },
                    ...(sourceNodeId ? { hash: sourceNodeId } : {}),
                  });
                }}
                onOpenRelatedDoc={handleOpenRelatedDoc}
                onRetryBacklinks={() => void backlinksQuery.refetch()}
                onSelectGraphDoc={(targetDocId) => {
                  void navigate({ to: "/docs/$docId", params: { docId: targetDocId } });
                }}
                relatedDocs={relatedDocs}
                relatedPending={relatedQuery.isPending}
                spaces={spacesQuery.data ?? []}
                unlinkedMentions={unlinkedMentionsQuery.data ?? []}
              />

              <InspectorRevisionsTab
                actorLabels={actorLabels}
                diffData={diffQuery.data}
                diffPending={diffQuery.isPending}
                docVersion={doc.version}
                isError={revisionsQuery.isError}
                isPending={revisionsQuery.isPending}
                onRestore={(version) => restoreMutation.mutate(version)}
                onRetry={() => void revisionsQuery.refetch()}
                onSelectRevision={setSelectedRevision}
                restoring={restoreMutation.isPending}
                revisions={revisionsQuery.data ?? []}
                selectedRevision={selectedRevision}
              />

              <InspectorDocumentExtras
                activeShareLinks={activeShareLinks}
                attachments={docAttachments}
                attachmentsOpen={attachmentsOpen}
                attachmentsPending={attachmentsQuery.isPending}
                creatingShare={createShareMutation.isPending}
                onAttachmentsOpenChange={setAttachmentsOpen}
                onCreateShare={() => createShareMutation.mutate()}
                onDownloadAttachment={(event, att) => void handleDownloadAttachment(event, att)}
                onRevokeShare={(shareLinkId) => revokeShareMutation.mutate(shareLinkId)}
                onShareExpiryChange={setShareExpiry}
                onShareOpenChange={setShareOpen}
                shareExpiry={shareExpiry}
                shareOpen={shareOpen}
              />
            </div>
          </ScrollArea>
        </Tabs>
      )}
    </div>
  );
}
