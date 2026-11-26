import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { useReactFlow } from "@xyflow/react";
import type {
  DesignThread,
  DesignView,
  EdgeRoute,
  SemanticDiff,
} from "@redlinify/shared/browser";
import {
  ApiError,
  connectWebSocket,
  fetchThreads,
  fetchView,
  fetchWorkspace,
  saveLayout,
  saveView,
  type WorkspaceSnapshot,
} from "../api/client";
import { computeAutoLayout } from "../layout/elk";
import type { Point } from "../layout/routing";
import type { HistoryEntry } from "./useViewHistory";

interface RefBox<T> {
  current: T;
}

interface UseWorkspaceSyncOptions {
  activeViewIdRef: RefBox<string | null>;
  activeViewRef: RefBox<DesignView | null>;
  positionsRef: RefBox<Record<string, Point>>;
  edgeRoutesRef: RefBox<Record<string, EdgeRoute>>;
  viewportReadyRef: RefBox<boolean>;
  fitView: ReturnType<typeof useReactFlow>["fitView"];
  setViewport: ReturnType<typeof useReactFlow>["setViewport"];
  getViewport: ReturnType<typeof useReactFlow>["getViewport"];
  pushHistoryEntry: (viewId: string, customEntry?: HistoryEntry) => void;
  showToast: (message: string, tone?: "info" | "warning" | "error") => void;
}

