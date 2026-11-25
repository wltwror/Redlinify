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
 * Restricted Damerau-Levenshtein (Optimal String Alignment) edit distance
 * with early cutoff when every row cell exceeds `maxDist`.
 */
function damerauLevenshtein(a: string, b: string, maxDist: number): number {
  const lenA = a.length;
  const lenB = b.length;
  if (Math.abs(lenA - lenB) > maxDist) return maxDist + 1;
  if (lenA === 0) return lenB;
  if (lenB === 0) return lenA;

  let prevPrev = new Array<number>(lenB + 1).fill(0);
  let prev = Array.from({ length: lenB + 1 }, (_, j) => j);

  for (let i = 1; i <= lenA; i += 1) {
    const curr = new Array<number>(lenB + 1).fill(maxDist + 1);
    curr[0] = i;
    let rowMin = i;
    const chA = a[i - 1]!;

    for (let j = 1; j <= lenB; j += 1) {
      const chB = b[j - 1]!;
      const cost = chA === chB ? 0 : 1;
      let val = Math.min(
        prev[j]! + 1,
        curr[j - 1]! + 1,
        prev[j - 1]! + cost,
      );
      if (i > 1 && j > 1 && chA === b[j - 2] && a[i - 2] === chB) {
        val = Math.min(val, prevPrev[j - 2]! + cost);
      }
      curr[j] = val;
      if (val < rowMin) rowMin = val;
    }

    if (rowMin > maxDist) return maxDist + 1;
    prevPrev = prev;
    prev = curr;
  }

  return prev[lenB]!;
}

function maxEditsForToken(len: number): number {
  if (len <= 2) return 0;
  if (len <= 5) return 1;
  if (len <= 9) return 2;
  return 3;
}

function extractWordSpans(
  text: string,
): Array<{ word: string; start: number; end: number }> {
  const spans: Array<{ word: string; start: number; end: number }> = [];
  let start = -1;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    const isDelim = " _-.:/→()[]".includes(ch);
    if (isDelim) {
      if (start !== -1) {
        spans.push({
          word: text.slice(start, i).toLowerCase(),
          start,
          end: i,
        });
        start = -1;
      }
      continue;
    }
    const prev = i > 0 ? text[i - 1]! : "";
    const camelSplit =
      start !== -1 &&
      prev >= "a" &&
      prev <= "z" &&
      ch >= "A" &&
      ch <= "Z";
    if (camelSplit) {
      spans.push({
        word: text.slice(start, i).toLowerCase(),
        start,
        end: i,
      });
      start = i;
    } else if (start === -1) {
      start = i;
    }
  }
  if (start !== -1) {
    spans.push({
      word: text.slice(start).toLowerCase(),
      start,
      end: text.length,
    });
  }
  return spans;
}

function matchWithTypoTolerance(
  qLower: string,
  text: string,
): { score: number; indices: number[] } | null {
  const maxDist = maxEditsForToken(qLower.length);
  if (maxDist === 0) return null;

  const baseSpans = extractWordSpans(text);
  const candidates: Array<{ cand: string; start: number; end: number; compound?: boolean }> = [];

  for (let i = 0; i < baseSpans.length; i += 1) {
    const s = baseSpans[i]!;
    candidates.push({ cand: s.word, start: s.start, end: s.end });
    if (s.word.length >= qLower.length + 2 && qLower.length >= 4) {
      const prefLen = Math.min(s.word.length, qLower.length);
      candidates.push({
        cand: s.word.slice(0, prefLen),
        start: s.start,
        end: s.start + prefLen,
      });
      if (prefLen + 1 <= s.word.length) {
        candidates.push({
          cand: s.word.slice(0, prefLen + 1),
          start: s.start,
          end: s.start + prefLen + 1,
        });
      }
    }
    if (i + 1 < baseSpans.length) {
      const next = baseSpans[i + 1]!;
      candidates.push({
        cand: `${s.word}${next.word}`,
        start: s.start,
        end: next.end,
        compound: true,
      });
    }
  }

  let bestScore = -Infinity;
  let bestSpan: { start: number; end: number } | null = null;

  for (const item of candidates) {
    if (item.cand.length < 2) continue;
    const allowed = Math.min(
      maxDist,
      Math.max(1, Math.floor((Math.max(qLower.length, item.cand.length) - 1) / 2)),
    );
    const dist = damerauLevenshtein(qLower, item.cand, allowed);
    if (dist > allowed) continue;

    const boundaryBonus = item.start === 0 ? 12 : 4;
    const compoundPenalty = item.compound ? 4 : 0;
    const score =
      96 - dist * 24 + boundaryBonus - compoundPenalty - item.start * 0.1 - text.length * 0.04;
    if (score > bestScore) {
      bestScore = score;
      bestSpan = { start: item.start, end: item.end };
    }
  }

  if (!bestSpan || bestScore <= 0) return null;
  const indices: number[] = [];
  for (let idx = bestSpan.start; idx < bestSpan.end; idx += 1) {
    indices.push(idx);
  }
  return { score: bestScore, indices };
}

/**
 * Case-insensitive fuzzy matcher combining exact/substring/subsequence
 * matching with typo-tolerant Damerau-Levenshtein fallback.
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

  // DP over text indices for ordered subsequence matching across camelCase/delimiters
  const qLen = qLower.length;
  const tLen = tLower.length;
  if (qLen <= tLen) {
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
    if (winner) return winner;
  }

  // Tier 2: Typo-tolerant Damerau-Levenshtein match against word tokens & prefixes
  return matchWithTypoTolerance(qLower, text);
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
