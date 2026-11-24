import { describe, expect, it } from "vitest";
import {
  computeSemanticDiff,
  computeViewHash,
  type DesignView,
} from "../src/index.js";

function makeBaseView(): DesignView {
  return {
    id: "classes",
    title: "Core Classes",
    direction: "TB",
    created_by: "agent",
    nodes: [
      {
        id: "engine",
        entity_ref: "dedup_engine",
        kind: "Class",
        title: "DedupEngine",
        summary: "Deduplicates inbound events",
        status: "draft",
        locked: false,
        sections: [
          {
            id: "fields",
            heading: "Fields",
            items: ["ttlSeconds: number", "store: EventStore"],
          },
          {
            id: "methods",
            heading: "Methods",
            items: ["check(id: string): boolean", "mark(id: string): void"],
          },
        ],
      },
      {
        id: "store",
        kind: "Store",
        title: "RedisCache",
        status: "approved",
        locked: true,
        sections: [
          { id: "ops", heading: "Ops", items: ["SETNX key 1 EX ttl"] },
        ],
      },
    ],
    edges: [
      {
        id: "e1",
        source: "engine",
        target: "store",
        label: "reads/writes",
        step: 1,
        style: "solid",
      },
    ],
  };
}

describe("computeSemanticDiff & computeViewHash", () => {
  it("reports zero diff and identical hash regardless of node/edge ordering or created_by", () => {
    const a = makeBaseView();
    const b: DesignView = {
      ...structuredClone(a),
      created_by: "human",
      nodes: [...structuredClone(a).nodes].reverse(),
      edges: [...structuredClone(a).edges],
    };

    expect(computeViewHash(a)).toBe(computeViewHash(b));
    const diff = computeSemanticDiff(a, b);
    expect(diff.has_changes).toBe(false);
    expect(diff.nodes_added).toEqual([]);
    expect(diff.nodes_removed).toEqual([]);
    expect(diff.nodes_modified).toEqual([]);
    expect(diff.edges_added).toEqual([]);
    expect(diff.edges_removed).toEqual([]);
    expect(diff.edges_modified).toEqual([]);
  });

  it("treats null baseline as all nodes and edges added", () => {
    const current = makeBaseView();
    const diff = computeSemanticDiff(null, current);

    expect(diff.baseline_missing).toBe(true);
    expect(diff.has_changes).toBe(true);
    expect(diff.nodes_added).toHaveLength(2);
    expect(diff.edges_added).toHaveLength(1);
    expect(diff.nodes_removed).toEqual([]);
  });

  it("detects view meta, added/removed/modified nodes, and item-level section diffs", () => {
    const before = makeBaseView();
    const after = structuredClone(before);
    after.title = "Core Architecture";
    after.direction = "LR";

    // Modify engine: update status, add/remove items in fields, reorder methods, add new section
    after.nodes[0]!.status = "approved";
    after.nodes[0]!.sections[0]!.items = [
      "ttlSeconds: number",
      "maxEntries: number",
    ];
    after.nodes[0]!.sections[1]!.items = [
      "mark(id: string): void",
      "check(id: string): boolean",
    ];
    after.nodes[0]!.sections.push({
      id: "invariants",
      heading: "Invariants",
      items: ["idempotent within ttlSeconds"],
    });

    // Remove store, add postgres_store, update edge
    after.nodes = [
      after.nodes[0]!,
      {
        id: "pg",
        kind: "Store",
        title: "PostgresStore",
        status: "draft",
        locked: false,
        sections: [],
      },
    ];
    after.edges = [
      {
        id: "e1",
        source: "engine",
        target: "pg",
        label: "persists",
        step: 1,
        style: "dashed",
      },
    ];

    const diff = computeSemanticDiff(before, after);
    expect(diff.has_changes).toBe(true);
    expect(diff.view_meta_changed).toEqual({
      title: { before: "Core Classes", after: "Core Architecture" },
      direction: { before: "TB", after: "LR" },
    });

    expect(diff.nodes_added.map((n) => n.id)).toEqual(["pg"]);
    expect(diff.nodes_removed).toEqual([{ id: "store", title: "RedisCache" }]);
    expect(diff.nodes_modified).toHaveLength(1);

    const engineDiff = diff.nodes_modified[0]!;
    expect(engineDiff.changes.status).toEqual({
      before: "draft",
      after: "approved",
    });
    expect(engineDiff.sections_added.map((s) => s.id)).toEqual(["invariants"]);
    expect(engineDiff.sections_modified).toEqual([
      {
        id: "fields",
        heading: "Fields",
        added_items: ["maxEntries: number"],
        removed_items: ["store: EventStore"],
        reordered: false,
      },
      {
        id: "methods",
        heading: "Methods",
        added_items: [],
        removed_items: [],
        reordered: true,
      },
    ]);

    expect(diff.edges_modified).toHaveLength(1);
    expect(diff.edges_modified[0]!.changes).toEqual({
      target: { before: "store", after: "pg" },
      label: { before: "reads/writes", after: "persists" },
      style: { before: "solid", after: "dashed" },
    });
  });

  it("handles duplicate items accurately in section diffs and falls back to unique heading match", () => {
    const before: DesignView = {
      id: "algo",
      title: "Algorithm",
      direction: "TB",
      nodes: [
        {
          id: "step1",
          kind: "Stage",
          title: "Retry",
          status: "draft",
          locked: false,
          sections: [
            {
              id: "old_sec_id",
              heading: "Steps",
              items: ["retry", "retry", "abort"],
            },
          ],
        },
      ],
      edges: [],
    };
    const after: DesignView = {
      ...structuredClone(before),
      nodes: [
        {
          ...structuredClone(before.nodes[0]!),
          sections: [
            {
              id: "renamed_sec_id",
              heading: "Steps",
              items: ["retry", "log", "abort"],
            },
          ],
        },
      ],
    };

    const diff = computeSemanticDiff(before, after);
    expect(diff.nodes_modified[0]?.sections_added).toEqual([]);
    expect(diff.nodes_modified[0]?.sections_removed).toEqual([]);
    expect(diff.nodes_modified[0]?.sections_modified).toEqual([
      {
        id: "renamed_sec_id",
        heading: "Steps",
        added_items: ["log"],
        removed_items: ["retry"],
        reordered: false,
      },
    ]);
  });

  it("diffs ER fields and edge cardinalities cleanly", () => {
    const before: DesignView = {
      id: "er",
      title: "Fleet ER",
      diagram_type: "er",
      direction: "LR",
      nodes: [
        {
          id: "vehicle",
          kind: "Entity",
          title: "Vehicle",
          status: "draft",
          locked: false,
          sections: [],
          fields: [
            { id: "id", name: "id", type: "uuid", pk: true },
            { id: "vin", name: "vin", type: "varchar", nullable: false },
          ],
        },
        {
          id: "fleet",
          kind: "Entity",
          title: "Fleet",
          status: "draft",
          locked: false,
          sections: [],
          fields: [{ id: "id", name: "id", type: "uuid", pk: true }],
        },
      ],
      edges: [
        {
          id: "e1",
          source: "fleet",
          target: "vehicle",
          source_cardinality: "1",
          target_cardinality: "0..*",
          relation_kind: "association",
        },
      ],
    };

    const after = structuredClone(before);
    after.nodes[0]!.fields![1]!.unique = true;
    after.nodes[0]!.fields!.push({
      id: "fleet_id",
      name: "fleet_id",
      type: "uuid",
      fk: true,
    });
    after.edges[0]!.target_cardinality = "1..*";

    const diff = computeSemanticDiff(before, after);
    expect(diff.has_changes).toBe(true);
    expect(diff.nodes_modified[0]?.fields_added.map((f) => f.id)).toEqual([
      "fleet_id",
    ]);
    expect(diff.nodes_modified[0]?.fields_modified).toEqual([
      {
        id: "vin",
        name: "vin",
        changes: { unique: { before: false, after: true } },
      },
    ]);
    expect(diff.edges_modified[0]?.changes).toEqual({
      target_cardinality: { before: "0..*", after: "1..*" },
    });
  });
});
