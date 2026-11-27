import { asSpaceId, type DocumentKind, type Space, type SpaceId } from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import { inkadeQueryKeys } from "@inkade/sdk";
import { useInkadeSpaces, useInkadeWorkspaceSummary } from "@inkade/sdk/react";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
  Badge,
  Button,
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
  SpaceIcon,
} from "@inkade/ui";
import { SettingsGroupSkeleton } from "./SettingsSkeletons.tsx";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArchiveIcon, PencilIcon, PlusIcon } from "lucide-react";
import type React from "react";
import { useMemo, useState } from "react";
import { CreateSpaceDialog } from "../../components/CreateSpaceDialog.tsx";
import { getInkadeClient } from "../../lib/api.ts";
import { showErrorToast, showSuccessToast } from "../../lib/undo.ts";
import {
  DangerZone,
  SettingRow,
  SettingsGroup,
  SettingsSectionHeader,
} from "./SettingRow.tsx";

interface FlattenedSpaceRow {
  readonly space: Space;
  readonly depth: number;
}

function flattenSpaceHierarchy(spaces: readonly Space[]): readonly FlattenedSpaceRow[] {
  const active = spaces.filter((s) => s.archivedAt === null);
  const activeIds = new Set(active.map((s) => s.id));
  const byParent = new Map<string | null, Space[]>();

  for (const space of active) {
    const parentKey = space.parentId && activeIds.has(space.parentId) ? space.parentId : null;
    const list = byParent.get(parentKey);
    if (list) list.push(space);
    else byParent.set(parentKey, [space]);
  }

  for (const list of byParent.values()) {
    list.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  }

  const rows: FlattenedSpaceRow[] = [];
  const visited = new Set<string>();

  function walk(parentId: string | null, depth: number): void {
    const children = byParent.get(parentId) ?? [];
    for (const child of children) {
      if (visited.has(child.id)) continue;
      visited.add(child.id);
      rows.push({ space: child, depth });
      walk(child.id, depth + 1);
    }
  }

  walk(null, 0);
  return rows;
}

