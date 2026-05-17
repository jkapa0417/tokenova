// Star Codex discovery tracking.
//
// A "discovered" shape is one the user has seen at least once in any of
// their daily universes. We persist the Set across launches in
// localStorage — no backend changes needed since shape is derived purely
// from `Star.id` + `Star.radius`.

import { shapeForStar, type StarShape } from "./star-shapes";
import type { Star } from "./types";

const STORAGE_KEY = "tokenova.star-codex.discovered.v1";

let cache: Set<StarShape> | null = null;
let cacheCounts: Map<StarShape, number> | null = null;
const COUNTS_KEY = "tokenova.star-codex.counts.v1";

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

function loadCounts(): Map<StarShape, number> {
  if (cacheCounts) return cacheCounts;
  try {
    const raw = localStorage.getItem(COUNTS_KEY);
    cacheCounts = raw ? new Map(JSON.parse(raw)) : new Map();
  } catch {
    cacheCounts = new Map();
  }
  return cacheCounts;
}

function persist(): void {
  try {
    if (cache) localStorage.setItem(STORAGE_KEY, JSON.stringify([...cache]));
    if (cacheCounts) {
      localStorage.setItem(COUNTS_KEY, JSON.stringify([...cacheCounts.entries()]));
    }
  } catch {
    /* quota / disabled — silently skip */
  }
}

/** Record every star in the given list as encountered. Idempotent. */
export function recordStarsEncountered(stars: Star[]): void {
  if (stars.length === 0) return;
  const set = loadCache();
  const counts = loadCounts();
  let changed = false;
  for (const s of stars) {
    const shape = shapeForStar(s.id, s.radius);
    if (!set.has(shape)) {
      set.add(shape);
      changed = true;
    }
    counts.set(shape, (counts.get(shape) ?? 0) + 1);
    changed = true;
  }
  if (changed) persist();
}

export function discoveredStarShapes(): Set<StarShape> {
  return loadCache();
}

export function starShapeCounts(): Map<StarShape, number> {
  return loadCounts();
}

export function totalDiscoveredStarShapes(): number {
  return loadCache().size;
}
