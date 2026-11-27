import { useEffect, useRef, useState } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  Position,
  getSmoothStepPath,
  useReactFlow,
  type Edge,
  type EdgeProps,
} from "@xyflow/react";
import { Lock } from "lucide-react";
import type {
  Cardinality,
  DesignEdge,
  DiagramType,
  HandleSide,
} from "@redlinify/shared/browser";
import type { Point } from "../layout/routing";
import { OverflowTooltip } from "./OverflowTooltip";

export interface StepEdgeData extends Record<string, unknown> {
  edge: DesignEdge;
  diagramType: DiagramType;
  dimmed?: boolean;
  highlighted?: boolean;
  softDimmed?: boolean;
  sourcePortOffset?: number;
  targetPortOffset?: number;
  manualWaypoints?: Point[];
  autoWaypoints?: Point[];
  curveOffset?: Point;
  onCommitWaypoints?: (
    edgeId: string,
    waypoints: Point[],
    handles?: { source_handle: HandleSide; target_handle: HandleSide },
  ) => void;
}

export type StepFlowEdge = Edge<StepEdgeData, "step">;

function shiftPort(pt: Point, position: Position, offset: number): Point {
  if (!offset) return pt;
  if (position === Position.Left || position === Position.Right) {
    return { x: pt.x, y: pt.y + offset };
  }
  return { x: pt.x + offset, y: pt.y };
}

