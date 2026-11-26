import { describe, expect, it } from "vitest";
import type { DesignView } from "@redlinify/shared/browser";
import { getCollapsedVisibleCount } from "../src/layout/elk";
import {
  renderViewToJson,
  renderViewToMermaid,
  renderViewToSvg,
} from "../src/utils/exportDiagram";

const generalView: DesignView = {
  id: "arch_test",
  title: "Architecture & Export",
  diagram_type: "general",
  direction: "LR",
  nodes: [
    {
      id: "api",
      kind: "Service",
      title: "API Gateway",
      summary: "Handles auth & routing",
      status: "approved",
      locked: true,
      entity_ref: "api_gateway",
      code_refs: [{ path: "src/api.ts", symbol: "handler" }],
      sections: [{ id: "routes", heading: "Routes", items: ["GET /health"] }],
    },
    {
      id: "db",
      kind: "Store",
      title: "Postgres",
      status: "needs_input",
      locked: false,
      sections: [],
    },
  ],
  edges: [
    {
      id: "e1",
      source: "api",
      target: "db",
      label: "queries",
      step: 1,
      style: "solid",
      locked: true,
    },
  ],
};

const erView: DesignView = {
  id: "fleet_er",
  title: "Fleet ER",
  diagram_type: "er",
  direction: "LR",
  nodes: [
    {
      id: "customers",
      kind: "Entity",
      title: "Customers",
      status: "approved",
      locked: true,
      sections: [],
      fields: [
        { id: "c1", name: "id", type: "uuid", pk: true, nullable: false },
        { id: "c2", name: "email", type: "varchar", unique: true, nullable: false },
      ],
    },
    {
      id: "vehicles",
      kind: "Entity",
      title: "Vehicles",
      status: "draft",
      locked: false,
      sections: [],
      fields: [
        { id: "v1", name: "id", type: "uuid", pk: true, nullable: false },
        { id: "v2", name: "customer_id", type: "uuid", fk: true, nullable: true },
      ],
    },
  ],
  edges: [
    {
      id: "e_rent",
      source: "customers",
      target: "vehicles",
      label: "leases",
      source_cardinality: "1",
      target_cardinality: "0..*",
      relation_kind: "association",
    },
  ],
};

