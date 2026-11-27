import {
  type AdeKind,
  DEFAULT_HOST_KIND,
  formatHostDisplayName,
  isNeutralHostKind,
  normalizeHostKind,
} from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import {
  GridDisclosure,
  Input,
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@inkade/ui/primitives";
import React, { useState } from "react";

const SUGGESTED_HOST_KINDS: readonly string[] = [
  "cursor",
  "claude-code",
  "codex",
  "opencode",
  "windsurf",
];

const CUSTOM_HOST_SENTINEL = "__custom__";

export interface HostKindPickerProps {
  readonly id: string;
  readonly customInputId: string;
  readonly value: AdeKind;
  readonly onChange: (next: AdeKind) => void;
}

/**
 * Open, host-neutral picker supporting the neutral `"any"` default,
 * common host presets, and arbitrary lowercase host slugs normalized via `@inkade/core`.
 */
export function HostKindPicker({
  id,
  customInputId,
  value,
  onChange,
}: HostKindPickerProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const [customEditing, setCustomEditing] = useState(false);
  const [customDraft, setCustomDraft] = useState("");

  const normalizedValue = isNeutralHostKind(value) ? DEFAULT_HOST_KIND : value;
  const displayLabel = isNeutralHostKind(normalizedValue)
    ? t("clipper.adeAny")
    : formatHostDisplayName(normalizedValue, t("clipper.adeAny"));

  const hasCustomNonSuggested =
    !isNeutralHostKind(normalizedValue) && !SUGGESTED_HOST_KINDS.includes(normalizedValue);

  const commitCustomHost = () => {
    const trimmed = customDraft.trim();
    const next = trimmed ? normalizeHostKind(trimmed) : DEFAULT_HOST_KIND;
    onChange(next);
    setCustomEditing(false);
  };

  return (
    <div className="flex w-full min-w-0 flex-col">
      <Select
        onValueChange={(raw) => {
          if (raw === CUSTOM_HOST_SENTINEL) {
            setCustomDraft(isNeutralHostKind(normalizedValue) ? "" : normalizedValue);
            setCustomEditing(true);
            return;
          }
          setCustomEditing(false);
          onChange(normalizeHostKind(raw));
        }}
        value={normalizedValue}
      >
        <SelectTrigger className="w-full min-w-0" id={id} size="sm">
          <SelectValue className="min-w-0 truncate">
            <span className="flex min-w-0 items-center gap-1.5">
              <span
                aria-hidden="true"
                className={
                  isNeutralHostKind(normalizedValue)
                    ? "size-1.5 shrink-0 rounded-full bg-muted-foreground/60"
                    : "size-1.5 shrink-0 rounded-full bg-primary"
                }
              />
              <span className="truncate">{displayLabel}</span>
            </span>
          </SelectValue>
        </SelectTrigger>
        <SelectPopup>
          <SelectItem value={DEFAULT_HOST_KIND}>{t("clipper.adeAny")}</SelectItem>
          {SUGGESTED_HOST_KINDS.map((slug) => (
            <SelectItem key={slug} value={slug}>
              {formatHostDisplayName(slug, t("clipper.adeAny"))}
            </SelectItem>
          ))}
          {hasCustomNonSuggested ? (
            <SelectItem value={normalizedValue}>{displayLabel}</SelectItem>
          ) : null}
          <SelectItem value={CUSTOM_HOST_SENTINEL}>{t("common.customHostLabel")}</SelectItem>
        </SelectPopup>
      </Select>

      <GridDisclosure open={customEditing}>
        <Input
          aria-label={t("common.customHostLabel")}
          className="mt-1.5 w-full"
          id={customInputId}
          onBlur={commitCustomHost}
          onChange={(e) => setCustomDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitCustomHost();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setCustomEditing(false);
            }
          }}
          placeholder={t("clipper.adeCustomPlaceholder")}
          size="sm"
          value={customDraft}
        />
      </GridDisclosure>
    </div>
  );
}
