"use client";

import { useInkadeTranslation } from "@inkade/i18n";
import { CheckIcon, MessageSquarePlusIcon, SendIcon, XIcon } from "lucide-react";
import type React from "react";
import { cn } from "../../lib/utils.ts";
import { Badge } from "../../primitives/badge.tsx";
import { Button } from "../../primitives/button.tsx";
import { GridDisclosure } from "../../primitives/grid-disclosure.tsx";
import { Input } from "../../primitives/input.tsx";
import type { SuggestionDecision, SuggestionHunk } from "./diff-model.ts";

export interface SuggestionHunkCardProps {
  readonly hunk: SuggestionHunk;
  readonly decision: SuggestionDecision;
  readonly isActive: boolean;
  readonly isCommenting: boolean;
  readonly commentDraft: string;
  readonly hasCommentHandler: boolean;
  readonly onSelect: () => void;
  readonly onDecision: (decision: SuggestionDecision) => void;
  readonly onToggleComment: () => void;
  readonly onCommentDraftChange: (value: string) => void;
  readonly onSubmitComment: () => void;
  readonly setCardRef: (el: HTMLDivElement | null) => void;
}

export function SuggestionHunkCard({
  hunk,
  decision,
  isActive,
  isCommenting,
  commentDraft,
  hasCommentHandler,
  onSelect,
  onDecision,
  onToggleComment,
  onCommentDraftChange,
  onSubmitComment,
  setCardRef,
}: SuggestionHunkCardProps): React.ReactElement {
  const { t } = useInkadeTranslation();

  return (
    <div
      className={cn(
        "group relative my-3 overflow-hidden rounded-lg px-3.5 py-3 transition-colors duration-[var(--duration-quick)] ease-[var(--ease-smooth-out)]",
        decision === "accepted" && "bg-emerald-500/8",
        decision === "rejected" && "bg-rose-500/7 opacity-80",
        decision === "pending" && "bg-muted/35",
        isActive && "ring-1 ring-primary/45",
      )}
      data-hunk-active={isActive ? "true" : undefined}
      data-hunk-decision={decision}
      data-hunk-id={hunk.id}
      onClick={onSelect}
      ref={setCardRef}
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-0 left-0 w-[3px]",
          decision === "accepted"
            ? "bg-success"
            : decision === "rejected"
              ? "inkade-diff-hatch-del"
              : "bg-warning/75",
        )}
      />
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Badge
            size="sm"
            variant={
              decision === "accepted"
                ? "success"
                : decision === "rejected"
                  ? "error"
                  : "warning"
            }
          >
            {decision === "accepted"
              ? t("reader.acceptedLabel")
              : decision === "rejected"
                ? t("reader.rejectedLabel")
                : `#${hunk.index + 1}`}
          </Badge>
        </div>

        <div className="flex flex-wrap items-center gap-1">
          <Button
            onClick={(e) => {
              e.stopPropagation();
              onDecision("accepted");
            }}
            size="xs"
            variant={decision === "accepted" ? "default" : "outline"}
          >
            <CheckIcon />
            {t("reader.acceptHunk")}
          </Button>
          <Button
            onClick={(e) => {
              e.stopPropagation();
              onDecision("rejected");
            }}
            size="xs"
            variant={decision === "rejected" ? "destructive" : "ghost"}
          >
            <XIcon />
            {t("reader.rejectHunk")}
          </Button>
          {hasCommentHandler && (
            <Button
              onClick={(e) => {
                e.stopPropagation();
                onToggleComment();
              }}
              size="xs"
              variant="ghost"
            >
              <MessageSquarePlusIcon />
              {t("reader.commentRework")}
            </Button>
          )}
        </div>
      </div>

      {/* Inline Word-Level Rendered Diff */}
      <div className="whitespace-pre-wrap text-[0.95rem] leading-relaxed">
        {decision === "accepted" ? (
          <span className="text-foreground">
            {hunk.newText || <em className="text-muted-foreground">—</em>}
          </span>
        ) : decision === "rejected" ? (
          <span className="text-foreground">
            {hunk.oldText || <em className="text-muted-foreground">—</em>}
          </span>
        ) : (
          hunk.tokens.map((tok, tokIdx) => {
            if (tok.kind === "equal") {
              return <span key={tokIdx}>{tok.text}</span>;
            }
            if (tok.kind === "insert") {
              return (
                <ins className="inkade-suggestion-ins no-underline" key={tokIdx}>
                  {tok.text}
                </ins>
              );
            }
            return (
              <del className="inkade-suggestion-del" key={tokIdx}>
                {tok.text}
              </del>
            );
          })
        )}
      </div>

      <GridDisclosure open={isCommenting}>
        <div className="pt-3" onClick={(e) => e.stopPropagation()}>
          <form
            className="flex items-center gap-2 border-t pt-2.5"
            key={isCommenting ? "inline-rework-open" : "inline-rework-closed"}
            onSubmit={(e) => {
              e.preventDefault();
              onSubmitComment();
            }}
          >
            <Input
              autoFocus={isCommenting}
              className="flex-1"
              onChange={(e) => onCommentDraftChange(e.target.value)}
              placeholder={t("reader.reworkPlaceholder")}
              size="sm"
              value={commentDraft}
            />
            <Button size="sm" type="submit">
              <SendIcon />
              {t("reader.sendReworkToAde")}
            </Button>
          </form>
        </div>
      </GridDisclosure>
    </div>
  );
}
