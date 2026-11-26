import type {
  DiagramType,
  DesignNode,
  DesignView,
  NodeShape,
  ViewLayout,
} from "@redlinify/shared/browser";

type ElkInstance = InstanceType<
  typeof import("elkjs/lib/elk.bundled.js").default
>;
let elkPromise: Promise<ElkInstance> | null = null;

function getElk(): Promise<ElkInstance> {
  if (!elkPromise) {
    elkPromise = import("elkjs/lib/elk.bundled.js").then(
      ({ default: ELK }) => new ELK(),
    );
  }
  return elkPromise;
}

export const MAX_VISIBLE_SECTION_ITEMS = 5;
export const MAX_VISIBLE_ER_FIELDS = 8;

export function getCollapsedVisibleCount(
  totalCount: number,
  maxVisible: number,
): { visibleCount: number; hiddenCount: number } {
  if (totalCount <= maxVisible + 1) {
    return { visibleCount: totalCount, hiddenCount: 0 };
  }
  return { visibleCount: maxVisible, hiddenCount: totalCount - maxVisible };
}

export function getEffectiveNodeShape(
  node: DesignNode,
  diagramType: DiagramType = "general",
): NodeShape {
  if (diagramType === "er" || (node.fields && node.fields.length > 0)) {
    return "card";
  }
  return node.shape ?? "card";
}

export const NODE_SHAPE_OPTIONS: ReadonlyArray<{
  shape: NodeShape;
  label: string;
  shortLabel: string;
  hint: string;
}> = [
  {
    shape: "card",
    label: "Card (Box)",
    shortLabel: "Card",
    hint: "Structured component / service card",
  },
  {
    shape: "decision",
    label: "Decision (Rhombus)",
    shortLabel: "Decision",
    hint: "Conditional branch or gate diamond",
  },
  {
    shape: "terminal",
    label: "Terminal (Pill)",
    shortLabel: "Terminal",
    hint: "Start, end, actor, or trigger pill",
  },
  {
    shape: "store",
    label: "Store (Database)",
    shortLabel: "Store",
    hint: "Database, cache, or queue cylinder",
  },
];

export function estimateNodeSize(
  node: DesignNode,
  diagramType: DiagramType = "general",
): {
  width: number;
  height: number;
} {
  const shape = getEffectiveNodeShape(node, diagramType);

  if (shape === "decision") {
    const titleChars = Math.max(node.title.length, 10);
    const width = Math.min(288, Math.max(224, Math.round(titleChars * 7 + 124)));
    const summaryExtra = node.summary?.trim() ? 22 : 0;
    const height = Math.max(138, Math.round(width * 0.56) + summaryExtra);
    return { width, height };
  }

  if (shape === "terminal") {
    const lineChars = Math.max(
      node.title.length + 4,
      node.kind.length + 8,
      node.summary?.trim() ? Math.min(node.summary.trim().length, 32) : 0,
    );
    const width = Math.min(290, Math.max(200, Math.round(lineChars * 6.8 + 72)));
    let height = 74;
    if (node.summary?.trim()) height += 22;
    if (node.entity_ref || (node.code_refs && node.code_refs.length > 0)) height += 16;
    return { width, height: Math.max(74, height) };
  }

  let longestLine = node.title.length + node.kind.length + 6;
  for (const section of node.sections) {
    longestLine = Math.max(longestLine, section.heading.length + 4);
    const { visibleCount } = getCollapsedVisibleCount(
      section.items.length,
      MAX_VISIBLE_SECTION_ITEMS,
    );
    for (const item of section.items.slice(0, visibleCount)) {
      longestLine = Math.max(longestLine, item.length);
    }
  }
  const { visibleCount: widthFieldCount } = getCollapsedVisibleCount(
    (node.fields ?? []).length,
    MAX_VISIBLE_ER_FIELDS,
  );
  for (const field of (node.fields ?? []).slice(0, widthFieldCount)) {
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
    const { visibleCount: visibleFields, hiddenCount: hiddenFields } =
      getCollapsedVisibleCount(fields.length, MAX_VISIBLE_ER_FIELDS);
    const hasMoreFields = hiddenFields > 0 ? 22 : 0;
    const emptyHint = fields.length === 0 ? 22 : 0;
    height += 26 + visibleFields * 24 + hasMoreFields + emptyHint + 16;
  }

  for (const section of node.sections) {
    const { visibleCount, hiddenCount } = getCollapsedVisibleCount(
      section.items.length,
      MAX_VISIBLE_SECTION_ITEMS,
    );
    const hasMore = hiddenCount > 0 ? 22 : 0;
    const emptyHint = section.items.length === 0 ? 18 : 0;
    height += 26 + visibleCount * 20 + hasMore + emptyHint + 10;
  }
  if (node.sections.length === 0 && fields.length === 0 && diagramType !== "er") {
    height += 28;
  }
  if (node.code_refs && node.code_refs.length > 0) {
    height += 26;
  }
  if (shape === "store") {
    height += 28;
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

  if (
    !options?.forceReset &&
    view.nodes.every((node) => Boolean(savedLayout.positions[node.id]))
  ) {
    const preserved: Record<string, { x: number; y: number }> = {};
    for (const node of view.nodes) {
      const saved = savedLayout.positions[node.id]!;
      preserved[node.id] = { x: saved.x, y: saved.y };
    }
    return preserved;
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
  const elk = await getElk();
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
