import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";
import { InkadeError } from "./errors.ts";

/**
 * Generates an opaque lexicographically sortable fractional index key between `prevKey` and `nextKey`.
 */
export function createOrderKeyBetween(prevKey: string | null, nextKey: string | null): string {
  if (prevKey !== null && nextKey !== null && prevKey >= nextKey) {
    throw new InkadeError(
      "VALIDATION_ERROR",
      `Invalid orderKey range: "${prevKey}" must be strictly less than "${nextKey}"`,
    );
  }
  try {
    return generateKeyBetween(prevKey, nextKey);
  } catch (error) {
    throw new InkadeError(
      "VALIDATION_ERROR",
      error instanceof Error ? error.message : "Failed to generate orderKey",
    );
  }
}

/**
 * Generates `count` sorted fractional index keys between `prevKey` and `nextKey`.
 */
export function createOrderKeysBetween(
  prevKey: string | null,
  nextKey: string | null,
  count: number,
): string[] {
  if (!Number.isInteger(count) || count < 0) {
    throw new InkadeError("VALIDATION_ERROR", `Invalid orderKey count: ${count}`);
  }
  if (count === 0) return [];
  if (prevKey !== null && nextKey !== null && prevKey >= nextKey) {
    throw new InkadeError(
      "VALIDATION_ERROR",
      `Invalid orderKey range: "${prevKey}" must be strictly less than "${nextKey}"`,
    );
  }
  try {
    return generateNKeysBetween(prevKey, nextKey, count);
  } catch (error) {
    throw new InkadeError(
      "VALIDATION_ERROR",
      error instanceof Error ? error.message : "Failed to generate orderKeys",
    );
  }
}
