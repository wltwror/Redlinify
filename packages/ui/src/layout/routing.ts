import type {
  DesignView,
  EdgeRoute,
  HandleSide,
} from "@redlinify/shared/browser";
import { estimateNodeSize, type ElkAutoEdgeRoute } from "./elk";

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

function defaultHandlesForDelta(
  dx: number,
  dy: number,
  direction: "LR" | "TB" = "LR",
): {
  sourceHandle: HandleSide;
  targetHandle: HandleSide;
} {
  if (direction === "LR") {
    if (Math.abs(dx) * 1.2 >= Math.abs(dy)) {
      return dx >= 0
        ? { sourceHandle: "right", targetHandle: "left" }
        : { sourceHandle: "left", targetHandle: "right" };
    }
    return dy >= 0
      ? { sourceHandle: "bottom", targetHandle: "top" }
      : { sourceHandle: "top", targetHandle: "bottom" };
  }
  if (Math.abs(dy) * 1.2 >= Math.abs(dx)) {
    return dy >= 0
      ? { sourceHandle: "bottom", targetHandle: "top" }
      : { sourceHandle: "top", targetHandle: "bottom" };
  }
  return dx >= 0
    ? { sourceHandle: "right", targetHandle: "left" }
    : { sourceHandle: "left", targetHandle: "right" };
}

interface Segment {
  a: Point;
  b: Point;
}

function dedupeSortedAxis(vals: number[], minGap = 4): number[] {
  const sorted = [...vals].map((v) => Math.round(v)).sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of sorted) {
    const prev = out[out.length - 1];
    if (prev === undefined || Math.abs(v - prev) >= minGap) {
      out.push(v);
    }
  }
  return out;
}

function mergeExactAxis(vals: number[], anchors: number[]): number[] {
  const base = dedupeSortedAxis(vals, 5);
  const merged = [...base];
  for (const anchor of anchors) {
    const rounded = Math.round(anchor);
    if (!merged.some((v) => Math.abs(v - rounded) <= 2)) {
      merged.push(rounded);
    }
  }
  merged.sort((a, b) => a - b);
  return merged;
}

