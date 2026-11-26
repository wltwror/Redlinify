import type {
  Cardinality,
  DesignNode,
  DesignView,
} from "@redlinify/shared/browser";
import { MAX_VISIBLE_SECTION_ITEMS } from "../layout/elk";

function truncateText(str: string, maxChars: number): string {
  if (str.length <= maxChars) return str;
  return `${str.slice(0, Math.max(1, maxChars - 1))}…`;
}

function toMermaidId(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_]/g, "_");
  return /^[0-9]/.test(cleaned) || !cleaned ? `n_${cleaned}` : cleaned;
}

function erLeftCard(c?: Cardinality): string {
  switch (c) {
    case "0..1":
      return "|o";
    case "1..*":
      return "}|";
    case "0..*":
      return "}o";
    case "1":
    default:
      return "||";
  }
}

function erRightCard(c?: Cardinality): string {
  switch (c) {
    case "0..1":
      return "o|";
    case "1..*":
      return "|{";
    case "0..*":
      return "o{";
    case "1":
    default:
      return "||";
  }
}

function escMermaidHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/#/g, "&#35;")
    .replace(/\|/g, "&#124;");
}

type MermaidStyleClass =
  | "drifted"
  | "needs_input"
  | "locked"
  | "approved"
  | "implemented"
  | "draft";

const MERMAID_CLASS_ORDER: MermaidStyleClass[] = [
  "drifted",
  "needs_input",
  "locked",
  "approved",
  "implemented",
  "draft",
];

const MERMAID_CLASS_DEFS: Record<
  "dark" | "light",
  Record<MermaidStyleClass, string>
> = {
  dark: {
    drifted: "fill:#4c0519,stroke:#f43f5e,stroke-width:2px,color:#ffe4e6",
    needs_input: "fill:#451a03,stroke:#f59e0b,stroke-width:2px,color:#fef3c7",
    locked: "fill:#1e1b4b,stroke:#8b5cf6,stroke-width:2px,color:#f1f5f9",
    approved: "fill:#022c22,stroke:#10b981,stroke-width:1.5px,color:#d1fae5",
    implemented: "fill:#042f2e,stroke:#14b8a6,stroke-width:1.5px,color:#ccfbf1",
    draft: "fill:#0f172a,stroke:#475569,stroke-width:1.5px,color:#f1f5f9",
  },
  light: {
    drifted: "fill:#ffe4e6,stroke:#e11d48,stroke-width:2px,color:#881337",
    needs_input: "fill:#fef3c7,stroke:#d97706,stroke-width:2px,color:#78350f",
    locked: "fill:#f5f3ff,stroke:#7c3aed,stroke-width:2px,color:#1e293b",
    approved: "fill:#d1fae5,stroke:#059669,stroke-width:1.5px,color:#064e3b",
    implemented: "fill:#ccfbf1,stroke:#0d9488,stroke-width:1.5px,color:#134e4a",
    draft: "fill:#ffffff,stroke:#94a3b8,stroke-width:1.5px,color:#0f172a",
  },
};

function mermaidClassForNode(node: DesignNode): MermaidStyleClass {
  if (node.status === "drifted") return "drifted";
  if (node.status === "needs_input") return "needs_input";
  if (node.locked) return "locked";
  if (node.status === "approved") return "approved";
  if (node.status === "implemented") return "implemented";
  return "draft";
}

function formatMermaidNodeShape(
  mId: string,
  node: DesignNode,
  innerHtml: string,
): string {
  if (node.sections.length === 0) {
    if (/(store|storage|db|database|cache|queue)/i.test(node.kind)) {
      return `  ${mId}[("${innerHtml}")]`;
    }
    if (/(actor|user|client)/i.test(node.kind)) {
      return `  ${mId}(["${innerHtml}"])`;
    }
  }
  return `  ${mId}("${innerHtml}")`;
}

