import type {
  DesignThread,
  DesignView,
  ThreadTargetType,
} from "@redlinify/shared/browser";
import type { TabStatusSummary } from "../api/client";
import type { ElementDrawerTab } from "../components/InspectorDrawer";

export type SearchItemKind = "view" | "node" | "edge" | "thread";

export interface SearchSubEntry {
  label: string;
  text: string;
}

export interface SearchItem {
  id: string;
  kind: SearchItemKind;
  title: string;
  subtitle?: string;
  viewId?: string;
  viewTitle?: string;
  targetType?: ThreadTargetType;
  targetId?: string;
  preferredTab?: ElementDrawerTab;
  badge: string;
  keywords: string[];
  subEntries?: SearchSubEntry[];
  isCurrentView?: boolean;
}

export interface SearchMatch {
  item: SearchItem;
  score: number;
  titleIndices: number[];
  matchedSubEntry?: string;
}

function isBoundary(text: string, idx: number): boolean {
  if (idx <= 0) return true;
  const prev = text[idx - 1]!;
  const curr = text[idx]!;
  if (" _-.:/→()[]".includes(prev)) return true;
  // CamelCase boundary (e.g. "designStorage")
  return (
    prev >= "a" &&
    prev <= "z" &&
    curr >= "A" &&
    curr <= "Z"
  );
}

/**
 * Case-insensitive ordered subsequence fuzzy matcher that rewards exact,
 * prefix, word/camelCase-boundary, and contiguous character matches.
 */
export function fuzzyMatch(
  rawQuery: string,
  rawText: string,
): { score: number; indices: number[] } | null {
  const query = rawQuery.trim();
  if (!query) return { score: 0, indices: [] };
  if (!rawText) return null;

  const text = rawText.length > 320 ? rawText.slice(0, 320) : rawText;
  const qLower = query.toLowerCase();
  const tLower = text.toLowerCase();

  if (tLower === qLower) {
    return {
      score: 260 + query.length * 10,
      indices: Array.from({ length: text.length }, (_, i) => i),
    };
  }

  // Fast path: pick the best boundary-aligned contiguous substring if one exists
  let bestSubIdx = -1;
  let bestSubBonus = -Infinity;
  let searchFrom = 0;
  while (searchFrom <= tLower.length - qLower.length) {
    const idx = tLower.indexOf(qLower, searchFrom);
    if (idx === -1) break;
    const bonus =
      (idx === 0 ? 55 : isBoundary(text, idx) ? 35 : 0) - idx * 0.25;
    if (bonus > bestSubBonus) {
      bestSubBonus = bonus;
      bestSubIdx = idx;
    }
    searchFrom = idx + 1;
  }
  if (bestSubIdx !== -1) {
    return {
      score: 140 + bestSubBonus + qLower.length * 8 - text.length * 0.05,
      indices: Array.from({ length: qLower.length }, (_, i) => bestSubIdx + i),
    };
  }

  // DP over text indices for each query character so skipped gaps choose optimal boundaries
  const qLen = qLower.length;
  const tLen = tLower.length;
  if (qLen > tLen) return null;

  let prevRow: Array<{ score: number; indices: number[] } | null> = new Array(
    tLen,
  ).fill(null);

  for (let ti = 0; ti < tLen; ti += 1) {
    if (tLower[ti] === qLower[0]) {
      const bonus =
        (ti === 0 ? 18 : isBoundary(text, ti) ? 14 : 0) +
        (text[ti] === query[0] ? 2 : 0) -
        ti * 0.15;
      prevRow[ti] = { score: 6 + bonus, indices: [ti] };
    }
  }

  for (let qi = 1; qi < qLen; qi += 1) {
    const currRow: Array<{ score: number; indices: number[] } | null> =
      new Array(tLen).fill(null);
    let bestPrevIdx = -1;
    let bestPrev: { score: number; indices: number[] } | null = null;

    for (let ti = qi; ti < tLen; ti += 1) {
      const candidatePrev = prevRow[ti - 1];
      if (
        candidatePrev &&
        (!bestPrev ||
          candidatePrev.score >= bestPrev.score - (ti - 1 - bestPrevIdx) * 0.6)
      ) {
        bestPrevIdx = ti - 1;
        bestPrev = candidatePrev;
      }

      if (bestPrev && tLower[ti] === qLower[qi]) {
        const consecutive = bestPrevIdx === ti - 1;
        const gap = ti - bestPrevIdx - 1;
        const stepScore =
          5 +
          (consecutive ? 16 : isBoundary(text, ti) ? 12 : 0) +
          (text[ti] === query[qi] ? 2 : 0) -
          Math.min(12, gap * 0.6);
        currRow[ti] = {
          score: bestPrev.score + stepScore,
          indices: [...bestPrev.indices, ti],
        };
      }
    }
    prevRow = currRow;
  }

  let winner: { score: number; indices: number[] } | null = null;
  for (let ti = 0; ti < tLen; ti += 1) {
    const cell = prevRow[ti];
    if (!cell) continue;
    const adjusted = cell.score - text.length * 0.05;
    if (!winner || adjusted > winner.score) {
      winner = { score: adjusted, indices: cell.indices };
    }
  }
  return winner;
}

