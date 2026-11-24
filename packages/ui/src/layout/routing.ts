import type {
  DesignView,
  EdgeRoute,
  HandleSide,
} from "@redlinify/shared/browser";
import { estimateNodeSize } from "./elk";

export interface Point {
  x: number;
  y: number;
}

export interface NodeRect {
  x: number;
  y: number;
  width: number;
  height: number;
  cx: number;
  cy: number;
}

export interface ComputedEdgeRoute {
  sourceHandle: HandleSide;
  targetHandle: HandleSide;
  manualWaypoints: Point[];
  autoWaypoints: Point[];
  curveOffset: Point;
}

function segmentIntersectsRect(a: Point, b: Point, rect: NodeRect, pad = 14): boolean {
  const minX = rect.x - pad;
  const maxX = rect.x + rect.width + pad;
  const minY = rect.y - pad;
  const maxY = rect.y + rect.height + pad;

  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;

  const checks: Array<[number, number]> = [
    [-dx, a.x - minX],
    [dx, maxX - a.x],
    [-dy, a.y - minY],
    [dy, maxY - a.y],
  ];

  for (const [p, q] of checks) {
    if (Math.abs(p) < 1e-6) {
      if (q < 0) return false;
    } else {
      const r = q / p;
      if (p < 0) {
        if (r > t1) return false;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return false;
        if (r < t1) t1 = r;
      }
    }
  }
  return t0 <= t1;
}

function defaultHandlesForDelta(dx: number, dy: number): {
  sourceHandle: HandleSide;
  targetHandle: HandleSide;
} {
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0
      ? { sourceHandle: "right", targetHandle: "left" }
      : { sourceHandle: "left", targetHandle: "right" };
  }
  return dy >= 0
    ? { sourceHandle: "bottom", targetHandle: "top" }
    : { sourceHandle: "top", targetHandle: "bottom" };
}

/**
 * Computes smart default handles, symmetric bowing for reciprocal/parallel edges
 * (`A -> B` and `B -> A`), and obstacle-avoiding detours for skip/back-edges
 * while preserving user-specified `edge_routes`.
 */
