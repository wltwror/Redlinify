import { describe, expect, it } from "vitest";
import type { DesignEdge, DesignNode, DesignView } from "@redlinify/shared/browser";
import {
  computeAutoLayout,
  estimateNodeSize,
  resolveNodeOverlaps,
} from "../src/layout/elk.js";
import { computeSmartEdgeRouting, type Point } from "../src/layout/routing.js";

function makeDenseView(direction: "LR" | "TB"): DesignView {
  const nodes: DesignNode[] = Array.from({ length: 28 }, (_, i) => {
    const id = `n_${i + 1}`;
    const shapes = ["card", "decision", "store", "terminal"] as const;
    const shape = shapes[i % 4];
    return {
      id,
      kind: shape === "decision" ? "gate" : shape === "store" ? "database" : "service",
      shape,
      title:
        i % 3 === 0
          ? `Very Long Orchestrator & Analytics Worker Component Title ${i + 1}`
          : `Node ${i + 1}`,
      summary:
        i % 2 === 0
          ? `Handles distributed state partitioning and retry backoff coordination for shard group ${i + 1}`
          : undefined,
      sections:
        shape === "card" || shape === "store"
          ? [
              {
                id: "resp",
                heading: "Responsibilities",
                items: [
                  `process_partition_batch_with_idempotency_key_${i + 1}`,
                  `emit_audit_event_${i + 1}`,
                  `refresh_cache_${i + 1}`,
                ],
              },
            ]
          : [],
      status: "approved",
      locked: false,
      entity_ref: i % 5 === 0 ? `core.tables.partition_state_${i + 1}` : undefined,
      created_by: "agent",
    };
  });

  const edges: DesignEdge[] = [];
  for (let i = 0; i < 24; i++) {
    edges.push({
      id: `e_fwd_${i}`,
      source: `n_${i + 1}`,
      target: `n_${((i + 3) % 27) + 1}`,
      label: `step ${i + 1}`,
      style: "solid",
      locked: false,
      created_by: "agent",
    });
    if (i % 2 === 0 && i + 7 < 28) {
      edges.push({
        id: `e_skip_${i}`,
        source: `n_${i + 1}`,
        target: `n_${i + 8}`,
        label: `async_dispatch_${i + 1}`,
        style: "dashed",
        locked: false,
        created_by: "agent",
      });
    }
  }
  // Long backward & cross-layer edges to stress corridor routing
  edges.push(
    {
      id: "e_back_1",
      source: "n_24",
      target: "n_2",
      label: "retry_dead_letter",
      style: "dashed",
      locked: false,
      created_by: "agent",
    },
    {
      id: "e_back_2",
      source: "n_20",
      target: "n_4",
      label: "invalidate",
      style: "solid",
      locked: false,
      created_by: "agent",
    },
    {
      id: "e_shared_1",
      source: "n_1",
      target: "n_15",
      label: "fanout_a",
      style: "solid",
      locked: false,
      created_by: "agent",
    },
    {
      id: "e_shared_2",
      source: "n_1",
      target: "n_19",
      label: "fanout_b",
      style: "solid",
      locked: false,
      created_by: "agent",
    },
  );

  return {
    id: `dense_${direction.toLowerCase()}`,
    title: "Dense System Graph",
    diagram_type: "general",
    direction,
    nodes,
    edges,
  };
}

function handlePoint(
  pos: Point,
  size: { width: number; height: number },
  side: "left" | "right" | "top" | "bottom",
  offset: number,
): Point {
  switch (side) {
    case "left":
      return { x: pos.x, y: pos.y + size.height / 2 + offset };
    case "right":
      return { x: pos.x + size.width, y: pos.y + size.height / 2 + offset };
    case "top":
      return { x: pos.x + size.width / 2 + offset, y: pos.y };
    case "bottom":
      return { x: pos.x + size.width / 2 + offset, y: pos.y + size.height };
  }
}

function segIntersectsBox(
  a: Point,
  b: Point,
  box: { x: number; y: number; width: number; height: number },
  pad = 2,
): boolean {
  const minX = box.x - pad;
  const maxX = box.x + box.width + pad;
  const minY = box.y - pad;
  const maxY = box.y + box.height + pad;
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  for (const [p, q] of [
    [-dx, a.x - minX],
    [dx, maxX - a.x],
    [-dy, a.y - minY],
    [dy, maxY - a.y],
  ] as const) {
    if (Math.abs(p) < 1e-6) {
      if (q < 0) return false;
    } else {
      const r = q / p;
      if (p < 0) {
        if (r > t1) return false;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return false;
        if (r < t1) t1 = r;
      }
    }
  }
  return t0 <= t1;
}

