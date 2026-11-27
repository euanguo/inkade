import {
  DOCUMENT_KINDS,
  type DocumentId,
  type DocumentKind,
  type SpaceId,
  type WorkspaceGraphEdge,
  type WorkspaceGraphEdgeKind,
  type WorkspaceGraphNode,
} from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import {
  useInkadeDocument,
  useInkadeSpaces,
  useInkadeWorkspaceGraph,
  useLinkDocumentTargetMutation,
} from "@inkade/sdk/react";
import {
  Badge,
  Button,
  cn,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Input,
  ScrollArea,
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Switch,
} from "@inkade/ui";
import {
  usePaperMode,
  useSurfaceTheme,
  useThemePreference,
} from "@inkade/views/lib/preferences-store";
import {
  SigmaContainer,
  useCamera,
  useLoadGraph,
  useRegisterEvents,
  useSigma,
} from "@react-sigma/core";
import "@react-sigma/core/lib/style.css";
import { useNavigate } from "@tanstack/react-router";
import Graph, { MultiUndirectedGraph } from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import {
  Columns2Icon,
  ExternalLinkIcon,
  Link2Icon,
  Maximize2Icon,
  NetworkIcon,
  RefreshCwIcon,
  SearchIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_DEPTH_LAYERS } from "sigma";
import { layerDashed, layerPlain, pathLine, pathLoop } from "sigma/rendering";
import { DEFAULT_NODE_PRIMITIVES, DEFAULT_STYLES } from "sigma/types";
import { useAppActions } from "../components/AppShell.tsx";
import { showErrorToast, showSuccessToast } from "../lib/undo.ts";

interface GraphThemePalette {
  readonly canvasBg: string;
  readonly labelColor: string;
  readonly backdropBg: string;
  readonly backdropShadow: string;
  readonly explicitEdge: string;
  readonly mirrorEdge: string;
  readonly semanticEdge: string;
  readonly dimEdge: string;
  readonly dimNode: string;
  readonly highlightNode: string;
  readonly defaultNode: string;
}

const NODE_SERIES_LIGHT = [
  "#2563eb",
  "#059669",
  "#d97706",
  "#7c3aed",
  "#e11d48",
  "#0891b2",
  "#4f46e5",
  "#65a30d",
] as const;

const NODE_SERIES_DARK = [
  "#60a5fa",
  "#34d399",
  "#fbbf24",
  "#a78bfa",
  "#fb7185",
  "#22d3ee",
  "#818cf8",
  "#a3e635",
] as const;

function resolveGraphThemePalette(
  surfaceTheme: string,
  paperMode: string,
  effectiveTheme: "light" | "dark",
): GraphThemePalette {
  const isDark = effectiveTheme === "dark";
  if (paperMode === "sepia") {
    return isDark
      ? {
          canvasBg: "#161411",
          labelColor: "#e6dec8",
          backdropBg: "#1e1b16",
          backdropShadow: "rgba(0, 0, 0, 0.65)",
          explicitEdge: "#7c6f59",
          mirrorEdge: "#2dd4bf",
          semanticEdge: "#f59e0b",
          dimEdge: "#26211a",
          dimNode: "#3c352a",
          highlightNode: "#fbbf24",
          defaultNode: "#d97706",
        }
      : {
          canvasBg: "#fbf8f1",
          labelColor: "#2b251e",
          backdropBg: "#fbf8f1",
          backdropShadow: "rgba(43, 37, 30, 0.25)",
          explicitEdge: "#b8a890",
          mirrorEdge: "#0f766e",
          semanticEdge: "#b45309",
          dimEdge: "#ebe3d5",
          dimNode: "#dfd6c7",
          highlightNode: "#b45309",
          defaultNode: "#78716c",
        };
  }
  if (isDark && surfaceTheme === "dark-dimmed") {
    return {
      canvasBg: "#191b1f",
      labelColor: "#eeeeef",
      backdropBg: "#1f2126",
      backdropShadow: "rgba(0, 0, 0, 0.7)",
      explicitEdge: "#444b59",
      mirrorEdge: "#2dd4bf",
      semanticEdge: "#c084fc",
      dimEdge: "#23262e",
      dimNode: "#323741",
      highlightNode: "#818cf8",
      defaultNode: "#94a3b8",
    };
  }
  if (isDark) {
    return {
      canvasBg: "#141517",
      labelColor: "#eeeeef",
      backdropBg: "#18191c",
      backdropShadow: "rgba(0, 0, 0, 0.72)",
      explicitEdge: "#64748b",
      mirrorEdge: "#34d399",
      semanticEdge: "#a78bfa",
      dimEdge: "#1f2126",
      dimNode: "#2e3138",
      highlightNode: "#60a5fa",
      defaultNode: "#9ca3af",
    };
  }
  return {
    canvasBg: surfaceTheme === "light-dimmed" ? "#fbfaf7" : "#ffffff",
    labelColor: "#171717",
    backdropBg: surfaceTheme === "light-dimmed" ? "#fbfaf7" : "#ffffff",
    backdropShadow: "rgba(0, 0, 0, 0.22)",
    explicitEdge: "#94a3b8",
    mirrorEdge: "#059669",
    semanticEdge: "#7c3aed",
    dimEdge: "#e5e7eb",
    dimNode: "#d4d4d8",
    highlightNode: "#2563eb",
    defaultNode: "#52525b",
  };
}

