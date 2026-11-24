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
  sourcePortOffset: number;
  targetPortOffset: number;
  manualWaypoints: Point[];
  autoWaypoints: Point[];
  curveOffset: Point;
}

function segmentIntersectsRect(
  a: Point,
  b: Point,
  rect: NodeRect,
  pad = 14,
): boolean {
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

function handlePoint(rect: NodeRect, side: HandleSide): Point {
  switch (side) {
    case "top":
      return { x: rect.cx, y: rect.y };
    case "right":
      return { x: rect.x + rect.width, y: rect.cy };
    case "bottom":
      return { x: rect.cx, y: rect.y + rect.height };
    case "left":
      return { x: rect.x, y: rect.cy };
  }
}

function shiftHandlePoint(pt: Point, side: HandleSide, offset: number): Point {
  if (!offset) return pt;
  if (side === "left" || side === "right") {
    return { x: pt.x, y: pt.y + offset };
  }
  return { x: pt.x + offset, y: pt.y };
}

function pointToSegmentDistSq(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-6) {
    const px = p.x - a.x;
    const py = p.y - a.y;
    return px * px + py * py;
  }
  const t = Math.max(
    0,
    Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq),
  );
  const projX = a.x + dx * t;
  const projY = a.y + dy * t;
  const diffX = p.x - projX;
  const diffY = p.y - projY;
  return diffX * diffX + diffY * diffY;
}

function buildNodeRects(
  view: DesignView,
  positions: Record<string, Point>,
  measured?: Record<string, { width?: number; height?: number }>,
): Map<string, NodeRect> {
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
  return rects;
}

function handleOutward(side: HandleSide): Point {
  switch (side) {
    case "top":
      return { x: 0, y: -1 };
    case "right":
      return { x: 1, y: 0 };
    case "bottom":
      return { x: 0, y: 1 };
    case "left":
      return { x: -1, y: 0 };
  }
}

function approxOrthoPath(
  srcRect: NodeRect,
  srcSide: HandleSide,
  tgtRect: NodeRect,
  tgtSide: HandleSide,
): Point[] {
  const s = handlePoint(srcRect, srcSide);
  const t = handlePoint(tgtRect, tgtSide);
  const so = handleOutward(srcSide);
  const to = handleOutward(tgtSide);
  const p1 = { x: s.x + so.x * 24, y: s.y + so.y * 24 };
  const p2 = { x: t.x + to.x * 24, y: t.y + to.y * 24 };

  const srcHoriz = srcSide === "left" || srcSide === "right";
  const tgtHoriz = tgtSide === "left" || tgtSide === "right";

  if (srcHoriz && tgtHoriz) {
    const midX = (p1.x + p2.x) / 2;
    return [s, p1, { x: midX, y: p1.y }, { x: midX, y: p2.y }, p2, t];
  }
  if (!srcHoriz && !tgtHoriz) {
    const midY = (p1.y + p2.y) / 2;
    return [s, p1, { x: p1.x, y: midY }, { x: p2.x, y: midY }, p2, t];
  }
  if (srcHoriz && !tgtHoriz) {
    return [s, p1, { x: p2.x, y: p1.y }, p2, t];
  }
  return [s, p1, { x: p1.x, y: p2.y }, p2, t];
}