function findIndexNear(arr: number[], value: number): number {
  let bestIdx = 0;
  let bestDist = Infinity;
  const target = Math.round(value);
  for (let i = 0; i < arr.length; i++) {
    const d = Math.abs(arr[i]! - target);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function simplifyCorridorWaypoints(
  srcPort: Point,
  rawPoints: Point[],
  tgtPort: Point,
): Point[] {
  const full = [srcPort, ...rawPoints, tgtPort].map((p) => ({
    x: Math.round(p.x),
    y: Math.round(p.y),
  }));
  const deduped: Point[] = [];
  for (const p of full) {
    const last = deduped[deduped.length - 1];
    if (!last || Math.abs(last.x - p.x) > 1 || Math.abs(last.y - p.y) > 1) {
      deduped.push(p);
    }
  }
  if (deduped.length <= 2) return [];

  const turns: Point[] = [deduped[0]!];
  for (let i = 1; i < deduped.length - 1; i++) {
    const prev = turns[turns.length - 1]!;
    const curr = deduped[i]!;
    const next = deduped[i + 1]!;
    const sameX = Math.abs(prev.x - curr.x) <= 1 && Math.abs(curr.x - next.x) <= 1;
    const sameY = Math.abs(prev.y - curr.y) <= 1 && Math.abs(curr.y - next.y) <= 1;
    if (!sameX && !sameY) {
      turns.push(curr);
    }
  }
  return turns.slice(1);
}

function segmentsCrossPerpendicular(a1: Point, a2: Point, b1: Point, b2: Point): boolean {
  const aHoriz = Math.abs(a1.y - a2.y) <= 1 && Math.abs(a1.x - a2.x) > 1;
  const aVert = Math.abs(a1.x - a2.x) <= 1 && Math.abs(a1.y - a2.y) > 1;
  const bHoriz = Math.abs(b1.y - b2.y) <= 1 && Math.abs(b1.x - b2.x) > 1;
  const bVert = Math.abs(b1.x - b2.x) <= 1 && Math.abs(b1.y - b2.y) > 1;

  if (aHoriz && bVert) {
    const minX = Math.min(a1.x, a2.x) + 2;
    const maxX = Math.max(a1.x, a2.x) - 2;
    const minY = Math.min(b1.y, b2.y) + 2;
    const maxY = Math.max(b1.y, b2.y) - 2;
    return b1.x > minX && b1.x < maxX && a1.y > minY && a1.y < maxY;
  }
  if (aVert && bHoriz) {
    const minX = Math.min(b1.x, b2.x) + 2;
    const maxX = Math.max(b1.x, b2.x) - 2;
    const minY = Math.min(a1.y, a2.y) + 2;
    const maxY = Math.max(a1.y, a2.y) - 2;
    return a1.x > minX && a1.x < maxX && b1.y > minY && b1.y < maxY;
  }
  return false;
}

function segmentOverlapLength(a1: Point, a2: Point, b1: Point, b2: Point): number {
  const aHoriz = Math.abs(a1.y - a2.y) <= 1;
  const bHoriz = Math.abs(b1.y - b2.y) <= 1;
  if (aHoriz && bHoriz && Math.abs(a1.y - b1.y) <= 4) {
    const overlap =
      Math.min(Math.max(a1.x, a2.x), Math.max(b1.x, b2.x)) -
      Math.max(Math.min(a1.x, a2.x), Math.min(b1.x, b2.x));
    return overlap > 2 ? overlap : 0;
  }
  const aVert = Math.abs(a1.x - a2.x) <= 1;
  const bVert = Math.abs(b1.x - b2.x) <= 1;
  if (aVert && bVert && Math.abs(a1.x - b1.x) <= 4) {
    const overlap =
      Math.min(Math.max(a1.y, a2.y), Math.max(b1.y, b2.y)) -
      Math.max(Math.min(a1.y, a2.y), Math.min(b1.y, b2.y));
    return overlap > 2 ? overlap : 0;
  }
  return 0;
}

function buildGridAxes(
  rects: Map<string, NodeRect>,
  anchors: Point[],
): { xs: number[]; ys: number[] } {
  const allRects = [...rects.values()];
  const rawXs: number[] = [];
  const rawYs: number[] = [];

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const r of allRects) {
    minX = Math.min(minX, r.x);
    maxX = Math.max(maxX, r.x + r.width);
    minY = Math.min(minY, r.y);
    maxY = Math.max(maxY, r.y + r.height);
    rawXs.push(r.x - 16, r.x + r.width + 16, Math.round(r.cx));
    rawYs.push(r.y - 16, r.y + r.height + 16, Math.round(r.cy));
  }

  if (Number.isFinite(minX)) {
    rawXs.push(minX - 42, maxX + 42, minX - 76, maxX + 76);
    rawYs.push(minY - 42, maxY + 42, minY - 76, maxY + 76);
  }

  // Add aisle midpoints between non-overlapping horizontal/vertical box spans
  const sortedByX = [...allRects].sort((a, b) => a.x - b.x);
  for (let i = 0; i < sortedByX.length; i++) {
    const aRight = sortedByX[i]!.x + sortedByX[i]!.width;
    for (let j = i + 1; j < sortedByX.length; j++) {
      const gap = sortedByX[j]!.x - aRight;
      if (gap >= 24 && gap <= 320) {
        rawXs.push(Math.round(aRight + gap / 2));
        break;
      }
      if (gap > 320) break;
    }
  }

  const sortedByY = [...allRects].sort((a, b) => a.y - b.y);
  for (let i = 0; i < sortedByY.length; i++) {
    const aBottom = sortedByY[i]!.y + sortedByY[i]!.height;
    for (let j = i + 1; j < sortedByY.length; j++) {
      const gap = sortedByY[j]!.y - aBottom;
      if (gap >= 24 && gap <= 280) {
        rawYs.push(Math.round(aBottom + gap / 2));
        break;
      }
      if (gap > 280) break;
    }
  }

  return {
    xs: mergeExactAxis(
      rawXs,
      anchors.map((a) => a.x),
    ),
    ys: mergeExactAxis(
      rawYs,
      anchors.map((a) => a.y),
    ),
  };
}

interface CorridorRouteCandidate {
  waypoints: Point[];
  score: number;
  sourceHandle: HandleSide;
  targetHandle: HandleSide;
}

function routeOnCorridorGrid(
  srcRect: NodeRect,
  srcHandle: HandleSide,
  tgtRect: NodeRect,
  tgtHandle: HandleSide,
  obstacles: NodeRect[],
  baseAxes: { xs: number[]; ys: number[] },
  occupiedSegments: Segment[],
): CorridorRouteCandidate | null {
  const srcPort = handlePoint(srcRect, srcHandle);
  const tgtPort = handlePoint(tgtRect, tgtHandle);
  const srcOut = handleOutward(srcHandle);
  const tgtOut = handleOutward(tgtHandle);

  const exitOffsets = [22, 12];
  for (const stubLen of exitOffsets) {
    const sExit: Point = {
      x: Math.round(srcPort.x + srcOut.x * stubLen),
      y: Math.round(srcPort.y + srcOut.y * stubLen),
    };
    const tEntry: Point = {
      x: Math.round(tgtPort.x + tgtOut.x * stubLen),
      y: Math.round(tgtPort.y + tgtOut.y * stubLen),
    };

    const pad = stubLen >= 20 ? 10 : 4;
    if (
      obstacles.some(
        (r) =>
          segmentIntersectsRect(srcPort, sExit, r, pad) ||
          segmentIntersectsRect(tEntry, tgtPort, r, pad),
      )
    ) {
      continue;
    }

    const xs = mergeExactAxis(baseAxes.xs, [sExit.x, tEntry.x]);
    const ys = mergeExactAxis(baseAxes.ys, [sExit.y, tEntry.y]);
    const W = xs.length;
    const H = ys.length;
    if (W === 0 || H === 0) continue;

    const sxIdx = findIndexNear(xs, sExit.x);
    const syIdx = findIndexNear(ys, sExit.y);
    const txIdx = findIndexNear(xs, tEntry.x);
    const tyIdx = findIndexNear(ys, tEntry.y);

    // State id encodes (y * W + x) * 2 + lastDir (0 = H, 1 = V)
    const totalStates = W * H * 2;
    const gScore = new Float64Array(totalStates).fill(Infinity);
    const parent = new Int32Array(totalStates).fill(-1);
    const closed = new Uint8Array(totalStates);

    const startH = (syIdx * W + sxIdx) * 2;
    const startV = startH + 1;
    const initDir =
      srcHandle === "left" || srcHandle === "right" ? 0 : 1;
    const initialState = initDir === 0 ? startH : startV;
    gScore[initialState] = 0;

    // Min-heap of [fScore, state]
    const heap: Array<[number, number]> = [
      [
        Math.abs(xs[sxIdx]! - tEntry.x) + Math.abs(ys[syIdx]! - tEntry.y),
        initialState,
      ],
    ];
    const pushHeap = (f: number, state: number) => {
      heap.push([f, state]);
      let idx = heap.length - 1;
      while (idx > 0) {
        const pIdx = (idx - 1) >> 1;
        if (heap[pIdx]![0] <= heap[idx]![0]) break;
        const tmp = heap[pIdx]!;
        heap[pIdx] = heap[idx]!;
        heap[idx] = tmp;
        idx = pIdx;
      }
    };
    const popHeap = (): number => {
      const top = heap[0]![1];
      const last = heap.pop()!;
      if (heap.length > 0) {
        heap[0] = last;
        let idx = 0;
        const n = heap.length;
        while (true) {
          let smallest = idx;
          const left = idx * 2 + 1;
          const right = left + 1;
          if (left < n && heap[left]![0] < heap[smallest]![0]) smallest = left;
          if (right < n && heap[right]![0] < heap[smallest]![0]) smallest = right;
          if (smallest === idx) break;
          const tmp = heap[smallest]!;
          heap[smallest] = heap[idx]!;
          heap[idx] = tmp;
          idx = smallest;
        }
      }
      return top;
    };

    const dirs: Array<[number, number, number]> = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 1],
      [0, -1, 1],
    ];

    let goalState = -1;
    const goalCell = tyIdx * W + txIdx;
    const targetEndDir =
      tgtHandle === "left" || tgtHandle === "right" ? 0 : 1;

    while (heap.length > 0) {
      const curr = popHeap();
      if (closed[curr]) continue;
      closed[curr] = 1;

      const cell = curr >> 1;
      if (cell === goalCell) {
        goalState = curr;
        break;
      }

      const lastDir = curr & 1;
      const cx = cell % W;
      const cy = Math.floor(cell / W);
      const ax = xs[cx]!;
      const ay = ys[cy]!;
      const currG = gScore[curr]!;

      for (const [dx, dy, nextDir] of dirs) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
        const nState = (ny * W + nx) * 2 + nextDir;
        if (closed[nState]) continue;

        const bx = xs[nx]!;
        const by = ys[ny]!;
        const segA = { x: ax, y: ay };
        const segB = { x: bx, y: by };

        // Prevent walking into obstacles or back through source/target boxes
        if (
          segmentIntersectsRect(segA, segB, srcRect, 3) ||
          segmentIntersectsRect(segA, segB, tgtRect, 3)
        ) {
          continue;
        }
        let blocked = false;
        for (const r of obstacles) {
          if (segmentIntersectsRect(segA, segB, r, pad)) {
            blocked = true;
            break;
          }
        }
        if (blocked) continue;

        const dist = Math.abs(bx - ax) + Math.abs(by - ay);
        const turnPenalty =
          curr === initialState && nextDir === initDir
            ? 0
            : lastDir !== nextDir
              ? 65
              : 0;
        const goalTurnPenalty =
          ny * W + nx === goalCell && nextDir !== targetEndDir ? 65 : 0;

        let occPenalty = 0;
        for (const occ of occupiedSegments) {
          if (segmentsCrossPerpendicular(segA, segB, occ.a, occ.b)) {
            occPenalty += 220;
          } else {
            const overlap = segmentOverlapLength(segA, segB, occ.a, occ.b);
            if (overlap > 0) {
              occPenalty += 90 + overlap * 0.4;
            }
          }
        }

        const tentativeG =
          currG + dist + turnPenalty + goalTurnPenalty + occPenalty;
        if (tentativeG < gScore[nState]!) {
          gScore[nState] = tentativeG;
          parent[nState] = curr;
          const h =
            Math.abs(bx - tEntry.x) + Math.abs(by - tEntry.y);
          pushHeap(tentativeG + h, nState);
        }
      }
    }

    if (goalState === -1) continue;

    const rev: Point[] = [];
    let trace = goalState;
    while (trace !== -1) {
      const cell = trace >> 1;
      const cx = cell % W;
      const cy = Math.floor(cell / W);
      rev.push({ x: xs[cx]!, y: ys[cy]! });
      trace = parent[trace]!;
    }
    rev.reverse();

    const waypoints = simplifyCorridorWaypoints(srcPort, rev, tgtPort);
    return {
      waypoints,
      score: gScore[goalState]!,
      sourceHandle: srcHandle,
      targetHandle: tgtHandle,
    };
  }

  return null;
}