function longestSegmentMidpoint(pts: Point[]): Point | null {
  if (pts.length < 2) return null;
  // Prefer interior segments if there are at least 4 points (2+ waypoints)
  const startIdx = pts.length >= 4 ? 1 : 0;
  const endIdx = pts.length >= 4 ? pts.length - 2 : pts.length - 1;
  let bestScore = -1;
  let bestMid: Point | null = null;
  for (let i = startIdx; i < endIdx; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const dx = Math.abs(b.x - a.x);
    const dy = Math.abs(b.y - a.y);
    const len = Math.hypot(dx, dy);
    const horizBoost = dx >= dy ? 1.25 : 1;
    const score = len * horizBoost;
    if (score > bestScore) {
      bestScore = score;
      bestMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
  }
  return bestMid;
}

function buildRoundedPolylinePath(points: Point[], radius = 12): string {
  if (points.length < 2) return "";
  if (points.length === 2) {
    return `M ${points[0]!.x} ${points[0]!.y} L ${points[1]!.x} ${points[1]!.y}`;
  }

  let d = `M ${points[0]!.x} ${points[0]!.y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1]!;
    const curr = points[i]!;
    const next = points[i + 1]!;

    const d1x = curr.x - prev.x;
    const d1y = curr.y - prev.y;
    const len1 = Math.hypot(d1x, d1y);

    const d2x = next.x - curr.x;
    const d2y = next.y - curr.y;
    const len2 = Math.hypot(d2x, d2y);

    if (len1 < 1 || len2 < 1) {
      d += ` L ${curr.x} ${curr.y}`;
      continue;
    }

    const r = Math.min(radius, len1 * 0.4, len2 * 0.4);
    const pInX = curr.x - (d1x / len1) * r;
    const pInY = curr.y - (d1y / len1) * r;
    const pOutX = curr.x + (d2x / len2) * r;
    const pOutY = curr.y + (d2y / len2) * r;

    d += ` L ${pInX} ${pInY} Q ${curr.x} ${curr.y} ${pOutX} ${pOutY}`;
  }

  const last = points[points.length - 1]!;
  d += ` L ${last.x} ${last.y}`;
  return d;
}

function getHandleOutwardVector(position: Position): Point {
  switch (position) {
    case Position.Right:
      return { x: 1, y: 0 };
    case Position.Left:
      return { x: -1, y: 0 };
    case Position.Bottom:
      return { x: 0, y: 1 };
    case Position.Top:
      return { x: 0, y: -1 };
  }
}

function positionToHandleSide(position: Position): HandleSide {
  switch (position) {
    case Position.Right:
      return "right";
    case Position.Left:
      return "left";
    case Position.Bottom:
      return "bottom";
    case Position.Top:
      return "top";
  }
}

function normalizeVec(dx: number, dy: number, fallback: Point): Point {
  const len = Math.hypot(dx, dy);
  if (len < 1e-3) return fallback;
  return { x: dx / len, y: dy / len };
}

function isMandatoryCardinality(c?: Cardinality): boolean {
  return c === "1" || c === "1..*";
}

function isOptionalCardinality(c?: Cardinality): boolean {
  return c === "0..1" || c === "0..*";
}

function CrowsFootEnd({
  anchor,
  outward,
  cardinality,
  color,
  strokeWidth,
}: {
  anchor: Point;
  outward: Point;
  cardinality: Cardinality;
  color: string;
  strokeWidth: number;
}) {
  const px = -outward.y;
  const py = outward.x;
  const pt = (d: number, perp: number) => ({
    x: anchor.x + outward.x * d + px * perp,
    y: anchor.y + outward.y * d + py * perp,
  });

  const isMany = cardinality === "1..*" || cardinality === "0..*";
  const isOpt = cardinality === "0..1" || cardinality === "0..*";

  const barDist = isMany ? 14 : 9;
  const b1 = pt(barDist, -6);
  const b2 = pt(barDist, 6);
  const circleCenter = pt(isMany ? 18 : 16, 0);

  const fTop = pt(0, -7);
  const fBot = pt(0, 7);
  const fApex = pt(12, 0);

  return (
    <g pointerEvents="none">
      {isMany ? (
        <>
          <line
            x1={fApex.x}
            y1={fApex.y}
            x2={fTop.x}
            y2={fTop.y}
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
          />
          <line
            x1={fApex.x}
            y1={fApex.y}
            x2={fBot.x}
            y2={fBot.y}
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
          />
        </>
      ) : (
        <line
          x1={b1.x}
          y1={b1.y}
          x2={b2.x}
          y2={b2.y}
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />
      )}

      {!isOpt && isMany && (
        <line
          x1={b1.x}
          y1={b1.y}
          x2={b2.x}
          y2={b2.y}
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />
      )}

      {isOpt && (
        <circle
          cx={circleCenter.x}
          cy={circleCenter.y}
          r={4}
          fill="var(--rl-canvas-bg, #020617)"
          stroke={color}
          strokeWidth={strokeWidth}
        />
      )}
    </g>
  );
}

function SubtypeTriangle({
  anchor,
  outward,
  color,
  strokeWidth,
}: {
  anchor: Point;
  outward: Point;
  color: string;
  strokeWidth: number;
}) {
  const px = -outward.y;
  const py = outward.x;
  const tip = anchor;
  const left = {
    x: anchor.x + outward.x * 13 + px * 7,
    y: anchor.y + outward.y * 13 + py * 7,
  };
  const right = {
    x: anchor.x + outward.x * 13 - px * 7,
    y: anchor.y + outward.y * 13 - py * 7,
  };

  return (
    <polygon
      points={`${tip.x},${tip.y} ${left.x},${left.y} ${right.x},${right.y}`}
      fill="var(--rl-canvas-bg, #020617)"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinejoin="round"
      pointerEvents="none"
    />
  );
}

export function StepEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps<StepFlowEdge>) {
  const { screenToFlowPosition } = useReactFlow();
  const designEdge = data?.edge;
  const diagramType = data?.diagramType ?? "general";
  const isEr =
    diagramType === "er" ||
    Boolean(
      designEdge?.source_cardinality ||
        designEdge?.target_cardinality ||
        designEdge?.relation_kind,
    );

  const srcPt = shiftPort(
    { x: sourceX, y: sourceY },
    sourcePosition,
    data?.sourcePortOffset ?? 0,
  );
  const tgtPt = shiftPort(
    { x: targetX, y: targetY },
    targetPosition,
    data?.targetPortOffset ?? 0,
  );
  const sx = srcPt.x;
  const sy = srcPt.y;
  const tx = tgtPt.x;
  const ty = tgtPt.y;

  const savedManual = data?.manualWaypoints ?? [];
  const savedKey = JSON.stringify(savedManual);
  const [dragWaypoints, setDragWaypoints] = useState<Point[] | null>(null);
  const draggingRef = useRef(false);

  useEffect(() => {
    if (!draggingRef.current) {
      setDragWaypoints(null);
    }
  }, [savedKey]);

  const activeManual = dragWaypoints ?? savedManual;
  const autoWaypoints = data?.autoWaypoints ?? [];
  const curveOffset = data?.curveOffset ?? { x: 0, y: 0 };

  const defaultSourceOutward = getHandleOutwardVector(sourcePosition);
  const defaultTargetOutward = getHandleOutwardVector(targetPosition);
  let sourceOutward: Point = defaultSourceOutward;
  let targetOutward: Point = defaultTargetOutward;

  let edgePath = "";
  let labelX = (sx + tx) / 2;
  let labelY = (sy + ty) / 2;
  let bendKnob: Point = { x: labelX, y: labelY };

  if (activeManual.length > 0) {
    const pts = [{ x: sx, y: sy }, ...activeManual, { x: tx, y: ty }];
    edgePath = buildRoundedPolylinePath(pts, 12);
    const first = activeManual[0]!;
    const last = activeManual[activeManual.length - 1]!;
    sourceOutward = normalizeVec(first.x - sx, first.y - sy, defaultSourceOutward);
    targetOutward = normalizeVec(last.x - tx, last.y - ty, defaultTargetOutward);
    if (activeManual.length >= 2) {
      const midIdx = Math.floor(activeManual.length / 2);
      const a = activeManual[midIdx - 1]!;
      const b = activeManual[midIdx]!;
      bendKnob = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const best = longestSegmentMidpoint(pts) ?? bendKnob;
      labelX = best.x;
      labelY = best.y;
    } else {
      const wp = activeManual[0]!;
      labelX = wp.x;
      labelY = wp.y;
      bendKnob = wp;
    }
  } else if (autoWaypoints.length > 0) {
    const pts = [{ x: sx, y: sy }, ...autoWaypoints, { x: tx, y: ty }];
    edgePath = buildRoundedPolylinePath(pts, 14);
    const first = autoWaypoints[0]!;
    const last = autoWaypoints[autoWaypoints.length - 1]!;
    sourceOutward = normalizeVec(first.x - sx, first.y - sy, defaultSourceOutward);
    targetOutward = normalizeVec(last.x - tx, last.y - ty, defaultTargetOutward);
    if (autoWaypoints.length >= 2) {
      const best = longestSegmentMidpoint(pts);
      if (best) {
        labelX = best.x;
        labelY = best.y;
      } else {
        const a = autoWaypoints[0]!;
        const b = autoWaypoints[1]!;
        labelX = (a.x + b.x) / 2;
        labelY = (a.y + b.y) / 2;
      }
    } else {
      labelX = autoWaypoints[0]!.x;
      labelY = autoWaypoints[0]!.y;
    }
    bendKnob = { x: labelX, y: labelY };
  } else if (curveOffset.x !== 0 || curveOffset.y !== 0) {
    const cx = (sx + tx) / 2 + curveOffset.x;
    const cy = (sy + ty) / 2 + curveOffset.y;
    edgePath = `M ${sx} ${sy} Q ${cx} ${cy} ${tx} ${ty}`;
    sourceOutward = normalizeVec(cx - sx, cy - sy, defaultSourceOutward);
    targetOutward = normalizeVec(cx - tx, cy - ty, defaultTargetOutward);
    labelX = 0.25 * sx + 0.5 * cx + 0.25 * tx;
    labelY = 0.25 * sy + 0.5 * cy + 0.25 * ty;
    bendKnob = { x: labelX, y: labelY };
  } else {
    const [path, lx, ly] = getSmoothStepPath({
      sourceX: sx,
      sourceY: sy,
      sourcePosition,
      targetX: tx,
      targetY: ty,
      targetPosition,
      borderRadius: 12,
    });
    edgePath = path;
    labelX = lx;
    labelY = ly;
    bendKnob = { x: lx, y: ly };
  }

  const startWaypointDrag = (
    e: React.PointerEvent,
    target:
      | { kind: "move"; index: number }
      | { kind: "insert"; index: number; initialPt: Point },
  ) => {
    e.stopPropagation();
    e.preventDefault();
    draggingRef.current = true;

    const initialList =
      target.kind === "insert"
        ? [
            ...activeManual.slice(0, target.index),
            target.initialPt,
            ...activeManual.slice(target.index),
          ]
        : [...activeManual];
    const targetIdx = target.index;
    let latest = initialList;
    if (target.kind === "insert") {
      setDragWaypoints(latest);
    }

    const onMove = (moveEvt: PointerEvent) => {
      const flowPt = screenToFlowPosition({
        x: moveEvt.clientX,
        y: moveEvt.clientY,
      });
      latest = initialList.map((pt, i) =>
        i === targetIdx
          ? { x: Math.round(flowPt.x), y: Math.round(flowPt.y) }
          : pt,
      );
      setDragWaypoints(latest);
    };

    const onUp = () => {
      draggingRef.current = false;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      const handles =
        latest.length > 0
          ? {
              source_handle: positionToHandleSide(sourcePosition),
              target_handle: positionToHandleSide(targetPosition),
            }
          : undefined;
      data?.onCommitWaypoints?.(id, latest, handles);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const isFocused = Boolean(selected || data?.highlighted);
  const strokeColor = isFocused
    ? "var(--rl-edge-selected, #38bdf8)"
    : designEdge?.locked
      ? "var(--rl-edge-locked, #f59e0b)"
      : "var(--rl-edge-default, #64748b)";
  const strokeWidth = selected ? 2.5 : data?.highlighted ? 2.3 : 1.75;
  const markerId = `redlinify-arrow-${id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;

  const srcCard = designEdge?.source_cardinality;
  const tgtCard = designEdge?.target_cardinality;
  const relKind = designEdge?.relation_kind ?? "association";

  const srcOpt = isOptionalCardinality(srcCard);
  const tgtOpt = isOptionalCardinality(tgtCard);
  const srcMand = isMandatoryCardinality(srcCard);
  const tgtMand = isMandatoryCardinality(tgtCard);
  const useSplitDash =
    isEr &&
    relKind === "association" &&
    ((srcMand && tgtOpt) || (srcOpt && tgtMand));
  const fullDashed =
    designEdge?.style === "dashed" ||
    (isEr && relKind === "association" && srcOpt && tgtOpt && !useSplitDash);

  const labelText =
    designEdge?.label?.trim() || (relKind === "subtype" ? "is-a" : "");
  const hasLabel =
    Boolean(labelText) ||
    designEdge?.step !== undefined ||
    Boolean(designEdge?.locked);

  const opacity = data?.dimmed
    ? 0.2
    : data?.softDimmed && !isFocused
      ? 0.35
      : 1;
  const renderedLabelY =
    selected && activeManual.length === 1 ? labelY - 22 : labelY;

  const splitHandles: Array<{ index: number; mid: Point }> = [];
  if (selected && activeManual.length >= 1) {
    const polyPts = [{ x: sx, y: sy }, ...activeManual, { x: tx, y: ty }];
    for (let i = 0; i < polyPts.length - 1; i++) {
      const a = polyPts[i]!;
      const b = polyPts[i + 1]!;
      if (Math.hypot(b.x - a.x, b.y - a.y) < 72) continue;
      const mid = {
        x: Math.round((a.x + b.x) / 2),
        y: Math.round((a.y + b.y) / 2),
      };
      if (
        hasLabel &&
        Math.hypot(mid.x - labelX, mid.y - renderedLabelY) < 22
      ) {
        continue;
      }
      splitHandles.push({ index: i, mid });
    }
  }

  return (
    <>
      {!isEr && (
        <defs>
          <marker
            id={markerId}
            viewBox="-10 -10 20 20"
            refX="0"
            refY="0"
            markerWidth="12.5"
            markerHeight="12.5"
            orient="auto-start-reverse"
          >
            <polyline
              stroke={strokeColor}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1"
              fill={strokeColor}
              points="-5,-4 0,0 -5,4 -5,-4"
            />
          </marker>
        </defs>
      )}

      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        className="react-flow__edge-interaction"
      />

      <path
        d={edgePath}
        fill="none"
        pointerEvents="none"
        style={{
          stroke: "var(--rl-canvas-bg, #020617)",
          strokeWidth: strokeWidth + 4,
          strokeLinecap: "round",
          strokeLinejoin: "round",
          opacity: data?.dimmed || (data?.softDimmed && !isFocused) ? 0 : 0.92,
        }}
      />

      {useSplitDash ? (
        <g style={{ opacity }}>
          <path
            d={edgePath}
            fill="none"
            className="react-flow__edge-path"
            style={{
              stroke: strokeColor,
              strokeWidth,
              strokeDasharray: "6 4",
            }}
          />
          <path
            d={edgePath}
            fill="none"
            pathLength={100}
            style={{
              stroke: strokeColor,
              strokeWidth,
              strokeDasharray: "50 100",
              strokeDashoffset: srcMand ? 0 : -50,
            }}
            pointerEvents="none"
          />
        </g>
      ) : (
        <BaseEdge
          id={id}
          path={edgePath}
          markerEnd={isEr ? undefined : `url(#${markerId})`}
          style={{
            stroke: strokeColor,
            strokeWidth,
            strokeDasharray: fullDashed ? "6 4" : undefined,
            opacity,
          }}
        />
      )}

      {/* ER End Symbols (Crow's foot / Subtype triangle) */}
      {isEr && relKind === "subtype" && (
        <g style={{ opacity }}>
          <SubtypeTriangle
            anchor={{ x: tx, y: ty }}
            outward={targetOutward}
            color={strokeColor}
            strokeWidth={strokeWidth}
          />
        </g>
      )}
      {isEr && relKind !== "subtype" && (srcCard || tgtCard) && (
        <g style={{ opacity }}>
          {srcCard && (
            <CrowsFootEnd
              anchor={{ x: sx, y: sy }}
              outward={sourceOutward}
              cardinality={srcCard}
              color={strokeColor}
              strokeWidth={strokeWidth}
            />
          )}
          {tgtCard && (
            <CrowsFootEnd
              anchor={{ x: tx, y: ty }}
              outward={targetOutward}
              cardinality={tgtCard}
              color={strokeColor}
              strokeWidth={strokeWidth}
            />
          )}
        </g>
      )}

      {/* HTML layer for labels AND reliable draggable bend handles */}
      <EdgeLabelRenderer>
        {hasLabel && (
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${renderedLabelY}px)`,
              pointerEvents: "all",
              zIndex: selected ? 40 : data?.highlighted ? 25 : 10,
            }}
            className={`nodrag nopan inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] shadow-md transition-opacity ${
              isFocused
                ? "border-sky-400 bg-slate-900 text-sky-100"
                : "border-slate-700 bg-slate-900/95 text-slate-200"
            } ${
              data?.dimmed
                ? "opacity-20"
                : data?.softDimmed && !isFocused
                  ? "opacity-40"
                  : "opacity-100"
            }`}
          >
            {designEdge?.step !== undefined && (
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-sky-500 text-[10px] font-bold text-slate-950">
                {designEdge.step}
              </span>
            )}
            {labelText && (
              <OverflowTooltip
                text={labelText}
                className="inline-flex min-w-0 max-w-[160px]"
              >
                <span className="max-w-[160px] truncate">{labelText}</span>
              </OverflowTooltip>
            )}
            {designEdge?.locked && (
              <Lock className="h-2.5 w-2.5 text-violet-400" />
            )}
          </div>
        )}

        {selected &&
          splitHandles.map((sh) => (
            <div
              key={`split-${sh.index}`}
              style={{
                position: "absolute",
                transform: `translate(-50%, -50%) translate(${sh.mid.x}px,${sh.mid.y}px)`,
                pointerEvents: "all",
                zIndex: 45,
              }}
              title="Drag to add bend point on this segment"
              className="nodrag nopan h-3 w-3 rounded-full border-2 border-sky-400/80 bg-slate-950/90 opacity-65 hover:opacity-100 hover:scale-125 shadow-sm cursor-grab active:cursor-grabbing transition-all"
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onPointerDown={(e) =>
                startWaypointDrag(e, {
                  kind: "insert",
                  index: sh.index,
                  initialPt: sh.mid,
                })
              }
            />
          ))}

        {selected &&
          activeManual.map((pt, idx) => (
            <div
              key={`wp-${idx}`}
              style={{
                position: "absolute",
                transform: `translate(-50%, -50%) translate(${pt.x}px,${pt.y}px)`,
                pointerEvents: "all",
                zIndex: 50,
              }}
              title="Drag to move bend point • Double-click to remove"
              className="nodrag nopan h-4 w-4 rounded-full border-2 border-slate-950 bg-sky-400 shadow-md cursor-grab active:cursor-grabbing hover:scale-125 transition-transform"
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onPointerDown={(e) =>
                startWaypointDrag(e, { kind: "move", index: idx })
              }
              onDoubleClick={(e) => {
                e.stopPropagation();
                const next = activeManual.filter((_, i) => i !== idx);
                setDragWaypoints(next);
                data?.onCommitWaypoints?.(
                  id,
                  next,
                  next.length > 0
                    ? {
                        source_handle: positionToHandleSide(sourcePosition),
                        target_handle: positionToHandleSide(targetPosition),
                      }
                    : undefined,
                );
              }}
            />
          ))}

        {selected && activeManual.length === 0 && (
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${bendKnob.x}px,${hasLabel ? bendKnob.y + 20 : bendKnob.y}px)`,
              pointerEvents: "all",
              zIndex: 50,
            }}
            title="Drag to manually bend this line"
            className="nodrag nopan h-4 w-4 rounded-full border-2 border-sky-400 bg-slate-950 shadow-md cursor-grab active:cursor-grabbing hover:scale-125 transition-transform"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) =>
              startWaypointDrag(e, {
                kind: "insert",
                index: 0,
                initialPt: {
                  x: Math.round(bendKnob.x),
                  y: Math.round(bendKnob.y),
                },
              })
            }
          />
        )}
      </EdgeLabelRenderer>
    </>
  );
}
