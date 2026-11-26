import { useEffect, useState } from "react";
import { Code2, Copy, ExternalLink, Link2 } from "lucide-react";
import type { DesignNode, DesignView } from "@redlinify/shared/browser";
import { fetchCrossLinks, type CrossLinkOccurrence } from "../../api/client";
import type { InspectorDrawerProps } from "./types";

interface NodeLinksTabProps {
  activeView: DesignView | null;
  selectedNode: DesignNode;
  onJumpToTarget: InspectorDrawerProps["onJumpToTarget"];
  onCopyText: (text: string, label: string) => Promise<void>;
}

export function NodeLinksTab({
  activeView,
  selectedNode,
  onJumpToTarget,
  onCopyText,
}: NodeLinksTabProps) {
  const [crossLinks, setCrossLinks] = useState<CrossLinkOccurrence[]>([]);
  const [loadingLinks, setLoadingLinks] = useState(false);

  useEffect(() => {
    if (!selectedNode.entity_ref) {
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
  }, [selectedNode.entity_ref]);

  const otherOccurrences = crossLinks.filter(
    (occ) =>
      !(occ.view_id === activeView?.id && occ.node_id === selectedNode.id),
  );

  return (
    <div className="space-y-4">
      <div>
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-200">
          <Link2 className="h-3.5 w-3.5 text-sky-400" />
          Also In (Cross-Tab Links)
        </h3>
        {!selectedNode.entity_ref ? (
          <p className="text-xs text-slate-500">
            Set an <code className="font-mono">entity_ref</code> in the Spec tab
            to link this concept across multiple diagrams.
          </p>
        ) : loadingLinks ? (
          <p className="text-xs text-slate-500">Scanning diagrams...</p>
        ) : (
          <div className="space-y-1.5">
            {otherOccurrences.map((occ) => (
              <button
                key={`${occ.view_id}:${occ.node_id}`}
                type="button"
                onClick={() =>
                  onJumpToTarget(occ.view_id, "node", occ.node_id, "spec")
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
            {otherOccurrences.length === 0 && (
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
                    onClick={() => void onCopyText(ref.path, ref.path)}
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
  );
}
