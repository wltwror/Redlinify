import { useState } from "react";
import { X } from "lucide-react";

interface EdgeCreateModalProps {
  sourceTitle: string;
  targetTitle: string;
  onCancel: () => void;
  onConfirm: (input: {
    label?: string;
    step?: number;
    style: "solid" | "dashed";
  }) => void;
}

export function EdgeCreateModal({
  sourceTitle,
  targetTitle,
  onCancel,
  onConfirm,
}: EdgeCreateModalProps) {
  const [label, setLabel] = useState("");
  const [step, setStep] = useState("");
  const [style, setStyle] = useState<"solid" | "dashed">("solid");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-xl border border-slate-700 bg-slate-900 p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-100">
            Connect Nodes
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
              Create Edge
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