describe("exportDiagram", () => {
  it("renders valid pure vector SVG for general & ER diagrams in both themes", () => {
    const darkSvg = renderViewToSvg({
      view: generalView,
      positions: { api: { x: 40, y: 80 }, db: { x: 420, y: 80 } },
      theme: "dark",
      bgPattern: "dots",
    });
    expect(darkSvg.width).toBeGreaterThan(400);
    expect(darkSvg.height).toBeGreaterThan(200);
    expect(darkSvg.svg).toContain("<svg xmlns=\"http://www.w3.org/2000/svg\"");
    expect(darkSvg.svg).not.toContain("<foreignObject");
    expect(darkSvg.svg).toContain("API Gateway");
    expect(darkSvg.svg).toContain("Postgres");
    expect(darkSvg.svg).toContain("queries");
    expect(darkSvg.svg).toContain("#020617");

    const lightErSvg = renderViewToSvg({
      view: erView,
      positions: { customers: { x: 40, y: 60 }, vehicles: { x: 420, y: 60 } },
      theme: "light",
      bgPattern: "grid",
    });
    expect(lightErSvg.svg).not.toContain("<foreignObject");
    expect(lightErSvg.svg).toContain("Customers");
    expect(lightErSvg.svg).not.toContain("license");
    expect(lightErSvg.svg).toContain("customer_id: uuid");
    expect(lightErSvg.svg).toContain("leases");
    expect(lightErSvg.svg).toContain("#f1f5f9");
  });

  it("exports valid Mermaid and zero-coordinate JSON", () => {
    const mmdGen = renderViewToMermaid(generalView, { theme: "dark" });
    expect(mmdGen).toContain("%%{init:");
    expect(mmdGen).toContain("flowchart LR");
    expect(mmdGen).toContain("%% Architecture & Export");
    expect(mmdGen).toContain('api("<small>SERVICE · 🔒</small><br/><b>API Gateway</b><br/><i>Handles auth &amp; routing</i><br/><br/><b>Routes</b><br/>• GET /health")');
    expect(mmdGen).toContain('db[("<small>STORE · NEEDS INPUT</small><br/><b>Postgres</b>")]');
    expect(mmdGen).toContain('api ==>|"1 · queries"| db');
    expect(mmdGen).toContain("classDef locked fill:#1e1b4b,stroke:#8b5cf6");
    expect(mmdGen).toContain("class api locked");
    expect(mmdGen).toContain("class db needs_input");
    expect(mmdGen).toContain("linkStyle default stroke:#64748b");

    const mmdLight = renderViewToMermaid(generalView, { theme: "light" });
    expect(mmdLight).toContain("classDef locked fill:#f5f3ff,stroke:#7c3aed");
    expect(mmdLight).toContain("classDef needs_input fill:#fef3c7,stroke:#d97706");

    const mmdEr = renderViewToMermaid(erView);
    expect(mmdEr).toContain("erDiagram");
    expect(mmdEr).toContain("uuid id PK");
    expect(mmdEr).toContain('customers ||--o{ vehicles : "leases"');

    const jsonText = renderViewToJson(generalView);
    expect(JSON.parse(jsonText)).toEqual(generalView);
    expect(jsonText).not.toContain("waypoints");
  });

  it("renders decision, terminal, and store node shapes in SVG and Mermaid export", () => {
    const flowView: DesignView = {
      id: "auth_flow",
      title: "Auth Flowchart",
      diagram_type: "general",
      direction: "TB",
      nodes: [
        {
          id: "start",
          kind: "Terminal",
          shape: "terminal",
          title: "HTTP Request",
          status: "approved",
          locked: false,
          sections: [],
        },
        {
          id: "check",
          kind: "Decision",
          shape: "decision",
          title: "Token Valid?",
          status: "needs_input",
          locked: false,
          sections: [],
        },
        {
          id: "sessions",
          kind: "Cache",
          shape: "store",
          title: "Redis Sessions",
          status: "draft",
          locked: false,
          sections: [
            { id: "keys", heading: "Keys", items: ["sess:{id}"] },
          ],
        },
      ],
      edges: [
        { id: "e1", source: "start", target: "check", label: "validate" },
        { id: "e2", source: "check", target: "sessions", label: "lookup" },
      ],
    };

    const svgRes = renderViewToSvg({
      view: flowView,
      positions: {
        start: { x: 40, y: 20 },
        check: { x: 40, y: 140 },
        sessions: { x: 40, y: 320 },
      },
      theme: "dark",
      bgPattern: "dots",
    });
    expect(svgRes.svg).not.toContain("<foreignObject");
    expect(svgRes.svg).toContain("<polygon");
    expect(svgRes.svg).toContain("<ellipse");
    expect(svgRes.svg).toContain("HTTP Request");
    expect(svgRes.svg).toContain("Token Valid?");
    expect(svgRes.svg).toContain("Redis Sessions");

    const mmd = renderViewToMermaid(flowView, { theme: "light" });
    expect(mmd).toContain('start(["<small>TERMINAL</small><br/><b>HTTP Request</b>"])');
    expect(mmd).toContain('check{"<small>DECISION · NEEDS INPUT</small><br/><b>Token Valid?</b>"}');
    expect(mmd).toContain('sessions[("<small>CACHE</small><br/><b>Redis Sessions</b>');
  });

  it("never collapses a single '+1 more' item in sections, fields, or exports", () => {
    expect(getCollapsedVisibleCount(5, 5)).toEqual({ visibleCount: 5, hiddenCount: 0 });
    expect(getCollapsedVisibleCount(6, 5)).toEqual({ visibleCount: 6, hiddenCount: 0 });
    expect(getCollapsedVisibleCount(7, 5)).toEqual({ visibleCount: 5, hiddenCount: 2 });
    expect(getCollapsedVisibleCount(9, 8)).toEqual({ visibleCount: 9, hiddenCount: 0 });
    expect(getCollapsedVisibleCount(10, 8)).toEqual({ visibleCount: 8, hiddenCount: 2 });

    const sixItemView: DesignView = {
      id: "collapse_check",
      title: "Collapse Check",
      diagram_type: "general",
      direction: "TB",
      nodes: [
        {
          id: "svc",
          kind: "Service",
          title: "Worker",
          status: "draft",
          locked: false,
          sections: [
            {
              id: "steps",
              heading: "Steps",
              items: ["step_1", "step_2", "step_3", "step_4", "step_5", "step_6"],
            },
          ],
        },
      ],
      edges: [],
    };

    const svgSix = renderViewToSvg({
      view: sixItemView,
      positions: { svc: { x: 40, y: 40 } },
      theme: "dark",
      bgPattern: "dots",
    });
    expect(svgSix.svg).toContain("step_6");
    expect(svgSix.svg).not.toContain("+1 more");

    const mmdSix = renderViewToMermaid(sixItemView, { theme: "dark" });
    expect(mmdSix).toContain("step_6");
    expect(mmdSix).not.toContain("+1 more");

    const sevenItemView = structuredClone(sixItemView);
    sevenItemView.nodes[0]!.sections[0]!.items.push("step_7");
    const svgSeven = renderViewToSvg({
      view: sevenItemView,
      positions: { svc: { x: 40, y: 40 } },
      theme: "dark",
      bgPattern: "dots",
    });
    expect(svgSeven.svg).not.toContain("step_7");
    expect(svgSeven.svg).toContain("+2 more");

    const mmdSeven = renderViewToMermaid(sevenItemView, { theme: "dark" });
    expect(mmdSeven).not.toContain("step_7");
    expect(mmdSeven).toContain("+2 more");
  });
});