describe("layout and routing", () => {
  it("accounts for wrapped titles and entity_ref-only footers in estimateNodeSize", () => {
    const shortCard: DesignNode = {
      id: "s",
      kind: "service",
      title: "API",
      sections: [],
      status: "draft",
      locked: false,
      created_by: "agent",
    };
    const tallCard: DesignNode = {
      ...shortCard,
      id: "t",
      title: "Very Long Multi-Line Orchestration Service Title For Layout Sizing",
      entity_ref: "core.entities.audit_log",
    };

    const sSize = estimateNodeSize(shortCard, "general");
    const tSize = estimateNodeSize(tallCard, "general");
    expect(tSize.height).toBeGreaterThan(sSize.height + 30);
  });

  it("keeps pinned positions intact and resolves newly colliding boxes cleanly", () => {
    const pinned = new Set(["a", "b"]);
    const resolved = resolveNodeOverlaps(
      {
        a: { x: 100, y: 100 },
        b: { x: 520, y: 100 },
        newNode: { x: 120, y: 110 },
      },
      {
        a: { width: 280, height: 180 },
        b: { width: 280, height: 180 },
        newNode: { width: 280, height: 180 },
      },
      { gap: 40, pinnedIds: pinned, preferredAxis: "y" },
    );

    expect(resolved.a).toEqual({ x: 100, y: 100 });
    expect(resolved.b).toEqual({ x: 520, y: 100 });
    const aBottom = resolved.a!.y + 180;
    const nBottom = resolved.newNode!.y + 180;
    const separatedY =
      resolved.newNode!.y >= aBottom + 38 || resolved.a!.y >= nBottom + 38;
    const separatedX =
      resolved.newNode!.x >= resolved.a!.x + 280 + 38 ||
      resolved.a!.x >= resolved.newNode!.x + 280 + 38;
    expect(separatedY || separatedX).toBe(true);
  });

  it.each(["LR", "TB"] as const)(
    "produces zero overlaps and orthogonal obstacle-free routes on a 28-node %s graph",
    async (direction) => {
      const view = makeDenseView(direction);
      const { positions, autoRoutes } = await computeAutoLayout(
        view,
        { positions: {} },
        { forceReset: true },
      );

      expect(Object.keys(positions)).toHaveLength(view.nodes.length);
      expect(Object.keys(autoRoutes).length).toBeGreaterThan(10);

      const sizes: Record<string, { width: number; height: number }> = {};
      for (const n of view.nodes) {
        sizes[n.id] = estimateNodeSize(n, view.diagram_type);
      }

      // Check zero overlaps across all pairs with >= 36px margin
      for (let i = 0; i < view.nodes.length; i++) {
        const a = view.nodes[i]!;
        const pa = positions[a.id]!;
        const sa = sizes[a.id]!;
        for (let j = i + 1; j < view.nodes.length; j++) {
          const b = view.nodes[j]!;
          const pb = positions[b.id]!;
          const sb = sizes[b.id]!;
          const overlapX =
            Math.min(pa.x + sa.width, pb.x + sb.width) - Math.max(pa.x, pb.x);
          const overlapY =
            Math.min(pa.y + sa.height, pb.y + sb.height) - Math.max(pa.y, pb.y);
          const collides = overlapX > -36 && overlapY > -36;
          expect(collides).toBe(false);
        }
      }

      // Compute smart routing without precomputed autoRoutes too (exercises Corridor A* directly)
      const corridorOnly = computeSmartEdgeRouting(view, positions, {});
      const withElk = computeSmartEdgeRouting(
        view,
        positions,
        {},
        sizes,
        autoRoutes,
      );

      for (const routingMap of [withElk, corridorOnly]) {
        for (const edge of view.edges) {
          const r = routingMap[edge.id]!;
          const sp = handlePoint(
            positions[edge.source]!,
            sizes[edge.source]!,
            r.sourceHandle,
            r.sourcePortOffset,
          );
          const tp = handlePoint(
            positions[edge.target]!,
            sizes[edge.target]!,
            r.targetHandle,
            r.targetPortOffset,
          );

          if (r.autoWaypoints.length > 0) {
            const full = [sp, ...r.autoWaypoints, tp];
            for (let k = 0; k < full.length - 1; k++) {
              const p1 = full[k]!;
              const p2 = full[k + 1]!;
              const isOrthogonal =
                Math.abs(p1.x - p2.x) <= 2 || Math.abs(p1.y - p2.y) <= 2;
              expect(isOrthogonal).toBe(true);

              for (const obs of view.nodes) {
                if (obs.id === edge.source || obs.id === edge.target) continue;
                const obsBox = {
                  x: positions[obs.id]!.x,
                  y: positions[obs.id]!.y,
                  ...sizes[obs.id]!,
                };
                expect(segIntersectsBox(p1, p2, obsBox, 1)).toBe(false);
              }
            }
          }
        }
      }
    },
  );
});
