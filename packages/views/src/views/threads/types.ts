import type { AdeThreadStatus } from "@inkade/core";

export type ThreadsViewMode = "status" | "conflicts";
export const THREADS_CONFLICT_SESSION_KEY = "inkade:threads:initial-mode";

export interface ThreadsViewUrlState {
  readonly mode?: ThreadsViewMode | undefined;
  readonly host?: string | undefined;
  readonly q?: string | undefined;
}

export interface ThreadsViewProps {
  readonly readonly?: boolean | undefined;
  readonly urlState?: ThreadsViewUrlState | undefined;
  readonly onUrlStateChange?: ((patch: Partial<ThreadsViewUrlState>) => void) | undefined;
}

export interface ThreadGroupMeta {
  readonly status: AdeThreadStatus;
  readonly heading: string;
  readonly description: string;
}
