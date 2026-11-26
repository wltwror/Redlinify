import type {
  Cardinality,
  DesignEdge,
  DesignNode,
  DesignView,
  EdgeRoute,
  EntityField,
  HandleSide,
  NodeStatus,
} from "@redlinify/shared/browser";
import {
  MAX_VISIBLE_ER_FIELDS,
  MAX_VISIBLE_SECTION_ITEMS,
  estimateNodeSize,
} from "../layout/elk";
import { computeSmartEdgeRouting, type Point } from "../layout/routing";

export type ExportFormat = "png" | "svg" | "mermaid" | "copy_mermaid" | "json";

interface Palette {
  canvasBg: string;
  patternColor: string;
  cardBg: string;
  headerBg: string;
  footerBg: string;
  divider: string;
  borderDefault: string;
  borderLocked: string;
  borderNeedsInput: string;
  borderDrifted: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  badgeBg: string;
  badgeBorder: string;
  edgeDefault: string;
  edgeLocked: string;
  pillBg: string;
  pillBorder: string;
}

const DARK_PALETTE: Palette = {
  canvasBg: "#020617",
  patternColor: "#334155",
  cardBg: "#0f172a",
  headerBg: "#0f172a",
  footerBg: "#091124",
  divider: "#1e293b",
  borderDefault: "#334155",
  borderLocked: "#8b5cf6",
  borderNeedsInput: "#f59e0b",
  borderDrifted: "#f43f5e",
  textPrimary: "#f1f5f9",
  textSecondary: "#cbd5e1",
  textMuted: "#94a3b8",
  badgeBg: "#1e293b",
  badgeBorder: "#334155",
  edgeDefault: "#64748b",
  edgeLocked: "#a78bfa",
  pillBg: "#0f172a",
  pillBorder: "#334155",
};

const LIGHT_PALETTE: Palette = {
  canvasBg: "#f1f5f9",
  patternColor: "#94a3b8",
  cardBg: "#ffffff",
  headerBg: "#f8fafc",
  footerBg: "#f8fafc",
  divider: "#e2e8f0",
  borderDefault: "#cbd5e1",
  borderLocked: "#7c3aed",
  borderNeedsInput: "#d97706",
  borderDrifted: "#e11d48",
  textPrimary: "#0f172a",
  textSecondary: "#334155",
  textMuted: "#64748b",
  badgeBg: "#f1f5f9",
  badgeBorder: "#cbd5e1",
  edgeDefault: "#64748b",
  edgeLocked: "#7c3aed",
  pillBg: "#ffffff",
  pillBorder: "#cbd5e1",
};

const STATUS_STYLE: Record<
  NodeStatus,
  {
    label: string;
    darkText: string;
    darkBg: string;
    darkBorder: string;
    lightText: string;
    lightBg: string;
    lightBorder: string;
  }
> = {
  draft: {
    label: "draft",
    darkText: "#cbd5e1",
    darkBg: "#1e293b",
    darkBorder: "#334155",
    lightText: "#334155",
    lightBg: "#f1f5f9",
    lightBorder: "#cbd5e1",
  },
  needs_input: {
    label: "needs input",
    darkText: "#fcd34d",
    darkBg: "#451a03",
    darkBorder: "#b45309",
    lightText: "#b45309",
    lightBg: "#fef3c7",
    lightBorder: "#f59e0b",
  },
  approved: {
    label: "approved",
    darkText: "#6ee7b7",
    darkBg: "#022c22",
    darkBorder: "#059669",
    lightText: "#047857",
    lightBg: "#d1fae5",
    lightBorder: "#10b981",
  },
  implemented: {
    label: "implemented",
    darkText: "#5eead4",
    darkBg: "#042f2e",
    darkBorder: "#0d9488",
    lightText: "#0f766e",
    lightBg: "#ccfbf1",
    lightBorder: "#14b8a6",
  },
  drifted: {
    label: "drifted",
    darkText: "#fda4af",
    darkBg: "#4c0519",
    darkBorder: "#e11d48",
    lightText: "#be123c",
    lightBg: "#ffe4e6",
    lightBorder: "#f43f5e",
  },
};

function escXml(input: string): string {
  return input
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function truncateText(str: string, maxChars: number): string {
  if (str.length <= maxChars) return str;
  return `${str.slice(0, Math.max(1, maxChars - 1))}…`;
}

function wrapTextLines(str: string, maxChars: number, maxLines: number): string[] {
  const words = str.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else if (!current) {
      lines.push(truncateText(word, maxChars));
      current = "";
    } else {
      lines.push(current);
      current = word;
    }
    if (lines.length === maxLines) {
      current = "";
      break;
    }
  }
  if (current && lines.length < maxLines) {
    lines.push(truncateText(current, maxChars));
  } else if (current && lines.length === maxLines) {
    lines[maxLines - 1] = truncateText(lines[maxLines - 1]!, maxChars);
  }
  return lines;
}

