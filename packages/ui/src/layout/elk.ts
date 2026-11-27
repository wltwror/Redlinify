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

export type LayoutSide = "left" | "right" | "top" | "bottom";

export interface ElkPoint {
  x: number;
  y: number;
}

export interface ElkAutoEdgeRoute {
  sourceSide?: LayoutSide;
  targetSide?: LayoutSide;
  startPoint: ElkPoint;
  endPoint: ElkPoint;
  waypoints: ElkPoint[];
  sourcePos: ElkPoint;
  targetPos: ElkPoint;
}

export interface AutoLayoutResult {
  positions: Record<string, ElkPoint>;
  autoRoutes: Record<string, ElkAutoEdgeRoute>;
}

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
    const width = Math.min(290, Math.max(244, Math.round(titleChars * 7 + 124)));
    const titleLines = Math.max(1, Math.min(3, Math.ceil(node.title.length / 20)));
    const summaryExtra = node.summary?.trim()
      ? node.summary.trim().length > 26
        ? 30
        : 18
      : 0;
    const height = Math.max(
      148,
      Math.round(width * 0.56) + (titleLines - 1) * 16 + summaryExtra,
    );
    return { width, height };
  }

  if (shape === "terminal") {
    const lineChars = Math.max(
      node.title.length + 4,
      node.kind.length + 8,
      node.summary?.trim() ? Math.min(node.summary.trim().length, 32) : 0,
    );
    const width = Math.min(290, Math.max(200, Math.round(lineChars * 6.8 + 72)));
    const titleLines = Math.max(1, Math.min(3, Math.ceil(node.title.length / 26)));
    let height = 76 + (titleLines - 1) * 18;
    if (node.summary?.trim()) {
      height += node.summary.trim().length > 32 ? 32 : 18;
    }
    if (node.entity_ref || (node.code_refs && node.code_refs.length > 0)) {
      height += 18;
    }
    return { width, height: Math.max(76, height) };
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
  const charsPerTitleLine = Math.max(18, Math.floor((width - 104) / 7.2));
  const titleLines = Math.max(
    1,
    Math.min(4, Math.ceil(node.title.length / charsPerTitleLine)),
  );

  let height = 42 + titleLines * 19; // kind badge + wrapped title header
  if (node.summary?.trim()) {
    height += node.summary.trim().length > 42 ? 44 : 28;
  }

  const fields = node.fields ?? [];
  if (diagramType === "er" || fields.length > 0) {
    const { visibleCount: visibleFields, hiddenCount: hiddenFields } =
      getCollapsedVisibleCount(fields.length, MAX_VISIBLE_ER_FIELDS);
    const hasMoreFields = hiddenFields > 0 ? 26 : 0;
    const emptyHint = fields.length === 0 ? 24 : 0;
    height += 28 + visibleFields * 25 + hasMoreFields + emptyHint + 14;
  }

  for (const section of node.sections) {
    const { visibleCount, hiddenCount } = getCollapsedVisibleCount(
      section.items.length,
      MAX_VISIBLE_SECTION_ITEMS,
    );
    const hasMore = hiddenCount > 0 ? 24 : 0;
    const emptyHint = section.items.length === 0 ? 20 : 0;
    height += 26 + visibleCount * 22 + hasMore + emptyHint + 12;
  }
  if (node.sections.length === 0 && fields.length === 0 && diagramType !== "er") {
    height += 28;
  }
  if (node.entity_ref || (node.code_refs && node.code_refs.length > 0)) {
    height += 28;
  }
  if (shape === "store") {
    height += 32;
  }

  return { width, height: Math.max(112, height + 14) };
}

