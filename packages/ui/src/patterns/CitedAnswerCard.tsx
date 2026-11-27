"use client";

import type {
  DocumentId,
  DocumentKind,
  DocumentSummary,
  OutlineNodeId,
  SpaceId,
} from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import { ExternalLinkIcon, FileTextIcon } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../lib/utils.ts";
import { GridDisclosure } from "../primitives/grid-disclosure.tsx";
import { StreamText } from "../primitives/stream-text.tsx";

export interface CitedSourceItem {
  readonly id?: string | undefined;
  readonly index?: number | undefined;
  readonly documentId?: DocumentId | undefined;
  readonly spaceId?: SpaceId | undefined;
  readonly headingPath?: string | null | undefined;
  readonly nodeId?: OutlineNodeId | null | undefined;
  readonly documentTitle: string;
  readonly excerpt: string;
  readonly highlightTerms?: readonly string[] | undefined;
  readonly kind?: DocumentKind | undefined;
}

interface AnswerTextPart {
  readonly type: "text" | "cite";
  readonly value: string;
  readonly bold?: boolean | undefined;
  readonly citeIndex?: number | undefined;
  readonly num?: number | undefined;
}

function pushCitationAwareParts(
  chunk: string,
  bold: boolean,
  indexByNum: ReadonlyMap<number, number>,
  out: AnswerTextPart[],
): void {
  if (!chunk) return;
  const parts = chunk.split(/(\[\d+\])/g);
  for (const part of parts) {
    if (!part) continue;
    const match = /^\[(\d+)\]$/.exec(part);
    if (match) {
      const num = Number.parseInt(match[1] ?? "0", 10);
      const citeIndex = indexByNum.get(num);
      if (citeIndex !== undefined) {
        out.push({ type: "cite", value: part, bold, citeIndex, num });
        continue;
      }
    }
    out.push({ type: "text", value: part, ...(bold ? { bold: true } : {}) });
  }
}

function splitInlineCitationTokens(
  text: string,
  citations: readonly CitedSourceItem[],
): readonly AnswerTextPart[] {
  if (!text) {
    return [{ type: "text", value: text }];
  }
  const indexByNum = new Map<number, number>();
  citations.forEach((cite, idx) => {
    indexByNum.set(cite.index ?? idx + 1, idx);
  });

  const out: AnswerTextPart[] = [];
  const boldSegments = text.split(/(\*\*[^*\n]+\*\*)/g);
  for (const segment of boldSegments) {
    if (!segment) continue;
    const isBold =
      segment.length > 4 && segment.startsWith("**") && segment.endsWith("**");
    const inner = isBold ? segment.slice(2, -2) : segment;
    pushCitationAwareParts(inner, isBold, indexByNum, out);
  }
  return out;
}

export interface ExcerptHighlightSegment {
  readonly text: string;
  readonly highlighted: boolean;
}

/**
 * Splits `excerpt` into plain and highlighted segments matching `terms` case-insensitively.
 */
export function splitHighlightedExcerpt(
  excerpt: string,
  terms: readonly string[] = [],
): readonly ExcerptHighlightSegment[] {
  const cleanTerms = terms.map((t) => t.trim()).filter((t) => t.length > 0);
  if (!excerpt || cleanTerms.length === 0) {
    return excerpt ? [{ text: excerpt, highlighted: false }] : [];
  }
  const escaped = cleanTerms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const regex = new RegExp(`(${escaped.join("|")})`, "gi");
  const parts = excerpt.split(regex);
  const lowerSet = new Set(cleanTerms.map((t) => t.toLowerCase()));
  return parts
    .filter((p) => p.length > 0)
    .map((part) => ({
      text: part,
      highlighted: lowerSet.has(part.toLowerCase()),
    }));
}

/**
 * Extracts structured source citations from `[[wikilink]]` tokens inside an agent summary string.
 */
