import { describe, expect, it } from "vitest";
import type { DesignView } from "@redlinify/shared/browser";
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
    const mmdGen = renderViewToMermaid(generalView);
    expect(mmdGen).toContain("flowchart LR");
    expect(mmdGen).toContain('api["<b>API Gateway</b>');
    expect(mmdGen).toContain('api -->|"1. queries"| db');

    const mmdEr = renderViewToMermaid(erView);
    expect(mmdEr).toContain("erDiagram");
    expect(mmdEr).toContain("uuid id PK");
    expect(mmdEr).toContain('customers ||--o{ vehicles : "leases"');

    const jsonText = renderViewToJson(generalView);
    expect(JSON.parse(jsonText)).toEqual(generalView);
    expect(jsonText).not.toContain("waypoints");
  });
});