function recordSegments(
  srcPt: Point,
  waypoints: Point[],
  tgtPt: Point,
  out: Segment[],
): void {
  const full = [srcPt, ...waypoints, tgtPt];
  for (let i = 0; i < full.length - 1; i++) {
    out.push({ a: full[i]!, b: full[i + 1]! });
  }
}

function isCollinearOverlap(
  a1: Point,
  a2: Point,
  b1: Point,
  b2: Point,
): boolean {
  const aHoriz = Math.abs(a1.y - a2.y) <= 2 && Math.abs(a1.x - a2.x) > 4;
  const bHoriz = Math.abs(b1.y - b2.y) <= 2 && Math.abs(b1.x - b2.x) > 4;
  if (aHoriz && bHoriz && Math.abs(a1.y - b1.y) <= 3) {
    const overlap =
      Math.min(Math.max(a1.x, a2.x), Math.max(b1.x, b2.x)) -
      Math.max(Math.min(a1.x, a2.x), Math.min(b1.x, b2.x));
    return overlap > 4;
  }
  const aVert = Math.abs(a1.x - a2.x) <= 2 && Math.abs(a1.y - a2.y) > 4;
  const bVert = Math.abs(b1.x - b2.x) <= 2 && Math.abs(b1.y - b2.y) > 4;
  if (aVert && bVert && Math.abs(a1.x - b1.x) <= 3) {
    const overlap =
      Math.min(Math.max(a1.y, a2.y), Math.max(b1.y, b2.y)) -
      Math.max(Math.min(a1.y, a2.y), Math.min(b1.y, b2.y));
    return overlap > 4;
  }
  return false;
}

