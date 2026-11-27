"use client";

import { useInkadeTranslation } from "@inkade/i18n";
import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { Trash2Icon } from "lucide-react";
import type React from "react";
import { Button } from "../../primitives/button.tsx";
import { InkadeArtifactBlock } from "../../patterns/InkadeArtifactBlock.tsx";
import { useEditorSurface } from "../context.tsx";

export function InkadeArtifactNodeView({
  deleteNode,
  node,
  selected,
  updateAttributes,
}: ReactNodeViewProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const {
    theme,
    paperMode,
    readOnly,
    onIssueArtifactTicket,
    onSubmitArtifactComment,
    onOpenSecuritySettings,
  } = useEditorSurface();

  const artifactId = String(node.attrs?.artifactId ?? "");
  const title = typeof node.attrs?.title === "string" ? node.attrs.title : undefined;
  const heightPx =
    typeof node.attrs?.height === "number" && Number.isFinite(node.attrs.height)
      ? node.attrs.height
      : undefined;

  return (
    <NodeViewWrapper
      className={
        selected ? "rounded-[var(--radius-card)] ring-2 ring-primary/35 ring-offset-1" : undefined
      }
      contentEditable={false}
      data-artifact-id={artifactId}
      data-type="inkade-artifact"
    >
      <InkadeArtifactBlock
        artifactId={artifactId}
        headerExtra={
          !readOnly ? (
            <Button
              aria-label={t("inkadeArtifact.deleteBlockAria")}
              className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive-foreground"
              onClick={deleteNode}
              size="icon-xs"
              title={t("inkadeArtifact.deleteBlockAria")}
              type="button"
              variant="ghost"
            >
              <Trash2Icon className="size-3.5" />
            </Button>
          ) : null
        }
        heightPx={heightPx}
        onIssueTicket={onIssueArtifactTicket}
        onOpenSecuritySettings={onOpenSecuritySettings}
        onSubmitComment={onSubmitArtifactComment}
        onUpdateHeight={
          readOnly
            ? undefined
            : (nextHeight) => {
                updateAttributes({ height: nextHeight });
              }
        }
        paperMode={paperMode}
        readOnly={readOnly}
        theme={theme}
        title={title}
      />
    </NodeViewWrapper>
  );
}
