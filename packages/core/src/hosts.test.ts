import { describe, expect, test } from "bun:test";
import {
  DEFAULT_HOST_KIND,
  adeKindSchema,
  claimThreadBindingInputSchema,
  createThreadBindingInputSchema,
  formatHostDisplayName,
  getHostBadgeTone,
  getHostInitials,
  isNeutralHostKind,
  normalizeHostKind,
} from "./index.ts";

describe("open host model", () => {
  test("accepts arbitrary valid host slugs and normalizes case", () => {
    expect(adeKindSchema.parse("Cursor")).toBe("cursor");
    expect(adeKindSchema.parse("opencode")).toBe("opencode");
    expect(adeKindSchema.parse("claude-code")).toBe("claude-code");
    expect(adeKindSchema.parse("custom.ade-1")).toBe("custom.ade-1");
    expect(adeKindSchema.parse("bb")).toBe("bb");
    expect(adeKindSchema.parse("paseo")).toBe("paseo");
    expect(adeKindSchema.parse("any")).toBe(DEFAULT_HOST_KIND);
  });

  test("rejects empty or invalid host slugs", () => {
    expect(() => adeKindSchema.parse("")).toThrow();
    expect(() => adeKindSchema.parse("   ")).toThrow();
    expect(() => adeKindSchema.parse("bad!host")).toThrow();
    expect(() => adeKindSchema.parse("-leading-dash")).toThrow();
    expect(() => adeKindSchema.parse("a".repeat(65))).toThrow();
  });

  test("normalizeHostKind falls back to DEFAULT_HOST_KIND", () => {
    expect(normalizeHostKind("  OpenCode ")).toBe("opencode");
    expect(normalizeHostKind(null)).toBe("any");
    expect(normalizeHostKind("invalid host!")).toBe("any");
  });

  test("identifies neutral hosts and formats display names/initials/tones", () => {
    expect(isNeutralHostKind("any")).toBe(true);
    expect(isNeutralHostKind("generic")).toBe(true);
    expect(isNeutralHostKind("cursor")).toBe(false);

    expect(formatHostDisplayName("any")).toBe("Any");
    expect(formatHostDisplayName("any", "任意宿主")).toBe("任意宿主");
    expect(formatHostDisplayName("bb")).toBe("BB");
    expect(formatHostDisplayName("paseo")).toBe("Paseo");
    expect(formatHostDisplayName("claude-code")).toBe("Claude Code");

    expect(getHostInitials("any")).toBe("AG");
    expect(getHostInitials("generic")).toBe("AG");
    expect(getHostInitials("bb")).toBe("BB");
    expect(getHostInitials("paseo")).toBe("PA");
    expect(getHostInitials("cindy")).toBe("CI");
    expect(getHostInitials("claude-code")).toBe("CC");

    expect(getHostBadgeTone("any")).toBe("slate");
    expect(getHostBadgeTone("generic")).toBe("slate");
    expect(getHostBadgeTone("bb")).toBe("blue");
    expect(getHostBadgeTone("cursor")).toBe(getHostBadgeTone("cursor"));
  });

  test("schemas default create adeKind to any and allow open adeKind in claim", () => {
    const created = createThreadBindingInputSchema.parse({
      documentId: "doc_1",
      externalThreadId: "thr_pending_1",
      title: "Draft outline",
    });
    expect(created.adeKind).toBe("any");

    const claimed = claimThreadBindingInputSchema.parse({
      adeKind: "Cursor",
      externalThreadId: "cur_123",
    });
    expect(claimed.adeKind).toBe("cursor");
  });
});
