export type ScrollMode = "pan" | "zoom";

export interface SimpleViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface WheelViewportInput {
  viewport: SimpleViewport;
  clientX: number;
  clientY: number;
  containerRect: { left: number; top: number };
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  scrollMode?: ScrollMode;
  isMac?: boolean;
  minZoom?: number;
  maxZoom?: number;
  panSpeed?: number;
}

export interface WheelViewportResult {
  action: "pan" | "zoom";
  viewport: SimpleViewport;
}

export const VIEWPORT_MIN_ZOOM = 0.15;
export const VIEWPORT_MAX_ZOOM = 3;
export const TRACKPAD_PAN_SPEED = 1.0;
export const PINCH_ZOOM_SENSITIVITY = 0.009;
export const MOUSE_ZOOM_SENSITIVITY = 0.0022;
export const MAX_ZOOM_STEP = 0.2;

export const ARROW_TAP_STEP = 100;
export const ARROW_TAP_FAST_STEP = 220;
export const ARROW_HOLD_DELAY_MS = 120;
export const ARROW_ACCEL_DURATION_MS = 280;
export const ARROW_HOLD_BASE_SPEED = 560;
export const ARROW_HOLD_MAX_SPEED = 1750;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizeWheelDelta(delta: number, deltaMode: number): number {
  if (deltaMode === 1) return delta * 28;
  if (deltaMode === 2) return delta * 320;
  return delta;
}

export function computeArrowPanSpeed(heldMs: number, shiftKey: boolean): number {
  if (heldMs < ARROW_HOLD_DELAY_MS) {
    return 0;
  }
  const t = clamp(
    (heldMs - ARROW_HOLD_DELAY_MS) / ARROW_ACCEL_DURATION_MS,
    0,
    1,
  );
  const baseSpeed =
    ARROW_HOLD_BASE_SPEED +
    (ARROW_HOLD_MAX_SPEED - ARROW_HOLD_BASE_SPEED) * t * t;
  return shiftKey ? baseSpeed * 1.5 : baseSpeed;
}

export function computeNextViewportFromWheel({
  viewport,
  clientX,
  clientY,
  containerRect,
  deltaX,
  deltaY,
  deltaMode,
  ctrlKey,
  metaKey,
  shiftKey,
  scrollMode = "pan",
  isMac = false,
  minZoom = VIEWPORT_MIN_ZOOM,
  maxZoom = VIEWPORT_MAX_ZOOM,
  panSpeed = TRACKPAD_PAN_SPEED,
}: WheelViewportInput): WheelViewportResult {
  let dx = normalizeWheelDelta(deltaX, deltaMode);
  let dy = normalizeWheelDelta(deltaY, deltaMode);

  const isPinchOrModZoom = ctrlKey || metaKey;
  const shouldZoom =
    isPinchOrModZoom ||
    (scrollMode === "zoom" &&
      !shiftKey &&
      Math.abs(dy) >= Math.abs(dx) &&
      dy !== 0);

  if (shouldZoom) {
    const sensitivity = isPinchOrModZoom
      ? PINCH_ZOOM_SENSITIVITY
      : MOUSE_ZOOM_SENSITIVITY;
    const zoomStep =
      dy !== 0 ? clamp(-dy * sensitivity, -MAX_ZOOM_STEP, MAX_ZOOM_STEP) : 0;

    const nextZoom = clamp(viewport.zoom * Math.exp(zoomStep), minZoom, maxZoom);
    const px = clientX - containerRect.left;
    const py = clientY - containerRect.top;
    const ratio = nextZoom / viewport.zoom;

    return {
      action: "zoom",
      viewport: {
        x: px - (px - viewport.x) * ratio,
        y: py - (py - viewport.y) * ratio,
        zoom: nextZoom,
      },
    };
  }

  if (!isMac && shiftKey && dx === 0 && dy !== 0) {
    dx = dy;
    dy = 0;
  }

  return {
    action: "pan",
    viewport: {
      x: viewport.x - dx * panSpeed,
      y: viewport.y - dy * panSpeed,
      zoom: viewport.zoom,
    },
  };
}
