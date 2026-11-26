import { useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  MessageSquare,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import type { DesignThread, DesignView } from "@redlinify/shared/browser";
import { ThreadPanel } from "./ThreadPanel";
import type { InspectorDrawerProps } from "./types";

interface WorkspaceDecisionsTabProps {
  activeView: DesignView | null;
  allThreads: DesignThread[];
  onCreateThread: InspectorDrawerProps["onCreateThread"];
  onReplyThread: InspectorDrawerProps["onReplyThread"];
  onJumpToTarget: InspectorDrawerProps["onJumpToTarget"];
}

export function WorkspaceDecisionsTab({
  activeView,
  allThreads,
  onCreateThread,
  onReplyThread,
  onJumpToTarget,
}: WorkspaceDecisionsTabProps) {
  const [showAdrGuide, setShowAdrGuide] = useState(false);
  const [decisionQuery, setDecisionQuery] = useState("");
  const [expandedDecisionIds, setExpandedDecisionIds] = useState<
    Record<string, boolean>
  >({});
  const [showGeneralThreads, setShowGeneralThreads] = useState(false);
  const [reopeningDecisionId, setReopeningDecisionId] = useState<string | null>(
    null,
  );

  const viewOrOrphanThreads = useMemo(() => {
    if (!activeView) {
      return allThreads.filter((t) => t.target_type === "workspace");
    }
    const validNodeIds = new Set(activeView.nodes.map((n) => n.id));
    const validEdgeIds = new Set(activeView.edges.map((e) => e.id));
    return allThreads.filter((t) => {
      if (t.target_type === "workspace") return true;
      if (t.view_id !== activeView.id) return false;
      if (t.target_type === "view") return true;
      if (t.target_type === "node") return !validNodeIds.has(t.target_id ?? "");
      if (t.target_type === "edge") return !validEdgeIds.has(t.target_id ?? "");
      return false;
    });
  }, [allThreads, activeView]);

  const openViewOrOrphanCount = useMemo(
    () => viewOrOrphanThreads.filter((t) => t.status === "open").length,
    [viewOrOrphanThreads],
  );

  const resolvedDecisions = useMemo(
    () =>
      allThreads
        .filter((t) => t.status === "resolved")
        .sort((a, b) => {
          const bTs = b.messages[b.messages.length - 1]?.created_at ?? "";
          const aTs = a.messages[a.messages.length - 1]?.created_at ?? "";
          return bTs.localeCompare(aTs);
        }),
    [allThreads],
  );

  const filteredDecisions = useMemo(() => {
    const q = decisionQuery.trim().toLowerCase();
    if (!q) return resolvedDecisions;
    return resolvedDecisions.filter((t) => {
      const summary =
        t.resolution_summary ?? t.messages[t.messages.length - 1]?.body ?? "";
      return (
        summary.toLowerCase().includes(q) ||
        (t.view_id ?? "").toLowerCase().includes(q) ||
        (t.target_id ?? "").toLowerCase().includes(q) ||
        (t.entity_ref ?? "").toLowerCase().includes(q)
      );
    });
  }, [decisionQuery, resolvedDecisions]);

  const handleReopenDecision = async (threadId: string) => {
    setReopeningDecisionId(threadId);
    try {
      await onReplyThread(threadId, {
        body: "Reopened for follow-up.",
        reopen: true,
      });
    } finally {
      setReopeningDecisionId(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Primary Content: Decision Log */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-semibold text-slate-100">
              Decision Log
            </h3>
            <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-mono text-slate-300">
              {resolvedDecisions.length}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setShowAdrGuide((v) => !v)}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-slate-400 hover:bg-slate-800 hover:text-slate-200"
          >
            <span>How it works</span>
            {showAdrGuide ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
          </button>
        </div>

        {showAdrGuide && (
          <div className="rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2.5 space-y-1.5 text-[11px] text-slate-300 leading-relaxed">
            <p>
              • <strong className="text-amber-300">Question:</strong> asks for
              clarification before locking a design.
            </p>
            <p>
              • <strong className="text-sky-300">Change Request:</strong>{" "}
              requests the agent to modify a box, edge, or view.
            </p>
            <p>
              • <strong className="text-emerald-300">Decision (ADR):</strong>{" "}
              resolved threads graduate into persistent Architecture Decision
              Records so future iterations remember <em>why</em> choices were
              made.
            </p>
          </div>
        )}

        {resolvedDecisions.length >= 2 && (
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-500" />
            <input
              type="text"
              value={decisionQuery}
              onChange={(e) => setDecisionQuery(e.target.value)}
              placeholder="Filter decisions by summary, view, or node..."
              className="w-full rounded-md border border-slate-800 bg-slate-950 py-1.5 pl-8 pr-7 text-xs text-slate-100 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
            />
            {decisionQuery && (
              <button
                type="button"
                onClick={() => setDecisionQuery("")}
                aria-label="Clear filter"
                className="absolute right-2 top-1.5 rounded p-0.5 text-slate-500 hover:text-slate-200"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        )}

        {filteredDecisions.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-800 px-3 py-4 text-center text-xs text-slate-500">
            {resolvedDecisions.length === 0
              ? "No resolved decisions yet. Resolve any thread to record a decision here."
              : "No decisions match that filter."}
          </div>
        ) : (
          <div className="space-y-2.5">
            {filteredDecisions.map((t) => {
              const isExpanded = expandedDecisionIds[t.id] === true;
              const summaryText =
                t.resolution_summary ??
                t.messages[t.messages.length - 1]?.body ??
                "Resolved decision";
              const scopeLabel = `${t.view_id ?? "workspace"}${
                t.target_id ? ` / ${t.target_id}` : ""
              }`;
              const hasAnchor = Boolean(t.view_id || t.target_id);
              const lastTs = t.messages[t.messages.length - 1]?.created_at;

              return (
                <div
                  key={t.id}
                  className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                      <span
                        title={scopeLabel}
                        className="truncate rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-300"
                      >
                        {scopeLabel}
                      </span>
                    </div>
                    {hasAnchor && (
                      <button
                        type="button"
                        onClick={() =>
                          onJumpToTarget(
                            t.view_id,
                            t.target_type,
                            t.target_id,
                            "threads",
                          )
                        }
                        className="inline-flex shrink-0 items-center gap-1 rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-sky-300 hover:bg-slate-800"
                      >
                        <ExternalLink className="h-2.5 w-2.5" />
                        Jump
                      </button>
                    )}
                  </div>

                  <p className="text-xs font-medium text-slate-100 leading-relaxed">
                    {summaryText}
                  </p>

                  <div className="flex items-center justify-between gap-2 pt-0.5 text-[10px] text-slate-400">
                    <span>
                      {lastTs ? `${new Date(lastTs).toLocaleDateString()} • ` : ""}
                      {t.messages.length} msg
                      {t.messages.length === 1 ? "" : "s"}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedDecisionIds((prev) => ({
                          ...prev,
                          [t.id]: !isExpanded,
                        }))
                      }
                      className="text-[11px] font-medium text-sky-300 hover:underline"
                    >
                      {isExpanded ? "Hide discussion" : "Show discussion"}
                    </button>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-slate-800/90 pt-2 space-y-2">
                      <div className="space-y-1.5">
                        {t.messages.map((msg) => (
                          <div
                            key={msg.id}
                            className={`rounded-md px-2.5 py-1.5 text-[11px] ${
                              msg.author === "agent"
                                ? "bg-slate-900 border border-slate-800 text-slate-200"
                                : "bg-sky-950/40 border border-sky-500/25 text-sky-100"
                            }`}
                          >
                            <div className="mb-0.5 flex items-center justify-between text-[10px] text-slate-400">
                              <span className="font-semibold uppercase tracking-wider">
                                {msg.author}
                              </span>
                              <span>
                                {new Date(msg.created_at).toLocaleTimeString(
                                  [],
                                  {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  },
                                )}
                              </span>
                            </div>
                            <p className="whitespace-pre-wrap leading-relaxed">
                              {msg.body}
                            </p>
                          </div>
                        ))}
                      </div>
                      <div className="flex justify-end">
                        <button
                          type="button"
                          disabled={reopeningDecisionId === t.id}
                          onClick={() => void handleReopenDecision(t.id)}
                          className="inline-flex items-center gap-1 rounded border border-slate-700 px-2 py-0.5 text-[10px] text-slate-300 hover:bg-slate-800 disabled:opacity-50"
                        >
                          <RotateCcw className="h-2.5 w-2.5" />
                          Reopen thread
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Secondary Content: View & Workspace Threads */}
      <div className="border-t border-slate-800 pt-3 space-y-2">
        <button
          type="button"
          onClick={() => setShowGeneralThreads((v) => !v)}
          className="flex w-full items-center justify-between rounded-md py-1 text-left text-xs font-semibold text-slate-300 hover:text-slate-100"
        >
          <span className="inline-flex items-center gap-1.5">
            <MessageSquare className="h-3.5 w-3.5 text-sky-400" />
            View &amp; Workspace Threads
            <span
              className={`rounded-full px-1.5 py-0.2 text-[10px] font-mono ${
                openViewOrOrphanCount > 0
                  ? "bg-amber-500/20 text-amber-200 border border-amber-500/35"
                  : "bg-slate-800 text-slate-400"
              }`}
            >
              {openViewOrOrphanCount} open
            </span>
          </span>
          {showGeneralThreads || openViewOrOrphanCount > 0 ? (
            <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
          )}
        </button>

        {(showGeneralThreads || openViewOrOrphanCount > 0) && (
          <ThreadPanel
            threads={viewOrOrphanThreads}
            targetType={activeView ? "view" : "workspace"}
            viewId={activeView?.id}
            onCreateThread={onCreateThread}
            onReplyThread={onReplyThread}
            onJumpToTarget={onJumpToTarget}
            showJumpLinks
          />
        )}
      </div>
    </div>
  );
}
