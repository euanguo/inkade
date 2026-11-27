import type { UserPreferencesPatch, UserPreferencesRecord } from "@inkade/core";
import type { InkadeHttpTransport } from "../http-transport.ts";

export interface PreferencesResource {
  get(): Promise<UserPreferencesRecord>;
  update(patch: UserPreferencesPatch): Promise<UserPreferencesRecord>;
}

export function createPreferencesResource(transport: InkadeHttpTransport): PreferencesResource {
  return {
    get: () => transport.requestJson<UserPreferencesRecord>("/api/v1/preferences"),
    update: (patch) =>
      transport.requestJson<UserPreferencesRecord>("/api/v1/preferences", {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
  };
}