export function buildSearchIndex(params: {
  tabs: TabStatusSummary[];
  views: DesignView[];
  allThreads: DesignThread[];
  activeViewId: string | null;
}): SearchItem[] {
  const { tabs, views, allThreads, activeViewId } = params;
  const items: SearchItem[] = [];
  const viewById = new Map(views.map((v) => [v.id, v]));
  const tabById = new Map(tabs.map((t) => [t.view_id, t]));

  const orderedViews: DesignView[] = [];
  const seenViewIds = new Set<string>();

  for (const tab of tabs) {
    items.push({
      id: `view:${tab.view_id}`,
      kind: "view",
      title: tab.title,
      subtitle: tab.description,
      viewId: tab.view_id,
      viewTitle: tab.title,
      targetType: "view",
      badge: tab.diagram_type === "er" ? "ER View" : "View",
      keywords: [
        tab.view_id,
        tab.diagram_type ?? "general",
        tab.description ?? "",
      ].filter(Boolean),
      isCurrentView: tab.view_id === activeViewId,
    });
    const v = viewById.get(tab.view_id);
    if (v) {
      orderedViews.push(v);
      seenViewIds.add(v.id);
    }
  }

  for (const v of views) {
    if (!seenViewIds.has(v.id)) {
      orderedViews.push(v);
    }
  }

  for (const view of orderedViews) {
    const tabMeta = tabById.get(view.id);
    const viewTitle = tabMeta?.title ?? view.title;
    const isCurrentView = view.id === activeViewId;
    const nodeTitleById = new Map(view.nodes.map((n) => [n.id, n.title]));

    for (const node of view.nodes) {
      const subEntries: SearchSubEntry[] = [];
      for (const sec of node.sections) {
        subEntries.push({
          label: `Section: ${sec.heading}`,
          text: sec.heading,
        });
        for (const entry of sec.items) {
          subEntries.push({
            label: `${sec.heading}: ${entry}`,
            text: `${sec.heading} ${entry}`,
          });
        }
      }
      for (const fld of node.fields ?? []) {
        subEntries.push({
          label: `Attr: ${fld.name}${fld.type ? `: ${fld.type}` : ""}`,
          text: `${fld.name}${fld.type ? ` ${fld.type}` : ""}`,
        });
      }

      items.push({
        id: `node:${view.id}:${node.id}`,
        kind: "node",
        title: node.title,
        subtitle: node.summary,
        viewId: view.id,
        viewTitle,
        targetType: "node",
        targetId: node.id,
        preferredTab: "spec",
        badge: node.kind,
        keywords: [
          node.id,
          node.kind,
          node.status,
          node.entity_ref ?? "",
          ...(node.code_refs ?? []).map((r) =>
            r.symbol ? `${r.path}:${r.symbol}` : r.path,
          ),
        ].filter(Boolean),
        subEntries,
        isCurrentView,
      });
    }

    for (const edge of view.edges) {
      const srcTitle = nodeTitleById.get(edge.source) ?? edge.source;
      const tgtTitle = nodeTitleById.get(edge.target) ?? edge.target;
      const cardText =
        edge.source_cardinality || edge.target_cardinality
          ? `${edge.source_cardinality ?? ""} : ${edge.target_cardinality ?? ""}`
          : undefined;
      items.push({
        id: `edge:${view.id}:${edge.id}`,
        kind: "edge",
        title: edge.label
          ? `${edge.label} (${srcTitle} → ${tgtTitle})`
          : `${srcTitle} → ${tgtTitle}`,
        subtitle: cardText ?? edge.relation_kind,
        viewId: view.id,
        viewTitle,
        targetType: "edge",
        targetId: edge.id,
        preferredTab: "spec",
        badge: "Edge",
        keywords: [
          edge.id,
          edge.label ?? "",
          srcTitle,
          tgtTitle,
          edge.source,
          edge.target,
          edge.source_cardinality ?? "",
          edge.target_cardinality ?? "",
        ].filter(Boolean),
        isCurrentView,
      });
    }
  }

  for (const thread of allThreads) {
    const viewTitle = thread.view_id
      ? (tabById.get(thread.view_id)?.title ??
        viewById.get(thread.view_id)?.title ??
        thread.view_id)
      : "Workspace";
    items.push({
      id: `thread:${thread.id}`,
      kind: "thread",
      title:
        thread.resolution_summary ||
        thread.messages[0]?.body ||
        thread.id,
      subtitle: thread.target_id
        ? `${thread.target_type}: ${thread.target_id}`
        : thread.target_type,
      viewId: thread.view_id,
      viewTitle,
      targetType: thread.target_type,
      targetId: thread.target_id,
      preferredTab: "threads",
      badge:
        thread.status === "resolved"
          ? "Decision"
          : thread.kind.replace("_", " "),
      keywords: [
        thread.id,
        thread.target_id ?? "",
        thread.entity_ref ?? "",
        ...thread.messages.map((m) => m.body),
      ].filter(Boolean),
      isCurrentView: Boolean(thread.view_id && thread.view_id === activeViewId),
    });
  }

  return items;
}

