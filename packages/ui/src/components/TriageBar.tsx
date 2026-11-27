import { useEffect, useRef, useState } from "react";
import {
  Bell,
  CheckCircle2,
  ChevronDown,
  Copy,
  Download,
  FileCode2,
  FileImage,
  FileJson,
  Sparkles,
  WifiOff,
} from "lucide-react";
import type { ExportFormat } from "../utils/exportDiagram";
import type { WorkspaceDrawerTab } from "./inspector/types";

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
  onExport: (format: ExportFormat) => void;
  openQuestionsCount: number;
  pendingAgentCount: number;
  decisionsCount: number;
  activeWorkspaceTab?: WorkspaceDrawerTab | null;
  onOpenQuestions: () => void;
  onOpenPendingReview: () => void;
  onOpenDecisions: () => void;
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
  onExport,
  openQuestionsCount,
  pendingAgentCount,
  decisionsCount,
  activeWorkspaceTab,
  onOpenQuestions,
  onOpenPendingReview,
  onOpenDecisions,
  showOfflineWarning,
}: TriageBarProps) {
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!exportOpen) return;
    const onDown = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setExportOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExportOpen(false);
    };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [exportOpen]);

  const handleExportChoice = (format: ExportFormat) => {
    setExportOpen(false);
    onExport(format);
  };

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

      <div className="flex items-center gap-2 flex-wrap">
        <div
          role="group"
          aria-label="Agent review drawers"
          className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-950/50 p-0.5"
        >
          <button
            type="button"
            onClick={onOpenQuestions}
            aria-pressed={activeWorkspaceTab === "questions"}
            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
              activeWorkspaceTab === "questions"
                ? "bg-amber-500/25 text-amber-100 ring-1 ring-amber-400/60"
                : openQuestionsCount > 0
                  ? "bg-amber-500/15 text-amber-200 hover:bg-amber-500/25"
                  : "text-slate-300 hover:bg-slate-800"
            }`}
          >
            <Bell className="h-3 w-3 text-amber-400" />
            <span>Questions</span>
            <span className="rounded bg-slate-900/80 px-1 text-[10px] font-mono">
              {openQuestionsCount}
            </span>
          </button>

          <button
            type="button"
            onClick={onOpenPendingReview}
            aria-pressed={activeWorkspaceTab === "pending"}
            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
              activeWorkspaceTab === "pending"
                ? "bg-sky-500/25 text-sky-100 ring-1 ring-sky-400/60"
                : pendingAgentCount > 0
                  ? "bg-sky-500/15 text-sky-200 hover:bg-sky-500/25"
                  : "text-slate-300 hover:bg-slate-800"
            }`}
          >
            <Sparkles className="h-3 w-3 text-sky-400" />
            <span className="hidden sm:inline">Pending Review</span>
            <span className="sm:hidden">Review</span>
            <span className="rounded bg-slate-900/80 px-1 text-[10px] font-mono">
              {pendingAgentCount}
            </span>
          </button>

          <button
            type="button"
            onClick={onOpenDecisions}
            aria-pressed={activeWorkspaceTab === "adrs"}
            title="View resolved design decisions (ADRs) & project threads"
            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
              activeWorkspaceTab === "adrs"
                ? "bg-emerald-500/25 text-emerald-100 ring-1 ring-emerald-400/60"
                : decisionsCount > 0
                  ? "bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25"
                  : "text-slate-300 hover:bg-slate-800"
            }`}
          >
            <CheckCircle2 className="h-3 w-3 text-emerald-400" />
            <span>Decisions</span>
            <span className="rounded bg-slate-900/80 px-1 text-[10px] font-mono">
              {decisionsCount}
            </span>
          </button>
        </div>

        {hasActiveView && (
          <>
            <div className="hidden sm:block h-4 w-px bg-slate-800" />

            <div ref={exportRef} className="relative">
              <button
                type="button"
                onClick={() => setExportOpen((v) => !v)}
                aria-label="Export diagram"
                aria-expanded={exportOpen}
                title="Export active diagram as PNG, SVG, Mermaid, or JSON"
                className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800/70 px-2.5 py-1 text-[11px] font-medium text-slate-300 hover:bg-slate-700 transition-colors"
              >
                <Download className="h-3 w-3 text-sky-400" />
                <span className="hidden sm:inline">Export</span>
                <ChevronDown className="h-3 w-3 text-slate-400" />
              </button>

              {exportOpen && (
                <div
                  role="menu"
                  className="absolute right-0 top-full z-40 mt-1.5 min-w-[200px] rounded-xl border border-slate-700 bg-slate-900/95 p-1.5 shadow-2xl backdrop-blur-md"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => handleExportChoice("png")}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-slate-200 hover:bg-slate-800 hover:text-slate-50"
                  >
                    <FileImage className="h-3.5 w-3.5 text-sky-400" />
                    <span>Export PNG (2× HD)</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => handleExportChoice("svg")}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-slate-200 hover:bg-slate-800 hover:text-slate-50"
                  >
                    <FileImage className="h-3.5 w-3.5 text-emerald-400" />
                    <span>Export SVG (Vector)</span>
                  </button>
                  <div className="my-1 border-t border-slate-800" />
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => handleExportChoice("mermaid")}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-slate-200 hover:bg-slate-800 hover:text-slate-50"
                  >
                    <FileCode2 className="h-3.5 w-3.5 text-violet-400" />
                    <span>Export Mermaid (.mmd)</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => handleExportChoice("copy_mermaid")}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-slate-200 hover:bg-slate-800 hover:text-slate-50"
                  >
                    <Copy className="h-3.5 w-3.5 text-slate-400" />
                    <span>Copy Mermaid</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => handleExportChoice("json")}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-slate-200 hover:bg-slate-800 hover:text-slate-50"
                  >
                    <FileJson className="h-3.5 w-3.5 text-amber-400" />
                    <span>Export JSON (.json)</span>
                  </button>
                </div>
              )}
            </div>
          </>
        )}

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
