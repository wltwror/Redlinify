import type {
  DesignEdge,
  DesignNode,
  DesignView,
  DiagramType,
  SemanticDiff,
} from "@redlinify/shared/browser";

function truncateInline(value: string, maxLen = 40): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, maxLen - 1)}…`;
}

export function getModifiedEdgeIds(diff: SemanticDiff | null): Set<string> {
  const set = new Set<string>();
  if (!diff) return set;
  for (const e of diff.edges_added) set.add(e.id);
  for (const e of diff.edges_modified) set.add(e.id);
  return set;
}

export function summarizeNodeDiff(
  diff: SemanticDiff | null,
  nodeId: string,
  diagramType: DiagramType = "general",
): string[] {
  if (!diff) return [];
  if (diff.nodes_added.some((n) => n.id === nodeId)) {
    return [diagramType === "er" ? "+ Added entity" : "+ Added box"];
  }

  const mod = diff.nodes_modified.find((n) => n.id === nodeId);
  if (!mod) return [];

  const lines: string[] = [];
  const { changes } = mod;

  if (changes.title) {
    lines.push(
      `Title: "${truncateInline(String(changes.title.before ?? ""), 20)}" → "${truncateInline(String(changes.title.after ?? ""), 24)}"`,
    );
  }
  if (changes.kind) {
    lines.push(`Kind: ${String(changes.kind.before)} → ${String(changes.kind.after)}`);
  }
  if (changes.shape) {
    lines.push(`Shape: ${String(changes.shape.before)} → ${String(changes.shape.after)}`);
  }
  if (changes.summary) {
    lines.push(
      changes.summary.after
        ? changes.summary.before
          ? "Updated summary"
          : `Added summary: "${truncateInline(String(changes.summary.after), 28)}"`
        : "Removed summary",
    );
  }
  if (changes.status) {
    lines.push(
      `Status: ${String(changes.status.before)} → ${String(changes.status.after)}`,
    );
  }
  if (changes.locked) {
    lines.push(changes.locked.after ? "Locked" : "Unlocked");
  }
  if (changes.entity_ref) {
    lines.push(
      changes.entity_ref.after
        ? `Ref: ${String(changes.entity_ref.after)}`
        : "Removed entity ref",
    );
  }
  if (changes.code_refs) {
    const afterLen = Array.isArray(changes.code_refs.after)
      ? changes.code_refs.after.length
      : 0;
    const beforeLen = Array.isArray(changes.code_refs.before)
      ? changes.code_refs.before.length
      : 0;
    lines.push(`Code refs: ${beforeLen} → ${afterLen}`);
  }

  for (const s of mod.sections_added) {
    lines.push(`+ Section "${s.heading}" (${s.items.length})`);
  }
  for (const s of mod.sections_removed) {
    lines.push(`- Section "${s.heading}"`);
  }
  for (const s of mod.sections_modified) {
    if (s.heading_changed) {
      lines.push(
        `Section "${s.heading_changed.before}" → "${s.heading_changed.after}"`,
      );
    }
    if (s.added_items.length === 1 && s.removed_items.length === 0) {
      lines.push(`+ ${s.heading}: ${truncateInline(s.added_items[0]!, 32)}`);
    } else if (s.removed_items.length === 1 && s.added_items.length === 0) {
      lines.push(`- ${s.heading}: ${truncateInline(s.removed_items[0]!, 32)}`);
    } else if (s.added_items.length > 0 || s.removed_items.length > 0) {
      const parts: string[] = [];
      if (s.added_items.length > 0) parts.push(`+${s.added_items.length}`);
      if (s.removed_items.length > 0) parts.push(`-${s.removed_items.length}`);
      lines.push(`${s.heading}: ${parts.join(" / ")}`);
    } else if (s.reordered) {
      lines.push(`${s.heading}: reordered`);
    }
  }

  for (const f of mod.fields_added) {
    lines.push(`+ Attr ${f.name}${f.type ? `: ${f.type}` : ""}`);
  }
  for (const f of mod.fields_removed) {
    lines.push(`- Attr ${f.name}`);
  }
  for (const f of mod.fields_modified) {
    const keys = Object.keys(f.changes);
    if (keys.includes("name") && f.changes.name) {
      lines.push(
        `Attr ${String(f.changes.name.before)} → ${String(f.changes.name.after)}`,
      );
    } else if (keys.includes("nullable") && keys.length === 1 && f.changes.nullable) {
      lines.push(
        `Attr ${f.name}: ${f.changes.nullable.after ? "nullable ○" : "NOT NULL *"}`,
      );
    } else {
      lines.push(`~ Attr ${f.name} (${keys.join(", ")})`);
    }
  }

  return lines;
}

export function summarizeEdgeDiff(
  diff: SemanticDiff | null,
  edgeId: string,
): string[] {
  if (!diff) return [];
  if (diff.edges_added.some((e) => e.id === edgeId)) {
    return ["+ Added connection"];
  }

  const mod = diff.edges_modified.find((e) => e.id === edgeId);
  if (!mod) return [];

  const lines: string[] = [];
  const { changes } = mod;
  if (changes.label) {
    lines.push(
      changes.label.after
        ? `Label: "${truncateInline(String(changes.label.after), 28)}"`
        : "Removed label",
    );
  }
  if (changes.source || changes.target) {
    lines.push("Reconnected / flipped direction");
  }
  if (changes.style) {
    lines.push(`Style: ${String(changes.style.after)}`);
  }
  if (changes.source_cardinality || changes.target_cardinality) {
    lines.push("Updated cardinality");
  }
  if (changes.relation_kind) {
    lines.push(`Relation: ${String(changes.relation_kind.after)}`);
  }
  if (changes.locked) {
    lines.push(changes.locked.after ? "Locked edge" : "Unlocked edge");
  }
  if (changes.step) {
    lines.push(
      changes.step.after !== undefined
        ? `Step #${String(changes.step.after)}`
        : "Removed step",
    );
  }
  return lines.length > 0 ? lines : ["Modified connection"];
}

