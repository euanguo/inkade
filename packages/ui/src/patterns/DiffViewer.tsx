"use client";

import type { RevisionDiffHunk, RevisionDiffResult } from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import {
  CheckIcon,
  GitCompareIcon,
  MessageSquarePlusIcon,
  RotateCcwIcon,
  SendIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
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
import { GridDisclosure } from "../primitives/grid-disclosure.tsx";
import { Input } from "../primitives/input.tsx";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "../primitives/segmented-control.tsx";

export interface UnifiedDiffRow {
  readonly kind: "context" | "add" | "del";
  readonly oldLine: number | null;
  readonly newLine: number | null;
  readonly text: string;
}

export interface SplitDiffRow {
  readonly left: {
    readonly lineNumber: number | null;
    readonly text: string;
    readonly kind: "context" | "del" | "empty";
  };
  readonly right: {
    readonly lineNumber: number | null;
    readonly text: string;
    readonly kind: "context" | "add" | "empty";
  };
}

export function buildUnifiedRows(hunk: RevisionDiffHunk): UnifiedDiffRow[] {
  const rows: UnifiedDiffRow[] = [];
  let oldLine = hunk.oldStart;
  let newLine = hunk.newStart;

  for (const raw of hunk.lines) {
    if (raw.startsWith("+")) {
      rows.push({ kind: "add", oldLine: null, newLine, text: raw.slice(1) });
      newLine++;
    } else if (raw.startsWith("-")) {
      rows.push({ kind: "del", oldLine, newLine: null, text: raw.slice(1) });
      oldLine++;
    } else {
      const content = raw.startsWith(" ") ? raw.slice(1) : raw;
      rows.push({ kind: "context", oldLine, newLine, text: content });
      oldLine++;
      newLine++;
    }
  }
  return rows;
}

export function buildSplitRows(hunk: RevisionDiffHunk): SplitDiffRow[] {
  const rows: SplitDiffRow[] = [];
  let oldLine = hunk.oldStart;
  let newLine = hunk.newStart;
  let pendingDels: Array<{ lineNumber: number; text: string }> = [];
  let pendingAdds: Array<{ lineNumber: number; text: string }> = [];

  const flushPending = (): void => {
    const maxLen = Math.max(pendingDels.length, pendingAdds.length);
    for (let i = 0; i < maxLen; i++) {
      const delItem = pendingDels[i];
      const addItem = pendingAdds[i];
      rows.push({
        left: delItem
          ? { lineNumber: delItem.lineNumber, text: delItem.text, kind: "del" }
          : { lineNumber: null, text: "", kind: "empty" },
        right: addItem
          ? { lineNumber: addItem.lineNumber, text: addItem.text, kind: "add" }
          : { lineNumber: null, text: "", kind: "empty" },
      });
    }
    pendingDels = [];
    pendingAdds = [];
  };

  for (const raw of hunk.lines) {
    if (raw.startsWith("-")) {
      pendingDels.push({ lineNumber: oldLine++, text: raw.slice(1) });
    } else if (raw.startsWith("+")) {
      pendingAdds.push({ lineNumber: newLine++, text: raw.slice(1) });
    } else {
      flushPending();
      const content = raw.startsWith(" ") ? raw.slice(1) : raw;
      rows.push({
        left: { lineNumber: oldLine++, text: content, kind: "context" },
        right: { lineNumber: newLine++, text: content, kind: "context" },
      });
    }
  }

  flushPending();
  return rows;
}

export interface DiffViewerProps {
  readonly diff: RevisionDiffResult;
  readonly oldLabel?: string | undefined;
  readonly newLabel?: string | undefined;
  readonly defaultMode?: "unified" | "split" | undefined;
  readonly changeSummary?: string | null | undefined;
  readonly onSwitchToInline?: (() => void) | undefined;
  readonly hunkDecisions?: Readonly<Record<number, "pending" | "accepted" | "rejected">> | undefined;
  readonly onAcceptHunk?: ((hunkIndex: number, hunk: RevisionDiffHunk) => void) | undefined;
  readonly onRejectHunk?: ((hunkIndex: number, hunk: RevisionDiffHunk) => void) | undefined;
  readonly onCommentReworkHunk?: ((hunkIndex: number, hunk: RevisionDiffHunk, comment: string) => void) | undefined;
  readonly onRestore?: (() => void) | undefined;
  readonly restoring?: boolean | undefined;
  readonly onClose?: (() => void) | undefined;
  readonly className?: string | undefined;
}

export function DiffViewer({
  diff,
  oldLabel,
  newLabel,
  defaultMode = "unified",
  changeSummary,
  onSwitchToInline,
  hunkDecisions,
  onAcceptHunk,
  onRejectHunk,
  onCommentReworkHunk,
  onRestore,
  restoring = false,
  onClose,
  className,
}: DiffViewerProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const [mode, setMode] = useState<"unified" | "split">(() => {
    if (defaultMode === "split" && typeof window !== "undefined" && window.innerWidth < 640) {
      return "unified";
    }
    return defaultMode;
  });
  const [commentingIdx, setCommentingIdx] = useState<number | null>(null);
  const [reworkText, setReworkText] = useState("");
  const resolvedOldLabel = oldLabel ?? t("diff.defaultOldLabel");
  const resolvedNewLabel = newLabel ?? t("diff.defaultNewLabel");

  useEffect(() => {
    setCommentingIdx(null);
    setReworkText("");
    setMode(
      defaultMode === "split" && typeof window !== "undefined" && window.innerWidth < 640
        ? "unified"
        : defaultMode,
    );
  }, [defaultMode, diff]);

  const renderedHunks = useMemo(
    () =>
      diff.hunks.map((hunk) => ({
        hunk,
        unified: buildUnifiedRows(hunk),
        split: buildSplitRows(hunk),
      })),
    [diff.hunks],
  );

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-[var(--shadow-card)]",
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-mono text-muted-foreground">{resolvedOldLabel}</span>
          <span className="text-muted-foreground/60">→</span>
          <span className="font-mono font-medium text-foreground">{resolvedNewLabel}</span>
          <div className="flex items-center gap-1">
            <Badge size="sm" variant="success">
              +{diff.additions}
            </Badge>
            <Badge size="sm" variant="error">
              -{diff.deletions}
            </Badge>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {onSwitchToInline && (
            <Button onClick={onSwitchToInline} size="xs" variant="outline">
              <SparklesIcon />
              {t("reader.inlineSuggestions")}
            </Button>
          )}

          <SegmentedControl size="sm">
            <SegmentedControlItem
              data-pressed={mode === "unified" ? "" : undefined}
              onClick={() => setMode("unified")}
            >
              {t("diff.unified")}
            </SegmentedControlItem>
            <SegmentedControlItem
              data-pressed={mode === "split" ? "" : undefined}
              onClick={() => setMode("split")}
            >
              {t("diff.split")}
            </SegmentedControlItem>
          </SegmentedControl>

          {onRestore && (
            <Button
              loading={restoring}
              onClick={onRestore}
              size="xs"
              variant="outline"
            >
              <RotateCcwIcon />
              {t("diff.restoreVersion")}
            </Button>
          )}
          {onClose && (
            <Button
              aria-label={t("diff.closeComparison")}
              onClick={onClose}
              size="xs"
              variant="ghost"
            >
              <XIcon />
              {t("diff.closeComparison")}
            </Button>
          )}
        </div>
      </div>

      {changeSummary && (
        <div className="flex items-start gap-2 border-b bg-brand-subtle/35 px-3 py-2 text-xs">
          <SparklesIcon className="mt-0.5 size-3.5 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <span className="font-semibold text-primary">{t("diff.agentSummaryLabel")}: </span>
            <span>{changeSummary}</span>
          </div>
        </div>
      )}

      {renderedHunks.length === 0 ? (
        <Empty className="py-10">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <GitCompareIcon />
            </EmptyMedia>
            <EmptyTitle>{t("diff.noChangesTitle")}</EmptyTitle>
            <EmptyDescription>{t("diff.noChangesDesc")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="overflow-x-auto font-mono text-xs leading-relaxed">
          {renderedHunks.map(({ hunk, unified, split }, hunkIdx) => {
            const decision = hunkDecisions?.[hunkIdx] ?? "pending";
            const isCommenting = commentingIdx === hunkIdx;
            return (
              <div className="border-b last:border-b-0" key={`${hunk.oldStart}-${hunk.newStart}-${hunkIdx}`}>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/30 px-3 py-1 text-[11px] text-muted-foreground">
                  <span>{`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`}</span>

                  {(onAcceptHunk || onRejectHunk || onCommentReworkHunk) && (
                    <div className="flex items-center gap-1 font-sans">
                      {onAcceptHunk && (
                        <Button
                          onClick={() => onAcceptHunk(hunkIdx, hunk)}
                          size="xs"
                          variant={decision === "accepted" ? "default" : "ghost"}
                        >
                          <CheckIcon />
                          {t("diff.acceptHunk")}
                        </Button>
                      )}
                      {onRejectHunk && (
                        <Button
                          onClick={() => onRejectHunk(hunkIdx, hunk)}
                          size="xs"
                          variant={decision === "rejected" ? "destructive" : "ghost"}
                        >
                          <XIcon />
                          {t("diff.rejectHunk")}
                        </Button>
                      )}
                      {onCommentReworkHunk && (
                        <Button
                          onClick={() => {
                            setCommentingIdx(isCommenting ? null : hunkIdx);
                            setReworkText("");
                          }}
                          size="xs"
                          variant="ghost"
                        >
                          <MessageSquarePlusIcon />
                          {t("diff.commentRework")}
                        </Button>
                      )}
                    </div>
                  )}
                </div>

                {onCommentReworkHunk && (
                  <GridDisclosure open={isCommenting}>
                    <form
                      className="flex items-center gap-2 border-b bg-muted/20 px-3 py-2 font-sans"
                      key={isCommenting ? "diff-rework-open" : "diff-rework-closed"}
                      onSubmit={(e) => {
                        e.preventDefault();
                        const trimmed = reworkText.trim();
                        if (!trimmed) return;
                        onCommentReworkHunk(hunkIdx, hunk, trimmed);
                        setCommentingIdx(null);
                        setReworkText("");
                      }}
                    >
                      <Input
                        autoFocus={isCommenting}
                        className="flex-1"
                        onChange={(e) => setReworkText(e.target.value)}
                        placeholder={t("diff.reworkPlaceholder")}
                        size="sm"
                        value={reworkText}
                      />
                      <Button size="sm" type="submit">
                        <SendIcon />
                        {t("diff.sendRework")}
                      </Button>
                    </form>
                  </GridDisclosure>
                )}

                {mode === "unified" ? (
                  <table className="w-full border-collapse">
                    <tbody>
                      {unified.map((row, idx) => (
                        <tr
                          className={cn(
                            row.kind === "add" && "bg-success/8 dark:bg-success/12",
                            row.kind === "del" && "bg-destructive/8 dark:bg-destructive/12",
                          )}
                          key={idx}
                        >
                          <td className="relative w-10 select-none border-r px-2 py-0.5 text-right text-[11px] text-muted-foreground/70">
                            {row.kind !== "context" && (
                              <span
                                aria-hidden
                                className={cn(
                                  "pointer-events-none absolute inset-y-0 left-0 w-[3px]",
                                  row.kind === "add" ? "bg-success" : "inkade-diff-hatch-del",
                                )}
                              />
                            )}
                            {row.oldLine ?? ""}
                          </td>
                          <td className="w-10 select-none border-r px-2 py-0.5 text-right text-[11px] text-muted-foreground/70">
                            {row.newLine ?? ""}
                          </td>
                          <td
                            className={cn(
                              "w-5 select-none text-center font-semibold",
                              row.kind === "add" && "text-success-foreground",
                              row.kind === "del" && "text-destructive-foreground",
                              row.kind === "context" && "text-muted-foreground/50",
                            )}
                          >
                            {row.kind === "add" ? "+" : row.kind === "del" ? "-" : " "}
                          </td>
                          <td className="whitespace-pre-wrap [overflow-wrap:anywhere] px-2 py-0.5 text-foreground">
                            {row.text || " "}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <table className="w-full min-w-[540px] table-fixed border-collapse">
                    <tbody>
                      {split.map((row, idx) => (
                        <tr key={idx}>
                          <td
                            className={cn(
                              "relative w-10 select-none border-r px-2 py-0.5 text-right text-[11px] text-muted-foreground/70",
                              row.left.kind === "del" && "bg-destructive/10",
                              row.left.kind === "empty" && "bg-muted/20",
                            )}
                          >
                            {row.left.kind === "del" && (
                              <span
                                aria-hidden
                                className="inkade-diff-hatch-del pointer-events-none absolute inset-y-0 left-0 w-[3px]"
                              />
                            )}
                            {row.left.lineNumber ?? ""}
                          </td>
                          <td
                            className={cn(
                              "w-1/2 whitespace-pre-wrap [overflow-wrap:anywhere] border-r px-2 py-0.5",
                              row.left.kind === "del" && "bg-destructive/8 text-foreground dark:bg-destructive/12",
                              row.left.kind === "empty" && "bg-muted/20 text-muted-foreground/40",
                            )}
                          >
                            {row.left.kind === "del" ? `- ${row.left.text}` : row.left.text || " "}
                          </td>
                          <td
                            className={cn(
                              "relative w-10 select-none border-r px-2 py-0.5 text-right text-[11px] text-muted-foreground/70",
                              row.right.kind === "add" && "bg-success/10",
                              row.right.kind === "empty" && "bg-muted/20",
                            )}
                          >
                            {row.right.kind === "add" && (
                              <span
                                aria-hidden
                                className="pointer-events-none absolute inset-y-0 left-0 w-[3px] bg-success"
                              />
                            )}
                            {row.right.lineNumber ?? ""}
                          </td>
                          <td
                            className={cn(
                              "w-1/2 whitespace-pre-wrap [overflow-wrap:anywhere] px-2 py-0.5",
                              row.right.kind === "add" && "bg-success/8 text-foreground dark:bg-success/12",
                              row.right.kind === "empty" && "bg-muted/20 text-muted-foreground/40",
                            )}
                          >
                            {row.right.kind === "add" ? `+ ${row.right.text}` : row.right.text || " "}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
