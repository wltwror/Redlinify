import { AlertTriangle, Copy, RotateCcw } from "lucide-react";
import type { DesignView, SemanticDiff } from "@redlinify/shared/browser";
import type { PendingFeedbackResult } from "../../api/client";
import { summarizeEdgeDiff, summarizeNodeDiff } from "../../utils/diffSummary";
import type { InspectorDrawerProps } from "./types";

function buildAgentPrompt(pendingFeedback: PendingFeedbackResult): string {
  const lines = [
    "Please review my latest Redlinify feedback by calling `get_workspace()`:",
  ];
  for (const vd of pendingFeedback.view_diffs) {
    const d = vd.diff;
    const parts: string[] = [];
    if (d.nodes_added.length) parts.push(`+${d.nodes_added.length} nodes`);
    if (d.nodes_modified.length)
      parts.push(`~${d.nodes_modified.length} modified nodes`);
    if (d.nodes_removed.length)
      parts.push(`-${d.nodes_removed.length} removed nodes`);
    if (
      d.edges_added.length + d.edges_modified.length + d.edges_removed.length >
      0
    ) {
      parts.push(
        `${d.edges_added.length + d.edges_modified.length + d.edges_removed.length} edge changes`,
      );
    }
    lines.push(`- View \`${vd.view_id}\`: ${parts.join(", ") || "updated"}`);
  }
  if (pendingFeedback.pending_threads.length > 0) {
    const locs = pendingFeedback.pending_threads
      .map((t) =>
        t.view_id
          ? `${t.view_id}${t.target_id ? `/${t.target_id}` : ""}`
          : "workspace",
      )
      .join(", ");
    lines.push(
      `- Open threads needing agent response: ${pendingFeedback.pending_threads.length} (${locs})`,
    );
  }
  if (pendingFeedback.view_requests.length > 0) {
    lines.push(
      `- New view requests: ${pendingFeedback.view_requests.map((r) => `"${r.title}"`).join(", ")}`,
    );
  }
  return lines.join("\n");
}

interface WorkspacePendingTabProps {
  activeView: DesignView | null;
  viewDiff: SemanticDiff | null;
  viewBaseline?: DesignView | null;
  pendingFeedback: PendingFeedbackResult;
  onOpenTab: (viewId: string) => void;
  onJumpToTarget: InspectorDrawerProps["onJumpToTarget"];
  onRevertNode?: (nodeId: string) => Promise<void>;
  onRevertView?: () => Promise<void>;
  onCopyText: (text: string, label: string) => Promise<void>;
}

