import { useState, type FormEvent } from "react";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Plus,
  RotateCcw,
  Send,
} from "lucide-react";
import {
  isThreadWaitingOnAgent,
  isThreadWaitingOnHuman,
  type DesignThread,
  type ThreadKind,
  type ThreadTargetType,
} from "@redlinify/shared/browser";
import type { InspectorDrawerProps } from "./types";

interface ThreadPanelProps {
  threads: DesignThread[];
  targetType: ThreadTargetType;
  viewId?: string;
  targetId?: string;
  entityRef?: string;
  onCreateThread: InspectorDrawerProps["onCreateThread"];
  onReplyThread: InspectorDrawerProps["onReplyThread"];
  onJumpToTarget?: InspectorDrawerProps["onJumpToTarget"];
  showJumpLinks?: boolean;
}

export function ThreadPanel({
  threads,
  targetType,
  viewId,
  targetId,
  entityRef,
  onCreateThread,
  onReplyThread,
  onJumpToTarget,
  showJumpLinks = false,
}: ThreadPanelProps) {
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

  const handleCreate = async (e: FormEvent) => {
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
              Resolved Decisions
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
                    <div className="flex items-start gap-2 text-[11px] font-medium text-slate-100 leading-relaxed">
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400 mt-0.5" />
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
