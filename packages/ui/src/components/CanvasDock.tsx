import { useEffect, useRef, useState } from "react";
import {
  ArrowDownUp,
  ChevronDown,
  Database,
  Diamond,
  LayoutGrid,
  Plus,
  RectangleHorizontal,
  Redo2,
  Square,
  Undo2,
} from "lucide-react";
import type {
  DiagramType,
  NodeShape,
  ViewDirection,
} from "@redlinify/shared/browser";
import { NODE_SHAPE_OPTIONS } from "../layout/elk";

interface CanvasDockProps {
  diagramType: DiagramType;
  direction: ViewDirection;
  canUndo: boolean;
  canRedo: boolean;
  onAddBox: (shape?: NodeShape) => void;
  onUndo: () => void;
  onRedo: () => void;
  onToggleDirection: () => void;
  onAutoLayout: () => void;
}

function ShapeMenuIcon({ shape }: { shape: NodeShape }) {
  switch (shape) {
    case "decision":
      return <Diamond className="h-3.5 w-3.5 text-sky-400 shrink-0" />;
    case "terminal":
      return <RectangleHorizontal className="h-3.5 w-3.5 text-emerald-400 shrink-0" />;
    case "store":
      return <Database className="h-3.5 w-3.5 text-violet-400 shrink-0" />;
    case "card":
    default:
      return <Square className="h-3.5 w-3.5 text-slate-300 shrink-0" />;
  }
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
  const [shapeMenuOpen, setShapeMenuOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const isEr = diagramType === "er";
  const addLabel = isEr ? "Add Entity" : "Add Box";

  useEffect(() => {
    if (!shapeMenuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShapeMenuOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShapeMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [shapeMenuOpen]);

  return (
    <div
      role="toolbar"
      aria-label="Canvas actions"
      className="nowheel absolute top-3 left-1/2 z-20 -translate-x-1/2 sm:top-auto sm:bottom-[15px] flex items-center gap-1 rounded-xl border border-slate-700 bg-slate-900/95 p-1 shadow-xl backdrop-blur-sm"
    >
      {isEr ? (
        <button
          type="button"
          onClick={() => onAddBox()}
          aria-label={addLabel}
          title={`${addLabel} (or right-click canvas)`}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-sky-400 hover:bg-slate-800 hover:text-sky-300 transition-colors"
        >
          <Plus className="h-4 w-4" />
        </button>
      ) : (
        <div ref={pickerRef} className="relative flex items-center">
          <div className="flex items-center rounded-lg overflow-hidden">
            <button
              type="button"
              onClick={() => {
                setShapeMenuOpen(false);
                onAddBox("card");
              }}
              aria-label={addLabel}
              title="Add Box (or right-click canvas)"
              className="flex h-7 w-7 items-center justify-center text-sky-400 hover:bg-slate-800 hover:text-sky-300 transition-colors"
            >
              <Plus className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setShapeMenuOpen((v) => !v)}
              aria-label="Add shape menu"
              aria-haspopup="menu"
              aria-expanded={shapeMenuOpen}
              title="Choose node shape to add"
              className="flex h-7 w-5 items-center justify-center border-l border-slate-700/70 text-slate-400 hover:bg-slate-800 hover:text-slate-100 transition-colors"
            >
              <ChevronDown className="h-3 w-3" />
            </button>
          </div>

          {shapeMenuOpen && (
            <div
              role="menu"
              aria-label="Add node shape"
              className="absolute top-full left-0 mt-2 sm:top-auto sm:bottom-full sm:mt-0 sm:mb-2 w-48 rounded-xl border border-slate-700 bg-slate-900/98 p-1 shadow-2xl backdrop-blur-md"
            >
              {NODE_SHAPE_OPTIONS.map((opt) => (
                <button
                  key={opt.shape}
                  type="button"
                  role="menuitem"
                  title={opt.hint}
                  onClick={() => {
                    setShapeMenuOpen(false);
                    onAddBox(opt.shape);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-slate-200 hover:bg-slate-800 transition-colors"
                >
                  <ShapeMenuIcon shape={opt.shape} />
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

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
