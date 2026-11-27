import { describe, expect, test } from "bun:test";
import {
  ADMIN_USER_SCOPE,
  asSpaceId,
  evaluateScopeAccess,
  resolveAllowedSpaceIds,
  summarizeEffectiveScope,
  type Space,
  type TokenScope,
} from "./index.ts";

const spaces: readonly Pick<Space, "id" | "parentId">[] = [
  { id: asSpaceId("spc_daily"), parentId: null },
  { id: asSpaceId("spc_research"), parentId: null },
  { id: asSpaceId("spc_research_ai"), parentId: asSpaceId("spc_research") },
  { id: asSpaceId("spc_research_ai_ade"), parentId: asSpaceId("spc_research_ai") },
  { id: asSpaceId("spc_private"), parentId: null },
];

describe("evaluateScopeAccess", () => {
  test("inherits descendant spaces when includeDescendants is enabled", () => {
    const scope: TokenScope = {
      permission: "write",
      spaceIds: [asSpaceId("spc_research")],
      includeDescendants: true,
      allowedKinds: ["article", "clip"],
      denyHardDelete: true,
    };

    const allowedSpaces = resolveAllowedSpaceIds(scope, spaces);
    expect(allowedSpaces).not.toBe("*");
    if (allowedSpaces !== "*") {
      expect(allowedSpaces.has(asSpaceId("spc_research"))).toBe(true);
      expect(allowedSpaces.has(asSpaceId("spc_research_ai"))).toBe(true);
      expect(allowedSpaces.has(asSpaceId("spc_research_ai_ade"))).toBe(true);
      expect(allowedSpaces.has(asSpaceId("spc_private"))).toBe(false);
    }

    expect(
      evaluateScopeAccess(
        scope,
        "write",
        { spaceId: asSpaceId("spc_research_ai_ade"), kind: "article" },
        spaces,
      ).allowed,
    ).toBe(true);

    expect(
      evaluateScopeAccess(
        scope,
        "read",
        { spaceId: asSpaceId("spc_private"), kind: "article" },
        spaces,
      ).allowed,
    ).toBe(false);
  });

  test("handles cyclic space parents safely without infinite loop", () => {
    const cyclicSpaces: readonly Pick<Space, "id" | "parentId">[] = [
      { id: asSpaceId("spc_a"), parentId: asSpaceId("spc_b") },
      { id: asSpaceId("spc_b"), parentId: asSpaceId("spc_a") },
    ];
    const scope: TokenScope = {
      permission: "read",
      spaceIds: [asSpaceId("spc_a")],
      includeDescendants: true,
      denyHardDelete: true,
    };

    const resolved = resolveAllowedSpaceIds(scope, cyclicSpaces);
    expect(resolved).not.toBe("*");
    if (resolved !== "*") {
      expect(resolved.has(asSpaceId("spc_a"))).toBe(true);
      expect(resolved.has(asSpaceId("spc_b"))).toBe(true);
    }
  });

  test("enforces permission levels, kind filtering, and hard-delete guard", () => {
    const appendOnly: TokenScope = {
      permission: "append",
      spaceIds: [asSpaceId("spc_daily")],
      includeDescendants: false,
      allowedKinds: ["outline"],
      denyHardDelete: true,
    };

    expect(
      evaluateScopeAccess(
        appendOnly,
        "append",
        { spaceId: asSpaceId("spc_daily"), kind: "outline" },
        spaces,
      ).allowed,
    ).toBe(true);

    expect(
      evaluateScopeAccess(
        appendOnly,
        "write",
        { spaceId: asSpaceId("spc_daily"), kind: "outline" },
        spaces,
      ).allowed,
    ).toBe(false);

    expect(
      evaluateScopeAccess(
        appendOnly,
        "append",
        { spaceId: asSpaceId("spc_daily"), kind: "article" },
        spaces,
      ).allowed,
    ).toBe(false);

    expect(
      evaluateScopeAccess(appendOnly, "append", { spaceId: asSpaceId("spc_daily") }, spaces)
        .allowed,
    ).toBe(false);

    const adminWithGuard: TokenScope = {
      permission: "admin",
      spaceIds: "*",
      includeDescendants: true,
      denyHardDelete: true,
    };

    expect(
      evaluateScopeAccess(
        adminWithGuard,
        "hard_delete",
        { spaceId: asSpaceId("spc_daily") },
        spaces,
      ).allowed,
    ).toBe(false);

    expect(
      evaluateScopeAccess(
        ADMIN_USER_SCOPE,
        "hard_delete",
        { spaceId: asSpaceId("spc_daily"), kind: "article" },
        spaces,
      ).allowed,
    ).toBe(true);
  });

  test("tightens tagAllowlist: rejects undefined/empty tags for documents, allows space checks", () => {
    const scope: TokenScope = {
      permission: "read",
      spaceIds: [asSpaceId("spc_research")],
      includeDescendants: true,
      tagAllowlist: ["project/inkade", "shared"],
      allowedKinds: ["article"],
      denyHardDelete: true,
    };

    expect(
      evaluateScopeAccess(
        scope,
        "read",
        { spaceId: asSpaceId("spc_research_ai"), kind: "article", tags: ["project/inkade"] },
        spaces,
      ).allowed,
    ).toBe(true);

    expect(
      evaluateScopeAccess(
        scope,
        "read",
        { spaceId: asSpaceId("spc_research_ai"), kind: "article", tags: ["personal-diary"] },
        spaces,
      ).allowed,
    ).toBe(false);

    expect(
      evaluateScopeAccess(
        scope,
        "read",
        { spaceId: asSpaceId("spc_research_ai"), kind: "article", tags: [] },
        spaces,
      ).allowed,
    ).toBe(false);

    expect(
      evaluateScopeAccess(
        scope,
        "read",
        { spaceId: asSpaceId("spc_research_ai"), kind: "article" },
        spaces,
      ).allowed,
    ).toBe(false);

    expect(
      evaluateScopeAccess(
        scope,
        "read",
        { spaceId: asSpaceId("spc_research_ai"), resourceType: "space" },
        spaces,
      ).allowed,
    ).toBe(true);
  });

  test("summarizeEffectiveScope expands allowed spaces and nullable constraints", () => {
    const scope: TokenScope = {
      permission: "append",
      spaceIds: [asSpaceId("spc_research")],
      includeDescendants: true,
      tagAllowlist: ["ai"],
      denyHardDelete: true,
    };

    const summary = summarizeEffectiveScope(scope, spaces);
    expect(summary.permission).toBe("append");
    expect(summary.allowedSpaceIds).toEqual([
      asSpaceId("spc_research"),
      asSpaceId("spc_research_ai"),
      asSpaceId("spc_research_ai_ade"),
    ]);
    expect(summary.tagAllowlist).toEqual(["ai"]);
    expect(summary.allowedKinds).toBeNull();
    expect(summary.denyHardDelete).toBe(true);
  });
});
