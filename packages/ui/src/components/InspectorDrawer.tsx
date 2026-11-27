import { useMemo } from "react";
import { X } from "lucide-react";
import { EdgeSpecTab } from "./inspector/EdgeSpecTab";
import { NodeLinksTab } from "./inspector/NodeLinksTab";
import { NodeSpecTab } from "./inspector/NodeSpecTab";
import { ThreadPanel } from "./inspector/ThreadPanel";
import type { InspectorDrawerProps } from "./inspector/types";
import { WorkspaceDecisionsTab } from "./inspector/WorkspaceDecisionsTab";
import { WorkspacePendingTab } from "./inspector/WorkspacePendingTab";

export type {
  DrawerMode,
  ElementDrawerTab,
  InspectorDrawerProps,
  WorkspaceDrawerTab,
} from "./inspector/types";

export function InspectorDrawer(props: InspectorDrawerProps) {
  const {
    mode,
    elementTab,
    workspaceTab,
    onChangeElementTab,
    onChangeWorkspaceTab,
    onClose,
    activeView,
    selectedNode,
    selectedEdge,
    edgeRoute,
    allThreads,
    viewDiff,
    viewBaseline = null,
    pendingFeedback,
    status,
    onSaveNode,
    onDeleteNode,
    onRevertNode,
    onRevertView,
    onSaveEdge,
    onDeleteEdge,
    onUpdateEdgeRoute,
    onFlipEdge,
    onCreateThread,
    onReplyThread,
    onOpenTab,
    onJumpToTarget,
    onNotify,
  } = props;

  const elementThreads = useMemo(() => {
    if (mode === "node" && selectedNode && activeView) {
      return allThreads.filter(
        (t) =>
          t.target_type === "node" &&
          t.view_id === activeView.id &&
          t.target_id === selectedNode.id,
      );
    }
    if (mode === "edge" && selectedEdge && activeView) {
      return allThreads.filter(
        (t) =>
          t.target_type === "edge" &&
          t.view_id === activeView.id &&
          t.target_id === selectedEdge.id,
      );
    }
    return [];
  }, [mode, selectedNode, selectedEdge, activeView, allThreads]);

  const workspaceOpenQuestions = useMemo(
    () => allThreads.filter((t) => t.status === "open"),
    [allThreads],
  );

  const resolvedDecisionsCount = useMemo(
    () => allThreads.filter((t) => t.status === "resolved").length,
    [allThreads],
  );

  if (mode === "none") {
    return null;
  }

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      onNotify(`Copied ${label}`);
    } catch {
      onNotify("Could not access clipboard", "warning");
    }
  };

  return (
    <>
      {/* Backdrop on mobile */}
      <div
        onClick={onClose}
        className="fixed inset-0 z-30 bg-black/50 md:hidden"
      />

      <aside className="fixed inset-y-0 right-0 z-40 flex w-full max-w-[400px] flex-col border-l border-slate-800 bg-slate-900 shadow-2xl md:static md:z-auto md:w-[390px] md:shrink-0">
        {/* Drawer Header */}
        <div className="flex items-center justify-between gap-2 border-b border-slate-800 px-4 py-3">
          <div className="min-w-0">
            {mode === "node" && selectedNode && (
              <>
                <div className="text-[10px] font-mono uppercase tracking-wider text-sky-400">
                  {selectedNode.kind} Node
                </div>
                <h2 className="truncate text-sm font-semibold text-slate-100">
                  {selectedNode.title}
                </h2>
              </>
            )}
            {mode === "edge" && selectedEdge && (
              <>
                <div className="text-[10px] font-mono uppercase tracking-wider text-sky-400">
                  Edge Connection
                </div>
                <h2 className="truncate text-sm font-semibold text-slate-100">
                  {selectedEdge.source} → {selectedEdge.target}
                </h2>
              </>
            )}
            {mode === "workspace" && (
              <>
                <div className="text-[10px] font-mono uppercase tracking-wider text-sky-400">
                  Workspace Triage
                </div>
                <h2 className="truncate text-sm font-semibold text-slate-100">
                  {status?.project_name ?? "Redlinify"}
                </h2>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
            aria-label="Close inspector"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Sub-tabs */}
        {(mode === "node" || mode === "edge") && (
          <div className="grid grid-cols-3 border-b border-slate-800 bg-slate-950/50 text-xs font-medium">
            <button
              type="button"
              onClick={() => onChangeElementTab("spec")}
              className={`py-2 border-b-2 transition-colors ${
                elementTab === "spec"
                  ? "border-sky-400 text-sky-200"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              Spec
            </button>
            <button
              type="button"
              onClick={() => onChangeElementTab("threads")}
              className={`py-2 border-b-2 transition-colors ${
                elementTab === "threads"
                  ? "border-sky-400 text-sky-200"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              Threads ({elementThreads.filter((t) => t.status === "open").length})
            </button>
            {mode === "node" && (
              <button
                type="button"
                onClick={() => onChangeElementTab("links")}
                className={`py-2 border-b-2 transition-colors ${
                  elementTab === "links"
                    ? "border-sky-400 text-sky-200"
                    : "border-transparent text-slate-400 hover:text-slate-200"
                }`}
              >
                Links & Code
              </button>
            )}
          </div>
        )}

        {mode === "workspace" && (
          <div className="grid grid-cols-3 border-b border-slate-800 bg-slate-950/50 text-xs font-medium">
            <button
              type="button"
              onClick={() => onChangeWorkspaceTab("questions")}
              className={`py-2 border-b-2 transition-colors ${
                workspaceTab === "questions"
                  ? "border-sky-400 text-sky-200"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              Threads ({workspaceOpenQuestions.length})
            </button>
            <button
              type="button"
              onClick={() => onChangeWorkspaceTab("pending")}
              className={`py-2 border-b-2 transition-colors ${
                workspaceTab === "pending"
                  ? "border-sky-400 text-sky-200"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              Pending (
              {pendingFeedback.view_diffs.length +
                pendingFeedback.pending_threads.length +
                pendingFeedback.view_requests.length}
              )
            </button>
            <button
              type="button"
              onClick={() => onChangeWorkspaceTab("adrs")}
              className={`py-2 border-b-2 transition-colors ${
                workspaceTab === "adrs"
                  ? "border-sky-400 text-sky-200"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              Decisions ({resolvedDecisionsCount})
            </button>
          </div>
        )}

        {/* Drawer Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {mode === "node" && elementTab === "spec" && selectedNode && (
            <NodeSpecTab
              activeView={activeView}
              selectedNode={selectedNode}
              onSaveNode={onSaveNode}
              onDeleteNode={onDeleteNode}
            />
          )}

          {((mode === "node" && selectedNode) ||
            (mode === "edge" && selectedEdge)) &&
            elementTab === "threads" &&
            activeView && (
              <ThreadPanel
                threads={elementThreads}
                targetType={mode === "node" ? "node" : "edge"}
                viewId={activeView.id}
                targetId={
                  mode === "node" ? selectedNode!.id : selectedEdge!.id
                }
                entityRef={
                  mode === "node" ? selectedNode?.entity_ref : undefined
                }
                onCreateThread={onCreateThread}
                onReplyThread={onReplyThread}
              />
            )}

          {mode === "node" && elementTab === "links" && selectedNode && (
            <NodeLinksTab
              activeView={activeView}
              selectedNode={selectedNode}
              onJumpToTarget={onJumpToTarget}
              onCopyText={copyText}
            />
          )}

          {mode === "edge" && elementTab === "spec" && selectedEdge && (
            <EdgeSpecTab
              activeView={activeView}
              selectedEdge={selectedEdge}
              edgeRoute={edgeRoute}
              onSaveEdge={onSaveEdge}
              onDeleteEdge={onDeleteEdge}
              onUpdateEdgeRoute={onUpdateEdgeRoute}
              onFlipEdge={onFlipEdge}
            />
          )}

          {mode === "workspace" && workspaceTab === "questions" && (
            <ThreadPanel
              threads={allThreads}
              targetType={activeView ? "view" : "workspace"}
              viewId={activeView?.id}
              onCreateThread={onCreateThread}
              onReplyThread={onReplyThread}
              onJumpToTarget={onJumpToTarget}
              showJumpLinks
            />
          )}

          {mode === "workspace" && workspaceTab === "pending" && (
            <WorkspacePendingTab
              activeView={activeView}
              viewDiff={viewDiff}
              viewBaseline={viewBaseline}
              pendingFeedback={pendingFeedback}
              onOpenTab={onOpenTab}
              onJumpToTarget={onJumpToTarget}
              onRevertNode={onRevertNode}
              onRevertView={onRevertView}
              onCopyText={copyText}
            />
          )}

          {mode === "workspace" && workspaceTab === "adrs" && (
            <WorkspaceDecisionsTab
              activeView={activeView}
              allThreads={allThreads}
              onCreateThread={onCreateThread}
              onReplyThread={onReplyThread}
              onJumpToTarget={onJumpToTarget}
            />
          )}
        </div>
      </aside>
    </>
  );
}
