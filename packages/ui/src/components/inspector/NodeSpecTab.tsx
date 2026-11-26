import { useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Database,
  Lock,
  Plus,
  Trash2,
  Unlock,
  X,
} from "lucide-react";
import {
  ENTITY_REF_REGEX,
  type BoxSection,
  type DesignNode,
  type DesignView,
  type EntityField,
  type NodeStatus,
} from "@redlinify/shared/browser";

const STATUS_OPTIONS: NodeStatus[] = [
  "draft",
  "needs_input",
  "approved",
  "implemented",
  "drifted",
];

interface NodeSpecTabProps {
  activeView: DesignView | null;
  selectedNode: DesignNode;
  onSaveNode: (updated: DesignNode) => Promise<void>;
  onDeleteNode: (nodeId: string) => Promise<void>;
}

export function NodeSpecTab({
  activeView,
  selectedNode,
  onSaveNode,
  onDeleteNode,
}: NodeSpecTabProps) {
  const [nodeDraft, setNodeDraft] = useState<DesignNode | null>(selectedNode);
  const [entityRefError, setEntityRefError] = useState<string | null>(null);

  useEffect(() => {
    setNodeDraft(selectedNode ? structuredClone(selectedNode) : null);
    setEntityRefError(null);
  }, [selectedNode]);

  if (!nodeDraft) {
    return null;
  }

  const commitNode = async (next: DesignNode) => {
    setNodeDraft(next);
    await onSaveNode(next);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
        <div className="flex items-center gap-2 text-xs">
          {nodeDraft.locked ? (
            <Lock className="h-3.5 w-3.5 text-violet-400" />
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
              ? "bg-violet-500/20 text-violet-200 border border-violet-500/40"
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
              if (nodeDraft.kind.trim()) {
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
          <p className="mt-1 text-[11px] text-rose-400">{entityRefError}</p>
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
                      onClick={() => updateField({ nullable: !field.nullable })}
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
                      onClick={() => updateField({ unique: !field.unique })}
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
                      onClick={() => updateField({ indexed: !field.indexed })}
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
                      const nextSecs = structuredClone(nodeDraft.sections);
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
                        const nextSecs = structuredClone(nodeDraft.sections);
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
                    const nextSecs = structuredClone(nodeDraft.sections);
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
  );
}
