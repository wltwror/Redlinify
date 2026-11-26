import { AlertTriangle, Copy } from "lucide-react";
import type { DesignView, SemanticDiff } from "@redlinify/shared/browser";
import type { PendingFeedbackResult } from "../../api/client";
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
  pendingFeedback: PendingFeedbackResult;
  onOpenTab: (viewId: string) => void;
  onJumpToTarget: InspectorDrawerProps["onJumpToTarget"];
  onCopyText: (text: string, label: string) => Promise<void>;
}

export function WorkspacePendingTab({
  activeView,
  viewDiff,
  pendingFeedback,
  onOpenTab,
  onJumpToTarget,
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
          {pendingFeedback.view_diffs.map(({ view_id, diff }) => (
            <div
              key={view_id}
              className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 space-y-2"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-sky-300 font-mono">
                  {view_id}
                </span>
                <button
                  type="button"
                  onClick={() => onOpenTab(view_id)}
                  className="text-[11px] text-sky-400 hover:underline"
                >
                  Open tab
                </button>
              </div>
              <ul className="space-y-1 text-xs text-slate-300">
                {Object.keys(diff.view_meta_changed).length > 0 && (
                  <li>• View title/direction updated</li>
                )}
                {diff.nodes_added.map((n) => (
                  <li key={n.id} className="text-emerald-300">
                    + Added node: {n.title}
                  </li>
                ))}
                {diff.nodes_modified.map((n) => (
                  <li key={n.id} className="text-sky-200">
                    ~ Modified node: {n.title}
                  </li>
                ))}
                {diff.nodes_removed.map((n) => (
                  <li key={n.id} className="text-rose-300">
                    - Removed node: {n.title}
                  </li>
                ))}
                {(diff.edges_added.length > 0 ||
                  diff.edges_modified.length > 0 ||
                  diff.edges_removed.length > 0) && (
                  <li className="text-slate-400">
                    • Edges: +{diff.edges_added.length} / ~
                    {diff.edges_modified.length} / -{diff.edges_removed.length}
                  </li>
                )}
              </ul>
            </div>
          ))}

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
