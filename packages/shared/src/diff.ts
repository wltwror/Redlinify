import { canonicalEqual } from "./canonical.js";
import type {
  BoxSection,
  DesignEdge,
  DesignNode,
  DesignView,
  EntityField,
} from "./schemas.js";

export interface SectionDiff {
  id: string;
  heading: string;
  heading_changed?: { before: string; after: string };
  added_items: string[];
  removed_items: string[];
  reordered: boolean;
}

export interface FieldDiff {
  id: string;
  name: string;
  changes: Record<string, { before: unknown; after: unknown }>;
}

export interface NodeDiff {
  id: string;
  title: string;
  changes: Record<string, { before: unknown; after: unknown }>;
  sections_added: BoxSection[];
  sections_removed: Array<{ id: string; heading: string }>;
  sections_modified: SectionDiff[];
  fields_added: EntityField[];
  fields_removed: Array<{ id: string; name: string }>;
  fields_modified: FieldDiff[];
}

export interface EdgeDiff {
  id: string;
  source: string;
  target: string;
  changes: Record<string, { before: unknown; after: unknown }>;
}

export interface SemanticDiff {
  view_id: string;
  has_changes: boolean;
  baseline_missing: boolean;
  view_meta_changed: Partial<
    Record<"title" | "direction" | "diagram_type", { before: string; after: string }>
  >;
  nodes_added: DesignNode[];
  nodes_removed: Array<{ id: string; title: string }>;
  nodes_modified: NodeDiff[];
  edges_added: DesignEdge[];
  edges_removed: Array<{
    id: string;
    source: string;
    target: string;
    label?: string;
  }>;
  edges_modified: EdgeDiff[];
}

function diffItemLists(
  beforeItems: string[],
  afterItems: string[],
): { added_items: string[]; removed_items: string[]; reordered: boolean } {
  const beforeCounts = new Map<string, number>();
  for (const item of beforeItems) {
    beforeCounts.set(item, (beforeCounts.get(item) ?? 0) + 1);
  }

  const afterCounts = new Map<string, number>();
  for (const item of afterItems) {
    afterCounts.set(item, (afterCounts.get(item) ?? 0) + 1);
  }

  const added_items: string[] = [];
  const remainingBefore = new Map(beforeCounts);
  for (const item of afterItems) {
    const count = remainingBefore.get(item) ?? 0;
    if (count > 0) {
      remainingBefore.set(item, count - 1);
    } else {
      added_items.push(item);
    }
  }

  const removed_items: string[] = [];
  const remainingAfter = new Map(afterCounts);
  for (const item of beforeItems) {
    const count = remainingAfter.get(item) ?? 0;
    if (count > 0) {
      remainingAfter.set(item, count - 1);
    } else {
      removed_items.push(item);
    }
  }

  const reordered =
    added_items.length === 0 &&
    removed_items.length === 0 &&
    !canonicalEqual(beforeItems, afterItems);

  return { added_items, removed_items, reordered };
}

function diffSections(
  beforeSections: BoxSection[],
  afterSections: BoxSection[],
): {
  sections_added: BoxSection[];
  sections_removed: Array<{ id: string; heading: string }>;
  sections_modified: SectionDiff[];
} {
  const afterById = new Map(afterSections.map((s) => [s.id, s]));
  const matchedBeforeIds = new Set<string>();
  const matchedAfterIds = new Set<string>();
  const pairs: Array<{ before: BoxSection; after: BoxSection }> = [];

  for (const beforeSec of beforeSections) {
    const afterSec = afterById.get(beforeSec.id);
    if (afterSec) {
      pairs.push({ before: beforeSec, after: afterSec });
      matchedBeforeIds.add(beforeSec.id);
      matchedAfterIds.add(afterSec.id);
    }
  }

  const unmatchedBefore = beforeSections.filter((s) => !matchedBeforeIds.has(s.id));
  const unmatchedAfter = afterSections.filter((s) => !matchedAfterIds.has(s.id));

  const beforeHeadingCounts = new Map<string, number>();
  for (const s of unmatchedBefore) {
    beforeHeadingCounts.set(s.heading, (beforeHeadingCounts.get(s.heading) ?? 0) + 1);
  }
  const afterHeadingCounts = new Map<string, number>();
  for (const s of unmatchedAfter) {
    afterHeadingCounts.set(s.heading, (afterHeadingCounts.get(s.heading) ?? 0) + 1);
  }

  for (const beforeSec of unmatchedBefore) {
    if (beforeHeadingCounts.get(beforeSec.heading) !== 1) continue;
    if (afterHeadingCounts.get(beforeSec.heading) !== 1) continue;
    const afterSec = unmatchedAfter.find((s) => s.heading === beforeSec.heading);
    if (afterSec) {
      pairs.push({ before: beforeSec, after: afterSec });
      matchedBeforeIds.add(beforeSec.id);
      matchedAfterIds.add(afterSec.id);
    }
  }

  const sections_added = afterSections.filter((s) => !matchedAfterIds.has(s.id));
  const sections_removed = beforeSections
    .filter((s) => !matchedBeforeIds.has(s.id))
    .map((s) => ({ id: s.id, heading: s.heading }));

  const sections_modified: SectionDiff[] = [];
  for (const { before, after } of pairs) {
    const heading_changed =
      before.heading !== after.heading
        ? { before: before.heading, after: after.heading }
        : undefined;
    const { added_items, removed_items, reordered } = diffItemLists(
      before.items,
      after.items,
    );

    if (
      heading_changed ||
      added_items.length > 0 ||
      removed_items.length > 0 ||
      reordered
    ) {
      sections_modified.push({
        id: after.id,
        heading: after.heading,
        ...(heading_changed ? { heading_changed } : {}),
        added_items,
        removed_items,
        reordered,
      });
    }
  }

  return { sections_added, sections_removed, sections_modified };
}

