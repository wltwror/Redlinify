import { useCallback, useEffect, useRef } from "react";
import type { EdgeRoute } from "@redlinify/shared/browser";
import type { useReactFlow } from "@xyflow/react";
import { saveLayout } from "../api/client";
import type { Point } from "../layout/routing";
import {
  computeNextViewportFromWheel,
  VIEWPORT_MAX_ZOOM,
  VIEWPORT_MIN_ZOOM,
  type NavigationMode,
} from "../utils/viewportNavigation";

interface RefBox<T> {
  current: T;
}

interface UseViewportNavigationOptions {
  containerRef: RefBox<HTMLDivElement | null>;
  activeViewIdRef: RefBox<string | null>;
  positionsRef: RefBox<Record<string, Point>>;
  edgeRoutesRef: RefBox<Record<string, EdgeRoute>>;
  viewportReadyRef: RefBox<boolean>;
  navMode: NavigationMode;
  getViewport: ReturnType<typeof useReactFlow>["getViewport"];
  setViewport: ReturnType<typeof useReactFlow>["setViewport"];
  fitView: ReturnType<typeof useReactFlow>["fitView"];
  zoomIn: ReturnType<typeof useReactFlow>["zoomIn"];
  zoomOut: ReturnType<typeof useReactFlow>["zoomOut"];
  zoomTo: ReturnType<typeof useReactFlow>["zoomTo"];
  clearContextMenu: () => void;
}

const WHEEL_IGNORE_SELECTOR =
  '.nowheel, .react-flow__controls, [role="dialog"], [role="menu"]';

export function useViewportNavigation({
  containerRef,
  activeViewIdRef,
  positionsRef,
  edgeRoutesRef,
  viewportReadyRef,
  navMode,
  getViewport,
  setViewport,
  fitView,
  zoomIn,
  zoomOut,
  zoomTo,
  clearContextMenu,
}: UseViewportNavigationOptions) {
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleSaveLayout = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      const viewId = activeViewIdRef.current;
      if (!viewId || !viewportReadyRef.current) return;
      void saveLayout(viewId, {
        positions: positionsRef.current,
        edge_routes: edgeRoutesRef.current,
        viewport: getViewport(),
      });
    }, 180);
  }, [
    activeViewIdRef,
    edgeRoutesRef,
    getViewport,
    positionsRef,
    viewportReadyRef,
  ]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const isMac =
      typeof navigator !== "undefined" &&
      /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent);

    const onWheel = (e: WheelEvent) => {
      if (!activeViewIdRef.current) return;
      const target = e.target;
      if (target instanceof Element && target.closest(WHEEL_IGNORE_SELECTOR)) {
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      clearContextMenu();

      const next = computeNextViewportFromWheel({
        viewport: getViewport(),
        clientX: e.clientX,
        clientY: e.clientY,
        containerRect: el.getBoundingClientRect(),
        deltaX: e.deltaX,
        deltaY: e.deltaY,
        deltaMode: e.deltaMode,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey,
        navMode,
        isMac,
        minZoom: VIEWPORT_MIN_ZOOM,
        maxZoom: VIEWPORT_MAX_ZOOM,
      });

      void setViewport(next.viewport, { duration: 0 });
      scheduleSaveLayout();
    };

    const preventGesture = (e: Event) => {
      e.preventDefault();
    };

    el.addEventListener("wheel", onWheel, { capture: true, passive: false });
    el.addEventListener("gesturestart", preventGesture, { passive: false });
    el.addEventListener("gesturechange", preventGesture, { passive: false });

    return () => {
      el.removeEventListener("wheel", onWheel, true);
      el.removeEventListener("gesturestart", preventGesture);
      el.removeEventListener("gesturechange", preventGesture);
    };
  }, [
    activeViewIdRef,
    clearContextMenu,
    containerRef,
    getViewport,
    navMode,
    scheduleSaveLayout,
    setViewport,
  ]);

  const panViewportBy = useCallback(
    (dx: number, dy: number) => {
      if (!activeViewIdRef.current) return;
      const current = getViewport();
      void setViewport(
        {
          x: current.x + dx,
          y: current.y + dy,
          zoom: current.zoom,
        },
        { duration: 90 },
      );
      scheduleSaveLayout();
    },
    [activeViewIdRef, getViewport, scheduleSaveLayout, setViewport],
  );

  const handleZoomIn = useCallback(() => {
    if (!activeViewIdRef.current) return;
    void zoomIn({ duration: 130 });
    scheduleSaveLayout();
  }, [activeViewIdRef, scheduleSaveLayout, zoomIn]);

  const handleZoomOut = useCallback(() => {
    if (!activeViewIdRef.current) return;
    void zoomOut({ duration: 130 });
    scheduleSaveLayout();
  }, [activeViewIdRef, scheduleSaveLayout, zoomOut]);

  const handleFitView = useCallback(() => {
    if (!activeViewIdRef.current) return;
    void fitView({ padding: 0.16, maxZoom: 1.05, duration: 180 });
    scheduleSaveLayout();
  }, [activeViewIdRef, fitView, scheduleSaveLayout]);

  const handleResetZoom = useCallback(() => {
    if (!activeViewIdRef.current) return;
    void zoomTo(1, { duration: 150 });
    scheduleSaveLayout();
  }, [activeViewIdRef, scheduleSaveLayout, zoomTo]);

  return {
    panViewportBy,
    handleZoomIn,
    handleZoomOut,
    handleFitView,
    handleResetZoom,
  };
}