function spreadOverlappingCorridorSegments(
  edges: DesignView["edges"],
  result: Record<string, ComputedEdgeRoute>,
  rects: Map<string, NodeRect>,
): void {
  interface InteriorSeg {
    edgeId: string;
    wpIndex: number;
    horiz: boolean;
    coord: number;
    spanMin: number;
    spanMax: number;
  }

  const candidates: InteriorSeg[] = [];
  for (const edge of edges) {
    const route = result[edge.id];
    const srcRect = rects.get(edge.source);
    const tgtRect = rects.get(edge.target);
    if (!route || !srcRect || !tgtRect) continue;
    if (route.manualWaypoints.length > 0 || route.autoWaypoints.length < 2) {
      continue;
    }

    const wps = route.autoWaypoints;
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
    const srcHoriz = route.sourceHandle === "left" || route.sourceHandle === "right";
    const tgtHoriz = route.targetHandle === "left" || route.targetHandle === "right";

    for (let i = 0; i < wps.length - 1; i++) {
      const a = wps[i]!;
      const b = wps[i + 1]!;
      const segHoriz = Math.abs(a.y - b.y) <= 2 && Math.abs(a.x - b.x) > 8;
      const segVert = Math.abs(a.x - b.x) <= 2 && Math.abs(a.y - b.y) > 8;
      if (!segHoriz && !segVert) continue;

      // Never shift the orthogonal line collinear with a fixed end stub
      if (i === 0) {
        if (segHoriz && srcHoriz && Math.abs(a.y - srcPt.y) <= 2) continue;
        if (segVert && !srcHoriz && Math.abs(a.x - srcPt.x) <= 2) continue;
      }
      if (i + 1 === wps.length - 1) {
        if (segHoriz && tgtHoriz && Math.abs(b.y - tgtPt.y) <= 2) continue;
        if (segVert && !tgtHoriz && Math.abs(b.x - tgtPt.x) <= 2) continue;
      }

      candidates.push({
        edgeId: edge.id,
        wpIndex: i,
        horiz: segHoriz,
        coord: segHoriz ? (a.y + b.y) / 2 : (a.x + b.x) / 2,
        spanMin: segHoriz ? Math.min(a.x, b.x) : Math.min(a.y, b.y),
        spanMax: segHoriz ? Math.max(a.x, b.x) : Math.max(a.y, b.y),
      });
    }
  }

  // Group collinear overlapping segments
  const used = new Set<number>();
  for (let i = 0; i < candidates.length; i++) {
    if (used.has(i)) continue;
    const base = candidates[i]!;
    const group: number[] = [i];
    for (let j = i + 1; j < candidates.length; j++) {
      if (used.has(j)) continue;
      const other = candidates[j]!;
      if (other.horiz !== base.horiz || other.edgeId === base.edgeId) continue;
      const a1 = base.horiz
        ? { x: base.spanMin, y: base.coord }
        : { x: base.coord, y: base.spanMin };
      const a2 = base.horiz
        ? { x: base.spanMax, y: base.coord }
        : { x: base.coord, y: base.spanMax };
      const b1 = other.horiz
        ? { x: other.spanMin, y: other.coord }
        : { x: other.coord, y: other.spanMin };
      const b2 = other.horiz
        ? { x: other.spanMax, y: other.coord }
        : { x: other.coord, y: other.spanMax };
      if (isCollinearOverlap(a1, a2, b1, b2)) {
        group.push(j);
      }
    }

    if (group.length <= 1) continue;
    group.sort((ia, ib) => candidates[ia]!.spanMin - candidates[ib]!.spanMin);

    for (let k = 0; k < group.length; k++) {
      const seg = candidates[group[k]!]!;
      used.add(group[k]!);
      const rawShift = Math.round((k - (group.length - 1) / 2) * 12);
      if (rawShift === 0) continue;
      const route = result[seg.edgeId];
      const wps = route?.autoWaypoints;
      const edge = edges.find((e) => e.id === seg.edgeId);
      const srcRect = edge ? rects.get(edge.source) : undefined;
      const tgtRect = edge ? rects.get(edge.target) : undefined;
      if (!route || !wps || !edge || !srcRect || !tgtRect) continue;
      const p1 = wps[seg.wpIndex];
      const p2 = wps[seg.wpIndex + 1];
      if (!p1 || !p2) continue;

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
      const prevAnchor = seg.wpIndex > 0 ? wps[seg.wpIndex - 1]! : srcPt;
      const nextAnchor =
        seg.wpIndex + 2 < wps.length ? wps[seg.wpIndex + 2]! : tgtPt;
      const obstacles: NodeRect[] = [];
      for (const [nodeId, rect] of rects.entries()) {
        if (nodeId !== edge.source && nodeId !== edge.target) {
          obstacles.push(rect);
        }
      }

      const tryOffsets = [rawShift, Math.round(rawShift / 2)].filter(
        (v, idx, arr) => v !== 0 && arr.indexOf(v) === idx,
      );
      for (const delta of tryOffsets) {
        const nextP1 = seg.horiz
          ? { x: p1.x, y: p1.y + delta }
          : { x: p1.x + delta, y: p1.y };
        const nextP2 = seg.horiz
          ? { x: p2.x, y: p2.y + delta }
          : { x: p2.x + delta, y: p2.y };
        const collides = findCollisions(
          [prevAnchor, nextP1, nextP2, nextAnchor],
          obstacles,
          6,
        );
        if (collides.length === 0) {
          wps[seg.wpIndex] = nextP1;
          wps[seg.wpIndex + 1] = nextP2;
          break;
        }
      }
    }
  }
}

