// Shared types — mirror the Rust engine payloads.

export type GalaxyType =
  | "black_hole"
  | "nebula"
  | "cluster"
  | "galaxy"
  | "mega_galaxy"
  | "super_cluster";

export interface Universe {
  id: number;
  date: string;
  star_count: number;
  galaxy_type: GalaxyType | null;
  seed: number;
  layout_shape: string | null;
  palette: string | null;
  cluster_name: string | null;
}

export interface Star {
  id: number;
  universe_id: number;
  position_x: number;
  position_y: number;
  radius: number;
  color_r: number;
  color_g: number;
  color_b: number;
  opacity: number;
  is_big: boolean;
}

export type Rarity = "common" | "rare" | "epic" | "legendary" | "mythic";

export interface Planet {
  id: number;
  universe_id: number;
  planet_type: string;
  rarity: Rarity;
  seed: number;
  position_x: number;
  position_y: number;
  discovered_at?: string;
  acknowledged_at?: string | null;
  /** Session that ended with ≥ 5,000 tokens and triggered this planet. */
  triggering_session_id?: number | null;
}

export interface Nebula {
  id: number;
  universe_id: number;
  position_x: number;
  position_y: number;
  radius: number;
  /** Color stem like `rgba(120, 80, 180,` — alpha appended per draw. */
  color: string;
  opacity: number;
}

export interface Constellation {
  id: number;
  universe_id: number;
  name: string;
  color: string;
  star_ids: number[];
  preset_id: string | null;
  created_at: string;
}

export interface UniversePayload {
  universe: Universe;
  stars: Star[];
  planets: Planet[];
  nebulae: Nebula[];
  constellations: Constellation[];
  leftover_tokens: number;
  today_tokens: number;
}

// World-space dimensions match the Rust engine constants.
export const UNIVERSE_W = 960;
export const UNIVERSE_H = 800;

// Display size (CSS pixels). The canvas backing store is sized by DPR.
export const DISPLAY_W = 480;
export const DISPLAY_H = 400;