function diffFields(
  beforeFields: EntityField[],
  afterFields: EntityField[],
): {
  fields_added: EntityField[];
  fields_removed: Array<{ id: string; name: string }>;
  fields_modified: FieldDiff[];
} {
  const afterById = new Map(afterFields.map((f) => [f.id, f]));
  const matchedBeforeIds = new Set<string>();
  const matchedAfterIds = new Set<string>();
  const pairs: Array<{ before: EntityField; after: EntityField }> = [];

  for (const beforeField of beforeFields) {
    const afterField = afterById.get(beforeField.id);
    if (afterField) {
      pairs.push({ before: beforeField, after: afterField });
      matchedBeforeIds.add(beforeField.id);
      matchedAfterIds.add(afterField.id);
    }
  }

  const unmatchedBefore = beforeFields.filter((f) => !matchedBeforeIds.has(f.id));
  const unmatchedAfter = afterFields.filter((f) => !matchedAfterIds.has(f.id));

  const beforeNameCounts = new Map<string, number>();
  for (const f of unmatchedBefore) {
    beforeNameCounts.set(f.name, (beforeNameCounts.get(f.name) ?? 0) + 1);
  }
  const afterNameCounts = new Map<string, number>();
  for (const f of unmatchedAfter) {
    afterNameCounts.set(f.name, (afterNameCounts.get(f.name) ?? 0) + 1);
  }

  for (const beforeField of unmatchedBefore) {
    if (beforeNameCounts.get(beforeField.name) !== 1) continue;
    if (afterNameCounts.get(beforeField.name) !== 1) continue;
    const afterField = unmatchedAfter.find((f) => f.name === beforeField.name);
    if (afterField) {
      pairs.push({ before: beforeField, after: afterField });
      matchedBeforeIds.add(beforeField.id);
      matchedAfterIds.add(afterField.id);
    }
  }

  const fields_added = afterFields.filter((f) => !matchedAfterIds.has(f.id));
  const fields_removed = beforeFields
    .filter((f) => !matchedBeforeIds.has(f.id))
    .map((f) => ({ id: f.id, name: f.name }));

  const fields_modified: FieldDiff[] = [];
  for (const { before, after } of pairs) {
    const changes: Record<string, { before: unknown; after: unknown }> = {};
    for (const key of ["name", "type", "default_value", "note"] as const) {
      if (!canonicalEqual(before[key], after[key])) {
        changes[key] = { before: before[key], after: after[key] };
      }
    }
    for (const flag of ["pk", "fk", "unique", "nullable", "indexed"] as const) {
      const bVal = Boolean(before[flag]);
      const aVal = Boolean(after[flag]);
      if (bVal !== aVal) {
        changes[flag] = { before: bVal, after: aVal };
      }
    }

    if (Object.keys(changes).length > 0) {
      fields_modified.push({
        id: after.id,
        name: after.name,
        changes,
      });
    }
  }

  return { fields_added, fields_removed, fields_modified };
}

const NODE_SCALAR_FIELDS = [
  "entity_ref",
  "kind",
  "title",
  "summary",
  "status",
  "locked",
  "code_refs",
] as const;

function diffNode(beforeNode: DesignNode, afterNode: DesignNode): NodeDiff | null {
  const changes: Record<string, { before: unknown; after: unknown }> = {};
  for (const field of NODE_SCALAR_FIELDS) {
    const beforeVal = beforeNode[field];
    const afterVal = afterNode[field];
    if (!canonicalEqual(beforeVal, afterVal)) {
      changes[field] = { before: beforeVal, after: afterVal };
    }
  }

  const beforeShape = beforeNode.shape ?? "card";
  const afterShape = afterNode.shape ?? "card";
  if (beforeShape !== afterShape) {
    changes.shape = { before: beforeShape, after: afterShape };
  }

  const { sections_added, sections_removed, sections_modified } = diffSections(
    beforeNode.sections,
    afterNode.sections,
  );
  const { fields_added, fields_removed, fields_modified } = diffFields(
    beforeNode.fields ?? [],
    afterNode.fields ?? [],
  );

  if (
    Object.keys(changes).length === 0 &&
    sections_added.length === 0 &&
    sections_removed.length === 0 &&
    sections_modified.length === 0 &&
    fields_added.length === 0 &&
    fields_removed.length === 0 &&
    fields_modified.length === 0
  ) {
    return null;
  }

  return {
    id: afterNode.id,
    title: afterNode.title,
    changes,
    sections_added,
    sections_removed,
    sections_modified,
    fields_added,
    fields_removed,
    fields_modified,
  };
}

