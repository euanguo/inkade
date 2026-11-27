import { describe, expect, test } from "bun:test";
import {
  DEFAULT_USER_PREFERENCES,
  mergeUserPreferences,
  parseUserPreferences,
  userPreferencesPatchSchema,
} from "./preferences.ts";

describe("UserPreferences domain schema & helpers", () => {
  test("parses empty or malformed inputs into defaults and migrates legacy inbox tabs cleanly", () => {
    expect(parseUserPreferences(null)).toEqual(DEFAULT_USER_PREFERENCES);
    expect(parseUserPreferences("not-an-object")).toEqual(DEFAULT_USER_PREFERENCES);
    expect(
      parseUserPreferences({
        tasks: { viewMode: "bogus", boardGroupBy: "priority" },
        reader: { measure: "full", paper: "invalid" },
        library: { displayOptions: { density: "compact", showTags: "nope" } },
      }),
    ).toEqual({
      ...DEFAULT_USER_PREFERENCES,
      tasks: {
        ...DEFAULT_USER_PREFERENCES.tasks,
        boardGroupBy: "priority",
      },
      reader: {
        ...DEFAULT_USER_PREFERENCES.reader,
        measure: "full",
      },
      library: {
        ...DEFAULT_USER_PREFERENCES.library,
        displayOptions: {
          ...DEFAULT_USER_PREFERENCES.library.displayOptions,
          density: "compact",
        },
      },
    });

    expect(parseUserPreferences({ inbox: { defaultTab: "approvals" } }).inbox.defaultTab).toBe(
      "exceptions",
    );
    expect(parseUserPreferences({ inbox: { defaultTab: "alerts" } }).inbox.defaultTab).toBe(
      "exceptions",
    );
    expect(parseUserPreferences({ inbox: { defaultTab: "reviews" } }).inbox.defaultTab).toBe(
      "digest",
    );
    expect(parseUserPreferences({ inbox: { defaultTab: "all" } }).inbox.defaultTab).toBe("digest");
  });

  test("deep-merges partial preference patches without dropping siblings", () => {
    const step1 = mergeUserPreferences(DEFAULT_USER_PREFERENCES, {
      tasks: { viewMode: "board", boardGroupBy: "priority" },
      library: {
        viewMode: "table",
        displayOptions: { density: "compact" },
      },
      layout: { workspaceCanvasWidth: "centered" },
      reader: { measure: "full", paper: "sepia" },
    });

    const step2 = mergeUserPreferences(step1, {
      tasks: { viewMode: "agenda" },
      library: {
        sortBy: "title",
        displayOptions: { showProperties: true },
      },
    });

    expect(step2.tasks.viewMode).toBe("agenda");
    expect(step2.tasks.boardGroupBy).toBe("priority");
    expect(step2.library.viewMode).toBe("table");
    expect(step2.library.sortBy).toBe("title");
    expect(step2.library.displayOptions.density).toBe("compact");
    expect(step2.library.displayOptions.showProperties).toBe(true);
    expect(step2.library.displayOptions.showExcerpt).toBe(true);
    expect(step2.layout.workspaceCanvasWidth).toBe("centered");
    expect(step2.reader.measure).toBe("full");
    expect(step2.reader.paper).toBe("sepia");
  });

  test("patch schema validates allowed literals including 'full' reader measure", () => {
    expect(
      userPreferencesPatchSchema.safeParse({
        layout: { workspaceCanvasWidth: "centered", sidebarMode: "doc", showFormatBar: true },
        reader: { measure: "full" },
        inbox: { defaultTab: "clips" },
      }).success,
    ).toBe(true);

    expect(
      userPreferencesPatchSchema.safeParse({
        reader: { measure: "120ch" },
      }).success,
    ).toBe(false);
  });

  test("patch schema does not inject default values for omitted sibling fields", () => {
    expect(userPreferencesPatchSchema.parse({ layout: { sidebarMode: "doc" } })).toEqual({
      layout: { sidebarMode: "doc" },
    });
    expect(
      userPreferencesPatchSchema.parse({
        tasks: { statusFilter: "all" },
        daily: { focusRailOpen: true },
        library: { displayOptions: { showEmptyDailies: true } },
        threads: { hostFilter: "bb" },
        inbox: { defaultTab: "digest" },
        reader: { fontSize: "lg" },
      }),
    ).toEqual({
      tasks: { statusFilter: "all" },
      daily: { focusRailOpen: true },
      library: { displayOptions: { showEmptyDailies: true } },
      threads: { hostFilter: "bb" },
      inbox: { defaultTab: "digest" },
      reader: { fontSize: "lg" },
    });
  });
});
