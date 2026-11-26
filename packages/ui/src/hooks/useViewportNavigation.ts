import { useCallback, useEffect, useRef } from "react";
import type { EdgeRoute } from "@redlinify/shared/browser";
import type { useReactFlow } from "@xyflow/react";
import { saveLayout } from "../api/client";
import type { Point } from "../layout/routing";
import {
  ARROW_TAP_FAST_STEP,
  ARROW_TAP_STEP,
  VIEWPORT_MAX_ZOOM,
  VIEWPORT_MIN_ZOOM,
  computeArrowPanSpeed,
  computeNextViewportFromWheel,
  type ScrollMode,
} from "../utils/viewportNavigation";

export type ArrowDirectionKey =
  | "ArrowUp"
  | "ArrowDown"
  | "ArrowLeft"
  | "ArrowRight";

interface RefBox<T> {
  current: T;
}

interface UseViewportNavigationOptions {
  containerRef: RefBox<HTMLDivElement | null>;
  activeViewIdRef: RefBox<string | null>;
  positionsRef: RefBox<Record<string, Point>>;
  edgeRoutesRef: RefBox<Record<string, EdgeRoute>>;
  viewportReadyRef: RefBox<boolean>;
  scrollMode: ScrollMode;
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

function getDirectionVector(pressed: Set<ArrowDirectionKey>): Point {
  let vx = 0;
  let vy = 0;
  if (pressed.has("ArrowLeft")) vx += 1;
  if (pressed.has("ArrowRight")) vx -= 1;
  if (pressed.has("ArrowUp")) vy += 1;
  if (pressed.has("ArrowDown")) vy -= 1;
  if (vx !== 0 && vy !== 0) {
    const invSqrt2 = 1 / Math.SQRT2;
    vx *= invSqrt2;
    vy *= invSqrt2;
  }
  return { x: vx, y: vy };
}

export function useViewportNavigation({
  containerRef,
  activeViewIdRef,
  positionsRef,
  edgeRoutesRef,
  viewportReadyRef,
  scrollMode,
  getViewport,
  setViewport,
  fitView,
  zoomIn,
  zoomOut,
  zoomTo,
  clearContextMenu,
}: UseViewportNavigationOptions) {
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollModeRef = useRef<ScrollMode>(scrollMode);
  scrollModeRef.current = scrollMode;

  const pressedArrowsRef = useRef<Set<ArrowDirectionKey>>(new Set());
  const arrowShiftRef = useRef(false);
  const arrowStartTsRef = useRef(0);
  const arrowLastFrameTsRef = useRef(0);
  const arrowRafRef = useRef<number | null>(null);

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

  const cancelArrowLoop = useCallback(() => {
    if (arrowRafRef.current !== null) {
      cancelAnimationFrame(arrowRafRef.current);
      arrowRafRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      cancelArrowLoop();
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, [cancelArrowLoop]);

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
        scrollMode: scrollModeRef.current,
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
    scheduleSaveLayout,
    setViewport,
  ]);

  const runArrowTick = useCallback(
    (now: number) => {
      if (pressedArrowsRef.current.size === 0 || !activeViewIdRef.current) {
        arrowRafRef.current = null;
        return;
      }

      const dt = Math.min(
        Math.max((now - arrowLastFrameTsRef.current) / 1000, 0),
        0.05,
      );
      arrowLastFrameTsRef.current = now;

      const speed = computeArrowPanSpeed(
        now - arrowStartTsRef.current,
        arrowShiftRef.current,
      );
      if (speed > 0 && dt > 0) {
        const dir = getDirectionVector(pressedArrowsRef.current);
        if (dir.x !== 0 || dir.y !== 0) {
          const vp = getViewport();
          void setViewport(
            {
              x: vp.x + dir.x * speed * dt,
              y: vp.y + dir.y * speed * dt,
              zoom: vp.zoom,
            },
            { duration: 0 },
          );
        }
      }

      arrowRafRef.current = requestAnimationFrame(runArrowTick);
    },
    [activeViewIdRef, getViewport, setViewport],
  );

  const startArrowPan = useCallback(
    (key: ArrowDirectionKey, shiftKey: boolean) => {
      if (!activeViewIdRef.current) return;
      arrowShiftRef.current = shiftKey;
      if (pressedArrowsRef.current.has(key)) return;

      const wasIdle = pressedArrowsRef.current.size === 0;
      const now = performance.now();
      if (wasIdle) {
        arrowStartTsRef.current = now;
        arrowLastFrameTsRef.current = now;
      }
      pressedArrowsRef.current.add(key);

      const tapStep = shiftKey ? ARROW_TAP_FAST_STEP : ARROW_TAP_STEP;
      const dx = key === "ArrowLeft" ? tapStep : key === "ArrowRight" ? -tapStep : 0;
      const dy = key === "ArrowUp" ? tapStep : key === "ArrowDown" ? -tapStep : 0;
      const vp = getViewport();
      void setViewport(
        {
          x: vp.x + dx,
          y: vp.y + dy,
          zoom: vp.zoom,
        },
        { duration: 0 },
      );
      scheduleSaveLayout();

      if (arrowRafRef.current === null) {
        arrowRafRef.current = requestAnimationFrame(runArrowTick);
      }
    },
    [
      activeViewIdRef,
      getViewport,
      runArrowTick,
      scheduleSaveLayout,
      setViewport,
    ],
  );

  const stopArrowPan = useCallback(
    (key: ArrowDirectionKey) => {
      if (!pressedArrowsRef.current.has(key)) return;
      pressedArrowsRef.current.delete(key);
      if (pressedArrowsRef.current.size === 0) {
        cancelArrowLoop();
        scheduleSaveLayout();
      }
    },
    [cancelArrowLoop, scheduleSaveLayout],
  );

  const updateArrowShift = useCallback((shiftKey: boolean) => {
    arrowShiftRef.current = shiftKey;
  }, []);

  const stopAllArrowPan = useCallback(() => {
    const hadActive = pressedArrowsRef.current.size > 0;
    pressedArrowsRef.current.clear();
    arrowShiftRef.current = false;
    cancelArrowLoop();
    if (hadActive) {
      scheduleSaveLayout();
    }
  }, [cancelArrowLoop, scheduleSaveLayout]);

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
    startArrowPan,
    stopArrowPan,
    updateArrowShift,
    stopAllArrowPan,
    handleZoomIn,
    handleZoomOut,
    handleFitView,
    handleResetZoom,
  };
}
