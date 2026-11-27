import { describe, expect, it } from "bun:test";
import { asSpaceId, asWorkspaceId, type Space, type TokenScope } from "@inkade/core";
import { parseHighlightSegments } from "./command-highlight.ts";
import { buildSpaceSelectionTree } from "./ScopeTreePicker.tsx";

describe("parseHighlightSegments", () => {
  it("splits FTS5 <mark> tags into safe React highlight segments", () => {
    expect(parseHighlightSegments("Concurrent <mark>outline</mark> tree <mark>lock</mark>")).toEqual([
      { text: "Concurrent ", highlighted: false },
      { text: "outline", highlighted: true },
      { text: " tree ", highlighted: false },
      { text: "lock", highlighted: true },
    ]);
  });

  it("strips non-mark HTML tags safely without XSS risk", () => {
    expect(
      parseHighlightSegments('<img src=x onerror=alert(1)>Hello <mark><b>world</b></mark>'),
    ).toEqual([
      { text: "Hello ", highlighted: false },
      { text: "world", highlighted: true },
    ]);
  });

  it("returns empty array for empty snippets", () => {
    expect(parseHighlightSegments("")).toEqual([]);
  });
});

describe("buildSpaceSelectionTree", () => {
  const spaces: Space[] = [
    {
      id: asSpaceId("sp_root"),
      workspaceId: asWorkspaceId("ws_1"),
      parentId: null,
      slug: "research",
      name: "Research",
      sortOrder: 0,
      archivedAt: null,
      createdAt: "2026-11-24T00:00:00.000Z",
      updatedAt: "2026-11-24T00:00:00.000Z",
    },
    {
      id: asSpaceId("sp_child"),
      workspaceId: asWorkspaceId("ws_1"),
      parentId: asSpaceId("sp_root"),
      slug: "agents",
      name: "Agents",
      sortOrder: 0,
      archivedAt: null,
      createdAt: "2026-11-24T00:00:00.000Z",
      updatedAt: "2026-11-24T00:00:00.000Z",
    },
  ];

  it("distinguishes directly selected spaces from inherited descendants", () => {
    const withInheritance: TokenScope = {
      permission: "read",
      spaceIds: [asSpaceId("sp_root")],
      includeDescendants: true,
      denyHardDelete: true,
    };

    const tree = buildSpaceSelectionTree(spaces, withInheritance);
    expect(tree.map((t) => [t.space.id, t.isDirectlySelected, t.isInherited])).toEqual([
      [asSpaceId("sp_root"), true, false],
      [asSpaceId("sp_child"), false, true],
    ]);

    const withoutInheritance: TokenScope = {
      ...withInheritance,
      includeDescendants: false,
    };
    const flatTree = buildSpaceSelectionTree(spaces, withoutInheritance);
    expect(flatTree.map((t) => [t.space.id, t.isDirectlySelected, t.isInherited])).toEqual([
      [asSpaceId("sp_root"), true, false],
      [asSpaceId("sp_child"), false, false],
    ]);
  });
});
