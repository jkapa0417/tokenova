// Star Codex discovery tracking.
//
// A "discovered" shape is one the user has seen at least once in any of
// their daily universes. We persist the Set across launches in
// localStorage — no backend changes needed since shape is derived purely
// from `Star.id` + `Star.radius`.
//
// Counts are derived per-universe from the live star list, NOT cumulatively
// over all polls. The earlier cumulative implementation inflated counts
// (every 3 s poll re-added every star), producing values like 1,089,790.

import { shapeForStar, type StarShape } from "./star-shapes";
import type { Star } from "./types";

const STORAGE_KEY = "tokenova.star-codex.discovered.v1";

let cache: Set<StarShape> | null = null;
let liveCounts: Map<StarShape, number> = new Map();

function loadCache(): Set<StarShape> {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    cache = raw ? new Set<StarShape>(JSON.parse(raw)) : new Set<StarShape>();
  } catch {
    cache = new Set<StarShape>();
  }
  return cache;
}

function persist(): void {
  try {
    if (cache) localStorage.setItem(STORAGE_KEY, JSON.stringify([...cache]));
  } catch {
    /* quota / disabled — silently skip */
  }
}

/** Record every star in the given list as encountered (for unlocking) and
 *  refresh the per-shape count from the *current* universe — not cumulative.
 */
export function recordStarsEncountered(stars: Star[]): void {
  const set = loadCache();
  const fresh = new Map<StarShape, number>();
  let unlockedAny = false;
  for (const s of stars) {
    const shape = shapeForStar(s.id, s.radius);
    fresh.set(shape, (fresh.get(shape) ?? 0) + 1);
    if (!set.has(shape)) {
      set.add(shape);
      unlockedAny = true;
    }
  }
  liveCounts = fresh;
  if (unlockedAny) persist();
}

export function discoveredStarShapes(): Set<StarShape> {
  return loadCache();
}

export function starShapeCounts(): Map<StarShape, number> {
  return liveCounts;
}

export function totalDiscoveredStarShapes(): number {
  return loadCache().size;
}
