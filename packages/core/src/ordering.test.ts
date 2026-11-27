import { describe, expect, test } from "bun:test";
import {
  createOrderKeyBetween,
  createOrderKeysBetween,
  InkadeError,
} from "./index.ts";

describe("fractional-indexing ordering", () => {
  test("generates strictly monotonic order keys for appends, prepends, and splits", () => {
    const first = createOrderKeyBetween(null, null);
    const second = createOrderKeyBetween(first, null);
    const zeroth = createOrderKeyBetween(null, first);
    const middle = createOrderKeyBetween(first, second);

    expect(zeroth < first).toBe(true);
    expect(first < middle).toBe(true);
    expect(middle < second).toBe(true);
  });

  test("generates batch keys in sorted order", () => {
    const a = createOrderKeyBetween(null, null);
    const b = createOrderKeyBetween(a, null);
    const batch = createOrderKeysBetween(a, b, 5);

    expect(batch).toHaveLength(5);
    const all = [a, ...batch, b];
    for (let i = 1; i < all.length; i++) {
      expect((all[i - 1] ?? "") < (all[i] ?? "")).toBe(true);
    }
  });

  test("throws InkadeError VALIDATION_ERROR when prevKey >= nextKey", () => {
    expect(() => createOrderKeyBetween("a5", "a2")).toThrow(InkadeError);
    expect(() => createOrderKeysBetween("a5", "a5", 2)).toThrow(InkadeError);
    expect(createOrderKeysBetween(null, null, 0)).toEqual([]);
  });
});