function alignEndStubsOrthogonally(
  srcPt: Point,
  srcHandle: HandleSide,
  tgtPt: Point,
  tgtHandle: HandleSide,
  waypoints: Point[],
): Point[] {
  if (waypoints.length === 0) return waypoints;
  const wps = waypoints.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));
  const srcHoriz = srcHandle === "left" || srcHandle === "right";
  const tgtHoriz = tgtHandle === "left" || tgtHandle === "right";

  // Ensure first segment from srcPt is strictly orthogonal
  const first = wps[0]!;
  if (srcHoriz && Math.abs(first.y - srcPt.y) > 1) {
    if (wps.length >= 2 && Math.abs(wps[1]!.x - first.x) <= 2) {
      wps[0] = { x: first.x, y: Math.round(srcPt.y) };
    } else {
      const out = handleOutward(srcHandle);
      const midX = Math.round(srcPt.x + out.x * 16);
      wps.unshift(
        { x: midX, y: Math.round(srcPt.y) },
        { x: midX, y: first.y },
      );
    }
  } else if (!srcHoriz && Math.abs(first.x - srcPt.x) > 1) {
    if (wps.length >= 2 && Math.abs(wps[1]!.y - first.y) <= 2) {
      wps[0] = { x: Math.round(srcPt.x), y: first.y };
    } else {
      const out = handleOutward(srcHandle);
      const midY = Math.round(srcPt.y + out.y * 16);
      wps.unshift(
        { x: Math.round(srcPt.x), y: midY },
        { x: first.x, y: midY },
      );
    }
  }

  // Ensure last segment into tgtPt is strictly orthogonal
  const lastIdx = wps.length - 1;
  const last = wps[lastIdx]!;
  if (tgtHoriz && Math.abs(last.y - tgtPt.y) > 1) {
    if (wps.length >= 2 && Math.abs(wps[lastIdx - 1]!.x - last.x) <= 2) {
      wps[lastIdx] = { x: last.x, y: Math.round(tgtPt.y) };
    } else {
      const out = handleOutward(tgtHandle);
      const midX = Math.round(tgtPt.x + out.x * 16);
      wps.push(
        { x: midX, y: last.y },
        { x: midX, y: Math.round(tgtPt.y) },
      );
    }
  } else if (!tgtHoriz && Math.abs(last.x - tgtPt.x) > 1) {
    if (wps.length >= 2 && Math.abs(wps[lastIdx - 1]!.y - last.y) <= 2) {
      wps[lastIdx] = { x: Math.round(tgtPt.x), y: last.y };
    } else {
      const out = handleOutward(tgtHandle);
      const midY = Math.round(tgtPt.y + out.y * 16);
      wps.push(
        { x: last.x, y: midY },
        { x: Math.round(tgtPt.x), y: midY },
      );
    }
  }

  return simplifyCorridorWaypoints(srcPt, wps, tgtPt);
}

