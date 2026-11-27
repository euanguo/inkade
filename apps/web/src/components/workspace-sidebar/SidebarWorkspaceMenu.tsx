import { ACCENT_PRESETS, type AccentPreset, type TokenPermission } from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import type { useInkadeWhoami } from "@inkade/sdk/react";
import {
  Badge,
  Button,
  Kbd,
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuShortcut,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "@inkade/ui";
import { useAccentPreset } from "@inkade/views/lib/preferences-store";
import {
  ChevronDownIcon,
  DownloadIcon,
  FilePlus2Icon,
  KeyboardIcon,
  LogOutIcon,
  MoonIcon,
  PaletteIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  SearchIcon,
  SettingsIcon,
  SunIcon,
  XIcon,
} from "lucide-react";
import type React from "react";

const ACCENT_DOT_CLASS: Readonly<Record<AccentPreset, string>> = {
  indigo: "bg-indigo-600 dark:bg-indigo-400",
  sage: "bg-emerald-700 dark:bg-emerald-400",
  terracotta: "bg-orange-700 dark:bg-orange-400",
  mono: "bg-neutral-800 dark:bg-neutral-200",
};

export interface SidebarWorkspaceMenuProps {
  readonly isPeek: boolean;
  readonly isDrawer?: boolean | undefined;
  readonly workspaceName: string;
  readonly workspaceInitial: string;
  readonly whoami: ReturnType<typeof useInkadeWhoami>["data"];
  readonly permissionLabels: Readonly<Record<TokenPermission, string>>;
  readonly effectiveTheme: "light" | "dark";
  readonly onToggleTheme: () => void;
  readonly onOpenNewDoc: () => void;
  readonly onSetSidebarCollapsed: (collapsed: boolean) => void;
  readonly onOpenCommandPalette: () => void;
  readonly onOpenShortcuts: () => void;
  readonly onOpenSettingsModal: () => void;
  readonly onCloseDrawers: () => void;
  readonly onExportZip: () => Promise<void>;
  readonly onSignOut: () => Promise<void>;
}

export function SidebarWorkspaceMenu({
  isPeek,
  isDrawer = false,
  workspaceName,
  workspaceInitial,
  whoami,
  permissionLabels,
  effectiveTheme,
  onToggleTheme,
  onOpenNewDoc,
  onSetSidebarCollapsed,
  onOpenCommandPalette,
  onOpenShortcuts,
  onOpenSettingsModal,
  onCloseDrawers,
  onExportZip,
  onSignOut,
}: SidebarWorkspaceMenuProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const { accent, setAccent } = useAccentPreset();

  const accentLabels: Readonly<Record<AccentPreset, string>> = {
    indigo: t("common.accentIndigo"),
    sage: t("common.accentSage"),
    terracotta: t("common.accentTerracotta"),
    mono: t("common.accentMono"),
  };

  return (
    <>
      {/* Sidebar Header: Zero border-b */}
      <div className="flex h-11 shrink-0 items-center justify-between gap-1.5 pl-2.5 pr-3.5">
        <Menu>
          <MenuTrigger
            render={
              <button
                aria-label={t("nav.workspaceSwitcherAria")}
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-sidebar-accent active:scale-[0.985]"
                type="button"
              />
            }
          >
            <span className="flex size-5.5 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-[11px] font-semibold text-foreground">
              {workspaceInitial}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight text-foreground">
              {workspaceName}
            </span>
            {whoami && whoami.scope.permission !== "admin" ? (
              <Badge className="shrink-0" size="sm" variant="outline">
                {permissionLabels[whoami.scope.permission]}
              </Badge>
            ) : null}
            <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
          </MenuTrigger>

          <MenuPopup align="start" className="w-64">
            {whoami ? (
              <>
                <MenuGroup>
                  <MenuGroupLabel className="flex items-center justify-between gap-2">
                    <span className="truncate">
                      {t("nav.workspacePrincipal", {
                        name: whoami.tokenName ?? workspaceName,
                      })}
                    </span>
                    <Badge size="sm" variant="secondary">
                      {whoami.scope?.permission
                        ? permissionLabels[whoami.scope.permission]
                        : permissionLabels.admin}
                    </Badge>
                  </MenuGroupLabel>
                </MenuGroup>
                <MenuSeparator />
              </>
            ) : null}

            <MenuItem
              onClick={() => {
                onCloseDrawers();
                onOpenSettingsModal();
              }}
            >
              <SettingsIcon />
              <span>{t("nav.goToSettings")}</span>
              {!isDrawer ? (
                <MenuShortcut>
                  <Kbd>⌘,</Kbd>
                </MenuShortcut>
              ) : null}
            </MenuItem>

            <MenuItem
              onClick={() => {
                onCloseDrawers();
                onOpenShortcuts();
              }}
            >
              <KeyboardIcon />
              <span>{t("nav.keyboardShortcuts")}</span>
            </MenuItem>

            <MenuSeparator />

            <MenuItem onClick={onToggleTheme}>
              {effectiveTheme === "dark" ? <SunIcon /> : <MoonIcon />}
              <span>{t("nav.switchTheme")}</span>
            </MenuItem>

            <MenuSub>
              <MenuSubTrigger>
                <PaletteIcon />
                <span>{t("nav.switchAccent")}</span>
              </MenuSubTrigger>
              <MenuSubPopup>
                <MenuRadioGroup
                  onValueChange={(next) => setAccent(next as AccentPreset)}
                  value={accent}
                >
                  {ACCENT_PRESETS.map((preset) => (
                    <MenuRadioItem key={preset} value={preset}>
                      <span className="flex items-center gap-2">
                        <span className={`size-2.5 rounded-full ${ACCENT_DOT_CLASS[preset]}`} />
                        <span>{accentLabels[preset]}</span>
                      </span>
                    </MenuRadioItem>
                  ))}
                </MenuRadioGroup>
              </MenuSubPopup>
            </MenuSub>

            <MenuSeparator />

            <MenuItem onClick={() => void onExportZip()}>
              <DownloadIcon />
              <span>{t("nav.exportWorkspaceZip")}</span>
            </MenuItem>

            <MenuSeparator />

            <MenuItem onClick={() => void onSignOut()} variant="destructive">
              <LogOutIcon />
              <span>{t("nav.signOut")}</span>
            </MenuItem>
          </MenuPopup>
        </Menu>

        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            aria-label={t("nav.newDocument")}
            className="transition-[transform,color,background-color,border-color] duration-[var(--duration-quick)] ease-[var(--ease-smooth-out)] active:scale-[0.985]"
            onClick={onOpenNewDoc}
            size="icon-xs"
            title={t("nav.newDocument")}
            variant="ghost"
          >
            <FilePlus2Icon />
          </Button>
          {isDrawer ? (
            <Button
              aria-label={t("common.close")}
              className="transition-[transform,color,background-color,border-color] duration-[var(--duration-quick)] ease-[var(--ease-smooth-out)] active:scale-[0.985]"
              onClick={onCloseDrawers}
              size="icon-xs"
              title={t("common.close")}
              variant="ghost"
            >
              <XIcon />
            </Button>
          ) : isPeek ? (
            <Button
              aria-label={t("nav.pinSidebarOpen")}
              className="transition-[transform,color,background-color,border-color] duration-[var(--duration-quick)] ease-[var(--ease-smooth-out)] active:scale-[0.985]"
              onClick={() => onSetSidebarCollapsed(false)}
              size="icon-xs"
              title={t("nav.pinSidebarOpen")}
              variant="ghost"
            >
              <PanelLeftOpenIcon />
            </Button>
          ) : (
            <Button
              aria-label={t("nav.collapseSidebar")}
              className="hidden lg:inline-flex"
              onClick={() => onSetSidebarCollapsed(true)}
              size="icon-xs"
              title={t("nav.collapseSidebar")}
              variant="ghost"
            >
              <PanelLeftCloseIcon />
            </Button>
          )}
        </div>
      </div>

      {/* ⌘K Trigger */}
      <div className="pl-2.5 pr-3.5 pt-2 pb-1">
        <button
          className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-md border border-border/75 bg-background/75 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-background hover:text-foreground active:scale-[0.99]"
          onClick={onOpenCommandPalette}
          type="button"
        >
          <span className="flex items-center gap-2">
            <SearchIcon className="size-3.5" />
            <span>{t("nav.searchOrCommand")}</span>
          </span>
          {!isDrawer ? <Kbd>⌘K</Kbd> : null}
        </button>
      </div>
    </>
  );
}
