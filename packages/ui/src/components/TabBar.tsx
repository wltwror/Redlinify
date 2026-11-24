import { useState } from "react";
import {
  AlertTriangle,
  Clock,
  Database,
  Layers,
  Moon,
  MoreVertical,
  Plus,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import type {
  DiagramType,
  ViewDirection,
  ViewRequest,
} from "@redlinify/shared/browser";
import type { TabStatusSummary } from "../api/client";
import { ContextMenu } from "./ContextMenu";

interface TabBarProps {
  projectName: string;
  tabs: TabStatusSummary[];
  viewRequests: ViewRequest[];
  activeViewId: string | null;
  onSelectView: (viewId: string) => void;
  onReorderTabs: (nextTabs: TabStatusSummary[]) => void;
  onDeleteRequest: (requestId: string) => void;
  onRequestView: (input: { title: string; prompt: string }) => Promise<void>;
  onCreateBlankView: (input: {
    title: string;
    diagram_type: DiagramType;
    direction: ViewDirection;
  }) => Promise<void>;
  onDeleteView: (viewId: string) => Promise<void>;
  theme: "dark" | "light";
  onToggleTheme: () => void;
}

export function TabBar({
  projectName,
  tabs,
  viewRequests,
  activeViewId,
  onSelectView,
  onReorderTabs,
  onDeleteRequest,
  onRequestView,
  onCreateBlankView,
  onDeleteView,
  theme,
  onToggleTheme,
}: TabBarProps) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [mode, setMode] = useState<"request" | "blank">("blank");
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [diagramType, setDiagramType] = useState<DiagramType>("general");
  const [direction, setDirection] = useState<ViewDirection>("TB");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [tabMenu, setTabMenu] = useState<{
    x: number;
    y: number;
    tab: TabStatusSummary;
  } | null>(null);
  const [confirmDeleteTab, setConfirmDeleteTab] =
    useState<TabStatusSummary | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);

  const handleDrop = (targetViewId: string) => {
    if (!draggedId || draggedId === targetViewId) {
      setDraggedId(null);
      return;
    }
    const fromIdx = tabs.findIndex((t) => t.view_id === draggedId);
    const toIdx = tabs.findIndex((t) => t.view_id === targetViewId);
    setDraggedId(null);
    if (fromIdx === -1 || toIdx === -1) return;

    const reordered = [...tabs];
    const [moved] = reordered.splice(fromIdx, 1);
    if (!moved) return;
    reordered.splice(toIdx, 0, moved);
    onReorderTabs(reordered.map((t, idx) => ({ ...t, order: idx })));
  };

  const resetModal = () => {
    setModalOpen(false);
    setTitle("");
    setPrompt("");
    setDiagramType("general");
    setDirection("TB");
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    if (mode === "request" && !prompt.trim()) {
      setError("Prompt is required to request a view from the agent.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      if (mode === "request") {
        const finalPrompt =
          diagramType === "er"
            ? `[ER Diagram] ${prompt.trim()}`
            : prompt.trim();
        await onRequestView({ title: title.trim(), prompt: finalPrompt });
      } else {
        await onCreateBlankView({
          title: title.trim(),
          diagram_type: diagramType,
          direction,
        });
      }
      resetModal();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create view");
    } finally {
      setSubmitting(false);
    }
  };

  const canConfirmDelete =
    confirmDeleteTab !== null &&
    (confirmText.trim() === confirmDeleteTab.title ||
      confirmText.trim() === confirmDeleteTab.view_id);

  const handleConfirmDelete = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!confirmDeleteTab || !canConfirmDelete) return;
    setDeleting(true);
    try {
      await onDeleteView(confirmDeleteTab.view_id);
      setConfirmDeleteTab(null);
      setConfirmText("");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-slate-800 bg-slate-900 px-3 overflow-x-auto">
        <div className="flex shrink-0 items-center gap-2 pr-2 border-r border-slate-800">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-amber-500/15 text-amber-400 border border-amber-500/30">
            <Layers className="h-3.5 w-3.5" />
          </div>
          <span className="text-xs font-semibold tracking-wide text-slate-100">
            Redlinify
          </span>
          <span className="hidden sm:inline-block rounded bg-slate-800 px-1.5 py-0.5 text-[11px] font-mono text-slate-400">
            {projectName}
          </span>
        </div>

        <nav className="flex items-center gap-1 min-w-0">
          {tabs.map((tab) => {
            const active = tab.view_id === activeViewId;
            const hasBlueDot = tab.has_human_edits || tab.waiting_on_agent > 0;
            const hasRedDot = tab.drifted_count > 0;
            const isEr = tab.diagram_type === "er";

            return (
              <div
                key={tab.view_id}
                draggable
                onDragStart={() => setDraggedId(tab.view_id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => handleDrop(tab.view_id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setTabMenu({ x: e.clientX, y: e.clientY, tab });
                }}
                className={`group flex shrink-0 items-center gap-1 rounded-t-md border-b-2 transition-colors ${
                  active
                    ? "bg-slate-950 text-slate-50 border-sky-400"
                    : "bg-slate-900/40 text-slate-400 border-transparent hover:bg-slate-800/70 hover:text-slate-200"
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelectView(tab.view_id)}
                  title={`${tab.description ?? tab.title} (Right-click for options)`}
                  className="flex items-center gap-1.5 pl-3 pr-1.5 py-1.5 text-xs font-medium"
                >
                  {isEr && (
                    <Database className="h-3 w-3 shrink-0 text-emerald-400" />
                  )}
                  <span className="truncate max-w-[160px]">{tab.title}</span>

                  {tab.waiting_on_human > 0 && (
                    <span
                      title={`${tab.waiting_on_human} open thread(s) waiting on you`}
                      className="inline-flex items-center justify-center rounded-full bg-amber-500/20 px-1.5 py-0.2 text-[10px] font-semibold text-amber-300 border border-amber-500/40"
                    >
                      {tab.waiting_on_human}
                    </span>
                  )}

                  {hasBlueDot && (
                    <span
                      title="Unsynced local edits or replies waiting on agent"
                      className="h-2 w-2 rounded-full bg-sky-400"
                    />
                  )}

                  {hasRedDot && (
                    <span
                      title={`${tab.drifted_count} drifted node(s)`}
                      className="h-2 w-2 rounded-full bg-rose-500"
                    />
                  )}
                </button>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    const rect = e.currentTarget.getBoundingClientRect();
                    setTabMenu({ x: rect.left, y: rect.bottom + 4, tab });
                  }}
                  className={`mr-1 rounded p-0.5 text-slate-500 hover:bg-slate-800 hover:text-slate-200 transition-opacity ${
                    active ? "opacity-80" : "opacity-0 group-hover:opacity-80"
                  }`}
                  title="Tab options"
                  aria-label={`Tab options for ${tab.title}`}
                >
                  <MoreVertical className="h-3 w-3" />
                </button>
              </div>
            );
          })}

          {viewRequests.map((req) => (
            <div
              key={req.id}
              title={`Pending agent request: ${req.prompt}`}
              className="flex shrink-0 items-center gap-1.5 rounded-md border border-dashed border-slate-700 bg-slate-900/60 px-2.5 py-1 text-xs text-slate-400"
            >
              <Clock className="h-3 w-3 text-amber-400" />
              <span className="max-w-[140px] truncate">{req.title}</span>
              <button
                type="button"
                onClick={() => onDeleteRequest(req.id)}
                className="ml-0.5 rounded p-0.5 text-slate-500 hover:bg-slate-800 hover:text-slate-200"
                aria-label={`Cancel view request ${req.title}`}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}

          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-slate-700 bg-slate-800/80 text-slate-300 hover:bg-slate-700 hover:text-slate-50 transition-colors"
            title="Request or create a new view"
            aria-label="Add or request view"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </nav>

        <div className="ml-auto flex shrink-0 items-center pl-2">
          <button
            type="button"
            onClick={onToggleTheme}
            title={
              theme === "dark" ? "Switch to light theme" : "Switch to dark theme"
            }
            aria-label="Toggle color theme"
            className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-700 bg-slate-800/80 text-slate-300 hover:bg-slate-700 hover:text-slate-50 transition-colors"
          >
            {theme === "dark" ? (
              <Sun className="h-3.5 w-3.5 text-amber-300" />
            ) : (
              <Moon className="h-3.5 w-3.5 text-sky-400" />
            )}
          </button>
        </div>
      </header>

      {tabMenu && (
        <ContextMenu
          x={tabMenu.x}
          y={tabMenu.y}
          header={tabMenu.tab.title}
          onClose={() => setTabMenu(null)}
          items={[
            {
              id: "open",
              label: "Switch to Tab",
              onSelect: () => onSelectView(tabMenu.tab.view_id),
            },
            {
              id: "delete",
              label: "Delete Tab...",
              danger: true,
              dividerBefore: true,
              onSelect: () => {
                setConfirmDeleteTab(tabMenu.tab);
                setConfirmText("");
              },
            },
          ]}
        />
      )}

      {confirmDeleteTab && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-rose-500/40 bg-slate-900 p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="flex items-center gap-2 text-rose-300">
                <AlertTriangle className="h-5 w-5 shrink-0" />
                <h2 className="text-sm font-semibold">Delete Tab Permanently</h2>
              </div>
              <button
                type="button"
                onClick={() => setConfirmDeleteTab(null)}
                className="rounded p-1 text-slate-400 hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed mb-3">
              This will permanently remove{" "}
              <code className="font-mono text-rose-200">
                .design/views/{confirmDeleteTab.view_id}.json
              </code>{" "}
              and its local layout/checkpoint. Resolved ADR threads stay archived
              in <code className="font-mono text-slate-400">.design/threads/</code>.
            </p>

            <form onSubmit={handleConfirmDelete} className="space-y-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  Type{" "}
                  <span className="font-semibold text-slate-100 select-all">
                    {confirmDeleteTab.title}
                  </span>{" "}
                  (or{" "}
                  <code className="font-mono text-slate-200 select-all">
                    {confirmDeleteTab.view_id}
                  </code>
                  ) to confirm:
                </label>
                <input
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder={confirmDeleteTab.title}
                  autoFocus
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-600 focus:border-rose-500 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmDeleteTab(null)}
                  className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!canConfirmDelete || deleting}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {deleting ? "Deleting..." : "Delete Tab"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-slate-100">
                Add Design View
              </h2>
              <button
                type="button"
                onClick={resetModal}
                className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 mb-4">
              <button
                type="button"
                onClick={() => setMode("blank")}
                className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                  mode === "blank"
                    ? "border-sky-500 bg-sky-500/15 text-sky-200"
                    : "border-slate-700 bg-slate-800/50 text-slate-400 hover:text-slate-200"
                }`}
              >
                Create Blank View
              </button>
              <button
                type="button"
                onClick={() => setMode("request")}
                className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                  mode === "request"
                    ? "border-sky-500 bg-sky-500/15 text-sky-200"
                    : "border-slate-700 bg-slate-800/50 text-slate-400 hover:text-slate-200"
                }`}
              >
                Request View from Agent
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Diagram Type
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setDiagramType("general")}
                    className={`rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                      diagramType === "general"
                        ? "border-sky-500 bg-sky-500/15 text-sky-100"
                        : "border-slate-700 bg-slate-950 text-slate-400"
                    }`}
                  >
                    <div className="font-semibold">General Diagram</div>
                    <div className="text-[10px] text-slate-400">
                      Classes, flows, architecture
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDiagramType("er");
                      setDirection("LR");
                    }}
                    className={`rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                      diagramType === "er"
                        ? "border-emerald-500 bg-emerald-500/15 text-emerald-100"
                        : "border-slate-700 bg-slate-950 text-slate-400"
                    }`}
                  >
                    <div className="flex items-center gap-1 font-semibold">
                      <Database className="h-3 w-3 text-emerald-400" />
                      ER Diagram
                    </div>
                    <div className="text-[10px] text-slate-400">
                      Entities, PK/FK/null, crow&apos;s foot
                    </div>
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Tab Title
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={
                    diagramType === "er"
                      ? "e.g. Database Schema"
                      : mode === "request"
                        ? "e.g. Dataflow"
                        : "e.g. Scratchpad"
                  }
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
                  autoFocus
                />
              </div>

              {mode === "request" ? (
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Prompt for Coding Agent
                  </label>
                  <textarea
                    rows={3}
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder={
                      diagramType === "er"
                        ? "Model tables, foreign keys, and cardinalities for orders & billing"
                        : "Show event ingestion, caching, and deduplication stages"
                    }
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
                  />
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Layout Direction
                  </label>
                  <div className="flex gap-2">
                    {(["TB", "LR"] as const).map((dir) => (
                      <button
                        key={dir}
                        type="button"
                        onClick={() => setDirection(dir)}
                        className={`flex-1 rounded-lg border px-3 py-1.5 text-xs font-medium ${
                          direction === dir
                            ? "border-sky-500 bg-sky-500/15 text-sky-200"
                            : "border-slate-700 bg-slate-950 text-slate-400"
                        }`}
                      >
                        {dir === "TB"
                          ? "Top → Bottom (TB)"
                          : "Left → Right (LR)"}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {error && (
                <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/30 rounded-md px-2.5 py-1.5">
                  {error}
                </p>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={resetModal}
                  className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg bg-sky-500 px-3.5 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-50"
                >
                  {submitting
                    ? "Saving..."
                    : mode === "request"
                      ? "Queue Request"
                      : "Create View"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
