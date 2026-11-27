"use client";

import type { DocumentKind } from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { FilePlus2Icon } from "lucide-react";
import type React from "react";
import { useMemo } from "react";
import { cn } from "../../lib/utils.ts";
import { Badge } from "../../primitives/badge.tsx";
import { Button } from "../../primitives/button.tsx";
import {
  PreviewCard,
  PreviewCardPopup,
  PreviewCardTrigger,
} from "../../primitives/preview-card.tsx";
import { SpaceIcon } from "../../primitives/space-icon.tsx";
import { DocumentKindIcon, TagPill } from "../../primitives/tag-pill.tsx";
import { parseWikilinkInner } from "../../patterns/remark-inkade-wikilinks.ts";
import { useEditorSurface } from "../context.tsx";

export function WikilinkNodeView({
  node,
  selected,
}: ReactNodeViewProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const { onCreateMissingDoc, onOpenWikilink, spaces, workspaceDocs } = useEditorSurface();
  const target = String(node.attrs?.target ?? "");
  const parsed = parseWikilinkInner(target);
  const cleanTarget = parsed?.target ?? (target.split("|")[0]?.split("#")[0]?.trim() ?? target);
  const displayText = parsed?.displayText ?? target;
  const normalized = cleanTarget.toLowerCase();

  const matchedDoc = useMemo(
    () =>
      workspaceDocs.find(
        (d) =>
          d.id.toLowerCase() === normalized ||
          d.slug.toLowerCase() === normalized ||
          d.title.toLowerCase() === normalized,
      ),
    [normalized, workspaceDocs],
  );

  const matchedSpace = useMemo(
    () => (matchedDoc?.spaceId ? spaces.find((s) => s.id === matchedDoc.spaceId) : undefined),
    [matchedDoc?.spaceId, spaces],
  );

  const kindLabels: Readonly<Record<DocumentKind, string>> = {
    outline: t("common.kindOutline"),
    article: t("common.kindArticle"),
    clip: t("common.kindClip"),
  };

  return (
    <NodeViewWrapper
      as="span"
      className="inline"
      contentEditable={false}
      data-target={target}
      data-type="inkade-wikilink"
    >
      <PreviewCard>
        <PreviewCardTrigger
          delay={200}
          render={
            <button
              className={cn(
                "inkade-wikilink-pill inline cursor-pointer [box-decoration-break:clone] rounded-sm px-1 py-[1px] leading-snug font-medium underline underline-offset-2 transition-colors",
                matchedDoc
                  ? "bg-brand-subtle/75 text-brand-subtle-foreground decoration-primary/40 hover:bg-brand-subtle"
                  : "border-b border-dashed border-muted-foreground/60 bg-muted/60 text-muted-foreground no-underline hover:bg-muted",
                selected && "outline-1 outline-foreground/40",
              )}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (matchedDoc) {
                  onOpenWikilink?.(target, e);
                } else if (onCreateMissingDoc) {
                  onCreateMissingDoc(cleanTarget);
                } else {
                  onOpenWikilink?.(target, e);
                }
              }}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              type="button"
            />
          }
        >
          {displayText}
        </PreviewCardTrigger>
        <PreviewCardPopup align="start" className="not-typeset w-76">
          {matchedDoc ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <Badge size="sm" variant="secondary">
                  <DocumentKindIcon kind={matchedDoc.kind} size="xs" />
                  {kindLabels[matchedDoc.kind]}
                </Badge>
                {matchedSpace && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                    <SpaceIcon color={matchedSpace.color} icon={matchedSpace.icon} size="xs" />
                    <span className="truncate">{matchedSpace.name}</span>
                  </span>
                )}
              </div>
              <p className="text-sm font-semibold text-foreground">{matchedDoc.title}</p>
              {matchedDoc.excerpt && (
                <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">
                  {matchedDoc.excerpt}
                </p>
              )}
              {matchedDoc.tags && matchedDoc.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-0.5">
                  {matchedDoc.tags.slice(0, 4).map((tag) => (
                    <TagPill key={tag} size="sm" tag={tag} />
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-xs leading-relaxed text-muted-foreground">
                {t("reader.missingDocHint", { title: cleanTarget })}
              </p>
              {onCreateMissingDoc && (
                <Button
                  onClick={() => onCreateMissingDoc(cleanTarget)}
                  size="xs"
                  type="button"
                  variant="outline"
                >
                  <FilePlus2Icon className="size-3.5" />
                  {t("reader.createMissingDoc")}
                </Button>
              )}
            </div>
          )}
        </PreviewCardPopup>
      </PreviewCard>
    </NodeViewWrapper>
  );
}