function findCollisions(
  points: Point[],
  obstacles: NodeRect[],
  pad = 12,
): NodeRect[] {
  const hit: NodeRect[] = [];
  for (const rect of obstacles) {
    let intersects = false;
    for (let i = 0; i < points.length - 1; i++) {
      if (segmentIntersectsRect(points[i]!, points[i + 1]!, rect, pad)) {
        intersects = true;
        break;
      }
    }
    if (intersects) hit.push(rect);
  }
  return hit;
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
 * Computes smart default handles, multi-port side spreading, symmetric bowing
 * for reciprocal/parallel edges (`A -> B` and `B -> A`), and obstacle-avoiding
 * detours while honoring user-specified `edge_routes`.
 */
export function computeSmartEdgeRouting(
  view: DesignView,
  positions: Record<string, Point>,
  edgeRoutes: Record<string, EdgeRoute> = {},
  measured?: Record<string, { width?: number; height?: number }>,
): Record<string, ComputedEdgeRoute> {
  const rects = buildNodeRects(view, positions, measured);

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
        sourcePortOffset: 0,
        targetPortOffset: 0,
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
        sourcePortOffset: 0,
        targetPortOffset: 0,
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

    let autoWaypoints: Point[] = [];
    let autoSourceHandle = defaults.sourceHandle;
    let autoTargetHandle = defaults.targetHandle;

    if (
      manualWaypoints.length === 0 &&
      !userRoute?.source_handle &&
      !userRoute?.target_handle &&
      siblings.length === 1
    ) {
      const obstacles: NodeRect[] = [];
      for (const [nodeId, rect] of rects.entries()) {
        if (nodeId !== edge.source && nodeId !== edge.target) {
          obstacles.push(rect);
        }
      }

      const defaultPath = approxOrthoPath(
        srcRect,
        defaults.sourceHandle,
        tgtRect,
        defaults.targetHandle,
      );
      const hitOnDefault = findCollisions(defaultPath, obstacles, 12);

      if (hitOnDefault.length > 0) {
        // First try alternative direct handle combinations that avoid boxes
        const candidates: Array<[HandleSide, HandleSide]> = [
          [defaults.sourceHandle, dy >= 0 ? "top" : "bottom"],
          [dy >= 0 ? "bottom" : "top", defaults.targetHandle],
          ["bottom", "top"],
          ["top", "bottom"],
          ["right", "left"],
          ["left", "right"],
          ["bottom", "bottom"],
          ["top", "top"],
        ];

        let foundCleanDirect = false;
        for (const [cSrc, cTgt] of candidates) {
          const testPath = approxOrthoPath(srcRect, cSrc, tgtRect, cTgt);
          if (findCollisions(testPath, obstacles, 12).length === 0) {
            autoSourceHandle = cSrc;
            autoTargetHandle = cTgt;
            foundCleanDirect = true;
            break;
          }
        }

        // Otherwise build an outer detour lane completely outside hit boxes
        if (!foundCleanDirect) {
          const mostlyHorizontal = Math.abs(dx) >= Math.abs(dy);
          if (mostlyHorizontal) {
            const maxBottom = Math.max(
              srcRect.y + srcRect.height,
              tgtRect.y + tgtRect.height,
              ...hitOnDefault.map((r) => r.y + r.height),
            );
            const laneY = Math.round(maxBottom + 48 + lrDetourCount * 32);
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
              ...hitOnDefault.map((r) => r.x + r.width),
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
    }

    result[edge.id] = {
      sourceHandle: userRoute?.source_handle ?? autoSourceHandle,
      targetHandle: userRoute?.target_handle ?? autoTargetHandle,
      sourcePortOffset: 0,
      targetPortOffset: 0,
      manualWaypoints,
      autoWaypoints,
      curveOffset,
    };
  }

  // Spread multiple attachments sharing the same side of a node so lines & crow's feet never overlap
  const sideBuckets = new Map<
    string,
    Array<{
      edgeId: string;
      end: "source" | "target";
      sortCoord: number;
      sideLength: number;
    }>
  >();

  for (const edge of view.edges) {
    const route = result[edge.id];
    const srcRect = rects.get(edge.source);
    const tgtRect = rects.get(edge.target);
    if (!route || !srcRect || !tgtRect) continue;

    const srcHoriz =
      route.sourceHandle === "left" || route.sourceHandle === "right";
    const srcKey = `${edge.source}:${route.sourceHandle}`;
    const srcList = sideBuckets.get(srcKey) ?? [];
    srcList.push({
      edgeId: edge.id,
      end: "source",
      sortCoord: srcHoriz ? tgtRect.cy : tgtRect.cx,
      sideLength: srcHoriz ? srcRect.height : srcRect.width,
    });
    sideBuckets.set(srcKey, srcList);

    const tgtHoriz =
      route.targetHandle === "left" || route.targetHandle === "right";
    const tgtKey = `${edge.target}:${route.targetHandle}`;
    const tgtList = sideBuckets.get(tgtKey) ?? [];
    tgtList.push({
      edgeId: edge.id,
      end: "target",
      sortCoord: tgtHoriz ? srcRect.cy : srcRect.cx,
      sideLength: tgtHoriz ? tgtRect.height : tgtRect.width,
    });
    sideBuckets.set(tgtKey, tgtList);
  }

  for (const attachments of sideBuckets.values()) {
    if (attachments.length <= 1) continue;
    attachments.sort((a, b) => a.sortCoord - b.sortCoord);
    const sideLength = attachments[0]!.sideLength;
    const step = Math.min(28, Math.max(14, (sideLength - 44) / attachments.length));
    const maxOffset = Math.max(16, sideLength / 2 - 24);

    attachments.forEach((att, idx) => {
      const raw = (idx - (attachments.length - 1) / 2) * step;
      const clamped = Math.round(Math.max(-maxOffset, Math.min(maxOffset, raw)));
      const route = result[att.edgeId];
      if (!route) return;
      if (att.end === "source") route.sourcePortOffset = clamped;
      else route.targetPortOffset = clamped;
    });
  }

  return result;
}

/**
 * Inserts a new waypoint into whichever segment of `edgeId`'s rendered polyline
 * is closest to `newPt`, preventing self-crossing loops when adding points
 * earlier along an already-bent edge.
 */
export function insertWaypointAlongEdge(
  view: DesignView,
  positions: Record<string, Point>,
  edgeRoutes: Record<string, EdgeRoute>,
  edgeId: string,
  newPt: Point,
  measured?: Record<string, { width?: number; height?: number }>,
): {
  waypoints: Point[];
  handles: { source_handle: HandleSide; target_handle: HandleSide };
} {
  const routing = computeSmartEdgeRouting(view, positions, edgeRoutes, measured);
  const route = routing[edgeId];
  const roundedPt = { x: Math.round(newPt.x), y: Math.round(newPt.y) };

  if (!route) {
    const existing = edgeRoutes[edgeId]?.waypoints ?? [];
    return {
      waypoints: [...existing, roundedPt],
      handles: {
        source_handle: edgeRoutes[edgeId]?.source_handle ?? "right",
        target_handle: edgeRoutes[edgeId]?.target_handle ?? "left",
      },
    };
  }

  const handles = {
    source_handle: route.sourceHandle,
    target_handle: route.targetHandle,
  };
  const existingWps = route.manualWaypoints;
  if (existingWps.length === 0) {
    return { waypoints: [roundedPt], handles };
  }

  const edge = view.edges.find((e) => e.id === edgeId);
  const rects = buildNodeRects(view, positions, measured);
  const srcRect = edge ? rects.get(edge.source) : undefined;
  const tgtRect = edge ? rects.get(edge.target) : undefined;
  if (!srcRect || !tgtRect) {
    return { waypoints: [...existingWps, roundedPt], handles };
  }

  const srcPt = shiftHandlePoint(
    handlePoint(srcRect, route.sourceHandle),
    route.sourceHandle,
    route.sourcePortOffset,
  );
  const tgtPt = shiftHandlePoint(
    handlePoint(tgtRect, route.targetHandle),
    route.targetHandle,
    route.targetPortOffset,
  );

  const pts = [srcPt, ...existingWps, tgtPt];
  let bestIdx = existingWps.length;
  let bestDist = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = pointToSegmentDistSq(roundedPt, pts[i]!, pts[i + 1]!);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }

  const nextWps = [...existingWps];
  nextWps.splice(bestIdx, 0, roundedPt);
  return { waypoints: nextWps, handles };
}
