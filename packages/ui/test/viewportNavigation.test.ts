import { describe, expect, it } from "vitest";
import {
  TRACKPAD_PAN_SPEED,
  VIEWPORT_MAX_ZOOM,
  VIEWPORT_MIN_ZOOM,
  computeNextViewportFromWheel,
  normalizeWheelDelta,
} from "../src/utils/viewportNavigation.js";

describe("viewportNavigation", () => {
  it("normalizes pixel, line, and page wheel deltas", () => {
    expect(normalizeWheelDelta(12, 0)).toBe(12);
    expect(normalizeWheelDelta(3, 1)).toBe(84);
    expect(normalizeWheelDelta(1, 2)).toBe(320);
  });

  it("pans in 2D at boosted speed in trackpad mode while preserving zoom", () => {
    const res = computeNextViewportFromWheel({
      viewport: { x: 100, y: 50, zoom: 1.2 },
      clientX: 400,
      clientY: 300,
      containerRect: { left: 0, top: 60 },
      deltaX: 40,
      deltaY: 80,
      deltaMode: 0,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      navMode: "trackpad",
    });

    expect(res.action).toBe("pan");
    expect(res.viewport.x).toBeCloseTo(100 - 40 * TRACKPAD_PAN_SPEED);
    expect(res.viewport.y).toBeCloseTo(50 - 80 * TRACKPAD_PAN_SPEED);
    expect(res.viewport.zoom).toBe(1.2);
  });

  it("performs responsive cursor-centered pinch zoom on Windows/Linux and macOS", () => {
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
        navMode: "trackpad",
        isMac,
      });

      expect(res.action).toBe("zoom");
      expect(res.viewport.zoom).toBeGreaterThan(1.08);

      // Verify flow point directly under cursor remains anchored
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
      navMode: "trackpad",
    });

    expect(res.action).toBe("zoom");
    expect(res.viewport.zoom).toBeCloseTo(Math.exp(0.3), 5);
  });

  it("converts Shift+vertical wheel into horizontal pan on non-macOS systems", () => {
    for (const navMode of ["trackpad", "mouse"] as const) {
      const res = computeNextViewportFromWheel({
        viewport: { x: 0, y: 0, zoom: 1 },
        clientX: 200,
        clientY: 200,
        containerRect: { left: 0, top: 0 },
        deltaX: 0,
        deltaY: 50,
        deltaMode: 0,
        ctrlKey: false,
        metaKey: false,
        shiftKey: true,
        navMode,
        isMac: false,
      });

      expect(res.action).toBe("pan");
      expect(res.viewport.x).toBeCloseTo(-50 * TRACKPAD_PAN_SPEED);
      expect(res.viewport.y).toBe(0);
    }
  });

  it("zooms on plain vertical wheel in mouse mode and clamps zoom bounds", () => {
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
      navMode: "mouse",
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
      navMode: "mouse",
    });
    expect(zoomedOut.action).toBe("zoom");
    expect(zoomedOut.viewport.zoom).toBe(VIEWPORT_MIN_ZOOM);
  });
});
