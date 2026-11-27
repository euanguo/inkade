import { describe, expect, test } from "bun:test";
import { matchGlob } from "./index.ts";

describe("matchGlob", () => {
  test("matches repository paths and normalizes separators", () => {
    expect(matchGlob("**/personal/*", "/Users/alice/projects/personal/inkade")).toBe(
      true,
    );
    expect(matchGlob("**/work/**", "C:\\repos\\work\\service")).toBe(true);
    expect(matchGlob("**/personal/*", "/Users/alice/projects/work/app")).toBe(false);
    expect(matchGlob("", "anything")).toBe(false);
  });
});
