import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  INKADE_MCP_TOOL_NAMES,
  INKADE_TOOL_DEFINITIONS,
  asDocumentId,
  createId,
  extractSourceDomain,
  idSchema,
  isPrefixedId,
  parseId,
  stripLeadingDuplicateTitle,
  todayLocalDateString,
  ID_PREFIXES,
} from "./index.ts";

describe("@inkade/core ids, dates, markdown & tool definitions", () => {
  test("branded ID helpers and Zod schemas validate prefixes cleanly", () => {
    const docId = createId(ID_PREFIXES.document);
    expect(isPrefixedId(ID_PREFIXES.document, docId)).toBe(true);
    expect(parseId(ID_PREFIXES.document, docId)).toBe(docId);
    expect(() => parseId(ID_PREFIXES.space, docId)).toThrow();

    const artId = createId(ID_PREFIXES.documentArtifact);
    expect(isPrefixedId(ID_PREFIXES.documentArtifact, artId)).toBe(true);
    expect(artId.startsWith("art_")).toBe(true);

    const schema = idSchema(ID_PREFIXES.document);
    expect(schema.parse(docId)).toBe(docId);
    expect(schema.safeParse("spc_wrong").success).toBe(false);
    expect(schema.safeParse("").success).toBe(false);
    expect(asDocumentId("custom_legacy")).toBe(asDocumentId("custom_legacy"));
  });

  test("shared markdown and date helpers normalize titles, domains, and dates", () => {
    expect(stripLeadingDuplicateTitle("# My Title\n\nBody paragraph.", "My Title")).toBe(
      "Body paragraph.",
    );
    expect(stripLeadingDuplicateTitle("# Other Heading\n\nBody", "My Title")).toBe(
      "# Other Heading\n\nBody",
    );
    expect(extractSourceDomain("https://www.example.com/posts/1")).toBe("example.com");
    expect(extractSourceDomain("not-a-url")).toBeNull();
    expect(todayLocalDateString(new Date(2026, 10, 25))).toBe("2026-11-25");
  });

  test("INKADE_TOOL_DEFINITIONS defines 45 unique JSON-Schema-serializable tools", () => {
    expect(INKADE_TOOL_DEFINITIONS.length).toBe(45);
    expect(INKADE_MCP_TOOL_NAMES.length).toBe(45);
    for (const def of INKADE_TOOL_DEFINITIONS) {
      expect(def.name).toBe(`inkade_${def.mcpName}`);
      const jsonSchema = z.toJSONSchema(def.inputSchema);
      expect(jsonSchema.type).toBe("object");
    }
  });
});