function handleAnchor(
  rect: { x: number; y: number; width: number; height: number },
  side: HandleSide,
  offset = 0,
): Point {
  const base = (() => {
    switch (side) {
      case "top":
        return { x: rect.x + rect.width / 2, y: rect.y };
      case "right":
        return { x: rect.x + rect.width, y: rect.y + rect.height / 2 };
      case "bottom":
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height };
      case "left":
        return { x: rect.x, y: rect.y + rect.height / 2 };
    }
  })();
  if (!offset) return base;
  if (side === "left" || side === "right") {
    return { x: base.x, y: base.y + offset };
  }
  return { x: base.x + offset, y: base.y };
}

function outwardVector(side: HandleSide): Point {
  switch (side) {
    case "right":
      return { x: 1, y: 0 };
    case "left":
      return { x: -1, y: 0 };
    case "bottom":
      return { x: 0, y: 1 };
    case "top":
      return { x: 0, y: -1 };
  }
}

function normalizeVec(dx: number, dy: number, fallback: Point): Point {
  const len = Math.hypot(dx, dy);
  if (len < 1e-3) return fallback;
  return { x: dx / len, y: dy / len };
}

function buildRoundedPolylinePath(points: Point[], radius = 12): string {
  if (points.length < 2) return "";
  if (points.length === 2) {
    return `M ${points[0]!.x} ${points[0]!.y} L ${points[1]!.x} ${points[1]!.y}`;
  }

  let d = `M ${points[0]!.x} ${points[0]!.y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1]!;
    const curr = points[i]!;
    const next = points[i + 1]!;

    const d1x = curr.x - prev.x;
    const d1y = curr.y - prev.y;
    const len1 = Math.hypot(d1x, d1y);

    const d2x = next.x - curr.x;
    const d2y = next.y - curr.y;
    const len2 = Math.hypot(d2x, d2y);

    if (len1 < 1 || len2 < 1) {
      d += ` L ${curr.x} ${curr.y}`;
      continue;
    }

    const r = Math.min(radius, len1 * 0.4, len2 * 0.4);
    const pInX = curr.x - (d1x / len1) * r;
    const pInY = curr.y - (d1y / len1) * r;
    const pOutX = curr.x + (d2x / len2) * r;
    const pOutY = curr.y + (d2y / len2) * r;

    d += ` L ${pInX} ${pInY} Q ${curr.x} ${curr.y} ${pOutX} ${pOutY}`;
  }

  const last = points[points.length - 1]!;
  d += ` L ${last.x} ${last.y}`;
  return d;
}

function buildDirectOrthoPoints(
  src: Point,
  srcSide: HandleSide,
  tgt: Point,
  tgtSide: HandleSide,
): { points: Point[]; labelPos: Point } {
  const so = outwardVector(srcSide);
  const to = outwardVector(tgtSide);
  const p1 = { x: src.x + so.x * 22, y: src.y + so.y * 22 };
  const p2 = { x: tgt.x + to.x * 22, y: tgt.y + to.y * 22 };
  const srcHoriz = srcSide === "left" || srcSide === "right";
  const tgtHoriz = tgtSide === "left" || tgtSide === "right";

  if (srcHoriz && tgtHoriz) {
    const midX = (p1.x + p2.x) / 2;
    return {
      points: [src, p1, { x: midX, y: p1.y }, { x: midX, y: p2.y }, p2, tgt],
      labelPos: { x: midX, y: (p1.y + p2.y) / 2 },
    };
  }
  if (!srcHoriz && !tgtHoriz) {
    const midY = (p1.y + p2.y) / 2;
    return {
      points: [src, p1, { x: p1.x, y: midY }, { x: p2.x, y: midY }, p2, tgt],
      labelPos: { x: (p1.x + p2.x) / 2, y: midY },
    };
  }
  if (srcHoriz && !tgtHoriz) {
    return {
      points: [src, p1, { x: p2.x, y: p1.y }, p2, tgt],
      labelPos: { x: p2.x, y: p1.y },
    };
  }
  return {
    points: [src, p1, { x: p1.x, y: p2.y }, p2, tgt],
    labelPos: { x: p1.x, y: p2.y },
  };
}

function renderCrowsFootSvg(
  anchor: Point,
  outward: Point,
  cardinality: Cardinality,
  color: string,
  strokeWidth: number,
  bgColor: string,
): string {
  const px = -outward.y;
  const py = outward.x;
  const pt = (d: number, perp: number) => ({
    x: anchor.x + outward.x * d + px * perp,
    y: anchor.y + outward.y * d + py * perp,
  });

  const isMany = cardinality === "1..*" || cardinality === "0..*";
  const isOpt = cardinality === "0..1" || cardinality === "0..*";
  const barDist = isMany ? 14 : 9;
  const b1 = pt(barDist, -6);
  const b2 = pt(barDist, 6);
  const circleCenter = pt(isMany ? 18 : 16, 0);
  const fTop = pt(0, -7);
  const fBot = pt(0, 7);
  const fApex = pt(12, 0);

  const parts: string[] = [];
  if (isMany) {
    parts.push(
      `<line x1="${fApex.x}" y1="${fApex.y}" x2="${fTop.x}" y2="${fTop.y}" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" />`,
      `<line x1="${fApex.x}" y1="${fApex.y}" x2="${fBot.x}" y2="${fBot.y}" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" />`,
    );
  } else {
    parts.push(
      `<line x1="${b1.x}" y1="${b1.y}" x2="${b2.x}" y2="${b2.y}" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" />`,
    );
  }
  if (!isOpt && isMany) {
    parts.push(
      `<line x1="${b1.x}" y1="${b1.y}" x2="${b2.x}" y2="${b2.y}" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" />`,
    );
  }
  if (isOpt) {
    parts.push(
      `<circle cx="${circleCenter.x}" cy="${circleCenter.y}" r="4" fill="${bgColor}" stroke="${color}" stroke-width="${strokeWidth}" />`,
    );
  }
  return parts.join("");
}

