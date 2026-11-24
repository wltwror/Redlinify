import { createHash } from "node:crypto";
import {
  canonicalEqual,
  canonicalStringify,
  canonicalize,
} from "./canonical.js";
import type { DesignEdge, DesignNode, DesignView, EntityField } from "./schemas.js";

export { canonicalEqual, canonicalStringify, canonicalize };

export function computeContentHash(value: unknown): string {
  return createHash("sha256")
    .update(canonicalStringify(value))
    .digest("hex")
    .slice(0, 16);
}

function normalizeField(field: EntityField): Record<string, unknown> {
  return {
    id: field.id,
    name: field.name,
    type: field.type,
    pk: field.pk === true ? true : undefined,
    fk: field.fk === true ? true : undefined,
    unique: field.unique === true ? true : undefined,
    nullable: field.nullable === true ? true : undefined,
    indexed: field.indexed === true ? true : undefined,
    default_value: field.default_value,
    note: field.note,
  };
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
    fields: node.fields?.map(normalizeField),
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
    source_cardinality: edge.source_cardinality,
    target_cardinality: edge.target_cardinality,
    relation_kind: edge.relation_kind,
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
    diagram_type: view.diagram_type ?? "general",
    direction: view.direction,
    nodes,
    edges,
  };
}

export function computeViewHash(view: DesignView): string {
  return computeContentHash(normalizeViewForHash(view));
}