interface GraphNodeAttr {
  label: string;
  x: number;
  y: number;
  size: number;
  color: string;
  baseColor: string;
  zIndex: number;
  spaceId: string;
  kind: DocumentKind;
  degree: number;
}

interface GraphEdgeAttr {
  size: number;
  color: string;
  baseColor: string;
  edgeKind: WorkspaceGraphEdgeKind;
  weight: number;
  dashSize: number;
  gapSize: number;
}

function buildGraphologyInstance(
  nodes: readonly WorkspaceGraphNode[],
  edges: readonly WorkspaceGraphEdge[],
  palette: GraphThemePalette,
  spaceColorMap: ReadonlyMap<SpaceId, string>,
  isDark: boolean,
): Graph<GraphNodeAttr, GraphEdgeAttr> {
  const graph = new Graph<GraphNodeAttr, GraphEdgeAttr>({
    type: "undirected",
    multi: true,
    allowSelfLoops: false,
  });

  const series = isDark ? NODE_SERIES_DARK : NODE_SERIES_LIGHT;
  const total = Math.max(1, nodes.length);
  const isNarrow = typeof window !== "undefined" && window.innerWidth < 640;

  nodes.forEach((node, idx) => {
    const angle = (idx / total) * Math.PI * 2;
    const radius = 12 + (idx % 5) * 6;
    const baseColor =
      spaceColorMap.get(node.spaceId) ?? series[idx % series.length] ?? palette.defaultNode;
    const displayLabel = (() => {
      if (!isNarrow) return node.title;
      const isoMatch = node.title.match(/(?:^|Daily\s*[·•-]\s*)(\d{4})-(\d{2})-(\d{2})\b/i);
      if (isoMatch) return `${isoMatch[2]}-${isoMatch[3]}`;
      const zhMatch = node.title.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
      if (zhMatch) return `${zhMatch[2]}/${zhMatch[3]}`;
      return node.title.length > 13 ? `${node.title.slice(0, 12)}…` : node.title;
    })();
    graph.addNode(node.id, {
      label: displayLabel,
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      size: 6 + Math.min(13, Math.sqrt(Math.max(1, node.degree)) * 3.2),
      color: baseColor,
      baseColor,
      zIndex: 0,
      spaceId: node.spaceId,
      kind: node.kind,
      degree: node.degree,
    });
  });

  for (const edge of edges) {
    if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) continue;
    const baseColor =
      edge.kind === "mirror"
        ? palette.mirrorEdge
        : edge.kind === "semantic"
          ? palette.semanticEdge
          : palette.explicitEdge;
    graph.addEdgeWithKey(edge.id, edge.source, edge.target, {
      size: edge.kind === "explicit" ? 1.5 : edge.kind === "mirror" ? 1.9 : 1.2,
      color: baseColor,
      baseColor,
      edgeKind: edge.kind,
      weight: edge.weight,
      dashSize: edge.kind === "semantic" ? 7 : 10,
      gapSize: edge.kind === "semantic" ? 6 : 0,
    });
  }

  if (graph.order >= 2 && graph.size >= 1) {
    const inferred = forceAtlas2.inferSettings(graph);
    forceAtlas2.assign(graph, {
      iterations: 95,
      settings: {
        ...inferred,
        adjustSizes: true,
        gravity: 0.25,
        scalingRatio: Math.max(58, inferred.scalingRatio ?? 58),
        slowDown: 2,
      },
    });
    if (!isNarrow) {
      graph.forEachNode((nodeKey, attrs) => {
        graph.setNodeAttribute(nodeKey, "x", attrs.x * 1.65);
        graph.setNodeAttribute(nodeKey, "y", attrs.y * 1.15);
      });
    }
  }

  // Iterative true screen-pixel label relaxation across zoom refit passes
  if (graph.order >= 2 && graph.order <= 200) {
    const nodesData: Array<{ key: string; x: number; y: number; hw: number; hh: number }> = [];
    graph.forEachNode((key, attrs) => {
      const labelLen = typeof attrs.label === "string" ? Math.min(attrs.label.length, 52) : 12;
      nodesData.push({
        key,
        x: typeof attrs.x === "number" ? attrs.x : 0,
        y: typeof attrs.y === "number" ? attrs.y : 0,
        hw: labelLen * 4.1 + 30,
        hh: 46,
      });
    });

    const stageW = isNarrow ? 340 : 1020;
    const stageH = isNarrow ? 440 : 700;

    for (let pass = 0; pass < 6; pass++) {
      let minX = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      for (const n of nodesData) {
        if (n.x < minX) minX = n.x;
        if (n.x > maxX) maxX = n.x;
        if (n.y < minY) minY = n.y;
        if (n.y > maxY) maxY = n.y;
      }
      const scale = Math.min(
        stageW / Math.max(maxX - minX, 1e-3),
        stageH / Math.max(maxY - minY, 1e-3),
      );
      for (const n of nodesData) {
        n.x = (n.x - minX) * scale;
        n.y = (n.y - minY) * scale;
      }

      for (let iter = 0; iter < 50; iter++) {
        for (let i = 0; i < nodesData.length; i++) {
          const a = nodesData[i]!;
          for (let j = i + 1; j < nodesData.length; j++) {
            const b = nodesData[j]!;
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const ox = a.hw + b.hw - Math.abs(dx);
            const oy = a.hh + b.hh - Math.abs(dy);
            if (ox <= 0 || oy <= 0) continue;

            if (oy * 2.4 <= ox) {
              const dirY = dy === 0 ? (i % 2 === 0 ? -1 : 1) : Math.sign(dy);
              const push = oy * 0.35 * dirY;
              a.y -= push;
              b.y += push;
            } else {
              const dirX = dx === 0 ? (i % 2 === 0 ? -1 : 1) : Math.sign(dx);
              const push = ox * 0.35 * dirX;
              a.x -= push;
              b.x += push;
            }
          }
        }
      }
    }

    for (const n of nodesData) {
      graph.setNodeAttribute(n.key, "x", n.x);
      graph.setNodeAttribute(n.key, "y", n.y);
    }
  }

  return graph;
}