function renderSubtypeTriangleSvg(
  anchor: Point,
  outward: Point,
  color: string,
  strokeWidth: number,
  bgColor: string,
): string {
  const px = -outward.y;
  const py = outward.x;
  const left = {
    x: anchor.x + outward.x * 13 + px * 7,
    y: anchor.y + outward.y * 13 + py * 7,
  };
  const right = {
    x: anchor.x + outward.x * 13 - px * 7,
    y: anchor.y + outward.y * 13 - py * 7,
  };
  return `<polygon points="${anchor.x},${anchor.y} ${left.x},${left.y} ${right.x},${right.y}" fill="${bgColor}" stroke="${color}" stroke-width="${strokeWidth}" stroke-linejoin="round" />`;
}

function fieldBadgesList(field: EntityField): Array<{
  label: string;
  darkBg: string;
  darkText: string;
  darkBorder: string;
  lightBg: string;
  lightText: string;
  lightBorder: string;
}> {
  const list: Array<{
    label: string;
    darkBg: string;
    darkText: string;
    darkBorder: string;
    lightBg: string;
    lightText: string;
    lightBorder: string;
  }> = [];
  if (field.pk) {
    list.push({
      label: "PK",
      darkBg: "#451a03",
      darkText: "#fcd34d",
      darkBorder: "#b45309",
      lightBg: "#fef3c7",
      lightText: "#b45309",
      lightBorder: "#f59e0b",
    });
  }
  if (field.fk) {
    list.push({
      label: "FK",
      darkBg: "#082f49",
      darkText: "#7dd3fc",
      darkBorder: "#0369a1",
      lightBg: "#e0f2fe",
      lightText: "#0369a1",
      lightBorder: "#38bdf8",
    });
  }
  if (field.unique) {
    list.push({
      label: "UQ",
      darkBg: "#2e1065",
      darkText: "#c4b5fd",
      darkBorder: "#6d28d9",
      lightBg: "#ede9fe",
      lightText: "#6d28d9",
      lightBorder: "#a78bfa",
    });
  }
  if (field.indexed) {
    list.push({
      label: "IDX",
      darkBg: "#1e293b",
      darkText: "#cbd5e1",
      darkBorder: "#475569",
      lightBg: "#f1f5f9",
      lightText: "#334155",
      lightBorder: "#cbd5e1",
    });
  }
  return list;
}

