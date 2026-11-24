import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  Database,
  ExternalLink,
  Link2,
  Lock,
  MessageSquare,
  Plus,
  RotateCcw,
  Send,
  Trash2,
  Unlock,
  X,
} from "lucide-react";
import {
  ENTITY_REF_REGEX,
  isThreadWaitingOnAgent,
  isThreadWaitingOnHuman,
  type BoxSection,
  type Cardinality,
  type DesignEdge,
  type DesignNode,
  type DesignThread,
  type DesignView,
  type EdgeRoute,
  type EntityField,
  type HandleSide,
  type NodeStatus,
  type RelationKind,
  type SemanticDiff,
  type ThreadKind,
  type ThreadTargetType,
} from "@redlinify/shared/browser";
import {
  fetchCrossLinks,
  type CrossLinkOccurrence,
  type PendingFeedbackResult,
  type WorkspaceStatusResult,
} from "../api/client";

export type DrawerMode = "none" | "node" | "edge" | "workspace";
export type ElementDrawerTab = "spec" | "threads" | "links";
export type WorkspaceDrawerTab = "questions" | "pending" | "adrs";

interface InspectorDrawerProps {
  mode: DrawerMode;
  elementTab: ElementDrawerTab;
  workspaceTab: WorkspaceDrawerTab;
  onChangeElementTab: (tab: ElementDrawerTab) => void;
  onChangeWorkspaceTab: (tab: WorkspaceDrawerTab) => void;
  onClose: () => void;
  activeView: DesignView | null;
  selectedNode: DesignNode | null;
  selectedEdge: DesignEdge | null;
  edgeRoute?: EdgeRoute;
  allThreads: DesignThread[];
  viewDiff: SemanticDiff | null;
  pendingFeedback: PendingFeedbackResult;
  status: WorkspaceStatusResult | null;
  onSaveNode: (updated: DesignNode) => Promise<void>;
  onDeleteNode: (nodeId: string) => Promise<void>;
  onSaveEdge: (updated: DesignEdge) => Promise<void>;
  onDeleteEdge: (edgeId: string) => Promise<void>;
  onUpdateEdgeRoute: (edgeId: string, patch: Partial<EdgeRoute> | null) => void;
  onCreateThread: (input: {
    target_type: ThreadTargetType;
    view_id?: string;
    target_id?: string;
    entity_ref?: string;
    kind: ThreadKind;
    body: string;
  }) => Promise<void>;
  onReplyThread: (
    threadId: string,
    input: {
      body: string;
      resolve?: boolean;
      reopen?: boolean;
      resolution_summary?: string;
    },
  ) => Promise<void>;
  onOpenTab: (viewId: string) => void;
  onJumpToTarget: (
    viewId: string | undefined,
    targetType: ThreadTargetType,
    targetId?: string,
    preferredTab?: ElementDrawerTab,
  ) => void;
  onNotify: (message: string, tone?: "info" | "warning" | "error") => void;
}

const STATUS_OPTIONS: NodeStatus[] = [
  "draft",
  "needs_input",
  "approved",
  "implemented",
  "drifted",
];

