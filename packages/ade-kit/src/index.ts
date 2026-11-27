import type { AdeKind } from "@inkade/core";

export interface AdeAdapterCapabilities {
  readonly adeKind: AdeKind;
  readonly supportsPinnedSidebar: boolean;
  readonly supportsInlinePreviewCard: boolean;
  readonly supportsProgrammaticSpawn: boolean;
  readonly supportsManagedSecrets: boolean;
}

export * from "./scope-rules.ts";
export * from "./thread-sync.ts";
export * from "./prompts.ts";
export * from "./dispatch.ts";
