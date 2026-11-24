import { memo, useState } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import {
  ChevronDown,
  ChevronUp,
  Code2,
  Link2,
  Lock,
  MessageSquare,
  Unlock,
} from "lucide-react";
import type {
  DesignNode,
  NodeStatus,
  ViewDirection,
} from "@redlinify/shared/browser";
import { MAX_VISIBLE_SECTION_ITEMS } from "../layout/elk";

export interface StructuredNodeData extends Record<string, unknown> {
  node: DesignNode;
  direction: ViewDirection;
  isHumanEdited: boolean;
  waitingOnHumanCount: number;
  totalOpenThreads: number;
  dimmed: boolean;
  pulsing: boolean;
  onToggleLock: (nodeId: string) => void;
  onInlineUpdateTitle: (nodeId: string, nextTitle: string) => void;
  onInlineUpdateItem: (
    nodeId: string,
    sectionId: string,
    itemIndex: number,
    nextValue: string,
  ) => void;
  onOpenNodeThreads: (nodeId: string) => void;
}

export type StructuredFlowNode = Node<StructuredNodeData, "structured">;

const STATUS_BADGE: Record<NodeStatus, { label: string; classes: string }> = {
  draft: {
    label: "draft",
    classes: "bg-slate-800 text-slate-300 border-slate-700",
  },
  needs_input: {
    label: "needs input",
    classes: "bg-amber-500/15 text-amber-300 border-amber-500/40",
  },
  approved: {
    label: "approved",
    classes: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
  },
  implemented: {
    label: "implemented",
    classes: "bg-teal-500/15 text-teal-300 border-teal-500/40",
  },
  drifted: {
    label: "drifted",
    classes: "bg-rose-500/20 text-rose-300 border-rose-500/50",
  },
};

