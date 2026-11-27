import { useInkadeTranslation } from "@inkade/i18n";
import { Badge, cn, Kbd } from "@inkade/ui";
import { useHoverPeekPreference } from "@inkade/views/lib/preferences-store";
import { Link } from "@tanstack/react-router";
import type React from "react";
import { useCallback, useEffect, useRef } from "react";

export type SidebarMode = "tree" | "doc";

export interface SidebarNavLinkProps {
  readonly to:
    | "/daily"
    | "/inbox"
    | "/tasks"
    | "/library"
    | "/graph"
    | "/threads"
    | "/ask"
    | "/connect"
    | "/trash"
    | "/settings";
  readonly label: string;
  readonly icon: React.ReactNode;
  readonly active: boolean;
  readonly badge?: string | undefined;
  readonly badgeVariant?: "secondary" | "warning" | undefined;
  readonly shortcut?: string | undefined;
  readonly onNavigate?: (() => void) | undefined;
}

export function SidebarNavLink({
  to,
  label,
  icon,
  active,
  badge,
  badgeVariant = "secondary",
  shortcut,
  onNavigate,
}: SidebarNavLinkProps): React.ReactElement {
  return (
    <Link
      className={cn(
        "group relative z-10 flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors duration-[var(--duration-micro)]",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-sidebar-foreground hover:bg-sidebar-accent/70 in-data-[glide-visible=true]:hover:bg-transparent hover:text-sidebar-accent-foreground",
      )}
      data-glide-item
      onClick={onNavigate}
      to={to}
    >
      <span className="flex min-w-0 items-center gap-2.5">
        {icon}
        <span className="truncate">{label}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        {shortcut ? (
          <Kbd className="hidden bg-transparent px-1 text-[10px] text-muted-foreground/70 opacity-0 shadow-none ring-0 transition-opacity duration-150 group-hover:opacity-100 group-hover:delay-200 group-focus-visible:opacity-100 lg:inline-flex">
            {shortcut}
          </Kbd>
        ) : null}
        {badge ? (
          <Badge size="sm" variant={badgeVariant}>
            {badge}
          </Badge>
        ) : null}
      </span>
    </Link>
  );
}

export interface SidebarHoverPeekProps {
  readonly enabled: boolean;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly children: React.ReactNode;
}

export function SidebarHoverPeek({
  enabled,
  open,
  onOpenChange,
  children,
}: SidebarHoverPeekProps): React.ReactElement | null {
  const { hoverPeek: hoverPeekEnabled } = useHoverPeekPreference();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const schedulePeek = useCallback(
    (openNext: boolean, delayMs: number) => {
      clearTimer();
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        onOpenChange(openNext);
      }, delayMs);
    },
    [clearTimer, onOpenChange],
  );

  useEffect(() => clearTimer, [clearTimer]);

  useEffect(() => {
    if (!enabled || !hoverPeekEnabled) {
      onOpenChange(false);
    }
  }, [enabled, hoverPeekEnabled, onOpenChange]);

  if (!enabled || !hoverPeekEnabled) return null;

  return (
    <>
      <div
        aria-hidden="true"
        className="fixed top-12 bottom-0 left-0 z-30 hidden w-2.5 lg:block"
        onMouseEnter={() => {
          if (!open) schedulePeek(true, 120);
          else clearTimer();
        }}
        onMouseLeave={clearTimer}
      />
      <aside
        aria-hidden={!open}
        className={cn(
          "fixed top-12 bottom-2 left-2 z-40 hidden w-[272px] flex-col overflow-hidden rounded-lg border border-[var(--border-overlay)] bg-sidebar/96 shadow-[var(--shadow-overlay)] backdrop-blur-md transition-[transform,opacity] will-change-transform lg:flex",
          open
            ? "pointer-events-auto translate-x-0 opacity-100 duration-[var(--duration-fast)] ease-[var(--ease-smooth-out)]"
            : "pointer-events-none -translate-x-4 opacity-0 duration-[var(--duration-quick)] ease-out",
        )}
        data-open={open ? "true" : "false"}
        data-slot="sidebar-hover-peek"
        inert={!open ? true : undefined}
        onMouseEnter={clearTimer}
        onMouseLeave={() => schedulePeek(false, 180)}
      >
        {children}
      </aside>
    </>
  );
}

export function useWorkspacePermissionLabels(): Readonly<
  Record<"read" | "append" | "write" | "admin", string>
> {
  const { t } = useInkadeTranslation();
  return {
    read: t("common.permissionRead"),
    append: t("common.permissionAppend"),
    write: t("common.permissionWrite"),
    admin: t("common.permissionAdmin"),
  };
}
