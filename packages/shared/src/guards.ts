import { ZodError } from "zod";
import {
  LockViolationError,
  NotFoundError,
  ValidationError,
  type LockViolation,
} from "./errors.js";
import { canonicalEqual } from "./canonical.js";
import {
  DesignViewSchema,
  ViewPatchSchema,
  type BoxSection,
  type DesignEdge,
  type DesignNode,
  type DesignView,
  type NodeUpdatePatch,
  type SectionPatchOp,
  type ViewPatch,
} from "./schemas.js";

const LOCKED_NODE_SPEC_FIELDS = [
  "entity_ref",
  "kind",
  "title",
  "summary",
  "sections",
] as const;

const LOCKED_NODE_STATUS_FIELDS = ["status", "code_refs"] as const;

const LOCKED_EDGE_FIELDS = [
  "source",
  "target",
  "label",
  "step",
  "style",
] as const;

/**
 * Checks whether an incoming view deletes, unlocks, or mutates any node or edge
 * marked `locked: true` in `existingView`.
 */
export function checkLockViolations(
  existingView: DesignView,
  incomingView: DesignView,
  options?: { allowCodeRefSync?: boolean },
): LockViolation[] {
  const violations: LockViolation[] = [];
  const incomingNodes = new Map(incomingView.nodes.map((n) => [n.id, n]));
  const incomingEdges = new Map(incomingView.edges.map((e) => [e.id, e]));

  for (const existingNode of existingView.nodes) {
    if (!existingNode.locked) continue;
    const incomingNode = incomingNodes.get(existingNode.id);
    if (!incomingNode) {
      violations.push({
        target_type: "node",
        id: existingNode.id,
        title: existingNode.title,
        reason: "deleted",
      });
      continue;
    }
    if (!incomingNode.locked) {
      violations.push({
        target_type: "node",
        id: existingNode.id,
        title: existingNode.title,
        reason: "unlocked",
      });
      continue;
    }

    const fieldsToCheck: readonly string[] = options?.allowCodeRefSync
      ? LOCKED_NODE_SPEC_FIELDS
      : [...LOCKED_NODE_SPEC_FIELDS, ...LOCKED_NODE_STATUS_FIELDS];

    const changedFields: string[] = [];
    for (const field of fieldsToCheck) {
      const prevVal = existingNode[field as keyof DesignNode];
      const nextVal = incomingNode[field as keyof DesignNode];
      if (!canonicalEqual(prevVal, nextVal)) {
        changedFields.push(field);
      }
    }
    if (changedFields.length > 0) {
      violations.push({
        target_type: "node",
        id: existingNode.id,
        title: existingNode.title,
        reason: "modified",
        fields: changedFields,
      });
    }
  }

  for (const existingEdge of existingView.edges) {
    if (existingEdge.locked !== true) continue;
    const incomingEdge = incomingEdges.get(existingEdge.id);
    if (!incomingEdge) {
      violations.push({
        target_type: "edge",
        id: existingEdge.id,
        reason: "deleted",
      });
      continue;
    }
    if (incomingEdge.locked !== true) {
      violations.push({
        target_type: "edge",
        id: existingEdge.id,
        reason: "unlocked",
      });
      continue;
    }

    const changedFields: string[] = [];
    for (const field of LOCKED_EDGE_FIELDS) {
      const prevVal = existingEdge[field];
      const nextVal = incomingEdge[field];
      if (!canonicalEqual(prevVal, nextVal)) {
        changedFields.push(field);
      }
    }
    if (changedFields.length > 0) {
      violations.push({
        target_type: "edge",
        id: existingEdge.id,
        reason: "modified",
        fields: changedFields,
      });
    }
  }

  return violations;
}

/**
 * Preserves existing `code_refs` when an agent calls `upsert_view` without
 * re-sending `code_refs` on nodes that already have implementation links.
 */
export function mergePreservedCodeRefs(
  existingView: DesignView | null,
  incomingView: DesignView,
): DesignView {
  if (!existingView) return incomingView;
  const existingNodes = new Map(existingView.nodes.map((n) => [n.id, n]));
  return {
    ...incomingView,
    nodes: incomingView.nodes.map((node) => {
      if (node.code_refs !== undefined) return node;
      const prev = existingNodes.get(node.id);
      if (prev?.code_refs === undefined) return node;
      return {
        ...node,
        code_refs: structuredClone(prev.code_refs),
      };
    }),
  };
}