export function resolveNodeOverlaps(
  positions: Record<string, ElkPoint>,
  sizes: Record<string, { width: number; height: number }>,
  options?: {
    gap?: number;
    pinnedIds?: ReadonlySet<string>;
    preferredAxis?: "x" | "y";
  },
): Record<string, ElkPoint> {
  const gap = options?.gap ?? 40;
  const pinnedIds = options?.pinnedIds;
  const preferredAxis = options?.preferredAxis ?? "y";
  const next: Record<string, ElkPoint> = {};
  for (const [id, pos] of Object.entries(positions)) {
    next[id] = { x: pos.x, y: pos.y };
  }

  const ids = Object.keys(next).sort((a, b) => {
    const pa = next[a]!;
    const pb = next[b]!;
    return pa.y - pb.y || pa.x - pb.x || a.localeCompare(b);
  });

  if (ids.length < 2) {
    return next;
  }

  for (let pass = 0; pass < 40; pass++) {
    let movedAny = false;
    for (let i = 0; i < ids.length; i++) {
      const idA = ids[i]!;
      const posA = next[idA]!;
      const sizeA = sizes[idA] ?? { width: 290, height: 180 };
      const pinnedA = pinnedIds?.has(idA) ?? false;

      for (let j = i + 1; j < ids.length; j++) {
        const idB = ids[j]!;
        const pinnedB = pinnedIds?.has(idB) ?? false;
        if (pinnedA && pinnedB) continue;

        const posB = next[idB]!;
        const sizeB = sizes[idB] ?? { width: 290, height: 180 };

        const centerAx = posA.x + sizeA.width / 2;
        const centerAy = posA.y + sizeA.height / 2;
        const centerBx = posB.x + sizeB.width / 2;
        const centerBy = posB.y + sizeB.height / 2;

        const dx = centerBx - centerAx;
        const dy = centerBy - centerAy;
        const reqX = (sizeA.width + sizeB.width) / 2 + gap;
        const reqY = (sizeA.height + sizeB.height) / 2 + gap;
        const overlapX = reqX - Math.abs(dx);
        const overlapY = reqY - Math.abs(dy);

        if (overlapX <= 0.5 || overlapY <= 0.5) continue;

        movedAny = true;
        const pushAlongX =
          preferredAxis === "x"
            ? overlapX <= overlapY * 1.15
            : overlapX * 1.15 < overlapY;

        if (pushAlongX) {
          const sign = dx === 0 ? (idA < idB ? 1 : -1) : Math.sign(dx);
          const shift = Math.ceil(overlapX);
          if (pinnedA) {
            posB.x = Math.round(posB.x + sign * shift);
          } else if (pinnedB) {
            posA.x = Math.round(posA.x - sign * shift);
          } else {
            const half = Math.ceil(shift / 2);
            posA.x = Math.round(posA.x - sign * half);
            posB.x = Math.round(posB.x + sign * (shift - half));
          }
        } else {
          const sign = dy === 0 ? (idA < idB ? 1 : -1) : Math.sign(dy);
          const shift = Math.ceil(overlapY);
          if (pinnedA) {
            posB.y = Math.round(posB.y + sign * shift);
          } else if (pinnedB) {
            posA.y = Math.round(posA.y - sign * shift);
          } else {
            const half = Math.ceil(shift / 2);
            posA.y = Math.round(posA.y - sign * half);
            posB.y = Math.round(posB.y + sign * (shift - half));
          }
        }
      }
    }
    if (!movedAny) break;
  }

  return next;
}

function simplifyOrthogonalWaypoints(
  start: ElkPoint,
  bends: ElkPoint[],
  end: ElkPoint,
): ElkPoint[] {
  const full: ElkPoint[] = [start, ...bends, end].map((p) => ({
    x: Math.round(p.x),
    y: Math.round(p.y),
  }));
  const deduped: ElkPoint[] = [];
  for (const pt of full) {
    const last = deduped[deduped.length - 1];
    if (!last || Math.abs(last.x - pt.x) > 0.5 || Math.abs(last.y - pt.y) > 0.5) {
      deduped.push(pt);
    }
  }
  if (deduped.length <= 2) return [];

  const simplified: ElkPoint[] = [deduped[0]!];
  for (let i = 1; i < deduped.length - 1; i++) {
    const prev = simplified[simplified.length - 1]!;
    const curr = deduped[i]!;
    const next = deduped[i + 1]!;
    const sameX = Math.abs(prev.x - curr.x) <= 0.5 && Math.abs(curr.x - next.x) <= 0.5;
    const sameY = Math.abs(prev.y - curr.y) <= 0.5 && Math.abs(curr.y - next.y) <= 0.5;
    if (!sameX && !sameY) {
      simplified.push(curr);
    }
  }
  return simplified.slice(1);
}

function inferHandleSide(
  pt: ElkPoint,
  pos: ElkPoint,
  size: { width: number; height: number },
): LayoutSide {
  const distLeft = Math.abs(pt.x - pos.x);
  const distRight = Math.abs(pt.x - (pos.x + size.width));
  const distTop = Math.abs(pt.y - pos.y);
  const distBottom = Math.abs(pt.y - (pos.y + size.height));
  const min = Math.min(distLeft, distRight, distTop, distBottom);
  if (min === distLeft) return "left";
  if (min === distRight) return "right";
  if (min === distTop) return "top";
  return "bottom";
}

