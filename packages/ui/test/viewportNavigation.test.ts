import { describe, expect, it } from "vitest";
import {
  ARROW_ACCEL_DURATION_MS,
  ARROW_HOLD_BASE_SPEED,
  ARROW_HOLD_DELAY_MS,
  ARROW_HOLD_MAX_SPEED,
  MAX_ZOOM_STEP,
  TRACKPAD_PAN_SPEED,
  VIEWPORT_MAX_ZOOM,
  VIEWPORT_MIN_ZOOM,
  computeArrowPanSpeed,
  computeNextViewportFromWheel,
  normalizeWheelDelta,
} from "../src/utils/viewportNavigation.js";

describe("viewportNavigation", () => {
  it("normalizes pixel, line, and page wheel deltas", () => {
    expect(normalizeWheelDelta(12, 0)).toBe(12);
    expect(normalizeWheelDelta(3, 1)).toBe(84);
    expect(normalizeWheelDelta(1, 2)).toBe(320);
  });

  it("pans in Pan scroll mode (default) for 2D, integer, and fractional wheel deltas while preserving zoom", () => {
    for (const [deltaX, deltaY] of [
      [40, 80],
      [0, -100],
      [0, -66.67],
    ] as const) {
      const res = computeNextViewportFromWheel({
        viewport: { x: 100, y: 50, zoom: 1.2 },
        clientX: 400,
        clientY: 300,
        containerRect: { left: 0, top: 60 },
        deltaX,
        deltaY,
        deltaMode: 0,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        scrollMode: "pan",
      });

      expect(res.action).toBe("pan");
      expect(res.viewport.x).toBeCloseTo(100 - deltaX * TRACKPAD_PAN_SPEED);
      expect(res.viewport.y).toBeCloseTo(50 - deltaY * TRACKPAD_PAN_SPEED);
      expect(res.viewport.zoom).toBe(1.2);
    }
  });

  it("performs gentle cursor-centered pinch / Ctrl+wheel zoom in Pan mode across platforms", () => {
    for (const isMac of [false, true]) {
      const start = { x: 120, y: 80, zoom: 1 };
      const containerRect = { left: 20, top: 60 };
      const clientX = 320;
      const clientY = 260;

      const res = computeNextViewportFromWheel({
        viewport: start,
        clientX,
        clientY,
        containerRect,
        deltaX: 0,
        deltaY: -6,
        deltaMode: 0,
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        scrollMode: "pan",
        isMac,
      });

      expect(res.action).toBe("zoom");
      expect(res.viewport.zoom).toBeGreaterThan(1.05);
      expect(res.viewport.zoom).toBeLessThan(1.08);

      const px = clientX - containerRect.left;
      const py = clientY - containerRect.top;
      const flowXBefore = (px - start.x) / start.zoom;
      const flowYBefore = (py - start.y) / start.zoom;
      const flowXAfter = (px - res.viewport.x) / res.viewport.zoom;
      const flowYAfter = (py - res.viewport.y) / res.viewport.zoom;

      expect(flowXAfter).toBeCloseTo(flowXBefore, 6);
      expect(flowYAfter).toBeCloseTo(flowYBefore, 6);
    }
  });

  it("clamps discrete Ctrl+wheel zoom spikes cleanly", () => {
    const res = computeNextViewportFromWheel({
      viewport: { x: 0, y: 0, zoom: 1 },
      clientX: 200,
      clientY: 200,
      containerRect: { left: 0, top: 0 },
      deltaX: 0,
      deltaY: -120,
      deltaMode: 0,
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
      scrollMode: "zoom",
    });

    expect(res.action).toBe("zoom");
    expect(res.viewport.zoom).toBeCloseTo(Math.exp(MAX_ZOOM_STEP), 5);
  });

  it("converts Shift+vertical wheel into horizontal pan on non-macOS systems", () => {
    for (const scrollMode of ["pan", "zoom"] as const) {
      const res = computeNextViewportFromWheel({
        viewport: { x: 0, y: 0, zoom: 1 },
        clientX: 200,
        clientY: 200,
        containerRect: { left: 0, top: 0 },
        deltaX: 0,
        deltaY: 100,
        deltaMode: 0,
        ctrlKey: false,
        metaKey: false,
        shiftKey: true,
        scrollMode,
        isMac: false,
      });

      expect(res.action).toBe("pan");
      expect(res.viewport.x).toBeCloseTo(-100 * TRACKPAD_PAN_SPEED);
      expect(res.viewport.y).toBe(0);
    }
  });

  it("zooms reliably in Zoom scroll mode for integer, fractional, and small vertical deltas and pans when horizontal dominates", () => {
    for (const deltaY of [-120, -66.67, -12]) {
      const zoomed = computeNextViewportFromWheel({
        viewport: { x: 0, y: 0, zoom: 1 },
        clientX: 100,
        clientY: 100,
        containerRect: { left: 0, top: 0 },
        deltaX: 0,
        deltaY,
        deltaMode: 0,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        scrollMode: "zoom",
      });
      expect(zoomed.action).toBe("zoom");
      expect(zoomed.viewport.zoom).toBeGreaterThan(1);
    }

    const horizontalPan = computeNextViewportFromWheel({
      viewport: { x: 0, y: 0, zoom: 1 },
      clientX: 100,
      clientY: 100,
      containerRect: { left: 0, top: 0 },
      deltaX: 50,
      deltaY: 10,
      deltaMode: 0,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      scrollMode: "zoom",
    });
    expect(horizontalPan.action).toBe("pan");
    expect(horizontalPan.viewport.x).toBeCloseTo(-50 * TRACKPAD_PAN_SPEED);

    const zoomedIn = computeNextViewportFromWheel({
      viewport: { x: 0, y: 0, zoom: VIEWPORT_MAX_ZOOM - 0.05 },
      clientX: 100,
      clientY: 100,
      containerRect: { left: 0, top: 0 },
      deltaX: 0,
      deltaY: -120,
      deltaMode: 0,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      scrollMode: "zoom",
    });
    expect(zoomedIn.action).toBe("zoom");
    expect(zoomedIn.viewport.zoom).toBe(VIEWPORT_MAX_ZOOM);

    const zoomedOut = computeNextViewportFromWheel({
      viewport: { x: 0, y: 0, zoom: VIEWPORT_MIN_ZOOM + 0.01 },
      clientX: 100,
      clientY: 100,
      containerRect: { left: 0, top: 0 },
      deltaX: 0,
      deltaY: 120,
      deltaMode: 0,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      scrollMode: "zoom",
    });
    expect(zoomedOut.action).toBe("zoom");
    expect(zoomedOut.viewport.zoom).toBe(VIEWPORT_MIN_ZOOM);
  });

  it("keeps arrow taps slow inside grace period and accelerates quickly when held", () => {
    expect(computeArrowPanSpeed(0, false)).toBe(0);
    expect(computeArrowPanSpeed(ARROW_HOLD_DELAY_MS - 1, false)).toBe(0);
    expect(computeArrowPanSpeed(ARROW_HOLD_DELAY_MS, false)).toBe(
      ARROW_HOLD_BASE_SPEED,
    );

    const mid = computeArrowPanSpeed(
      ARROW_HOLD_DELAY_MS + ARROW_ACCEL_DURATION_MS / 2,
      false,
    );
    expect(mid).toBeGreaterThan(ARROW_HOLD_BASE_SPEED);
    expect(mid).toBeLessThan(ARROW_HOLD_MAX_SPEED);

    expect(
      computeArrowPanSpeed(ARROW_HOLD_DELAY_MS + ARROW_ACCEL_DURATION_MS, false),
    ).toBe(ARROW_HOLD_MAX_SPEED);
    expect(
      computeArrowPanSpeed(ARROW_HOLD_DELAY_MS + ARROW_ACCEL_DURATION_MS, true),
    ).toBe(ARROW_HOLD_MAX_SPEED * 1.5);
  });
});
