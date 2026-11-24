import { describe, expect, it } from "vitest";
import {
  DesignThreadSchema,
  DesignViewSchema,
  ViewLayoutSchema,
  ViewPatchSchema,
  WorkspaceFileSchema,
} from "../src/index.js";

describe("schemas", () => {
  it("validates a well-formed DesignView and applies defaults", () => {
    const parsed = DesignViewSchema.parse({
      id: "classes",
      title: "Core Classes",
      nodes: [
        {
          id: "dedup_engine",
          entity_ref: "dedup_engine",
          kind: "Class",
          title: "DedupEngine",
          sections: [
            { id: "fields", heading: "Fields", items: ["cache: LRUCache"] },
          ],
        },
        {
          id: "event_store",
          kind: "Store",
          title: "EventStore",
          status: "approved",
          locked: true,
        },
      ],
      edges: [
        {
          id: "e1",
          source: "dedup_engine",
          target: "event_store",
          label: "persists",
          step: 1,
          style: "solid",
        },
      ],
    });

    expect(parsed.direction).toBe("TB");
    expect(parsed.nodes[0]?.status).toBe("draft");
    expect(parsed.nodes[0]?.locked).toBe(false);
    expect(parsed.nodes[1]?.sections).toEqual([]);
  });

  it("rejects path-traversal and invalid slug IDs", () => {
    expect(() =>
      DesignViewSchema.parse({
        id: "../etc/passwd",
        title: "Bad",
        nodes: [],
        edges: [],
      }),
    ).toThrow();

    expect(() =>
      DesignViewSchema.parse({
        id: "UpperCase",
        title: "Bad",
        nodes: [],
        edges: [],
      }),
    ).toThrow();
  });

  it("enforces canonical snake_case entity_ref slugs", () => {
    expect(() =>
      DesignViewSchema.parse({
        id: "classes",
        title: "Classes",
        nodes: [
          {
            id: "node_a",
            entity_ref: "Dedup-Engine",
            kind: "Class",
            title: "Dedup",
          },
        ],
        edges: [],
      }),
    ).toThrow(/entity_ref/);
  });

  it("rejects duplicate node IDs, duplicate section IDs, duplicate edge IDs, and dangling edges", () => {
    expect(() =>
      DesignViewSchema.parse({
        id: "classes",
        title: "Classes",
        nodes: [
          { id: "a", kind: "Class", title: "A" },
          { id: "a", kind: "Class", title: "A2" },
        ],
        edges: [],
      }),
    ).toThrow(/Duplicate node id/);

    expect(() =>
      DesignViewSchema.parse({
        id: "classes",
        title: "Classes",
        nodes: [
          {
            id: "a",
            kind: "Class",
            title: "A",
            sections: [
              { id: "sec", heading: "Fields", items: [] },
              { id: "sec", heading: "Methods", items: [] },
            ],
          },
        ],
        edges: [],
      }),
    ).toThrow(/Duplicate section id/);

    expect(() =>
      DesignViewSchema.parse({
        id: "classes",
        title: "Classes",
        nodes: [{ id: "a", kind: "Class", title: "A" }],
        edges: [{ id: "e1", source: "a", target: "missing_node" }],
      }),
    ).toThrow(/missing target node/);
  });

  it("validates workspace tabs and view_requests uniqueness", () => {
    const ws = WorkspaceFileSchema.parse({
      version: 1,
      project_name: "Test",
      tabs: [{ view_id: "classes", title: "Classes", order: 0 }],
      view_requests: [
        {
          id: "req_1",
          title: "Dataflow",
          prompt: "Show pipeline",
          created_at: "2026-11-24T00:00:00Z",
        },
      ],
    });
    expect(ws.tabs).toHaveLength(1);

    expect(() =>
      WorkspaceFileSchema.parse({
        version: 1,
        project_name: "Test",
        tabs: [
          { view_id: "classes", title: "Classes", order: 0 },
          { view_id: "classes", title: "Dup", order: 1 },
        ],
      }),
    ).toThrow(/Duplicate workspace tab/);
  });

  it("validates thread target requirements and message non-emptiness", () => {
    expect(
      DesignThreadSchema.parse({
        id: "thr_1",
        target_type: "workspace",
        kind: "decision",
        messages: [
          {
            id: "m1",
            author: "agent",
            body: "Use Postgres",
            created_at: "2026-11-24T00:00:00Z",
          },
        ],
      }).status,
    ).toBe("open");

    expect(() =>
      DesignThreadSchema.parse({
        id: "thr_2",
        target_type: "node",
        view_id: "classes",
        kind: "question",
        messages: [
          {
            id: "m1",
            author: "agent",
            body: "Which store?",
            created_at: "2026-11-24T00:00:00Z",
          },
        ],
      }),
    ).toThrow(/target_id is required/);

    expect(() =>
      DesignThreadSchema.parse({
        id: "thr_3",
        target_type: "view",
        kind: "question",
        messages: [
          {
            id: "m1",
            author: "human",
            body: "Why?",
            created_at: "2026-11-24T00:00:00Z",
          },
        ],
      }),
    ).toThrow(/view_id is required/);
  });

  it("validates layout coordinates and view patches", () => {
    const layout = ViewLayoutSchema.parse({
      positions: { node_a: { x: 10, y: 20 } },
      viewport: { x: 0, y: 0, zoom: 1.2 },
    });
    expect(layout.viewport?.zoom).toBe(1.2);

    const patch = ViewPatchSchema.parse({
      update_nodes: [
        {
          id: "node_a",
          summary: null,
          section_ops: [{ op: "update", id: "fields", add_items: ["id: string"] }],
        },
      ],
    });
    expect(patch.update_nodes).toHaveLength(1);
  });
});
