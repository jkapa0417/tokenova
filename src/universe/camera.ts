// Camera with zoom + pan, with bounds clamping per design modification #3.
// Scale is expressed in world-units → display-pixels: at zoom=1, the full
// `UNIVERSE_W × UNIVERSE_H` world maps onto `DISPLAY_W × DISPLAY_H` exactly.

import { DISPLAY_W, UNIVERSE_H, UNIVERSE_W } from "./types";

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 8;
export const ZOOM_STEP = 1.15;

const SCALE = DISPLAY_W / UNIVERSE_W; // 0.5 — same in both axes (480/960 == 400/800)

export interface View {
  /** World-space x of the display's top-left corner. */
  x: number;
  /** World-space y of the display's top-left corner. */
  y: number;
  /** Zoom factor relative to the natural-fit view (1.0 = full universe). */
  zoom: number;
}

export function makeView(): View {
  return { x: 0, y: 0, zoom: 1 };
}

/** Convert world → display (CSS pixel) coordinates. */
export function worldToScreen(view: View, wx: number, wy: number): { x: number; y: number } {
  return {
    x: (wx - view.x) * SCALE * view.zoom,
    y: (wy - view.y) * SCALE * view.zoom,
  };
}

/** Convert display (CSS pixel) → world coordinates. */
export function screenToWorld(view: View, sx: number, sy: number): { x: number; y: number } {
  return {
    x: sx / (SCALE * view.zoom) + view.x,
    y: sy / (SCALE * view.zoom) + view.y,
  };
}

/**
 * Clamp the camera so the visible viewport always stays inside the universe.
 * At zoom=1 the visible region equals the full universe → pan locked.
 * At higher zooms there's slack on each axis equal to (1 - 1/zoom) of the
 * universe dimension.
 */
export function clampCamera(view: View): void {
  const visibleW = UNIVERSE_W / view.zoom;
  const visibleH = UNIVERSE_H / view.zoom;
  const maxX = UNIVERSE_W - visibleW;
  const maxY = UNIVERSE_H - visibleH;
  view.x = Math.max(0, Math.min(maxX, view.x));
  view.y = Math.max(0, Math.min(maxY, view.y));
}

/** Apply a wheel delta as zoom anchored on the cursor's screen position. */
export function zoomAtCursor(
  view: View,
  cursorScreenX: number,
  cursorScreenY: number,
  deltaY: number,
): void {
  const world = screenToWorld(view, cursorScreenX, cursorScreenY);
  const factor = deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
  view.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, view.zoom * factor));
  view.x = world.x - cursorScreenX / (SCALE * view.zoom);
  view.y = world.y - cursorScreenY / (SCALE * view.zoom);
  clampCamera(view);
}

/** Pan by a screen-space delta (e.g. from a drag gesture). */
export function panByScreen(view: View, dxScreen: number, dyScreen: number): void {
  view.x -= dxScreen / (SCALE * view.zoom);
  view.y -= dyScreen / (SCALE * view.zoom);
  clampCamera(view);
}

/** Re-export SCALE so renderer/interaction stay in sync. */
export const WORLD_TO_SCREEN_SCALE = SCALE;