function applySectionOps(
  sections: BoxSection[],
  ops: SectionPatchOp[],
  nodeId: string,
): BoxSection[] {
  const next = structuredClone(sections);

  for (const op of ops) {
    if (op.op === "add") {
      if (next.some((s) => s.id === op.section.id)) {
        throw new ValidationError(
          `Section '${op.section.id}' already exists on node '${nodeId}'`,
        );
      }
      const copy = structuredClone(op.section);
      if (op.index !== undefined) {
        const idx = Math.min(op.index, next.length);
        next.splice(idx, 0, copy);
      } else {
        next.push(copy);
      }
      continue;
    }

    if (op.op === "remove") {
      const idx = next.findIndex((s) => s.id === op.id);
      if (idx === -1) {
        throw new NotFoundError(
          `Section '${op.id}' not found on node '${nodeId}'`,
        );
      }
      next.splice(idx, 1);
      continue;
    }

    // op.op === "update"
    const section = next.find((s) => s.id === op.id);
    if (!section) {
      throw new NotFoundError(
        `Section '${op.id}' not found on node '${nodeId}'`,
      );
    }
    if (
      op.items !== undefined &&
      (op.add_items !== undefined || op.remove_items !== undefined)
    ) {
      throw new ValidationError(
        `Section '${op.id}' update cannot specify both 'items' and 'add_items'/'remove_items'`,
      );
    }
    if (op.heading !== undefined) {
      section.heading = op.heading;
    }
    if (op.items !== undefined) {
      section.items = [...op.items];
    } else {
      if (op.remove_items) {
        for (const itemToRemove of op.remove_items) {
          const itemIdx = section.items.indexOf(itemToRemove);
          if (itemIdx !== -1) {
            section.items.splice(itemIdx, 1);
          }
        }
      }
      if (op.add_items) {
        section.items.push(...op.add_items);
      }
    }
  }

  return next;
}

function applyNodeUpdate(node: DesignNode, patch: NodeUpdatePatch): DesignNode {
  if (patch.sections !== undefined && patch.section_ops !== undefined) {
    throw new ValidationError(
      `Node '${node.id}' update cannot specify both 'sections' and 'section_ops'`,
    );
  }

  const next: DesignNode = structuredClone(node);

  if (patch.entity_ref === null) {
    delete next.entity_ref;
  } else if (patch.entity_ref !== undefined) {
    next.entity_ref = patch.entity_ref;
  }

  if (patch.kind !== undefined) next.kind = patch.kind;
  if (patch.title !== undefined) next.title = patch.title;

  if (patch.summary === null) {
    delete next.summary;
  } else if (patch.summary !== undefined) {
    next.summary = patch.summary;
  }

  if (patch.status !== undefined) next.status = patch.status;
  if (patch.locked !== undefined) next.locked = patch.locked;

  if (patch.sections !== undefined) {
    next.sections = structuredClone(patch.sections);
  } else if (patch.section_ops !== undefined) {
    next.sections = applySectionOps(next.sections, patch.section_ops, node.id);
  }

  if (patch.code_refs === null) {
    delete next.code_refs;
  } else if (patch.code_refs !== undefined) {
    next.code_refs = structuredClone(patch.code_refs);
  }

  return next;
}

/**
 * Applies an incremental `ViewPatch` to an existing `DesignView` and validates
 * the resulting graph against `DesignViewSchema`.
 */
