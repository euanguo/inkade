import type { Space, SpaceId } from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import {
  Badge,
  Button,
  Input,
  Menu,
  MenuItem,
  MenuPopup,
  MenuTrigger,
  Popover,
  PopoverPopup,
  PopoverTrigger,
  SpaceIcon,
} from "@inkade/ui";
import {
  FolderInputIcon,
  PinIcon,
  PinOffIcon,
  TagIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import type React from "react";

export interface LibraryBulkActionBarProps {
  readonly activeSpaces: readonly Space[];
  readonly bulkTagDraft: string;
  readonly bulkTagPopoverOpen: boolean;
  readonly movePending: boolean;
  readonly onBulkAddTag: (tag: string) => void;
  readonly onBulkMoveSpace: (spaceId: SpaceId) => void;
  readonly onBulkPin: (nextPinned: boolean) => void;
  readonly onBulkTagDraftChange: (value: string) => void;
  readonly onBulkTagPopoverOpenChange: (open: boolean) => void;
  readonly onBulkTrash: () => void;
  readonly onClearSelection: () => void;
  readonly pinPending: boolean;
  readonly selectedCount: number;
  readonly shouldPin: boolean;
  readonly tagPending: boolean;
  readonly trashPending: boolean;
}

export function LibraryBulkActionBar({
  activeSpaces,
  bulkTagDraft,
  bulkTagPopoverOpen,
  movePending,
  onBulkAddTag,
  onBulkMoveSpace,
  onBulkPin,
  onBulkTagDraftChange,
  onBulkTagPopoverOpenChange,
  onBulkTrash,
  onClearSelection,
  pinPending,
  selectedCount,
  shouldPin,
  tagPending,
  trashPending,
}: LibraryBulkActionBarProps): React.ReactElement | null {
  const { t } = useInkadeTranslation();
  if (selectedCount === 0) return null;

  return (
    <>
      <div className="flex items-center justify-between gap-2 md:contents">
        <Badge className="shrink-0 tabular-nums" size="sm" variant="secondary">
          {t("library.selectedCount", { count: selectedCount })}
        </Badge>

        <Button
          aria-label={t("library.clearSelection")}
          className="shrink-0 md:order-last"
          onClick={onClearSelection}
          size="icon-xs"
          title={t("library.clearSelection")}
          variant="ghost"
        >
          <XIcon className="size-3.5" />
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-1 md:flex-nowrap">
        <Menu>
          <MenuTrigger
            render={
              <Button disabled={movePending} size="xs" variant="ghost" />
            }
          >
            <FolderInputIcon className="size-3.5" />
            <span>{t("library.bulkMoveSpace")}</span>
          </MenuTrigger>
          <MenuPopup align="center" side="top">
            {activeSpaces.map((s) => (
              <MenuItem key={s.id} onClick={() => onBulkMoveSpace(s.id)}>
                <SpaceIcon color={s.color} icon={s.icon} size="xs" tone="mono" />
                <span>{s.name}</span>
              </MenuItem>
            ))}
          </MenuPopup>
        </Menu>

        <Popover onOpenChange={onBulkTagPopoverOpenChange} open={bulkTagPopoverOpen}>
          <PopoverTrigger render={<Button size="xs" variant="ghost" />}>
            <TagIcon className="size-3.5" />
            <span>{t("library.bulkAddTag")}</span>
          </PopoverTrigger>
          <PopoverPopup align="center" className="w-60" side="top" viewportClassName="p-2.5">
            <form
              className="flex items-center gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                if (bulkTagDraft.trim() && !tagPending) {
                  onBulkAddTag(bulkTagDraft);
                }
              }}
            >
              <Input
                autoFocus
                onChange={(e) => onBulkTagDraftChange(e.target.value)}
                placeholder={t("library.bulkTagPlaceholder")}
                size="sm"
                value={bulkTagDraft}
              />
              <Button
                disabled={!bulkTagDraft.trim() || tagPending}
                size="sm"
                type="submit"
              >
                {t("library.bulkApplyTag")}
              </Button>
            </form>
          </PopoverPopup>
        </Popover>

        <Button
          disabled={pinPending}
          onClick={() => onBulkPin(shouldPin)}
          size="xs"
          variant="ghost"
        >
          {shouldPin ? <PinIcon className="size-3.5" /> : <PinOffIcon className="size-3.5" />}
          <span>{shouldPin ? t("library.bulkPin") : t("library.bulkUnpin")}</span>
        </Button>

        <Button
          disabled={trashPending}
          onClick={onBulkTrash}
          size="xs"
          variant="ghost"
        >
          <Trash2Icon className="size-3.5 text-destructive" />
          <span className="text-destructive">{t("library.bulkTrash")}</span>
        </Button>
      </div>
    </>
  );
}