function renderNodeSvg(
  node: DesignNode,
  rect: { x: number; y: number; width: number; height: number },
  diagramType: DesignView["diagram_type"],
  palette: Palette,
  isDark: boolean,
): string {
  const { x, y, width, height } = rect;
  const clipId = `clip-${node.id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  const isErNode =
    diagramType === "er" || (node.fields && node.fields.length > 0);
  const statusMeta = STATUS_STYLE[node.status];
  const borderColor =
    node.status === "drifted"
      ? palette.borderDrifted
      : node.status === "needs_input"
        ? palette.borderNeedsInput
        : node.locked
          ? palette.borderLocked
          : palette.borderDefault;
  const strokeWidth = node.locked || node.status !== "draft" ? 1.8 : 1.25;

  const out: string[] = [];
  out.push(`<g transform="translate(${x}, ${y})">`);
  out.push(
    `<defs><clipPath id="${clipId}"><rect x="0" y="0" width="${width}" height="${height}" rx="12" /></clipPath></defs>`,
  );
  out.push(
    `<rect x="0" y="0" width="${width}" height="${height}" rx="12" fill="${palette.cardBg}" stroke="${borderColor}" stroke-width="${strokeWidth}" />`,
  );
  out.push(`<g clip-path="url(#${clipId})">`);

  // Header bar
  const headerH = 34;
  out.push(
    `<rect x="0" y="0" width="${width}" height="${headerH}" fill="${palette.headerBg}" />`,
    `<line x1="0" y1="${headerH}" x2="${width}" y2="${headerH}" stroke="${palette.divider}" stroke-width="1" />`,
  );

  const kindText = node.kind.toUpperCase();
  const kindPillW = Math.min(width - 110, Math.max(42, kindText.length * 6.5 + 16));
  out.push(
    `<rect x="10" y="7" width="${kindPillW}" height="20" rx="5" fill="${palette.badgeBg}" stroke="${palette.badgeBorder}" stroke-width="1" />`,
    `<text x="${10 + kindPillW / 2}" y="20.5" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="10" font-weight="700" fill="${isDark ? "#7dd3fc" : "#0369a1"}">${escXml(truncateText(kindText, 18))}</text>`,
  );

  const statusPillW = Math.max(46, statusMeta.label.length * 6 + 14);
  const statusX = 10 + kindPillW + 6;
  out.push(
    `<rect x="${statusX}" y="7" width="${statusPillW}" height="20" rx="10" fill="${isDark ? statusMeta.darkBg : statusMeta.lightBg}" stroke="${isDark ? statusMeta.darkBorder : statusMeta.lightBorder}" stroke-width="1" />`,
    `<text x="${statusX + statusPillW / 2}" y="20.5" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="10" font-weight="600" fill="${isDark ? statusMeta.darkText : statusMeta.lightText}">${escXml(statusMeta.label)}</text>`,
  );

  if (node.locked) {
    const lockPillX = width - 30;
    out.push(
      `<rect x="${lockPillX}" y="7" width="20" height="20" rx="5" fill="${isDark ? "#2e1065" : "#ede9fe"}" stroke="${palette.borderLocked}" stroke-width="1" />`,
      `<text x="${lockPillX + 10}" y="20.5" text-anchor="middle" font-family="system-ui, sans-serif" font-size="10" font-weight="700" fill="${palette.borderLocked}">L</text>`,
    );
  }

  let curY = headerH + 18;
  const maxTitleChars = Math.max(16, Math.floor((width - 24) / 7.8));
  out.push(
    `<text x="12" y="${curY}" font-family="system-ui, -apple-system, sans-serif" font-size="13.5" font-weight="700" fill="${palette.textPrimary}">${escXml(truncateText(node.title, maxTitleChars))}</text>`,
  );
  curY += 16;

  if (node.summary?.trim()) {
    const summaryLines = wrapTextLines(
      node.summary,
      Math.max(22, Math.floor((width - 24) / 6.2)),
      2,
    );
    for (const line of summaryLines) {
      out.push(
        `<text x="12" y="${curY}" font-family="system-ui, -apple-system, sans-serif" font-size="11" fill="${palette.textMuted}">${escXml(line)}</text>`,
      );
      curY += 14;
    }
  }
  curY += 4;

  // Footer reservation if entity_ref / code_refs exist
  const hasFooter = Boolean(
    node.entity_ref || (node.code_refs && node.code_refs.length > 0),
  );
  const contentLimitY = height - (hasFooter ? 28 : 8);

  // ER fields block
  const fields = node.fields ?? [];
  if (isErNode && curY + 24 < contentLimitY) {
    out.push(
      `<line x1="0" y1="${curY}" x2="${width}" y2="${curY}" stroke="${palette.divider}" stroke-width="1" />`,
    );
    curY += 16;
    out.push(
      `<text x="12" y="${curY}" font-family="system-ui, sans-serif" font-size="9.5" font-weight="700" letter-spacing="0.8" fill="${isDark ? "#34d399" : "#047857"}">ATTRIBUTES</text>`,
      `<text x="${width - 12}" y="${curY}" text-anchor="end" font-family="ui-monospace, monospace" font-size="10" fill="${palette.textMuted}">${fields.length}</text>`,
    );
    curY += 14;

    if (fields.length === 0) {
      out.push(
        `<text x="12" y="${curY}" font-family="system-ui, sans-serif" font-size="11" font-style="italic" fill="${palette.textMuted}">No attributes</text>`,
      );
      curY += 18;
    } else {
      const visible = fields.slice(0, MAX_VISIBLE_ER_FIELDS);
      for (const f of visible) {
        if (curY + 8 > contentLimitY) break;
        const nullMark = f.nullable ? "○" : "*";
        const nullColor = f.nullable
          ? palette.textMuted
          : isDark
            ? "#fb7185"
            : "#e11d48";
        out.push(
          `<text x="14" y="${curY}" font-family="ui-monospace, monospace" font-size="11" font-weight="700" fill="${nullColor}">${nullMark}</text>`,
        );
        const badges = fieldBadgesList(f);
        let badgeX = width - 10;
        for (let bi = badges.length - 1; bi >= 0; bi--) {
          const b = badges[bi]!;
          const bw = b.label.length * 6.5 + 8;
          badgeX -= bw;
          out.push(
            `<rect x="${badgeX}" y="${curY - 10}" width="${bw}" height="13" rx="3" fill="${isDark ? b.darkBg : b.lightBg}" stroke="${isDark ? b.darkBorder : b.lightBorder}" stroke-width="0.8" />`,
            `<text x="${badgeX + bw / 2}" y="${curY - 1}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="8.5" font-weight="700" fill="${isDark ? b.darkText : b.lightText}">${b.label}</text>`,
          );
          badgeX -= 3;
        }
        const availChars = Math.max(12, Math.floor((badgeX - 30) / 6.5));
        const label = f.type ? `${f.name}: ${f.type}` : f.name;
        out.push(
          `<text x="27" y="${curY}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="11" fill="${palette.textPrimary}">${escXml(truncateText(label, availChars))}</text>`,
        );
        curY += 20;
      }
      if (fields.length > MAX_VISIBLE_ER_FIELDS && curY + 4 <= contentLimitY) {
        out.push(
          `<text x="14" y="${curY}" font-family="system-ui, sans-serif" font-size="10" font-weight="600" fill="${isDark ? "#38bdf8" : "#0284c7"}">+${fields.length - MAX_VISIBLE_ER_FIELDS} more</text>`,
        );
        curY += 16;
      }
    }
  }

  // Sections
  for (const sec of node.sections) {
    if (curY + 22 >= contentLimitY) break;
    out.push(
      `<line x1="0" y1="${curY}" x2="${width}" y2="${curY}" stroke="${palette.divider}" stroke-width="1" />`,
    );
    curY += 15;
    out.push(
      `<text x="12" y="${curY}" font-family="system-ui, sans-serif" font-size="9.5" font-weight="700" letter-spacing="0.7" fill="${palette.textMuted}">${escXml(truncateText(sec.heading.toUpperCase(), 30))}</text>`,
      `<text x="${width - 12}" y="${curY}" text-anchor="end" font-family="ui-monospace, monospace" font-size="10" fill="${palette.textMuted}">${sec.items.length}</text>`,
    );
    curY += 15;

    if (sec.items.length === 0) {
      out.push(
        `<text x="14" y="${curY}" font-family="system-ui, sans-serif" font-size="11" font-style="italic" fill="${palette.textMuted}">No items</text>`,
      );
      curY += 16;
    } else {
      const visibleItems = sec.items.slice(0, MAX_VISIBLE_SECTION_ITEMS);
      const maxItemChars = Math.max(18, Math.floor((width - 28) / 6.5));
      for (const item of visibleItems) {
        if (curY + 4 > contentLimitY) break;
        out.push(
          `<text x="14" y="${curY}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="11" fill="${palette.textSecondary}">${escXml(truncateText(item, maxItemChars))}</text>`,
        );
        curY += 17;
      }
      if (sec.items.length > MAX_VISIBLE_SECTION_ITEMS && curY + 4 <= contentLimitY) {
        out.push(
          `<text x="14" y="${curY}" font-family="system-ui, sans-serif" font-size="10" font-weight="600" fill="${isDark ? "#38bdf8" : "#0284c7"}">+${sec.items.length - MAX_VISIBLE_SECTION_ITEMS} more</text>`,
        );
        curY += 15;
      }
    }
  }

  // Footer
  if (hasFooter) {
    const footerY = height - 24;
    out.push(
      `<rect x="0" y="${footerY}" width="${width}" height="24" fill="${palette.footerBg}" />`,
      `<line x1="0" y1="${footerY}" x2="${width}" y2="${footerY}" stroke="${palette.divider}" stroke-width="1" />`,
    );
    if (node.entity_ref) {
      out.push(
        `<text x="12" y="${footerY + 15.5}" font-family="ui-monospace, monospace" font-size="10" fill="${palette.textMuted}">${escXml(truncateText(`ref:${node.entity_ref}`, 26))}</text>`,
      );
    }
    if (node.code_refs && node.code_refs.length > 0) {
      const n = node.code_refs.length;
      out.push(
        `<text x="${width - 12}" y="${footerY + 15.5}" text-anchor="end" font-family="ui-monospace, monospace" font-size="10" fill="${isDark ? "#6ee7b7" : "#047857"}">${n} ref${n > 1 ? "s" : ""}</text>`,
      );
    }
  }

  out.push("</g></g>");
  return out.join("\n");
}

