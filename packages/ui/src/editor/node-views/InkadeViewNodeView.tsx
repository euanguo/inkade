"use client";

import { useInkadeTranslation } from "@inkade/i18n";
import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { CheckIcon, Code2Icon, Trash2Icon } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import { Button } from "../../primitives/button.tsx";
import { Textarea } from "../../primitives/textarea.tsx";
import { InkadeViewBlock } from "../../patterns/InkadeViewBlock.tsx";
import { useEditorSurface } from "../context.tsx";

export function InkadeViewNodeView({
  deleteNode,
  node,
  selected,
  updateAttributes,
}: ReactNodeViewProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const {
    workspaceDocs,
    spaces,
    readOnly,
    onQueryInkadeView,
    embeddedViewSnapshots,
    onOpenDocument,
    onOpenWikilink,
  } = useEditorSurface();
  const rawYaml = String(node.attrs?.rawYaml ?? "");
  const [editingYaml, setEditingYaml] = useState(false);
  const [draftYaml, setDraftYaml] = useState(rawYaml);

  useEffect(() => {
    setDraftYaml(rawYaml);
  }, [rawYaml]);

  const snapshot =
    embeddedViewSnapshots?.[rawYaml] ?? embeddedViewSnapshots?.[rawYaml.trim()] ?? undefined;

  return (
    <NodeViewWrapper
      className={selected ? "rounded-xl ring-2 ring-primary/35 ring-offset-1" : undefined}
      contentEditable={false}
      data-type="inkade-view"
    >
      <InkadeViewBlock
        embeddedSnapshot={snapshot}
        headerExtra={
          !readOnly ? (
            <div className="flex items-center gap-1">
              <Button
                aria-label={t("editor.inkadeViewEditYaml")}
                onClick={() => setEditingYaml((prev) => !prev)}
                size="icon-xs"
                title={t("editor.inkadeViewEditYaml")}
                type="button"
                variant={editingYaml ? "secondary" : "ghost"}
              >
                <Code2Icon className="size-3.5" />
              </Button>
              <span aria-hidden="true" className="mx-0.5 h-3.5 w-px bg-border" />
              <Button
                aria-label={t("common.delete")}
                className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive-foreground"
                onClick={deleteNode}
                size="icon-xs"
                title={t("common.delete")}
                type="button"
                variant="ghost"
              >
                <Trash2Icon className="size-3.5" />
              </Button>
            </div>
          ) : null
        }
        onOpenDocument={onOpenDocument}
        onOpenWikilink={onOpenWikilink}
        onQueryInkadeView={onQueryInkadeView}
        rawYaml={rawYaml}
        spaces={spaces}
        workspaceDocs={workspaceDocs}
      />

      {!readOnly && editingYaml && (
        <div
          className="mb-3 flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-2.5"
          onKeyDown={(e) => e.stopPropagation()}
        >
          <Textarea
            className="min-h-24 font-mono text-xs"
            onChange={(e) => setDraftYaml(e.target.value)}
            placeholder={t("editor.inkadeViewYamlPlaceholder")}
            value={draftYaml}
          />
          <div className="flex justify-end gap-1.5">
            <Button
              onClick={() => {
                updateAttributes({ rawYaml: draftYaml.trimEnd() });
                setEditingYaml(false);
              }}
              size="xs"
              type="button"
            >
              <CheckIcon className="size-3" />
              <span>{t("editor.inkadeViewApplyYaml")}</span>
            </Button>
          </div>
        </div>
      )}
    </NodeViewWrapper>
  );
}
