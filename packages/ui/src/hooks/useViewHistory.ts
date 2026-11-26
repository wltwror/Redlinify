import { useCallback, useRef, useState } from "react";
import type { DesignView, EdgeRoute } from "@redlinify/shared/browser";
import type { Point } from "../layout/routing";

export interface HistoryEntry {
  view: DesignView;
  positions: Record<string, Point>;
  edgeRoutes: Record<string, EdgeRoute>;
}

interface RefBox<T> {
  current: T;
}

interface UseViewHistoryOptions {
  activeViewRef: RefBox<DesignView | null>;
  positionsRef: RefBox<Record<string, Point>>;
  edgeRoutesRef: RefBox<Record<string, EdgeRoute>>;
  showToast: (message: string, tone?: "info" | "warning" | "error") => void;
}

export function useViewHistory({
  activeViewRef,
  positionsRef,
  edgeRoutesRef,
  showToast,
}: UseViewHistoryOptions) {
  const [historyTick, setHistoryTick] = useState(0);
  const undoMapRef = useRef<Map<string, HistoryEntry[]>>(new Map());
  const redoMapRef = useRef<Map<string, HistoryEntry[]>>(new Map());

  const pushHistoryEntry = useCallback(
    (viewId: string, customEntry?: HistoryEntry) => {
      const currView = activeViewRef.current;
      if (!customEntry && (!currView || currView.id !== viewId)) return;
      const entry: HistoryEntry = customEntry ?? {
        view: structuredClone(currView!),
        positions: structuredClone(positionsRef.current),
        edgeRoutes: structuredClone(edgeRoutesRef.current),
      };
      const undoStack = undoMapRef.current.get(viewId) ?? [];
      undoStack.push(entry);
      if (undoStack.length > 50) undoStack.shift();
      undoMapRef.current.set(viewId, undoStack);
      redoMapRef.current.set(viewId, []);
      setHistoryTick((t) => t + 1);
    },
    [activeViewRef, edgeRoutesRef, positionsRef],
  );

  const undoWith = useCallback(
    async (
      applyEntry: (target: HistoryEntry, curr: DesignView) => Promise<void>,
    ) => {
      const curr = activeViewRef.current;
      if (!curr) return;
      const undoStack = undoMapRef.current.get(curr.id) ?? [];
      const prev = undoStack.pop();
      if (!prev) return;
      const redoStack = redoMapRef.current.get(curr.id) ?? [];
      redoStack.push({
        view: structuredClone(curr),
        positions: structuredClone(positionsRef.current),
        edgeRoutes: structuredClone(edgeRoutesRef.current),
      });
      redoMapRef.current.set(curr.id, redoStack);
      setHistoryTick((t) => t + 1);
      await applyEntry(prev, curr);
      showToast("Undone");
    },
    [activeViewRef, edgeRoutesRef, positionsRef, showToast],
  );

  const redoWith = useCallback(
    async (
      applyEntry: (target: HistoryEntry, curr: DesignView) => Promise<void>,
    ) => {
      const curr = activeViewRef.current;
      if (!curr) return;
      const redoStack = redoMapRef.current.get(curr.id) ?? [];
      const next = redoStack.pop();
      if (!next) return;
      const undoStack = undoMapRef.current.get(curr.id) ?? [];
      undoStack.push({
        view: structuredClone(curr),
        positions: structuredClone(positionsRef.current),
        edgeRoutes: structuredClone(edgeRoutesRef.current),
      });
      undoMapRef.current.set(curr.id, undoStack);
      setHistoryTick((t) => t + 1);
      await applyEntry(next, curr);
      showToast("Redone");
    },
    [activeViewRef, edgeRoutesRef, positionsRef, showToast],
  );

  const clearViewHistory = useCallback((viewId: string) => {
    undoMapRef.current.delete(viewId);
    redoMapRef.current.delete(viewId);
  }, []);

  return {
    historyTick,
    undoMapRef,
    redoMapRef,
    pushHistoryEntry,
    undoWith,
    redoWith,
    clearViewHistory,
  };
}