const DEFAULT_KIND_PRIORITY: Record<SearchItemKind, number> = {
  view: 4,
  node: 3,
  edge: 2,
  thread: 1,
};

export function searchItems(
  items: SearchItem[],
  rawQuery: string,
  scope: "all" | SearchItemKind = "all",
  limit = 40,
): SearchMatch[] {
  const scoped =
    scope === "all" ? items : items.filter((item) => item.kind === scope);
  const tokens = rawQuery
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (tokens.length === 0) {
    return [...scoped]
      .sort((a, b) => {
        const ka = DEFAULT_KIND_PRIORITY[a.kind];
        const kb = DEFAULT_KIND_PRIORITY[b.kind];
        if (ka !== kb) return kb - ka;
        if (Boolean(a.isCurrentView) !== Boolean(b.isCurrentView)) {
          return a.isCurrentView ? -1 : 1;
        }
        return 0;
      })
      .slice(0, limit)
      .map((item) => ({ item, score: 0, titleIndices: [] }));
  }

  const results: SearchMatch[] = [];

  for (const item of scoped) {
    let totalScore = 0;
    let allTokensMatched = true;
    const titleIndexSet = new Set<number>();
    let matchedSubEntry: string | undefined;

    for (const token of tokens) {
      let bestTokenScore = -Infinity;

      const titleMatch = fuzzyMatch(token, item.title);
      if (titleMatch) {
        bestTokenScore = Math.max(bestTokenScore, titleMatch.score * 1.45);
        for (const idx of titleMatch.indices) titleIndexSet.add(idx);
      }

      if (item.subtitle) {
        const subMatch = fuzzyMatch(token, item.subtitle);
        if (subMatch) {
          bestTokenScore = Math.max(bestTokenScore, subMatch.score * 0.95);
        }
      }

      if (item.viewTitle) {
        const vtMatch = fuzzyMatch(token, item.viewTitle);
        if (vtMatch) {
          bestTokenScore = Math.max(bestTokenScore, vtMatch.score * 0.8);
        }
      }

      for (const kw of item.keywords) {
        const kwMatch = fuzzyMatch(token, kw);
        if (kwMatch) {
          bestTokenScore = Math.max(bestTokenScore, kwMatch.score * 0.9);
        }
      }

      if (item.subEntries) {
        for (const se of item.subEntries) {
          const seMatch = fuzzyMatch(token, se.text);
          if (seMatch) {
            const weighted = seMatch.score * 1.05;
            if (weighted > bestTokenScore) {
              bestTokenScore = weighted;
            }
            if (!matchedSubEntry) {
              matchedSubEntry = se.label;
            }
          }
        }
      }

      if (bestTokenScore === -Infinity) {
        allTokensMatched = false;
        break;
      }

      totalScore += bestTokenScore;
    }

    if (!allTokensMatched) continue;

    if (item.isCurrentView) totalScore += 18;
    if (item.kind === "view") totalScore += 10;

    results.push({
      item,
      score: totalScore,
      titleIndices: Array.from(titleIndexSet).sort((a, b) => a - b),
      matchedSubEntry,
    });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}