export function computeSmartEdgeRouting(
  view: DesignView,
  positions: Record<string, Point>,
  edgeRoutes: Record<string, EdgeRoute> = {},
  measured?: Record<string, { width?: number; height?: number }>,
): Record<string, ComputedEdgeRoute> {
  const rects = new Map<string, NodeRect>();
  for (const node of view.nodes) {
    const pos = positions[node.id] ?? { x: 40, y: 40 };
    const est = estimateNodeSize(node, view.diagram_type);
    const w = measured?.[node.id]?.width ?? est.width;
    const h = measured?.[node.id]?.height ?? est.height;
    rects.set(node.id, {
      x: pos.x,
      y: pos.y,
      width: w,
      height: h,
      cx: pos.x + w / 2,
      cy: pos.y + h / 2,
    });
  }

  // Group edges by unordered node pair so reciprocal (`A->B` + `B->A`) and
  // parallel edges bow symmetrically on opposite physical sides.
  const pairGroups = new Map<string, string[]>();
  for (const edge of view.edges) {
    const pairKey =
      edge.source < edge.target
        ? `${edge.source}::${edge.target}`
        : `${edge.target}::${edge.source}`;
    const list = pairGroups.get(pairKey) ?? [];
    list.push(edge.id);
    pairGroups.set(pairKey, list);
  }

  const result: Record<string, ComputedEdgeRoute> = {};
  let lrDetourCount = 0;
  let tbDetourCount = 0;

  for (const edge of view.edges) {
    const srcRect = rects.get(edge.source);
    const tgtRect = rects.get(edge.target);
    const userRoute = edgeRoutes[edge.id];

    if (!srcRect || !tgtRect) {
      result[edge.id] = {
        sourceHandle: userRoute?.source_handle ?? "right",
        targetHandle: userRoute?.target_handle ?? "left",
        manualWaypoints: userRoute?.waypoints ?? [],
        autoWaypoints: [],
        curveOffset: { x: 0, y: 0 },
      };
      continue;
    }

    const manualWaypoints = userRoute?.waypoints ? [...userRoute.waypoints] : [];

    // Self-loop handling
    if (edge.source === edge.target) {
      const autoWaypoints =
        manualWaypoints.length > 0
          ? []
          : [
              { x: srcRect.x + srcRect.width + 44, y: srcRect.cy },
              {
                x: srcRect.x + srcRect.width + 44,
                y: srcRect.y - 36,
              },
              { x: srcRect.cx, y: srcRect.y - 36 },
            ];
      result[edge.id] = {
        sourceHandle: userRoute?.source_handle ?? "right",
        targetHandle: userRoute?.target_handle ?? "top",
        manualWaypoints,
        autoWaypoints,
        curveOffset: { x: 0, y: 0 },
      };
      continue;
    }

    const dx = tgtRect.cx - srcRect.cx;
    const dy = tgtRect.cy - srcRect.cy;
    const defaults = defaultHandlesForDelta(dx, dy);

    const pairKey =
      edge.source < edge.target
        ? `${edge.source}::${edge.target}`
        : `${edge.target}::${edge.source}`;
    const siblings = pairGroups.get(pairKey) ?? [edge.id];

    let curveOffset: Point = { x: 0, y: 0 };
    if (siblings.length > 1 && manualWaypoints.length === 0) {
      const idx = siblings.indexOf(edge.id);
      const slot = idx - (siblings.length - 1) / 2;
      const minId = edge.source < edge.target ? edge.source : edge.target;
      const maxId = edge.source < edge.target ? edge.target : edge.source;
      const minRect = rects.get(minId)!;
      const maxRect = rects.get(maxId)!;
      const cdx = maxRect.cx - minRect.cx;
      const cdy = maxRect.cy - minRect.cy;
      const len = Math.hypot(cdx, cdy) || 1;
      const nx = -cdy / len;
      const ny = cdx / len;
      const magnitude = slot * 92;
      curveOffset = {
        x: Math.round(nx * magnitude),
        y: Math.round(ny * magnitude),
      };
    }

    // Detect intermediate box collisions (e.g., feedback back-edges or skip connections)
    let autoWaypoints: Point[] = [];
    let autoSourceHandle = defaults.sourceHandle;
    let autoTargetHandle = defaults.targetHandle;

    if (
      manualWaypoints.length === 0 &&
      !userRoute?.source_handle &&
      !userRoute?.target_handle
    ) {
      const srcCenter = { x: srcRect.cx, y: srcRect.cy };
      const tgtCenter = { x: tgtRect.cx, y: tgtRect.cy };
      const intersected: NodeRect[] = [];

      for (const [nodeId, rect] of rects.entries()) {
        if (nodeId === edge.source || nodeId === edge.target) continue;
        if (segmentIntersectsRect(srcCenter, tgtCenter, rect, 18)) {
          intersected.push(rect);
        }
      }

      if (intersected.length > 0) {
        const mostlyHorizontal = Math.abs(dx) >= Math.abs(dy);
        if (mostlyHorizontal) {
          const maxBottom = Math.max(
            srcRect.y + srcRect.height,
            tgtRect.y + tgtRect.height,
            ...intersected.map((r) => r.y + r.height),
          );
          const laneY = Math.round(maxBottom + 46 + lrDetourCount * 32);
          lrDetourCount += 1;
          autoSourceHandle = "bottom";
          autoTargetHandle = "bottom";
          autoWaypoints = [
            { x: Math.round(srcRect.cx), y: laneY },
            { x: Math.round(tgtRect.cx), y: laneY },
          ];
          curveOffset = { x: 0, y: 0 };
        } else {
          const maxRight = Math.max(
            srcRect.x + srcRect.width,
            tgtRect.x + tgtRect.width,
            ...intersected.map((r) => r.x + r.width),
          );
          const laneX = Math.round(maxRight + 64 + tbDetourCount * 36);
          tbDetourCount += 1;
          autoSourceHandle = "right";
          autoTargetHandle = "right";
          autoWaypoints = [
            { x: laneX, y: Math.round(srcRect.cy) },
            { x: laneX, y: Math.round(tgtRect.cy) },
          ];
          curveOffset = { x: 0, y: 0 };
        }
      }
    }

    result[edge.id] = {
      sourceHandle: userRoute?.source_handle ?? autoSourceHandle,
      targetHandle: userRoute?.target_handle ?? autoTargetHandle,
      manualWaypoints,
      autoWaypoints,
      curveOffset,
    };
  }

  return result;
}
