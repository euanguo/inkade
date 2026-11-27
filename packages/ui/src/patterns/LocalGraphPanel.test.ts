import { describe, expect, it } from "bun:test";
import { asDocumentId, asLinkId, asSpaceId, type DocumentGraph } from "@inkade/core";
import { buildLocalGraphSimulationData } from "./LocalGraphPanel.tsx";

describe("LocalGraphPanel graph projection", () => {
  it("maps DocumentGraph nodes and edges with space colors and center node highlight", () => {
    const graph: DocumentGraph = {
      centerDocumentId: asDocumentId("doc_center"),
      nodes: [
        {
          id: asDocumentId("doc_center"),
          title: "Architecture",
          slug: "architecture",
          spaceId: asSpaceId("spc_res"),
          kind: "article",
          tags: ["arch"],
          depth: 0,
        },
        {
          id: asDocumentId("doc_hop1"),
          title: "Daily 2026-11-24",
          slug: "daily-2026-11-24",
          spaceId: asSpaceId("spc_daily"),
          kind: "outline",
          tags: [],
          depth: 1,
        },
        {
          id: asDocumentId("doc_hop2"),
          title: "Orphan Note",
          slug: "orphan",
          spaceId: asSpaceId("spc_res"),
          kind: "clip",
          tags: [],
          depth: 2,
        },
      ],
      edges: [
        {
          id: asLinkId("edge_1"),
          sourceDocumentId: asDocumentId("doc_hop1"),
          targetDocumentId: asDocumentId("doc_center"),
          anchorText: "ADR-009",
        },
        {
          id: asLinkId("edge_dangling"),
          sourceDocumentId: asDocumentId("doc_center"),
          targetDocumentId: asDocumentId("doc_missing"),
          anchorText: null,
        },
      ],
    };

    const { nodes, links } = buildLocalGraphSimulationData(graph, [
      { id: asSpaceId("spc_res"), color: "emerald" },
      { id: asSpaceId("spc_daily"), color: "amber" },
    ]);

    expect(nodes).toHaveLength(3);
    const center = nodes.find((n) => n.id === "doc_center");
    expect(center?.isCenter).toBe(true);
    expect(center?.colorHex).toBe("#10b981");
    expect(center?.degree).toBe(2);

    const hop1 = nodes.find((n) => n.id === "doc_hop1");
    expect(hop1?.isCenter).toBe(false);
    expect(hop1?.colorHex).toBe("#f59e0b");

    // Dangling edges targeting missing nodes are filtered out safely
    expect(links).toHaveLength(1);
    expect(links[0]?.id).toBe("edge_1");
  });
});
