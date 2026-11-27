"use client";

import type { DocumentGraph, DocumentGraphNode, Space } from "@inkade/core";
import { useInkadeTranslation } from "@inkade/i18n";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { NetworkIcon, RotateCcwIcon, ZoomInIcon, ZoomOutIcon } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../lib/utils.ts";
import { Badge } from "../primitives/badge.tsx";
import { Button } from "../primitives/button.tsx";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../primitives/empty.tsx";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "../primitives/segmented-control.tsx";
import type { SpaceColorName } from "../primitives/space-icon.tsx";

const GRAPH_NODE_FILL: Readonly<Record<SpaceColorName, string>> = {
  indigo: "#6366f1",
  blue: "#3b82f6",
  teal: "#14b8a6",
  emerald: "#10b981",
  amber: "#f59e0b",
  orange: "#f97316",
  rose: "#f43f5e",
  pink: "#ec4899",
  violet: "#8b5cf6",
  slate: "#64748b",
};

export interface GraphSimNode extends SimulationNodeDatum {
  readonly id: string;
  readonly title: string;
  readonly kind: DocumentGraphNode["kind"];
  readonly depth: number;
  readonly spaceId: string;
  readonly colorHex: string;
  readonly isCenter: boolean;
  readonly degree: number;
}

export interface GraphSimLink extends SimulationLinkDatum<GraphSimNode> {
  readonly id: string;
  readonly sourceId: string;
  readonly targetId: string;
  readonly anchorText: string | null;
}

/**
 * Projects a `DocumentGraph` and Space metadata into deterministic `d3-force` node & link data.
 */
export function buildLocalGraphSimulationData(
  graph: DocumentGraph,
  spaces: readonly Pick<Space, "id" | "color">[] = [],
  width = 320,
  height = 260,
): {
  readonly nodes: GraphSimNode[];
  readonly links: GraphSimLink[];
} {
  const spaceColorMap = new Map(spaces.map((s) => [s.id, s.color]));
  const degreeMap = new Map<string, number>();

  for (const edge of graph.edges) {
    degreeMap.set(edge.sourceDocumentId, (degreeMap.get(edge.sourceDocumentId) ?? 0) + 1);
    degreeMap.set(edge.targetDocumentId, (degreeMap.get(edge.targetDocumentId) ?? 0) + 1);
  }

  const total = Math.max(1, graph.nodes.length);
  const cx = width / 2;
  const cy = height / 2;

  const nodes: GraphSimNode[] = graph.nodes.map((n, index) => {
    const spaceColor = spaceColorMap.get(n.spaceId) as SpaceColorName | undefined;
    const colorHex =
      (spaceColor && GRAPH_NODE_FILL[spaceColor]) ??
      (n.kind === "outline" ? "#6366f1" : n.kind === "clip" ? "#14b8a6" : "#f59e0b");
    const isCenter = n.id === graph.centerDocumentId;
    const angle = (index / total) * Math.PI * 2;
    const radius = isCenter ? 0 : 48 + n.depth * 32;

    return {
      id: n.id,
      title: n.title,
      kind: n.kind,
      depth: n.depth,
      spaceId: n.spaceId,
      colorHex,
      isCenter,
      degree: degreeMap.get(n.id) ?? 0,
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
    };
  });

  const nodeIds = new Set(nodes.map((n) => n.id));
  const links: GraphSimLink[] = graph.edges
    .filter((e) => nodeIds.has(e.sourceDocumentId) && nodeIds.has(e.targetDocumentId))
    .map((e) => ({
      id: e.id,
      source: e.sourceDocumentId,
      target: e.targetDocumentId,
      sourceId: e.sourceDocumentId,
      targetId: e.targetDocumentId,
      anchorText: e.anchorText,
    }));

  return { nodes, links };
}

export interface LocalGraphPanelProps {
  readonly graph: DocumentGraph;
  readonly spaces?: readonly Pick<Space, "id" | "name" | "color">[] | undefined;
  readonly depth?: 1 | 2 | undefined;
  readonly onDepthChange?: ((depth: 1 | 2) => void) | undefined;
  readonly onSelectDocument?: ((documentId: string) => void) | undefined;
  readonly className?: string | undefined;
}

const SVG_WIDTH = 340;
const SVG_HEIGHT = 270;

