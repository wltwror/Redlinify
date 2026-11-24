import {
  ArrowDownUp,
  Bell,
  LayoutGrid,
  Plus,
  Redo2,
  Sparkles,
  Undo2,
  WifiOff,
} from "lucide-react";
import type { DiagramType, ViewDirection } from "@redlinify/shared/browser";

export type TriageFilter =
  | "all"
  | "waiting_on_me"
  | "my_edits"
  | "locked"
  | "drifted";

interface TriageBarProps {
  filter: TriageFilter;
  onChangeFilter: (next: TriageFilter) => void;
  hasActiveView: boolean;
  diagramType: DiagramType;
  direction: ViewDirection;
  onToggleDirection: () => void;
  onAddBox: () => void;
  onAutoLayout: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  openQuestionsCount: number;
  pendingAgentCount: number;
  onOpenQuestions: () => void;
  onOpenPendingReview: () => void;
  showOfflineWarning: boolean;
}

const FILTER_ITEMS: Array<{ id: TriageFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "waiting_on_me", label: "Waiting on Me" },
  { id: "my_edits", label: "My Edits" },
  { id: "locked", label: "Locked" },
  { id: "drifted", label: "Drifted" },
];

export function TriageBar({
  filter,
  onChangeFilter,
  hasActiveView,
  diagramType,
  direction,
  onToggleDirection,
  onAddBox,
  onAutoLayout,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  openQuestionsCount,
  pendingAgentCount,
  onOpenQuestions,
  onOpenPendingReview,
  showOfflineWarning,
}: TriageBarProps) {
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-slate-900/80 px-3 py-1.5">
      <div className="flex items-center gap-1 overflow-x-auto">
        {FILTER_ITEMS.map((item) => {
          const active = filter === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onChangeFilter(item.id)}
              className={`shrink-0 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                active
                  ? "bg-sky-500/20 text-sky-200 border border-sky-500/40"
                  : "text-slate-400 border border-transparent hover:bg-slate-800 hover:text-slate-200"
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        {hasActiveView && (
          <>
            <button
              type="button"
              onClick={onAddBox}
              className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-slate-100 hover:bg-slate-700 transition-colors"
            >
              <Plus className="h-3 w-3 text-sky-400" />
              {diagramType === "er" ? "Add Entity" : "Add Box"}
            </button>

            <div className="flex items-center rounded-md border border-slate-700 bg-slate-800/70 overflow-hidden">
              <button
                type="button"
                disabled={!canUndo}
                onClick={onUndo}
                title="Undo (Ctrl+Z)"
                aria-label="Undo"
                className="px-1.5 py-1 text-slate-300 hover:bg-slate-700 disabled:opacity-30 disabled:pointer-events-none"
              >
                <Undo2 className="h-3 w-3" />
              </button>
              <div className="h-3.5 w-px bg-slate-700" />
              <button
                type="button"
                disabled={!canRedo}
                onClick={onRedo}
                title="Redo (Ctrl+Shift+Z)"
                aria-label="Redo"
                className="px-1.5 py-1 text-slate-300 hover:bg-slate-700 disabled:opacity-30 disabled:pointer-events-none"
              >
                <Redo2 className="h-3 w-3" />
              </button>
            </div>

            <button
              type="button"
              onClick={onToggleDirection}
              title="Toggle diagram flow direction (TB / LR)"
              className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800/70 px-2 py-1 text-[11px] font-mono text-slate-300 hover:bg-slate-700 transition-colors"
            >
              <ArrowDownUp className="h-3 w-3 text-slate-400" />
              {direction}
            </button>

            <button
              type="button"
              onClick={onAutoLayout}
              title="Reset manual positions & routes and run ELK auto-layout"
              className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800/70 px-2 py-1 text-[11px] font-medium text-slate-300 hover:bg-slate-700 transition-colors"
            >
              <LayoutGrid className="h-3 w-3 text-slate-400" />
              <span className="hidden sm:inline">Auto-Layout</span>
            </button>
          </>
        )}

        <button
          type="button"
          onClick={onOpenQuestions}
          className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${
            openQuestionsCount > 0
              ? "border-amber-500/40 bg-amber-500/15 text-amber-200 hover:bg-amber-500/25"
              : "border-slate-700 bg-slate-800/70 text-slate-300 hover:bg-slate-700"
          }`}
        >
          <Bell className="h-3 w-3" />
          <span>Questions</span>
          <span className="rounded bg-slate-950/60 px-1 text-[10px] font-mono">
            {openQuestionsCount}
          </span>
        </button>

        <button
          type="button"
          onClick={onOpenPendingReview}
          className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${
            pendingAgentCount > 0
              ? "border-sky-500/40 bg-sky-500/15 text-sky-200 hover:bg-sky-500/25"
              : "border-slate-700 bg-slate-800/70 text-slate-300 hover:bg-slate-700"
          }`}
        >
          <Sparkles className="h-3 w-3" />
          <span className="hidden sm:inline">Pending Review</span>
          <span className="sm:hidden">Review</span>
          <span className="rounded bg-slate-950/60 px-1 text-[10px] font-mono">
            {pendingAgentCount}
          </span>
        </button>

        {showOfflineWarning && (
          <span
            title="Live file sync disconnected — reconnecting automatically..."
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium border border-amber-500/40 bg-amber-500/15 text-amber-200"
          >
            <WifiOff className="h-2.5 w-2.5" />
            <span>Offline — reconnecting</span>
          </span>
        )}
      </div>
    </div>
  );
}