/**
 * Computes smart default handles, multi-port side spreading, symmetric bowing
 * for reciprocal/parallel edges (`A -> B` and `B -> A`), and obstacle-avoiding
 * orthogonal corridor routes while honoring ELK routes and user `edge_routes`.
 */
export function computeSmartEdgeRouting(
  view: DesignView,
  positions: Record<string, Point>,
  edgeRoutes: Record<string, EdgeRoute> = {},
  measured?: Record<string, { width?: number; height?: number }>,
  elkRoutes?: Record<string, ElkAutoEdgeRoute>,
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

  const baseAxes = buildGridAxes(rects, []);
  const occupiedSegments: Segment[] = [];
  const elkPinnedEnd = new Set<string>();
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
    const defaults = defaultHandlesForDelta(dx, dy, view.direction);

    const pairKey =
      edge.source < edge.target
        ? `${edge.source}::${edge.target}`
        : `${edge.target}::${edge.source}`;
    const siblings = pairGroups.get(pairKey) ?? [edge.id];

    const obstacles: NodeRect[] = [];
    for (const [nodeId, rect] of rects.entries()) {
      if (nodeId !== edge.source && nodeId !== edge.target) {
        obstacles.push(rect);
      }
    }

    let curveOffset: Point = { x: 0, y: 0 };
    if (siblings.length > 1 && manualWaypoints.length === 0) {
      const directSiblingPath = approxOrthoPath(
        srcRect,
        userRoute?.source_handle ?? defaults.sourceHandle,
        tgtRect,
        userRoute?.target_handle ?? defaults.targetHandle,
      );
      if (findCollisions(directSiblingPath, obstacles, 12).length === 0) {
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
    }

    let autoWaypoints: Point[] = [];
    let autoSourceHandle = defaults.sourceHandle;
    let autoTargetHandle = defaults.targetHandle;
    let initSrcOffset = 0;
    let initTgtOffset = 0;

    // 1. Try precomputed ELK orthogonal route if both endpoints are untouched & path is clean
    const elkRoute = elkRoutes?.[edge.id];
    let adoptedElk = false;
    if (
      manualWaypoints.length === 0 &&
      !userRoute?.source_handle &&
      !userRoute?.target_handle &&
      curveOffset.x === 0 &&
      curveOffset.y === 0 &&
      elkRoute &&
      Math.abs(elkRoute.sourcePos.x - srcRect.x) <= 1 &&
      Math.abs(elkRoute.sourcePos.y - srcRect.y) <= 1 &&
      Math.abs(elkRoute.targetPos.x - tgtRect.x) <= 1 &&
      Math.abs(elkRoute.targetPos.y - tgtRect.y) <= 1
    ) {
      const fullElk = [
        elkRoute.startPoint,
        ...elkRoute.waypoints,
        elkRoute.endPoint,
      ];
      if (findCollisions(fullElk, obstacles, 10).length === 0) {
        const srcSide = elkRoute.sourceSide ?? defaults.sourceHandle;
        const tgtSide = elkRoute.targetSide ?? defaults.targetHandle;
        const srcHoriz = srcSide === "left" || srcSide === "right";
        const tgtHoriz = tgtSide === "left" || tgtSide === "right";
        const maxSrcOff = Math.max(12, (srcHoriz ? srcRect.height : srcRect.width) / 2 - 20);
        const maxTgtOff = Math.max(12, (tgtHoriz ? tgtRect.height : tgtRect.width) / 2 - 20);
        initSrcOffset = Math.round(
          Math.max(
            -maxSrcOff,
            Math.min(
              maxSrcOff,
              srcHoriz
                ? elkRoute.startPoint.y - srcRect.cy
                : elkRoute.startPoint.x - srcRect.cx,
            ),
          ),
        );
        initTgtOffset = Math.round(
          Math.max(
            -maxTgtOff,
            Math.min(
              maxTgtOff,
              tgtHoriz
                ? elkRoute.endPoint.y - tgtRect.cy
                : elkRoute.endPoint.x - tgtRect.cx,
            ),
          ),
        );
        autoSourceHandle = srcSide;
        autoTargetHandle = tgtSide;
        autoWaypoints = [...elkRoute.waypoints];
        adoptedElk = true;
        elkPinnedEnd.add(`${edge.id}:source`);
        elkPinnedEnd.add(`${edge.id}:target`);
      }
    }

    // 2. Corridor A* & direct clean routing when ELK route wasn't used
    if (
      !adoptedElk &&
      manualWaypoints.length === 0 &&
      !userRoute?.source_handle &&
      !userRoute?.target_handle &&
      curveOffset.x === 0 &&
      curveOffset.y === 0
    ) {
      const defaultPath = approxOrthoPath(
        srcRect,
        defaults.sourceHandle,
        tgtRect,
        defaults.targetHandle,
      );
      const hitOnDefault = findCollisions(defaultPath, obstacles, 12);

      if (hitOnDefault.length > 0) {
        // First try clean direct handles without intermediate boxes
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
        if (siblings.length === 1) {
          for (const [cSrc, cTgt] of candidates) {
            const testPath = approxOrthoPath(srcRect, cSrc, tgtRect, cTgt);
            if (findCollisions(testPath, obstacles, 12).length === 0) {
              autoSourceHandle = cSrc;
              autoTargetHandle = cTgt;
              foundCleanDirect = true;
              break;
            }
          }
        }

        // Next run obstacle-avoiding orthogonal Corridor A*
        if (!foundCleanDirect) {
          const handlePairs: Array<[HandleSide, HandleSide]> = [
            [defaults.sourceHandle, defaults.targetHandle],
          ];
          if (view.direction === "LR" && dx < 0) {
            handlePairs.push(["bottom", "bottom"], ["top", "top"]);
          } else if (view.direction === "TB" && dy < 0) {
            handlePairs.push(["right", "right"], ["left", "left"]);
          }

          let bestCorridor: CorridorRouteCandidate | null = null;
          for (const [hSrc, hTgt] of handlePairs) {
            const candidate = routeOnCorridorGrid(
              srcRect,
              hSrc,
              tgtRect,
              hTgt,
              obstacles,
              baseAxes,
              occupiedSegments,
            );
            if (
              candidate &&
              (!bestCorridor || candidate.score < bestCorridor.score * 0.92)
            ) {
              bestCorridor = candidate;
            }
          }

          if (bestCorridor) {
            autoSourceHandle = bestCorridor.sourceHandle;
            autoTargetHandle = bestCorridor.targetHandle;
            autoWaypoints = bestCorridor.waypoints;
          } else {
            // Outer clean perimeter lane fallback
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
            }
          }
        }
      }
    }

    const effSrcHandle = userRoute?.source_handle ?? autoSourceHandle;
    const effTgtHandle = userRoute?.target_handle ?? autoTargetHandle;
    result[edge.id] = {
      sourceHandle: effSrcHandle,
      targetHandle: effTgtHandle,
      sourcePortOffset: initSrcOffset,
      targetPortOffset: initTgtOffset,
      manualWaypoints,
      autoWaypoints,
      curveOffset,
    };

    if (manualWaypoints.length > 0) {
      recordSegments(
        handlePoint(srcRect, effSrcHandle),
        manualWaypoints,
        handlePoint(tgtRect, effTgtHandle),
        occupiedSegments,
      );
    } else if (autoWaypoints.length > 0) {
      recordSegments(
        shiftHandlePoint(
          handlePoint(srcRect, effSrcHandle),
          effSrcHandle,
          initSrcOffset,
        ),
        autoWaypoints,
        shiftHandlePoint(
          handlePoint(tgtRect, effTgtHandle),
          effTgtHandle,
          initTgtOffset,
        ),
        occupiedSegments,
      );
    } else {
      const approx = approxOrthoPath(srcRect, effSrcHandle, tgtRect, effTgtHandle);
      for (let k = 0; k < approx.length - 1; k++) {
        occupiedSegments.push({ a: approx[k]!, b: approx[k + 1]! });
      }
    }
  }

  // Spread multiple attachments sharing the same side of a node so lines & crow's feet never overlap
  const sideBuckets = new Map<
    string,
    Array<{
      edgeId: string;
      end: "source" | "target";
      sortCoord: number;
      sideLength: number;
      currentOffset: number;
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
      sortCoord: elkPinnedEnd.has(`${edge.id}:source`)
        ? route.sourcePortOffset
        : srcHoriz
          ? tgtRect.cy
          : tgtRect.cx,
      sideLength: srcHoriz ? srcRect.height : srcRect.width,
      currentOffset: route.sourcePortOffset,
    });
    sideBuckets.set(srcKey, srcList);

    const tgtHoriz =
      route.targetHandle === "left" || route.targetHandle === "right";
    const tgtKey = `${edge.target}:${route.targetHandle}`;
    const tgtList = sideBuckets.get(tgtKey) ?? [];
    tgtList.push({
      edgeId: edge.id,
      end: "target",
      sortCoord: elkPinnedEnd.has(`${edge.id}:target`)
        ? route.targetPortOffset
        : tgtHoriz
          ? srcRect.cy
          : srcRect.cx,
      sideLength: tgtHoriz ? tgtRect.height : tgtRect.width,
      currentOffset: route.targetPortOffset,
    });
    sideBuckets.set(tgtKey, tgtList);
  }

  for (const attachments of sideBuckets.values()) {
    if (attachments.length <= 1) continue;
    const allElkPinned = attachments.every((a) =>
      elkPinnedEnd.has(`${a.edgeId}:${a.end}`),
    );
    if (allElkPinned) {
      const sortedOffsets = attachments
        .map((a) => a.currentOffset)
        .sort((a, b) => a - b);
      let wellSpaced = true;
      for (let i = 1; i < sortedOffsets.length; i++) {
        if (Math.abs(sortedOffsets[i]! - sortedOffsets[i - 1]!) < 10) {
          wellSpaced = false;
          break;
        }
      }
      if (wellSpaced) continue;
    }

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

  // Spread shared parallel corridor segments by +-12px and guarantee orthogonal end stubs
  spreadOverlappingCorridorSegments(view.edges, result, rects);
  for (const edge of view.edges) {
    const route = result[edge.id];
    const srcRect = rects.get(edge.source);
    const tgtRect = rects.get(edge.target);
    if (!route || !srcRect || !tgtRect) continue;
    if (route.manualWaypoints.length > 0 || route.autoWaypoints.length === 0) {
      continue;
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
    route.autoWaypoints = alignEndStubsOrthogonally(
      srcPt,
      route.sourceHandle,
      tgtPt,
      route.targetHandle,
      route.autoWaypoints,
    );
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