function renderEdgeSvg(
  edge: DesignEdge,
  viewDiagramType: DesignView["diagram_type"],
  rects: Map<string, { x: number; y: number; width: number; height: number }>,
  route: ReturnType<typeof computeSmartEdgeRouting>[string],
  palette: Palette,
  isDark: boolean,
  markerDefaultId: string,
  markerLockedId: string,
): { svg: string; extraPoints: Point[] } {
  const srcRect = rects.get(edge.source);
  const tgtRect = rects.get(edge.target);
  if (!srcRect || !tgtRect) return { svg: "", extraPoints: [] };

  const srcPt = handleAnchor(srcRect, route.sourceHandle, route.sourcePortOffset);
  const tgtPt = handleAnchor(tgtRect, route.targetHandle, route.targetPortOffset);

  const defaultSrcOut = outwardVector(route.sourceHandle);
  const defaultTgtOut = outwardVector(route.targetHandle);
  let sourceOutward = defaultSrcOut;
  let targetOutward = defaultTgtOut;

  let d = "";
  let labelX = (srcPt.x + tgtPt.x) / 2;
  let labelY = (srcPt.y + tgtPt.y) / 2;
  const extraPoints: Point[] = [srcPt, tgtPt];

  const activeWps =
    route.manualWaypoints.length > 0 ? route.manualWaypoints : route.autoWaypoints;

  if (activeWps.length > 0) {
    extraPoints.push(...activeWps);
    const pts = [srcPt, ...activeWps, tgtPt];
    d = buildRoundedPolylinePath(
      pts,
      route.manualWaypoints.length > 0 ? 12 : 14,
    );
    const first = activeWps[0]!;
    const last = activeWps[activeWps.length - 1]!;
    sourceOutward = normalizeVec(first.x - srcPt.x, first.y - srcPt.y, defaultSrcOut);
    targetOutward = normalizeVec(last.x - tgtPt.x, last.y - tgtPt.y, defaultTgtOut);
    if (activeWps.length >= 2) {
      const midIdx =
        route.manualWaypoints.length > 0 ? Math.floor(activeWps.length / 2) - 1 : 0;
      const a = activeWps[Math.max(0, midIdx)]!;
      const b = activeWps[Math.min(activeWps.length - 1, midIdx + 1)]!;
      labelX = (a.x + b.x) / 2;
      labelY = (a.y + b.y) / 2;
    } else {
      labelX = activeWps[0]!.x;
      labelY = activeWps[0]!.y;
    }
  } else if (route.curveOffset.x !== 0 || route.curveOffset.y !== 0) {
    const cx = (srcPt.x + tgtPt.x) / 2 + route.curveOffset.x;
    const cy = (srcPt.y + tgtPt.y) / 2 + route.curveOffset.y;
    extraPoints.push({ x: cx, y: cy });
    d = `M ${srcPt.x} ${srcPt.y} Q ${cx} ${cy} ${tgtPt.x} ${tgtPt.y}`;
    sourceOutward = normalizeVec(cx - srcPt.x, cy - srcPt.y, defaultSrcOut);
    targetOutward = normalizeVec(cx - tgtPt.x, cy - tgtPt.y, defaultTgtOut);
    labelX = 0.25 * srcPt.x + 0.5 * cx + 0.25 * tgtPt.x;
    labelY = 0.25 * srcPt.y + 0.5 * cy + 0.25 * tgtPt.y;
  } else {
    const ortho = buildDirectOrthoPoints(
      srcPt,
      route.sourceHandle,
      tgtPt,
      route.targetHandle,
    );
    extraPoints.push(...ortho.points);
    d = buildRoundedPolylinePath(ortho.points, 12);
    labelX = ortho.labelPos.x;
    labelY = ortho.labelPos.y;
  }

  extraPoints.push({ x: labelX, y: labelY });

  const isErEdge =
    viewDiagramType === "er" ||
    Boolean(edge.source_cardinality || edge.target_cardinality || edge.relation_kind);
  const strokeColor = edge.locked ? palette.edgeLocked : palette.edgeDefault;
  const strokeWidth = 1.75;

  const srcCard = edge.source_cardinality;
  const tgtCard = edge.target_cardinality;
  const relKind = edge.relation_kind ?? "association";
  const srcOpt = srcCard === "0..1" || srcCard === "0..*";
  const tgtOpt = tgtCard === "0..1" || tgtCard === "0..*";
  const srcMand = srcCard === "1" || srcCard === "1..*";
  const tgtMand = tgtCard === "1" || tgtCard === "1..*";
  const useSplitDash =
    isErEdge &&
    relKind === "association" &&
    ((srcMand && tgtOpt) || (srcOpt && tgtMand));
  const fullDashed =
    edge.style === "dashed" ||
    (isErEdge && relKind === "association" && srcOpt && tgtOpt && !useSplitDash);

  const parts: string[] = [];
  if (useSplitDash) {
    parts.push(
      `<path d="${d}" fill="none" stroke="${strokeColor}" stroke-width="${strokeWidth}" stroke-dasharray="6 4" />`,
      `<path d="${d}" fill="none" stroke="${strokeColor}" stroke-width="${strokeWidth}" pathLength="100" stroke-dasharray="50 100" stroke-dashoffset="${srcMand ? 0 : -50}" />`,
    );
  } else {
    const markerAttr = isErEdge
      ? ""
      : ` marker-end="url(#${edge.locked ? markerLockedId : markerDefaultId})"`;
    const dashAttr = fullDashed ? ` stroke-dasharray="6 4"` : "";
    parts.push(
      `<path d="${d}" fill="none" stroke="${strokeColor}" stroke-width="${strokeWidth}"${dashAttr}${markerAttr} />`,
    );
  }

  if (isErEdge && relKind === "subtype") {
    parts.push(
      renderSubtypeTriangleSvg(
        tgtPt,
        targetOutward,
        strokeColor,
        strokeWidth,
        palette.canvasBg,
      ),
    );
  } else if (isErEdge && (srcCard || tgtCard)) {
    if (srcCard) {
      parts.push(
        renderCrowsFootSvg(
          srcPt,
          sourceOutward,
          srcCard,
          strokeColor,
          strokeWidth,
          palette.canvasBg,
        ),
      );
    }
    if (tgtCard) {
      parts.push(
        renderCrowsFootSvg(
          tgtPt,
          targetOutward,
          tgtCard,
          strokeColor,
          strokeWidth,
          palette.canvasBg,
        ),
      );
    }
  }

  const labelText = edge.label?.trim() || (relKind === "subtype" ? "is-a" : "");
  const hasLabel =
    Boolean(labelText) || edge.step !== undefined || Boolean(edge.locked);

  if (hasLabel) {
    const stepW = edge.step !== undefined ? 20 : 0;
    const textW = labelText ? Math.min(160, labelText.length * 6.4) : 0;
    const lockW = edge.locked ? 14 : 0;
    const pillW = Math.max(28, 16 + stepW + textW + lockW);
    const pillH = 22;
    const px = labelX - pillW / 2;
    const py = labelY - pillH / 2;
    parts.push(
      `<rect x="${px}" y="${py}" width="${pillW}" height="${pillH}" rx="11" fill="${palette.pillBg}" stroke="${palette.pillBorder}" stroke-width="1" />`,
    );
    let innerX = px + 8;
    if (edge.step !== undefined) {
      parts.push(
        `<circle cx="${innerX + 7}" cy="${labelY}" r="7.5" fill="${isDark ? "#38bdf8" : "#0284c7"}" />`,
        `<text x="${innerX + 7}" y="${labelY + 3.5}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="9.5" font-weight="700" fill="${isDark ? "#020617" : "#ffffff"}">${edge.step}</text>`,
      );
      innerX += 20;
    }
    if (labelText) {
      parts.push(
        `<text x="${innerX}" y="${labelY + 3.8}" font-family="system-ui, -apple-system, sans-serif" font-size="11" font-weight="500" fill="${palette.textSecondary}">${escXml(truncateText(labelText, 24))}</text>`,
      );
    }
  }

  return { svg: parts.join("\n"), extraPoints };
}