export function revertNodeToBaseline(
  view: DesignView,
  baseline: DesignView | null,
  nodeId: string,
): DesignView | null {
  const baseNode: DesignNode | undefined = baseline?.nodes.find(
    (n) => n.id === nodeId,
  );
  const existsInView = view.nodes.some((n) => n.id === nodeId);

  if (baseNode) {
    const clonedNode = structuredClone(baseNode);
    if (existsInView) {
      return {
        ...view,
        nodes: view.nodes.map((n) => (n.id === nodeId ? clonedNode : n)),
      };
    }

    // Restore deleted node plus any baseline edges connecting it to present nodes
    const nextNodes = [...view.nodes, clonedNode];
    const presentIds = new Set(nextNodes.map((n) => n.id));
    const existingEdgeIds = new Set(view.edges.map((e) => e.id));
    const restoredEdges: DesignEdge[] = [];
    for (const baseEdge of baseline?.edges ?? []) {
      if (
        (baseEdge.source === nodeId || baseEdge.target === nodeId) &&
        !existingEdgeIds.has(baseEdge.id) &&
        presentIds.has(baseEdge.source) &&
        presentIds.has(baseEdge.target)
      ) {
        restoredEdges.push(structuredClone(baseEdge));
      }
    }
    return {
      ...view,
      nodes: nextNodes,
      edges: [...view.edges, ...restoredEdges],
    };
  }

  if (!existsInView) {
    return null;
  }

  // Node was added by human (not in baseline): discard node and incident edges
  return {
    ...view,
    nodes: view.nodes.filter((n) => n.id !== nodeId),
    edges: view.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
  };
}

export function revertEdgeToBaseline(
  view: DesignView,
  baseline: DesignView | null,
  edgeId: string,
): DesignView | null {
  const baseEdge: DesignEdge | undefined = baseline?.edges.find(
    (e) => e.id === edgeId,
  );
  const existsInView = view.edges.some((e) => e.id === edgeId);

  if (baseEdge) {
    const nodeIds = new Set(view.nodes.map((n) => n.id));
    if (!nodeIds.has(baseEdge.source) || !nodeIds.has(baseEdge.target)) {
      return null;
    }
    const clonedEdge = structuredClone(baseEdge);
    if (existsInView) {
      return {
        ...view,
        edges: view.edges.map((e) => (e.id === edgeId ? clonedEdge : e)),
      };
    }
    return {
      ...view,
      edges: [...view.edges, clonedEdge],
    };
  }

  if (!existsInView) {
    return null;
  }

  return {
    ...view,
    edges: view.edges.filter((e) => e.id !== edgeId),
  };
}
