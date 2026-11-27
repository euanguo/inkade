import type { DocumentRecord } from "@inkade/core";
import type React from "react";
import { createContext, useCallback, useContext, useMemo, useState } from "react";

export type InspectorTab = "threads" | "backlinks" | "revisions";

export interface InspectorTarget {
  readonly document: DocumentRecord | null;
  readonly selectedNodeId?: string | null | undefined;
}

interface InspectorContextValue {
  readonly open: boolean;
  readonly setOpen: (open: boolean) => void;
  readonly toggleOpen: () => void;
  readonly activeTab: InspectorTab;
  readonly setActiveTab: (tab: InspectorTab) => void;
  readonly target: InspectorTarget;
  readonly setTarget: (target: InspectorTarget) => void;
  readonly openWithTab: (tab: InspectorTab) => void;
}

const InspectorContext = createContext<InspectorContextValue | null>(null);

export function InspectorProvider({ children }: { readonly children: React.ReactNode }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<InspectorTab>("threads");
  const [target, setTarget] = useState<InspectorTarget>({ document: null, selectedNodeId: null });

  const toggleOpen = useCallback(() => {
    setOpen((prev) => !prev);
  }, []);

  const openWithTab = useCallback((tab: InspectorTab) => {
    setActiveTab(tab);
    setOpen(true);
  }, []);

  const value = useMemo<InspectorContextValue>(
    () => ({
      open,
      setOpen,
      toggleOpen,
      activeTab,
      setActiveTab,
      target,
      setTarget,
      openWithTab,
    }),
    [open, toggleOpen, activeTab, target, openWithTab],
  );

  return <InspectorContext.Provider value={value}>{children}</InspectorContext.Provider>;
}

export function useInspector(): InspectorContextValue {
  const ctx = useContext(InspectorContext);
  if (!ctx) {
    throw new Error("useInspector must be used within InspectorProvider");
  }
  return ctx;
}
