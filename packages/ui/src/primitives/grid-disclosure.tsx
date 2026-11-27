"use client";

import type * as React from "react";
import { cn } from "../lib/utils.ts";

export interface GridDisclosureProps extends React.HTMLAttributes<HTMLDivElement> {
  readonly open: boolean;
  readonly children: React.ReactNode;
}

/**
 * Smooth height-and-opacity disclosure driven by CSS Grid `0fr <-> 1fr` track sizing.
 * Closed subtrees are marked `inert` so hidden controls never trap keyboard focus.
 */
export function GridDisclosure({
  open,
  className,
  children,
  style,
  ...props
}: GridDisclosureProps): React.ReactElement {
  return (
    <div
      className={cn(
        "grid transition-[grid-template-rows,opacity] duration-[var(--duration-fast)] ease-[var(--ease-out-strong)] motion-reduce:transition-none",
        className,
      )}
      data-open={open ? "true" : "false"}
      data-slot="grid-disclosure"
      style={{
        gridTemplateRows: open ? "1fr" : "0fr",
        opacity: open ? 1 : 0,
        ...style,
      }}
      {...props}
    >
      <div
        aria-hidden={!open || undefined}
        className="min-h-0 overflow-hidden"
        data-slot="grid-disclosure-inner"
        inert={!open ? true : undefined}
      >
        {children}
      </div>
    </div>
  );
}
