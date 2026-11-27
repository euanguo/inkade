import { useInkadeTranslation } from "@inkade/i18n";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  Input,
  Kbd,
} from "@inkade/ui";
import { SearchIcon } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useState } from "react";

export interface GlobalShortcutsDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

interface ShortcutRow {
  readonly label: string;
  readonly shortcut: string;
}

interface ShortcutGroup {
  readonly id: string;
  readonly title: string;
  readonly items: readonly ShortcutRow[];
}

export function GlobalShortcutsDialog({
  open,
  onOpenChange,
}: GlobalShortcutsDialogProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) {
      setQuery("");
    }
  }, [open]);

  const groups: readonly ShortcutGroup[] = useMemo(
    () => [
      {
        id: "global",
        title: t("nav.shortcutsGroupGlobal"),
        items: [
          { label: t("nav.shortcutCommandPalette"), shortcut: "⌘K" },
          { label: t("nav.shortcutAskDrawer"), shortcut: "⌘⇧J" },
          { label: t("nav.shortcutQuickCapture"), shortcut: "C" },
          { label: t("nav.shortcutOpenShortcuts"), shortcut: "?" },
          { label: t("nav.shortcutToggleInspector"), shortcut: "⌘." },
          { label: t("nav.shortcutToggleSidebar"), shortcut: "⌘\\" },
          { label: t("nav.shortcutOpenSettings"), shortcut: "⌘," },
          { label: t("nav.shortcutGoDaily"), shortcut: "G D" },
          { label: t("nav.shortcutGoInbox"), shortcut: "G I" },
          { label: t("nav.shortcutGoTasks"), shortcut: "G K" },
          { label: t("nav.shortcutGoLibrary"), shortcut: "G L" },
          { label: t("graph.shortcutNav"), shortcut: "G G" },
          { label: t("nav.shortcutGoThreads"), shortcut: "G T" },
          { label: t("nav.shortcutGoAsk"), shortcut: "G A" },
          { label: t("nav.shortcutGoConnect"), shortcut: "G C" },
        ],
      },
      {
        id: "tabs-split",
        title: t("tabs.shortcutsGroupTitle"),
        items: [
          { label: t("tabs.shortcutCloseTab"), shortcut: "⌘W" },
          { label: t("tabs.shortcutReopenTab"), shortcut: "⌘⇧T" },
          { label: t("tabs.shortcutSwitchTab"), shortcut: "⌘1–9" },
          { label: t("tabs.shortcutSplitOpen"), shortcut: "⇧⏎" },
        ],
      },
      {
        id: "daily",
        title: t("nav.shortcutsGroupDaily"),
        items: [
          { label: t("nav.shortcutDailyFocusRail"), shortcut: "⌘⇧B" },
          { label: t("nav.shortcutToggleEdit"), shortcut: "E" },
          { label: t("nav.shortcutReviewHunks"), shortcut: "[ / ]" },
        ],
      },
      {
        id: "inbox",
        title: t("nav.shortcutsGroupInbox"),
        items: [
          { label: t("nav.shortcutInboxApprove"), shortcut: "J / K · Enter" },
          { label: t("nav.shortcutInboxSnooze"), shortcut: "H" },
          { label: t("nav.shortcutInboxUnread"), shortcut: "U" },
          { label: t("nav.shortcutInboxDismiss"), shortcut: "E" },
          { label: t("nav.shortcutInboxClearRead"), shortcut: "⇧⌫" },
        ],
      },
      {
        id: "tasks",
        title: t("nav.shortcutsGroupTasks"),
        items: [
          { label: t("nav.shortcutTasksQuickAdd"), shortcut: "N" },
          { label: t("nav.shortcutTasksToggleComplete"), shortcut: "Space" },
          { label: t("nav.shortcutTasksWhen"), shortcut: "S" },
          { label: t("nav.shortcutTasksDispatch"), shortcut: "D" },
        ],
      },
      {
        id: "library",
        title: t("nav.shortcutsGroupLibrary"),
        items: [
          { label: t("nav.shortcutLibrarySelectToggle"), shortcut: "X" },
          { label: t("nav.shortcutLibraryDisplayOptions"), shortcut: "⇧V" },
        ],
      },
    ],
    [t],
  );

  const normalizedQuery = query.trim().toLowerCase();
  const filteredGroups = useMemo(() => {
    if (!normalizedQuery) {
      return groups;
    }
    return groups
      .map((group) => ({
        ...group,
        items: group.items.filter(
          (item) =>
            item.label.toLowerCase().includes(normalizedQuery) ||
            item.shortcut.toLowerCase().includes(normalizedQuery) ||
            group.title.toLowerCase().includes(normalizedQuery),
        ),
      }))
      .filter((group) => group.items.length > 0);
  }, [groups, normalizedQuery]);

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogPopup className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("nav.shortcutsTitle")}</DialogTitle>
          <DialogDescription>{t("nav.shortcutsDesc")}</DialogDescription>
        </DialogHeader>
        <DialogPanel className="flex flex-col gap-3">
          <Input
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("nav.shortcutsSearchPlaceholder")}
            size="sm"
            startAddon={<SearchIcon />}
            type="search"
            value={query}
          />
          {filteredGroups.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              {t("nav.shortcutsEmpty")}
            </p>
          ) : (
            <div className="grid max-h-[60vh] grid-cols-1 gap-4 overflow-y-auto pr-1 [scrollbar-gutter:stable] sm:grid-cols-2">
              {filteredGroups.map((group) => (
                <section className="flex flex-col gap-1.5" key={group.id}>
                  <h3 className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                    {group.title}
                  </h3>
                  <div className="flex flex-col divide-y divide-border/60 rounded-lg border border-border/80 bg-background">
                    {group.items.map((item) => (
                      <div
                        className="flex items-center justify-between gap-2 px-3 py-2 text-xs"
                        key={`${group.id}:${item.shortcut}:${item.label}`}
                      >
                        <span className="min-w-0 flex-1 truncate text-foreground">
                          {item.label}
                        </span>
                        <Kbd className="shrink-0">{item.shortcut}</Kbd>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