export function renderViewToSvg(params: {
  view: DesignView;
  positions: Record<string, Point>;
  edgeRoutes?: Record<string, EdgeRoute>;
  measured?: Record<string, { width?: number; height?: number }>;
  theme: "dark" | "light";
  bgPattern?: "dots" | "grid";
}): { svg: string; width: number; height: number } {
  const {
    view,
    positions,
    edgeRoutes = {},
    measured,
    theme,
    bgPattern = "dots",
  } = params;
  const isDark = theme === "dark";
  const palette = isDark ? DARK_PALETTE : LIGHT_PALETTE;

  if (view.nodes.length === 0) {
    const width = 560;
    const height = 280;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="${palette.canvasBg}" />
  <text x="${width / 2}" y="${height / 2}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="14" fill="${palette.textMuted}">${escXml(view.title)} (empty diagram)</text>
</svg>\n`;
    return { svg, width, height };
  }

  const rects = new Map<
    string,
    { x: number; y: number; width: number; height: number }
  >();
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const node of view.nodes) {
    const pos = positions[node.id] ?? { x: 40, y: 40 };
    const est = estimateNodeSize(node, view.diagram_type);
    const w = Math.round(measured?.[node.id]?.width ?? est.width);
    const h = Math.round(measured?.[node.id]?.height ?? est.height);
    rects.set(node.id, { x: pos.x, y: pos.y, width: w, height: h });
    minX = Math.min(minX, pos.x);
    minY = Math.min(minY, pos.y);
    maxX = Math.max(maxX, pos.x + w);
    maxY = Math.max(maxY, pos.y + h);
  }

  const routing = computeSmartEdgeRouting(view, positions, edgeRoutes, measured);
  const markerDefaultId = "redlinify-arrow-default";
  const markerLockedId = "redlinify-arrow-locked";

  const edgeSvgs: string[] = [];
  for (const edge of view.edges) {
    const route = routing[edge.id];
    if (!route) continue;
    const rendered = renderEdgeSvg(
      edge,
      view.diagram_type,
      rects,
      route,
      palette,
      isDark,
      markerDefaultId,
      markerLockedId,
    );
    edgeSvgs.push(rendered.svg);
    for (const pt of rendered.extraPoints) {
      minX = Math.min(minX, pt.x - 90);
      minY = Math.min(minY, pt.y - 24);
      maxX = Math.max(maxX, pt.x + 90);
      maxY = Math.max(maxY, pt.y + 24);
    }
  }

  const padding = 48;
  const width = Math.max(480, Math.ceil(maxX - minX + padding * 2));
  const height = Math.max(280, Math.ceil(maxY - minY + padding * 2));
  const offsetX = Math.round(-minX + padding);
  const offsetY = Math.round(-minY + padding);

  const nodeSvgs = view.nodes.map((node) =>
    renderNodeSvg(node, rects.get(node.id)!, view.diagram_type, palette, isDark),
  );

  const bgPatternDef =
    bgPattern === "grid"
      ? `<pattern id="rl-bg-pattern" width="24" height="24" patternUnits="userSpaceOnUse">
      <path d="M 24 0 L 0 0 0 24" fill="none" stroke="${isDark ? "#1e293b" : "#cbd5e1"}" stroke-width="1" />
    </pattern>`
      : `<pattern id="rl-bg-pattern" width="24" height="24" patternUnits="userSpaceOnUse">
      <circle cx="12" cy="12" r="1.4" fill="${palette.patternColor}" opacity="0.65" />
    </pattern>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    ${bgPatternDef}
    <marker id="${markerDefaultId}" viewBox="-10 -10 20 20" refX="0" refY="0" markerWidth="11" markerHeight="11" orient="auto-start-reverse">
      <polyline points="-5,-4 0,0 -5,4 -5,-4" fill="${palette.edgeDefault}" stroke="${palette.edgeDefault}" stroke-width="1" stroke-linejoin="round" />
    </marker>
    <marker id="${markerLockedId}" viewBox="-10 -10 20 20" refX="0" refY="0" markerWidth="11" markerHeight="11" orient="auto-start-reverse">
      <polyline points="-5,-4 0,0 -5,4 -5,-4" fill="${palette.edgeLocked}" stroke="${palette.edgeLocked}" stroke-width="1" stroke-linejoin="round" />
    </marker>
  </defs>
  <rect width="${width}" height="${height}" fill="${palette.canvasBg}" />
  <rect width="${width}" height="${height}" fill="url(#rl-bg-pattern)" />
  <g transform="translate(${offsetX}, ${offsetY})">
    ${edgeSvgs.join("\n")}
    ${nodeSvgs.join("\n")}
  </g>
</svg>\n`;

  return { svg, width, height };
}

export function svgToPngBlob(
  svg: string,
  width: number,
  height: number,
  scale = 2,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const maxDim = 8192;
    const boundedScale = Math.min(
      scale,
      maxDim / Math.max(1, width),
      maxDim / Math.max(1, height),
    );
    const outW = Math.max(1, Math.round(width * boundedScale));
    const outH = Math.max(1, Math.round(height * boundedScale));

    const svgBlob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);
    const img = new Image();

    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = outW;
        canvas.height = outH;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          URL.revokeObjectURL(url);
          reject(new Error("Canvas 2D context is unavailable"));
          return;
        }
        ctx.drawImage(img, 0, 0, outW, outH);
        URL.revokeObjectURL(url);
        canvas.toBlob((png) => {
          if (png) resolve(png);
          else reject(new Error("Failed to encode PNG image"));
        }, "image/png");
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to rasterize SVG diagram"));
    };
    img.src = url;
  });
}

export { renderViewToMermaid } from "./exportMermaid";

export function renderViewToJson(view: DesignView): string {
  return `${JSON.stringify(view, null, 2)}\n`;
}

export function triggerFileDownload(
  filename: string,
  content: Blob | string,
  mimeType = "text/plain;charset=utf-8",
): void {
  const blob =
    content instanceof Blob ? content : new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