export function LocalGraphPanel({
  graph,
  spaces = [],
  depth = 2,
  onDepthChange,
  onSelectDocument,
  className,
}: LocalGraphPanelProps): React.ReactElement {
  const { t } = useInkadeTranslation();
  const [zoom, setZoom] = useState(1);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [tickCount, setTickCount] = useState(0);
  const draggingNodeRef = useRef<GraphSimNode | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const simData = useMemo(() => {
    const data = buildLocalGraphSimulationData(graph, spaces, SVG_WIDTH, SVG_HEIGHT);
    const sim = forceSimulation<GraphSimNode>(data.nodes)
      .force(
        "link",
        forceLink<GraphSimNode, GraphSimLink>(data.links)
          .id((d) => d.id)
          .distance((d) => ((d.source as GraphSimNode).isCenter ? 68 : 88)),
      )
      .force("charge", forceManyBody().strength(-160))
      .force("center", forceCenter(SVG_WIDTH / 2, SVG_HEIGHT / 2))
      .force("collide", forceCollide<GraphSimNode>(22))
      .stop();

    for (let i = 0; i < 90; i++) {
      sim.tick();
    }

    return { ...data, sim };
  }, [graph, spaces]);

  useEffect(() => {
    setTickCount((c) => c + 1);
    return () => {
      simData.sim.stop();
    };
  }, [simData]);

  const toSvgCoords = (clientX: number, clientY: number): { x: number; y: number } => {
    const svg = svgRef.current;
    if (!svg) return { x: SVG_WIDTH / 2, y: SVG_HEIGHT / 2 };
    const rect = svg.getBoundingClientRect();
    const scaleX = SVG_WIDTH / Math.max(1, rect.width);
    const scaleY = SVG_HEIGHT / Math.max(1, rect.height);
    const rawX = (clientX - rect.left) * scaleX;
    const rawY = (clientY - rect.top) * scaleY;
    // Account for centered zoom transform
    return {
      x: SVG_WIDTH / 2 + (rawX - SVG_WIDTH / 2) / zoom,
      y: SVG_HEIGHT / 2 + (rawY - SVG_HEIGHT / 2) / zoom,
    };
  };

  if (graph.nodes.length <= 1 && graph.edges.length === 0) {
    return (
      <div className={cn("rounded-lg border border-border bg-card p-3", className)}>
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-foreground">{t("reader.graphTitle")}</span>
          {onDepthChange && (
            <SegmentedControl size="sm">
              <SegmentedControlItem
                data-pressed={depth === 1 ? "" : undefined}
                onClick={() => onDepthChange(1)}
              >
                {t("reader.graphDepth1")}
              </SegmentedControlItem>
              <SegmentedControlItem
                data-pressed={depth === 2 ? "" : undefined}
                onClick={() => onDepthChange(2)}
              >
                {t("reader.graphDepth2")}
              </SegmentedControlItem>
            </SegmentedControl>
          )}
        </div>
        <Empty className="py-6">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <NetworkIcon />
            </EmptyMedia>
            <EmptyTitle>{t("reader.graphEmpty")}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  const connectedToHovered = new Set<string>();
  if (hoveredId) {
    connectedToHovered.add(hoveredId);
    for (const link of simData.links) {
      const s = typeof link.source === "object" ? link.source.id : String(link.source);
      const tgt = typeof link.target === "object" ? link.target.id : String(link.target);
      if (s === hoveredId) connectedToHovered.add(tgt);
      if (tgt === hoveredId) connectedToHovered.add(s);
    }
  }

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-lg border border-border bg-card text-card-foreground",
        className,
      )}
      data-tick={tickCount}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-3 py-2">
        <div className="flex items-center gap-1.5">
          <NetworkIcon className="size-3.5 text-primary" />
          <span className="text-xs font-semibold">{t("reader.graphTitle")}</span>
          <Badge size="sm" variant="outline">
            {simData.nodes.length}
          </Badge>
        </div>

        <div className="flex items-center gap-1">
          {onDepthChange && (
            <SegmentedControl size="sm">
              <SegmentedControlItem
                data-pressed={depth === 1 ? "" : undefined}
                onClick={() => onDepthChange(1)}
              >
                {t("reader.graphDepth1")}
              </SegmentedControlItem>
              <SegmentedControlItem
                data-pressed={depth === 2 ? "" : undefined}
                onClick={() => onDepthChange(2)}
              >
                {t("reader.graphDepth2")}
              </SegmentedControlItem>
            </SegmentedControl>
          )}
          <Button
            aria-label={t("reader.graphZoomOut")}
            onClick={() => setZoom((z) => Math.max(0.6, Number((z - 0.2).toFixed(2))))}
            size="icon-xs"
            variant="ghost"
          >
            <ZoomOutIcon />
          </Button>
          <Button
            aria-label={t("reader.graphZoomIn")}
            onClick={() => setZoom((z) => Math.min(2.2, Number((z + 0.2).toFixed(2))))}
            size="icon-xs"
            variant="ghost"
          >
            <ZoomInIcon />
          </Button>
          <Button
            aria-label={t("reader.graphReset")}
            onClick={() => setZoom(1)}
            size="icon-xs"
            variant="ghost"
          >
            <RotateCcwIcon />
          </Button>
        </div>
      </div>

      <div className="overflow-hidden bg-background/50">
        <svg
          className="block h-[270px] w-full select-none touch-none"
          onPointerMove={(e) => {
            const node = draggingNodeRef.current;
            if (!node) return;
            const pt = toSvgCoords(e.clientX, e.clientY);
            node.fx = pt.x;
            node.fy = pt.y;
            node.x = pt.x;
            node.y = pt.y;
            simData.sim.tick();
            setTickCount((c) => c + 1);
          }}
          onPointerUp={() => {
            const node = draggingNodeRef.current;
            if (node) {
              node.fx = null;
              node.fy = null;
              draggingNodeRef.current = null;
            }
          }}
          onWheel={(e) => {
            e.preventDefault();
            const delta = e.deltaY < 0 ? 0.1 : -0.1;
            setZoom((z) => Math.min(2.2, Math.max(0.6, Number((z + delta).toFixed(2)))));
          }}
          ref={svgRef}
          viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
        >
          <g
            transform={`translate(${SVG_WIDTH / 2}, ${SVG_HEIGHT / 2}) scale(${zoom}) translate(${-SVG_WIDTH / 2}, ${-SVG_HEIGHT / 2})`}
          >
            {/* Edges */}
            {simData.links.map((link) => {
              const s = link.source as GraphSimNode;
              const tgt = link.target as GraphSimNode;
              const isHighlighted =
                !hoveredId ||
                (s.id === hoveredId || tgt.id === hoveredId);
              return (
                <line
                  key={link.id}
                  stroke="currentColor"
                  strokeOpacity={isHighlighted ? 0.35 : 0.1}
                  strokeWidth={isHighlighted ? 1.5 : 1}
                  x1={s.x ?? SVG_WIDTH / 2}
                  x2={tgt.x ?? SVG_WIDTH / 2}
                  y1={s.y ?? SVG_HEIGHT / 2}
                  y2={tgt.y ?? SVG_HEIGHT / 2}
                />
              );
            })}

            {/* Nodes */}
            {simData.nodes.map((node) => {
              const x = node.x ?? SVG_WIDTH / 2;
              const y = node.y ?? SVG_HEIGHT / 2;
              const radius = node.isCenter ? 9 : Math.min(8, 5 + node.degree * 0.6);
              const dimmed = Boolean(hoveredId && !connectedToHovered.has(node.id));
              return (
                <g
                  className="cursor-pointer"
                  key={node.id}
                  onClick={() => {
                    if (!node.isCenter) {
                      onSelectDocument?.(node.id);
                    }
                  }}
                  onMouseEnter={() => setHoveredId(node.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    draggingNodeRef.current = node;
                    node.fx = x;
                    node.fy = y;
                  }}
                  opacity={dimmed ? 0.3 : 1}
                  transform={`translate(${x}, ${y})`}
                >
                  {node.isCenter && (
                    <circle
                      fill="none"
                      r={radius + 4}
                      stroke="var(--primary)"
                      strokeOpacity={0.65}
                      strokeWidth={1.75}
                    />
                  )}
                  <circle
                    fill={node.colorHex}
                    r={radius}
                    stroke="var(--background)"
                    strokeWidth={1.5}
                  />
                  <text
                    className="fill-foreground text-[9px] font-medium pointer-events-none"
                    dx={radius + 4}
                    dy={3}
                    paintOrder="stroke"
                    stroke="var(--background)"
                    strokeLinejoin="round"
                    strokeWidth={3.5}
                  >
                    {node.title.length > 18 ? `${node.title.slice(0, 17)}…` : node.title}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>
    </div>
  );
}