function diffEdge(beforeEdge: DesignEdge, afterEdge: DesignEdge): EdgeDiff | null {
  const changes: Record<string, { before: unknown; after: unknown }> = {};

  for (const field of [
    "source",
    "target",
    "label",
    "step",
    "style",
    "source_cardinality",
    "target_cardinality",
    "relation_kind",
  ] as const) {
    const beforeVal = beforeEdge[field];
    const afterVal = afterEdge[field];
    if (!canonicalEqual(beforeVal, afterVal)) {
      changes[field] = { before: beforeVal, after: afterVal };
    }
  }

  const beforeLocked = Boolean(beforeEdge.locked);
  const afterLocked = Boolean(afterEdge.locked);
  if (beforeLocked !== afterLocked) {
    changes["locked"] = { before: beforeLocked, after: afterLocked };
  }

  if (Object.keys(changes).length === 0) {
    return null;
  }

  return {
    id: afterEdge.id,
    source: afterEdge.source,
    target: afterEdge.target,
    changes,
  };
}

/**
 * Computes a minimal semantic diff between an agent checkpoint baseline and
 * the current view on disk, ignoring layout coordinates, JSON key order, and whitespace.
 */
export function computeSemanticDiff(
  checkpointView: DesignView | null,
  currentView: DesignView,
): SemanticDiff {
  if (checkpointView === null) {
    const has_changes =
      currentView.nodes.length > 0 || currentView.edges.length > 0;
    return {
      view_id: currentView.id,
      has_changes,
      baseline_missing: true,
      view_meta_changed: {},
      nodes_added: [...currentView.nodes],
      nodes_removed: [],
      nodes_modified: [],
      edges_added: [...currentView.edges],
      edges_removed: [],
      edges_modified: [],
    };
  }

  const view_meta_changed: SemanticDiff["view_meta_changed"] = {};
  if (checkpointView.title !== currentView.title) {
    view_meta_changed.title = {
      before: checkpointView.title,
      after: currentView.title,
    };
  }
  if (checkpointView.direction !== currentView.direction) {
    view_meta_changed.direction = {
      before: checkpointView.direction,
      after: currentView.direction,
    };
  }
  const beforeType = checkpointView.diagram_type ?? "general";
  const afterType = currentView.diagram_type ?? "general";
  if (beforeType !== afterType) {
    view_meta_changed.diagram_type = {
      before: beforeType,
      after: afterType,
    };
  }

  const beforeNodes = new Map(checkpointView.nodes.map((n) => [n.id, n]));
  const afterNodes = new Map(currentView.nodes.map((n) => [n.id, n]));

  const nodes_added: DesignNode[] = [];
  const nodes_modified: NodeDiff[] = [];
  for (const afterNode of currentView.nodes) {
    const beforeNode = beforeNodes.get(afterNode.id);
    if (!beforeNode) {
      nodes_added.push(afterNode);
      continue;
    }
    const modified = diffNode(beforeNode, afterNode);
    if (modified) {
      nodes_modified.push(modified);
    }
  }

  const nodes_removed: Array<{ id: string; title: string }> = [];
  for (const beforeNode of checkpointView.nodes) {
    if (!afterNodes.has(beforeNode.id)) {
      nodes_removed.push({ id: beforeNode.id, title: beforeNode.title });
    }
  }

  const beforeEdges = new Map(checkpointView.edges.map((e) => [e.id, e]));
  const afterEdges = new Map(currentView.edges.map((e) => [e.id, e]));

  const edges_added: DesignEdge[] = [];
  const edges_modified: EdgeDiff[] = [];
  for (const afterEdge of currentView.edges) {
    const beforeEdge = beforeEdges.get(afterEdge.id);
    if (!beforeEdge) {
      edges_added.push(afterEdge);
      continue;
    }
    const modified = diffEdge(beforeEdge, afterEdge);
    if (modified) {
      edges_modified.push(modified);
    }
  }

  const edges_removed: SemanticDiff["edges_removed"] = [];
  for (const beforeEdge of checkpointView.edges) {
    if (!afterEdges.has(beforeEdge.id)) {
      edges_removed.push({
        id: beforeEdge.id,
        source: beforeEdge.source,
        target: beforeEdge.target,
        ...(beforeEdge.label !== undefined ? { label: beforeEdge.label } : {}),
      });
    }
  }

  const has_changes =
    Object.keys(view_meta_changed).length > 0 ||
    nodes_added.length > 0 ||
    nodes_removed.length > 0 ||
    nodes_modified.length > 0 ||
    edges_added.length > 0 ||
    edges_removed.length > 0 ||
    edges_modified.length > 0;

  return {
    view_id: currentView.id,
    has_changes,
    baseline_missing: false,
    view_meta_changed,
    nodes_added,
    nodes_removed,
    nodes_modified,
    edges_added,
    edges_removed,
    edges_modified,
  };
}
