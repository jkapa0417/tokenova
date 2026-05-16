/**
 * Deterministic PRNG used for client-side procedural details (planet radius,
 * palette pick within a type). Matches the mulberry32 reference algorithm so
 * the same seed always yields the same sequence.
 */
export function mulberry32(seed: number): () => number {
  let state = Math.floor(seed) | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
