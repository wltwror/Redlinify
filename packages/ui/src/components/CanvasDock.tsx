import { ArrowDownUp, LayoutGrid, Plus, Redo2, Undo2 } from "lucide-react";
import type { DiagramType, ViewDirection } from "@redlinify/shared/browser";

interface CanvasDockProps {
  diagramType: DiagramType;
  direction: ViewDirection;
  canUndo: boolean;
  canRedo: boolean;
  onAddBox: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onToggleDirection: () => void;
  onAutoLayout: () => void;
}

export function CanvasDock({
  diagramType,
  direction,
  canUndo,
  canRedo,
  onAddBox,
  onUndo,
  onRedo,
  onToggleDirection,
  onAutoLayout,
}: CanvasDockProps) {
  const addLabel = diagramType === "er" ? "Add Entity" : "Add Box";

  return (
    <div
      role="toolbar"
      aria-label="Canvas actions"
      className="nowheel absolute top-3 left-1/2 z-20 -translate-x-1/2 sm:top-auto sm:bottom-[15px] flex items-center gap-1 rounded-xl border border-slate-700 bg-slate-900/95 p-1 shadow-xl backdrop-blur-sm"
    >
      <button
        type="button"
        onClick={onAddBox}
        aria-label={addLabel}
        title={`${addLabel} (or right-click canvas)`}
        className="flex h-7 w-7 items-center justify-center rounded-lg text-sky-400 hover:bg-slate-800 hover:text-sky-300 transition-colors"
      >
        <Plus className="h-4 w-4" />
      </button>

      <div className="mx-0.5 h-4 w-px bg-slate-700/80" />

      <button
        type="button"
        disabled={!canUndo}
        onClick={onUndo}
        title="Undo (Ctrl+Z)"
        aria-label="Undo"
        className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-300 hover:bg-slate-800 hover:text-slate-100 disabled:opacity-30 disabled:pointer-events-none transition-colors"
      >
        <Undo2 className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        disabled={!canRedo}
        onClick={onRedo}
        title="Redo (Ctrl+Shift+Z)"
        aria-label="Redo"
        className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-300 hover:bg-slate-800 hover:text-slate-100 disabled:opacity-30 disabled:pointer-events-none transition-colors"
      >
        <Redo2 className="h-3.5 w-3.5" />
      </button>

      <div className="mx-0.5 h-4 w-px bg-slate-700/80" />

      <button
        type="button"
        onClick={onToggleDirection}
        title="Toggle diagram flow direction (TB / LR)"
        aria-label={`Toggle layout direction (${direction})`}
        className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] font-mono text-slate-300 hover:bg-slate-800 hover:text-slate-100 transition-colors"
      >
        <ArrowDownUp className="h-3.5 w-3.5 text-slate-400" />
        <span>{direction}</span>
      </button>

      <button
        type="button"
        onClick={onAutoLayout}
        title="Reset manual positions & routes and run ELK auto-layout"
        aria-label="Auto-Layout"
        className="inline-flex h-7 items-center gap-1.5 rounded-lg px-2 text-[11px] font-medium text-slate-300 hover:bg-slate-800 hover:text-slate-100 transition-colors"
      >
        <LayoutGrid className="h-3.5 w-3.5 text-slate-400" />
        <span className="hidden md:inline">Auto-Layout</span>
      </button>
    </div>
  );
}
