// Mouse interaction: drag-pan, wheel-zoom, hover, click.

import { clampCamera, panByScreen, WORLD_TO_SCREEN_SCALE, worldToScreen, zoomAtCursor, type View } from "./camera";
import type { Star } from "./types";

const DRAG_THRESHOLD_PX = 3;
const MAX_PICK_DISTANCE_PX = 18;

export interface InteractionCallbacks {
  onChange: () => void;
  onStarClick: (star: Star) => void;
  onEmptyClick: () => void;
  onHoverChange: (star: Star | null) => void;
}

export class UniverseInteraction {
  private dragging = false;
  private didDrag = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private hoveredStar: Star | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly view: View,
    private readonly getStars: () => Star[],
    private readonly callbacks: InteractionCallbacks,
  ) {
    canvas.addEventListener("mousedown", this.onMouseDown);
    canvas.addEventListener("mousemove", this.onMouseMove);
    canvas.addEventListener("mouseup", this.onMouseUp);
    canvas.addEventListener("mouseleave", this.onMouseLeave);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    canvas.style.cursor = "grab";
    clampCamera(this.view);
  }

  destroy(): void {
    this.canvas.removeEventListener("mousedown", this.onMouseDown);
    this.canvas.removeEventListener("mousemove", this.onMouseMove);
    this.canvas.removeEventListener("mouseup", this.onMouseUp);
    this.canvas.removeEventListener("mouseleave", this.onMouseLeave);
    this.canvas.removeEventListener("wheel", this.onWheel);
  }

  private pos(e: MouseEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private onMouseDown = (e: MouseEvent): void => {
    this.dragging = true;
    this.didDrag = false;
    const p = this.pos(e);
    this.dragStartX = p.x;
    this.dragStartY = p.y;
    this.canvas.style.cursor = "grabbing";
  };

  private onMouseMove = (e: MouseEvent): void => {
    const p = this.pos(e);
    if (this.dragging) {
      const dx = p.x - this.dragStartX;
      const dy = p.y - this.dragStartY;
      if (Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX) {
        this.didDrag = true;
      }
      // Pan by incremental delta and reset the anchor so the same drag works
      // regardless of zoom (each move maps screen pixels to current-zoom world units).
      panByScreen(this.view, dx, dy);
      this.dragStartX = p.x;
      this.dragStartY = p.y;
      this.callbacks.onChange();
      return;
    }

    const star = findStarAt(p.x, p.y, this.view, this.getStars());
    if (star?.id !== this.hoveredStar?.id) {
      this.hoveredStar = star;
      this.canvas.style.cursor = star ? "pointer" : "grab";
      this.callbacks.onHoverChange(star);
    }
  };

  private onMouseUp = (e: MouseEvent): void => {
    const wasDragging = this.didDrag;
    this.dragging = false;
    this.canvas.style.cursor = "grab";
    if (wasDragging) return;

    const p = this.pos(e);
    const star = findStarAt(p.x, p.y, this.view, this.getStars());
    if (star) {
      this.callbacks.onStarClick(star);
    } else {
      this.callbacks.onEmptyClick();
    }
  };

  private onMouseLeave = (): void => {
    this.dragging = false;
    if (this.hoveredStar) {
      this.hoveredStar = null;
      this.callbacks.onHoverChange(null);
    }
    this.canvas.style.cursor = "grab";
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const p = this.pos(e);
    zoomAtCursor(this.view, p.x, p.y, e.deltaY);
    this.callbacks.onChange();
  };
}

export function findStarAt(
  screenX: number,
  screenY: number,
  view: View,
  stars: Star[],
): Star | null {
  let closest: Star | null = null;
  let closestDist = MAX_PICK_DISTANCE_PX;
  for (const star of stars) {
    const s = worldToScreen(view, star.position_x, star.position_y);
    const dist = Math.hypot(s.x - screenX, s.y - screenY);
    // Pick radius grows with zoom so distant stars stay clickable, but never
    // shrinks below 8 CSS pixels.
    const pickR = Math.max(8, star.radius * WORLD_TO_SCREEN_SCALE * view.zoom + 6);
    if (dist < pickR && dist < closestDist) {
      closestDist = dist;
      closest = star;
    }
  }
  return closest;
}