export function WorkspacePendingTab({
  activeView,
  viewDiff,
  viewBaseline = null,
  pendingFeedback,
  onOpenTab,
  onJumpToTarget,
  onRevertNode,
  onRevertView,
  onCopyText,
}: WorkspacePendingTabProps) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 p-3 space-y-2">
        <p className="text-xs text-slate-200 leading-relaxed">
          Review your pending semantic edits, thread replies, and view requests
          before prompting the coding agent.
        </p>
        <button
          type="button"
          onClick={() =>
            void onCopyText(
              buildAgentPrompt(pendingFeedback),
              "prompt for agent",
            )
          }
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-sky-500 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400"
        >
          <Copy className="h-3.5 w-3.5" />
          Copy Prompt for Agent
        </button>
      </div>

      {pendingFeedback.view_diffs.length === 0 &&
      pendingFeedback.pending_threads.length === 0 &&
      pendingFeedback.view_requests.length === 0 ? (
        <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-4 text-center text-xs text-slate-400">
          Everything is synced with the last agent checkpoint.
        </div>
      ) : (
        <>
          {pendingFeedback.view_diffs.map(({ view_id, diff }) => {
            const isCurrentView = activeView?.id === view_id;
            const diagramType = isCurrentView
              ? (activeView.diagram_type ?? "general")
              : "general";
            return (
              <div
                key={view_id}
                className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-sky-300 font-mono">
                    {view_id}
                  </span>
                  <div className="flex items-center gap-2">
                    {isCurrentView && viewBaseline && onRevertView && (
                      <button
                        type="button"
                        onClick={() => void onRevertView()}
                        title="Revert all unsynced changes in this view to checkpoint"
                        className="inline-flex items-center gap-1 rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300 hover:border-sky-500/60 hover:text-sky-300"
                      >
                        <RotateCcw className="h-2.5 w-2.5" />
                        Revert view
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onOpenTab(view_id)}
                      className="text-[11px] text-sky-400 hover:underline"
                    >
                      {isCurrentView ? "Active" : "Open tab"}
                    </button>
                  </div>
                </div>
                <ul className="space-y-1.5 text-xs text-slate-300">
                  {Object.keys(diff.view_meta_changed).length > 0 && (
                    <li>• View title/direction updated</li>
                  )}
                  {diff.nodes_added.map((n) => (
                    <li
                      key={n.id}
                      className="flex items-center justify-between gap-2 text-emerald-300"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          onJumpToTarget(view_id, "node", n.id, "spec")
                        }
                        className="truncate text-left hover:underline"
                      >
                        + Added: {n.title}
                      </button>
                      {isCurrentView && onRevertNode && (
                        <button
                          type="button"
                          onClick={() => void onRevertNode(n.id)}
                          className="shrink-0 rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300 hover:border-rose-500/60 hover:text-rose-200"
                        >
                          Discard
                        </button>
                      )}
                    </li>
                  ))}
                  {diff.nodes_modified.map((n) => {
                    const summaryLines = summarizeNodeDiff(
                      diff,
                      n.id,
                      diagramType,
                    );
                    return (
                      <li key={n.id} className="space-y-0.5 text-sky-200">
                        <div className="flex items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              onJumpToTarget(view_id, "node", n.id, "spec")
                            }
                            className="truncate text-left hover:underline"
                          >
                            ~ Modified: {n.title}
                          </button>
                          {isCurrentView && viewBaseline && onRevertNode && (
                            <button
                              type="button"
                              onClick={() => void onRevertNode(n.id)}
                              className="shrink-0 rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300 hover:border-sky-500/60 hover:text-sky-200"
                            >
                              Revert
                            </button>
                          )}
                        </div>
                        {summaryLines.length > 0 && (
                          <ul className="ml-3 space-y-0.5 text-[11px] font-mono text-slate-400">
                            {summaryLines.map((line, idx) => (
                              <li key={idx} className="truncate">
                                {line}
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                  {diff.nodes_removed.map((n) => (
                    <li
                      key={n.id}
                      className="flex items-center justify-between gap-2 text-rose-300"
                    >
                      <span className="truncate">- Removed: {n.title}</span>
                      {isCurrentView && viewBaseline && onRevertNode && (
                        <button
                          type="button"
                          onClick={() => void onRevertNode(n.id)}
                          className="shrink-0 rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300 hover:border-emerald-500/60 hover:text-emerald-200"
                        >
                          Restore
                        </button>
                      )}
                    </li>
                  ))}
                  {diff.edges_added.map((e) => (
                    <li key={`ea-${e.id}`} className="text-emerald-300/90">
                      <button
                        type="button"
                        onClick={() =>
                          onJumpToTarget(view_id, "edge", e.id, "spec")
                        }
                        className="truncate text-left hover:underline"
                      >
                        + Edge {e.source} → {e.target}
                        {e.label ? ` (${e.label})` : ""}
                      </button>
                    </li>
                  ))}
                  {diff.edges_modified.map((e) => {
                    const edgeLines = summarizeEdgeDiff(diff, e.id);
                    return (
                      <li key={`em-${e.id}`} className="text-sky-200/90">
                        <button
                          type="button"
                          onClick={() =>
                            onJumpToTarget(view_id, "edge", e.id, "spec")
                          }
                          className="truncate text-left hover:underline"
                        >
                          ~ Edge {e.id}: {edgeLines.join(" · ")}
                        </button>
                      </li>
                    );
                  })}
                  {diff.edges_removed.length > 0 && (
                    <li className="text-rose-300/90">
                      - {diff.edges_removed.length} removed edge
                      {diff.edges_removed.length > 1 ? "s" : ""}
                    </li>
                  )}
                </ul>
              </div>
            );
          })}

          {pendingFeedback.pending_threads.length > 0 && (
            <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 space-y-2">
              <div className="text-xs font-semibold text-slate-200">
                Threads Awaiting Agent ({pendingFeedback.pending_threads.length})
              </div>
              {pendingFeedback.pending_threads.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() =>
                    onJumpToTarget(
                      t.view_id,
                      t.target_type,
                      t.target_id,
                      "threads",
                    )
                  }
                  className="block w-full rounded border border-slate-800 bg-slate-900 p-2 text-left hover:border-sky-500/40"
                >
                  <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono">
                    <span>
                      {t.view_id ?? "workspace"}
                      {t.target_id ? ` / ${t.target_id}` : ""}
                    </span>
                    <span>{t.kind}</span>
                  </div>
                  <p className="mt-1 truncate text-xs text-slate-200">
                    {t.messages[t.messages.length - 1]?.body}
                  </p>
                </button>
              ))}
            </div>
          )}

          {pendingFeedback.view_requests.length > 0 && (
            <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 space-y-2">
              <div className="text-xs font-semibold text-amber-300">
                Requested Views ({pendingFeedback.view_requests.length})
              </div>
              {pendingFeedback.view_requests.map((r) => (
                <div
                  key={r.id}
                  className="rounded border border-slate-800 bg-slate-900 p-2 text-xs"
                >
                  <div className="font-semibold text-slate-100">{r.title}</div>
                  <div className="mt-0.5 text-slate-400">{r.prompt}</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {viewDiff && viewDiff.has_changes && activeView && (
        <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
          <AlertTriangle className="h-3.5 w-3.5 text-sky-400" />
          <span>
            Active tab{" "}
            <code className="font-mono text-slate-200">{activeView.id}</code>{" "}
            has unsynced human changes.
          </span>
        </div>
      )}
    </div>
  );
}
