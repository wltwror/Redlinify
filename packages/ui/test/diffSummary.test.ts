import { describe, expect, it } from "vitest";
import { computeSemanticDiff, type DesignView } from "@redlinify/shared/browser";
import {
  getModifiedEdgeIds,
  revertEdgeToBaseline,
  revertNodeToBaseline,
  summarizeEdgeDiff,
  summarizeNodeDiff,
} from "../src/utils/diffSummary";

function sampleBaseline(): DesignView {
  return {
    id: "arch",
    title: "Architecture",
    diagram_type: "general",
    direction: "TB",
    created_by: "agent",
    nodes: [
      {
        id: "api",
        title: "API Gateway",
        kind: "service",
        shape: "card",
        status: "approved",
        locked: false,
        summary: "Routes requests",
        sections: [
          {
            id: "s1",
            heading: "Endpoints",
            items: ["GET /health", "POST /orders"],
          },
        ],
      },
      {
        id: "db",
        title: "Orders DB",
        kind: "database",
        shape: "store",
        status: "approved",
        locked: false,
        sections: [],
        fields: [
          { id: "f1", name: "id", type: "uuid", pk: true, nullable: false },
          { id: "f2", name: "total", type: "int", nullable: false },
        ],
      },
    ],
    edges: [
      {
        id: "e_api_db",
        source: "api",
        target: "db",
        label: "reads/writes",
        style: "solid",
        locked: false,
      },
    ],
  };
}

describe("diffSummary", () => {
  it("summarizes modified node, ER field, added node, and edge diffs", () => {
    const base = sampleBaseline();
    const current: DesignView = structuredClone(base);
    current.nodes[0]!.title = "Edge API Gateway";
    current.nodes[0]!.sections[0]!.items.push("DELETE /orders");
    current.nodes[1]!.fields![1]!.nullable = true;
    current.nodes.push({
      id: "cache",
      title: "Redis Cache",
      kind: "cache",
      status: "draft",
      locked: false,
      sections: [],
    });
    current.edges[0]!.label = "queries";
    current.edges.push({
      id: "e_api_cache",
      source: "api",
      target: "cache",
      label: "caches",
      style: "dashed",
      locked: false,
    });

    const diff = computeSemanticDiff(base, current);

    const apiSummary = summarizeNodeDiff(diff, "api", "general");
    expect(apiSummary).toContain('Title: "API Gateway" → "Edge API Gateway"');
    expect(apiSummary).toContain("+ Endpoints: DELETE /orders");

    const dbSummary = summarizeNodeDiff(diff, "db", "er");
    expect(dbSummary).toContain("Attr total: nullable ○");

    expect(summarizeNodeDiff(diff, "cache", "general")).toEqual(["+ Added box"]);
    expect(summarizeNodeDiff(diff, "cache", "er")).toEqual(["+ Added entity"]);

    const edgeIds = getModifiedEdgeIds(diff);
    expect([...edgeIds].sort()).toEqual(["e_api_cache", "e_api_db"]);
    expect(summarizeEdgeDiff(diff, "e_api_db")).toEqual(['Label: "queries"']);
    expect(summarizeEdgeDiff(diff, "e_api_cache")).toEqual(["+ Added connection"]);
  });

  it("reverts modified nodes, discards added nodes + incident edges, and restores removed nodes", () => {
    const base = sampleBaseline();

    // 1. Modified node reverts back to exact baseline snapshot
    const modified: DesignView = structuredClone(base);
    modified.nodes[0]!.title = "Changed Title";
    modified.nodes[0]!.sections[0]!.items = ["ONLY ONE"];
    const revertedMod = revertNodeToBaseline(modified, base, "api");
    expect(revertedMod?.nodes[0]).toEqual(base.nodes[0]);
    expect(computeSemanticDiff(base, revertedMod!).has_changes).toBe(false);

    // 2. Human-added node and its incident edges are discarded
    const withAdded: DesignView = structuredClone(base);
    withAdded.nodes.push({
      id: "temp_box",
      title: "Temp Box",
      kind: "component",
      status: "draft",
      locked: false,
      sections: [],
    });
    withAdded.edges.push({
      id: "e_temp",
      source: "api",
      target: "temp_box",
      locked: false,
    });
    const discarded = revertNodeToBaseline(withAdded, base, "temp_box");
    expect(discarded?.nodes.map((n) => n.id)).toEqual(["api", "db"]);
    expect(discarded?.edges.map((e) => e.id)).toEqual(["e_api_db"]);

    // 3. Removed baseline node is restored along with its baseline edge
    const withRemoved: DesignView = {
      ...structuredClone(base),
      nodes: [structuredClone(base.nodes[0]!)],
      edges: [],
    };
    const restored = revertNodeToBaseline(withRemoved, base, "db");
    expect(restored?.nodes.map((n) => n.id)).toEqual(["api", "db"]);
    expect(restored?.edges.map((e) => e.id)).toEqual(["e_api_db"]);
  });

  it("reverts modified edges and discards human-added edges", () => {
    const base = sampleBaseline();
    const modified: DesignView = structuredClone(base);
    modified.edges[0]!.label = "mutated";
    modified.edges[0]!.style = "dashed";
    modified.edges.push({
      id: "e_extra",
      source: "db",
      target: "api",
      locked: false,
    });

    const revertedModified = revertEdgeToBaseline(modified, base, "e_api_db");
    expect(revertedModified?.edges[0]).toEqual(base.edges[0]);

    const discardedAdded = revertEdgeToBaseline(revertedModified!, base, "e_extra");
    expect(discardedAdded?.edges).toEqual(base.edges);
    expect(computeSemanticDiff(base, discardedAdded!).has_changes).toBe(false);
  });
});
