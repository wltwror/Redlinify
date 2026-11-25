import { useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Database,
  GitBranch,
  Layers,
  MessageSquare,
  Search,
  X,
} from "lucide-react";
import {
  searchItems,
  type SearchItem,
  type SearchItemKind,
  type SearchMatch,
} from "../utils/fuzzySearch";

interface CommandSearchModalProps {
  open: boolean;
  loading: boolean;
  items: SearchItem[];
  onClose: () => void;
  onSelect: (item: SearchItem) => void;
}

const SCOPE_OPTIONS: Array<{ id: "all" | SearchItemKind; label: string }> = [
  { id: "all", label: "All" },
  { id: "view", label: "Views" },
  { id: "node", label: "Nodes" },
  { id: "edge", label: "Edges" },
  { id: "thread", label: "Threads" },
];

function renderHighlightedTitle(title: string, indices: number[]) {
  if (indices.length === 0) return title;
  const hitSet = new Set(indices);
  return Array.from(title).map((ch, idx) =>
    hitSet.has(idx) ? (
      <mark
        key={idx}
        className="rounded-sm bg-sky-500/25 px-0.5 text-sky-200 font-semibold"
      >
        {ch}
      </mark>
    ) : (
      <span key={idx}>{ch}</span>
    ),
  );
}

function ItemIcon({ item }: { item: SearchItem }) {
  if (item.kind === "view") {
    return item.badge === "ER View" ? (
      <Database className="h-4 w-4 shrink-0 text-emerald-400" />
    ) : (
      <Layers className="h-4 w-4 shrink-0 text-sky-400" />
    );
  }
  if (item.kind === "node") {
    return <Box className="h-4 w-4 shrink-0 text-sky-300" />;
  }
  if (item.kind === "edge") {
    return <GitBranch className="h-4 w-4 shrink-0 text-violet-400" />;
  }
  return <MessageSquare className="h-4 w-4 shrink-0 text-amber-400" />;
}

export function CommandSearchModal({
  open,
  loading,
  items,
  onClose,
  onSelect,
}: CommandSearchModalProps) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"all" | SearchItemKind>("all");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const matches: SearchMatch[] = useMemo(
    () => searchItems(items, query, scope, 40),
    [items, query, scope],
  );

  useEffect(() => {
    if (!open) {
      setQuery("");
      setScope("all");
      setActiveIndex(0);
      return;
    }
    setActiveIndex(0);
    const id = requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, scope]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const activeEl = listRef.current.querySelector<HTMLElement>(
      `[data-search-index="${activeIndex}"]`,
    );
    activeEl?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open, matches.length]);

  if (!open) return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (matches.length > 0) {
        setActiveIndex((prev) => (prev + 1) % matches.length);
      }
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (matches.length > 0) {
        setActiveIndex((prev) => (prev - 1 + matches.length) % matches.length);
      }
      return;
    }
    if (e.key === "Enter") {
      const target = matches[activeIndex] ?? matches[0];
      if (target) {
        e.preventDefault();
        onSelect(target.item);
      }
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Quick search"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/65 px-4 pt-[11vh] backdrop-blur-sm"
    >
      <div
        onKeyDown={handleKeyDown}
        className="flex w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"
      >
        {/* Search bar */}
        <div className="flex items-center gap-2.5 border-b border-slate-800 px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-sky-400" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search views, boxes, attributes, edges, or threads..."
            aria-label="Search workspace input"
            className="w-full bg-transparent text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search query"
              className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <kbd className="hidden sm:inline-block rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
            Esc
          </kbd>
        </div>

        {/* Scope pills */}
        <div className="flex items-center justify-between gap-2 border-b border-slate-800/80 bg-slate-950/50 px-4 py-2">
          <div className="flex items-center gap-1 overflow-x-auto">
            {SCOPE_OPTIONS.map((opt) => {
              const selected = scope === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setScope(opt.id)}
                  className={`rounded-md px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                    selected
                      ? "border border-sky-500/40 bg-sky-500/20 text-sky-200"
                      : "border border-transparent text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          <span className="shrink-0 font-mono text-[10px] text-slate-500">
            {loading
              ? "Indexing…"
              : `${matches.length} result${matches.length === 1 ? "" : "s"}`}
          </span>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[54vh] overflow-y-auto p-1.5">
          {loading && matches.length === 0 ? (
            <div className="px-4 py-10 text-center text-xs text-slate-400">
              Loading views and workspace index…
            </div>
          ) : matches.length === 0 ? (
            <div className="px-4 py-10 text-center text-xs text-slate-400">
              No matching views, boxes, attributes, edges, or threads.
            </div>
          ) : (
            matches.map((match, idx) => {
              const { item, titleIndices, matchedSubEntry } = match;
              const isSelected = idx === activeIndex;
              const secondary = matchedSubEntry ?? item.subtitle;

              return (
                <button
                  key={item.id}
                  type="button"
                  data-search-index={idx}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onClick={() => onSelect(item)}
                  className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition-colors ${
                    isSelected
                      ? "bg-slate-800 text-slate-50"
                      : "text-slate-200 hover:bg-slate-800/60"
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <ItemIcon item={item} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="truncate text-xs font-medium">
                          {renderHighlightedTitle(item.title, titleIndices)}
                        </span>
                        <span className="shrink-0 rounded border border-slate-700 bg-slate-950/70 px-1.5 py-0.2 font-mono text-[10px] text-slate-400">
                          {item.badge}
                        </span>
                      </div>
                      {secondary && (
                        <div className="truncate font-mono text-[11px] text-slate-400 mt-0.5">
                          {secondary}
                        </div>
                      )}
                    </div>
                  </div>

                  {item.viewTitle && item.kind !== "view" && (
                    <span className="shrink-0 rounded-md border border-slate-700/80 bg-slate-950/60 px-2 py-0.5 text-[10px] text-slate-400">
                      {item.viewTitle}
                    </span>
                  )}
                  {item.kind === "view" && item.isCurrentView && (
                    <span className="shrink-0 rounded-md border border-sky-500/40 bg-sky-500/15 px-2 py-0.5 text-[10px] font-medium text-sky-300">
                      current
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>

        {/* Footer hints */}
        <div className="flex items-center justify-between border-t border-slate-800 bg-slate-950/60 px-4 py-1.5 text-[10px] text-slate-500">
          <span>↑↓ Navigate · Enter Jump · Esc Close</span>
          <span>Tab / Shift+Tab cycles tabs</span>
        </div>
      </div>
    </div>
  );
}