export function applyViewPatch(
  existingView: DesignView,
  rawPatch: ViewPatch,
): DesignView {
  let patch: ViewPatch;
  try {
    patch = ViewPatchSchema.parse(rawPatch);
  } catch (err) {
    if (err instanceof ZodError) {
      throw new ValidationError(`Invalid view patch: ${err.message}`, err.issues);
    }
    throw err;
  }

  const next: DesignView = structuredClone(existingView);

  if (patch.meta?.title !== undefined) {
    next.title = patch.meta.title;
  }
  if (patch.meta?.direction !== undefined) {
    next.direction = patch.meta.direction;
  }

  const explicitRemovedEdgeIds = new Set(patch.remove_edges ?? []);
  const cascadeRemovedEdgeIds = new Set<string>();

  if (patch.remove_nodes && patch.remove_nodes.length > 0) {
    const existingNodeIds = new Set(next.nodes.map((n) => n.id));
    const removeSet = new Set(patch.remove_nodes);

    for (const nodeId of removeSet) {
      if (!existingNodeIds.has(nodeId)) {
        throw new NotFoundError(
          `Cannot remove missing node '${nodeId}' from view '${existingView.id}'`,
        );
      }
    }

    const lockedIncidentViolations: LockViolation[] = [];
    for (const edge of next.edges) {
      const touchesRemoved =
        removeSet.has(edge.source) || removeSet.has(edge.target);
      if (!touchesRemoved) continue;

      if (edge.locked === true && !explicitRemovedEdgeIds.has(edge.id)) {
        lockedIncidentViolations.push({
          target_type: "edge",
          id: edge.id,
          reason: "deleted",
        });
      } else {
        cascadeRemovedEdgeIds.add(edge.id);
      }
    }

    if (lockedIncidentViolations.length > 0) {
      throw new LockViolationError(
        lockedIncidentViolations,
        `Cannot remove nodes because incident edge(s) are locked: ${lockedIncidentViolations.map((v) => v.id).join(", ")}`,
      );
    }

    next.nodes = next.nodes.filter((n) => !removeSet.has(n.id));
    next.edges = next.edges.filter((e) => !cascadeRemovedEdgeIds.has(e.id));
  }

  if (patch.add_nodes && patch.add_nodes.length > 0) {
    const existingIds = new Set(next.nodes.map((n) => n.id));
    for (const node of patch.add_nodes) {
      if (existingIds.has(node.id)) {
        throw new ValidationError(
          `Cannot add duplicate node '${node.id}' to view '${existingView.id}'`,
        );
      }
      existingIds.add(node.id);
      next.nodes.push(structuredClone(node));
    }
  }

  if (patch.update_nodes && patch.update_nodes.length > 0) {
    for (const nodePatch of patch.update_nodes) {
      const idx = next.nodes.findIndex((n) => n.id === nodePatch.id);
      if (idx === -1) {
        throw new NotFoundError(
          `Cannot update missing node '${nodePatch.id}' in view '${existingView.id}'`,
        );
      }
      next.nodes[idx] = applyNodeUpdate(next.nodes[idx]!, nodePatch);
    }
  }

  if (patch.remove_edges && patch.remove_edges.length > 0) {
    const remainingEdgeIds = new Set(next.edges.map((e) => e.id));
    const removeEdgeSet = new Set<string>();
    for (const edgeId of patch.remove_edges) {
      if (cascadeRemovedEdgeIds.has(edgeId)) continue;
      if (!remainingEdgeIds.has(edgeId)) {
        throw new NotFoundError(
          `Cannot remove missing edge '${edgeId}' from view '${existingView.id}'`,
        );
      }
      removeEdgeSet.add(edgeId);
    }
    next.edges = next.edges.filter((e) => !removeEdgeSet.has(e.id));
  }

  if (patch.add_edges && patch.add_edges.length > 0) {
    const existingEdgeIds = new Set(next.edges.map((e) => e.id));
    for (const edge of patch.add_edges) {
      if (existingEdgeIds.has(edge.id)) {
        throw new ValidationError(
          `Cannot add duplicate edge '${edge.id}' to view '${existingView.id}'`,
        );
      }
      existingEdgeIds.add(edge.id);
      next.edges.push(structuredClone(edge));
    }
  }

  if (patch.update_edges && patch.update_edges.length > 0) {
    for (const edgePatch of patch.update_edges) {
      const idx = next.edges.findIndex((e) => e.id === edgePatch.id);
      if (idx === -1) {
        throw new NotFoundError(
          `Cannot update missing edge '${edgePatch.id}' in view '${existingView.id}'`,
        );
      }
      const updated: DesignEdge = structuredClone(next.edges[idx]!);
      if (edgePatch.source !== undefined) updated.source = edgePatch.source;
      if (edgePatch.target !== undefined) updated.target = edgePatch.target;

      if (edgePatch.label === null) delete updated.label;
      else if (edgePatch.label !== undefined) updated.label = edgePatch.label;

      if (edgePatch.step === null) delete updated.step;
      else if (edgePatch.step !== undefined) updated.step = edgePatch.step;

      if (edgePatch.style === null) delete updated.style;
      else if (edgePatch.style !== undefined) updated.style = edgePatch.style;

      if (edgePatch.locked === null) delete updated.locked;
      else if (edgePatch.locked !== undefined) updated.locked = edgePatch.locked;

      next.edges[idx] = updated;
    }
  }

  try {
    return DesignViewSchema.parse(next);
  } catch (err) {
    if (err instanceof ZodError) {
      throw new ValidationError(
        `Patched view '${existingView.id}' failed validation: ${err.message}`,
        err.issues,
      );
    }
    throw err;
  }
}
