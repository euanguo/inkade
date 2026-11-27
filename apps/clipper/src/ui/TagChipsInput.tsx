import { useInkadeTranslation } from "@inkade/i18n";
import { Button, Input, TagPill } from "@inkade/ui/primitives";
import { X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

export interface TagSuggestionItem {
  readonly tag: string;
  readonly count?: number | undefined;
}

export interface TagChipsInputProps {
  readonly id?: string | undefined;
  readonly tags: readonly string[];
  readonly onChange: (next: string[]) => void;
  readonly suggestions?: readonly TagSuggestionItem[] | undefined;
  readonly placeholder?: string | undefined;
  readonly disabled?: boolean | undefined;
}

function cleanTagToken(raw: string): string {
  return raw.trim().replace(/^#+/, "");
}

export function TagChipsInput({
  id,
  tags,
  onChange,
  suggestions = [],
  placeholder,
  disabled = false,
}: TagChipsInputProps) {
  const { t } = useInkadeTranslation();
  const [draft, setDraft] = useState("");
  const [focused, setFocused] = useState(false);
  const blurTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (blurTimerRef.current !== null) {
        window.clearTimeout(blurTimerRef.current);
      }
    };
  }, []);

  const commitDraftTokens = (raw: string) => {
    const parts = raw
      .split(/[,，\n]/)
      .map(cleanTagToken)
      .filter(Boolean);
    if (parts.length === 0) {
      setDraft("");
      return;
    }
    const existingLower = new Set(tags.map((item) => item.toLowerCase()));
    const additions: string[] = [];
    for (const part of parts) {
      if (!existingLower.has(part.toLowerCase())) {
        existingLower.add(part.toLowerCase());
        additions.push(part);
      }
    }
    if (additions.length > 0) {
      onChange([...tags, ...additions]);
    }
    setDraft("");
  };

  const addSingleTag = (tag: string) => {
    const clean = cleanTagToken(tag);
    if (!clean) return;
    if (tags.some((existing) => existing.toLowerCase() === clean.toLowerCase())) return;
    onChange([...tags, clean]);
    setDraft("");
  };

  const removeTag = (target: string) => {
    onChange(tags.filter((item) => item !== target));
  };

  const visibleSuggestions = useMemo(() => {
    const existingLower = new Set(tags.map((item) => item.toLowerCase()));
    const q = cleanTagToken(draft).toLowerCase();
    return suggestions
      .filter((item) => !existingLower.has(item.tag.toLowerCase()))
      .filter((item) => !q || item.tag.toLowerCase().includes(q))
      .slice(0, 6);
  }, [tags, suggestions, draft]);

  return (
    <div className="flex w-full flex-col gap-1.5">
      {tags.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1">
          {tags.map((tag) => (
            <span
              className="inline-flex max-w-full items-center gap-0.5 rounded-md border border-border/75 bg-muted/60 pr-1"
              key={tag}
            >
              <TagPill className="border-0 bg-transparent" size="sm" tag={tag} />
              <button
                aria-label={t("scope.removeTagAria", { tag })}
                className="inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--border-focus)]"
                disabled={disabled}
                onClick={() => removeTag(tag)}
                type="button"
              >
                <X className="size-2.5" />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <Input
        disabled={disabled}
        id={id}
        onBlur={() => {
          if (draft.trim()) {
            commitDraftTokens(draft);
          }
          if (blurTimerRef.current !== null) {
            window.clearTimeout(blurTimerRef.current);
          }
          // Delay collapsing inline suggestions so mousedown -> mouseup on buttons below never shifts mid-click
          blurTimerRef.current = window.setTimeout(() => {
            blurTimerRef.current = null;
            setFocused(false);
          }, 180);
        }}
        onChange={(e) => {
          const val = e.target.value;
          if (/[,，\n]/.test(val)) {
            commitDraftTokens(val);
          } else {
            setDraft(val);
          }
        }}
        onFocus={() => {
          if (blurTimerRef.current !== null) {
            window.clearTimeout(blurTimerRef.current);
            blurTimerRef.current = null;
          }
          setFocused(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (draft.trim()) {
              commitDraftTokens(draft);
            }
            return;
          }
          if (e.key === "Backspace" && !draft && tags.length > 0) {
            removeTag(tags[tags.length - 1]!);
          }
        }}
        placeholder={placeholder}
        size="sm"
        type="text"
        value={draft}
      />

      {(focused || draft.trim().length > 0) && visibleSuggestions.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1">
          {visibleSuggestions.map((item) => (
            <Button
              className="h-5 px-1.5 text-[11px]"
              key={item.tag}
              onClick={() => addSingleTag(item.tag)}
              onMouseDown={(e) => e.preventDefault()}
              size="xs"
              variant="outline"
            >
              <span>{`#${item.tag}`}</span>
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
