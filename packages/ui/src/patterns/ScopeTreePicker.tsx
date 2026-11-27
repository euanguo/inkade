"use client";

import {
  DOCUMENT_KINDS,
  type DocumentKind,
  resolveAllowedSpaceIds,
  type Space,
  type SpaceId,
  summarizeEffectiveScope,
  type TokenPermission,
  type TokenScope,
} from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  FolderIcon,
  GlobeIcon,
  PlusIcon,
  ShieldCheckIcon,
  XIcon,
} from "lucide-react";
import type React from "react";
import { useMemo, useState } from "react";
import { cn } from "../lib/utils.ts";
import { Badge } from "../primitives/badge.tsx";
import { Button } from "../primitives/button.tsx";
import { Checkbox } from "../primitives/checkbox.tsx";
import { Input } from "../primitives/input.tsx";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "../primitives/segmented-control.tsx";
import { Separator } from "../primitives/separator.tsx";
import { Switch } from "../primitives/switch.tsx";

export interface SpaceSelectionNode {
  readonly space: Space;
  readonly depth: number;
  readonly hasChildren: boolean;
  readonly isDirectlySelected: boolean;
  readonly isInherited: boolean;
}

export function buildSpaceSelectionTree(
  spaces: readonly Space[],
  scope: TokenScope,
): SpaceSelectionNode[] {
  const activeSpaces = spaces.filter((s) => s.archivedAt === null);
  const activeIds = new Set(activeSpaces.map((s) => s.id));
  const byParent = new Map<string | null, Space[]>();

  for (const space of activeSpaces) {
    const parentKey =
      space.parentId !== null && activeIds.has(space.parentId) ? space.parentId : null;
    const list = byParent.get(parentKey);
    if (list) list.push(space);
    else byParent.set(parentKey, [space]);
  }

  for (const siblings of byParent.values()) {
    siblings.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  }

  const directSet =
    scope.spaceIds === "*" ? null : new Set<string>(scope.spaceIds);
  const resolvedSet = resolveAllowedSpaceIds(scope, activeSpaces);

  const flattened: SpaceSelectionNode[] = [];
  const visited = new Set<string>();

  function walk(parentId: string | null, depth: number): void {
    const list = byParent.get(parentId) ?? [];
    for (const space of list) {
      if (visited.has(space.id)) continue;
      visited.add(space.id);
      const children = byParent.get(space.id) ?? [];
      const isDirect = directSet === null ? true : directSet.has(space.id);
      const isAllowed = resolvedSet === "*" ? true : resolvedSet.has(space.id);
      flattened.push({
        space,
        depth,
        hasChildren: children.length > 0,
        isDirectlySelected: isDirect,
        isInherited: !isDirect && isAllowed,
      });
      walk(space.id, depth + 1);
    }
  }

  walk(null, 0);
  return flattened;
}

export interface ScopeTreePickerProps {
  readonly spaces: readonly Space[];
  readonly value: TokenScope;
  readonly onChange: (next: TokenScope) => void;
  readonly availableTags?: readonly string[] | undefined;
  readonly variant?: "card" | "embedded" | undefined;
  readonly className?: string | undefined;
}

