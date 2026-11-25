import { useState } from "react";
import { X } from "lucide-react";
import type {
  Cardinality,
  DiagramType,
  RelationKind,
} from "@redlinify/shared/browser";

interface EdgeCreateModalProps {
  diagramType: DiagramType;
  sourceTitle: string;
  targetTitle: string;
  onCancel: () => void;
  onConfirm: (input: {
    label?: string;
    step?: number;
    style: "solid" | "dashed";
    source_cardinality?: Cardinality;
    target_cardinality?: Cardinality;
    relation_kind?: RelationKind;
  }) => void;
}

const CARDINALITIES: Array<{ value: Cardinality; label: string }> = [
  { value: "1", label: "1 (mandatory one)" },
  { value: "0..1", label: "0..1 (optional one)" },
  { value: "1..*", label: "1..* (mandatory many)" },
  { value: "0..*", label: "0..* (optional many)" },
];

export function EdgeCreateModal({
  diagramType,
  sourceTitle,
  targetTitle,
  onCancel,
  onConfirm,
}: EdgeCreateModalProps) {
  const [label, setLabel] = useState("");
  const [step, setStep] = useState("");
  const [style, setStyle] = useState<"solid" | "dashed">("solid");
  const [sourceCard, setSourceCard] = useState<Cardinality>("1");
  const [targetCard, setTargetCard] = useState<Cardinality>("0..*");
  const [relationKind, setRelationKind] = useState<RelationKind>("association");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (diagramType === "er") {
      onConfirm({
        label: label.trim() || undefined,
        style: "solid",
        relation_kind: relationKind,
        ...(relationKind !== "subtype"
          ? {
              source_cardinality: sourceCard,
              target_cardinality: targetCard,
            }
          : {}),
      });
      return;
    }

    const parsedStep = step.trim() ? Number(step.trim()) : undefined;
    onConfirm({
      label: label.trim() || undefined,
      step:
        parsedStep !== undefined && Number.isInteger(parsedStep) && parsedStep > 0
          ? parsedStep
          : undefined,
      style,
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={diagramType === "er" ? "Connect Entities" : "Connect Nodes"}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-sm rounded-xl border border-slate-700 bg-slate-900 p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-100">
            {diagramType === "er" ? "Connect Entities" : "Connect Nodes"}
          </h3>
          <button
            type="button"
            onClick={onCancel}
            className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mb-3 text-xs text-slate-400">
          <span className="font-medium text-slate-200">{sourceTitle}</span>
          {" → "}
          <span className="font-medium text-slate-200">{targetTitle}</span>
        </p>

        <form onSubmit={handleSubmit} className="space-y-3">
          {diagramType === "er" ? (
            <>
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    { label: "1 : 0..*", s: "1", t: "0..*", k: "association" },
                    { label: "1 : 1..*", s: "1", t: "1..*", k: "association" },
                    { label: "1 : 0..1", s: "1", t: "0..1", k: "association" },
                    { label: "0..* : 0..*", s: "0..*", t: "0..*", k: "association" },
                    { label: "Subtype (is-a)", s: "1", t: "1", k: "subtype" },
                  ] as const
                ).map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => {
                      setSourceCard(preset.s);
                      setTargetCard(preset.t);
                      setRelationKind(preset.k);
                    }}
                    className={`rounded border px-2 py-0.5 text-[11px] font-mono ${
                      relationKind === preset.k &&
                      (preset.k === "subtype" ||
                        (sourceCard === preset.s && targetCard === preset.t))
                        ? "border-emerald-500 bg-emerald-500/15 text-emerald-200"
                        : "border-slate-700 bg-slate-950 text-slate-300 hover:bg-slate-800"
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Relationship Kind
                </label>
                <select
                  value={relationKind}
                  onChange={(e) =>
                    setRelationKind(e.target.value as RelationKind)
                  }
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
                >
                  <option value="association">Association (FK)</option>
                  <option value="identifying">Identifying (PK+FK)</option>
                  <option value="subtype">Subtype / Inheritance (is-a)</option>
                </select>
              </div>

              {relationKind !== "subtype" && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-400 mb-1">
                      {sourceTitle} side
                    </label>
                    <select
                      value={sourceCard}
                      onChange={(e) =>
                        setSourceCard(e.target.value as Cardinality)
                      }
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
                    >
                      {CARDINALITIES.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-400 mb-1">
                      {targetTitle} side
                    </label>
                    <select
                      value={targetCard}
                      onChange={(e) =>
                        setTargetCard(e.target.value as Cardinality)
                      }
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
                    >
                      {CARDINALITIES.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Verb / Label (optional)
                </label>
                <input
                  type="text"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="e.g. places, belongs to, assigned to"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
                  autoFocus
                />
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Label (optional)
                </label>
                <input
                  type="text"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="e.g. validates, writes to, calls"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
                  autoFocus
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Step # (optional)
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={step}
                    onChange={(e) => setStep(e.target.value)}
                    placeholder="1, 2, 3..."
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Line Style
                  </label>
                  <select
                    value={style}
                    onChange={(e) =>
                      setStyle(e.target.value === "dashed" ? "dashed" : "solid")
                    }
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
                  >
                    <option value="solid">Solid</option>
                    <option value="dashed">Dashed</option>
                  </select>
                </div>
              </div>
            </>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-lg bg-sky-500 px-3.5 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-400"
            >
              Create Relationship
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
