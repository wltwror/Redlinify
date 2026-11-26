export type NavigationMode = "trackpad" | "mouse";

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
  navMode: NavigationMode;
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
export const KEYBOARD_PAN_STEP = 120;
export const KEYBOARD_PAN_FAST_STEP = 260;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizeWheelDelta(delta: number, deltaMode: number): number {
  if (deltaMode === 1) return delta * 28;
  if (deltaMode === 2) return delta * 320;
  return delta;
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
  navMode,
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
    (navMode === "mouse" &&
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