export function extractCitationsFromSummary(
  summary: string | null | undefined,
  docs: readonly (Pick<DocumentSummary, "id" | "title" | "slug" | "kind" | "excerpt"> & {
    readonly contentText?: string | undefined;
  })[],
): CitedSourceItem[] {
  if (!summary || !summary.trim()) return [];
  const docByKey = new Map<
    string,
    Pick<DocumentSummary, "id" | "title" | "slug" | "kind" | "excerpt"> & {
      readonly contentText?: string | undefined;
    }
  >();
  for (const doc of docs) {
    docByKey.set(doc.id.toLowerCase(), doc);
    docByKey.set(doc.slug.toLowerCase(), doc);
    docByKey.set(doc.title.trim().toLowerCase(), doc);
  }

  const seenTargets = new Set<string>();
  const citations: CitedSourceItem[] = [];
  const pattern = /\[\[([^[\]|]+)(?:\|([^[\]]+))?\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(summary)) !== null) {
    const rawTarget = (match[1] ?? "").split("#")[0]?.trim() ?? "";
    if (!rawTarget) continue;
    const key = rawTarget.toLowerCase();
    if (seenTargets.has(key)) continue;
    seenTargets.add(key);

    const matchedDoc = docByKey.get(key);
    const contextStart = Math.max(0, match.index - 40);
    const contextEnd = Math.min(summary.length, match.index + match[0].length + 60);
    const fallbackExcerpt = summary.slice(contextStart, contextEnd).replace(/\s+/g, " ").trim();

    citations.push({
      id: matchedDoc?.id ?? `cite-${citations.length + 1}`,
      index: citations.length + 1,
      documentId: matchedDoc?.id,
      documentTitle: matchedDoc?.title ?? rawTarget,
      excerpt: matchedDoc?.excerpt || matchedDoc?.contentText?.slice(0, 180) || fallbackExcerpt,
      highlightTerms: [rawTarget],
      kind: matchedDoc?.kind,
    });
  }

  return citations;
}

export interface CitedAnswerCardProps {
  readonly answer?: string | undefined;
  readonly citations: readonly CitedSourceItem[];
  readonly defaultExpandedIndex?: number | null | undefined;
  readonly streaming?: boolean | undefined;
  readonly onOpenSource?: ((citation: CitedSourceItem) => void) | undefined;
  readonly className?: string | undefined;
}

/**
 * Renders concise answer text with inline circular (1) markers and an expandable
 * 1px neutral bordered source excerpt card — strictly without colored left borders.
 */