export async function computeAutoLayout(
  view: DesignView,
  savedLayout: ViewLayout,
  options?: {
    forceReset?: boolean;
    measured?: Record<string, { width?: number; height?: number }>;
  },
): Promise<AutoLayoutResult> {
  if (view.nodes.length === 0) {
    return { positions: {}, autoRoutes: {} };
  }

  const sizeMap: Record<string, { width: number; height: number }> = {};
  for (const node of view.nodes) {
    const est = estimateNodeSize(node, view.diagram_type);
    const m = options?.measured?.[node.id];
    sizeMap[node.id] = {
      width: Math.round(m?.width && m.width > 0 ? m.width : est.width),
      height: Math.round(m?.height && m.height > 0 ? m.height : est.height),
    };
  }

  if (
    !options?.forceReset &&
    view.nodes.every((node) => Boolean(savedLayout.positions[node.id]))
  ) {
    const preserved: Record<string, ElkPoint> = {};
    for (const node of view.nodes) {
      const saved = savedLayout.positions[node.id]!;
      preserved[node.id] = { x: saved.x, y: saved.y };
    }
    return { positions: preserved, autoRoutes: {} };
  }

  const elkNodes = view.nodes.map((node) => ({
    id: node.id,
    width: sizeMap[node.id]!.width,
    height: sizeMap[node.id]!.height,
  }));

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
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.layered.layering.strategy": "NETWORK_SIMPLEX",
      "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
      "elk.layered.nodePlacement.bk.fixedAlignment": "BALANCED",
      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
      "elk.layered.crossingMinimization.greedySwitch.type": "TWO_SIDED",
      "elk.layered.cycleBreaking.strategy": "GREEDY",
      "elk.layered.thoroughness": "14",
      "elk.separateConnectedComponents": "true",
      "elk.aspectRatio": "1.6",
      "elk.spacing.nodeNode": isEr ? "96" : "80",
      "elk.layered.spacing.nodeNodeBetweenLayers": isEr ? "200" : "160",
      "elk.spacing.edgeNode": isEr ? "52" : "44",
      "elk.spacing.edgeEdge": "20",
      "elk.spacing.componentComponent": "110",
      "elk.padding": "[top=32,left=32,bottom=32,right=32]",
    },
    children: elkNodes,
    edges: elkEdges,
  });

  const rawPositions: Record<string, ElkPoint> = {};
  for (const child of laidOut.children ?? []) {
    rawPositions[child.id] = {
      x: Math.round(child.x ?? 0),
      y: Math.round(child.y ?? 0),
    };
  }

  const autoPositions = resolveNodeOverlaps(rawPositions, sizeMap, {
    gap: 40,
    preferredAxis: view.direction === "LR" ? "y" : "x",
  });

  const edgeById = new Map(view.edges.map((edge) => [edge.id, edge]));
  const autoRoutes: Record<string, ElkAutoEdgeRoute> = {};
  for (const elkEdge of laidOut.edges ?? []) {
    const edge = edgeById.get(elkEdge.id);
    const section = elkEdge.sections?.[0];
    if (!edge || !section?.startPoint || !section?.endPoint) continue;
    if (edge.source === edge.target) continue;

    const srcRaw = rawPositions[edge.source];
    const tgtRaw = rawPositions[edge.target];
    const srcFinal = autoPositions[edge.source];
    const tgtFinal = autoPositions[edge.target];
    if (!srcRaw || !tgtRaw || !srcFinal || !tgtFinal) continue;
    // Only reuse ELK section points directly if neither endpoint needed post-ELK displacement
    if (
      Math.abs(srcRaw.x - srcFinal.x) > 1 ||
      Math.abs(srcRaw.y - srcFinal.y) > 1 ||
      Math.abs(tgtRaw.x - tgtFinal.x) > 1 ||
      Math.abs(tgtRaw.y - tgtFinal.y) > 1
    ) {
      continue;
    }

    const startPoint = {
      x: Math.round(section.startPoint.x),
      y: Math.round(section.startPoint.y),
    };
    const endPoint = {
      x: Math.round(section.endPoint.x),
      y: Math.round(section.endPoint.y),
    };
    const waypoints = simplifyOrthogonalWaypoints(
      startPoint,
      section.bendPoints ?? [],
      endPoint,
    );
    const srcSize = sizeMap[edge.source]!;
    const tgtSize = sizeMap[edge.target]!;
    autoRoutes[edge.id] = {
      sourceSide: inferHandleSide(startPoint, srcFinal, srcSize),
      targetSide: inferHandleSide(endPoint, tgtFinal, tgtSize),
      startPoint,
      endPoint,
      waypoints,
      sourcePos: { ...srcFinal },
      targetPos: { ...tgtFinal },
    };
  }

  if (options?.forceReset) {
    return { positions: autoPositions, autoRoutes };
  }

  const pinnedIds = new Set<string>();
  const combined: Record<string, ElkPoint> = {};
  for (const node of view.nodes) {
    const saved = savedLayout.positions[node.id];
    if (saved) {
      combined[node.id] = { x: saved.x, y: saved.y };
      pinnedIds.add(node.id);
    } else {
      combined[node.id] = autoPositions[node.id] ?? { x: 40, y: 40 };
    }
  }
  const resolved = resolveNodeOverlaps(combined, sizeMap, {
    gap: 40,
    pinnedIds,
    preferredAxis: view.direction === "LR" ? "y" : "x",
  });
  return { positions: resolved, autoRoutes };
}
