import { describe, expect, it } from "vitest";
import type { DesignThread, DesignView } from "@redlinify/shared/browser";
import type { TabStatusSummary } from "../src/api/client";
import {
  buildSearchIndex,
  fuzzyMatch,
  searchItems,
} from "../src/utils/fuzzySearch";

const sampleTabs: TabStatusSummary[] = [
  {
    view_id: "architecture",
    title: "System Architecture",
    diagram_type: "general",
    order: 0,
    view_hash: "h1",
    waiting_on_agent: 0,
    waiting_on_human: 0,
    drifted_count: 0,
    has_human_edits: false,
    diff_counts: {
      nodes_added: 0,
      nodes_removed: 0,
      nodes_modified: 0,
      edges_added: 0,
      edges_removed: 0,
      edges_modified: 0,
    },
  },
  {
    view_id: "fleet_er",
    title: "Fleet ER Model",
    diagram_type: "er",
    order: 1,
    view_hash: "h2",
    waiting_on_agent: 0,
    waiting_on_human: 0,
    drifted_count: 0,
    has_human_edits: false,
    diff_counts: {
      nodes_added: 0,
      nodes_removed: 0,
      nodes_modified: 0,
      edges_added: 0,
      edges_removed: 0,
      edges_modified: 0,
    },
  },
];

const sampleViews: DesignView[] = [
  {
    id: "architecture",
    title: "System Architecture",
    diagram_type: "general",
    direction: "LR",
    nodes: [
      {
        id: "design_storage",
        kind: "Storage",
        title: "DesignStorage",
        summary: "Atomic JSON storage layer",
        status: "approved",
        locked: true,
        sections: [
          {
            id: "methods",
            heading: "Methods",
            items: ["upsertView()", "getPendingFeedback()"],
          },
        ],
      },
    ],
    edges: [],
  },
  {
    id: "fleet_er",
    title: "Fleet ER Model",
    diagram_type: "er",
    direction: "LR",
    nodes: [
      {
        id: "vehicles",
        kind: "Entity",
        title: "Vehicles",
        status: "draft",
        locked: false,
        sections: [],
        fields: [
          { id: "f1", name: "license_plate", type: "varchar", unique: true },
          { id: "f2", name: "vin", type: "varchar" },
        ],
      },
      {
        id: "customers",
        kind: "Entity",
        title: "Customers",
        status: "approved",
        locked: true,
        sections: [],
        fields: [{ id: "c1", name: "email", type: "varchar" }],
      },
    ],
    edges: [],
  },
];

const sampleThreads: DesignThread[] = [];

describe("fuzzySearch (typo-tolerant Damerau-Levenshtein + subsequence)", () => {
  it("matches single-character transpositions, substitutions, extra letters, and prefixes", () => {
    expect(fuzzyMatch("desgin", "DesignStorage")).not.toBeNull();
    expect(fuzzyMatch("storagw", "DesignStorage")).not.toBeNull();
    expect(fuzzyMatch("stoorage", "DesignStorage")).not.toBeNull();
    expect(fuzzyMatch("custmoer", "Customers")).not.toBeNull();
    expect(fuzzyMatch("architac", "System Architecture")).not.toBeNull();
  });

  it("ranks exact/prefix matches strictly above typo matches", () => {
    const exact = fuzzyMatch("DesignStorage", "DesignStorage")!;
    const typo = fuzzyMatch("DesginStorage", "DesignStorage")!;
    expect(exact).not.toBeNull();
    expect(typo).not.toBeNull();
    expect(exact.score).toBeGreaterThan(typo.score);
  });

  it("finds cross-tab nodes and attributes across multi-token queries with typos", () => {
    const items = buildSearchIndex({
      tabs: sampleTabs,
      views: sampleViews,
      allThreads: sampleThreads,
      activeViewId: "architecture",
    });

    const matches = searchItems(items, "vechiles licnse", "all");
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]?.item.viewId).toBe("fleet_er");
    expect(matches[0]?.item.targetId).toBe("vehicles");
    expect(matches[0]?.matchedSubEntry).toContain("license_plate");

    const archMatches = searchItems(items, "architacture", "view");
    expect(archMatches[0]?.item.viewId).toBe("architecture");
  });
});