export function ScopeTreePicker({
  spaces,
  value,
  onChange,
  availableTags = [],
  variant = "card",
  className,
}: ScopeTreePickerProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const [tagDraft, setTagDraft] = useState("");
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());

  const permissionOptions: readonly { readonly value: TokenPermission; readonly label: string }[] = [
    { value: "read", label: t("common.permissionRead") },
    { value: "append", label: t("common.permissionAppend") },
    { value: "write", label: t("common.permissionWrite") },
    { value: "admin", label: t("common.permissionAdmin") },
  ];

  const kindLabels: Readonly<Record<DocumentKind, string>> = {
    outline: t("common.kindOutline"),
    article: t("common.kindArticle"),
    clip: t("common.kindClip"),
  };

  const permissionLabelMap: Readonly<Record<TokenPermission, string>> = {
    read: t("common.permissionRead"),
    append: t("common.permissionAppend"),
    write: t("common.permissionWrite"),
    admin: t("common.permissionAdmin"),
  };

  const treeNodes = useMemo(
    () => buildSpaceSelectionTree(spaces, value),
    [spaces, value],
  );

  const visibleNodes = useMemo(() => {
    const result: SpaceSelectionNode[] = [];
    let hiddenDepth: number | null = null;
    for (const item of treeNodes) {
      if (hiddenDepth !== null) {
        if (item.depth > hiddenDepth) continue;
        hiddenDepth = null;
      }
      result.push(item);
      if (collapsedIds.has(item.space.id) && item.hasChildren) {
        hiddenDepth = item.depth;
      }
    }
    return result;
  }, [treeNodes, collapsedIds]);

  const summary = useMemo(
    () => summarizeEffectiveScope(value, spaces),
    [value, spaces],
  );

  const toggleAllSpaces = (checked: boolean): void => {
    onChange({
      ...value,
      spaceIds: checked ? "*" : [],
    });
  };

  const toggleSpace = (spaceId: SpaceId): void => {
    if (value.spaceIds === "*") {
      const remaining = spaces
        .filter((s) => s.archivedAt === null && s.id !== spaceId)
        .map((s) => s.id);
      onChange({ ...value, spaceIds: remaining });
      return;
    }

    const next = new Set(value.spaceIds);
    if (next.has(spaceId)) {
      next.delete(spaceId);
    } else {
      next.add(spaceId);
    }
    onChange({ ...value, spaceIds: [...next] });
  };

  const toggleKind = (kind: DocumentKind): void => {
    const current = value.allowedKinds ? [...value.allowedKinds] : [...DOCUMENT_KINDS];
    const has = current.includes(kind);
    const next = has ? current.filter((k) => k !== kind) : [...current, kind];
    if (next.length === DOCUMENT_KINDS.length) {
      const { allowedKinds: _omitted, ...rest } = value;
      onChange(rest);
      return;
    }
    onChange({
      ...value,
      allowedKinds: next.length > 0 ? next : [kind],
    });
  };

  const addTag = (raw: string): void => {
    const clean = raw.trim().replace(/^#/, "");
    if (!clean) return;
    const existing = value.tagAllowlist ? [...value.tagAllowlist] : [];
    if (existing.includes(clean)) {
      setTagDraft("");
      return;
    }
    onChange({ ...value, tagAllowlist: [...existing, clean] });
    setTagDraft("");
  };

  const removeTag = (tag: string): void => {
    const next = (value.tagAllowlist ?? []).filter((tItem) => tItem !== tag);
    if (next.length === 0) {
      const { tagAllowlist: _omitted, ...rest } = value;
      onChange(rest);
      return;
    }
    onChange({ ...value, tagAllowlist: next });
  };

  const toggleCollapse = (spaceId: string): void => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(spaceId)) next.delete(spaceId);
      else next.add(spaceId);
      return next;
    });
  };

  const effectiveCountLabel =
    summary.allowedSpaceIds === "*"
      ? t("scope.allSpacesLabel")
      : t("scope.spacesCount", { count: summary.allowedSpaceIds.length });

  return (
    <div
      className={cn(
        variant === "card"
          ? "flex flex-col gap-4 rounded-lg border border-border bg-card p-4 text-card-foreground"
          : "flex flex-col gap-4",
        className,
      )}
    >
      {/* Permission level */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t("scope.permissionLevel")}
          </span>
          <Badge size="sm" variant="outline">
            <ShieldCheckIcon />
            {permissionLabelMap[summary.permission]}
          </Badge>
        </div>
        <SegmentedControl className="w-full" size="sm">
          {permissionOptions.map((opt) => (
            <SegmentedControlItem
              className="flex-1"
              data-pressed={value.permission === opt.value ? "" : undefined}
              key={opt.value}
              onClick={() => onChange({ ...value, permission: opt.value })}
            >
              {opt.label}
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
      </div>

      <Separator />

      {/* Space Tree Selector */}
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t("scope.allowedSpaces")}
          </span>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <span>{t("scope.includeDescendants")}</span>
            <Switch
              checked={value.includeDescendants}
              onCheckedChange={(checked) =>
                onChange({ ...value, includeDescendants: checked })
              }
            />
          </label>
        </div>

        <label className="flex cursor-pointer items-center gap-2.5 rounded-md bg-muted/40 px-3 py-2 text-sm font-medium">
          <Checkbox
            checked={value.spaceIds === "*"}
            onCheckedChange={(checked) => toggleAllSpaces(Boolean(checked))}
          />
          <GlobeIcon className="size-4 text-muted-foreground" />
          <span className="flex-1">{t("scope.allWorkspaceSpaces")}</span>
          <Badge size="sm" variant={value.spaceIds === "*" ? "info" : "secondary"}>
            {effectiveCountLabel}
          </Badge>
        </label>

        <div className="max-h-60 overflow-y-auto rounded-md bg-muted/20 p-1.5">
          {visibleNodes.length === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">
              {t("scope.noSpaces")}
            </p>
          ) : (
            <div className="flex flex-col gap-0.5">
              {visibleNodes.map((item) => {
                const isCollapsed = collapsedIds.has(item.space.id);
                return (
                  <div
                    className={cn(
                      "flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent/60",
                      item.isInherited && "bg-info/6",
                    )}
                    key={item.space.id}
                    style={{ paddingLeft: `${item.depth * 18 + 8}px` }}
                  >
                    {item.hasChildren ? (
                      <button
                        aria-label={
                          isCollapsed ? t("scope.expandSpaceAria") : t("scope.collapseSpaceAria")
                        }
                        className="inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-muted"
                        onClick={() => toggleCollapse(item.space.id)}
                        type="button"
                      >
                        {isCollapsed ? (
                          <ChevronRightIcon className="size-3.5" />
                        ) : (
                          <ChevronDownIcon className="size-3.5" />
                        )}
                      </button>
                    ) : (
                      <span className="w-4 shrink-0" />
                    )}

                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                      <Checkbox
                        checked={item.isDirectlySelected}
                        indeterminate={item.isInherited}
                        onCheckedChange={() => toggleSpace(item.space.id)}
                      />
                      <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate font-medium">{item.space.name}</span>
                    </label>

                    {item.isInherited && (
                      <Badge size="sm" variant="info">
                        {t("common.inherited")}
                      </Badge>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <Separator />

      {/* Document Kinds + Tag Allowlist + Hard Delete Guard */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t("scope.allowedDocumentKinds")}
          </span>
          <div className="flex flex-wrap gap-1.5">
            {DOCUMENT_KINDS.map((kind) => {
              const active =
                value.allowedKinds === undefined || value.allowedKinds.includes(kind);
              return (
                <Button
                  key={kind}
                  onClick={() => toggleKind(kind)}
                  size="xs"
                  variant={active ? "default" : "outline"}
                >
                  {kindLabels[kind]}
                </Button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t("scope.tagAllowlistOptional")}
          </span>
          <div className="flex items-center gap-1.5">
            <Input
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addTag(tagDraft);
                }
              }}
              placeholder={t("scope.addTagPlaceholder")}
              size="sm"
              value={tagDraft}
            />
            <Button
              onClick={() => addTag(tagDraft)}
              size="sm"
              variant="outline"
            >
              <PlusIcon />
              {t("common.add")}
            </Button>
          </div>
          {(value.tagAllowlist?.length ?? 0) > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {value.tagAllowlist?.map((tag) => (
                <Badge className="gap-1 pr-1" key={tag} variant="secondary">
                  <span>#{tag}</span>
                  <button
                    aria-label={t("scope.removeTagAria", { tag })}
                    className="cursor-pointer rounded-xs p-0.5 hover:bg-muted"
                    onClick={() => removeTag(tag)}
                    type="button"
                  >
                    <XIcon className="size-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
          {availableTags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 pt-0.5 text-[11px] text-muted-foreground">
              <span>{t("scope.suggestions")}</span>
              {availableTags
                .filter((tag) => !value.tagAllowlist?.includes(tag))
                .slice(0, 6)
                .map((tag) => (
                  <button
                    className="cursor-pointer rounded px-1.5 py-0.5 hover:bg-muted hover:text-foreground"
                    key={tag}
                    onClick={() => addTag(tag)}
                    type="button"
                  >
                    #{tag}
                  </button>
                ))}
            </div>
          )}
        </div>

        <label className="flex cursor-pointer items-center justify-between gap-3 rounded-md bg-muted/30 px-3 py-2">
          <div className="flex flex-col">
            <span className="text-sm font-medium">{t("scope.denyHardDelete")}</span>
            <span className="text-xs text-muted-foreground">
              {t("scope.denyHardDeleteDesc")}
            </span>
          </div>
          <Switch
            checked={value.denyHardDelete}
            onCheckedChange={(checked) =>
              onChange({ ...value, denyHardDelete: checked })
            }
          />
        </label>
      </div>

      {/* Effective scope summary pill */}
      <div className="flex flex-wrap items-center gap-1.5 border-t border-border/70 pt-3 text-xs">
        <Badge size="sm" variant="default">
          {permissionLabelMap[summary.permission]}
        </Badge>
        <Badge size="sm" variant="outline">
          {effectiveCountLabel}
        </Badge>
        {summary.includeDescendants && value.spaceIds !== "*" && (
          <Badge size="sm" variant="info">
            {t("scope.plusDescendants")}
          </Badge>
        )}
        <Badge size="sm" variant="outline">
          {summary.allowedKinds
            ? summary.allowedKinds.map((k) => kindLabels[k]).join(", ")
            : t("scope.allKinds")}
        </Badge>
        {summary.tagAllowlist && summary.tagAllowlist.length > 0 && (
          <Badge size="sm" variant="secondary">
            {t("scope.tagsSummary", {
              tags: summary.tagAllowlist.map((tag) => `#${tag}`).join(" "),
            })}
          </Badge>
        )}
        {summary.denyHardDelete && (
          <Badge size="sm" variant="warning">
            {t("scope.noHardDeleteBadge")}
          </Badge>
        )}
      </div>
    </div>
  );
}
