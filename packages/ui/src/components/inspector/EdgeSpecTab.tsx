import { useEffect, useState } from "react";
import { ArrowLeftRight, Lock, Trash2, Unlock } from "lucide-react";
import type {
  Cardinality,
  DesignEdge,
  DesignView,
  EdgeRoute,
  HandleSide,
  RelationKind,
} from "@redlinify/shared/browser";

interface EdgeSpecTabProps {
  activeView: DesignView | null;
  selectedEdge: DesignEdge;
  edgeRoute?: EdgeRoute;
  onSaveEdge: (updated: DesignEdge) => Promise<void>;
  onDeleteEdge: (edgeId: string) => Promise<void>;
  onUpdateEdgeRoute: (edgeId: string, patch: Partial<EdgeRoute> | null) => void;
  onFlipEdge: (edgeId: string) => void;
}

export function EdgeSpecTab({
  activeView,
  selectedEdge,
  edgeRoute,
  onSaveEdge,
  onDeleteEdge,
  onUpdateEdgeRoute,
  onFlipEdge,
}: EdgeSpecTabProps) {
  const [edgeDraft, setEdgeDraft] = useState<DesignEdge | null>(selectedEdge);

  useEffect(() => {
    setEdgeDraft(selectedEdge ? structuredClone(selectedEdge) : null);
  }, [selectedEdge]);

  if (!edgeDraft) {
    return null;
  }

  const commitEdge = async (next: DesignEdge) => {
    setEdgeDraft(next);
    await onSaveEdge(next);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
        <div className="flex items-center gap-2 text-xs">
          {edgeDraft.locked ? (
            <Lock className="h-3.5 w-3.5 text-violet-400" />
          ) : (
            <Unlock className="h-3.5 w-3.5 text-slate-400" />
          )}
          <span className="font-medium text-slate-200">
            {edgeDraft.locked ? "Locked Edge" : "Unlocked Edge"}
          </span>
        </div>
        <button
          type="button"
          onClick={() =>
            void commitEdge({
              ...edgeDraft,
              locked: !edgeDraft.locked,
            })
          }
          className={`rounded-md px-2.5 py-1 text-xs font-medium ${
            edgeDraft.locked
              ? "bg-violet-500/20 text-violet-200 border border-violet-500/40 hover:bg-violet-500/30"
              : "border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700"
          }`}
        >
          {edgeDraft.locked ? "Unlock" : "Lock"}
        </button>
      </div>

      <div>
        <label className="block text-[11px] font-medium text-slate-400 mb-1">
          Label
        </label>
        <input
          type="text"
          value={edgeDraft.label ?? ""}
          disabled={Boolean(edgeDraft.locked)}
          onChange={(e) =>
            setEdgeDraft({ ...edgeDraft, label: e.target.value })
          }
          onBlur={() => {
            const cleaned = edgeDraft.label?.trim();
            const next = { ...edgeDraft };
            if (cleaned) next.label = cleaned;
            else delete next.label;
            void commitEdge(next);
          }}
          className="w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-100 disabled:opacity-50 focus:border-sky-500 focus:outline-none"
        />
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <div>
          <label className="block text-[11px] font-medium text-slate-400 mb-1">
            Step #
          </label>
          <input
            type="number"
            min={1}
            value={edgeDraft.step ?? ""}
            disabled={Boolean(edgeDraft.locked)}
            onChange={(e) => {
              const val = e.target.value.trim();
              const next = { ...edgeDraft };
              if (!val) delete next.step;
              else next.step = Number(val);
              setEdgeDraft(next);
            }}
            onBlur={() => void commitEdge(edgeDraft)}
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-100 disabled:opacity-50 focus:border-sky-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-slate-400 mb-1">
            Style
          </label>
          <select
            value={edgeDraft.style ?? "solid"}
            disabled={Boolean(edgeDraft.locked)}
            onChange={(e) =>
              void commitEdge({
                ...edgeDraft,
                style: e.target.value === "dashed" ? "dashed" : "solid",
              })
            }
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 disabled:opacity-50 focus:border-sky-500 focus:outline-none"
          >
            <option value="solid">solid</option>
            <option value="dashed">dashed</option>
          </select>
        </div>
      </div>

      {(activeView?.diagram_type === "er" ||
        edgeDraft.source_cardinality ||
        edgeDraft.target_cardinality ||
        edgeDraft.relation_kind) && (
        <div className="space-y-2.5 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
          <div className="text-xs font-semibold text-emerald-300">
            ER Relationship
          </div>
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Kind</label>
            <select
              value={edgeDraft.relation_kind ?? "association"}
              disabled={Boolean(edgeDraft.locked)}
              onChange={(e) =>
                void commitEdge({
                  ...edgeDraft,
                  relation_kind: e.target.value as RelationKind,
                })
              }
              className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 disabled:opacity-50"
            >
              <option value="association">Association (FK)</option>
              <option value="identifying">Identifying (PK+FK)</option>
              <option value="subtype">Subtype (is-a)</option>
            </select>
          </div>

          {edgeDraft.relation_kind !== "subtype" && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  Source ({edgeDraft.source})
                </label>
                <select
                  value={edgeDraft.source_cardinality ?? "1"}
                  disabled={Boolean(edgeDraft.locked)}
                  onChange={(e) =>
                    void commitEdge({
                      ...edgeDraft,
                      source_cardinality: e.target.value as Cardinality,
                    })
                  }
                  className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 disabled:opacity-50"
                >
                  <option value="1">1 (mandatory)</option>
                  <option value="0..1">0..1 (optional)</option>
                  <option value="1..*">1..* (many mand.)</option>
                  <option value="0..*">0..* (many opt.)</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  Target ({edgeDraft.target})
                </label>
                <select
                  value={edgeDraft.target_cardinality ?? "0..*"}
                  disabled={Boolean(edgeDraft.locked)}
                  onChange={(e) =>
                    void commitEdge({
                      ...edgeDraft,
                      target_cardinality: e.target.value as Cardinality,
                    })
                  }
                  className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 disabled:opacity-50"
                >
                  <option value="1">1 (mandatory)</option>
                  <option value="0..1">0..1 (optional)</option>
                  <option value="1..*">1..* (many mand.)</option>
                  <option value="0..*">0..* (many opt.)</option>
                </select>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Edge Routing & Flip */}
      <div className="space-y-2.5 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-200">
            Line Routing
          </span>
          <button
            type="button"
            disabled={Boolean(edgeDraft.locked)}
            onClick={() => onFlipEdge(edgeDraft.id)}
            className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-800 px-2 py-0.5 text-[11px] text-slate-200 hover:bg-slate-700 disabled:opacity-40"
          >
            <ArrowLeftRight className="h-3 w-3" />
            Flip A ↔ B
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">
              Source Side
            </label>
            <select
              value={edgeRoute?.source_handle ?? ""}
              onChange={(e) =>
                onUpdateEdgeRoute(edgeDraft.id, {
                  source_handle: e.target.value
                    ? (e.target.value as HandleSide)
                    : undefined,
                })
              }
              className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100"
            >
              <option value="">Auto</option>
              <option value="top">Top</option>
              <option value="right">Right</option>
              <option value="bottom">Bottom</option>
              <option value="left">Left</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">
              Target Side
            </label>
            <select
              value={edgeRoute?.target_handle ?? ""}
              onChange={(e) =>
                onUpdateEdgeRoute(edgeDraft.id, {
                  target_handle: e.target.value
                    ? (e.target.value as HandleSide)
                    : undefined,
                })
              }
              className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100"
            >
              <option value="">Auto</option>
              <option value="top">Top</option>
              <option value="right">Right</option>
              <option value="bottom">Bottom</option>
              <option value="left">Left</option>
            </select>
          </div>
        </div>

        <div className="flex items-center justify-between text-[11px] text-slate-400">
          <span>
            Bend points: {edgeRoute?.waypoints?.length ?? 0} (or drag on canvas)
          </span>
          <button
            type="button"
            onClick={() => onUpdateEdgeRoute(edgeDraft.id, null)}
            className="text-sky-400 hover:underline"
          >
            Reset Route
          </button>
        </div>
      </div>

      <button
        type="button"
        disabled={Boolean(edgeDraft.locked)}
        onClick={() => void onDeleteEdge(edgeDraft.id)}
        className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-300 hover:bg-rose-500/20 disabled:opacity-40"
      >
        <Trash2 className="h-3.5 w-3.5" />
        {edgeDraft.locked ? "Unlock edge to delete" : "Delete Edge"}
      </button>
    </div>
  );
}
