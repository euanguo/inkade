import { describe, expect, test } from "bun:test";
import {
  asSpaceId,
  INKADE_MCP_TOOL_NAMES,
  type TokenScope,
} from "@inkade/core";
import {
  INKADE_TOOL_CATALOG,
  filterInkadeToolsByScope,
  toJsonSchemaToolManifest,
} from "./tool-catalog.ts";

describe("INKADE_TOOL_CATALOG", () => {
  test("defines unique tool names aligned 1:1 with core definitions and valid Zod object schemas", () => {
    const names = INKADE_TOOL_CATALOG.map((t) => t.name);
    const mcpNames = INKADE_TOOL_CATALOG.map((t) => t.mcpName);
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(mcpNames).size).toBe(mcpNames.length);
    expect([...mcpNames].sort()).toEqual([...INKADE_MCP_TOOL_NAMES].sort());
    expect(mcpNames).toContain("claim_thread_binding");
    expect(mcpNames).toContain("get_thread_binding");
    expect(mcpNames).toContain("get_space_schema");
    expect(mcpNames).toContain("upsert_space_schema");
    expect(mcpNames).toContain("list_context_packs");
    expect(mcpNames).toContain("read_context_pack");
    expect(mcpNames).toContain("list_comment_threads");
    expect(mcpNames).toContain("reply_comment_thread");
    expect(mcpNames).toContain("get_viewer_context");
    expect(mcpNames).toContain("scaffold_document");
    expect(mcpNames).toContain("create_document_artifact");
    expect(mcpNames).toContain("update_document_artifact");
    expect(mcpNames).toContain("validate_document_artifact");

    for (const spec of INKADE_TOOL_CATALOG) {
      expect(spec.name).toBe(`inkade_${spec.mcpName}`);
      expect(spec.description.length).toBeGreaterThan(5);
      expect(spec.whenToUse.length).toBeGreaterThan(5);
      expect(typeof spec.execute).toBe("function");
    }
  });

  test("filterInkadeToolsByScope strictly respects permission ladder", () => {
    const readScope: TokenScope = {
      permission: "read",
      spaceIds: [asSpaceId("spc_1")],
      includeDescendants: true,
      denyHardDelete: true,
    };
    const appendScope: TokenScope = { ...readScope, permission: "append" };
    const writeScope: TokenScope = { ...readScope, permission: "write" };
    const adminScope: TokenScope = {
      permission: "admin",
      spaceIds: "*",
      includeDescendants: true,
      denyHardDelete: true,
    };

    const readTools = filterInkadeToolsByScope(readScope);
    expect(readTools.every((t) => t.requiredPermission === "read")).toBe(true);
    expect(readTools.some((t) => t.mutating)).toBe(false);
    expect(readTools.some((t) => t.mcpName === "list_comment_threads")).toBe(true);
    expect(readTools.some((t) => t.mcpName === "get_viewer_context")).toBe(true);
    expect(readTools.some((t) => t.mcpName === "reply_comment_thread")).toBe(false);

    const appendTools = filterInkadeToolsByScope(appendScope);
    expect(appendTools.some((t) => t.mcpName === "claim_thread_binding")).toBe(true);
    expect(appendTools.some((t) => t.mcpName === "reply_comment_thread")).toBe(true);
    expect(appendTools.some((t) => t.mcpName === "create_document")).toBe(false);

    const writeTools = filterInkadeToolsByScope(writeScope);
    expect(writeTools.some((t) => t.mcpName === "create_document")).toBe(true);
    expect(writeTools.some((t) => t.mcpName === "get_audit_logs")).toBe(false);

    const adminTools = filterInkadeToolsByScope(adminScope);
    expect(adminTools.length).toBe(INKADE_TOOL_CATALOG.length);
  });

  test("toJsonSchemaToolManifest produces valid JSON Schema objects for every tool", () => {
    const manifest = toJsonSchemaToolManifest();
    expect(manifest.length).toBe(INKADE_TOOL_CATALOG.length);
    for (const entry of manifest) {
      expect(entry.inputSchema).toBeObject();
      expect(entry.inputSchema.type).toBe("object");
    }
  });
});
