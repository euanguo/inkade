import type {
  AdeThreadBinding,
  AdeThreadStatus,
  DocumentHighlight,
  DocumentId,
  DocumentSummary,
  HighlightId,
  OutlineNodeId,
  Space,
} from "@inkade/core";
import type { useInkadeTranslation } from "@inkade/i18n";

export interface DocumentDetailViewProps {
  readonly documentId: DocumentId;
  readonly mode?: "read" | "edit" | undefined;
  readonly focusNodeId?: OutlineNodeId | undefined;
  readonly focusHeading?: string | undefined;
  readonly focusHighlightId?: HighlightId | undefined;
  readonly focusPage?: number | undefined;
  readonly focusAnnotationId?: string | undefined;
  readonly readonly?: boolean | undefined;
  readonly hideHeaderActions?: boolean | undefined;
  readonly spaces?: readonly Space[] | undefined;
  readonly workspaceDocs?: readonly DocumentSummary[] | undefined;
  readonly externalSplitDocId?: DocumentId | null | undefined;
  readonly onExternalSplitClear?: (() => void) | undefined;
}

export type SplitMode = "closed" | "doc" | "daily";

export function getBindingStatusLabel(
  status: AdeThreadStatus,
  t: ReturnType<typeof useInkadeTranslation>["t"],
): string {
  switch (status) {
    case "queued":
      return t("common.statusQueued");
    case "running":
      return t("common.statusRunning");
    case "waiting_input":
      return t("common.statusWaitingShort");
    case "completed":
      return t("common.statusCompleted");
    case "failed":
      return t("common.statusFailed");
    case "archived":
      return t("common.statusArchived");
  }
}

export const EMPTY_BINDINGS: readonly AdeThreadBinding[] = [];
export const EMPTY_HIGHLIGHTS: readonly DocumentHighlight[] = [];
export const EMPTY_SPACES: readonly Space[] = [];
export const EMPTY_DOCS: readonly DocumentSummary[] = [];

export interface ActiveHeadingStore {
  getSnapshot(): string | null;
  set(next: string | null): void;
  subscribe(listener: () => void): () => void;
}

export function createActiveHeadingStore(): ActiveHeadingStore {
  let current: string | null = null;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => current,
    set: (next: string | null) => {
      if (current === next) return;
      current = next;
      for (const listener of listeners) {
        listener();
      }
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function scrollContainerToElement(
  container: HTMLElement | null,
  target: HTMLElement | null,
  block: "start" | "center",
  offsetPx = 20,
): void {
  if (!container || !target) return;
  const containerRect = container.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const nextTop =
    block === "center"
      ? container.scrollTop +
        (targetRect.top - containerRect.top) -
        (containerRect.height - targetRect.height) / 2
      : container.scrollTop + (targetRect.top - containerRect.top) - offsetPx;
  container.scrollTo({ top: Math.max(0, nextTop), behavior: "smooth" });
}