interface GraphCanvasControllerProps {
  readonly nodes: readonly WorkspaceGraphNode[];
  readonly edges: readonly WorkspaceGraphEdge[];
  readonly searchMatchedIds: ReadonlySet<DocumentId> | null;
  readonly focusedNodeId: DocumentId | null;
  readonly hoveredNodeId: DocumentId | null;
  readonly layoutVersion: number;
  readonly fitSignal: number;
  readonly palette: GraphThemePalette;
  readonly spaceColorMap: ReadonlyMap<SpaceId, string>;
  readonly isDark: boolean;
  readonly onSelectNode: (nodeId: DocumentId | null) => void;
  readonly onHoverNode: (nodeId: DocumentId | null) => void;
}

function GraphCanvasController({
  nodes,
  edges,
  searchMatchedIds,
  focusedNodeId,
  hoveredNodeId,
  layoutVersion,
  fitSignal,
  palette,
  spaceColorMap,
  isDark,
  onSelectNode,
  onHoverNode,
}: GraphCanvasControllerProps): null {
  const sigma = useSigma<GraphNodeAttr, GraphEdgeAttr>();
  const loadGraph = useLoadGraph<GraphNodeAttr, GraphEdgeAttr>();
  const registerEvents = useRegisterEvents();
  const { reset } = useCamera();
  const prevTopologyKeyRef = useRef<string>("");

  const topologyKey = useMemo(() => {
    const nKey = nodes.map((n) => n.id).join(",");
    const eKey = edges.map((e) => `${e.id}:${e.kind}`).join(",");
    return `${nKey}|${eKey}`;
  }, [edges, nodes]);

  useEffect(() => {
    if (prevTopologyKeyRef.current === topologyKey && sigma.getGraph().order === nodes.length) {
      return;
    }
    prevTopologyKeyRef.current = topologyKey;
    const graph = buildGraphologyInstance(nodes, edges, palette, spaceColorMap, isDark);
    loadGraph(graph, true);
  }, [edges, isDark, loadGraph, nodes, palette, sigma, spaceColorMap, topologyKey]);

  useEffect(() => {
    if (layoutVersion === 0) return;
    const graph = sigma.getGraph();
    if (graph.order < 2) return;
    const inferred = forceAtlas2.inferSettings(graph);
    forceAtlas2.assign(graph, {
      iterations: 110,
      settings: {
        ...inferred,
        gravity: 1.4,
        scalingRatio: Math.max(8, inferred.scalingRatio ?? 8),
        slowDown: 2,
      },
    });
    sigma.refresh();
  }, [layoutVersion, sigma]);

  useEffect(() => {
    if (fitSignal === 0) return;
    void reset({ duration: 280 });
  }, [fitSignal, reset]);

  useEffect(() => {
    const graph = sigma.getGraph();
    const anchorId = hoveredNodeId ?? focusedNodeId;
    const neighborSet =
      anchorId && graph.hasNode(anchorId) ? new Set(graph.neighbors(anchorId)) : null;

    graph.forEachNode((nodeKey, attrs) => {
      const series = isDark ? NODE_SERIES_DARK : NODE_SERIES_LIGHT;
      const baseColor =
        spaceColorMap.get(attrs.spaceId as SpaceId) ??
        series[attrs.label.length % series.length] ??
        palette.defaultNode;

      const hiddenBySearch =
        searchMatchedIds !== null && !searchMatchedIds.has(nodeKey as DocumentId);
      const dimmedByFocus =
        anchorId !== null &&
        nodeKey !== anchorId &&
        !(neighborSet && neighborSet.has(nodeKey));

      const nextColor =
        nodeKey === anchorId
          ? palette.highlightNode
          : hiddenBySearch || dimmedByFocus
            ? palette.dimNode
            : baseColor;
      const nextZ = nodeKey === anchorId ? 2 : neighborSet?.has(nodeKey) ? 1 : 0;

      graph.mergeNodeAttributes(nodeKey, {
        color: nextColor,
        baseColor,
        zIndex: nextZ,
      });
    });

    graph.forEachEdge((edgeKey, attrs, source, target) => {
      const activeColor =
        attrs.edgeKind === "mirror"
          ? palette.mirrorEdge
          : attrs.edgeKind === "semantic"
            ? palette.semanticEdge
            : palette.explicitEdge;

      const touchesAnchor =
        anchorId === null || source === anchorId || target === anchorId;
      const matchesSearch =
        searchMatchedIds === null ||
        searchMatchedIds.has(source as DocumentId) ||
        searchMatchedIds.has(target as DocumentId);

      graph.mergeEdgeAttributes(edgeKey, {
        baseColor: activeColor,
        color: touchesAnchor && matchesSearch ? activeColor : palette.dimEdge,
      });
    });

    sigma.refresh();
  }, [
    focusedNodeId,
    hoveredNodeId,
    isDark,
    palette,
    searchMatchedIds,
    sigma,
    spaceColorMap,
  ]);

  useEffect(() => {
    registerEvents({
      clickNode: (event) => {
        onSelectNode(event.node as DocumentId);
      },
      clickStage: () => {
        onSelectNode(null);
      },
      enterNode: (event) => {
        onHoverNode(event.node as DocumentId);
      },
      leaveNode: () => {
        onHoverNode(null);
      },
    });
  }, [onHoverNode, onSelectNode, registerEvents]);

  return null;
}

