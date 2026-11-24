import { createHash } from "node:crypto";
import {
  canonicalEqual,
  canonicalStringify,
  canonicalize,
} from "./canonical.js";
import type { DesignEdge, DesignNode, DesignView } from "./schemas.js";

export { canonicalEqual, canonicalStringify, canonicalize };

export function computeContentHash(value: unknown): string {
  return createHash("sha256")
    .update(canonicalStringify(value))
    .digest("hex")
    .slice(0, 16);
}

function normalizeNode(node: DesignNode): Record<string, unknown> {
  return {
    id: node.id,
    entity_ref: node.entity_ref,
    kind: node.kind,
    title: node.title,
    summary: node.summary,
    status: node.status,
    locked: node.locked,
    sections: node.sections.map((section) => ({
      id: section.id,
      heading: section.heading,
      items: [...section.items],
    })),
    code_refs: node.code_refs,
  };
}

function normalizeEdge(edge: DesignEdge): Record<string, unknown> {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label,
    step: edge.step,
    style: edge.style,
    locked: edge.locked === true ? true : undefined,
  };
}

/**
 * Produces a canonical representation of semantic view content for hashing.
 * Excludes non-semantic metadata (`created_by`) and sorts nodes/edges by ID
 * so array order changes alone do not trigger spurious concurrency errors.
 */
export function normalizeViewForHash(view: DesignView): Record<string, unknown> {
  const nodes = [...view.nodes]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(normalizeNode);
  const edges = [...view.edges]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(normalizeEdge);

  return {
    id: view.id,
    title: view.title,
    direction: view.direction,
    nodes,
    edges,
  };
}

export function computeViewHash(view: DesignView): string {
  return computeContentHash(normalizeViewForHash(view));
}