function StructuredNodeComponent({
  data,
  selected,
}: NodeProps<StructuredFlowNode>) {
  const {
    node,
    direction,
    isHumanEdited,
    waitingOnHumanCount,
    totalOpenThreads,
    dimmed,
    pulsing,
    onToggleLock,
    onInlineUpdateTitle,
    onInlineUpdateItem,
    onOpenNodeThreads,
  } = data;

  const [expandedSections, setExpandedSections] = useState<
    Record<string, boolean>
  >({});
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(node.title);
  const [editingItem, setEditingItem] = useState<{
    sectionId: string;
    index: number;
    draft: string;
  } | null>(null);

  const statusMeta = STATUS_BADGE[node.status];
  const targetPos = direction === "LR" ? Position.Left : Position.Top;
  const sourcePos = direction === "LR" ? Position.Right : Position.Bottom;

  let cardBorder = "border-slate-700/90";
  if (selected) {
    cardBorder = "border-sky-400 ring-2 ring-sky-500/40";
  } else if (node.status === "drifted") {
    cardBorder = "border-rose-500/80 ring-1 ring-rose-500/30";
  } else if (isHumanEdited) {
    cardBorder = "border-sky-500/80 ring-2 ring-sky-500/25";
  } else if (waitingOnHumanCount > 0) {
    cardBorder = "border-amber-500/75 ring-1 ring-amber-500/25";
  }

  const commitTitle = () => {
    setEditingTitle(false);
    const trimmed = titleDraft.trim();
    if (trimmed && trimmed !== node.title) {
      onInlineUpdateTitle(node.id, trimmed);
    } else {
      setTitleDraft(node.title);
    }
  };

  const commitItem = () => {
    if (!editingItem) return;
    const { sectionId, index, draft } = editingItem;
    setEditingItem(null);
    onInlineUpdateItem(node.id, sectionId, index, draft);
  };

  return (
    <div
      className={`relative min-w-[270px] max-w-[340px] rounded-xl border bg-slate-900/95 shadow-xl backdrop-blur-sm transition-all ${cardBorder} ${
        dimmed ? "opacity-25" : "opacity-100"
      } ${pulsing ? "redlinify-pulse-ring" : ""}`}
    >
      <Handle
        type="target"
        position={targetPos}
        className="!h-3 !w-3 !border-2 !border-slate-900 !bg-sky-400 hover:!scale-125 transition-transform"
      />

      {/* Top header */}
      <div className="flex items-center justify-between gap-2 rounded-t-xl border-b border-slate-800 bg-slate-900 px-3 py-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="shrink-0 rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-sky-300 border border-slate-700">
            {node.kind}
          </span>
          <span
            className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${statusMeta.classes}`}
          >
            {statusMeta.label}
          </span>
          {isHumanEdited && (
            <span
              title="Modified by human since last agent checkpoint"
              className="shrink-0 rounded-full bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-medium text-sky-300 border border-sky-500/30"
            >
              edited
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {totalOpenThreads > 0 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenNodeThreads(node.id);
              }}
              title={`${totalOpenThreads} open thread(s)`}
              className={`nodrag inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${
                waitingOnHumanCount > 0
                  ? "border-amber-500/40 bg-amber-500/20 text-amber-200"
                  : "border-slate-700 bg-slate-800 text-slate-300"
              }`}
            >
              <MessageSquare className="h-2.5 w-2.5" />
              {totalOpenThreads}
            </button>
          )}

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleLock(node.id);
            }}
            title={
              node.locked
                ? "Locked (agent cannot mutate). Click to unlock."
                : "Unlocked. Click to lock."
            }
            className={`nodrag rounded p-1 transition-colors ${
              node.locked
                ? "bg-amber-500/15 text-amber-300 hover:bg-amber-500/25"
                : "text-slate-500 hover:bg-slate-800 hover:text-slate-200"
            }`}
          >
            {node.locked ? (
              <Lock className="h-3.5 w-3.5" />
            ) : (
              <Unlock className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* Title & optional summary */}
      <div className="px-3 py-2">
        {editingTitle ? (
          <input
            type="text"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitTitle();
              if (e.key === "Escape") {
                setTitleDraft(node.title);
                setEditingTitle(false);
              }
            }}
            autoFocus
            className="nodrag w-full rounded border border-sky-500 bg-slate-950 px-1.5 py-0.5 text-sm font-semibold text-slate-100 focus:outline-none"
          />
        ) : (
          <div
            onDoubleClick={(e) => {
              if (node.locked) return;
              e.stopPropagation();
              setTitleDraft(node.title);
              setEditingTitle(true);
            }}
            title={
              node.locked
                ? "Locked node (unlock to edit)"
                : "Double-click to edit title"
            }
            className="text-sm font-semibold text-slate-100 leading-snug break-words"
          >
            {node.title}
          </div>
        )}

        {node.summary && (
          <p className="mt-1 text-[11px] text-slate-400 leading-relaxed line-clamp-2">
            {node.summary}
          </p>
        )}
      </div>

      {/* Sections */}
      {node.sections.length > 0 && (
        <div className="divide-y divide-slate-800 border-t border-slate-800">
          {node.sections.map((section) => {
            const isExpanded = expandedSections[section.id] === true;
            const visibleItems = isExpanded
              ? section.items
              : section.items.slice(0, MAX_VISIBLE_SECTION_ITEMS);
            const hiddenCount = Math.max(
              0,
              section.items.length - MAX_VISIBLE_SECTION_ITEMS,
            );

            return (
              <div key={section.id} className="px-3 py-2">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    {section.heading}
                  </span>
                  <span className="text-[10px] font-mono text-slate-600">
                    {section.items.length}
                  </span>
                </div>

                {section.items.length === 0 ? (
                  <p className="text-[11px] italic text-slate-600">No items</p>
                ) : (
                  <ul className="space-y-0.5">
                    {visibleItems.map((item, idx) => {
                      const activeItemEdit =
                        editingItem &&
                        editingItem.sectionId === section.id &&
                        editingItem.index === idx
                          ? editingItem
                          : null;

                      return (
                        <li key={`${section.id}-${idx}`} className="text-xs">
                          {activeItemEdit ? (
                            <input
                              type="text"
                              value={activeItemEdit.draft}
                              onChange={(e) =>
                                setEditingItem({
                                  sectionId: section.id,
                                  index: idx,
                                  draft: e.target.value,
                                })
                              }
                              onBlur={commitItem}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") commitItem();
                                if (e.key === "Escape") setEditingItem(null);
                              }}
                              autoFocus
                              className="nodrag w-full rounded border border-sky-500 bg-slate-950 px-1.5 py-0.5 font-mono text-[11px] text-slate-100 focus:outline-none"
                            />
                          ) : (
                            <div
                              onDoubleClick={(e) => {
                                if (node.locked) return;
                                e.stopPropagation();
                                setEditingItem({
                                  sectionId: section.id,
                                  index: idx,
                                  draft: item,
                                });
                              }}
                              title={
                                node.locked
                                  ? "Locked node"
                                  : "Double-click to edit line"
                              }
                              className="truncate rounded px-1 py-0.5 font-mono text-[11px] text-slate-200 hover:bg-slate-800/70"
                            >
                              {item}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}

                {hiddenCount > 0 && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpandedSections((prev) => ({
                        ...prev,
                        [section.id]: !isExpanded,
                      }));
                    }}
                    className="nodrag mt-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-sky-400 hover:bg-slate-800"
                  >
                    {isExpanded ? (
                      <>
                        <ChevronUp className="h-3 w-3" /> Show less
                      </>
                    ) : (
                      <>
                        <ChevronDown className="h-3 w-3" /> +{hiddenCount} more
                      </>
                    )}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Footer metadata */}
      {(node.entity_ref || (node.code_refs && node.code_refs.length > 0)) && (
        <div className="flex items-center justify-between gap-2 rounded-b-xl border-t border-slate-800/90 bg-slate-950/60 px-3 py-1.5 text-[10px] text-slate-400">
          <div className="flex items-center gap-1 truncate">
            {node.entity_ref && (
              <span className="inline-flex items-center gap-1 truncate font-mono text-slate-400">
                <Link2 className="h-2.5 w-2.5 shrink-0 text-sky-400" />
                {node.entity_ref}
              </span>
            )}
          </div>
          {node.code_refs && node.code_refs.length > 0 && (
            <span className="inline-flex shrink-0 items-center gap-1 font-mono text-emerald-300">
              <Code2 className="h-2.5 w-2.5" />
              {node.code_refs.length} ref{node.code_refs.length > 1 ? "s" : ""}
            </span>
          )}
        </div>
      )}

      <Handle
        type="source"
        position={sourcePos}
        className="!h-3 !w-3 !border-2 !border-slate-900 !bg-sky-400 hover:!scale-125 transition-transform"
      />
    </div>
  );
}

export const StructuredNode = memo(StructuredNodeComponent);