export function GraphPage(): React.ReactElement {
  const { t } = useInkadeTranslation();
  const navigate = useNavigate();
  const { requestOpenSplitDoc } = useAppActions();
  const { surfaceTheme } = useSurfaceTheme();
  const { paper } = usePaperMode();
  const { effectiveTheme } = useThemePreference();

  const [searchQuery, setSearchQuery] = useState("");
  const [spaceFilter, setSpaceFilter] = useState<string>("all");
  const [kindFilter, setKindFilter] = useState<string>("all");
  const [tagFilter, setTagFilter] = useState<string>("all");
  const [includeSemantic, setIncludeSemantic] = useState(true);
  const [includeIsolated, setIncludeIsolated] = useState(true);
  const [selectedNodeId, setSelectedNodeId] = useState<DocumentId | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<DocumentId | null>(null);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const [fitSignal, setFitSignal] = useState(0);

  const spacesQuery = useInkadeSpaces();
  const spaces = useMemo(() => spacesQuery.data ?? [], [spacesQuery.data]);
  const spaceNameMap = useMemo(() => new Map(spaces.map((s) => [s.id, s.name])), [spaces]);
  const spaceColorMap = useMemo(() => {
    const series = effectiveTheme === "dark" ? NODE_SERIES_DARK : NODE_SERIES_LIGHT;
    const map = new Map<SpaceId, string>();
    spaces.forEach((s, index) => {
      map.set(s.id, series[index % series.length]!);
    });
    return map;
  }, [effectiveTheme, spaces]);

  const graphQuery = useInkadeWorkspaceGraph({
    ...(spaceFilter !== "all" ? { spaceId: spaceFilter as SpaceId } : {}),
    ...(kindFilter !== "all" ? { kind: kindFilter as DocumentKind } : {}),
    ...(tagFilter !== "all" ? { tag: tagFilter } : {}),
    includeSemantic,
    includeIsolated,
  });

  const nodes = useMemo(() => graphQuery.data?.nodes ?? [], [graphQuery.data?.nodes]);
  const edges = useMemo(() => graphQuery.data?.edges ?? [], [graphQuery.data?.edges]);

  const availableTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const node of nodes) {
      for (const tag of node.tags) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 30)
      .map(([tag]) => tag);
  }, [nodes]);

  const searchMatchedIds = useMemo(() => {
    const needle = searchQuery.trim().toLowerCase();
    if (!needle) return null;
    const matched = new Set<DocumentId>();
    for (const node of nodes) {
      const hit =
        node.title.toLowerCase().includes(needle) ||
        node.tags.some((tag) => tag.toLowerCase().includes(needle));
      if (hit) matched.add(node.id);
    }
    return matched;
  }, [nodes, searchQuery]);

  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const selectedNode = selectedNodeId ? (nodeById.get(selectedNodeId) ?? null) : null;
  const selectedDocQuery = useInkadeDocument(selectedNode?.id);

  const linkTargetMutation = useLinkDocumentTargetMutation({
    onSuccess: (res, vars) => {
      const targetTitle = nodeById.get(vars.targetDocumentId)?.title ?? "";
      if (res.alreadyLinked) {
        showSuccessToast(t("graph.alreadyLinkedToast", { title: targetTitle }));
      } else {
        showSuccessToast(t("graph.linkedToast", { title: targetTitle }));
      }
    },
    onError: (err) => showErrorToast(t("graph.linkFailedToast"), err),
  });

  const palette = useMemo(
    () => resolveGraphThemePalette(surfaceTheme, paper, effectiveTheme),
    [effectiveTheme, paper, surfaceTheme],
  );
  const paletteRef = useRef(palette);
  paletteRef.current = palette;

  const sigmaOptions = useMemo(() => {
    const isNarrow = typeof window !== "undefined" && window.innerWidth < 640;
    return {
      primitives: {
        nodes: DEFAULT_NODE_PRIMITIVES,
        edges: {
          paths: [pathLine(), pathLoop()],
          extremities: [],
          variables: {
            plainColor: { type: "color" as const, default: "rgba(0,0,0,0)" },
            dashSize: { type: "number" as const, default: 7 },
            gapSize: { type: "number" as const, default: 0 },
          },
          layers: [
            layerPlain({ color: { attribute: "plainColor", default: "rgba(0,0,0,0)" } }),
            layerDashed({
              dashSize: { attribute: "dashSize", default: 7, mode: "pixels" },
              gapSize: { attribute: "gapSize", default: 0, mode: "pixels" },
              cap: "round",
            }),
          ],
          defaultHead: "none",
          defaultTail: "none",
          label: {},
        },
        depthLayers: DEFAULT_DEPTH_LAYERS,
      },
      styles: {
        nodes: {
          ...DEFAULT_STYLES.nodes,
          labelPosition: "below" as const,
          labelSize: isNarrow ? 11 : 12,
          labelColor: () => paletteRef.current.labelColor,
          backdropColor: () => paletteRef.current.backdropBg,
          backdropShadowColor: () => paletteRef.current.backdropShadow,
        },
        edges: {
          ...DEFAULT_STYLES.edges,
          plainColor: (attrs: Record<string, unknown>) =>
            attrs["edgeKind"] === "semantic"
              ? "rgba(0,0,0,0)"
              : typeof attrs["color"] === "string"
                ? attrs["color"]
                : paletteRef.current.explicitEdge,
          dashSize: (attrs: Record<string, unknown>) =>
            typeof attrs["dashSize"] === "number" ? attrs["dashSize"] : 7,
          gapSize: (attrs: Record<string, unknown>) =>
            typeof attrs["gapSize"] === "number" ? attrs["gapSize"] : 0,
        },
      },
      settings: {
        itemSizesReference: "screen" as const,
        autoRescaleContent: isNarrow ? ("nodes" as const) : ("labels" as const),
        renderLabels: true,
        labelDensity: isNarrow ? 0.6 : 4,
        labelGridCellSize: isNarrow ? 135 : 42,
        labelRenderedSizeThreshold: 0,
        enableEdgeEvents: false,
        stagePadding: isNarrow ? 54 : 56,
      },
    };
  }, []);

  const { directNeighbors, semanticNeighbors } = useMemo(() => {
    if (!selectedNode) {
      return {
        directNeighbors: [] as Array<{
          readonly node: WorkspaceGraphNode;
          readonly kind: WorkspaceGraphEdgeKind;
        }>,
        semanticNeighbors: [] as Array<{
          readonly node: WorkspaceGraphNode;
          readonly weight: number;
        }>,
      };
    }

    const directMap = new Map<
      DocumentId,
      { readonly node: WorkspaceGraphNode; readonly kind: WorkspaceGraphEdgeKind }
    >();
    const semanticMap = new Map<
      DocumentId,
      { readonly node: WorkspaceGraphNode; readonly weight: number }
    >();

    for (const edge of edges) {
      if (edge.source !== selectedNode.id && edge.target !== selectedNode.id) continue;
      const otherId = edge.source === selectedNode.id ? edge.target : edge.source;
      const other = nodeById.get(otherId);
      if (!other) continue;
      if (edge.kind === "semantic") {
        if (!directMap.has(otherId)) {
          semanticMap.set(otherId, { node: other, weight: edge.weight });
        }
      } else {
        directMap.set(otherId, { node: other, kind: edge.kind });
        semanticMap.delete(otherId);
      }
    }

    return {
      directNeighbors: [...directMap.values()],
      semanticNeighbors: [...semanticMap.values()].sort((a, b) => b.weight - a.weight),
    };
  }, [edges, nodeById, selectedNode]);

  const handleSelectNode = useCallback((nodeId: DocumentId | null) => {
    setSelectedNodeId(nodeId);
  }, []);

  const kindLabel = useCallback(
    (kind: DocumentKind) =>
      kind === "outline"
        ? t("common.kindOutline")
        : kind === "clip"
          ? t("common.kindClip")
          : t("common.kindArticle"),
    [t],
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {/* Top Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-background/95 px-3 py-2 sm:px-4">
        <div className="flex w-full min-w-0 flex-wrap items-center gap-1.5 sm:w-auto sm:flex-1">
          <div className="w-full sm:w-56 lg:w-64 sm:flex-none">
            <Input
              aria-label={t("graph.searchPlaceholder")}
              className="h-8 text-xs"
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("graph.searchPlaceholder")}
              startAddon={<SearchIcon className="size-3.5" />}
              value={searchQuery}
            />
          </div>

          <Select onValueChange={(v) => setSpaceFilter(v || "all")} value={spaceFilter}>
            <SelectTrigger className="h-8 w-24 text-xs" size="sm">
              <SelectValue>
                {spaceFilter === "all"
                  ? t("graph.filterSpaceAll")
                  : (spaceNameMap.get(spaceFilter as SpaceId) ?? t("graph.filterSpaceAll"))}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value="all">{t("graph.filterSpaceAll")}</SelectItem>
              {spaces
                .filter((s) => s.archivedAt === null)
                .map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
            </SelectPopup>
          </Select>

          <Select onValueChange={(v) => setKindFilter(v || "all")} value={kindFilter}>
            <SelectTrigger className="h-8 w-24 text-xs" size="sm">
              <SelectValue>
                {kindFilter === "all"
                  ? t("graph.filterKindAll")
                  : kindLabel(kindFilter as DocumentKind)}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value="all">{t("graph.filterKindAll")}</SelectItem>
              {DOCUMENT_KINDS.map((k) => (
                <SelectItem key={k} value={k}>
                  {kindLabel(k)}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>

          {availableTags.length > 0 ? (
            <Select onValueChange={(v) => setTagFilter(v || "all")} value={tagFilter}>
              <SelectTrigger className="hidden h-8 w-24 text-xs sm:inline-flex" size="sm">
                <SelectValue>
                  {tagFilter === "all" ? t("graph.filterTagAll") : `#${tagFilter}`}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value="all">{t("graph.filterTagAll")}</SelectItem>
                {availableTags.map((tag) => (
                  <SelectItem key={tag} value={tag}>
                    #{tag}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          ) : null}

          <label className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs text-foreground">
            <Switch
              aria-label={t("graph.toggleSemantic")}
              checked={includeSemantic}
              onCheckedChange={setIncludeSemantic}
            />
            <span className="whitespace-nowrap">{t("graph.toggleSemantic")}</span>
          </label>

          <label className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs text-foreground">
            <Switch
              aria-label={t("graph.toggleIsolated")}
              checked={includeIsolated}
              onCheckedChange={setIncludeIsolated}
            />
            <span className="whitespace-nowrap">{t("graph.toggleIsolated")}</span>
          </label>
        </div>

        <div className="flex w-full shrink-0 items-center justify-end gap-1.5 sm:w-auto sm:gap-2">
          <span className="hidden text-xs text-muted-foreground xl:inline">
            {t("graph.statsSummary", { nodes: nodes.length, edges: edges.length })}
          </span>
          <Button
            onClick={() => setLayoutVersion((v) => v + 1)}
            size="xs"
            variant="outline"
          >
            <RefreshCwIcon />
            <span>{t("graph.runLayout")}</span>
          </Button>
          <Button
            onClick={() => setFitSignal((v) => v + 1)}
            size="xs"
            variant="ghost"
          >
            <Maximize2Icon />
            <span>{t("graph.resetCamera")}</span>
          </Button>
        </div>
      </div>

      {/* Canvas & Slide-Over Preview */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {graphQuery.isPending ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6">
            <Skeleton className="h-64 w-full max-w-2xl rounded-xl" />
            <p className="text-xs text-muted-foreground">{t("graph.loading")}</p>
          </div>
        ) : graphQuery.isError ? (
          <div className="flex h-full items-center justify-center p-6">
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <NetworkIcon />
                </EmptyMedia>
                <EmptyTitle>{t("graph.errorLoad")}</EmptyTitle>
              </EmptyHeader>
            </Empty>
          </div>
        ) : nodes.length === 0 ? (
          <div className="flex h-full items-center justify-center p-6">
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <NetworkIcon />
                </EmptyMedia>
                <EmptyTitle>{t("graph.emptyTitle")}</EmptyTitle>
                <EmptyDescription>{t("graph.emptyDesc")}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          </div>
        ) : (
          <div
            className="h-full w-full"
            style={{ "--sigma-background-color": palette.canvasBg } as React.CSSProperties}
          >
            <SigmaContainer
              className="h-full w-full"
              graph={MultiUndirectedGraph}
              options={sigmaOptions}
              style={{ height: "100%", width: "100%", background: palette.canvasBg }}
            >
              <GraphCanvasController
                edges={edges}
                fitSignal={fitSignal}
                focusedNodeId={selectedNodeId}
                hoveredNodeId={hoveredNodeId}
                isDark={effectiveTheme === "dark"}
                layoutVersion={layoutVersion}
                nodes={nodes}
                onHoverNode={setHoveredNodeId}
                onSelectNode={handleSelectNode}
                palette={palette}
                searchMatchedIds={searchMatchedIds}
                spaceColorMap={spaceColorMap}
              />
            </SigmaContainer>
          </div>
        )}

        {/* Bottom-Left Edge Legend */}
        {nodes.length > 0 ? (
          <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-border/85 bg-background/95 px-3 py-1.5 text-[11px] font-medium text-foreground/85 shadow-sm backdrop-blur-sm">
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="inline-flex items-center -space-x-1">
                <span className="inline-block size-2 rounded-full bg-sky-500 ring-1 ring-background" />
                <span className="inline-block size-2 rounded-full bg-emerald-500 ring-1 ring-background" />
              </span>
              <span>{t("graph.legendNodeSpace")}</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-0.5 w-4 rounded-full"
                style={{ backgroundColor: palette.explicitEdge }}
              />
              <span>{t("graph.legendExplicit")}</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-0.5 w-4 rounded-full"
                style={{ backgroundColor: palette.mirrorEdge }}
              />
              <span>{t("graph.legendMirror")}</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span
                className="inline-block w-4 border-t-2 border-dashed"
                style={{ borderColor: palette.semanticEdge }}
              />
              <span>{t("graph.legendSemantic")}</span>
            </span>
          </div>
        ) : null}

        {/* Right Node Preview Drawer */}
        {selectedNode ? (
          <aside
            aria-label={selectedNode.title}
            className="absolute top-3 right-3 bottom-3 z-20 flex w-80 max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-xl border bg-background/95 shadow-lg backdrop-blur-sm"
          >
            <div className="flex items-start justify-between gap-2 border-b px-4 py-3">
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-sm font-semibold text-foreground">
                  {selectedNode.title}
                </h2>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <Badge size="sm" variant="outline">
                    {spaceNameMap.get(selectedNode.spaceId) ?? selectedNode.spaceId}
                  </Badge>
                  <Badge size="sm" variant="secondary">
                    {kindLabel(selectedNode.kind)}
                  </Badge>
                  <span className="text-[11px] text-muted-foreground">
                    {t("graph.previewDegree", { count: selectedNode.degree })}
                  </span>
                </div>
              </div>
              <Button
                aria-label={t("graph.previewClose")}
                onClick={() => setSelectedNodeId(null)}
                size="icon-xs"
                variant="ghost"
              >
                <XIcon />
              </Button>
            </div>

            <div className="flex items-center gap-2 border-b px-4 py-2">
              <Button
                className="flex-1"
                onClick={() =>
                  void navigate({ to: "/docs/$docId", params: { docId: selectedNode.id } })
                }
                size="xs"
                variant="default"
              >
                <ExternalLinkIcon />
                <span>{t("graph.previewOpenPrimary")}</span>
              </Button>
              <Button
                className="hidden flex-1 lg:inline-flex"
                onClick={() => requestOpenSplitDoc(selectedNode.id)}
                size="xs"
                variant="outline"
              >
                <Columns2Icon />
                <span>{t("graph.previewOpenSplit")}</span>
              </Button>
            </div>

            <ScrollArea className="min-h-0 flex-1" overscrollContain>
              <div className="flex flex-col gap-4 p-4">
                {selectedDocQuery.isPending ? (
                  <Skeleton className="h-16 w-full" />
                ) : selectedDocQuery.data?.excerpt ? (
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {selectedDocQuery.data.excerpt}
                  </p>
                ) : null}

                {selectedNode.tags.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {selectedNode.tags.map((tag) => (
                      <Badge key={tag} size="sm" variant="outline">
                        #{tag}
                      </Badge>
                    ))}
                  </div>
                ) : null}

                {directNeighbors.length > 0 ? (
                  <div className="flex flex-col gap-1.5">
                    <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                      {t("graph.previewNeighbors")}
                    </div>
                    <div className="flex flex-col gap-1">
                      {directNeighbors.map(({ node, kind }) => (
                        <button
                          className="flex cursor-pointer items-center justify-between gap-2 rounded-md border border-transparent px-2 py-1 text-left text-xs transition-colors hover:border-border hover:bg-muted/50"
                          key={`${kind}:${node.id}`}
                          onClick={() => setSelectedNodeId(node.id)}
                          type="button"
                        >
                          <span className="truncate font-medium text-foreground">
                            {node.title}
                          </span>
                          <Badge size="sm" variant={kind === "mirror" ? "default" : "outline"}>
                            {kind === "mirror" ? t("graph.legendMirror") : t("graph.legendExplicit")}
                          </Badge>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {semanticNeighbors.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                      <SparklesIcon className="size-3" />
                      <span>{t("graph.previewSuggestions")}</span>
                    </div>
                    <div className="flex flex-col gap-2">
                      {semanticNeighbors.map(({ node, weight }) => (
                        <div
                          className="flex flex-col gap-1.5 rounded-lg border bg-muted/25 p-2"
                          key={node.id}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <button
                              className={cn(
                                "min-w-0 flex-1 cursor-pointer truncate text-left text-xs font-medium text-foreground hover:underline",
                              )}
                              onClick={() => setSelectedNodeId(node.id)}
                              type="button"
                            >
                              {node.title}
                            </button>
                            <span className="shrink-0 text-[11px] text-muted-foreground">
                              {t("graph.similarityScore", { percent: Math.round(weight * 100) })}
                            </span>
                          </div>
                          <Button
                            loading={linkTargetMutation.isPending}
                            onClick={() =>
                              linkTargetMutation.mutate({
                                documentId: selectedNode.id,
                                targetDocumentId: node.id,
                              })
                            }
                            size="xs"
                            variant="secondary"
                          >
                            <Link2Icon />
                            <span>{t("graph.linkAction")}</span>
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </ScrollArea>
          </aside>
        ) : null}
      </div>
    </div>
  );
}
