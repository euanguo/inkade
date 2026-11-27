"use client";

import type { DocumentId, OutlineNode, OutlineNodeId } from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import { RepeatIcon, SearchIcon } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import { Button } from "../../primitives/button.tsx";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../../primitives/dialog.tsx";
import { Input } from "../../primitives/input.tsx";
import { ScrollArea } from "../../primitives/scroll-area.tsx";
import type { ProseMirrorWorkspaceDocSummary, WorkspaceOutlineSearchMatch } from "./types.ts";

export interface OutlineMirrorDialogProps {
  readonly state:
    | { readonly mode: "push"; readonly sourceNode: OutlineNode }
    | {
        readonly mode: "pull";
        readonly insertAfterNodeId?: OutlineNodeId | undefined;
        readonly parentNodeId?: OutlineNodeId | null | undefined;
        readonly pmItemPos?: number | undefined;
      }
    | null;
  readonly currentDocumentId: DocumentId;
  readonly workspaceDocs: readonly ProseMirrorWorkspaceDocSummary[];
  readonly localNodes: readonly OutlineNode[];
  readonly onSearchWorkspaceNodes?:
    | ((query: string) => Promise<readonly WorkspaceOutlineSearchMatch[]>)
    | undefined;
  readonly onConfirmPushMirror: (
    sourceNode: OutlineNode,
    targetDocumentId: DocumentId,
  ) => Promise<void>;
  readonly onConfirmPullMirror: (match: WorkspaceOutlineSearchMatch) => Promise<void>;
  readonly onClose: () => void;
}

export function OutlineMirrorDialog({
  state,
  currentDocumentId,
  workspaceDocs,
  localNodes,
  onSearchWorkspaceNodes,
  onConfirmPushMirror,
  onConfirmPullMirror,
  onClose,
}: OutlineMirrorDialogProps): React.ReactElement | null {
  const { t } = useInkadeTranslation();
  const [query, setQuery] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [matches, setMatches] = useState<readonly WorkspaceOutlineSearchMatch[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!state) {
      setQuery("");
      setMatches([]);
      return;
    }
    if (state.mode !== "pull") return;

    let cancelled = false;
    const trimmed = query.trim();

    if (!onSearchWorkspaceNodes) {
      const localMatches: WorkspaceOutlineSearchMatch[] = localNodes
        .filter(
          (n) =>
            n.deletedAt === null &&
            (!trimmed || n.contentText.toLowerCase().includes(trimmed.toLowerCase())),
        )
        .slice(0, 20)
        .map((node) => ({
          node,
          documentId: currentDocumentId,
          documentTitle: t("outline.defaultTitle"),
        }));
      setMatches(localMatches);
      return;
    }

    setSearching(true);
    const timer = setTimeout(() => {
      void onSearchWorkspaceNodes(trimmed)
        .then((res) => {
          if (!cancelled) setMatches(res);
        })
        .catch(() => {
          if (!cancelled) setMatches([]);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 150);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [currentDocumentId, localNodes, onSearchWorkspaceNodes, query, state, t]);

  if (!state) return null;

  const outlineDocs = workspaceDocs.filter(
    (d) =>
      d.kind === "outline" &&
      d.id !== currentDocumentId &&
      (!query.trim() || d.title.toLowerCase().includes(query.trim().toLowerCase())),
  );

  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open>
      <DialogPopup className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RepeatIcon className="size-4 text-teal-600 dark:text-teal-400" />
            <span>{t("mirrorNode.mirrorPickerTitle")}</span>
          </DialogTitle>
        </DialogHeader>

        <DialogPanel className="flex flex-col gap-3">
          {state.mode === "push" ? (
            <>
              <div className="rounded-md border border-border/70 bg-muted/40 px-3 py-2 text-xs text-foreground">
                {state.sourceNode.contentText || state.sourceNode.contentMarkdown}
              </div>
              <p className="text-xs text-muted-foreground">
                {t("mirrorNode.mirrorPickerTargetDocLabel")}
              </p>
            </>
          ) : null}

          <Input
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("mirrorNode.mirrorPickerSearchPlaceholder")}
            size="sm"
            startAddon={<SearchIcon />}
            value={query}
          />

          <ScrollArea className="max-h-64 rounded-lg border border-border/70">
            <div className="flex flex-col divide-y divide-border/50 p-1">
              {state.mode === "push" ? (
                outlineDocs.length === 0 ? (
                  <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                    {t("mirrorNode.mirrorPickerEmpty")}
                  </p>
                ) : (
                  outlineDocs.map((doc) => (
                    <button
                      className="flex cursor-pointer items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-xs transition-colors hover:bg-accent"
                      disabled={submitting}
                      key={doc.id}
                      onClick={() => {
                        setSubmitting(true);
                        void onConfirmPushMirror(state.sourceNode, doc.id).finally(() => {
                          setSubmitting(false);
                          onClose();
                        });
                      }}
                      type="button"
                    >
                      <span className="truncate font-medium text-foreground">{doc.title}</span>
                      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                        {doc.slug}
                      </span>
                    </button>
                  ))
                )
              ) : searching ? (
                <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                  {t("mirrorNode.mirrorPickerCreating")}
                </p>
              ) : matches.length === 0 ? (
                <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                  {t("mirrorNode.mirrorPickerEmpty")}
                </p>
              ) : (
                matches.map((m) => (
                  <button
                    className="flex cursor-pointer flex-col gap-0.5 rounded-md px-3 py-2 text-left text-xs transition-colors hover:bg-accent"
                    disabled={submitting}
                    key={m.node.id}
                    onClick={() => {
                      setSubmitting(true);
                      void onConfirmPullMirror(m).finally(() => {
                        setSubmitting(false);
                        onClose();
                      });
                    }}
                    type="button"
                  >
                    <span className="truncate font-medium text-foreground">
                      {m.node.contentText || m.node.contentMarkdown}
                    </span>
                    <span className="truncate text-[11px] text-muted-foreground">
                      {m.documentTitle}
                    </span>
                  </button>
                ))
              )}
            </div>
          </ScrollArea>
        </DialogPanel>

        <DialogFooter>
          <Button onClick={onClose} size="sm" type="button" variant="outline">
            {t("common.cancel")}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