export function SpacesSettings(): React.ReactElement {
  const { t } = useInkadeTranslation();
  const queryClient = useQueryClient();

  const spacesQuery = useInkadeSpaces({ includeArchived: true });

  const summaryQuery = useInkadeWorkspaceSummary();

  const [spaceDialogOpen, setSpaceDialogOpen] = useState(false);
  const [editingSpaceId, setEditingSpaceId] = useState<SpaceId | null>(null);
  const [selectedArchiveId, setSelectedArchiveId] = useState<SpaceId | "__none__">("__none__");
  const [confirmArchiveSpace, setConfirmArchiveSpace] = useState<Space | null>(null);

  const spaces = useMemo(() => spacesQuery.data ?? [], [spacesQuery.data]);
  const activeRows = useMemo(() => flattenSpaceHierarchy(spaces), [spaces]);
  const activeSpaces = useMemo(
    () => activeRows.map((r) => r.space),
    [activeRows],
  );
  const archivedSpaces = useMemo(
    () => spaces.filter((s) => s.archivedAt !== null),
    [spaces],
  );
  const spaceNameById = useMemo(
    () => new Map(spaces.map((s) => [s.id, s.name])),
    [spaces],
  );
  const countBySpaceId = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of summaryQuery.data?.spaces ?? []) {
      map.set(item.spaceId, item.activeCount);
    }
    return map;
  }, [summaryQuery.data]);

  const editingSpace = useMemo(
    () => spaces.find((s) => s.id === editingSpaceId) ?? null,
    [spaces, editingSpaceId],
  );

  const kindLabels: Readonly<Record<DocumentKind, string>> = {
    outline: t("common.kindOutline"),
    article: t("common.kindArticle"),
    clip: t("common.kindClip"),
  };

  const archiveSpaceMutation = useMutation({
    mutationFn: (id: SpaceId) => getInkadeClient().spaces.archive(id),
    onSuccess: (archived) => {
      setConfirmArchiveSpace(null);
      setSelectedArchiveId("__none__");
      void queryClient.invalidateQueries({ queryKey: [...inkadeQueryKeys.all, "spaces"] });
      void queryClient.invalidateQueries({ queryKey: inkadeQueryKeys.workspaceSummary() });
      showSuccessToast(t("nav.spaceArchived"), archived.name);
    },
    onError: (err) => showErrorToast(t("settings.archiveFailed"), err),
  });

  return (
    <div className="flex flex-col gap-6">
      <SettingsSectionHeader
        actions={
          <Button
            onClick={() => {
              setEditingSpaceId(null);
              setSpaceDialogOpen(true);
            }}
            size="sm"
          >
            <PlusIcon />
            {t("settings.createSpace")}
          </Button>
        }
        description={t("settings.sectionSpacesDesc")}
        title={t("settings.sectionSpacesLabel")}
      />

      {spacesQuery.isPending ? (
        <SettingsGroupSkeleton rows={4} showGroupHeader variant="space" />
      ) : (
        <SettingsGroup title={t("settings.spacesTitle")}>
          {activeRows.map(({ space, depth }) => {
            const docCount = countBySpaceId.get(space.id);
            return (
              <div
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5"
                key={space.id}
                style={{ paddingLeft: `${16 + depth * 20}px` }}
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <SpaceIcon color={space.color} icon={space.icon} size="sm" withChip />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">
                        {space.name}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">
                        /{space.slug}
                      </span>
                      {typeof docCount === "number" ? (
                        <Badge size="sm" variant="secondary">
                          {t("settings.spacesCountBadge", { count: docCount })}
                        </Badge>
                      ) : null}
                      {space.defaultKind ? (
                        <Badge size="sm" variant="outline">
                          {t("settings.defaultKindBadge", {
                            kind: kindLabels[space.defaultKind],
                          })}
                        </Badge>
                      ) : null}
                      {space.parentId ? (
                        <Badge size="sm" variant="outline">
                          {t("settings.parentBadge", {
                            name: spaceNameById.get(space.parentId) ?? space.parentId,
                          })}
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                </div>

                <Button
                  onClick={() => {
                    setEditingSpaceId(space.id);
                    setSpaceDialogOpen(true);
                  }}
                  size="xs"
                  variant="outline"
                >
                  <PencilIcon />
                  {t("common.edit")}
                </Button>
              </div>
            );
          })}
        </SettingsGroup>
      )}

      {archivedSpaces.length > 0 ? (
        <SettingsGroup title={t("settings.archivedSpacesTitle", { count: archivedSpaces.length })}>
          {archivedSpaces.map((space) => (
            <div
              className="flex items-center justify-between gap-3 px-4 py-2.5 opacity-70 sm:px-5"
              key={space.id}
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <SpaceIcon color={space.color} icon={space.icon} size="sm" withChip />
                <span className="truncate text-sm font-medium">{space.name}</span>
                <span className="font-mono text-xs text-muted-foreground">/{space.slug}</span>
              </div>
              <Badge size="sm" variant="secondary">
                {t("common.archived")}
              </Badge>
            </div>
          ))}
        </SettingsGroup>
      ) : null}

      <DangerZone>
        <SettingRow
          description={t("settings.archiveSpaceRowDesc")}
          title={t("settings.archiveSpaceRowTitle")}
        >
          <div className="flex flex-wrap items-center gap-2">
            <Select<SpaceId | "__none__">
              onValueChange={(val) =>
                setSelectedArchiveId(!val || val === "__none__" ? "__none__" : asSpaceId(val))
              }
              value={selectedArchiveId}
            >
              <SelectTrigger className="w-48" size="sm">
                <SelectValue>
                  {selectedArchiveId === "__none__"
                    ? t("settings.selectSpaceToArchive")
                    : (spaceNameById.get(selectedArchiveId) ?? t("settings.selectSpaceToArchive"))}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value="__none__">{t("settings.selectSpaceToArchive")}</SelectItem>
                {activeSpaces.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
            <Button
              disabled={selectedArchiveId === "__none__"}
              onClick={() => {
                const target = activeSpaces.find((s) => s.id === selectedArchiveId) ?? null;
                if (target) setConfirmArchiveSpace(target);
              }}
              size="sm"
              variant="destructive-outline"
            >
              <ArchiveIcon />
              {t("nav.archiveSpace")}
            </Button>
          </div>
        </SettingRow>
      </DangerZone>

      <CreateSpaceDialog
        editingSpace={editingSpace}
        onOpenChange={setSpaceDialogOpen}
        open={spaceDialogOpen}
        spaces={spaces}
      />

      <AlertDialog
        onOpenChange={(open) => {
          if (!open) setConfirmArchiveSpace(null);
        }}
        open={Boolean(confirmArchiveSpace)}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("settings.archiveConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("settings.archiveConfirmDesc", {
                name: confirmArchiveSpace?.name ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>
              {t("common.cancel")}
            </AlertDialogClose>
            <Button
              loading={archiveSpaceMutation.isPending}
              onClick={() => {
                if (confirmArchiveSpace) {
                  archiveSpaceMutation.mutate(confirmArchiveSpace.id);
                }
              }}
              variant="destructive"
            >
              {t("settings.confirmArchive")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </div>
  );
}
