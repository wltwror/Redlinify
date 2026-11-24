import { memo, useState } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import {
  ChevronDown,
  ChevronUp,
  Code2,
  Database,
  KeyRound,
  Link2,
  Lock,
  MessageSquare,
  Plus,
  Unlock,
} from "lucide-react";
import type {
  DesignNode,
  DiagramType,
  EntityField,
  NodeStatus,
} from "@redlinify/shared/browser";
import {
  MAX_VISIBLE_ER_FIELDS,
  MAX_VISIBLE_SECTION_ITEMS,
} from "../layout/elk";

export interface StructuredNodeData extends Record<string, unknown> {
  node: DesignNode;
  diagramType: DiagramType;
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
  onInlineAddItem: (nodeId: string, sectionId: string, item: string) => void;
  onInlineToggleFieldNullable: (nodeId: string, fieldId: string) => void;
  onInlineUpdateFieldName: (
    nodeId: string,
    fieldId: string,
    nextName: string,
  ) => void;
  onInlineAddField: (nodeId: string, name: string) => void;
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

function FieldBadges({ field }: { field: EntityField }) {
  return (
    <span className="flex items-center gap-1 shrink-0">
      {field.pk && (
        <span className="inline-flex items-center gap-0.5 rounded bg-amber-500/20 px-1 py-0.2 text-[9px] font-bold text-amber-300 border border-amber-500/40">
          <KeyRound className="h-2.5 w-2.5" />
          PK
        </span>
      )}
      {field.fk && (
        <span className="rounded bg-sky-500/20 px-1 py-0.2 text-[9px] font-bold text-sky-300 border border-sky-500/40">
          FK
        </span>
      )}
      {field.unique && (
        <span className="rounded bg-violet-500/20 px-1 py-0.2 text-[9px] font-bold text-violet-300 border border-violet-500/40">
          UQ
        </span>
      )}
      {field.indexed && (
        <span className="rounded bg-slate-700/70 px-1 py-0.2 text-[9px] font-semibold text-slate-300 border border-slate-600">
          IDX
        </span>
      )}
    </span>
  );
}

function StructuredNodeComponent({
  data,
  selected,
}: NodeProps<StructuredFlowNode>) {
  const {
    node,
    diagramType,
    isHumanEdited,
    waitingOnHumanCount,
    totalOpenThreads,
    dimmed,
    pulsing,
    onToggleLock,
    onInlineUpdateTitle,
    onInlineUpdateItem,
    onInlineAddItem,
    onInlineToggleFieldNullable,
    onInlineUpdateFieldName,
    onInlineAddField,
    onOpenNodeThreads,
  } = data;

  const [expandedSections, setExpandedSections] = useState<
    Record<string, boolean>
  >({});
  const [fieldsExpanded, setFieldsExpanded] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(node.title);
  const [editingItem, setEditingItem] = useState<{
    sectionId: string;
    index: number;
    draft: string;
  } | null>(null);
  const [addingSectionId, setAddingSectionId] = useState<string | null>(null);
  const [newItemDraft, setNewItemDraft] = useState("");
  const [editingField, setEditingField] = useState<{
    fieldId: string;
    draft: string;
  } | null>(null);
  const [addingField, setAddingField] = useState(false);
  const [newFieldDraft, setNewFieldDraft] = useState("");

  const statusMeta = STATUS_BADGE[node.status];
  const isErMode = diagramType === "er" || (node.fields && node.fields.length > 0);
  const fields = node.fields ?? [];
  const visibleFields = fieldsExpanded
    ? fields
    : fields.slice(0, MAX_VISIBLE_ER_FIELDS);
  const hiddenFieldsCount = Math.max(0, fields.length - MAX_VISIBLE_ER_FIELDS);

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

  const commitNewItem = (sectionId: string) => {
    const val = newItemDraft.trim();
    setAddingSectionId(null);
    setNewItemDraft("");
    if (val) {
      onInlineAddItem(node.id, sectionId, val);
    }
  };

  const commitFieldName = () => {
    if (!editingField) return;
    const { fieldId, draft } = editingField;
    setEditingField(null);
    const trimmed = draft.trim();
    if (trimmed) {
      onInlineUpdateFieldName(node.id, fieldId, trimmed);
    }
  };

  const commitNewField = () => {
    const val = newFieldDraft.trim();
    setAddingField(false);
    setNewFieldDraft("");
    if (val) {
      onInlineAddField(node.id, val);
    }
  };

  const handleClass =
    "!h-3.5 !w-3.5 !z-20 redlinify-handle !border-2 !border-slate-900 !bg-sky-400/90 opacity-75 group-hover:opacity-100 hover:!bg-sky-300 hover:!scale-125 transition-all";

  return (
    <div
      className={`group relative min-w-[270px] max-w-[350px] rounded-xl border bg-slate-900/95 shadow-xl backdrop-blur-sm transition-all ${cardBorder} ${
        dimmed ? "opacity-25" : "opacity-100"
      } ${pulsing ? "redlinify-pulse-ring" : ""}`}
    >
      {/* 4-sided connection handles (all usable as source & target via ConnectionMode.Loose) */}
      <Handle id="top" type="source" position={Position.Top} className={handleClass} />
      <Handle id="right" type="source" position={Position.Right} className={handleClass} />
      <Handle id="bottom" type="source" position={Position.Bottom} className={handleClass} />
      <Handle id="left" type="source" position={Position.Left} className={handleClass} />

      {/* Top header */}
      <div className="flex items-center justify-between gap-2 rounded-t-xl border-b border-slate-800 bg-slate-900 px-3 py-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="inline-flex shrink-0 items-center gap-1 rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-sky-300 border border-slate-700">
            {isErMode && <Database className="h-2.5 w-2.5 text-emerald-400" />}
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

      {/* ER Entity Attributes */}
      {isErMode && (
        <div className="border-t border-slate-800 px-3 py-2">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400/90">
              Attributes
            </span>
            <span className="text-[10px] font-mono text-slate-600">
              {fields.length}
            </span>
          </div>

          {fields.length === 0 && !addingField ? (
            <p className="text-[11px] italic text-slate-600">No attributes</p>
          ) : (
            <ul className="space-y-1">
              {visibleFields.map((field) => {
                const isEditingThis = editingField?.fieldId === field.id;
                return (
                  <li
                    key={field.id}
                    className="flex items-center justify-between gap-1.5 rounded px-1 py-0.5 text-[11px] hover:bg-slate-800/60"
                  >
                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                      <button
                        type="button"
                        disabled={node.locked}
                        onClick={(e) => {
                          e.stopPropagation();
                          onInlineToggleFieldNullable(node.id, field.id);
                        }}
                        title={
                          field.nullable
                            ? "Nullable (optional ○) — click to mark mandatory (*)"
                            : "Mandatory (NOT NULL *) — click to mark nullable (○)"
                        }
                        className={`nodrag w-3.5 shrink-0 text-center font-mono text-xs font-bold leading-none ${
                          field.nullable
                            ? "text-slate-400 hover:text-amber-300"
                            : "text-rose-400 hover:text-rose-300"
                        } disabled:opacity-60`}
                      >
                        {field.nullable ? "○" : "*"}
                      </button>

                      {isEditingThis ? (
                        <input
                          type="text"
                          value={editingField.draft}
                          onChange={(e) =>
                            setEditingField({
                              fieldId: field.id,
                              draft: e.target.value,
                            })
                          }
                          onBlur={commitFieldName}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitFieldName();
                            if (e.key === "Escape") setEditingField(null);
                          }}
                          autoFocus
                          className="nodrag w-full rounded border border-sky-500 bg-slate-950 px-1 py-0.2 font-mono text-[11px] text-slate-100 focus:outline-none"
                        />
                      ) : (
                        <span
                          onDoubleClick={(e) => {
                            if (node.locked) return;
                            e.stopPropagation();
                            setEditingField({
                              fieldId: field.id,
                              draft: field.name,
                            });
                          }}
                          className="truncate font-mono text-slate-100"
                        >
                          {field.name}
                          {field.type && (
                            <span className="text-slate-400">
                              : {field.type}
                            </span>
                          )}
                        </span>
                      )}
                    </div>

                    <FieldBadges field={field} />
                  </li>
                );
              })}
            </ul>
          )}

          {hiddenFieldsCount > 0 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setFieldsExpanded((v) => !v);
              }}
              className="nodrag mt-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-sky-400 hover:bg-slate-800"
            >
              {fieldsExpanded ? (
                <>
                  <ChevronUp className="h-3 w-3" /> Show less
                </>
              ) : (
                <>
                  <ChevronDown className="h-3 w-3" /> +{hiddenFieldsCount} more
                </>
              )}
            </button>
          )}

          {!node.locked && (
            <div className="mt-1.5">
              {addingField ? (
                <input
                  type="text"
                  value={newFieldDraft}
                  onChange={(e) => setNewFieldDraft(e.target.value)}
                  onBlur={commitNewField}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitNewField();
                    if (e.key === "Escape") {
                      setAddingField(false);
                      setNewFieldDraft("");
                    }
                  }}
                  placeholder="column_name"
                  autoFocus
                  className="nodrag w-full rounded border border-sky-500 bg-slate-950 px-2 py-0.5 font-mono text-[11px] text-slate-100 placeholder:text-slate-600 focus:outline-none"
                />
              ) : (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setAddingField(true);
                  }}
                  className="nodrag inline-flex items-center gap-1 rounded px-1 py-0.5 text-[10px] text-slate-400 hover:bg-slate-800 hover:text-sky-300"
                >
                  <Plus className="h-2.5 w-2.5" /> Add attribute
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* General Box Sections */}
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
                  <div className="flex items-center gap-1.5">
                    {!node.locked && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setAddingSectionId(section.id);
                          setNewItemDraft("");
                        }}
                        title={`Add line to ${section.heading}`}
                        className="nodrag rounded p-0.5 text-slate-500 opacity-0 group-hover:opacity-100 hover:bg-slate-800 hover:text-sky-300 transition-opacity"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    )}
                    <span className="text-[10px] font-mono text-slate-600">
                      {section.items.length}
                    </span>
                  </div>
                </div>

                {section.items.length === 0 && addingSectionId !== section.id ? (
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

                {addingSectionId === section.id && (
                  <input
                    type="text"
                    value={newItemDraft}
                    onChange={(e) => setNewItemDraft(e.target.value)}
                    onBlur={() => commitNewItem(section.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitNewItem(section.id);
                      if (e.key === "Escape") {
                        setAddingSectionId(null);
                        setNewItemDraft("");
                      }
                    }}
                    placeholder="New entry..."
                    autoFocus
                    className="nodrag mt-1 w-full rounded border border-sky-500 bg-slate-950 px-1.5 py-0.5 font-mono text-[11px] text-slate-100 placeholder:text-slate-600 focus:outline-none"
                  />
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
    </div>
  );
}

export const StructuredNode = memo(StructuredNodeComponent);