export function renderViewToMermaid(
  view: DesignView,
  options?: { theme?: "dark" | "light" },
): string {
  if (view.diagram_type === "er") {
    const lines: string[] = ["erDiagram"];
    for (const node of view.nodes) {
      const entityId = toMermaidId(node.id);
      const safeTitle = node.title.replace(/"/g, "'");
      lines.push(`  ${entityId} ["${safeTitle}"] {`);
      for (const f of node.fields ?? []) {
        const fType = (f.type ?? "string").replace(/[^a-zA-Z0-9_]/g, "_");
        const fName = f.name.replace(/[^a-zA-Z0-9_]/g, "_");
        const keys = [f.pk ? "PK" : "", f.fk ? "FK" : "", f.unique ? "UK" : ""]
          .filter(Boolean)
          .join(",");
        const notes = [f.nullable ? "nullable" : "NOT NULL", f.note ?? ""]
          .filter(Boolean)
          .join(" - ")
          .replace(/"/g, "'");
        lines.push(
          `    ${fType} ${fName}${keys ? ` ${keys}` : ""} "${notes}"`,
        );
      }
      lines.push("  }");
    }
    for (const edge of view.edges) {
      const src = toMermaidId(edge.source);
      const tgt = toMermaidId(edge.target);
      const left = erLeftCard(edge.source_cardinality);
      const right = erRightCard(edge.target_cardinality);
      const rel = edge.style === "dashed" ? ".." : "--";
      const label = (
        edge.label?.trim() ||
        (edge.relation_kind === "subtype" ? "is-a" : "relates")
      ).replace(/"/g, "'");
      lines.push(`  ${src} ${left}${rel}${right} ${tgt} : "${label}"`);
    }
    return `${lines.join("\n")}\n`;
  }

  const theme = options?.theme === "light" ? "light" : "dark";
  const lines: string[] = [
    "%%{init: {'flowchart': {'curve': 'basis', 'nodeSpacing': 48, 'rankSpacing': 64, 'padding': 14}}}%%",
    `flowchart ${view.direction === "LR" ? "LR" : "TB"}`,
    `  %% ${view.title.replace(/[\r\n]+/g, " ")}`,
  ];

  const nodesByClass = new Map<MermaidStyleClass, string[]>();

  for (const node of view.nodes) {
    const mId = toMermaidId(node.id);
    const kindUpper = escMermaidHtml(node.kind.toUpperCase());
    const statusSuffix =
      node.status === "drifted"
        ? " · DRIFTED"
        : node.status === "needs_input"
          ? " · NEEDS INPUT"
          : node.locked
            ? " · 🔒"
            : "";

    const parts: string[] = [
      `<small>${kindUpper}${statusSuffix}</small>`,
      `<b>${escMermaidHtml(node.title)}</b>`,
    ];

    if (node.summary?.trim()) {
      parts.push(
        `<i>${escMermaidHtml(truncateText(node.summary.trim(), 64))}</i>`,
      );
    }

    for (const sec of node.sections) {
      if (sec.items.length === 0) continue;
      parts.push("", `<b>${escMermaidHtml(sec.heading)}</b>`);
      for (const item of sec.items.slice(0, MAX_VISIBLE_SECTION_ITEMS)) {
        parts.push(`• ${escMermaidHtml(truncateText(item, 44))}`);
      }
      if (sec.items.length > MAX_VISIBLE_SECTION_ITEMS) {
        parts.push(
          `<i>+${sec.items.length - MAX_VISIBLE_SECTION_ITEMS} more</i>`,
        );
      }
    }

    lines.push(formatMermaidNodeShape(mId, node, parts.join("<br/>")));

    const cls = mermaidClassForNode(node);
    const list = nodesByClass.get(cls) ?? [];
    list.push(mId);
    nodesByClass.set(cls, list);
  }

  if (view.nodes.length > 0 && view.edges.length > 0) {
    lines.push("");
  }

  for (const edge of view.edges) {
    const src = toMermaidId(edge.source);
    const tgt = toMermaidId(edge.target);
    const arrow =
      edge.style === "dashed" ? "-.->" : edge.locked ? "==>" : "-->";
    const text = [
      edge.step !== undefined ? String(edge.step) : "",
      edge.label?.trim() ?? "",
    ]
      .filter(Boolean)
      .join(" · ");
    const escaped = escMermaidHtml(text);
    lines.push(
      escaped
        ? `  ${src} ${arrow}|"${escaped}"| ${tgt}`
        : `  ${src} ${arrow} ${tgt}`,
    );
  }

  const styleLines: string[] = [];
  for (const cls of MERMAID_CLASS_ORDER) {
    const ids = nodesByClass.get(cls);
    if (!ids || ids.length === 0) continue;
    styleLines.push(`  classDef ${cls} ${MERMAID_CLASS_DEFS[theme][cls]}`);
    styleLines.push(`  class ${ids.join(",")} ${cls}`);
  }
  if (view.edges.length > 0) {
    styleLines.push("  linkStyle default stroke:#64748b,stroke-width:1.5px");
  }
  if (styleLines.length > 0) {
    lines.push("", ...styleLines);
  }

  return `${lines.join("\n")}\n`;
}