function ThreadPanel({
  threads,
  targetType,
  viewId,
  targetId,
  entityRef,
  onCreateThread,
  onReplyThread,
  onJumpToTarget,
  showJumpLinks = false,
}: {
  threads: DesignThread[];
  targetType: ThreadTargetType;
  viewId?: string;
  targetId?: string;
  entityRef?: string;
  onCreateThread: InspectorDrawerProps["onCreateThread"];
  onReplyThread: InspectorDrawerProps["onReplyThread"];
  onJumpToTarget?: InspectorDrawerProps["onJumpToTarget"];
  showJumpLinks?: boolean;
}) {
  const [newKind, setNewKind] = useState<ThreadKind>("change_request");
  const [newBody, setNewBody] = useState("");
  const [creating, setCreating] = useState(false);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [resolveSummary, setResolveSummary] = useState("");
  const [showResolved, setShowResolved] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const openThreads = threads.filter((t) => t.status === "open");
  const resolvedThreads = threads.filter((t) => t.status === "resolved");

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBody.trim()) return;
    setCreating(true);
    try {
      await onCreateThread({
        target_type: targetType,
        view_id: viewId,
        target_id: targetId,
        entity_ref: entityRef,
        kind: newKind,
        body: newBody.trim(),
      });
      setNewBody("");
    } finally {
      setCreating(false);
    }
  };

  const handleReply = async (threadId: string) => {
    const draft = replyDrafts[threadId]?.trim();
    if (!draft) return;
    setBusyId(threadId);
    try {
      await onReplyThread(threadId, { body: draft });
      setReplyDrafts((prev) => ({ ...prev, [threadId]: "" }));
    } finally {
      setBusyId(null);
    }
  };

  const handleConfirmResolve = async (threadId: string) => {
    setBusyId(threadId);
    try {
      const reply = replyDrafts[threadId]?.trim() || "Marked resolved.";
      await onReplyThread(threadId, {
        body: reply,
        resolve: true,
        resolution_summary: resolveSummary.trim() || undefined,
      });
      setReplyDrafts((prev) => ({ ...prev, [threadId]: "" }));
      setResolvingId(null);
      setResolveSummary("");
    } finally {
      setBusyId(null);
    }
  };

  const handleReopen = async (threadId: string) => {
    setBusyId(threadId);
    try {
      await onReplyThread(threadId, {
        body: "Reopened for follow-up.",
        reopen: true,
      });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <form
        onSubmit={handleCreate}
        className="rounded-lg border border-slate-800 bg-slate-950/70 p-3 space-y-2"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            New Thread
          </span>
          <select
            value={newKind}
            onChange={(e) => setNewKind(e.target.value as ThreadKind)}
            className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-[11px] text-slate-200 focus:border-sky-500 focus:outline-none"
          >
            <option value="change_request">Change Request</option>
            <option value="question">Question</option>
            <option value="decision">Decision</option>
          </select>
        </div>
        <textarea
          rows={2}
          value={newBody}
          onChange={(e) => setNewBody(e.target.value)}
          placeholder="Ask a question or request an architectural adjustment..."
          className="w-full rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
        />
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={creating || !newBody.trim()}
            className="inline-flex items-center gap-1 rounded-md bg-sky-500 px-2.5 py-1 text-xs font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
            Post Thread
          </button>
        </div>
      </form>

      {openThreads.length === 0 ? (
        <p className="text-xs text-slate-500 text-center py-3">
          No open threads here.
        </p>
      ) : (
        <div className="space-y-3">
          {openThreads.map((thread) => {
            const waitingHuman = isThreadWaitingOnHuman(thread);
            const waitingAgent = isThreadWaitingOnAgent(thread);
            const isDrift = thread.kind === "drift_alert";

            return (
              <div
                key={thread.id}
                className={`rounded-lg border p-3 space-y-2.5 ${
                  isDrift
                    ? "border-rose-500/40 bg-rose-950/10"
                    : waitingHuman
                      ? "border-amber-500/40 bg-amber-950/10"
                      : "border-slate-800 bg-slate-950/50"
                }`}
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-1.5">
                    <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-mono uppercase text-slate-300">
                      {thread.kind.replace("_", " ")}
                    </span>
                    {waitingHuman && (
                      <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold text-amber-300 border border-amber-500/30">
                        Waiting on you
                      </span>
                    )}
                    {waitingAgent && (
                      <span className="rounded-full bg-sky-500/20 px-2 py-0.5 text-[10px] font-semibold text-sky-300 border border-sky-500/30">
                        Waiting on agent
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5">
                    {showJumpLinks && onJumpToTarget && (
                      <button
                        type="button"
                        onClick={() =>
                          onJumpToTarget(
                            thread.view_id,
                            thread.target_type,
                            thread.target_id,
                            "threads",
                          )
                        }
                        className="inline-flex items-center gap-1 rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-sky-300 hover:bg-slate-800"
                      >
                        <ExternalLink className="h-2.5 w-2.5" />
                        Jump
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setResolvingId(
                          resolvingId === thread.id ? null : thread.id,
                        );
                        setResolveSummary("");
                      }}
                      className="inline-flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300 hover:bg-emerald-500/20"
                    >
                      <Check className="h-3 w-3" />
                      Resolve
                    </button>
                  </div>
                </div>

                {showJumpLinks && (
                  <div className="text-[10px] font-mono text-slate-500">
                    {thread.view_id ? `${thread.view_id}` : "workspace"}
                    {thread.target_id ? ` / ${thread.target_id}` : ""}
                  </div>
                )}

                <div className="space-y-2">
                  {thread.messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`rounded-md px-2.5 py-2 text-xs ${
                        msg.author === "agent"
                          ? "bg-slate-900 border border-slate-800 text-slate-200"
                          : "bg-sky-950/40 border border-sky-500/25 text-sky-100"
                      }`}
                    >
                      <div className="mb-1 flex items-center justify-between text-[10px] text-slate-400">
                        <span className="font-semibold uppercase tracking-wider">
                          {msg.author}
                        </span>
                        <span>
                          {new Date(msg.created_at).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                      <p className="whitespace-pre-wrap leading-relaxed">
                        {msg.body}
                      </p>
                    </div>
                  ))}
                </div>

                {resolvingId === thread.id && (
                  <div className="rounded-md border border-emerald-500/30 bg-emerald-950/20 p-2 space-y-2">
                    <input
                      type="text"
                      value={resolveSummary}
                      onChange={(e) => setResolveSummary(e.target.value)}
                      placeholder="Optional 1-line ADR summary..."
                      className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100 placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none"
                    />
                    <div className="flex justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => setResolvingId(null)}
                        className="rounded px-2 py-1 text-[11px] text-slate-400 hover:bg-slate-800"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={busyId === thread.id}
                        onClick={() => handleConfirmResolve(thread.id)}
                        className="rounded bg-emerald-500 px-2.5 py-1 text-[11px] font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
                      >
                        Confirm Resolve
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={replyDrafts[thread.id] ?? ""}
                    onChange={(e) =>
                      setReplyDrafts((prev) => ({
                        ...prev,
                        [thread.id]: e.target.value,
                      }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void handleReply(thread.id);
                      }
                    }}
                    placeholder="Write a reply..."
                    className="flex-1 rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1 text-xs text-slate-100 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    disabled={
                      busyId === thread.id || !(replyDrafts[thread.id]?.trim())
                    }
                    onClick={() => void handleReply(thread.id)}
                    className="inline-flex items-center justify-center rounded-md bg-slate-800 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-700 disabled:opacity-40"
                    aria-label="Send reply"
                  >
                    <Send className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {resolvedThreads.length > 0 && (
        <div className="border-t border-slate-800 pt-3">
          <button
            type="button"
            onClick={() => setShowResolved((v) => !v)}
            className="flex w-full items-center justify-between text-xs font-semibold text-slate-400 hover:text-slate-200"
          >
            <span className="inline-flex items-center gap-1.5">
              {showResolved ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
              Resolved Decisions (ADRs)
            </span>
            <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px]">
              {resolvedThreads.length}
            </span>
          </button>

          {showResolved && (
            <div className="mt-2.5 space-y-2">
              {resolvedThreads.map((t) => (
                <div
                  key={t.id}
                  className="rounded-lg border border-slate-800 bg-slate-950/60 p-2.5 space-y-1.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-300">
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                      <span>
                        {t.resolution_summary ??
                          t.messages[t.messages.length - 1]?.body}
                      </span>
                    </div>
                    <button
                      type="button"
                      disabled={busyId === t.id}
                      onClick={() => void handleReopen(t.id)}
                      className="inline-flex shrink-0 items-center gap-1 rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300 hover:bg-slate-800"
                    >
                      <RotateCcw className="h-2.5 w-2.5" />
                      Reopen
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    {t.messages.length} message(s) • {t.kind.replace("_", " ")}
                    {t.target_id ? ` • ${t.target_id}` : ""}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

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
    pendingFeedback,
    status,
    onSaveNode,
    onDeleteNode,
    onSaveEdge,
    onDeleteEdge,
    onUpdateEdgeRoute,
    onCreateThread,
    onReplyThread,
    onOpenTab,
    onJumpToTarget,
    onNotify,
  } = props;

  const [nodeDraft, setNodeDraft] = useState<DesignNode | null>(selectedNode);
  const [entityRefError, setEntityRefError] = useState<string | null>(null);
  const [edgeDraft, setEdgeDraft] = useState<DesignEdge | null>(selectedEdge);
  const [crossLinks, setCrossLinks] = useState<CrossLinkOccurrence[]>([]);
  const [loadingLinks, setLoadingLinks] = useState(false);

  useEffect(() => {
    setNodeDraft(selectedNode ? structuredClone(selectedNode) : null);
    setEntityRefError(null);
  }, [selectedNode]);

  useEffect(() => {
    setEdgeDraft(selectedEdge ? structuredClone(selectedEdge) : null);
  }, [selectedEdge]);

  useEffect(() => {
    if (
      mode !== "node" ||
      elementTab !== "links" ||
      !selectedNode?.entity_ref
    ) {
      setCrossLinks([]);
      return;
    }
    let cancelled = false;
    setLoadingLinks(true);
    fetchCrossLinks(selectedNode.entity_ref)
      .then((res) => {
        if (!cancelled) setCrossLinks(res.occurrences);
      })
      .catch(() => {
        if (!cancelled) setCrossLinks([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingLinks(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, elementTab, selectedNode?.entity_ref]);

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

  if (mode === "none") {
    return null;
  }

  const commitNode = async (next: DesignNode) => {
    setNodeDraft(next);
    await onSaveNode(next);
  };

  const commitEdge = async (next: DesignEdge) => {
    setEdgeDraft(next);
    await onSaveEdge(next);
  };

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      onNotify(`Copied ${label}`);
    } catch {
      onNotify(`Could not access clipboard`, "warning");
    }
  };

  const buildAgentPrompt = () => {
    const lines = [
      "Please review my latest Redlinify feedback by calling `get_pending_feedback()`:",
    ];
    for (const vd of pendingFeedback.view_diffs) {
      const d = vd.diff;
      const parts: string[] = [];
      if (d.nodes_added.length) parts.push(`+${d.nodes_added.length} nodes`);
      if (d.nodes_modified.length)
        parts.push(`~${d.nodes_modified.length} modified nodes`);
      if (d.nodes_removed.length)
        parts.push(`-${d.nodes_removed.length} removed nodes`);
      if (d.edges_added.length + d.edges_modified.length + d.edges_removed.length > 0) {
        parts.push(
          `${d.edges_added.length + d.edges_modified.length + d.edges_removed.length} edge changes`,
        );
      }
      lines.push(`- View \`${vd.view_id}\`: ${parts.join(", ") || "updated"}`);
    }
    if (pendingFeedback.pending_threads.length > 0) {
      lines.push(
        `- Open threads needing agent response: ${pendingFeedback.pending_threads.length}`,
      );
    }
    if (pendingFeedback.view_requests.length > 0) {
      lines.push(
        `- New view requests: ${pendingFeedback.view_requests.map((r) => `"${r.title}"`).join(", ")}`,
      );
    }
    return lines.join("\n");
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
              Pending ({pendingFeedback.view_diffs.length + pendingFeedback.pending_threads.length + pendingFeedback.view_requests.length})
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
              ADRs ({allThreads.filter((t) => t.status === "resolved").length})
            </button>
          </div>
        )}

        {/* Drawer Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* NODE SPEC */}
          {mode === "node" && elementTab === "spec" && nodeDraft && (
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
                <div className="flex items-center gap-2 text-xs">
                  {nodeDraft.locked ? (
                    <Lock className="h-3.5 w-3.5 text-amber-400" />
                  ) : (
                    <Unlock className="h-3.5 w-3.5 text-slate-400" />
                  )}
                  <span className="font-medium text-slate-200">
                    {nodeDraft.locked ? "Locked (agent read-only)" : "Unlocked"}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    void commitNode({
                      ...nodeDraft,
                      locked: !nodeDraft.locked,
                    })
                  }
                  className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                    nodeDraft.locked
                      ? "bg-amber-500/20 text-amber-200 border border-amber-500/40"
                      : "bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700"
                  }`}
                >
                  {nodeDraft.locked ? "Unlock" : "Lock"}
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">
                    Kind
                  </label>
                  <input
                    type="text"
                    value={nodeDraft.kind}
                    disabled={nodeDraft.locked}
                    onChange={(e) =>
                      setNodeDraft({ ...nodeDraft, kind: e.target.value })
                    }
                    onBlur={() => {
                      if (nodeDraft.kind.trim() && selectedNode) {
                        void commitNode({
                          ...nodeDraft,
                          kind: nodeDraft.kind.trim(),
                        });
                      }
                    }}
                    className="w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-100 disabled:opacity-50 focus:border-sky-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">
                    Status
                  </label>
                  <select
                    value={nodeDraft.status}
                    disabled={nodeDraft.locked}
                    onChange={(e) =>
                      void commitNode({
                        ...nodeDraft,
                        status: e.target.value as NodeStatus,
                      })
                    }
                    className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 disabled:opacity-50 focus:border-sky-500 focus:outline-none"
                  >
                    {STATUS_OPTIONS.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">
                  Title
                </label>
                <input
                  type="text"
                  value={nodeDraft.title}
                  disabled={nodeDraft.locked}
                  onChange={(e) =>
                    setNodeDraft({ ...nodeDraft, title: e.target.value })
                  }
                  onBlur={() => {
                    if (nodeDraft.title.trim()) {
                      void commitNode({
                        ...nodeDraft,
                        title: nodeDraft.title.trim(),
                      });
                    }
                  }}
                  className="w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-100 disabled:opacity-50 focus:border-sky-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">
                  Summary
                </label>
                <textarea
                  rows={2}
                  value={nodeDraft.summary ?? ""}
                  disabled={nodeDraft.locked}
                  onChange={(e) =>
                    setNodeDraft({ ...nodeDraft, summary: e.target.value })
                  }
                  onBlur={() => {
                    const cleaned = nodeDraft.summary?.trim();
                    const next = { ...nodeDraft };
                    if (cleaned) next.summary = cleaned;
                    else delete next.summary;
                    void commitNode(next);
                  }}
                  placeholder="Optional concise role summary..."
                  className="w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-600 disabled:opacity-50 focus:border-sky-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">
                  Shared Cross-Tab Key (`entity_ref`)
                </label>
                <input
                  type="text"
                  value={nodeDraft.entity_ref ?? ""}
                  disabled={nodeDraft.locked}
                  onChange={(e) => {
                    const val = e.target.value;
                    setNodeDraft({ ...nodeDraft, entity_ref: val });
                    if (val.trim() && !ENTITY_REF_REGEX.test(val.trim())) {
                      setEntityRefError("Use snake_case (a-z, 0-9, _)");
                    } else {
                      setEntityRefError(null);
                    }
                  }}
                  onBlur={() => {
                    const val = nodeDraft.entity_ref?.trim() ?? "";
                    if (!val) {
                      const next = { ...nodeDraft };
                      delete next.entity_ref;
                      setEntityRefError(null);
                      void commitNode(next);
                      return;
                    }
                    if (!ENTITY_REF_REGEX.test(val)) {
                      setEntityRefError("Use snake_case (a-z, 0-9, _)");
                      return;
                    }
                    setEntityRefError(null);
                    void commitNode({ ...nodeDraft, entity_ref: val });
                  }}
                  placeholder="e.g. design_storage"
                  className="w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 font-mono text-xs text-slate-100 placeholder:text-slate-600 disabled:opacity-50 focus:border-sky-500 focus:outline-none"
                />
                {entityRefError && (
                  <p className="mt-1 text-[11px] text-rose-400">
                    {entityRefError}
                  </p>
                )}
              </div>

              {/* ER Attributes editor */}
              {(activeView?.diagram_type === "er" ||
                (nodeDraft.fields && nodeDraft.fields.length > 0)) && (
                <div className="space-y-2.5 border-t border-slate-800 pt-3">
                  <datalist id="redlinify-sql-types">
                    <option value="uuid" />
                    <option value="bigint" />
                    <option value="integer" />
                    <option value="varchar(255)" />
                    <option value="text" />
                    <option value="boolean" />
                    <option value="timestamptz" />
                    <option value="date" />
                    <option value="decimal(10,2)" />
                    <option value="jsonb" />
                  </datalist>

                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-300">
                      <Database className="h-3.5 w-3.5" />
                      Entity Attributes
                    </span>
                    {!nodeDraft.locked && (
                      <button
                        type="button"
                        onClick={() => {
                          const newField: EntityField = {
                            id: `fld_${Date.now().toString(36).slice(-5)}`,
                            name: `col_${(nodeDraft.fields?.length ?? 0) + 1}`,
                            type: "varchar(255)",
                            nullable: false,
                          };
                          void commitNode({
                            ...nodeDraft,
                            fields: [...(nodeDraft.fields ?? []), newField],
                          });
                        }}
                        className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-700"
                      >
                        <Plus className="h-3 w-3" />
                        Add Attribute
                      </button>
                    )}
                  </div>

                  {(nodeDraft.fields ?? []).map((field, fldIdx) => {
                    const currentFields = nodeDraft.fields ?? [];
                    const updateField = (patch: Partial<EntityField>) => {
                      const nextFields = currentFields.map((f, idx) =>
                        idx === fldIdx ? { ...f, ...patch } : f,
                      );
                      void commitNode({ ...nodeDraft, fields: nextFields });
                    };
                    return (
                      <div
                        key={field.id}
                        className="rounded-lg border border-slate-800 bg-slate-950/60 p-2 space-y-1.5"
                      >
                        <div className="flex items-center gap-1.5">
                          <input
                            type="text"
                            value={field.name}
                            disabled={nodeDraft.locked}
                            onChange={(e) => {
                              const nextFields = [...currentFields];
                              nextFields[fldIdx] = {
                                ...field,
                                name: e.target.value,
                              };
                              setNodeDraft({ ...nodeDraft, fields: nextFields });
                            }}
                            onBlur={() => {
                              if (field.name.trim()) {
                                void commitNode(nodeDraft);
                              }
                            }}
                            placeholder="column_name"
                            className="flex-1 min-w-0 rounded border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-[11px] text-slate-100 disabled:opacity-50 focus:border-sky-500 focus:outline-none"
                          />
                          <input
                            type="text"
                            list="redlinify-sql-types"
                            value={field.type ?? ""}
                            disabled={nodeDraft.locked}
                            onChange={(e) => {
                              const nextFields = [...currentFields];
                              const val = e.target.value;
                              const nextField = { ...field };
                              if (val) nextField.type = val;
                              else delete nextField.type;
                              nextFields[fldIdx] = nextField;
                              setNodeDraft({ ...nodeDraft, fields: nextFields });
                            }}
                            onBlur={() => {
                              const cleaned = field.type?.trim();
                              const nextFields = [...currentFields];
                              const nextField = { ...field };
                              if (cleaned) nextField.type = cleaned;
                              else delete nextField.type;
                              nextFields[fldIdx] = nextField;
                              void commitNode({
                                ...nodeDraft,
                                fields: nextFields,
                              });
                            }}
                            placeholder="type"
                            className="w-24 rounded border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-[11px] text-slate-300 disabled:opacity-50 focus:border-sky-500 focus:outline-none"
                          />
                          {!nodeDraft.locked && (
                            <button
                              type="button"
                              onClick={() => {
                                const nextFields = currentFields.filter(
                                  (_, idx) => idx !== fldIdx,
                                );
                                void commitNode({
                                  ...nodeDraft,
                                  fields: nextFields,
                                });
                              }}
                              className="rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-rose-400"
                              title="Remove attribute"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          )}
                        </div>

                        <div className="flex items-center justify-between gap-1">
                          <div className="flex items-center gap-1 flex-wrap">
                            <button
                              type="button"
                              disabled={nodeDraft.locked}
                              onClick={() =>
                                updateField({ nullable: !field.nullable })
                              }
                              title="Toggle Mandatory (*) vs Nullable (○)"
                              className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
                                field.nullable
                                  ? "border-slate-700 bg-slate-900 text-slate-400"
                                  : "border-rose-500/40 bg-rose-500/15 text-rose-300"
                              }`}
                            >
                              {field.nullable ? "○ NULL" : "* REQ"}
                            </button>
                            <button
                              type="button"
                              disabled={nodeDraft.locked}
                              onClick={() => updateField({ pk: !field.pk })}
                              className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
                                field.pk
                                  ? "border-amber-500/40 bg-amber-500/20 text-amber-300"
                                  : "border-slate-800 bg-slate-900 text-slate-500"
                              }`}
                            >
                              PK
                            </button>
                            <button
                              type="button"
                              disabled={nodeDraft.locked}
                              onClick={() => updateField({ fk: !field.fk })}
                              className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
                                field.fk
                                  ? "border-sky-500/40 bg-sky-500/20 text-sky-300"
                                  : "border-slate-800 bg-slate-900 text-slate-500"
                              }`}
                            >
                              FK
                            </button>
                            <button
                              type="button"
                              disabled={nodeDraft.locked}
                              onClick={() =>
                                updateField({ unique: !field.unique })
                              }
                              className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
                                field.unique
                                  ? "border-violet-500/40 bg-violet-500/20 text-violet-300"
                                  : "border-slate-800 bg-slate-900 text-slate-500"
                              }`}
                            >
                              UQ
                            </button>
                            <button
                              type="button"
                              disabled={nodeDraft.locked}
                              onClick={() =>
                                updateField({ indexed: !field.indexed })
                              }
                              className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
                                field.indexed
                                  ? "border-slate-500/50 bg-slate-700/50 text-slate-200"
                                  : "border-slate-800 bg-slate-900 text-slate-500"
                              }`}
                            >
                              IDX
                            </button>
                          </div>

                          {!nodeDraft.locked && (
                            <div className="flex items-center gap-0.5">
                              <button
                                type="button"
                                disabled={fldIdx === 0}
                                onClick={() => {
                                  const nextFields = [...currentFields];
                                  const [moved] = nextFields.splice(fldIdx, 1);
                                  if (!moved) return;
                                  nextFields.splice(fldIdx - 1, 0, moved);
                                  void commitNode({
                                    ...nodeDraft,
                                    fields: nextFields,
                                  });
                                }}
                                className="rounded p-1 text-slate-500 hover:bg-slate-800 disabled:opacity-30"
                              >
                                <ArrowUp className="h-3 w-3" />
                              </button>
                              <button
                                type="button"
                                disabled={fldIdx === currentFields.length - 1}
                                onClick={() => {
                                  const nextFields = [...currentFields];
                                  const [moved] = nextFields.splice(fldIdx, 1);
                                  if (!moved) return;
                                  nextFields.splice(fldIdx + 1, 0, moved);
                                  void commitNode({
                                    ...nodeDraft,
                                    fields: nextFields,
                                  });
                                }}
                                className="rounded p-1 text-slate-500 hover:bg-slate-800 disabled:opacity-30"
                              >
                                <ArrowDown className="h-3 w-3" />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Sections editor */}
              <div className="space-y-2.5 border-t border-slate-800 pt-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-200">
                    Box Sections
                  </span>
                  {!nodeDraft.locked && (
                    <button
                      type="button"
                      onClick={() => {
                        const newSec: BoxSection = {
                          id: `sec_${Date.now().toString(36)}`,
                          heading: "Details",
                          items: ["new_item"],
                        };
                        void commitNode({
                          ...nodeDraft,
                          sections: [...nodeDraft.sections, newSec],
                        });
                      }}
                      className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-700"
                    >
                      <Plus className="h-3 w-3" />
                      Add Section
                    </button>
                  )}
                </div>

                {nodeDraft.sections.map((section, secIdx) => (
                  <div
                    key={section.id}
                    className="rounded-lg border border-slate-800 bg-slate-950/60 p-2.5 space-y-2"
                  >
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={section.heading}
                        disabled={nodeDraft.locked}
                        onChange={(e) => {
                          const nextSecs = [...nodeDraft.sections];
                          nextSecs[secIdx] = {
                            ...section,
                            heading: e.target.value,
                          };
                          setNodeDraft({ ...nodeDraft, sections: nextSecs });
                        }}
                        onBlur={() => {
                          if (section.heading.trim()) {
                            void commitNode(nodeDraft);
                          }
                        }}
                        className="flex-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs font-semibold text-slate-200 disabled:opacity-50 focus:border-sky-500 focus:outline-none"
                      />
                      {!nodeDraft.locked && (
                        <>
                          <button
                            type="button"
                            disabled={secIdx === 0}
                            onClick={() => {
                              const nextSecs = [...nodeDraft.sections];
                              const [moved] = nextSecs.splice(secIdx, 1);
                              if (!moved) return;
                              nextSecs.splice(secIdx - 1, 0, moved);
                              void commitNode({
                                ...nodeDraft,
                                sections: nextSecs,
                              });
                            }}
                            className="rounded p-1 text-slate-400 hover:bg-slate-800 disabled:opacity-30"
                            title="Move section up"
                          >
                            <ArrowUp className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            disabled={secIdx === nodeDraft.sections.length - 1}
                            onClick={() => {
                              const nextSecs = [...nodeDraft.sections];
                              const [moved] = nextSecs.splice(secIdx, 1);
                              if (!moved) return;
                              nextSecs.splice(secIdx + 1, 0, moved);
                              void commitNode({
                                ...nodeDraft,
                                sections: nextSecs,
                              });
                            }}
                            className="rounded p-1 text-slate-400 hover:bg-slate-800 disabled:opacity-30"
                            title="Move section down"
                          >
                            <ArrowDown className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const nextSecs = nodeDraft.sections.filter(
                                (_, idx) => idx !== secIdx,
                              );
                              void commitNode({
                                ...nodeDraft,
                                sections: nextSecs,
                              });
                            }}
                            className="rounded p-1 text-rose-400 hover:bg-rose-950/50"
                            title="Delete section"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </>
                      )}
                    </div>

                    <div className="space-y-1">
                      {section.items.map((item, itemIdx) => (
                        <div
                          key={`${section.id}-item-${itemIdx}`}
                          className="flex items-center gap-1"
                        >
                          <input
                            type="text"
                            value={item}
                            disabled={nodeDraft.locked}
                            onChange={(e) => {
                              const nextSecs = structuredClone(
                                nodeDraft.sections,
                              );
                              nextSecs[secIdx]!.items[itemIdx] = e.target.value;
                              setNodeDraft({
                                ...nodeDraft,
                                sections: nextSecs,
                              });
                            }}
                            onBlur={() => void commitNode(nodeDraft)}
                            className="flex-1 rounded border border-slate-800 bg-slate-900 px-2 py-1 font-mono text-[11px] text-slate-200 disabled:opacity-50 focus:border-sky-500 focus:outline-none"
                          />
                          {!nodeDraft.locked && (
                            <button
                              type="button"
                              onClick={() => {
                                const nextSecs = structuredClone(
                                  nodeDraft.sections,
                                );
                                nextSecs[secIdx]!.items.splice(itemIdx, 1);
                                void commitNode({
                                  ...nodeDraft,
                                  sections: nextSecs,
                                });
                              }}
                              className="rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-rose-400"
                              title="Remove item"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      ))}

                      {!nodeDraft.locked && (
                        <button
                          type="button"
                          onClick={() => {
                            const nextSecs = structuredClone(
                              nodeDraft.sections,
                            );
                            nextSecs[secIdx]!.items.push("new_line");
                            void commitNode({
                              ...nodeDraft,
                              sections: nextSecs,
                            });
                          }}
                          className="mt-1 inline-flex items-center gap-1 text-[11px] text-sky-400 hover:text-sky-300"
                        >
                          <Plus className="h-3 w-3" /> Add line
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="border-t border-slate-800 pt-3">
                <button
                  type="button"
                  disabled={nodeDraft.locked}
                  onClick={() => void onDeleteNode(nodeDraft.id)}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-300 hover:bg-rose-500/20 disabled:opacity-40"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {nodeDraft.locked
                    ? "Unlock node to delete"
                    : "Delete Node from View"}
                </button>
              </div>
            </div>
          )}

          {/* NODE / EDGE THREADS */}
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

          {/* NODE LINKS & CODE */}
          {mode === "node" && elementTab === "links" && selectedNode && (
            <div className="space-y-4">
              <div>
                <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                  <Link2 className="h-3.5 w-3.5 text-sky-400" />
                  Also In (Cross-Tab Links)
                </h3>
                {!selectedNode.entity_ref ? (
                  <p className="text-xs text-slate-500">
                    Set an <code className="font-mono">entity_ref</code> in the
                    Spec tab to link this concept across multiple diagrams.
                  </p>
                ) : loadingLinks ? (
                  <p className="text-xs text-slate-500">
                    Scanning diagrams...
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {crossLinks
                      .filter(
                        (occ) =>
                          !(
                            occ.view_id === activeView?.id &&
                            occ.node_id === selectedNode.id
                          ),
                      )
                      .map((occ) => (
                        <button
                          key={`${occ.view_id}:${occ.node_id}`}
                          type="button"
                          onClick={() =>
                            onJumpToTarget(
                              occ.view_id,
                              "node",
                              occ.node_id,
                              "spec",
                            )
                          }
                          className="flex w-full items-center justify-between rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2 text-left hover:border-sky-500/50 hover:bg-slate-800/70 transition-colors"
                        >
                          <div>
                            <div className="text-xs font-medium text-slate-100">
                              {occ.view_title}
                            </div>
                            <div className="text-[11px] font-mono text-slate-400">
                              {occ.node_title} ({occ.kind})
                            </div>
                          </div>
                          <ExternalLink className="h-3.5 w-3.5 text-sky-400" />
                        </button>
                      ))}
                    {crossLinks.filter(
                      (occ) =>
                        !(
                          occ.view_id === activeView?.id &&
                          occ.node_id === selectedNode.id
                        ),
                    ).length === 0 && (
                      <p className="text-xs text-slate-500">
                        No other views reference{" "}
                        <code className="font-mono text-slate-300">
                          {selectedNode.entity_ref}
                        </code>{" "}
                        yet.
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="border-t border-slate-800 pt-3">
                <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                  <Code2 className="h-3.5 w-3.5 text-emerald-400" />
                  Code References
                </h3>
                {!selectedNode.code_refs || selectedNode.code_refs.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    No code files linked yet. The agent links source files via{" "}
                    <code className="font-mono">sync_code_refs</code> after
                    implementation.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {selectedNode.code_refs.map((ref, idx) => {
                      const display = ref.symbol
                        ? `${ref.path}:${ref.symbol}`
                        : ref.path;
                      return (
                        <div
                          key={`${ref.path}-${idx}`}
                          className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2"
                        >
                          <span className="truncate font-mono text-xs text-emerald-300">
                            {display}
                          </span>
                          <button
                            type="button"
                            onClick={() => void copyText(ref.path, ref.path)}
                            className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
                            title="Copy file path"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* EDGE SPEC */}
          {mode === "edge" && elementTab === "spec" && edgeDraft && (
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
                <div className="flex items-center gap-2 text-xs">
                  {edgeDraft.locked ? (
                    <Lock className="h-3.5 w-3.5 text-amber-400" />
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
                  className="rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-700"
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
                        style:
                          e.target.value === "dashed" ? "dashed" : "solid",
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
                    <label className="block text-[11px] text-slate-400 mb-1">
                      Kind
                    </label>
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
                    onClick={() =>
                      void commitEdge({
                        ...edgeDraft,
                        source: edgeDraft.target,
                        target: edgeDraft.source,
                        source_cardinality: edgeDraft.target_cardinality,
                        target_cardinality: edgeDraft.source_cardinality,
                      })
                    }
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
                    Bend points: {edgeRoute?.waypoints?.length ?? 0} (or drag on
                    canvas)
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
          )}

          {/* WORKSPACE TRIAGE: OPEN QUESTIONS */}
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

          {/* WORKSPACE TRIAGE: PENDING FOR AGENT */}
          {mode === "workspace" && workspaceTab === "pending" && (
            <div className="space-y-4">
              <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 p-3 space-y-2">
                <p className="text-xs text-slate-200 leading-relaxed">
                  Review your pending semantic edits, thread replies, and view
                  requests before prompting the coding agent.
                </p>
                <button
                  type="button"
                  onClick={() =>
                    void copyText(buildAgentPrompt(), "prompt for agent")
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
                            {diff.edges_modified.length} / -
                            {diff.edges_removed.length}
                          </li>
                        )}
                      </ul>
                    </div>
                  ))}

                  {pendingFeedback.pending_threads.length > 0 && (
                    <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 space-y-2">
                      <div className="text-xs font-semibold text-slate-200">
                        Threads Awaiting Agent (
                        {pendingFeedback.pending_threads.length})
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
                          <div className="font-semibold text-slate-100">
                            {r.title}
                          </div>
                          <div className="mt-0.5 text-slate-400">
                            {r.prompt}
                          </div>
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
                    <code className="font-mono text-slate-200">
                      {activeView.id}
                    </code>{" "}
                    has unsynced human changes.
                  </span>
                </div>
              )}
            </div>
          )}

          {/* WORKSPACE TRIAGE: ADRs & VIEW/WORKSPACE THREADS */}
          {mode === "workspace" && workspaceTab === "adrs" && (
            <div className="space-y-4">
              <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3 space-y-1.5 text-[11px] text-slate-300 leading-relaxed">
                <div className="font-semibold text-slate-100 flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                  How Threads &amp; ADRs Work
                </div>
                <p>
                  • <strong className="text-amber-300">Question:</strong> asks
                  for clarification before locking a design.
                </p>
                <p>
                  • <strong className="text-sky-300">Change Request:</strong>{" "}
                  requests the agent to modify a box/edge/view.
                </p>
                <p>
                  • <strong className="text-emerald-300">Decision (ADR):</strong>{" "}
                  resolved threads graduate into persistent{" "}
                  <strong>Architecture Decision Records</strong> so future agent
                  iterations remember <em>why</em> choices were made.
                </p>
              </div>

              <div className="space-y-2">
                <div className="text-xs font-semibold text-emerald-300">
                  Resolved Decisions (ADRs) Across Project
                </div>
                {allThreads.filter((t) => t.status === "resolved").length === 0 ? (
                  <p className="text-xs text-slate-500">
                    No resolved ADRs yet. Resolve any thread to record a
                    decision here.
                  </p>
                ) : (
                  allThreads
                    .filter((t) => t.status === "resolved")
                    .map((t) => (
                      <div
                        key={t.id}
                        className="rounded-lg border border-slate-800 bg-slate-950/60 p-2.5 space-y-1.5"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="text-xs font-medium text-emerald-200">
                            {t.resolution_summary ??
                              t.messages[t.messages.length - 1]?.body}
                          </div>
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
                        </div>
                        <div className="text-[10px] font-mono text-slate-500">
                          {t.view_id ?? "workspace"}
                          {t.target_id ? ` / ${t.target_id}` : ""} •{" "}
                          {t.messages.length} msg(s)
                        </div>
                      </div>
                    ))
                )}
              </div>

              <div className="border-t border-slate-800 pt-3 space-y-2">
                <div className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                  <MessageSquare className="h-3.5 w-3.5 text-sky-400" />
                  View, Workspace &amp; Orphaned Threads
                </div>
                <ThreadPanel
                  threads={viewOrOrphanThreads}
                  targetType={activeView ? "view" : "workspace"}
                  viewId={activeView?.id}
                  onCreateThread={onCreateThread}
                  onReplyThread={onReplyThread}
                  onJumpToTarget={onJumpToTarget}
                  showJumpLinks
                />
              </div>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