export function CitedAnswerCard({
  answer,
  citations,
  defaultExpandedIndex = 0,
  streaming = false,
  onOpenSource,
  className,
}: CitedAnswerCardProps): React.ReactElement | null {
  const { t } = useInkadeTranslation();
  const [expandedIndex, setExpandedIndex] = useState<number | null>(() =>
    citations.length > 0 && defaultExpandedIndex !== null
      ? Math.max(0, Math.min(citations.length - 1, defaultExpandedIndex))
      : null,
  );
  const lastCitationRef = useRef<CitedSourceItem | null>(null);

  const activeCitation =
    expandedIndex !== null ? (citations[expandedIndex] ?? null) : null;

  useEffect(() => {
    if (activeCitation) {
      lastCitationRef.current = activeCitation;
    } else if (citations.length === 0) {
      lastCitationRef.current = null;
    }
  }, [activeCitation, citations.length]);

  const renderedCitation = activeCitation ?? lastCitationRef.current;

  const segments = useMemo(
    () =>
      renderedCitation
        ? splitHighlightedExcerpt(renderedCitation.excerpt, renderedCitation.highlightTerms)
        : [],
    [renderedCitation],
  );

  const answerParts = useMemo(
    () => (answer && !streaming ? splitInlineCitationTokens(answer, citations) : []),
    [answer, citations, streaming],
  );

  if (citations.length === 0 && !answer) {
    return null;
  }

  return (
    <div
      className={cn("flex flex-col gap-2", className)}
      data-slot="cited-answer-card"
    >
      {answer || citations.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-border/80 bg-card/70 px-3.5 py-3 text-xs leading-relaxed text-foreground/95 shadow-[var(--shadow-card)]">
          {answer ? (
            streaming ? (
              <StreamText streaming text={answer} />
            ) : (
              <span className="whitespace-pre-wrap">
                {answerParts.map((part, idx) =>
                  part.type === "cite" && part.citeIndex !== undefined ? (
                    <button
                      aria-label={t("agentControl.citationJumpMarkerAria", {
                        index: part.num ?? part.citeIndex + 1,
                        title: citations[part.citeIndex]?.documentTitle ?? "",
                      })}
                      className={cn(
                        "mx-0.5 inline-flex items-center rounded px-1 py-0.2 font-mono text-[11px] font-semibold tabular-nums transition-colors duration-[var(--duration-micro)]",
                        expandedIndex === part.citeIndex
                          ? "bg-foreground text-background"
                          : "bg-muted text-foreground hover:bg-foreground/15",
                      )}
                      key={`inline-cite-${idx}`}
                      onClick={() =>
                        setExpandedIndex(
                          expandedIndex === part.citeIndex ? null : (part.citeIndex ?? 0),
                        )
                      }
                      type="button"
                    >
                      {part.value}
                    </button>
                  ) : part.bold ? (
                    <strong className="font-semibold text-foreground" key={`inline-text-${idx}`}>
                      {part.value}
                    </strong>
                  ) : (
                    <span key={`inline-text-${idx}`}>{part.value}</span>
                  ),
                )}
              </span>
            )
          ) : null}
          {citations.map((cite, idx) => {
            const num = cite.index ?? idx + 1;
            const isActive = expandedIndex === idx;
            return (
              <button
                aria-expanded={isActive}
                aria-label={t("agentControl.toggleCitationAria", {
                  index: num,
                  title: cite.documentTitle,
                })}
                className={cn(
                  "inline-flex size-5 cursor-pointer items-center justify-center rounded-full border font-mono text-[10px] font-semibold tabular-nums transition-[transform,colors,border-color] duration-[var(--duration-micro)] ease-[var(--ease-out-strong)] active:scale-[0.94]",
                  isActive
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-card text-muted-foreground hover:border-foreground/40 hover:text-foreground",
                )}
                data-citation-index={num}
                key={cite.id ?? `${cite.documentTitle}-${idx}`}
                onClick={() => setExpandedIndex(isActive ? null : idx)}
                type="button"
              >
                {num}
              </button>
            );
          })}
        </div>
      ) : null}

      {renderedCitation ? (
        <GridDisclosure open={Boolean(activeCitation)}>
          <div
            className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 shadow-[var(--shadow-card)]"
            data-slot="cited-source-excerpt"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span
                  aria-hidden="true"
                  className="inline-flex size-[22px] shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
                >
                  <FileTextIcon className="size-3.5" />
                </span>
                <span className="truncate text-xs font-semibold text-foreground">
                  {renderedCitation.documentTitle}
                </span>
                {renderedCitation.headingPath &&
                renderedCitation.headingPath.trim().toLowerCase() !==
                  renderedCitation.documentTitle.trim().toLowerCase() ? (
                  <span className="truncate rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {(() => {
                      const rawHeading = renderedCitation.headingPath.trim();
                      const pageMatch = /^Page\s+(\d+)$/i.exec(rawHeading);
                      if (pageMatch) {
                        return t("agentControl.citationAnchorPage", { page: pageMatch[1] ?? "1" });
                      }
                      return t("agentControl.citationAnchorSection", { heading: rawHeading });
                    })()}
                  </span>
                ) : null}
                {renderedCitation.nodeId ? (
                  <span className="truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                    {t("agentControl.citationAnchorNode", {
                      nodeId: renderedCitation.nodeId,
                    })}
                  </span>
                ) : null}
              </div>

              {onOpenSource ? (
                <button
                  className="inline-flex shrink-0 cursor-pointer items-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors duration-[var(--duration-micro)] hover:text-foreground"
                  onClick={() => onOpenSource(renderedCitation)}
                  type="button"
                >
                  <span>{t("agentControl.openSourceLink")}</span>
                  <ExternalLinkIcon aria-hidden="true" className="size-3" />
                </button>
              ) : null}
            </div>

            {segments.length > 0 ? (
              <p className="text-xs leading-relaxed text-muted-foreground">
                {segments.map((seg, idx) =>
                  seg.highlighted ? (
                    <mark
                      className="rounded-xs bg-amber-500/18 px-0.5 text-foreground"
                      key={idx}
                    >
                      {seg.text}
                    </mark>
                  ) : (
                    <span key={idx}>{seg.text}</span>
                  ),
                )}
              </p>
            ) : null}
          </div>
        </GridDisclosure>
      ) : null}
    </div>
  );
}
