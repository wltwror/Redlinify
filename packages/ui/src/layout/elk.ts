import ELK from "elkjs/lib/elk.bundled.js";
import type {
  DiagramType,
  DesignNode,
  DesignView,
  ViewLayout,
} from "@redlinify/shared/browser";

const elk = new ELK();

export const MAX_VISIBLE_SECTION_ITEMS = 5;
export const MAX_VISIBLE_ER_FIELDS = 8;

export function estimateNodeSize(
  node: DesignNode,
  diagramType: DiagramType = "general",
): {
  width: number;
  height: number;
} {
  let longestLine = node.title.length + node.kind.length + 6;
  for (const section of node.sections) {
    longestLine = Math.max(longestLine, section.heading.length + 4);
    for (const item of section.items.slice(0, MAX_VISIBLE_SECTION_ITEMS)) {
      longestLine = Math.max(longestLine, item.length);
    }
  }
  for (const field of (node.fields ?? []).slice(0, MAX_VISIBLE_ER_FIELDS)) {
    const lineLen =
      field.name.length + (field.type ? field.type.length + 2 : 0) + 10;
    longestLine = Math.max(longestLine, lineLen);
  }

  const width = Math.min(350, Math.max(280, Math.round(longestLine * 6.6 + 52)));

  let height = 52; // top header bar
  if (node.summary?.trim()) {
    height += 34;
  }

  const fields = node.fields ?? [];
  if (diagramType === "er" || fields.length > 0) {
    const visibleFields = Math.min(fields.length, MAX_VISIBLE_ER_FIELDS);
    const hasMoreFields = fields.length > MAX_VISIBLE_ER_FIELDS ? 22 : 0;
    const emptyHint = fields.length === 0 ? 22 : 0;
    height += 26 + visibleFields * 24 + hasMoreFields + emptyHint + 16;
  }

  for (const section of node.sections) {
    const visibleCount = Math.min(section.items.length, MAX_VISIBLE_SECTION_ITEMS);
    const hasMore = section.items.length > MAX_VISIBLE_SECTION_ITEMS ? 22 : 0;
    const emptyHint = section.items.length === 0 ? 18 : 0;
    height += 26 + visibleCount * 20 + hasMore + emptyHint + 10;
  }
  if (node.sections.length === 0 && fields.length === 0 && diagramType !== "er") {
    height += 28;
  }
  if (node.code_refs && node.code_refs.length > 0) {
    height += 26;
  }

  return { width, height: Math.max(104, height + 12) };
}

export async function computeAutoLayout(
  view: DesignView,
  savedLayout: ViewLayout,
  options?: {
    forceReset?: boolean;
    measured?: Record<string, { width?: number; height?: number }>;
  },
): Promise<Record<string, { x: number; y: number }>> {
  if (view.nodes.length === 0) {
    return {};
  }

  const elkNodes = view.nodes.map((node) => {
    const est = estimateNodeSize(node, view.diagram_type);
    const measured = options?.measured?.[node.id];
    return {
      id: node.id,
      width: Math.round(measured?.width ?? est.width),
      height: Math.round(measured?.height ?? est.height),
    };
  });

  const elkEdges = view.edges.map((edge) => ({
    id: edge.id,
    sources: [edge.source],
    targets: [edge.target],
  }));

  const isEr = view.diagram_type === "er";
  const laidOut = await elk.layout({
    id: view.id,
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": view.direction === "LR" ? "RIGHT" : "DOWN",
      "elk.spacing.nodeNode": isEr ? "90" : "72",
      "elk.layered.spacing.nodeNodeBetweenLayers": isEr ? "195" : "156",
      "elk.spacing.edgeNode": isEr ? "56" : "48",
      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
      "elk.layered.nodePlacement.strategy": "SIMPLE",
      "elk.padding": "[top=24,left=24,bottom=24,right=24]",
    },
    children: elkNodes,
    edges: elkEdges,
  });

  const autoPositions: Record<string, { x: number; y: number }> = {};
  for (const child of laidOut.children ?? []) {
    autoPositions[child.id] = {
      x: Math.round(child.x ?? 0),
      y: Math.round(child.y ?? 0),
    };
  }

  if (options?.forceReset) {
    return autoPositions;
  }

  const merged: Record<string, { x: number; y: number }> = {};
  for (const node of view.nodes) {
    const saved = savedLayout.positions[node.id];
    if (saved) {
      merged[node.id] = { x: saved.x, y: saved.y };
    } else {
      merged[node.id] = autoPositions[node.id] ?? { x: 40, y: 40 };
    }
  }
  return merged;
}
