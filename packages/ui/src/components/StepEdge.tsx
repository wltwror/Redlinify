import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type Edge,
  type EdgeProps,
} from "@xyflow/react";
import { Lock } from "lucide-react";
import type { DesignEdge } from "@redlinify/shared/browser";

export interface StepEdgeData extends Record<string, unknown> {
  edge: DesignEdge;
  dimmed?: boolean;
}

export type StepFlowEdge = Edge<StepEdgeData, "step">;

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
  markerEnd,
}: EdgeProps<StepFlowEdge>) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 12,
  });

  const designEdge = data?.edge;
  const isDashed = designEdge?.style === "dashed";
  const hasLabel = Boolean(designEdge?.label?.trim()) || designEdge?.step !== undefined || designEdge?.locked;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: selected
            ? "#38bdf8"
            : designEdge?.locked
              ? "#f59e0b"
              : "#64748b",
          strokeWidth: selected ? 2.5 : 1.75,
          strokeDasharray: isDashed ? "6 4" : undefined,
          opacity: data?.dimmed ? 0.2 : 1,
        }}
      />
      {hasLabel && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: "all",
            }}
            className={`nodrag nopan inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] shadow-md transition-opacity ${
              selected
                ? "border-sky-400 bg-slate-900 text-sky-100"
                : "border-slate-700 bg-slate-900/95 text-slate-200"
            } ${data?.dimmed ? "opacity-20" : "opacity-100"}`}
          >
            {designEdge?.step !== undefined && (
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-sky-500 text-[10px] font-bold text-slate-950">
                {designEdge.step}
              </span>
            )}
            {designEdge?.label && (
              <span className="max-w-[160px] truncate">{designEdge.label}</span>
            )}
            {designEdge?.locked && (
              <Lock className="h-2.5 w-2.5 text-amber-400" />
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