export function useWorkspaceSync({
  activeViewIdRef,
  activeViewRef,
  positionsRef,
  edgeRoutesRef,
  viewportReadyRef,
  fitView,
  setViewport,
  getViewport,
  pushHistoryEntry,
  showToast,
}: UseWorkspaceSyncOptions) {
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<DesignView | null>(null);
  const [viewHash, setViewHash] = useState<string | undefined>(undefined);
  const [viewDiff, setViewDiff] = useState<SemanticDiff | null>(null);
  const [allThreads, setAllThreads] = useState<DesignThread[]>([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [wsEverConnected, setWsEverConnected] = useState(false);
  const [wsGraceExpired, setWsGraceExpired] = useState(false);
  const [conflictBanner, setConflictBanner] = useState(false);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const [routingTick, setRoutingTick] = useState(0);

  const viewHashRef = useRef<string | undefined>(undefined);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());

  activeViewIdRef.current = activeViewId;
  activeViewRef.current = activeView;
  viewHashRef.current = viewHash;

  const tabs = useMemo(() => snapshot?.status.tabs ?? [], [snapshot]);

  const loadWorkspaceMeta = useCallback(async () => {
    const [wsSnap, thrRes] = await Promise.all([
      fetchWorkspace(),
      fetchThreads(),
    ]);
    setSnapshot(wsSnap);
    setAllThreads(thrRes.threads);
    return wsSnap;
  }, []);

  const persistCurrentLayout = useCallback(
    async (viewId: string) => {
      await saveLayout(viewId, {
        positions: positionsRef.current,
        edge_routes: edgeRoutesRef.current,
        viewport: getViewport(),
      });
    },
    [edgeRoutesRef, getViewport, positionsRef],
  );

  const loadViewDetail = useCallback(
    async (
      viewId: string,
      options?: { preserveViewport?: boolean; forceResetLayout?: boolean },
    ): Promise<DesignView> => {
      const detail = await fetchView(viewId);
      const savedPositions = options?.forceResetLayout
        ? {}
        : detail.layout.positions;
      const mergedPositions = await computeAutoLayout(
        detail.view,
        { positions: savedPositions },
        { forceReset: options?.forceResetLayout },
      );

      positionsRef.current = mergedPositions;
      edgeRoutesRef.current = options?.forceResetLayout
        ? {}
        : (detail.layout.edge_routes ?? {});
      activeViewRef.current = detail.view;
      setActiveView(detail.view);
      setViewHash(detail.view_hash);
      setViewDiff(detail.diff);
      setConflictBanner(false);
      setLayoutVersion((v) => v + 1);
      setRoutingTick((t) => t + 1);

      if (!options?.preserveViewport) {
        viewportReadyRef.current = false;
        requestAnimationFrame(() => {
          if (detail.layout.viewport && !options?.forceResetLayout) {
            void setViewport(detail.layout.viewport, { duration: 150 });
          } else {
            void fitView({ padding: 0.16, maxZoom: 1.05, duration: 180 });
          }
          setTimeout(() => {
            viewportReadyRef.current = true;
          }, 250);
        });
      }
      return detail.view;
    },
    [activeViewRef, edgeRoutesRef, fitView, positionsRef, setViewport, viewportReadyRef],
  );

  // Initial load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const wsSnap = await loadWorkspaceMeta();
        if (cancelled) return;
        const hashId = window.location.hash.startsWith("#view=")
          ? decodeURIComponent(window.location.hash.slice("#view=".length))
          : null;
        const firstId = wsSnap.status.tabs[0]?.view_id ?? null;
        const initialId =
          hashId && wsSnap.status.tabs.some((t) => t.view_id === hashId)
            ? hashId
            : firstId;

        if (initialId) {
          setActiveViewId(initialId);
          await loadViewDetail(initialId);
        }
      } catch (err) {
        if (!cancelled) {
          showToast(
            err instanceof Error ? err.message : "Failed to load workspace",
            "error",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadViewDetail, loadWorkspaceMeta, showToast]);

  // WebSocket live updates
  useEffect(() => {
    const graceTimer = setTimeout(() => setWsGraceExpired(true), 2000);
    const disconnect = connectWebSocket(
      (event) => {
        void (async () => {
          await loadWorkspaceMeta();
          const currentId = activeViewIdRef.current;

          if (
            event.type === "view_updated" &&
            currentId &&
            event.view_id === currentId &&
            event.origin === "external"
          ) {
            await loadViewDetail(currentId, { preserveViewport: true });
            showToast(`Agent updated view "${currentId}"`, "info");
          } else if (
            event.type === "view_updated" &&
            event.origin === "external"
          ) {
            showToast(`Agent updated "${event.view_id}"`, "info");
          } else if (
            event.type === "threads_updated" &&
            event.origin === "external"
          ) {
            showToast("Agent updated a thread", "info");
          } else if (
            event.type === "workspace_updated" &&
            event.origin === "external"
          ) {
            const ws = await loadWorkspaceMeta();
            if (!currentId && ws.status.tabs[0]?.view_id) {
              const first = ws.status.tabs[0].view_id;
              setActiveViewId(first);
              await loadViewDetail(first);
            }
          }
        })();
      },
      (connected) => {
        setWsConnected(connected);
        if (connected) setWsEverConnected(true);
      },
    );
    return () => {
      clearTimeout(graceTimer);
      disconnect();
    };
  }, [activeViewIdRef, loadViewDetail, loadWorkspaceMeta, showToast]);

  const persistView = useCallback(
    async (nextView: DesignView, options?: { recordHistory?: boolean }) => {
      const recordHistory = options?.recordHistory !== false;
      const currentSnapshot = activeViewRef.current;
      if (
        recordHistory &&
        currentSnapshot &&
        currentSnapshot.id === nextView.id
      ) {
        pushHistoryEntry(nextView.id);
      }

      const run = async () => {
        try {
          const saved = await saveView(nextView, viewHashRef.current);
          setActiveView(saved.view);
          setViewHash(saved.view_hash);
          setViewDiff(saved.diff);
          setConflictBanner(false);
          await loadWorkspaceMeta();
        } catch (err) {
          if (err instanceof ApiError && err.status === 409) {
            setConflictBanner(true);
            showToast(
              "View changed on disk; reload to sync latest version.",
              "warning",
            );
          } else {
            showToast(
              err instanceof Error ? err.message : "Failed to save view",
              "error",
            );
          }
          throw err;
        }
      };

      const queued = saveChainRef.current.then(run, run);
      saveChainRef.current = queued.catch(() => {});
      return queued;
    },
    [activeViewRef, loadWorkspaceMeta, pushHistoryEntry, showToast],
  );

  const applyHistoryEntry = useCallback(
    async (target: HistoryEntry, curr: DesignView) => {
      positionsRef.current = structuredClone(target.positions);
      edgeRoutesRef.current = structuredClone(target.edgeRoutes);
      setLayoutVersion((v) => v + 1);
      setRoutingTick((t) => t + 1);
      await persistCurrentLayout(curr.id);
      if (JSON.stringify(target.view) !== JSON.stringify(curr)) {
        await persistView(target.view, { recordHistory: false });
      }
    },
    [edgeRoutesRef, persistCurrentLayout, persistView, positionsRef],
  );

  return {
    snapshot,
    tabs,
    activeViewId,
    setActiveViewId,
    activeView,
    setActiveView,
    viewDiff,
    setViewDiff,
    allThreads,
    wsConnected,
    wsEverConnected,
    wsGraceExpired,
    conflictBanner,
    layoutVersion,
    setLayoutVersion,
    routingTick,
    setRoutingTick,
    loadWorkspaceMeta,
    persistCurrentLayout,
    loadViewDetail,
    persistView,
    applyHistoryEntry,
  };
}
